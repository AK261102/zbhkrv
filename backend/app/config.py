"""Domain configuration for the January 2026 pilot."""

from __future__ import annotations

import os
from datetime import date, time
from pathlib import Path
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")

# Purchase decisions are made on D-1 for delivery day D.
# Decisions made in January 2026 => delivery days 2 Jan .. 1 Feb 2026.
DECISION_FIRST = date(2026, 1, 1)
DECISION_LAST = date(2026, 1, 31)
DELIVERY_FIRST = date(2026, 1, 2)
DELIVERY_LAST = date(2026, 2, 1)

# Default decision cutoff (UK local time on D-1). Adjustable per request.
DEFAULT_CUTOFF = time(10, 0)

DATA_PATH = Path(os.environ.get("DATA_PATH", Path(__file__).resolve().parent.parent / "data" / "snapshot.json"))
