// Server-side validation for account-backed tracker states.
// Mirrors the browser rules so bad records cannot be stored.

const TIMES = new Set(["Morning", "Evening", "Anytime"]);
const COLORS = new Set(["peach", "sage", "lavender"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isStr(v, max) {
  return typeof v === "string" && v.length <= max;
}

export function validateTrackerState(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: "state must be an object" };
  if (!Array.isArray(data.supplements))
    return { ok: false, error: "supplements must be an array" };
  if (data.supplements.length > 100)
    return { ok: false, error: "too many supplements" };
  const ids = new Set();
  for (const s of data.supplements) {
    if (!s || typeof s !== "object")
      return { ok: false, error: "bad supplement" };
    if (!isStr(s.id, 80) || !isStr(s.name, 70) || !s.name.trim())
      return { ok: false, error: "bad supplement name" };
    if (s.detail !== undefined && !isStr(s.detail, 100))
      return { ok: false, error: "bad serving note" };
    if (!TIMES.has(s.time)) return { ok: false, error: "bad schedule" };
    if (s.color !== undefined && !COLORS.has(s.color))
      return { ok: false, error: "bad color" };
    if (ids.has(s.id)) return { ok: false, error: "duplicate id" };
    ids.add(s.id);
  }
  if (!data.days || typeof data.days !== "object" || Array.isArray(data.days))
    return { ok: false, error: "days must be an object" };
  if (Object.keys(data.days).length > 400)
    return { ok: false, error: "too many days" };
  for (const [day, v] of Object.entries(data.days)) {
    if (!DAY_RE.test(day)) return { ok: false, error: "bad day key" };
    if (!v || !Array.isArray(v.taken))
      return { ok: false, error: "bad day record" };
    if (v.taken.length > 100 || !v.taken.every((id) => isStr(id, 80)))
      return { ok: false, error: "bad taken list" };
    if (v.checkin !== undefined) {
      for (const m of ["energy", "sleep", "mood"]) {
        const n = v.checkin?.[m];
        if (!Number.isInteger(n) || n < 1 || n > 5)
          return { ok: false, error: "bad check-in" };
      }
    }
  }
  return { ok: true };
}

export function sanitizeTrackerState(data) {
  return {
    demo: false,
    supplements: data.supplements.map((s) => ({
      id: s.id,
      name: s.name.trim().slice(0, 70),
      detail: (s.detail || "").slice(0, 100),
      time: s.time,
      color: COLORS.has(s.color) ? s.color : "peach",
    })),
    days: Object.fromEntries(
      Object.entries(data.days)
        .slice(0, 400)
        .map(([day, v]) => [
          day,
          {
            taken: v.taken.filter((id) => typeof id === "string").slice(0, 100),
            ...(v.checkin
              ? {
                  checkin: {
                    energy: v.checkin.energy,
                    sleep: v.checkin.sleep,
                    mood: v.checkin.mood,
                  },
                }
              : {}),
          },
        ]),
    ),
  };
}
