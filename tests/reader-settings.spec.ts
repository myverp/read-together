import { selectReaderAction, waitForSync } from "./reader-menu";
import { test, expect } from "@playwright/test";
import { openReader, expectPassageInView } from "./reader-fixture";

const KEY = "read-together:reading-settings:v1";
test("settings preserve CFI and Done through font, theme, rotation, exit and refresh", async ({ page, request }) => {
  const room = await openReader(page, "nested");
  await selectReaderAction(page, "Contents");
  await page.getByRole("dialog").getByRole("button", { name: /<b>River passage/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Done here", exact: true }).click();
  const before = await room.position();
  await waitForSync(page);
  const trigger = page.getByRole("button", { name: "Reader menu", exact: true });
  await selectReaderAction(page, "Reading settings");
  const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
  for (const size of [16,28,18]) {
    await dialog.getByLabel("Text size").selectOption(String(size));
    await expect(dialog.getByLabel("Text size")).toBeEnabled();
    await expect.poll(() => page.frameLocator(".book-view iframe").locator("body").evaluate(element => getComputedStyle(element).fontSize)).toBe(`${size}px`);
    expect((await room.position()).cfi).toBe(before.cfi); expect((await room.position()).done).toBe(true);
    await dialog.getByRole("button", { name: "Close reading settings" }).click();
    await expectPassageInView(page);
    await selectReaderAction(page, "Reading settings");
  }
  for (const theme of ["Dark", "Sepia", "Light"]) {
    await dialog.getByRole("radio", { name: theme, exact: true }).check();
    await expect(dialog.getByLabel("Text size")).toBeEnabled();
    await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", theme.toLowerCase());
  }
  await dialog.getByRole("radio", { name: "Sepia", exact: true }).check(); await expect(dialog.getByLabel("Text size")).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Reading settings", exact: true })).toHaveCSS("background-color", "rgb(244, 236, 216)");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await selectReaderAction(page, "Reading settings");
  await page.evaluate(() => { const frame = requestAnimationFrame.bind(window); window.requestAnimationFrame = fn => frame(time => { setTimeout(() => fn(time),400); }); });
  await dialog.getByLabel("Text size").selectOption("28");
  await dialog.getByRole("button", { name: "Close reading settings" }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeEnabled();
  await room.reopen(); expect((await room.position()).cfi).toBe(before.cfi); expect((await room.position()).done).toBe(true);
  await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "sepia");
  await page.reload(); await expect(page.locator(".reader-controls > button:nth-child(2)")).toBeEnabled();
  expect((await room.position()).cfi).toBe(before.cfi);
  const response = await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers }); expect(response.ok()).toBeTruthy();
  expect((await response.json()).me.cfi).toBe(before.cfi);
  await selectReaderAction(page, "Reading settings"); await expect(dialog.getByLabel("Text size")).toHaveValue("28");
  await dialog.getByRole("button", { name: "Reset", exact: true }).click(); await expect(dialog.getByLabel("Text size")).toBeEnabled();
  await expect(dialog.getByLabel("Text size")).toHaveValue("18"); await expect(dialog.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Close reading settings" }).click();
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(trigger).toBeEnabled();
    expect(await page.locator(".reader-controls button").evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("personal settings cross books, stay independent of partner, and storage failure remains usable", async ({ page, browser, baseURL }, testInfo) => {
  await page.addInitScript(key => { if (!sessionStorage.getItem("settings-fixture")) { localStorage.setItem(key, '{broken'); sessionStorage.setItem("settings-fixture", "1"); } }, KEY);
  const room = await openReader(page);
  const options = testInfo.project.use;
  const context = await browser.newContext({ viewport: options.viewport, isMobile: options.isMobile, hasTouch: options.hasTouch });
  const partner = await context.newPage();
  try {
    await partner.goto(baseURL!); await partner.getByLabel("Room code").fill(room.code);
    await partner.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await selectReaderAction(page, "Reading settings");
    await page.getByLabel("Text size").selectOption("28"); await expect(page.getByLabel("Text size")).toBeEnabled();
    await page.getByRole("radio", { name: "Dark", exact: true }).check(); await expect(page.getByLabel("Text size")).toBeEnabled();
    await expect(partner.locator(".reader")).toHaveAttribute("data-reading-theme", "light");
    await expect(partner.frameLocator(".book-view iframe").locator("body")).toHaveCSS("font-size", "18px");
    await page.getByRole("button", { name: "Close reading settings" }).click();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).toEqual({version:1,theme:"dark",fontSize:28});
    await openReader(page); await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "dark");
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name,value) { if(name === key) throw new Error("Settings storage blocked"); return original.call(this,name,value); };
    }, KEY);
    await selectReaderAction(page, "Reading settings");
    await page.getByRole("radio", { name: "Sepia", exact: true }).check(); await expect(page.getByLabel("Text size")).toBeEnabled();
    await expect(page.getByText("Settings work for this session, but cannot be saved on this device.")).toBeVisible();
    await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "sepia");
  } finally { await context.close(); }
});

test("author styles remain readable without changing emphasis or SVG; fixed layout disables text sizing", async ({ page }) => {
  await openReader(page, "normal", "styled");
  await selectReaderAction(page, "Reading settings");
  await page.getByLabel("Text size").selectOption("28"); await expect(page.getByLabel("Text size")).toBeEnabled();
  await page.getByRole("radio", { name: "Dark", exact: true }).check(); await expect(page.getByLabel("Text size")).toBeEnabled();
  const frame = page.frameLocator(".book-view iframe");
  await expect(frame.locator("body")).toHaveCSS("font-size", "28px");
  await expect(frame.locator("p").first()).toHaveCSS("font-size", "28px");
  await expect(frame.locator("p").first()).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator("em")).toHaveCSS("font-style", "italic");
  const heading = await frame.locator("h1").evaluate(element => parseFloat(getComputedStyle(element).fontSize)); expect(heading).toBeGreaterThan(28);
  await expect(frame.locator("code")).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator("td")).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator("svg circle")).toHaveAttribute("fill", "#ff0000");
  await expect(frame.locator("svg")).toHaveCSS("filter", "none");
  await page.getByRole("button", { name: "Close reading settings" }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await openReader(page, "normal", "fixed");
  await selectReaderAction(page, "Reading settings");
  await expect(page.getByLabel("Text size")).toBeDisabled();
  await expect(page.getByText("This fixed-layout book does not support changing text size.")).toBeVisible();
});

test("reflow timeout rolls back settings and ignores late frames before a successful retry", async ({ page }) => {
  const room = await openReader(page); const before = await room.position();
  await selectReaderAction(page, "Reading settings");
  await page.evaluate(() => {
    const frame = requestAnimationFrame.bind(window);
    (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame = frame;
    (window as unknown as { lateFrames: number }).lateFrames = 0;
    window.requestAnimationFrame = fn => frame(time => { setTimeout(() => { fn(time); (window as unknown as { lateFrames: number }).lateFrames++; },6500); });
  });
  await page.getByLabel("Text size").selectOption("28");
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Text size")).toHaveValue("18");
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.evaluate(() => { window.requestAnimationFrame = (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { lateFrames: number }).lateFrames)).toBeGreaterThan(0);
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.getByLabel("Text size").selectOption("28"); await expect(page.getByLabel("Text size")).toBeEnabled();
  await expect(page.frameLocator(".book-view iframe").locator("body")).toHaveCSS("font-size", "28px");
});
