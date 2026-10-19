from app.api.routes import next_episode

SEASONS = [{"season": 0, "episodes": 2}, {"season": 1, "episodes": 16}, {"season": 2, "episodes": 16}, {"season": 4, "episodes": 8}]


def test_next_in_same_season():
    assert next_episode(SEASONS, 2, 12) == {"season": 2, "episode": 13}


def test_last_episode_goes_to_next_season_skipping_missing_ones():
    assert next_episode(SEASONS, 2, 16) == {"season": 4, "episode": 1}


def test_after_series_end_or_without_data():
    assert next_episode(SEASONS, 4, 8) is None
    assert next_episode([], 1, 3) is None
    assert next_episode(SEASONS, None, None) is None  # film


def test_specials_season_is_ignored():
    assert next_episode(SEASONS, 1, 16) == {"season": 2, "episode": 1}
    assert next_episode([{"season": 0, "episodes": 5}, {"season": 1, "episodes": 10}], 1, 10) is None
