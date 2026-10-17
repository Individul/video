#!/usr/bin/env bash
# Copie zilnică a datelor Cinema (watchlist/istoric, setări TorrServer, config Jackett).
# Instalare (ca root):  ln -s /opt/vid/deploy/backup.sh /etc/cron.daily/cinema-backup
# Păstrează ultimele 7 arhive în /opt/vid/backups — descarcă-le periodic acasă:
#   scp root@IP_VPS:/opt/vid/backups/cinema-*.tar.gz .
set -euo pipefail

cd /opt/vid
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)

# copie consistentă a bazei SQLite, chiar dacă aplicația scrie în ea
sqlite3 data/vid.db ".backup 'backups/vid-$stamp.db'"

tar -czf "backups/cinema-$stamp.tar.gz" \
  "backups/vid-$stamp.db" torrserver jackett/Jackett/ServerConfig.json jackett/Jackett/Indexers .env
rm -f "backups/vid-$stamp.db"
chmod 600 "backups/cinema-$stamp.tar.gz"   # conține parole (.env, logins Jackett)

ls -1t backups/cinema-*.tar.gz | tail -n +8 | xargs -r rm -f
