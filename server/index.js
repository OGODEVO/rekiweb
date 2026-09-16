// Reki Web paid-access server: Whop OAuth sign-in, server-verified 30-day
// entitlements, signed webhooks, account-backed tracker state.
// Serves the built frontend (dist/) in production alongside /api.

import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  config,
  publicConfig,
  returnUrl,
  webhookUrl,
  oauthCallbackUrl,
  configWarnings,
} from "./config.js";
import { openDatabase, pruneOAuthStates } from "./db.js";
import { createWhopClient } from "./whop.js";
import {
  activeEntitlement,
  grantFromMembership,
  pickQualifyingMembership,
} from "./entitlements.js";
import {
  SESSION_COOKIE,
  authorizeUrl,
  clearedSessionCookie,
  createSession,
  destroySession,
  exchangeCode,
  parseCookies,
  readSession,
  sessionCookie,
  upsertUser,
} from "./auth.js";
import { handleWebhookEvent, verifyWebhookSignature } from "./webhooks.js";
import { sanitizeTrackerState, validateTrackerState } from "./state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function createApp({ db, cfg = config, whop = null } = {}) {
  const store = db || openDatabase(cfg.databasePath);
  const api =
    whop ||
    createWhopClient({
      apiKey: cfg.apiKey,
      apiBase: cfg.whopApiBase,
      versionDate: cfg.apiVersionDate,
    });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const secureCookies =
    cfg.publicBaseUrl.startsWith("https://") || cfg.nodeEnv === "production";

  function sessionOf(req) {
    return readSession(
      store,
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      new Date().toISOString(),
    );
  }

  async function refreshFromWhop(whopUserId) {
    // Source of truth for purchase: Whop memberships, never the browser.
    if (!cfg.apiKey || !whopUserId) return null;
    try {
      const list = await api.listMemberships({
        userId: whopUserId,
        accountId: cfg.accountId || undefined,
        productId: cfg.productId || undefined,
        planId: cfg.planId || undefined,
      });
      const m = pickQualifyingMembership(list, {
        productId: cfg.productId || undefined,
        planId: cfg.planId || undefined,
      });
      if (!m) return null;
      return grantFromMembership(store, m, {
        durationDays: cfg.accessDurationDays,
        source: "api:verify",
        nowIso: new Date().toISOString(),
      });
    } catch {
      return activeEntitlement(store, whopUserId, new Date().toISOString());
    }
  }

  async function accessFor(whopUserId, { refresh = false } = {}) {
    const nowIso = new Date().toISOString();
    let ent = activeEntitlement(store, whopUserId, nowIso);
    if (!ent && refresh) ent = await refreshFromWhop(whopUserId);
    if (!ent) return { active: false, expiresAt: null };
    return { active: true, expiresAt: ent.expires_at };
  }

  // ---- public config (no secrets) ----
  app.get("/api/config", (req, res) => {
    res.json(publicConfig(cfg));
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // ---- OAuth sign-in ----
  app.get("/api/auth/whop/start", (req, res) => {
    if (!cfg.appId || !cfg.publicBaseUrl)
      return res.status(503).json({ error: "sign-in is not configured" });
    const next =
      typeof req.query.next === "string" && req.query.next.startsWith("/")
        ? req.query.next
        : "/#tracker";
    const { url, state, nonce, verifier } = authorizeUrl({
      apiBase: cfg.whopApiBase,
      appId: cfg.appId,
      redirectUri: oauthCallbackUrl(),
      scope: "openid profile email",
      accountId: cfg.accountId || undefined,
    });
    pruneOAuthStates(store, new Date().toISOString());
    store
      .prepare(
        "INSERT INTO oauth_states (state, code_verifier, nonce, next, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(state, verifier, nonce, next, new Date().toISOString());
    res.redirect(302, url);
  });

  app.get("/api/auth/whop/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (typeof code !== "string" || typeof state !== "string")
        return res.status(400).send("Invalid callback");
      const pending = store
        .prepare("SELECT * FROM oauth_states WHERE state = ?")
        .get(state);
      if (!pending) return res.status(400).send("Expired sign-in attempt");
      store.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
      if (Date.parse(pending.created_at) < Date.now() - 15 * 60 * 1000)
        return res.status(400).send("Expired sign-in attempt");
      const tokens = await exchangeCode({
        apiBase: cfg.whopApiBase,
        appId: cfg.appId,
        clientSecret: cfg.clientSecret || undefined,
        redirectUri: oauthCallbackUrl(),
        code,
        verifier: pending.code_verifier,
      });
      if (!tokens?.access_token) throw new Error("No access token");
      const info = await api.userInfo(tokens.access_token);
      const whopUserId = info?.sub;
      if (typeof whopUserId !== "string" || !whopUserId.startsWith("user_"))
        throw new Error("Bad userinfo");
      const nowIso = new Date().toISOString();
      upsertUser(store, {
        whopUserId,
        email: info.email,
        name: info.name || info.preferred_username,
        nowIso,
      });
      await refreshFromWhop(whopUserId).catch(() => null);
      const sid = createSession(store, whopUserId);
      res.setHeader(
        "Set-Cookie",
        sessionCookie(sid, { secure: secureCookies }),
      );
      res.redirect(302, pending.next || "/#tracker");
    } catch {
      res.status(401).send("Sign-in failed. Please try again.");
    }
  });

  app.post("/api/auth/logout", express.json(), (req, res) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sid) destroySession(store, sid);
    res.setHeader("Set-Cookie", clearedSessionCookie());
    res.json({ ok: true });
  });

  // ---- session + access ----
  app.get("/api/me", async (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.json({ signedIn: false, access: { active: false } });
    const access = await accessFor(s.whop_user_id, {
      refresh: req.query.refresh === "1",
    });
    res.json({
      signedIn: true,
      access,
    });
  });

  // ---- checkout return (public HTTPS; NOT proof of payment) ----
  app.get("/api/whop/return", async (req, res) => {
    const s = sessionOf(req);
    if (!s)
      return res.redirect(
        302,
        `/api/auth/whop/start?next=${encodeURIComponent("/api/whop/return")}`,
      );
    const ent = await refreshFromWhop(s.whop_user_id);
    res.redirect(
      302,
      ent ? "/?access=active#tracker" : "/?access=pending#tracker",
    );
  });

  // ---- account-backed tracker state (paid access only) ----
  app.get("/api/state", async (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: "sign-in required" });
    const access = await accessFor(s.whop_user_id);
    if (!access.active)
      return res.status(403).json({ error: "paid access required" });
    const row = store
      .prepare(
        "SELECT data, updated_at FROM tracker_states WHERE whop_user_id = ?",
      )
      .get(s.whop_user_id);
    if (!row) return res.json({ state: null });
    res.json({ state: JSON.parse(row.data), updatedAt: row.updated_at });
  });

  app.put("/api/state", express.json({ limit: "256kb" }), async (req, res) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: "sign-in required" });
    const access = await accessFor(s.whop_user_id);
    if (!access.active)
      return res.status(403).json({ error: "paid access required" });
    const v = validateTrackerState(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const clean = sanitizeTrackerState(req.body);
    const nowIso = new Date().toISOString();
    store
      .prepare(
        `INSERT INTO tracker_states (whop_user_id, data, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT (whop_user_id) DO UPDATE SET data = ?, updated_at = ?`,
      )
      .run(
        s.whop_user_id,
        JSON.stringify(clean),
        nowIso,
        JSON.stringify(clean),
        nowIso,
      );
    res.json({ ok: true, updatedAt: nowIso });
  });

  // ---- webhooks (raw body; signature required) ----
  app.post(
    "/api/webhooks/whop",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      const get = (n) => req.headers[n] || req.headers[n.toLowerCase()];
      const ok = verifyWebhookSignature(req.body, get, cfg.webhookSecret);
      if (!ok) return res.status(401).send("bad signature");
      let envelope;
      try {
        envelope = JSON.parse(Buffer.from(req.body).toString("utf8"));
      } catch {
        return res.status(400).send("bad payload");
      }
      try {
        await handleWebhookEvent(
          store,
          api,
          {
            type: envelope.type,
            data: envelope.data,
            webhookId: envelope.id,
          },
          {
            durationDays: cfg.accessDurationDays,
            accountId: cfg.accountId,
            productId: cfg.productId,
            planId: cfg.planId,
          },
        );
      } catch {
        // Verified but fulfillment failed: acknowledge to stop retries
        // racing, fulfillment reconciles on next verify/webhook.
      }
      res.status(200).send("OK");
    },
  );

  // ---- static frontend (production) ----
  const dist = join(root, "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(join(dist, "index.html"));
    });
  }

  return { app, store };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const warnings = configWarnings();
  if (warnings.length && config.nodeEnv === "production") {
    console.warn(`[reki-web] missing config: ${warnings.join("; ")}`);
  }
  const { app } = createApp();
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`[reki-web] listening on :${config.port}`);
    console.log(`[reki-web] return: ${returnUrl() || "(set PUBLIC_BASE_URL)"}`);
    console.log(
      `[reki-web] webhook: ${webhookUrl() || "(set PUBLIC_BASE_URL)"}`,
    );
  });
}
