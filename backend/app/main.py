"""FastAPI app: JSON API under /api, plus the built React app when STATIC_DIR is set."""

from __future__ import annotations

import os
from datetime import date, time
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, config

app = FastAPI(title="Wind Forecast Decision Support API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def dataset() -> analysis.Dataset:
    return analysis.Dataset.load(config.DATA_PATH)


def parse_cutoff(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"cutoff must be HH:MM, got {value!r}") from None


def parse_delivery_day(value: str) -> date:
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"date must be YYYY-MM-DD, got {value!r}") from None
    if not config.DELIVERY_FIRST <= day <= config.DELIVERY_LAST:
        raise HTTPException(404, f"{day} is outside the delivery window "
                                 f"{config.DELIVERY_FIRST}..{config.DELIVERY_LAST}")
    return day


# Results depend only on (cutoff[, day]) over an immutable snapshot, so cache them.
@lru_cache(maxsize=64)
def _accuracy(cutoff: time) -> dict:
    return analysis.accuracy_report(dataset(), cutoff)


@lru_cache(maxsize=512)
def _day(day: date, cutoff: time) -> dict:
    return analysis.day_view(dataset(), day, cutoff)


@lru_cache(maxsize=1)
def _insights() -> dict:
    ds = dataset()
    return {"horizonCurve": analysis.horizon_curve(ds), "cutoffSensitivity": analysis.cutoff_sensitivity(ds)}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    ds = dataset()
    return {
        "source": ds.source,
        "fetchedAt": ds.fetched_at,
        "defaultCutoff": config.DEFAULT_CUTOFF.strftime("%H:%M"),
        "decisionWindow": [config.DECISION_FIRST.isoformat(), config.DECISION_LAST.isoformat()],
        "deliveryDays": [d.isoformat() for d in analysis.delivery_days()],
        "timezone": "Europe/London",
    }


@app.get("/api/day")
def day(date_: str = Query(..., alias="date"), cutoff: str = config.DEFAULT_CUTOFF.strftime("%H:%M")) -> dict:
    return _day(parse_delivery_day(date_), parse_cutoff(cutoff))


@app.get("/api/accuracy")
def accuracy(cutoff: str = config.DEFAULT_CUTOFF.strftime("%H:%M")) -> dict:
    return _accuracy(parse_cutoff(cutoff))


@app.get("/api/insights")
def insights() -> dict:
    return _insights()


# ----------------------------------------------------------------------------- static SPA
STATIC_DIR = os.environ.get("STATIC_DIR")
if STATIC_DIR and Path(STATIC_DIR).is_dir():
    static_root = Path(STATIC_DIR).resolve()
    app.mount("/assets", StaticFiles(directory=static_root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        candidate = (static_root / path).resolve()
        if path and candidate.is_file() and static_root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(static_root / "index.html")
