import pytest

from app.config import Config
from app.sources import sport

# secțiuni reale RGFootball: „VIP-Light …” și „⚽️VIP …” dau 404 cu contul din Jackett
CAPS = """<?xml version="1.0" encoding="UTF-8"?><caps><categories>
<category id="5000" name="TV"/>
<category id="100100" name=" |- Serie A 2024-25"/>
<category id="100300" name=" |- VIP-Light Italy"/>
<category id="100223" name=" |- ⚽️VIP Germany"/>
<category id="100003" name=" |- Англия/England"/>
<category id="100394" name=" |- Бразилия/Brazil"/>
</categories></caps>""".encode()


def item(title, path, size, date, seeds, cat):
    return f"""<item><title>{title}</title><link>http://jackett:9117/dl/rgfootball/?path={path}</link>
<size>{size}</size><pubDate>{date}</pubDate><torznab:attr name="seeders" value="{seeds}"/>
<torznab:attr name="category" value="5000"/><torznab:attr name="category" value="{cat}"/></item>"""


FEED = ("""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>"""
        + item("Italy » Serie A 2026-27 » 07. Round » Bologna FC vs Inter [17.10.2026, 720p, 50 fps]", 1, 3276009805,
               "Sat, 17 Oct 2026 22:00:00 +0300", 16, 100100)
        + item("Italy » Serie A 2026-27 » 07. Round » Bologna FC vs Inter [17.10.2026, 1080i, H.264]", 2, 9223372036,
               "Sat, 17 Oct 2026 23:00:00 +0300", 4, 100300)
        + item("⚽️Germany » Bundesliga 2026-27 / 06. Round / ALL MATCHES Part 1+2 / S.S.BL HD [20.10.2026, 1080p, 50 fps]", 3,
               20000000000, "Tue, 20 Oct 2026 10:00:00 +0300", 5, 100223)
        + item("England » Premier League 2026-27 » 07. Round » Match of the Day » Saturday [17.10.2026, 1080i, H.264]", 4,
               6000000000, "Sun, 18 Oct 2026 09:00:00 +0300", 3, 100003)
        + item("Brasileirao Seria A 2026 » Matchday 31 » Athletico Paranaense - Palmeiras [18.10.2026, 720p 50 fps, MKV]", 5,
               2000000000, "Sun, 18 Oct 2026 10:00:00 +0300", 1, 100394)
        + "</channel></rss>").encode()


class Resp:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


@pytest.fixture(autouse=True)
def jackett(monkeypatch):
    import requests

    monkeypatch.setattr(Config, "TORZNAB_URL", "http://jackett:9117")
    monkeypatch.setattr(Config, "TORZNAB_API_KEY", "k")
    monkeypatch.setattr(requests, "get", lambda url, *a, **k: Resp(CAPS if "t=caps" in url else FEED))
    monkeypatch.setattr(sport, "_cache", {})
    monkeypatch.setattr(sport, "_sections_cache", None)


def test_parse_titluri_reale():
    p = sport.parse_title("Italy » Serie A 2026-27 » 07. Round » Bologna FC vs Inter [17.10.2026, 720p, 50 fps]")
    assert p == {"competition": "Serie A", "country": "Italy", "round": "07. Round",
                 "match": "Bologna FC vs Inter", "date": "2026-10-17", "quality": "720p 50fps"}
    b = sport.parse_title("Brasileirao Seria A 2026 » Matchday 31 » Athletico Paranaense - Palmeiras [18.10.2026, 720p 50 fps, MKV]")
    assert (b["competition"], b["round"], b["quality"]) == ("Brasileirao Seria A", "Matchday 31", "720p 50fps")
    u = sport.parse_title('"UFC Fight Night 291": Buckley vs. Malott [Main card] / MTV HD [17.10.2026, 720p, 50 fps]')
    assert u["competition"] == "UFC Fight Night" and u["match"].startswith("Buckley vs. Malott")


def test_vip_ascuns_hd_normal_pastrat():
    m = {x["match"]: x for x in sport.feed()}
    # VIP-Light (1080i Bologna) și ⚽️VIP (ALL MATCHES) dau 404 -> nu apar
    assert [v["quality"] for v in m["Bologna FC vs Inter"]["variants"]] == ["720p 50fps"]
    assert not any("ALL MATCHES" in k for k in m)
    # HD din secțiuni normale (Англия/England) rămâne — se descarcă fără VIP
    assert [v["quality"] for v in m["Match of the Day » Saturday"]["variants"]] == ["1080i"]
    bol = m["Bologna FC vs Inter"]["variants"][0]
    assert bol["torrent_url"].endswith("path=1") and bol["seeds"] == 16 and bol["size"].endswith("GB")


def test_fara_caps_nu_ascunde_nimic(monkeypatch):
    """Dacă lista secțiunilor nu se poate citi, nu ghicim: arătăm tot."""
    import requests

    def get(url, *a, **k):
        if "t=caps" in url:
            raise requests.ConnectionError("caps indisponibil")
        return Resp(FEED)

    monkeypatch.setattr(requests, "get", get)
    assert any("ALL MATCHES" in x["match"] for x in sport.feed())


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


def test_cautare_trimite_q_la_jackett_si_cache_separat(monkeypatch):
    import requests

    urls = []

    def get(url, *a, **k):
        urls.append(url)
        return Resp(CAPS if "t=caps" in url else FEED)

    monkeypatch.setattr(requests, "get", get)
    sport.feed()
    sport.feed(q="  Bologna   Inter ")
    sport.feed(q="bologna inter")  # aceeași căutare (spații/majuscule) -> din cache
    search = [u for u in urls if "t=search" in u]
    assert len(search) == 2
    assert "q=" not in search[0] and "q=Bologna+Inter" in search[1]


def test_champions_league_faza_tine_de_etapa():
    p = sport.parse_title("UEFA Champions League 2026–27 » League Phase » Matchday 2 » AS Roma vs Real Madrid "
                          "[14.10.2026, 720p, 50 fps, H.264, RUS/STD, HDTVRip]")
    assert (p["competition"], p["country"], p["round"], p["match"]) == (
        "UEFA Champions League", "", "League Phase · Matchday 2", "AS Roma vs Real Madrid")


def test_group_stage_lipit_de_etapa():
    p = sport.parse_title("UEFA Europa League 2026-27 » Group Stage » Matchday 1 » Lazio vs Ajax [01.10.2026, 720p]")
    assert (p["competition"], p["round"], p["match"]) == ("UEFA Europa League", "Group Stage · Matchday 1", "Lazio vs Ajax")
