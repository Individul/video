import asyncio
import time

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app import auth
from app.config import Config
from app.db import _columns, _migrate
from app.models import Base
from app.sources import subtitles
from app.sources.base import SourceError
from app.sources.torrents import same_origin, torrserver_play

TS = "http://127.0.0.1:8090"


# ----------------- verificarea hostului TorrServer -----------------


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8090/stream/x.srt?link=abc",
        "http://user:parola@127.0.0.1:8090/stream/x.mkv",
    ],
)
def test_same_origin_accepta_torrserver(url):
    assert same_origin(url, TS)


@pytest.mark.parametrize(
    "url",
    [
        "file:///C:/Users/prisa/vid/.env",  # netloc gol trecea de vechea verificare
        "http://127.0.0.1/",  # port diferit (80)
        "http://0.0.1:8090/",  # subșir al hostului
        "http://1:8090/",
        "https://127.0.0.1:8090/",  # altă schemă
        "http://127.0.0.1:8090@evil.com/",
        "ftp://127.0.0.1:8090/",
        "-i",
    ],
)
def test_same_origin_respinge(url):
    assert not same_origin(url, TS)


def test_same_origin_fara_baza():
    assert not same_origin("http://127.0.0.1:9117/dl/x", None)


def test_subtitrari_resping_url_strain(monkeypatch):
    monkeypatch.setattr(Config, "TORRSERVER_URL", TS)
    with pytest.raises(SourceError):
        subtitles.fetch_torrserver_subtitle("file:///C:/Windows/win.ini")
    with pytest.raises(SourceError):
        subtitles.mux_job_state("file:///C:/Windows/win.ini")
    with pytest.raises(SourceError):
        subtitles.mux_job_result("http://1:8090/stream/x.mkv")


# ----------------- .torrent doar de pe Jackett -----------------


async def test_torrent_url_strain_respins(monkeypatch):
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://127.0.0.1:9117")
    with pytest.raises(SourceError, match="nepermis"):
        await torrserver_play({"torrent_url": "http://169.254.169.254/latest/meta-data"})


async def test_torrent_url_fara_jackett_respins(monkeypatch):
    monkeypatch.setattr(Config, "TORZNAB_URL", None)
    with pytest.raises(SourceError, match="nepermis"):
        await torrserver_play({"torrent_url": "http://127.0.0.1:9117/dl/x"})


async def test_torrent_url_jackett_cazut_da_sourceerror(monkeypatch):
    # port închis -> eroare de rețea transformată în SourceError (502), nu 500
    monkeypatch.setattr(Config, "TORZNAB_URL", "http://127.0.0.1:1")
    with pytest.raises(SourceError, match="Nu pot descărca"):
        await torrserver_play({"torrent_url": "http://127.0.0.1:1/dl/x"})


# ----------------- autentificare -----------------


@pytest.fixture
def parola(monkeypatch):
    monkeypatch.setattr(Config, "APP_PASSWORD", "parolă-ăîșț")
    monkeypatch.setattr(Config, "APP_SECRET", "secret-test")
    monkeypatch.setattr(auth, "_last_fail", 0.0)


async def test_parola_cu_diacritice(parola):
    assert await auth.check_password("parolă-ăîșț")
    assert not await auth.check_password("altceva-ă")


async def test_parola_gresita_nu_blocheaza_bucla(parola):
    assert not await auth.check_password("gresit")
    started = time.monotonic()
    # a doua greșeală așteaptă 1s, dar alte corutine continuă între timp
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.05)
            ticks += 1

    t = asyncio.create_task(ticker())
    assert not await auth.check_password("gresit")
    t.cancel()
    assert time.monotonic() - started >= 0.9
    assert ticks >= 10


def test_token_valid_si_expirat(parola):
    now = time.time()
    tok = auth.make_token(now)
    assert auth.token_ok(tok, now)
    assert auth.token_ok(tok, now + auth.TOKEN_MAX_AGE - 10)
    assert not auth.token_ok(tok, now + auth.TOKEN_MAX_AGE + 10)


def test_token_modificat_respins(parola):
    now = time.time()
    issued, _, sig = auth.make_token(now).partition(".")
    # prelungirea manuală a datei invalidează semnătura
    assert not auth.token_ok(f"{int(issued) + 1000}.{sig}", now)
    assert not auth.token_ok("fals", now)
    assert not auth.token_ok("", now)
    assert not auth.token_ok("abc.def", now)


def test_schimbarea_parolei_invalideaza_sesiunile(parola, monkeypatch):
    tok = auth.make_token()
    monkeypatch.setattr(Config, "APP_PASSWORD", "parola-noua")
    assert not auth.token_ok(tok)


# ----------------- migrare independentă de dialect -----------------


async def test_migrare_adauga_coloanele_lipsa():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE titles DROP COLUMN extra"))
        assert "extra" not in await _columns(conn, "titles")
        await _migrate(conn)
        assert "extra" in await _columns(conn, "titles")
        assert {"name", "still"} <= await _columns(conn, "episodes")
    await engine.dispose()
