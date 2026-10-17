import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Title
from app.services.catalog import upsert_search_hit
from app.sources.base import SearchHit


async def test_upsert_simultan_acelasi_titlu(tmp_path):
    # pagina principală încarcă liste în paralel; același film apare în mai multe
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 't.db'}", connect_args={"timeout": 15})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    hit = SearchHit(source="tmdb", name="Film", source_url="https://www.themoviedb.org/movie/1", category="film")

    async def one(i):
        async with maker() as s:
            t = await upsert_search_hit(s, hit)
            await asyncio.sleep(0.01 * (i % 3))  # tranzacții suprapuse
            await s.commit()
            return t.id

    ids = await asyncio.gather(*(one(i) for i in range(6)))
    assert len(set(ids)) == 1  # toate cererile au primit același titlu, fără eroare
    async with maker() as s:
        assert await s.scalar(select(func.count()).select_from(Title)) == 1
    await engine.dispose()
