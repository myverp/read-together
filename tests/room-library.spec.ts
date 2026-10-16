import { test, expect } from "@playwright/test";
import { epub } from "./epub";

test("guest archives personally, retries failures, keeps Done and opens archived rooms without restoring", async ({ page, browser, baseURL }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Library story.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Done here", exact: true }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  const row = page.locator(".room-library-row").filter({ hasText: "Library story" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/p\. 2/);
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem(`read-together:${localStorage.getItem("read-together:room")}:1`))).toContain('"done":true');
  let attempts = 0;
  await page.route(`**/api/rooms/${code}/archive`, async route => {
    attempts++; if (attempts === 1) return route.fulfill({ status: 503, json: { error: "Archive service unavailable. Try again." } });
    return route.continue();
  });
  await row.getByLabel("Actions for Library story").click();
  await row.getByRole("button", { name: "Archive Library story", exact: true }).click();
  await expect(row.getByRole("alert")).toContainText("Archive service unavailable");
  await expect(row.getByRole("button", { name: "Continue", exact: false })).toBeEnabled();
  await row.getByRole("button", { name: "Retry archive" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Active", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 640, height: 450 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await row.getByRole("button", { name: new RegExp(`Library story ${code} Continue`) }).click();
  await expect(page.getByRole("button", { name: "Keep reading", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row).toBeVisible();

  const context = await browser.newContext({ ...testInfo.project.use, baseURL });
  try {
    const partner = await context.newPage(); await partner.goto("/");
    await partner.getByLabel("Room code or invitation link").fill(code);
    await partner.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await partner.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(partner.locator(".room-library-row").filter({ hasText: "Library story" })).toBeVisible();
    await expect(partner.getByRole("button", { name: "Continue reading", exact: true })).toBeVisible();
  } finally { await context.close(); }
  await row.getByLabel("Actions for Library story").click();
  await row.getByRole("button", { name: "Restore Library story" }).click();
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeVisible();
});

test("temporary metadata errors retain all local rooms and pending progress; confirmed unavailable stays represented", async ({ page }) => {
  const codes = Array.from({ length: 125 }, (_, index) => index.toString(16).toUpperCase().padStart(12, "0"));
  await page.addInitScript(({ codes }) => {
    localStorage.setItem("read-together:rooms", JSON.stringify(codes.map((code, index) => ({ code, seat: 1, title: `Saved ${index}` }))));
    localStorage.setItem(`read-together:${codes[0]}:1:pending`, "keep pending exactly");
  }, { codes });
  let failed = true, admissions = 0;
  page.on("request", request => { if (/\/api\/rooms\/[A-F0-9]{12}$/.test(new URL(request.url()).pathname) && request.method() === "POST") admissions++; });
  const batches: number[] = [];
  await page.route("**/api/rooms/library", async route => {
    const { codes: batch } = route.request().postDataJSON() as { codes: string[] }; batches.push(batch.length);
    if (failed) return route.fulfill({ status: 503, json: { error: "Library temporarily unavailable." } });
    return route.fulfill({ json: { rooms: batch.filter(code => code !== codes[0]).map(code => ({ code, title: `Book ${code}`, seat: 1, section: "Saved section", createdAt: "2026-01-01T00:00:00Z", lastOpenedAt: code === codes[124] ? "2026-10-15T12:00:00Z" : null, archivedAt: null, linked: false })), unavailable: batch.filter(code => code === codes[0]) } });
  });
  await page.goto("/");
  await expect(page.locator(".room-library").getByRole("alert")).toContainText("Library temporarily unavailable");
  await expect(page.locator(".room-library-row")).toHaveCount(125);
  expect(await page.evaluate(code => localStorage.getItem(`read-together:${code}:1:pending`), codes[0])).toBe("keep pending exactly");
  failed = false; await page.getByRole("button", { name: "Retry rooms" }).click();
  await expect(page.locator(".room-library-row")).toHaveCount(125);
  await expect(page.getByText("Unavailable for this reader.", { exact: false })).toBeVisible();
  await expect(page.locator(".continue-panel")).toContainText(`Book ${codes[124]}`);
  expect(batches.every(count => count <= 100)).toBe(true); expect(batches).toContain(25);
  expect(admissions).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("read-together:rooms")!).length)).toBe(125);
  expect(await page.evaluate(code => localStorage.getItem(`read-together:${code}:1:pending`), codes[0])).toBe("keep pending exactly");
});
