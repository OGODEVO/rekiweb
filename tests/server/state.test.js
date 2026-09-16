import { it } from "node:test";
import assert from "node:assert/strict";
import { validateTrackerState, sanitizeTrackerState } from "../../server/state.js";
import { tracker } from "./fixtures.js";

it("strict tracker schema includes preferences and preserves deleted-supplement history", () => {
  const good = tracker();
  good.days["2026-09-16"].taken.push("deleted-supplement");
  assert.equal(validateTrackerState(good).ok, true);
  assert.deepEqual(sanitizeTrackerState(good), good);
  const leap = tracker(); leap.days = { "2024-02-29": { taken: [] } };
  assert.equal(validateTrackerState(leap).ok, true);
});

it("rejects unsafe dates, duplicate IDs, unknown keys, invalid ratings, preferences, and excessive collections", () => {
  const bad = [];
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "0000-01-01", "__proto__"])
    bad.push({ ...tracker(), days: { [date]: { taken: [] } } });
  for (const taken of [["a", "a"], ["__proto__"], [""], [null], Array.from({ length: 101 }, (_, i) => String(i))])
    bad.push({ ...tracker(), days: { "2026-09-16": { taken } } });
  for (const checkin of [null, [], { energy: 0, mood: 1, sleep: 1 }, { energy: 1.1, mood: 1, sleep: 1 },
    { energy: 1, mood: 1 }, { energy: 1, mood: 1, sleep: 1, secret: true }])
    bad.push({ ...tracker(), days: { "2026-09-16": { taken: [], checkin } } });
  for (const changes of [{ id: "" }, { id: "constructor" }, { name: "\u0000" }, { time: "Never" }, { detail: "x".repeat(101) }, { color: "red" }, { extra: 1 }])
    bad.push({ ...tracker(), supplements: [{ ...tracker().supplements[0], ...changes }] });
  bad.push({ ...tracker(), supplements: Array(101).fill(tracker().supplements[0]) });
  bad.push({ ...tracker(), supplements: [tracker().supplements[0], tracker().supplements[0]] });
  for (const preferences of [undefined, null, [], {}, { tourCompleted: "true" }, { tourCompleted: false, extra: true }])
    bad.push({ ...tracker(), preferences });
  bad.push({ ...tracker(), days: null }, { ...tracker(), demo: true }, { ...tracker(), extra: true });
  const days = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), { taken: [] }]));
  bad.push({ ...tracker(), days });
  for (const value of bad) assert.equal(validateTrackerState(value).ok, false, JSON.stringify(value).slice(0, 200));
});
