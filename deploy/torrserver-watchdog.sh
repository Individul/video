#!/usr/bin/env bash
# Paznic TorrServer: uneori intră într-o buclă (100% CPU fără niciun torrent activ),
# care sufocă tot VPS-ul (FlareSolverr nu mai trece de Cloudflare, căutările devin lente).
# Dacă la două verificări la rând (cron, la 5 min) e peste 70% CPU și nu rulează niciun
# torrent, îl repornim. Cât timp rulează un film, nu facem nimic.
# Instalare: echo '*/5 * * * * root /opt/vid/deploy/torrserver-watchdog.sh' > /etc/cron.d/torrserver-watchdog
set -u
cd /opt/vid || exit 0
STATE=/run/torrserver-watchdog.flag

cpu=$(docker stats --no-stream --format '{{.CPUPerc}}' torrserver 2>/dev/null | tr -d '%' | cut -d. -f1)
[ -z "${cpu:-}" ] && exit 0

active=$(docker compose exec -T vid python -c '
import json, urllib.request
r = urllib.request.Request("http://torrserver:8090/torrents", json.dumps({"action": "list"}).encode(), {"Content-Type": "application/json"})
print(sum(1 for t in json.load(urllib.request.urlopen(r, timeout=20)) if t.get("stat_string") == "Torrent working"))
' 2>/dev/null || echo "?")

if [ "$cpu" -ge 70 ] && [ "$active" = "0" ]; then
  if [ -f "$STATE" ]; then
    docker compose restart torrserver >/dev/null 2>&1
    logger -t torrserver-watchdog "TorrServer repornit: ${cpu}% CPU fără torrente active"
    rm -f "$STATE"
  else
    touch "$STATE"  # prima observație: mai așteptăm o verificare
  fi
else
  rm -f "$STATE"
fi
