import { expect, type Page } from "@playwright/test";
import { epub } from "./epub";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

export async function applyReadingSettings(page: Page, fontSize = 28, theme = "Dark") {
  await page.getByRole("button", { name: "Reading settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
  await dialog.getByLabel("Text size").selectOption(String(fontSize));
  await expect(dialog.getByLabel("Text size")).toBeEnabled();
  await dialog.getByRole("radio", { name: theme, exact: true }).check();
  await expect(dialog.getByLabel("Text size")).toBeEnabled();
  await dialog.getByRole("button", { name: "Close reading settings" }).click();
  await expect(page.getByRole("button", { name: "Contents", exact: true })).toBeEnabled();
}

export async function openReader(page: Page, navigation: Parameters<typeof epub>[1] = "normal", appearance: Parameters<typeof epub>[2] = "plain") {
  if (process.env.CI_ISOLATED_BACKEND !== "1" || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).port !== "57321") throw new Error("Reader tests require the disposable backend.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const email = `reader-${randomUUID()}@example.test`, password = randomBytes(32).toString("hex"), token = randomBytes(32).toString("hex");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw created.error;
  const signed = await client.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error;
  const session = signed.data.session!;
  await page.addInitScript(({ session, token }) => { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("read-together:token", token); }, { session, token });
  await page.goto("/");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Reader test.epub", mimeType: "application/epub+zip", buffer: await epub(false, navigation, appearance) });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const position = () => page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`) || "null"), code);
  await expect.poll(async () => (await position())?.cfi).toMatch(/^epubcfi\(/);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible();
  const reopen = async () => {
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`Reader test.*${code}`) }).click();
    await expect(page.getByRole("button", { name: "Reading settings", exact: true })).toBeEnabled();
  };
  return { code, position, reopen, headers: { Authorization: `Bearer ${session.access_token}`, "X-Reader-Token": token } };
}
// WebKit's IntersectionObserver can report zero for a paragraph split across
// CSS columns even when its first word is visible. Check the text range against
// the clipped reader viewport, rather than the paragraph's fragmented box.
export async function expectPassageInView(page: Page) {
  await expect.poll(() => page.locator(".book-view iframe").evaluate(element => {
    const frame = element as HTMLIFrameElement;
    const passage = frame.contentDocument?.getElementById("passage");
    if (!passage?.firstChild) return false;
    const range = passage.ownerDocument.createRange();
    range.setStart(passage.firstChild, 0); range.setEnd(passage.firstChild, 9);
    const word = range.getClientRects()[0];
    const origin = frame.getBoundingClientRect();
    const clip = frame.closest(".book-view")!.getBoundingClientRect();
    return !!word && origin.left + word.right > Math.max(clip.left, 0) &&
      origin.left + word.left < Math.min(clip.right, innerWidth) &&
      origin.top + word.bottom > Math.max(clip.top, 0) &&
      origin.top + word.top < Math.min(clip.bottom, innerHeight);
  })).toBe(true);
}
