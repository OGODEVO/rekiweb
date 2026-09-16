import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeExpiry,
  grantFromMembership,
  isActive,
  pickQualifyingMembership,
  revokeMembership,
} from "../../server/entitlements.js";
import { openDatabase } from "../../server/db.js";

const m = (over = {}) => ({
  id: "mem_1",
  user_id: "user_1",
  product_id: "prod_1",
  plan_id: "plan_1",
  status: "active",
  created_at: "2026-09-01T00:00:00.000Z",
  current_period_end: null,
  ...over,
});

describe("pickQualifyingMembership", () => {
  it("prefers newest qualifying membership for the product", () => {
    const pick = pickQualifyingMembership(
      [
        m({ id: "old" }),
        m({ id: "new", created_at: "2026-09-10T00:00:00.000Z" }),
      ],
      { productId: "prod_1" },
    );
    assert.equal(pick.id, "new");
  });
  it("rejects canceled memberships and wrong products", () => {
    assert.equal(
      pickQualifyingMembership(
        [m({ status: "canceled" }), m({ id: "x", product_id: "prod_9" })],
        { productId: "prod_1" },
      ),
      null,
    );
  });
  it("accepts completed one-time purchases", () => {
    assert.equal(
      pickQualifyingMembership([m({ status: "completed" })], {}).id,
      "mem_1",
    );
  });
});

describe("computeExpiry", () => {
  it("grants 30 days from purchase when Whop sets no expiry", () => {
    assert.equal(computeExpiry(m({}), 30), "2026-10-01T00:00:00.000Z");
  });
  it("never exceeds an earlier Whop expiry", () => {
    assert.equal(
      computeExpiry(m({ current_period_end: "2026-09-05T00:00:00.000Z" }), 30),
      "2026-09-05T00:00:00.000Z",
    );
  });
});

describe("grant / revoke lifecycle", () => {
  it("access ends after 30 days and revocation sticks", () => {
    const db = openDatabase(":memory:");
    const now = "2026-09-02T00:00:00.000Z";
    const ent = grantFromMembership(db, m({}), {
      durationDays: 30,
      source: "test",
      nowIso: now,
    });
    assert.equal(ent.expires_at, "2026-10-01T00:00:00.000Z");
    assert.equal(isActive(ent, "2026-09-15T00:00:00.000Z"), true);
    assert.equal(isActive(ent, "2026-10-02T00:00:00.000Z"), false);
    revokeMembership(db, "mem_1", now);
    const after = db
      .prepare("SELECT * FROM entitlements WHERE membership_id = ?")
      .get("mem_1");
    assert.equal(isActive(after, "2026-09-15T00:00:00.000Z"), false);
  });
});
