import enum
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class TitleType(str, enum.Enum):
    MOVIE = "movie"
    SERIES = "series"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Title(Base):
    __tablename__ = "titles"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    source_url: Mapped[str] = mapped_column(String(512))
    name: Mapped[str] = mapped_column(String(256))
    name_original: Mapped[str | None] = mapped_column(String(256), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title_type: Mapped[TitleType | None] = mapped_column(
        Enum(TitleType, native_enum=False), nullable=True
    )
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)  # film/series/cartoon/anime
    poster: Mapped[str | None] = mapped_column(String(512), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    # JSON cu extra TMDB: {trailer, cast: [...], similar: [...]}
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail_loaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    episodes: Mapped[list["Episode"]] = relationship(
        back_populates="title", cascade="all, delete-orphan"
    )
    watchlist: Mapped["WatchlistItem | None"] = relationship(
        back_populates="title", cascade="all, delete-orphan", uselist=False
    )
    history: Mapped[list["HistoryItem"]] = relationship(
        back_populates="title", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("source", "source_url", name="uq_title_source_url"),)


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    title_id: Mapped[int] = mapped_column(ForeignKey("titles.id"))
    season: Mapped[int] = mapped_column(Integer)
    episode: Mapped[int] = mapped_column(Integer)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    still: Mapped[str | None] = mapped_column(String(512), nullable=True)

    title: Mapped[Title] = relationship(back_populates="episodes")

    __table_args__ = (UniqueConstraint("title_id", "season", "episode", name="uq_episode"),)


class WatchlistStatus(str, enum.Enum):
    TO_WATCH = "to_watch"
    WATCHING = "watching"
    WATCHED = "watched"


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    title_id: Mapped[int] = mapped_column(ForeignKey("titles.id"), unique=True)
    status: Mapped[WatchlistStatus] = mapped_column(
        Enum(WatchlistStatus, native_enum=False), default=WatchlistStatus.TO_WATCH
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    title: Mapped[Title] = relationship(back_populates="watchlist")


class HistoryItem(Base):
    __tablename__ = "history"

    id: Mapped[int] = mapped_column(primary_key=True)
    title_id: Mapped[int] = mapped_column(ForeignKey("titles.id"))
    season: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position_seconds: Mapped[float] = mapped_column(Float, default=0)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    title: Mapped[Title] = relationship(back_populates="history")

    __table_args__ = (
        UniqueConstraint("title_id", "season", "episode", name="uq_history_title_ep"),
    )
