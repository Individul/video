import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth_router, router
from app.config import Config
from app.db import init_db

_STATIC = Path(__file__).parent / "static"


def _warm_calendar() -> None:
    """Prima construire a calendarului durează ~15 s (un apel TMDB per film);
    o facem în fundal la pornire, ca pagina Calendar să se deschidă din cache."""
    from app.sources import calendar as cal

    try:
        cal.calendar(7, 60, [])
    except Exception:  # noqa: BLE001 — doar o optimizare
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if Config.TMDB_API_KEY:
        # fir daemon: nu ține procesul (sau testele) în viață la oprire
        threading.Thread(target=_warm_calendar, daemon=True).start()
    yield


app = FastAPI(title="Cinema — agregator filme/seriale cu traducere rusa", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(router)
app.mount("/static", StaticFiles(directory=_STATIC), name="static")


@app.get("/")
async def index():
    return FileResponse(_STATIC / "index.html")
