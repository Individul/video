from app.sources.torrents import (
    _parse_size_gb,
    pick_file_index,
    quality_label,
    score_torrent,
)


def test_quality_label():
    assert quality_label("Movie.2160p.BluRay") == "4K"
    assert quality_label("Movie.1080p.WEB-DL") == "1080p"
    assert quality_label("Movie.720p.BDRip") == "720p"
    assert quality_label("Movie.(CAM).x264") == "CAM"
    assert quality_label("ceva diferit") is None


def test_parse_size_gb():
    assert abs(_parse_size_gb("1.46 GB") - 1.46) < 0.01
    assert abs(_parse_size_gb("700 MB") - 700 / 1024) < 0.01
    assert abs(_parse_size_gb("1,5 TB") - 1536) < 0.5
    assert _parse_size_gb(None) is None
    assert _parse_size_gb("fără dimensiune") is None


def test_scoring_dubaj_rus_bate_simplu():
    plain = {"name": "Movie 2024 1080p WEB-DL", "size": "8 GB", "seeds": 10}
    dubbed = {"name": "Movie 2024 1080p WEB-DL | Дубляж", "size": "8 GB", "seeds": 10}
    assert score_torrent(dubbed)[0] > score_torrent(plain)[0]


def test_scoring_dubaj_ru_dominanta_calitate():
    # 720p cu dublaj RU bate 1080p EN: audio rusesc > rezoluție
    en_1080 = {"name": "Movie 2024 1080p BluRay x264", "size": "8 GB", "seeds": 30}
    ru_720 = {"name": "Movie 2024 720p BDRip Многоголосый", "size": "4 GB", "seeds": 3}
    assert score_torrent(ru_720)[0] > score_torrent(en_1080)[0]


def test_scoring_an_gresit_penalizat_forte():
    # release cu titlu asemănător dar alt an (remake vechi) nu trebuie să câștige
    wrong_year = {"name": "Операция Rogue (2014) DVDRip | Лицензия", "size": "1.4 GB", "seeds": 5}
    right_movie = {"name": "Операция «Возмездие» / The Fix (2026) WEBRip 1080p | Sub", "size": "3 GB", "seeds": 109}
    s_wrong, _ = score_torrent(wrong_year, query_year=2026)
    s_right, _ = score_torrent(right_movie, query_year=2026)
    assert s_right > s_wrong


def test_scoring_fara_an_in_nume_nu_penalizeaza():
    r = {"name": "Movie 1080p BluRay", "size": "8 GB", "seeds": 5}
    s, _ = score_torrent(r, query_year=2026)
    s0, _ = score_torrent(r, query_year=None)
    assert s == s0


def test_scoring_cam_egal_penalizat_forte():
    cam = {"name": "Movie 2024 (CAM) качество", "size": "1.2 GB", "seeds": 50}
    ok = {"name": "Movie 2024 720p BDRip", "size": "4 GB", "seeds": 1}
    assert score_torrent(ok)[0] > score_torrent(cam)[0]


def test_scoring_trailer_penalizat():
    good = {"name": "Movie 1080p", "size": "8 GB", "seeds": 5}
    trailer = {"name": "Movie 1080p trailer", "size": "300 MB", "seeds": 5}
    assert score_torrent(good)[0] > score_torrent(trailer)[0]


def test_scoring_seedi_ajuta():
    low = {"name": "Movie 1080p", "size": "8 GB", "seeds": 0}
    high = {"name": "Movie 1080p", "size": "8 GB", "seeds": 100}
    assert score_torrent(high)[0] > score_torrent(low)[0]


def test_pick_file_index_patternuri():
    files = [
        {"name": "show/s01e01.mp4"},
        {"name": "Show.S02E05.1080p.mkv"},
        {"name": "Show.S02E06.1080p.mkv"},
    ]
    assert pick_file_index(files, 2, 5) == 1


def test_pick_file_index_format_2x5():
    files = [{"name": "show 2x5 hardcore.mp4"}, {"name": "altceva.mp4"}]
    assert pick_file_index(files, 2, 5) == 0


def test_pick_file_index_rusesc():
    files = [{"name": "Сериал сезон 2 серия 5.mp4"}, {"name": "altul.mp4"}]
    assert pick_file_index(files, 2, 5) == 0


def test_pick_file_index_fallback_video():
    files = [{"name": "poster.jpg"}, {"name": "film.mkv"}, {"name": "sub.srt"}]
    assert pick_file_index(files, 3, 3) == 1  # fără potrivire → primul video


def test_pick_file_index_fara_match():
    assert pick_file_index([], 1, 1) is None


# ---------- sezoane: pachete și potrivire exactă ----------

def test_pack_mentions_season():
    from app.sources.torrents import pack_mentions_season

    assert pack_mentions_season("Жуки / S4E1-17 of 17 (2024) WEBRip 1080p", 4)
    assert pack_mentions_season("Жуки 3 сезон (2022) WEBRip", 3)
    assert pack_mentions_season("Serial 2x01 pack", 2)
    assert pack_mentions_season("Сериал сезон 5 (полный)", 5)
    # alt sezon -> False
    assert not pack_mentions_season("Жуки / S3E1-16 of 16 (2022)", 4)
    assert not pack_mentions_season("Жуки 3 сезон", 4)


def test_find_episode_file_rute_nume():
    from app.sources.torrents import find_episode_file

    # ordine rusească „3 сезон 1 серия"
    files = [{"name": "serial.3.sezon.1.serija.mkv"}, {"name": "altceva.mkv"}]
    assert find_episode_file(files, 3, 1) == 0
    # sezon+episod concatenate (407.avi)
    files = [{"name": "407.avi"}, {"name": "altceva.mkv"}]
    assert find_episode_file(files, 4, 7) == 0
    # fără potrivire -> None (nu mai ia mut primul video)
    files = [{"name": "Zhuki.S03.E01.mkv"}, {"name": "Zhuki.S03.E02.mkv"}]
    assert find_episode_file(files, 4, 7) is None


def test_find_episode_file_nu_confunda_sezoane():
    from app.sources.torrents import find_episode_file

    # S03.E07 NU e sezonul 4 episodul 7
    files = [{"name": "Zhuki.S03.E07.2022.mkv"}]
    assert find_episode_file(files, 4, 7) is None
    assert find_episode_file(files, 3, 7) == 0


def test_find_episode_file_nivelul2_numar_izolat():
    from app.sources.torrents import find_episode_file

    # nume reale din pachete RU: „07.08. Жуки.S04.2024.WEB-DL 1080p.mkv”
    files = [
        {"name": "01.02. Жуки.S04.2024.WEB-DL 1080p.Files-x.mkv"},
        {"name": "03.04. Жуки.S04.2024.WEB-DL 1080p.Files-x.mkv"},
        {"name": "07.08. Жуки.S04.2024.WEB-DL 1080p.Files-x.mkv"},
    ]
    assert find_episode_file(files, 4, 7) == 2
    assert find_episode_file(files, 4, 1) == 0
    assert find_episode_file(files, 4, 3) == 1
    # fără sezonul în nume -> nivelul 2 nu se aplică
    assert find_episode_file([{"name": "07.08. altceva.mkv"}], 4, 7) is None


def test_find_episode_file_episod_fara_sezon_in_nume():
    from app.sources.torrents import find_episode_file

    # nume reale din pachetul S1 „Жуки": sezonul doar în titlul pachetului
    files = [
        {"name": "Zhuki.e01.2019.WEB-DL.(720p).ExKinoRay.mkv"},
        {"name": "Zhuki.e07.2019.WEB-DL.(720p).ExKinoRay.mkv"},
        {"name": "Zhuki.e08.2019.WEB-DL.(720p).ExKinoRay.mkv"},
        {"name": "Жуки - Фильм о сериале (2019).mkv"},
    ]
    assert find_episode_file(files, 1, 8) == 2
    assert find_episode_file(files, 1, 1) == 0
    assert find_episode_file(files, 1, 7) == 1
    # filmul bonus nu se confundă cu vreun episod
    assert find_episode_file(files, 1, 16) is None


def test_find_episode_file_episod_simplu_nu_ia_alt_sezon():
    from app.sources.torrents import find_episode_file

    # fișier cu propriul marker de sezon (S02) nu se alege pentru sezonul 1
    files = [{"name": "Show.s02e08.1080p.mkv"}, {"name": "Show.e08.mkv"}]
    assert find_episode_file(files, 1, 8) == 1
    assert find_episode_file(files, 2, 8) == 0
