from app.sources.base import BaseSource, SourceError
from app.sources.tmdb import TmdbSource

SOURCES: dict[str, BaseSource] = {"tmdb": TmdbSource()}


def get_source(name: str) -> BaseSource:
    try:
        return SOURCES[name]
    except KeyError as e:
        raise SourceError(f"Sursa necunoscuta: {name}") from e
