import { it } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../server/db.js";
import { activeEntitlement, computeExpiry, grantFromMembership, qualifies, revokeMembership } from "../../server/entitlements.js";
import { cfg, membership, payment, iso, DAY, harness } from "./fixtures.js";

it("strict membership and payment scopes, active status, amount, settlement, and dates are required", () => {
  const now = Date.now(), m = membership(now), p = payment(now), time = iso(now);
  assert.equal(qualifies(m, p, cfg, time), true);
  for (const changes of [
    { account: { id: "biz_other" } }, { product_id: "prod_other" }, { plan_id: "plan_old" }, { user_id: "user_other" },
    { status: "trialing" }, { status: "past_due" }, { status: "completed" }, { status: "canceled" },
    { current_period_end: null }, { current_period_end: "invalid" }, { current_period_end: iso(now - 1) },
  ]) assert.equal(qualifies({ ...m, ...changes }, p, cfg, time), false, JSON.stringify(changes));
  for (const changes of [
    { company: { id: "biz_other" } }, { user: { id: "user_other" } }, { membership: { id: "mem_other" } },
    { product: { id: "prod_other" } }, { plan: { id: "plan_old" } }, { status: "authorized" }, { substatus: "pending" },
    { paid_at: null }, { paid_at: iso(now + 1) }, { paid_at: "2026-02-30T00:00:00.000Z" },
    { created_at: iso(now - 31 * DAY) }, { subtotal: 3.99 }, { total: 0 }, { currency: "eur" },
    { refunded_amount: 0.01 }, { refunded_amount: undefined }, { auto_refunded: true }, { auto_refunded: undefined },
    { refunded_at: undefined }, { substatus: "partially_refunded" }, { billing_reason: "manual" },
  ]) assert.equal(qualifies(m, { ...p, ...changes }, cfg, time), false, JSON.stringify(changes));
  for (const changes of [{ accountId: "" }, { productId: "" }, { planId: "" }, { apiKey: "" }])
    assert.equal(qualifies(m, p, { ...cfg, ...changes }, time), false);
});

it("recurring grants follow verified provider periods, not original membership creation", () => {
  const db = openDatabase(":memory:");
  try {
    const now = Date.now(), m = membership(now), p = payment(now);
    const opts = { cfg, payment: p, nowIso: iso(now), source: "test" };
    const first = grantFromMembership(db, m, opts);
    assert.equal(first.expires_at, m.current_period_end);
    assert.equal(computeExpiry({ ...m, current_period_end: null }), null);
    assert.equal(grantFromMembership(db, m, opts).id, first.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM entitlements").get().n, 1);
    const later = now + 30 * DAY;
    const renewed = { ...m, current_period_end: iso(later + 29 * DAY) };
    // Reusing an old settled receipt cannot substantiate the new billing period.
    assert.equal(grantFromMembership(db, renewed, { ...opts, nowIso: iso(later) }), null);
    const newerPayment = payment(later, renewed, { id: "pay_renewal" });
    const renewal = grantFromMembership(db, renewed, { ...opts, payment: newerPayment, nowIso: iso(later) });
    assert.equal(renewal.id, first.id);
    assert.equal(renewal.expires_at, renewed.current_period_end);
    const reduced = { ...renewed, current_period_end: iso(later + 28 * DAY) };
    assert.equal(grantFromMembership(db, reduced, { ...opts, payment: newerPayment, nowIso: iso(later) }).expires_at, reduced.current_period_end);
  } finally { db.close(); }
});

it("refund tombstones survive before/after grant ordering but allow a genuinely newer recurring payment", () => {
  for (const grantFirst of [false, true]) {
    const db = openDatabase(":memory:");
    try {
      const now = Date.now(), m = membership(now), p = payment(now);
      const opts = { cfg, payment: p, nowIso: iso(now), source: "test" };
      if (grantFirst) grantFromMembership(db, m, opts);
      revokeMembership(db, m.id, p.paid_at, { paymentId: p.id, reason: "refund" });
      assert.equal(grantFromMembership(db, m, opts), null);
      assert.equal(activeEntitlement(db, m.user_id, iso(now), cfg), null);
      const later = now + 30 * DAY;
      const next = membership(later), nextPayment = payment(later, next, { id: "pay_next" });
      assert.ok(grantFromMembership(db, next, { ...opts, payment: nextPayment, nowIso: iso(later) }));
      // A delayed refund for the old payment must not revoke the new cycle.
      revokeMembership(db, m.id, p.paid_at, { paymentId: p.id, reason: "refund" });
      assert.ok(activeEntitlement(db, m.user_id, iso(later), cfg));
    } finally { db.close(); }
  }
});

it("provider returns for other accounts/users cannot confer access and free periods fail closed", async (t) => {
  const h = await harness(t), a = h.auth();
  h.memberships[0].user_id = "user_b";
  assert.equal((await (await h.request("/api/me", { headers: a })).json()).access.active, false);
  h.memberships[0].user_id = "user_a";
  h.payments.length = 0;
  assert.equal((await (await h.request("/api/me?refresh=1", { headers: a })).json()).access.active, false);
});

it("simultaneous reconciliation calls share one provider snapshot", async (t) => {
  const h = await harness(t);
  await Promise.all([h.access.refresh("user_a"), h.access.refresh("user_a")]);
  assert.equal(h.calls.memberships, 1);
  assert.equal(h.calls.payments, 1);
});

it("a refund tombstone committed during a provider lookup defeats its stale grant snapshot", async (t) => {
  const h = await harness(t);
  let entered, release;
  const ready = new Promise((r) => { entered = r; });
  h.api.listPayments = async () => {
    const snapshot = structuredClone(h.payments);
    entered();
    await new Promise((r) => { release = r; });
    return snapshot;
  };
  const refreshing = h.access.refresh("user_a");
  await ready;
  revokeMembership(h.db, "mem_a", h.payments[0].paid_at, { paymentId: "pay_a", reason: "refund" });
  release();
  await refreshing;
  assert.equal(h.access.current("user_a").active, false);
});

it("a partial reconciliation failure rolls back grants and marks verification unavailable", async (t) => {
  const h = await harness(t);
  await h.access.refresh("user_a");
  const previous = h.db.prepare("SELECT * FROM entitlements").get();
  h.payments[0].refunded_amount = 4.99;
  h.payments[0].paid_at = null;
  await assert.rejects(h.access.refresh("user_a"));
  assert.deepEqual(h.db.prepare("SELECT * FROM entitlements").get(), previous);
  assert.equal(h.access.current("user_a").verificationPending, true);
});
