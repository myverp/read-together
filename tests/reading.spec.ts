import { test, expect, type Page } from "@playwright/test";
import { epub } from "./epub";

async function position(page: Page, code: string, seat: number, partner = false) {
  return page.evaluate(({ code, seat, partner }) => JSON.parse(localStorage.getItem(`read-together:${code}:${seat}${partner ? ":partner" : ""}`) || "null"), { code, seat, partner });
}

test("two mobile readers upload, join, sync positions/status, reconnect and reopen", async ({ page, browser, baseURL, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Choose an EPUB")).toBeEnabled();
  const roomResponse = page.waitForResponse(response => /\/api\/rooms\/[A-F0-9]{12}$/.test(response.url()) && response.request().method() === "POST");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Test walk.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const roomData = await (await roomResponse).json();
  const signedBook = await request.get(roomData.bookUrl);
  expect(signedBook.ok()).toBe(true);
  expect((await signedBook.body()).subarray(0, 2).toString()).toBe("PK");
  const unsignedBook = new URL(roomData.bookUrl);
  unsignedBook.search = "";
  expect((await request.get(unsignedBook.href)).ok()).toBe(false);
  unsignedBook.pathname = unsignedBook.pathname.replace("/object/sign/", "/object/public/");
  expect((await request.get(unsignedBook.href)).ok()).toBe(false);
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const options = testInfo.project.use;
  const secondContext = await browser.newContext({ viewport: options.viewport, isMobile: options.isMobile, hasTouch: options.hasTouch });
  const second = await secondContext.newPage();
  second.on("pageerror", e => errors.push(e.message));
  try {
    await second.goto(baseURL!);
    await second.getByLabel("Room code").fill(code);
    await second.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await expect(page.getByText("· online", { exact: true })).toBeVisible();
    await expect(second.getByText("· online", { exact: true })).toBeVisible();
    const expandedHeight = await second.locator(".book-view").evaluate(el => el.clientHeight);
    await second.getByRole("button", { name: "Collapse room details" }).click();
    await expect(second.getByRole("button", { name: "Exit", exact: true })).toBeHidden();
    await expect(second.getByRole("region", { name: "Reader positions" })).toBeHidden();
    await expect(second.getByRole("button", { name: "Jump to partner" })).toBeEnabled();
    await expect.poll(() => second.locator(".book-view").evaluate(el => el.clientHeight)).toBeGreaterThan(expandedHeight + 60);
    await second.screenshot({ path: testInfo.outputPath("reader-collapsed.png") });
    await second.getByRole("button", { name: "Expand room details" }).click();
    await expect(second.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
    await expect.poll(() => second.locator(".book-view").evaluate(el => el.clientHeight)).toBe(expandedHeight);
    const initial = await position(page, code, 1);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(async () => (await position(page, code, 1))?.cfi).not.toBe(initial.cfi);
    await expect.poll(async () => (await position(second, code, 2, true))?.cfi).toBe((await position(page, code, 1)).cfi);
    // Partner navigation does not move the second reader automatically.
    expect((await position(second, code, 2)).cfi).toBe(initial.cfi);
    await second.getByRole("button", { name: "Jump to partner" }).click();
    await expect.poll(async () => (await position(second, code, 2))?.cfi).toBe((await position(page, code, 1)).cfi);
    await page.getByRole("button", { name: "Done here", exact: true }).click();
    await expect.poll(async () => (await position(second, code, 2, true))?.done).toBe(true);
    await second.getByRole("button", { name: "Done here", exact: true }).click();
    await expect.poll(async () => (await position(page, code, 1, true))?.done).toBe(true);
    await second.reload();
    await second.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(second.getByRole("button", { name: "Keep reading" })).toBeEnabled();
    await secondContext.setOffline(true);
    await expect(second.getByText("Offline · position saved on this device")).toBeVisible();
    await second.getByRole("button", { name: "Next page" }).click();
    await expect.poll(async () => (await position(second, code, 2))?.done).toBe(false);
    await secondContext.setOffline(false);
    await expect(second.getByText("Live", { exact: true })).toBeVisible();
    await expect.poll(async () => (await position(page, code, 1, true))?.cfi).toBe((await position(second, code, 2)).cfi);
    await second.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => second.locator(".book-view").evaluate(el => el.clientHeight)).toBeGreaterThan(100);
    await second.getByRole("button", { name: "Next page" }).click();
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await second.setViewportSize({ width: 390, height: 844 });
    await second.screenshot({ path: testInfo.outputPath("reader-mobile.png") });
    // A third browser cannot take another seat, even though it knows the room code.
    const third = await browser.newContext();
    const thirdPage = await third.newPage();
    await thirdPage.goto(baseURL!);
    await thirdPage.getByLabel("Room code").fill(code);
    await thirdPage.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(thirdPage.locator("p[role=alert]")).toContainText("already has two readers");
    await third.close();
    expect(errors).toEqual([]);
  } finally { await secondContext.close(); }
});

test("rejects a corrupt EPUB before creating a room", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Choose an EPUB")).toBeEnabled();
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "broken.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not an epub") });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.locator("p[role=alert]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload & create room" })).toBeEnabled();
});


