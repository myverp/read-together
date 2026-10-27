import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { openReader, applyReadingSettings } from "./reader-fixture";
import { selectReaderAction } from "./reader-menu";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

test("book search is inert until selection, returns to prior Done position and preserves partner", async ({ page, request }, testInfo) => {
  const room = await openReader(page);
  const headers = { Authorization: `Bearer ${randomBytes(32).toString("hex")}` };
  expect((await request.post(`/api/rooms/${room.code}`, { headers })).status()).toBe(200);
  const partner = await (await request.get(`/api/rooms/${room.code}/state`, { headers })).json();
  await page.getByRole("button", { name: "Done here", exact: true }).click();
  const previous = await room.position();
  await selectReaderAction(page, "Search book");
  const dialog = page.getByRole("dialog", { name: "Search book", exact: true });
  await expect(dialog.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await dialog.getByLabel("Find in book").fill("not present xyz");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.getByText(/No matches found/)).toBeVisible();
  await dialog.getByLabel("Find in book").fill("PARAGRAPH 40.");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".search-results li")).toHaveCount(2);
  expect(await room.position()).toEqual(previous);
  await page.screenshot({ path: testInfo.outputPath("book-search.png") });
  await dialog.getByRole("button", { name: /Coming home/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await room.position()).cfi).toContain("/6/4!");
  expect((await room.position()).done).toBe(false);
  await page.getByRole("button", { name: "Return to previous position" }).click();
  await expect.poll(async () => (await room.position()).cfi).toBe(previous.cfi);
  await expect.poll(async () => (await room.position()).done).toBe(true);
  await expect(page.getByRole("button", { name: "Return to previous position" })).toHaveCount(0);
  await room.reopen(); expect((await room.position()).cfi).toBe(previous.cfi);
  const after = await (await request.get(`/api/rooms/${room.code}/state`, { headers })).json();
  expect(after.me).toEqual(partner.me);
  await selectReaderAction(page, "Search book"); await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Reader menu", exact: true })).toBeFocused();
  await page.clock.install(); await page.clock.pauseAt(new Date());
  await selectReaderAction(page, "Search book");
  await dialog.getByLabel("Find in book").fill("river");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel search" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Search cancelled.");
  await page.clock.runFor(100);
  await expect(dialog.locator(".search-results li")).toHaveCount(0);
});

test("search handles inline text, literal punctuation, bounded results and a missing section", async ({ page }) => {
  const room = await openReader(page, "normal", "plain", async buffer => {
    const zip = await JSZip.loadAsync(buffer);
    const one = await zip.file("OEBPS/one.xhtml")!.async("string");
    zip.file("OEBPS/one.xhtml", one.replace("</body>", `<p>Unique <em>inline</em> phrase [literal].</p>${"<p>Many matches here.</p>".repeat(220)}</body>`));
    zip.remove("OEBPS/two.xhtml");
    return zip.generateAsync({ type: "nodebuffer" });
  });
  const before = await room.position();
  await selectReaderAction(page, "Search book");
  const dialog = page.getByRole("dialog", { name: "Search book", exact: true });
  await dialog.getByLabel("Find in book").fill("unique inline phrase [literal].");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".search-results li")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toContainText("1 sections could not be searched");
  expect(await room.position()).toEqual(before);
  await dialog.getByLabel("Find in book").fill("Many matches");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.locator(".search-results li")).toHaveCount(200);
  await expect(dialog.getByRole("status")).toContainText("refine your search");
});

test("compact notes expand full quotes without changing search or export and fit reader themes", async ({ page, request }, testInfo) => {
  const room = await openReader(page);
  const quote = "A long shared quote. ".repeat(30);
  expect((await request.post(`/api/rooms/${room.code}/highlights`, { headers: room.headers, data: { id: randomUUID(), cfi: "epubcfi(/6/2!/4/4,/1:0,/1:12)", quote, comment: "Keep this note" } })).status()).toBe(200);
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true });
  for (const theme of ["Light", "Dark", "Sepia"]) {
    await applyReadingSettings(page, 18, theme);
    await selectReaderAction(page, "Notes");
    await expect(dialog.locator("blockquote")).toHaveClass("note-quote-collapsed");
    if (theme === "Light") {
      const downloaded = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Export my notes" }).click();
      const markdown = await readFile((await (await downloaded).path())!, "utf8");
      expect(markdown.match(/A long shared quote/g)).toHaveLength(30);
    }
    await dialog.getByRole("button", { name: "Expand quote" }).click();
    await expect(dialog.locator("blockquote")).toHaveText(quote.trim());
    await expect(dialog.getByRole("button", { name: "Collapse quote" })).toHaveAttribute("aria-expanded", "true");
    await dialog.getByRole("button", { name: "Collapse quote" }).click();
    await page.setViewportSize({ width: 320, height: 480 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`compact-notes-${theme}.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    const search = await dialog.getByLabel("Search notes").boundingBox(), author = await dialog.getByLabel("Author", { exact: true }).boundingBox();
    expect(Math.abs(search!.y - author!.y)).toBeLessThan(4);
    await dialog.getByRole("button", { name: "Close notes" }).click();
  }
});
