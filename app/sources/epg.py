"""Ghidul TV (EPG, XMLTV) al playlistului IPTV: „Acum / Urmează”, programul pe zile, căutare.

Adresa vine din antetul playlistului (url-tvg / x-tvg-url — la tvoetv.io: epg.tvoetv.io/api/epg.xml.gz,
~13 MB arhivat, ~130 MB XML, ~670.000 emisiuni pe ~3 luni). Îl descărcăm la câteva ore și îl citim
în flux (iterparse), păstrând în memorie doar fereastra utilă: arhiva furnizorului (până la
`catchup-days` în urmă, doar la canalele cu arhivă) și următoarele 36 de ore — ~75.000 de emisiuni.
"""

import bisect
import gzip
import re
import threading
import time

from app.config import ROOT, Config

_GZ = ROOT / "epg.xml.gz"
_REFRESH = 6 * 3600
_AHEAD = 36 * 3600
_lock = threading.Lock()
_state: dict = {"progs": {}, "ts": 0, "loading": False, "error": None}
# progs: {tvg_id: [(start, stop, title), ...]} sortate după start


def parse_time(s: str | None) -> int | None:
    """„20261020144000 +0300” -> timestamp Unix (fără fus orar: UTC, ca în standardul XMLTV).
    De mână, nu cu strptime: ghidul are ~1,3 milioane de ore de citit."""
    import calendar

    s = (s or "").strip()
    if len(s) < 14 or not s[:14].isdigit():
        return None
    try:
        ts = calendar.timegm((int(s[0:4]), int(s[4:6]), int(s[6:8]), int(s[8:10]), int(s[10:12]), int(s[12:14])))
    except (ValueError, OverflowError):
        return None
    z = s[14:].strip()
    if len(z) == 5 and z[0] in "+-" and z[1:].isdigit():
        off = int(z[1:3]) * 3600 + int(z[3:5]) * 60
        ts -= off if z[0] == "+" else -off
    return ts


def parse(fileobj, keep: dict[str, int], now: float | None = None) -> dict[str, list]:
    """Citește XMLTV în flux. `keep`: {tvg_id: zile de arhivă} — restul canalelor se sar."""
    from xml.etree.ElementTree import iterparse

    now = now or time.time()
    progs: dict[str, list] = {}
    # filtru grosier pe data scrisă („20261020…”), înainte de a calcula orele: ghidul are ~3 luni,
    # păstrăm doar ~1 săptămână (o zi de rezervă pentru fusurile orare)
    max_back = max([d for d in keep.values()] + [1]) * 86400
    lo = time.strftime("%Y%m%d", time.gmtime(now - max_back - 86400))
    hi = time.strftime("%Y%m%d", time.gmtime(now + _AHEAD + 86400))
    for _, el in iterparse(fileobj, events=("end",)):
        if el.tag != "programme":
            if el.tag == "channel":
                el.clear()
            continue
        cid = el.get("channel")
        day = (el.get("start") or "")[:8]
        if cid in keep and lo <= day <= hi:
            start, stop = parse_time(el.get("start")), parse_time(el.get("stop"))
            back = keep[cid] * 86400 if keep[cid] else 3 * 3600
            if start and stop and stop > now - back and start < now + _AHEAD:
                title = " ".join((el.findtext("title") or "").split())[:160]
                progs.setdefault(cid, []).append((start, stop, title))
        el.clear()
    for v in progs.values():
        v.sort()
    return progs


def _download(url: str) -> None:
    import requests

    headers = {"User-Agent": Config.USER_AGENT}
    if _GZ.exists():
        headers["If-Modified-Since"] = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(_GZ.stat().st_mtime))
    with requests.get(url, headers=headers, timeout=120, stream=True) as r:
        if r.status_code == 304:
            return
        r.raise_for_status()
        tmp = _GZ.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
        tmp.replace(_GZ)


def refresh(force: bool = False) -> None:
    """Descarcă (dacă s-a schimbat) și citește ghidul; rulează în fundal."""
    from app.sources import iptv

    with _lock:
        if _state["loading"] or (not force and time.time() - _state["ts"] < _REFRESH and _state["progs"]):
            return
        _state["loading"] = True
    try:
        pl = iptv._playlist()
        url = pl.get("epg")
        if not url:
            _state["error"] = "Playlistul nu are ghid TV (url-tvg)"
            return
        keep = {c["tvg_id"]: (c.get("catchup_days") or 0) for c in pl["channels"] if c.get("tvg_id")}
        try:
            _download(url.split(" ")[0])
        except Exception as e:  # noqa: BLE001 — rămâne fișierul vechi, dacă e
            _state["error"] = f"Ghidul nu se poate descărca: {e.__class__.__name__}"
            if not _GZ.exists():
                return
        opener = gzip.open if url.split("?")[0].endswith(".gz") or _is_gzip() else open
        with opener(_GZ, "rb") as f:
            progs = parse(f, keep)
        with _lock:
            _state.update(progs=progs, ts=time.time(), error=None)
    except Exception as e:  # noqa: BLE001
        _state["error"] = f"Ghidul nu se poate citi: {e}"
    finally:
        _state["loading"] = False


def _is_gzip() -> bool:
    try:
        with open(_GZ, "rb") as f:
            return f.read(2) == b"\x1f\x8b"
    except OSError:
        return False


def ensure_fresh() -> None:
    """Pornește reîmprospătarea în fundal când ghidul lipsește sau e mai vechi de 6 ore."""
    if not _state["loading"] and (not _state["progs"] or time.time() - _state["ts"] > _REFRESH):
        threading.Thread(target=refresh, name="epg", daemon=True).start()


def _list(tvg_id: str | None) -> list:
    return _state["progs"].get(tvg_id or "") or []


def now_next(tvg_id: str | None, now: float | None = None) -> tuple | None:
    """((titlu, start, stop) acum, (titlu, start) următoarea) sau None."""
    now = now or time.time()
    lst = _list(tvg_id)
    i = bisect.bisect_right(lst, (now, float("inf"), "")) - 1
    cur = lst[i] if 0 <= i < len(lst) and lst[i][0] <= now < lst[i][1] else None
    nxt = next((p for p in lst[max(i, 0):] if p[0] > now), None)
    if not cur and not nxt:
        return None
    return ((cur[2], cur[0], cur[1]) if cur else None, (nxt[2], nxt[0]) if nxt else None)


def guide(tvg_id: str | None, archive_days: int | None, now: float | None = None) -> list[dict]:
    """Programul canalului: din arhivă (cât ține furnizorul) până la +36 h; `archive` = se poate reda."""
    now = now or time.time()
    back = (archive_days or 0) * 86400
    out = []
    for start, stop, title in _list(tvg_id):
        if stop < now - max(back, 3 * 3600):
            continue
        out.append({"start": start, "stop": stop, "title": title,
                    "live": start <= now < stop,
                    "archive": bool(archive_days) and stop <= now and start >= now - back})
    return out


def _norm(s: str) -> str:
    return (s or "").lower().replace("ё", "е")


def search(q: str, channels: list[dict], now: float | None = None, limit: int = 80) -> list[dict]:
    """Emisiunile care conțin toate cuvintele: acum, urmează (36 h) și, la canalele cu arhivă, trecute."""
    now = now or time.time()
    words = [w for w in re.findall(r"\w+", _norm(q)) if len(w) >= 2]
    if not words:
        return []
    out = []
    for c in channels:
        days = c.get("catchup_days") or 0
        for start, stop, title in _list(c.get("tvg_id")):
            t = _norm(title)
            if not all(w in t for w in words):
                continue
            live = start <= now < stop
            archive = bool(days) and stop <= now and start >= now - days * 86400
            if not (live or start > now or archive):
                continue
            out.append({"cid": c["id"], "channel": c["name"], "logo": c.get("logo"), "title": title,
                        "start": start, "stop": stop, "live": live, "archive": archive})
    # acum, apoi ce urmează (cel mai curând), apoi arhiva (cea mai recentă)
    out.sort(key=lambda x: (0, 0) if x["live"] else (1, x["start"]) if x["start"] > now else (2, -x["start"]))
    return out[:limit]


def status() -> dict:
    return {"loaded": bool(_state["progs"]), "channels": len(_state["progs"]),
            "programmes": sum(len(v) for v in _state["progs"].values()),
            "updated": int(_state["ts"]) or None, "loading": _state["loading"], "error": _state["error"]}

