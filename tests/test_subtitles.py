from app.sources.subtitles import (
    ass_to_vtt,
    is_ru_subtitle,
    is_subtitle_file,
    srt_to_vtt,
    to_vtt,
)
from app.sources.torrents import dedupe_results


def test_is_subtitle_file():
    assert is_subtitle_file("Film.ru.srt")
    assert is_subtitle_file("pack/subs.ass")
    assert not is_subtitle_file("Film.1080p.mkv")
    assert not is_subtitle_file(None)


def test_is_ru_subtitle():
    assert is_ru_subtitle("Movie.2024.rus.srt")
    assert is_ru_subtitle("Movie_русские субтитры.ass")
    assert not is_ru_subtitle("Movie.en.srt")


def test_srt_to_vtt():
    srt = "\ufeff1\r\n00:00:01,000 --> 00:00:03,500\r\nПривет\r\n\r\n2\r\n00:00:04,250 --> 00:00:06,000\r\nМир\r\n"
    vtt = srt_to_vtt(srt)
    assert vtt.startswith("WEBVTT")
    assert "00:00:01.000 --> 00:00:03.500" in vtt
    assert "Привет" in vtt


def test_ass_to_vtt():
    ass = """[Script Info]
Title: test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.18,0:00:03.64,Default,,0,0,0,,{\\i1}Привет{\\i0}\\Nвторая linie
Dialogue: 0,0:01:02.03,0:01:04.50,Default,,0,0,0,,Просто текст
"""
    vtt = ass_to_vtt(ass)
    assert vtt.startswith("WEBVTT")
    assert "0:00:01.180 --> 0:00:03.640" in vtt
    assert "0:01:02.030 --> 0:01:04.500" in vtt
    assert "{\\i1}" not in vtt
    assert "Привет" in vtt and "вторая linie" in vtt


def test_to_vtt_zip_cu_ru_preferat():
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie-en.srt", "1\n00:00:01,000 --> 00:00:02,000\nhello\n")
        z.writestr("movie-ru.srt", "1\n00:00:01,000 --> 00:00:02,000\nпривет\n")
    vtt = to_vtt(buf.getvalue(), "subs.zip")
    assert "привет" in vtt
    assert "hello" not in vtt


def test_to_vtt_cp1251_fallback():
    raw = "1\n00:00:01,000 --> 00:00:02,000\nпривет\n".encode("cp1251")
    vtt = to_vtt(raw, "movie.srt")
    assert "привет" in vtt


def test_dedupe_results_pe_infohash():
    a = {"name": "Release A", "magnet": "magnet:?xt=urn:btih:" + "a" * 40}
    b = {"name": "Release A (alt nume, alt tracker)", "magnet": "magnet:?xt=urn:btih:" + "a" * 40}
    c = {"name": "Release C", "magnet": "magnet:?xt=urn:btih:" + "b" * 40}
    out = dedupe_results([a, b, c])
    assert len(out) == 2
    assert out[0]["name"] == "Release A"


def test_dedupe_fara_magnet_cade_pe_nume():
    a = {"name": "X", "torrent_url": "http://t/1.torrent"}
    b = {"name": "X", "torrent_url": "http://t/1.torrent"}
    assert len(dedupe_results([a, b])) == 1


def test_extract_mkv_cache_hit_fara_ffmpeg(monkeypatch, tmp_path):
    from app.sources import subtitles as mod

    # fără ffmpeg configurat, dar cu cache pe disc → job-ul raportează done instant
    monkeypatch.setattr(mod.Config, "FFMPEG_PATH", None)
    monkeypatch.setattr(mod.Config, "TORRSERVER_URL", "http://127.0.0.1:8090")  # independent de .env
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    url = "http://127.0.0.1:8090/stream/x.mkv?link=abc"
    mod._mux_cache_path(url).write_text(
        "WEBVTT\n\n00:01.000 --> 00:02.000\nтест\n", encoding="utf-8"
    )
    st = mod.mux_job_state(url)
    assert st == {"status": "done", "pct": 100}
    assert "тест" in mod.mux_job_result(url)


def test_extract_mkv_fara_ffmpeg_fara_cache(monkeypatch, tmp_path):
    from app.sources import subtitles as mod

    monkeypatch.setattr(mod.Config, "FFMPEG_PATH", None)
    monkeypatch.setattr(mod.Config, "TORRSERVER_URL", "http://127.0.0.1:8090")  # independent de .env
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    st = mod.mux_job_state("http://127.0.0.1:8090/stream/y.mkv?link=zzz")
    assert st["status"] == "error"
    assert mod.mux_job_result("http://127.0.0.1:8090/stream/y.mkv?link=zzz") is None


def test_extract_mkv_refuza_url_strain(monkeypatch, tmp_path):
    import pytest as _pytest

    from app.sources import subtitles as mod
    from app.sources.base import SourceError

    monkeypatch.setattr(mod, "ROOT", tmp_path)
    with _pytest.raises(SourceError):
        mod.mux_job_state("http://evil.com/stream/z.mkv?link=1")


def test_parse_duration_seconds():
    from app.sources import subtitles as mod

    # funcțiile de probing ffprobe au fost eliminate; verificăm doar că modulul e curat
    assert not hasattr(mod, "probe_duration_seconds")
    assert not hasattr(mod, "progress_pct")
