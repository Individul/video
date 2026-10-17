from app.sources.torrents import _parse_btdig, _NON_MEDIA_RE

FIXTURE = """
<div style="display:table">
  <div style="display:table-row">
    <div><a href="https://btdig.com/1addfe413ccf82abfca2a660a7f0cb9654a9387c/0-order-1">
      <span>28.81 GB</span></a></div>
    <div class="torrent_magnet">
      <a href="magnet:?xt=urn:btih:1addfe413ccf82abfca2a660a7f0cb9654a9387c&dn=Nevsky.Nasledstvo.2025.WEB-DLRip&tr=udp://opentor.net">magnet</a>
    </div>
  </div>
  <div style="display:table-row">
    <div class="torrent_magnet">
      <a href="magnet:?xt=urn:btih:2ddeff413ccf82abfca2a660a7f0cb9654a9387c&dn=Nevsky.Book.2023.PDF.mobi">book</a>
    </div>
  </div>
</div>
"""


def test_parse_btdig_extracteaza_din_dn():
    hits = _parse_btdig(FIXTURE)
    assert len(hits) == 2
    first = hits[0]
    assert first["magnet"].startswith("magnet:?xt=urn:btih:")
    assert "Nevsky.Nasledstvo" in first["name"]
    assert first["size"] == "28.81 GB"


def test_filtru_non_media():
    assert _NON_MEDIA_RE.search("Nevsky.Book.2023.PDF.mobi")
    assert _NON_MEDIA_RE.search("Album.2021.flac")
    assert not _NON_MEDIA_RE.search("Nevsky.Nasledstvo.2025.WEB-DLRip")


def test_parse_btdig_dedup():
    assert len(_parse_btdig(FIXTURE + FIXTURE)) == 2
