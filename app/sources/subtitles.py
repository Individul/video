"""Subtitrări: conversie srt/ass -> WebVTT, extragere din arhiva torrentului
și (opțional) OpenSubtitles.com cu cheie OS_API_KEY în .env."""

import hashlib
import re
import zipfile
from io import BytesIO
from pathlib import Path

from app.config import ROOT, Config
from app.sources.base import SourceError
from app.sources.torrents import same_origin, ts_auth, ts_internal_url

SUBTITLE_RE = re.compile(r"\.(srt|ass|ssa|vtt)$", re.I)
_RU_NAME_RE = re.compile(r"\b(ru|rus|russian|russia|russe?|русск\w*|перевод)\b|руссуб|субтитры", re.I)

_OS_BASE = "https://api.opensubtitles.com/api/v1"


def is_subtitle_file(name: str | None) -> bool:
    return bool(name and SUBTITLE_RE.search(name))


def is_ru_subtitle(name: str | None) -> bool:
    return bool(name and is_subtitle_file(name) and _RU_NAME_RE.search(name))


# ----------------- conversii -----------------

def srt_to_vtt(text: str) -> str:
    """SRT -> WebVTT: virgulă -> punct în timestamp-uri + antet."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    text = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{1,3})", r"\1.\2", text)
    return "WEBVTT\n\n" + text.strip() + "\n"


_ASS_TS = re.compile(r"^(\d+):(\d{2}):(\d{2})[.](\d{2})")


def _ass_ts(value: str) -> str | None:
    m = _ASS_TS.match(value.strip())
    if not m:
        return None
    h, mnt, s, cs = int(m[1]), int(m[2]), int(m[3]), int(m[4]) * 10
    return f"{h}:{mnt:02d}:{s:02d}.{cs:03d}"


def ass_to_vtt(text: str) -> str:
    """SSA/ASS -> WebVTT (dialog simplu, fără stiluri)."""
    lines_out: list[str] = ["WEBVTT", ""]
    for line in text.replace("\r\n", "\n").split("\n"):
        if not line.startswith("Dialogue:"):
            continue
        parts = line.split(":", 1)[1].split(",", 9)
        if len(parts) < 10:
            continue
        start, end = _ass_ts(parts[1] or ""), _ass_ts(parts[2] or "")
        if not start or not end:
            continue
        body = parts[9]
        body = re.sub(r"\{[^}]*\}", "", body)          # tag-uri override {...}
        body = body.replace("\\N", "\n").replace("\\n", "\n").strip()
        if not body:
            continue
        lines_out += [f"{start} --> {end}", body, ""]
    return "\n".join(lines_out)


def to_vtt(raw: bytes, filename: str = "") -> str:
    """Convertește raw (srt/ass/vtt sau zip cu srt) în WebVTT; aruncă SourceError."""
    fname = (filename or "").lower()
    if fname.endswith(".zip") or raw[:2] == b"PK":
        with zipfile.ZipFile(BytesIO(raw)) as z:
            srt_names = [n for n in z.namelist() if n.lower().endswith(".srt")]
            if not srt_names:
                raise SourceError("Arhiva de subtitrări nu conține .srt")
            srt_names.sort(key=lambda n: (not _RU_NAME_RE.search(n), len(n)))
            raw = z.read(srt_names[0])
            fname = srt_names[0]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1251", errors="replace")  # subtitrările RU vechi sunt adesea cp1251
    if fname.endswith(".ass") or fname.endswith(".ssa") or text.lstrip().startswith("[Script Info"):
        return ass_to_vtt(text)
    if fname.endswith(".vtt") or text.lstrip().startswith("WEBVTT"):
        return text.lstrip("\ufeff").strip() + "\n"
    return srt_to_vtt(text)


# ----------------- subtitrare din arhiva torrentului (TorrServer) -----------------

def fetch_torrserver_subtitle(url: str) -> str:
    """Descarcă un fișier de subtitrare servit de TorrServer și îl convertește."""
    import requests
    url = _torrserver_url(url)

    r = requests.get(
        url, headers={"User-Agent": Config.USER_AGENT}, auth=ts_auth(), timeout=(5, 60)
    )
    r.raise_for_status()
    name = url.split("/")[-1].split("?")[0]
    return to_vtt(r.content, name)


# ----------------- subtitrări muxate în MKV (extrase cu ffmpeg, cu progres) -----------------

import shutil as _shutil
import subprocess as _subprocess
import tempfile as _tempfile
import threading as _threading

_MUX_JOBS: dict[str, dict] = {}
_JOBS_LOCK = _threading.Lock()
_MUX_MAX_SECONDS = 30 * 60  # plafon de siguranță per tentativă


def _mux_cache_path(url: str) -> Path:
    subs_dir = ROOT / "subs"
    subs_dir.mkdir(exist_ok=True)
    return subs_dir / ("mux-" + hashlib.sha1(url.encode()).hexdigest() + ".vtt")


def _torrserver_url(url: str) -> str:
    """URL-ul intern TorrServer pentru `url` (traduce căile proxy /ts/...); acceptă doar
    URL-uri de pe TorrServer-ul configurat (fără file://, alte hosturi etc.)."""
    url = ts_internal_url(url)
    if not same_origin(url, Config.TORRSERVER_URL):
        raise SourceError("URL de subtitrare nepermis (nu e de pe TorrServer)")
    return url


def _ffmpeg_auth_args() -> list[str]:
    """Antet Authorization pentru ffmpeg, când TorrServer are parolă."""
    import base64

    a = ts_auth()
    if not a:
        return []
    cred = base64.b64encode(f"{a[0]}:{a[1]}".encode()).decode()
    return ["-headers", f"Authorization: Basic {cred}\r\n"]


def _extract_track(url: str, map_spec: str, job: dict) -> str | None:
    tmp = _tempfile.NamedTemporaryFile(
        "r", encoding="utf-8", errors="replace", suffix=".vtt", delete=False
    )
    tmp_path = tmp.name
    tmp.close()
    try:
        proc = _subprocess.Popen(
            [
                Config.FFMPEG_PATH, "-hide_banner", "-loglevel", "error", "-y",
                *_ffmpeg_auth_args(),
                "-i", url, "-map", map_spec, "-f", "webvtt", tmp_path,
            ],
            stdin=_subprocess.DEVNULL,
            stdout=_subprocess.DEVNULL, stderr=_subprocess.PIPE,
            # fără fereastră CMD vizibilă pentru utilizator (pythonw nu are consolă)
            creationflags=getattr(_subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        return None
    import time as _time

    job["proc"] = proc  # cancel_mux_job îl poate opri din alt thread
    if job.get("cancelled"):  # anulat chiar înainte de pornire
        proc.kill()
    started = _time.monotonic()
    err_tail: list[str] = []
    try:
        for raw in proc.stderr:  # type: ignore[union-attr]
            if len(err_tail) > 4:
                err_tail.pop(0)
            err_tail.append(raw.decode(errors="replace").strip())
            if _time.monotonic() - started > _MUX_MAX_SECONDS:
                proc.kill()
                job["error"] = "extragerea a depășit 30 min — abandonată"
                return None
        proc.wait()
    finally:
        proc.stderr.close()  # type: ignore[union-attr]
        job["proc"] = None
    if job.get("cancelled"):
        return None
    if proc.returncode != 0:
        job["error"] = "ffmpeg: " + (err_tail[-1] if err_tail else f"cod {proc.returncode}")
        return None
    vtt = Path(tmp_path).read_text(encoding="utf-8", errors="replace")
    return vtt if "-->" in vtt else None


def _torrserver_progress(url: str) -> int | None:
    """Progres real: câte bytes din torrent a citit TorrServer (link=<infohash> din URL)."""
    import json as _json

    import requests
    from urllib.parse import parse_qs, urlparse

    infohash = (parse_qs(urlparse(url).query).get("link") or [None])[0]
    if not infohash:
        return None
    try:
        r = requests.post(
            f"{Config.TORRSERVER_URL}/torrents",
            json={"action": "list"},
            headers={"User-Agent": Config.USER_AGENT},
            auth=ts_auth(),
            timeout=5,
        )
        r.raise_for_status()
        for t in r.json():
            if str(t.get("hash", "")).lower() == infohash.lower():
                total = t.get("torrent_size") or 0
                read = t.get("bytes_read") or 0
                if total > 0 and read > 0:
                    return min(99, int(read * 100 / total))
    except Exception:  # noqa: BLE001 — progresul e best-effort
        pass
    return None


def _run_mux_extraction(url: str, job: dict) -> None:
    for map_spec in ("0:s:m:language:rus", "0:s:0"):
        if job.get("cancelled"):
            return
        vtt = _extract_track(url, map_spec, job)
        if vtt:
            _mux_cache_path(url).write_text(vtt, encoding="utf-8")
            job["state"] = "done"
            job["pct"] = 100
            return
    job["state"] = "error"
    if not job.get("error"):
        job["error"] = "niciun track de subtitrare găsit"


def mux_job_state(url: str, start: bool = True) -> dict:
    """Starea extragerii pentru URL; pornește jobul în fundal la prima cerere.
    Cu start=False doar raportează (cache/job existent), altfel {"status": "idle"} —
    pentru fișierele mari, unde extragerea pornește doar la cererea utilizatorului."""
    url = _torrserver_url(url)
    cache = _mux_cache_path(url)
    if cache.is_file() and cache.stat().st_size > 0:
        return {"status": "done", "pct": 100}
    if not Config.FFMPEG_PATH:
        return {"status": "error", "pct": 0, "error": "ffmpeg indisponibil"}
    key = hashlib.sha1(url.encode()).hexdigest()
    with _JOBS_LOCK:
        job = _MUX_JOBS.get(key)
        if job is None and not start:
            return {"status": "idle", "pct": 0, "error": None}
        if job is None:
            # o singură extragere odată: ffmpeg citește tot fișierul, iar două în paralel
            # (sau una rămasă de la versiunea abandonată) îi iau banda filmului care rulează
            for other_key in [k for k, j in _MUX_JOBS.items() if j["state"] == "running"]:
                _cancel_locked(other_key)
            job = {"state": "running", "pct": 0, "error": None, "proc": None, "cancelled": False}
            _MUX_JOBS[key] = job
            _threading.Thread(target=_run_mux_extraction, args=(url, job), daemon=True).start()
            return {"status": job["state"], "pct": job["pct"], "error": job["error"]}
        if job["state"] == "running":
            pct = _torrserver_progress(url)
            if pct is not None:
                job["pct"] = pct
        return {"status": job["state"], "pct": job["pct"], "error": job["error"]}


def _cancel_locked(key: str) -> bool:
    """Oprește jobul (apelat cu _JOBS_LOCK luat); îl scoate din listă ca să poată
    fi repornit mai târziu, dacă revii la acel fișier."""
    job = _MUX_JOBS.pop(key, None)
    if job is None or job["state"] != "running":
        return False
    job["cancelled"] = True
    job["state"] = "error"
    job["error"] = "anulat"
    proc = job.get("proc")
    if proc is not None and proc.poll() is None:
        proc.kill()
    return True


def cancel_mux_job(url: str) -> bool:
    """Anulează extragerea pentru URL (player închis / altă versiune). True dacă rula."""
    url = _torrserver_url(url)
    key = hashlib.sha1(url.encode()).hexdigest()
    with _JOBS_LOCK:
        return _cancel_locked(key)


def mux_job_result(url: str) -> str | None:
    """Conținutul VTT dacă extragerea e gata (cache pe disc), altfel None."""
    url = _torrserver_url(url)
    cache = _mux_cache_path(url)
    if cache.is_file() and cache.stat().st_size > 0:
        return cache.read_text(encoding="utf-8")
    return None


# ----------------- OpenSubtitles (opțional, cu cheie) -----------------

def _cache_path(query: str, season: int | None, episode: int | None) -> Path:
    key = f"{query}|{season}|{episode}".lower()
    subs_dir = ROOT / "subs"
    subs_dir.mkdir(exist_ok=True)
    return subs_dir / (hashlib.sha1(key.encode()).hexdigest() + ".vtt")


def _os_search_file_id(query: str, season: int | None, episode: int | None) -> int | None:
    import requests

    params: dict = {"query": query, "languages": "ru"}
    if season:
        params["season_number"] = season
    if episode:
        params["episode_number"] = episode
    r = requests.get(
        f"{_OS_BASE}/subtitles",
        params=params,
        headers={
            "Api-Key": Config.OS_API_KEY,
            "User-Agent": f"vid-local/{Config.USER_AGENT[:20]}",
        },
        timeout=20,
    )
    r.raise_for_status()
    for item in r.json().get("data", []):
        for f in item.get("attributes", {}).get("files", []):
            if f.get("file_id"):
                return f["file_id"]
    return None


def _os_download(file_id: int) -> bytes:
    import requests

    r = requests.post(
        f"{_OS_BASE}/download",
        json={"file_id": file_id},
        headers={
            "Api-Key": Config.OS_API_KEY,
            "User-Agent": f"vid-local/{Config.USER_AGENT[:20]}",
        },
        timeout=30,
    )
    r.raise_for_status()
    link = r.json().get("link")
    if not link:
        raise SourceError("OpenSubtitles: link de download lipsă")
    d = requests.get(link, timeout=30)
    d.raise_for_status()
    return d.content


def fetch_external_subtitle(query: str, season: int | None = None, episode: int | None = None) -> str | None:
    """Caută + descarcă subtitrare RU de pe OpenSubtitles; None dacă nu e configurat/găsit.
    Rezultatul se pǎstreazǎ pe disc (cheia API are limite zilnice)."""
    cache = _cache_path(query, season, episode)
    if cache.is_file() and cache.stat().st_size > 0:
        return cache.read_text(encoding="utf-8")
    if not Config.OS_API_KEY:
        return None
    try:
        file_id = _os_search_file_id(query, season, episode)
        if not file_id:
            return None
        vtt = to_vtt(_os_download(file_id))
    except Exception as e:  # noqa: BLE001 — subtitrările sunt best-effort
        raise SourceError(f"OpenSubtitles: {e}") from e
    if " --> " not in vtt:
        return None
    cache.write_text(vtt, encoding="utf-8")
    return vtt
