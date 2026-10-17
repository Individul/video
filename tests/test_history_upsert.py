from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, HistoryItem, Title
from app.services.catalog import upsert_search_hit
from app.sources.base import SearchHit

import pytest


@pytest.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


def _save_data(title_id, season, episode, position, duration=1800):
    return {
        "title_id": title_id,
        "season": season,
        "episode": episode,
        "position_seconds": position,
        "duration_seconds": duration,
    }


async def test_history_upsert_one_row_per_episode(session_factory):
    from app.api import routes

    async with session_factory() as s:
        t = await upsert_search_hit(s, SearchHit(source="tmdb", name="A", source_url="https://x/a"))

    # simulăm handlerul: de trei ori pentru același episod
    async with session_factory() as s:
        for pos in (10, 42, 99):
            body = routes.HistoryBody(**_save_data(t.id, None, None, pos))
            q = select(HistoryItem).where(HistoryItem.title_id == body.title_id)
            q = q.where(HistoryItem.season.is_(None) if body.season is None else HistoryItem.season == body.season)
            q = q.where(HistoryItem.episode.is_(None) if body.episode is None else HistoryItem.episode == body.episode)
            item = (await s.scalars(q)).first()
            if item is not None:
                item.position_seconds = body.position_seconds
                item.duration_seconds = body.duration_seconds
            else:
                s.add(HistoryItem(**_save_data(t.id, body.season, body.episode, body.position_seconds)))
        await s.commit()

        rows = (await s.scalars(select(HistoryItem))).all()
        assert len(rows) == 1
        assert rows[0].position_seconds == 99


async def test_history_upsert_episodes_separate(session_factory):
    async with session_factory() as s:
        t = await upsert_search_hit(s, SearchHit(source="tmdb", name="S", source_url="https://x/s"))
        # episoade diferite → rânduri diferite
        s.add(HistoryItem(title_id=t.id, season=1, episode=1, position_seconds=100, duration_seconds=1800))
        s.add(HistoryItem(title_id=t.id, season=1, episode=2, position_seconds=200, duration_seconds=1800))
        await s.commit()
        rows = (await s.scalars(select(HistoryItem))).all()
        assert len(rows) == 2


async def test_history_constraint_refuza_duplicate(session_factory):
    from sqlalchemy.exc import IntegrityError

    async with session_factory() as s:
        t = await upsert_search_hit(s, SearchHit(source="tmdb", name="S", source_url="https://x/s"))
        s.add(HistoryItem(title_id=t.id, season=1, episode=1, position_seconds=100, duration_seconds=1800))
        await s.commit()
        s.add(HistoryItem(title_id=t.id, season=1, episode=1, position_seconds=150, duration_seconds=1800))
        with pytest.raises(IntegrityError):
            await s.commit()
