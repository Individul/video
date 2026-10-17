"""Autentificare simplă cu parolă (pentru publicare pe web).
Fără APP_PASSWORD setată, totul e deschis — uz local."""

import hashlib
import hmac
import time

from fastapi import HTTPException, Request

from app.config import Config

COOKIE_NAME = "vid_auth"
_last_fail = 0.0


def _secret() -> bytes:
    return (Config.APP_SECRET or Config.APP_PASSWORD or "vid-local-dev").encode()


def make_token() -> str:
    return hmac.new(_secret(), b"vid-auth-v1", hashlib.sha256).hexdigest()


def token_ok(token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(token, make_token())


async def require_auth(request: Request) -> None:
    """Dependență FastAPI: 401 dacă parola e activă și cookie-ul lipsește/greșit."""
    if not Config.APP_PASSWORD:
        return
    if not token_ok(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=401, detail="Autentificare necesară")


async def check_password(password: str) -> bool:
    """Compară parola cu o mică frână anti brute-force."""
    global _last_fail
    if not Config.APP_PASSWORD:
        return True  # autentificare dezactivată (uz local)
    if hmac.compare_digest(password, Config.APP_PASSWORD):
        _last_fail = 0.0
        return True
    # după o încercare greșită, următoarea așteaptă 1s (nu blochează, doar încetinește)
    now = time.monotonic()
    if now - _last_fail < 1.0:
        time.sleep(1.0)
    _last_fail = now
    return False
