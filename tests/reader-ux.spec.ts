import { test, expect, type Page } from "@playwright/test";
import { openReader } from "./reader-fixture";
import { selectReaderAction } from "./reader-menu";

async function selectVisiblePassage(page: Page, backwards = false, bottom = false) {
  return page.locator(".book-view iframe").evaluate((element, options) => {
    const frame = element as HTMLIFrameElement, doc = frame.contentDocument!;
    const origin = frame.getBoundingClientRect(), clip = frame.closest(".book-view")!.getBoundingClientRect();
    const candidates: { node: Text; start: number; end: number; y: number }[] = [];
    for (const paragraph of doc.querySelectorAll("p")) {
      const node = paragraph.firstChild;
      if (node?.nodeType !== Node.TEXT_NODE) continue;
      const visible: number[] = [];
      for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
        const letter = doc.createRange(); letter.setStart(node,index); letter.setEnd(node,index+1);
        const box = letter.getBoundingClientRect();
        if (origin.left + box.left >= clip.left && origin.left + box.right <= clip.right && origin.top + box.top >= clip.top + 8 && origin.top + box.bottom <= clip.bottom - 8) visible.push(index);
      }
      if (visible.length >= 60) {
        const start = visible[0], end = Math.min(visible[visible.length-1]+1,start+115);
        const range=doc.createRange(); range.setStart(node,start); range.setEnd(node,end);
        candidates.push({node:node as Text,start,end,y:range.getBoundingClientRect().bottom});
      }
    }
    const candidate = options.bottom ? candidates.at(-1) : candidates[0];
    if (!candidate) throw new Error("No sufficiently long visible passage");
    const {node,start,end}=candidate, selected=doc.getSelection()!;
    selected.setBaseAndExtent(node,options.backwards?end:start,node,options.backwards?start:end);
    const range=selected.getRangeAt(0), caret=range.cloneRange(); caret.setStart(node,options.backwards?start:end); caret.collapse(true);
    const boxes=Array.from(range.getClientRects()).filter(box=>origin.left+box.right>clip.left&&origin.left+box.left<clip.right);
    const endpoint=caret.getClientRects()[0] || (options.backwards?boxes[0]:boxes.at(-1))!;
    return {quote:selected.toString().trim(),x:origin.left+(options.backwards?endpoint.left:endpoint.right),top:origin.top+endpoint.top,bottom:origin.top+endpoint.bottom,
      rangeBottom:origin.top+boxes.at(-1)!.bottom,translated:origin.left<clip.left-50,lines:boxes.length};
  }, {backwards,bottom});
}

test("selection actions follow forward and reverse multiline endpoints on translated pages", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const room=await openReader(page);
  await page.getByRole("button",{name:"Skip tips"}).click();
  for (const [index,viewport] of [{width:390,height:844},{width:820,height:1180},{width:1180,height:820},{width:844,height:390}].entries()) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button",{name:"Done here",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"Next page",exact:true}).click();
    await expect(page.getByRole("button",{name:"Done here",exact:true})).toBeEnabled();
    const before=await room.position();
    let previous: {x:number;y:number}|null=null;
    for (const backwards of [false,true]) {
      const endpoint=await selectVisiblePassage(page,backwards);
      expect(endpoint.translated).toBe(true); expect(endpoint.lines).toBeGreaterThan(1);
      const toolbar=page.getByRole("group",{name:"Selected text actions"});
      await expect(toolbar).toBeVisible();
      await expect.poll(async()=>{
        const box=(await toolbar.boundingBox())!;
        return Math.min(Math.abs(box.y-endpoint.bottom),Math.abs(box.y+box.height-endpoint.top));
      }).toBeLessThanOrEqual(17);
      const box=(await toolbar.boundingBox())!,area=(await page.locator(".book-area").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(area.x); expect(box.x+box.width).toBeLessThanOrEqual(area.x+area.width);
      expect(box.y).toBeGreaterThanOrEqual(area.y); expect(box.y+box.height).toBeLessThanOrEqual(area.y+area.height);
      expect(box.width).toBeLessThan(120);
      if(previous)expect(Math.abs(box.x-previous.x)+Math.abs(box.y-previous.y)).toBeGreaterThan(10);
      previous={x:box.x,y:box.y};
      await page.screenshot({path:testInfo.outputPath(`selection-${index}-${backwards?"reverse":"forward"}.png`)});
    }
    const endpoint=await selectVisiblePassage(page,false,true);
    const highlight=page.getByRole("button",{name:"Highlight selection",exact:true});
    await expect(highlight).toBeVisible();
    await expect.poll(async()=>{
      const box=(await page.getByRole("group",{name:"Selected text actions"}).boundingBox())!;
      return Math.min(Math.abs(box.y-endpoint.bottom),Math.abs(box.y+box.height-endpoint.top));
    }).toBeLessThanOrEqual(17);
    // Native input must retain the captured passage on both touch engines.
    const button=(await highlight.boundingBox())!;
    await page.touchscreen.tap(button.x+button.width/2,button.y+button.height/2);
    await expect(page.getByRole("dialog").locator("blockquote")).toHaveText(endpoint.quote);
    const submitted=page.waitForRequest(request=>request.url().endsWith(`/api/rooms/${room.code}/highlights`)&&request.method()==="POST");
    await page.getByRole("button",{name:"Save highlight",exact:true}).click();
    const saved=(await submitted).postDataJSON(); expect(saved.quote).toBe(endpoint.quote);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Check the saved CFI's rendered mark at the new selection, not just its quote.
    await expect(page.locator(`.shared-highlight[data-id="${saved.id}"] rect`).first()).toBeAttached();
    const ends=await page.locator(`.shared-highlight[data-id="${saved.id}"] rect`).evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().bottom));
    expect(Math.min(...ends.map(bottom=>Math.abs(bottom-endpoint.rangeBottom)))).toBeLessThan(5);
    expect(await room.position()).toEqual(before);
  }
});

test("compact search and reordered settings fit phone tablet desktop and every theme", async ({ page },testInfo) => {
  test.setTimeout(240000);
  await openReader(page); await page.getByRole("button",{name:"Skip tips"}).click();
  for(const viewport of [{width:320,height:640},{width:820,height:1180},{width:1180,height:820},{width:1280,height:800}]) {
    await page.setViewportSize(viewport); await expect(page.getByRole("button",{name:"Done here",exact:true})).toBeEnabled();
    for(const theme of ["Light","Dark","Sepia"]) {
      await selectReaderAction(page,"Reading settings");
      const settings=page.getByRole("dialog",{name:"Reading settings",exact:true});
      await settings.getByRole("radio",{name:theme,exact:true}).check(); await expect(settings.getByLabel("Font",{exact:true})).toBeEnabled();
      expect(await settings.locator("legend").allTextContents()).toEqual(["Theme","Typography"]);
      await expect(settings.getByLabel("Font sample")).toHaveCount(0);
      await expect(settings.getByText(/Saved on this device/)).toHaveCount(0);
      await page.screenshot({path:testInfo.outputPath(`settings-${viewport.width}-${theme}.png`)});
      await settings.getByRole("button",{name:"Close reading settings"}).click();
      await selectReaderAction(page,"Search book");
      const search=page.getByRole("dialog",{name:"Search book",exact:true}),input=search.getByLabel("Find in book");
      await expect(search.getByText(/Search runs on this device/)).toHaveCount(0);
      await expect(search.getByRole("button",{name:"Close search"})).toHaveAttribute("title","Close search");
      const query=(await input.boundingBox())!,submit=(await search.getByRole("button",{name:"Search",exact:true}).boundingBox())!;
      expect(submit.x).toBeGreaterThan(query.x+query.width); expect(Math.abs(submit.y-query.y)).toBeLessThan(2);
      await input.fill("paragraph 1."); await input.press("Enter"); await expect(search.locator(".search-results li")).toHaveCount(2);
      expect(await search.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`search-${viewport.width}-${theme}.png`)});
      await search.getByRole("button",{name:"Close search"}).click(); await expect(page.getByRole("button",{name:"Reader menu",exact:true})).toBeFocused();
    }
  }
});

test("immediate selection changes snapshot the same live quote and CFI and retain length limits",async({page})=>{
  const room=await openReader(page); await page.getByRole("button",{name:"Skip tips"}).click();
  await selectVisiblePassage(page); await expect(page.getByRole("button",{name:"Highlight selection",exact:true})).toBeVisible();
  // Same JavaScript task: no epub.js callback or 400ms fallback poll can update
  // the captured draft between changing the range and activating its action.
  const expected=await page.evaluate(()=>{
    const frame=document.querySelector<HTMLIFrameElement>(".book-view iframe")!,doc=frame.contentDocument!;
    const node=doc.querySelectorAll("p")[1].firstChild!,range=doc.createRange(); range.setStart(node,0);range.setEnd(node,45);
    const selected=doc.getSelection()!;selected.removeAllRanges();selected.addRange(range);
    const box=range.getBoundingClientRect(),origin=frame.getBoundingClientRect();
    const quote=selected.toString().trim();document.querySelector<HTMLButtonElement>('button[aria-label="Highlight selection"]')!.click();
    return {quote,bottom:origin.top+box.bottom};
  });
  await expect(page.getByRole("dialog").locator("blockquote")).toHaveText(expected.quote);
  const submitted=page.waitForRequest(request=>request.url().endsWith(`/api/rooms/${room.code}/highlights`)&&request.method()==="POST");
  await page.getByRole("button",{name:"Save highlight",exact:true}).click();const saved=(await submitted).postDataJSON();expect(saved.quote).toBe(expected.quote);
  const mark=page.locator(`.shared-highlight[data-id="${saved.id}"] rect`);await expect(mark.first()).toBeAttached();
  const ends=await mark.evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().bottom));
  expect(Math.min(...ends.map(bottom=>Math.abs(bottom-expected.bottom)))).toBeLessThan(5);
  await selectVisiblePassage(page);await expect(page.getByRole("button",{name:"Highlight selection",exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const doc=document.querySelector<HTMLIFrameElement>(".book-view iframe")!.contentDocument!,range=doc.createRange();range.selectNodeContents(doc.body);
    const selected=doc.getSelection()!;selected.removeAllRanges();selected.addRange(range);
    document.querySelector<HTMLButtonElement>('button[aria-label="Highlight selection"]')!.click();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByRole("alert").filter({hasText:"Select a shorter passage"})).toBeVisible();
});

test("first reading tips are contextual optional suspendable and dismissed across books",async({page},testInfo)=>{
  const room=await openReader(page),tips=page.getByRole("region",{name:"Reading tips"});
  await expect(tips).toHaveAttribute("data-tip-step","1");
  const area=await page.locator(".book-area").boundingBox(),before=await room.position();
  await expect(page.getByRole("button",{name:"Next page",exact:true})).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath("tips-page-turn.png")});
  await tips.getByRole("button",{name:"Next tip"}).click(); await expect(tips).toHaveAttribute("data-tip-step","2");
  await page.screenshot({path:testInfo.outputPath("tips-selection.png")});
  expect(await page.locator(".book-area").boundingBox()).toEqual(area); expect(await room.position()).toEqual(before);
  await selectVisiblePassage(page); await expect(tips).toHaveCount(0);
  await page.getByRole("button",{name:"Dismiss selection"}).click(); await expect(tips).toHaveAttribute("data-tip-step","2");
  await tips.getByRole("button",{name:"Next tip"}).click(); await expect(tips).toHaveAttribute("data-tip-step","3");
  await page.screenshot({path:testInfo.outputPath("tips-menu.png")});
  await selectReaderAction(page,"Reading settings"); await expect(tips).toHaveCount(0);
  await page.getByRole("button",{name:"Close reading settings"}).click(); await expect(tips).toHaveAttribute("data-tip-step","3");
  await selectReaderAction(page,"Hide interface"); await expect(tips).toHaveCount(0);
  await page.getByRole("button",{name:"Hide controls",exact:true}).click(); await expect(page.locator(".reader")).toHaveAttribute("data-interface-hidden","true");
  await expect(tips).toHaveCount(0);
  await selectVisiblePassage(page); await expect(page.getByRole("button",{name:"Highlight selection",exact:true})).toBeVisible();
  await expect(tips).toHaveCount(0); await page.getByRole("button",{name:"Dismiss selection"}).click();
  await page.keyboard.press("Escape"); await expect(tips).toHaveAttribute("data-tip-step","3");
  await tips.getByRole("button",{name:"Done",exact:true}).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button",{name:"Reader menu",exact:true})).toBeFocused();
  await room.reopen(); await expect(tips).toHaveCount(0);
  await openReader(page); await expect(tips).toHaveCount(0);
});

test("tips can be skipped when their own storage write is unavailable",async({page})=>{
  await page.addInitScript(()=>{const original=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value){if(key==="read-together:reading-tips:v1")throw new Error("Blocked tips storage");return original.call(this,key,value);};});
  await openReader(page); await page.getByRole("button",{name:"Skip tips"}).click();
  await expect(page.getByRole("region",{name:"Reading tips"})).toHaveCount(0);
  await page.getByRole("button",{name:"Next page",exact:true}).click(); await expect(page.getByRole("button",{name:"Done here",exact:true})).toBeEnabled();
});

test("homepage secondary actions have space and readable hover and focus states",async({page},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem("read-together:demo","ABCDEF123456"));
  await page.goto("/");
  const invite=page.getByRole("button",{name:"Have an invitation?",exact:true}),another=page.getByRole("button",{name:"Start another demo",exact:true});
  for(const width of [320,390,820,1280]){
    await page.setViewportSize({width,height:900});
    const a=(await invite.boundingBox())!,b=(await another.boundingBox())!;
    expect(Math.abs(a.y-b.y)>10||b.x-a.x-a.width>=10).toBe(true);
    await another.hover(); await expect(another).toHaveCSS("color","rgb(0, 79, 158)"); await expect(another).toHaveCSS("background-color","rgb(230, 239, 251)");
    await invite.focus(); await expect(invite).toHaveCSS("outline-style","solid");
    await page.screenshot({path:testInfo.outputPath(`home-secondary-${width}.png`),fullPage:true});
  }
});
