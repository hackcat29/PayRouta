#!/bin/bash
# PayRouta Contabo VPS Setup Script (Ubuntu)
# Run this as root on the Contabo server

echo "Setting up PayRouta Bare Metal Environment..."

# 1. Update system and install dependencies
apt-get update
apt-get install -y curl dirmngr apt-transport-https lsb-release ca-certificates nginx

# 2. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 3. Install PM2 process manager
npm install -g pm2

# 4. Install PostgreSQL 17
# Add PostgreSQL apt repository
sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt-get update
apt-get install -y postgresql-17

# 5. Configure PostgreSQL User and Database
sudo -u postgres psql -c "CREATE USER payrouta WITH PASSWORD 'YOUR_STRONG_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE payrouta OWNER payrouta;"
sudo -u postgres psql -c "ALTER USER payrouta CREATEDB;"

# 6. Ensure target directory exists
mkdir -p /opt/payrouta
chown -R root:root /opt/payrouta

echo "============================================="
echo "✅ Server dependencies installed successfully!"
echo "Next steps:"
echo "1. Create /opt/payrouta/.env with your DATABASE_URL, BETTER_AUTH_SECRET, etc."
echo "2. Add your domain to Nginx and run Certbot for SSL."
echo "3. Trigger a GitHub Action deployment."
echo "============================================="
