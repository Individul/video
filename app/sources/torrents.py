import asyncio
import hashlib
import re
import time
from urllib.parse import quote, unquote_plus, urlparse
from xml.etree import ElementTree

from app.config import Config
from app.sources.base import SourceError

_MAGNET_RE = re.compile(r"^magnet:\?xt=urn:btih:[a-fA-F0-9]{32,64}.*")
_SIZE_RE = re.compile(r"(\d+[.,]?\d*)\s*(GB|MB|TB)", re.I)
_NON_MEDIA_RE = re.compile(
    r"\b(pdf|mp3|flac|cbr|cbz|epub|djvu|docx?|xlsx?|pptx?|wav|mobi|azw3?)\b",
    re.I,
)

# ----------------- scoring release-uri (alegerea AUTO) -----------------

# marcheri de dublaj/voiceover rusesc în numele release-ului
_RU_AUDIO_RE = re.compile(
    r"дубля\w*|дублаж|дубл|многоголос\w*|закадров\w*|одноголос\w*|перевод|"
    r"jaskier|lostfilm|hdrezka|kerob|cubetelevision|кубик|parovoz|newstudio|alexfilm|"
    r"baibako|hamsterstudio|reedick|greenray|лиценз",
    re.I,
)
_CAM_RE = re.compile(r"[\s\._\(\[](?:cam|ts|telesync|screener|vhsrip|wp|workprint)[\s\._\)\]]", re.I)
_VIDEO_EXT_RE = re.compile(r"\.(mp4|mkv|avi|webm|mov|m4v|mpg|mpeg)$", re.I)


def _parse_size_gb(size: str | None) -> float | None:
    if not size:
        return None
    m = re.search(r"(\d+[.,]?\d*)\s*(TB|GB|MB|KB)", str(size), re.I)
    if not m:
        return None
    v = float(m.group(1).replace(",", "."))
    return v * {"TB": 1024.0, "GB": 1.0, "MB": 1 / 1024, "KB": 1 / 1024 / 1024}[m.group(2).upper()]


def quality_label(name: str) -> str | None:
    n = (name or "").lower()
    # „4K” doar ca marcaj separat: numele de grup „ELEKTRI4KA” nu e 4K (era 2,18 GB)
    if re.search(r"2160|(?<![a-zа-я0-9])4[kк](?![a-zа-я0-9])|\buhd\b", n):
        return "4K"
    if "1080" in n:
        return "1080p"
    if "720" in n:
        return "720p"
    if _CAM_RE.search(n):
        return "CAM"
    if re.search(r"dvd|dvdr", n):
        return "SD"
    return None


_HEVC_RE = re.compile(r"x\.?265|h\.?265|hevc")
_HDR_RE = re.compile(r"\bhdr|dolby.?vision|\bdv\b|\bdovi\b")
_AVC_RE = re.compile(r"x\.?264|h\.?264|\bavc\b")


def score_torrent(item: dict, query_year: int | None = None) -> tuple[float, str | None]:
    """Scor pentru alegerea AUTO, gândit pentru redare în browser: preferă dublaj RU,
    apoi 1080p H.264 (debit moderat, decodat de orice browser) + seederi.
    4K, HEVC/x265 și HDR/Dolby Vision rămân în listă, dar nu mai pornesc singure:
    debit de 2-3 ori mai mare și decodare nesigură în browser -> buffering.
    Penalizează camera (CAM), trailere, dimensiuni aberante și titlurile greșite."""
    name = item.get("name") or ""
    n = name.lower()
    score = 0.0
    q = quality_label(name)
    if q == "1080p":
        score += 5
    elif q == "4K":
        score += 3
    elif q == "720p":
        score += 3
    elif q == "CAM":
        score -= 25
    if _HEVC_RE.search(n):
        score -= 2  # Chrome/Firefox redau HEVC doar cu suport hardware, adesea deloc
    elif _AVC_RE.search(n):
        score += 1
    if _HDR_RE.search(n):
        score -= 2  # HDR/Dolby Vision: culori spălate sau ecran negru pe multe browsere
    if "remux" in n:
        score -= 3  # remux: debit uriaș + audio TrueHD/DTS pe care browserul nu-l redă
    elif re.search(r"web-?dl|blu-?ray|bdrip|bd-?rip", n):
        score += 2
    elif re.search(r"webrip|hdrip|hdtv|dvdrip", n):
        score += 1
    if has_ru_audio(name):
        # dominant: un release cu dublaj RU bate orice release EN de calitate mai bună
        score += 12
    if re.search(r"трейлер|trailer|промо|promo\b", n):
        score -= 20
    # titlu greșit: release-ul poartă alt an decât cel căutat (ex. remake-uri vechi)
    if query_year:
        years = {int(y) for y in re.findall(r"(?:19|20)\d{2}", name)}
        if years and query_year not in years:
            score -= 15
    size_gb = _parse_size_gb(item.get("size"))
    if size_gb is not None:
        if size_gb < 0.35:
            score -= 6  # suspect de mic pentru un film
        elif size_gb > 45:
            score -= 4  # remux 4K monștruos
    seeds = item.get("seeds") or 0
    score += min(4.0, ((seeds + 1) ** 0.5) / 2)
    return round(score, 2), q


# marcaje de tip RuTracker/Rutor pentru dublaj rusesc:
#  „Dub (Videofilm Int.)” — „Dub” simplu înseamnă dublaj RU; „Dub (Ukr)” e ucrainean
#  „| D |”, „| D, P, A |”, „| D | Videofilm” — litera D în lista de piste audio
_RU_DUB_WORD_RE = re.compile(r"\bdub\b(?!\s*\(\s*(?:ukr|укр|eng|англ|kaz|каз))", re.I)
_RU_DUB_MARK_RE = re.compile(r"[|\[]\s*(?:[A-ZА-Я]\d?\s*,\s*)*D(?:\s*,\s*[A-ZА-Я]\d?)*\s*(?=[|\]\-]|$)")


def has_ru_audio(name: str | None) -> bool:
    name = name or ""
    return bool(
        _RU_AUDIO_RE.search(name.lower()) or _RU_DUB_WORD_RE.search(name) or _RU_DUB_MARK_RE.search(name)
    )


def dedupe_results(items: list[dict]) -> list[dict]:
    """Elimină duplicatele pe toate sursele: același infohash = același torrent."""
    seen: set[str] = set()
    out: list[dict] = []
    for r in items:
        key = r.get("magnet") or r.get("torrent_url") or r.get("name") or ""
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def find_episode_file(files: list[dict], season: int, episode: int) -> int | None:
    """Indexul fișierului care corespunde EXACT episodului. Nivelul 1: tipare combinate
    (S02E05, 2x5, '3 сезон 1 серия', '407.avi'). Nivelul 2: sezonul apare în nume și
    episodul ca număr izolat ('07.08. Жуки.S04.2024...'). None dacă nimic nu se potrivește."""
    pats = [
        re.compile(rf"s0*{season}[\s._\-]?e0*{episode}(?!\d)", re.I),
        re.compile(rf"(?<!\d)0*{season}x0*{episode}(?!\d)", re.I),
        # sezon-și-episod în rusă sau transliterație, în ambele ordini:
        # „сезон 3 серия 1”, „3 сезон 1 серия”, „3.sezon.1.serija”
        re.compile(
            rf"(?:сезон|sezon|season)[\s._\-]*0*{season}(?!\d).*?0*{episode}[\s._\-]*(?:серия|сер|эпизод|seriya|serija|seria|episod\w*|episode)(?!\d)",
            re.I,
        ),
        re.compile(
            rf"0*{season}[\s._\-]*(?:сезон|sezon|season)[\s._\-].{{0,30}}?0*{episode}[\s._\-]*(?:серия|сер|эпизод|seriya|serija|seria|episod\w*|episode)(?!\d)",
            re.I,
        ),
        re.compile(rf"(?<!\d)0*{season}0*{episode:02d}(?!\d)"),  # 407.avi (sezon+episod concatenați)
    ]
    for i, f in enumerate(files):
        nm = f.get("name") or ""
        if any(p.search(nm) for p in pats):
            return i
    # nivelul 1.5: episod fără sezon în numele fișierului („Zhuki.e08.2019.mkv",
    # „серия 8") — sezonul e dat de pachet; ignorăm fișierele care poartă propriul
    # marker de sezon (ar fi din alt sezon)
    ep_only = [
        re.compile(rf"[\s._\-(\[]e0*{episode}(?!\d)", re.I),
        re.compile(rf"ep0*{episode}(?!\d)", re.I),
        re.compile(rf"0*{episode}\s*(?:серия|сер|выпуск)(?!\d)", re.I),
        re.compile(rf"(?:серия|выпуск)\s*0*{episode}(?!\d)", re.I),
    ]
    has_season_marker = re.compile(r"s0*\d+(?!\d)|(?<!\d)\d+x\d+|сезон|sezon|season", re.I)
    for i, f in enumerate(files):
        nm = f.get("name") or ""
        if has_season_marker.search(nm):
            continue
        if any(p.search(nm) for p in ep_only):
            return i
    # nivelul 2: „07.08. Жуки.S04.2024.WEB-DL...” — sezon + episod ca număr izolat
    season_pat = re.compile(rf"s0*{season}(?!\d)", re.I)
    ep_pat = re.compile(rf"(?<!\d)0*{episode}(?!\d)")
    for i, f in enumerate(files):
        nm = f.get("name") or ""
        if season_pat.search(nm) and ep_pat.search(nm):
            return i
    return None


def first_video_index(files: list[dict]) -> int | None:
    for i, f in enumerate(files):
        nm = f.get("name") or ""
        if not nm or _VIDEO_EXT_RE.search(nm):
            return i
    return None


def pick_file_index(files: list[dict], season: int, episode: int) -> int | None:
    """Compat: potrivire exactă, altfel primul fișier video."""
    idx = find_episode_file(files, season, episode)
    return idx if idx is not None else first_video_index(files)


def seasons_in_name(name: str) -> list[tuple[int, int]]:
    """Sezoanele declarate în numele release-ului, ca intervale (de la, până la):
    'S4E1-17' -> [(4, 4)], 'S01-04E01-65' / '[S1-4 + …]' -> [(1, 4)], '1-3 сезон' -> [(1, 3)], '2x05' -> [(2, 2)]."""
    n = (name or "").lower()
    out: list[tuple[int, int]] = []
    for x, y in re.findall(r"(?<![a-zа-я0-9])s0*(\d{1,2})\s*-\s*s?0*(\d{1,2})(?!\d)", n):
        out.append((int(x), int(y)))
    for x, y in re.findall(r"(?<!\d)(\d{1,2})\s*-\s*(\d{1,2})\s*(?:сезон|sezon|season)", n):
        out.append((int(x), int(y)))
    for x, y in re.findall(r"(?:сезон[ыиа]?|seasons?)\s*(\d{1,2})\s*-\s*(\d{1,2})(?!\d)", n):
        out.append((int(x), int(y)))
    singles = (
        re.findall(r"(?<![a-zа-я0-9])s0*(\d{1,2})(?!\d)\s*[\s._\-]?e", n)
        + re.findall(r"(?<!\d)0*(\d{1,2})x\d", n)
        + re.findall(r"(?<![\d-])0*(\d{1,2})\s*(?:сезон|sezon|season)", n)
        + re.findall(r"(?:сезон|sezon|season)\s*0*(\d{1,2})(?![\d-])", n)
    )
    out += [(int(x), int(x)) for x in singles]
    return [(min(x, y), max(x, y)) for x, y in out]


def pack_mentions_season(name: str, season: int) -> bool:
    """Numele release-ului (pachetului) conține sezonul dat?
    ex: 'S4E1-17 of 17', 'Жуки 3 сезон', '4x01', 'S1-4 + 2 фильма'."""
    return any(x <= season <= y for x, y in seasons_in_name(name))


def names_other_season(name: str, season: int) -> bool:
    """Release-ul declară alte sezoane, nu pe acesta (ex. 'S2E1-16' când cauți sezonul 4)."""
    found = seasons_in_name(name)
    return bool(found) and not any(x <= season <= y for x, y in found)


# cache in-memory pentru rezultatele de căutare magneți (15 min)
_SEARCH_CACHE: dict[str, tuple[float, list[dict]]] = {}
_SEARCH_CACHE_TTL = 900.0


def _mk_headers() -> dict:
    return {"User-Agent": Config.USER_AGENT}


def _proxies() -> dict | None:
    """Proxy opțional pentru sursele web (datacenter IP-urile sunt blocate adesea)."""
    return {"http": Config.PROXY, "https": Config.PROXY} if Config.PROXY else None


# ----------------- TorrServer: autentificare opțională -----------------

def same_origin(url: str, base: str | None) -> bool:
    """True doar dacă `url` e http(s) și are exact schema, hostul și portul lui `base`
    (credențialele user:parolă@ sunt ignorate)."""
    if not base:
        return False
    try:
        u, b = urlparse(url), urlparse(base)
        u_port = u.port or (443 if u.scheme == "https" else 80)
        b_port = b.port or (443 if b.scheme == "https" else 80)
    except ValueError:
        return False
    return (
        u.scheme in ("http", "https")
        and u.scheme == b.scheme
        and bool(u.hostname)
        and u.hostname == b.hostname
        and u_port == b_port
    )


def ts_auth() -> tuple[str, str] | None:
    """(user, parolă) dacă TorrServer-ul e protejat de parolă."""
    if not Config.TORRSERVER_AUTH or ":" not in Config.TORRSERVER_AUTH:
        return None
    user, _, pw = Config.TORRSERVER_AUTH.partition(":")
    return (user, pw)


def ts_stream_url(url: str) -> str:
    """URL-ul de stream predat browserului.

    Cu STREAM_PROXY_PATH (VPS): cale relativă la portal (/ts/stream/...), pe care Caddy
    o trimite la TorrServer-ul intern după ce verifică autentificarea — parola TorrServer
    nu ajunge în browser. Altfel (local): URL-ul direct, cu credențialele înglobate."""
    if Config.STREAM_PROXY_PATH:
        u = urlparse(url)
        return f"{Config.STREAM_PROXY_PATH}{u.path}" + (f"?{u.query}" if u.query else "")
    auth = ts_auth()
    if not auth:
        return url
    prefix = f"{Config.TORRSERVER_URL.split('://', 1)[0]}://"
    if url.startswith(f"{prefix}{auth[0]}:"):
        return url  # deja înglobat
    return url.replace(prefix, f"{prefix}{auth[0]}:{auth[1]}@", 1)


def ts_internal_url(url: str) -> str:
    """Inversul lui ts_stream_url pentru căile proxy: /ts/stream/... -> TORRSERVER_URL/stream/...
    (serverul vorbește direct cu TorrServer-ul intern). Restul URL-urilor rămân neschimbate."""
    prefix = Config.STREAM_PROXY_PATH
    if prefix and url.startswith(prefix + "/"):
        return Config.TORRSERVER_URL + url[len(prefix):]
    return url


# ----------------- Jackett / Torznab (optional, normalizat) -----------------

def _torznab_configured() -> bool:
    return bool(Config.TORZNAB_URL and Config.TORZNAB_API_KEY)


def _parse_torznab(xml_bytes: bytes) -> list[dict]:
    """Parsează răspunsul Torznab (XML) -> intrări normalizate."""
    root = ElementTree.fromstring(xml_bytes)
    out: list[dict] = []
    for item in root.iter("item"):
        title = item.findtext("title") or ""
        size = (item.findtext("size") or "").strip()
        link_el = item.findtext("link") or ""
        guid = item.findtext("guid") or ""
        # Jackett foloseste namespace torznab:attr (si pe unii feed-uri attr simplu)
        attrs = {}
        cats: list[str] = []  # „category” se repetă (categoria standard + cea a trackerului)
        for a in item.iter():
            tag = a.tag.rsplit("}", 1)[-1]  # scoate {ns} prefixul
            if tag == "attr" and a.get("name"):
                attrs[a.get("name")] = a.get("value") or ""
                if a.get("name") == "category" and a.get("value"):
                    cats.append(a.get("value"))
        seeds = attrs.get("seeders")
        magnet = attrs.get("magneturl") or None
        torrent_url = None
        link = link_el or guid
        if link.startswith("magnet:"):
            magnet = magnet or link
        elif link:
            torrent_url = link

        if not magnet and not torrent_url:
            continue
        magnet_short = None
        if magnet:
            m = re.search(r"urn:btih:([a-fA-F0-9]{32,64})", magnet)
            magnet_short = f"magnet:?xt=urn:btih:{m.group(1).lower()}" if m else magnet

        out.append({
            "name": title,
            "magnet": magnet_short,
            "torrent_url": torrent_url,
            "size": _human_size(int(size)) if size.isdigit() else (size or None),
            "seeds": int(seeds) if seeds and seeds.isdigit() else None,
            "source": "jackett",
            "indexer": attrs.get("jackettindexer") or attrs.get("jackettindexers") or attrs.get("indexer") or None,
            "published": _iso_date(item.findtext("pubDate")),
            "cats": cats,
        })
    return out


def _iso_date(rfc822: str | None) -> str | None:
    """„Sat, 17 Oct 2026 22:00:00 +0300” -> „2026-10-17T22:00:00+03:00” (pentru sortare)."""
    from email.utils import parsedate_to_datetime

    try:
        return parsedate_to_datetime(rfc822).isoformat() if rfc822 else None
    except (TypeError, ValueError):
        return None


_TORZNAB_INDEXER_CACHE: list[tuple[str, str]] = []
_TORZNAB_INDEXER_TS = 0.0


def _torznab_indexer_list() -> list[tuple[str, str]]:
    """[(id, nume-scurt)] pentru indexeri configurați în Jackett; cache 10 min."""
    import time as _time

    global _TORZNAB_INDEXER_CACHE, _TORZNAB_INDEXER_TS
    import requests
    from xml.etree import ElementTree

    if _TORZNAB_INDEXER_CACHE and _time.time() - _TORZNAB_INDEXER_TS < 600:
        return _TORZNAB_INDEXER_CACHE
    url = (
        f"{Config.TORZNAB_URL.rstrip('/')}/api/v2.0/indexers/all/results/torznab/api"
        f"?apikey={Config.TORZNAB_API_KEY}&t=indexers"
    )
    out: list[tuple[str, str]] = []
    try:
        # Jackett e serviciu intern (docker) — niciodată prin PROXY-ul extern
        r = requests.get(url, headers=_mk_headers(), timeout=15)
        r.raise_for_status()
        root = ElementTree.fromstring(r.content)
        for ix in root.iter("indexer"):
            if ix.get("configured") == "true":
                idx_id = ix.get("id") or "all"
                title = (ix.findtext("title") or idx_id).split(".")[0].strip()
                out.append((idx_id, title))
    except Exception:  # noqa: BLE001 — cădem pe „all"
        pass
    if not out:
        # Jackett indisponibil (ex. tocmai pornește): rezerva „all” se ține doar 30 s,
        # nu 10 min — altfel căutările ar rămâne lente mult după ce Jackett și-a revenit
        out = [(Config.TORZNAB_INDEXER or "all", "jackett")]
        _TORZNAB_INDEXER_CACHE, _TORZNAB_INDEXER_TS = out, _time.time() - 570
        return out
    _TORZNAB_INDEXER_CACHE, _TORZNAB_INDEXER_TS = out, _time.time()
    return out


def _torznab_one(idx: tuple[str, str], query: str, limit: int, timeout: float = 25) -> list[dict]:
    """Căutare pe un singur indexer Jackett; rezultatele poartă numele sursei."""
    import requests

    idx_id, label = idx
    url = (
        f"{Config.TORZNAB_URL.rstrip('/')}/api/v2.0/indexers/{idx_id}/results/torznab/api"
        f"?apikey={Config.TORZNAB_API_KEY}&q={quote(query)}&limit={limit}"
    )
    r = requests.get(url, headers=_mk_headers(), timeout=timeout)
    r.raise_for_status()
    out = _parse_torznab(r.content)
    for x in out:
        x["indexer"] = label
    return out


def _search_torznab(query: str, limit: int) -> list[dict]:
    """Interogare Torznab (Jackett) pe fiecare indexer configurat, în paralel.
    Rezultatele poartă numele sursei; un indexer lent/căzut nu blochează restul."""
    from concurrent.futures import ThreadPoolExecutor

    def _one(idx: tuple[str, str]) -> list[dict]:
        return _torznab_one(idx, query, limit)

    results: list[dict] = []
    indexers = _torznab_indexer_list()
    with ThreadPoolExecutor(max_workers=min(6, len(indexers))) as pool:
        futures = [pool.submit(_try_indexer, _one, idx) for idx in indexers]
        for f in futures:
            results.extend(f.result())
    results.sort(key=lambda r: (r.get("seeds") or 0), reverse=True)
    return results


def raw_search_sync(query: str, wait_s: float = 15.0, limit: int = 200) -> dict:
    """Căutare liberă în toate trackerele (pagina „Torrente”), fără catalogul TMDB și
    fără filtrul de filme: orice text, orice categorie. Sursele care nu răspund în
    `wait_s` secunde sunt raportate ca „lente” — nu țin pe loc rezultatele celorlalte."""
    from concurrent.futures import ThreadPoolExecutor, wait

    indexers = _torznab_indexer_list() if _torznab_configured() else []
    pool = ThreadPoolExecutor(max_workers=8)
    jobs = {pool.submit(_torznab_one, idx, query, 100, wait_s + 5): idx[1] for idx in indexers}
    jobs[pool.submit(_rutor_or_empty, query)] = "RuTor (direct)"
    done, pending = wait(list(jobs), timeout=wait_s)
    pool.shutdown(wait=False, cancel_futures=True)

    results: list[dict] = []
    failed: list[str] = []
    for f in done:
        try:
            results.extend(f.result())
        except Exception:  # noqa: BLE001 — o sursă căzută nu strică restul
            failed.append(jobs[f])
    slow = sorted(jobs[f] for f in pending)
    results = dedupe_results(results)
    for r in results:
        q = quality_label(r.get("name") or "")
        r["quality"] = q or ""
        r["dub"] = "RU" if has_ru_audio(r.get("name")) else ""
    results.sort(key=lambda r: (r.get("seeds") or 0), reverse=True)
    return {"results": results[:limit], "slow": slow, "failed": sorted(failed)}


def _rutor_or_empty(query: str) -> list[dict]:
    """Rutor direct; „niciun rezultat” nu e o eroare a sursei."""
    try:
        return _search_mirrors(query)
    except SourceError as e:
        if "goale" in str(e):
            return []
        raise


async def raw_search(query: str) -> dict:
    return await asyncio.to_thread(raw_search_sync, query)


def _try_indexer(fn, idx) -> list[dict]:
    try:
        return fn(idx)
    except Exception:  # noqa: BLE001 — indexer individual căzut
        return []


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.2f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024.0
    return f"{n:.2f} TB"


# ----------------- bencode minimal: .torrent -> infohash -----------------

def _bencode(data) -> bytes:
    if isinstance(data, int):
        return b"i%de" % data
    if isinstance(data, bytes):
        return str(len(data)).encode() + b":" + data
    if isinstance(data, str):
        b = data.encode()
        return str(len(b)).encode() + b":" + b
    if isinstance(data, list):
        return b"l" + b"".join(_bencode(i) for i in data) + b"e"
    if isinstance(data, dict):
        items = sorted(data.items())
        return b"d" + b"".join(_bencode(k) + _bencode(v) for k, v in items) + b"e"
    raise ValueError("tip bencode nesuportat")


def _bdecode(buf: bytes, pos: int = 0):
    c = buf[pos:pos + 1]
    if c == b"i":
        end = buf.index(b"e", pos)
        return int(buf[pos + 1:end]), end + 1
    if c == b"l":
        pos += 1
        out = []
        while buf[pos:pos + 1] != b"e":
            val, pos = _bdecode(buf, pos)
            out.append(val)
        return out, pos + 1
    if c == b"d":
        pos += 1
        out = {}
        while buf[pos:pos + 1] != b"e":
            key, pos = _bdecode(buf, pos)
            val, pos = _bdecode(buf, pos)
            out[key] = val
        return out, pos + 1
    m = re.match(rb"(\d+):", buf[pos:])
    if not m:
        raise ValueError("bencode invalid")
    ln = int(m.group(1))
    start = pos + m.end()
    return buf[start:start + ln], start + ln


def _infohash_from_torrent(data: bytes) -> str:
    """sha1 al dict-ului b'info' din .torrent -> infohash hex (40 chars)."""
    decoded, _ = _bdecode(data)
    info = decoded[b"info"]
    return hashlib.sha1(_bencode(info)).hexdigest()


# ----------------- cautare pe Rutor -----------------

def _parse_rutor(html: str) -> list[dict]:
    """Parsare tolerant pagina cu rezultate Rutor: randuri cu link magnet."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=_MAGNET_RE):
        magnet = a["href"].split("&")[0]  # magnet simplu (btih)
        row = a.find_parent("tr")
        if not row:
            continue
        # titlul e link-ul /torrent/<id>/... (nu iconita de download / magnet)
        title_a = row.find("a", href=re.compile(r"^/torrent/\d+"))
        name = (title_a.get_text(strip=True) if title_a else a.get_text(strip=True)) or ""
        size_m = _SIZE_RE.search(row.get_text(" ", strip=True))
        seeds = None
        green = row.select_one("span.green")  # seederi pe rutor (span verde)
        if green:
            ms = re.search(r"(\d+)", green.get_text(" ", strip=True))
            if ms:
                seeds = int(ms.group(1))
        if not name or magnet in seen:
            continue
        seen.add(magnet)
        out.append(
            {"name": name, "magnet": magnet, "size": size_m.group(0) if size_m else None,
             "seeds": seeds, "source": "rutor"}
        )
    return out


def _search_rutor_once(mirror: str, query: str) -> list[dict]:
    import requests

    r = requests.get(f"{mirror}search/{query}", headers=_mk_headers(), proxies=_proxies(), timeout=20)
    r.raise_for_status()
    return _parse_rutor(r.text)


def _search_mirrors(query: str) -> list[dict]:
    last_err: Exception | None = None
    for mirror in Config.RUTOR_MIRRORS:
        m = mirror.rstrip("/") + "/"
        try:
            hits = _search_rutor_once(m, query)
            if hits:
                return hits
            last_err = SourceError(f"{m}: rezultate goale")
        except Exception as e:  # noqa: BLE001 — incercam urmatorul mirror
            last_err = e
    raise last_err or SourceError("Niciun mirror Rutor configurat")


async def search_torrents(query: str, limit: int | None = None) -> list[dict]:
    limit = limit or Config.TORRENT_LIMIT
    # cache scurt: evităm bombardarea surselor la fiecare deschidere de detaliu
    cache_key = f"{query.lower()}|{limit}"
    cached = _SEARCH_CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _SEARCH_CACHE_TTL:
        return cached[1]

    parts = query.split()
    stripped = " ".join(parts[:-1]) if (len(parts) > 1 and parts[-1].isdigit()) else None

    async def _jackett() -> list[dict]:
        if not _torznab_configured():
            return []
        try:
            return await asyncio.to_thread(_search_torznab, query, limit) or []
        except Exception:  # noqa: BLE001 — best-effort
            return []

    async def _rutor() -> list[dict]:
        # pe Rutor căutarea "frază" cu an dă adesea zero -> fallback fără an
        for q in (query, stripped):
            if not q:
                continue
            try:
                return await asyncio.to_thread(_search_mirrors, q) or []
            except Exception:  # noqa: BLE001 — încercăm varianta următoare
                continue
        return []

    # Jackett (trackere internaționale) + Rutor (trackere RU cu dublaj) în paralel,
    # apoi deduplicare pe infohash — scoring-ul decide câștigătorul, nu ordinea sursei
    jackett_res, rutor_res = await asyncio.gather(_jackett(), _rutor())
    results = dedupe_results([*jackett_res, *rutor_res])

    if not results:  # fallback DHT (BTDig) când ambele sunt goale
        try:
            results = await asyncio.to_thread(_search_provider_btdig, query) or []
        except Exception:  # noqa: BLE001 — btdig e best-effort
            results = []
    results = relevant(_filter_media(_not_audio_or_books(results)), query)
    if not results:
        raise SourceError(f"Niciun rezultat de torrent pentru '{query}'")

    # scor + sortare: cel mai bun release primul
    query_year = int(parts[-1]) if parts and parts[-1].isdigit() else None
    annotated = []
    for r in results:
        score, q = score_torrent(r, query_year)
        annotated.append({
            **r,
            "score": score,
            "quality": q or "",
            "dub": "RU" if has_ru_audio(r.get("name")) else "",
        })
    annotated.sort(key=lambda r: r["score"], reverse=True)
    annotated = annotated[:limit]
    _SEARCH_CACHE[cache_key] = (time.monotonic(), annotated)
    return annotated


def _not_audio_or_books(results: list[dict]) -> list[dict]:
    """Versiunile unui film/serial: fără albume și cărți (categoriile Torznab 3xxx Audio, 7xxx Books),
    ex. „[TR24][OF] Masterplan - Metalmorphosis” la filmul „Masterplan”. Pagina „Torrente” le păstrează."""
    out = []
    for r in results:
        std = [c for c in r.pop("cats", None) or [] if len(c) == 4]  # categoriile standard (nu ale trackerului)
        if std and all(c[0] in "37" for c in std):
            continue
        out.append(r)
    return out


def searchable(text: str | None) -> bool:
    """Are litere latine sau chirilice? Rutor ignoră restul („호프 2026” devine „2026”)."""
    return bool(re.search(r"[a-zA-Zа-яА-ЯёЁ]", text or ""))


def relevant(results: list[dict], query: str) -> list[dict]:
    """Doar rezultatele care conțin măcar un cuvânt din căutare (în afară de an): o sursă care
    nu înțelege căutarea întoarce ultimele apariții, iar fără filtru le-am lua drept versiuni."""
    words = [w for w in re.findall(r"\w+", query.lower().replace("ё", "е")) if len(w) >= 2 and not w.isdigit()]
    if not words:
        return results
    return [r for r in results if any(w in (r.get("name") or "").lower().replace("ё", "е") for w in words)]


def _filter_media(results: list[dict]) -> list[dict]:
    return [r for r in results if not _NON_MEDIA_RE.search(r["name"])]


# ----------------- BTDig (fallback DHT) -----------------

def _parse_btdig(html: str) -> list[dict]:
    """BTDig: fiecare rezultat are un link magnet; numele vine din dn=, dimensiunea
    din liseful 'X fisiere / SIZE' al grupei."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=_MAGNET_RE):
        full = a["href"]
        base = full.split("&")[0]
        if base in seen:
            continue
        m_dn = re.search(r"[?&]dn=([^&]+)", full)
        name = unquote_plus(m_dn.group(1)) if m_dn else "torrent"
        size = None
        block = a.find_parent("div", style=re.compile("table-row")) or a.find_parent("div")
        if block:
            m_size = _SIZE_RE.search(block.get_text(" ", strip=True))
            if m_size:
                size = m_size.group(0)
        seen.add(base)
        out.append({"name": name, "magnet": base, "size": size, "seeds": None, "source": "btdig"})
    return out


def _search_provider_btdig(query: str) -> list[dict]:
    import requests

    r = requests.get(
        f"https://btdig.com/0/order/1/?q={quote(query)}",
        headers=_mk_headers(),
        proxies=_proxies(),
        timeout=25,
    )
    r.raise_for_status()
    return _parse_btdig(r.text)


# ----------------- TorrServer (MatriX, m3u-based) -----------------

_BTILH_RE = re.compile(r"urn:btih:([a-fA-F0-9]{32,64})")


def _hash_from_magnet(magnet: str) -> str:
    m = _BTILH_RE.search(magnet)
    if not m:
        raise SourceError("Magnetul nu are un info hash valid")
    return m.group(1).lower()


def _torrent_m3u_once(h: str) -> tuple[list[dict], str | None]:
    """GET /stream/playlist.m3u?link=<hash>&m3u — inregistreaza torrentul si
    intoarce lista de fisiere (nume + index + URL stream absolut)."""
    import requests

    r = requests.get(
        f"{Config.TORRSERVER_URL}/stream/playlist.m3u?link={h}&m3u",
        headers={"User-Agent": Config.USER_AGENT},
        auth=ts_auth(),
        timeout=(5, 120),
    )
    r.raise_for_status()
    text = r.text
    files: list[dict] = []
    last_name: str | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            last_name = line.split(",", 1)[1].strip() if "," in line else None
        elif line.startswith("http") and "/stream/" in line:
            m_idx = re.search(r"(?:^|[?&])index=(\d+)", line)
            files.append({
                "index": int(m_idx.group(1)) if m_idx else len(files),
                "name": last_name or line.rsplit("/", 1)[-1].split("?")[0],
                "url": line,
            })
            last_name = None
    return files, text or None


async def torrserver_play(
    source: dict | str,
    index: int = 0,
    season: int | None = None,
    episode: int | None = None,
) -> dict:
    """Adauga torrentul in TorrServer (MatriX, prin .m3u) si intoarce fișierele
    plus URL-ul de direct-stream al ferestrei selectate.

    source poate fi: magnet str SAU dict {magnet?, torrent_url?} (din Jackett).
    Dacă se dau season/episode, alege automat fișierul potrivit episodului."""
    magnet = None
    if isinstance(source, dict):
        magnet = source.get("magnet")
        torrent_url = source.get("torrent_url")
    else:
        magnet = source
        torrent_url = None

    if not magnet:
        if not torrent_url:
            raise SourceError("Niciun magnet și niciun .torrent")
        # .torrent (Jackett/RuTracker) -> infohash; doar de pe Jackett-ul configurat
        if not same_origin(torrent_url, Config.TORZNAB_URL):
            raise SourceError("Link .torrent nepermis (acceptat doar de pe Jackett/TORZNAB_URL)")

        def _download() -> bytes | str:
            import requests

            # fără redirect automat: unii indexeri din Jackett redirecționează /dl/ spre magnet:
            r = requests.get(torrent_url, headers=_mk_headers(), timeout=40, allow_redirects=False)
            location = r.headers.get("Location", "")
            if r.is_redirect and location.startswith("magnet:"):
                return location
            if r.is_redirect:
                r = requests.get(torrent_url, headers=_mk_headers(), timeout=40)
            r.raise_for_status()
            return r.content

        try:
            content = await asyncio.to_thread(_download)
        except Exception as e:  # noqa: BLE001 — rețea/HTTP -> 502 cu mesaj, nu 500
            raise SourceError(f"Nu pot descărca .torrent de pe Jackett: {e}") from e
        if isinstance(content, str):
            magnet = content
            h = _hash_from_magnet(magnet)
        else:
            try:
                h = _infohash_from_torrent(content)
            except Exception as e:  # noqa: BLE001 — răspuns care nu e .torrent valid
                raise SourceError("Jackett nu a returnat un fișier .torrent valid") from e
            magnet = f"magnet:?xt=urn:btih:{h}"
    else:
        h = _hash_from_magnet(magnet)

    try:
        files, _ = await asyncio.to_thread(_torrent_m3u_once, h)
    except Exception as e:  # noqa: BLE001
        raise SourceError(
            f"TorrServer nu raspunde la {Config.TORRSERVER_URL} ({e}). "
            "porneste TorrServer (vezi README) sau ajusteaza TORRSERVER_URL in .env."
        ) from e
    if not files:
        raise SourceError("TorrServer nu a returnat fluxuri — torrentul nu e găsit / seed zero")
    await asyncio.to_thread(_attach_file_sizes, h, files)
    index = max(0, min(index, max(0, len(files) - 1)))
    matched = False
    if season is not None and episode is not None:
        ep_index = find_episode_file(files, season, episode)
        if ep_index is not None:
            index, matched = ep_index, True
        else:
            fallback = first_video_index(files)
            if fallback is not None:
                index = fallback
    file = files[index]
    return {
        "name": file["name"],
        "files": [{**f, "url": ts_stream_url(f["url"])} for f in files],
        "stream_url": ts_stream_url(file["url"]),
        "index": file["index"],
        "size": file.get("size"),  # bytes; None dacă TorrServer nu a raportat
        "hash": h,
        "matched": matched,
    }


# ----------------- TorrServer: gospodărire cache (pagina Descărcări) -----------------

def _ts_request(action: str, torrent_hash: str | None = None):
    import requests

    body: dict = {"action": action}
    if torrent_hash:
        body["hash"] = torrent_hash
    r = requests.post(
        f"{Config.TORRSERVER_URL}/torrents",
        json=body,
        headers={"User-Agent": Config.USER_AGENT},
        auth=ts_auth(),
        timeout=10,
    )
    r.raise_for_status()
    try:
        return r.json()
    except ValueError:
        return None


async def list_downloads() -> list[dict]:
    """Torrenții ținuți în cache de TorrServer."""
    def _run() -> list[dict]:
        items = _ts_request("list") or []
        out = []
        for t in items:
            speed = t.get("download_speed") or 0
            out.append({
                "hash": t.get("hash"),
                "name": t.get("title") or t.get("name") or "?",
                "size": _human_size(t.get("torrent_size") or 0),
                "status": t.get("stat_string") or "",
                "speed": f"{speed / 1024 / 1024:.2f} MB/s" if speed else "",
                "timestamp": t.get("timestamp"),
            })
        return out

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:  # noqa: BLE001
        raise SourceError(
            f"TorrServer nu raspunde la {Config.TORRSERVER_URL} ({e}). "
            "Porneste TorrServer sau ajusteaza TORRSERVER_URL in .env."
        ) from e


async def torrent_stats(torrent_hash: str) -> dict:
    """Starea torrentului care rulează (panoul „Stare” din player): viteză, peers,
    cât e încărcat în avans în cache — ca să se vadă de unde vine un eventual buffering."""
    if not _HASH_RE.match(torrent_hash or ""):
        raise SourceError("Hash de torrent invalid")
    try:
        t = await asyncio.to_thread(_ts_request, "get", torrent_hash.lower()) or {}
    except Exception as e:  # noqa: BLE001
        raise SourceError(f"TorrServer nu răspunde ({e}).") from e

    def _cache() -> dict:
        import requests

        r = requests.post(
            f"{Config.TORRSERVER_URL}/cache", json={"action": "get", "hash": torrent_hash.lower()},
            headers={"User-Agent": Config.USER_AGENT}, auth=ts_auth(), timeout=10,
        )
        r.raise_for_status()
        return r.json() or {}

    try:  # capacitatea și umplerea cache-ului vin din /cache, nu din /torrents
        cache = await asyncio.to_thread(_cache)
    except Exception:  # noqa: BLE001 — informație în plus, nu obligatorie
        cache = {}
    return {
        "cache_capacity": cache.get("Capacity") or 0,
        "cache_filled": cache.get("Filled") or 0,
        "status": t.get("stat_string") or "",
        "download_bps": int((t.get("download_speed") or 0) * 8),
        "upload_bps": int((t.get("upload_speed") or 0) * 8),
        "peers_active": t.get("active_peers") or 0,
        "peers_total": t.get("total_peers") or 0,
        "seeders": t.get("connected_seeders") or 0,
        "preloaded": t.get("preloaded_bytes") or 0,  # cât e încărcat înaintea poziției curente
        "read": t.get("bytes_read") or 0,
        "size": t.get("torrent_size") or 0,
    }


def _attach_file_sizes(h: str, files: list[dict]) -> None:
    """Adaugă `size` (bytes) fiecărui fișier, din file_stats-ul TorrServer (best-effort).
    Frontendul decide după mărime dacă extrage automat subtitrările din MKV."""
    try:
        info = _ts_request("get", h) or {}
        sizes = {fs.get("id"): fs.get("length") for fs in info.get("file_stats") or []}
    except Exception:  # noqa: BLE001 — fără mărimi, frontendul tratează fișierul ca mare
        return
    for f in files:
        if sizes.get(f["index"]):
            f["size"] = sizes[f["index"]]


_HASH_RE = re.compile(r"^[a-fA-F0-9]{40}$|^[a-fA-F0-9]{64}$")


async def drop_torrent(torrent_hash: str) -> None:
    """Deconectează torrentul (nu mai descarcă/urcă), dar îl păstrează în listă și în cache.
    Folosit când închizi player-ul sau treci la altă versiune."""
    if not _HASH_RE.match(torrent_hash or ""):
        raise SourceError("Hash de torrent invalid")
    try:
        await asyncio.to_thread(_ts_request, "drop", torrent_hash.lower())
    except Exception as e:  # noqa: BLE001
        raise SourceError(f"TorrServer nu a putut opri torrentul ({e}).") from e


async def remove_download(torrent_hash: str) -> None:
    def _run() -> None:
        _ts_request("rem", torrent_hash)

    try:
        await asyncio.to_thread(_run)
    except Exception as e:  # noqa: BLE001
        raise SourceError(f"TorrServer nu a putut șterge torrentul ({e}).") from e
