const TIMES = new Set(["Morning", "Evening", "Anytime"]);
const COLORS = new Set(["peach", "sage", "lavender"]);
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
const text = (v, max) => typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v) => text(v, 80) && v.trim() === v && v.length > 0 && !unsafe.has(v);

export function validateTrackerState(data) {
  if (!keys(data, ["demo", "supplements", "days", "preferences"]) || data.demo !== false)
    return { ok: false, error: "invalid state object" };
  if (!Array.isArray(data.supplements) || data.supplements.length > 100)
    return { ok: false, error: "invalid supplements" };
  const ids = new Set();
  for (const s of data.supplements) {
    if (!keys(s, ["id", "name", "detail", "time", "color"]) || !id(s.id) || ids.has(s.id) ||
      !text(s.name, 70) || !s.name.trim() || !text(s.detail, 100) || !TIMES.has(s.time) || !COLORS.has(s.color))
      return { ok: false, error: "invalid supplement" };
    ids.add(s.id);
  }
  if (!object(data.days) || Object.keys(data.days).length > 400)
    return { ok: false, error: "invalid days" };
  for (const [day, v] of Object.entries(data.days)) {
    const ms = Date.parse(`${day}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "1900-01-01" || !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== day || !keys(v, ["taken", "checkin"]) ||
      !Array.isArray(v.taken) || v.taken.length > 100 || !v.taken.every(id) || new Set(v.taken).size !== v.taken.length)
      return { ok: false, error: "invalid day record" };
    // Taken IDs may refer to deleted supplements; their history is intentional.
    if (v.checkin !== undefined && (!keys(v.checkin, ["energy", "sleep", "mood"]) ||
      !["energy", "sleep", "mood"].every((k) => Number.isInteger(v.checkin[k]) && v.checkin[k] >= 1 && v.checkin[k] <= 5)))
      return { ok: false, error: "invalid check-in" };
  }
  if (!keys(data.preferences, ["tourCompleted"]) || typeof data.preferences.tourCompleted !== "boolean")
    return { ok: false, error: "invalid preferences" };
  return { ok: true };
}

export function sanitizeTrackerState(data) {
  return { ...data, demo: false, supplements: data.supplements.map((s) => ({ ...s, name: s.name.trim() })) };
}

// Previously persisted states lack preferences. Reading does not rewrite history.
export function storedTrackerState(data) {
  const state = JSON.parse(data);
  return { ...state, demo: false, preferences: { tourCompleted: state.preferences?.tourCompleted === true } };
}
