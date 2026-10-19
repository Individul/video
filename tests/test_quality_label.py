from app.sources import torrents


def test_4k_only_as_separate_mark():
    assert torrents.quality_label("Spider-Man (2026) WEB-DL от ELEKTRI4KA") is None
    assert torrents.quality_label("Spider-Man (2026) WEB-DL 2160p | 4К | HDR") == "4K"
    assert torrents.quality_label("Spider-Man [2026, 4K, HDR]") == "4K"
    assert torrents.quality_label("Spider-Man UHD WEB-DL") == "4K"
