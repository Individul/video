import pytest

from app.config import Config
from app.sources import library
from app.sources.base import SourceError


def item(title, n, date, seeds):
    return f"""<item><title>{title}</title><link>http://jackett:9117/dl/rutracker/?path={n}</link>
<size>{n * 100_000_000}</size><pubDate>{date}</pubDate><torznab:attr name="seeders" value="{seeds}"/>
<torznab:attr name="category" value="3030"/></item>"""


FEED = ("""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>"""
        + item("Булгаков - Мастер и Маргарита [MP3, 128 kbps]", 1, "Sat, 17 Oct 2026 22:00:00 +0300", 40)
        + item("Кинг - Зелёная миля [MP3, 96 kbps]", 2, "Mon, 19 Oct 2026 08:00:00 +0300", 3)
        + item("Ремарк - Три товарища [MP3, 64 kbps]", 3, "Sun, 18 Oct 2026 10:00:00 +0300", 12)
        + "</channel></rss>").encode()


class Resp:
    def __init__(self, content=b"", status=200, headers=None, is_redirect=False):
        self.content, self.status_code, self.headers, self.is_redirect = content, status, headers or {}, is_redirect

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self.content


@pytest.fixture
def jackett(monkeypatch):
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    monkeypatch.setattr(Config, "TORZNAB_API_KEY", "k")
    monkeypatch.setattr(library, "_torznab_indexer_list", lambda: [("rutracker", "RuTracker")])
    library._cache.clear()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return Resp(FEED)

    import requests
    monkeypatch.setattr(requests, "get", fake_get)
    return calls


def test_browse_newest_first_with_category(jackett):
    res = library.browse("audiobooks")
    assert [r["name"][:4] for r in res] == ["Кинг", "Рема", "Булг"]
    assert "cat=3030" in jackett[0] and "q=" not in jackett[0]
    assert res[0]["indexer"] == "RuTracker"


def test_search_sorted_by_seeds_and_cached(jackett):
    res = library.browse("audiobooks", "  мастер   ")
    assert [r["seeds"] for r in res] == [40, 12, 3]
    assert "q=%D0%BC%D0%B0%D1%81%D1%82%D0%B5%D1%80" in jackett[0]
    library.browse("audiobooks", "Мастер")
    assert len(jackett) == 1  # din cache


def test_music_categories(jackett):
    library.browse("music")
    assert "cat=3000%2C3010%2C3040" in jackett[0]


def test_unknown_kind():
    with pytest.raises(SourceError):
        library.browse("films")


def test_add_magnet_to_music_folder(monkeypatch):
    sent = {}

    def fake_qb(method, path, **kw):
        sent.update(method=method, path=path, **kw)
        return Resp()

    monkeypatch.setattr(library, "_qb", fake_qb)
    h = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    out = library.add("music", {"magnet": f"magnet:?xt=urn:btih:{h}&dn=x"})
    assert out == {"hash": h.lower(), "kind": "music"}
    assert sent["path"] == "torrents/add"
    assert sent["data"]["savepath"] == "/media/music" and sent["data"]["category"] == "music"


def test_add_rejects_foreign_torrent_url(monkeypatch):
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    monkeypatch.setattr(library, "_qb", lambda *a, **k: pytest.fail("nu trebuia trimis"))
    with pytest.raises(SourceError, match="nepermis"):
        library.add("audiobooks", {"torrent_url": "http://evil.example/x.torrent"})
    with pytest.raises(SourceError, match="invalid"):
        library.add("audiobooks", {"magnet": "http://x"})


def test_items_and_free_space(monkeypatch):
    def fake_qb(method, path, **kw):
        if path == "sync/maindata":
            return Resp({"server_state": {"free_space_on_disk": 20 * 1024 ** 3}})
        if kw["params"]["category"] == "music":
            return Resp([{"hash": "a" * 40, "name": "Album", "size": 1024 ** 3, "progress": 0.5,
                          "state": "downloading", "dlspeed": 1000, "eta": 60, "added_on": 2}])
        return Resp([{"hash": "b" * 40, "name": "Carte", "size": 1024 ** 3, "progress": 1,
                      "state": "stalledUP", "dlspeed": 0, "eta": 0, "added_on": 1}])

    monkeypatch.setattr(library, "_qb", fake_qb)
    out = library.items()
    assert [x["kind"] for x in out["items"]] == ["music", "audiobooks"]
    assert out["items"][0]["dl_bps"] == 8000
    assert out["used"] == "2.00 GB" and out["free"] == "20.00 GB"


def test_remove_validates_hash(monkeypatch):
    monkeypatch.setattr(library, "_qb", lambda *a, **k: Resp())
    with pytest.raises(SourceError):
        library.remove("../x")
    library.remove("c" * 40)
