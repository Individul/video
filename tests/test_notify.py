import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, HistoryItem, Notification, Title, TitleType, WatchlistItem
from app.services import notify


@pytest.fixture
async def maker(tmp_path, monkeypatch):
    monkeypatch.setattr(notify, "_STATE", tmp_path / "notify_state.json")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    mk = async_sessionmaker(engine, expire_on_commit=False)
    yield mk
    await engine.dispose()


def info(seasons, last, nxt=None):
    return {"seasons": seasons, "last": last, "next": nxt, "status": "Returning Series"}


def test_covers_episode_ranges():
    assert notify.covers("Жуки / S5E1-4 of 10 (Максим Пешков) [2026, WEBRip 1080p]", 5, 3)
    assert not notify.covers("Жуки / S5E1-4 of 10 [2026]", 5, 6)
    assert notify.covers("Жуки.S05E03.2026.WEB-DL.1080p", 5, 3)
    assert not notify.covers("Жуки.S05E02.2026.WEB-DL.1080p", 5, 3)
    assert notify.covers("Жуки (5 сезон) [01-03 из 10] (2026) WEBRip", 5, 2)  # format rutor
    assert not notify.covers("Жуки (5 сезон) [01-03 из 10] (2026) WEBRip", 5, 4)
    assert notify.covers("Жуки 5 сезон (2026) WEB-DL", 5, 7)  # sezon întreg
    assert not notify.covers("Жуки / S4E1-17 of 17", 5, 1)  # alt sezon


def test_diff_new_season_and_episodes():
    old = info({"4": [16, "2024-12-16"]}, [4, 16, "2025-01-10"])
    new = info({"4": [16, "2024-12-16"], "5": [10, "2026-11-20"]}, [4, 16, "2025-01-10"])
    ev, eps = notify.diff(old, new, "2026-10-21")
    assert ev == [{"kind": "season", "season": 5, "text": "Sezonul 5 a fost anunțat — începe pe 20 noiembrie 2026"}]
    assert eps == []
    later = info({"4": [16, "x"], "5": [10, "2026-11-20"]}, [5, 2, "2026-11-21"])
    ev, eps = notify.diff(new, later, "2026-11-22")
    assert ev == [] and eps == [[5, 1], [5, 2]]
    assert notify.diff(None, later, "2026-11-22") == ([], [])  # prima vedere: fără anunțuri


async def test_check_announces_only_when_on_trackers(maker, monkeypatch):
    async with maker() as db:
        t = Title(source="tmdb", source_url="https://www.themoviedb.org/tv/93014", name="Жуки", title_type=TitleType.SERIES)
        film = Title(source="tmdb", source_url="https://www.themoviedb.org/movie/1", name="Film", title_type=TitleType.MOVIE)
        db.add_all([t, film])
        await db.flush()
        db.add_all([WatchlistItem(title_id=t.id), WatchlistItem(title_id=film.id)])
        await db.commit()

    state = {"info": info({"4": [16, "2024-12-16"]}, [4, 16, "2025-01-10"])}
    monkeypatch.setattr(notify, "tv_info", lambda tid: state["info"])
    on_trackers = set()

    async def fake_available(title, s, e):
        return (s, e) in on_trackers

    monkeypatch.setattr(notify, "available", fake_available)

    async with maker() as db:
        assert [x.name for x in await notify.followed(db)] == ["Жуки"]  # filmul nu
        assert await notify.check(db) == 0  # prima trecere doar memorează

    state["info"] = info({"4": [16, "2024-12-16"], "5": [10, "2026-11-20"]}, [5, 2, "2026-11-21"])
    async with maker() as db:
        assert await notify.check(db) == 1  # doar „sezonul 5 anunțat”: episoadele nu-s încă pe trackere
    on_trackers |= {(5, 1), (5, 2)}
    async with maker() as db:
        assert await notify.check(db) == 1
        assert await notify.check(db) == 0  # nu se repetă
        rows = (await db.scalars(select(Notification).order_by(Notification.id))).all()
    assert [r.text for r in rows] == ["Sezonul 5 a fost anunțat — începe pe 20 noiembrie 2026",
                                      "Episoadele 1–2 din sezonul 5 e disponibil"]


async def test_history_series_are_followed(maker):
    async with maker() as db:
        t = Title(source="tmdb", source_url="https://www.themoviedb.org/tv/2316", name="Офис")
        db.add(t)
        await db.flush()
        db.add(HistoryItem(title_id=t.id, season=1, episode=1, position_seconds=10))
        await db.commit()
        assert [x.name for x in await notify.followed(db)] == ["Офис"]
