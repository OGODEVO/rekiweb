import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "./style.css";
import { searchSupplements } from "./supplements-data.js";

const paths = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  stack: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
  chart: '<path d="M4 4v16h16M8 15l4-5 4 2 4-7"/>',
  leaf: '<path d="M5 19C-1 5 15 3 21 3c0 7-2 18-14 15m-3 3L16 8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  heart:
    '<path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 4 12 8 15 4-3 13-10 8-15Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
  bin: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const key = "reki-web-preview-v1";
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const initial = () => ({
  demo: true,
  preferences: { tourCompleted: false },
  supplements: [
    {
      id: "d3",
      name: "Vitamin D3",
      detail: "1 softgel",
      time: "Morning",
      color: "peach",
    },
    {
      id: "omega",
      name: "Omega-3",
      detail: "2 softgels",
      time: "Morning",
      color: "sage",
    },
    {
      id: "magnesium",
      name: "Magnesium",
      detail: "1 capsule",
      time: "Evening",
      color: "lavender",
    },
  ],
  days: {},
});
let storageFailed = false;
let state;
try {
  const saved = localStorage.getItem(key);
  state = saved ? JSON.parse(saved) : initial();
  if (
    typeof state.demo !== "boolean" ||
    !Array.isArray(state.supplements) ||
    !state.days ||
    typeof state.days !== "object" ||
    Array.isArray(state.days)
  )
    throw new Error("Invalid saved data");
  // Older saves lack preferences; normalize instead of resetting history.
  if (
    !state.preferences ||
    typeof state.preferences.tourCompleted !== "boolean"
  )
    state.preferences = { tourCompleted: false };
  for (const item of state.supplements) {
    if (
      !["id", "name", "detail", "time", "color"].every(
        (field) => typeof item[field] === "string",
      ) ||
      !["Morning", "Evening", "Anytime"].includes(item.time)
    )
      throw new Error("Invalid supplement");
  }
  for (const day of Object.values(state.days)) {
    if (
      !day ||
      !Array.isArray(day.taken) ||
      !day.taken.every((id) => typeof id === "string")
    )
      throw new Error("Invalid day");
    if (
      day.checkin &&
      !["energy", "sleep", "mood"].every(
        (metric) =>
          Number.isInteger(day.checkin[metric]) &&
          day.checkin[metric] >= 1 &&
          day.checkin[metric] <= 5,
      )
    )
      throw new Error("Invalid check-in");
  }
} catch {
  state = initial();
  storageFailed = true;
}
let activeTab = "today";
let selectedDate = todayKey();
// Paid-access UI state. Declared before first render() so render can read it.
const paidAccess = {
  checkoutUrl: "",
  billing: null,
  me: null,
  unlocked: false,
  locked: false,
  revision: 0,
  tourStep: -1,
  bannerMode: "",
};
const day = () => state.days[todayKey()] || { taken: [] };
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}
function announce(message) {
  document.querySelector("#announcement").textContent = message;
}

document.querySelector("#app").innerHTML = `
  <header class="site-header wrap">
    <a class="brand" href="#" aria-label="Reki Web home"><img src="/assets/reki-face.webp" alt="" width="42" height="42"><span>reki<span class="brand-dot">.</span></span><span class="web-label">WEB</span></a>
    <nav aria-label="Main navigation"><a href="#how-it-works">The little routine</a><a href="#pricing">One simple price</a></nav>
    <a class="button button-small button-dark" href="#tracker">Try it out ${icon("arrow")}</a>
  </header>
  <main>
    <section class="hero wrap" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="status-dot"></span> A FRIENDLIER DAILY ROUTINE</div>
        <h1 id="hero-title">Your supplements.<br>Your little ritual.<br><span>More you.</span></h1>
        <p class="hero-description">Track your supplements. See how you feel.<br>A calm little home for your daily stack, right in your browser.</p>
        <div class="hero-actions"><a class="button button-coral" href="#tracker" id="try-button">Find your rhythm ${icon("arrow")}</a><span class="try-note">Try the tracker.<br>No account needed.</span></div>
        <div class="hero-footnote">${icon("check")} Not another PDF. A place to come back to.</div>
        <div class="mascot-note"><img src="/assets/reki-face.webp" alt="Reki, your red-haired, bespectacled companion" width="48" height="48"><p>Small habits. No guilt.<br><strong>I'll be here when you're ready.</strong></p></div>
      </div>
      <div class="hero-product">
        <div class="handwritten">a little look at your day <span aria-hidden="true">↴</span></div>
        <section id="tracker" class="tracker" aria-label="Interactive Reki Web tracker" tabindex="-1">
          <div class="tracker-top"><span class="mini-brand">reki<span>.</span></span><span id="demo-badge" class="demo-badge"></span></div>
          <div class="tracker-tabs" role="tablist" aria-label="Tracker views">
            <button id="tab-today" role="tab" aria-controls="tracker-content" data-tab="today">${icon("sun")} Today</button>
            <button id="tab-stack" role="tab" aria-controls="tracker-content" data-tab="stack">${icon("stack")} My stack</button>
            <button id="tab-insights" role="tab" aria-controls="tracker-content" data-tab="insights">${icon("chart")} How I feel</button>
          </div>
          <div id="tracker-content" role="tabpanel" tabindex="0"></div>
          <div class="tracker-bottom"><span>${icon("lock")} <span id="storage-status"></span></span><span><button class="text-button" id="tour-replay">Tour</button><button class="text-button" id="auth-link">Sign in</button><button class="text-button" id="start-own">Make it yours ${icon("arrow")}</button></span></div>
        </section>
        <div class="product-caption"><span class="caption-line"></span> REAL BUTTONS. YOUR NEXT SMALL STEP.</div>
      </div>
    </section>
    <div class="values-strip"><div class="wrap"><span>${icon("sun")} Your day, a little clearer</span><span>${icon("stack")} Your stack, all together</span><span>${icon("heart")} Your feelings, worth noticing</span></div></div>
    <section id="how-it-works" class="routine wrap" aria-labelledby="routine-title">
      <div class="section-heading"><div><span class="eyebrow">LESS GUESSING. MORE NOTICING.</span><h2 id="routine-title">A routine that fits<br>into your real life.</h2></div><p>You don't need another complicated dashboard.<br>Just a little space to keep track of you.</p></div>
      <div class="routine-steps">
        <article><div class="step-number">01 <span></span></div><div class="step-art stack-art"><div>${icon("leaf")} Your everyday essentials</div><div>${icon("plus")} Room for your own routine</div></div><h3>Give your stack a home.</h3><p>Add what you already take. Keep your schedule and serving notes together, without the spreadsheet.</p></article>
        <article><div class="step-number">02 <span></span></div><div class="step-art tick-art"><span>${icon("check")}</span><p>One little check.<br><strong>One less thing to remember.</strong></p></div><h3>Check in, then get on.</h3><p>Open Today, mark what you've taken, and get back to your day. A routine, not a full-time job.</p></article>
        <article><div class="step-number">03 <span></span></div><div class="step-art feeling-art"><span>1</span><span>2</span><span>3</span><span class="chosen">4</span><span>5</span></div><h3>Notice how you feel.</h3><p>Log your energy, sleep, and mood. Build a personal record, not a promise that a supplement works.</p></article>
      </div>
    </section>
    <section id="pricing" class="pricing wrap" aria-labelledby="price-title">
      <div class="price-story"><span class="eyebrow">A LITTLE INVESTMENT IN YOUR ROUTINE</span><h2 id="price-title">Less overthinking.<br>More showing up.</h2><p>A browser tracker with a familiar face.<br>$15 now, then $15 every 30 days.<br>Just you, your stack, and a fresh start each day.</p><img class="waving-reki" src="/assets/reki-waving.webp" alt="Reki smiling and waving" width="480" height="1014" loading="lazy"><span class="mascot-signature">see you tomorrow.</span></div>
      <div class="price-card"><span class="offer-label">REKI WEB · MONTHLY MEMBERSHIP</span><div class="price"><span class="currency">$</span>15<span class="price-period">USD<br>every 30 days</span></div><p class="price-subtitle">$15 now, then $15 every 30 days. Cancel anytime in Whop.</p><ul><li>${icon("check")} Your supplement stack & serving notes</li><li>${icon("check")} Daily check-offs & morning / evening schedule</li><li>${icon("check")} Energy, sleep & mood check-ins</li><li>${icon("check")} Ongoing access while membership is active</li></ul><button class="button button-dark price-button" id="beta-button">Start my membership — $15 ${icon("arrow")}</button><p class="checkout-note">Local preview. Checkout isn't connected yet.</p><p class="terms-note">$15 USD now, then $15 every 30 days. Manage or cancel in Whop; you keep access for time already paid. AI scanning and iPhone app access are not included.</p></div>
    </section>
    <section class="faq wrap" aria-labelledby="faq-title"><div><span class="eyebrow">A FEW LITTLE DETAILS</span><h2 id="faq-title">Good to know.</h2></div><div class="faq-items">
      <details><summary>Is this the Reki iPhone app?<span>+</span></summary><p>No. Reki Web is a separate browser tracker. This offer does not unlock Reki Pro or any paid features in the iPhone app.</p></details>
      <details><summary>What does this preview save?<span>+</span></summary><p>Your stack, daily check-offs, and check-ins stay in this browser's local storage. Nothing is sent to a server. There is no account, cloud backup, or device sync. Clearing browser data removes your record. Avoid shared devices for personal information.</p></details>
      <details><summary>Can it tell me if my supplements work?<span>+</span></summary><p>It helps you record your routine and notice how you feel over time. Self-reported patterns do not establish that a supplement caused a change. Reki does not diagnose conditions or give medical advice.</p></details>
      <details><summary>Do I need a card to try it?<span>+</span></summary><p>No. The interactive local preview is free to explore without an account or a card. Membership is separate: $15 now and every 30 days through Whop; checkout is not enabled here.</p></details>
    </div></section>
  </main>
  <footer class="wrap"><a class="brand" href="#"><span>reki<span class="brand-dot">.</span></span><span class="web-label">WEB</span></a><p>A little more mindful. A little more you.</p><a href="mailto:admin@rekisupplement.org">Say hello ${icon("arrow")}</a></footer>
  <dialog id="editor" aria-labelledby="editor-title"><form id="supplement-form"><div class="dialog-heading"><h2 id="editor-title">A new little habit.</h2><button type="button" class="icon-button" data-close aria-label="Close supplement editor">${icon("close")}</button></div><input type="hidden" name="id"><label>Supplement name<input name="name" required maxlength="70" placeholder="e.g. Vitamin D3" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="supplement-suggest" aria-autocomplete="list"><ul class="suggest-list" id="supplement-suggest" role="listbox" aria-label="Matching supplements" hidden></ul></label><label>Your serving note<input name="detail" maxlength="100" placeholder="e.g. 1 softgel with breakfast" autocomplete="off"></label><label>When do you take it?<select name="time"><option>Morning</option><option>Evening</option><option>Anytime</option></select></label><p class="form-note">Record your existing routine. Follow your label or clinician's guidance for dosage.</p><button class="button button-coral" type="submit">Save to my stack ${icon("check")}</button></form></dialog>
  <dialog id="checkin" aria-labelledby="checkin-title"><form id="checkin-form"><div class="dialog-heading"><h2 id="checkin-title">How's your day feeling?</h2><button type="button" class="icon-button" data-close aria-label="Close check-in">${icon("close")}</button></div><p class="dialog-intro">No right answer. Just a moment for you.</p>${["energy", "sleep", "mood"].map((metric) => `<fieldset><legend>${metric[0].toUpperCase() + metric.slice(1)}</legend><div class="rating-options">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${metric}" value="${n}" required><span>${n}</span></label>`).join("")}</div><div class="rating-scale"><span>Low</span><span>Great</span></div></fieldset>`).join("")}<button class="button button-coral" type="submit">Save my check-in ${icon("check")}</button></form></dialog>
  <dialog id="start-dialog" aria-labelledby="start-title"><div class="dialog-heading"><h2 id="start-title">Make room for your routine.</h2><button class="icon-button" data-close aria-label="Close start dialog">${icon("close")}</button></div><p>This removes the example stack and any preview check-ins so you can start fresh. Your new entries will stay in this browser only.</p><button class="button button-coral" id="confirm-start">Start my own stack ${icon("arrow")}</button></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title"><div class="dialog-heading"><h2 id="delete-title">Remove this supplement?</h2><button class="icon-button" data-close aria-label="Close removal dialog">${icon("close")}</button></div><p id="delete-description"></p><button class="button button-dark" id="confirm-delete">Remove from my stack</button></dialog>
  <dialog id="beta-dialog" aria-labelledby="beta-title"><div class="dialog-heading"><h2 id="beta-title">A little early. A lot to come.</h2><button class="icon-button" data-close aria-label="Close beta details">${icon("close")}</button></div><p>This is the local Reki Web preview. The $15 membership (now and every 30 days) is not taking payments yet. Nothing has been purchased and no account has been created.</p><p>You can keep exploring the working tracker now.</p><button class="button button-coral" data-close>Back to my routine ${icon("arrow")}</button></dialog>
  <div id="member-banner" class="member-banner" hidden></div>
  <div id="tour" class="tour" hidden>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <img id="tour-image" src="/assets/reki-waving.webp" alt="Reki guiding you" width="146" height="300">
      <div class="tour-copy">
        <p id="tour-step" class="tour-step">1 of 4</p>
        <h2 id="tour-title">Welcome in.</h2>
        <p id="tour-text"></p>
        <div class="tour-actions">
          <button class="button button-small button-dark" id="tour-back">Back</button>
          <button class="button button-small button-coral" id="tour-next">Next</button>
          <button class="text-button" id="tour-skip">Skip the tour</button>
        </div>
      </div>
      <button class="icon-button tour-close" id="tour-close" aria-label="Close tour">${icon("close")}</button>
    </div>
  </div>
  <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
`;

function render(focusKey) {
  const current = day();
  const taken = state.supplements.filter((s) =>
    current.taken.includes(s.id),
  ).length;
  const total = state.supplements.length;
  const date = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
  const panel = document.querySelector("#tracker-content");
  panel.setAttribute("aria-labelledby", `tab-${activeTab}`);
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === activeTab));
    tab.tabIndex = tab.dataset.tab === activeTab ? 0 : -1;
  });
  document.querySelector("#demo-badge").textContent = paidAccess.unlocked
    ? "MEMBER STACK · BACKED UP"
    : state.demo
      ? "INTERACTIVE PREVIEW · SAMPLE STACK"
      : "YOUR LOCAL STACK";
  if (!paidAccess.unlocked)
    document.querySelector("#storage-status").textContent = storageFailed
      ? "Saving unavailable in this browser"
      : "Saved in this browser only";
  document.querySelector("#start-own").hidden = !state.demo;
  document
    .querySelector("#tracker")
    .classList.toggle("locked", paidAccess.locked);
  const lockedCard = paidAccess.locked
    ? `<div class="locked-card"><img src="/assets/reki-heart.webp" alt="" width="25" height="64"><div><strong>Membership paused.</strong><span>Your history is safe below. Renew to keep tracking.</span></div><div class="locked-actions"><a class="button button-small button-coral" href="#pricing">Renew — $15</a><a class="text-button" href="/api/export" download>Export my data</a></div></div>`
    : "";
  const row = (item, isStack) =>
    `<div class="supplement-row"><div class="supplement-symbol ${["peach", "sage", "lavender"].includes(item.color) ? item.color : "peach"}">${icon(item.time === "Evening" ? "moon" : "leaf")}</div><div class="supplement-copy"><strong>${esc(item.name)}</strong><span>${esc(item.detail || "No serving note")}${isStack ? ` · ${esc(item.time)}` : ""}</span></div>${isStack ? `<button class="icon-button" data-edit="${esc(item.id)}" aria-label="Edit ${esc(item.name)}">${icon("edit")}</button><button class="icon-button" data-delete="${esc(item.id)}" aria-label="Remove ${esc(item.name)}">${icon("bin")}</button>` : `<button class="dose-check ${current.taken.includes(item.id) ? "taken" : ""}" data-toggle="${esc(item.id)}" aria-label="Mark ${esc(item.name)} ${current.taken.includes(item.id) ? "not taken" : "taken"}" aria-pressed="${current.taken.includes(item.id)}" ${paidAccess.locked ? "disabled" : ""}>${icon("check")}</button>`}</div>`;
  const empty = `<div class="empty-state">${icon("leaf")}<h3>Your routine starts here.</h3><p>Add your first supplement. No perfect stack required.</p><button class="text-button" data-add>${icon("plus")} Add a supplement</button></div>`;
  if (activeTab === "today") {
    panel.innerHTML = `${lockedCard}<div class="tracker-greeting"><div><p class="tracker-date">${date}</p><h2>A little care, daily.</h2></div><span class="sun-doodle">${icon("sun")}</span></div><div class="daily-progress"><div><span><strong>${taken}</strong> of ${total} taken today</span><span>${total && taken === total ? "A little win. All done." : "One small step at a time."}</span></div><div class="progress-track" role="progressbar" aria-label="Supplements taken today" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${taken}"><span style="width:${total ? (taken / total) * 100 : 0}%"></span></div></div><div class="schedule">${
      total
        ? ["Morning", "Evening", "Anytime"]
            .filter((time) => state.supplements.some((s) => s.time === time))
            .map(
              (time) =>
                `<div class="schedule-label">${icon(time === "Evening" ? "moon" : "sun")} ${time}</div>${state.supplements
                  .filter((s) => s.time === time)
                  .map((s) => row(s, false))
                  .join("")}`,
            )
            .join("")
        : empty
    }</div><button class="checkin-card" id="open-checkin"><span class="checkin-face">${icon("heart")}</span><span><strong>${current.checkin ? "A moment, just for you. Saved." : "And how are you feeling?"}</strong><small>${current.checkin ? "Your daily check-in is here. Tap to edit." : "A little check-in with yourself."}</small></span>${icon("arrow")}</button>`;
  } else if (activeTab === "stack") {
    panel.innerHTML = `${lockedCard}<div class="tracker-greeting"><div><p class="tracker-date">YOUR EVERYDAY ESSENTIALS</p><h2>Make it your own.</h2></div><button class="icon-button add-circle" data-add aria-label="Add a supplement">${icon("plus")}</button></div><p class="panel-description">A home for what you take, and when.</p><div class="stack-list">${total ? state.supplements.map((s) => row(s, true)).join("") : empty}</div>${total ? `<button class="add-stack-button" data-add>${icon("plus")} Add a supplement</button>` : ""}<p class="panel-note">${state.demo ? "These are example entries, not supplement or dosage recommendations." : "Your routine belongs to you. Serving notes are a record, not dosage advice."}</p>`;
  } else {
    const checkins = Object.entries(state.days)
      .filter(([, value]) => value.checkin)
      .sort(([a], [b]) => b.localeCompare(a));
    panel.innerHTML = `${lockedCard}<div class="tracker-greeting"><div><p class="tracker-date">A MOMENT TO NOTICE</p><h2>Your days, in feeling.</h2></div>${icon("chart")}</div><p class="panel-description">Personal observations. No scores to chase.</p>${
      checkins.length
        ? `<div class="metric-grid">${["energy", "sleep", "mood"].map((metric) => `<div><span>${metric}</span><strong>${(checkins.reduce((sum, [, value]) => sum + value.checkin[metric], 0) / checkins.length).toFixed(1)}<small>/5</small></strong></div>`).join("")}</div><p class="averages-caption">Averages across ${checkins.length} recorded ${checkins.length === 1 ? "day" : "days"}${state.demo ? " in this preview" : ""}.</p><div class="checkin-history">${checkins
            .slice(0, 5)
            .map(
              ([dateKey, value]) =>
                `<div><strong>${dateKey === todayKey() ? "Today" : esc(dateKey)}</strong><span>Energy ${value.checkin.energy} · Sleep ${value.checkin.sleep} · Mood ${value.checkin.mood}</span></div>`,
            )
            .join("")}</div>`
        : `<div class="empty-state feeling-empty">${icon("heart")}<h3>Get to know your days.</h3><p>Your first check-in starts the story.<br>Your history will appear here as you go.</p></div>`
    }<button class="button button-coral checkin-start" id="open-checkin">${current.checkin ? "Edit today's check-in" : "Check in with yourself"} ${icon("plus")}</button><p class="panel-note">Patterns aren't proof. These notes can't tell you whether a supplement caused a change.</p>`;
  }
  if (focusKey)
    document
      .querySelector(`[data-toggle="${CSS.escape(focusKey)}"]`)
      ?.focus({ preventScroll: true });
}

function openEditor(id) {
  const form = document.querySelector("#supplement-form");
  form.reset();
  const item = state.supplements.find((s) => s.id === id);
  document.querySelector("#editor-title").textContent = item
    ? "Your habit, your way."
    : "A new little habit.";
  for (const field of ["id", "name", "detail", "time"])
    form.elements[field].value =
      item?.[field] || (field === "time" ? "Morning" : "");
  closeSuggest();
  document.querySelector("#editor").showModal();
  form.elements.name.focus();
}

// Built-in directory suggestions for the name field.
const nameInput = document.querySelector("#supplement-form").elements.name;
const suggestBox = document.querySelector("#supplement-suggest");
let suggestItems = [];
let suggestIndex = -1;

function closeSuggest() {
  suggestItems = [];
  suggestIndex = -1;
  suggestBox.innerHTML = "";
  suggestBox.hidden = true;
  nameInput.setAttribute("aria-expanded", "false");
}

function renderSuggest() {
  suggestBox.innerHTML = suggestItems
    .map(
      (item, i) =>
        `<li role="option" id="suggest-option-${i}" aria-selected="${i === suggestIndex}">` +
        `<strong>${esc(item.name)}</strong><span>${esc(item.serving)} · ${esc(item.time)}</span></li>`,
    )
    .join("");
  suggestBox.hidden = suggestItems.length === 0;
  nameInput.setAttribute("aria-expanded", String(suggestItems.length > 0));
}

function pickSuggest(i) {
  const item = suggestItems[i];
  if (!item) return;
  const form = document.querySelector("#supplement-form");
  form.elements.name.value = item.name;
  if (!form.elements.detail.value.trim()) form.elements.detail.value = item.serving;
  form.elements.time.value = item.time;
  closeSuggest();
  announce(`${item.name} selected. Serving note added — edit it to match your label.`);
  form.elements.detail.focus();
}

nameInput.addEventListener("input", () => {
  nameInput.setCustomValidity("");
  suggestItems = searchSupplements(nameInput.value);
  suggestIndex = -1;
  renderSuggest();
});

nameInput.addEventListener("keydown", (event) => {
  if (suggestBox.hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    suggestIndex =
      (suggestIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestItems.length) %
      suggestItems.length;
    renderSuggest();
    document.querySelector(`#suggest-option-${suggestIndex}`)?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && suggestIndex >= 0) {
    event.preventDefault();
    pickSuggest(suggestIndex);
  } else if (event.key === "Escape") {
    closeSuggest();
  }
});

suggestBox.addEventListener("mousedown", (event) => {
  const option = event.target.closest('[role="option"]');
  if (!option) return;
  event.preventDefault();
  pickSuggest(Number(option.id.replace("suggest-option-", "")));
});

nameInput.addEventListener("blur", () => {
  setTimeout(closeSuggest, 120);
});

let pendingDelete;
document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.hasAttribute("data-close"))
    return target.closest("dialog").close();
  if (target.dataset.tab) {
    activeTab = target.dataset.tab;
    render();
  }
  if (
    paidAccess.locked &&
    (target.hasAttribute("data-add") ||
      target.dataset.edit ||
      target.id === "open-checkin")
  ) {
    announce("Membership paused. Renew to make changes.");
    return;
  }
  if (target.hasAttribute("data-add")) openEditor();
  if (target.dataset.edit) openEditor(target.dataset.edit);
  if (target.dataset.delete) {
    pendingDelete = target.dataset.delete;
    const item = state.supplements.find((s) => s.id === pendingDelete);
    document.querySelector("#delete-description").textContent =
      `Remove ${item.name} from your stack? Your daily feeling check-ins will stay.`;
    document.querySelector("#delete-dialog").showModal();
  }
  if (target.dataset.toggle) {
    const current = day();
    const id = target.dataset.toggle;
    current.taken = current.taken.includes(id)
      ? current.taken.filter((s) => s !== id)
      : [...current.taken, id];
    state.days[todayKey()] = current;
    save();
    render(id);
    announce(
      storageFailed
        ? "Updated for this session. Browser saving is unavailable."
        : "Your daily routine is saved.",
    );
  }
  if (target.id === "open-checkin") {
    const form = document.querySelector("#checkin-form");
    form.reset();
    const previous = day().checkin;
    if (previous)
      for (const metric of ["energy", "sleep", "mood"])
        form.elements[metric].value = previous[metric];
    document.querySelector("#checkin").showModal();
  }
  if (target.id === "start-own")
    document.querySelector("#start-dialog").showModal();
  if (target.id === "confirm-start") {
    state = { demo: false, supplements: [], days: {} };
    save();
    activeTab = "stack";
    render();
    document.querySelector("#start-dialog").close();
    openEditor();
  }
  if (target.id === "confirm-delete") {
    state.supplements = state.supplements.filter((s) => s.id !== pendingDelete);
    for (const value of Object.values(state.days))
      value.taken = value.taken.filter((id) => id !== pendingDelete);
    save();
    render();
    document.querySelector("#delete-dialog").close();
    document.querySelector("[data-add]")?.focus();
    announce("Supplement removed.");
  }
  if (target.id === "beta-button") {
    if (paidAccess.unlocked) {
      window.location.hash = "#tracker";
      return;
    }
    if (paidAccess.checkoutUrl) {
      window.location.href = paidAccess.checkoutUrl;
      return;
    }
    document.querySelector("#beta-dialog").showModal();
  }
  if (target.id === "auth-link") {
    if (paidAccess.me?.signedIn) {
      fetch("/api/auth/logout", { method: "POST", headers: mutationHeaders() })
        .catch(() => {})
        .finally(() => window.location.reload());
      return;
    }
    window.location.href = `/api/auth/whop/start?next=${encodeURIComponent("/#tracker")}`;
    return;
  }
});

document
  .querySelector("#supplement-form")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    if (!name) {
      form.elements.name.setCustomValidity("Please enter a supplement name.");
      form.elements.name.reportValidity();
      return;
    }
    const id = form.elements.id.value;
    const existing = state.supplements.find((s) => s.id === id);
    const item = {
      id: id || crypto.randomUUID(),
      name,
      detail: form.elements.detail.value.trim(),
      time: form.elements.time.value,
      color:
        existing?.color ||
        ["peach", "sage", "lavender"][state.supplements.length % 3],
    };
    if (existing)
      state.supplements = state.supplements.map((s) =>
        s.id === id ? item : s,
      );
    else state.supplements.push(item);
    save();
    render();
    document.querySelector("#editor").close();
    document.querySelector(`[data-edit="${CSS.escape(item.id)}"]`)?.focus();
    announce(
      storageFailed
        ? "Updated for this session only. Saving is unavailable."
        : `${name} saved to your stack.`,
    );
  });
document
  .querySelector("#supplement-form")
  .elements.name.addEventListener("input", (event) =>
    event.target.setCustomValidity(""),
  );
document.querySelector("#checkin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const checkin = Object.fromEntries(
    ["energy", "sleep", "mood"].map((metric) => [
      metric,
      Number(form.get(metric)),
    ]),
  );
  if (!Object.values(checkin).every((value) => value >= 1 && value <= 5))
    return;
  state.days[todayKey()] = { ...day(), checkin };
  save();
  render();
  document.querySelector("#checkin").close();
  document.querySelector("#open-checkin")?.focus();
  announce(
    storageFailed
      ? "Check-in updated for this session only."
      : "Your check-in is saved.",
  );
});
document.querySelector(".tracker-tabs").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const position = tabs.indexOf(document.activeElement);
  if (
    position < 0 ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  event.preventDefault();
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (position + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  activeTab = tabs[index].dataset.tab;
  render();
  tabs[index].focus();
});
function refreshDate() {
  if (selectedDate !== todayKey()) {
    selectedDate = todayKey();
    render();
  }
}
document.addEventListener("visibilitychange", refreshDate);
setInterval(refreshDate, 30000);
render();

// Paid access: server-verified Whop membership, account-backed state.
// No-ops when the page is served without the backend (static preview).
// Visible paid UI (banner, tour, member states) only ever follows a verified
// /api/me response — never the ?access= URL parameter on its own.
let serverSyncTimer = null;

const TOUR_STEPS = [
  {
    img: "/assets/reki-waving.webp",
    title: "Welcome in.",
    text: "I'm Reki. This is your personal tracker now — backed up, not stuck in this browser. Thirty seconds, then it's yours.",
  },
  {
    img: "/assets/reki-pointing.webp",
    title: "Your stack lives here.",
    text: "Add what you already take, with serving notes and a morning or evening schedule. My stack is home base for all of it.",
  },
  {
    img: "/assets/reki-thumbsup.webp",
    title: "Check in, then get on.",
    text: "Open Today, mark what you've taken, and get back to your day. One small check, one less thing to remember.",
  },
  {
    img: "/assets/reki-celebrating.webp",
    title: "Notice how you feel.",
    text: "Log energy, sleep, and mood. Over time you build your own record — not proof anything works, just your pattern.",
  },
];

async function paidFetch(path, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(path, { ...options, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mutationHeaders() {
  return {
    "X-CSRF-Token": paidAccess.me?.csrfToken || "",
    "X-Reki-User": paidAccess.me?.user?.id || "",
  };
}

async function authed(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(path, {
      ...options,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...mutationHeaders(),
      },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function serverPayload() {
  return {
    demo: false,
    supplements: state.supplements,
    days: state.days,
    preferences: {
      tourCompleted: state.preferences?.tourCompleted === true,
    },
  };
}

function queueServerSync() {
  if (!paidAccess.unlocked) return;
  clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(() => flushServerSync(), 900);
}

async function flushServerSync() {
  if (!paidAccess.unlocked) return false;
  clearTimeout(serverSyncTimer);
  const { status, body } = await authed("/api/state", {
    method: "PUT",
    body: JSON.stringify({
      state: serverPayload(),
      revision: paidAccess.revision,
    }),
  });
  if (status === 200 && body) {
    paidAccess.revision = body.revision;
    return true;
  }
  if (status === 409) {
    // Someone (or another device) saved newer data. Server wins.
    await adoptServerState("Newer saved data loaded.");
    return false;
  }
  if (status === 403) {
    await refreshAccess();
    return false;
  }
  return false;
}

async function adoptServerState(note) {
  const remote = await paidFetch("/api/state");
  const srv = remote?.state;
  if (
    srv &&
    (srv.supplements?.length ||
      Object.keys(srv.days || {}).length ||
      (remote.revision || 0) > 0)
  ) {
    state = {
      demo: false,
      supplements: srv.supplements || [],
      days: srv.days || {},
      preferences: {
        tourCompleted: srv.preferences?.tourCompleted === true,
      },
    };
    paidAccess.revision = remote.revision || 0;
    save();
    render();
    if (note) announce(note);
    return true;
  }
  return false;
}

// ---------- member banner (verified state only) ----------

function hideBanner() {
  const banner = document.querySelector("#member-banner");
  banner.hidden = true;
  banner.innerHTML = "";
  banner.className = "member-banner";
  paidAccess.bannerMode = "";
}

function showWelcomeBanner(until) {
  const banner = document.querySelector("#member-banner");
  banner.className = "member-banner welcome";
  banner.innerHTML =
    `<img src="/assets/reki-celebrating.webp" alt="" width="100" height="150">` +
    `<div><strong>You're in. Membership active until ${fmtDate(until)}.</strong>` +
    `<span>Your stack is backed up. Want the 30-second tour?</span>` +
    `<div class="banner-actions"><button class="button button-small button-coral" id="banner-tour">Show me around</button>` +
    `<button class="text-button" id="banner-dismiss">Maybe later</button></div></div>`;
  banner.hidden = false;
  paidAccess.bannerMode = "welcome";
  announce("Membership active. Welcome in.");
}

function showExpiredBanner() {
  const banner = document.querySelector("#member-banner");
  banner.className = "member-banner expired";
  banner.innerHTML =
    `<img src="/assets/reki-heart.webp" alt="" width="33" height="84">` +
    `<div><strong>Membership paused.</strong>` +
    `<span>Your history is safe. Renew to keep tracking.</span>` +
    `<div class="banner-actions"><a class="button button-small button-coral" href="#pricing">Renew — $15</a>` +
    `<a class="text-button" href="/api/export" download>Export my data</a>` +
    `<button class="text-button" id="banner-dismiss">Dismiss</button></div></div>`;
  banner.hidden = false;
  paidAccess.bannerMode = "expired";
}

function showSigninBanner() {
  const banner = document.querySelector("#member-banner");
  banner.className = "member-banner signin";
  banner.innerHTML =
    `<img src="/assets/reki-waving.webp" alt="" width="41" height="84">` +
    `<div><strong>Bought Reki Web?</strong>` +
    `<span>Sign in with Whop to link your purchase.</span>` +
    `<div class="banner-actions"><button class="button button-small button-dark" id="banner-signin">Sign in</button>` +
    `<button class="text-button" id="banner-dismiss">Dismiss</button></div></div>`;
  banner.hidden = false;
  paidAccess.bannerMode = "signin";
}

// ---------- guided tour ----------

function tourCompleted() {
  if (paidAccess.unlocked) return state.preferences?.tourCompleted === true;
  try {
    return localStorage.getItem("reki-web-tour-done") === "1";
  } catch {
    return true;
  }
}

function startTour() {
  paidAccess.tourStep = 0;
  activeTab = "today";
  render();
  renderTourStep();
  document.querySelector("#tour").hidden = false;
  document.querySelector("#tour-next").focus();
}

function renderTourStep() {
  const step = TOUR_STEPS[paidAccess.tourStep];
  document.querySelector("#tour-image").src = step.img;
  document.querySelector("#tour-step").textContent =
    `${paidAccess.tourStep + 1} of ${TOUR_STEPS.length}`;
  document.querySelector("#tour-title").textContent = step.title;
  document.querySelector("#tour-text").textContent = step.text;
  document.querySelector("#tour-back").disabled = paidAccess.tourStep === 0;
  document.querySelector("#tour-next").textContent =
    paidAccess.tourStep === TOUR_STEPS.length - 1 ? "Finish" : "Next";
}

function endTour(finished) {
  document.querySelector("#tour").hidden = true;
  paidAccess.tourStep = -1;
  if (!finished) {
    announce("Tour closed. Replay it anytime with the Tour button.");
    return;
  }
  if (paidAccess.unlocked) {
    state.preferences = { tourCompleted: true };
    flushServerSync();
  } else {
    try {
      localStorage.setItem("reki-web-tour-done", "1");
    } catch {
      /* Preview choice is best-effort. */
    }
  }
  announce("Tour finished. Your routine is ready.");
}

// ---------- price card states ----------

function updatePriceCardMember(until) {
  const button = document.querySelector("#beta-button");
  const note = document.querySelector(".checkout-note");
  if (button) {
    button.innerHTML = `Open your tracker ${icon("arrow")}`;
  }
  if (note) {
    note.textContent = `Membership active until ${fmtDate(until)}. Manage in Whop.`;
  }
}

function updatePriceCardRenew() {
  const button = document.querySelector("#beta-button");
  const note = document.querySelector(".checkout-note");
  if (button) {
    button.innerHTML = `Renew membership — $15 ${icon("arrow")}`;
  }
  if (note) {
    note.textContent = "Membership paused. Renew to keep tracking.";
  }
}

// ---------- boot ----------

async function refreshAccess() {
  const me = await paidFetch("/api/me?refresh=1");
  paidAccess.me = me;
  const statusEl = document.querySelector("#storage-status");
  if (!me?.signedIn) {
    paidAccess.unlocked = false;
    paidAccess.locked = false;
    const authLink = document.querySelector("#auth-link");
    if (authLink) authLink.textContent = "Sign in";
    render();
    return me;
  }
  const authLink = document.querySelector("#auth-link");
  if (authLink) authLink.textContent = "Sign out";
  if (me.access?.active) {
    paidAccess.unlocked = true;
    paidAccess.locked = false;
    hideBanner();
    if (statusEl)
      statusEl.textContent = `Signed in · access until ${fmtDate(me.access.expiresAt)} · backed up`;
    updatePriceCardMember(me.access.expiresAt);
    render();
  } else {
    paidAccess.unlocked = false;
    paidAccess.locked = true;
    if (statusEl) statusEl.textContent = "Membership paused · history kept";
    updatePriceCardRenew();
    showExpiredBanner();
    render();
  }
  return me;
}

async function initPaidAccess() {
  const params = new URLSearchParams(window.location.search);
  const accessParam = params.get("access");
  if (accessParam === "active" || accessParam === "pending") {
    params.delete("access");
    const clean =
      window.location.pathname +
      (params.toString() ? `?${params}` : "") +
      window.location.hash;
    window.history.replaceState(null, "", clean);
  }
  const cfg = await paidFetch("/api/config");
  if (!cfg) return; // static preview without backend
  paidAccess.checkoutUrl =
    typeof cfg.checkoutUrl === "string" ? cfg.checkoutUrl : "";
  paidAccess.billing = cfg.billing || null;
  const note = document.querySelector(".checkout-note");
  if (note && paidAccess.checkoutUrl)
    note.textContent =
      "Secure checkout via Whop. $15 now, then $15 every 30 days.";
  const me = await paidFetch("/api/me?refresh=1");
  paidAccess.me = me;
  const authLink = document.querySelector("#auth-link");
  const statusEl = document.querySelector("#storage-status");
  if (!me?.signedIn) {
    if (authLink) authLink.textContent = "Sign in";
    if (accessParam === "pending" || accessParam === "active")
      showSigninBanner();
    return;
  }
  if (authLink) authLink.textContent = "Sign out";
  if (me.access?.active) {
    paidAccess.unlocked = true;
    paidAccess.locked = false;
    if (statusEl)
      statusEl.textContent = `Signed in · access until ${fmtDate(me.access.expiresAt)} · backed up`;
    updatePriceCardMember(me.access.expiresAt);
    const hasLocalWork = !state.demo;
    const adopted = await adoptServerState("");
    if (!adopted) {
      if (state.demo) {
        // Fresh member: start clean, not with sample data.
        state = {
          demo: false,
          supplements: [],
          days: {},
          preferences: { tourCompleted: false },
        };
      }
      paidAccess.revision = 0;
      await flushServerSync();
      // Re-read: a 409 means another device won; adopt it instead.
      await adoptServerState("");
      render();
    } else if (hasLocalWork) {
      announce("Your saved stack is loaded.");
    }
    // The banner follows the verified response, never the URL alone.
    if (accessParam === "active") {
      showWelcomeBanner(me.access.expiresAt);
      if (!tourCompleted()) {
        setTimeout(() => {
          if (paidAccess.bannerMode === "welcome" && !tourCompleted())
            startTour();
        }, 600);
      }
    }
  } else {
    paidAccess.unlocked = false;
    paidAccess.locked = true;
    if (statusEl) statusEl.textContent = "Membership paused · history kept";
    updatePriceCardRenew();
    if (accessParam === "active" || accessParam === "pending")
      announce("No active purchase found for this account yet.");
    showExpiredBanner();
    render();
  }
}

const localSave = save;
save = function saveAndSync() {
  localSave();
  queueServerSync();
};

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.id === "tour-replay") {
    hideBanner();
    startTour();
    return;
  }
  if (target.id === "tour-back" && paidAccess.tourStep > 0) {
    paidAccess.tourStep -= 1;
    renderTourStep();
    return;
  }
  if (target.id === "tour-next" && paidAccess.tourStep >= 0) {
    if (paidAccess.tourStep === TOUR_STEPS.length - 1) endTour(true);
    else {
      paidAccess.tourStep += 1;
      renderTourStep();
    }
    return;
  }
  if (target.id === "tour-skip" || target.id === "tour-close") {
    endTour(false);
    return;
  }
  if (target.id === "banner-tour") {
    startTour();
    return;
  }
  if (target.id === "banner-dismiss") {
    hideBanner();
    return;
  }
  if (target.id === "banner-signin") {
    window.location.href = `/api/auth/whop/start?next=${encodeURIComponent("/#tracker")}`;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || paidAccess.tourStep < 0) return;
  endTour(false);
});

initPaidAccess();
