import time

import pytest

from app.sources import torrents as t
from app.sources.base import SourceError


@pytest.fixture
def fake_sources(monkeypatch):
    monkeypatch.setattr(t, "_torznab_configured", lambda: True)
    monkeypatch.setattr(t, "_torznab_indexer_list", lambda: [("fast", "Rapid"), ("slow", "Lent"), ("dead", "Căzut")])

    def one(idx, query, limit, timeout=25):
        if idx[0] == "slow":
            time.sleep(2)
            return [{"name": "lent 1080p", "magnet": "magnet:?xt=urn:btih:" + "c" * 40, "seeds": 99, "indexer": "Lent"}]
        if idx[0] == "dead":
            raise RuntimeError("timeout Cloudflare")
        return [
            {"name": "Concert 2160p", "magnet": "magnet:?xt=urn:btih:" + "a" * 40, "seeds": 5, "indexer": "Rapid"},
            {"name": "Concert Дубляж 1080p", "magnet": "magnet:?xt=urn:btih:" + "b" * 40, "seeds": 50, "indexer": "Rapid"},
        ]

    monkeypatch.setattr(t, "_torznab_one", one)

    def rutor_empty(q):
        raise SourceError("https://rutor.info/: rezultate goale")

    monkeypatch.setattr(t, "_search_mirrors", rutor_empty)


def test_sursa_lenta_nu_blocheaza(fake_sources):
    started = time.monotonic()
    r = t.raw_search_sync("concert", wait_s=0.5)
    assert time.monotonic() - started < 1.5  # nu a așteptat sursa lentă
    assert r["slow"] == ["Lent"]
    assert r["failed"] == ["Căzut"]  # Rutor fără rezultate NU e trecut la căzute
    names = [x["name"] for x in r["results"]]
    assert names == ["Concert Дубляж 1080p", "Concert 2160p"]  # sortat după seederi
    first = r["results"][0]
    assert first["quality"] == "1080p" and first["dub"] == "RU"
