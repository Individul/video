import sqlite3
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import ROOT, Config
from app.models import Base

engine = create_async_engine(Config.DB_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _columns(conn, table: str) -> set[str]:
    rows = await conn.execute(text(f"PRAGMA table_info({table})"))
    return {r[1] for r in rows}


async def _migrate(conn) -> None:
    """Migrari idempotente: create_all nu adauga coloane pe tabele existente."""
    title_cols = await _columns(conn, "titles")
    if "extra" not in title_cols:
        await conn.execute(text("ALTER TABLE titles ADD COLUMN extra TEXT"))

    ep_cols = await _columns(conn, "episodes")
    if "name" not in ep_cols:
        await conn.execute(text("ALTER TABLE episodes ADD COLUMN name VARCHAR(256)"))
    if "still" not in ep_cols:
        await conn.execute(text("ALTER TABLE episodes ADD COLUMN still VARCHAR(512)"))

    # istoric vechi: un rând la fiecare 10s -> păstrăm doar ultimul per titlu+sezon+episod
    await conn.execute(
        text(
            "DELETE FROM history WHERE id NOT IN "
            "(SELECT MAX(id) FROM history GROUP BY title_id, season, episode)"
        )
    )


def _backup_sqlite() -> None:
    """Copie de siguranță a bazei la fiecare pornire (păstrăm ultimele 7)."""
    url = Config.DB_URL
    if "///" not in url or not url.startswith("sqlite"):
        return
    path = url.split("///", 1)[1]
    if not path or not Path(path).is_file():
        return  # prima pornire — nu există încă bază
    backups = ROOT / "backups"
    backups.mkdir(exist_ok=True)
    dest = backups / f"vid-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    try:
        src = sqlite3.connect(path)
        dst = sqlite3.connect(dest)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        olds = sorted(backups.glob("vid-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in olds[7:]:
            old.unlink()
    except Exception:  # noqa: BLE001 — backup-ul nu trebuie să blocheze pornirea
        pass


async def init_db() -> None:
    _backup_sqlite()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
