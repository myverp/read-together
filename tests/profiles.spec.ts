import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { epub } from "./epub";

async function latestOtp(request: APIRequestContext, email: string) {
  return expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:45324/api/v1/messages");
    if (!response.ok()) return "";
    const body = await response.json() as { messages?: { To?: { Address?: string }[]; Snippet?: string }[] };
    const message = body.messages?.find(item => item.To?.some(to => to.Address === email));
    return message?.Snippet?.match(/\b\d{6}\b/)?.[0] || "";
  }, { timeout: 15000 }).not.toBe("").then(async () => {
    const body = await (await request.get("http://127.0.0.1:45324/api/v1/messages")).json() as { messages: { To?: { Address?: string }[]; Snippet?: string }[] };
    return body.messages.find(item => item.To?.some(to => to.Address === email))!.Snippet!.match(/\b\d{6}\b/)![0];
  });
}

async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const otp = await latestOtp(request, email);
  await page.getByLabel("6-digit code").fill(otp);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Your profile", { exact: true })).toBeVisible();
}

test("email profile links a guest room, customizes it, and requires explicit device takeover", async ({ page, browser, baseURL, request }, testInfo) => {
  test.setTimeout(180000);
  const email = `reader-${Date.now()}-${testInfo.workerIndex}@example.test`;
  await page.goto("/");
  await page.getByLabel("Choose an EPUB").setInputFiles({ name: "Profile room.epub", mimeType: "application/epub+zip", buffer: await epub() });
  await page.getByRole("button", { name: "Upload & create room" }).click();
  await expect(page.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
  const roomCode = await page.evaluate(() => localStorage.getItem("read-together:room")!);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();

  await signIn(page, request, email);
  await page.getByLabel("Name").fill("River Reader");
  await page.getByRole("button", { name: "moon" }).click();
  await page.getByRole("button", { name: "Color 4" }).click();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByRole("button", { name: "Link browser rooms" }).click();
  await expect(page.getByText("1 room linked.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My rooms" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Profile room.*${roomCode}`) }).click();
  await expect(page.getByText(/p\. 2/).first()).toBeVisible();
  await page.getByRole("button", { name: "Use color 5 in this room" }).click();
  await expect(page.getByRole("button", { name: "Use color 5 in this room" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Exit", exact: true }).click();

  const secondContext = await browser.newContext({ ...testInfo.project.use, baseURL });
  const second = await secondContext.newPage();
  try {
    await second.goto("/"); await signIn(second, request, email);
    await expect(second.getByLabel("Name")).toHaveValue("River Reader");
    await expect(second.getByRole("button", { name: "moon" })).toHaveAttribute("aria-pressed", "true");
    await second.getByRole("button", { name: new RegExp(`Profile room.*${roomCode}`) }).click();
    await expect(second.getByText("This profile is open on another device. Choose Continue here to take control.")).toBeVisible();
    await second.getByRole("button", { name: "Continue here" }).click();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await expect(page.getByText("Continued on another device", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  } finally { await secondContext.close(); }
});
