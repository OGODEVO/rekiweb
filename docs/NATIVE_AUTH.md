# Reki Web: native passwordless auth

Reki owns identity. Whop only takes the payment. There is no Whop redirect
for sign-in.

## Flow (the confirmed example)

1. Buyer signs in to Reki with `you@mail.com` (one-time email link).
2. Buyer pays on Whop with `you@mail.com`.
3. Whop webhooks tell our server "`you@mail.com` subscribed" (or renewed /
   cancelled / expired).
4. Server marks the account paid → tracker unlocks. Renewal extends it,
   cancel/expiry ends it.

The join funnel must push the same email on both sides; a mismatch shows an
honest "no purchase found" state, never a silent lockout.

## Implementation

- `POST /api/auth/magic/start` — validates the address, rate-limits
  (10/ip + 5/address per window), issues a single-use 15-minute token, and
  emails the link. Generic `{ok:true}` on success; malformed addresses get
  400; missing mailer gets 503. Undeliverable tokens are deleted, never kept.
- `GET /api/auth/magic/verify?token=` — consumes atomically (one redemption
  wins a race), finds or creates the native account by email, opens a
  server-side session, redirects to the tracker.
- Token storage is hash-only; raw tokens never touch the database, logs, or
  error responses.
- Mail goes through Resend (`MAIL_FROM`, `RESEND_API_KEY`). With no provider
  configured the endpoint fails closed. No console/log fallback exists by
  design.
- Existing OAuth members keep everything: native login resolves by email to
  the same owner id, so entitlements and saved tracker carry over with no
  migration step at login. Webhook buyer emails attach to Whop identities
  for members who paid before ever signing in.

## Still open (owner decisions)

- **SMTP/email provider + credentials**: Resend is wired; SMTP via another
  service needs its adapter plus key before production sign-in works.
- **P1 gating** (what membership unlocks vs free): auth plumbing is done,
  but feature gates wait on this definition.
- **OAuth removal**: the Whop login path stays until native auth + webhook
  email mapping pass live E2E. Then it is deleted, not deprecated.

## Deploy notes (VPS)

Add to the service env (never GitHub): `MAIL_FROM` (e.g.
`Reki <hello@rekisupplement.com>`), `RESEND_API_KEY`, optional
`MAGIC_LINK_TTL_MIN` (default 15). No database migration beyond the
automatic one (new `magic_tokens` table, unique email index). Restart the
service after env changes.
