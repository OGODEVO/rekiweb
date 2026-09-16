# Reki Web: Whop product and checkout handoff

## Scope

Prepare one product and one checkout in the owner's existing Whop business. Inspect for an existing Reki Web product first; reuse it rather than creating duplicates. Do not change unrelated products, account ownership, payout details, or the iPhone app. Keep the offer unlisted and do not distribute a live payment link until the integration is verified and Arinze approves launch.

Repository: https://github.com/OGODEVO/rekiweb
Support/customer contact email: admin@rekisupplement.org

## Product

- Title: Reki Web
- Headline: Track your supplements. See how you feel.
- Plan/internal name: Monthly membership — $15 now, then $15 every 30 days
- Price: $15 USD now, then $15 every 30 days (recurring).
- Payment type: Recurring membership. No free trial.
- Plan ID: `plan_ntTuSfZpGhMJu`. Checkout:
  `https://whop.com/checkout/ch_mMNbh5gIMIjL09n/`.
- The old $3.99 one-time plan is left alone and must not be sold.
- Access duration: each paid period, verified server-side against Whop's
  paid-through date. Manage/cancel in Whop; access covers time already paid.
- Keep marketplace/store visibility off during setup. Unlisted is not a payment block; do not send real customers the checkout link yet.

Description:

> A friendly browser-based supplement tracker. Organize your stack and serving notes, check off your daily routine, and record your energy, sleep, and mood. $15 now, then $15 every 30 days. Manage or cancel in Whop. Reki Web is separate from the Reki iPhone app: this purchase does not unlock Reki Pro. AI scanning is not included. Personal tracking only, not medical advice or proof that a supplement works.

## Brand

- Primary coral: #E07563; secondary coral: #EE9A88.
- Warm cream background: #FBF7F2; white cards: #FFFFFF.
- Primary text: #171513; secondary text: #655D55.
- Rounded headings, calm spacing, warm and friendly. No mint rebrand.
- Existing mascot assets: public/assets/reki-face.webp and public/assets/reki-waving.webp.
- Use actual web-preview screenshots, not iPhone screenshots or invented testimonials. Do not advertise cloud sync, scanning, or other unbuilt features as available.

## Checkout and delivery

1. Confirm the checkout summary displays $15 USD now and every 30 days on plan `plan_ntTuSfZpGhMJu`. Report any buyer-facing fees/tax behavior and the seller fee schedule; do not claim a guaranteed net margin.
2. Confirm access follows the paid-through period (recurring), not a fixed grant. Do not substitute a one-time plan; report the blocker if the plan type is wrong.
3. Use a hosted Whop checkout link. Return its URL and the company, product, and plan IDs to the code agent. These IDs are not secrets.
4. Configure post-checkout redirect only once the code/deployment agent supplies the real public HTTPS return URL. Do not use localhost or invent a production domain/path.
5. Select only the intended Reki Web experience if available. Do not grant unrelated apps or a PDF as the product. Report if the web experience is not yet connected.
6. Return required developer integration settings and webhook event names supported by the current Whop API. Store any credentials in the approved secret store, never chat, screenshots, GitHub, or frontend code. Do not rotate existing credentials.
7. Verify payment completion, failed/cancelled checkout, expiry, and refund/revocation behavior using Whop's supported test facilities where available. Do not charge a real card to test without explicit approval.

Reference checked during setup: https://docs.whop.com/manage-your-business/payment-processing/set-up-pricing
The docs list recurring billing and Redirect after checkout. Verify the actual dashboard settings rather than assuming defaults.

## Current code and launch blockers

The repository now implements the paid flow in `server/` (Whop OAuth sign-in,
server-verified recurring entitlements, signed idempotent webhooks,
account-backed state with revisions, read-only history plus export after
expiry). What is still missing before any sale:

- HR-confirmed public `https://` domain (`PUBLIC_BASE_URL`), so the three
  URLs in `docs/DEPLOY.md` (return, webhook, OAuth callback) can be registered.
- Whop-side values from this handoff's product setup: company, product, and
  plan IDs plus the hosted checkout URL, placed in server env (never GitHub).
- End-to-end verification per `docs/DEPLOY.md` (test purchase, renewal,
  refund/revocation). Checkout stays unlisted until then.

The delivery flow is payment -> sign-in/account link -> server-verified membership access -> saved tracker. A redirect or browser flag is not proof of payment. Whop's paid-through date is enforced server-side in Reki Web.

Do not connect live payments or advertise paid availability until the code agent completes and tests fulfillment. The iPhone app and its StoreKit subscriptions remain separate and unchanged.

## Return report

- Existing/new product, company ID, product ID, plan ID, hosted checkout URL.
- Exact price, currency, non-recurring status, access duration, expiry setting, and visibility.
- Screenshots of saved pricing/expiry and checkout summary, with private details redacted.
- Confirm support email is admin@rekisupplement.org.
- Actual fees discovered and whether $15 meets minimum price requirements.
- Redirect/experience integration status, test evidence, and remaining blockers.
- Do not mark ready to sell until the full payment-to-access flow is verified.
