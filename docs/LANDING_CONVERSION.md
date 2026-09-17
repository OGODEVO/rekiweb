# Landing conversion update

Based on the September 17 ad debrief. This change does not touch ad budgets,
targeting, creatives, Whop plan settings, or the iPhone app.

## Product boundary

Free: a usable single-browser tracker, including local history and Insights.
Member: account-backed saving, loading the saved record on another signed-in
device, recovery of server saves after clearing local storage, and authenticated
read/export after expiry. No exclusive Insights, priority support, unlimited
history, AI scan, or iPhone access promise was added. A failed server save is not
described as a backup; local preview data is not silently uploaded into accounts.

The conversion moment is an explicit "Keep this record across devices" prompt
after an add/check-off/feel-log action. It opens the account-saving offer, not an
automatic checkout. Free users can dismiss it and continue. New members with an
empty server record can explicitly import their preview after sign-in; existing
account records are never replaced automatically. The free tour explains local
storage rather than claiming that a visitor already has a backed-up account.

No trial or refund guarantee was enabled. Trust cues are factual: Whop handles
checkout/sign-in, real support email, clear tax/cancellation copy, and legal links.

## Billing and checkout

Public copy now matches the reported Whop checkout wording: $15 USD per month,
auto-renewing until canceled, plus applicable tax. Do not advertise $15.90 as a
universal total; tax varies. This is a copy change, not a plan interval change.
The provider's actual renewal date is the customer-facing authority. HR should
confirm the saved Whop plan's billing interval and receipt against backend
qualification during E2E before resuming ads.

The CTA waits for account initialization and checks fresh server access before
redirecting. Active members open their record; signed-out/nonmember users open
configured Whop checkout in the same tab. Failed verification blocks checkout
with a retry message instead of risking a duplicate subscription. Repeated clicks
are disabled while checking/navigating.

## Legal separation

The apex privacy/terms URLs explicitly cover iOS/Apple, not Whop and Reki Web.
They were not changed. `/legal.html` provides web-specific terms, privacy
information and refund-request instructions with footer deep links. It does not
invent a refund guarantee or retention period. Owner review of this new web copy
and the Whop checkout's actual refund terms remains required before another ad
round; this implementation is not legal review.

## Deployment and acceptance

Build and deploy Reki Web only. No environment or database migration in this
change. Verify `/#tracker` explains the first action and browser-only storage;
comparison and tax disclosure are readable on mobile; checkout opens in the
same tab; already-paid members aren't sent to buy again; Terms/Privacy/Refunds
links reach their matching web sections. Keep ads paused until the owner
approves the revised flow and the live purchase-to-access check passes.
