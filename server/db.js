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
  db.exec(SCHEMA);
  return db;
}

export function pruneOAuthStates(db, nowIso) {
  const cutoff = new Date(Date.parse(nowIso) - 15 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(cutoff);
}
