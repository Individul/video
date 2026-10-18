"""Pagina „Sport”: ultimele apariții de pe RGFootball (prin Jackett), grupate pe meci.

Titlurile RGFootball sunt structurate, ex.:
  „Italy » Serie A 2026-27 » 07. Round » Bologna FC vs Inter [17.10.2026, 720p, 50 fps]”
  „"UFC Fight Night 291": Buckley vs. Malott [Preliminary + Main card] / MTV HD [17.10.2026, 720p]”
Le despărțim în competiție / etapă / meci / dată / calitate, iar variantele aceluiași meci
(720p 50 fps, 1080i…) devin un singur rând cu mai multe butoane.
"""

import re
import time
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode

from app.config import Config
from app.sources.base import SourceError

INDEXER = "rgfootball"
_CACHE_TTL = 300
_cache: dict[str, tuple[float, list[dict]]] = {}

# „[17.10.2026, 720p, 50 fps]” — uneori fără „]” la final (titlu trunchiat)
_BRACKET_RE = re.compile(r"\[([^\[\]]*\d{2}\.\d{2}\.\d{4}[^\[\]]*)(?:\]|$)")
_SEP_RE = re.compile(r"\s*»\s*|\s+/\s+")
_EMOJI_RE = re.compile(r"[☀-➿️\U0001F000-\U0001FAFF]+")
_CHANNEL_RE = re.compile(r"\b(HD|UHD|TV|SP@RT|SPORT|SKY|TNT|DAZN|ESPN|BT|SSB|S\.S\.BL)\b", re.I)
_COUNTRIES = (
    "England", "Germany", "Italy", "Spain", "France", "Portugal", "Netherlands", "Scotland",
    "Turkey", "Turkiye", "Russia", "Ukraine", "Belgium", "Brazil", "Argentina", "USA",
)
_DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")
_SEASON_RE = re.compile(r"\s+\d{4}(?:[-/]\d{2,4})?\s*$")
# a doua bucată e etapa, nu liga („Matchday 31”, „07. Round”, „1/8 Final”)
# (fără „^\d+\.” — ar prinde „2. Bundesliga”; „07. Round” are oricum cuvântul „Round”)
_ROUND_RE = re.compile(r"\b(round|matchday|tour|week|day|stage|group|final|тур)\b", re.I)


def _quality(bracket: str) -> str:
    parts = [p.strip() for p in bracket.split(",")]
    res = next((p for p in parts if re.search(r"\d{3,4}[pi]\b", p)), "")
    fps = next((p for p in parts if re.search(r"\d+\s*fps", p, re.I)), "")
    m = re.search(r"\d{3,4}[pi]", res)
    out = m.group(0) if m else ""
    f = re.search(r"(\d+)\s*fps", fps, re.I)  # „720p 50 fps” -> 50, nu 720
    if f and out:
        out += f" {f.group(1)}fps"
    if not out:  # ex. „720p 50” fără virgulă
        m = re.search(r"(\d{3,4}[pi])(?:\s+(\d{2})\b)?", bracket)
        if m:
            out = m.group(1) + (f" {m.group(2)}fps" if m.group(2) else "")
    return out


def _split_country(s: str) -> tuple[str, str]:
    """„England Premier League” -> („England”, „Premier League”); altfel („”, s)."""
    for c in _COUNTRIES:
        if s.lower().startswith(c.lower() + " ") and len(s) > len(c) + 1:
            return c, s[len(c) + 1 :].strip()
        if s.lower() == c.lower():
            return c, ""
    return "", s


def parse_title(title: str) -> dict:
    """Competiție, etapă, meci, dată (YYYY-MM-DD), calitate, din titlul RGFootball.
    Separatoare folosite de RGFootball: „»” și „ / ”; uneori emoji (⚽️), țara lipită de
    ligă („England Premier League”) și canalul TV la final („SKY SP@RT UHD”)."""
    bracket_m = _BRACKET_RE.search(title)
    bracket = bracket_m.group(1) if bracket_m else ""
    head = title[: bracket_m.start()].strip() if bracket_m else title.strip()
    date = None
    dm = _DATE_RE.search(bracket)
    if dm:
        date = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}"

    head = _EMOJI_RE.sub("", head).strip()
    country = rnd = ""
    q = re.match(r'^"([^"]+)":\s*(.+)$', head)
    if q:
        # „"UFC Fight Night 291": Buckley vs. Malott ...” -> competiția e partea dintre ghilimele
        competition, match = re.sub(r"\s+\d+$", "", q.group(1)), q.group(2)
    else:
        parts = [p.strip() for p in _SEP_RE.split(head) if p.strip()]
        if len(parts) > 2 and _CHANNEL_RE.search(parts[-1]):
            parts = parts[:-1]  # „... / SKY SP@RT UHD” — canalul TV, nu meciul
        ri = next((i for i, p in enumerate(parts) if i > 0 and _ROUND_RE.search(p)), None)
        if ri is not None:
            rnd = parts[ri]
            comp_raw = _SEASON_RE.sub("", parts[ri - 1]) or parts[ri - 1]
            country, competition = _split_country(comp_raw)
            if ri >= 2:
                country = parts[ri - 2]
            if not competition:  # „Germany » ...” fără ligă separată
                competition = comp_raw
            match = " » ".join(parts[ri + 1 :]) or rnd
        elif len(parts) >= 2:
            comp_raw = _SEASON_RE.sub("", parts[0]) or parts[0]
            country, competition = _split_country(comp_raw)
            competition = competition or comp_raw
            match = " » ".join(parts[1:])
        else:
            competition, match = "Altele", head
    match = re.sub(r"\s*/\s*[^/]*\b(HD|TV|Sport)\b[^/]*$", "", match).strip()  # „ / MTV HD”
    return {
        "competition": competition.strip(),
        "country": country,
        "round": rnd,
        "match": match,
        "date": date,
        "quality": _quality(bracket),
    }


def _fetch(cat: str | None) -> list[dict]:
    import requests
    from xml.etree import ElementTree

    if not (Config.TORZNAB_URL and Config.TORZNAB_API_KEY):
        raise SourceError("Jackett nu e configurat")
    params = {"apikey": Config.TORZNAB_API_KEY, "t": "search"}
    if cat:
        params["cat"] = cat
    url = f"{Config.TORZNAB_URL.rstrip('/')}/api/v2.0/indexers/{INDEXER}/results/torznab/api?{urlencode(params)}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    root = ElementTree.fromstring(r.content)
    err = root if root.tag == "error" else root.find("error")
    if err is not None:
        raise SourceError(f"RGFootball: {err.get('description') or 'eroare'}")
    out = []
    for item in root.iter("item"):
        attrs = {}
        for a in item.iter():
            if a.tag.rsplit("}", 1)[-1] == "attr" and a.get("name"):
                attrs[a.get("name")] = a.get("value") or ""
        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        size = (item.findtext("size") or "").strip()
        try:
            pub = parsedate_to_datetime(item.findtext("pubDate") or "").date().isoformat()
        except (TypeError, ValueError):
            pub = None
        seeds = attrs.get("seeders")
        out.append({
            "name": title,
            "magnet": attrs.get("magneturl") or (link if link.startswith("magnet:") else None),
            "torrent_url": None if link.startswith("magnet:") else (link or None),
            "size_bytes": int(size) if size.isdigit() else None,
            "seeds": int(seeds) if seeds and seeds.isdigit() else None,
            "published": pub,
            "indexer": "RGFootball",
            "source": "jackett",
            **parse_title(title),
        })
    return out


def feed(cat: str | None = None) -> list[dict]:
    """Meciuri recente, grupate: [{key, competition, country, round, match, date, variants[]}]."""
    key = cat or "*"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    from app.sources.torrents import _human_size

    groups: dict[str, dict] = {}
    for x in _fetch(cat):
        gkey = f"{x['competition']}|{x['round']}|{x['match']}|{x['date']}".lower()
        g = groups.setdefault(gkey, {
            "key": gkey,
            "competition": x["competition"],
            "country": x["country"],
            "round": x["round"],
            "match": x["match"],
            "date": x["date"] or x["published"],
            "variants": [],
        })
        g["variants"].append({
            "name": x["name"],
            "magnet": x["magnet"],
            "torrent_url": x["torrent_url"],
            "size": _human_size(x["size_bytes"]) if x["size_bytes"] else None,
            "seeds": x["seeds"],
            "quality": x["quality"],
            "indexer": x["indexer"],
            "source": x["source"],
        })
    out = sorted(groups.values(), key=lambda g: (g["date"] or ""), reverse=True)
    def weight(q: str) -> int:  # cea mai ușoară de redat în browser întâi
        q = q or ""
        return 0 if "720" in q else 1 if "1080p" in q else 2 if "1080i" in q else 3 if "2160" in q else 1

    for g in out:
        g["variants"].sort(key=lambda v: (weight(v["quality"]), -(v["seeds"] or 0)))
    _cache[key] = (time.time(), out)
    return out
