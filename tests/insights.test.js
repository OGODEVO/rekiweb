import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeInsights } from "../src/insights.js";

const D3 = {
  id: "d3",
  name: "Vitamin D3",
  detail: "1",
  time: "Morning",
  color: "peach",
};
const MAG = {
  id: "mag",
  name: "Magnesium",
  detail: "1",
  time: "Evening",
  color: "lavender",
};

function days(entries, end = new Date("2026-09-16T12:00:00")) {
  const out = {};
  for (const [offset, taken, checkin] of entries) {
    const d = new Date(end);
    d.setDate(d.getDate() - offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out[key] = { taken, checkin };
  }
  return out;
}

const full = (e, s, m) => ({ energy: e, sleep: s, mood: m });

describe("computeInsights", () => {
  it("returns nothing for an empty stack", () => {
    const r = computeInsights([], days([[0, [], full(3, 3, 3)]]));
    assert.equal(r.cards.length, 0);
    assert.equal(r.stackCount, 0);
  });

  it("asks for more logging under 5 paired days", () => {
    const r = computeInsights(
      [D3],
      days([
        [0, ["d3"], full(4, 4, 4)],
        [1, ["d3"], full(4, 4, 4)],
      ]),
    );
    assert.equal(r.cards[0].verdict, "notEnoughData");
    assert.match(r.cards[0].headline, /few more days/);
  });

  it("flags messy adherence under 60%", () => {
    const d = days([
      [0, ["d3"], full(4, 4, 4)],
      [1, [], full(2, 2, 2)],
      [2, [], full(2, 2, 2)],
      [3, [], full(2, 2, 2)],
      [4, [], full(2, 2, 2)],
      [5, [], full(2, 2, 2)],
    ]);
    const r = computeInsights([D3], d);
    assert.equal(r.cards[0].verdict, "messyAdherence");
    assert.match(r.cards[0].headline, /%/);
  });

  it("reports a helpful pattern only with real skip days", () => {
    const d = days([
      [0, ["d3"], full(5, 5, 5)],
      [1, ["d3"], full(5, 5, 5)],
      [2, ["d3"], full(4, 4, 4)],
      [3, [], full(2, 2, 2)],
      [4, [], full(2, 2, 2)],
    ]);
    const r = computeInsights([D3], d);
    const c = r.cards[0];
    assert.equal(c.verdict, "seemsHelpful");
    assert.equal(c.hasRealSkipComparison, true);
    assert.match(c.detail, /pattern, not proof/);
  });

  it("stays unclear with perfect adherence and no skip days", () => {
    const d = days(
      [0, 1, 2, 3, 4, 5, 6].map((n) => [n, ["d3"], full(4, 4, 4)]),
    );
    const r = computeInsights([D3], d);
    assert.equal(r.cards[0].verdict, "unclear");
    assert.equal(r.cards[0].hasRealSkipComparison, false);
    assert.equal(r.cards[0].skippedAverage, null);
  });

  it("uses sleep for evening supplements", () => {
    const d = days([
      [0, ["mag"], full(2, 5, 3)],
      [1, ["mag"], full(2, 5, 3)],
      [2, ["mag"], full(2, 4, 3)],
      [3, [], full(4, 2, 3)],
      [4, [], full(4, 2, 3)],
    ]);
    const r = computeInsights([MAG], d);
    assert.equal(r.cards[0].metric, "sleep");
    assert.equal(r.cards[0].verdict, "seemsHelpful");
  });

  it("counts the logging streak ending today or yesterday", () => {
    const d = days([
      [0, [], full(3, 3, 3)],
      [1, [], full(3, 3, 3)],
      [2, [], full(3, 3, 3)],
      [4, [], full(3, 3, 3)],
    ]);
    assert.equal(computeInsights([], d).streak, 3);
    assert.equal(computeInsights([], d).feelDays, 4);
  });
});
