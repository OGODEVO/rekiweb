# Reki Web: VPS briefing

One job: put `https://web.rekisupplement.com` live serving OGODEVO/rekiweb
`main` (Express + SQLite, `npm start` on `$PORT`). Checkout stays unlisted.
No sales traffic until E2E verification passes.

## Hard boundaries (do not cross)

- Do NOT touch the apex site, `/privacy`, `/terms`, `/help` (must stay
  exactly as-is for Apple review).
- Do NOT touch the `api.` site, the iOS backend checkout, its database, or
  its `.env`.
- Do NOT change firewall, SSH, DNS (except the one A record below), or system
  credentials.
- Do NOT commit or print secrets. Missing secret values are reported as
  missing, never invented.
- New app lives in its own directory, its own port, its own systemd unit.
  Nothing shared with existing services except the host itself.

## Steps

### 1. DNS

Create A record `web.rekisupplement.com` → `2.25.174.209` wherever DNS is
hosted. Verify with `dig +short web.rekisupplement.com` before continuing.
If you cannot edit DNS, stop and report that as the blocker.

### 2. Caddy (add-only)

Add a NEW `web.rekisupplement.com` site block that reverse-proxies to the
local Node port you choose (default `3001`, loopback only) with automatic
HTTPS. Edit nothing in the existing apex or api blocks.

Then:

```sh
caddy validate
systemctl reload caddy
```

If validation fails, fix before reloading. Never reload a bad config.

### 3. App

```sh
git clone https://github.com/OGODEVO/rekiweb /opt/reki-web
# or pull main in the existing clone if you already made one
cd /opt/reki-web
npm ci
npm run build
```

Use your judgment on the directory if `/opt` is not your convention, and
report the path you used.

### 4. Env

Copy `.env.example` to the service env file (outside the repo). Set:

```
PUBLIC_BASE_URL=https://web.rekisupplement.com
PORT=<the port from step 2>
NODE_ENV=production
HOST=127.0.0.1
DATABASE_PATH=<persistent path, e.g. /var/lib/reki-web/reki-web.sqlite>
```

Leave `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_APP_ID`,
`WHOP_CLIENT_SECRET`, `WHOP_ACCOUNT_ID`, `WHOP_PRODUCT_ID` EMPTY unless the
owner has already provided them — then set exactly those. Always set
`WHOP_PLAN_ID=plan_ntTuSfZpGhMJu` and
`WHOP_CHECKOUT_URL=https://whop.com/checkout/ch_mMNbh5gIMIjL09n/`.
Report each key as set or missing. Never invent values.
Ensure the data directory exists and is writable by the service user.

### 5. Service

Create systemd unit `reki-web`: runs `npm start` in the app directory,
`Restart=always`, starts on boot. Then:

```sh
systemctl daemon-reload
systemctl enable --now reki-web
systemctl is-active reki-web
```

### 6. Verify

```sh
curl -fsS https://web.rekisupplement.com/api/health
curl -fsS https://web.rekisupplement.com/ | head -c 300
curl -fsS https://rekisupplement.com/privacy | head -c 200
curl -fsS https://api.rekisupplement.com/health
```

All four must succeed. The first two prove the new site; the last two prove
nothing else moved.

## Report back

- DNS status (`dig` output).
- Caddy file path, the block you added (redact nothing — it holds no
  secrets), validate + reload output.
- App directory, Node port, service status.
- The four verify outputs.
- List of env keys still missing values.
- Explicit confirmation: apex, api, and legal paths unchanged.

## Rollback (if anything else breaks)

```sh
systemctl stop reki-web
# remove the web.rekisupplement.com block, then:
caddy validate && systemctl reload caddy
```

Support: admin@rekisupplement.org.
