import { expect, type Page } from "@playwright/test";
import { epub } from "./epub";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

export async function openReader(page: Page, navigation: Parameters<typeof epub>[1] = "normal") {
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
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Reader test.epub", mimeType: "application/epub+zip", buffer: await epub(false, navigation) });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const position = () => page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`) || "null"), code);
  await expect.poll(async () => (await position())?.cfi).toMatch(/^epubcfi\(/);
  const reopen = async () => {
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`Reader test.*${code}`) }).click();
    await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  };
  return { code, position, reopen, headers: { Authorization: `Bearer ${session.access_token}`, "X-Reader-Token": token } };
}
