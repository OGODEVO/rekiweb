import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorizeUrl, pkcePair } from "../../server/auth.js";

describe("oauth pkce", () => {
  it("builds a valid authorize URL with S256 challenge", () => {
    const { verifier, challenge } = pkcePair();
    assert.ok(verifier.length >= 43);
    const expect = Buffer.from(
      createHash("sha256").update(verifier, "utf8").digest(),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(challenge, expect);
    const r = authorizeUrl({
      apiBase: "https://api.whop.com",
      appId: "app_x",
      redirectUri: "https://example.com/api/auth/whop/callback",
      scope: "openid profile email",
    });
    assert.ok(r.url.startsWith("https://api.whop.com/oauth/authorize?"));
    assert.ok(r.url.includes("code_challenge_method=S256"));
    assert.ok(r.state && r.nonce && r.verifier);
  });
});
