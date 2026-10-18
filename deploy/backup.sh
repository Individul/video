#!/usr/bin/env bash
# Copie zilnică a datelor Cinema (watchlist/istoric, setări TorrServer, config Jackett, canale Live).
# Instalare (ca root):  ln -s /opt/vid/deploy/backup.sh /etc/cron.daily/cinema-backup
# Păstrează ultimele 7 arhive în /opt/vid/backups și, dacă e configurat rclone cu remote-ul
# „gdrive”, urcă arhiva CRIPTATĂ în Google Drive (folderul Cinema-backups, ultimele 30 de zile).
#
# Criptare: parola stă în /root/.cinema-backup-pass (păstreaz-o și în managerul de parole —
# fără ea arhivele din Drive nu se pot deschide). Decriptare:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:PAROLA -in X.tar.gz.enc | tar xz
set -euo pipefail

cd /opt/vid
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
archive="backups/cinema-$stamp.tar.gz"

# copie consistentă a bazei SQLite, chiar dacă aplicația scrie în ea
sqlite3 data/vid.db ".backup 'backups/vid-$stamp.db'"

extra=()
[ -f data/live_channels.json ] && extra+=(data/live_channels.json)
tar -czf "$archive" \
  "backups/vid-$stamp.db" torrserver jackett/Jackett/ServerConfig.json jackett/Jackett/Indexers .env "${extra[@]}"
rm -f "backups/vid-$stamp.db"
chmod 600 "$archive"   # conține parole (.env, logins Jackett)

ls -1t backups/cinema-*.tar.gz | tail -n +8 | xargs -r rm -f

# ---------- copie în Google Drive (opțional) ----------
PASS_FILE=/root/.cinema-backup-pass
REMOTE="gdrive:Cinema-backups"
if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -qx "gdrive:"; then
  if [ ! -s "$PASS_FILE" ]; then
    echo "backup: lipsește $PASS_FILE — nu urc în Drive arhive necriptate" >&2
    exit 1
  fi
  enc="/tmp/cinema-$stamp.tar.gz.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" -in "$archive" -out "$enc"
  rclone copy "$enc" "$REMOTE" --retries 3 --low-level-retries 10
  rm -f "$enc"
  rclone delete "$REMOTE" --min-age 30d --include "cinema-*.tar.gz.enc" || true
fi
