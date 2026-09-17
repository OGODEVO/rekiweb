import { it } from "node:test";
import assert from "node:assert/strict";
import { harness, tracker, membership, payment, DAY, iso } from "./fixtures.js";

const write = (h, headers, state = tracker(), revision = 0) => h.request("/api/state", {
  method: "PUT", headers, body: JSON.stringify({ state, revision }),
});

it("exposes the $4.99 recurring contract without credentials", async (t) => {
  const h = await harness(t);
  const result = await (await h.request("/api/config")).json();
  assert.deepEqual(result, { checkoutConfigured: true, checkoutUrl: h.cfg.checkoutUrl,
    authConfigured: true, billing: { price: 4.99, currency: "USD", intervalDays: 30 }, productTitle: "Reki Web" });
  assert.deepEqual(await (await h.request("/api/me")).json(), { signedIn: false, access: { active: false } });
});

it("paid sessions get identity, CSRF, revisions, and export; URL flags never grant", async (t) => {
  const h = await harness(t), headers = h.auth();
  const res = await h.request("/api/me", { headers });
  const me = await res.json();
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(me.user, { id: "user_a", email: null, name: "user_a" });
  assert.equal(me.csrfToken, headers["x-csrf-token"]);
  assert.equal(me.access.active, true);
  assert.equal(me.access.expiresAt, h.memberships[0].current_period_end);
  assert.deepEqual(await (await h.request("/api/state", { headers })).json(), { state: null, revision: 0, updatedAt: null });
  const saved = await (await write(h, headers)).json();
  assert.equal(saved.revision, 1);
  const stored = await (await h.request("/api/state", { headers })).json();
  assert.deepEqual(stored.state, tracker());
  const exported = await h.request("/api/export", { headers });
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  assert.deepEqual(await exported.json(), stored);
  assert.equal((await h.request("/api/state?access=active")).status, 401);
});

it("expired/unpaid users retain authenticated reads/export but cannot write", async (t) => {
  const h = await harness(t), headers = h.auth();
  assert.equal((await write(h, headers)).status, 200);
  h.advance(31 * DAY);
  // Existing session has expired too; a fresh sign-in still owns the old data.
  const again = h.auth();
  const me = await (await h.request("/api/me?refresh=1", { headers: again })).json();
  assert.equal(me.access.active, false);
  assert.equal(me.access.status, "expired");
  assert.equal((await write(h, again, tracker(), 1)).status, 403);
  assert.equal((await h.request("/api/export", { headers: again })).status, 200);
  assert.deepEqual((await (await h.request("/api/state", { headers: again })).json()).state, tracker());
  assert.equal((await h.request("/api/whop/return", { headers: again })).headers.get("location"), "/?access=pending#tracker");
});

it("cookie decoding never crashes and duplicated session cookies fail closed", async (t) => {
  const h = await harness(t), headers = h.auth();
  for (const cookie of ["unrelated=%", "reki_session=%ZZ", `${headers.cookie}; ${headers.cookie}`]) {
    const response = await h.request("/api/me", { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).signedIn, false);
  }
  assert.equal((await h.request("/api/health")).status, 200);
});

it("CSRF, Origin and exact user identity guard state writes and logout", async (t) => {
  const h = await harness(t), headers = h.auth();
  for (const [key, value, expected] of [["x-csrf-token", "wrong", 403], ["origin", "https://evil.example", 403],
    ["origin", "", 403], ["x-reki-user", "user_other", 409], ["x-reki-user", "", 409]]) {
    const bad = { ...headers, [key]: value };
    assert.equal((await write(h, bad)).status, expected);
    assert.equal((await h.request("/api/auth/logout", { method: "POST", headers: bad })).status, expected);
  }
  assert.equal((await h.request("/api/auth/logout", { method: "POST", headers })).status, 200);
  assert.equal((await write(h, headers)).status, 401);
});

it("optimistic revisions reject parallel initial inserts and stale updates", async (t) => {
  const h = await harness(t), headers = h.auth();
  await h.request("/api/me", { headers });
  assert.deepEqual((await Promise.all([write(h, headers), write(h, headers)])).map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual((await Promise.all([write(h, headers, tracker("A"), 1), write(h, headers, tracker("B"), 1)])).map((r) => r.status).sort(), [200, 409]);
  assert.equal((await (await h.request("/api/state", { headers })).json()).revision, 2);
  assert.equal((await write(h, headers, tracker(), 0)).status, 409);
});

it("two accounts cannot read or overwrite each other; switched tabs receive 409", async (t) => {
  const h = await harness(t), a = h.auth(), b = h.auth("user_b");
  const m = membership(h.now(), { id: "mem_b", user_id: "user_b" });
  h.memberships.push(m); h.payments.push(payment(h.now(), m, { id: "pay_b" }));
  assert.equal((await write(h, a, tracker("A"))).status, 200);
  assert.equal((await write(h, b, tracker("B"))).status, 200);
  const readA = await (await h.request("/api/state?user_id=user_b", { headers: a })).json();
  const readB = await (await h.request("/api/state?user_id=user_a", { headers: b })).json();
  assert.equal(readA.state.supplements[0].name, "A");
  assert.equal(readB.state.supplements[0].name, "B");
  assert.equal((await write(h, { ...b, "x-reki-user": "user_a" }, tracker(), 1)).status, 409);
  assert.equal((await write(h, { ...a, cookie: b.cookie }, tracker(), 1)).status, 409);
  assert.equal((await write(h, b, { ...tracker(), user_id: "user_a" }, 1)).status, 400);
});

it("refresh is cached for one minute, explicit refresh reconciles loss, failures deny writes but retain data", async (t) => {
  const h = await harness(t), headers = h.auth();
  assert.equal((await write(h, headers)).status, 200);
  await h.request("/api/me", { headers });
  assert.equal(h.calls.memberships, 1);
  await h.request("/api/me?refresh=1", { headers });
  assert.equal(h.calls.memberships, 2);
  h.advance(60001);
  await h.request("/api/me", { headers });
  assert.equal(h.calls.memberships, 3);
  const original = h.api.listMemberships;
  h.api.listMemberships = async () => { throw new Error("secret-provider-error-must-not-leak"); };
  const pending = await (await h.request("/api/me?refresh=1", { headers })).json();
  assert.equal(pending.access.active, false);
  assert.equal(pending.access.verificationPending, true);
  const denied = await write(h, headers, tracker(), 1);
  assert.equal(denied.status, 503);
  assert.doesNotMatch(await denied.text(), /secret-provider/);
  assert.equal((await (await h.request("/api/state", { headers })).json()).revision, 1);
  h.api.listMemberships = original;
  h.memberships.length = 0;
  assert.equal((await (await h.request("/api/me?refresh=1", { headers })).json()).access.active, false);
  assert.equal((await write(h, headers, tracker(), 1)).status, 403);
});

it("legacy stored state gains preferences on read without rewriting history", async (t) => {
  const h = await harness(t), headers = h.auth();
  const old = tracker(); delete old.preferences;
  old.days["2026-09-16"].taken = ["deleted"];
  h.db.prepare("INSERT INTO tracker_states (whop_user_id,data,updated_at) VALUES (?,?,?)").run("user_a", JSON.stringify(old), iso(h.now()));
  const read = await (await h.request("/api/state", { headers })).json();
  assert.equal(read.revision, 1);
  assert.deepEqual(read.state.preferences, { tourCompleted: false });
  assert.deepEqual(read.state.days["2026-09-16"].taken, ["deleted"]);
  assert.equal((await write(h, headers, read.state, 1)).status, 200);
});

it("JSON failures, old PUT bodies, and oversized payloads return JSON errors", async (t) => {
  const h = await harness(t), headers = h.auth();
  for (const [body, expected] of [["{", 400], [JSON.stringify(tracker()), 400], [JSON.stringify({ value: "x".repeat(270000) }), 413]]) {
    const result = await h.request("/api/state", { method: "PUT", headers, body });
    assert.equal(result.status, expected);
    assert.equal(typeof (await result.json()).error, "string");
  }
});

it("logout during provider verification prevents a pending write", async (t) => {
  const h = await harness(t), headers = h.auth();
  let release, entered;
  const began = new Promise((r) => { entered = r; });
  h.api.listMemberships = async () => { entered(); await new Promise((r) => { release = r; }); return h.memberships; };
  const pending = write(h, headers);
  await began;
  assert.equal((await h.request("/api/auth/logout", { method: "POST", headers })).status, 200);
  release();
  assert.equal((await pending).status, 401);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM tracker_states").get().n, 0);
});

it("explicit provider refreshes are rate limited", async (t) => {
  const h = await harness(t), headers = h.auth();
  for (let i = 0; i < 6; i++) assert.equal((await h.request("/api/me?refresh=1", { headers })).status, 200);
  const limited = await h.request("/api/me?refresh=1", { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});
