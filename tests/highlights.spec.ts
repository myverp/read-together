import { test, expect, type Page } from "@playwright/test";
import { epub } from "./epub";
import type { HighlightSnapshot } from "../src/lib/highlights";

test.use({ actionTimeout: 20000 });

async function selectText(page: Page, paragraph: number) {
  await page.bringToFront();
  await expect(page.frameLocator(".book-view iframe").locator("p").nth(paragraph)).toBeVisible();
  await page.frameLocator(".book-view iframe").locator("p").nth(paragraph).evaluate(element => {
    const text = element.firstChild!;
    const range = element.ownerDocument.createRange();
    range.setStart(text, 0); range.setEnd(text, Math.min(22, text.textContent!.length));
    const selection = element.ownerDocument.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole("button", { name: "Highlight selection", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function marks(page: Page, code: string): Promise<HighlightSnapshot> {
  return page.evaluate(async code => {
    const response = await fetch(`/api/rooms/${code}/highlights`, { headers: { Authorization: `Bearer ${localStorage.getItem("read-together:token")}` } });
    if (!response.ok) throw new Error(`Highlight read failed: ${response.status}`);
    return response.json();
  }, code);
}

async function tapMark(page: Page, id: string) {
  await page.bringToFront();
  const rect = page.locator(`.shared-highlight[data-id="${id}"] rect`).first();
  await expect(rect).toBeVisible();
  const box = (await rect.boundingBox())!;
  // epub.js forwards real pointer events from the iframe to its SVG marks.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("shared highlights and optional comments persist with distinct reader colors", async ({ page, browser, baseURL, request }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByLabel("Choose an EPUB")).toBeEnabled();
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Highlights.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const secondContext = await browser.newContext({ ...testInfo.project.use, baseURL });
  const second = await secondContext.newPage();
  second.on("pageerror", error => errors.push(error.message));
  try {
    await second.goto("/");
    await second.getByLabel("Room code").fill(code);
    await second.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Collapse room details" }).click();
    await second.getByRole("button", { name: "Collapse room details" }).click();

    // Blank/whitespace comments create a translucent highlight, without a note.
    await selectText(page, 0);
    await page.getByLabel("Comment (optional)").fill("   ");
    await page.getByRole("button", { name: "Save highlight" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const first = (await marks(page, code)).items[0];
    expect(first.comment).toBe("");
    await expect(second.locator(`.shared-highlight[data-id="${first.id}"]`)).toHaveCount(1);
    await expect(second.locator(`.shared-highlight[data-id="${first.id}"]`)).toHaveAttribute("fill-opacity", "0.32");
    await tapMark(second, first.id);
    await expect(second.getByText("No comment", { exact: true })).toBeVisible();
    await expect(second.getByRole("button", { name: "Remove highlight" })).toHaveCount(0);
    await second.getByRole("button", { name: "Close highlight" }).click();

    await selectText(second, 1);
    const comment = "This passage made me smile.\n<img src=x onerror=alert(1)>";
    await second.getByLabel("Comment (optional)").fill(comment);
    // Failed saves retain the draft for a safe retry.
    await second.route(`**/api/rooms/${code}/highlights`, async route => {
      if (route.request().method() === "POST") await route.fulfill({ status: 503, json: { error: "Temporary test outage" } });
      else await route.continue();
    });
    await second.getByRole("button", { name: "Save highlight" }).click();
    await expect(second.getByRole("dialog").getByRole("alert")).toContainText("Temporary test outage");
    await expect(second.getByLabel("Comment (optional)")).toHaveValue(comment);
    await second.unroute(`**/api/rooms/${code}/highlights`);
    await second.getByRole("button", { name: "Save highlight" }).click();
    await expect(second.getByRole("dialog")).toHaveCount(0);
    const partnerMark = (await marks(page, code)).items[1];
    expect(partnerMark.color).not.toBe(first.color);
    await expect(page.locator(`.shared-highlight[data-id="${partnerMark.id}"]`)).toHaveCount(1);
    await tapMark(page, partnerMark.id);
    await expect(page.locator(".highlight-comment")).toHaveText(comment);
    await expect(page.getByRole("dialog").locator("img")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("shared-comment-mobile.png") });
    await page.getByRole("button", { name: "Close highlight" }).click();

    // A second highlight from the same reader uses exactly the same color.
    await selectText(page, 2);
    await page.getByRole("button", { name: "Save highlight" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await marks(page, code)).items[2].color).toBe(first.color);

    await second.reload();
    await second.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await expect(second.locator(".shared-highlight")).toHaveCount(3);
    await second.getByRole("button", { name: "Collapse room details" }).click();
    await second.setViewportSize({ width: 844, height: 390 });
    await second.setViewportSize({ width: 390, height: 844 });
    await expect(second.frameLocator(".book-view iframe").locator("p").first()).toBeVisible();
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await tapMark(second, partnerMark.id);
    await expect(second.locator(".highlight-comment")).toHaveText(comment);
    await second.getByRole("button", { name: "Remove highlight" }).click();
    await expect(second.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(`.shared-highlight[data-id="${partnerMark.id}"]`)).toHaveCount(0);

    // Both seats can save at once without overwriting each other's marks.
    const create = (target: Page, quote: string) => target.evaluate(async ({ code, cfi, quote }) => {
      const response = await fetch(`/api/rooms/${code}/highlights`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("read-together:token")}` }, body: JSON.stringify({ id: crypto.randomUUID(), cfi, quote, comment: "Concurrent save" }) });
      return response.status;
    }, { code, cfi: first.cfi, quote });
    expect(await Promise.all([create(page, "Reader one concurrent"), create(second, "Reader two concurrent")])).toEqual([200, 200]);
    const concurrent = await marks(page, code);
    expect(concurrent.items).toHaveLength(4);
    expect(new Set(concurrent.items.filter(h => h.seat === 1).map(h => h.color)).size).toBe(1);
    expect(concurrent.items.find(h => h.quote === "Reader two concurrent")?.color).toBe(partnerMark.color);

    // Knowing the room code is insufficient to read, write, or delete marks.
    const outsiderHeaders = { Authorization: `Bearer ${"a".repeat(64)}` };
    expect((await request.get(`/api/rooms/${code}/highlights`, { headers: outsiderHeaders })).status()).toBe(403);
    expect((await request.post(`/api/rooms/${code}/highlights`, { headers: outsiderHeaders, data: { id: crypto.randomUUID(), cfi: first.cfi, quote: "Outsider", comment: "" } })).status()).toBe(403);
    const deleteOther = await page.evaluate(async ({ code, id }) => (await fetch(`/api/rooms/${code}/highlights`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("read-together:token")}` }, body: JSON.stringify({ id }) })).status, { code, id: concurrent.items.find(h => h.seat === 2)!.id });
    expect(deleteOther).toBe(403);
    expect(errors).toEqual([]);
  } finally { await secondContext.close(); }
});
