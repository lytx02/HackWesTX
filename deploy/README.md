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
cd /opt/campus-ai/server && npm ci   # not --omit=dev: drizzle-kit (migrations) is a dev dependency

# 3. API config (paste your DATABASE_URL; keep CORS_ORIGIN as the site)
cp .env.example .env
nano .env
#   DATABASE_URL=postgresql://campus_app:PASSWORD@HOST:16751/campus_ai?sslmode=require&uselibpqcompat=true
#   PORT=4000
#   CORS_ORIGIN=https://chalktexas.tech
#   CANVAS_TOKEN_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
#   VLLM_BASE_URL=https://<POD_ID>-8000.proxy.runpod.net/v1   (see server/.env.example)
#   VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct
#   DAILY_TOKEN_LIMIT=50000
chown -R www-data:www-data /opt/campus-ai
# Git refuses to touch a repo owned by another user; trust it once (as root).
git config --global --add safe.directory /opt/campus-ai

# 4. Database (only if this database has not been migrated/seeded yet)
npm run db:migrate
npm run db:seed        # WIPES tables; skip if you have real data

# 5. API service
cp /opt/campus-ai/deploy/systemd/campus-ai-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now campus-ai-api
systemctl status campus-ai-api --no-pager
curl -s http://127.0.0.1:4000/health      # expect {"ok":true,"db":"up"}
curl -s http://127.0.0.1:4000/llm/health  # expect {"ok":true,...,"model":"Qwen/..."}; or `npm run llm:ping`

# 5b. Daily summary timer (nightly two-line summaries for instructor digests).
#     Runs at 00:05 America/Chicago and catches up the last seven completed days.
cp /opt/campus-ai/deploy/systemd/campus-ai-summary.service /etc/systemd/system/
cp /opt/campus-ai/deploy/systemd/campus-ai-summary.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now campus-ai-summary.timer
systemctl list-timers campus-ai-summary.timer --no-pager
# Try one run now (safe to repeat: unchanged days are skipped):
sudo -u www-data bash -c 'cd /opt/campus-ai/server && node scripts/summarize-day.js --catch-up-days 7'

# 6. Frontend build (build on the server so VITE_API_URL from .env.production is used)
cd /opt/campus-ai && npm ci && npm run build
mkdir -p /var/www/chalktexas.tech
rsync -a --delete dist/ /var/www/chalktexas.tech/

# 7. Nginx. If a Certbot-managed site for chalktexas.tech already exists
#    (/etc/nginx/sites-enabled/chalktexas.tech.conf), do NOT add a second one:
#    merge the /api/ and location / blocks from deploy/nginx/chalktexas.tech.conf
#    into its HTTPS server block instead (the live server was set up this way).
#    The /api/ block needs `proxy_buffering off` and the 300s timeouts or chat
#    replies arrive all at once instead of streaming.
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
cd server && npm ci && npm run db:migrate && systemctl restart campus-ai-api
cd .. && npm ci && npm run build && rsync -a --delete dist/ /var/www/chalktexas.tech/
```

The update recipe runs pending migrations before restarting the API; when there are none it is a no-op.

## Checking things

```bash
systemctl status campus-ai-api      # is the API running
journalctl -u campus-ai-api -f      # live API logs
systemctl status campus-ai-summary.timer   # next scheduled summary run
journalctl -u campus-ai-summary     # last summary job output (scanned/updated/skipped/failed)
cd /opt/campus-ai/server && npm run summary:day   # run the previous completed Central day now
curl -s https://chalktexas.tech/api/llm/health   # can the API reach the RunPod vLLM pod
cd /opt/campus-ai/server && npm run llm:ping     # same, plus a streamed test completion
nginx -t                            # config syntax
tail -f /var/log/nginx/error.log    # Nginx errors
```

## RunPod notes

- The API reaches vLLM over the public RunPod proxy (`https://<POD_ID>-8000.proxy.runpod.net`),
  so a stopped/restarted pod means a new `POD_ID`: update `VLLM_BASE_URL` in `server/.env`
  and `systemctl restart campus-ai-api`.
- Set `VLLM_MODEL` to the exact served-model id from the running pod; never guess a Qwen id.
  `npm run llm:ping` lists the ids vLLM reports and streams a test completion.
- If the pod is started with `--api-key`, set `VLLM_API_KEY` too.

## Rollback

Migration 0003 is purely additive (new tables/columns/checks, no drops or rewrites),
so a code rollback does not require a database rollback:

```bash
cd /opt/campus-ai && git log --oneline -5          # find the last good commit
git checkout <last-good-commit>                    # or: git revert <bad-commit>
cd server && npm ci && systemctl restart campus-ai-api
cd .. && npm ci && npm run build && rsync -a --delete dist/ /var/www/chalktexas.tech/
# Optional: stop scheduling nightly summaries while rolled back
systemctl disable --now campus-ai-summary.timer
```

Leaving the summary tables and usage counter columns in place is safe: older code
simply ignores them. Do not reverse the migration by hand on the shared database.

## Tightening later

- Attach the instance and the database to the same Vultr VPC, switch `DATABASE_URL`
  to the VPC hostname, and turn the database's public access off.
- Add the instance's IP to the database's Trusted Sources and remove your laptop's.
- `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable` so only 22, 80, 443 are open.
