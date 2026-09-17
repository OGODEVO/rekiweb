import { it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/index.js";
import { openDatabase } from "../../server/db.js";
import { sendMagicLink } from "../../server/mailer.js";
import { harness, iso, cfg } from "./fixtures.js";
import { nativeOwnerId, normalizeEmail } from "../../server/auth.js";

const start = (h, email) =>
  h.request("/api/auth/magic/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

const linkToken = (entry) =>
  new URL(entry.url.match(/https:[^"<>]+/)[0]).searchParams.get("token");

it("magic start validates email and refuses without a mailer", async (t) => {
  // Raw app without the test mail hook: unconfigured mailer fails closed.
  const db = openDatabase(":memory:");
  const instance = createApp({ db, cfg: { ...cfg } });
  const server = await new Promise((resolve) => {
    const s = instance.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (email) =>
    fetch(base + "/api/auth/magic/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  assert.equal((await post("not-an-email")).status, 400);
  assert.equal((await post("")).status, 400);
  const res = await post("buyer@example.com");
  assert.equal(res.status, 503);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM magic_tokens").get().n, 0);
});

it("mailer posts to Resend and never sends without config", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: "mail_1" }), { status: 200 });
  };
  await sendMagicLink(
    { mailFrom: "Reki <hi@example.com>", resendApiKey: "re_test" },
    { to: "a@b.com", url: "https://x/y" },
    fetchImpl,
  );
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(calls[0].body.to, ["a@b.com"]);
  assert.match(calls[0].body.subject, /Reki Web/);
  let fetched = false;
  await assert.rejects(
    sendMagicLink({}, { to: "a@b.com", url: "https://x/y" }, async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    }),
    /configured/,
  );
  assert.equal(fetched, false);
});

it("magic verify consumes a single-use expiring token and signs in", async (t) => {
  const h = await harness(t);
  const started = await start(h, "Buyer@Example.com");
  assert.equal(started.status, 200);
  assert.deepEqual(await started.json(), { ok: true });
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0].to, "buyer@example.com");
  const token = linkToken(h.mail[0]);
  // Only the hash is stored; the raw token never touches the database.
  const row = h.db.prepare("SELECT * FROM magic_tokens").get();
  assert.notEqual(row.token_hash, token);
  assert.equal(row.email, "buyer@example.com");

  const verified = await h.request(
    `/api/auth/magic/verify?token=${encodeURIComponent(token)}`,
  );
  assert.equal(verified.status, 302);
  assert.match(verified.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const me = await (await h.request("/api/me", { headers: { cookie } })).json();
  assert.equal(me.signedIn, true);
  assert.equal(me.user.email, "buyer@example.com");
  assert.equal(me.user.id, nativeOwnerId("buyer@example.com"));

  // Single use: replay fails. Unknown token fails generically.
  assert.equal(
    (await h.request(`/api/auth/magic/verify?token=${encodeURIComponent(token)}`)).status,
    400,
  );
  assert.equal((await h.request("/api/auth/magic/verify?token=nope")).status, 400);
});

it("magic links expire", async (t) => {
  const h = await harness(t);
  await start(h, "slow@example.com");
  const token = linkToken(h.mail[0]);
  h.advance(16 * 60 * 1000);
  assert.equal(
    (await h.request(`/api/auth/magic/verify?token=${encodeURIComponent(token)}`)).status,
    400,
  );
});

it("magic rate limits bound token issuance", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await start(h, `r${i}@example.com`)).status, 200);
  }
  assert.equal((await start(h, "r10@example.com")).status, 429);
});

it("native login reuses the existing OAuth row by email", async (t) => {
  const h = await harness(t);
  // Existing member arrived via Whop OAuth; webhook backfilled the email.
  h.db
    .prepare(
      "INSERT INTO users (whop_user_id, email, name, created_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run("user_oauth", "member@example.com", "Member", iso(h.now()), iso(h.now()));
  h.db
    .prepare(
      "INSERT INTO entitlements (whop_user_id, membership_id, account_id, product_id, plan_id, granted_at, expires_at, revoked_at, source, payment_id, paid_at, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run("user_oauth", "mem_oauth", "biz_reki", "prod_reki", h.cfg.planId, iso(h.now()), iso(h.now() + 29 * 86400000), null, "webhook", "pay_oauth", iso(h.now()), iso(h.now()));
  await start(h, "member@example.com");
  const token = linkToken(h.mail[0]);
  const verified = await h.request(
    `/api/auth/magic/verify?token=${encodeURIComponent(token)}`,
  );
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const me = await (
    await h.request("/api/me?refresh=1", { headers: { cookie } })
  ).json();
  // Same owner id: entitlements and saved tracker carry over untouched.
  assert.equal(me.user.id, "user_oauth");
  assert.equal(me.user.email, "member@example.com");
  assert.equal(
    h.db.prepare("SELECT COUNT(*) n FROM users WHERE email=?").get("member@example.com").n,
    1,
  );
});

it("webhook links buyer email so native login keeps access", async (t) => {
  const h = await harness(t);
  h.memberships[0].user = { id: "user_a", email: "hook@example.com", name: "Hook" };
  assert.equal((await h.send("membership.activated", "mem_a")).status, 200);
  assert.equal(
    h.db.prepare("SELECT email FROM users WHERE whop_user_id=?").get("user_a")?.email,
    "hook@example.com",
  );
  await start(h, "hook@example.com");
  const token = linkToken(h.mail[0]);
  const verified = await h.request(
    `/api/auth/magic/verify?token=${encodeURIComponent(token)}`,
  );
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const me = await (
    await h.request("/api/me?refresh=1", { headers: { cookie } })
  ).json();
  assert.equal(me.user.id, "user_a");
  assert.equal(me.access.active, true);
});

it("normalizeEmail lowercases and rejects junk", () => {
  assert.equal(normalizeEmail("  Buyer@Example.COM "), "buyer@example.com");
  assert.equal(normalizeEmail("nope"), "");
  assert.equal(normalizeEmail("a@b"), "");
  assert.equal(normalizeEmail("x".repeat(400)), "");
  assert.equal(nativeOwnerId("a@x.com"), nativeOwnerId("a@x.com"));
  assert.ok(nativeOwnerId("a@x.com").startsWith("local:"));
});
