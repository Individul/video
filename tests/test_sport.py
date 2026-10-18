import pytest

from app.config import Config
from app.sources import sport

FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
<item><title>Italy \xc2\xbb Serie A 2026-27 \xc2\xbb 07. Round \xc2\xbb Bologna FC vs Inter [17.10.2026, 720p, 50 fps]</title>
<link>http://jackett:9117/dl/rgfootball/?path=1</link><size>3276009805</size><pubDate>Sat, 17 Oct 2026 22:00:00 +0300</pubDate>
<torznab:attr name="seeders" value="16"/></item>
<item><title>Italy \xc2\xbb Serie A 2026-27 \xc2\xbb 07. Round \xc2\xbb Bologna FC vs Inter [17.10.2026, 1080i, H.264]</title>
<link>http://jackett:9117/dl/rgfootball/?path=2</link><size>9223372036</size><pubDate>Sat, 17 Oct 2026 23:00:00 +0300</pubDate>
<torznab:attr name="seeders" value="4"/></item>
<item><title>Brasileirao Seria A 2026 \xc2\xbb Matchday 31 \xc2\xbb Athletico Paranaense - Palmeiras [18.10.2026, 720p 50 fps, MKV]</title>
<link>http://jackett:9117/dl/rgfootball/?path=3</link><size>2000000000</size><pubDate>Sun, 18 Oct 2026 10:00:00 +0300</pubDate>
<torznab:attr name="seeders" value="1"/></item>
</channel></rss>"""


class Resp:
    content = FEED

    def raise_for_status(self):
        pass


@pytest.fixture(autouse=True)
def jackett(monkeypatch):
    import requests

    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    monkeypatch.setattr(Config, "TORZNAB_API_KEY", "k")
    monkeypatch.setattr(requests, "get", lambda *a, **k: Resp())
    monkeypatch.setattr(sport, "_cache", {})


def test_parse_titluri_reale():
    p = sport.parse_title("Italy » Serie A 2026-27 » 07. Round » Bologna FC vs Inter [17.10.2026, 720p, 50 fps]")
    assert p == {"competition": "Serie A", "country": "Italy", "round": "07. Round",
                 "match": "Bologna FC vs Inter", "date": "2026-10-17", "quality": "720p 50fps"}
    b = sport.parse_title("Brasileirao Seria A 2026 » Matchday 31 » Athletico Paranaense - Palmeiras [18.10.2026, 720p 50 fps, MKV]")
    assert (b["competition"], b["round"], b["quality"]) == ("Brasileirao Seria A", "Matchday 31", "720p 50fps")
    u = sport.parse_title('"UFC Fight Night 291": Buckley vs. Malott [Main card] / MTV HD [17.10.2026, 720p, 50 fps]')
    assert u["competition"] == "UFC Fight Night" and u["match"].startswith("Buckley vs. Malott")


def test_feed_grupeaza_variantele_aceluiasi_meci():
    m = sport.feed()
    assert [x["match"] for x in m] == ["Athletico Paranaense - Palmeiras", "Bologna FC vs Inter"]  # cele mai noi întâi
    bol = m[1]
    assert [v["quality"] for v in bol["variants"]] == ["720p 50fps", "1080i"]  # varianta ușoară întâi
    assert bol["variants"][0]["torrent_url"].endswith("path=1") and bol["variants"][0]["seeds"] == 16
    assert bol["variants"][0]["size"].endswith("GB")


@pytest.mark.parametrize("title,expected", [
    ("⚽️England Premier League 2026-27 / 07. Round / Everton - Chelsea / TNT SP@RT UHD [17.10.2026, 2160p, 50 fps, 4k, HDR, HEVC]",
     ("England", "Premier League", "07. Round", "Everton - Chelsea", "2160p 50fps")),
    ("⚽️Germany » 2. Bundesliga 2026-27 / 08. Round / Hannover 96 - St. Pauli / SSB UHD [17.09.2026, 2160p, 50 fps, HEVC",
     ("Germany", "2. Bundesliga", "08. Round", "Hannover 96 - St. Pauli", "2160p 50fps")),
    ("Primera Division 2026-2027 / Matchday 09 / Real Betis - Barcelona [17.10.2026, 720p 50 fps, H.264, RU, HDTVRip]",
     ("", "Primera Division", "Matchday 09", "Real Betis - Barcelona", "720p 50fps")),
])
def test_formate_rgfootball(title, expected):
    p = sport.parse_title(title)
    assert (p["country"], p["competition"], p["round"], p["match"], p["quality"]) == expected
