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
