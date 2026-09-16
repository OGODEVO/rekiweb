// API integration tests with in-memory DB and stubbed Whop client.
// No network, no secrets.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp } from "../../server/index.js";
import { openDatabase } from "../../server/db.js";

const SECRET = "ws_test_secret_0123456789abcdef";

function stubWhop() {
  return {
    async checkAccess() {
      return { has_access: true, access_level: "customer" };
    },
    async listMemberships() {
      return [];
    },
    async retrieveMembership(id) {
      return {
        id,
        user_id: "user_test",
        product_id: "prod_test",
        plan_id: "plan_test",
        status: "active",
        created_at: new Date().toISOString(),
        current_period_end: null,
      };
    },
    async retrievePayment(id) {
      return { id, membership_id: "mem_test" };
    },
    async userInfo() {
      return { sub: "user_test" };
    },
  };
}

const cfg = {
  port: 0,
  nodeEnv: "test",
  publicBaseUrl: "https://example.com",
  whopApiBase: "https://api.whop.com",
  apiVersionDate: "2026-09-15",
  apiKey: "",
  webhookSecret: SECRET,
  appId: "app_test",
  clientSecret: "",
  accountId: "biz_test",
  productId: "prod_test",
  planId: "plan_test",
  checkoutUrl: "https://whop.com/checkout/test",
  accessDurationDays: 30,
  sessionSecret: "test-session-secret-0123456789",
  databasePath: ":memory:",
};

let base;
let server;
let db;

function sign(id, ts, body) {
  const sig = createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${id}.${ts}.${body}`, "utf8")
    .digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": `v1,${sig}`,
    "content-type": "application/json",
  };
}

before(async () => {
  db = openDatabase(":memory:");
  const { app } = createApp({ db, cfg, whop: stubWhop() });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("paid-access API", () => {
  it("exposes public config without secrets", async () => {
    const res = await fetch(`${base}/api/config`);
    const body = await res.json();
    assert.equal(body.checkoutConfigured, true);
    assert.equal(body.accessDurationDays, 30);
    assert.ok(!("apiKey" in body) && !("webhookSecret" in body));
  });

  it("gates state behind sign-in and paid access", async () => {
    let res = await fetch(`${base}/api/state`);
    assert.equal(res.status, 401);
    // Signed in but unpaid.
    db.prepare(
      "INSERT INTO sessions (id, whop_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      "sess_unpaid",
      "user_unpaid",
      new Date().toISOString(),
      "2030-01-01T00:00:00.000Z",
    );
    res = await fetch(`${base}/api/state`, {
      headers: { cookie: "reki_session=sess_unpaid" },
    });
    assert.equal(res.status, 403);
  });

  it("grants 30 days on payment.succeeded and stores state", async () => {
    const envelope = {
      id: "msg_pay_1",
      type: "payment.succeeded",
      data: { id: "pay_1", membership_id: "mem_test", user_id: "user_test" },
    };
    const body = JSON.stringify(envelope);
    const ts = Math.floor(Date.now() / 1000);
    const headers = { ...sign("msg_pay_1", ts, body) };
    let res = await fetch(`${base}/api/webhooks/whop`, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(res.status, 200);
    // Duplicate delivery is idempotent.
    res = await fetch(`${base}/api/webhooks/whop`, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(res.status, 200);
    db.prepare(
      "INSERT INTO sessions (id, whop_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      "sess_paid",
      "user_test",
      new Date().toISOString(),
      "2030-01-01T00:00:00.000Z",
    );
    const cookie = "reki_session=sess_paid";
    res = await fetch(`${base}/api/me`, { headers: { cookie } });
    assert.equal((await res.json()).access.active, true);
    const state = {
      supplements: [
        { id: "a", name: "D3", detail: "1", time: "Morning", color: "peach" },
      ],
      days: {},
    };
    res = await fetch(`${base}/api/state`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/api/state`, { headers: { cookie } });
    assert.deepEqual((await res.json()).state.supplements, state.supplements);
  });

  it("ends access on membership.deactivated and refund", async () => {
    const ts = Math.floor(Date.now() / 1000);
    for (const [id, type, data] of [
      ["msg_deact", "membership.deactivated", { id: "mem_test" }],
      [
        "msg_ref",
        "refund.updated",
        { id: "re_1", status: "succeeded", payment_id: "pay_1" },
      ],
    ]) {
      const body = JSON.stringify({ id, type, data });
      const res = await fetch(`${base}/api/webhooks/whop`, {
        method: "POST",
        headers: sign(id, ts, body),
        body,
      });
      assert.equal(res.status, 200);
    }
    const res = await fetch(`${base}/api/me`, {
      headers: { cookie: "reki_session=sess_paid" },
    });
    assert.equal((await res.json()).access.active, false);
  });

  it("rejects unsigned webhooks", async () => {
    const res = await fetch(`${base}/api/webhooks/whop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", type: "payment.succeeded", data: {} }),
    });
    assert.equal(res.status, 401);
  });
});
