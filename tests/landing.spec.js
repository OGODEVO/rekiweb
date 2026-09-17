import { test, expect } from "@playwright/test";

const checkout = "https://whop.com/checkout/ch_mMNbh5gIMIjL09n/";
const config = {
  checkoutConfigured: true,
  checkoutUrl: checkout,
  authConfigured: true,
};
const active = {
  signedIn: true,
  user: { id: "user_buyer", name: "Buyer" },
  csrfToken: "test",
  access: { active: true, status: "active", expiresAt: "2099-01-01T00:00:00Z" },
};
const empty = {
  demo: false,
  supplements: [],
  days: {},
  preferences: { tourCompleted: true },
};

async function setup(
  page,
  me = { signedIn: false, access: { active: false } },
) {
  await page.route("**/api/config", (route) => route.fulfill({ json: config }));
  await page.route("**/api/me**", (route) => route.fulfill({ json: me }));
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: { state: empty, revision: 1 } }),
  );
  await page.goto("/#tracker");
}

test("explains first action, free/member boundary, monthly tax, and legal routes", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator("#preview-intro")).toContainText(
    "Start with one supplement",
  );
  await expect(page.locator("#storage-status")).toHaveText(
    "Saved in this browser only",
  );
  const comparison = page.getByRole("table");
  await expect(comparison).toContainText("This browser only");
  await expect(comparison).toContainText("Your Reki Web account");
  await expect(page.locator("#billing-disclosure")).toContainText(
    "Tax added at checkout",
  );
  await expect(page.locator("#app")).not.toContainText(
    /every 30 days|checkout is not enabled here|\$15\.90|money-back guarantee\s+included/i,
  );
  await page.locator("summary").filter({ hasText: "Do I need a card to try it?" }).click();
  await expect(page.locator("details[open]")).toContainText(
    "no account or card needed",
  );
  await expect(page.locator(".after-join")).toContainText(
    "same email you paid with",
  );
  for (const section of ["terms", "privacy", "refunds"]) {
    const response = await page.request.get(`/legal.html#${section}`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`id="${section}"`);
  }
  await expect(
    page
      .getByRole("navigation", { name: "Legal information" })
      .getByRole("link"),
  ).toHaveCount(3);
});

test("introduces paid account saving after a first meaningful preview action", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator("#save-moment")).toBeHidden();
  await page
    .getByRole("button", { name: "Mark Vitamin D3 taken", exact: true })
    .click();
  await expect(page.locator("#save-moment")).toBeVisible();
  await page
    .getByRole("button", { name: "Keep this record across devices" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Your routine, beyond this browser." }),
  ).toContainText("$4.99 USD per month, plus applicable tax");
  await page
    .getByRole("button", { name: "Keep using this browser for free" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Mark Vitamin D3 not taken",
      exact: true,
    }),
  ).toBeVisible();
});

test("free tour does not promise account backups", async ({ page }) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Show me around", exact: true })
    .click();
  await expect(page.locator("#tour-text")).toContainText(
    "free preview saves in this browser",
  );
  await expect(page.locator("#tour-text")).not.toContainText(
    "Your membership is active",
  );
});

test("fresh access check prevents another checkout for an active member", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/me**", (route) => route.fulfill({ json: active }));
  let checkouts = 0;
  await page.route(checkout, (route) => {
    checkouts++;
    return route.fulfill({ body: "Unexpected checkout" });
  });
  await page.locator("#beta-button").click();
  await expect(page.locator("#checkout-status")).toContainText(
    "no new purchase needed",
  );
  await expect(page.locator("#demo-badge")).toContainText("MEMBER STACK");
  expect(checkouts).toBe(0);
});

test("checkout checks auth, disables repeat clicks and navigates the same tab", async ({
  page,
  context,
}) => {
  await setup(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me**", async (route) => {
    await gate;
    await route.fulfill({
      json: { signedIn: false, access: { active: false } },
    });
  });
  await page.route(checkout, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Test Whop checkout</h1>",
    }),
  );
  await page.locator("#beta-button").click();
  await expect(page.locator("#beta-button")).toBeDisabled();
  await expect(page.locator("#checkout-status")).toContainText(
    "Checking access",
  );
  release();
  await expect(page).toHaveURL(checkout);
  expect(context.pages()).toHaveLength(1);
});

test("failed and pending verification never send someone to buy again", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/me**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.locator("#beta-button").click();
  await expect(page.locator("#checkout-status")).toContainText(
    "no checkout was opened",
  );
  await expect(page.locator("#beta-button")).toBeEnabled();
  await page.route("**/api/me**", (route) =>
    route.fulfill({
      json: {
        ...active,
        access: {
          active: false,
          status: "verification_pending",
          verificationPending: true,
        },
      },
    }),
  );
  await page.locator("#beta-button").click();
  await expect(page.locator("#checkout-status")).toContainText(
    "no checkout was opened",
  );
  expect(page.url()).toContain("127.0.0.1");
});

test("member restore does not leak its record into free preview storage", async ({
  page,
}) => {
  const accountRecord = {
    ...empty,
    supplements: [
      {
        id: "private",
        name: "Private record",
        detail: "",
        time: "Anytime",
        color: "peach",
      },
    ],
  };
  await setup(page, active);
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: { state: accountRecord, revision: 4 } }),
  );
  await page.reload();
  await expect(page.locator("#tracker-content")).toContainText(
    "Private record",
  );
  expect(
    await page.evaluate(
      () => localStorage.getItem("reki-web-preview-v1") || "",
    ),
  ).not.toContain("Private record");
});

test("preview import is explicit and cannot overwrite an existing account", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Mark Vitamin D3 taken", exact: true })
    .click();
  await page.route("**/api/me**", (route) => route.fulfill({ json: active }));
  const writes = [];
  await page.route("**/api/state", (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, revision: 2 } });
    }
    return route.fulfill({ json: { state: empty, revision: 1 } });
  });
  await page.reload();
  await expect(page.locator("#import-preview")).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.locator("#import-preview").click();
  await page
    .getByRole("button", { name: "Import my preview", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].revision).toBe(1);
  expect(writes[0].state.supplements[0].name).toBe("Vitamin D3");
  await expect(page.locator("#import-preview")).toBeHidden();
});

test("comparison and pricing fit mobile without horizontal overflow", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.locator("#membership-difference").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/landing-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
