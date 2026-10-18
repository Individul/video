from app.sources import audio


def _probe(**video):
    return {
        "streams": [
            {"codec_type": "video", "codec_name": "h264", "profile": "High", "level": 41, **video},
            {"codec_type": "audio", "codec_name": "ac3", "channels": 6,
             "tags": {"language": "rus", "title": "Дубляж"}, "disposition": {"default": 1}},
            {"codec_type": "audio", "codec_name": "aac", "channels": 2, "tags": {"language": "eng"}},
            {"codec_type": "subtitle", "codec_name": "subrip"},
        ],
        "format": {"duration": "7265.120000"},
    }


def test_parse_probe_tracks_and_codecs():
    info = audio.parse_probe(_probe())
    assert info["mse_codecs"] == "avc1.640029, mp4a.40.2"
    assert info["duration"] == 7265.12
    assert [t["lang"] for t in info["tracks"]] == ["rus", "eng"]
    assert info["tracks"][0] == {
        "index": 0, "codec": "ac3", "lang": "rus", "title": "Дубляж",
        "channels": 6, "default": True, "native": False,
    }
    assert info["tracks"][1]["native"] is True


def test_no_switching_for_hevc_or_10bit():
    assert audio.parse_probe(_probe(codec_name="hevc"))["mse_codecs"] is None
    assert audio.parse_probe(_probe(profile="High 10"))["mse_codecs"] is None


def test_avc_codec_strings():
    assert audio.avc_codec_string({"profile": "Main", "level": 31}) == "avc1.4d001f"
    assert audio.avc_codec_string({"profile": "Constrained Baseline", "level": 30}) == "avc1.42401e"


def test_ffmpeg_cmd_keeps_original_timestamps():
    cmd = audio.ffmpeg_cmd("http://torrserver:8090/stream/x?link=h&index=1&play", 2, 125.5)
    assert cmd[cmd.index("-ss") + 1] == "125.500"
    assert cmd.index("-ss") < cmd.index("-i")  # căutare rapidă, înainte de intrare
    assert "-copyts" in cmd
    assert "0:a:2" in cmd and cmd[cmd.index("-c:v") + 1] == "copy"


def test_stream_rejects_foreign_urls():
    import pytest

    from app.sources.base import SourceError

    with pytest.raises(SourceError):
        audio.stream("http://evil.example/x.mkv", 0, 0)
    with pytest.raises(SourceError):
        audio.stream("file:///etc/passwd", 0, 0)
