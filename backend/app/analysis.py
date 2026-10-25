"""Pure analysis functions: decision-time forecast selection and accuracy metrics.

Conventions
-----------
* All timestamps are timezone-aware UTC datetimes internally.
* error = forecast - actual (MW). Positive error = over-forecast: less wind turned up
  than forecast, so a buyer who trusted the forecast would be *short* and exposed to
  imbalance/top-up costs. Negative error = under-forecast (over-procured).
* Forecasts are hourly (WINDFOR) and actuals half-hourly (FUELHH). Accuracy is measured
  where both exist, i.e. joined on identical startTime (the :00 half-hour of each hour).
"""

from __future__ import annotations

import bisect
import json
import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from .config import DELIVERY_FIRST, DELIVERY_LAST, UK_TZ


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def fmt_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Dataset:
    # startTime -> list of (publishTime, MW), sorted by publishTime
    forecasts: dict[datetime, list[tuple[datetime, int]]]
    # startTime -> MW (half-hourly)
    actuals: dict[datetime, int]
    fetched_at: str
    source: str

    @classmethod
    def from_snapshot(cls, snapshot: dict) -> "Dataset":
        forecasts: dict[datetime, list[tuple[datetime, int]]] = {}
        for publish, start, gen in snapshot["forecasts"]:
            forecasts.setdefault(parse_ts(start), []).append((parse_ts(publish), gen))
        for runs in forecasts.values():
            runs.sort()
        actuals = {parse_ts(start): gen for start, gen in snapshot["actuals"]}
        return cls(forecasts, actuals, snapshot.get("fetchedAt", ""), snapshot.get("source", ""))

    @classmethod
    def load(cls, path: Path) -> "Dataset":
        return cls.from_snapshot(json.loads(Path(path).read_text()))


@dataclass(frozen=True)
class Point:
    start: datetime
    forecast: int
    publish: datetime
    actual: int | None

    @property
    def horizon_h(self) -> float:
        return (self.start - self.publish).total_seconds() / 3600

    @property
    def error(self) -> int | None:
        return None if self.actual is None else self.forecast - self.actual


# --------------------------------------------------------------------------- time helpers


def delivery_days(first: date = DELIVERY_FIRST, last: date = DELIVERY_LAST) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """UK-local calendar day as a UTC [start, end) interval (handles DST-length days)."""
    start = datetime.combine(day, time(0), tzinfo=UK_TZ).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=UK_TZ).astimezone(timezone.utc)
    return start, end


def decision_cutoff_utc(delivery_day: date, cutoff: time) -> datetime:
    """The moment the buyer commits: `cutoff` UK local time on the day before delivery."""
    return datetime.combine(delivery_day - timedelta(days=1), cutoff, tzinfo=UK_TZ).astimezone(timezone.utc)


# --------------------------------------------------------------------------- selection


def latest_forecast_before(runs: list[tuple[datetime, int]], cutoff: datetime) -> tuple[datetime, int] | None:
    """Most recent (publishTime, MW) with publishTime <= cutoff. `runs` sorted by publishTime."""
    idx = bisect.bisect_right(runs, (cutoff, math.inf)) - 1
    return runs[idx] if idx >= 0 else None


def decision_forecasts(ds: Dataset, delivery_day: date, cutoff: time) -> list[Point]:
    """For each hourly target in the delivery day, the latest forecast available at the cutoff."""
    cutoff_utc = decision_cutoff_utc(delivery_day, cutoff)
    start, end = day_bounds_utc(delivery_day)
    points = []
    for target in sorted(t for t in ds.forecasts if start <= t < end):
        chosen = latest_forecast_before(ds.forecasts[target], cutoff_utc)
        if chosen is not None:
            publish, mw = chosen
            points.append(Point(target, mw, publish, ds.actuals.get(target)))
    return points


def hours_in_day(day: date) -> int:
    start, end = day_bounds_utc(day)
    return int((end - start).total_seconds() // 3600)


def actuals_for_day(ds: Dataset, day: date) -> list[tuple[datetime, int]]:
    start, end = day_bounds_utc(day)
    return sorted((t, mw) for t, mw in ds.actuals.items() if start <= t < end)


# --------------------------------------------------------------------------- metrics


def quantile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated quantile (same as numpy's default) of pre-sorted values."""
    if not sorted_values:
        raise ValueError("quantile of empty sequence")
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def error_metrics(points: list[Point]) -> dict | None:
    """Summary accuracy metrics over points that have an actual. None if there are none."""
    paired = [p for p in points if p.actual is not None]
    if not paired:
        return None
    errors = sorted(p.error for p in paired)
    n = len(errors)
    mean_actual = sum(p.actual for p in paired) / n
    mae = sum(abs(e) for e in errors) / n
    p90 = quantile(errors, 0.9)
    return {
        "n": n,
        "mae": mae,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        # MAE relative to mean actual output; avoids MAPE blow-ups in low-wind hours.
        "nmae": mae / mean_actual if mean_actual else None,
        "meanActual": mean_actual,
        "p10": quantile(errors, 0.1),
        "p50": quantile(errors, 0.5),
        "p90": p90,
        # Plan for this much less wind than forecast to be covered in 90% of hours.
        "shortfallBuffer90": max(p90, 0.0),
        "maxOverForecast": errors[-1],
        "maxUnderForecast": errors[0],
    }


def histogram(values: list[float], bin_width: float) -> list[dict]:
    if not values:
        return []
    lo = math.floor(min(values) / bin_width) * bin_width
    hi = math.floor(max(values) / bin_width) * bin_width
    counts = {lo + i * bin_width: 0 for i in range(int(round((hi - lo) / bin_width)) + 1)}
    for v in values:
        counts[math.floor(v / bin_width) * bin_width] += 1
    return [{"from": k, "to": k + bin_width, "count": c} for k, c in sorted(counts.items())]


# --------------------------------------------------------------------------- views


def month_points(ds: Dataset, cutoff: time, days: list[date] | None = None) -> dict[date, list[Point]]:
    return {d: decision_forecasts(ds, d, cutoff) for d in (days or delivery_days())}


BIAS_WINDOW_DAYS = 14


def trailing_bias(by_day: dict[date, list[Point]], delivery_day: date, window: int = BIAS_WINDOW_DAYS) -> float:
    """Mean decision-time error over the `window` delivery days ending at D-2.

    Causal: at the D-1 cutoff, actuals for D-2 are complete but D-1 is not, so only
    delivery days <= D-2 are used. Returns 0 when there is no history yet.
    """
    first, last = delivery_day - timedelta(days=window + 1), delivery_day - timedelta(days=2)
    errors = [p.error for d, pts in by_day.items() if first <= d <= last for p in pts if p.error is not None]
    return sum(errors) / len(errors) if errors else 0.0


def bias_adjusted(points: list[Point], bias: float) -> list[Point]:
    return [Point(p.start, max(round(p.forecast - bias), 0), p.publish, p.actual) for p in points]


def accuracy_report(ds: Dataset, cutoff: time, hist_bin_mw: int = 500) -> dict:
    """Month-level accuracy of decision-time forecasts for a given cutoff."""
    by_day = month_points(ds, cutoff)
    all_points = [p for pts in by_day.values() for p in pts]
    adjusted_points = [p for d, pts in by_day.items() for p in bias_adjusted(pts, trailing_bias(by_day, d))]

    by_hour = []
    for hour in range(24):
        pts = [p for p in all_points if p.start.astimezone(UK_TZ).hour == hour]
        m = error_metrics(pts)
        by_hour.append({"hour": hour, "mae": m and m["mae"], "bias": m and m["bias"], "n": m["n"] if m else 0})

    daily = []
    for d, pts in by_day.items():
        m = error_metrics(pts)
        runs = sorted({p.publish for p in pts})
        daily.append({
            "deliveryDay": d.isoformat(),
            "mae": m and m["mae"],
            "bias": m and m["bias"],
            "nmae": m and m["nmae"],
            "forecastRuns": [fmt_ts(r) for r in runs],
        })

    errors = [p.error for p in all_points if p.error is not None]
    return {
        "cutoff": cutoff.strftime("%H:%M"),
        # Very early cutoffs can precede the run covering the last hours of D; those hours are unscored.
        "coverage": {"hours": len(all_points), "expected": sum(hours_in_day(d) for d in by_day)},
        "summary": error_metrics(all_points),
        "biasAdjustedSummary": error_metrics(adjusted_points),
        "biasWindowDays": BIAS_WINDOW_DAYS,
        "meanHorizonH": sum(p.horizon_h for p in all_points) / len(all_points) if all_points else None,
        "byHour": by_hour,
        "byDay": daily,
        "histogram": histogram(errors, hist_bin_mw),
        "series": [
            {
                "t": fmt_ts(p.start),
                "forecast": p.forecast,
                "actual": p.actual,
                "publishTime": fmt_ts(p.publish),
                "horizonH": p.horizon_h,
            }
            for p in all_points
        ],
    }


def horizon_curve(ds: Dataset, bucket_h: int = 6) -> list[dict]:
    """Accuracy of *every* forecast in the window, grouped by lead time. Cutoff-independent."""
    buckets: dict[int, list[Point]] = {}
    for target, runs in ds.forecasts.items():
        actual = ds.actuals.get(target)
        if actual is None:
            continue
        for publish, mw in runs:
            p = Point(target, mw, publish, actual)
            buckets.setdefault(int(p.horizon_h // bucket_h) * bucket_h, []).append(p)
    out = []
    for start_h in sorted(buckets):
        m = error_metrics(buckets[start_h])
        out.append({"fromH": start_h, "toH": start_h + bucket_h, "mae": m["mae"], "bias": m["bias"],
                    "rmse": m["rmse"], "n": m["n"]})
    return out


def cutoff_sensitivity(ds: Dataset, cutoffs: list[time] | None = None) -> list[dict]:
    """How month MAE changes if the decision were taken at a different time on D-1."""
    cutoffs = cutoffs or [time(h, 0) for h in range(24)]
    out = []
    for c in cutoffs:
        pts = [p for pts in month_points(ds, c).values() for p in pts]
        m = error_metrics(pts)
        out.append({"cutoff": c.strftime("%H:%M"), "mae": m and m["mae"], "rmse": m and m["rmse"], "n": m["n"] if m else 0,
                    "expected": sum(hours_in_day(d) for d in delivery_days())})
    return out


def day_view(ds: Dataset, day: date, cutoff: time, band_q: tuple[float, float] = (0.1, 0.9)) -> dict:
    """Everything the buyer sees for one delivery day.

    The uncertainty band is built from errors on *other* delivery days in the window
    (leave-one-day-out), so the day being viewed does not inform its own band.
    """
    by_day = month_points(ds, cutoff)
    points = by_day[day] if day in by_day else decision_forecasts(ds, day, cutoff)
    bias = trailing_bias(by_day, day)
    adjusted = {p.start: p.forecast for p in bias_adjusted(points, bias)}
    other_errors = sorted(p.error for d, pts in by_day.items() if d != day for p in pts if p.error is not None)
    lo_q, hi_q = (quantile(other_errors, q) for q in band_q) if other_errors else (0.0, 0.0)
    runs = sorted({p.publish for p in points})
    covered = {p.start for p in points}
    day_actuals = actuals_for_day(ds, day)
    return {
        "deliveryDay": day.isoformat(),
        "decisionDay": (day - timedelta(days=1)).isoformat(),
        "cutoff": cutoff.strftime("%H:%M"),
        "cutoffUtc": fmt_ts(decision_cutoff_utc(day, cutoff)),
        "forecastRuns": [fmt_ts(r) for r in runs],
        "band": {"lowerQuantile": band_q[0], "upperQuantile": band_q[1]},
        "forecast": [
            {
                "t": fmt_ts(p.start),
                "mw": p.forecast,
                "publishTime": fmt_ts(p.publish),
                "horizonH": p.horizon_h,
                # actual = forecast - error, so the likely-actual range flips the error quantiles.
                "low": p.forecast - hi_q,
                "high": p.forecast - lo_q,
                "adjusted": adjusted[p.start],
                "actual": p.actual,
            }
            for p in points
        ],
        "actuals": [{"t": fmt_ts(t), "mw": mw} for t, mw in day_actuals],
        "metrics": error_metrics(points),
        "trailingBias": bias,
        "biasAdjustedMetrics": error_metrics(bias_adjusted(points, bias)),
        "coverage": {"hours": len(points), "expected": hours_in_day(day)},
        "totals": {
            # Energy over the hours that have a forecast only, so the two totals are comparable.
            # Hourly forecast MW ~ MWh for that hour; each half-hourly actual contributes 0.5 h.
            "forecastMWh": sum(p.forecast for p in points),
            "actualMWh": sum(mw for t, mw in day_actuals if t.replace(minute=0) in covered) * 0.5,
        },
    }
