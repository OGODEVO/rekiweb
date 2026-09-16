import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTrackerState } from "../../server/state.js";

const good = {
  supplements: [
    { id: "a", name: "D3", detail: "1", time: "Morning", color: "peach" },
  ],
  days: {
    "2026-09-16": { taken: ["a"], checkin: { energy: 4, sleep: 3, mood: 5 } },
  },
};

describe("validateTrackerState", () => {
  it("accepts the preview shape", () => {
    assert.equal(validateTrackerState(good).ok, true);
  });
  it("rejects bad schedules, ratings, and oversized payloads", () => {
    assert.equal(
      validateTrackerState({
        ...good,
        supplements: [{ id: "a", name: "x", time: "Never" }],
      }).ok,
      false,
    );
    assert.equal(
      validateTrackerState({
        ...good,
        days: {
          "2026-09-16": {
            taken: [],
            checkin: { energy: 9, sleep: 3, mood: 5 },
          },
        },
      }).ok,
      false,
    );
    assert.equal(
      validateTrackerState({ supplements: [], days: null }).ok,
      false,
    );
  });
});
