import pytest

from app.sources import live
from app.sources.base import SourceError

H = "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c"
S = "0123456789abcdef0123456789abcdef"


@pytest.mark.parametrize(
    "text,expected",
    [
        (f"acestream://{H}", ("id", H)),
        (f"  {H.upper()}  ", ("id", H)),
        (f"ih:{H}", ("infohash", H)),
        (f"magnet:?xt=urn:btih:{H}&dn=x", ("infohash", H)),
    ],
)
def test_parse_ref_ok(text, expected):
    assert live.parse_ref(text) == expected


@pytest.mark.parametrize("text", ["", "acestream://abc", "http://exemplu.ro/x", f"{H}00"])
def test_parse_ref_invalid(text):
    with pytest.raises(SourceError):
        live.parse_ref(text)


def test_manifest_rewrites_internal_urls(monkeypatch):
    class R:
        status_code = 200
        text = f"#EXTM3U\n#EXTINF:5,\nhttp://acestream:6878/ace/c/{S}/1.ts\n"

    import requests

    monkeypatch.setattr(requests, "get", lambda url, timeout: R())
    out = live.manifest(H, S)
    assert f"\n/ace/c/{S}/1.ts" in out
    assert "acestream:6878" not in out


def test_session_ids_are_validated():
    with pytest.raises(SourceError):
        live.manifest("../../etc", S)


def test_channels_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(live, "_CHANNELS_FILE", tmp_path / "ch.json")
    assert live.channels() == []
    live.save_channel("Test", f"acestream://{H}")
    items = live.save_channel("Redenumit", H)  # același hash: înlocuit, nu dublat
    assert items == [{"name": "Redenumit", "kind": "id", "hash": H}]
    assert live.delete_channel(H) == []


def test_start_accepts_live_playlist(monkeypatch):
    url = f"http://acestream:6878/ace/m/{H}/{S}.m3u8"
    monkeypatch.setattr(live, "_get_json", lambda u, timeout=60: {"response": {"playback_url": url, "is_live": 1}})
    out = live.start("id", H)
    assert out["playlist"] == f"/api/live/m/{H}/{S}.m3u8?t=m" and out["is_live"]


def test_manifest_rejects_unknown_mode():
    with pytest.raises(SourceError):
        live.manifest(H, S, "x")


def test_audio_gaps_detection():
    frame = 1024 / 48000
    clean = [100 + i * frame for i in range(230)]
    assert not live.audio_gaps(clean)
    assert not live.audio_gaps(clean, prev_last=100 - frame)
    holed = clean[:50] + [t + 1.0 for t in clean[50:]]  # ~1 s lipsă, ca în segmentul 411
    assert live.audio_gaps(holed) == 1.02
    assert live.audio_gaps(clean, prev_last=99.5) == 0.5  # gaură între segmente
    assert not live.audio_gaps([])


def test_segments_with_gaps_reach_stat(monkeypatch):
    frame = 1024 / 48000
    good = [i * frame for i in range(235)]
    pts = {1: good, 2: [t + 5 for t in good], 3: [t + 10 for t in good[:40]] + [t + 11 for t in good[40:]]}
    monkeypatch.setattr(live, "_audio_pts", lambda data: pts[int(data)])

    class R:
        def __init__(self, n):
            self.content = str(n).encode()

    import requests

    monkeypatch.setattr(requests, "get", lambda url, timeout: R(url.rsplit("/", 1)[1].split(".")[0]))
    playlist = "".join(f"#EXTINF:5,\nhttp://acestream:6878/ace/c/{H}/{n}.ts\n" for n in (1, 2, 3, 4))
    live._audio.clear()
    live._schedule_audio_check(S, playlist)
    live._audio_pool.submit(lambda: None).result()  # așteaptă verificările din coadă
    assert live.audio_gap_segments(S) == [[3, 1.02]]
    live._schedule_audio_check(S, playlist)  # segmentele deja verificate nu se reiau
    live._audio_pool.submit(lambda: None).result()
    assert live.audio_gap_segments(S) == [[3, 1.02]]


def test_audio_pts_parses_ffprobe_csv(monkeypatch):
    class P:
        stdout = "10974.056000,\n10974.077333,\nN/A,\n"

    monkeypatch.setattr(live.subprocess, "run", lambda *a, **k: P())
    assert live._audio_pts(b"x") == [10974.056, 10974.077333]


def test_relay_cmd_copies_video_converts_audio(tmp_path):
    cmd = live.relay_cmd("http://acestream:6878/ace/m/x/y.m3u8", tmp_path)
    assert cmd[cmd.index("-live_start_index") + 1] == "0"  # păstrează rezerva acumulată
    assert cmd[cmd.index("-c:v") + 1] == "copy" and cmd[cmd.index("-c:a") + 1] == "aac"
    assert "aresample=async=1000" in cmd  # găurile din audio devin liniște
    assert cmd[-1] == str(tmp_path / "index.m3u8")


def test_relay_file_only_serves_own_session_and_safe_names(tmp_path, monkeypatch):
    (tmp_path / "index.m3u8").write_text("#EXTM3U\n")
    (tmp_path / "3.ts").write_bytes(b"x")
    monkeypatch.setattr(live, "_relay", {"sess": S, "dir": tmp_path, "seen": 0, "proc": None})
    assert live.relay_file(S, "index.m3u8") == tmp_path / "index.m3u8"
    assert live.relay_file(S, "3.ts") == tmp_path / "3.ts"
    assert live.relay_file(S, "4.ts") is None  # încă nescris
    assert live.relay_file(S, "../etc/passwd") is None
    assert live.relay_file("f" * 32, "index.m3u8") is None  # altă sesiune
    with pytest.raises(SourceError):
        live.relay_file("../x", "index.m3u8")


def test_prepare_decides_relay_by_audio_codec(monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import Config
    from app.main import app

    monkeypatch.setattr(Config, "APP_PASSWORD", None)
    monkeypatch.setattr(live, "start_relay", lambda ih, sess: f"/api/live/relay/{sess}/index.m3u8")
    with TestClient(app) as c:
        monkeypatch.setattr(live, "audio_codec", lambda ih, sess: "aac")
        assert c.post(f"/api/live/prepare/{H}/{S}").json() == {"relay": False, "audio": "aac"}
        monkeypatch.setattr(live, "audio_codec", lambda ih, sess: "mp2")
        r = c.post(f"/api/live/prepare/{H}/{S}").json()
        assert r == {"relay": True, "audio": "mp2", "playlist": f"/api/live/relay/{S}/index.m3u8"}
