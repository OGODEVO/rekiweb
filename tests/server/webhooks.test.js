import { it } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhookSignature } from "../../server/webhooks.js";
import { createApp } from "../../server/index.js";
import { harness, signed, cfg, iso, DAY, membership, payment } from "./fixtures.js";

it("signature verification uses literal ws_ UTF8, exact raw bytes, v1 and fresh integer timestamps", () => {
  const body = Buffer.from('{"text":"different whitespace matters"}');
  const headers = signed(body, "msg_test");
  const verify = (h = headers, b = body, secret = cfg.webhookSecret) => verifyWebhookSignature(b, (n) => h[n], secret);
  assert.equal(verify(), true);
  assert.equal(verify(headers, Buffer.concat([body, Buffer.from(" ")])), false);
  assert.equal(verify(headers, body, "ws_wrong"), false);
  assert.equal(verify(signed(body, "msg_test", Buffer.from(cfg.webhookSecret.slice(3), "base64"))), false);
  assert.equal(verify(signed(body, "msg_test", cfg.webhookSecret, Math.floor(Date.now() / 1000) - 301)), false);
  assert.equal(verify(signed(body, "msg_test", cfg.webhookSecret, Math.floor(Date.now() / 1000) + 301)), false);
  assert.equal(verify({ ...headers, "webhook-signature": headers["webhook-signature"].replace("v1,", "v2,") }), false);
  assert.equal(verify({ ...headers, "webhook-signature": `v2,ignored ${headers["webhook-signature"]}` }), true);
  assert.equal(verify(headers, body.toString()), false);
});

it("signed header/envelope IDs and pinned envelope versions must agree", async (t) => {
  const h = await harness(t);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_a", { id: "msg_different" })).status, 400);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_b", { id: undefined })).status, 400);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_c", { api_version_date: "old" })).status, 400);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_d", { account_id: "biz_other" })).status, 200);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM webhook_events").get().n, 0);
  assert.equal((await h.request("/api/webhooks/whop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
});

it("incomplete billing configuration never acknowledges fulfillment as successful", async (t) => {
  const h = await harness(t, { productId: "" });
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_config")).status, 503);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM webhook_events WHERE status='completed'").get().n, 0);
});

it("payment events grant once, retries deduplicate, and ID collisions cannot replace events", async (t) => {
  const h = await harness(t);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_a")).status, 200);
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_a")).status, 200);
  assert.equal(h.calls.memberships, 1);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM entitlements").get().n, 1);
  assert.equal(h.db.prepare("SELECT status FROM webhook_events").get().status, "completed");
  assert.equal((await h.send("membership.activated", "mem_a", "msg_a")).status, 400);
});

it("membership root data.id deactivation revokes independently of refunds", async (t) => {
  const h = await harness(t);
  await h.send("payment.succeeded", "pay_a", "msg_payment");
  h.memberships[0].status = "canceled";
  assert.equal((await h.send("membership.deactivated", "mem_a", "msg_deactivated")).status, 200);
  assert.equal(h.access.current("user_a").active, false);
  assert.ok(h.db.prepare("SELECT * FROM membership_revocations WHERE membership_id='mem_a'").get());
});

it("wrong-plan/product/account webhook resources never confer access", async (t) => {
  const h = await harness(t);
  for (const [key, value] of [["plan_id", "plan_old"], ["product_id", "prod_other"], ["account", { id: "biz_other" }]]) {
    h.memberships[0] = membership(h.now(), { [key]: value });
    assert.equal((await h.send("payment.succeeded", "pay_a", `msg_${key.replaceAll("_", "")}`)).status, 200);
  }
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM entitlements").get().n, 0);
});

it("transient failures return 503, preserve retry work, and successful redelivery completes", async (t) => {
  const h = await harness(t);
  const original = h.api.retrievePayment;
  h.api.retrievePayment = async () => { throw new Error("transient"); };
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_retry")).status, 503);
  assert.equal(h.db.prepare("SELECT status FROM webhook_events").get().status, "failed");
  h.api.retrievePayment = original;
  assert.equal((await h.send("payment.succeeded", "pay_a", "msg_retry")).status, 200);
  assert.equal(h.db.prepare("SELECT attempts FROM webhook_events").get().attempts, 2);
  assert.equal(h.access.current("user_a").active, true);
});

it("durable local retry reclaims expired processing leases without a provider redelivery", async (t) => {
  const h = await harness(t);
  const original = h.api.retrievePayment;
  h.api.retrievePayment = async () => { throw new Error("offline"); };
  await h.send("payment.succeeded", "pay_a", "msg_retry");
  h.api.retrievePayment = original;
  h.db.prepare("UPDATE webhook_events SET status='processing',lease_until=0,next_attempt_at=0").run();
  const restarted = createApp({ db: h.db, cfg: h.cfg, whop: h.api, clock: h.now });
  await restarted.retryWebhooks();
  assert.equal(h.db.prepare("SELECT status FROM webhook_events").get().status, "completed");
  assert.equal(h.access.current("user_a").active, true);
});

it("late deactivation from a prior cycle does not revoke a newer settled renewal", async (t) => {
  const h = await harness(t);
  const oldTime = iso(h.now());
  h.advance(30 * DAY);
  h.memberships[0] = membership(h.now());
  h.payments.push(payment(h.now(), h.memberships[0], { id: "pay_next" }));
  await h.send("payment.succeeded", "pay_next", "msg_next");
  assert.equal((await h.send("membership.deactivated", "mem_a", "msg_late", { timestamp: oldTime })).status, 200);
  assert.equal(h.access.current("user_a").active, true);
});

it("a scheduled cancellation retains only the currently paid period", async (t) => {
  const h = await harness(t);
  h.memberships[0].cancel_at_period_end = true;
  assert.equal((await h.send("membership.cancel_at_period_end_changed", "mem_a", "msg_cancel")).status, 200);
  assert.equal(h.access.current("user_a").active, true);
  h.advance(30 * DAY);
  await h.access.refresh("user_a");
  assert.equal(h.access.current("user_a").active, false);
});

it("failed refunds deny access until retried and cannot be erased by payment replay or refresh", async (t) => {
  const h = await harness(t);
  await h.send("payment.succeeded", "pay_a", "msg_paid");
  h.refunds.push({ id: "rf_a", payment: { id: "pay_a" }, status: "succeeded" });
  const original = h.api.retrievePayment;
  h.api.retrievePayment = async () => { throw new Error("temporary"); };
  assert.equal((await h.send("refund.updated", "rf_a", "msg_refund")).status, 503);
  await h.access.refresh("user_a");
  assert.equal(h.access.current("user_a").verificationPending, true);
  h.api.retrievePayment = original;
  assert.equal((await h.send("refund.updated", "rf_a", "msg_refund")).status, 200);
  assert.equal(h.access.current("user_a").active, false);
  // List results deliberately remain stale: tombstones still win.
  await h.send("payment.succeeded", "pay_a", "msg_paid");
  await h.send("payment.succeeded", "pay_a", "msg_newdelivery");
  await h.access.refresh("user_a");
  assert.equal(h.access.current("user_a").active, false);
});

it("refund-before-grant blocks old receipts; delayed old refund preserves genuine next-cycle access", async (t) => {
  const h = await harness(t);
  h.refunds.push({ id: "rf_a", payment: { id: "pay_a" }, status: "succeeded" });
  assert.equal((await h.send("refund.created", "rf_a", "msg_refundfirst")).status, 200);
  assert.equal(h.access.current("user_a").active, false);
  h.advance(30 * DAY);
  h.memberships[0] = membership(h.now());
  h.payments.push(payment(h.now(), h.memberships[0], { id: "pay_next" }));
  assert.equal((await h.send("payment.succeeded", "pay_next", "msg_next")).status, 200);
  assert.equal(h.access.current("user_a").active, true);
  assert.equal((await h.send("refund.updated", "rf_a", "msg_delayed")).status, 200);
  assert.equal(h.access.current("user_a").active, true);
  assert.equal(h.access.current("user_a").expiresAt, h.memberships[0].current_period_end);
});

it("failed/non-final refunds do not revoke, while partial succeeded refunds do", async (t) => {
  const h = await harness(t);
  await h.send("payment.succeeded", "pay_a", "msg_paid");
  h.refunds.push({ id: "rf_a", payment: { id: "pay_a" }, status: "failed", amount: 1 });
  await h.send("refund.updated", "rf_a", "msg_failed");
  assert.equal(h.access.current("user_a").active, true);
  h.refunds[0].status = "succeeded";
  await h.send("refund.updated", "rf_a", "msg_partial");
  assert.equal(h.access.current("user_a").active, false);
});

it("parallel duplicate deliveries never acknowledge an unfinished lease as completed", async (t) => {
  const h = await harness(t);
  const original = h.api.retrievePayment;
  let entered, release;
  const ready = new Promise((r) => { entered = r; });
  h.api.retrievePayment = async (...args) => { entered(); await new Promise((r) => { release = r; }); return original(...args); };
  const first = h.send("payment.succeeded", "pay_a", "msg_parallel");
  await ready;
  const second = await h.send("payment.succeeded", "pay_a", "msg_parallel");
  assert.equal(second.status, 503);
  release();
  assert.equal((await first).status, 200);
  assert.equal(h.db.prepare("SELECT attempts FROM webhook_events").get().attempts, 1);
});
