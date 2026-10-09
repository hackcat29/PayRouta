#!/usr/bin/env bash
# PayRouta server setup (Ubuntu 22.04/24.04). Run once as root from a
# checkout of this repository (it reads deploy/nginx.conf):
#   git clone <repo> /tmp/payrouta-setup && cd /tmp/payrouta-setup
#   DOMAIN=pay.example.com ADMIN_EMAIL=ops@example.com bash scripts/setup-vps.sh
# Secrets are generated here and written only to /opt/payrouta/.env (0600).
set -euo pipefail
: "${DOMAIN:?Set DOMAIN}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL}"
ROOT=/opt/payrouta
DEPLOY_USER=${DEPLOY_USER:-root}

apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release nginx certbot python3-certbot-nginx \
  ufw unattended-upgrades clamav-daemon clamav-freshclam

# Node.js 24 LTS and PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
npm install -g pm2
pm2 install pm2-logrotate
pm2 startup systemd -u "$DEPLOY_USER" --hp "$(eval echo ~"$DEPLOY_USER")"

# PostgreSQL 17 (local only)
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update && apt-get install -y postgresql-17
DB_PASSWORD=$(openssl rand -hex 24)
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payrouta') THEN
    CREATE ROLE payrouta LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE payrouta PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='payrouta'" | grep -q 1 \
  || sudo -u postgres createdb -O payrouta payrouta

# ClamAV daemon on localhost only (evidence malware scanning)
sed -i 's/^#\?TCPSocket .*/TCPSocket 3310/; s/^#\?TCPAddr .*/TCPAddr 127.0.0.1/' /etc/clamav/clamd.conf
grep -q '^TCPSocket' /etc/clamav/clamd.conf || echo 'TCPSocket 3310' >> /etc/clamav/clamd.conf
grep -q '^TCPAddr' /etc/clamav/clamd.conf || echo 'TCPAddr 127.0.0.1' >> /etc/clamav/clamd.conf
systemctl enable --now clamav-freshclam clamav-daemon

# Directories and environment (existing .env is never overwritten)
install -d -m 750 "$ROOT" "$ROOT/releases" "$ROOT/incoming" "$ROOT/backups"
if [ ! -f "$ROOT/.env" ]; then
  umask 077
  cat > "$ROOT/.env" <<ENV
PORTAL_MODE=production
DATABASE_URL=postgresql://payrouta:$DB_PASSWORD@127.0.0.1:5432/payrouta
BETTER_AUTH_URL=https://$DOMAIN
BETTER_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
SITE_URL=https://$DOMAIN
SECRET_MASTER_KEYS=k$(date +%Y%m):$(openssl rand -base64 32)
EVIDENCE_RETENTION_DAYS=90
CLAMD_HOST=127.0.0.1
CLAMD_PORT=3310
# Fill in before launch (npm run preflight:production lists what is missing):
SMTP_URL=
MAIL_FROM=
S3_BUCKET=
S3_REGION=
OPENSANCTIONS_API_KEY=
CONTACT_WEBHOOK_URL=
# Set to "enabled" to let merchants test with simulated providers on this host,
# then run: npm run sandbox:providers
HOSTED_SANDBOX=
ENV
  echo "Wrote $ROOT/.env. Back up SECRET_MASTER_KEYS somewhere offline: losing it loses every stored secret."
fi
chown -R "$DEPLOY_USER" "$ROOT"

# Daily database backup, 14 days retained
cat > /etc/cron.daily/payrouta-backup <<'CRON'
#!/bin/sh
set -e
f=/opt/payrouta/backups/payrouta-$(date +%F).sql.gz
sudo -u postgres pg_dump payrouta | gzip > "$f"
chmod 600 "$f"
find /opt/payrouta/backups -name 'payrouta-*.sql.gz' -mtime +14 -delete
CRON
chmod 755 /etc/cron.daily/payrouta-backup

# nginx and TLS
cp "$(dirname "$0")/../deploy/payrouta-proxy.conf" /etc/nginx/snippets/payrouta-proxy.conf
sed "s/example.com/$DOMAIN/g" "$(dirname "$0")/../deploy/nginx.conf" > /etc/nginx/sites-available/payrouta
ln -sf /etc/nginx/sites-available/payrouta /etc/nginx/sites-enabled/payrouta
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$ADMIN_EMAIL" --agree-tos --non-interactive --redirect

# Firewall: SSH and web only. PostgreSQL, clamd and the app stay on localhost.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Server ready. Complete $ROOT/.env, then push to main to deploy."
