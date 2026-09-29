import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("a clean visitor opens the real demo within a minute, invites a partner and continues", async ({ page, browser, baseURL }, testInfo) => {
  let created = 0;
  page.on("request", req => { if (req.url().endsWith("/api/rooms") && req.method() === "POST") created++; });
  const started = Date.now();
  await page.goto("/");
  const demoButton = page.getByRole("button", { name: "Try demo", exact: true });
  await expect(demoButton).toBeEnabled();
  await demoButton.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  await expect(page.frameLocator(".book-view iframe").locator("body")).toContainText("Mara found the book");
  const elapsed = Date.now() - started;
  console.log(`Demo ready on local isolated loopback (${testInfo.project.name}): ${elapsed} ms`);
  testInfo.annotations.push({ type: "demo-ready-ms-local-loopback", description: String(elapsed) });
  expect(elapsed).toBeLessThan(60000);
  expect(created).toBe(1);
  const url = page.url();
  await expect(page.getByText(/Turn a page, select a phrase/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss demo tips" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  const context = await browser.newContext({ ...testInfo.project.use, baseURL });
  try {
    const partner = await context.newPage(); await partner.goto(url);
    await partner.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await expect(page.getByText("· online", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await page.getByRole("button", { name: "Continue demo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await expect(page).toHaveURL(url); expect(created).toBe(1);
  } finally { await context.close(); }
});

test("demo retry reconciles a lost upload response without another room or upload", async ({ page }) => {
  let created = 0, uploads = 0;
  page.on("request", req => {
    if (req.url().endsWith("/api/rooms") && req.method() === "POST") created++;
    if (req.url().includes("/storage/v1/object/upload/sign/")) uploads++;
  });
  // Keep the browser's real multipart body. Playwright's route.fetch forwards
  // an empty multipart body from Windows WebKit for this binary request.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window); let lost = false;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (!lost && url.includes("/storage/v1/object/upload/sign/") && response.ok) { lost = true; throw new TypeError("Lost upload response"); }
      return response;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await expect(page.locator("p.error[role=alert]")).toBeVisible();
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  expect(created).toBe(1); expect(uploads).toBe(1);
});

test("cancelling an active upload never admits or marks its room ready", async ({ page }) => {
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (process.env.CI_ISOLATED_BACKEND !== "1" || new URL(backend).port !== "57321") throw new Error("Cancellation checks require disposable Supabase.");
  const admin = createClient(backend, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/storage/v1/object/upload/sign/**", async route => { await held; await route.continue(); });
  await page.goto("/");
  const reservation = page.waitForResponse(response => response.url().endsWith("/api/rooms") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  const { code } = await (await reservation).json();
  await expect(page.getByText("Uploading EPUB…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel creation" }).click(); release();
  await expect(page.getByText(/Creation cancelled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeHidden();
  const { data, error } = await admin.from("reading_rooms").select("ready,book_path").eq("code", code).single();
  expect(error).toBeNull(); expect(data!.ready).toBe(false);
  await admin.storage.from("epubs").remove([data!.book_path]); await admin.from("reading_rooms").delete().eq("code", code);
});
