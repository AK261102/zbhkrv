"""API tests against the committed January 2026 snapshot."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta_lists_31_delivery_days():
    body = client.get("/api/meta").json()
    assert body["defaultCutoff"] == "10:00"
    assert body["deliveryDays"][0] == "2026-01-02"
    assert body["deliveryDays"][-1] == "2026-02-01"
    assert len(body["deliveryDays"]) == 31


def test_day_view_uses_only_forecasts_published_before_cutoff():
    body = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "10:00"}).json()
    assert body["decisionDay"] == "2026-01-14"
    assert len(body["forecast"]) == 24
    assert len(body["actuals"]) == 48
    assert all(f["publishTime"] <= body["cutoffUtc"] for f in body["forecast"])
    assert all(f["low"] <= f["high"] for f in body["forecast"])
    assert body["metrics"]["n"] == 24


def test_later_cutoff_can_only_use_same_or_newer_runs():
    early = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "06:00"}).json()
    late = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "23:00"}).json()
    assert max(early["forecastRuns"]) <= max(late["forecastRuns"])


def test_early_cutoff_reports_partial_coverage_and_comparable_totals():
    # Runs published before ~02:30 on D-1 stop at 21:00 on D, so 22:00 and 23:00 are uncovered.
    body = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "01:00"}).json()
    assert body["coverage"] == {"hours": len(body["forecast"]), "expected": 24}
    assert body["coverage"]["hours"] < 24
    covered = {f["t"][:13] for f in body["forecast"]}
    expected_actual = sum(a["mw"] for a in body["actuals"] if a["t"][:13] in covered) * 0.5
    assert body["totals"]["actualMWh"] == expected_actual

    full = client.get("/api/day", params={"date": "2026-01-15", "cutoff": "10:00"}).json()
    assert full["coverage"] == {"hours": 24, "expected": 24}


def test_day_validation():
    assert client.get("/api/day", params={"date": "2025-12-01"}).status_code == 404
    assert client.get("/api/day", params={"date": "15/01/2026"}).status_code == 422
    assert client.get("/api/day", params={"date": "2026-01-15", "cutoff": "25:00"}).status_code == 422


def test_accuracy_report_shape():
    body = client.get("/api/accuracy", params={"cutoff": "10:00"}).json()
    assert body["summary"]["n"] == 31 * 24
    assert len(body["byHour"]) == 24
    assert len(body["byDay"]) == 31
    assert len(body["series"]) == 31 * 24
    assert sum(b["count"] for b in body["histogram"]) == body["summary"]["n"]


def test_insights():
    body = client.get("/api/insights").json()
    assert body["horizonCurve"][0]["fromH"] == 0
    assert len(body["cutoffSensitivity"]) == 24
