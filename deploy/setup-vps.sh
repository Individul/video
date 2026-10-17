#!/usr/bin/env bash
# Pregătirea unui VPS Ubuntu 22.04/24.04 proaspăt pentru Cinema (rulezi o singură dată, ca root):
#   bash deploy/setup-vps.sh
# Face: update, swap 2 GB, firewall (22/80/443/6881), Docker, curățare automată a imaginilor vechi.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rulează ca root (sudo bash deploy/setup-vps.sh)" >&2
  exit 1
fi

echo "==> Actualizare sistem"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
DEBIAN_FRONTEND=noninteractive apt-get -y install ca-certificates curl ufw git sqlite3

echo "==> Swap 2 GB (plasă de siguranță pentru vârfurile FlareSolverr)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-cinema-swap.conf

echo "==> Firewall: SSH, HTTP/HTTPS (Caddy), 6881 (peers TorrServer)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 6881/tcp
ufw allow 6881/udp
ufw --force enable
# Notă: porturile publicate de Docker ocolesc ufw — de aceea în docker-compose.yml
# doar Caddy și 6881 sunt publice; Jackett e legat de 127.0.0.1, restul nu au porturi.

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Curățare săptămânală a imaginilor Docker nefolosite"
cat > /etc/cron.weekly/docker-prune <<'EOF'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1
EOF
chmod +x /etc/cron.weekly/docker-prune

echo "==> Gata. Urmează pașii din README-WEB.md (clonare, .env, date, pornire)."
