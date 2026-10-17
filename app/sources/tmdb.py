import asyncio
import re

from app.config import Config
from app.models import TitleType
from app.sources.base import (
    BaseSource,
    EpisodeInfo,
    SearchHit,
    SourceError,
    TitleDetail,
)

# URL-uri de sursa folosite in DB: themoviedb.org/movie/<id> / /tv/<id>
_URL_RE = re.compile(r"themoviedb\.org/(movie|tv)/(\d+)")

_SORT_MAP_FILM = {
    "popularity": "popularity.desc",
    "rating": "vote_average.desc",
    "date": "primary_release_date.desc",
    "title": "original_title.asc",
}
_SORT_MAP_TV = {
    "popularity": "popularity.desc",
    "rating": "vote_average.desc",
    "date": "first_air_date.desc",
    "title": "original_title.asc",
}

# cache in-memory pentru lista de genuri (schimba extrem de rar)
_genres_cache: dict[str, list[dict]] = {}


def _get(path: str, **params) -> dict:
    if not Config.TMDB_API_KEY:
        raise SourceError(
            "Lipseste TMDB_API_KEY. Creeaza cont gratuit pe themoviedb.org -> Settings -> API, "
            "si pune TMDB_API_KEY=... in fisierul .env din folderul proiectului, apoi reporneste."
        )
    import requests

    r = requests.get(
        f"{Config.TMDB_BASE}{path}",
        params={"api_key": Config.TMDB_API_KEY, "language": Config.TMDB_LANG, **params},
        timeout=20,
    )
    if r.status_code == 404:
        raise SourceError(f"TMDB: nu am gasit resursa {path}")
    r.raise_for_status()
    return r.json()


def _poster(path: str | None, base: str | None = None) -> str | None:
    if not path:
        return None
    b = base or Config.TMDB_IMAGE_BASE
    return f"{b}{path}"


class TmdbSource(BaseSource):
    """Catalog TMDB: cautare/discover/detalii in limba rusa. Fara stream — redarea
    merge prin magneți + TorrServer (vezi app/sources/torrents.py)."""

    name = "tmdb"

    def supports_browse(self, category: str) -> bool:
        return category in ("films", "series")

    async def search(self, query: str, page: int = 1) -> list[SearchHit]:
        data = await asyncio.to_thread(_get, "/search/multi", query=query, page=page, include_adult="false")
        return self._hits_from_multi(data.get("results", []))

    async def browse(
        self,
        category: str,
        page: int = 1,
        *,
        genre: int | None = None,
        year: int | None = None,
        sort: str = "popularity",
    ) -> list[SearchHit]:
        is_tv = category == "series"
        params: dict = {"page": page, "sort_by": _SORT_MAP_TV.get(sort, "popularity.desc") if is_tv
                        else _SORT_MAP_FILM.get(sort, "popularity.desc"), "include_adult": "false"}
        if sort == "rating":
            params["vote_count.gte"] = 200  # fara titluri cu 2 voturi de 10
        if genre:
            params["with_genres"] = genre
        if year:
            params["first_air_date_year" if is_tv else "primary_release_year"] = year
        data = await asyncio.to_thread(
            _get, "/discover/tv" if is_tv else "/discover/movie", **params
        )
        hits: list[SearchHit] = []
        for r in data.get("results", []):
            name = r.get("title") or r.get("name") or "?"
            year_s = (r.get("release_date") or r.get("first_air_date") or "")[:4]
            hits.append(
                SearchHit(
                    source=self.name,
                    name=name,
                    source_url=f"https://www.themoviedb.org/{'tv' if is_tv else 'movie'}/{r['id']}",
                    poster=_poster(r.get("poster_path")),
                    year=int(year_s) if year_s.isdigit() else None,
                    category="series" if is_tv else "film",
                    rating=r.get("vote_average") or None,
                )
            )
        return hits

    def _hits_from_multi(self, results: list[dict]) -> list[SearchHit]:
        hits: list[SearchHit] = []
        for r in results:
            if r.get("media_type") not in ("movie", "tv"):
                continue
            is_tv = r["media_type"] == "tv"
            name = r.get("title") or r.get("name") or "?"
            year_s = (r.get("release_date") or r.get("first_air_date") or "")[:4]
            hits.append(
                SearchHit(
                    source=self.name,
                    name=name,
                    source_url=f"https://www.themoviedb.org/{'tv' if is_tv else 'movie'}/{r['id']}",
                    poster=_poster(r.get("poster_path")),
                    year=int(year_s) if year_s.isdigit() else None,
                    category="series" if is_tv else "film",
                    rating=r.get("vote_average") or None,
                )
            )
        return hits

    async def genres(self, category: str) -> list[dict]:
        kind = "tv" if category == "series" else "movie"
        if kind not in _genres_cache:
            data = await asyncio.to_thread(_get, f"/genre/{kind}/list")
            _genres_cache[kind] = data.get("genres", [])
        return _genres_cache[kind]

    async def details(self, source_url: str) -> TitleDetail:
        m = _URL_RE.search(source_url)
        if not m:
            raise SourceError(f"URL TMDB nerecunoscut: {source_url}")
        media_type, tmdb_id = m.group(1), m.group(2)
        return await asyncio.to_thread(self._details_once, media_type, tmdb_id, source_url)

    # ---- extra best-effort: o eroare de rețea la trailer/cast nu strică detaliul ----

    def _trailer(self, media_type: str, tmdb_id: str) -> str | None:
        for lang in (Config.TMDB_LANG, "en-US"):
            try:
                data = _get(f"/{media_type}/{tmdb_id}/videos", language=lang)
            except Exception:  # noqa: BLE001
                continue
            vids = [v for v in data.get("results", []) if v.get("site") == "YouTube"]
            trailers = [v for v in vids if v.get("type") in ("Trailer", "Teaser")]
            pool = trailers or vids
            pool.sort(key=lambda v: (v.get("type") != "Trailer", not v.get("official", False)))
            if pool:
                return f"https://www.youtube.com/watch?v={pool[0]['key']}"
        return None

    def _cast(self, media_type: str, tmdb_id: str) -> list[dict]:
        try:
            data = _get(f"/{media_type}/{tmdb_id}/credits")
        except Exception:  # noqa: BLE001
            return []
        return [
            {
                "name": p.get("name") or "?",
                "character": p.get("character") or "",
                "profile": _poster(p.get("profile_path"), base="https://image.tmdb.org/t/p/w185"),
            }
            for p in (data.get("cast") or [])[:10]
        ]

    def _similar(self, media_type: str, tmdb_id: str) -> list[dict]:
        try:
            data = _get(f"/{media_type}/{tmdb_id}/recommendations")
        except Exception:  # noqa: BLE001
            return []
        out = []
        for r in (data.get("results") or [])[:8]:
            if not r.get("poster_path"):
                continue
            year_s = (r.get("release_date") or r.get("first_air_date") or "")[:4]
            out.append({
                "source": self.name,
                "name": r.get("title") or r.get("name") or "?",
                "source_url": f"https://www.themoviedb.org/{media_type}/{r['id']}",
                "poster": _poster(r.get("poster_path")),
                "year": int(year_s) if year_s.isdigit() else None,
                "category": "series" if media_type == "tv" else "film",
                "rating": r.get("vote_average") or None,
            })
        return out

    def _details_once(self, media_type: str, tmdb_id: str, source_url: str) -> TitleDetail:
        is_tv = media_type == "tv"
        path = f"/tv/{tmdb_id}" if is_tv else f"/movie/{tmdb_id}"
        data = _get(path, append_to_response="external_ids" if is_tv else "release_dates")

        # doar lista sezoanelor; episoadele se încarcă leneș, per sezon (vezi season_episodes)
        seasons: list[dict] = []
        if is_tv:
            for season in data.get("seasons", []):
                n = season.get("season_number")
                if n is not None:
                    seasons.append({"season": n, "episodes": season.get("episode_count") or 0})

        name = data.get("name") or data.get("title") or "?"
        year_s = (data.get("first_air_date") or data.get("release_date") or "")[:4]

        return TitleDetail(
            source=self.name,
            source_url=source_url,
            name=name,
            name_original=data.get("original_name") or data.get("original_title"),
            year=int(year_s) if year_s.isdigit() else None,
            title_type=TitleType.SERIES.value if is_tv else TitleType.MOVIE.value,
            category="series" if is_tv else "film",
            poster=_poster(data.get("poster_path")),
            description=data.get("overview") or None,
            rating=data.get("vote_average"),
            trailer=self._trailer(media_type, tmdb_id),
            cast=self._cast(media_type, tmdb_id),
            similar=self._similar(media_type, tmdb_id),
            seasons=seasons,
            backdrop=_poster(data.get("backdrop_path"), base="https://image.tmdb.org/t/p/w1280"),
        )

    def season_episodes(self, source_url: str, season: int) -> list[EpisodeInfo]:
        """Episoadele unui singur sezon — încărcare la cerere din gridul de episoade."""
        m = _URL_RE.search(source_url)
        if not m:
            raise SourceError(f"URL TMDB nerecunoscut: {source_url}")
        media_type, tmdb_id = m.group(1), m.group(2)
        if media_type != "tv":
            return []
        data = _get(f"/tv/{tmdb_id}/season/{season}")
        out: list[EpisodeInfo] = []
        for ep in data.get("episodes", []):
            if ep.get("episode_number"):
                out.append(
                    EpisodeInfo(
                        season,
                        ep["episode_number"],
                        name=ep.get("name"),
                        still=_poster(ep.get("still_path"), base="https://image.tmdb.org/t/p/w300"),
                    )
                )
        return out
