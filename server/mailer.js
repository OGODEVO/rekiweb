// Outbound mail for magic-link sign-in. Fail-closed: with no provider
// configured, sending is refused (503) rather than logged or faked.
// Tokens must never appear in logs, errors, or client responses.
//
// Two providers, Resend first when both are configured:
//   Resend — MAIL_FROM + RESEND_API_KEY (HTTPS API).
//   SMTP — MAIL_FROM + SMTP_HOST, for Google Workspace and friends.
//     Point it at your provider's relay/submission host. With Google
//     Workspace SMTP relay, allowlist the server IP and leave SMTP_USER
//     empty (no password stored anywhere). Otherwise set SMTP_USER and
//     SMTP_PASS (e.g. a Gmail App Password, never a real password).

import nodemailer from "nodemailer";

export function mailerConfigured(cfg) {
  return Boolean(cfg.mailFrom && (cfg.resendApiKey || cfg.smtpHost));
}

export function mailerName(cfg) {
  if (!cfg.mailFrom) return "";
  if (cfg.resendApiKey) return "resend";
  if (cfg.smtpHost) return "smtp";
  return "";
}

function magicContent(url) {
  return {
    subject: "Sign in to Reki Web",
    text:
      `Tap this link to sign in to Reki Web. It expires in 15 minutes and works once.\n\n${url}\n\n` +
      `If you didn't ask for this, ignore it — no account changes were made.`,
    html:
      `<p>Tap this link to sign in to Reki Web. It expires in 15 minutes and works once.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>If you didn't ask for this, ignore it — no account changes were made.</p>`,
  };
}

async function sendViaResend(cfg, { to, subject, text, html }, fetchImpl) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: cfg.mailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const error = new Error("Email send failed");
    error.status = 503;
    throw error;
  }
}

async function sendViaSmtp(cfg, { to, subject, text, html }, transport = null) {
  const sender =
    transport ||
    nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort || 587,
      secure: cfg.smtpSecure === true,
      auth: cfg.smtpUser
        ? { user: cfg.smtpUser, pass: cfg.smtpPass || "" }
        : undefined,
    });
  try {
    await sender.sendMail({ from: cfg.mailFrom, to, subject, text, html });
  } catch {
    const error = new Error("Email send failed");
    error.status = 503;
    throw error;
  } finally {
    if (!transport && typeof sender.close === "function") sender.close();
  }
}

export async function sendMagicLink(
  cfg,
  { to, url },
  fetchImpl = globalThis.fetch,
  transport = null,
) {
  if (!mailerConfigured(cfg)) {
    const error = new Error("Email is not configured");
    error.status = 503;
    throw error;
  }
  const content = magicContent(url);
  if (cfg.resendApiKey) {
    await sendViaResend(cfg, { to, ...content }, fetchImpl);
    return { provider: "resend" };
  }
  await sendViaSmtp(cfg, { to, ...content }, transport);
  return { provider: "smtp" };
}
