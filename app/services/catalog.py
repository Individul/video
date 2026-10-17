import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Episode, Title, TitleType, utcnow
from app.sources.base import SearchHit, TitleDetail


async def upsert_search_hit(session: AsyncSession, hit: SearchHit) -> Title:
    """Creeaza/actualizeaza un titlu minimal dintr-un rezultat de cautare/browsare."""
    q = select(Title).where(Title.source == hit.source, Title.source_url == hit.source_url)
    title = (await session.scalars(q)).first()
    if title is None:
        title = Title(source=hit.source, source_url=hit.source_url, name=hit.name)
        session.add(title)

    title.name = hit.name
    title.year = hit.year or title.year
    title.poster = hit.poster or title.poster
    title.category = hit.category or title.category
    if hit.title_type:
        title.title_type = TitleType(hit.title_type)
    await session.flush()
    return title


async def upsert_title_detail(session: AsyncSession, detail: TitleDetail) -> Title:
    """Upsert complet: campuri + episoade."""
    q = select(Title).where(Title.source == detail.source, Title.source_url == detail.source_url)
    title = (await session.scalars(q)).first()
    if title is None:
        title = Title(source=detail.source, source_url=detail.source_url, name=detail.name)
        session.add(title)

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
        {"trailer": detail.trailer, "cast": detail.cast, "similar": detail.similar},
        ensure_ascii=False,
    )

    # episoade (adaugă cele noi, completează nume/imagine pentru cele vechi)
    existing_eps: dict[tuple[int, int], Episode] = {
        (e.season, e.episode): e
        for e in (await session.scalars(
            select(Episode).where(Episode.title_id == title.id)
        )).all()
    }
    for ep in detail.episodes:
        row = existing_eps.get((ep.season, ep.episode))
        if row is None:
            session.add(
                Episode(title_id=title.id, season=ep.season, episode=ep.episode,
                        name=ep.name, still=ep.still)
            )
        else:
            if ep.name and not row.name:
                row.name = ep.name
            if ep.still and not row.still:
                row.still = ep.still

    await session.flush()
    return title


async def get_title(session: AsyncSession, title_id: int) -> Title | None:
    return (await session.scalars(select(Title).where(Title.id == title_id))).first()
