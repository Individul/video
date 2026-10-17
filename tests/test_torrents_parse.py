from app.sources.torrents import _parse_rutor

FIXTURE = """
<table>
<tr class="gai">
  <td>15 Окт 26</td>
  <td><a class="downgif" href="//d.rutor.info/download/1108025"><img alt="D"></a>
      <a href="magnet:?xt=urn:btih:9fbcbf1a3d2b4d0d9c9edf7c9e6a1f1c2b3a4d5d&tr=udp://opentor.net">M</a>
      <a href="/torrent/1108025/igra-v-kalmar-2021-bdrip-1080p">Игра в кальмары (2021) BDRip 1080p</a></td>
  <td align="right">19.56 GB</td>
  <td align="center"><span class="green">113</span> <span class="red">237</span></td>
</tr>
<tr class="tum">
  <td>15 Окт 26</td>
  <td><a href="magnet:?xt=urn:btih:aabcbf1a3d2b4d0d9c9edf7c9e6a1f1c2b3a4d5d">M</a>
      <a href="/torrent/1108027/igra-v-kalmar-2021-web-dl-720p">Игра в кальмары (2021) WEB-DL 720p</a></td>
  <td align="right">2.1 GB</td>
  <td align="center"><span class="green">34</span> <span class="red">56</span></td>
</tr>
</table>
"""


def test_parse_rutor_extracts_magnets():
    hits = _parse_rutor(FIXTURE)
    assert len(hits) == 2
    first, second = hits
    assert "Игра в кальмары" in first["name"]
    assert first["magnet"].startswith("magnet:?xt=urn:btih:")
    assert first["size"] == "19.56 GB"
    assert first["seeds"] == 113
    assert second["seeds"] == 34
    assert second["size"] == "2.1 GB"


def test_parse_rutor_dedup_and_empty():
    assert len(_parse_rutor(FIXTURE + FIXTURE)) == 2
    assert _parse_rutor("<table></table>") == []
