import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../../server/webhooks.js";

const SECRET = "ws_test_secret_0123456789abcdef";

function signed(id, ts, body, key = Buffer.from(SECRET, "utf8")) {
  const sig = createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`, "utf8")
    .digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": `v1,${sig}`,
  };
}

describe("verifyWebhookSignature", () => {
  it("accepts a fresh valid signature", () => {
    const body = JSON.stringify({ type: "payment.succeeded" });
    const ts = Math.floor(Date.now() / 1000);
    const h = signed("msg_1", ts, body);
    assert.equal(
      verifyWebhookSignature(body, (n) => h[n], SECRET),
      true,
    );
  });
  it("rejects tampered bodies, stale timestamps, and wrong secrets", () => {
    const body = JSON.stringify({ type: "payment.succeeded" });
    const ts = Math.floor(Date.now() / 1000);
    const h = signed("msg_1", ts, body);
    assert.equal(
      verifyWebhookSignature(body + "x", (n) => h[n], SECRET),
      false,
    );
    const stale = signed("msg_1", ts - 601, body);
    assert.equal(
      verifyWebhookSignature(body, (n) => stale[n], SECRET),
      false,
    );
    assert.equal(
      verifyWebhookSignature(body, (n) => h[n], "ws_wrong"),
      false,
    );
  });
});
