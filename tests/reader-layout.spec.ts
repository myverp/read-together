import { test, expect } from "@playwright/test";
import { openReader } from "./reader-fixture";
import { openReaderMenu, selectReaderAction } from "./reader-menu";

test("compact reader menu keeps geometry and position, supports keyboard and transfers focus", async ({ page }, testInfo) => {
  const room = await openReader(page);
  const trigger = page.getByRole("button", { name: "Reader menu" });
  const before = await room.position();
  const box = await page.locator(".book-view").boundingBox();
  await expect(page.locator(".progress-status")).toHaveCount(0);
  await expect(page.locator(".reader-top button")).toHaveCount(2);
  await expect(page.locator(".reader-controls button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Draw on page" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("button", { name: "Hide drawings" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await trigger.focus(); await page.keyboard.press("ArrowDown");
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["Contents", "Search book", "Notes", "Listen", "Reading settings", "Hide interface", "Invite", "Partner", "Room details"]);
  await expect(items.first()).toBeFocused();
  await expect(page.getByRole("menuitem", { name: "Partner", exact: true })).toBeDisabled();
  await page.keyboard.press("End"); await expect(items.last()).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeFocused();
  for (const name of ["Contents", "Search book", "Notes", "Reading settings", "Invite", "Room details", "Listen"]) {
    await selectReaderAction(page, name);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  }
  expect(await page.locator(".book-view").boundingBox()).toEqual(box);
  expect(await room.position()).toEqual(before);
  for (const [theme, background] of [["Dark", "rgb(23, 25, 30)"], ["Sepia", "rgb(244, 236, 216)"], ["Light", "rgb(255, 255, 255)"]]) {
    await selectReaderAction(page, "Reading settings");
    await page.getByRole("radio", { name: theme, exact: true }).check();
    await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
    await page.getByRole("button", { name: "Close reading settings" }).click();
    await openReaderMenu(page);
    await expect(page.getByRole("menu")).toHaveCSS("background-color", background);
    await expect(page.locator(".reader-top")).toHaveCSS("background-color", background);
    await page.screenshot({ path: testInfo.outputPath(`menu-${theme.toLowerCase()}.png`) });
    await page.keyboard.press("Escape");
  }
  await openReaderMenu(page);
  await page.mouse.click(box!.x + box!.width - 12, box!.y + box!.height - 12);
  await expect(page.getByRole("menu")).toHaveCount(0);
  for (const viewport of [{ width: 320, height: 700 }, { width: 844, height: 280 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Draw on page" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Hide drawings" })).toBeInViewport();
    const book = await page.locator(".book-view").boundingBox();
    const eye = await page.getByRole("button", { name: "Hide drawings" }).boundingBox();
    expect(eye!.y).toBeGreaterThanOrEqual(book!.y + book!.height);
    await openReaderMenu(page);
    await page.getByRole("menuitem", { name: "Room details" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("menuitem", { name: "Room details" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`menu-${viewport.width}.png`) });
    await page.keyboard.press("Escape");
  }
  await openReaderMenu(page);
  await page.getByRole("button", { name: "Hide drawings" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show drawings" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show drawings" }).click();
});

test("reader menu still dismisses over the book after rotation replaces its iframe", async ({ page }) => {
  const room = await openReader(page);
  const before = await room.position();
  await openReaderMenu(page);
  const oldFrame = await page.locator(".book-view iframe").elementHandle();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => oldFrame!.evaluate(frame => frame.isConnected)).toBe(false);
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await expect(page.getByRole("menu")).toBeVisible();
  const book = await page.locator(".book-view").boundingBox();
  await page.mouse.click(book!.x + book!.width - 20, book!.y + 30);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await room.position()).toEqual(before);
});

test("rotation during a delayed page turn queues real geometry after navigation", async({page})=>{
  const room=await openReader(page);const before=await room.position();
  await page.evaluate(()=>{
    const frame=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>frame(time=>{setTimeout(()=>callback(time),150);});
  });
  await page.getByRole("button",{name:"Next page"}).click();
  await expect(page.getByRole("button",{name:"Next page"})).toBeDisabled();
  await page.setViewportSize({width:844,height:390});
  await expect(page.getByRole("button",{name:"Next page"})).toBeEnabled();
  await expect.poll(async()=>{
    // The iframe spans every CSS column in a section; epub-container is the clipped page viewport.
    const book=await page.locator(".book-view").boundingBox(),stage=await page.locator(".book-view .epub-container").boundingBox();
    return !!book&&!!stage&&Math.abs(book.width-stage.width)<1&&Math.abs(book.height-stage.height)<1;
  }).toBe(true);
  await expect.poll(async()=>(await room.position()).cfi).not.toBe(before.cfi);
  const rotated=await room.position();
  await room.reopen();expect((await room.position()).cfi).toBe(rotated.cfi);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
test(`reader motion preserves dismissal, focus and geometry (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  const room = await openReader(page);
  const before = await room.position();
  const box = await page.locator(".book-view").boundingBox();
  const trigger = page.getByRole("button", { name: "Reader menu" });
  for (let reopen = 0; reopen < 3; reopen++) {
    await trigger.press("ArrowDown");
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCSS("animation-name", reducedMotion === "reduce" ? "none" : "reader-menu-enter");
    expect(await page.getByRole("menu").evaluate(menu => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return document.activeElement?.getAttribute("aria-label");
    })).toBe("Reader menu");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  await selectReaderAction(page, "Reading settings");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("animation-name", reducedMotion === "reduce" ? "none" : "reader-dialog-enter");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await selectReaderAction(page, "Hide interface");
  await page.getByRole("button", { name: "Hide controls", exact: true }).click();
  expect(await page.locator(".book-view").boundingBox()).toEqual(box);
  const chrome = page.locator(".reader > :is(.reader-top, .reader-controls, .reader-eye-row)");
  for (const element of await chrome.all()) {
    await expect(element).toHaveAttribute("inert", "");
    if (reducedMotion === "reduce") await expect(element).toHaveCSS("transition-duration", "0s");
    await expect(element).toHaveCSS("opacity", "0");
    await expect(element).toHaveCSS("visibility", "hidden");
  }
  await page.getByRole("button", { name: "Show interface", exact: true }).press("Enter");
  await expect(trigger).toBeFocused();
  await trigger.press("ArrowDown");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  expect(await page.getByRole("menuitem").first().evaluate(item => {
    const rect = item.getBoundingClientRect();
    return item.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await page.keyboard.press("Escape");
  for (const element of await chrome.all()) await expect(element).not.toHaveAttribute("inert", "");
  await expect(page.locator(".reader-top")).toHaveCSS("opacity", "1");
  expect(await page.locator(".book-view").boundingBox()).toEqual(box);
  expect(await room.position()).toEqual(before);
});
}
