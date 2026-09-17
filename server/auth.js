// Whop OAuth 2.1 + PKCE for Reki Web sign-in.
// Docs: https://docs.whop.com/developer/guides/oauth
// Sessions are server-side rows; the cookie holds only a random session id.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { fetchJson } from "./whop.js";

export const SESSION_COOKIE = "reki_session";
export const OAUTH_COOKIE = "reki_oauth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(
    createHash("sha256").update(verifier, "utf8").digest(),
  );
  return { verifier, challenge };
}

export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try {
      const value = decodeURIComponent(part.slice(i + 1).trim());
      out[key] = Object.hasOwn(out, key) ? "" : value;
    } catch { out[key] = ""; }
  }
  return out;
}

export function randomToken() { return randomBytes(32).toString("base64url"); }
export function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }
export function equalToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function oauthCookie(value, secure, clear = false) {
  return `${OAUTH_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/whop; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 900}${secure ? "; Secure" : ""}`;
}

export function sessionCookie(sessionId, { secure }) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedSessionCookie(secure = false) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function authorizeUrl({
  apiBase,
  appId,
  redirectUri,
  scope,
  accountId,
}) {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: appId,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (accountId) params.set("company_id", accountId);
  return {
    url: `${apiBase}/oauth/authorize?${params}`,
    state,
    nonce,
    verifier,
  };
}

export async function exchangeCode(
  { apiBase, appId, clientSecret, redirectUri, code, verifier },
  fetchImpl = globalThis.fetch,
) {
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: appId,
    code_verifier: verifier,
  };
  if (clientSecret) body.client_secret = clientSecret;
  return fetchJson(`${apiBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, fetchImpl);
}

export function createSession(db, whopUserId, nowMs = Date.now()) {
  const id = b64url(randomBytes(32));
  const now = new Date(nowMs).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, whop_user_id, created_at, expires_at, csrf_token) VALUES (?, ?, ?, ?, ?)",
  ).run(id, whopUserId, now, new Date(nowMs + SESSION_TTL_MS).toISOString(), randomToken());
  return id;
}

export function readSession(db, sessionId, nowIso) {
  if (!sessionId) return null;
  const session = (
    db
      .prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?")
      .get(sessionId, nowIso) || null
  );
  if (session && !session.csrf_token) {
    db.prepare("UPDATE sessions SET csrf_token = ? WHERE id = ? AND csrf_token IS NULL")
      .run(randomToken(), sessionId);
    session.csrf_token = db.prepare("SELECT csrf_token FROM sessions WHERE id = ?").get(sessionId).csrf_token;
  }
  return session;
}

export function destroySession(db, sessionId) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (email.length > 320) return "";
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return "";
  return email;
}

// Stable owner id for passwordless accounts. The "local:" prefix can never
// collide with Whop "user_" ids, so native and OAuth rows share every table.
export function nativeOwnerId(email) {
  return `local:${createHash("sha256").update(`reki-native:${email}`).digest("hex").slice(0, 32)}`;
}

export function findUserByEmail(db, email) {
  if (!email) return null;
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
}

// Native sign-in resolves by email first: an existing OAuth row with the same
// email is reused as-is, so current members keep their id, entitlements, and
// saved tracker with zero migration step at login time.
export function upsertNativeUser(db, { email, nowIso }) {
  const existing = findUserByEmail(db, email);
  if (existing) return existing;
  const ownerId = nativeOwnerId(email);
  const taken = db.prepare("SELECT * FROM users WHERE whop_user_id = ?").get(ownerId);
  if (taken) return taken;
  db.prepare(
    "INSERT INTO users (whop_user_id, email, name, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
  ).run(ownerId, email, nowIso, nowIso);
  return db.prepare("SELECT * FROM users WHERE whop_user_id = ?").get(ownerId);
}

export function issueMagicToken(db, { email, next, nowMs = Date.now(), ttlMin = 15 }) {
  const token = randomToken();
  const now = new Date(nowMs).toISOString();
  // Bound outstanding tokens per email so the table cannot grow unbounded.
  const live = db.prepare(
    "SELECT COUNT(*) AS n FROM magic_tokens WHERE email = ? AND consumed_at IS NULL AND expires_at > ?",
  ).get(email, now).n;
  if (live >= 5) {
    db.prepare("DELETE FROM magic_tokens WHERE email = ? AND (consumed_at IS NOT NULL OR expires_at <= ?)").run(email, now);
  }
  db.prepare(
    "INSERT INTO magic_tokens (token_hash, email, created_at, expires_at, consumed_at, next) VALUES (?, ?, ?, ?, NULL, ?)",
  ).run(
    tokenHash(token), email, now,
    new Date(nowMs + ttlMin * 60 * 1000).toISOString(), next || "/#tracker",
  );
  return token;
}

// Returns the token row on success, null on expired/unknown/used. Consumes
// atomically: exactly one caller can redeem a token.
export function consumeMagicToken(db, token, nowIso) {
  if (typeof token !== "string" || !token) return null;
  const hash = tokenHash(token);
  const row = db.prepare(
    "SELECT * FROM magic_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?",
  ).get(hash, nowIso);
  if (!row) return null;
  const done = db.prepare(
    "UPDATE magic_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL",
  ).run(nowIso, hash);
  if (!done.changes) return null; // lost a race; treat as invalid
  return row;
}

// Link a Whop identity to its email owner (webhook path). Never merges two
// different emails: if the Whop row already carries another email, keep it
// and let the native login resolve through the matching row instead.
export function linkWhopEmail(db, { whopUserId, email, name, nowIso }) {
  if (!email) return;
  const byId = db.prepare("SELECT * FROM users WHERE whop_user_id = ?").get(whopUserId);
  if (byId) {
    if (!byId.email) {
      db.prepare("UPDATE users SET email = ?, name = COALESCE(name, ?), updated_at = ? WHERE whop_user_id = ?")
        .run(email, name || null, nowIso, whopUserId);
    }
    return;
  }
  // First sight of this buyer (paid before any sign-in): record the identity
  // row now so a later native login resolves to this same owner id. Never
  // attach an email that already belongs to a different owner id.
  const clash = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (clash) return;
  db.prepare(
    "INSERT INTO users (whop_user_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(whopUserId, email, name || null, nowIso, nowIso);
}

export function upsertUser(db, { whopUserId, email, name, nowIso }) {
  const existing = db
    .prepare("SELECT * FROM users WHERE whop_user_id = ?")
    .get(whopUserId);
  if (!existing) {
    db.prepare(
      "INSERT INTO users (whop_user_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(whopUserId, email || null, name || null, nowIso, nowIso);
    return;
  }
  db.prepare(
    "UPDATE users SET email = ?, name = ?, updated_at = ? WHERE whop_user_id = ?",
  ).run(email || null, name || null, nowIso, whopUserId);
}
