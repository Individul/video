from fastapi.testclient import TestClient

from app.main import app


def test_fara_parola_totul_deschis():
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/auth/status").json() == {"auth_required": False}
        assert c.post("/api/auth/login", json={"password": "orice"}).json()["ok"] is True


def test_cu_parola_flux_complet(monkeypatch):
    from app.config import Config

    monkeypatch.setattr(Config, "APP_PASSWORD", "parola-test")
    monkeypatch.setattr(Config, "APP_SECRET", "secret-test")

    with TestClient(app) as c:
        # fără cookie -> 401
        assert c.get("/api/health").status_code == 401
        assert c.get("/api/browse?category=films").status_code == 401

        # parolă greșită -> 401
        assert c.post("/api/auth/login", json={"password": "greseala"}).status_code == 401

        # parolă corectă -> cookie + acces
        r = c.post("/api/auth/login", json={"password": "parola-test"})
        assert r.status_code == 200
        assert "vid_auth" in r.cookies
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/auth/status").json() == {"auth_required": True}

        # logout -> din nou 401
        assert c.post("/api/auth/logout").status_code == 200
        assert c.get("/api/health").status_code == 401


def test_token_invalid_respins(monkeypatch):
    from app.config import Config

    monkeypatch.setattr(Config, "APP_PASSWORD", "parola-test")
    monkeypatch.setattr(Config, "APP_SECRET", "secret-test")

    with TestClient(app) as c:
        c.cookies.set("vid_auth", "fals")
        assert c.get("/api/health").status_code == 401
