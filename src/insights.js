// Taken-vs-skipped insight engine, ported from the Reki iOS standard
// (LocalInsightEngine). Pure logic, no DOM.
// Rules: 28-day window; only days with a feel check-in count; a supplement
// needs >=5 paired days before any read, >=60% adherence before comparison,
// and >=3 taken + >=2 skipped days before a real comparison. Comparisons are
// never invented: without skip days the verdict stays unclear.

const WINDOW_DAYS = 28;

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDays(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function metricFor(time) {
  return time === "Evening" ? "sleep" : "energy";
}

export function metricLabel(metric) {
  return metric === "sleep" ? "Sleep" : "Energy";
}

function buildCard(supplement, days) {
  const metric = metricFor(supplement.time);
  const takenScores = [];
  const skippedScores = [];
  const series = [];
  for (const [date, record] of Object.entries(days)) {
    if (!record || !record.checkin) continue;
    const score = record.checkin[metric];
    if (!Number.isInteger(score)) continue;
    const didTake = (record.taken || []).includes(supplement.id);
    series.push({ date, value: score, didTake });
    if (didTake) takenScores.push(score);
    else skippedScores.push(score);
  }
  series.sort((a, b) => (a.date < b.date ? -1 : 1));
  const takenDays = takenScores.length;
  const skippedDays = skippedScores.length;
  const pairedDays = takenDays + skippedDays;
  if (!pairedDays) return null;
  const adherence = Math.round((takenDays / pairedDays) * 100);
  const takenAverage = avg(takenScores);
  const skippedAverage = avg(skippedScores);
  const hasRealSkipComparison = takenDays >= 3 && skippedDays >= 2;
  const name = supplement.name;
  const metricName = metricLabel(metric);

  if (pairedDays < 5) {
    return base(supplement, metric, {
      verdict: "notEnoughData",
      confidence: "low",
      headline: "Keep logging for a few more days",
      detail: `Need about a week of check-offs and feel check-ins before judging ${name}.`,
      takenDays,
      skippedDays,
      adherence,
      takenAverage,
      skippedAverage: null,
      hasRealSkipComparison: false,
      series,
    });
  }
  if (adherence < 60) {
    return base(supplement, metric, {
      verdict: "messyAdherence",
      confidence: "low",
      headline: `You only took it ${adherence}% of logged days`,
      detail: `Missed doses make it hard to tell if ${name} helps. Hit most days for a week, then check again.`,
      takenDays,
      skippedDays,
      adherence,
      takenAverage,
      skippedAverage: null,
      hasRealSkipComparison: false,
      series,
    });
  }
  if (hasRealSkipComparison) {
    const delta = takenAverage - skippedAverage;
    const meaningful = Math.abs(delta) >= 0.5;
    const confidence = pairedDays >= 10 ? "moderate" : "low";
    if (meaningful && delta > 0) {
      return base(supplement, metric, {
        verdict: "seemsHelpful",
        confidence,
        headline: `${metricName} looks better on days you took it`,
        detail: `Taken ${takenAverage.toFixed(1)} vs skipped ${skippedAverage.toFixed(1)} over ${pairedDays} days. Still a pattern, not proof.`,
        takenDays,
        skippedDays,
        adherence,
        takenAverage,
        skippedAverage,
        hasRealSkipComparison: true,
        series,
      });
    }
    if (meaningful && delta < 0) {
      return base(supplement, metric, {
        verdict: "notWorthIt",
        confidence,
        headline: `${metricName} didn't look better when you took it`,
        detail: `Taken ${takenAverage.toFixed(1)} vs skipped ${skippedAverage.toFixed(1)}. Worth a drop, or a clean take-it / skip-it test.`,
        takenDays,
        skippedDays,
        adherence,
        takenAverage,
        skippedAverage,
        hasRealSkipComparison: true,
        series,
      });
    }
    return base(supplement, metric, {
      verdict: "unclear",
      confidence: "low",
      headline: "No clear difference yet",
      detail: `Taken and skipped days look similar for ${metricName.toLowerCase()}. Keep going, or run a short test.`,
      takenDays,
      skippedDays,
      adherence,
      takenAverage,
      skippedAverage: null,
      hasRealSkipComparison: false,
      series,
    });
  }
  // Good adherence but almost no skip days — never invent a comparison.
  return base(supplement, metric, {
    verdict: "unclear",
    confidence: "low",
    headline: "You're consistent — need a few skip days",
    detail: `You've logged ${takenDays} taken days. Skip it a couple of times so we can compare fairly.`,
    takenDays,
    skippedDays,
    adherence,
    takenAverage,
    skippedAverage: null,
    hasRealSkipComparison: false,
    series,
  });
}

function base(supplement, metric, rest) {
  return {
    id: supplement.id,
    name: supplement.name,
    metric,
    metricName: metricLabel(metric),
    pairedDays: rest.takenDays + rest.skippedDays,
    ...rest,
  };
}

export function computeInsights(supplements, days, today = new Date()) {
  const windowStart = dayKey(shiftDays(today, -(WINDOW_DAYS - 1)));
  const todayStr = dayKey(today);
  const windowed = Object.fromEntries(
    Object.entries(days || {}).filter(
      ([date]) => date >= windowStart && date <= todayStr,
    ),
  );
  const feelDays = Object.values(windowed).filter((d) => d && d.checkin).length;
  let streak = 0;
  for (let n = 0; ; n++) {
    const key = dayKey(shiftDays(today, -n));
    const rec = (days || {})[key];
    if (n === 0 && !(rec && rec.checkin)) continue; // today may still be open
    if (rec && rec.checkin) streak += 1;
    else break;
    if (n > 400) break;
  }
  const cards = (supplements || [])
    .slice(0, 6)
    .map((s) => buildCard(s, windowed))
    .filter(Boolean);
  return { streak, feelDays, stackCount: (supplements || []).length, cards };
}
