"""Thin client for the two Elexon BMRS stream endpoints we use.

Both endpoints are public (no API key) and return a JSON array of records.
"""

from __future__ import annotations

from datetime import date, datetime

import httpx

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
TIMEOUT = httpx.Timeout(60.0)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime) -> list[dict]:
    """WINDFOR: national wind generation forecasts, filtered by publish time (UTC)."""
    params = {"publishDateTimeFrom": _iso(publish_from), "publishDateTimeTo": _iso(publish_to)}
    resp = httpx.get(f"{BASE_URL}/WINDFOR/stream", params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_wind_actuals(settlement_from: date, settlement_to: date) -> list[dict]:
    """FUELHH: half-hourly outturn by fuel type, restricted to WIND."""
    params = {
        "settlementDateFrom": settlement_from.isoformat(),
        "settlementDateTo": settlement_to.isoformat(),
        "fuelType": "WIND",
    }
    resp = httpx.get(f"{BASE_URL}/FUELHH/stream", params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()
