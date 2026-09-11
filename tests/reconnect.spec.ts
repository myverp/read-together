import { test, expect } from "@playwright/test";
import { epub } from "./epub";

test("Presence track errors explicitly rejoin once, back off, and recover Live", async ({ page, browser, baseURL }, testInfo) => {
  const joins: number[] = [];
  let failures = 2;
  let injected = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => {
      let frame;
      try { frame = JSON.parse(message.toString()); } catch { server.send(message); return; }
      const array = Array.isArray(frame);
      const event = array ? frame[3] : frame.event;
      const payload = array ? frame[4] : frame.payload;
      if (event === "phx_join") joins.push(Date.now());
      if (event === "presence" && payload?.event === "track" && failures > 0) {
        failures--; injected++;
        const reply = { status: "error", response: { reason: "Injected track failure" } };
        socket.send(JSON.stringify(array
          ? [frame[0], frame[1], frame[2], "phx_reply", reply]
          : { ...frame, event: "phx_reply", payload: reply }));
      } else { server.send(message); }
    });
  });
  await page.goto("/");
  await expect(page.getByLabel("Choose an EPUB")).toBeEnabled();
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Reconnect.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByText("Reconnecting…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  expect(injected).toBe(2);
  expect(joins).toHaveLength(3);
  expect(joins[1] - joins[0]).toBeGreaterThanOrEqual(900);
  expect(joins[2] - joins[1]).toBeGreaterThanOrEqual(1900);

  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const options = testInfo.project.use;
  const secondContext = await browser.newContext({ viewport: options.viewport, isMobile: options.isMobile, hasTouch: options.hasTouch });
  const second = await secondContext.newPage();
  try {
    await second.goto(baseURL!);
    await second.getByLabel("Room code").fill(code);
    await second.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(second.getByText("Live", { exact: true })).toBeVisible();
    await expect(page.getByText("· online", { exact: true })).toBeVisible();
    // Fail the normal, debounced track path after the connection was healthy.
    const before = joins.length;
    failures = 1;
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Reconnecting…", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    expect(injected).toBe(3);
    expect(joins.length - before).toBe(1);
    const local = await page.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:1`)!).cfi, code);
    await expect.poll(() => second.evaluate(code => JSON.parse(localStorage.getItem(`read-together:${code}:2:partner`) || "null")?.cfi, code)).toBe(local);
    expect(errors).toEqual([]);
  } finally { await secondContext.close(); }
});
