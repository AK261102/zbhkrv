"""Download the January 2026 pilot data from Elexon and write backend/data/snapshot.json.

Usage (from backend/):  python -m scripts.fetch_snapshot

The app reads only the snapshot at runtime, so it is fast, reproducible, and does not
depend on Elexon availability. Re-run this script to refresh the data.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from app import config, elexon


def _uk_midnight_utc(d) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=config.UK_TZ).astimezone(timezone.utc)


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def main() -> None:
    # Any forecast that could be "latest at the cutoff" for a January decision: published from
    # the day before the first decision day up to the end of the last decision day.
    publish_from = _uk_midnight_utc(config.DECISION_FIRST - timedelta(days=1))
    publish_to = _uk_midnight_utc(config.DECISION_LAST + timedelta(days=1))
    target_from = _uk_midnight_utc(config.DELIVERY_FIRST)
    target_to = _uk_midnight_utc(config.DELIVERY_LAST + timedelta(days=1))

    raw_fc = elexon.fetch_wind_forecasts(publish_from, publish_to)
    forecasts = sorted(
        {
            (r["publishTime"], r["startTime"], r["generation"])
            for r in raw_fc
            if publish_from <= _parse(r["publishTime"]) < publish_to
            and target_from <= _parse(r["startTime"]) < target_to
            # A forecast for a time before it was published is not a forecast.
            and _parse(r["startTime"]) >= _parse(r["publishTime"])
        }
    )

    raw_act = elexon.fetch_wind_actuals(config.DELIVERY_FIRST, config.DELIVERY_LAST)
    # Keep the most recently published value per half-hour in case of revisions.
    latest: dict[str, tuple[str, int]] = {}
    for r in raw_act:
        if r.get("fuelType") != "WIND" or not (target_from <= _parse(r["startTime"]) < target_to):
            continue
        prev = latest.get(r["startTime"])
        if prev is None or r["publishTime"] > prev[0]:
            latest[r["startTime"]] = (r["publishTime"], r["generation"])
    actuals = sorted((start, gen) for start, (_, gen) in latest.items())

    snapshot = {
        "source": "Elexon BMRS (WINDFOR, FUELHH fuelType=WIND)",
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecastColumns": ["publishTime", "startTime", "generation"],
        "forecasts": [list(f) for f in forecasts],
        "actualColumns": ["startTime", "generation"],
        "actuals": [list(a) for a in actuals],
    }
    config.DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.DATA_PATH.write_text(json.dumps(snapshot, separators=(",", ":")))
    print(f"Wrote {len(forecasts)} forecast rows and {len(actuals)} actual rows to {config.DATA_PATH}")


if __name__ == "__main__":
    main()
