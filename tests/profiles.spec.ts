import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { epub } from "./epub";

const mailMessages = `${process.env.TEST_MAIL_URL || (process.env.CI_ISOLATED_BACKEND === "1" ? "http://127.0.0.1:57324" : "http://127.0.0.1:45324")}/api/v1/messages`;
type MailMessage = { ID?: string; To?: { Address?: string }[]; Snippet?: string };
async function latestOtp(request: APIRequestContext, email: string, previousIds: string[]) {
  return expect.poll(async () => {
    const response = await request.get(mailMessages);
    if (!response.ok()) return "";
    const body = await response.json() as { messages?: MailMessage[] };
    const message = body.messages?.find(item => item.To?.some(to => to.Address === email) && !previousIds.includes(item.ID || ""));
    return message?.Snippet?.match(/\b\d{6}\b/)?.[0] || "";
  }, { timeout: 15000 }).not.toBe("").then(async () => {
    const body = await (await request.get(mailMessages)).json() as { messages: MailMessage[] };
    return body.messages.find(item => item.To?.some(to => to.Address === email) && !previousIds.includes(item.ID || ""))!.Snippet!.match(/\b\d{6}\b/)![0];
  });
}

async function signIn(page: Page, request: APIRequestContext, email: string) {
  const previous = await (await request.get(mailMessages)).json() as { messages?: MailMessage[] };
  const previousIds = (previous.messages || []).map(message => message.ID || "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const otp = await latestOtp(request, email, previousIds);
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
  // Keep the first device's reader open so takeover can be observed by its poll.
  await page.getByRole("button", { name: new RegExp(`Profile room.*${roomCode}`) }).click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  const second = await secondContext.newPage();
  try {
    await second.goto("/"); await signIn(second, request, email);
    await expect(second.getByLabel("Name")).toHaveValue("River Reader");
    await expect(second.getByRole("button", { name: "moon" })).toHaveAttribute("aria-pressed", "true");
    await second.getByRole("button", { name: new RegExp(`Profile room.*${roomCode}`) }).click();
    await expect(second.getByText("This profile is open on another device. Choose Continue here to take control.")).toBeVisible();
    let takeoverAttempts = 0;
    await second.route(`**/api/rooms/${roomCode}`, async route => {
      if (!(route.request().postDataJSON() as { takeover?: boolean } | null)?.takeover) return route.continue();
      takeoverAttempts++;
      if (takeoverAttempts === 1) return route.fulfill({ status: 503, contentType: "text/html", body: "Unavailable" });
      if (takeoverAttempts === 2) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Reader control changed.", takeoverRequired: true }) });
      await new Promise(resolve => setTimeout(resolve, 300)); await route.continue();
    });
    await second.getByRole("button", { name: "Continue here" }).click();
    await expect(second.getByText(/Request failed \(503\)/)).toBeVisible();
    await expect(second.getByRole("button", { name: "Continue here" })).toBeEnabled();
    await second.getByRole("button", { name: "Continue here" }).click();
    await expect(second.getByText("This profile is open on another device. Choose Continue here to take control.")).toBeVisible();
    await second.getByRole("button", { name: "Continue here" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(second.getByRole("button", { name: "Continue here" })).toBeDisabled();
    await expect(second.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    expect(takeoverAttempts).toBe(3);
    await expect(page.locator(".connection")).toHaveText("Continued on another device", { timeout: 10000 });
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  } finally { await secondContext.close(); }
});
