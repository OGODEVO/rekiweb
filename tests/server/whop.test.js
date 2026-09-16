import { it } from "node:test";
import assert from "node:assert/strict";
import { createWhopClient, fetchJson } from "../../server/whop.js";
import { authConfigured, publicConfig, PAID_PLAN_ID } from "../../server/config.js";
import { cfg } from "./fixtures.js";

const response = (data, next = null) => new Response(JSON.stringify({ data,
  page_info: { has_next_page: next !== null, end_cursor: next, start_cursor: null, has_previous_page: false } }));

it("membership and payment pages are fully fetched with documented filters and version pin", async () => {
  const calls = [];
  const api = createWhopClient({ apiKey: "test-key", apiBase: cfg.whopApiBase, versionDate: cfg.apiVersionDate,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new URL(url).searchParams.has("after") ? response([{ id: "second" }]) : response([{ id: "first" }], "cursor2");
    } });
  const query = { userId: "user_a", accountId: cfg.accountId, productId: cfg.productId, planId: cfg.planId };
  assert.deepEqual(await api.listMemberships(query), [{ id: "first" }, { id: "second" }]);
  assert.equal(calls[0].url.pathname, "/api/v1/memberships");
  for (const [key, value] of Object.entries({ user_id: "user_a", account_id: cfg.accountId, product_id: cfg.productId, plan_id: cfg.planId }))
    assert.equal(calls[0].url.searchParams.get(key), value);
  assert.equal(calls[1].url.searchParams.get("after"), "cursor2");
  assert.equal(calls[0].options.headers["Api-Version-Date"], "2026-09-15");
  assert.equal(calls[0].options.redirect, "error");
  await api.listPayments(query);
  assert.equal(calls[2].url.pathname, "/api/v1/payments");
  assert.equal(calls[2].url.searchParams.get("query"), "user_a");
  assert.equal(calls[2].url.searchParams.get("plan_ids"), cfg.planId);
  assert.equal(calls[2].url.searchParams.get("product_ids"), cfg.productId);
  assert.equal(calls[2].url.searchParams.get("account_id"), cfg.accountId);
});

it("pagination loops, malformed responses, and excessive pages fail closed", async () => {
  for (const reply of [() => response([], "same"), () => new Response("{}"), () => new Response("null"), () => new Response("invalid")]) {
    const api = createWhopClient({ apiBase: cfg.whopApiBase, fetchImpl: async () => reply() });
    await assert.rejects(api.listMemberships({}));
  }
  let calls = 0;
  const api = createWhopClient({ apiBase: cfg.whopApiBase, fetchImpl: async () => response([], String(++calls)) });
  await assert.rejects(api.listPayments({}), /pagination limit/);
  assert.equal(calls, 20);
});

it("provider timeouts abort requests and provider error details never propagate", async () => {
  await assert.rejects(fetchJson("https://provider.invalid", {}, async () => new Response("secret error body", { status: 403 })),
    (error) => error.message === "Provider request failed" && !error.body);
  let signal;
  await assert.rejects(fetchJson("https://provider.invalid", {}, async (url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("{}")), 1000);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }, 10));
  assert.equal(signal.aborted, true);
});

it("resource IDs cannot inject paths, and userinfo only receives its own token", async () => {
  const calls = [];
  const api = createWhopClient({ apiBase: cfg.whopApiBase, apiKey: "server-key", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options }); return new Response('{"sub":"user_a"}');
  } });
  assert.throws(() => api.retrievePayment("pay_x/../../users"), /Invalid resource ID/);
  await api.userInfo("oauth-token");
  assert.equal(calls[0].url, "https://api.whop.com/oauth/userinfo");
  assert.deepEqual(calls[0].options.headers, { Authorization: "Bearer oauth-token" });
});

it("checkout stays hidden without explicit safe new-offer configuration", () => {
  for (const checkoutUrl of ["", "http://whop.com/checkout/ch_mMNbh5gIMIjL09n/", "https://whop.com.evil.test/checkout/ch_mMNbh5gIMIjL09n/",
    "https://evil.test/", "https://user:pass@whop.com/checkout/ch_mMNbh5gIMIjL09n/", "https://whop.com:444/checkout/ch_mMNbh5gIMIjL09n/",
    "https://whop.com/checkout/old/", `${cfg.checkoutUrl}?redirect=https://evil.test`]) {
    const value = publicConfig({ ...cfg, checkoutUrl });
    assert.equal(value.checkoutUrl, ""); assert.equal(value.checkoutConfigured, false);
  }
  assert.equal(publicConfig({ ...cfg, planId: "plan_old" }).checkoutConfigured, false);
  assert.equal(publicConfig({ ...cfg, apiKey: "" }).checkoutConfigured, false);
  assert.equal(publicConfig({ ...cfg, planId: PAID_PLAN_ID }).checkoutConfigured, true);
  assert.equal(authConfigured({ ...cfg, nodeEnv: "production", publicBaseUrl: "http://reki.example" }), false);
  assert.equal(authConfigured({ ...cfg, publicBaseUrl: "https://reki.example/path" }), false);
  assert.equal(authConfigured({ ...cfg, publicBaseUrl: "http://127.0.0.1:3001" }), true);
});
