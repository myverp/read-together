import { test, expect } from "@playwright/test";
import { epub } from "./epub";

test("invitation GET is private, joining is explicit, and route refresh/history reopens", async ({ page, browser, baseURL, request }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Private invitation book.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const code = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  const path = `/room/${code}`;
  await expect(page).toHaveURL(`${baseURL}${path}`);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByLabel("Invitation link")).toHaveValue(`${baseURL}${path}`);
  const html = await (await request.get(path)).text();
  const headers = (await request.get(path)).headers();
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(html).not.toContain("Private invitation book");
  expect(html).not.toContain("bookUrl");
  expect(html).not.toContain("readerToken");
  expect(html).toContain('name="robots" content="noindex, nofollow"');
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText(/Copy the selected link manually/)).toBeVisible();
  await expect(page.getByLabel("Invitation link")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeFocused();

  const context = await browser.newContext({ ...testInfo.project.use, baseURL });
  const second = await context.newPage();
  let admissions = 0;
  second.on("request", req => { if (req.url().endsWith(`/api/rooms/${code}`) && req.method() === "POST") admissions++; });
  try {
    await second.goto(path.toLowerCase());
    await expect(second).toHaveURL(`${baseURL}${path}`);
    await expect(second.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
    expect(admissions).toBe(0);
    await expect(second.getByText("Private invitation book.epub")).toBeHidden();
    await second.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    expect(admissions).toBe(1);
    await expect(page.getByText("· online", { exact: true })).toBeVisible();
    await second.reload();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    expect(admissions).toBe(2);
    await second.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(second).toHaveURL(`${baseURL}/`);
    await second.goBack();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    expect(admissions).toBe(3);
    await second.goForward();
    await expect(second).toHaveURL(`${baseURL}/`);
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeHidden();
  } finally { await context.close(); }
});

test("invitation form rejects foreign links and room errors remain retryable", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Room code").fill("https://evil.example/room/A1B2C3D4E5F6");
  await page.getByRole("button", { name: "Join / reopen room" }).click();
  await expect(page.getByText(/valid invitation link from this site/)).toBeVisible();
  await page.goto("/room/ABCDEF123456");
  let attempts = 0;
  await page.route("**/api/rooms/ABCDEF123456", route => {
    attempts++;
    return route.fulfill({ status: attempts === 1 ? 503 : 404, contentType: "application/json", body: JSON.stringify({ error: attempts === 1 ? "Service unavailable. Try again." : "Room not found. Check the code." }) });
  });
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByText("Service unavailable. Try again.")).toBeVisible();
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByText("Room not found. Check the code.")).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeHidden();
});

test("refresh replaces a rejected signed book URL through fresh admission", async ({ page }) => {
  await page.goto("/");
  let replies = 0;
  await page.route(/\/api\/rooms\/[A-F0-9]{12}$/, async route => {
    const response = await route.fetch(); const room = await response.json(); replies++;
    if (replies === 1) { const url = new URL(room.bookUrl); url.searchParams.set("token", "expired"); room.bookUrl = url.href; }
    await route.fulfill({ response, json: room });
  });
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "URL refresh.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByText("Could not download the EPUB. Exit and reopen the room to retry.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  expect(replies).toBe(2);
});
