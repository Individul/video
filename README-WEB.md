# Cinema pe VPS — ghid de mutare

Totul rulează 24/7 pe VPS, în Docker: portalul, TorrServer, Jackett și FlareSolverr.
Calculatorul de acasă nu mai e necesar.

```
browser ──HTTPS──▶ Caddy ──▶ vid (portal, parolă)
                     │
                     └─/ts/stream/*──(doar după login)──▶ TorrServer ──▶ peers BitTorrent (port 6881)
                                                vid ──▶ Jackett ──▶ FlareSolverr
```

- Spre internet sunt deschise doar Caddy (80/443) și portul de peers 6881.
- Video-ul trece prin Caddy. Caddy verifică întâi cookie-ul portalului, deci fără login nu se poate viziona nimic.
- Interfața TorrServer nu e accesibilă din internet. Interfața Jackett se deschide doar prin tunel SSH.

Gândit pentru: 1 vCPU, 1,5 GB RAM, 10 GB disc, 1 utilizator. Fiecare container are o limită de memorie, iar scriptul de instalare adaugă 2 GB swap.

## 0. Înainte de cumpărare

- În termenii furnizorului: **traficul lunar** inclus și dacă **P2P/BitTorrent** e permis.
  - Un film trece de două ori prin VPS: o dată de la peers și o dată spre tine.
- Un **domeniu** cu un record DNS `A` spre IP-ul VPS-ului, necesar pentru HTTPS.
  - Merge și unul gratuit, de exemplu DuckDNS (`ceva.duckdns.org`).

## 1. Serverul (o singură dată)

```bash
ssh root@IP_VPS
git clone -b vps https://github.com/Individul/video.git /opt/vid
cd /opt/vid
bash deploy/setup-vps.sh      # update, swap 2 GB, firewall, Docker
```

Recomandat: autentificare SSH doar cu cheie. Copiezi cheia cu `ssh-copy-id root@IP_VPS`, apoi setezi `PasswordAuthentication no` în `/etc/ssh/sshd_config` și rulezi `systemctl restart ssh`.

## 2. Configurarea

```bash
cd /opt/vid
cp .env.vps.example .env
nano .env        # DOMAIN, APP_PASSWORD, APP_SECRET, TMDB_API_KEY, TORZNAB_API_KEY
chmod 600 .env
```

## 3. Datele de acasă

Pe Windows, folderul `C:\Users\prisa\vid-vps\transfer\` conține deja:

| În `transfer/` | Ce e | Pe VPS |
|---|---|---|
| `data/vid.db` | watchlist (5), istoric (26), 610 titluri | `/opt/vid/data/` |
| `data/subs/` | subtitrări extrase din MKV | `/opt/vid/data/subs/` |
| `torrserver/settings.json` | setări TorrServer adaptate pentru VPS: cache 96 MB în RAM, upload limitat la 1 MB/s, port 6881 | `/opt/vid/torrserver/` |
| `torrserver/config.db` | lista torrenților TorrServer | `/opt/vid/torrserver/` |
| `torrserver/settings.windows.json` | setările originale, doar ca referință | — |

**Jackett îl copiezi tu**, pentru că fișierele lui conțin login-urile tale la trackere:

1. Închide Jackett pe Windows.
2. Copiază `C:\ProgramData\Jackett\ServerConfig.json` în `transfer\jackett\Jackett\`.
3. Copiază și folderul `C:\ProgramData\Jackett\Indexers\` în `transfer\jackett\Jackett\`. Fișierele `.bak` nu sunt necesare.

Apoi urci totul, din Git Bash pe Windows:

```bash
cd /c/Users/prisa/vid-vps/transfer
scp -r data torrserver jackett root@IP_VPS:/opt/vid/
```

Pe VPS:

```bash
cd /opt/vid
chown -R 1000:1000 jackett     # containerul Jackett rulează ca utilizatorul 1000
```

## 4. Pornirea

```bash
cd /opt/vid
docker compose up -d --build
docker compose ps              # toate „running”
docker compose logs -f caddy   # urmărește obținerea certificatului HTTPS
```

Deschide `https://DOMENIUL-TAU` și loghează-te cu `APP_PASSWORD`.

## 5. Jackett pe VPS

Interfața Jackett se deschide doar prin tunel SSH. De pe Windows:

```bash
ssh -L 9117:127.0.0.1:9117 root@IP_VPS
```

Apoi deschide <http://localhost:9117> pe calculatorul tău.

1. **FlareSolverr API URL** (jos, în setări): schimbă `http://127.0.0.1:8191` în `http://flaresolverr:8191` și apasă **Apply server settings**.
2. Apasă **Test All**. Dacă un indexer cu cont (rutracker, kinozal…) dă eroare de login, reintrodu-i parola din butonul cheie.
   - Cauza: Windows criptează parolele salvate cu chei care nu se mută pe Linux.
3. Cheia API din colțul dreapta-sus trebuie să fie aceeași cu `TORZNAB_API_KEY` din `.env`. Dacă ai schimbat-o, actualizeaz-o și rulează `docker compose up -d`.

## 6. Verificare

- [ ] Login, pagina principală, căutare titlu
- [ ] Căutare magneți (Rutor, BTDig, Jackett) la un film
- [ ] Redare film; derulare înainte și înapoi
- [ ] Redare episod de serial (alegerea automată a fișierului)
- [ ] Subtitrări: din torrent (.srt) și extrase din MKV
- [ ] Fără login: `https://DOMENIUL-TAU/ts/stream/x` trebuie să dea 401
- [ ] `free -h` și `docker stats` arată memorie liberă când rulează un film

Dacă Rutor sau BTDig nu găsesc nimic pe VPS, dar acasă merg, cel mai probabil blochează IP-urile de datacenter. Setează `PROXY` în `.env`, apoi rulează `docker compose up -d`.

## 7. Întreținere

```bash
cd /opt/vid
git pull && docker compose up -d --build      # update cod
docker compose pull && docker compose up -d   # update imagini (TorrServer, Jackett, ...)
docker compose logs -f vid                    # loguri portal
docker stats                                  # memorie per container
df -h /                                       # spațiu pe disc
```

Backup zilnic: păstrează ultimele 7 arhive în `/opt/vid/backups`.

```bash
chmod +x /opt/vid/deploy/backup.sh
ln -s /opt/vid/deploy/backup.sh /etc/cron.daily/cinema-backup
```

Descarcă din când în când arhivele acasă cu `scp root@IP_VPS:/opt/vid/backups/cinema-*.tar.gz .`. Arhivele conțin parole, așa că păstrează-le în siguranță.

Dacă `dmesg | grep -i oom` arată containere oprite din lipsă de memorie, cel mai probabil e de vină FlareSolverr. Treci la un plan cu mai mult RAM: mutarea înseamnă doar să copiezi `/opt/vid`.

## După mutare (pe Windows)

Dezactivează pornirea automată din `autostart/start_vid.bat`, care pornea TorrServer, FlareSolverr și serverul web local. Folderul `C:\Users\prisa\vid` rămâne neschimbat și poți reveni oricând la el.
