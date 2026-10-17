import hashlib

from app.sources.torrents import _bdecode, _bencode, _infohash_from_torrent, _parse_torznab

# ----------------- bencode + infohash -----------------

def test_bencode_roundtrip():
    data = {b"announce": b"http://tr/", b"info": {b"name": b"test.bin", b"length": 10}}
    decoded, _ = _bdecode(_bencode(data))
    assert decoded == data


def test_infohash_computed_from_info_dict():
    info = {b"name": b"test.bin", b"length": 10, b"piece length": 16384, b"pieces": bytes(20)}
    torrent = _bencode({b"announce": b"http://tr/", b"info": info})
    expected = hashlib.sha1(_bencode(info)).hexdigest()
    assert _infohash_from_torrent(torrent) == expected
    assert len(expected) == 40


# ----------------- Torznab XML parse -----------------

TORZNAB_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="1.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
<channel>
<item>
  <title>Фильм (2024) WEB-DLRip</title>
  <link>https://127.0.0.1:9117/dl/rutracker/abc.torrent?apikey=K</link>
  <guid>https://127.0.0.1:9117/dl/rutracker/abc.torrent?apikey=K</guid>
  <size>4294967296</size>
  <attr name="seeders" value="42"/>
  <attr name="jackettindexers" value="rutracker.org"/>
</item>
<item>
  <title>Alt film (2023) 1080p</title>
  <link>magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567</link>
  <size>1073741824</size>
  <attr name="seeders" value="7"/>
</item>
</channel>
</rss>
""".encode("utf-8")


def test_parse_torznab_items():
    items = _parse_torznab(TORZNAB_XML)
    assert len(items) == 2

    first = items[0]
    assert "Фильм (2024)" in first["name"]
    assert first["magnet"] is None
    assert first["torrent_url"].endswith("abc.torrent?apikey=K")
    assert first["seeds"] == 42
    assert first["size"] == "4.00 GB"

    second = items[1]
    assert second["magnet"] == "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"
    assert second["seeds"] == 7
