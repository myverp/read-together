import { selectReaderAction, waitForSync } from "./reader-menu";
import { test, expect } from "@playwright/test";
import { openReader, expectPassageInView } from "./reader-fixture";

const KEY = "read-together:reading-settings:v1";
test("settings preserve CFI and Done through font, theme, rotation, exit and refresh", async ({ page, request }) => {
  const room = await openReader(page, "nested");
  await selectReaderAction(page, "Contents");
  await page.getByRole("dialog").getByRole("button", { name: /<b>River passage/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Done here", exact: true }).click();
  const before = await room.position();
  await waitForSync(page);
  const trigger = page.getByRole("button", { name: "Reader menu", exact: true });
  await selectReaderAction(page, "Reading settings");
  const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
  for (const size of [16,28,18]) {
    await dialog.getByLabel("Text size", {exact:true}).selectOption(String(size));
    await expect(dialog.getByLabel("Text size", {exact:true})).toBeEnabled();
    await expect.poll(() => page.frameLocator(".book-view iframe").locator("body").evaluate(element => getComputedStyle(element).fontSize)).toBe(`${size}px`);
    expect((await room.position()).cfi).toBe(before.cfi); expect((await room.position()).done).toBe(true);
    await dialog.getByRole("button", { name: "Close reading settings" }).click();
    await expectPassageInView(page);
    await selectReaderAction(page, "Reading settings");
  }
  await dialog.getByLabel("Text size",{exact:true}).selectOption("32"); await expect(dialog.getByLabel("Text size",{exact:true})).toBeEnabled();
  await expect(dialog.getByRole("button",{name:"Increase text size"})).toBeDisabled();
  await dialog.getByRole("button",{name:"Decrease text size"}).click(); await expect(dialog.getByLabel("Text size",{exact:true})).toBeEnabled();
  await expect(dialog.getByLabel("Text size",{exact:true})).toHaveValue("30");
  await dialog.getByLabel("Text size",{exact:true}).selectOption("18");await expect(dialog.getByLabel("Text size",{exact:true})).toBeEnabled();
  for (const theme of ["Dark", "Sepia", "Light"]) {
    await dialog.getByRole("radio", { name: theme, exact: true }).check();
    await expect(dialog.getByLabel("Text size", {exact:true})).toBeEnabled();
    await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", theme.toLowerCase());
  }
  await dialog.getByRole("radio", { name: "Sepia", exact: true }).check(); await expect(dialog.getByLabel("Text size", {exact:true})).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Reading settings", exact: true })).toHaveCSS("background-color", "rgb(244, 236, 216)");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await selectReaderAction(page, "Reading settings");
  await page.evaluate(() => { const frame = requestAnimationFrame.bind(window); window.requestAnimationFrame = fn => frame(time => { setTimeout(() => fn(time),400); }); });
  await dialog.getByLabel("Text size", {exact:true}).selectOption("28");
  await dialog.getByRole("button", { name: "Close reading settings" }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "Exit", exact: true })).toBeEnabled();
  await room.reopen(); expect((await room.position()).cfi).toBe(before.cfi); expect((await room.position()).done).toBe(true);
  await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "sepia");
  await page.reload(); await expect(page.locator(".reader-controls > button:nth-child(2)")).toBeEnabled();
  expect((await room.position()).cfi).toBe(before.cfi);
  const response = await request.get(`/api/rooms/${room.code}/state`, { headers: room.headers }); expect(response.ok()).toBeTruthy();
  expect((await response.json()).me.cfi).toBe(before.cfi);
  await selectReaderAction(page, "Reading settings"); await expect(dialog.getByLabel("Text size", {exact:true})).toHaveValue("28");
  await dialog.getByRole("button", { name: "Reset", exact: true }).click(); await expect(dialog.getByLabel("Text size", {exact:true})).toBeEnabled();
  await expect(dialog.getByLabel("Text size", {exact:true})).toHaveValue("20"); await expect(dialog.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Close reading settings" }).click();
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(trigger).toBeEnabled();
    expect(await page.locator(".reader-controls button").evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("personal settings cross books, stay independent of partner, and storage failure remains usable", async ({ page, browser, baseURL }, testInfo) => {
  await page.addInitScript(key => { if (!sessionStorage.getItem("settings-fixture")) { localStorage.setItem(key, '{broken'); sessionStorage.setItem("settings-fixture", "1"); } }, KEY);
  const room = await openReader(page);
  const options = testInfo.project.use;
  const context = await browser.newContext({ viewport: options.viewport, isMobile: options.isMobile, hasTouch: options.hasTouch });
  const partner = await context.newPage();
  try {
    await partner.goto(baseURL!); await partner.getByLabel("Room code").fill(room.code);
    await partner.getByRole("button", { name: "Join / reopen room" }).click();
    await expect(partner.getByRole("button", { name: "Done here", exact: true })).toBeEnabled();
    await selectReaderAction(page, "Reading settings");
    await page.getByLabel("Text size", {exact:true}).selectOption("28"); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
    await page.getByRole("radio", { name: "Dark", exact: true }).check(); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
    await expect(partner.locator(".reader")).toHaveAttribute("data-reading-theme", "light");
    await expect(partner.frameLocator(".book-view iframe").locator("body")).toHaveCSS("font-size", "20px");
    await page.getByRole("button", { name: "Close reading settings" }).click();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).toEqual({version:2,theme:"dark",fontSize:28,font:"serif",lineHeight:1.6,textWidth:"standard",alignment:"original"});
    await openReader(page); await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "dark");
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name,value) { if(name === key) throw new Error("Settings storage blocked"); return original.call(this,name,value); };
    }, KEY);
    await selectReaderAction(page, "Reading settings");
    await page.getByRole("radio", { name: "Sepia", exact: true }).check(); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
    await expect(page.getByText("Settings work for this session, but cannot be saved on this device.")).toBeVisible();
    await expect(page.locator(".reader")).toHaveAttribute("data-reading-theme", "sepia");
  } finally { await context.close(); }
});

test("author styles remain readable without changing emphasis or SVG; fixed layout disables text sizing", async ({ page }) => {
  await openReader(page, "normal", "styled");
  await selectReaderAction(page, "Reading settings");
  await page.getByLabel("Text size", {exact:true}).selectOption("28"); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
  await page.getByRole("radio", { name: "Dark", exact: true }).check(); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
  const frame = page.frameLocator(".book-view iframe");
  await expect(frame.locator("body")).toHaveCSS("font-size", "28px");
  await expect(frame.locator("p").first()).toHaveCSS("font-size", "28px");
  await expect(frame.locator("p").first()).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator(".bodytext")).toHaveCSS("font-family", "Georgia, serif");
  await page.getByLabel("Prose alignment").selectOption("left"); await expect(page.getByLabel("Prose alignment")).toBeEnabled();
  await expect(frame.locator(".bodytext")).toHaveCSS("text-align", "left");
  await expect(frame.locator(".verse")).toHaveCSS("text-align", "center");
  await page.getByLabel("Font", {exact:true}).selectOption("original"); await expect(page.getByLabel("Font",{exact:true})).toBeEnabled();
  await expect(frame.locator(".bodytext")).toHaveCSS("font-family", "Arial, sans-serif");
  await expect(frame.locator("em")).toHaveCSS("font-style", "italic");
  const heading = await frame.locator("h1").evaluate(element => parseFloat(getComputedStyle(element).fontSize)); expect(heading).toBeGreaterThan(28);
  await expect(frame.locator("code")).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator("td")).toHaveCSS("color", "rgb(233, 237, 242)");
  await expect(frame.locator("svg circle")).toHaveAttribute("fill", "#ff0000");
  await expect(frame.locator("svg")).toHaveCSS("filter", "none");
  await page.getByRole("button", { name: "Close reading settings" }).click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await openReader(page, "normal", "fixed");
  await selectReaderAction(page, "Reading settings");
  await expect(page.getByLabel("Text size", {exact:true})).toBeDisabled();
  for(const label of ["Font","Line spacing","Text width","Prose alignment"]) await expect(page.getByLabel(label,{exact:true})).toBeDisabled();
  await expect(page.locator(".book-area")).toHaveClass(/fixed-layout/);
  await expect(page.getByText("This fixed-layout book keeps its original typography and width. You can change the theme.")).toBeVisible();
});

test("reflow timeout rolls back settings and ignores late frames before a successful retry", async ({ page }) => {
  const room = await openReader(page); const before = await room.position();
  await page.setViewportSize({width:1024,height:900});
  await expect(page.getByRole("button",{name:"Next page"})).toBeEnabled();
  const geometry=await page.locator(".book-view").boundingBox();
  await selectReaderAction(page, "Reading settings");
  await page.evaluate(() => {
    const frame = requestAnimationFrame.bind(window);
    (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame = frame;
    (window as unknown as { lateFrames: number }).lateFrames = 0;
    window.requestAnimationFrame = fn => frame(time => { setTimeout(() => { fn(time); (window as unknown as { lateFrames: number }).lateFrames++; },6500); });
  });
  await page.getByLabel("Text size", {exact:true}).selectOption("28");
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Text size", {exact:true})).toHaveValue("20");
  expect((await room.position()).cfi).toBe(before.cfi);
  // The required visible error banner consumes height; the text column must roll back.
  expect((await page.locator(".book-view").boundingBox())!.width).toBe(geometry!.width);
  await page.evaluate(() => { window.requestAnimationFrame = (window as unknown as { originalFrame: typeof requestAnimationFrame }).originalFrame; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { lateFrames: number }).lateFrames)).toBeGreaterThan(0);
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.getByLabel("Text size", {exact:true}).selectOption("28"); await expect(page.getByLabel("Text size", {exact:true})).toBeEnabled();
  await expect(page.frameLocator(".book-view iframe").locator("body")).toHaveCSS("font-size", "28px");
});

test("extended typography and viewport themes preserve passage on phone and tablet", async ({ page }, testInfo) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({version:1,theme:"sepia",fontSize:18})), KEY);
  const room = await openReader(page, "nested");
  await selectReaderAction(page,"Contents");
  await page.getByRole("dialog").getByRole("button",{name:/<b>River passage/}).click();
  await page.getByRole("button",{name:"Done here",exact:true}).click();
  const before=await room.position();
  for (const viewport of [{width:390,height:844},{width:820,height:1180},{width:1180,height:820}]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button",{name:"Next page"})).toBeEnabled();
    await selectReaderAction(page,"Reading settings");
    await expect(page.getByLabel("Text size", {exact:true})).toHaveValue("18");
    for (const [font,family] of [["sans","sans-serif"],["serif","Georgia"],["original",""]]) {
      await page.getByLabel("Font",{exact:true}).selectOption(font);
      await expect(page.getByLabel("Font",{exact:true})).toBeEnabled();
      if(family) await expect.poll(()=>page.frameLocator(".book-view iframe").locator("p").first().evaluate(el=>getComputedStyle(el).fontFamily)).toContain(family);
    }
    for (const spacing of ["1.4","2","1.6"]) {
      await page.getByLabel("Line spacing").selectOption(spacing); await expect(page.getByLabel("Line spacing")).toBeEnabled();
      await expect.poll(()=>page.frameLocator(".book-view iframe").locator("p").first().evaluate(el=>parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(18*Number(spacing),3);
    }
    for (const width of ["narrow","wide","standard"]) {
      await page.getByLabel("Text width").selectOption(width); await expect(page.getByLabel("Text width")).toBeEnabled();
      const bookWidth=(await page.locator(".book-view").boundingBox())!.width;
      expect(bookWidth).toBeCloseTo(Math.min(viewport.width,18*({narrow:27,standard:32,wide:40}[width as "narrow"|"standard"|"wide"])),0);
      expect((await room.position()).cfi).toBe(before.cfi);expect((await room.position()).done).toBe(true);
    }
    await page.getByLabel("Prose alignment").selectOption("left");await expect(page.getByLabel("Prose alignment")).toBeEnabled();
    await expect(page.frameLocator(".book-view iframe").locator("p").first()).toHaveCSS("text-align","left");
    await expect(page.locator("body")).toHaveCSS("background-color","rgb(244, 236, 216)");
    await page.getByRole("button",{name:"Close reading settings"}).click();
    await expectPassageInView(page);
    await selectReaderAction(page,"Reading settings");
    await page.screenshot({path:testInfo.outputPath(`settings-${viewport.width}.png`)});
    await page.getByRole("button",{name:"Close reading settings"}).click();
  }
});

test("focus mode reserves geometry, ignores selections and gestures, and restores by tap and iframe Escape", async ({page}) => {
  const room=await openReader(page);
  await page.getByRole("button",{name:"Done here",exact:true}).click();
  const before=await room.position();
  const box=await page.locator(".book-view").boundingBox();
  await selectReaderAction(page,"Hide interface");
  await expect(page.getByRole("dialog",{name:"Hide interface"})).toBeVisible();
  await page.getByRole("button",{name:"Hide controls",exact:true}).click();
  await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","true");
  await expect(page.getByRole("button",{name:"Exit",exact:true})).toBeHidden();
  expect(await page.locator(".book-view").boundingBox()).toEqual(box);
  expect(await room.position()).toEqual(before);
  const frame=page.frameLocator(".book-view iframe");
  await frame.locator("body").evaluate(async body=>{
    const win=body.ownerDocument.defaultView!,x=win.innerWidth/2,y=win.innerHeight/2;
    const pointer=(target:Element,type:string)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0,clientX:x,clientY:y}));
    const link=body.ownerDocument.createElement("a");link.href="#passage";body.append(link);
    pointer(link,"pointerdown");pointer(link,"pointerup");link.remove();
    pointer(body,"pointerdown");await new Promise(resolve=>setTimeout(resolve,350));pointer(body,"pointerup");
  });
  await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","true");
  await frame.locator("body").evaluate(body=>{
    const doc=body.ownerDocument, win=doc.defaultView!;
    const x=win.innerWidth/2,y=win.innerHeight/2;
    const event=(type:string,clientX:number)=>body.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0,clientX,clientY:y}));
    event("pointerdown",x);event("pointermove",x+70);event("pointerup",x+70);
  });
  await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","true");
  await frame.locator("body").evaluate(body=>{
    const doc=body.ownerDocument,range=doc.createRange();range.selectNodeContents(body.querySelector("p")!);doc.defaultView!.getSelection()!.addRange(range);
    const win=doc.defaultView!,x=win.innerWidth/2,y=win.innerHeight/2;
    for(const type of ["pointerdown","pointerup"]) body.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0,clientX:x,clientY:y}));
  });
  await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","true");
  await frame.locator("body").evaluate(body=>{body.ownerDocument.defaultView!.getSelection()!.removeAllRanges();});
  await expect(page.getByRole("button",{name:"Highlight selection"})).toHaveCount(0);
  await frame.locator("body").evaluate(body=>body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  await expect(page.getByRole("button",{name:"Reader menu"})).toBeFocused();
  await selectReaderAction(page,"Hide interface");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await frame.locator("body").evaluate(body=>{
    const win=body.ownerDocument.defaultView!,x=win.innerWidth/2,y=win.innerHeight/2;
    for(const type of ["pointerdown","pointerup"]) body.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0,clientX:x,clientY:y}));
  });
  await expect(page.getByRole("button",{name:"Reader menu"})).toBeFocused();
  expect(await page.locator(".book-view").boundingBox()).toEqual(box);expect(await room.position()).toEqual(before);
  await selectReaderAction(page,"Hide interface");
  await page.getByRole("button",{name:"Show interface",exact:true}).press("Enter");
  await expect(page.getByRole("button",{name:"Reader menu"})).toBeFocused();
  await room.reopen();await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","false");
});

test("width reflow failure restores confirmed geometry and settings after applying a draft",async({page})=>{
  await page.setViewportSize({width:1024,height:900});
  const room=await openReader(page);const before=await room.position();
  const geometry=await page.locator(".book-view").boundingBox();
  await selectReaderAction(page,"Reading settings");
  await page.evaluate(()=>{
    const frame=requestAnimationFrame.bind(window),setProperty=CSSStyleDeclaration.prototype.setProperty;
    (window as unknown as {restoreReflowFixture:()=>void}).restoreReflowFixture=()=>{window.requestAnimationFrame=frame;CSSStyleDeclaration.prototype.setProperty=setProperty;};
    CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){
      setProperty.call(this,name,value,priority);
      if(name==="--text-width"&&value==="800px") window.requestAnimationFrame=callback=>frame(time=>{setTimeout(()=>callback(time),6500);});
    };
  });
  await page.getByLabel("Text width").selectOption("wide");
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Text width")).toHaveValue("standard");
  // The required visible error banner consumes height; the text column must roll back.
  expect((await page.locator(".book-view").boundingBox())!.width).toBe(geometry!.width);
  expect((await room.position()).cfi).toBe(before.cfi);
  await page.evaluate(()=>(window as unknown as {restoreReflowFixture:()=>void}).restoreReflowFixture());
  await page.getByLabel("Text width").selectOption("narrow");await expect(page.getByLabel("Text width")).toBeEnabled();
  await expect.poll(async()=>(await page.locator(".book-view").boundingBox())!.width).toBe(540);
  expect((await room.position()).cfi).toBe(before.cfi);
});
