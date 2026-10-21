import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const routes = [
  "/",
  "/pricing",
  "/partners",
  "/contact",
  "/terms",
  "/privacy",
  "/docs",
  ...[
    "quickstart",
    "api-reference",
    "sdks",
    "payment-intents",
    "payment-methods",
    "webhooks",
    "provider-integration",
    "settlement",
    "errors",
  ].map((s) => "/docs/" + s),
];
test("every route renders; internal links, assets and page metadata resolve", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const links = new Set<string>();
  const titles = new Set<string>();
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    const title = await page.title();
    expect(titles.has(title), title).toBe(false);
    titles.add(title);
    expect(
      await page.locator('meta[name="description"]').getAttribute("content"),
    ).toBeTruthy();
    for (const h of await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") || "")))
      if (h.startsWith("/") && !h.includes("#")) links.add(h);
    // Below-the-fold photos load lazily; scroll so every image is requested.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await page
      .waitForFunction(() =>
        [...document.images].every((i) => i.complete),
      )
      .catch(() => {});
    expect(
      await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.every(
            (i) =>
              (i as HTMLImageElement).complete &&
              (i as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    ).toBe(true);
  }
  for (const h of links) expect((await request.get(h)).status(), h).toBe(200);
  expect(errors).toEqual([]);
});
test("header menus list real pages, and the menu works on mobile", async ({ page }) => {
  const { navLinks, navMenus, paths } = await import("../../lib/site-config");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const menu of navMenus) {
    await nav.getByRole("button", { name: menu.label }).click();
    const panel = page.getByRole("region", { name: menu.label });
    for (const item of menu.groups.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/#")).toBe(false);
      await expect(panel.getByRole("link", { name: new RegExp(item.label) })).toHaveAttribute("href", item.href);
      if (item.href.startsWith("/")) expect((await page.request.get(item.href.split("#")[0])).status(), item.href).toBe(200);
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
  for (const [href, label] of navLinks) await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  const header = page.locator("header.mk-header");
  await expect(header.getByRole("link", { name: "Get started", exact: true })).toHaveAttribute("href", paths.signUp);
  await expect(header.getByRole("link", { name: "Create a payment link" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("navigation", { name: "Menu" });
  await menu.getByRole("button", { name: "Platform" }).click();
  await menu.getByRole("link", { name: /Pay with credit/ }).click();
  await expect(page).toHaveURL(/\/credit$/);
  await expect(menu).toHaveCount(0);
});
test("docs searches real content and copies code", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs");
  await page
    .getByRole("searchbox", { name: "Search documentation" })
    .fill("objectVersion");
  await expect(
    page
      .getByRole("navigation", { name: "Documentation search results" })
      .getByRole("link", { name: "Webhooks" }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("zzzznoresults");
  await expect(page.getByText("No results.", { exact: false })).toBeVisible();
  await page.goto("/docs/quickstart");
  await page.getByRole("button", { name: "Copy code" }).first().click();
  await expect(page.locator(".copy-status").first()).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "new PayRouta(",
  );
});
test("CTA intents, validation and unconfigured state", async ({ page }) => {
  for (const intent of ["merchant", "pricing", "general"]) {
    await page.goto("/contact?intent=" + intent);
    await expect(page.getByLabel("I’m interested in")).toHaveValue(intent);
  }
  // Providers are sent to the reviewed access request instead.
  await page.goto("/contact?intent=provider");
  await expect(page).toHaveURL(/\/partners#request$/);
  await page.goto("/contact?intent=invalid");
  await expect(page.getByLabel("I’m interested in")).toHaveValue("general");
  await page.getByRole("button", { name: "Check enquiry" }).click();
  await expect(
    page.getByText("Enter your name.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Example Person");
  await page.getByLabel("Work email").fill("test@example.com");
  await page.getByLabel("Company", { exact: true }).fill("Example Company");
  await page.getByLabel("Country / region").fill("Nigeria");
  await page
    .getByLabel("How can we help?")
    .fill("We are testing the local validation.");
  await page.getByRole("button", { name: "Check enquiry" }).click();
  await expect(page.getByRole("status")).toContainText("has not been sent");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Example Person",
  );
});
test("provider access is requested, not self-serve", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Partners" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /Request provider access/ }).click();
  await expect(page).toHaveURL(/\/partners#request$/);
  await page
    .getByRole("button", { name: "Request provider access" })
    .click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(
    page.getByText("Choose at least one payment method."),
  ).toBeVisible();
  const signUp = await page.request.get("/provider/sign-up", {
    maxRedirects: 0,
  });
  expect(signUp.status()).toBe(307);
  expect(signUp.headers().location).toContain("/partners#request");
});
test("responsive overflow and accessibility across all routes", async ({
  page,
}) => {
  test.setTimeout(180000);
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${width}: ${route}`,
      ).toBe(true);
    }
  }
  for (const route of [
    "/",
    "/pricing",
    "/terms",
    "/docs/quickstart",
    "/contact",
  ]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, route).toEqual([]);
  }
});
test("reduced motion, 200% text and screenshots", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/", "/pricing", "/docs/quickstart", "/contact"]) {
      await page.goto(route);
      await page.screenshot({
        path: `test-results/review-${width}-${route.replaceAll("/", "-") || "home"}.png`,
        fullPage: true,
      });
      await page.addStyleTag({ content: "html {font-size:200%}" });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `200% ${width}: ${route}`,
      ).toBe(true);
    }
  }
});

test("configured enquiry confirms acceptance, preserves failures and reuses retry references", async ({
  page,
}) => {
  const ids: string[] = [];
  let accepted = false;
  await page.route("**/api/enquiries", async (route) => {
    ids.push(route.request().postDataJSON().submissionId);
    await route.fulfill({
      status: accepted ? 200 : 502,
      contentType: "application/json",
      body: JSON.stringify({
        ok: accepted,
        message: accepted
          ? "Your enquiry was accepted for delivery."
          : "Delivery was not confirmed. Please try again.",
      }),
    });
  });
  await page.goto("http://127.0.0.1:3001/contact?intent=merchant");
  await page.getByLabel("Name", { exact: true }).fill("Example Person");
  await page.getByLabel("Work email").fill("test@example.com");
  await page.getByLabel("Company", { exact: true }).fill("Example Company");
  await page.getByLabel("Country / region").fill("Nigeria");
  await page
    .getByLabel("How can we help?")
    .fill("This is a controlled browser test.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("status")).toContainText("not confirmed");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Example Person",
  );
  accepted = true;
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("status")).toContainText("accepted for delivery");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(
    page.getByRole("button", { name: "Send enquiry" }),
  ).toBeDisabled();
});

test("permanent migrations preserve queries and parents stay absent", async ({
  request,
  page,
}) => {
  const { legacyRedirects } = await import("../../lib/site-config");
  for (const r of legacyRedirects) {
    const response = await request.get(r.source + "?intent=provider", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    const destination = new URL(
      response.headers().location,
      "http://127.0.0.1:3000",
    );
    expect(destination.pathname).toBe(r.destination);
    expect(destination.searchParams.get("intent")).toBe("provider");
    expect(
      (await request.get(destination.href, { maxRedirects: 0 })).status(),
    ).toBe(200);
  }
  for (const path of ["/platform", "/solutions"])
    expect((await request.get(path)).status()).toBe(404);
  await page.goto("/terms");
  for (const id of ["scope", "fees", "risk", "law"]) {
    await page.locator(`a[href="#${id}"]`).click();
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  for (const route of routes) {
    await page.goto(route);
    const links = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const r of legacyRedirects) expect(links).not.toContain(r.source);
  }
});

test("marketing editorial review screenshots", async ({ page }) => {
  const { primaryRoutes } = await import("../../lib/site-config");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path] of primaryRoutes) {
      await page.goto(path);
      await page.screenshot({
        path: `test-results/editorial-${width}-${path.replaceAll("/", "-") || "home"}.png`,
        fullPage: true,
      });
      const copy = await page.locator("main").innerText();
      expect(copy).not.toMatch(
        /revolutionary|game-changing|next-generation|cutting-edge|seamless|frictionless|unlock|empower|supercharge|leverage|future-proof|enterprise-grade|intelligent|AI-powered/i,
      );
      await expect(
        page.locator(
          "main .badge, main .capability-tags, main .large-number",
        ),
      ).toHaveCount(0);
    }
  }
});
