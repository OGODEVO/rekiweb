import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/nunito-sans/latin-800.css";
import "./style.css";

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
          <div class="tracker-bottom"><span>${icon("lock")} <span id="storage-status"></span></span><button class="text-button" id="start-own">Make it yours ${icon("arrow")}</button></div>
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
      <div class="price-story"><span class="eyebrow">A LITTLE INVESTMENT IN YOUR ROUTINE</span><h2 id="price-title">Less overthinking.<br>More showing up.</h2><p>A browser tracker with a familiar face.<br>Try one month. No automatic renewal.<br>Just you, your stack, and a fresh start each day.</p><img class="waving-reki" src="/assets/reki-waving.webp" alt="Reki smiling and waving" width="480" height="1014" loading="lazy"><span class="mascot-signature">see you tomorrow.</span></div>
      <div class="price-card"><span class="offer-label">REKI WEB · ONE-MONTH BETA</span><div class="price"><span class="currency">$</span>3.99<span class="price-period">USD<br>for one month</span></div><p class="price-subtitle">Pay once for one month. No automatic renewal.</p><ul><li>${icon("check")} Your supplement stack & serving notes</li><li>${icon("check")} Daily check-offs & morning / evening schedule</li><li>${icon("check")} Energy, sleep & mood check-ins</li><li>${icon("check")} One month of core web tracker access</li></ul><button class="button button-dark price-button" id="beta-button">Get one month for $3.99 ${icon("arrow")}</button><p class="checkout-note">Local preview. Checkout isn't connected yet.</p><p class="terms-note">Access ends after one month. You won't be charged again automatically. AI scanning and iPhone app access are not included.</p></div>
    </section>
    <section class="faq wrap" aria-labelledby="faq-title"><div><span class="eyebrow">A FEW LITTLE DETAILS</span><h2 id="faq-title">Good to know.</h2></div><div class="faq-items">
      <details><summary>Is this the Reki iPhone app?<span>+</span></summary><p>No. Reki Web is a separate browser tracker. This offer does not unlock Reki Pro or any paid features in the iPhone app.</p></details>
      <details><summary>What does this preview save?<span>+</span></summary><p>Your stack, daily check-offs, and check-ins stay in this browser's local storage. Nothing is sent to a server. There is no account, cloud backup, or device sync. Clearing browser data removes your record. Avoid shared devices for personal information.</p></details>
      <details><summary>Can it tell me if my supplements work?<span>+</span></summary><p>It helps you record your routine and notice how you feel over time. Self-reported patterns do not establish that a supplement caused a change. Reki does not diagnose conditions or give medical advice.</p></details>
      <details><summary>Do I need a card to try it?<span>+</span></summary><p>No. The interactive local preview is free to explore without an account or a card. The beta offer is a separate $3.99 purchase for one month of access, with no automatic renewal; checkout is not enabled here.</p></details>
    </div></section>
  </main>
  <footer class="wrap"><a class="brand" href="#"><span>reki<span class="brand-dot">.</span></span><span class="web-label">WEB</span></a><p>A little more mindful. A little more you.</p><a href="mailto:admin@rekisupplement.org">Say hello ${icon("arrow")}</a></footer>
  <dialog id="editor" aria-labelledby="editor-title"><form id="supplement-form"><div class="dialog-heading"><h2 id="editor-title">A new little habit.</h2><button type="button" class="icon-button" data-close aria-label="Close supplement editor">${icon("close")}</button></div><input type="hidden" name="id"><label>Supplement name<input name="name" required maxlength="70" placeholder="e.g. Vitamin D3" autocomplete="off"></label><label>Your serving note<input name="detail" maxlength="100" placeholder="e.g. 1 softgel with breakfast" autocomplete="off"></label><label>When do you take it?<select name="time"><option>Morning</option><option>Evening</option><option>Anytime</option></select></label><p class="form-note">Record your existing routine. Follow your label or clinician's guidance for dosage.</p><button class="button button-coral" type="submit">Save to my stack ${icon("check")}</button></form></dialog>
  <dialog id="checkin" aria-labelledby="checkin-title"><form id="checkin-form"><div class="dialog-heading"><h2 id="checkin-title">How's your day feeling?</h2><button type="button" class="icon-button" data-close aria-label="Close check-in">${icon("close")}</button></div><p class="dialog-intro">No right answer. Just a moment for you.</p>${["energy", "sleep", "mood"].map((metric) => `<fieldset><legend>${metric[0].toUpperCase() + metric.slice(1)}</legend><div class="rating-options">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${metric}" value="${n}" required><span>${n}</span></label>`).join("")}</div><div class="rating-scale"><span>Low</span><span>Great</span></div></fieldset>`).join("")}<button class="button button-coral" type="submit">Save my check-in ${icon("check")}</button></form></dialog>
  <dialog id="start-dialog" aria-labelledby="start-title"><div class="dialog-heading"><h2 id="start-title">Make room for your routine.</h2><button class="icon-button" data-close aria-label="Close start dialog">${icon("close")}</button></div><p>This removes the example stack and any preview check-ins so you can start fresh. Your new entries will stay in this browser only.</p><button class="button button-coral" id="confirm-start">Start my own stack ${icon("arrow")}</button></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title"><div class="dialog-heading"><h2 id="delete-title">Remove this supplement?</h2><button class="icon-button" data-close aria-label="Close removal dialog">${icon("close")}</button></div><p id="delete-description"></p><button class="button button-dark" id="confirm-delete">Remove from my stack</button></dialog>
  <dialog id="beta-dialog" aria-labelledby="beta-title"><div class="dialog-heading"><h2 id="beta-title">A little early. A lot to come.</h2><button class="icon-button" data-close aria-label="Close beta details">${icon("close")}</button></div><p>This is the local Reki Web preview. The $3.99 one-month beta offer is not taking payments yet. It provides one month of access with no automatic renewal. Nothing has been purchased and no account has been created.</p><p>You can keep exploring the working tracker now.</p><button class="button button-coral" data-close>Back to my routine ${icon("arrow")}</button></dialog>
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
  document.querySelector("#demo-badge").textContent = state.demo
    ? "INTERACTIVE PREVIEW · SAMPLE STACK"
    : "YOUR LOCAL STACK";
  document.querySelector("#storage-status").textContent = storageFailed
    ? "Saving unavailable in this browser"
    : "Saved in this browser only";
  document.querySelector("#start-own").hidden = !state.demo;
  const row = (item, isStack) =>
    `<div class="supplement-row"><div class="supplement-symbol ${["peach", "sage", "lavender"].includes(item.color) ? item.color : "peach"}">${icon(item.time === "Evening" ? "moon" : "leaf")}</div><div class="supplement-copy"><strong>${esc(item.name)}</strong><span>${esc(item.detail || "No serving note")}${isStack ? ` · ${esc(item.time)}` : ""}</span></div>${isStack ? `<button class="icon-button" data-edit="${esc(item.id)}" aria-label="Edit ${esc(item.name)}">${icon("edit")}</button><button class="icon-button" data-delete="${esc(item.id)}" aria-label="Remove ${esc(item.name)}">${icon("bin")}</button>` : `<button class="dose-check ${current.taken.includes(item.id) ? "taken" : ""}" data-toggle="${esc(item.id)}" aria-label="Mark ${esc(item.name)} ${current.taken.includes(item.id) ? "not taken" : "taken"}" aria-pressed="${current.taken.includes(item.id)}">${icon("check")}</button>`}</div>`;
  const empty = `<div class="empty-state">${icon("leaf")}<h3>Your routine starts here.</h3><p>Add your first supplement. No perfect stack required.</p><button class="text-button" data-add>${icon("plus")} Add a supplement</button></div>`;
  if (activeTab === "today") {
    panel.innerHTML = `<div class="tracker-greeting"><div><p class="tracker-date">${date}</p><h2>A little care, daily.</h2></div><span class="sun-doodle">${icon("sun")}</span></div><div class="daily-progress"><div><span><strong>${taken}</strong> of ${total} taken today</span><span>${total && taken === total ? "A little win. All done." : "One small step at a time."}</span></div><div class="progress-track" role="progressbar" aria-label="Supplements taken today" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${taken}"><span style="width:${total ? (taken / total) * 100 : 0}%"></span></div></div><div class="schedule">${
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
    panel.innerHTML = `<div class="tracker-greeting"><div><p class="tracker-date">YOUR EVERYDAY ESSENTIALS</p><h2>Make it your own.</h2></div><button class="icon-button add-circle" data-add aria-label="Add a supplement">${icon("plus")}</button></div><p class="panel-description">A home for what you take, and when.</p><div class="stack-list">${total ? state.supplements.map((s) => row(s, true)).join("") : empty}</div>${total ? `<button class="add-stack-button" data-add>${icon("plus")} Add a supplement</button>` : ""}<p class="panel-note">${state.demo ? "These are example entries, not supplement or dosage recommendations." : "Your routine belongs to you. Serving notes are a record, not dosage advice."}</p>`;
  } else {
    const checkins = Object.entries(state.days)
      .filter(([, value]) => value.checkin)
      .sort(([a], [b]) => b.localeCompare(a));
    panel.innerHTML = `<div class="tracker-greeting"><div><p class="tracker-date">A MOMENT TO NOTICE</p><h2>Your days, in feeling.</h2></div>${icon("chart")}</div><p class="panel-description">Personal observations. No scores to chase.</p>${
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
  document.querySelector("#editor").showModal();
  form.elements.name.focus();
}

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
  if (target.id === "beta-button")
    document.querySelector("#beta-dialog").showModal();
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
