// Reki Web server configuration. Secrets come from the environment only.
// Never log secret values. Non-secret IDs/URLs may be returned to clients.

function asInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trimSlash(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: asInt(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV || "development",
  publicBaseUrl: trimSlash(process.env.PUBLIC_BASE_URL || ""),
  whopApiBase: trimSlash(process.env.WHOP_API_BASE || "https://api.whop.com"),
  apiVersionDate: process.env.WHOP_API_VERSION_DATE || "2026-09-15",
  apiKey: process.env.WHOP_API_KEY || "",
  webhookSecret: process.env.WHOP_WEBHOOK_SECRET || "",
  appId: process.env.WHOP_APP_ID || "",
  clientSecret: process.env.WHOP_CLIENT_SECRET || "",
  accountId: process.env.WHOP_ACCOUNT_ID || "",
  productId: process.env.WHOP_PRODUCT_ID || "",
  planId: process.env.WHOP_PLAN_ID || "plan_ntTuSfZpGhMJu",
  checkoutUrl: (process.env.WHOP_CHECKOUT_URL || "").trim(),
  databasePath: process.env.DATABASE_PATH || "./data/reki-web.sqlite",
};

export const BILLING = Object.freeze({ price: 15, currency: "USD", intervalDays: 30 });
export const PAID_PLAN_ID = "plan_ntTuSfZpGhMJu";

export function authConfigured(c) {
  try {
    const u = new URL(c.publicBaseUrl);
    return Boolean(c.appId && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash &&
      (u.protocol === "https:" || (c.nodeEnv !== "production" &&
        u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))));
  } catch { return false; }
}

export function billingConfigured(c) {
  return Boolean(c.apiKey && c.accountId && c.productId && c.planId === PAID_PLAN_ID && c.apiVersionDate === "2026-09-15");
}

// Safe subset exposed to the browser. No secrets here.
export function publicConfig(c = config) {
  let checkoutUrl = "";
  try {
    const u = new URL(c.checkoutUrl);
    if (billingConfigured(c) && u.protocol === "https:" && !u.username && !u.password &&
      !u.port && ["whop.com", "www.whop.com"].includes(u.hostname) &&
      u.pathname === "/checkout/ch_mMNbh5gIMIjL09n/" && !u.search && !u.hash)
      checkoutUrl = u.href;
  } catch { /* Unconfigured checkout remains private. */ }
  return {
    checkoutConfigured: checkoutUrl !== "",
    checkoutUrl,
    authConfigured: authConfigured(c),
    billing: BILLING,
    productTitle: "Reki Web",
  };
}

export function returnUrl(c = config) {
  return c.publicBaseUrl ? `${c.publicBaseUrl}/api/whop/return` : "";
}

export function webhookUrl(c = config) {
  return c.publicBaseUrl
    ? `${c.publicBaseUrl}/api/webhooks/whop`
    : "";
}

export function oauthCallbackUrl(c = config) {
  return c.publicBaseUrl
    ? `${c.publicBaseUrl}/api/auth/whop/callback`
    : "";
}

export function configWarnings() {
  const warnings = [];
  if (!config.publicBaseUrl) warnings.push("PUBLIC_BASE_URL is not set");
  else if (!config.publicBaseUrl.startsWith("https://"))
    warnings.push("PUBLIC_BASE_URL must be a public https:// URL");
  if (!config.apiKey) warnings.push("WHOP_API_KEY is not set");
  if (!config.webhookSecret) warnings.push("WHOP_WEBHOOK_SECRET is not set");
  if (!config.appId) warnings.push("WHOP_APP_ID is not set");
  if (!config.productId) warnings.push("WHOP_PRODUCT_ID is not set");
  if (!config.accountId) warnings.push("WHOP_ACCOUNT_ID is not set");
  if (config.planId !== PAID_PLAN_ID) warnings.push("WHOP_PLAN_ID is not the recurring Reki plan");
  if (config.apiVersionDate !== "2026-09-15") warnings.push("WHOP_API_VERSION_DATE must be 2026-09-15");
  if (!config.checkoutUrl) warnings.push("WHOP_CHECKOUT_URL is not set");
  return warnings;
}
