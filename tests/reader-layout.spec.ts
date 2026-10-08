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
  await expect(items).toHaveText(["Contents", "Listen", "Reading settings", "Invite", "Partner", "Room details"]);
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
  for (const name of ["Contents", "Reading settings", "Invite", "Room details", "Listen"]) {
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
    await expect(page.getByLabel("Text size")).toBeEnabled();
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
