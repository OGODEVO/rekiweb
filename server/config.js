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
  planId: process.env.WHOP_PLAN_ID || "",
  checkoutUrl: (process.env.WHOP_CHECKOUT_URL || "").trim(),
  accessDurationDays: asInt(process.env.ACCESS_DURATION_DAYS, 30),
  sessionSecret: process.env.SESSION_SECRET || "",
  databasePath: process.env.DATABASE_PATH || "./data/reki-web.sqlite",
};

// Safe subset exposed to the browser. No secrets here.
export function publicConfig(c = config) {
  const checkoutUrl =
    c.checkoutUrl && c.checkoutUrl.startsWith("https://")
      ? c.checkoutUrl
      : "";
  return {
    checkoutConfigured: checkoutUrl !== "",
    checkoutUrl,
    accessDurationDays: c.accessDurationDays,
    productTitle: "Reki Web",
  };
}

export function returnUrl() {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/api/whop/return` : "";
}

export function webhookUrl() {
  return config.publicBaseUrl
    ? `${config.publicBaseUrl}/api/webhooks/whop`
    : "";
}

export function oauthCallbackUrl() {
  return config.publicBaseUrl
    ? `${config.publicBaseUrl}/api/auth/whop/callback`
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
  if (!config.checkoutUrl) warnings.push("WHOP_CHECKOUT_URL is not set");
  if (!config.sessionSecret) warnings.push("SESSION_SECRET is not set");
  return warnings;
}
