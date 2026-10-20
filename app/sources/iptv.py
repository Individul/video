"""TV prin IPTV: playlistul M3U al abonamentului tău (ex. „Плейлист / TVZone” din cabinetul tvoetv.io).

Linkul playlistului conține tokenul abonamentului: stă doar pe server (iptv.json din directorul de
date) și nu ajunge în browser — interfața primește canalele cu ID-uri proprii. Canalul ales îl
citește ffmpeg pe server (o singură retransmisie odată, ca un singur „dispozitiv”), copiază
video-ul, convertește sunetul în AAC și îl dă browserului ca HLS prin /api/iptv/relay/…: așa
merg și fluxurile http (pagina e https), și cele fără CORS, și cele cu sunet AC3/MP2.
"""

import hashlib
import json
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from app.config import ROOT, Config
from app.sources.base import SourceError

_FILE = ROOT / "iptv.json"
_lock = threading.Lock()
_CACHE_TTL = 6 * 3600
_cache: dict = {}  # {"ts", "url", "data"}

_RELAY_ROOT = Path(tempfile.gettempdir()) / "iptv-relay"
_RELAY_NAME = re.compile(r"^(index\.m3u8|\d{1,7}\.ts)$")
_SESS = re.compile(r"^[0-9a-f]{16}$")
_relay: dict = {}  # {"sess", "id", "proc", "dir", "seen"}
_relay_lock = threading.Lock()


# ---------- setări (linkul playlistului, favorite) ----------

def _load() -> dict:
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(d: dict) -> None:
    tmp = _FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(_FILE)


def mask(url: str | None) -> str | None:
    """„http://host/get.php?username=…&password=…” -> „host/…” (fără token în interfață)."""
    if not url:
        return None
    u = urlparse(url)
    return f"{u.hostname or '?'}/…"


# ---------- playlistul M3U ----------

_ATTR = re.compile(r'([\w-]+)="([^"]*)"')


def channel_id(name: str, url: str) -> str:
    return hashlib.sha1(f"{name}|{url}".encode()).hexdigest()[:12]


def parse_m3u(text: str) -> dict:
    """#EXTM3U url-tvg="…" / #EXTINF:-1 tvg-logo="…" group-title="…" catchup-days="5",Nume / URL."""
    epg, channels, cur, group = None, [], None, None
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip("﻿")
        if not line:
            continue
        if line.startswith("#EXTM3U"):
            attrs = dict(_ATTR.findall(line))
            epg = attrs.get("url-tvg") or attrs.get("x-tvg-url") or epg
        elif line.startswith("#EXTINF"):
            head, _, name = line.partition(",")
            attrs = dict(_ATTR.findall(head))
            cur = {
                "name": name.strip() or attrs.get("tvg-name") or "?",
                "group": attrs.get("group-title") or None,
                "logo": attrs.get("tvg-logo") or None,
                "tvg_id": attrs.get("tvg-id") or None,
                "catchup_days": int(attrs["catchup-days"]) if (attrs.get("catchup-days") or "").isdigit() else None,
            }
        elif line.startswith("#EXTGRP:") and cur is not None:
            cur["group"] = cur["group"] or line[8:].strip() or None
        elif line.startswith("#"):
            continue
        elif cur is not None and re.match(r"^(https?|rtmp|rtsp|udp)://", line, re.I):
            cur["url"] = line
            cur["id"] = channel_id(cur["name"], line)
            cur["group"] = cur["group"] or "Fără grup"
            channels.append(cur)
            cur = None
    return {"epg": epg, "channels": channels}


def _fetch(url: str) -> dict:
    import requests

    try:
        r = requests.get(url, headers={"User-Agent": Config.USER_AGENT}, timeout=40)
    except requests.RequestException as e:
        raise SourceError(f"Playlistul nu se poate descărca: {e.__class__.__name__}") from e
    if r.status_code in (401, 403):
        raise SourceError("Furnizorul a refuzat playlistul (abonament expirat sau link greșit)")
    if r.status_code >= 400:
        raise SourceError(f"Furnizorul a răspuns {r.status_code} la playlist")
    data = parse_m3u(r.content.decode("utf-8", "replace"))
    if not data["channels"]:
        raise SourceError("Linkul nu e un playlist M3U cu canale")
    return data


def _playlist(refresh: bool = False) -> dict:
    url = _load().get("url")
    if not url:
        raise SourceError("Playlistul IPTV nu e configurat")
    with _lock:
        if not refresh and _cache.get("url") == url and time.time() - _cache["ts"] < _CACHE_TTL:
            return _cache["data"]
    data = _fetch(url)
    with _lock:
        _cache.update(ts=time.time(), url=url, data=data)
    return data


def set_playlist(url: str) -> dict:
    url = (url or "").strip()
    if not re.match(r"^https?://[^\s/]+", url, re.I) or len(url) > 2000:
        raise SourceError("Link invalid: trebuie să înceapă cu http:// sau https://")
    data = _fetch(url)  # verificăm înainte să-l salvăm
    with _lock:
        d = _load()
        d["url"] = url
        _save(d)
        _cache.update(ts=time.time(), url=url, data=data)
    return {"count": len(data["channels"])}


def clear_playlist() -> None:
    stop_all()
    with _lock:
        d = _load()
        d.pop("url", None)
        _save(d)
        _cache.clear()


def overview(refresh: bool = False) -> dict:
    """Ce vede interfața: canalele fără adresele lor, grupurile, favoritele."""
    d = _load()
    if not d.get("url"):
        return {"configured": False}
    data = _playlist(refresh)
    groups: dict[str, int] = {}
    for c in data["channels"]:
        groups[c["group"]] = groups.get(c["group"], 0) + 1
    return {
        "configured": True,
        "source": mask(d["url"]),
        "channels": [{k: c[k] for k in ("id", "name", "group", "logo", "catchup_days")} for c in data["channels"]],
        "groups": [{"name": g, "count": n} for g, n in groups.items()],  # ordinea din playlist
        "favorites": [f for f in d.get("favorites", []) if isinstance(f, str)],
    }


def toggle_favorite(cid: str) -> list[str]:
    if not re.match(r"^[0-9a-f]{12}$", cid or ""):
        raise SourceError("Canal invalid")
    with _lock:
        d = _load()
        fav = [f for f in d.get("favorites", []) if f != cid]
        if len(fav) == len(d.get("favorites", [])):
            fav.append(cid)
        d["favorites"] = fav
        _save(d)
    return fav


def _channel(cid: str) -> dict:
    c = next((c for c in _playlist()["channels"] if c["id"] == cid), None)
    if not c:
        raise SourceError("Canal inexistent (playlistul s-a schimbat?)")
    return c


# ---------- retransmisia (ffmpeg) ----------

def relay_cmd(src: str, out_dir: Path) -> list[str]:
    http = src.lower().startswith(("http://", "https://"))
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        *(["-user_agent", Config.USER_AGENT, "-reconnect", "1", "-reconnect_streamed", "1",
           "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5"] if http else []),
        # cel mult puțin peste timp real (după un start rapid de 8 s): canalele live vin oricum
        # în ritmul lor, iar filmele (VOD) din playlist nu mai fug înaintea player-ului
        "-readrate", "1.05", "-readrate_initial_burst", "8",
        "-i", src,
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-ac", "2",
        "-af", "aresample=async=1000",
        "-f", "hls", "-hls_time", "4", "-hls_list_size", "15",
        "-hls_flags", "delete_segments+independent_segments",
        "-hls_segment_filename", str(out_dir / "%d.ts"),
        str(out_dir / "index.m3u8"),
    ]


def _stop_locked() -> None:
    proc = _relay.get("proc")
    if proc and proc.poll() is None:
        proc.kill()
    if _relay.get("dir"):
        shutil.rmtree(_relay["dir"], ignore_errors=True)
    _relay.clear()


def start(cid: str) -> dict:
    """Pornește canalul (oprește-l pe cel de dinainte); întoarce sesiunea și playlistul HLS."""
    c = _channel(cid)
    with _relay_lock:
        _stop_locked()
        sess = secrets.token_hex(8)
        out_dir = _RELAY_ROOT / sess
        shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True)
        log = open(out_dir / "ffmpeg.log", "wb")  # nu PIPE: un pipe necitit ar bloca ffmpeg după ore
        proc = subprocess.Popen(relay_cmd(c["url"], out_dir), stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=log)
        log.close()
        _relay.update(sess=sess, id=cid, proc=proc, dir=out_dir, seen=time.time())
        threading.Thread(target=_watchdog, args=(proc,), daemon=True).start()
    return {"session": sess, "playlist": f"/api/iptv/relay/{sess}/index.m3u8", "name": c["name"]}


def _watchdog(proc) -> None:
    """Oprește retransmisia dacă player-ul n-a mai cerut nimic 45 s (tab închis, alt canal)."""
    while proc.poll() is None:
        time.sleep(5)
        with _relay_lock:
            if _relay.get("proc") is not proc:
                return
            if time.time() - _relay["seen"] > 45:
                _stop_locked()
                return


def status(sess: str) -> dict:
    """Încă merge? Dacă ffmpeg s-a oprit, de ce (prima linie de eroare)."""
    if not _SESS.match(sess or ""):
        raise SourceError("Sesiune invalidă")
    with _relay_lock:
        if _relay.get("sess") != sess:
            return {"running": False, "error": "Retransmisia s-a oprit"}
        proc = _relay["proc"]
        _relay["seen"] = time.time()
        if proc.poll() is None:
            return {"running": True}
        try:
            err = (_relay["dir"] / "ffmpeg.log").read_text("utf-8", "replace")[-4000:].strip().splitlines()
        except OSError:
            err = []
    msg = err[-1] if err else "ffmpeg s-a oprit"
    if re.search(r"40[13]|Forbidden|Unauthorized", msg):
        msg = "Furnizorul a refuzat canalul (abonament, limită de dispozitive sau canal indisponibil)"
    elif re.search(r"404|Not Found", msg):
        msg = "Canalul nu mai există la furnizor"
    return {"running": False, "error": msg}


def relay_file(sess: str, name: str) -> Path | None:
    if not _SESS.match(sess or "") or not _RELAY_NAME.match(name or ""):
        return None
    with _relay_lock:
        if _relay.get("sess") != sess:
            return None
        _relay["seen"] = time.time()
        path = _relay["dir"] / name
    return path if path.is_file() else None


def stop(sess: str) -> None:
    with _relay_lock:
        if _relay.get("sess") == sess:
            _stop_locked()


def stop_all() -> None:
    with _relay_lock:
        _stop_locked()
