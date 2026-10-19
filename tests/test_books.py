import pytest

from app.config import Config
from app.sources import books
from app.sources.base import SourceError
from app.sources.books import book_key, group_books, parse_title


def test_parse_rutracker_series_and_narrators():
    p = parse_title("Леншер Ханна - Академия Крылатого Пламени 5, Ловушка для генерала "
                    "[Виктор Самарин, Ирина Звонкая, 2026, 128 kbps, MP3]")
    assert p["author"] == "Ханна Леншер"
    assert p["series"] == "Академия Крылатого Пламени 5" and p["title"] == "Ловушка для генерала"
    assert p["narrator"] == "Виктор Самарин, Ирина Звонкая"
    assert (p["year"], p["bitrate"], p["format"]) == ("2026", "128 kbps", "MP3")


def test_parse_rutracker_language_and_alternatives():
    p = parse_title("[Английский] Gordievsky Oleg / Гордиевский Олег - Next Stop Execution: The Autobiography of "
                    "Oleg Gordievsky / Следующая остановка - расстрел [Saul Reichlin, 2018, MP3, 64 kbps]")
    assert p["lang"] == "Английский"
    assert p["author"] == "Oleg Gordievsky" and p["author_alt"] == "Олег Гордиевский"
    assert p["title"].startswith("Next Stop Execution") and p["title_alt"] == "Следующая остановка - расстрел"
    assert p["narrator"] == "Saul Reichlin" and p["year"] == "2018"


def test_parse_rutracker_multi_author_and_odd_bracket():
    p = parse_title("Сапфир Олег, Альтергот Марк - Идеальный мир для Химеролога 6 [Андрей Морозов, 2026, 96 kbps, MP3]")
    assert p["author"] == "Олег Сапфир, Марк Альтергот" and p["title"] == "Идеальный мир для Химеролога 6"
    p = parse_title("Народное творчество (фольклор) - Али-Баба и сорок разбойников (сборник) "
                    "[Аравушкин Александр, 2024, Восточные сказки, VBR 128 kbps]")
    assert p["author"] == "Народное творчество (фольклор)"
    assert p["title"] == "Али-Баба и сорок разбойников (сборник)"
    assert p["bitrate"] == "VBR 128 kbps" and p["narrator"] == "Аравушкин Александр"


def test_parse_nnm():
    p = parse_title("Максим Перов | Религия и Общество - Religiolog (2019) [MP3, Максим Перов] (Обновляемая)")
    assert p["author"] == "Максим Перов" and p["title"] == "Религия и Общество - Religiolog"
    assert (p["year"], p["format"], p["narrator"]) == ("2019", "MP3", "Максим Перов")


def test_parse_unknown_format_keeps_name():
    assert parse_title("Something weird")["title"] == "Something weird"


def test_same_book_from_both_trackers_is_grouped():
    rel = [
        {"name": "Булгаков Михаил - Мастер и Маргарита [Клюквин Александр, 2015, 128 kbps, MP3]", "seeds": 5,
         "magnet": "magnet:?xt=urn:btih:" + "a" * 40, "published": "2026-10-01"},
        {"name": "Михаил Булгаков | Мастер и Маргарита (2008) [MP3, Олег Басилашвили]", "seeds": 40,
         "magnet": "magnet:?xt=urn:btih:" + "b" * 40, "published": "2026-10-05"},
        {"name": "Кинг Стивен - Зелёная миля [Котов Игорь, 2010, 96 kbps, MP3]", "seeds": 3,
         "magnet": "magnet:?xt=urn:btih:" + "c" * 40, "published": "2026-09-01"},
    ]
    out = group_books(rel)
    assert len(out) == 2
    b = out[0]
    assert b["key"] == book_key("Михаил Булгаков", "Мастер и Маргарита")
    assert [v["narrator"] for v in b["versions"]] == ["Олег Басилашвили", "Клюквин Александр"]
    assert b["seeds"] == 40 and b["published"] == "2026-10-05"
    assert b["narrators"] == ["Олег Басилашвили", "Клюквин Александр"]


def test_litres_match_requires_author():
    items = [
        {"instance": {"id": 1, "title": "Регистрация банков в РФ", "persons": [{"full_name": "Сергей Каледин", "role": "author"}]}},
        {"instance": {"id": 2, "title": "Регистрация", "persons": [{"full_name": "Дмитрий Глуховский", "role": "author"}]}},
    ]
    assert books._litres_match("Дмитрий Глуховский", "Регистрация", items)["id"] == 2
    assert books._litres_match("Дмитрий Глуховский", "Регистрация", items[:1]) is None


def test_meta_cached_and_misses_remembered(monkeypatch, tmp_path):
    monkeypatch.setattr(books, "_META_FILE", tmp_path / "m.json")
    monkeypatch.setattr(books, "_meta", None)
    calls = []

    def fake(path, **params):
        calls.append(path)
        if path == "search":
            return [{"instance": {"id": 7, "title": "Регистрация", "persons": [
                {"full_name": "Дмитрий Глуховский", "role": "author"}, {"full_name": "Дмитрий Оргин", "role": "reader"}]}}]
        return {"html_annotation": "<p>Роман &laquo;о&raquo;</p><p>второй</p>", "genres": [{"name": "антиутопии"}],
                "livelib_rated_avg": 4.26, "date_written_at": "2026-02-01"}

    monkeypatch.setattr(books, "_litres_get", fake)
    m = books.meta("Дмитрий Глуховский", "Регистрация")
    assert m["cover"].endswith("/cover_415/7.jpg") and m["readers"] == ["Дмитрий Оргин"]
    m = books.meta("Дмитрий Глуховский", "Регистрация", full=True)
    assert m["description"] == "Роман «о»\nвторой" and m["rating"] == 4.3 and m["genres"] == ["антиутопии"]
    books.meta("Дмитрий Глуховский", "Регистрация", full=True)
    assert calls == ["search", "arts/7"]

    monkeypatch.setattr(books, "_litres_get", lambda path, **p: calls.append(path) or [])
    assert books.meta("Nobody", "Nothing") is None
    n = len(calls)
    assert books.meta("Nobody", "Nothing") is None and len(calls) == n  # lipsa e ținută minte
    assert (tmp_path / "m.json").exists()


FEED = ("""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
<item><title>Глуховский Дмитрий - Регистрация [Дмитрий Оргин, 2026, 192 kbps, MP3]</title>
<link>http://jackett:9117/dl/rutracker/?path=1</link><size>100</size><pubDate>Mon, 19 Oct 2026 08:00:00 +0300</pubDate>
<torznab:attr name="seeders" value="9"/><torznab:attr name="category" value="3030"/><torznab:attr name="category" value="102387"/></item>
</channel></rss>""").encode()


class Resp:
    def __init__(self, content=b"", status=200):
        self.content, self.status_code = content, status

    def raise_for_status(self):
        pass

    def json(self):
        return self.content


def test_genre_browse_uses_rutracker_subforums(monkeypatch):
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    monkeypatch.setattr(Config, "TORZNAB_API_KEY", "k")
    monkeypatch.setattr(books, "_torznab_indexer_list", lambda: [("rutracker", "RuTracker"), ("noname-club", "NNM")])
    books._cache.clear()
    urls = []
    import requests
    monkeypatch.setattr(requests, "get", lambda url, **kw: urls.append(url) or Resp(FEED))
    out = books.browse("fantasy")
    assert len(urls) == 1 and "/indexers/rutracker/" in urls[0] and "cat=102387%2C102388%2C102348" in urls[0]
    assert out[0]["title"] == "Регистрация" and out[0]["versions"][0]["indexer"] == "RuTracker"
    with pytest.raises(SourceError):
        books.browse("nope")


def test_tracks_natural_order_and_safe_path(monkeypatch, tmp_path):
    root = tmp_path / "audiobooks"
    (root / "Carte").mkdir(parents=True)
    for n in ("10.mp3", "2.mp3", "1.mp3"):
        (root / "Carte" / n).write_bytes(b"x")
    monkeypatch.setenv("AUDIOBOOKS_DIR", str(root))
    files = [{"index": 0, "name": "Carte/10.mp3", "size": 1, "progress": 1},
             {"index": 1, "name": "Carte/2.mp3", "size": 1, "progress": 1},
             {"index": 2, "name": "Carte/cover.jpg", "size": 1, "progress": 1},
             {"index": 3, "name": "Carte/1.mp3", "size": 1, "progress": 1},
             {"index": 4, "name": "../../etc/passwd.mp3", "size": 1, "progress": 1}]
    monkeypatch.setattr(books, "_qb", lambda *a, **k: Resp(files))
    h = "d" * 40
    assert [t["title"] for t in books.tracks(h) if t["title"] != "passwd"] == ["1", "2", "10"]
    assert books.track_path(h, 1) == (root / "Carte" / "2.mp3").resolve()
    with pytest.raises(SourceError):
        books.track_path(h, 4)
    with pytest.raises(SourceError):
        books.track_path(h, 2)  # nu e pistă audio
    with pytest.raises(SourceError):
        books.tracks("../x")


def test_add_magnet(monkeypatch):
    sent = {}
    monkeypatch.setattr(books, "_qb", lambda m, p, **kw: sent.update(path=p, **kw) or Resp())
    h = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    assert books.add({"magnet": f"magnet:?xt=urn:btih:{h}"}) == h.lower()
    assert sent["data"]["savepath"] == "/media/audiobooks" and sent["data"]["category"] == "audiobooks"
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    with pytest.raises(SourceError, match="nepermis"):
        books.add({"torrent_url": "http://evil.example/x.torrent"})


def test_author_spellings_group_together():
    k = book_key("Михаил Булгаков", "Мастер и Маргарита")
    for a in ("Булгаков Михаил Афанасьевич", "Михаил Афанасьевич Булгаков", "М.А.Булгаков", "Булгаков", "Михал Булгаков"):
        assert book_key(a, "Мастер и Маргарита") == k, a
    assert book_key("Олег Сапфир, Марк Альтергот", "X") == book_key("Марк Альтергот, Олег Сапфир", "X")


def test_parse_messy_rutracker_brackets():
    p = parse_title("[Русская] Михаил Булгаков - Мастер и Маргарита [Александр Клюквин, Максим Суханов, Дарья Мороз, "
                    "2006, OGG 32-48 kbps]. Полное издание. Аудиокнига")
    assert p["title"] == "Мастер и Маргарита" and p["narrator"].startswith("Александр Клюквин")
    p = parse_title("Булгаков Михаил - Мастер и Маргарита [2006, Максим Суханов, Дарья Мороз, MP3, 160 kbps]")
    assert p["year"] == "2006" and p["narrator"] == "Максим Суханов, Дарья Мороз"
    p = parse_title("[Английский] Bulgakov Mikhail / Булгаков Михаил - The Master and Margarita / Мастер и Маргарита "
                    "[Julian Rhind-Tutt, 2009 г., MP3, 64 kbps]")
    assert p["year"] == "2009" and p["narrator"] == "Julian Rhind-Tutt"
