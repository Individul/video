import pytest

from app.sources import iptv
from app.sources.base import SourceError

M3U = """﻿#EXTM3U url-tvg="http://epg.example/epg.xml.gz"
#EXTINF:-1 tvg-id="perviy" tvg-logo="http://logo/1.png" group-title="Общие" catchup="shift" catchup-days="5",Первый канал HD
http://srv.example/live/user/pass/101.m3u8
#EXTINF:-1 tvg-name="Матч ТВ",Матч! ТВ
#EXTGRP:Спорт
http://srv.example/live/user/pass/202.ts
#EXTINF:-1,Fără URL valid
not-a-url
#EXTINF:-1 group-title="Кино",Кино ТВ
https://srv.example/live/user/pass/303.m3u8
"""


class Resp:
    def __init__(self, text="", status=200):
        self.content, self.status_code = text.encode(), status


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setattr(iptv, "_FILE", tmp_path / "iptv.json")
    iptv._cache.clear()
    import requests

    calls = []
    monkeypatch.setattr(requests, "get", lambda url, **kw: calls.append(url) or Resp(M3U))
    return calls


def test_parse_m3u_channels_groups_and_epg():
    d = iptv.parse_m3u(M3U)
    assert d["epg"] == "http://epg.example/epg.xml.gz"
    assert [c["name"] for c in d["channels"]] == ["Первый канал HD", "Матч! ТВ", "Кино ТВ"]
    first, match, kino = d["channels"]
    assert first["group"] == "Общие" and first["logo"] == "http://logo/1.png" and first["catchup_days"] == 5
    assert match["group"] == "Спорт" and match["url"].endswith("202.ts")
    assert kino["group"] == "Кино" and len(first["id"]) == 12 and first["id"] != kino["id"]


def test_playlist_saved_server_side_and_never_sent_to_browser(store):
    assert iptv.overview() == {"configured": False}
    with pytest.raises(SourceError):
        iptv.set_playlist("ftp://x")
    assert iptv.set_playlist("http://srv.example/get.php?username=u&password=SECRET&type=m3u") == {"count": 3}
    o = iptv.overview()
    assert o["configured"] and o["source"] == "srv.example/…"
    assert "SECRET" not in str(o) and "url" not in o["channels"][0]
    assert [g["name"] for g in o["groups"]] == ["Общие", "Спорт", "Кино"]
    assert len(store) == 1  # din cache


def test_bad_playlists_are_refused(store, monkeypatch):
    import requests

    monkeypatch.setattr(requests, "get", lambda url, **kw: Resp("<html>login</html>"))
    with pytest.raises(SourceError, match="M3U"):
        iptv.set_playlist("https://srv.example/x")
    monkeypatch.setattr(requests, "get", lambda url, **kw: Resp("", 403))
    with pytest.raises(SourceError, match="refuzat"):
        iptv.set_playlist("https://srv.example/x")
    assert iptv.overview() == {"configured": False}


def test_favorites_toggle(store):
    iptv.set_playlist("http://srv.example/pl.m3u")
    cid = iptv.overview()["channels"][1]["id"]
    assert iptv.toggle_favorite(cid) == [cid]
    assert iptv.overview()["favorites"] == [cid]
    assert iptv.toggle_favorite(cid) == []
    with pytest.raises(SourceError):
        iptv.toggle_favorite("../etc")


def test_relay_cmd_and_files(tmp_path):
    cmd = iptv.relay_cmd("http://srv/1.ts", tmp_path)
    assert "-reconnect" in cmd and cmd[cmd.index("-c:v") + 1] == "copy" and cmd[cmd.index("-c:a") + 1] == "aac"
    assert cmd.index("-readrate") < cmd.index("-i")  # opțiune de intrare
    assert "-reconnect" not in iptv.relay_cmd("udp://239.0.0.1:1234", tmp_path)
    assert iptv.relay_file("0123456789abcdef", "../x") is None
    assert iptv.relay_file("nope", "index.m3u8") is None
    assert iptv.relay_file("0123456789abcdef", "ffmpeg.log") is None  # jurnalul nu se servește


def test_status_explains_provider_refusal(tmp_path, monkeypatch):
    class Done:
        def poll(self):
            return 1

    (tmp_path / "ffmpeg.log").write_text("[http] HTTP error 403 Forbidden\n")
    monkeypatch.setattr(iptv, "_relay", {"sess": "0123456789abcdef", "proc": Done(), "dir": tmp_path, "seen": 0})
    st = iptv.status("0123456789abcdef")
    assert st["running"] is False and "refuzat" in st["error"]
    assert iptv.status("fedcba9876543210")["running"] is False
    with pytest.raises(SourceError):
        iptv.status("x")
