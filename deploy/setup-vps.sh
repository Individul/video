#!/usr/bin/env bash
# Pregătirea unui VPS Ubuntu 22.04/24.04 proaspăt pentru Cinema (rulezi o singură dată, ca root):
#   bash deploy/setup-vps.sh            (swap implicit 1 GB; altă mărime: SWAP_SIZE=2G bash ...)
# Face: update, swap, Docker, curățare automată a imaginilor vechi.
# Securitatea (SSH doar cu cheie + firewall) e separată: deploy/secure-vps.sh
set -euo pipefail

SWAP_SIZE="${SWAP_SIZE:-1G}"   # disc mic (≈9 GB): 1 GB swap lasă loc imaginilor Docker

if [ "$(id -u)" -ne 0 ]; then
  echo "Rulează ca root (sudo bash deploy/setup-vps.sh)" >&2
  exit 1
fi

echo "==> Actualizare sistem"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
DEBIAN_FRONTEND=noninteractive apt-get -y install ca-certificates curl git sqlite3

echo "==> Swap $SWAP_SIZE (plasă de siguranță pentru vârfurile FlareSolverr)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-cinema-swap.conf

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Curățare săptămânală a imaginilor Docker nefolosite"
cat > /etc/cron.weekly/docker-prune <<'PRUNE'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1
PRUNE
chmod +x /etc/cron.weekly/docker-prune

echo "==> Gata. Urmează pașii din README-WEB.md (securitate, .env, date, pornire)."
