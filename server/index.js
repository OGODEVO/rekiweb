import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, publicConfig, oauthCallbackUrl, authConfigured, billingConfigured, configWarnings } from "./config.js";
import { openDatabase, pruneOAuthStates } from "./db.js";
import { createWhopClient } from "./whop.js";
import { createAccessService } from "./entitlements.js";
import {
  SESSION_COOKIE, OAUTH_COOKIE, authorizeUrl, clearedSessionCookie, createSession, destroySession,
  exchangeCode, parseCookies, readSession, sessionCookie, upsertUser, randomToken, tokenHash, equalToken, oauthCookie,
  normalizeEmail, upsertNativeUser, issueMagicToken, consumeMagicToken,
} from "./auth.js";
import { mailerConfigured, sendMagicLink } from "./mailer.js";
import { enqueueWebhook, processWebhook, retryWebhooks, verifyWebhookSignature } from "./webhooks.js";
import { sanitizeTrackerState, validateTrackerState, storedTrackerState } from "./state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const route = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function createApp({ db, cfg = config, whop, fetchImpl = globalThis.fetch, clock = Date.now, sendMail = null } = {}) {
  const store = db || openDatabase(cfg.databasePath);
  const api = whop || createWhopClient({ apiKey: cfg.apiKey, apiBase: cfg.whopApiBase, versionDate: cfg.apiVersionDate, fetchImpl });
  const mailer = sendMail || ((args) => sendMagicLink(cfg, args));
  const access = createAccessService(store, api, cfg, clock);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  const secure = cfg.publicBaseUrl?.startsWith("https://") || cfg.nodeEnv === "production";
  let origin = "";
  try { origin = new URL(cfg.publicBaseUrl).origin; } catch { /* Configuration remains unavailable. */ }

  // Bounded per-process rates plus a global cap; no request data is logged.
  const buckets = new Map();
  function limit(key, max) {
    const now = clock();
    if (buckets.size >= 10000) for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
    let b = buckets.get(key);
    if (!b || b.until <= now) {
      if (buckets.size >= 10000 && !b) fail(429, "too many requests");
      b = { count: 0, until: now + 60000 }; buckets.set(key, b);
    }
    if (++b.count > max) fail(429, "too many requests");
  }
  app.use("/api", route((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    limit("global", 3000);
    limit(`ip:${req.ip}`, req.path === "/webhooks/whop" ? 600 : 180);
    next();
  }));
  function sessionOf(req, required = true) {
    const s = readSession(store, parseCookies(req.headers.cookie)[SESSION_COOKIE], new Date(clock()).toISOString());
    if (!s && required) fail(401, "sign-in required");
    return s;
  }
  function mutation(req) {
    const s = sessionOf(req);
    if (!origin || req.headers.origin !== origin)
      fail(403, "request verification failed");
    if (req.headers["x-reki-user"] !== s.whop_user_id) fail(409, "account changed; reload before saving");
    if (!equalToken(req.headers["x-csrf-token"], s.csrf_token)) fail(403, "request verification failed");
    limit(`write:${s.whop_user_id}`, 60);
    return s;
  }
  function rereadSession(req, previous) {
    const current = sessionOf(req);
    if (current.id !== previous.id || current.whop_user_id !== previous.whop_user_id) fail(409, "account changed; reload before saving");
    return current;
  }
  function stateFor(userId) {
    const row = store.prepare("SELECT data, revision, updated_at FROM tracker_states WHERE whop_user_id=?").get(userId);
    return row ? { state: storedTrackerState(row.data), revision: row.revision, updatedAt: row.updated_at }
      : { state: null, revision: 0, updatedAt: null };
  }
  const destination = (value) => value.active ? "/?access=active#tracker" : "/?access=pending#tracker";

  app.get("/api/config", (req, res) => res.json(publicConfig(cfg)));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/auth/whop/start", route((req, res) => {
    if (!authConfigured(cfg)) fail(503, "sign-in is not configured");
    limit(`oauth:${req.ip}`, 10);
    const next = req.query.next === "/api/whop/return" ? "/api/whop/return" : "/#tracker";
    const { url, state, nonce, verifier } = authorizeUrl({
      apiBase: cfg.whopApiBase, appId: cfg.appId, redirectUri: oauthCallbackUrl(cfg),
      scope: "openid profile email", accountId: cfg.accountId || undefined,
    });
    const binding = randomToken(), nowIso = new Date(clock()).toISOString();
    pruneOAuthStates(store, nowIso);
    store.prepare(`INSERT INTO oauth_states (state, code_verifier, nonce, next, created_at, browser_hash)
      VALUES (?, ?, ?, ?, ?, ?)`).run(state, verifier, nonce, next, nowIso, tokenHash(binding));
    res.setHeader("Set-Cookie", oauthCookie(binding, secure));
    res.redirect(302, url);
  }));
  app.get("/api/auth/whop/callback", route(async (req, res) => {
    limit(`oauth-callback:${req.ip}`, 20);
    if (!authConfigured(cfg)) fail(503, "sign-in is not configured");
    const { code, state } = req.query;
    if (typeof code !== "string" || !code || code.length > 4096 || typeof state !== "string" || state.length > 128)
      fail(400, "invalid sign-in callback");
    const binding = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    const pending = store.prepare("SELECT * FROM oauth_states WHERE state=?").get(state);
    if (!pending || !binding || !equalToken(pending.browser_hash, tokenHash(binding))) fail(400, "invalid sign-in attempt");
    store.prepare("DELETE FROM oauth_states WHERE state=?").run(state);
    res.setHeader("Set-Cookie", oauthCookie("", secure, true));
    if (Date.parse(pending.created_at) <= clock() - 900000) fail(400, "expired sign-in attempt");
    let info;
    try {
      const tokens = await exchangeCode({ apiBase: cfg.whopApiBase, appId: cfg.appId,
        clientSecret: cfg.clientSecret, redirectUri: oauthCallbackUrl(cfg), code, verifier: pending.code_verifier }, fetchImpl);
      if (typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("Missing token");
      info = await api.userInfo(tokens.access_token);
      if (typeof info?.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(info.sub)) throw new Error("Invalid identity");
    } catch { fail(401, "sign-in failed; please try again"); }
    upsertUser(store, { whopUserId: info.sub, email: typeof info.email === "string" ? info.email.slice(0, 320) : null,
      name: typeof info.name === "string" ? info.name.slice(0, 200) : null, nowIso: new Date(clock()).toISOString() });
    await access.access(info.sub, { refresh: true });
    const previous = sessionOf(req, false);
    if (previous) destroySession(store, previous.id);
    const sid = createSession(store, info.sub, clock());
    res.setHeader("Set-Cookie", [sessionCookie(sid, { secure }), oauthCookie("", secure, true)]);
    res.redirect(302, destination(access.current(info.sub)));
  }));
  // ---- native passwordless auth (email magic link) ----
  app.post("/api/auth/magic/start", express.json({ limit: "4kb" }), route(async (req, res) => {
    limit(`magic-start:${req.ip}`, 10);
    const email = normalizeEmail(req.body?.email);
    if (!email) fail(400, "enter a valid email address");
    limit(`magic-email:${email}`, 5);
    const next = req.body?.next === "/api/whop/return" ? "/api/whop/return" : "/#tracker";
    const token = issueMagicToken(store, { email, next, nowMs: clock(), ttlMin: cfg.magicLinkTtlMin });
    const url = `${cfg.publicBaseUrl}/api/auth/magic/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
    // Generic success shape whether or not the mail goes out: the address
    // itself is never confirmed or denied here.
    try {
      await mailer({ to: email, url });
    } catch {
      // The link can never be delivered; remove it so stale tokens cannot
      // accumulate or be redeemed through another channel.
      store.prepare("DELETE FROM magic_tokens WHERE email = ?").run(email);
      fail(503, "email is unavailable right now; try again later");
    }
    res.json({ ok: true });
  }));

  app.get("/api/auth/magic/verify", route(async (req, res) => {
    limit(`magic-verify:${req.ip}`, 20);
    const code = req.query.token;
    if (typeof code !== "string" || !code || code.length > 512) fail(400, "invalid sign-in link");
    const row = consumeMagicToken(store, code, new Date(clock()).toISOString());
    if (!row) fail(400, "this sign-in link is expired or already used");
    const nowIso = new Date(clock()).toISOString();
    const user = upsertNativeUser(store, { email: row.email, nowIso });
    await access.access(user.whop_user_id, { refresh: true }).catch(() => null);
    const previous = sessionOf(req, false);
    if (previous) destroySession(store, previous.id);
    const sid = createSession(store, user.whop_user_id, clock());
    res.setHeader("Set-Cookie", sessionCookie(sid, { secure }));
    const next = row.next === "/api/whop/return" ? "/api/whop/return" : "/#tracker";
    res.redirect(302, next);
  }));

  app.post("/api/auth/logout", route((req, res) => {
    const s = mutation(req);
    destroySession(store, s.id);
    res.setHeader("Set-Cookie", clearedSessionCookie(secure));
    res.json({ ok: true });
  }));
  app.get("/api/me", route(async (req, res) => {
    const s = sessionOf(req, false);
    if (!s) return res.json({ signedIn: false, access: { active: false } });
    const refresh = req.query.refresh === "1";
    if (refresh) limit(`refresh:${s.whop_user_id}`, 6);
    await access.access(s.whop_user_id, { refresh });
    rereadSession(req, s);
    const user = store.prepare("SELECT email, name FROM users WHERE whop_user_id=?").get(s.whop_user_id);
    res.json({ signedIn: true, user: { id: s.whop_user_id, email: user?.email || null, name: user?.name || null }, csrfToken: s.csrf_token, access: access.current(s.whop_user_id) });
  }));
  app.get("/api/whop/return", route(async (req, res) => {
    const s = sessionOf(req, false);
    if (!s) return res.redirect(302, "/api/auth/whop/start?next=%2Fapi%2Fwhop%2Freturn");
    limit(`refresh:${s.whop_user_id}`, 6);
    await access.access(s.whop_user_id, { refresh: true });
    rereadSession(req, s);
    res.redirect(302, destination(access.current(s.whop_user_id)));
  }));
  app.get("/api/state", route((req, res) => res.json(stateFor(sessionOf(req).whop_user_id))));
  app.get("/api/export", route((req, res) => {
    const state = stateFor(sessionOf(req).whop_user_id);
    res.setHeader("Content-Disposition", 'attachment; filename="reki-data.json"');
    res.json(state);
  }));
  app.put("/api/state", express.json({ limit: "256kb" }), route(async (req, res) => {
    const s = mutation(req);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some((k) => !["state", "revision"].includes(k)) ||
      !Number.isSafeInteger(req.body.revision) || req.body.revision < 0 || req.body.revision >= Number.MAX_SAFE_INTEGER)
      fail(400, "expected state and revision");
    const validation = validateTrackerState(req.body.state);
    if (!validation.ok) fail(400, validation.error);
    await access.access(s.whop_user_id);
    rereadSession(req, s);
    const status = access.current(s.whop_user_id);
    if (status.verificationPending) fail(503, "payment verification unavailable; try again");
    if (!status.active) fail(403, "paid access required");
    // No await between the final access check and the conditional write.
    const nowIso = new Date(clock()).toISOString(), value = JSON.stringify(sanitizeTrackerState(req.body.state));
    const revision = req.body.revision;
    const result = revision === 0
      ? store.prepare(`INSERT INTO tracker_states (whop_user_id, data, updated_at, revision) VALUES (?, ?, ?, 1)
          ON CONFLICT(whop_user_id) DO NOTHING`).run(s.whop_user_id, value, nowIso)
      : store.prepare(`UPDATE tracker_states SET data=?, updated_at=?, revision=revision+1
          WHERE whop_user_id=? AND revision=?`).run(value, nowIso, s.whop_user_id, revision);
    if (!result.changes) fail(409, "state changed; reload before saving");
    res.json({ ok: true, revision: revision + 1, updatedAt: nowIso });
  }));
  app.post("/api/webhooks/whop", express.raw({ type: "application/json", limit: "256kb", inflate: false }), route(async (req, res) => {
    if (!cfg.webhookSecret) fail(503, "webhooks are not configured");
    if (!verifyWebhookSignature(req.body, (name) => req.headers[name], cfg.webhookSecret)) fail(401, "invalid webhook signature");
    if (!billingConfigured(cfg)) fail(503, "billing is not configured");
    let envelope;
    try { envelope = JSON.parse(req.body.toString("utf8")); } catch { fail(400, "invalid webhook payload"); }
    const id = enqueueWebhook(store, envelope, req.headers["webhook-id"], req.body, cfg);
    if (id) await processWebhook(store, api, access, id, cfg);
    res.json({ ok: true });
  }));
  app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 401, 403, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
    if (status === 429) res.setHeader("Retry-After", "60");
    const message = error.type === "entity.parse.failed" ? "invalid JSON" : error.type === "entity.too.large" ? "payload too large"
      : status === 503 ? "service temporarily unavailable; try again" : error.message;
    res.status(status).json({ error: message });
  });
  const dist = join(root, "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(dist, "index.html")));
  }
  return { app, store, access, retryWebhooks: () => retryWebhooks(store, api, access, cfg) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const warnings = configWarnings();
  if (warnings.length) console.warn(`[reki-web] configuration: ${warnings.join("; ")}`);
  const { app, retryWebhooks: retry } = createApp();
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await retry(); } catch { /* Retry on next tick. */ } finally { running = false; } };
  const timer = setInterval(tick, 5000);
  timer.unref();
  void tick();
  app.listen(config.port, config.host, () => console.log(`[reki-web] listening on ${config.host}:${config.port}`));
}
