// Entitlement rules for the $3.99 one-month beta.
// A redirect or browser flag never grants access; only a verified Whop
// membership recorded here does. Access always ends at expires_at.

export const QUALIFYING_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "completed",
]);

export function pickQualifyingMembership(
  memberships,
  { productId, planId } = {},
) {
  const list = (memberships || []).filter(
    (m) =>
      m &&
      QUALIFYING_STATUSES.has(m.status) &&
      (!productId || m.product_id === productId) &&
      (!planId || m.plan_id === planId) &&
      m.user_id,
  );
  list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return list[0] || null;
}

export function computeExpiry(membership, durationDays) {
  const start = Date.parse(membership.created_at);
  const base = Number.isFinite(start) ? start : Date.now();
  let expires = base + durationDays * 24 * 60 * 60 * 1000;
  const whopEnd = Date.parse(membership.current_period_end || "");
  if (Number.isFinite(whopEnd)) expires = Math.min(expires, whopEnd);
  return new Date(expires).toISOString();
}

export function isActive(entitlement, nowIso) {
  if (!entitlement || entitlement.revoked_at) return false;
  return String(entitlement.expires_at) > String(nowIso);
}

export function activeEntitlement(db, whopUserId, nowIso) {
  return (
    db
      .prepare(
        `SELECT * FROM entitlements
         WHERE whop_user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY expires_at DESC LIMIT 1`,
      )
      .get(whopUserId, nowIso) || null
  );
}

export function grantFromMembership(
  db,
  membership,
  { durationDays, source, nowIso },
) {
  const expiresAt = computeExpiry(membership, durationDays);
  const existing = db
    .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
    .get(membership.id);
  if (existing) {
    if (!existing.revoked_at && existing.expires_at >= expiresAt)
      return existing;
    db.prepare(
      `UPDATE entitlements
       SET expires_at = ?, revoked_at = NULL, source = ? WHERE membership_id = ?`,
    ).run(expiresAt, source, membership.id);
    return db
      .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
      .get(membership.id);
  }
  db.prepare(
    `INSERT INTO entitlements
     (whop_user_id, membership_id, product_id, plan_id, granted_at, expires_at, revoked_at, source)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    membership.user_id,
    membership.id,
    membership.product_id || null,
    membership.plan_id || null,
    nowIso,
    expiresAt,
    source,
  );
  return db
    .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
    .get(membership.id);
}

export function revokeMembership(db, membershipId, nowIso) {
  const row = db
    .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
    .get(membershipId);
  if (!row || row.revoked_at) return row;
  db.prepare(
    "UPDATE entitlements SET revoked_at = ? WHERE membership_id = ?",
  ).run(nowIso, membershipId);
  return db
    .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
    .get(membershipId);
}
