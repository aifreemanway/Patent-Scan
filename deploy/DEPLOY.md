# Patent-Scan — VPS deploy / переезд runbook

**Target:** Timeweb VPS `ap-prod-msk` · Ubuntu 22.04 · 2 vCPU / 4 GB / 50 GB NVMe · Москва · dedicated (NOT co-located with SellerForge — isolates the spiky beta from the live product).

The VPS is a **stateless app server**: code comes from GitHub, all data lives in Supabase. No VPS backups needed (re-provision + redeploy on loss). Backups only become relevant if Postgres is ever self-hosted here.

Fill these before starting: `VPS_IP`, the `.env.production` values.

## 1. First login + hardening
```bash
ssh root@VPS_IP                      # key auth (no password)
adduser deploy && usermod -aG sudo deploy
rsync --archive ~/.ssh /home/deploy/   # copy authorized_keys to deploy user
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
# AFTER confirming key login works (open a 2nd session as `deploy` first!),
# lock SSH to keys only — password auth was left on at order time as a safety net:
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh
```

## 2. Install stack (as deploy)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -   # Node 20 LTS
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git
sudo npm install -g pm2
```

## 3. Clone + build
```bash
sudo mkdir -p /var/www/patent-scan && sudo chown deploy:deploy /var/www/patent-scan
git clone https://github.com/aifreemanway/Patent-Scan.git /var/www/patent-scan
cd /var/www/patent-scan
npm ci
# create .env.production (see checklist below) BEFORE build
npm run build
```

## 4. `.env.production` checklist (NOT in git)
```
GEMINI_API_KEY=            TIMEWEB_AI_KEY=            # Deep Analysis (Sonnet)
PATSEARCH_TOKEN=           TAVILY_API_KEY=
EPO_KEY=                   EPO_SECRET=
NEXT_PUBLIC_SUPABASE_URL=  NEXT_PUBLIC_SUPABASE_ANON_KEY=  SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=  TURNSTILE_SECRET_KEY=
RESEND_API_KEY=
UPSTASH_REDIS_REST_URL=    UPSTASH_REDIS_REST_TOKEN=
```
(Rotate `TIMEWEB_AI_KEY` + the chat-exposed Turnstile secret at this step — they leaked earlier.)

## 5. Run under pm2
```bash
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup        # run the printed command once
```

## 6. Nginx + TLS
```bash
sudo cp deploy/nginx/patent-scan.conf /etc/nginx/sites-available/patent-scan.conf
sudo ln -s /etc/nginx/sites-available/patent-scan.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d patent-scan.ru -d www.patent-scan.ru
```
⚠ The `proxy_read_timeout 130s` in the conf is what lets Deep Analysis (≤120s) finish — do not lower it.

## 7. Supabase migrations (Dashboard → SQL Editor, in order)
0001 is already applied on the existing project. Apply the rest, in order:
- `supabase/migrations/0002_subscription_tiers.sql`  (tier model + quota semantics)
- `supabase/migrations/0003_deep_analysis_free.sql`  (1 free Deep Analysis/account)
**Until 0003 is applied, Deep Analysis returns 500 (missing RPC); quota for free works after 0002 (and even on old 0001 for free tier).**

## 8. DNS
Point `patent-scan.ru` (+ `www`) A-record → `VPS_IP` (Cloudflare or registrar). Add the host to the Turnstile allowed hostnames if not already.

## 9. CI deploys (after first manual bring-up)
GitHub repo → Settings → Secrets: `VPS_HOST`, `VPS_USER` (=deploy), `VPS_SSH_KEY` (private key). Then redeploys = run the **Deploy to VPS** workflow (`.github/workflows/deploy.yml`, manual dispatch).

## 10. Smoke (acceptance — beta-tz §8)
1. Magic-link: register → email from `noreply@patent-scan.com` → click → session.
2. Search NORD caisson → verdict cites `US6322610`/`US4572482`, every patent has a working link.
3. 4th free search → 402 quota panel (not raw error); novelty charges 1 unit, not ~150.
4. Deep Analysis → 1 free claim-by-claim run; 2nd → 402 used.
5. No false-green verdict; disclaimer + "what we didn't check" visible.

## Notes
- `maxDuration` exports in routes are Vercel-only — no-ops here (Nginx timeout governs). Optional cleanup later.
- App-server is RU now; PDn still in Supabase (Frankfurt) — full RU-localization is a separate post-beta track (see memory `project-supabase-hosting-decision`).
