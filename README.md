# Reki Web local preview

Separate from the iPhone app and all existing Reki projects. No production API calls, accounts, analytics, payments, or cloud sync.

Support: admin@rekisupplement.org. Product/checkout setup instructions: [Whop handoff](docs/WHOP_HANDOFF.md).

## Run

```sh
npm install
npm run dev -- --port 5173
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

Reki Web, $3.99 USD paid once for one month of core web tracker beta access. No automatic renewal or subsequent automatic charge; paid access ends after one month. Separate from Reki Pro/iPhone. AI scanning and iPhone app access are not included. Checkout and access expiry are not implemented in this local preview; no purchase can be made.

The beta access button explicitly explains checkout is not connected. Before a public paid launch: owner-approved Whop product and offer terms, verified payment/membership access, appropriate privacy/terms and data protection, and a backup/export strategy. Local storage is not paid-access enforcement and must not be treated as such.

## Verify

```sh
npm run build
npx playwright install chromium
npm test
```
