import { selectReaderAction, openReaderMenu } from "./reader-menu";
import { test, expect, type Page } from '@playwright/test';
import { epub } from './epub';
import { applyReadingSettings } from './reader-fixture';

async function state(page: Page, code: string) {
  return page.evaluate(async code => {
    const response = await fetch(`/api/rooms/${code}/drawings`, { headers: { Authorization: `Bearer ${localStorage.getItem('read-together:token')}` } });
    if (!response.ok) throw new Error(`Drawing read failed: ${response.status}`);
    return response.json();
  }, code);
}
async function stroke(page: Page) {
  const bounds = await page.locator('.drawing-canvas').boundingBox();
  if (!bounds) throw new Error('Drawing canvas is missing');
  await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .62, bounds.y + bounds.height * .55, { steps: 8 });
  await page.mouse.up();
}
async function findDrawing(page: Page, code: string) {
  const stroke = page.locator('.saved-drawing-stroke').first();
  const cfi = () => page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:2`) || 'null')?.cfi, code);
  // Reflow can briefly render the old page while EPUB recalculates columns.
  // Search nearby pages both ways and verify each turn committed.
  for (const direction of ['Next page', 'Previous page']) {
    for (let i = 0; i < 8; i++) {
      await stroke.waitFor({ state: 'visible', timeout: 1250 }).catch(() => {});
      if (await stroke.isVisible()) return;
      const button = page.getByRole('button', { name: direction });
      if (!(await button.isEnabled())) break;
      const before = await cfi();
      await button.click();
      await expect.poll(cfi).not.toBe(before);
    }
  }
  await expect(stroke).toBeVisible();
}

test('a drawing persists, follows its chapter, opens a frozen page, and stays owner controlled', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('Choose an EPUB')).toBeEnabled();
  await page.getByLabel('Choose an EPUB').setInputFiles({ name: 'Drawings.epub', mimeType: 'application/epub+zip', buffer: await epub() });
  await page.getByRole('button', { name: 'Upload & create room' }).click();
  await expect(page.getByRole('button', { name: 'Draw on page' })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem('read-together:room')!);
  const partnerContext = await browser.newContext({ ...testInfo.project.use, baseURL });
  const partner = await partnerContext.newPage();
  partner.on('pageerror', error => errors.push(error.message));
  try {
    await partner.goto('/');
    await partner.getByLabel('Room code').fill(code);
    await partner.getByRole('button', { name: 'Join / reopen room' }).click();
    await expect(partner.getByRole('button', { name: 'Draw on page' })).toBeEnabled();
    await page.getByRole('button', { name: 'Draw on page' }).click();
    await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await openReaderMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Contents', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Reading settings', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await state(page, code)).items).toHaveLength(0);
    await page.getByRole('button', { name: 'Draw on page' }).click();
    await stroke(page);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    const sentIds: string[] = [];
    await page.route(`**/api/rooms/${code}/drawings`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      sentIds.push(JSON.parse(route.request().postData()!).id);
      if (sentIds.length === 1) return route.fulfill({ status: 503, json: { error: 'Temporary drawing outage' } });
      return route.continue();
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.drawing-error')).toContainText('Temporary drawing outage');
    await expect(page.locator('.drawing-canvas path')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect(sentIds).toHaveLength(2);
    expect(sentIds[0]).toBe(sentIds[1]);
    await page.unroute(`**/api/rooms/${code}/drawings`);
    await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toHaveCount(0);
    const saved = (await state(page, code)).items;
    expect(saved).toHaveLength(1);
    expect(saved[0].page.runs.length).toBeGreaterThan(0);
    await expect(partner.locator('.saved-drawing-stroke').first()).toBeVisible();
    await partner.screenshot({ path: testInfo.outputPath('drawing-overlay.png') });
    await partner.setViewportSize({ width: 320, height: 700 });
    await findDrawing(partner, code);
    expect(await partner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await partner.screenshot({ path: testInfo.outputPath('drawing-320.png') });
    const loadedDrawings = partner.waitForResponse(response => response.url().endsWith(`/api/rooms/${code}/drawings`) && response.request().method() === 'GET');
    await partner.reload();
    await loadedDrawings;
    await expect(partner.getByRole('button', { name: 'Draw on page' })).toBeEnabled();
    const partnerCfi = () => partner.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:2`) || 'null')?.cfi, code);
    const ownerCfi = await page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`) || 'null')?.cfi, code);
    await selectReaderAction(partner, "Partner");
    await expect.poll(partnerCfi).toBe(ownerCfi);
    await findDrawing(partner, code);
    await partner.getByRole('button', { name: 'Hide drawings' }).click();
    await expect(partner.locator('.saved-drawing-stroke')).toHaveCount(0);
    await partner.getByRole('button', { name: 'Show drawings' }).click();
    await expect(partner.locator('.saved-drawing-stroke').first()).toBeVisible();
    const beforeReflow = await partnerCfi();
    await applyReadingSettings(partner);
    expect(await partnerCfi()).toBe(beforeReflow);
    expect((await state(page, code)).items).toEqual(saved);
    await expect(page.locator('.reader')).toHaveAttribute('data-reading-theme', 'light');
    await findDrawing(partner, code);
    await partner.locator('.drawing-overlay g[role="button"]').first().focus();
    await partner.keyboard.press('Enter');
    await expect(partner.getByRole('dialog', { name: 'Original drawing page' })).toBeVisible();
    await expect(partner.getByRole('dialog').locator('text')).not.toHaveCount(0);
    await expect(partner.locator('.drawing-original')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await partner.screenshot({ path: testInfo.outputPath('drawing-original.png') });
    await expect(partner.getByRole('button', { name: 'Delete my drawing' })).toHaveCount(0);
    await partner.getByRole('button', { name: 'Close original page' }).click();
    await applyReadingSettings(partner, 18, 'Light');
    await partner.getByRole('button', { name: 'Next page' }).click();
    await expect(partner.locator('.saved-drawing-stroke')).toHaveCount(0);
    // At 320px the wrapped toolbar and platform fonts can make this fixture's
    // first chapter exceed 35 screens. Wait for each saved location; the target
    // chapter and drawing absence below remain the actual assertions.
    for (let i = 0; i < 80 && await partner.frameLocator('.book-view iframe').locator('h1', { hasText: 'Coming home' }).count() === 0; i++) {
      const before = await partnerCfi();
      await partner.getByRole('button', { name: 'Next page' }).click();
      await expect.poll(partnerCfi).not.toBe(before);
    }
    await expect(partner.frameLocator('.book-view iframe').locator('h1', { hasText: 'Coming home' })).toHaveCount(1);
    await expect(partner.locator('.saved-drawing-stroke')).toHaveCount(0);
    await page.locator('.drawing-overlay g[role="button"]').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Delete my drawing' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete my drawing' }).click();
    await expect(partner.locator('.saved-drawing-stroke')).toHaveCount(0);
    await page.getByRole('button', { name: 'Draw on page' }).click();
    const canvas = page.locator('.drawing-canvas');
    const canvasBox = (await canvas.boundingBox())!;
    await canvas.evaluate(element => element.addEventListener('pointerdown', event => { (element as HTMLElement).dataset.pointerId = String((event as PointerEvent).pointerId); }, { once: true }));
    await page.mouse.move(canvasBox.x + 60, canvasBox.y + 80);
    await page.mouse.down();
    await canvas.evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: Number((element as HTMLElement).dataset.pointerId), pointerType: 'mouse', isPrimary: true })));
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.mouse.down();
    await canvas.evaluate(element => element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9876, pointerType: 'touch', isPrimary: false })));
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await partnerContext.close(); }
});
