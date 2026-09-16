// Whop webhook verification (Standard Webhooks) and paid-access handling.
// Docs: https://docs.whop.com/developer/guides/webhooks
// Always 200 after verification bookkeeping; fulfillment is idempotent.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  grantFromMembership,
  pickQualifyingMembership,
  revokeMembership,
} from "./entitlements.js";

function candidateKeys(secret) {
  const keys = [Buffer.from(secret, "utf8")];
  const stripped = secret.replace(/^(ws_|whsec_)/, "");
  try {
    const b = Buffer.from(stripped, "base64");
    if (b.length >= 16) keys.push(b);
  } catch {
    // ignore; utf8 key is enough
  }
  return keys;
}

export function verifyWebhookSignature(rawBody, getHeader, secret) {
  try {
    const id = getHeader("webhook-id");
    const ts = getHeader("webhook-timestamp");
    const sig = getHeader("webhook-signature");
    if (!id || !ts || !sig || !secret) return false;
    const skew = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(skew) || skew > 5 * 60) return false;
    const payload =
      typeof rawBody === "string"
        ? rawBody
        : Buffer.from(rawBody).toString("utf8");
    const signed = `${id}.${ts}.${payload}`;
    const parts = sig.split(" ").flatMap((p) => p.split(","));
    const sigs = parts
      .map((p) => p.trim().replace(/^v1,?/, ""))
      .filter(Boolean);
    for (const key of candidateKeys(secret)) {
      const expected = createHmac("sha256", key)
        .update(signed, "utf8")
        .digest();
      for (const s of sigs) {
        try {
          const got = Buffer.from(s, "base64");
          if (got.length === expected.length && timingSafeEqual(got, expected))
            return true;
        } catch {
          // try next
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function field(obj, ...names) {
  for (const n of names) {
    const v = obj?.[n];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

export function extractRefs(data = {}) {
  const membershipId =
    field(data, "membership_id") ||
    field(data.membership || {}, "id") ||
    field(data.metadata || {}, "membership_id");
  const userId =
    field(data, "user_id") ||
    field(data.user || {}, "id") ||
    field(data.member || {}, "user_id") ||
    field(data.metadata || {}, "user_id");
  const paymentId = field(data, "id").startsWith("pay_")
    ? data.id
    : field(data, "payment_id") || field(data.payment || {}, "id");
  return { membershipId, userId, paymentId };
}

// Returns { action } where action is granted|revoked|noted|duplicate|ignored.
export async function handleWebhookEvent(db, whop, event, ctx) {
  const { type, data } = event;
  const nowIso = new Date().toISOString();
  const { membershipId, userId } = extractRefs(data || {});
  const wid = event.webhookId || "";

  if (wid) {
    try {
      db.prepare(
        "INSERT INTO webhook_events (webhook_id, type, received_at, summary) VALUES (?, ?, ?, ?)",
      ).run(wid, type, nowIso, (data?.id || membershipId || "").slice(0, 120));
    } catch {
      return { action: "duplicate" };
    }
  }

  const grantMembership = (m) =>
    grantFromMembership(db, m, {
      durationDays: ctx.durationDays,
      source: `webhook:${type}`,
      nowIso,
    });

  if (type === "membership.activated" || type === "membership.updated") {
    if (membershipId) {
      const m = await whop.retrieveMembership(membershipId);
      if (m?.user_id && (!ctx.productId || m.product_id === ctx.productId)) {
        grantMembership(m);
        return { action: "granted" };
      }
    }
    return { action: "noted" };
  }

  if (type === "membership.deactivated") {
    if (membershipId) revokeMembership(db, membershipId, nowIso);
    return { action: "revoked" };
  }

  if (type === "payment.succeeded") {
    let membership = null;
    if (membershipId) membership = await whop.retrieveMembership(membershipId);
    else if (userId) {
      const list = await whop.listMemberships({
        userId,
        accountId: ctx.accountId || undefined,
        productId: ctx.productId || undefined,
        planId: ctx.planId || undefined,
      });
      membership = pickQualifyingMembership(list, {
        productId: ctx.productId,
        planId: ctx.planId,
      });
    }
    if (membership) {
      grantMembership(membership);
      return { action: "granted" };
    }
    return { action: "noted" };
  }

  if (type === "refund.created" || type === "refund.updated") {
    const status = String(data?.status || "").toLowerCase();
    const isFinal =
      status === "succeeded" || status === "completed" || status === "paid";
    let target = membershipId;
    if (!target && data) {
      const pid = field(data, "payment_id") || field(data.payment || {}, "id");
      if (pid) {
        try {
          const payment = await whop.retrievePayment(pid);
          target =
            field(payment, "membership_id") ||
            field(payment.membership || {}, "id");
        } catch {
          target = "";
        }
      }
    }
    if (target && isFinal) {
      revokeMembership(db, target, nowIso);
      return { action: "revoked" };
    }
    return { action: "noted" };
  }

  return { action: "ignored" };
}
