import { test, expect } from "@playwright/test";
import { epub } from "./epub";

// Playable PCM fixture: tests the browser player, not ElevenLabs voice quality.
function wav() {
  const data = Buffer.alloc(44 + 8000 * 2 * 3);
  data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}

test("page audio uses page boundaries, plays, cancels, remembers voice and forgets secrets", async ({ page, browserName }, testInfo) => {
  await page.goto("/");
  await expect(page.getByLabel("Choose an EPUB")).toBeEnabled();
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Audio test.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Listen to page" })).toBeEnabled();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const captured: string[] = [];
  let fail = false, hold = false;
  await page.route("**/api/rooms/*/speech", async route => {
    expect(route.request().headers()["x-elevenlabs-key"]).toBe("test-key-not-a-real-secret");
    const body = route.request().postDataJSON();
    if (body.action === "voices") return route.fulfill({ json: { voices: [{ id: "testVoice", name: "Test voice" }], hasMore: false } });
    captured.push(body.text);
    if (hold) return;
    if (fail) return route.fulfill({ status: 429, json: { error: "ElevenLabs quota or request limit reached. Check your plan or try later." } });
    await route.fulfill({ contentType: "audio/wav", body: wav() });
  });
  await page.getByRole("button", { name: "Listen to page" }).click();
  await page.getByLabel("ElevenLabs API key").fill("test-key-not-a-real-secret");
  await page.getByRole("button", { name: "Load voices" }).click();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("testVoice");
  await page.getByRole("button", { name: "Generate page audio" }).click();
  const player = page.locator("audio");
  await expect(player).toBeVisible();
  expect(captured[0]).toContain("The morning walk");
  expect(captured[0]).toContain("Paragraph 1.");
  expect(captured[0]).not.toContain("Paragraph 50.");
  expect(captured[0].length).toBeGreaterThan(100);
  expect(captured[0].length).toBeLessThan(3000);
  if (browserName === "webkit" && process.platform === "win32") {
    // Confirmed separately on a blank document: Windows WebKit rejects valid PCM
    // with MEDIA_ERR_SRC_NOT_SUPPORTED. Keep all other integration assertions.
    testInfo.annotations.push({ type: "limitation", description: "Native audio decoding needs macOS WebKit or a physical iPhone; Windows WebKit PCM probe fails with code 4." });
  } else {
    await player.tap({ position: { x: 20, y: 27 } });
    await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThan(0);
    await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    await player.evaluate((element: HTMLAudioElement) => element.pause());
    await expect.poll(() => player.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("audio-player.png") });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("test-key-not-a-real-secret");
  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(player).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("button", { name: "Listen to page" })).toBeEnabled();
  await page.getByRole("button", { name: "Listen to page" }).click();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue("testVoice");
  fail = true;
  await page.getByRole("button", { name: "Generate page audio" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("quota");
  expect(captured[1]).not.toBe(captured[0]);
  expect(captured[1]).not.toContain("The morning walk");
  fail = false; hold = true;
  await page.getByRole("button", { name: "Generate page audio" }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate page audio" })).toBeEnabled();
  await page.getByText("Audio settings", { exact: true }).click();
  await page.getByRole("button", { name: "Forget key" }).click();
  await expect(page.getByLabel("ElevenLabs API key")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Generate page audio" })).toBeDisabled();
  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room"));
  const denied = await page.request.post(`/api/rooms/${code}/speech`, { headers: { Authorization: `Bearer ${"f".repeat(64)}` }, data: { action: "voices" } });
  expect(denied.status()).toBe(403);
});

test("speech route rejects unauthenticated callers without contacting ElevenLabs", async ({ request }) => {
  const response = await request.post("/api/rooms/ABCDEF123456/speech", { data: { action: "speech", text: "hello", voice: "test" } });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("no-store");
});
