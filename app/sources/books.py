"""Cărți audio: catalog din trackere, coperți și descrieri de pe LitRes, descărcare în qBittorrent.

- Catalogul vine din categoria Torznab 3030 (Audiobook) a trackerelor din Jackett; genurile sunt
  subforumurile RuTracker „[Аудио] …”.
- Un release de pe tracker are titlul „Автор - Название [Чтец, 2026, 128 kbps, MP3]” (RuTracker)
  sau „Автор | Название (2026) [MP3, Чтец]” (NNM-Club); același titlu de la mai mulți cititori
  sau în mai multe calități = aceeași carte, cu mai multe versiuni.
- Coperta, descrierea și genurile vin din căutarea publică LitRes (doar dacă autorul se potrivește),
  păstrate pe disc ca să nu întrebăm de două ori.
- Ce adaugi descarcă qBittorrent în ./media/audiobooks; portalul vede folderul read-only (/media/audiobooks)
  și redă fișierele în playerul lui. API-ul qBittorrent răspunde fără parolă doar rețelei Docker.
"""

import hashlib
import html
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.config import ROOT, Config
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

CATEGORY = "3030"
SAVE_DIR = "/media/audiobooks"  # aceeași cale în qBittorrent și în portal
QB_CATEGORY = "audiobooks"
AUDIO_EXT = {".mp3", ".m4b", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wav", ".wma", ".mka"}

# (slug, nume, subforumurile RuTracker) — rândurile de pe pagina „Cărți audio”
GENRES = [
    ("fantasy", "Fantastic și fantasy", ("102387", "102388", "102348")),
    ("detective", "Detective și thrillere", ("102137", "100499")),
    ("russian", "Literatură rusă", ("100402",)),
    ("foreign", "Literatură străină", ("100399",)),
    ("love", "Romane de dragoste", ("100467", "100661")),
    ("history", "Istorie și filozofie", ("100400",)),
    ("bio", "Biografii și memorii", ("101036",)),
    ("science", "Știință pe înțeles", ("100403",)),
    ("business", "Business și dezvoltare", ("100716",)),
    ("kids", "Pentru copii", ("100490",)),
    ("radio", "Teatru radiofonic", ("100574",)),
    ("poetry", "Poezie", ("100695",)),
    ("english", "În engleză", ("101501",)),
]
_GENRE = {slug: (name, cats) for slug, name, cats in GENRES}

_HASH = re.compile(r"^[0-9a-f]{40}$")
_CACHE_TTL = 1800
_cache: dict[str, tuple[float, list[dict]]] = {}


def qb_url() -> str:
    return (os.getenv("QBITTORRENT_URL") or "http://qbittorrent:8080").rstrip("/")


def media_root() -> Path:
    return Path(os.getenv("AUDIOBOOKS_DIR") or SAVE_DIR)


# ---------- titlul release-ului -> autor / titlu / cititor ----------

_FMT = re.compile(r"^(mp3|m4b|m4a|aac|flac|ogg|opus|alac|ape|wav|wma)$", re.I)
_BITRATE = re.compile(r"(?i)\b(?:vbr\s*)?\d{2,3}(?:-\d{2,3})?\s*kbps\b")
_YEAR = re.compile(r"^(1[89]\d\d|20\d\d)(?:\s*г\.?)?$")
_CYR = re.compile(r"[а-яё]", re.I)


def _pick(variants: str) -> tuple[str, str | None]:
    """„Fitzgerald Francis Scott / Фицджеральд Фрэнсис Скотт” -> (primul, varianta chirilică)."""
    parts = [p.strip() for p in variants.split(" / ") if p.strip()]
    if not parts:
        return variants.strip(), None
    cyr = next((p for p in parts if _CYR.search(p)), None)
    return parts[0], cyr if cyr and cyr != parts[0] else None


def _swap_name(author: str) -> str:
    """RuTracker scrie „Глуховский Дмитрий”; afișăm „Дмитрий Глуховский” (doar la nume din 2 cuvinte)."""
    out = []
    for a in author.split(", "):
        w = a.split()
        out.append(f"{w[1]} {w[0]}" if len(w) == 2 and not re.search(r"[()\d]", a) else a)
    return ", ".join(out)


def parse_title(name: str) -> dict:
    s = " ".join((name or "").split())
    info = {"author": None, "author_alt": None, "title": s, "title_alt": None, "series": None,
            "narrator": None, "year": None, "bitrate": None, "format": None, "lang": None}
    m = re.match(r"^\[([^\]\d]{3,30})\]\s*", s)  # „[Английский] …”
    if m:
        info["lang"] = m.group(1)
        s = s[m.end():]
    bracket = ""
    if " | " in s:  # NNM-Club: Автор | Название (2026) [MP3, Чтец] (Обновляемая)
        author, rest = s.split(" | ", 1)
        m = re.match(r"^(.*?)\s*\((\d{4})\)\s*\[([^\]]*)\]", rest)
        if m:
            title, info["year"], bracket = m.group(1), m.group(2), m.group(3)
        else:
            title = re.sub(r"\s*[\[(].*$", "", rest)
        parts = [p.strip() for p in bracket.split(",") if p.strip()]
        if parts and _FMT.match(parts[0]):
            info["format"] = parts.pop(0).upper()
        if parts:
            info["narrator"] = ", ".join(parts)
        info["author"], info["author_alt"] = _pick(author)
    else:  # RuTracker: Автор - Название [Чтец, 2026, 128 kbps, MP3]
        # ultimul […] cu detaliile; ce urmează după el („. Полное издание”) e zgomot
        m = re.match(r"^(.*)\[([^\[\]]*)\]([^\[\]]*)$", s)
        head, bracket = (m.group(1).strip(), m.group(2)) if m else (s, "")
        if " - " in head:
            author, title = head.split(" - ", 1)
            a, alt = _pick(author)
            info["author"], info["author_alt"] = _swap_name(a), _swap_name(alt) if alt else None
        else:
            title = head
        narrators, rest = [], []
        for p in (x.strip() for x in bracket.split(",")):
            if not p:
                continue
            if _YEAR.match(p) and not info["year"]:
                info["year"] = p[:4]
            elif _BITRATE.search(p):
                info["bitrate"] = p
            elif _FMT.match(p):
                info["format"] = p.upper()
            elif not info["year"]:
                narrators.append(p)  # cititorii sunt înaintea anului
            else:
                rest.append(p)
        narrators = narrators or rest  # „[2006, Максим Суханов, Дарья Мороз, MP3]”: anul e primul
        if narrators:
            info["narrator"] = ", ".join(narrators)
    title, info["title_alt"] = _pick(title.strip(" -"))
    m = re.match(r"^(.+?\s\d+(?:\.\d+)?),\s+(.+)$", title)  # „Серия 5, Название книги”
    if m:
        info["series"], title = m.group(1), m.group(2)
    info["title"] = title.strip() or s
    if info["bitrate"]:
        info["bitrate"] = re.sub(r"(?i)\s*kbps", " kbps", info["bitrate"])
    return info


def _norm(s: str | None) -> str:
    return re.sub(r"[^0-9a-zа-я]+", "", (s or "").lower().replace("ё", "е"))


_PATRONYMIC = re.compile(r"(вич|вна|ична|ич)$")


def surnames(author: str | None) -> list[str]:
    """Numele de familie ale autorilor, oricum ar fi scrise: „Михаил Булгаков”, „Булгаков Михаил
    Афанасьевич”, „Михаил Афанасьевич Булгаков”, „М.А. Булгаков” -> ["Булгаков"]."""
    out = []
    for a in re.split(r",|;|\s&\s|\sи\s", author or ""):
        w = [x for x in re.findall(r"[^\s.()]+", a) if len(x) > 1]  # fără inițiale
        if not w:
            continue
        if len(w) >= 3 and _PATRONYMIC.search(w[-1].lower()):
            out.append(w[0])  # Фамилия Имя Отчество
        else:
            out.append(w[-1])  # Имя Фамилия / Имя Отчество Фамилия
    return out


def book_key(author: str | None, title: str) -> str:
    """Aceeași carte de la cititori diferiți: numele de familie ale autorilor + titlul."""
    raw = "|".join(sorted(_norm(x) for x in surnames(author))) + "#" + _norm(title)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def group_books(results: list[dict]) -> list[dict]:
    """Release-uri -> cărți, fiecare cu versiunile ei (păstrează ordinea primei apariții)."""
    books: dict[str, dict] = {}
    for r in results:
        p = parse_title(r["name"])
        k = book_key(p["author"], p["title"])
        b = books.get(k)
        if not b:
            b = books[k] = {
                "key": k, "author": p["author"], "title": p["title"], "series": p["series"],
                "author_alt": p["author_alt"], "title_alt": p["title_alt"], "lang": p["lang"],
                "year": p["year"], "seeds": 0, "published": None, "versions": [],
            }
        v = {x: r.get(x) for x in ("name", "magnet", "torrent_url", "size", "seeds", "indexer", "published")}
        v.update({x: p[x] for x in ("narrator", "year", "bitrate", "format")})
        b["versions"].append(v)
        b["seeds"] = max(b["seeds"], r.get("seeds") or 0)
        if (r.get("published") or "") > (b["published"] or ""):
            b["published"] = r.get("published")
        b["year"] = b["year"] or p["year"]
    for b in books.values():
        b["versions"].sort(key=lambda v: v.get("seeds") or 0, reverse=True)
        b["narrators"] = list(dict.fromkeys(v["narrator"] for v in b["versions"] if v.get("narrator")))
    return list(books.values())


# ---------- catalog din Jackett ----------

def _search_one(idx: tuple[str, str], cats: str, q: str | None, limit: int) -> list[dict]:
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


def _releases(genre: str | None, q: str | None) -> list[dict]:
    if not _torznab_configured():
        raise SourceError("Jackett nu e configurat")
    indexers = _torznab_indexer_list()
    if genre:
        if genre not in _GENRE:
            raise SourceError("Gen necunoscut")
        cats = ",".join(_GENRE[genre][1])
        indexers = [i for i in indexers if i[0] == "rutracker"]  # genurile sunt subforumuri RuTracker
    else:
        cats = CATEGORY
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(6, len(indexers) or 1)) as pool:
        futures = [pool.submit(_try_indexer, lambda i: _search_one(i, cats, q, 100), idx) for idx in indexers]
        for f in futures:
            results.extend(f.result())
    # doar cărți audio (trackerul poate întoarce și altceva la căutare liberă)
    results = [r for r in dedupe_results(results) if CATEGORY in (r.pop("cats", None) or [CATEGORY]) or genre]
    return results


def browse(genre: str | None = None, q: str | None = None) -> list[dict]:
    """Cărți: noutăți (toate sau pe gen, cele mai noi întâi) sau căutare (după seederi)."""
    q = " ".join((q or "").split())[:100] or None
    key = f"{genre or ''}|{(q or '').lower()}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    books = group_books(_releases(genre, q))
    if q:
        books.sort(key=lambda b: b["seeds"], reverse=True)
    else:
        books.sort(key=lambda b: b["published"] or "", reverse=True)
    if len(_cache) > 60:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:-30]:
            del _cache[k]
    _cache[key] = (time.time(), books)
    return books


def _surname(author: str | None) -> str:
    names = surnames(author)
    return names[0] if names else ""


def book(author: str | None, title: str) -> dict | None:
    """Pagina cărții: toate versiunile ei de pe toate trackerele."""
    want = book_key(author, title)
    q = f"{_surname(author)} {title}".strip()
    found = [b for b in browse(None, q) if b["key"] == want]
    if not found:  # titluri lungi: trackerul caută după toate cuvintele — încercăm mai scurt
        short = " ".join(title.split()[:4])
        found = [b for b in browse(None, f"{_surname(author)} {short}".strip()) if b["key"] == want]
    return found[0] if found else None


def genres() -> list[dict]:
    return [{"slug": s, "name": n} for s, n, _ in GENRES]


# ---------- LitRes: copertă, descriere, genuri ----------

_META_FILE = ROOT / "books_meta.json"
_META_MISS_TTL = 7 * 86400
_meta_lock = threading.Lock()
_meta: dict | None = None
_litres_sem = threading.Semaphore(4)


def _meta_store() -> dict:
    global _meta
    if _meta is None:
        try:
            _meta = json.loads(_META_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _meta = {}
    return _meta


def _meta_save() -> None:
    try:
        tmp = _META_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_meta, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_META_FILE)
    except OSError:
        pass


def _plain(html_text: str | None) -> str | None:
    if not html_text:
        return None
    t = re.sub(r"(?i)</p>|<br\s*/?>", "\n", html_text)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    t = "\n".join(line.strip() for line in t.splitlines() if line.strip())
    return t[:4000] or None


def _litres_get(path: str, **params):
    import requests

    with _litres_sem:
        r = requests.get(f"https://api.litres.ru/foundation/api/{path}", params=params,
                         headers=_mk_headers(), timeout=15)
    r.raise_for_status()
    return r.json().get("payload", {}).get("data")


def _litres_match(author: str | None, title: str, items: list[dict]) -> dict | None:
    sur = _norm(_surname(author))
    t = _norm(title)
    items = sorted(items or [], key=lambda it: _norm((it.get("instance") or it).get("title")) != t)  # exact întâi
    for it in items:
        x = it.get("instance") or it
        authors = [_norm(p.get("full_name")) for p in x.get("persons") or [] if p.get("role") in (None, "author")]
        lt = _norm(x.get("title"))
        if not lt or not t:
            continue
        title_ok = lt.startswith(t[:24]) or t.startswith(lt[:24])
        author_ok = not sur or any(sur in a for a in authors)
        if title_ok and author_ok:
            return x
    return None


def meta(author: str | None, title: str, full: bool = False) -> dict | None:
    """Coperta (și cu `full`, descrierea + genurile) cărții, de pe LitRes; None dacă nu e acolo."""
    k = book_key(author, title)
    store = _meta_store()
    m = store.get(k)
    if m and m.get("miss") and time.time() - m.get("ts", 0) < _META_MISS_TTL:
        return None
    if m and not m.get("miss") and (not full or "description" in m):
        return m
    try:
        if not m or m.get("miss"):
            found = None
            for types in ("audiobook", None):
                params = {"q": f"{title} {author or ''}".strip(), "limit": 8}
                if types:
                    params["types"] = types
                found = _litres_match(author, title, _litres_get("search", **params))
                if found:
                    break
            if not found:
                with _meta_lock:
                    store[k] = {"miss": True, "ts": time.time()}
                    _meta_save()
                return None
            m = {"litres_id": found["id"], "cover": f"https://cdn.litres.ru/pub/c/cover_415/{found['id']}.jpg",
                 "title": found.get("title"),
                 "readers": [p["full_name"] for p in found.get("persons") or [] if p.get("role") == "reader"][:6]}
        if full:
            d = _litres_get(f"arts/{m['litres_id']}") or {}
            m["description"] = _plain(d.get("html_annotation"))
            m["genres"] = [g["name"] for g in d.get("genres") or [] if g.get("name")][:6]
            rating = d.get("livelib_rated_avg") or (d.get("rating") or {}).get("rated_avg")
            m["rating"] = round(float(rating), 1) if rating else None
            m["written"] = (d.get("date_written_at") or "")[:4] or None
    except Exception:  # noqa: BLE001 — LitRes indisponibil: fără copertă, nu e o eroare
        return m if m and not m.get("miss") else None
    with _meta_lock:
        store[k] = m
        _meta_save()
    return m


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
    """(magnet, conținut .torrent) din versiunea aleasă; .torrent doar de pe Jackett."""
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


def add(source: dict) -> str:
    """Pune versiunea în coada de descărcare; întoarce infohash-ul."""
    try:
        magnet, content = _resolve(source)
    except SourceError:
        raise
    except Exception as e:  # noqa: BLE001
        raise SourceError(f"Nu pot descărca .torrent de pe Jackett: {e}") from e
    data = {"savepath": SAVE_DIR, "category": QB_CATEGORY, "tags": "cinema"}
    if magnet:
        m = re.search(r"btih:([0-9a-fA-F]{40})", magnet)
        if not m:
            raise SourceError("Magnet invalid")
        _qb("POST", "torrents/add", data={**data, "urls": magnet})
        return m.group(1).lower()
    try:
        h = _infohash_from_torrent(content)
    except Exception as e:  # noqa: BLE001
        raise SourceError("Jackett nu a returnat un fișier .torrent valid") from e
    _qb("POST", "torrents/add", data=data, files={"torrents": ("release.torrent", content, "application/x-bittorrent")})
    return h


def downloads() -> dict:
    """Starea descărcărilor (după infohash) + spațiul liber pe disc."""
    out = {}
    for t in _qb("GET", "torrents/info", params={"category": QB_CATEGORY}).json():
        out[t.get("hash")] = {
            "name": t.get("name"),
            "size": _human_size(int(t.get("size") or 0)) if t.get("size") else None,
            "size_bytes": int(t.get("size") or 0),
            "progress": round(float(t.get("progress") or 0), 4),
            "state": t.get("state"),
            "dl_bps": int(t.get("dlspeed") or 0) * 8,
            "eta": int(t.get("eta") or 0),
            "added_on": t.get("added_on"),
        }
    free = None
    try:
        free = _qb("GET", "sync/maindata").json().get("server_state", {}).get("free_space_on_disk")
    except SourceError:
        pass
    return {"torrents": out, "free": _human_size(int(free)) if free else None}


def remove(h: str) -> None:
    """Șterge din bibliotecă: torrentul și fișierele de pe disc."""
    if not _HASH.match(h or ""):
        raise SourceError("Hash invalid")
    _qb("POST", "torrents/delete", data={"hashes": h, "deleteFiles": "true"})


def _natural(s: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", s)]


def tracks(h: str) -> list[dict]:
    """Fișierele audio ale cărții, în ordinea firească (01, 02 … 10)."""
    if not _HASH.match(h or ""):
        raise SourceError("Hash invalid")
    files = _qb("GET", "torrents/files", params={"hash": h}).json()
    out = []
    for f in files:
        name = f.get("name") or ""
        if Path(name).suffix.lower() not in AUDIO_EXT:
            continue
        out.append({"index": f.get("index"), "path": name, "title": Path(name).stem,
                    "size": int(f.get("size") or 0), "done": float(f.get("progress") or 0) >= 1})
    out.sort(key=lambda x: _natural(x["path"]))
    return out


def track_path(h: str, index: int) -> Path:
    """Calea pe disc a unei piste, verificată să fie în folderul cărților audio."""
    t = next((t for t in tracks(h) if t["index"] == index), None)
    if not t:
        raise SourceError("Pistă inexistentă")
    root = media_root().resolve()
    p = (root / t["path"]).resolve()
    if not p.is_relative_to(root):
        raise SourceError("Cale invalidă")
    if not p.is_file():
        raise SourceError("Fișierul nu e încă descărcat")
    return p
