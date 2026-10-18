"""Evenimente sportive de pe pimpletv.ru pentru pagina „Live”.

Site-ul listează meciurile (fotbal, hochei…) cu oră, ligă, echipe și canalul TV;
pagina fiecărui meci conține exact un link acestream://<id>. Parsăm lista de pe
prima pagină la cerere (cache scurt — minutele meciurilor live se schimbă), iar
ID-ul îl aducem abia la pornirea redării (o singură pagină în plus, doar la click).
Orele de pe site sunt ora Moscovei (UTC+3).
"""

import re
import time
from urllib.parse import urlparse

from app.config import Config
from app.sources.base import SourceError

BASE = "https://www.pimpletv.ru"
_HOSTS = {"pimpletv.ru", "www.pimpletv.ru"}
_EVENT_PATH = re.compile(r"^/[a-z]+/\d+-[0-9a-z\-]+/$", re.I)
_ID_RE = re.compile(r"acestream://([0-9a-f]{40})", re.I)
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

_CACHE_TTL = 60  # minutele meciurilor live se tot schimbă
_cache: tuple[float, list[dict]] | None = None

# cuvinte-cheie din numele ligii -> codul steagului pe flagcdn.com (stema, ca să
# prindă și cazurile declinate: „Профессиональная лига Аргентины”, „Серия А Италия”).
# Cele UEFA le pun la urmă: dacă în nume apare și o țară, câștigă țara.
_FLAGS: tuple[tuple[str, str], ...] = (
    ("росси", "ru"), ("кхл", "ru"),
    ("англи", "gb-eng"), ("испан", "es"), ("итал", "it"),
    ("герман", "de"), ("бундеслиг", "de"), ("франц", "fr"), ("португ", "pt"),
    ("нидерланд", "nl"), ("голланд", "nl"), ("турц", "tr"), ("шотланд", "gb-sct"),
    ("украин", "ua"), ("беларус", "by"), ("казахстан", "kz"), ("бразил", "br"),
    ("аргентин", "ar"), ("сша", "us"), ("кита", "cn"), ("япон", "jp"),
    ("саудовск", "sa"), ("молдов", "md"), ("румын", "ro"), ("грец", "gr"),
    ("швейцар", "ch"), ("австри", "at"), ("дания", "dk"), ("швеци", "se"),
    ("норвег", "no"), ("финлянд", "fi"), ("чехи", "cz"), ("польш", "pl"),
    ("серб", "rs"), ("хорват", "hr"), ("болгар", "bg"), ("венгр", "hu"),
    ("уефа", "eu"), ("лига чемпионов", "eu"), ("лига европы", "eu"),
)


def flag_of(league: str) -> str | None:
    """Steagul campionatului după numele ligii; None = fără steag (ligi internaționale etc.)."""
    l = (league or "").lower()
    for kw, code in _FLAGS:
        if kw in l:
            return code
    return None


def _get(url: str, timeout: float = 20) -> str:
    import requests

    proxies = {"http": Config.PROXY, "https": Config.PROXY} if Config.PROXY else None
    r = requests.get(url, timeout=timeout, headers={"User-Agent": _UA}, proxies=proxies)
    r.raise_for_status()
    return r.text


def parse_events(html: str) -> list[dict]:
    """Lista `a.match-item` în ordinea din pagină, cu ziua curentă (`div.streams-day`).

    `when` e textul brut de pe site: minutul live („63'”), „Перерыв” sau ora de
    start („15:00”); `is_live` marchează meciul aflat în desfășurare.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    day = ""
    for el in soup.select(".streams-day, a.match-item"):
        if "streams-day" in (el.get("class") or []):
            day = el.get_text(" ", strip=True)
            continue
        href = (el.get("href") or "").strip()
        if not _EVENT_PATH.match(href):
            continue
        date_el = el.select_one(".match-item__title-date")
        when = " ".join(date_el.get_text(" ", strip=True).split()) if date_el else ""
        is_live = bool("liveTime" in (date_el.get("class") or [])) if date_el else False
        is_live = is_live or when == "Перерыв" or when.endswith("'")

        def _txt(sel: str) -> str:
            n = el.select_one(sel)
            return " ".join(n.get_text(" ", strip=True).split()) if n else ""

        sport = href.strip("/").split("/", 1)[0]
        league = _txt(".match-item__title-tournament")
        out.append({
            "url": f"{BASE}{href}",
            "sport": sport,
            "league": league,
            "flag": flag_of(league),
            "home": _txt(".table-item__home-name"),
            "away": _txt(".table-item__away-name"),
            "channel": _txt(".match-item__logo-channel"),
            "when": when,
            "is_live": is_live,
            "day": day,
        })
    return out


def events() -> list[dict]:
    global _cache
    if _cache and time.time() - _cache[0] < _CACHE_TTL:
        return _cache[1]
    out = parse_events(_get(BASE))
    _cache = (time.time(), out)
    return out


def extract_ids(html: str) -> list[str]:
    """Toate ID-urile Ace Stream din pagina unui meci, fără duplicate."""
    return list(dict.fromkeys(m.group(1).lower() for m in _ID_RE.finditer(html)))


def resolve(url: str) -> str:
    """Pagina unui meci pimpletv -> ID-ul Ace Stream (SSRF: acceptăm doar hostul lor)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or (u.netloc.lower() not in _HOSTS) or not _EVENT_PATH.match(u.path):
        raise SourceError("Adresă de meci invalidă")
    ids = extract_ids(_get(url))
    if not ids:
        raise SourceError("Pagina meciului nu are un ID Ace Stream (transmisia a fost retrasă?)")
    return ids[0]
