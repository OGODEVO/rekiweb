import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { membershipInScope, paymentInScope, revokeMembership, timestamp } from "./entitlements.js";
import { billingConfigured } from "./config.js";

export function verifyWebhookSignature(rawBody, getHeader, secret, nowMs = Date.now()) {
  const id = getHeader("webhook-id"), ts = getHeader("webhook-timestamp"), signature = getHeader("webhook-signature");
  if (!Buffer.isBuffer(rawBody) || typeof secret !== "string" || !secret.startsWith("ws_") ||
    typeof id !== "string" || !/^msg_[A-Za-z0-9]+$/.test(id) || typeof ts !== "string" ||
    !/^\d{10,11}$/.test(ts) || typeof signature !== "string" || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${id}.${ts}.`, "utf8").update(rawBody).digest();
  return signature.split(/\s+/).some((part) => {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(part);
    if (!match) return false;
    const got = Buffer.from(match[1], "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export const EVENT_TYPES = new Set([
  "membership.activated", "membership.deactivated", "membership.updated", "membership.cancel_at_period_end_changed",
  "payment.succeeded", "payment.failed", "payment.canceled", "payment.pending", "payment.requires_action",
  "refund.created", "refund.updated",
]);

export function enqueueWebhook(db, envelope, headerId, rawBody, cfg) {
  if (!envelope || envelope.id !== headerId || envelope.api_version !== "v1" ||
    envelope.api_version_date !== cfg.apiVersionDate || typeof envelope.type !== "string" ||
    !Number.isFinite(timestamp(envelope.timestamp)) || typeof envelope.account_id !== "string")
    throw Object.assign(new Error("invalid webhook envelope"), { status: 400 });
  if (envelope.account_id !== cfg.accountId || !EVENT_TYPES.has(envelope.type)) return null;
  const prefix = envelope.type.split(".")[0];
  const pattern = prefix === "membership" ? /^mem_[A-Za-z0-9]+$/ : prefix === "payment" ? /^pay_[A-Za-z0-9]+$/ : /^rf_[A-Za-z0-9]+$/;
  if (typeof envelope.data?.id !== "string" || !pattern.test(envelope.data.id))
    throw Object.assign(new Error("invalid webhook resource"), { status: 400 });
  const hash = createHash("sha256").update(rawBody).digest("hex");
  // Persist only IDs and event time, not provider PII, license keys or secrets.
  const payload = JSON.stringify({ type: envelope.type, id: envelope.data.id, timestamp: envelope.timestamp });
  db.prepare(`INSERT INTO webhook_events (webhook_id, type, received_at, summary, account_id, payload, body_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(webhook_id) DO NOTHING`)
    .run(headerId, envelope.type, new Date().toISOString(), envelope.data.id, cfg.accountId, payload, hash);
  const existing = db.prepare("SELECT * FROM webhook_events WHERE webhook_id = ?").get(headerId);
  if (existing.body_hash && existing.body_hash !== hash)
    throw Object.assign(new Error("webhook ID collision"), { status: 400 });
  if (!existing.body_hash) db.prepare(`UPDATE webhook_events SET payload=?, body_hash=?, account_id=? WHERE webhook_id=?`)
    .run(payload, hash, cfg.accountId, headerId);
  return headerId;
}

export async function processWebhook(db, api, access, id, cfg) {
  const now = Date.now();
  const event = db.prepare("SELECT * FROM webhook_events WHERE webhook_id = ?").get(id);
  if (!event || event.status === "completed") return { action: "duplicate" };
  const claim = db.prepare(`UPDATE webhook_events SET status='processing', lease_until=?, attempts=attempts+1
    WHERE webhook_id=? AND status!='completed' AND lease_until<=?`).run(now + 60000, id, now);
  if (!claim.changes) throw Object.assign(new Error("webhook processing; retry later"), { status: 503 });
  let userId;
  try {
    if (!billingConfigured(cfg)) throw new Error("Billing is not configured");
    if (event.account_id !== cfg.accountId) throw new Error("Webhook account configuration changed");
    const data = JSON.parse(event.payload);
    const signal = AbortSignal.timeout(20000);
    let membership, payment, refund;
    if (data.type.startsWith("membership.")) {
      membership = await api.retrieveMembership(data.id, signal);
      if (membership?.id !== data.id) throw new Error("Membership mismatch");
    } else {
      if (data.type.startsWith("refund.")) {
        refund = await api.retrieveRefund(data.id, signal);
        if (refund?.id !== data.id || !refund.payment?.id) throw new Error("Refund mismatch");
      }
      const paymentId = refund ? refund.payment.id : data.id;
      payment = await api.retrievePayment(paymentId, signal);
      if (payment?.id !== paymentId || !payment.membership?.id) throw new Error("Payment mismatch");
      membership = await api.retrieveMembership(payment.membership.id, signal);
      if (membership?.id !== payment.membership.id) throw new Error("Membership mismatch");
    }
    if (membershipInScope(membership, cfg) && (!payment || paymentInScope(payment, membership, cfg))) {
      userId = membership.user_id;
      if (refund?.status === "succeeded")
        revokeMembership(db, membership.id, payment.paid_at, { paymentId: payment.id, reason: "refund" });
      if (data.type === "membership.deactivated")
        revokeMembership(db, membership.id, data.timestamp);
      await access.refresh(userId);
    }
    db.prepare("UPDATE webhook_events SET status='completed', lease_until=0 WHERE webhook_id=?").run(id);
    return { action: "processed" };
  } catch (error) {
    db.prepare(`UPDATE webhook_events SET status='failed', lease_until=0, next_attempt_at=? WHERE webhook_id=?`)
      .run(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(event.attempts + 1, 12)), id);
    if (userId) db.prepare("UPDATE access_checks SET status='unavailable' WHERE whop_user_id=?").run(userId);
    else db.prepare(`UPDATE access_checks SET status='unavailable' WHERE whop_user_id IN
      (SELECT whop_user_id FROM entitlements WHERE account_id=?)`).run(cfg.accountId || "");
    throw Object.assign(new Error("webhook fulfillment unavailable; retry later"), { status: 503 });
  }
}

export async function retryWebhooks(db, api, access, cfg) {
  const now = Date.now();
  const rows = db.prepare(`SELECT webhook_id FROM webhook_events WHERE status!='completed' AND payload IS NOT NULL
    AND account_id=? AND next_attempt_at<=? AND lease_until<=? ORDER BY received_at LIMIT 5`).all(cfg.accountId || "", now, now);
  for (const row of rows) {
    try { await processWebhook(db, api, access, row.webhook_id, cfg); } catch { /* Durable failure is retried with backoff. */ }
  }
}
