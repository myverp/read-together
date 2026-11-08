import { test, expect } from "@playwright/test";

test("home actions, keyboard forms and icons work with corrupt storage and small/zoomed layouts", async ({ page, request }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("read-together:rooms", "broken JSON"); localStorage.setItem("read-together:room", "BAD"); localStorage.setItem("read-together:demo", "bad"); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try demo", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Email", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Have an invitation?", exact: true }).click();
  await expect(page.getByLabel("Room code or invitation link")).toBeFocused();
  await page.getByLabel("Room code or invitation link").fill("invalid invitation"); await page.keyboard.press("Enter");
  await expect(page.getByText(/valid invitation link from this site/)).toBeVisible();
  // End text entry before resizing: WebKit otherwise scrolls the focused
  // invitation field back into view after a viewport change.
  await page.getByLabel("Room code or invitation link").blur();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("button", { name: "Try demo", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 640, height: 450 });
  // Browser text scaling plus a narrow CSS viewport approximates the reflow
  // impact of 200% zoom; native browser zoom is checked separately.
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  let otpRequests = 0;
  await page.route("**/auth/v1/otp", async route => { otpRequests++; await route.fulfill({ status: 400, json: { msg: "Could not send the code. Try again." } }); });
  await page.getByLabel("Email", { exact: true }).fill("reader@example.test"); await page.getByLabel("Email", { exact: true }).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Could not send the code" })).toBeVisible();
  expect(otpRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeEnabled();
  for (const path of ["/favicon.ico", "/apple-icon.png", "/product-preview.png"]) expect((await request.get(path)).ok()).toBe(true);
  await page.goto("/room/not-a-code"); await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("validated legacy history offers explicit continue without admitting on the home page", async ({ page }) => {
  let admissions = 0;
  page.on("request", req => { if (req.url().endsWith("/api/rooms/ABCDEF123456") && req.method() === "POST") admissions++; });
  await page.addInitScript(() => localStorage.setItem("read-together:rooms", '[{"code":"ABCDEF123456","seat":1}]'));
  await page.route("**/api/rooms/library", route => route.fulfill({ json: { rooms: [{ code: "ABCDEF123456", title: "Legacy room", seat: 1, createdAt: "2026-01-01T00:00:00Z", section: "", lastOpenedAt: null, archivedAt: null, linked: false }], unavailable: [] } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeVisible();
  expect(admissions).toBe(0);
  await page.route("**/api/rooms/ABCDEF123456", route => route.fulfill({ status: 404, json: { error: "Room not found. Check the code." } }));
  await page.getByRole("button", { name: "Continue reading", exact: true }).click();
  await expect(page).toHaveURL(/\/room\/ABCDEF123456$/);
  await expect(page.getByRole("heading", { name: "Room no longer available" })).toBeVisible();
  expect(admissions).toBe(1);
});

test("desktop library leads the action rail and reflows without losing account or form access", async ({ page, browser, baseURL }, testInfo) => {
  let title = "A long book title without an artificial cover ".repeat(3);
  await page.addInitScript(() => localStorage.setItem("read-together:rooms", '[{"code":"ABCDEF123456","seat":1}]'));
  await page.route("**/api/rooms/library", route => route.fulfill({ json: { rooms: [{ code: "ABCDEF123456", title, seat: 1, createdAt: "2026-01-01T00:00:00Z", section: "Chapter one", lastOpenedAt: null, archivedAt: null, linked: false }], unavailable: [] } }));
  await page.goto("/");
  await expect(page.locator(".continue-panel h2")).toHaveText(title.trim());
  for (const width of [1440, 1280, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.evaluate(() => {
      const library = document.querySelector(".home-library")!.getBoundingClientRect();
      const rail = document.querySelector(".home-rail")!.getBoundingClientRect();
      return { library: { x: library.x, right: library.right, y: library.y, bottom: library.bottom, width: library.width }, rail: { x: rail.x, y: rail.y, width: rail.width }, fits: document.documentElement.scrollWidth <= innerWidth };
    });
    expect(geometry.fits).toBe(true);
    if (width >= 1280) {
      expect(geometry.library.right).toBeLessThan(geometry.rail.x);
      expect(geometry.library.width).toBeGreaterThan(geometry.rail.width);
      expect(Math.abs(geometry.library.y - geometry.rail.y)).toBeLessThan(1);
    } else {
      expect(geometry.rail.y).toBeGreaterThan(geometry.library.bottom);
      expect(Math.abs(geometry.library.x - geometry.rail.x)).toBeLessThan(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`library-home-${width}.png`), fullPage: true });
  }
  title = "A short book title";
  await page.reload();
  await expect(page.locator(".continue-panel h2")).toHaveText(title);
  const subtitle = (await page.locator(".continue-panel .muted").boundingBox())!;
  const resume = (await page.getByRole("button", { name: "Continue reading", exact: true }).boundingBox())!;
  expect(resume.y - subtitle.y - subtitle.height).toBeLessThan(30);
  await page.screenshot({ path: testInfo.outputPath("library-home-short-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("library-home-short-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Your account", exact: true }).click();
  await expect(page.locator("#home-account")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Have an invitation?", exact: true }).click();
  await expect(page.getByLabel("Room code or invitation link")).toBeFocused();
  await page.getByLabel("Room code or invitation link").blur();
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("library-home-text-200.png"), fullPage: true });
  // Also exercise a desktop pointer/keyboard context, not just a wide phone viewport.
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  try {
    const desktopPage = await desktop.newPage();
    await desktopPage.addInitScript(() => localStorage.setItem("read-together:rooms", '[{"code":"ABCDEF123456","seat":1}]'));
    await desktopPage.route("**/api/rooms/library", route => route.fulfill({ json: { rooms: [{ code: "ABCDEF123456", title, seat: 1, createdAt: "2026-01-01T00:00:00Z", section: "Chapter one", lastOpenedAt: null, archivedAt: null, linked: false }], unavailable: [] } }));
    await desktopPage.goto("/");
    await expect(desktopPage.locator(".continue-panel h2")).toHaveText(title);
    const account = desktopPage.getByRole("link", { name: "Your account", exact: true });
    await account.focus(); await desktopPage.keyboard.press("Enter");
    await expect(desktopPage.locator("#home-account")).toBeFocused();
    await desktopPage.keyboard.press("Tab");
    await expect(desktopPage.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    await desktopPage.screenshot({ path: testInfo.outputPath("library-home-desktop-pointer.png"), fullPage: true });
  } finally { await desktop.close(); }
});
