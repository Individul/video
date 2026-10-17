import asyncio

from app.sources import SOURCES
from app.sources.base import SearchHit


async def aggregate_search(query: str, page: int = 1) -> tuple[list[SearchHit], list[str]]:
    """Cautare paralela pe toate sursele; merge rezultate + colecteaza erorile."""
    tasks = [source.search(query, page) for source in SOURCES.values()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    merged: list[SearchHit] = []
    errors: list[str] = []
    for res in results:
        if isinstance(res, Exception):
            errors.append(str(res))
        else:
            merged.extend(res)

    # dedup pe (nume, an) daca acelasi titlu apare pe mai multe surse
    seen: set[tuple[str, int | None]] = set()
    deduped: list[SearchHit] = []
    for hit in merged:
        key = (hit.name.lower(), hit.year)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(hit)
    return deduped, errors
