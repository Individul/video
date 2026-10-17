from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.models import Base, Title, TitleType
from app.services.catalog import upsert_search_hit, upsert_title_detail
from app.services.search import aggregate_search
from app.sources.base import EpisodeInfo, SearchHit

import pytest


@pytest.fixture
async def session_factory(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    # izoleaza testele de sursele reale
    class FakeSource:
        name = "fake"

        async def search(self, q, page=1):
            return [
                SearchHit(source="fake", name=f"Film {q}", source_url=f"https://src/fake/{q}.html", year=2020),
            ]

    import app.services.search as search_mod

    monkeypatch.setattr(search_mod, "SOURCES", {"fake": FakeSource()})
    yield maker
    await engine.dispose()


async def test_upsert_search_hit_creates_and_updates(session_factory):
    async with session_factory() as s:
        hit = SearchHit(source="tmdb", name="Test", source_url="https://x/test.html", year=2000)
        t1 = await upsert_search_hit(s, hit)
        t2 = await upsert_search_hit(s, SearchHit(source="tmdb", name="Test", source_url="https://x/test.html", poster="p.png"))
        assert t1.id == t2.id
        assert t2.poster == "p.png"


async def test_upsert_detail_fills_everything(session_factory):
    async with session_factory() as s:
        from app.sources.base import TitleDetail

        detail = TitleDetail(
            source="tmdb",
            source_url="https://x/serial.html",
            name="Serial",
            name_original="The Serial",
            year=2021,
            title_type=TitleType.SERIES.value,
            category="series",
            poster="p.jpg",
            description="Desc",
            rating=7.8,
            episodes=[EpisodeInfo(1, 1), EpisodeInfo(1, 2), EpisodeInfo(2, 1)],
        )
        t = await upsert_title_detail(s, detail)
        t = (await s.scalars(
            select(Title)
            .options(selectinload(Title.episodes))
            .where(Title.id == t.id)
        )).first()
        assert t.title_type is TitleType.SERIES
        assert len(t.episodes) == 3

        # idempotent — verific pe titlul recitit cu relatiile actualizate
        t2 = await upsert_title_detail(s, detail)
        t2 = (await s.scalars(
            select(Title)
            .options(selectinload(Title.episodes))
            .where(Title.id == t2.id)
        )).first()
        assert t2.id == t.id
        assert len(t2.episodes) == 3


async def test_aggregate_search_merges(session_factory):
    hits, errors = await aggregate_search("test")
    assert not errors
    assert len(hits) == 1
    assert hits[0].source == "fake"


async def test_watchlist_flow(session_factory):
    from sqlalchemy import select

    from app.models import WatchlistItem, WatchlistStatus

    async with session_factory() as s:
        title = await upsert_search_hit(
            s, SearchHit(source="tmdb", name="A", source_url="https://x/a.html")
        )
        s.add(WatchlistItem(title_id=title.id, status=WatchlistStatus.TO_WATCH))
        await s.flush()
        item = (await s.scalars(select(WatchlistItem))).first()
        assert item.status is WatchlistStatus.TO_WATCH
        item.status = WatchlistStatus.WATCHED
        await s.flush()
        item2 = (await s.scalars(select(WatchlistItem))).first()
        assert item2.status is WatchlistStatus.WATCHED
