import { createHmac } from "node:crypto";
import { createApp } from "../../server/index.js";
import { openDatabase } from "../../server/db.js";
import { createSession, upsertUser } from "../../server/auth.js";
import { PAID_PLAN_ID } from "../../server/config.js";

export const DAY = 86400000;
export const cfg = {
  nodeEnv: "test", publicBaseUrl: "https://reki.example", whopApiBase: "https://api.whop.com",
  apiVersionDate: "2026-09-15", apiKey: "test-only", webhookSecret: "ws_local_fixture_only_0123456789",
  appId: "app_fixture", clientSecret: "", accountId: "biz_reki", productId: "prod_reki", planId: PAID_PLAN_ID,
  checkoutUrl: "https://whop.com/checkout/ch_mMNbh5gIMIjL09n/", databasePath: ":memory:",
};
export const iso = (ms) => new Date(ms).toISOString();
export function membership(now, overrides = {}) {
  return { id: "mem_a", user_id: "user_a", product_id: cfg.productId, plan_id: cfg.planId,
    account: { id: cfg.accountId }, status: "active", created_at: iso(now - 365 * DAY),
    current_period_end: iso(now + 29 * DAY), cancel_at_period_end: false, ...overrides };
}
export function payment(now, m = membership(now), overrides = {}) {
  return { id: "pay_a", membership: { id: m.id }, user: { id: m.user_id }, company: { id: cfg.accountId },
    product: { id: m.product_id }, plan: { id: m.plan_id }, status: "paid", substatus: "succeeded",
    currency: "usd", subtotal: 15, total: 15, billing_reason: "subscription_cycle", auto_refunded: false,
    refunded_amount: 0, refunded_at: null, created_at: iso(now - DAY), paid_at: iso(now - DAY + 1000), ...overrides };
}
export const tracker = (name = "Vitamin D") => ({
  demo: false, supplements: [{ id: "a", name, detail: "1 capsule", time: "Morning", color: "peach" }],
  days: { "2026-09-16": { taken: ["a"], checkin: { energy: 3, mood: 4, sleep: 5 } } },
  preferences: { tourCompleted: true },
});
export function signed(body, id, secret = cfg.webhookSecret, ts = Math.floor(Date.now() / 1000)) {
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts),
    "webhook-signature": `v1,${createHmac("sha256", secret).update(`${id}.${ts}.`).update(body).digest("base64")}` };
}
export async function harness(t, overrides = {}) {
  let now = Date.now();
  const db = openDatabase(":memory:");
  const config = { ...cfg, ...overrides };
  const memberships = [membership(now)], payments = [payment(now)], refunds = [];
  const calls = { memberships: 0, payments: 0, tokens: [] };
  const api = {
    async listMemberships() { calls.memberships++; return structuredClone(memberships); },
    async listPayments() { calls.payments++; return structuredClone(payments); },
    async retrieveMembership(id) { const m = memberships.find((v) => v.id === id); if (!m) throw new Error("not found"); return structuredClone(m); },
    async retrievePayment(id) { const p = payments.find((v) => v.id === id); if (!p) throw new Error("not found"); return structuredClone(p); },
    async retrieveRefund(id) { const r = refunds.find((v) => v.id === id); if (!r) throw new Error("not found"); return structuredClone(r); },
    async userInfo() { return { sub: "user_a", name: "A" }; },
  };
  const fetchImpl = async (url, options) => {
    if (String(url) !== "https://api.whop.com/oauth/token") throw new Error("Unexpected external request");
    calls.tokens.push({ url, ...options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ access_token: "test-access-token" }));
  };
  const mail = [];
  const sendMail = async (args) => { mail.push(args); };
  const instance = createApp({ db, cfg: config, whop: api, fetchImpl, clock: () => now, sendMail });
  const server = await new Promise((resolve) => { const s = instance.app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((r) => server.close(r)); db.close(); });
  const request = (path, options = {}) => fetch(base + path, { redirect: "manual", ...options });
  const auth = (userId = "user_a") => {
    upsertUser(db, { whopUserId: userId, name: userId, nowIso: iso(now) });
    const sid = createSession(db, userId, now);
    const csrf = db.prepare("SELECT csrf_token FROM sessions WHERE id=?").get(sid).csrf_token;
    return { cookie: `reki_session=${sid}`, origin: config.publicBaseUrl,
      "x-csrf-token": csrf, "x-reki-user": userId, "content-type": "application/json" };
  };
  const send = (type, resourceId, id = "msg_event", changes = {}) => {
    const body = JSON.stringify({ id, type, timestamp: iso(now), api_version: "v1",
      api_version_date: config.apiVersionDate, account_id: config.accountId, data: { id: resourceId }, ...changes });
    return request("/api/webhooks/whop", { method: "POST", body, headers: signed(body, id, config.webhookSecret) });
  };
  return { ...instance, db, cfg: config, api, calls, mail, memberships, payments, refunds, request, auth, send,
    now: () => now, advance: (ms) => { now += ms; } };
}
