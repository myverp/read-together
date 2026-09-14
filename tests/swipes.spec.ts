import { test, expect, type Page } from '@playwright/test';
import { epub } from './epub';
async function pos(page: Page) { return page.evaluate(() => { const code=localStorage.getItem('read-together:room'); return JSON.parse(localStorage.getItem(`read-together:${code}:1`) || '{}').cfi; }); }
async function swipe(page: Page, dx = -160, dy = 0, fingers = 1, hold = 0) {
  await page.evaluate(async ({dx,dy,fingers,hold}) => {
    const body=document.querySelector<HTMLIFrameElement>('.book-view iframe')!.contentDocument!.body;

    const touches=(x:number,y:number) => Array.from({length:fingers},(_,id)=>({identifier:id,target:body,clientX:x+id*10,clientY:y}));
    const send=(type:string, list: ReturnType<typeof touches>, ended=false)=>{const event=new Event(type,{bubbles:true});Object.defineProperties(event,{touches:{value:ended?[]:list},changedTouches:{value:list}});body.dispatchEvent(event);};
    send('touchstart',touches(220,180));
    if(hold) await new Promise(r=>setTimeout(r,hold));
    send('touchmove',touches(220+dx,180+dy));
    send('touchend',touches(220+dx,180+dy),true);
  }, {dx,dy,fingers,hold});
}
test('swipes match buttons and reject short, vertical, multitouch, long press, selection and dialog gestures',async({page})=>{
 await page.goto('/');
 await expect(page.getByLabel('Choose an EPUB')).toBeEnabled();
 await page.getByLabel('Choose an EPUB').setInputFiles({name:'Swipe.epub',mimeType:'application/epub+zip',buffer:await epub()});
 await page.getByRole('button',{name:'Upload & create room'}).click();
 await expect(page.getByRole('button',{name:'Next page'})).toBeEnabled();
 const first=await pos(page);
 await page.getByRole('button',{name:'Next page'}).click();
 await expect.poll(()=>pos(page)).not.toBe(first); const next=await pos(page);
 await page.getByRole('button',{name:'Previous page'}).click();
 await expect.poll(()=>pos(page)).toBe(first);
 await swipe(page); await expect.poll(()=>pos(page)).toBe(next);
 await page.waitForTimeout(300); expect(await pos(page)).toBe(next);
 await swipe(page,160); await expect.poll(()=>pos(page)).toBe(first);
 for(const args of [[-20,0,1,0],[-70,140,1,0],[-160,0,2,0],[-160,0,1,550]]) {
  await swipe(page,...args as [number,number,number,number]); await page.waitForTimeout(250); expect(await pos(page)).toBe(first);
 }
 await page.frameLocator('.book-view iframe').locator('p').first().evaluate(el=>{const range=el.ownerDocument.createRange();range.selectNodeContents(el);const s=el.ownerDocument.getSelection()!;s.removeAllRanges();s.addRange(range);});
 await expect(page.getByRole('button',{name:'Highlight selection',exact:true})).toBeVisible();
 await swipe(page); await page.waitForTimeout(250); expect(await pos(page)).toBe(first);
 await page.getByRole('button',{name:'Highlight selection',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await swipe(page); await page.waitForTimeout(250); expect(await pos(page)).toBe(first);
 await page.getByRole('button',{name:'Close highlight'}).click();
 await swipe(page); await expect.poll(()=>pos(page)).toBe(next);
});

test('Chromium native touch delivery turns the iframe page once',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','CDP native touch injection is Chromium-only');
 await page.goto('/');await expect(page.getByLabel('Choose an EPUB')).toBeEnabled();
 await page.getByLabel('Choose an EPUB').setInputFiles({name:'Native swipe.epub',mimeType:'application/epub+zip',buffer:await epub()});
 await page.getByRole('button',{name:'Upload & create room'}).click();
 await expect(page.getByRole('button',{name:'Next page'})).toBeEnabled();
 const first=await pos(page);
 await page.getByRole('button',{name:'Next page'}).click();await expect.poll(()=>pos(page)).not.toBe(first);const next=await pos(page);
 await page.getByRole('button',{name:'Previous page'}).click();await expect.poll(()=>pos(page)).toBe(first);
 const frame=(await page.locator('.book-view iframe').boundingBox())!;
 const cdp=await context.newCDPSession(page);
 const point=(x:number)=>[{x:frame.x+x,y:frame.y+180,id:0}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(260)});
 for(const x of [230,200,170,140,100]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(x)});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>pos(page)).toBe(next);await page.waitForTimeout(300);expect(await pos(page)).toBe(next);
 await cdp.detach();
});

test('swipes keep working across EPUB sections and after reopening',async({page})=>{
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(await epub());
 for(const path of ['OEBPS/one.xhtml','OEBPS/two.xhtml']){let html=await zip.file(path)!.async('string');let n=0;html=html.replace(/<p>[\s\S]*?<\/p>/g,p=>++n<=4?p:'');zip.file(path,html);}
 await page.goto('/');await expect(page.getByLabel('Choose an EPUB')).toBeEnabled();
 await page.getByLabel('Choose an EPUB').setInputFiles({name:'Chapters.epub',mimeType:'application/epub+zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
 await page.getByRole('button',{name:'Upload & create room'}).click();await expect(page.getByRole('button',{name:'Next page'})).toBeEnabled();
 const label=page.locator('.reader-status > div').first();
 for(let i=0;i<12 && !(await label.innerText()).includes('Coming home');i++){const before=await pos(page);await swipe(page);await expect.poll(()=>pos(page)).not.toBe(before);}
 await expect(label).toContainText('Coming home');const chapterStart=await pos(page);
 await swipe(page);await expect.poll(()=>pos(page)).not.toBe(chapterStart);
 await swipe(page,160);await expect.poll(()=>pos(page)).toBe(chapterStart);
 await page.getByRole('button',{name:'Exit',exact:true}).click();
 await page.getByRole('button',{name:'Join / reopen room'}).click();await expect(page.getByRole('button',{name:'Next page'})).toBeEnabled();
 await expect.poll(()=>pos(page)).toBe(chapterStart);await swipe(page);await expect.poll(()=>pos(page)).not.toBe(chapterStart);
});
