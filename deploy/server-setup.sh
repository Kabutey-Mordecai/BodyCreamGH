#!/bin/bash
# =============================================================================
# server-setup.sh — One-time bootstrap for a fresh DigitalOcean Ubuntu 22.04 droplet.
#
# Run as root immediately after SSH-ing in for the first time:
#   ssh root@YOUR_SERVER_IP
#   bash server-setup.sh
#
# What this script does (in order):
#   1. Update the OS
#   2. Install Node.js 20 LTS (via NodeSource)
#   3. Install PostgreSQL 15
#   4. Install PM2 (process manager — keeps the API alive after reboots)
#   5. Install Nginx (reverse proxy — routes traffic to the Node app)
#   6. Install Certbot (free SSL via Let's Encrypt)
#   7. Create a non-root deploy user called "deploy"
#   8. Set up the PostgreSQL database and user
#   9. Clone the GitHub repo
#  10. Install backend dependencies
#  11. Prompt for the .env values and write /home/deploy/app/backend/.env
#  12. Run all database migrations
#  13. Start the backend with PM2 and save the process list
# =============================================================================

set -e  # Exit immediately if any command fails

# ── 1. System update ─────────────────────────────────────────────────────────
echo ">>> Updating system packages..."
apt update && apt upgrade -y

# ── 2. Node.js 20 LTS ────────────────────────────────────────────────────────
echo ">>> Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version   # confirm e.g. v20.x.x
npm --version

# ── 3. PostgreSQL 15 ─────────────────────────────────────────────────────────
echo ">>> Installing PostgreSQL 15..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# ── 4. PM2 ───────────────────────────────────────────────────────────────────
echo ">>> Installing PM2..."
npm install -g pm2

# ── 5. Nginx ─────────────────────────────────────────────────────────────────
echo ">>> Installing Nginx..."
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# ── 6. Certbot (Let's Encrypt SSL) ───────────────────────────────────────────
echo ">>> Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# ── 7. Create a non-root deploy user ─────────────────────────────────────────
# Running Node.js as root is a security risk. "deploy" is an unprivileged user.
echo ">>> Creating deploy user..."
if ! id "deploy" &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
fi
# Allow deploy to reload Nginx and manage PM2 without a password
echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx, /bin/systemctl restart nginx" \
  >> /etc/sudoers.d/deploy

# ── 8. PostgreSQL database + user ────────────────────────────────────────────
echo ">>> Setting up PostgreSQL database..."
# Prompt for the DB password so it never appears in shell history
read -rsp "Enter the PostgreSQL password for 'cosmetics_user': " DB_PASS
echo

sudo -u postgres psql <<SQL
-- Create the application database
CREATE DATABASE cosmetics_db;

-- Create a dedicated user (principle of least privilege — not a superuser)
CREATE USER cosmetics_user WITH PASSWORD '${DB_PASS}';

-- Good defaults for a web app
ALTER ROLE cosmetics_user SET client_encoding TO 'utf8';
ALTER ROLE cosmetics_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE cosmetics_user SET search_path = public;

-- Grant full access on the app database only
GRANT ALL PRIVILEGES ON DATABASE cosmetics_db TO cosmetics_user;
\q
SQL
echo ">>> Database created."

# ── 9. Clone the repository ───────────────────────────────────────────────────
# Replace the GitHub URL with your own repo URL before running.
APP_DIR="/home/deploy/app"
REPO_URL="https://github.com/YOUR_GITHUB_USERNAME/BodyCreamGH.git"  # <-- change this

echo ">>> Cloning repository into ${APP_DIR}..."
mkdir -p "${APP_DIR}"
git clone "${REPO_URL}" "${APP_DIR}"
chown -R deploy:deploy "${APP_DIR}"

# ── 10. Install Node.js dependencies ─────────────────────────────────────────
echo ">>> Installing backend dependencies..."
cd "${APP_DIR}/backend"
npm install --omit=dev  # production-only install (skip devDependencies like nodemon)

# ── 11. Write production .env ─────────────────────────────────────────────────
# Collect each secret interactively so nothing sensitive is hard-coded in this script.
echo ""
echo ">>> Configure production environment variables."
echo "    (These will be written to ${APP_DIR}/backend/.env)"
echo ""

read -rp  "Your domain name (e.g. api.yourdomain.com): "     DOMAIN
read -rsp "JWT_SECRET (long random string, 64+ chars): "     JWT_SECRET;  echo
read -rsp "Paystack LIVE secret key (sk_live_...): "         PAYSTACK_SECRET; echo
read -rp  "Paystack LIVE public key (pk_live_...): "         PAYSTACK_PUBLIC
read -rp  "Frontend URL (e.g. https://yourdomain.com): "     FRONTEND_URL
read -rp  "SMTP host (e.g. smtp.gmail.com): "                SMTP_HOST
read -rp  "SMTP user (your Gmail address): "                  SMTP_USER
read -rsp "SMTP app password: "                               SMTP_PASS; echo
read -rp  "Admin email: "                                     ADMIN_EMAIL
read -rsp "Admin password: "                                  ADMIN_PASSWORD; echo

cat > "${APP_DIR}/backend/.env" <<ENV
# ── Server ───────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production

# ── Database ──────────────────────────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cosmetics_db
DB_USER=cosmetics_user
DB_PASSWORD=${DB_PASS}

# ── JWT ───────────────────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRE=15m
REFRESH_TOKEN_DAYS=7

# ── Paystack (live keys from dashboard.paystack.com) ─────────────────────────
PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET}
PAYSTACK_PUBLIC_KEY=${PAYSTACK_PUBLIC}

# ── Email (Gmail — use an App Password, not your real password) ───────────────
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=587
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}

# ── URLs ─────────────────────────────────────────────────────────────────────
# Used in email reset links and Paystack callback redirects
FRONTEND_URL=${FRONTEND_URL}

# ── CORS ─────────────────────────────────────────────────────────────────────
# Comma-separated list of origins allowed to call the API
ALLOWED_ORIGINS=${FRONTEND_URL},https://admin.yourdomain.com

# ── Admin bootstrap (creates the first admin account on first start) ──────────
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL=info
ENV

chmod 600 "${APP_DIR}/backend/.env"  # owner-read-only — no other users can see secrets
chown deploy:deploy "${APP_DIR}/backend/.env"
echo ">>> .env written."

# ── 12. Run database migrations ───────────────────────────────────────────────
echo ">>> Running database migrations..."
cd "${APP_DIR}/backend"
sudo -u deploy npm run migrate
echo ">>> Migrations complete."

# ── 13. Start the API with PM2 ────────────────────────────────────────────────
echo ">>> Starting backend with PM2..."
cd "${APP_DIR}/backend"
sudo -u deploy pm2 start ecosystem.config.js
sudo -u deploy pm2 save        # persist process list across reboots

# Configure PM2 to start automatically when the server reboots
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy deploy/nginx.conf to /etc/nginx/sites-available/cosmetics"
echo "     and update the server_name line to your domain."
echo "  2. Run: certbot --nginx -d ${DOMAIN}"
echo "  3. Build and deploy the frontend + admin to Netlify."
echo "  4. Register the webhook URL in the Paystack dashboard:"
echo "     https://${DOMAIN}/api/payments/webhook"
