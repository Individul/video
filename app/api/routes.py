import asyncio
import json
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    BLOCK_SECONDS,
    COOKIE_NAME,
    TOKEN_MAX_AGE,
    check_password,
    client_ip,
    login_blocked,
    make_token,
    register_fail,
    register_ok,
    require_auth,
)
from app.config import Config
from app.db import get_session
from app.models import (
    AudioBook,
    HistoryItem,
    Title,
    TitleType,
    WatchlistItem,
    WatchlistStatus,
)
from app.services import catalog
from app.services.search import aggregate_search
from app.sources import get_source, SOURCES
from app.sources.base import SearchHit, SourceError
from app.sources import subtitles
from app.sources import torrents as torrent_service

router = APIRouter(prefix="/api", tags=["api"], dependencies=[Depends(require_auth)])

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


# ----------------- modele request (validare automata -> 422) -----------------


class PlaySource(BaseModel):
    """Rand de torrent din /api/torrents: magnet sau torrent_url (Jackett/RuTracker)."""

    magnet: str | None = None
    torrent_url: str | None = None


class PlayBody(BaseModel):
    magnet: PlaySource | str | None = None
    source: PlaySource | str | None = None
    index: int = Field(default=0, ge=0)
    season: int | None = Field(default=None, ge=1)
    episode: int | None = Field(default=None, ge=1)


class WatchlistBody(BaseModel):
    title_id: int
    status: WatchlistStatus = WatchlistStatus.TO_WATCH


class HistoryBody(BaseModel):
    title_id: int
    season: int | None = None
    episode: int | None = None
    position_seconds: float = 0
    duration_seconds: float | None = None


class HitBody(BaseModel):
    """Un rezultat de căutare (din similar/recenzii) → titlu în DB."""

    source: str
    name: str
    source_url: str
    poster: str | None = None
    year: int | None = None
    category: str | None = None
    rating: float | None = None


def _title_to_dict(t: Title, with_details: bool = False) -> dict[str, Any]:
    d = {
        "id": t.id,
        "source": t.source,
        "source_url": t.source_url,
        "name": t.name,
        "name_original": t.name_original,
        "year": t.year,
        "type": t.title_type.value if t.title_type else None,
        "category": t.category,
        "poster": t.poster,
        "rating": t.rating,
    }
    if with_details:
        d["description"] = t.description
        d["episodes"] = sorted(
            (
                {"season": e.season, "episode": e.episode, "name": e.name, "still": e.still}
                for e in t.episodes
            ),
            key=lambda e: (e["season"], e["episode"]),
        )
        extra: dict = {}
        if t.extra:
            try:
                extra = json.loads(t.extra)
            except (TypeError, ValueError):
                extra = {}
        d["trailer"] = extra.get("trailer")
        d["cast"] = extra.get("cast") or []
        d["similar"] = extra.get("similar") or []
        d["seasons"] = extra.get("seasons") or []
        d["backdrop"] = extra.get("backdrop")
        for key in ("tagline", "runtime", "status", "certification"):
            d[key] = extra.get(key)
        d["genres"] = extra.get("genres") or []
        d["countries"] = extra.get("countries") or []
        d["recommendations"] = extra.get("recommendations") or []
    return d


async def _hits_with_ids(db: AsyncSession, hits: list[dict]) -> list[dict[str, Any]]:
    """Hit-uri TMDB (similare/recomandări/filmografie) -> titluri cu id în DB, ca un clic pe
    card să deschidă detaliile (înainte cardurile „similare” nu aveau id și dădeau eroare)."""
    out = []
    for h in hits:
        try:
            hit = SearchHit(**{k: h.get(k) for k in ("source", "name", "source_url", "poster", "year", "category", "rating")})
        except TypeError:
            continue
        title = await catalog.upsert_search_hit(db, hit)
        out.append({**_title_to_dict(title), **({"role": h["role"]} if h.get("role") else {})})
    return out


def _source_for(title: Title):
    try:
        return get_source(title.source)
    except SourceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "sources": ",".join(SOURCES.keys())}


# ----------------- autentificare (public) -----------------


class LoginBody(BaseModel):
    password: str


@auth_router.post("/login")
async def auth_login(body: LoginBody, request: Request, response: Response) -> dict[str, Any]:
    ip = client_ip(request)
    if Config.APP_PASSWORD and (left := login_blocked(ip)):
        raise HTTPException(
            status_code=429,
            detail=f"Prea multe încercări greșite. Încearcă din nou peste {max(1, round(left / 60))} min.",
            headers={"Retry-After": str(left)},
        )
    if not await check_password(body.password):
        remaining = register_fail(ip)
        if remaining == 0:
            raise HTTPException(
                status_code=429,
                detail=f"Prea multe încercări greșite. Încearcă din nou peste {BLOCK_SECONDS // 60} min.",
                headers={"Retry-After": str(BLOCK_SECONDS)},
            )
        raise HTTPException(
            status_code=401,
            detail=f"Parolă greșită (mai ai {remaining} {'încercare' if remaining == 1 else 'încercări'})",
        )
    register_ok(ip)
    if Config.APP_PASSWORD:
        response.set_cookie(
            COOKIE_NAME,
            make_token(),
            httponly=True,
            samesite="lax",
            max_age=TOKEN_MAX_AGE,
            secure=os.getenv("HTTPS_ON", "") == "1",
        )
    return {"ok": True, "auth_required": bool(Config.APP_PASSWORD)}


@auth_router.post("/logout")
async def auth_logout(response: Response) -> dict[str, str]:
    response.delete_cookie(COOKIE_NAME)
    return {"ok": "true"}


@auth_router.get("/status")
async def auth_status() -> dict[str, Any]:
    return {"auth_required": bool(Config.APP_PASSWORD)}


# ----------------- torrenți (Rutor) + TorrServer -----------------

@router.get("/torrents")
async def torrents_search(
    q: str = Query(min_length=2),
    year: int | None = None,
    alt: str | None = Query(None, max_length=200),
) -> list[dict[str, Any]]:
    """Cautare magneți; `alt` = numele alternativ (rusesc ↔ original) pentru fallback."""
    if alt and alt.strip() and not torrent_service.searchable(q) and torrent_service.searchable(alt):
        q, alt = alt.strip(), q  # titlu original coreean/japonez/chinezesc: trackerele caută după numele rusesc
    query = f"{q} {year}" if year else q
    try:
        return await torrent_service.search_torrents(query)
    except SourceError as e:
        if alt and alt.strip() and alt.strip() != q.strip():
            alt_query = f"{alt.strip()} {year}" if year else alt.strip()
            try:
                return await torrent_service.search_torrents(alt_query)
            except SourceError as e2:
                raise HTTPException(status_code=502, detail=str(e2)) from e2
        raise HTTPException(status_code=502, detail=str(e)) from e


# ----------------- live (Ace Stream) -----------------

class LiveStartBody(BaseModel):
    ref: str = Field(min_length=10, max_length=200)  # acestream://<id>, <id>, ih:<infohash>, magnet


class LiveChannelBody(BaseModel):
    name: str = Field(default="", max_length=80)
    ref: str = Field(min_length=10, max_length=200)


class LiveEventPlayBody(BaseModel):
    url: str = Field(min_length=10, max_length=300)  # pagina meciului de pe pimpletv.ru


def _live_err(e: Exception) -> HTTPException:
    if isinstance(e, SourceError):
        return HTTPException(status_code=400 if "invalid" in str(e).lower() else 502, detail=str(e))
    return HTTPException(status_code=502, detail=f"Motorul Ace Stream nu răspunde: {e}")


@router.post("/live/start")
async def live_start(body: LiveStartBody) -> dict[str, Any]:
    from app.sources import live

    try:
        kind, h = live.parse_ref(body.ref)
        return await asyncio.to_thread(live.start, kind, h)
    except Exception as e:  # noqa: BLE001
        raise _live_err(e) from e


@router.get("/live/m/{ih}/{sess}.m3u8")
async def live_manifest(ih: str, sess: str, t: str = "r") -> Response:
    from app.sources import live

    try:
        text = await asyncio.to_thread(live.manifest, ih, sess, t)
    except SourceError as e:
        # încă face prebuffering: hls.js reîncearcă
        raise HTTPException(status_code=404 if "nu e gata" in str(e) else 400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise _live_err(e) from e
    return Response(content=text, media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "no-store"})


@router.get("/live/stat/{ih}/{sess}")
async def live_stat(ih: str, sess: str) -> dict[str, Any]:
    from app.sources import live

    try:
        return await asyncio.to_thread(live.stat, ih, sess)
    except Exception as e:  # noqa: BLE001
        raise _live_err(e) from e


# sunete pe care hls.js + browserul le redau direct; restul (MP2, AC3…) trec prin ffmpeg
_LIVE_NATIVE_AUDIO = {"aac", None}


@router.post("/live/prepare/{ih}/{sess}")
async def live_prepare(ih: str, sess: str) -> dict[str, Any]:
    """După ce motorul are segmente: dacă sunetul nu e AAC, pornește retransmisia ffmpeg
    și întoarce playlist-ul ei; altfel player-ul rămâne pe playlist-ul motorului."""
    from app.sources import live

    try:
        info = await asyncio.to_thread(live.stream_info, ih, sess)
        if info["audio"] in _LIVE_NATIVE_AUDIO:
            return {"relay": False, **info}
        playlist = await asyncio.to_thread(live.start_relay, ih, sess)
        return {"relay": True, **info, "playlist": playlist}
    except Exception as e:  # noqa: BLE001
        raise _live_err(e) from e


@router.get("/live/relay/{sess}/{name}")
async def live_relay_file(sess: str, name: str) -> Response:
    from fastapi.responses import FileResponse

    from app.sources import live

    try:
        path = await asyncio.to_thread(live.relay_file, sess, name)
    except SourceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not path:
        raise HTTPException(status_code=404, detail="Încă nu e gata")
    if name.endswith(".m3u8"):
        return Response(path.read_text(), media_type="application/vnd.apple.mpegurl", headers={"Cache-Control": "no-store"})
    return FileResponse(path, media_type="video/mp2t")


@router.post("/live/stop/{ih}/{sess}")
async def live_stop(ih: str, sess: str) -> dict[str, str]:
    from app.sources import live

    try:
        await asyncio.to_thread(live.stop, ih, sess)
    except SourceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": "true"}


@router.get("/live/channels")
async def live_channels() -> list[dict[str, Any]]:
    from app.sources import live

    return live.channels()


@router.post("/live/channels")
async def live_channel_add(body: LiveChannelBody) -> list[dict[str, Any]]:
    from app.sources import live

    try:
        return await asyncio.to_thread(live.save_channel, body.name, body.ref)
    except SourceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/live/channels/{h}")
async def live_channel_delete(h: str) -> list[dict[str, Any]]:
    from app.sources import live

    return await asyncio.to_thread(live.delete_channel, h.lower())


@router.get("/live/events")
async def live_events() -> list[dict[str, Any]]:
    """Evenimente sportive de pe pimpletv.ru (fotbal, hochei…) pentru pagina „Live”."""
    from app.sources import pimple

    try:
        return await asyncio.to_thread(pimple.events)
    except Exception as e:  # noqa: BLE001 — site indisponibil / blocat
        raise HTTPException(status_code=502, detail=f"pimpletv.ru indisponibil: {e}") from e


@router.post("/live/events/play")
async def live_event_play(body: LiveEventPlayBody) -> dict[str, Any]:
    """Pagina unui meci -> ID-ul Ace Stream -> pornește redarea în motor."""
    from app.sources import live, pimple

    try:
        h = await asyncio.to_thread(pimple.resolve, body.url)
    except SourceError as e:
        raise HTTPException(status_code=400 if "invalid" in str(e).lower() else 502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 — site indisponibil / blocat
        raise HTTPException(status_code=502, detail=f"pimpletv.ru indisponibil: {e}") from e
    try:
        return await asyncio.to_thread(live.start, "id", h)
    except Exception as e:  # noqa: BLE001
        raise _live_err(e) from e


# ----------------- TV (IPTV, playlistul abonamentului) -----------------

def _iptv_err(e: Exception) -> HTTPException:
    if isinstance(e, SourceError):
        msg = str(e)
        if "nu e configurat" in msg:
            return HTTPException(status_code=409, detail=msg)
        bad = any(w in msg for w in ("invalid", "inexistent", "Link"))
        return HTTPException(status_code=400 if bad else 502, detail=msg)
    return HTTPException(status_code=502, detail=f"IPTV indisponibil: {e}")


class IptvPlaylistBody(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


@router.get("/iptv")
async def iptv_overview(refresh: bool = False) -> dict[str, Any]:
    """Canalele (fără adresele lor), grupurile și favoritele; `configured: false` până pui playlistul."""
    from app.sources import iptv

    try:
        return await asyncio.to_thread(iptv.overview, refresh)
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e


@router.put("/iptv/playlist")
async def iptv_set_playlist(body: IptvPlaylistBody) -> dict[str, Any]:
    from app.sources import iptv

    try:
        return await asyncio.to_thread(iptv.set_playlist, body.url)
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e


@router.delete("/iptv/playlist")
async def iptv_clear_playlist() -> dict[str, str]:
    from app.sources import iptv

    await asyncio.to_thread(iptv.clear_playlist)
    return {"ok": "true"}


@router.post("/iptv/favorites/{cid}")
async def iptv_favorite(cid: str) -> dict[str, Any]:
    from app.sources import iptv

    try:
        return {"favorites": await asyncio.to_thread(iptv.toggle_favorite, cid)}
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e


@router.post("/iptv/play/{cid}")
async def iptv_play(cid: str, compat: bool = False) -> dict[str, Any]:
    """`compat=1`: video convertit pe server, pentru canalele pe care browserul nu le poate decoda."""
    from app.sources import iptv

    try:
        return await asyncio.to_thread(iptv.start, cid, compat)
    except SourceError as e:
        if str(e).startswith("hd:"):
            raise HTTPException(status_code=422, detail={"hd": int(str(e)[3:])}) from e
        raise _iptv_err(e) from e
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e


@router.get("/iptv/m3u/{cid}")
async def iptv_m3u(cid: str) -> Response:
    """Canalul ca fișier .m3u pentru VLC (rămâne la tine pe calculator)."""
    from urllib.parse import quote

    from app.sources import iptv

    try:
        name, body = await asyncio.to_thread(iptv.m3u_for, cid)
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e
    return Response(body, media_type="audio/x-mpegurl", headers={
        "Content-Disposition": f"attachment; filename=\"canal.m3u\"; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "no-store"})


@router.get("/iptv/status/{sess}")
async def iptv_status(sess: str) -> dict[str, Any]:
    from app.sources import iptv

    try:
        return await asyncio.to_thread(iptv.status, sess)
    except Exception as e:  # noqa: BLE001
        raise _iptv_err(e) from e


@router.get("/iptv/relay/{sess}/{name}")
async def iptv_relay_file(sess: str, name: str) -> Response:
    from fastapi.responses import FileResponse

    from app.sources import iptv

    path = await asyncio.to_thread(iptv.relay_file, sess, name)
    if not path:
        raise HTTPException(status_code=404, detail="Încă nu e gata")
    if name.endswith(".m3u8"):
        return Response(path.read_text(), media_type="application/vnd.apple.mpegurl", headers={"Cache-Control": "no-store"})
    return FileResponse(path, media_type="video/mp2t")


@router.post("/iptv/stop/{sess}")
async def iptv_stop(sess: str) -> dict[str, str]:
    from app.sources import iptv

    await asyncio.to_thread(iptv.stop, sess)
    return {"ok": "true"}


@router.get("/sport")
async def sport_feed(q: str | None = Query(None, max_length=100)) -> dict[str, Any]:
    """Ultimele meciuri/evenimente de pe RGFootball, grupate pe meci (pagina „Sport”);
    cu `q`, căutare în toată arhiva (echipă, competiție, „UFC”…)."""
    from app.sources import sport

    try:
        return {"matches": await asyncio.to_thread(sport.feed, None, q)}
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 — Jackett/RGFootball indisponibil
        raise HTTPException(status_code=502, detail=f"RGFootball indisponibil: {e}") from e


# ----------------- Cărți audio -----------------

def _books_err(e: Exception) -> HTTPException:
    if isinstance(e, SourceError):
        msg = str(e)
        bad = any(w in msg for w in ("necunoscut", "invalid", "nepermis", "inexistent"))
        return HTTPException(status_code=400 if bad else 404 if "încă" in msg else 502, detail=msg)
    return HTTPException(status_code=502, detail=f"Cărți audio indisponibile: {e}")


def _book_row(b: AudioBook, dl: dict | None) -> dict[str, Any]:
    return {
        "hash": b.hash, "author": b.author, "title": b.title, "narrator": b.narrator, "cover": b.cover,
        "track": b.track, "track_no": b.track_no, "tracks_total": b.tracks_total,
        "position": b.position, "duration": b.duration,
        "listened_at": b.listened_at.isoformat() if b.listened_at else None,
        "added_at": b.added_at.isoformat() if b.added_at else None,
        "download": dl,
    }


class BookSource(BaseModel):
    magnet: str | None = Field(None, max_length=4000)
    torrent_url: str | None = Field(None, max_length=4000)


class BookInfo(BaseModel):
    author: str | None = Field(None, max_length=256)
    title: str = Field(min_length=1, max_length=512)
    narrator: str | None = Field(None, max_length=256)
    cover: str | None = Field(None, max_length=512)


class BookAddBody(BaseModel):
    source: BookSource
    book: BookInfo


class BookProgressBody(BaseModel):
    track: int = Field(ge=0, le=100000)
    track_no: int = Field(ge=0, le=100000)
    tracks_total: int | None = Field(None, ge=0, le=100000)
    position: float = Field(ge=0, le=10 ** 7)
    duration: float | None = Field(None, ge=0, le=10 ** 7)


@router.get("/books/genres")
async def books_genres() -> list[dict[str, str]]:
    from app.sources import books

    return books.genres()


@router.get("/books/browse")
async def books_browse(
    genre: str | None = Query(None, max_length=30),
    q: str | None = Query(None, max_length=100),
    tag: str | None = Query(None, max_length=100),
) -> dict[str, Any]:
    """Cărți (grupate, cu versiuni): noutăți, un gen, populare, un subgen/tag (LitRes) sau căutare.
    Fiecare carte vine cu subgenurile și tagurile știute; restul se aduc în fundal."""
    from app.sources import books

    try:
        found = await asyncio.to_thread(books.tagged, tag) if tag else await asyncio.to_thread(books.browse, genre, q)
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    books.enqueue_enrich(found)
    return {"books": books.with_labels(found)}


@router.get("/books/book")
async def books_book(
    title: str = Query(min_length=1, max_length=512), author: str | None = Query(None, max_length=256)
) -> dict[str, Any]:
    """Pagina cărții: versiunile de pe toate trackerele + descrierea de pe LitRes."""
    from app.sources import books

    try:
        b, m = await asyncio.gather(
            asyncio.to_thread(books.book, author, title), asyncio.to_thread(books.meta, author, title, True)
        )
        if not m and b and (b.get("author_alt") or b.get("title_alt")):
            m = await asyncio.to_thread(books.meta, author, title, True, b.get("author_alt"), b.get("title_alt"))
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    return {"book": b, "meta": m}


@router.get("/books/meta")
async def books_meta(
    title: str = Query(min_length=1, max_length=512),
    author: str | None = Query(None, max_length=256),
    alt_author: str | None = Query(None, max_length=256),
    alt_title: str | None = Query(None, max_length=512),
) -> dict[str, Any]:
    """Coperta cărții (LitRes / Apple Books) — cerută leneș de fiecare card."""
    from app.sources import books

    return {"meta": await asyncio.to_thread(books.meta, author, title, False, alt_author, alt_title)}


@router.post("/books/add")
async def books_add(body: BookAddBody, db: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    from app.sources import books

    try:
        h = await asyncio.to_thread(books.add, body.source.model_dump())
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    row = await db.get(AudioBook, h)
    if not row:
        row = AudioBook(hash=h, title=body.book.title)
        db.add(row)
    row.author, row.title = body.book.author, body.book.title
    row.narrator, row.cover = body.book.narrator, body.book.cover
    await db.commit()
    return {"hash": h}


@router.get("/books/library")
async def books_library(db: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Cărțile din bibliotecă, cu starea descărcării și unde ai rămas."""
    from app.sources import books

    try:
        dl = await asyncio.to_thread(books.downloads)
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    rows = (await db.execute(select(AudioBook))).scalars().all()
    known = {r.hash for r in rows}
    items = [_book_row(r, dl["torrents"].get(r.hash)) for r in rows]
    # adăugate direct în qBittorrent: le arătăm cu numele torrentului
    for h, t in dl["torrents"].items():
        if h not in known:
            p = books.parse_title(t["name"] or "")
            items.append({"hash": h, "author": p["author"], "title": p["title"], "narrator": p["narrator"],
                          "cover": None, "track": None, "track_no": 0, "tracks_total": None, "position": 0,
                          "duration": None, "listened_at": None, "added_at": None, "download": t})
    items.sort(key=lambda x: x["listened_at"] or x["added_at"] or "", reverse=True)
    used = sum((x["download"] or {}).get("size_bytes", 0) for x in items)
    return {"items": items, "used": books._human_size(used) if used else "0 B", "free": dl["free"]}


@router.delete("/books/{torrent_hash}")
async def books_remove(torrent_hash: str, db: AsyncSession = Depends(get_session)) -> dict[str, str]:
    from app.sources import books

    h = torrent_hash.lower()
    try:
        await asyncio.to_thread(books.remove, h)
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    await db.execute(delete(AudioBook).where(AudioBook.hash == h))
    await db.commit()
    return {"ok": "true"}


@router.get("/books/{torrent_hash}/tracks")
async def books_tracks(torrent_hash: str) -> list[dict[str, Any]]:
    from app.sources import books

    try:
        return await asyncio.to_thread(books.tracks, torrent_hash.lower())
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e


@router.get("/books/{torrent_hash}/file/{index}")
async def books_file(torrent_hash: str, index: int):
    """Fișierul audio (cu Range: playerul sare oriunde în pistă)."""
    import mimetypes

    from fastapi.responses import FileResponse

    from app.sources import books

    try:
        path = await asyncio.to_thread(books.track_path, torrent_hash.lower(), index)
    except Exception as e:  # noqa: BLE001
        raise _books_err(e) from e
    mime = {".m4b": "audio/mp4", ".m4a": "audio/mp4", ".opus": "audio/ogg"}.get(path.suffix.lower())
    return FileResponse(path, media_type=mime or mimetypes.guess_type(path.name)[0] or "audio/mpeg",
                        headers={"Cache-Control": "private, max-age=86400"})


@router.put("/books/{torrent_hash}/progress")
async def books_progress(
    torrent_hash: str, body: BookProgressBody, db: AsyncSession = Depends(get_session)
) -> dict[str, str]:
    row = await db.get(AudioBook, torrent_hash.lower())
    if not row:
        raise HTTPException(status_code=404, detail="Cartea nu e în bibliotecă")
    row.track, row.track_no, row.position = body.track, body.track_no, body.position
    row.duration = body.duration
    if body.tracks_total is not None:
        row.tracks_total = body.tracks_total
    row.listened_at = datetime.now(UTC)
    await db.commit()
    return {"ok": "true"}


@router.get("/torrents/search")
async def torrents_free_search(q: str = Query(min_length=2, max_length=200)) -> dict[str, Any]:
    """Căutare liberă în toate trackerele (pagina „Torrente”), fără catalog."""
    return await torrent_service.raw_search(q.strip())


@router.post("/torrents/play")
async def torrents_play(body: PlayBody) -> dict[str, Any]:
    # source = magnet str (rutor/btdig) sau randul de torrent (dict cu torrent_url, Jackett/RuTracker)
    src = body.magnet or body.source
    if src is None:
        raise HTTPException(status_code=422, detail="Lipsește magnetul/sursa")
    if isinstance(src, PlaySource):
        src = {"magnet": src.magnet, "torrent_url": src.torrent_url}
    try:
        return await torrent_service.torrserver_play(
            src, body.index, season=body.season, episode=body.episode
        )
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


class DropBody(BaseModel):
    hash: str = Field(min_length=40, max_length=64)


@router.get("/torrents/stats/{torrent_hash}")
async def torrents_stats(torrent_hash: str) -> dict[str, Any]:
    try:
        return await torrent_service.torrent_stats(torrent_hash)
    except SourceError as e:
        raise HTTPException(status_code=400 if "invalid" in str(e) else 502, detail=str(e)) from e


@router.post("/torrents/drop")
async def torrents_drop(body: DropBody) -> dict[str, str]:
    """Deconectează un torrent care nu se mai redă (rămâne în cache, nu mai descarcă)."""
    try:
        await torrent_service.drop_torrent(body.hash)
    except SourceError as e:
        raise HTTPException(status_code=400 if "invalid" in str(e) else 502, detail=str(e)) from e
    return {"ok": "true"}


# ----------------- TorrServer: cache-ul de descărcări -----------------

@router.get("/downloads")
async def downloads_list() -> list[dict[str, Any]]:
    try:
        return await torrent_service.list_downloads()
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.delete("/downloads/{torrent_hash}")
async def downloads_remove(torrent_hash: str) -> dict[str, str]:
    try:
        await torrent_service.remove_download(torrent_hash)
        return {"ok": "true"}
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


# ----------------- subtitrări -----------------

@router.get("/subtitles/embed")
async def subtitles_embed(url: str = Query(min_length=10)) -> Response:
    """Convertește o subtitrare din arhiva torrentului (servită de TorrServer) în WebVTT."""
    try:
        vtt = await asyncio.to_thread(subtitles.fetch_torrserver_subtitle, url)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


@router.get("/subtitles/file")
async def subtitles_file(
    q: str = Query(min_length=2),
    season: int | None = Query(None, ge=1),
    episode: int | None = Query(None, ge=1),
) -> Response:
    """Subtitrare RU externă (OpenSubtitles, cu OS_API_KEY); cache pe disc."""
    vtt = await asyncio.to_thread(subtitles.fetch_external_subtitle, q, season, episode)
    if not vtt:
        raise HTTPException(status_code=404, detail="Nicio subtitrare RU disponibilă")
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


@router.get("/subtitles/mux")
async def subtitles_mux(url: str = Query(min_length=10), start: bool = True) -> dict[str, Any]:
    """Starea extragerii subtitrărilor din MKV (pornește jobul în fundal la prima cerere,
    dacă start=1): {status: running|done|error|idle, pct: 0-100}."""
    try:
        return await asyncio.to_thread(subtitles.mux_job_state, url, start)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.delete("/subtitles/mux")
async def subtitles_mux_cancel(url: str = Query(min_length=10)) -> dict[str, Any]:
    """Oprește extragerea (player închis / altă versiune aleasă) — ffmpeg nu mai trage
    tot fișierul prin TorrServer degeaba."""
    try:
        cancelled = await asyncio.to_thread(subtitles.cancel_mux_job, url)
    except SourceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "cancelled": cancelled}


@router.get("/subtitles/mux/data")
async def subtitles_mux_data(url: str = Query(min_length=10)) -> Response:
    """Conținutul VTT al subtitrărilor extrase (dacă jobul e gata)."""
    try:
        vtt = await asyncio.to_thread(subtitles.mux_job_result, url)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    if not vtt:
        raise HTTPException(status_code=404, detail="Încă nu e gata")
    return Response(content=vtt, media_type="text/vtt; charset=utf-8")


# ----------------- piste audio (dublaje) -----------------

@router.get("/audio/tracks")
async def audio_tracks(url: str = Query(min_length=10)) -> dict[str, Any]:
    """Pistele audio ale fișierului (limbă, codec, canale) + dacă se poate comuta (H.264)."""
    from app.sources import audio

    try:
        return await asyncio.to_thread(audio.probe, url)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/audio/stream")
async def audio_stream(
    url: str = Query(min_length=10),
    a: int = Query(ge=0, lt=32),
    t: float = Query(0, ge=0, lt=86400),
) -> StreamingResponse:
    """Video copiat + pista audio `a` în AAC, ca MP4 fragmentat începând de la `t` secunde."""
    from app.sources import audio

    try:
        body, media_start = await asyncio.to_thread(audio.stream, url, a, t)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    # X-Media-Start: unde începe de fapt fluxul în film (cadrul-cheie dinaintea lui t)
    return StreamingResponse(
        body,
        media_type="video/mp4",
        headers={"Cache-Control": "no-store", "X-Media-Start": f"{media_start:.3f}"},
    )


@router.delete("/audio/stream")
async def audio_stream_stop() -> dict[str, str]:
    from app.sources import audio

    await asyncio.to_thread(audio.stop)
    return {"status": "ok"}


# ----------------- cautare / browsare -----------------

@router.get("/search")
async def search(
    q: str = Query(min_length=2),
    page: int = 1,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    hits, errors = await aggregate_search(q, page)
    out = []
    for hit in hits:
        title = await catalog.upsert_search_hit(db, hit)
        out.append(_title_to_dict(title))
    await db.commit()
    return {"results": out, "errors": errors}


@router.get("/browse")
async def browse(
    category: str = Query("films"),
    page: int = Query(1, ge=1),
    genre: int | None = Query(None),
    year: int | None = Query(None, ge=1900, le=2100),
    sort: str = Query("popularity", pattern="^(popularity|rating|date|title)$"),
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Browsare agregata: interogam toate sursele care suporta categorie si combinam rezultatele."""
    sources = [s for s in SOURCES.values() if s.supports_browse(category)]
    if not sources:
        raise HTTPException(status_code=400, detail=f"Nicio sursa suporta categoria {category}")

    tasks = [
        asyncio.create_task(s.browse(category, page, genre=genre, year=year, sort=sort))
        for s in sources
    ]
    done = await asyncio.gather(*tasks, return_exceptions=True)

    hits: list[SearchHit] = []
    errors: list[str] = []
    for src, res in zip(sources, done):
        if isinstance(res, Exception):
            errors.append(f"{src.name}: {res}")
            continue
        hits.extend(res)

    out = []
    for hit in hits:
        title = await catalog.upsert_search_hit(db, hit)
        out.append(_title_to_dict(title))
    await db.commit()
    return {"results": out, "category": category, "page": page, "errors": errors}


@router.get("/genres")
async def genres(category: str = Query("films")) -> list[dict[str, Any]]:
    tmdb = SOURCES.get("tmdb")
    if tmdb is None or not hasattr(tmdb, "genres"):
        return []
    try:
        return await tmdb.genres(category)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/titles")
async def titles_create(
    body: HitBody,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Înregistrează un titlu dintr-un hit (folosit pentru 'titluri similare')."""
    hit = SearchHit(**body.model_dump())
    title = await catalog.upsert_search_hit(db, hit)
    await db.commit()
    return _title_to_dict(title)


# ----------------- titlu -----------------

async def _refresh_if_stale(db: AsyncSession, title: Title) -> Title:
    # SQLite nu pastreaza tzinfo -> normalizam la UTC inainte de comparatie
    loaded = title.detail_loaded_at
    if loaded is not None and loaded.tzinfo is None:
        loaded = loaded.replace(tzinfo=UTC)
    fresh = (
        loaded is not None
        and datetime.now(UTC) - loaded < timedelta(hours=Config.DETAIL_CACHE_HOURS)
        and title.extra is not None
    )
    if fresh:
        try:
            extra = json.loads(title.extra) if title.extra else {}
        except (TypeError, ValueError):
            extra = {}
        # seriale vechi (înainte de încărcarea leneșă) -> o singură reîmprospătare rapidă
        if title.title_type == TitleType.SERIES and not extra.get("seasons"):
            fresh = False
        # detalii salvate cu o versiune mai veche (fără fundal, slogan, genuri...) -> o reîmprospătare
        if extra.get("v", 1) < catalog.EXTRA_VERSION:
            fresh = False
    if fresh or not title.source_url:
        return title
    try:
        detail = await _source_for(title).details(title.source_url)
    except SourceError:
        return title  # pastram ce avem in DB
    title = await catalog.upsert_title_detail(db, detail)
    await db.commit()
    # repopulam colectia episoadelor abia adaugate (session-ul o avea goala in memorie)
    await db.refresh(title, attribute_names=["episodes"])
    return title


_KP_TTL = 7 * 86400  # ratingurile se schimbă încet; o cerere pe săptămână per titlu


async def _ensure_kinopoisk(db: AsyncSession, title: Title) -> dict | None:
    """Rating KP/IMDb + descriere din Kinopoisk, cache-uite în extra["kp"] (și „negăsit”,
    ca să nu repetăm cererea). La limită depășită păstrăm ce aveam și reîncercăm altă dată."""
    import time

    from app.sources import kinopoisk

    try:
        extra = json.loads(title.extra) if title.extra else {}
    except (TypeError, ValueError):
        extra = {}
    cached = extra.get("kp")
    if not Config.KP_API_KEY or title.source != "tmdb":
        return cached if cached and not cached.get("none") else None
    if cached and time.time() - cached.get("at", 0) < _KP_TTL:
        return None if cached.get("none") else cached
    try:
        res = await asyncio.to_thread(
            kinopoisk.lookup, extra.get("imdb_id"), title.name, title.name_original, title.year
        )
    except Exception:  # noqa: BLE001 — limită/rețea: Kinopoisk e opțional, pagina merge și fără
        return cached if cached and not cached.get("none") else None
    fresh = {**res, "at": time.time()} if res else {"none": True, "at": time.time()}
    extra["kp"] = fresh
    title.extra = json.dumps(extra, ensure_ascii=False)
    await db.commit()
    return None if fresh.get("none") else fresh


@router.get("/title/{title_id}")
async def title_detail(
    title_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    q = (
        select(Title)
        .where(Title.id == title_id)
        .options(selectinload(Title.episodes))
    )
    title = (await db.scalars(q)).first()
    if title is None:
        raise HTTPException(status_code=404, detail="Titlul nu exista")
    title = await _refresh_if_stale(db, title)
    kp = await _ensure_kinopoisk(db, title)
    d = _title_to_dict(title, with_details=True)
    if kp:
        d["kp"] = {k: kp.get(k) for k in ("id", "rating_kp", "votes_kp", "rating_imdb", "votes_imdb", "url")}
        if not d.get("description") and kp.get("description"):
            d["description"] = kp["description"]  # TMDB n-are descriere în rusă -> cea de pe Kinopoisk
    d["similar"] = await _hits_with_ids(db, d["similar"])
    d["recommendations"] = await _hits_with_ids(db, d["recommendations"])
    await db.commit()
    return d


@router.get("/calendar")
async def calendar_events(
    back: int = Query(7, ge=0, le=30),
    ahead: int = Query(60, ge=1, le=120),
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Calendarul aparițiilor: premiere în cinema și lansări digitale. Episoadele noi nu mai
    apar aici (aglomerau pagina): data lor e pe cardurile episoadelor din pagina serialului."""
    from app.sources import calendar as cal

    try:
        events = await asyncio.to_thread(cal.calendar, back, ahead, [], None, False)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    titles = await _hits_with_ids(db, [e["hit"] for e in events])
    await db.commit()
    out = []
    for e, t in zip(events, titles):
        e = {k: v for k, v in e.items() if k != "hit"}
        out.append({**e, "title": t})
    return {"today": datetime.now().date().isoformat(), "events": out}


@router.get("/person/{person_id}")
async def person_detail(
    person_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Pagina actorului: biografie + filmografie (titluri cu id, deschise direct din grilă)."""
    tmdb = SOURCES.get("tmdb")
    if tmdb is None or not hasattr(tmdb, "person"):
        raise HTTPException(status_code=400, detail="Sursa nu suportă persoane")
    try:
        p = await asyncio.to_thread(tmdb.person, person_id)
    except SourceError as e:
        raise HTTPException(status_code=404 if "nu am gasit" in str(e) else 502, detail=str(e)) from e
    p["works"] = await _hits_with_ids(db, p["works"])
    await db.commit()
    return p


@router.get("/title/{title_id}/episodes")
async def title_episodes(
    title_id: int,
    season: int = Query(ge=0),
    db: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    """Episoadele unui sezon (încărcare leneșă, cu cache în DB)."""
    title = await catalog.get_title(db, title_id)
    if title is None:
        raise HTTPException(status_code=404, detail="Titlul nu exista")
    source = _source_for(title)
    if not hasattr(source, "season_episodes"):
        raise HTTPException(status_code=400, detail="Sursa nu suportă episoade per sezon")
    try:
        eps = await asyncio.to_thread(source.season_episodes, title.source_url, season)
    except SourceError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    await catalog.upsert_episodes(db, title.id, eps)
    await db.commit()
    return sorted(
        ({"season": e.season, "episode": e.episode, "name": e.name, "still": e.still, "air_date": e.air_date}
         for e in eps),
        key=lambda e: (e["season"], e["episode"]),
    )


# ----------------- watchlist -----------------

@router.get("/watchlist")
async def watchlist_list(db: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    q = (
        select(WatchlistItem)
        .options(selectinload(WatchlistItem.title))
        .order_by(WatchlistItem.created_at.desc())
    )
    items = (await db.scalars(q)).all()
    return [
        {"status": w.status.value, "title": _title_to_dict(w.title)} for w in items
    ]


@router.post("/watchlist")
async def watchlist_add(
    body: WatchlistBody,
    db: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    if await catalog.get_title(db, body.title_id) is None:
        raise HTTPException(status_code=404, detail="Titlul nu exista")

    existing = (
        await db.scalars(select(WatchlistItem).where(WatchlistItem.title_id == body.title_id))
    ).first()
    if existing:
        existing.status = body.status
    else:
        db.add(WatchlistItem(title_id=body.title_id, status=body.status))
    await db.commit()
    return {"ok": "true"}


@router.delete("/watchlist/{title_id}")
async def watchlist_remove(title_id: int, db: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await db.execute(delete(WatchlistItem).where(WatchlistItem.title_id == title_id))
    await db.commit()
    return {"ok": "true"}


# ----------------- istoric -----------------

def next_episode(seasons: list[dict], season: int | None, episode: int | None) -> dict | None:
    """Episodul de după (season, episode), din sezoanele TMDB [{season, episodes}];
    trece la sezonul următor; sezonul 0 (speciale) nu contează; None după ultimul."""
    if season is None or episode is None:
        return None
    counts = {int(s["season"]): int(s.get("episodes") or 0) for s in seasons or [] if s.get("season")}
    if episode < counts.get(season, 0):
        return {"season": season, "episode": episode + 1}
    later = sorted(s for s, n in counts.items() if s > season and n > 0)
    return {"season": later[0], "episode": 1} if later else None


def _finished(h: HistoryItem) -> bool:
    return bool(h.duration_seconds) and (h.duration_seconds - (h.position_seconds or 0)) <= 60


@router.get("/history")
async def history_list(db: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    # istoricul salveaza o linie la fiecare pozitie — grupam: doar ultima per titlu
    q = (
        select(HistoryItem)
        .options(selectinload(HistoryItem.title))
        .order_by(HistoryItem.updated_at.desc())
    )
    seen: set[int] = set()
    items = []
    for h in (await db.scalars(q)).all():
        if h.title_id in seen:
            continue
        seen.add(h.title_id)
        items.append(h)
    def seasons_of(t: Title) -> list[dict]:
        try:
            return (json.loads(t.extra) if t.extra else {}).get("seasons") or []
        except (TypeError, ValueError):
            return []

    return [
        {
            "title": _title_to_dict(h.title),
            "season": h.season,
            "episode": h.episode,
            "position_seconds": h.position_seconds,
            "duration_seconds": h.duration_seconds,
            "updated_at": h.updated_at.isoformat(),
            # episod terminat: „Continuă” propune episodul următor (dacă mai există)
            "next": next_episode(seasons_of(h.title), h.season, h.episode) if _finished(h) else None,
        }
        for h in items
    ]


@router.get("/title/{title_id}/history")
async def title_history(
    title_id: int,
    db: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    """Progresul per episod (pentru gridul de episoade)."""
    q = (
        select(HistoryItem)
        .where(HistoryItem.title_id == title_id)
        .order_by(HistoryItem.updated_at.desc())
    )
    return [
        {
            "season": h.season,
            "episode": h.episode,
            "position_seconds": h.position_seconds,
            "duration_seconds": h.duration_seconds,
            "updated_at": h.updated_at.isoformat(),
        }
        for h in (await db.scalars(q)).all()
    ]


@router.post("/history")
async def history_save(
    body: HistoryBody,
    db: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    if await catalog.get_title(db, body.title_id) is None:
        raise HTTPException(status_code=404, detail="Titlul nu exista")
    # upsert: un singur rând per (titlu, sezon, episod) — fără spam la fiecare 10s
    q = select(HistoryItem).where(HistoryItem.title_id == body.title_id)
    q = q.where(HistoryItem.season.is_(None) if body.season is None else HistoryItem.season == body.season)
    q = q.where(HistoryItem.episode.is_(None) if body.episode is None else HistoryItem.episode == body.episode)
    item = (await db.scalars(q)).first()
    if item is not None:
        item.position_seconds = body.position_seconds
        item.duration_seconds = body.duration_seconds
    else:
        db.add(
            HistoryItem(
                title_id=body.title_id,
                season=body.season,
                episode=body.episode,
                position_seconds=body.position_seconds,
                duration_seconds=body.duration_seconds,
            )
        )
    await db.commit()
    return {"ok": "true"}
