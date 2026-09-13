# Deploying to a Vultr instance (Ubuntu)

Layout on the server:

| What | Where |
| --- | --- |
| Repo | `/opt/campus-ai` |
| API service | `campus-ai-api` (systemd), listens on 127.0.0.1:4000 |
| Frontend build | `/var/www/chalktexas.tech` (copy of `dist/`) |
| Nginx site | `/etc/nginx/sites-available/chalktexas.tech` |

The browser only ever talks to `https://chalktexas.tech`. Nginx serves the static
build and proxies `/api/` to the Node process. The API talks to Vultr Postgres.

## First-time setup (run on the server as root or with sudo)

```bash
# 1. Packages
apt update && apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# 2. Code
git clone https://github.com/lytx02/HackWesTX.git /opt/campus-ai
cd /opt/campus-ai/server && npm ci --omit=dev

# 3. API config (paste your DATABASE_URL; keep CORS_ORIGIN as the site)
cp .env.example .env
nano .env
#   DATABASE_URL=postgresql://campus_app:PASSWORD@HOST:16751/campus_ai?sslmode=require&uselibpqcompat=true
#   PORT=4000
#   CORS_ORIGIN=https://chalktexas.tech
chown -R www-data:www-data /opt/campus-ai
# Git refuses to touch a repo owned by another user; trust it once (as root).
git config --global --add safe.directory /opt/campus-ai

# 4. Database (only if this database has not been migrated/seeded yet)
sudo -u www-data npm run db:migrate
sudo -u www-data npm run db:seed        # WIPES tables; skip if you have real data

# 5. API service
cp /opt/campus-ai/deploy/systemd/campus-ai-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now campus-ai-api
systemctl status campus-ai-api --no-pager
curl -s http://127.0.0.1:4000/health      # expect {"ok":true,"db":"up"}

# 6. Frontend build (build on the server so VITE_API_URL from .env.production is used)
cd /opt/campus-ai && npm ci && npm run build
mkdir -p /var/www/chalktexas.tech
rsync -a --delete dist/ /var/www/chalktexas.tech/

# 7. Nginx. If a Certbot-managed site for chalktexas.tech already exists
#    (/etc/nginx/sites-enabled/chalktexas.tech.conf), do NOT add a second one:
#    merge the /api/ and location / blocks from deploy/nginx/chalktexas.tech.conf
#    into its HTTPS server block instead (the live server was set up this way).
#    On a fresh box:
cp /opt/campus-ai/deploy/nginx/chalktexas.tech.conf /etc/nginx/sites-available/chalktexas.tech
ln -sf /etc/nginx/sites-available/chalktexas.tech /etc/nginx/sites-enabled/chalktexas.tech
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
curl -s http://chalktexas.tech/api/health  # expect {"ok":true,"db":"up"}

# 8. HTTPS (fresh box only; DNS for chalktexas.tech must already point here)
apt install -y certbot python3-certbot-nginx
certbot --nginx -d chalktexas.tech -d www.chalktexas.tech
curl -s https://chalktexas.tech/api/health
```

## Updating after a code change

```bash
cd /opt/campus-ai && git pull
cd server && npm ci --omit=dev && systemctl restart campus-ai-api
cd .. && npm ci && npm run build && rsync -a --delete dist/ /var/www/chalktexas.tech/
```

New migrations: `cd /opt/campus-ai/server && sudo -u www-data npm run db:migrate` before restarting the API.

## Checking things

```bash
systemctl status campus-ai-api      # is the API running
journalctl -u campus-ai-api -f      # live API logs
nginx -t                            # config syntax
tail -f /var/log/nginx/error.log    # Nginx errors
```

## Tightening later

- Attach the instance and the database to the same Vultr VPC, switch `DATABASE_URL`
  to the VPC hostname, and turn the database's public access off.
- Add the instance's IP to the database's Trusted Sources and remove your laptop's.
- `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable` so only 22, 80, 443 are open.
