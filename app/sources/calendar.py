"""Calendarul aparițiilor (ca „Расписание” din Lampa), din TMDB:

- premiere în cinema (release_dates tip 2/3) și lansări digitale (tip 4 — de obicei
  momentul în care filmul apare și pe torrente), în SUA, cu fallback pe prima țară;
- episoade noi (next_episode_to_air) pentru serialele urmărite + premierele populare.

Datele exacte pe tip de lansare cer câte un apel per film, așa că totul e cache-uit
câteva ore în memorie, iar apelurile rulează în paralel pe câteva fire.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from app.sources.base import SourceError
from app.sources.tmdb import _get, _hit_from

_CACHE_TTL = 6 * 3600
_cache: dict[str, tuple[float, object]] = {}
_REGIONS = ("US", "GB", "RU")  # SUA întâi: acolo apar primele WEB-DL-uri


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.time(), value)
    return value


def _safe(fn, default=None):
    try:
        return fn()
    except (SourceError, Exception):  # noqa: BLE001 — un titlu căzut nu strică tot calendarul
        return default


def release_dates_of(movie_id: int) -> dict[str, str | None]:
    """{"cinema": "YYYY-MM-DD"|None, "digital": ...} pentru prima regiune care are date."""
    def load():
        data = _get(f"/movie/{movie_id}/release_dates")
        by_region = {r.get("iso_3166_1"): r.get("release_dates") or [] for r in data.get("results", [])}
        out: dict[str, str | None] = {"cinema": None, "digital": None}
        for region in (*_REGIONS, *by_region.keys()):
            for d in by_region.get(region, []):
                day = (d.get("release_date") or "")[:10] or None
                kind = "cinema" if d.get("type") in (2, 3) else "digital" if d.get("type") == 4 else None
                if kind and day and out[kind] is None:
                    out[kind] = day
            if out["cinema"] and out["digital"]:
                break
        return out

    return _cached(f"rd:{movie_id}", load)


def _movie_candidates(start: date, end: date) -> list[dict]:
    """Filme care pot avea o lansare în fereastră: cele lansate recent în cinema (urmează
    digitalul) + cele care urmează. Câteva pagini, sortate după popularitate."""
    def load():
        found: dict[int, dict] = {}
        windows = [
            # lansate în cinema în ultimele ~4 luni -> lansarea digitală cade adesea acum
            (start - timedelta(days=120), end),
        ]
        for gte, lte in windows:
            for page in (1, 2, 3, 4):
                data = _safe(lambda: _get(
                    "/discover/movie", page=page, sort_by="popularity.desc", include_adult="false",
                    **{"primary_release_date.gte": gte.isoformat(), "primary_release_date.lte": lte.isoformat(),
                       "vote_count.gte": 0, "region": "US", "with_release_type": "2|3|4"},  # doar filme cu lansare în SUA (acolo apar WEB-DL-urile)
                ), {}) or {}
                for r in data.get("results", []):
                    found.setdefault(r["id"], r)
        for page in (1, 2):
            data = _safe(lambda: _get("/movie/upcoming", page=page, region="US"), {}) or {}
            for r in data.get("results", []):
                found.setdefault(r["id"], r)
        return list(found.values())

    return _cached(f"mc:{start}:{end}", load)


def movie_events(start: date, end: date) -> list[dict]:
    cands = _movie_candidates(start, end)
    with ThreadPoolExecutor(max_workers=8) as pool:
        dates = list(pool.map(lambda r: _safe(lambda: release_dates_of(r["id"]), {}) or {}, cands))
    events = []
    for r, rd in zip(cands, dates):
        if not r.get("poster_path"):
            continue
        hit = _hit_from(r, "movie")
        for kind in ("cinema", "digital"):
            day = rd.get(kind)
            if day and start.isoformat() <= day <= end.isoformat():
                events.append({"date": day, "kind": kind, "hit": hit.__dict__.copy(),
                               "popularity": r.get("popularity") or 0})
    return events


def _next_episode(tv_id: int) -> dict | None:
    def load():
        d = _get(f"/tv/{tv_id}")
        nxt = d.get("next_episode_to_air") or None
        if not nxt or not nxt.get("air_date"):
            return None
        return {
            "date": nxt["air_date"][:10],
            "season": nxt.get("season_number"),
            "episode": nxt.get("episode_number"),
            "episode_name": nxt.get("name") or None,
            "show": d,
        }

    return _cached(f"tv:{tv_id}", load)


def _popular_airing(start: date, end: date) -> list[int]:
    def load():
        ids: list[int] = []
        for page in (1, 2):
            data = _safe(lambda: _get(
                "/discover/tv", page=page, sort_by="popularity.desc", include_adult="false",
                **{"air_date.gte": start.isoformat(), "air_date.lte": end.isoformat(), "vote_count.gte": 20,
                   "without_genres": "10763,10764,10767"},  # fără știri, reality, talk-show-uri
            ), {}) or {}
            ids += [r["id"] for r in data.get("results", [])]
        return ids

    return _cached(f"pa:{start}:{end}", load)


def episode_events(start: date, end: date, followed_ids: list[int]) -> list[dict]:
    """Episoade noi: serialele tale (followed=True) + cele populare care rulează acum."""
    followed = set(followed_ids)
    ids = list(dict.fromkeys([*followed_ids, *_popular_airing(start, end)]))
    with ThreadPoolExecutor(max_workers=8) as pool:
        nexts = list(pool.map(lambda i: _safe(lambda: _next_episode(i)), ids))
    events = []
    for tv_id, nx in zip(ids, nexts):
        if not nx or not (start.isoformat() <= nx["date"] <= end.isoformat()):
            continue
        show = nx["show"]
        if not show.get("poster_path"):
            continue
        hit = _hit_from({**show, "id": tv_id}, "tv")
        events.append({
            "date": nx["date"], "kind": "episode", "hit": hit.__dict__.copy(),
            "season": nx["season"], "episode": nx["episode"], "episode_name": nx["episode_name"],
            "followed": tv_id in followed, "popularity": show.get("popularity") or 0,
        })
    return events


def calendar(days_back: int, days_ahead: int, followed_tv_ids: list[int], today: date | None = None) -> list[dict]:
    """Evenimentele din [azi - days_back, azi + days_ahead], sortate pe dată, apoi
    serialele tale întâi, apoi după popularitate."""
    today = today or date.today()
    start, end = today - timedelta(days=days_back), today + timedelta(days=days_ahead)
    events = movie_events(start, end) + episode_events(start, end, followed_tv_ids)
    events.sort(key=lambda e: (e["date"], not e.get("followed", False), -e["popularity"]))
    for e in events:
        e.pop("popularity", None)
    return events
