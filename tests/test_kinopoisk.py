import json

import pytest

from app.config import Config
from app.sources import kinopoisk as kp


def fake_kp(calls):
    def _get(path, **params):
        calls.append((path, params))
        if path == "/v2.2/films" and params.get("imdbId") == "tt0816692":
            return {"items": [{"kinopoiskId": 258687}]}
        if path == "/v2.2/films":
            return {"items": []}
        if path == "/v2.1/films/search-by-keyword":
            return {"films": [
                {"filmId": 1, "nameRu": "Жуки", "year": "2019"},
                {"filmId": 2, "nameRu": "Жуки", "year": "2024"},
            ]}
        if path == "/v2.2/films/258687":
            return {"ratingKinopoisk": 8.7, "ratingKinopoiskVoteCount": 1000000, "ratingImdb": 8.7,
                    "ratingImdbVoteCount": 2000000, "description": "Описание", "webUrl": "https://www.kinopoisk.ru/film/258687/"}
        if path == "/v2.2/films/2":
            return {"ratingKinopoisk": 8.1, "shortDescription": "Коротко"}
        raise AssertionError(path)
    return _get


@pytest.fixture
def calls(monkeypatch):
    c = []
    monkeypatch.setattr(kp, "_get", fake_kp(c))
    return c


def test_lookup_prin_imdb(calls):
    r = kp.lookup("tt0816692", "Интерстеллар", "Interstellar", 2014)
    assert r["id"] == 258687 and r["rating_kp"] == 8.7 and r["rating_imdb"] == 8.7
    assert r["description"] == "Описание"
    assert len(calls) == 2  # o cerere pentru id, una pentru detalii


def test_lookup_fara_imdb_dupa_nume_si_an(calls):
    r = kp.lookup(None, "Жуки", None, 2024)
    assert r["id"] == 2 and r["description"] == "Коротко"  # anul alege filmul corect


def test_lookup_negasit(calls):
    assert kp.lookup("tt0000000", "Nimic", None, 1999) is None


def test_quota_nu_salveaza_negasit(monkeypatch):
    """La limită depășită pagina merge mai departe, fără să marcheze titlul „negăsit”."""
    import asyncio

    from app.api import routes
    from app.models import Title

    monkeypatch.setattr(Config, "KP_API_KEY", "x")

    def boom(*a, **k):
        raise kp.KpQuotaError("limită")

    monkeypatch.setattr(kp, "lookup", boom)

    class FakeDb:
        async def commit(self):
            raise AssertionError("nu trebuie salvat nimic")

    t = Title(source="tmdb", source_url="https://www.themoviedb.org/movie/1", name="X")
    t.extra = json.dumps({"imdb_id": "tt1"})
    assert asyncio.run(routes._ensure_kinopoisk(FakeDb(), t)) is None
    assert "kp" not in json.loads(t.extra)


def test_cache_negasit_nu_repeta_cererea(monkeypatch):
    import asyncio
    import time

    from app.api import routes
    from app.models import Title

    monkeypatch.setattr(Config, "KP_API_KEY", "x")
    monkeypatch.setattr(kp, "lookup", lambda *a, **k: (_ for _ in ()).throw(AssertionError("fără cerere")))
    t = Title(source="tmdb", source_url="https://www.themoviedb.org/movie/1", name="X")
    t.extra = json.dumps({"kp": {"none": True, "at": time.time()}})
    assert asyncio.run(routes._ensure_kinopoisk(None, t)) is None
