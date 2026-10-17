"""Autentificare simplă cu parolă (pentru publicare pe web).
Fără APP_PASSWORD setată, totul e deschis — uz local."""

import asyncio
import hashlib
import hmac
import time

from fastapi import HTTPException, Request

from app.config import Config

COOKIE_NAME = "vid_auth"
TOKEN_MAX_AGE = 30 * 24 * 3600  # o sesiune ține 30 de zile, apoi se cere din nou parola
_last_fail = 0.0


def _secret() -> bytes:
    # parola intră în secret: schimbarea ei invalidează toate sesiunile vechi
    return f"{Config.APP_SECRET or ''}|{Config.APP_PASSWORD or 'vid-local-dev'}".encode()


def _sign(issued: str) -> str:
    return hmac.new(_secret(), f"vid-auth-v2:{issued}".encode(), hashlib.sha256).hexdigest()


def make_token(now: float | None = None) -> str:
    """Token „<moment emitere>.<semnătură>” — expiră după TOKEN_MAX_AGE."""
    issued = str(int(time.time() if now is None else now))
    return f"{issued}.{_sign(issued)}"


def token_ok(token: str | None, now: float | None = None) -> bool:
    if not token or "." not in token:
        return False
    issued, _, sig = token.partition(".")
    if not issued.isdigit() or not hmac.compare_digest(sig.encode(), _sign(issued).encode()):
        return False
    age = (time.time() if now is None else now) - int(issued)
    return -300 <= age <= TOKEN_MAX_AGE  # 5 min toleranță pentru ceas decalat


async def require_auth(request: Request) -> None:
    """Dependență FastAPI: 401 dacă parola e activă și cookie-ul lipsește/greșit/expirat."""
    if not Config.APP_PASSWORD:
        return
    if not token_ok(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=401, detail="Autentificare necesară")


async def check_password(password: str) -> bool:
    """Compară parola cu o mică frână anti brute-force."""
    global _last_fail
    if not Config.APP_PASSWORD:
        return True  # autentificare dezactivată (uz local)
    # bytes: compare_digest pe str acceptă doar ASCII (parolă cu diacritice -> TypeError)
    if hmac.compare_digest(password.encode(), Config.APP_PASSWORD.encode()):
        _last_fail = 0.0
        return True
    # după o încercare greșită, următoarea așteaptă 1s (fără să blocheze celelalte cereri)
    now = time.monotonic()
    if now - _last_fail < 1.0:
        await asyncio.sleep(1.0)
    _last_fail = now
    return False
