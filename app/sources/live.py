"""Transmisii live prin Ace Stream (motorul rulează în containerul „acestream”).

Motorul dă un playlist HLS cu adrese absolute interne (http://acestream:6878/ace/c/...);
le rescriem în căi relative /ace/c/..., servite de Caddy doar după login. Canalele salvate
(ID-uri aduse de utilizator) stau într-un fișier JSON în directorul de date.
"""

import json
import re
import secrets
import threading

from app.config import ROOT, Config
from app.sources.base import SourceError

_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_CHANNELS_FILE = ROOT / "live_channels.json"
_lock = threading.Lock()


def engine_url() -> str:
    return (getattr(Config, "ACESTREAM_URL", None) or "http://acestream:6878").rstrip("/")


def parse_ref(text: str) -> tuple[str, str]:
    """„acestream://<id>”, „<id>” sau „ih:<infohash>” -> (tip, hash). tip: id | infohash."""
    t = (text or "").strip().lower()
    kind = "id"
    if t.startswith("acestream://"):
        t = t[len("acestream://"):]
    elif t.startswith(("ih:", "infohash:")):
        kind, t = "infohash", t.split(":", 1)[1]
    elif t.startswith("magnet:"):
        m = re.search(r"btih:([0-9a-f]{40})", t)
        kind, t = "infohash", (m.group(1) if m else "")
    t = t.strip().strip("/")
    if not _HEX40.match(t):
        raise SourceError("ID invalid: aștept 40 de caractere hex (acestream://…)")
    return kind, t


def _check(*parts: str) -> None:
    for p in parts:
        if not _HEX40.match(p or "") and not re.fullmatch(r"[0-9a-f]{32}", p or ""):
            raise SourceError("Sesiune invalidă")


def _get_json(url: str, timeout: float = 60) -> dict:
    import requests

    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def start(kind: str, ref: str) -> dict:
    """Pornește redarea în motor; întoarce căile publice (playlist, stare)."""
    pid = secrets.token_hex(8)
    data = _get_json(f"{engine_url()}/ace/manifest.m3u8?format=json&{kind}={ref}&pid={pid}")
    if data.get("error"):
        raise SourceError(f"Ace Stream: {data['error']}")
    resp = data.get("response") or {}
    # /ace/r/... = fișier (VOD), /ace/m/... = transmisie live
    m = re.search(r"/ace/([rm])/([0-9a-f]{40})/([0-9a-f]{32})\.m3u8", resp.get("playback_url") or "")
    if not m:
        raise SourceError("Ace Stream nu a întors un flux")
    mode, ih, sess = m.groups()
    return {
        "infohash": ih,
        "session": sess,
        "playlist": f"/api/live/m/{ih}/{sess}.m3u8?t={mode}",
        "is_live": bool(resp.get("is_live")),
    }


def manifest(ih: str, sess: str, mode: str = "r") -> str:
    """Playlist-ul HLS cu adresele segmentelor rescrise spre /ace/c/... (prin Caddy)."""
    import requests

    _check(ih, sess)
    if mode not in ("r", "m"):
        raise SourceError("Sesiune invalidă")
    r = requests.get(f"{engine_url()}/ace/{mode}/{ih}/{sess}.m3u8", timeout=30)
    if r.status_code != 200:
        raise SourceError(f"Fluxul nu e gata ({r.status_code})")
    return re.sub(r"https?://[^/\s]+/ace/", "/ace/", r.text)


def stat(ih: str, sess: str) -> dict:
    _check(ih, sess)
    d = (_get_json(f"{engine_url()}/ace/stat/{ih}/{sess}", timeout=15).get("response")) or {}
    return {
        "status": d.get("status"),  # prebuf / dl / check / ...
        "progress": d.get("progress") or d.get("total_progress"),
        "peers": d.get("peers") or 0,
        "down_bps": int((d.get("speed_down") or 0) * 8 * 1024),  # motorul raportează KB/s
        "up_bps": int((d.get("speed_up") or 0) * 8 * 1024),
        "is_live": bool(d.get("is_live")),
    }


def stop(ih: str, sess: str) -> None:
    _check(ih, sess)
    try:
        _get_json(f"{engine_url()}/ace/cmd/{ih}/{sess}?method=stop", timeout=15)
    except Exception:  # noqa: BLE001 — sesiunea poate fi deja închisă
        pass


# ---------- canale salvate (ID-uri aduse de utilizator) ----------

def channels() -> list[dict]:
    try:
        return json.loads(_CHANNELS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def save_channel(name: str, ref: str) -> list[dict]:
    kind, h = parse_ref(ref)
    name = (name or "").strip()[:80] or f"Canal {h[:6]}"
    with _lock:
        items = [c for c in channels() if c.get("hash") != h]
        items.append({"name": name, "kind": kind, "hash": h})
        _CHANNELS_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    return items


def delete_channel(h: str) -> list[dict]:
    with _lock:
        items = [c for c in channels() if c.get("hash") != h]
        _CHANNELS_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    return items
