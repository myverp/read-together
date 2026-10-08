import { selectReaderAction, waitForSync } from "./reader-menu";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { epub } from "./epub";

// Accounts/rooms are created only against the explicitly disposable test stack.
async function profileRoom(page: Page, request: APIRequestContext, internalLinks = false) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (process.env.CI_ISOLATED_BACKEND !== "1" || new URL(url).port !== "57321") throw new Error("Progress tests require the isolated CI backend.");
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const browser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const password = randomBytes(32).toString("hex"), email = `progress-${randomUUID()}@example.test`, device = randomBytes(32).toString("hex");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const signed = await browser.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error;
  const session = signed.data.session!;
  await page.addInitScript(({ session, device }) => { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("read-together:token", device); }, { session, device });
  const headers = { Authorization: `Bearer ${session.access_token}`, "X-Reader-Token": device };
  const book = await epub(internalLinks);
  const upload = await request.post("/api/rooms", { headers, data: { name: "Progress test.epub", size: book.length } });
  expect(upload.ok()).toBeTruthy(); const details = await upload.json();
  const stored = await browser.storage.from("epubs").uploadToSignedUrl(details.path, details.uploadToken, book, { contentType: "application/epub+zip" }); if (stored.error) throw stored.error;
  const opened = await request.post(`/api/rooms/${details.code}`, { headers }); expect(opened.ok()).toBeTruthy();
  await page.goto("/");
  const open = async () => {
    await page.getByRole("button", { name: new RegExp(`Progress test.*${details.code}`) }).click();
    await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
    await expect.poll(() => page.evaluate(code => {
      const key = `read-together:${code}:1`; const me = JSON.parse(localStorage.getItem(key) || "null");
      return !!me?.cfi && localStorage.getItem(`${key}:pending`) === null;
    }, details.code)).toBe(true);
    await waitForSync(page);
  };
  await open();
  return { code: details.code, open, headers, room: await opened.json(), cleanup: async () => { await admin.from("reading_rooms").delete().eq("code", details.code); await admin.storage.from("epubs").remove([details.path]); await admin.auth.admin.deleteUser(created.data.user!.id); } };
}

test("exit waits for the page-turn location before saving", async ({ page, request }) => {
  const room = await profileRoom(page, request);
  try {
    const before = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    // epub.js reports relocation on a later animation frame, after next() resolves.
    // Make that gap deterministic instead of depending on CI machine speed.
    await page.evaluate(() => {
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => frame(time => { setTimeout(() => callback(time), 500); });
    });
    await page.getByRole("button", { name: "Next page" }).click();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Read together", exact: true })).toBeVisible();
    const saved = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    expect(saved.me.cfi).not.toBe(before.me.cfi);
    expect(saved.me.section).toMatch(/^p\. 2 /);
    await room.open();
    await selectReaderAction(page, "Room details");
    await expect(page.getByText(/^p\. 2 /).first()).toBeVisible();
    await page.keyboard.press("Escape");
    const reopened = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    expect(reopened.me.cfi).toBe(saved.me.cfi);
    await page.getByRole("button", { name: "Exit", exact: true }).click();
  } finally { await room.cleanup(); }
});

test("internal book links replace a restored text anchor and persist their destination", async ({ page, request }) => {
  const room = await profileRoom(page, request, true);
  try {
    const before = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await room.open();
    await page.frameLocator(".book-view iframe").getByRole("link", { name: "Go to the other chapter" }).click();
    await expect(page.frameLocator(".book-view iframe").getByRole("heading", { name: "Coming home" })).toBeVisible();
    await expect.poll(async () => (await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json()).me.cfi).not.toBe(before.me.cfi);
    await waitForSync(page);
    const destination = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    expect(destination.me.cfi).toContain("/6/4!");
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await room.open();
    await expect(page.frameLocator(".book-view iframe").getByRole("heading", { name: "Coming home" })).toBeVisible();
    const reopened = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    expect(reopened.me.cfi).toBe(destination.me.cfi);
    await page.getByRole("button", { name: "Exit", exact: true }).click();
  } finally { await room.cleanup(); }
});

test("profile retries are bounded through 60 seconds of 503s, exit stays available and pending reopens", async ({ page, request }) => {
  const room = await profileRoom(page, request);
  try {
    await waitForSync(page);
    await page.clock.install();
    let patches = 0;
    await page.route(`**/api/rooms/${room.code}/state`, async route => {
      if (route.request().method() !== "PATCH") return route.continue();
      patches++; await route.fulfill({ status: 503, contentType: "text/html", body: "Service unavailable" });
    });
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Could not sync", { exact: true })).toBeVisible();
    for (let second = 0; second < 60; second++) {
      await page.clock.runFor(1000);
      // Allow real HTTP responses between advancing application timers.
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    expect(patches).toBeLessThanOrEqual(7); expect(patches).toBeGreaterThan(1);

    const pending = await page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1:pending`)! ), room.code);
    const started = Date.now(); await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Read together", exact: true })).toBeVisible(); expect(Date.now() - started).toBeLessThan(2800);
    await expect(page.getByText("Your position is saved on this device. Reopen this room to finish syncing.")).toBeVisible();
    await page.unroute(`**/api/rooms/${room.code}/state`); await room.open();
    await waitForSync(page);
    const cloud = await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers }); expect((await cloud.json()).me.cfi).toBe(pending.position.cfi);
    await page.getByRole("button", { name: "Exit", exact: true }).click();
  } finally { await room.cleanup(); }
});

test("unanswered writes cannot hold exit; offline progress recovers and storage failure stays visible", async ({ page, request }) => {
  const room = await profileRoom(page, request);
  try {
    const held = new Set<() => void>();
    let releaseWrites = false;
    await page.route(`**/api/rooms/${room.code}/state`, async route => {
      if (route.request().method() !== "PATCH") return route.continue();
      if (!releaseWrites) await new Promise<void>(resolve => { held.add(resolve); });
      try { await route.abort(); } catch { /* exited reader */ }
    });
    await page.getByRole("button", { name: "Next page" }).click(); await expect.poll(() => page.evaluate(code => !!localStorage.getItem(`read-together:${code}:1:pending`), room.code)).toBe(true);
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeInViewport();
    const elapsed = await page.evaluate(async () => {
      const started = performance.now();
      return new Promise<number>(resolve => {
        const observer = new MutationObserver(() => { if (document.querySelector(".home h1")) { observer.disconnect(); resolve(performance.now() - started); } });
        observer.observe(document.body, { childList: true, subtree: true });
        (document.querySelector('button[aria-label="Exit"]') as HTMLButtonElement).click();
      });
    });
    expect(elapsed).toBeLessThan(2500); await expect(page.getByRole("heading", { name: "Read together", exact: true })).toBeVisible();
    releaseWrites = true;
    for (const release of held) release();
    await page.unrouteAll({ behavior: "wait" });
    await room.open(); await waitForSync(page);
    await page.context().setOffline(true); await page.getByRole("button", { name: "Next page" }).click(); await expect(page.getByText("Waiting for connection", { exact: true })).toBeVisible();
    await page.context().setOffline(false); await waitForSync(page);
    const beforeStorageFailure = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.includes(":pending") || /read-together:.*:1$/.test(key)) throw new DOMException("Full", "QuotaExceededError"); return original.call(this,key,value); }; });
    await page.getByRole("button", { name: "Next page" }).click(); await expect(page.getByText(/Browser storage is full/)).toBeVisible();
    await expect.poll(async () => (await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json()).me.cfi).not.toBe(beforeStorageFailure.me.cfi);
    await expect(page.getByText(/Browser storage is full/)).toBeVisible(); await page.getByRole("button", { name: "Exit", exact: true }).click();
  } finally { await page.context().setOffline(false); await room.cleanup(); }
});

test("different cloud progress needs explicit choice; 320px exit survives collapsed details", async ({ page, request }, testInfo) => {
  const room = await profileRoom(page, request);
  try {
    // Removing the conflict panel can reflow the EPUB and save a new page label.
    // This simulated second tab must read the current revision before its write,
    // and rebase only an actual revision conflict (never another failure).
    const saveOtherTabPosition = async (section: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
        const response = await request.patch(`/api/rooms/${room.code}/state`, { headers: room.headers, data: { position: { ...state.me, section }, controlVersion: room.room.controlVersion, revision: state.revision } });
        if (response.ok()) return state;
        expect(response.status()).toBe(409);
        expect((await response.json()).code).toBe("revision_conflict");
      }
      throw new Error("The second tab could not save its position after three revision conflicts.");
    };
    await saveOtherTabPosition("Another tab's position");
    await page.getByRole("button", { name: "Next page" }).click(); await expect(page.getByText("Choose which position to keep", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep this position" }).click(); await waitForSync(page);
    const kept = await saveOtherTabPosition("Cloud choice");
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Choose which position to keep", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use cloud position" }).click();
    await waitForSync(page);
    await expect.poll(() => page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`)! ).cfi, room.code)).toBe(kept.me.cfi);
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("reader-320-collapsed.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await selectReaderAction(page, "Room details");
    await expect(page.getByRole("dialog", { name: "Room details" })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("reader-390-expanded.png") });
    await page.getByRole("button", { name: "Exit", exact: true }).click();
  } finally { await room.cleanup(); }
});

test("old-control pending needs explicit restoration; failure of both stores requires an exit choice", async ({ page, request }) => {
  const room = await profileRoom(page, request);
  try {
    const previous = await page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`)! ).cfi, room.code);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.poll(() => page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`)! ).cfi, room.code)).not.toBe(previous);
    await expect.poll(() => page.evaluate(code => localStorage.getItem(`read-together:${code}:1:pending`), room.code)).toBe(null);
    const local = await page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`)! ), room.code);
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    const state = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    const cloud = { ...state.me, section: "Cloud copy", cfi: "epubcfi(/6/2!/4/2/1:0)" };
    expect((await request.patch(`/api/rooms/${room.code}/state`, { headers: room.headers, data: { position: cloud, controlVersion: room.room.controlVersion, revision: state.revision } })).ok()).toBeTruthy();
    await page.evaluate(({ code, position, revision }) => localStorage.setItem(`read-together:${code}:1:pending`, JSON.stringify({ format: 1, position, revision, controlVersion: 999 })), { code: room.code, position: local, revision: state.revision });
    await page.getByRole("button", { name: new RegExp(`Progress test.*${room.code}`) }).click();
    await expect(page.getByRole("button", { name: "Restore local position" })).toBeEnabled();
    const beforeRestore = await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json();
    expect(beforeRestore.me.cfi).not.toBe(local.cfi);
    await page.getByRole("button", { name: "Restore local position" }).click();
    await expect.poll(async () => (await (await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers })).json()).me.cfi).toBe(local.cfi);
    await waitForSync(page);
    await page.route(`**/api/rooms/${room.code}/state`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, body: "" }) : route.continue());
    await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value) { if (key.startsWith("read-together:")) throw new DOMException("Blocked", "SecurityError"); return original.call(this,key,value); }; });
    await page.getByRole("button", { name: "Next page" }).click(); await expect(page.getByText("Could not sync", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Exit", exact: true }).click(); await expect(page.getByRole("button", { name: "Stay", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stay", exact: true }).click(); await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
    await page.getByRole("button", { name: "Exit", exact: true }).click(); await page.getByRole("button", { name: "Exit without saving", exact: true }).click();
    await expect(page.getByText("You left without saving your latest position. It may be lost.")).toBeVisible();
  } finally { await room.cleanup(); }
});
