"""Biblioteca: muzică și cărți audio.

Catalogul vine din categoriile Torznab ale trackerelor din Jackett (muzică: 3000/3010/3040,
cărți audio: 3030). Ce alegi descarcă qBittorrent pe disc, în ./media/music sau
./media/audiobooks, de unde le preiau Navidrome (/music) și Audiobookshelf (/audiobookshelf).
qBittorrent nu are porturi publice; API-ul lui răspunde fără parolă doar rețelei interne Docker.
"""

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from app.config import Config
from app.sources.base import SourceError
from app.sources.torrents import (
    _human_size,
    _infohash_from_torrent,
    _mk_headers,
    _parse_torznab,
    _torznab_configured,
    _torznab_indexer_list,
    _try_indexer,
    dedupe_results,
    same_origin,
)

KINDS = {
    # „exclude”: trackerele pun cărțile audio și sub „Audio” (3000) — pe Muzică nu le vrem
    "music": {"cats": "3000,3010,3040", "exclude": {"3030", "7020"}, "dir": "/media/music", "player": "/music/"},
    "audiobooks": {"cats": "3030", "exclude": set(), "dir": "/media/audiobooks", "player": "/audiobookshelf/"},
}
_HASH = re.compile(r"^[0-9a-f]{40}$")
_CACHE_TTL = 300
_cache: dict[str, tuple[float, list[dict]]] = {}


def qb_url() -> str:
    return (os.getenv("QBITTORRENT_URL") or "http://qbittorrent:8080").rstrip("/")


def _kind(kind: str) -> dict:
    if kind not in KINDS:
        raise SourceError("Categorie necunoscută")
    return KINDS[kind]


# ---------- catalog ----------

def _browse_one(idx: tuple[str, str], cats: str, q: str | None, limit: int) -> list[dict]:
    import requests
    from urllib.parse import urlencode

    idx_id, label = idx
    params = {"apikey": Config.TORZNAB_API_KEY, "t": "search", "cat": cats, "limit": limit}
    if q:
        params["q"] = q
    url = f"{Config.TORZNAB_URL.rstrip('/')}/api/v2.0/indexers/{idx_id}/results/torznab/api?{urlencode(params)}"
    r = requests.get(url, headers=_mk_headers(), timeout=30)
    r.raise_for_status()
    out = _parse_torznab(r.content)
    for x in out:
        x["indexer"] = label
    return out


def browse(kind: str, q: str | None = None, limit: int = 100) -> list[dict]:
    """Noutăți (fără q, cele mai noi întâi) sau căutare (după seederi) într-o categorie."""
    cfg = _kind(kind)
    if not _torznab_configured():
        raise SourceError("Jackett nu e configurat")
    q = " ".join((q or "").split())[:100] or None
    key = f"{kind}|{(q or '').lower()}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    indexers = _torznab_indexer_list()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(6, len(indexers) or 1)) as pool:
        futures = [pool.submit(_try_indexer, lambda i: _browse_one(i, cfg["cats"], q, limit), idx) for idx in indexers]
        for f in futures:
            results.extend(f.result())
    results = [r for r in dedupe_results(results) if not cfg["exclude"] & set(r.pop("cats", None) or ())]
    if q:
        results.sort(key=lambda r: r.get("seeds") or 0, reverse=True)
    else:
        results.sort(key=lambda r: r.get("published") or "", reverse=True)
    if len(_cache) > 40:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:-20]:
            del _cache[k]
    _cache[key] = (time.time(), results)
    return results


# ---------- qBittorrent ----------

def _qb(method: str, path: str, **kw):
    import requests

    try:
        r = requests.request(method, f"{qb_url()}/api/v2/{path}", timeout=30, **kw)
    except requests.RequestException as e:
        raise SourceError("qBittorrent nu răspunde") from e
    if r.status_code == 403:
        raise SourceError("qBittorrent a refuzat accesul (verifică lista albă a subrețelei)")
    r.raise_for_status()
    return r


def _resolve(source: dict) -> tuple[str | None, bytes | None]:
    """(magnet, conținut .torrent) din rezultatul de catalog; .torrent doar de pe Jackett."""
    import requests

    magnet, torrent_url = source.get("magnet"), source.get("torrent_url")
    if magnet:
        if not str(magnet).startswith("magnet:"):
            raise SourceError("Magnet invalid")
        return magnet, None
    if not torrent_url or not same_origin(torrent_url, Config.TORZNAB_URL):
        raise SourceError("Link .torrent nepermis (acceptat doar de pe Jackett)")
    r = requests.get(torrent_url, headers=_mk_headers(), timeout=40, allow_redirects=False)
    location = r.headers.get("Location", "")
    if r.is_redirect and location.startswith("magnet:"):
        return location, None
    if r.is_redirect:
        r = requests.get(torrent_url, headers=_mk_headers(), timeout=40)
    r.raise_for_status()
    return None, r.content


def add(kind: str, source: dict) -> dict:
    """Pune release-ul în coada de descărcare a bibliotecii; întoarce infohash-ul."""
    cfg = _kind(kind)
    try:
        magnet, content = _resolve(source)
    except SourceError:
        raise
    except Exception as e:  # noqa: BLE001
        raise SourceError(f"Nu pot descărca .torrent de pe Jackett: {e}") from e
    data = {"savepath": cfg["dir"], "category": kind, "tags": "cinema"}
    if magnet:
        m = re.search(r"btih:([0-9a-fA-F]{40})", magnet)
        h = m.group(1).lower() if m else None
        _qb("POST", "torrents/add", data={**data, "urls": magnet})
    else:
        try:
            h = _infohash_from_torrent(content)
        except Exception as e:  # noqa: BLE001
            raise SourceError("Jackett nu a returnat un fișier .torrent valid") from e
        _qb("POST", "torrents/add", data=data, files={"torrents": ("release.torrent", content, "application/x-bittorrent")})
    return {"hash": h, "kind": kind}


def items() -> dict:
    """Ce e în bibliotecă (descărcat sau în curs) + spațiul liber pe disc."""
    out = []
    for kind in KINDS:
        for t in _qb("GET", "torrents/info", params={"category": kind}).json():
            out.append({
                "hash": t.get("hash"),
                "kind": kind,
                "name": t.get("name"),
                "size": _human_size(int(t.get("size") or 0)) if t.get("size") else None,
                "size_bytes": int(t.get("size") or 0),
                "progress": round(float(t.get("progress") or 0), 4),
                "state": t.get("state"),
                "dl_bps": int(t.get("dlspeed") or 0) * 8,
                "eta": int(t.get("eta") or 0),
                "added_on": t.get("added_on"),
            })
    out.sort(key=lambda x: x.get("added_on") or 0, reverse=True)
    free = None
    try:
        free = _qb("GET", "sync/maindata").json().get("server_state", {}).get("free_space_on_disk")
    except SourceError:
        pass
    used = sum(x["size_bytes"] for x in out)
    return {
        "items": out,
        "used": _human_size(used) if used else "0 B",
        "free": _human_size(int(free)) if free else None,
        "players": {k: v["player"] for k, v in KINDS.items()},
    }


def remove(h: str) -> None:
    """Șterge din bibliotecă: torrentul și fișierele de pe disc."""
    if not _HASH.match(h or ""):
        raise SourceError("Hash invalid")
    _qb("POST", "torrents/delete", data={"hashes": h, "deleteFiles": "true"})
