from datetime import date, datetime, time, timezone

import pytest

from app import analysis as A


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def make_ds(forecasts, actuals) -> A.Dataset:
    return A.Dataset.from_snapshot({
        "forecasts": [[A.fmt_ts(p), A.fmt_ts(s), g] for p, s, g in forecasts],
        "actuals": [[A.fmt_ts(s), g] for s, g in actuals],
    })


# ------------------------------------------------------------------ cutoff & selection


def test_decision_cutoff_is_previous_day_uk_time():
    # January: UK local == UTC
    assert A.decision_cutoff_utc(date(2026, 1, 15), time(10, 0)) == utc(2026, 1, 14, 10, 0)
    # Summer (BST): 10:00 local == 09:00 UTC
    assert A.decision_cutoff_utc(date(2026, 7, 15), time(10, 0)) == utc(2026, 7, 14, 9, 0)


def test_day_bounds_handle_dst_change():
    start, end = A.day_bounds_utc(date(2026, 3, 29))  # clocks go forward: 23h day
    assert (end - start).total_seconds() == 23 * 3600


def test_selects_latest_forecast_published_at_or_before_cutoff():
    target = utc(2026, 1, 15, 12)
    ds = make_ds(
        forecasts=[
            (utc(2026, 1, 14, 4, 30), target, 100),
            (utc(2026, 1, 14, 9, 30), target, 200),   # latest before 10:00 -> chosen
            (utc(2026, 1, 14, 10, 0), target, 250),   # exactly at cutoff -> also allowed
            (utc(2026, 1, 14, 11, 30), target, 300),  # after cutoff -> excluded
        ],
        actuals=[(target, 180)],
    )
    [p] = A.decision_forecasts(ds, date(2026, 1, 15), time(10, 0))
    assert (p.forecast, p.publish) == (250, utc(2026, 1, 14, 10, 0))

    [p] = A.decision_forecasts(ds, date(2026, 1, 15), time(9, 59))
    assert (p.forecast, p.publish, p.actual, p.error) == (200, utc(2026, 1, 14, 9, 30), 180, 20)
    assert p.horizon_h == pytest.approx(26.5)


def test_targets_without_any_forecast_before_cutoff_are_skipped():
    ds = make_ds(forecasts=[(utc(2026, 1, 14, 11, 30), utc(2026, 1, 15, 0), 300)], actuals=[])
    assert A.decision_forecasts(ds, date(2026, 1, 15), time(10, 0)) == []


def test_only_targets_inside_delivery_day_are_selected():
    pub = utc(2026, 1, 14, 9, 30)
    ds = make_ds(
        forecasts=[(pub, utc(2026, 1, 14, 23), 1), (pub, utc(2026, 1, 15, 0), 2),
                   (pub, utc(2026, 1, 15, 23), 3), (pub, utc(2026, 1, 16, 0), 4)],
        actuals=[],
    )
    assert [p.forecast for p in A.decision_forecasts(ds, date(2026, 1, 15), time(10, 0))] == [2, 3]


# ------------------------------------------------------------------ metrics


def test_quantile_matches_linear_interpolation():
    vals = [1.0, 2.0, 3.0, 4.0]
    assert A.quantile(vals, 0.0) == 1.0
    assert A.quantile(vals, 0.5) == 2.5
    assert A.quantile(vals, 0.9) == pytest.approx(3.7)
    with pytest.raises(ValueError):
        A.quantile([], 0.5)


def test_error_metrics():
    t = utc(2026, 1, 15)
    pts = [A.Point(t, f, t, a) for f, a in [(110, 100), (90, 100), (130, 100), (100, None)]]
    m = A.error_metrics(pts)
    assert m["n"] == 3
    assert m["mae"] == pytest.approx(50 / 3)
    assert m["bias"] == pytest.approx(10)
    assert m["rmse"] == pytest.approx((1100 / 3) ** 0.5)
    assert m["nmae"] == pytest.approx(50 / 3 / 100)
    assert (m["maxOverForecast"], m["maxUnderForecast"]) == (30, -10)
    assert A.error_metrics([A.Point(t, 1, t, None)]) is None


def test_shortfall_buffer_never_negative():
    t = utc(2026, 1, 15)
    m = A.error_metrics([A.Point(t, 50, t, 100), A.Point(t, 60, t, 100)])  # always under-forecast
    assert m["shortfallBuffer90"] == 0.0


def test_histogram_bins_cover_all_values():
    h = A.histogram([-600, -1, 0, 499, 500, 1200], 500)
    assert [b["from"] for b in h] == [-1000, -500, 0, 500, 1000]
    assert sum(b["count"] for b in h) == 6


def test_trailing_bias_is_causal():
    t = utc(2026, 1, 1)
    by_day = {
        date(2026, 1, 10): [A.Point(t, 110, t, 100)],  # D-3: error +10
        date(2026, 1, 11): [A.Point(t, 130, t, 100)],  # D-2: error +30
        date(2026, 1, 12): [A.Point(t, 999, t, 100)],  # D-1: not yet known at cutoff
        date(2026, 1, 13): [A.Point(t, 999, t, 100)],  # D itself
    }
    assert A.trailing_bias(by_day, date(2026, 1, 13)) == pytest.approx(20)
    assert A.trailing_bias(by_day, date(2026, 1, 13), window=1) == pytest.approx(30)
    assert A.trailing_bias(by_day, date(2026, 1, 10)) == 0.0
