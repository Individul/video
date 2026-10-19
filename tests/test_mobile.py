from app.sources import torrents


def r(name, size, seeds=10):
    return {"name": name, "size": size, "seeds": seeds}


def test_mobile_tags_and_light_releases():
    assert torrents.is_mobile(r("[iPad] / Interstellar [2014, BDRip, SD (576p)] Dub", "2.90 GB"))
    assert torrents.is_mobile(r("Интерстеллар / Interstellar (2014) BDRip от MediaClub | КПК", "762.74 MB"))
    assert torrents.is_mobile(r("[iPhone][Cartoon]/Shrek 1-2 [2001-2007, DVDRip]", "895.67 MB"))
    # ușor, H.264, fără marcaj special
    assert torrents.is_mobile(r("Дюна / Dune: Part One (2021) BDRip-AVC", "1.96 GB"))


def test_not_mobile():
    assert not torrents.is_mobile(r("Dune [2021, BDRip 1080p] Dub", "14.5 GB"))  # greu
    assert not torrents.is_mobile(r("Dune [2021, WEB-DL 2160p, HEVC] Dub", "2.4 GB"))  # 4K/HEVC
    assert not torrents.is_mobile(r("Dune (2021) HEVC 1080p", "2.0 GB"))  # HEVC
    assert not torrents.is_mobile(r("Dune trailer", "0.1 GB"))  # suspect de mic
    assert not torrents.is_mobile(r("Dune", None))  # fără mărime


def test_mobile_score_prefers_light_but_keeps_ru_dub_dominant():
    heavy = r("Dune [2021, BDRip 1080p] Dub", "14.5 GB", seeds=400)
    light = r("Дюна / Dune (2021) BDRip-AVC Dub", "1.96 GB", seeds=400)
    light_en = r("Dune (2021) BDRip-AVC", "1.90 GB", seeds=400)
    sh, _ = torrents.score_torrent(heavy)
    sl, _ = torrents.score_torrent(light)
    se, _ = torrents.score_torrent(light_en)
    assert sh > sl  # pe desktop rămâne 1080p
    assert torrents.mobile_score(light, sl) > torrents.mobile_score(heavy, sh)  # pe telefon câștigă cel ușor
    assert torrents.mobile_score(heavy, sh) > torrents.mobile_score(light_en, se)  # dublajul RU contează mai mult


def test_hevc_never_mobile_even_with_tag():
    assert not torrents.is_mobile(r("[iPad] / Dune [2021, BDRip, HEVC] Dub", "1.9 GB"))
    assert not torrents.is_mobile(r("Dune (2021) WEB-DL x265 10bit | КПК", "1.2 GB"))
    assert not torrents.is_mobile(r("Dune (2021) WEB-DL 1080p 10-bit", "2.0 GB"))


def test_4k_only_as_separate_mark():
    assert torrents.quality_label("Spider-Man (2026) WEB-DL от ELEKTRI4KA") is None
    assert torrents.quality_label("Spider-Man (2026) WEB-DL 2160p | 4К | HDR") == "4K"
    assert torrents.quality_label("Spider-Man [2026, 4K, HDR]") == "4K"
    assert torrents.quality_label("Spider-Man UHD WEB-DL") == "4K"
    assert torrents.is_mobile({"name": "Человек-паук (2026) WEB-DL от ELEKTRI4KA", "size": "2.18 GB"})
