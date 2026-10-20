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


def channel_id(name: str, group: str | None, nth: int = 0) -> str:
    """Stabil între descărcări: furnizorul schimbă tokenul din linkuri, numele și grupul rămân
    (al doilea canal cu același nume în același grup primește `nth`=1 …)."""
    return hashlib.sha1(f"{name}|{group or ''}|{nth}".encode()).hexdigest()[:12]


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
            cur["group"] = cur["group"] or "Fără grup"
            channels.append(cur)
            cur = None
    seen: dict[tuple, int] = {}
    for c in channels:
        k = (c["name"], c["group"])
        c["id"] = channel_id(c["name"], c["group"], seen.get(k, 0))
        seen[k] = seen.get(k, 0) + 1
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
    start_prober()
    from app.sources import epg

    threading.Thread(target=epg.refresh, kwargs={"force": True}, name="epg", daemon=True).start()
    return {"count": len(data["channels"])}


def clear_playlist() -> None:
    stop_all()
    with _lock:
        d = _load()
        d.pop("url", None)
        _save(d)
        _cache.clear()


# ---------- ce merge în browser (verificare în fundal + ce raportează browserul) ----------
#
# Browserul refuză des video-ul întrețesut de satelit (1080i) și HEVC. Serverul deschide fiecare
# canal 2–3 s (ffprobe: codec, înălțime, cadre întrețesute), câte unul, și se oprește cât timp
# te uiți la TV (abonamentul are un număr limitat de dispozitive). Ce raportează browserul tău
# câștigă: „merge” / „refuzat” pe canal, iar un HD întrețesut care merge (accelerare grafică
# pornită) înseamnă că browserul tău le duce pe toate de felul ăsta.

_PROBE_FILE = ROOT / "iptv_probe.json"
_PROBE_TTL = 7 * 86400
_OFFLINE_RETRY = 86400
_probe_lock = threading.Lock()
_probe: dict | None = None
_prober = {"running": False}


def _probe_store() -> dict:
    global _probe
    if _probe is None:
        try:
            _probe = json.loads(_PROBE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _probe = {}
        _probe.setdefault("channels", {})
        _probe.setdefault("caps", {})
    return _probe


def _probe_save() -> None:
    tmp = _PROBE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_probe, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_PROBE_FILE)


def probe_channel(url: str) -> dict:
    """{"codec", "h", "interlaced"} din primele cadre; ridică dacă fluxul nu răspunde."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-user_agent", Config.USER_AGENT, "-select_streams", "v:0",
         "-read_intervals", "%+#12", "-show_entries", "stream=codec_name,height:frame=interlaced_frame",
         "-of", "json", url],
        capture_output=True, text=True, timeout=30,
    ).stdout
    d = json.loads(out or "{}")
    streams = d.get("streams") or []
    if not streams:
        raise SourceError("fără video")
    frames = [f.get("interlaced_frame") for f in d.get("frames") or []]
    return {"codec": streams[0].get("codec_name"), "h": streams[0].get("height"),
            "interlaced": bool(frames) and sum(1 for f in frames if f) * 2 >= len(frames)}


def _kind(info: dict) -> str | None:
    """Clasa de format care contează pentru browser: „hd_i” (HD întrețesut), „hevc” sau None."""
    codec = (info.get("codec") or "").lower()
    if codec in ("hevc", "h265"):
        return "hevc"
    if codec in ("mpeg2video", "mpeg1video") and (info.get("h") or 0) > COMPAT_MAX_HEIGHT:
        return "mpeg2_hd"  # niciun browser nu decodează MPEG-2, iar HD-ul nu-l putem converti
    if info.get("interlaced") and (info.get("h") or 0) > COMPAT_MAX_HEIGHT:
        return "hd_i"
    return None


def verdict(cid: str) -> str:
    """„ok” (merge sau merge prin conversie SD), „bad” (nu merge în browser / nu răspunde), „unknown”."""
    st = _probe_store()
    info = st["channels"].get(cid) or {}
    if info.get("seen") in ("ok", "bad"):
        return info["seen"]
    if info.get("offline", 0) >= 2:
        return "bad"
    if "codec" not in info:
        return "unknown"
    kind = _kind(info)
    if kind:
        return "ok" if st["caps"].get(kind) == "ok" else "bad"
    return "ok"


def report(cid: str, ok: bool) -> None:
    """Ce a văzut browserul: canalul a mers (ok) sau decodorul l-a refuzat."""
    if not re.match(r"^[0-9a-f]{12}$", cid or ""):
        raise SourceError("Canal invalid")
    with _probe_lock:
        st = _probe_store()
        info = st["channels"].setdefault(cid, {})
        info["seen"] = "ok" if ok else "bad"
        info.pop("offline", None)
        kind = _kind(info)
        if kind:  # browserul tău duce (sau nu) toate canalele de felul ăsta
            st["caps"][kind] = "ok" if ok else "bad"
        _probe_save()


def start_prober() -> None:
    """Pornește (o dată) verificarea în fundal a canalelor încă neverificate."""
    with _probe_lock:
        if _prober["running"]:
            return
        _prober["running"] = True
    threading.Thread(target=_prober_loop, name="iptv-probe", daemon=True).start()


def _prober_loop() -> None:
    try:
        while True:
            try:
                chans = _playlist()["channels"]
            except SourceError:
                return
            now = time.time()
            st = _probe_store()
            todo = [c for c in chans
                    if (now - (st["channels"].get(c["id"]) or {}).get("ts", 0))
                    > (_OFFLINE_RETRY if (st["channels"].get(c["id"]) or {}).get("offline") else _PROBE_TTL)]
            _prober["total"], _prober["todo"] = len(chans), len(todo)
            if not todo:
                return
            for c in todo:
                while _relay.get("proc") is not None and _relay["proc"].poll() is None:
                    time.sleep(10)  # te uiți la TV: nu ocupăm încă un „dispozitiv”
                try:
                    info = probe_channel(c["url"])
                except Exception:  # noqa: BLE001 — canal căzut / refuzat
                    info = None
                with _probe_lock:
                    rec = _probe_store()["channels"].setdefault(c["id"], {})
                    rec["ts"] = time.time()
                    if info:
                        rec.update(info)
                        rec.pop("offline", None)
                    else:
                        rec["offline"] = rec.get("offline", 0) + 1
                    _prober["todo"] = max(0, _prober.get("todo", 1) - 1)
                    _probe_save()
                time.sleep(0.5)
    finally:
        _prober["running"] = False


def probe_progress() -> dict:
    total = _prober.get("total")
    st = _probe_store()["channels"]
    try:
        ids = [c["id"] for c in _playlist()["channels"]]
    except SourceError:
        ids = []
    done = sum(1 for i in ids if "codec" in (st.get(i) or {}) or (st.get(i) or {}).get("offline"))
    return {"running": _prober["running"], "done": done, "total": total or len(ids)}


def epg_now() -> dict:
    """{id canal: [titlu acum, start, stop, titlu următor, start următor]} pentru canalele cu ghid."""
    from app.sources import epg

    epg.ensure_fresh()
    out = {}
    for c in _playlist()["channels"]:
        nn = epg.now_next(c.get("tvg_id"))
        if nn:
            cur, nxt = nn
            out[c["id"]] = [*(cur or (None, None, None)), *(nxt or (None, None))]
    return {"now": out, "epg": epg.status()}


def epg_guide(cid: str) -> dict:
    from app.sources import epg

    epg.ensure_fresh()
    c = _channel(cid)
    return {"id": cid, "name": c["name"], "logo": c.get("logo"), "archive_days": c.get("catchup_days") or 0,
            "programmes": epg.guide(c.get("tvg_id"), c.get("catchup_days"))}


def epg_search(q: str) -> dict:
    from app.sources import epg

    epg.ensure_fresh()
    return {"results": epg.search(q, _playlist()["channels"]), "epg": epg.status()}


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
        "channels": [{**{k: c[k] for k in ("id", "name", "group", "logo", "catchup_days")}, "state": verdict(c["id"])}
                     for c in data["channels"]],
        "probe": probe_progress(),
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

# conversia video (canalele întrețesute de satelit, pe care decodorul browserului le refuză):
# măsurat pe 2 vCPU — SD 576i ~0,6 vCPU (merge), HD 1080i ≥ 1,6 vCPU (tot serverul: nu)
COMPAT_MAX_HEIGHT = 576


def relay_cmd(src: str, out_dir: Path, compat: bool = False) -> list[str]:
    http = src.lower().startswith(("http://", "https://"))
    video = (["-vf", "yadif=0", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
              "-crf", "23", "-g", "50", "-threads", "2"] if compat else ["-c:v", "copy"])
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        *(["-user_agent", Config.USER_AGENT, "-reconnect", "1", "-reconnect_streamed", "1",
           "-reconnect_on_network_error", "1", "-reconnect_delay_max", "5"] if http else []),
        # cel mult puțin peste timp real (după un start rapid de 8 s): canalele live vin oricum
        # în ritmul lor, iar filmele (VOD) din playlist nu mai fug înaintea player-ului
        "-readrate", "1.05", "-readrate_initial_burst", "8",
        "-i", src,
        "-map", "0:v:0?", "-map", "0:a:0?",
        *video,
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


def probe_height(url: str) -> int | None:
    """Înălțimea video-ului canalului (ffprobe pe flux, ~3–8 s)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-user_agent", Config.USER_AGENT, "-select_streams", "v:0",
             "-show_entries", "stream=height", "-of", "json", url],
            capture_output=True, text=True, timeout=25,
        ).stdout
        streams = json.loads(out or "{}").get("streams") or []
        return int(streams[0]["height"]) if streams and streams[0].get("height") else None
    except (subprocess.SubprocessError, ValueError, KeyError, OSError):
        return None


def archive_url(url: str, start: int) -> str:
    """Arhiva Flussonic a furnizorului: „…/CANAL/mpegts?token=X” -> „…/CANAL/timeshift_abs-START.m3u8?token=X”
    (pornește de la începutul emisiunii și merge mai departe ca la TV)."""
    base, _, query = url.partition("?")
    return f"{base.rsplit('/', 1)[0]}/timeshift_abs-{int(start)}.m3u8" + (f"?{query}" if query else "")


def start(cid: str, compat: bool = False, at: int | None = None) -> dict:
    """Pornește canalul (oprește-l pe cel de dinainte); întoarce sesiunea și playlistul HLS.
    `compat`: video convertit pe server (doar SD — HD-ul nu încape în procesorul serverului).
    `at`: din arhivă, de la acest moment (doar canalele cu arhivă, în zilele ei)."""
    c = _channel(cid)
    src = c["url"]
    if at is not None:
        days = c.get("catchup_days") or 0
        if not days or not (time.time() - days * 86400 - 60 <= at <= time.time()):
            raise SourceError("Emisiunea nu e în arhiva canalului")
        src = archive_url(c["url"], at)
    if compat:
        h = probe_height(src)
        if h and h > COMPAT_MAX_HEIGHT:
            raise SourceError(f"hd:{h}")  # interfața arată „Deschide în VLC”
    with _relay_lock:
        _stop_locked()
        sess = secrets.token_hex(8)
        out_dir = _RELAY_ROOT / sess
        shutil.rmtree(out_dir, ignore_errors=True)
        out_dir.mkdir(parents=True)
        log = open(out_dir / "ffmpeg.log", "wb")  # nu PIPE: un pipe necitit ar bloca ffmpeg după ore
        proc = subprocess.Popen(relay_cmd(src, out_dir, compat), stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=log)
        log.close()
        _relay.update(sess=sess, id=cid, proc=proc, dir=out_dir, seen=time.time())
        threading.Thread(target=_watchdog, args=(proc,), daemon=True).start()
    return {"session": sess, "playlist": f"/api/iptv/relay/{sess}/index.m3u8", "name": c["name"],
            "compat": compat, "archive": at}


def m3u_for(cid: str) -> tuple[str, str]:
    """Un playlist cu un singur canal, pentru VLC pe calculatorul tău (conține linkul abonamentului)."""
    c = _channel(cid)
    safe = re.sub(r"[^\w\- ]+", "", c["name"]).strip() or "canal"
    return f"{safe}.m3u", f"#EXTM3U\n#EXTINF:-1,{c['name']}\n{c['url']}\n"


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
