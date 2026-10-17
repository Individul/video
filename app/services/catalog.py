import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Episode, Title, TitleType, utcnow
from app.sources.base import SearchHit, TitleDetail

# crește când detaliile salvate primesc câmpuri noi: titlurile vechi se reîmprospătează o dată
EXTRA_VERSION = 2


async def _get_or_create_title(session: AsyncSession, source: str, source_url: str, name: str) -> Title:
    """Titlul existent sau unul nou, sigur la cereri simultane: pagina principală încarcă
    mai multe liste în paralel, iar același film apare în mai multe (trend + populare).
    INSERT ... ON CONFLICT DO NOTHING evită eroarea de unicitate a celei de-a doua cereri."""
    q = select(Title).where(Title.source == source, Title.source_url == source_url)
    title = (await session.scalars(q)).first()
    if title is not None:
        return title
    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect in ("sqlite", "postgresql"):
        if dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        else:
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        await session.execute(
            dialect_insert(Title)
            .values(source=source, source_url=source_url, name=name)
            .on_conflict_do_nothing(index_elements=["source", "source_url"])
        )
        title = (await session.scalars(q)).first()
        if title is not None:
            return title
    title = Title(source=source, source_url=source_url, name=name)
    session.add(title)
    return title


async def upsert_search_hit(session: AsyncSession, hit: SearchHit) -> Title:
    """Creeaza/actualizeaza un titlu minimal dintr-un rezultat de cautare/browsare."""
    title = await _get_or_create_title(session, hit.source, hit.source_url, hit.name)

    title.name = hit.name
    title.year = hit.year or title.year
    title.poster = hit.poster or title.poster
    title.category = hit.category or title.category
    if hit.rating:
        title.rating = hit.rating  # nota TMDB vine proaspătă la fiecare căutare/browsare
    if hit.title_type:
        title.title_type = TitleType(hit.title_type)
    await session.flush()
    return title


async def upsert_episodes(session: AsyncSession, title_id: int, eps: list) -> None:
    """Adaugă episoadele noi și completează nume/imagine pentru cele existente."""
    existing: dict[tuple[int, int], Episode] = {
        (e.season, e.episode): e
        for e in (await session.scalars(
            select(Episode).where(Episode.title_id == title_id)
        )).all()
    }
    for ep in eps:
        row = existing.get((ep.season, ep.episode))
        if row is None:
            session.add(
                Episode(title_id=title_id, season=ep.season, episode=ep.episode,
                        name=ep.name, still=ep.still)
            )
        else:
            if ep.name and not row.name:
                row.name = ep.name
            if ep.still and not row.still:
                row.still = ep.still


async def upsert_title_detail(session: AsyncSession, detail: TitleDetail) -> Title:
    """Upsert complet: campuri + sezoane (+ episoade, dacă vin în detaliu)."""
    title = await _get_or_create_title(session, detail.source, detail.source_url, detail.name)

    title.name = detail.name
    title.name_original = detail.name_original
    title.year = detail.year
    title.poster = detail.poster
    title.description = detail.description
    title.rating = detail.rating
    title.category = detail.category
    if detail.title_type:
        title.title_type = TitleType(detail.title_type)
    title.detail_loaded_at = utcnow()
    title.extra = json.dumps(
        {
            "trailer": detail.trailer,
            "cast": detail.cast,
            "similar": detail.similar,
            "seasons": detail.seasons,
            "backdrop": detail.backdrop,
            "tagline": detail.tagline,
            "runtime": detail.runtime,
            "genres": detail.genres,
            "countries": detail.countries,
            "status": detail.status,
            "certification": detail.certification,
            "recommendations": detail.recommendations,
            "v": EXTRA_VERSION,
        },
        ensure_ascii=False,
    )

    if detail.episodes:
        await session.flush()  # aloca id-ul titlului nou înainte de episoade
        await upsert_episodes(session, title.id, detail.episodes)

    await session.flush()
    return title


async def get_title(session: AsyncSession, title_id: int) -> Title | None:
    return (await session.scalars(select(Title).where(Title.id == title_id))).first()
