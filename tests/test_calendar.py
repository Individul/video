from datetime import date

import pytest

from app.sources import calendar as cal

TODAY = date(2026, 10, 17)


def fake_tmdb(path, **params):
    """TMDB simulat: 2 filme (unul cu digital în fereastră, unul doar în cinema, departe)
    și 2 seriale (unul urmărit, cu episod mâine; unul fără episod programat)."""
    if path == "/discover/movie":
        if params.get("page") != 1:
            return {"results": []}
        return {"results": [
            {"id": 1, "title": "Film Digital", "poster_path": "/a.jpg", "release_date": "2026-08-01", "popularity": 50},
            {"id": 2, "title": "Film Cinema", "poster_path": "/b.jpg", "release_date": "2026-11-20", "popularity": 80},
            {"id": 3, "title": "Fără poster", "poster_path": None, "release_date": "2026-10-20", "popularity": 99},
        ]}
    if path == "/movie/upcoming":
        return {"results": []}
    if path == "/movie/1/release_dates":
        return {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 3, "release_date": "2026-08-01T00:00:00.000Z"},
                {"type": 4, "release_date": "2026-10-14T00:00:00.000Z"},
            ]},
        ]}
    if path == "/movie/2/release_dates":
        return {"results": [
            {"iso_3166_1": "DE", "release_dates": [{"type": 3, "release_date": "2026-11-20T00:00:00.000Z"}]},
        ]}
    if path == "/movie/3/release_dates":
        return {"results": [{"iso_3166_1": "US", "release_dates": [{"type": 3, "release_date": "2026-10-20T00:00:00.000Z"}]}]}
    if path == "/discover/tv":
        return {"results": [{"id": 20}] if params.get("page") == 1 else []}
    if path == "/tv/10":
        return {"id": 10, "name": "Serialul meu", "poster_path": "/s.jpg", "first_air_date": "2024-01-01",
                "popularity": 5, "next_episode_to_air": {"air_date": "2026-10-18", "season_number": 2,
                                                         "episode_number": 5, "name": "Ep"}}
    if path == "/tv/20":
        return {"id": 20, "name": "Fără episod", "poster_path": "/t.jpg", "next_episode_to_air": None}
    raise AssertionError(f"apel neașteptat {path}")


@pytest.fixture(autouse=True)
def tmdb(monkeypatch):
    monkeypatch.setattr(cal, "_get", fake_tmdb)
    monkeypatch.setattr(cal, "_cache", {})


def test_release_dates_us_si_fallback():
    assert cal.release_dates_of(1) == {"cinema": "2026-08-01", "digital": "2026-10-14"}
    # fără SUA -> prima țară care are date
    assert cal.release_dates_of(2) == {"cinema": "2026-11-20", "digital": None}


def test_calendar_fereastra_si_tipuri():
    ev = cal.calendar(7, 60, [10], today=TODAY)
    kinds = [(e["date"], e["kind"], e["hit"]["name"]) for e in ev]
    assert ("2026-10-14", "digital", "Film Digital") in kinds  # lansare digitală recentă (în ultimele 7 zile)
    assert ("2026-11-20", "cinema", "Film Cinema") in kinds
    assert not any(n == "Fără poster" for _, _, n in kinds)  # fără poster nu intră
    assert not any(e["kind"] == "cinema" and e["hit"]["name"] == "Film Digital" for e in ev)  # august e în afara ferestrei
    ep = next(e for e in ev if e["kind"] == "episode")
    assert (ep["date"], ep["season"], ep["episode"], ep["followed"]) == ("2026-10-18", 2, 5, True)
    assert ep["hit"]["source_url"].endswith("/tv/10")
    assert [e["date"] for e in ev] == sorted(e["date"] for e in ev)  # sortat cronologic


def test_calendar_fereastra_scurta_exclude_viitorul_indepartat():
    ev = cal.calendar(0, 10, [], today=TODAY)
    assert all(TODAY.isoformat() <= e["date"] <= "2026-10-27" for e in ev)
    assert not any(e["kind"] == "digital" for e in ev)  # 14 oct e înainte de azi, cu back=0
