from app.sources.torrents import _not_audio_or_books, relevant, searchable


def test_unrelated_latest_releases_are_dropped():
    rows = [{"name": "Фонари / Lanterns [S01] (2026) WEB-DL 1080p"},
            {"name": "Надежда / Hope (2026) WEB-DL 1080p | D, Р"},
            {"name": "Человек-паук: Новый день (2026) WEB-DL"}]
    assert [r["name"][:7] for r in relevant(rows, "Надежда 2026")] == ["Надежда"]
    assert [r["name"][:7] for r in relevant(rows, "Hope 2026")] == ["Надежда"]
    # titlu în coreeană: nimic nu se potrivește -> serverul trece la numele alternativ
    assert relevant(rows, "호프 2026") == []


def test_query_without_words_keeps_everything_and_yo_is_e():
    rows = [{"name": "Ёлки 12 (2026)"}]
    assert relevant(rows, "2026") == rows
    assert relevant(rows, "Елки 2026") == rows


def test_searchable_scripts():
    assert searchable("Hope") and searchable("Надежда")
    assert not searchable("호프") and not searchable("鬼滅の刃") and not searchable("") and not searchable(None)


def test_music_and_books_are_not_film_versions():
    rows = [{"name": "Гениальный план / Masterplan (2026) WEB-DL | D", "cats": ["2000", "100313"]},
            {"name": "[TR24][OF] Masterplan - Metalmorphosis - 2026 (Power Metal)", "cats": ["3000", "3040", "101702"]},
            {"name": "Masterplan (аудиокнига)", "cats": ["3030"]},
            {"name": "Rutor fără categorii"}]
    out = _not_audio_or_books(rows)
    assert [r["name"][:10] for r in out] == ["Гениальный", "Rutor fără"]
    assert "cats" not in out[0]
