// Outbound mail for magic-link sign-in. Fail-closed: with no provider
// configured, sending is refused (503) rather than logged or faked.
// Tokens must never appear in logs, errors, or client responses.

export function mailerConfigured(cfg) {
  return Boolean(cfg.mailFrom && cfg.resendApiKey);
}

export async function sendMagicLink(cfg, { to, url }, fetchImpl = globalThis.fetch) {
  if (!mailerConfigured(cfg)) {
    const error = new Error("Email is not configured");
    error.status = 503;
    throw error;
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.mailFrom,
      to: [to],
      subject: "Sign in to Reki Web",
      text:
        `Tap this link to sign in to Reki Web. It expires in 15 minutes and works once.\n\n${url}\n\n` +
        `If you didn't ask for this, ignore it — no account changes were made.`,
      html:
        `<p>Tap this link to sign in to Reki Web. It expires in 15 minutes and works once.</p>` +
        `<p><a href="${url}">${url}</a></p>` +
        `<p>If you didn't ask for this, ignore it — no account changes were made.</p>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const error = new Error("Email send failed");
    error.status = 503;
    throw error;
  }
}
