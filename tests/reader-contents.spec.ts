import { test, expect } from "@playwright/test";
import { openReader } from "./reader-fixture";

test("nested safe contents persists fragment CFI through delayed relocation, exit and reopen", async ({ page, request }) => {
  const room = await openReader(page, "nested");
  await page.setViewportSize({ width: 320, height: 844 });
  const trigger = page.getByRole("button", { name: "Contents", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Contents", exact: true });
  await expect(dialog.getByRole("button", { name: "External section" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Unsafe section" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Missing section" })).toBeDisabled();
  await expect(dialog.locator("ol ol")).toBeVisible();
  await expect(dialog.locator("b")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Absent passage" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /<b>River passage/ })).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await page.evaluate(() => {
    const frame = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => frame(time => { setTimeout(() => fn(time), 400); });
  });
  await trigger.click();
  await dialog.getByRole("button", { name: /<b>River passage/ }).click();
  await expect(dialog).toBeHidden();
  const saved = await room.position(); expect(saved.cfi).toMatch(/^epubcfi\(/);
  expect(saved.cfi).toContain("/6/2!");
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  const response = await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers });
  expect(response.ok()).toBeTruthy(); const state = await response.json();
  expect(state.me.cfi).toBe(saved.cfi);
  await page.getByRole("button", { name: new RegExp(`Reader test.*${room.code}`) }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  expect((await room.position()).cfi).toBe(saved.cfi);
  await expect(page.frameLocator(".book-view iframe").locator("#passage")).toBeInViewport();
  await trigger.click(); await dialog.getByRole("button", { name: /<b>River passage/ }).click();
  await expect(dialog).toBeHidden();
});

test("empty contents uses spine and EPUB 2 NCX retains nesting", async ({ page }) => {
  await openReader(page, "empty");
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("button", { name: "Section 2", exact: true }).click();
  await expect(page.frameLocator(".book-view iframe").getByRole("heading", { name: "Coming home" })).toBeVisible();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await openReader(page, "ncx");
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await expect(page.getByRole("dialog").locator("ol ol")).toBeVisible();
  await page.getByRole("button", { name: "River passage", exact: true }).click();
  await expect(page.frameLocator(".book-view iframe").locator("#passage")).toBeInViewport();
});

test("timed out relocation retains confirmed progress and can retry after late callback", async ({ page }) => {
  const room = await openReader(page);
  const before = await room.position();
  await page.evaluate(() => {
    const frame = requestAnimationFrame.bind(window);
    (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame = frame;
    (window as unknown as { lateFrames: number }).lateFrames = 0;
    window.requestAnimationFrame = fn => frame(time => { setTimeout(() => { fn(time); (window as unknown as { lateFrames: number }).lateFrames++; }, 6500); });
  });
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Coming home", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.evaluate(() => { window.requestAnimationFrame = (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame; });
  // The late callback observes the current view; it must not publish failed progress.
  await expect.poll(() => page.evaluate(() => (window as unknown as { lateFrames: number }).lateFrames)).toBeGreaterThan(0);
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.getByRole("dialog").getByRole("button", { name: "The morning walk" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.frameLocator(".book-view iframe").getByRole("heading", { name: "The morning walk" })).toBeVisible();
});
