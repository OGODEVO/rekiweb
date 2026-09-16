import { BILLING, billingConfigured } from "./config.js";
import { transaction } from "./db.js";

export function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : NaN;
}

export function membershipInScope(m, cfg, userId = m?.user_id) {
  return Boolean(billingConfigured(cfg) && m && /^mem_[A-Za-z0-9]+$/.test(m.id) &&
    typeof userId === "string" && /^user_[A-Za-z0-9]+$/.test(userId) && m.user_id === userId &&
    m.account?.id === cfg.accountId && m.product_id === cfg.productId && m.plan_id === cfg.planId);
}

export function paymentInScope(p, m, cfg) {
  return Boolean(membershipInScope(m, cfg) && p && /^pay_[A-Za-z0-9]+$/.test(p.id) &&
    p.membership?.id === m.id && p.user?.id === m.user_id && p.company?.id === cfg.accountId &&
    p.product?.id === cfg.productId && p.plan?.id === cfg.planId);
}

export function isRefunded(p) {
  return p.auto_refunded === true || Number(p.refunded_amount) > 0 || Boolean(p.refunded_at) ||
    ["refunded", "auto_refunded", "partially_refunded"].includes(p.substatus) ||
    p.refunds?.some((r) => r.status === "succeeded");
}

export function computeExpiry(membership) {
  const end = timestamp(membership.current_period_end);
  return Number.isFinite(end) ? new Date(end).toISOString() : null;
}

export function qualifies(m, p, cfg, nowIso) {
  if (!paymentInScope(p, m, cfg) || m.status !== "active" || p.status !== "paid" ||
    p.substatus !== "succeeded" || p.currency !== "usd" || p.subtotal !== BILLING.price ||
    p.auto_refunded !== false || p.refunded_at !== null || (p.refunded_amount !== null && p.refunded_amount !== 0) ||
    typeof p.total !== "number" || !Number.isFinite(p.total) || p.total < BILLING.price || isRefunded(p) ||
    !["subscription_create", "subscription_cycle", "subscription"].includes(p.billing_reason)) return false;
  const end = timestamp(m.current_period_end), paid = timestamp(p.paid_at);
  const created = timestamp(p.created_at), now = timestamp(nowIso);
  const start = end - BILLING.intervalDays * 86400000;
  // The pinned payment schema has no period field. Only receipts created and
  // settled within this recurring period can substantiate its paid-through end.
  return end > now && start <= now && created >= start && created <= paid && paid <= now;
}

export function activeEntitlement(db, userId, nowIso, cfg) {
  if (!billingConfigured(cfg)) return null;
  return db.prepare(`SELECT * FROM entitlements WHERE whop_user_id = ? AND
    account_id = ? AND product_id = ? AND plan_id = ? AND revoked_at IS NULL AND
    payment_id IS NOT NULL AND verified_at IS NOT NULL AND expires_at > ?
    ORDER BY expires_at DESC LIMIT 1`).get(userId, cfg.accountId, cfg.productId, cfg.planId, nowIso) || null;
}

export function revokeMembership(db, membershipId, cutoff, { paymentId = null, reason = "deactivated", nowIso = new Date().toISOString() } = {}) {
  if (!Number.isFinite(timestamp(cutoff))) throw new Error("Invalid revocation timestamp");
  cutoff = new Date(timestamp(cutoff)).toISOString();
  db.prepare(`INSERT INTO membership_revocations (membership_id, cutoff_paid_at, reason) VALUES (?, ?, ?)
    ON CONFLICT(membership_id) DO UPDATE SET cutoff_paid_at = MAX(cutoff_paid_at, excluded.cutoff_paid_at), reason = excluded.reason`)
    .run(membershipId, cutoff, reason);
  if (paymentId) db.prepare(`INSERT OR IGNORE INTO refunded_payments (payment_id, membership_id, paid_at) VALUES (?, ?, ?)`)
    .run(paymentId, membershipId, cutoff);
  db.prepare(`UPDATE entitlements SET revoked_at = ? WHERE membership_id = ? AND (paid_at IS NULL OR paid_at <= ?)`)
    .run(nowIso, membershipId, cutoff);
}

export function grantFromMembership(db, m, { cfg, payment, source, nowIso }) {
  if (!qualifies(m, payment, cfg, nowIso)) return null;
  const paidAt = new Date(timestamp(payment.paid_at)).toISOString();
  const blocked = db.prepare("SELECT cutoff_paid_at FROM membership_revocations WHERE membership_id = ?").get(m.id);
  if ((blocked && paidAt <= blocked.cutoff_paid_at) ||
    db.prepare("SELECT 1 FROM refunded_payments WHERE payment_id = ?").get(payment.id)) return null;
  db.prepare(`INSERT INTO entitlements
    (whop_user_id, membership_id, account_id, product_id, plan_id, granted_at, expires_at, revoked_at, source, payment_id, paid_at, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(membership_id) DO UPDATE SET whop_user_id=excluded.whop_user_id,
    account_id=excluded.account_id, product_id=excluded.product_id, plan_id=excluded.plan_id,
    expires_at=excluded.expires_at, revoked_at=NULL, source=excluded.source,
    payment_id=excluded.payment_id, paid_at=excluded.paid_at, verified_at=excluded.verified_at`)
    .run(m.user_id, m.id, cfg.accountId, m.product_id, m.plan_id, nowIso, computeExpiry(m), source, payment.id, paidAt, nowIso);
  return db.prepare("SELECT * FROM entitlements WHERE membership_id = ?").get(m.id);
}

export function createAccessService(db, api, cfg, clock = Date.now) {
  const inFlight = new Map();
  const check = db.prepare(`INSERT INTO access_checks (whop_user_id, checked_at, status) VALUES (?, ?, ?)
    ON CONFLICT(whop_user_id) DO UPDATE SET checked_at=excluded.checked_at, status=excluded.status`);
  function refresh(userId) {
    if (inFlight.has(userId)) return inFlight.get(userId);
    const task = (async () => {
      check.run(userId, new Date(clock()).toISOString(), "checking");
      try {
        if (!billingConfigured(cfg)) throw new Error("Billing is not configured");
        const query = { userId, accountId: cfg.accountId, productId: cfg.productId, planId: cfg.planId, signal: AbortSignal.timeout(15000) };
        const memberships = await api.listMemberships(query);
        if (!Array.isArray(memberships)) throw new Error("Invalid memberships");
        const scoped = memberships.filter((m) => membershipInScope(m, cfg, userId));
        const payments = scoped.length ? await api.listPayments(query) : [];
        if (!Array.isArray(payments)) throw new Error("Invalid payments");
        const nowIso = new Date(clock()).toISOString();
        transaction(db, () => {
          // Replace the authoritative snapshot, including reductions and losses.
          db.prepare("UPDATE entitlements SET revoked_at = ? WHERE whop_user_id = ?").run(nowIso, userId);
          for (const m of scoped) {
            const receipts = payments.filter((p) => paymentInScope(p, m, cfg));
            for (const p of receipts) if (isRefunded(p))
              revokeMembership(db, m.id, p.paid_at, { paymentId: p.id, reason: "refund", nowIso });
            receipts.sort((a, b) => timestamp(b.paid_at) - timestamp(a.paid_at));
            for (const payment of receipts) {
              if (grantFromMembership(db, m, { cfg, payment, nowIso, source: "api:verified" })) break;
            }
          }
          check.run(userId, nowIso, "verified");
        });
      } catch (error) {
        check.run(userId, new Date(clock()).toISOString(), "unavailable");
        throw error;
      }
    })();
    inFlight.set(userId, task);
    return task.finally(() => inFlight.delete(userId));
  }
  async function access(userId, { refresh: force = false } = {}) {
    const row = db.prepare("SELECT * FROM access_checks WHERE whop_user_id = ?").get(userId);
    if (force || !row || clock() - Date.parse(row.checked_at) >= 60000 || inFlight.has(userId)) {
      try { await refresh(userId); } catch { /* Unavailable is persisted, never served as active. */ }
    }
    return current(userId);
  }
  function current(userId) {
    const row = db.prepare("SELECT * FROM access_checks WHERE whop_user_id = ?").get(userId);
    // An unresolved adverse event must not be bypassed by an ordinary refresh.
    const pending = db.prepare(`SELECT 1 FROM webhook_events WHERE account_id = ? AND status != 'completed'
      AND (type LIKE 'refund.%' OR type = 'membership.deactivated') LIMIT 1`).get(cfg.accountId || "");
    if (row?.status !== "verified" || clock() - Date.parse(row.checked_at) >= 60000 || pending)
      return { active: false, expiresAt: null, status: "verification_pending", verificationPending: true };
    const ent = activeEntitlement(db, userId, new Date(clock()).toISOString(), cfg);
    if (ent) return { active: true, expiresAt: ent.expires_at, status: "active" };
    const old = db.prepare("SELECT expires_at FROM entitlements WHERE whop_user_id = ? ORDER BY expires_at DESC LIMIT 1").get(userId);
    return { active: false, expiresAt: old?.expires_at || null, status: old && Date.parse(old.expires_at) <= clock() ? "expired" : "inactive" };
  }
  return { access, refresh, current };
}
