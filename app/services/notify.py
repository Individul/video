"""Anunțuri despre serialele urmărite: episod nou disponibil pe trackere, sezon nou anunțat.

Urmărite = serialele din Watchlist + cele pornite în ultimele 120 de zile. La câteva ore, pentru
fiecare: TMDB spune ce sezoane există și ce episod a rulat ultimul; un episod nou devine anunț
abia când apare pe trackere (deci se poate viziona imediat), nu doar când a rulat la TV.
Starea (ce știm deja) stă în notify_state.json; prima vedere a unui serial nu anunță nimic.
"""

import asyncio
import json
import re
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import ROOT
from app.models import HistoryItem, Notification, Title, TitleType, WatchlistItem

_STATE = ROOT / "notify_state.json"
_INTERVAL = 4 * 3600
_PENDING_DAYS = 21  # cât căutăm pe trackere un episod rulat la TV
_running = {"busy": False, "last": None}


def _load() -> dict:
    try:
        return json.loads(_STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(d: dict) -> None:
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_STATE)


def tmdb_id(t: Title) -> str | None:
    m = re.search(r"themoviedb\.org/tv/(\d+)", t.source_url or "")
    return m.group(1) if m else None


async def followed(db) -> list[Title]:
    """Serialele din Watchlist + cele pornite în ultimele 120 de zile."""
    since = datetime.now(UTC) - timedelta(days=120)
    wl = (await db.scalars(select(Title).join(WatchlistItem, WatchlistItem.title_id == Title.id))).all()
    hist = (await db.scalars(
        select(Title).join(HistoryItem, HistoryItem.title_id == Title.id)
        .where(HistoryItem.updated_at >= since).distinct()
    )).all()
    out, seen = [], set()
    for t in [*wl, *hist]:
        if t.id in seen or not tmdb_id(t):
            continue
        if t.title_type not in (None, TitleType.SERIES):
            continue
        seen.add(t.id)
        out.append(t)
    return out


# ---------- ce spune TMDB ----------

def tv_info(tid: str) -> dict:
    """Sezoanele (număr -> episoade, dată), ultimul episod rulat și următorul."""
    from app.sources.tmdb import _get

    d = _get(f"/tv/{tid}")
    ep = lambda x: [x["season_number"], x["episode_number"], x.get("air_date")] if x else None  # noqa: E731
    return {
        "seasons": {str(s["season_number"]): [s.get("episode_count") or 0, s.get("air_date")]
                    for s in d.get("seasons") or [] if s.get("season_number")},
        "last": ep(d.get("last_episode_to_air")),
        "next": ep(d.get("next_episode_to_air")),
        "status": d.get("status"),
    }


def diff(old: dict | None, new: dict, today: str) -> tuple[list[dict], list[list]]:
    """(anunțuri despre sezoane, episoade noi rulate [s, e]) între starea știută și cea de acum."""
    if not old:
        return [], []
    events = []
    for n, (count, air) in new["seasons"].items():
        prev = old.get("seasons", {}).get(n)
        if prev is None:
            when = f" — începe pe {_ro_date(air)}" if air and air > today else ""
            events.append({"kind": "season", "season": int(n), "text": f"Sezonul {n} a fost anunțat{when}"})
        elif not prev[1] and air and air > today:
            events.append({"kind": "season", "season": int(n), "text": f"Sezonul {n} are dată: {_ro_date(air)}"})
    new_eps = []
    lo, hi = old.get("last"), new.get("last")
    if hi and (not lo or (hi[0], hi[1]) > (lo[0], lo[1])):
        s0, e0 = (lo[0], lo[1]) if lo else (hi[0], 0)
        for s in range(s0, hi[0] + 1):
            count = (new["seasons"].get(str(s)) or [0])[0]
            first = e0 + 1 if s == s0 else 1
            last = hi[1] if s == hi[0] else count
            new_eps += [[s, e] for e in range(first, last + 1)]
    return events, new_eps[-30:]


def _ro_date(iso: str) -> str:
    months = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august",
              "septembrie", "octombrie", "noiembrie", "decembrie"]
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        return f"{d.day} {months[d.month - 1]} {d.year}"
    except (TypeError, ValueError):
        return iso or ""


# ---------- e pe trackere? ----------

def covers(name: str, s: int, e: int) -> bool:
    """Release-ul conține episodul? „S05E03”, „S5E1-4 of 10”, „[01-04 из 10]”, „5 сезон” întreg."""
    from app.sources.torrents import pack_mentions_season

    n = (name or "").lower()
    if not pack_mentions_season(n, s):
        return False
    m = re.search(rf"s0*{s}(?!\d)\s*[\s._-]?e0*(\d+)(?:\s*-\s*(?:e)?0*(\d+))?", n)
    if not m:
        m = re.search(r"\[\s*0*(\d+)(?:\s*-\s*0*(\d+))?\s*(?:из|of)\s*\d+", n)
    if not m:
        m = re.search(r"(?:серии|серия|episodes?)\s*0*(\d+)(?:\s*-\s*0*(\d+))?", n)
    if not m:
        return True  # sezonul întreg, fără episoade în nume
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    return a <= e <= b


async def available(t: Title, s: int, e: int) -> bool:
    from app.sources import torrents

    for q in (f"{t.name} S{s:02d}E{e:02d}", f"{t.name} {s} сезон"):
        try:
            res = await torrents.search_torrents(q)
        except Exception:  # noqa: BLE001 — niciun rezultat / sursă căzută
            continue
        if any(covers(r["name"], s, e) for r in res):
            return True
    return False


# ---------- verificarea ----------

async def check(db) -> int:
    """O trecere prin serialele urmărite; întoarce câte anunțuri noi au apărut."""
    state = _load()
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    created = 0
    for t in await followed(db):
        tid = tmdb_id(t)
        try:
            info = await asyncio.to_thread(tv_info, tid)
        except Exception:  # noqa: BLE001 — TMDB indisponibil acum: data viitoare
            continue
        old = state.get(tid)
        events, new_eps = diff(old, info, today)
        pending = (old or {}).get("pending", [])
        pending += [[s, e, time.time()] for s, e in new_eps if [s, e] not in [p[:2] for p in pending]]
        # episoadele rulate: anunț când apar pe trackere (grupate: „episoadele 3–4”)
        ready, still = [], []
        for s, e, since in pending:
            if await available(t, s, e):
                ready.append((s, e))
            elif time.time() - since < _PENDING_DAYS * 86400:
                still.append([s, e, since])
        by_season: dict[int, list[int]] = {}
        for s, e in ready:
            by_season.setdefault(s, []).append(e)
        for s, eps in by_season.items():
            eps.sort()
            what = f"Episodul {eps[0]}" if len(eps) == 1 else f"Episoadele {eps[0]}–{eps[-1]}"
            events.append({"kind": "episode", "season": s, "episode": eps[0],
                           "text": f"{what} din sezonul {s} e disponibil"})
        for ev in events:
            db.add(Notification(title_id=t.id, kind=ev["kind"], season=ev.get("season"),
                                episode=ev.get("episode"), text=ev["text"]))
            created += 1
        state[tid] = {**info, "pending": still, "name": t.name}
        await db.commit()
    _save(state)
    _running["last"] = time.time()
    return created


async def loop() -> None:
    """La pornire (după 3 min) și apoi la fiecare 4 ore."""
    from app.db import SessionLocal

    await asyncio.sleep(180)
    while True:
        await run_once(SessionLocal)
        await asyncio.sleep(_INTERVAL)


async def run_once(session_maker) -> int:
    if _running["busy"]:
        return 0
    _running["busy"] = True
    try:
        async with session_maker() as db:
            return await check(db)
    except Exception:  # noqa: BLE001 — o trecere ratată nu oprește bucla
        return 0
    finally:
        _running["busy"] = False


def status() -> dict:
    return {"busy": _running["busy"], "last": _running["last"]}
