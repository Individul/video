from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Config
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


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
