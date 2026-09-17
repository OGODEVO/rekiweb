import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("loads local brand assets, stays on screen and has no runtime errors", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your supplements.",
  );
  await expect(
    page.getByText("INTERACTIVE PREVIEW · SAMPLE STACK"),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/reki-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("checks and unchecks a dose, preserving state after reload", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Mark Vitamin D3 taken", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Mark Vitamin D3 not taken",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Mark Vitamin D3 not taken", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});

test("starts a personal stack, edits it and removes it with confirmation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Make it yours" }).click();
  await page.getByRole("button", { name: "Start my own stack" }).click();
  const editor = page.getByRole("dialog", { name: "A new little habit." });
  await editor.getByLabel("Supplement name").fill("My Vitamin C");
  await editor.getByLabel("Your serving note").fill("With breakfast");
  await editor.getByLabel("When do you take it?").selectOption("Anytime");
  await editor.getByRole("button", { name: "Save to my stack" }).click();
  await expect(page.getByText("YOUR LOCAL STACK")).toBeVisible();
  await expect(page.locator("#tracker-content")).toContainText("My Vitamin C");
  await expect(page.locator("#tracker-content")).not.toContainText(
    "Vitamin D3",
  );
  await page.getByRole("button", { name: "Edit My Vitamin C" }).click();
  await page.getByLabel("Supplement name").fill("Vitamin C updated");
  await page.getByRole("button", { name: "Save to my stack" }).click();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Mark Vitamin C updated taken",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "My stack", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove Vitamin C updated", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Remove this supplement?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove from my stack", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your routine starts here." }),
  ).toBeVisible();
});

test("records real ratings and writes honest stack reads", async ({ page }) => {
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  await expect(page.getByText("No stack reads yet.")).toBeVisible();
  await page.getByRole("button", { name: "Check in with yourself" }).click();
  for (const [name, value] of [
    ["energy", 4],
    ["sleep", 3],
    ["mood", 5],
  ]) {
    await page.locator(`input[name="${name}"][value="${value}"]`).check();
  }
  await page.getByRole("button", { name: "Save my check-in" }).click();
  await expect(
    page.getByText("Keep logging for a few more days"),
  ).toHaveCount(3);
  await expect(page.locator("#tracker-content")).toContainText("1 feel day");
  await expect(page.locator("#tracker-content")).toContainText(
    "not medical proof",
  );
  await page.getByRole("button", { name: "Edit today's check-in" }).click();
  await page.locator('input[name="energy"][value="2"]').check();
  await page.getByRole("button", { name: "Save my check-in" }).click();
  await expect(
    page.getByText("Keep logging for a few more days"),
  ).toHaveCount(3);
  await page.reload();
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  await expect(
    page.getByText("Keep logging for a few more days"),
  ).toHaveCount(3);
});

test("compares taken and skipped days without inventing verdicts", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-16T12:00:00") });
  await page.evaluate(() => {
    const days = {};
    const base = new Date(2026, 8, 10);
    for (let n = 0; n < 7; n++) {
      const d = new Date(base);
      d.setDate(d.getDate() + n);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days[key] = {
        taken: n < 5 ? ["d3"] : [],
        checkin: {
          energy: n < 5 ? 5 : 2,
          sleep: 3,
          mood: 3,
        },
      };
    }
    localStorage.setItem(
      "reki-web-preview-v1",
      JSON.stringify({ demo: true, supplements: [], days }),
    );
  });
  await page.reload();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("reki-web-preview-v1"));
    saved.supplements = [
      {
        id: "d3",
        name: "D3Test",
        detail: "1",
        time: "Morning",
        color: "peach",
      },
    ];
    localStorage.setItem("reki-web-preview-v1", JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  await expect(
    page.getByText("Energy looks better on days you took it"),
  ).toBeVisible();
  await expect(page.locator("#tracker-content")).toContainText(
    "Still a pattern, not proof.",
  );
});

test("keeps the proposed purchase honest and disconnected", async ({
  page,
}) => {
  await expect(page.locator(".price")).toContainText("15");
  await expect(page.locator(".price-period")).toContainText("every 30 days");
  await expect(page.locator(".price-subtitle")).toContainText(
    "Cancel anytime in Whop",
  );
  await expect(page.locator(".terms-note")).toContainText(
    "$15 USD now, then $15 every 30 days",
  );
  await expect(page.locator("#app")).not.toContainText(
    /lifetime|\$19|\$3\.99|for one month/i,
  );
  await page.getByRole("button", { name: "Start my membership — $15" }).click();
  await expect(
    page.getByRole("dialog", { name: "A little early. A lot to come." }),
  ).toContainText("not taking payments yet");
  await page.getByRole("button", { name: "Back to my routine" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

const paidConfig = {
  checkoutConfigured: true,
  checkoutUrl: "https://whop.com/checkout/ch_mMNbh5gIMIjL09n/",
  authConfigured: true,
  billing: { price: 15, currency: "USD", intervalDays: 30 },
  productTitle: "Reki Web",
};

const activeMe = {
  signedIn: true,
  user: { id: "user_test", name: "Tester" },
  csrfToken: "csrf_test",
  access: {
    active: true,
    expiresAt: "2026-10-16T00:00:00.000Z",
    status: "active",
  },
};

test("welcomes verified members with a banner and Reki tour", async ({
  page,
}) => {
  const puts = [];
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: paidConfig }),
  );
  await page.route("**/api/me**", (route) => route.fulfill({ json: activeMe }));
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON());
      const rev = route.request().postDataJSON().revision || 0;
      return route.fulfill({
        json: {
          ok: true,
          revision: rev + 1,
          updatedAt: "2026-09-16T00:00:00.000Z",
        },
      });
    }
    return route.fulfill({
      json: { state: null, revision: 0, updatedAt: null },
    });
  });
  await page.goto("/?access=active#tracker");
  const banner = page.locator("#member-banner");
  await expect(banner).toContainText("You're in");
  await expect(banner).toContainText("Membership active until");
  const tour = page.locator("#tour");
  await expect(tour).toBeVisible({ timeout: 10000 });
  await expect(tour).toContainText("1 of 4");
  await expect(tour.locator("#tour-image")).toHaveAttribute(
    "src",
    "/assets/reki-waving.webp",
  );
  await tour.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tour).toContainText("2 of 4");
  await expect(tour.locator("#tour-image")).toHaveAttribute(
    "src",
    "/assets/reki-pointing.webp",
  );
  await tour.getByRole("button", { name: "Next", exact: true }).click();
  await tour.getByRole("button", { name: "Next", exact: true }).click();
  await expect(tour).toContainText("4 of 4");
  await tour.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(tour).toBeHidden();
  const finishPut = puts.find(
    (p) => p.state?.preferences?.tourCompleted === true,
  );
  expect(finishPut).toBeTruthy();
  await expect(page.locator("#demo-badge")).toContainText("MEMBER STACK");
});

test("locks expired members read-only with export and renew", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: paidConfig }),
  );
  await page.route("**/api/me**", (route) =>
    route.fulfill({
      json: {
        signedIn: true,
        user: { id: "user_test", name: "Tester" },
        csrfToken: "csrf_test",
        access: {
          active: false,
          expiresAt: "2026-08-01T00:00:00.000Z",
          status: "expired",
        },
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("#member-banner")).toContainText(
    "Membership paused",
  );
  await expect(page.locator('#member-banner a[href="#pricing"]')).toContainText(
    "Renew — $15",
  );
  await expect(
    page.locator('#member-banner a[href="/api/export"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark Vitamin D3 taken", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".locked-card")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Renew membership — $15" }),
  ).toBeVisible();
});

test("asks signed-out buyers to sign in to link purchase", async ({ page }) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: paidConfig }),
  );
  await page.route("**/api/me**", (route) =>
    route.fulfill({ json: { signedIn: false, access: { active: false } } }),
  );
  await page.goto("/?access=pending#tracker");
  await expect(page.locator("#member-banner")).toContainText(
    "Bought Reki Web?",
  );
});

test("supports keyboard tab navigation and escape from dialogs", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Today", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "My stack", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "My stack", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Add a supplement", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("suggests supplements from the built-in directory", async ({ page }) => {
  await page.getByRole("tab", { name: "My stack", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a supplement", exact: true })
    .first()
    .click();
  const name = page.getByLabel("Supplement name");
  await name.fill("mag");
  const listbox = page.getByRole("listbox", { name: "Matching supplements" });
  await expect(listbox).toBeVisible();
  await expect(listbox).toContainText("Magnesium Glycinate");
  await name.press("ArrowDown");
  await name.press("Enter");
  await expect(name).toHaveValue("Magnesium Glycinate");
  await expect(page.getByLabel("Your serving note")).toHaveValue("1 capsule");
  await expect(page.getByLabel("When do you take it?")).toHaveValue("Evening");
  await page.getByRole("button", { name: "Save to my stack" }).click();
  await expect(page.locator("#tracker-content")).toContainText(
    "Magnesium Glycinate",
  );
});

test("renders user text safely", async ({ page }) => {
  await page.getByRole("tab", { name: "My stack", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a supplement", exact: true })
    .first()
    .click();
  const payload = "<img src=x onerror=alert(1)>";
  await page.getByLabel("Supplement name").fill(payload);
  await page.getByRole("button", { name: "Save to my stack" }).click();
  await expect(page.locator(".supplement-copy").last()).toContainText(payload);
  await expect(page.locator("#tracker-content img")).toHaveCount(0);
});

test("handles invalid storage without crashing", async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem("reki-web-preview-v1", '{"days":null}'),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A little care, daily." }),
  ).toBeVisible();
  await expect(
    page.getByText("Saving unavailable in this browser"),
  ).toBeVisible();
});

test("handles blocked storage and keeps the session usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Mark Vitamin D3 taken", exact: true })
    .click();
  await expect(
    page.getByText("Saving unavailable in this browser"),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
});

test("starts a fresh daily checklist after midnight and retains check-ins", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-16T23:59:00") });
  await page.reload();
  await page
    .getByRole("button", { name: "Mark Vitamin D3 taken", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.clock.fastForward(90000);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  const days = await page.evaluate(
    () => JSON.parse(localStorage.getItem("reki-web-preview-v1")).days,
  );
  expect(days["2026-09-16"].taken).toContain("d3");
});
