# Cinema pe VPS — instalare, mutare, întreținere

Totul rulează în Docker pe un VPS Ubuntu 24.04. Serverul actual: 2 vCPU, 4 GB RAM, 40 GB NVMe, 1 Gbps
(AlexHost U2 RO). Merge și pe 1 vCPU / 1,5 GB, dar atunci micșorează cache-ul TorrServer și limitele
de memorie din `docker-compose.yml`.

Domeniu: un record DNS `A` (în Cloudflare: **DNS only**, nu proxied) spre IP-ul serverului.
Al doilea domeniu din `DOMAIN` (ex. `IP-cu-liniute.sslip.io`) e o rezervă care merge fără DNS propriu.

## 1. Server nou (o singură dată)

```bash
ssh root@IP_VPS
apt-get update && apt-get -y install git
git clone -b vps https://github.com/Individul/video.git /opt/vid
cd /opt/vid
SWAP_SIZE=2G bash deploy/setup-vps.sh   # update, swap, Docker, curățare săptămânală a imaginilor
bash deploy/secure-vps.sh               # ufw (22, 80, 443, 6881, 8621) + fail2ban
echo '*/5 * * * * root /opt/vid/deploy/torrserver-watchdog.sh' > /etc/cron.d/torrserver-watchdog
ln -s /opt/vid/deploy/backup.sh /etc/cron.daily/cinema-backup
```

Logarea SSH cu parolă rămâne activă, protejată de fail2ban (5 încercări greșite → IP blocat 1 oră).
SSH doar cu cheie, dacă vrei vreodată: `KEY_ONLY=1 bash deploy/secure-vps.sh`.

## 2. Configurare

```bash
cd /opt/vid
cp .env.vps.example .env && nano .env && chmod 600 .env
```

TorrServer (`torrserver/settings.json`, după prima pornire): `CacheSize` 1073741824 (1 GB),
`ConnectionsLimit` 50, `DisableUTP` true (evită bucla de CPU), `PeersListenPort` 6881.

## 3. Pornire

```bash
docker compose up -d --build
docker builder prune -af       # cache-ul de build ocupă ~1–2 GB după fiecare --build
docker compose ps
docker compose logs -f caddy   # obținerea certificatului HTTPS
```

Jackett: interfața se deschide doar prin tunel SSH — `ssh -L 9117:127.0.0.1:9117 root@IP_VPS`, apoi
<http://localhost:9117>. FlareSolverr API URL: `http://flaresolverr:8191`. Cheia API din colțul dreapta-sus
trebuie să fie aceeași cu `TORZNAB_API_KEY` din `.env`.

## 4. Mutare pe alt server

Datele sunt mici (~20 MB); cache-ul Ace Stream nu se mută.

1. Pe serverul nou: pașii 1 și 3 (fără `.env`, vine din copie).
2. Copiere de pe serverul vechi pe cel nou (cu `vid` și `jackett` oprite câteva secunde, pentru o bază consistentă):
   ```bash
   ssh root@VECHI 'cd /opt/vid && docker compose stop vid jackett &&
     tar czf - .env data backups jackett torrserver acestream/state; docker compose start vid jackett' \
     | ssh root@NOU 'cd /opt/vid && tar xzf -'
   ```
3. Pe serverul nou: în `.env`, schimbă domeniul `…sslip.io` la noul IP; `docker compose up -d --build`.
4. Test pe `https://IP-NOU-cu-liniute.sslip.io` (login, căutare, redare, Live).
5. Cloudflare: recordul `A` al domeniului → IP-ul nou. Dacă Caddy a încercat certificatul înainte de
   schimbarea DNS-ului, `docker compose restart caddy`.
6. Pe serverul vechi: `docker compose down` și scoate fișierele din `/etc/cron.d` și `/etc/cron.daily`.
   Prima căutare RuTracker pe serverul nou poate dura ~90 s (re-login), apoi ~2 s.

## 5. Verificare

- [ ] Login, catalog, căutare titlu, căutare torrente (toate trackerele apar, fără „slow”)
- [ ] Redare film și episod de serial; derulare; subtitrări
- [ ] Live: un ID Ace Stream pornește în ~5–30 s
- [ ] Fără login: `/ts/stream/x` și `/ace/c/x` dau 401
- [ ] `curl -sI https://DOMENIU | grep -i alt-svc` nu întoarce nimic (HTTP/3 e oprit)

## 6. Întreținere

```bash
cd /opt/vid
git pull && docker compose up -d --build && docker builder prune -af   # update cod
docker compose logs -f vid                                             # loguri portal
docker stats                                                           # memorie per container
df -h /                                                                # disc
```

**Actualizarea imaginilor** (Caddy, TorrServer, Jackett, FlareSolverr) e voită, nu automată: în
`docker-compose.yml` fiecare e fixată pe versiune + digest. Pentru o versiune nouă:

```bash
docker pull lscr.io/linuxserver/jackett:latest                 # exemplu
docker image inspect lscr.io/linuxserver/jackett:latest --format '{{index .RepoDigests 0}}'
# pune noul tag@digest în docker-compose.yml, commit, apoi:
docker compose up -d jackett
```

Dacă ceva se strică, revii la commit-ul anterior și rulezi din nou `docker compose up -d`.

**Login pe site:** după 5 parole greșite în 15 minute de pe același IP, login-ul de pe acel IP e
blocat 15 minute (răspuns 429). Repornirea containerului `vid` șterge blocările.

Backup zilnic: ultimele 7 arhive în `/opt/vid/backups` (baza de date, TorrServer, config Jackett, `.env`,
canale Live) și o copie **criptată** în Google Drive, folderul `Cinema-backups` (ultimele 30 de zile).

- Drive: `rclone` cu remote-ul `gdrive` (acces doar la fișierele create de el, `scope=drive.file`).
  Autorizare pe un PC cu browser: `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"`, apoi pe server
  `rclone config create gdrive drive scope=drive.file config_refresh_token=false token='…'`. rclone-ul nou
  scrie cheia în base64; pentru rclone 1.60 de pe server trebuie decodată la JSON-ul din câmpul `token`.
- Parola de criptare: `/root/.cinema-backup-pass` — păstreaz-o și în managerul de parole.
- Restaurare: `rclone copy gdrive:Cinema-backups/ARHIVA.tar.gz.enc .` apoi
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.cinema-backup-pass -in ARHIVA.tar.gz.enc | tar xz`

## Probleme cunoscute și rezolvări

| Simptom | Cauză | Rezolvare |
|---------|-------|-----------|
| Video lent / buffer, deși serverul e liber | HTTP/3 (QUIC/UDP) dădea ~4 Mbit/s spre client, TCP ~76 | HTTP/3 dezactivat în `Caddyfile` (`protocols h1 h2`) |
| TorrServer la 100% CPU fără torrente | buclă internă (uTP) | `DisableUTP`, plus `torrserver-watchdog.sh` la 5 minute |
| Live cu puțini peers | portul P2P Ace închis | 8621 publicat în compose și deschis în ufw |
| Live cu buffer des | rezervă mică la pornire (P2P live vine doar în timp real) | player-ul așteaptă ~30 s de segmente înainte de start |
| Discul se umple la Live | cache-ul Ace ignora limita implicită | `--disk-cache-limit` și `--live-disk-cache-size` în `deploy/acestream/Dockerfile` |
| Disc plin după rebuild | cache-ul de build Docker | `docker builder prune -af` |
