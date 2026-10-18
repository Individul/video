from fastapi.testclient import TestClient

from app import auth
from app.main import app


def _client(monkeypatch):
    from app.config import Config

    monkeypatch.setattr(Config, "APP_PASSWORD", "parola-test")
    monkeypatch.setattr(Config, "APP_SECRET", "secret-test")
    monkeypatch.delenv("HTTPS_ON", raising=False)
    monkeypatch.setattr(auth, "_fails", {})
    monkeypatch.setattr(auth, "_blocked_until", {})
    return TestClient(app)


def _login(c, password, ip="1.2.3.4"):
    return c.post("/api/auth/login", json={"password": password}, headers={"X-Forwarded-For": ip})


def test_block_after_five_wrong_passwords(monkeypatch):
    with _client(monkeypatch) as c:
        for left in (4, 3, 2, 1):
            r = _login(c, "gresit")
            assert r.status_code == 401 and f"mai ai {left}" in r.json()["detail"]
        r = _login(c, "gresit")
        assert r.status_code == 429 and "Retry-After" in r.headers
        # blocat: nici parola corectă nu trece de pe acel IP
        assert _login(c, "parola-test").status_code == 429
        # alt IP nu e afectat
        assert _login(c, "parola-test", ip="5.6.7.8").status_code == 200


def test_block_expires_and_success_resets(monkeypatch):
    with _client(monkeypatch) as c:
        for _ in range(3):
            _login(c, "gresit")
        assert _login(c, "parola-test").status_code == 200
        assert _login(c, "gresit").json()["detail"].endswith("mai ai 4 încercări)")  # contorul s-a resetat

    assert auth.register_fail("9.9.9.9", now=0) == 4
    auth._blocked_until["9.9.9.9"] = 100
    assert auth.login_blocked("9.9.9.9", now=50) == 51
    assert auth.login_blocked("9.9.9.9", now=101) == 0


def test_client_ip_uses_last_forwarded_entry():
    class R:
        headers = {"x-forwarded-for": "6.6.6.6, 203.0.113.9"}
        client = None

    assert auth.client_ip(R()) == "203.0.113.9"  # primul îl poate falsifica clientul, ultimul îl pune Caddy
