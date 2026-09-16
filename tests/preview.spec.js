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

test("records real ratings, edits today without double-counting", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "How I feel", exact: true }).click();
  await expect(
    page.getByText("Your first check-in starts the story."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check in with yourself" }).click();
  for (const [name, value] of [
    ["energy", 4],
    ["sleep", 3],
    ["mood", 5],
  ]) {
    await page.locator(`input[name="${name}"][value="${value}"]`).check();
  }
  await page.getByRole("button", { name: "Save my check-in" }).click();
  await expect(page.locator(".metric-grid")).toContainText("4.0");
  await expect(page.locator(".metric-grid")).toContainText("3.0");
  await expect(page.locator(".metric-grid")).toContainText("5.0");
  await page.getByRole("button", { name: "Edit today's check-in" }).click();
  await page.locator('input[name="energy"][value="2"]').check();
  await page.getByRole("button", { name: "Save my check-in" }).click();
  await expect(page.locator(".averages-caption")).toContainText(
    "1 recorded day",
  );
  await expect(page.locator(".metric-grid")).toContainText("2.0");
  await page.reload();
  await page.getByRole("tab", { name: "How I feel", exact: true }).click();
  await expect(page.locator(".metric-grid")).toContainText("2.0");
});

test("keeps the proposed purchase honest and disconnected", async ({
  page,
}) => {
  await expect(page.locator(".price")).toContainText("3.99");
  await expect(page.locator(".price-period")).toContainText("for one month");
  await expect(page.locator(".price-subtitle")).toContainText(
    "No automatic renewal",
  );
  await expect(page.locator(".terms-note")).toContainText(
    "Access ends after one month",
  );
  await expect(page.locator("#app")).not.toContainText(/lifetime|\$19/i);
  await page.getByRole("button", { name: "Get one month for $3.99" }).click();
  await expect(
    page.getByRole("dialog", { name: "A little early. A lot to come." }),
  ).toContainText("not taking payments yet");
  await expect(
    page.getByRole("dialog", { name: "A little early. A lot to come." }),
  ).toContainText("no automatic renewal");
  await page.getByRole("button", { name: "Back to my routine" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
