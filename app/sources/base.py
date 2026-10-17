from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class SourceError(Exception):
    """Eroare de parsare / sursa indisponibila."""


@dataclass
class SearchHit:
    source: str
    name: str
    source_url: str
    poster: str | None = None
    year: int | None = None
    category: str | None = None  # film / series / cartoon / anime
    rating: float | None = None

    @property
    def title_type(self) -> str | None:
        return "series" if self.category in ("series", "cartoon-series", "anime") else (
            "movie" if self.category else None
        )


@dataclass
class EpisodeInfo:
    season: int
    episode: int
    name: str | None = None
    still: str | None = None  # URL imagine episod


@dataclass
class TitleDetail:
    source: str
    source_url: str
    name: str
    name_original: str | None = None
    year: int | None = None
    title_type: str | None = None  # movie | series
    category: str | None = None
    poster: str | None = None
    description: str | None = None
    rating: float | None = None
    episodes: list[EpisodeInfo] = field(default_factory=list)
    trailer: str | None = None  # URL YouTube
    cast: list[dict] = field(default_factory=list)  # {name, character, profile}
    similar: list[dict] = field(default_factory=list)  # hit-uri {source, name, source_url, ...}
    seasons: list[dict] = field(default_factory=list)  # [{season, episodes}] — încărcare leneșă
    backdrop: str | None = None  # imagine lată (cadru din film) pentru hero/fereastra de detalii


class BaseSource(ABC):
    """Interfata comuna pentru toate sursele."""

    name: str = "abstract"

    @abstractmethod
    async def search(self, query: str, page: int = 1) -> list[SearchHit]:
        """Cautare dupa text liber."""

    @abstractmethod
    async def details(self, source_url: str) -> TitleDetail:
        """Detalii complete pentru un URL sursa."""

    async def browse(self, category: str, page: int = 1) -> list[SearchHit]:
        """Catalog paginat (films/series). Sursa poate sa nu suporte."""
        raise SourceError(f"Sursa '{self.name}' nu suporta browsarea")

    def supports_browse(self, category: str) -> bool:
        return False
