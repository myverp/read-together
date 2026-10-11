import { expect, type Page } from "@playwright/test";

export async function openReaderMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Reader menu", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(page.getByRole("menu", { name: "Reader actions" })).toBeVisible();
}

export async function selectReaderAction(page: Page, name: string) {
  await openReaderMenu(page);
  await page.getByRole("menuitem", { name, exact: true }).click();
}

export async function waitForSync(page: Page) {
  // Profile fixtures use seat 1. Verify both queue completion and the real cloud
  // position now that a permanent "Synced" label is no longer part of the UI.
  await expect.poll(() => page.evaluate(async () => {
    const code = localStorage.getItem("read-together:room");
    const key = `read-together:${code}:1`;
    if (localStorage.getItem(`${key}:pending`)) return false;
    const local = JSON.parse(localStorage.getItem(key) || "null");
    const session = JSON.parse(localStorage.getItem("sb-127-auth-token") || "null");
    const token = localStorage.getItem("read-together:token")!;
    const response = await fetch(`/api/rooms/${code}/state`, { headers: {
      Authorization: `Bearer ${session?.access_token || token}`, "X-Reader-Token": token,
    } });
    if (!response.ok || !local) return false;
    const { me } = await response.json();
    return me.cfi === local.cfi && me.section === local.section && me.done === local.done;
  })).toBe(true);
}
