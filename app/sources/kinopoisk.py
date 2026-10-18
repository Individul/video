"""Kinopoisk (prin kinopoiskapiunofficial.tech): rating KP + IMDb și descrierea rusească,
ca completare la TMDB. Legătura se face prin ID-ul IMDb (din TMDB); fără el, căutare
după nume + an. Fiecare titlu costă ~2 cereri o singură dată — rezultatul se ține în DB.

Cheia gratuită are o limită zilnică, așa că nu cerem nimic pentru titluri deja cache-uite
și nu repetăm cererile când serviciul răspunde cu „limită depășită”.
"""

import re

from app.config import Config
from app.sources.base import SourceError

BASE = "https://kinopoiskapiunofficial.tech/api"


class KpQuotaError(SourceError):
    """Limita zilnică/rata a fost depășită — încercăm din nou mai târziu, nu salvăm „negăsit”."""


def _get(path: str, **params) -> dict:
    if not Config.KP_API_KEY:
        raise SourceError("Lipsește KP_API_KEY")
    import requests

    r = requests.get(
        f"{BASE}{path}", params=params,
        headers={"X-API-KEY": Config.KP_API_KEY, "Accept": "application/json"}, timeout=15,
    )
    if r.status_code in (402, 429):
        raise KpQuotaError(f"Kinopoisk: limită depășită ({r.status_code})")
    if r.status_code in (401, 403):
        raise SourceError(f"Kinopoisk: cheie invalidă ({r.status_code})")
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    return r.json() or {}


def _norm(s: str | None) -> str:
    return re.sub(r"[^\w]+", "", (s or "").lower().replace("ё", "е"))


def _find_id(imdb_id: str | None, name: str | None, name_original: str | None, year: int | None) -> int | None:
    if imdb_id:
        data = _get("/v2.2/films", imdbId=imdb_id)
        items = data.get("items") or []
        if items and items[0].get("kinopoiskId"):
            return int(items[0]["kinopoiskId"])
    # fără IMDb (des la filmele rusești): căutare după nume, potrivit pe an
    for q in [n for n in (name, name_original) if n]:
        data = _get("/v2.1/films/search-by-keyword", keyword=q, page=1)
        for f in data.get("films") or []:
            y = str(f.get("year") or "")[:4]
            names = {_norm(f.get("nameRu")), _norm(f.get("nameEn"))}
            if (not year or y == str(year)) and (_norm(name) in names or _norm(name_original) in names):
                return int(f["filmId"])
    return None


def lookup(imdb_id: str | None, name: str | None, name_original: str | None, year: int | None) -> dict | None:
    """{id, rating_kp, votes_kp, rating_imdb, votes_imdb, description, url} sau None dacă
    titlul nu există pe Kinopoisk. Aruncă KpQuotaError / SourceError la probleme de serviciu."""
    kp_id = _find_id(imdb_id, name, name_original, year)
    if not kp_id:
        return None
    f = _get(f"/v2.2/films/{kp_id}")
    if not f:
        return None
    return {
        "id": kp_id,
        "rating_kp": f.get("ratingKinopoisk"),
        "votes_kp": f.get("ratingKinopoiskVoteCount"),
        "rating_imdb": f.get("ratingImdb"),
        "votes_imdb": f.get("ratingImdbVoteCount"),
        "description": f.get("description") or f.get("shortDescription") or None,
        "url": f.get("webUrl") or f"https://www.kinopoisk.ru/film/{kp_id}/",
    }
