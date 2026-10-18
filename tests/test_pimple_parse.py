import pytest

from app.sources import pimple
from app.sources.base import SourceError

# fragment cu structura reală a primei pagini pimpletv.ru:
# două zile, un meci live (minut), unul la pauză și unul viitor (ora de start)
HOME = """
<div class="sport">
<div class="streams-day">18 октября</div>
<a href="/football/72435-ural-nizhniy-novgorod/" class="match-item _rates">
  <div class="match-item__title">
    <div class="match-item__title-date liveTime">92'</div>
    <div class="match-item__title-tournament">Первая лига Россия</div>
    <div class="match-item__title-name">
      <span class="match-item__title-name-row"><span class="table-item home">
        <span class="table-item__home-name">Урал</span></span></span>
      <span class="match-item__title-separ">–</span>
      <span class="match-item__title-name-row"><span class="table-item away">
        <span class="table-item__away-name">Нижний Новгород</span></span></span>
    </div>
  </div>
  <div class="match-item__status"><div class="match-item__logo-channel">МАТЧ! HD</div></div>
</a>
<a href="/football/72441-zenit-akhmat/" class="match-item">
  <div class="match-item__title">
    <div class="match-item__title-date liveTime">Перерыв</div>
    <div class="match-item__title-tournament">Премьер-лига Россия</div>
    <div class="match-item__title-name">
      <span class="match-item__title-name-row"><span class="table-item home">
        <span class="table-item__home-name">Зенит</span></span></span>
      <span class="match-item__title-separ">–</span>
      <span class="match-item__title-name-row"><span class="table-item away">
        <span class="table-item__away-name">Ахмат</span></span></span>
    </div>
  </div>
  <div class="match-item__status"><div class="match-item__logo-channel">МАТЧ ПРЕМЬЕР HD</div></div>
</a>
<div class="streams-day">19 октября</div>
<a href="/hockey/72600-spartak-dynamo/" class="match-item">
  <div class="match-item__title">
    <div class="match-item__title-date"><div>19:30</div></div>
    <div class="match-item__title-tournament">КХЛ</div>
    <div class="match-item__title-name">
      <span class="match-item__title-name-row"><span class="table-item home">
        <span class="table-item__home-name">Спартак</span></span></span>
      <span class="match-item__title-separ">–</span>
      <span class="match-item__title-name-row"><span class="table-item away">
        <span class="table-item__away-name">Динамо</span></span></span>
    </div>
  </div>
  <div class="match-item__status"><div class="match-item__logo-channel">KHL TV</div></div>
</a>
<a href="/category/football/" class="match-item"><div class="match-item__title"></div></a>
</div>
"""

# pagina unui meci: exact un link acestream (uneori repetat în alte zone ale paginii)
MATCH = """
<div class="broadcast">Смотреть онлайн</div>
<a href="acestream://aca05dc506242324c1727525d0535ceda24f8dea">Ace Stream HD</a>
<script>var id = "acestream://ACA05DC506242324C1727525D0535CEDA24F8DEA";</script>
"""


def test_parse_events_campuri_si_ordine():
    evs = pimple.parse_events(HOME)
    assert len(evs) == 3
    assert evs[0]["home"] == "Урал"
    assert evs[0]["away"] == "Нижний Новгород"
    assert evs[0]["league"] == "Первая лига Россия"
    assert evs[0]["channel"] == "МАТЧ! HD"
    assert evs[0]["sport"] == "football"
    assert evs[0]["url"] == f"{pimple.BASE}/football/72435-ural-nizhniy-novgorod/"
    assert evs[2]["sport"] == "hockey"  # sportul vine din calea paginii


def test_parse_events_zi_si_stare_live():
    evs = pimple.parse_events(HOME)
    assert [e["day"] for e in evs] == ["18 октября", "18 октября", "19 октября"]
    assert [(e["when"], e["is_live"]) for e in evs] == [
        ("92'", True),          # minut live
        ("Перерыв", True),      # pauză
        ("19:30", False),       # nu a început
    ]


def test_flag_of_dupa_liga():
    assert pimple.flag_of("Серия А Италия") == "it"
    assert pimple.flag_of("Премьер-лига Англия") == "gb-eng"
    assert pimple.flag_of("Профессиональная лига Аргентины") == "ar"  # caz declinat
    assert pimple.flag_of("Лига чемпионов УЕФА") == "eu"
    # țara câștigă în fața cuvintelor UEFA (verificate ultima)
    assert pimple.flag_of("Лига чемпионов. Россия") == "ru"
    assert pimple.flag_of("Товарищеский матч") is None  # internațional, fără steag


def test_parse_events_flag():
    evs = pimple.parse_events(HOME)
    assert [e["flag"] for e in evs] == ["ru", "ru", "ru"]  # Rusia, Rusia, КХЛ


def test_extract_ids_dedupe_si_lowercase():
    assert pimple.extract_ids(MATCH) == ["aca05dc506242324c1727525d0535ceda24f8dea"]
    assert pimple.extract_ids("<p>fără nimic</p>") == []


def test_resolve_refuza_adrese_straine():
    with pytest.raises(SourceError):
        pimple.resolve("https://evil.example.com/football/1-a/acestream://x")
    with pytest.raises(SourceError):
        pimple.resolve("https://www.pimpletv.ru/wp-login.php")
    with pytest.raises(SourceError):
        pimple.resolve("not a url")


def test_resolve_alege_id_din_pagina(monkeypatch):
    monkeypatch.setattr(pimple, "_get", lambda url, timeout=20: MATCH)
    assert pimple.resolve("https://www.pimpletv.ru/football/72435-ural-nizhniy-novgorod/") == \
        "aca05dc506242324c1727525d0535ceda24f8dea"
