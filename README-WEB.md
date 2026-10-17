# vid pe web (VPS) — ghid de instalare

Portalul rulează 24/7 pe un server mic, independent de calculatorul tău.
Aplicația + TorrServer rulează în Docker, cu parolă de acces.

## De ce ai nevoie

- un VPS mic (ex. Hetzner CX22 ~4 €/lună sau Contabo; 2 GB RAM ajung pentru 1-3 utilizatori)
- Ubuntu 22.04/24.04 proaspăt
- cheia TMDB (cea din `.env`-ul tău local)
- (opțional, recomandat) un domeniu — pentru HTTPS prin Cloudflare Tunnel (~10 €/an orice domeniu)

## 1. Pregătirea serverului (o singură dată)

```bash
ssh root@IP_VPS
apt update && apt upgrade -y
# Docker + Compose
curl -fsSL https://get.docker.com | sh
```

## 2. Urcarea proiectului

Din calculatorul tău (proiectul nu e încă pe git — cel mai simplu cu scp/rsync):

```bash
rsync -av --exclude .venv --exclude __pycache__ --exclude data --exclude torrserver \
      --exclude vid.db --exclude subs --exclude "*.log" --exclude .env \
      /c/Users/prisa/vid/ root@IP_VPS:/opt/vid/
```

(sau comprimă folderul și îl urci cu scp, apoi despachetezi în `/opt/vid`)

## 3. Configurarea (.env pe server)

```bash
cd /opt/vid
cat > .env <<'EOF'
TMDB_API_KEY=cheia_ta_tmbd
APP_PASSWORD=o-parola-puternica
APP_SECRET=un-sir-lung-aleator-cccc-44-de-caractere
# doar dacă Rutor/BTDig sunt blocate de pe IP-ul datacenterului:
# PROXY=http://user:parola@adresa-proxy:port
# opțional:
# TORZNAB_URL=http://jackett:9117/torznab
# TORZNAB_API_KEY=cheia-jackett
# OS_API_KEY=cheia-opensubtitles
# HTTPS_ON=1   # dacă termini HTTPS în fața (tunel/reverse-proxy)
EOF
chmod 600 .env
```

`APP_SECRET` îl generezi cu: `python3 -c "import secrets; print(secrets.token_hex(32))"`
**Important:** nu schimba APP_SECRET-ul ulterior — invalidatează sesiunile.

## 4. Pornirea

```bash
cd /opt/vid && docker compose up -d --build
docker compose logs -f vid   # urmărește pornirea (Ctrl+C ca să ieși)
curl -I http://127.0.0.1:8000/api/auth/status  # pe VPS: trebuie răspuns 200
```

## 5. HTTPS + acces de pe internet (recomandat: Cloudflare Tunnel)

Varianta cea mai sigură — fără porturi deschise, cu HTTPS automat:

```bash
# pe VPS
docker run -d --name cloudflared --restart unless-stopped \
  --network host cloudflare/cloudflared:latest tunnel --no-autoupdate
# urmează wizard-ul: docker logs -f cloudflared → deschide linkul de login,
# apoi asociază hostname-ul (ex. vid.domeniulta.ro) → service http://localhost:8000
```

Alternativa rapidă (fără domeniu): Caddy ca reverse-proxy cu un domeniu ieftin,
sori (temporar) `ssh -L 8000:127.0.0.1:8000 root@IP_VPS` din browserul local.

## Note importante

- **TorrServer la distanță** (deja găzduit în altă parte): nu mai rula containerul local deloc —
  pune în `.env`:
  ```
  TORRSERVER_URL=http://adresa-torrserver:port
  TORRSERVER_AUTH=utilizator:parola
  ```
  și pornește doar `docker compose up -d --build vid`. Tot traficul de torente curge prin
  TorrServer-ul respectiv; VPS-ul tău face doar catalog + parser (ușor și discret).
- **Rutor/BTDig de pe IP de datacenter**: adesea răspund cu pagina de blocare sau nimic.
  Dacă căutarea de magneți nu merge pe VPS dar merge acasă, configurează `PROXY`
  în `.env` (un proxy rezidențial sau propriul server de acasă) și `docker compose up -d`.
- **Jackett**: dacă vrei și indexerele din Jackett, adaugă un container `linuxserver/jackett`
  în compose și pune `TORZNAB_URL=http://jackett:9117/torznab` + cheia.
- **Datele** (DB, subtitrări extrase, cache TorrServer) stau în `/opt/vid/data` și
  `/opt/vid/torrserver` — fă backup la folderul ăsta dacă vrei să muți serverul.
- **Update**: copiezi fișierele noi peste (rsync), apoi `docker compose up -d --build`.
- Portalul e gândit pentru un cerc mic (tu + familia). Fie sesiune e partajată
  (un singur watchlist/istoric comun).

## Comenzi utile

```bash
docker compose ps            # stare
docker compose logs -f vid   # loguri aplicație
docker compose restart       # repornire
docker compose down          # oprire
```
