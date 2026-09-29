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
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeVisible();
  expect(admissions).toBe(0);
  await page.route("**/api/rooms/ABCDEF123456", route => route.fulfill({ status: 404, json: { error: "Room not found. Check the code." } }));
  await page.getByRole("button", { name: "Continue reading", exact: true }).click();
  await expect(page).toHaveURL(/\/room\/ABCDEF123456$/);
  await expect(page.getByText("Room not found. Check the code.")).toBeVisible();
  expect(admissions).toBe(1);
});
