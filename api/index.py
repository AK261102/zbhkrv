"""Vercel serverless entry point: exposes the FastAPI app from backend/app.

Vercel routes /api/* here (see vercel.json); the React build is served as static files.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
