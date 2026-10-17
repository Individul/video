#!/usr/bin/env bash
# Securitatea VPS-ului (rulezi o singură dată, ca root, DUPĂ ce ai verificat că intri cu cheia SSH):
#   bash deploy/secure-vps.sh
# Face: SSH doar cu cheie (fără parolă), firewall cu porturile strict necesare.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rulează ca root" >&2
  exit 1
fi

if [ ! -s /root/.ssh/authorized_keys ]; then
  echo "Nu există nicio cheie în /root/.ssh/authorized_keys — oprit, ca să nu rămâi blocat afară." >&2
  exit 1
fi

echo "==> SSH: doar autentificare cu cheie"
# 00- ca să fie citit primul (în sshd prima valoare găsită câștigă, ex. față de 50-cloud-init.conf)
cat > /etc/ssh/sshd_config.d/00-cinema.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
sshd -t
systemctl reload ssh

echo "==> Firewall: SSH, HTTP/HTTPS (Caddy), 6881 (peers TorrServer)"
DEBIAN_FRONTEND=noninteractive apt-get -y install ufw
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

sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '
ufw status verbose
echo "==> Gata. Verifică dintr-o fereastră NOUĂ că intri în continuare cu cheia, înainte s-o închizi pe asta."
