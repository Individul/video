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
    monkeypatch.setattr(iptv, "_PROBE_FILE", tmp_path / "iptv_probe.json")
    monkeypatch.setattr(iptv, "_probe", None)
    monkeypatch.setattr(iptv, "start_prober", lambda: None)
    from app.sources import epg

    monkeypatch.setattr(epg, "refresh", lambda force=False: None)
    monkeypatch.setattr(epg, "ensure_fresh", lambda: None)
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


def test_compat_mode_transcodes_only_video(tmp_path):
    cmd = iptv.relay_cmd("http://srv/1.m3u8", tmp_path, compat=True)
    assert cmd[cmd.index("-c:v") + 1] == "libx264" and "yadif=0" in cmd and cmd[cmd.index("-preset") + 1] == "ultrafast"
    assert iptv.relay_cmd("http://srv/1.m3u8", tmp_path)[iptv.relay_cmd("http://srv/1.m3u8", tmp_path).index("-c:v") + 1] == "copy"


def test_compat_refuses_hd_and_m3u_for_vlc(store, monkeypatch):
    iptv.set_playlist("http://srv.example/pl.m3u")
    cid = iptv.overview()["channels"][0]["id"]
    monkeypatch.setattr(iptv, "probe_height", lambda url: 1080)
    with pytest.raises(SourceError, match="^hd:1080$"):
        iptv.start(cid, compat=True)
    name, body = iptv.m3u_for(cid)
    assert name == "Первый канал HD.m3u" and body.splitlines()[-1].endswith("/101.m3u8")


def test_ids_stay_when_provider_rotates_tokens():
    a = iptv.parse_m3u(M3U)["channels"]
    b = iptv.parse_m3u(M3U.replace("/user/pass/", "/user/NEWTOKEN/"))["channels"]
    assert [c["id"] for c in a] == [c["id"] for c in b]
    dup = iptv.parse_m3u("#EXTM3U\n#EXTINF:-1,X\nhttp://a/1.m3u8\n#EXTINF:-1,X\nhttp://a/2.m3u8\n")["channels"]
    assert dup[0]["id"] != dup[1]["id"]


def test_verdicts_hide_what_the_browser_cannot_play(store):
    iptv.set_playlist("http://srv.example/pl.m3u")
    first, match, kino = [c["id"] for c in iptv.overview()["channels"]]
    st = iptv._probe_store()["channels"]
    st[first] = {"codec": "h264", "h": 1080, "interlaced": False}
    st[match] = {"codec": "h264", "h": 1080, "interlaced": True}
    st[kino] = {"codec": "h264", "h": 576, "interlaced": True}  # SD: serverul îl convertește
    assert [c["state"] for c in iptv.overview()["channels"]] == ["ok", "bad", "ok"]
    st[kino] = {"offline": 2}
    assert iptv.verdict(kino) == "bad"
    assert iptv.verdict("0" * 12) == "unknown"
    st["a" * 12] = {"codec": "mpeg2video", "h": 1080, "interlaced": True}
    st["b" * 12] = {"codec": "mpeg2video", "h": 576, "interlaced": True}  # SD: convertit pe server
    assert iptv.verdict("a" * 12) == "bad" and iptv.verdict("b" * 12) == "ok"
    # accelerarea grafică pornită: un 1080i merge -> toate 1080i devin „ok”
    other = "f" * 12
    st[other] = {"codec": "h264", "h": 1080, "interlaced": True}
    iptv.report(match, True)
    assert iptv.verdict(match) == "ok" and iptv.verdict(other) == "ok"
    iptv.report(first, False)
    assert iptv.verdict(first) == "bad"
    with pytest.raises(SourceError):
        iptv.report("../x", True)
    assert iptv._PROBE_FILE.exists()


def test_probe_reads_interlacing(monkeypatch):
    class Out:
        stdout = '{"streams":[{"codec_name":"h264","height":1080}],"frames":[{"interlaced_frame":1},{"interlaced_frame":1},{"interlaced_frame":0}]}'

    monkeypatch.setattr(iptv.subprocess, "run", lambda *a, **k: Out())
    assert iptv.probe_channel("http://x") == {"codec": "h264", "h": 1080, "interlaced": True}
    Out.stdout = "{}"
    with pytest.raises(SourceError):
        iptv.probe_channel("http://x")


def test_archive_url_and_window(store, monkeypatch):
    assert iptv.archive_url("http://h/lb0/UAPerviy_HD/mpegts?token=abc", 1760000000) ==         "http://h/lb0/UAPerviy_HD/timeshift_abs-1760000000.m3u8?token=abc"
    iptv.set_playlist("http://srv.example/pl.m3u")
    chans = iptv.overview()["channels"]
    first, match = chans[0]["id"], chans[1]["id"]  # primul are arhivă 5 zile, al doilea nu
    started = []
    monkeypatch.setattr(iptv.subprocess, "Popen", lambda cmd, **kw: started.append(cmd) or type("P", (), {"poll": lambda self: None, "kill": lambda self: None})())
    monkeypatch.setattr(iptv, "_watchdog", lambda proc: None)
    import time as _t

    iptv.start(first, at=int(_t.time()) - 3600)
    assert "timeshift_abs-" in started[-1][started[-1].index("-i") + 1]
    with pytest.raises(SourceError, match="arhiva"):
        iptv.start(first, at=int(_t.time()) - 9 * 86400)  # mai vechi de 5 zile
    with pytest.raises(SourceError, match="arhiva"):
        iptv.start(match, at=int(_t.time()) - 3600)  # canal fără arhivă
    iptv.stop_all()
