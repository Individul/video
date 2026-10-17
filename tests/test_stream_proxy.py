import pytest

from app.config import Config
from app.sources import subtitles
from app.sources.base import SourceError
from app.sources.torrents import ts_internal_url, ts_stream_url

INTERN = "http://torrserver:8090"
STREAM = f"{INTERN}/stream/Film.mkv?link=abcdef&index=1&play"


@pytest.fixture
def proxy(monkeypatch):
    monkeypatch.setattr(Config, "TORRSERVER_URL", INTERN)
    monkeypatch.setattr(Config, "TORRSERVER_AUTH", "vid:parola-ts")
    monkeypatch.setattr(Config, "STREAM_PROXY_PATH", "/ts")


def test_stream_relativ_fara_parola(proxy):
    out = ts_stream_url(STREAM)
    assert out == "/ts/stream/Film.mkv?link=abcdef&index=1&play"
    assert "parola-ts" not in out  # parola TorrServer nu ajunge în browser


def test_drum_dus_intors(proxy):
    assert ts_internal_url(ts_stream_url(STREAM)) == STREAM


def test_url_fara_prefix_ramane_neschimbat(proxy):
    assert ts_internal_url("/tsx/stream/a") == "/tsx/stream/a"
    assert ts_internal_url(STREAM) == STREAM


def test_subtitrari_accepta_calea_proxy(proxy):
    assert subtitles._torrserver_url("/ts/stream/a.srt?link=abc") == f"{INTERN}/stream/a.srt?link=abc"


def test_subtitrari_resping_traversare_spre_alt_host(proxy):
    # /ts@evil.com/... nu începe cu "/ts/" -> rămâne neschimbat -> respins
    with pytest.raises(SourceError):
        subtitles._torrserver_url("/ts@evil.com/x")
    with pytest.raises(SourceError):
        subtitles._torrserver_url("file:///etc/passwd")


def test_local_fara_proxy_neschimbat(monkeypatch):
    monkeypatch.setattr(Config, "TORRSERVER_URL", "http://127.0.0.1:8090")
    monkeypatch.setattr(Config, "TORRSERVER_AUTH", None)
    monkeypatch.setattr(Config, "STREAM_PROXY_PATH", None)
    url = "http://127.0.0.1:8090/stream/a.mkv?link=x"
    assert ts_stream_url(url) == url
    assert ts_internal_url(url) == url
