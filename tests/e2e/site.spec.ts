import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const routes = [
  "/",
  "/platform/payment-flow",
  "/platform/provider-routing",
  "/platform/settlement",
  "/platform/payment-methods",
  "/solutions/merchants",
  "/solutions/providers",
  "/developers",
  "/solutions/use-cases",
  "/pricing",
  "/about",
  "/contact",
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
test("desktop navigation supports keyboard and Escape focus restoration", async ({
  page,
}) => {
  await page.goto("/");
  const product = page.getByRole("button", { name: "Platform", exact: true });
  await product.focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Payment Flow" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(product).toBeFocused();
  await expect(product).toHaveAttribute("aria-expanded", "false");
});
test("mobile navigation opens, closes and routes correctly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Solutions", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "For Providers" })
    .click();
  await expect(page).toHaveURL(/providers/);
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toHaveAttribute("aria-expanded", "false");
});
test("demo completes, resets, changes scenario and rejects stale timers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Bank transfer Available" }).click();
  await page
    .getByRole("button", { name: "Simulate payment", exact: true })
    .click();
  await expect(
    page.getByText("Simulated settlement complete in NGN."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset routing demo" }).click();
  await expect(
    page.getByRole("button", { name: "Simulate payment", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Stablecoins Available" }).click();
  await page
    .getByRole("button", { name: "Simulate payment", exact: true })
    .click();
  await page.getByLabel("Scenario", { exact: true }).selectOption("1");
  await expect(page.getByText("Choose a payment method above.")).toBeVisible();
  await expect(page.getByText("Ready when you choose.")).toBeVisible();
});
test("docs searches real content and copies code", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs");
  await page
    .getByRole("searchbox", { name: "Search documentation" })
    .fill("out-of-order");
  await expect(
    page
      .getByRole("navigation", { name: "Documentation", exact: true })
      .getByRole("link", { name: "Webhooks" }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("zzzznoresults");
  await expect(page.getByText("No results.", { exact: false })).toBeVisible();
  await page.goto("/docs/quickstart");
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.locator(".copy-status")).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "accepted_methods",
  );
});
test("CTA intents, validation and unconfigured state", async ({ page }) => {
  for (const intent of ["merchant", "provider", "pricing", "general"]) {
    await page.goto("/contact?intent=" + intent);
    await expect(page.getByLabel("I’m interested in")).toHaveValue(intent);
  }
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
    "/platform/payment-methods",
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
test("reduced motion, 200% text, filter and screenshots", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Bank transfer Available" }).click();
  await page
    .getByRole("button", { name: "Simulate payment", exact: true })
    .click();
  await expect(
    page.getByText("Simulated settlement complete in NGN."),
  ).toBeVisible();
  await page.goto("/platform/payment-methods");
  await page
    .getByRole("button", { name: "Digital assets", exact: true })
    .click();
  await expect(page.locator(".method-detail")).toHaveCount(2);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/",
      "/platform/payment-flow",
      "/docs/quickstart",
      "/contact",
    ]) {
      await page.goto(route);
      await page.screenshot({
        path: `test-results/review-${width}-${route.replaceAll("/", "-") || "home"}.png`,
        fullPage: true,
      });
      await page.addStyleTag({ content: "html {font-size:200%}" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
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
  await page.goto("/platform/payment-flow");
  for (const id of ["availability", "checkout", "execution", "settlement"]) {
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

test("new menu hierarchy works on desktop and mobile", async ({ page }) => {
  const { navigationGroups } = await import("../../lib/site-config");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const group of navigationGroups) {
      await page.goto("/");
      if (width === 390)
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("button", { name: group.title, exact: true })
        .click();
      for (const [href, label] of group.links)
        await expect(
          page
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("link", { name: label, exact: true }),
        ).toHaveAttribute("href", href);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: group.title, exact: true }),
      ).toBeFocused();
    }
    await expect(
      page.getByRole("button", { name: "Company", exact: true }),
    ).toHaveCount(0);
  }
});

test("marketing editorial review screenshots", async ({ page }) => {
  const { primaryRoutes } = await import("../../lib/site-config");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path] of primaryRoutes.filter(([p]) => p !== "/docs")) {
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
          "main .eyebrow, main .badge, main .status-mark, main .capability-tags, main .large-number",
        ),
      ).toHaveCount(0);
    }
  }
});
