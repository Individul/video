#!/usr/bin/env bash
# Securitatea VPS-ului (rulezi o singură dată, ca root):
#   bash deploy/secure-vps.sh
# Face: firewall cu porturile strict necesare + fail2ban (blochează IP-urile care ghicesc parola SSH).
# Logarea cu parolă rămâne activă. Pentru SSH doar cu cheie: KEY_ONLY=1 bash deploy/secure-vps.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rulează ca root" >&2
  exit 1
fi

echo "==> fail2ban: după 5 parole greșite în 10 min, IP-ul e blocat 1 oră"
DEBIAN_FRONTEND=noninteractive apt-get -y install fail2ban ufw
cat > /etc/fail2ban/jail.d/cinema-sshd.local <<'CONF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

if [ "${KEY_ONLY:-0}" = "1" ]; then
  if [ ! -s /root/.ssh/authorized_keys ]; then
    echo "Nicio cheie în /root/.ssh/authorized_keys — nu dezactivez parola, ai rămâne blocat afară." >&2
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
fi

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

ufw status verbose
fail2ban-client status sshd
echo "==> Gata."
