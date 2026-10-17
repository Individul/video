"""Intrarea pentru Vercel (serverless): FastAPI -> Mangum (ASGI pe Lambda-style)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mangum import Mangum  # noqa: E402

from app.main import app  # noqa: E402

handler = Mangum(app)
