# vid.local — agregator filme & seriale (TMDB + TorrServer)

Aplicatie **locala, personala** (FastAPI + SQLite + UI web): catalog de filme/seriale cu
descrieri in **rusa** de la TMDB, cautare, browsare, watchlist, istoric ("continua de unde
ai ramas") si **redare prin torrenti** cu TorrServer (dublaj voiceover rusesc din riple-urile
publice).

## Arhitectura (simpla si stabila)
| Componenta | Rol | Anti-bot? |
|------------|-----|-----------|
| **TMDB**   | catalog: cautare, detalii, postere, descrieri ru-RU | nu (API oficial, gratuita) |
| **Rutor**  | cautare magneți după titlu (+an) | nu |
| **TorrServer** | streaming torrent local (instalat de tine) | - |

## Instalare + configurare
1. `python -m venv .venv` ; `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`
2. **TMDB key** (gratuit): cont pe themoviedb.org → Settings → API → copiaza cheia v3
   → pun-o in `.env`: `TMDB_API_KEY=...`
3. **TorrServer**: descarca `TorrServer.exe` (github.com/YouROK/TorrServer/releases) si porneste
   dublu-click (port 8090). Portul se poate schimba in `.env` (TORRSERVER_URL).
4. Porneste serverul: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`
   → http://localhost:8000

## Utilizare
- cauti titlul (in rusa sau engleza) → detalii cu descriere ru-RU
- „Caută magneți (RU)" → lista de release-uri cu dimensiune + seederi
- ▶ pe un magneț → TorrServer il indexeaza si difuzeaza direct in player-ul din modala
  (primul pornire poate dura pana la primul chunk; seek merge, istoricul salveaza pozitia)

## API
- `GET /api/health` — status
- `GET /api/search?q=` — cautare TMDB (ru-RU)
- `GET /api/browse?category=films|series&page=&genre=&year=&sort=` — TMDB cu filtre
- `GET /api/genres?category=` — lista de genuri TMDB
- `GET /api/title/{id}` — detalii TMDB (+sezoane/episoade, trailer, distribuție, similare)
- `GET /api/title/{id}/history` — progres per episod
- `GET /api/torrents?q=&year=&alt=` — magneți (Jackett→Rutor→BTDig), scor + badge calitate, fallback pe numele alternativ
- `POST /api/torrents/play {source, index, season?, episode?}` — TorrServer → {stream_url, files}; cu sezon/episod alege fișierul potrivit
- `GET /api/downloads` + `DELETE /api/downloads/{hash}` — cache TorrServer (listă/golire)
- `POST /api/titles` — înregistrează titlu dintr-un hit (titluri similare)
- watchlist cu status (`to_watch|watching|watched`) + istoric upsert (un rând per titlu+sezon+episod)

## Funcționalități UI
- routing cu hash (butonul Back funcționează), skeletoane la încărcare, notificări toast
- filtre gen/an/sortare pe paginile Filme/Seriale
- modala de detaliu cu taburi: Redare / Episoade (grid cu miniaturi + progres) / Detalii (distribuție, trailer, titluri similare)
- redare: film = cel mai bun release automat; serial = cauți episodul (S01E05), potrivirea fișierului din pachet e automată; resume pe episod
- player: taste rapide (space/k, ←/→, F, M), dublu-click fullscreen, PiP, spinner buffering
- pagina Descărcări: ce e în cache-ul TorrServer + ștergere individuală/masă

## Config (.env)
| Variabila | Default | Descriere |
|-----------|---------|-----------|
| `TMDB_API_KEY` | - | cheie TMDB (obligatorie) |
| `TMDB_LANG` | `ru-RU` | limba descrierilor |
| `TORRSERVER_URL` | `http://127.0.0.1:8090` | adresa TorrServer |
| `RUTOR_MIRRORS` | rutor.info/.org/.is | ordinea mirror-urilor la cautare |
| `TORRENT_LIMIT` | `15` | nr. max de magneți listati |

## Structura
```
app/  main.py, config.py, db.py, models.py
  api/routes.py
  services/ catalog.py, search.py
  sources/  base.py, tmdb.py, torrents.py
  static/   index.html, app.js, style.css
tests/      parsare (rutor, btdig, torznab), logic DB
```

## Note
- `pytest` ruleaza fara internet (parsare pe HTML fix, logic DB in-memory)
- uz personal, rata limitata la surse externe
- **publicare pe web (VPS, Docker, parolă): vezi [README-WEB.md](README-WEB.md)**
