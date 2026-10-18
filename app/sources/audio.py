"""Alegerea pistei audio (dublaje) pentru fișierele din TorrServer.

Browserul redă doar prima pistă audio dintr-un MKV și nu știe AC3/DTS/TrueHD. Pentru altă
pistă, ffmpeg copiază video-ul (fără re-codare) și convertește doar pista aleasă în AAC
stereo, într-un MP4 fragmentat cu timpii originali (-copyts). Player-ul îl pune prin MSE
exact la pozițiile reale, deci progresul, istoricul și subtitrările rămân aliniate.
"""

import json
import shutil
import subprocess
import threading

from app.config import Config
from app.sources.base import SourceError
from app.sources.subtitles import _ffmpeg_auth_args, _torrserver_url

# codecuri audio pe care Chrome/Edge le redau direct din fișier
NATIVE_AUDIO = {"aac", "mp3", "opus", "vorbis", "flac"}

_AVC_PROFILES = {
    "Baseline": 66, "Constrained Baseline": 66, "Main": 77, "Extended": 88,
    "High": 100, "High 10": 110, "High 4:2:2": 122, "High 4:4:4 Predictive": 244,
}

_lock = threading.Lock()
_current: dict = {"proc": None}  # un singur utilizator: o singură conversie odată


def _ffprobe() -> str:
    ff = Config.FFMPEG_PATH or "ffmpeg"
    guess = ff[: -len("ffmpeg")] + "ffprobe" if ff.endswith("ffmpeg") else "ffprobe"
    return shutil.which(guess) or guess


def avc_codec_string(stream: dict) -> str | None:
    """Șirul de codec MSE pentru H.264 (ex. avc1.640028); None pentru profile nesuportate."""
    profile = stream.get("profile") or "High"
    pid = _AVC_PROFILES.get(profile)
    if pid is None or pid > 100:  # High 10 / 4:2:2 / 4:4:4 — browserul nu le decodează
        return None
    constraint = 0x40 if profile == "Constrained Baseline" else 0
    level = int(stream.get("level") or 40)
    return f"avc1.{pid:02x}{constraint:02x}{level:02x}"


def parse_probe(data: dict) -> dict:
    streams = data.get("streams") or []
    video = next(
        (s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")),
        None,
    )
    tracks = []
    for i, s in enumerate(x for x in streams if x.get("codec_type") == "audio"):
        tags = s.get("tags") or {}
        tracks.append({
            "index": i,
            "codec": s.get("codec_name") or "",
            "lang": (tags.get("language") or "").lower(),
            "title": tags.get("title") or "",
            "channels": s.get("channels") or 0,
            "default": bool((s.get("disposition") or {}).get("default")),
            "native": (s.get("codec_name") or "") in NATIVE_AUDIO,
        })
    avc = avc_codec_string(video) if video and video.get("codec_name") == "h264" else None
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {
        "video": video.get("codec_name") if video else None,
        # MSE are nevoie de H.264; la HEVC & co. alegerea pistei nu e disponibilă
        "mse_codecs": f"{avc}, mp4a.40.2" if avc else None,
        "duration": duration,
        "tracks": tracks,
    }


def probe(url: str) -> dict:
    src = _torrserver_url(url)
    try:
        out = subprocess.run(
            [_ffprobe(), "-v", "error", *_ffmpeg_auth_args(), "-show_streams", "-show_format", "-of", "json", src],
            capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise SourceError("Nu am putut citi pistele audio") from e
    try:
        return parse_probe(json.loads(out.stdout or "{}"))
    except ValueError as e:
        raise SourceError("Nu am putut citi pistele audio") from e


def ffmpeg_cmd(src: str, track: int, start: float) -> list[str]:
    return [
        Config.FFMPEG_PATH or "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        *_ffmpeg_auth_args(),
        "-ss", f"{start:.3f}", "-i", src,
        "-copyts",  # timpii originali: player-ul pune datele exact la poziția din film
        "-map", "0:v:0", "-map", f"0:a:{track}",
        "-c:v", "copy",
        "-c:a", "aac", "-ac", "2", "-b:a", "192k",
        "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
    ]


def _stop_current() -> None:
    proc = _current.get("proc")
    if proc and proc.poll() is None:
        proc.kill()
    _current["proc"] = None


def stream(url: str, track: int, start: float):
    """Generator cu MP4-ul fragmentat; oprește conversia anterioară (alt seek / altă pistă)."""
    if not 0 <= track < 32 or not 0 <= start < 86400:
        raise SourceError("Parametri invalizi")
    src = _torrserver_url(url)
    with _lock:
        _stop_current()
        try:
            proc = subprocess.Popen(
                ffmpeg_cmd(src, track, start),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
        except OSError as e:
            raise SourceError("ffmpeg indisponibil") from e
        _current["proc"] = proc

    def gen():
        try:
            while True:
                chunk = proc.stdout.read(64 * 1024)  # type: ignore[union-attr]
                if not chunk:
                    break
                yield chunk
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()  # type: ignore[union-attr]
            with _lock:
                if _current.get("proc") is proc:
                    _current["proc"] = None

    return gen()


def stop() -> None:
    with _lock:
        _stop_current()
