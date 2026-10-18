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
