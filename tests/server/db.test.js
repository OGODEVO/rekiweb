import { it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../../server/db.js";
import { readSession } from "../../server/auth.js";
import { grantFromMembership } from "../../server/entitlements.js";
import { cfg, membership, payment, iso, tracker, DAY } from "./fixtures.js";

it("migration preserves legacy sessions/state and conservative revocations, and is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, whop_user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE tracker_states (whop_user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE entitlements (id INTEGER PRIMARY KEY AUTOINCREMENT, whop_user_id TEXT NOT NULL, membership_id TEXT NOT NULL UNIQUE,
        product_id TEXT, plan_id TEXT, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, source TEXT);
      CREATE TABLE webhook_events (webhook_id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at TEXT NOT NULL, summary TEXT);
      CREATE TABLE oauth_states (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, next TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const now = Date.now(), old = JSON.stringify(tracker());
    db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run("legacy", "user_a", iso(now), iso(now + DAY));
    db.prepare("INSERT INTO tracker_states VALUES (?,?,?)").run("user_a", old, iso(now));
    db.prepare(`INSERT INTO entitlements (whop_user_id,membership_id,product_id,plan_id,granted_at,expires_at,revoked_at)
      VALUES (?,?,?,?,?,?,?)`).run("user_a", "mem_a", cfg.productId, cfg.planId, iso(now - DAY), iso(now + DAY), iso(now));
    db.prepare("INSERT INTO webhook_events VALUES (?,?,?,?)").run("msg_old", "payment.succeeded", iso(now), "pay_a");
    migrateDatabase(db); migrateDatabase(db);
    assert.equal(db.prepare("SELECT data FROM tracker_states").get().data, old);
    assert.equal(db.prepare("SELECT revision FROM tracker_states").get().revision, 1);
    assert.ok(readSession(db, "legacy", iso(now)).csrf_token);
    assert.equal(db.prepare("SELECT status FROM webhook_events").get().status, "pending");
    assert.equal(db.prepare("SELECT cutoff_paid_at FROM membership_revocations").get().cutoff_paid_at, iso(now));
    const m = membership(now), p = payment(now);
    assert.equal(grantFromMembership(db, m, { cfg, payment: p, nowIso: iso(now), source: "test" }), null);
    migrateDatabase(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tracker_states").get().n, 1);
  } finally { db.close(); }
});
