# Reki Web: deploy handoff (HR)

Checkout stays unlisted until this flow is verified end to end. Nothing here
requires touching the iPhone app.

## What was built

- `server/`: Express API + SQLite paid-access backend.
  - `GET /api/config` — public checkout info, no secrets.
  - Whop OAuth sign-in: `GET /api/auth/whop/start` →
    `GET /api/auth/whop/callback` (PKCE, server-side session cookie).
  - `GET /api/me` — session + access status.
  - `GET /api/whop/return` — post-checkout landing. Verifies the purchase
    against Whop and redirects to `/?access=active#tracker` or
    `/?access=pending#tracker`. A redirect here is never proof of payment;
    only a recorded entitlement unlocks access.
  - `POST /api/webhooks/whop` — Standard Webhooks signature verification,
    idempotent handling of `payment.succeeded`, `membership.activated`,
    `membership.deactivated`, refunds. Secrets stay in env.
  - `GET/PUT /api/state` — account-backed tracker state, paid access only.
- Access rule: active iff an entitlement row exists with `revoked_at IS NULL`
  and `expires_at` in the future. 30 days from purchase, then it ends.
  Refunds, deactivation, and expiry revoke immediately on next check.

## Deploy

```sh
npm ci
npm run build
# env from .env.example (server env only, never GitHub)
npm start
```

Serves `dist/` + API on `$PORT` (default 3001). Requires `PUBLIC_BASE_URL`
set to the public `https://` domain.

## URLs the Whop agent needs (after HR confirms the domain)

```
Return:  {PUBLIC_BASE_URL}/api/whop/return
Webhook: {PUBLIC_BASE_URL}/api/webhooks/whop
OAuth callback (register on the Whop OAuth app):
         {PUBLIC_BASE_URL}/api/auth/whop/callback
```

Forward to the Whop agent once the domain is known:

```text
Reki Web deployment is up. Set these on the unlisted product/checkout:
- Post-checkout redirect: {PUBLIC_BASE_URL}/api/whop/return
- Webhook endpoint: {PUBLIC_BASE_URL}/api/webhooks/whop
  events: payment.succeeded, membership.activated,
  membership.deactivated, refund.created, refund.updated
- OAuth redirect URI: {PUBLIC_BASE_URL}/api/auth/whop/callback
Report the company, product, and plan IDs plus the hosted checkout URL.
Do not publish or share the checkout link; it stays unlisted until
the full payment-to-access test passes.
```

## Verify before any sale

1. `GET /api/health` → 200.
2. Test checkout (Whop sandbox/test facilities only, no real card without
   owner approval) → return URL lands on `?access=active#tracker`.
3. `GET /api/me?refresh=1` shows active access with an expiry ~30 days out.
4. Tracker edits persist via `PUT /api/state`; reload restores them.
5. Refund/deactivation webhook → `GET /api/me` shows inactive; `/api/state`
   returns 403.
6. Expired entitlement → 403 on `/api/state`.
7. No secret appears in GitHub, logs, or client responses (`/api/config`
   carries no secrets).

Support: admin@rekisupplement.org.
