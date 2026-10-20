import io

from app.sources import epg

NOW = 1792500000  # 2026-10-19 ~17:20 UTC
X = """<?xml version="1.0" encoding="utf-8"?>
<tv>
<channel id="perviy"><display-name>Первый</display-name></channel>
<programme start="{a}" stop="{b}" channel="perviy"><title>Новости</title></programme>
<programme start="{b}" stop="{c}" channel="perviy"><title>Футбол. Лига чемпионов. Реал — Бавария</title></programme>
<programme start="{c}" stop="{d}" channel="perviy"><title>Вечерний Ургант</title></programme>
<programme start="{c}" stop="{d}" channel="perviy"><title>Вечерний Ургант</title></programme>
<programme start="{old}" stop="{old2}" channel="perviy"><title>Футбол. Обзор тура</title></programme>
<programme start="{b}" stop="{c}" channel="kino"><title>Х/ф Ёлки</title></programme>
<programme start="{b}" stop="{c}" channel="other"><title>Nu e în playlist</title></programme>
</tv>"""


def t(ts):
    import time

    return time.strftime("%Y%m%d%H%M%S +0000", time.gmtime(ts))


def doc():
    return X.format(a=t(NOW - 3600), b=t(NOW - 600), c=t(NOW + 3000), d=t(NOW + 6000), old=t(NOW - 2 * 86400), old2=t(NOW - 2 * 86400 + 3600)).encode()


def test_parse_time_with_and_without_zone():
    assert epg.parse_time("20261020144000 +0300") == epg.parse_time("20261020114000 +0000")
    assert epg.parse_time("20261020114000") == epg.parse_time("20261020114000 +0000")
    assert epg.parse_time("bad") is None


def test_parse_keeps_window_and_known_channels():
    progs = epg.parse(io.BytesIO(doc()), {"perviy": 5, "kino": 0}, now=NOW)
    assert set(progs) == {"perviy", "kino"}
    assert [p[2] for p in progs["perviy"]][0] == "Футбол. Обзор тура"  # arhiva de 5 zile o păstrează
    progs = epg.parse(io.BytesIO(doc()), {"perviy": 0}, now=NOW)
    assert "Футбол. Обзор тура" not in [p[2] for p in progs["perviy"]]  # fără arhivă: doar ultimele ore


def test_now_next_guide_and_search(monkeypatch):
    monkeypatch.setitem(epg._state, "progs", epg.parse(io.BytesIO(doc()), {"perviy": 5, "kino": 0}, now=NOW))
    cur, nxt = epg.now_next("perviy", now=NOW)
    assert cur[0].startswith("Футбол. Лига") and nxt[0] == "Вечерний Ургант"
    assert epg.now_next("missing", now=NOW) is None
    g = epg.guide("perviy", 5, now=NOW)
    assert [x["archive"] for x in g] == [True, True, False, False] and [x["live"] for x in g] == [False, False, True, False]
    chans = [{"id": "a" * 12, "name": "Первый", "tvg_id": "perviy", "catchup_days": 5},
             {"id": "b" * 12, "name": "Кино", "tvg_id": "kino", "catchup_days": 0}]
    res = epg.search("футбол", chans, now=NOW)
    assert [r["title"][:12] for r in res] == ["Футбол. Лига", "Футбол. Обзо"]  # acum, apoi arhiva
    assert res[0]["live"] and res[1]["archive"]
    assert epg.search("елки", chans, now=NOW)[0]["channel"] == "Кино"  # ё = е
    assert epg.search("x", chans, now=NOW) == []
    twice = chans + [{**chans[0], "id": "c" * 12}]  # același canal de două ori în playlist
    assert len(epg.search("футбол", twice, now=NOW)) == 2
