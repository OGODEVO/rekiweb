# Reki Web: Whop product and checkout handoff

## Scope

Prepare one product and one checkout in the owner's existing Whop business. Inspect for an existing Reki Web product first; reuse it rather than creating duplicates. Do not change unrelated products, account ownership, payout details, or the iPhone app. Keep the offer unlisted and do not distribute a live payment link until the integration is verified and Arinze approves launch.

Repository: https://github.com/OGODEVO/rekiweb
Support/customer contact email: admin@rekisupplement.org

## Product

- Title: Reki Web
- Headline: Track your supplements. See how you feel.
- Plan/internal name: One-month beta - no automatic renewal
- Price: $3.99 USD, charged once.
- Payment type: One-time, NOT recurring. No free trial, recurring fallback, or automatic second charge.
- Access duration: One month from successful purchase. Enable Auto-expire access. If Whop supports only a day count, set 30 days, explicitly say "30 days" in checkout, and report this so the website copy and backend expiry can be matched before launch.
- No lifetime access, annual plan, or additional paid tiers for this test.
- No requirement to cancel: access expires without another charge.
- Keep marketplace/store visibility off during setup. Unlisted is not a payment block; do not send real customers the checkout link yet.

Description:

> A friendly browser-based supplement tracker. Organize your stack and serving notes, check off your daily routine, and record your energy, sleep, and mood. Pay $3.99 once for one month of beta access. No automatic renewal. Reki Web is separate from the Reki iPhone app: this purchase does not unlock Reki Pro. AI scanning is not included. Personal tracking only, not medical advice or proof that a supplement works.

## Brand

- Primary coral: #E07563; secondary coral: #EE9A88.
- Warm cream background: #FBF7F2; white cards: #FFFFFF.
- Primary text: #171513; secondary text: #655D55.
- Rounded headings, calm spacing, warm and friendly. No mint rebrand.
- Existing mascot assets: public/assets/reki-face.webp and public/assets/reki-waving.webp.
- Use actual web-preview screenshots, not iPhone screenshots or invented testimonials. Do not advertise cloud sync, scanning, or other unbuilt features as available.

## Checkout and delivery

1. Confirm the checkout summary displays $3.99 USD once, the exact access duration, and no automatic renewal. Report any buyer-facing fees/tax behavior and the seller fee schedule; do not claim a guaranteed net margin.
2. Confirm Auto-expire access is actually saved. The one-time payment setting alone must not accidentally grant permanent access. Do not substitute a recurring plan if expiry is unavailable; report the blocker.
3. Use a hosted Whop checkout link. Return its URL and the company, product, and plan IDs to the code agent. These IDs are not secrets.
4. Configure post-checkout redirect only once the code/deployment agent supplies the real public HTTPS return URL. Do not use localhost or invent a production domain/path.
5. Select only the intended Reki Web experience if available. Do not grant unrelated apps or a PDF as the product. Report if the web experience is not yet connected.
6. Return required developer integration settings and webhook event names supported by the current Whop API. Store any credentials in the approved secret store, never chat, screenshots, GitHub, or frontend code. Do not rotate existing credentials.
7. Verify payment completion, failed/cancelled checkout, expiry, and refund/revocation behavior using Whop's supported test facilities where available. Do not charge a real card to test without explicit approval.

Reference checked during setup: https://docs.whop.com/manage-your-business/payment-processing/set-up-pricing
The docs list One-time payments, Auto-expire access, and Redirect after checkout. Verify the actual dashboard settings rather than assuming defaults.

## Current code and launch blockers

This repository is a local Vite/JavaScript preview, not a finished paid service. It has working browser-local tracking and a checkout placeholder. It does NOT yet implement:

- Whop sign-in/account linking and returning-customer access.
- Backend purchase verification, user-scoped entitlements, or expiry enforcement.
- Verified, idempotent webhook handling for purchase and access revocation.
- Account-backed data persistence, backup/export, or read-only access after expiry.
- A production deployment, real checkout redirect, or finalized web privacy/terms.

The proposed delivery flow is payment -> sign-in/account link -> server-verified one-month access -> saved tracker. A redirect or browser flag is not proof of payment. Whop expiry must also be enforced server-side in Reki Web. Read-only history/export after expiry is planned, not built; do not promise it in checkout yet.

Do not connect live payments or advertise paid availability until the code agent completes and tests fulfillment. The iPhone app and its StoreKit subscriptions remain separate and unchanged.

## Return report

- Existing/new product, company ID, product ID, plan ID, hosted checkout URL.
- Exact price, currency, non-recurring status, access duration, expiry setting, and visibility.
- Screenshots of saved pricing/expiry and checkout summary, with private details redacted.
- Confirm support email is admin@rekisupplement.org.
- Actual fees discovered and whether $3.99 meets minimum price requirements.
- Redirect/experience integration status, test evidence, and remaining blockers.
- Do not mark ready to sell until the full payment-to-access flow is verified.
