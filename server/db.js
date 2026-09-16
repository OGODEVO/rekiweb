// SQLite storage for Reki Web paid access. Uses node:sqlite (Node 22.5+).
// Tables: users, sessions, entitlements, webhook_events, tracker_states,
// oauth_states. All timestamps are ISO strings.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  whop_user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  whop_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whop_user_id TEXT NOT NULL,
  membership_id TEXT NOT NULL UNIQUE,
  product_id TEXT,
  plan_id TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  source TEXT
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user
  ON entitlements (whop_user_id);
CREATE TABLE IF NOT EXISTS webhook_events (
  webhook_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS tracker_states (
  whop_user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrateDatabase(db);
  return db;
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function migrateDatabase(db) {
  db.exec("PRAGMA busy_timeout = 5000");
  transaction(db, () => {
    db.exec(SCHEMA);
    const additions = {
      sessions: { csrf_token: "TEXT" },
      oauth_states: { browser_hash: "TEXT" },
      tracker_states: { revision: "INTEGER NOT NULL DEFAULT 1" },
      entitlements: { account_id: "TEXT", payment_id: "TEXT", paid_at: "TEXT", verified_at: "TEXT" },
      webhook_events: {
        payload: "TEXT", body_hash: "TEXT", account_id: "TEXT",
        status: "TEXT NOT NULL DEFAULT 'pending'", attempts: "INTEGER NOT NULL DEFAULT 0",
        lease_until: "INTEGER NOT NULL DEFAULT 0", next_attempt_at: "INTEGER NOT NULL DEFAULT 0",
      },
    };
    for (const [table, columns] of Object.entries(additions)) {
      const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const [name, type] of Object.entries(columns))
        if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS membership_revocations (
        membership_id TEXT PRIMARY KEY, cutoff_paid_at TEXT NOT NULL, reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS refunded_payments (
        payment_id TEXT PRIMARY KEY, membership_id TEXT NOT NULL, paid_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS access_checks (
        whop_user_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_retry ON webhook_events (account_id, status, next_attempt_at);
      INSERT OR IGNORE INTO membership_revocations (membership_id, cutoff_paid_at, reason)
        SELECT membership_id, revoked_at, 'legacy' FROM entitlements
        WHERE revoked_at IS NOT NULL AND payment_id IS NULL;
    `);
  });
}

export function pruneOAuthStates(db, nowIso) {
  const cutoff = new Date(Date.parse(nowIso) - 15 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(cutoff);
}
