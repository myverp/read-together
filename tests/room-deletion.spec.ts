import { test, expect } from "@playwright/test";
import { epub } from "./epub";

test("creator confirms deletion, retries a lost response, and stops the open partner reader", async ({ page, browser, baseURL }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Delete story.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const context = await browser.newContext({ ...testInfo.project.use, baseURL });
  try {
    const partner = await context.newPage();
    await partner.goto("/");
    await partner.getByLabel("Room code or invitation link").fill(code);
    await partner.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await partner.getByRole("button", { name: "Exit", exact: true }).click();
    const partnerRow = partner.locator(".room-library-row").filter({ hasText: "Delete story" });
    await partnerRow.getByLabel("Actions for Delete story").click();
    await expect(partnerRow.getByRole("button", { name: "Delete room", exact: true })).toHaveCount(0);
    await partner.keyboard.press("Escape");
    await partnerRow.getByRole("button", { name: /Continue/ }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    const row = page.locator(".room-library-row").filter({ hasText: "Delete story" });
    await row.getByLabel("Actions for Delete story").click();
    await page.keyboard.press("Escape");
    await expect(row.getByLabel("Actions for Delete story")).toBeFocused();
    await page.keyboard.press("Enter");
    await row.getByRole("button", { name: "Delete room", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Permanently delete room?" });
    await expect(dialog).toContainText("both you and your partner");
    await expect(dialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row.getByLabel("Actions for Delete story")).toBeFocused();
    await page.keyboard.press("Enter");
    await row.getByRole("button", { name: "Delete room", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 480 });
    expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("delete-confirmation-mobile.png"), fullPage: true });
    await dialog.getByLabel("Type ВИДАЛИТИ to confirm").fill("delete");
    await expect(dialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    await dialog.getByLabel("Type ВИДАЛИТИ to confirm").fill("ВИДАЛИТИ");
    await page.evaluate(code => {
      localStorage.setItem(`read-together:${code}:1:pending`, "remove only after confirmation");
      localStorage.setItem("read-together:ABCDEF012345:1:pending", "unrelated pending");
    }, code);
    let deletions = 0;
    await page.route(`**/api/rooms/${code}`, async route => {
      if (route.request().method() !== "DELETE") return route.continue();
      deletions++;
      if (deletions === 1) {
        const response = await route.fetch(); expect(response.status()).toBe(200);
        return route.fulfill({ status: 503, json: { error: "Response was lost after deletion." } });
      }
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Response was lost");
    expect(await page.evaluate(code => localStorage.getItem(`read-together:${code}:1:pending`), code)).toBe("remove only after confirmation");
    await expect(partner.getByRole("heading", { name: "Room no longer available" })).toBeVisible({ timeout: 15000 });
    await expect(partner.locator(".book-view")).toHaveCount(0);
    let laterRequests = 0;
    partner.on("request", request => { if (new URL(request.url()).pathname.startsWith(`/api/rooms/${code}`)) laterRequests++; });
    await partner.clock.install(); await partner.clock.fastForward(20000);
    expect(laterRequests).toBe(0);
    await dialog.getByRole("button", { name: "Retry deletion" }).click();
    await expect(dialog).toHaveCount(0); await expect(row).toHaveCount(0);
    expect(deletions).toBe(2);
    expect(await page.evaluate(code => localStorage.getItem(`read-together:${code}:1:pending`), code)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("read-together:ABCDEF012345:1:pending"))).toBe("unrelated pending");
    await partner.getByRole("link", { name: "Back to my rooms" }).click();
    await expect(partner.getByRole("heading", { name: "My rooms" })).toBeVisible();
  } finally { await context.close(); }
});
