# Cinema — portal personal de filme, seriale și sport

Portal web **personal** (un singur utilizator, cu parolă): catalog de filme și seriale de la TMDB cu
descrieri în **rusă**, redare prin torrente cu TorrServer direct în browser, sport (RGFootball) și
transmisii live prin Ace Stream. Rulează 24/7 pe un VPS, în Docker, în spatele lui Caddy (HTTPS).

> Ramura **`vps`** e versiunea de pe server. Ramura `main` e versiunea veche, locală (Windows).
> Instalarea și întreținerea serverului: **[README-WEB.md](README-WEB.md)**.

## Ce face

- **Catalog**: Filme, Seriale, Desene animate, Anime — filtre gen/an/sortare, căutare, pagini de actori.
- **Detalii titlu**: descriere, distribuție, trailer, titluri similare, episoade cu miniaturi și progres;
  rating Kinopoisk + IMDb (opțional, cu `KP_API_KEY`).
- **Redare**: alegere automată a release-ului (preferă 1080p H.264 pentru browser; 4K/HEVC rămân în listă),
  potrivire automată a episodului din pachete, reluare de unde ai rămas.
- **Modul cinema**: player pe toată fereastra cu panouri pentru versiuni, episoade și starea torrentului
  (peers, viteză, cât e încărcat în avans); subtitrări din torrent (.srt) sau extrase din MKV.
- **Sport**: ultimele apariții RGFootball (fără secțiunile VIP).
- **Live**: transmisii Ace Stream după ID-urile `acestream://…` aduse de utilizator; canale salvate.
  Pagina aduce automat **evenimentele sportive ale zilei de pe pimpletv.ru** (fotbal, hochei…, ore ora
  Moscovei): un click pe „Pornește” rezolvă pagina meciului la ID-ul Ace Stream și pornește redarea.
- **Cărți audio**: noutăți pe genuri direct de pe trackere (RuTracker, NNM-Club), cu coperți, descrieri și
  genuri de pe LitRes; aceeași carte de la mai mulți cititori = o carte cu mai multe versiuni. „Adaugă”
  o descarcă pe server (qBittorrent, `./media/audiobooks`), iar playerul de jos ține minte pista și
  secunda (±30 s, viteză 0.75–2×). **Biblioteca** arată descărcările și spațiul liber.
- **Calendar**: aparițiile viitoare (filme și episoade noi).
- **Torrente**: căutare directă în toate sursele, pentru orice release.
- **Watchlist**, **Continuă** (istoric), **Descărcări** (cache-ul TorrServer).

## Arhitectura

```
browser ──HTTPS──▶ Caddy ──▶ vid (FastAPI + SQLite, parolă)
                     │          ├──▶ TMDB / Kinopoisk (catalog)
                     │          ├──▶ Jackett ──▶ FlareSolverr (trackere, Cloudflare)
                     │          ├──▶ Rutor / BTDig (magneți)
                     │          ├──▶ motorul Ace Stream (API intern)
                     │          ├──▶ LitRes (coperți cărți audio)
                     │          └──▶ qBittorrent ──▶ ./media/audiobooks (6882)
                     ├─/ts/stream/*──(după login)──▶ TorrServer ──▶ peers BitTorrent (6881)
                     └─/ace/c/*─────(după login)──▶ Ace Stream ──▶ peers Ace (8621)
```

| Container | Rol | Memorie max. |
|-----------|-----|--------------|
| `caddy` | HTTPS (Let's Encrypt), login pentru stream-uri, fără HTTP/3 | 128 MB |
| `vid` | portalul (API + interfață), ffmpeg pentru subtitrări | 384 MB |
| `torrserver` | streaming torrent, cache 1 GB în RAM | 1,5 GB |
| `jackett` | căutare pe trackere (rutracker, nnmclub, …) | 384 MB |
| `flaresolverr` | trece de Cloudflare pentru Jackett | 768 MB |
| `acestream` | motorul Ace Stream 3.2.11 (pachetul oficial), cache disc ≤ 300 MB | 1 GB |
| `qbittorrent` | descarcă cărțile audio pe disc (API doar în rețeaua Docker) | 384 MB |

Spre internet sunt deschise doar 80/443 (Caddy), 6881 (TorrServer), 6882 (qBittorrent) și 8621 (Ace Stream).

## Dezvoltare locală

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # Windows
cp .env.vps.example .env                                    # completează TMDB_API_KEY etc.
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
.venv/Scripts/python -m pytest -q
```

Testele rulează fără internet (parsare pe HTML fix, logică DB în memorie). Pe server, testele nu sunt
în imagine: `docker cp tests vid:/srv/vid/ && docker exec vid python -m pytest -q tests`
(câteva teste de autentificare/ffmpeg pică acolo din cauza mediului de producție).

## API (prefix `/api`)

| Grup | Rute |
|------|------|
| Catalog | `GET /search`, `/browse`, `/genres`, `/title/{id}`, `/title/{id}/episodes`, `/person/{id}`, `/calendar`; `POST /titles` |
| Torrente | `GET /torrents`, `/torrents/search`, `/torrents/stats/{hash}`; `POST /torrents/play`, `/torrents/drop` |
| Descărcări | `GET /downloads`, `DELETE /downloads/{hash}` |
| Subtitrări | `GET /subtitles/embed`, `/subtitles/file`, `/subtitles/mux`, `/subtitles/mux/data`; `DELETE /subtitles/mux` |
| Sport | `GET /sport` |
| Cărți audio | `GET /books/genres`, `/books/browse?genre=&q=`, `/books/book?author=&title=`, `/books/meta`, `/books/library`, `/books/{hash}/tracks`, `/books/{hash}/file/{index}`; `POST /books/add`; `PUT /books/{hash}/progress`; `DELETE /books/{hash}` |
| Live | `POST /live/start`, `GET /live/m/{ih}/{sess}.m3u8`, `/live/stat/{ih}/{sess}`, `POST /live/stop/{ih}/{sess}`, `GET/POST /live/channels`, `DELETE /live/channels/{h}` |
| Live evenimente | `GET /live/events` (pimpletv.ru: meciurile zilei, ore ora Moscovei), `POST /live/events/play {url}` (rezolvă pagina meciului la ID-ul Ace Stream și pornește) |
| Utilizator | `GET/POST /watchlist`, `DELETE /watchlist/{id}`, `GET/POST /history`, `GET /title/{id}/history` |
| Stare | `GET /health` (200 doar cu sesiune validă — folosit de Caddy pentru stream-uri) |

## Configurare (`.env`)

| Variabilă | Descriere |
|-----------|-----------|
| `DOMAIN` | domeniu(ii) pentru HTTPS, separate prin virgulă |
| `APP_PASSWORD`, `APP_SECRET` | parola portalului și secretul sesiunilor |
| `TMDB_API_KEY` | cheie TMDB (obligatorie) |
| `TORZNAB_API_KEY` | cheia API Jackett |
| `KP_API_KEY` | opțional, kinopoiskapiunofficial.tech (rating KP + IMDb) |
| `OS_API_KEY` | opțional, OpenSubtitles |
| `PROXY` | opțional, dacă Rutor/BTDig blochează IP-ul serverului |

## Structura

```
app/
  main.py, config.py, db.py, models.py
  api/routes.py
  services/  catalog.py, search.py
  sources/   tmdb.py, kinopoisk.py, torrents.py, subtitles.py, sport.py, live.py, pimple.py, calendar.py
  static/    index.html, style.css, js/ (13 scripturi în ordine: 01-core … 13-init)
deploy/      setup-vps.sh, secure-vps.sh, backup.sh, torrserver-watchdog.sh, acestream/Dockerfile
tests/
docker-compose.yml, Caddyfile, Dockerfile
```
