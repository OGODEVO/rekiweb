import { it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorizeUrl, pkcePair, readSession } from "../../server/auth.js";
import { harness, iso } from "./fixtures.js";

it("builds S256 PKCE without exposing its verifier", () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.ok(verifier.length >= 43);
  const r = authorizeUrl({ apiBase: "https://api.whop.com", appId: "app_test", redirectUri: "https://reki.example/api/auth/whop/callback", scope: "openid profile email" });
  assert.ok(!r.url.includes(r.verifier));
});

it("OAuth state requires initiating browser binding and remains usable after a wrong-browser attempt", async (t) => {
  const h = await harness(t);
  const start = await h.request("/api/auth/whop/start?next=//evil.example");
  const url = new URL(start.headers.get("location"));
  assert.equal(url.searchParams.get("redirect_uri"), "https://reki.example/api/auth/whop/callback");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  assert.match(start.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=900; Secure/);
  const callback = `/api/auth/whop/callback?code=fixture&state=${url.searchParams.get("state")}`;
  assert.equal((await h.request(callback)).status, 400);
  assert.equal((await h.request(callback, { headers: { cookie: "reki_oauth=wrong" } })).status, 400);
  assert.equal(h.calls.tokens.length, 0);
  const result = await h.request(callback, { headers: { cookie } });
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("location"), "/?access=active#tracker");
  assert.match(result.headers.get("set-cookie"), /reki_session=/);
  assert.equal(h.calls.tokens[0].body.redirect_uri, url.searchParams.get("redirect_uri"));
  assert.equal(createHash("sha256").update(h.calls.tokens[0].body.code_verifier).digest("base64url"), url.searchParams.get("code_challenge"));
  assert.equal((await h.request(callback, { headers: { cookie } })).status, 400);
});

it("expired states fail, denied OAuth is generic, and expired entitlement callback redirects pending", async (t) => {
  const h = await harness(t);
  const start = await h.request("/api/auth/whop/start");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const cookie = start.headers.get("set-cookie").split(";")[0];
  h.advance(900001);
  assert.equal((await h.request(`/api/auth/whop/callback?code=x&state=${state}`, { headers: { cookie } })).status, 400);
  assert.equal((await h.request("/api/auth/whop/callback?error=access_denied")).status, 400);
  h.memberships[0].current_period_end = iso(h.now() - 1000);
  const second = await h.request("/api/auth/whop/start?next=%2Fapi%2Fwhop%2Freturn");
  const s2 = new URL(second.headers.get("location")).searchParams.get("state");
  const result = await h.request(`/api/auth/whop/callback?code=x&state=${s2}`, { headers: { cookie: second.headers.get("set-cookie").split(";")[0] } });
  assert.equal(result.headers.get("location"), "/?access=pending#tracker");
});

it("legacy sessions receive a stable CSRF token without invalidation", async (t) => {
  const h = await harness(t);
  h.db.prepare("INSERT INTO sessions (id,whop_user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run("legacy", "user_a", iso(h.now()), iso(h.now() + 60000));
  const a = readSession(h.db, "legacy", iso(h.now()));
  const b = readSession(h.db, "legacy", iso(h.now()));
  assert.equal(a.id, "legacy");
  assert.ok(a.csrf_token.length >= 40);
  assert.equal(a.csrf_token, b.csrf_token);
});

it("OAuth rate limit bounds pending states", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 10; i++) assert.equal((await h.request("/api/auth/whop/start")).status, 302);
  assert.equal((await h.request("/api/auth/whop/start")).status, 429);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM oauth_states").get().n, 10);
});
