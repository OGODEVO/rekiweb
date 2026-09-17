# Reki Web

Separate from the iPhone app and all existing Reki projects.

Support: admin@rekisupplement.org. Product/checkout setup: [Whop handoff](docs/WHOP_HANDOFF.md). Deploy: [deploy handoff](docs/DEPLOY.md).

## Run

Frontend preview:

```sh
npm install
npm run dev -- --port 5173
```

Paid-access server (needs env from `.env.example`, never commit `.env`):

```sh
npm run build
npm run server # serves dist/ + API on $PORT (default 3001)
```

The included optimized mascot assets come from the local Rekianime folder (face) and iOS asset catalog (transparent waving character). Originals are unchanged. To regenerate on this Mac: `npm run assets`.

## What works

- Today check-offs stored by local calendar date.
- Add, edit, and remove supplement entries with serving notes and schedule.
- Daily energy/sleep/mood ratings, editable same-day, with actual recorded averages.
- Example stack clearly labeled; "Make it yours" clears examples after confirmation.
- Browser-local persistence, validation of saved records, saving failure notice, daily rollover.
- Responsive page, keyboard tabs, native dialogs, reduced-motion support.

## Offer boundaries

Reki Web membership: $4.99 USD per month through Whop
(`plan_ntTuSfZpGhMJu`). Manage or cancel in Whop; access covers time already
paid. Separate from Reki Pro/iPhone. AI scanning and iPhone app access are
not included.

Access is granted only by a server-verified Whop membership recorded as an
entitlement; checkout redirects alone unlock nothing. Expiry, refunds, and
deactivation revoke access; expired members keep read-only history plus
export. Checkout stays unlisted until the flow in `docs/DEPLOY.md` is
verified end to end.

## Verify

```sh
npm run build
npm run test:server
npx playwright install chromium
npm test
```
