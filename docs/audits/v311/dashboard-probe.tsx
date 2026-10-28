// Static rendering of real Dashboard/TopNavbar + layout classes; no LMS or owner DB.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import Dashboard from '../../../src/app/page';
import { TopNavbar } from '../../../src/components/top-navbar';
import { getDb } from '../../../src/lib/db/sqlite';
import { assertPathAllowed } from '../../../src/lib/security/path-allowlist';

assert(process.cwd().includes('mindx-v311-review-'));
(globalThis as any).React = React;
const safe = (name: string) => assertPathAllowed(path.resolve(name));
const read = (name: string) => fs.readFileSync(safe(name),'utf8');
const write = (name: string, value: string) => fs.writeFileSync(safe(`docs/audits/v311/${name}`),value);
const db = getDb();
for (const classId of ['VT-C4K-PTA13','VT-ROB-SEMIA05','VT-KIND-ROB4I02','VT-ROB-ARMA13']) {
  db.prepare('INSERT OR IGNORE INTO classes_sessions (classId,className,sessionId,sessionNumber) VALUES (?,?,?,?)')
    .run(classId,classId,`${classId}_SESS_01`,1);
}
const layout = read('src/app/layout.tsx');
const mainClass = layout.match(/<main className="([^"]+)"/)![1];
const bodyClass = layout.match(/<body className="([^"]+)"/)![1];
const footerClass = layout.match(/<footer className="([^"]+)"/)![1];
const html = renderToStaticMarkup(<><TopNavbar/><main className={mainClass}><Dashboard/></main>
  <footer className={footerClass}>MindX Automation Bot • Local-Only Application • SQLite &amp; Playwright Engine</footer></>);
const css = read('docs/audits/v310/round3/probe.css');
class SequentialTaskQueue { tail: Promise<any> = Promise.resolve(); run<T>(fn:()=>Promise<T>):Promise<T> {this.tail=this.tail.then(fn);return this.tail;} }
const queue = new SequentialTaskQueue();
const context = await chromium.launchPersistentContext(safe('playwright-auth'), {headless:true});
const results:any[]=[];
try {
  const page = await queue.run(()=>context.newPage());
  for (const [width,height] of [[1440,900],[1366,768],[1920,1080],[1024,768]]) {
    await queue.run(()=>page.setViewportSize({width,height}));
    for (const theme of ['light','dark']) {
      await queue.run(()=>page.setContent(`<html data-theme="${theme}"><head><style>${css}</style></head><body class="${bodyClass}">${html}</body></html>`));
      const row = await queue.run(()=>page.evaluate(({width,height,theme})=>{
        const main=document.querySelector('main')!;
        const wrapper=main.firstElementChild!;
        const grid=wrapper.children[1];
        const cards=[...grid.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
        const bar=wrapper.lastElementChild!.getBoundingClientRect();
        const footer=document.querySelector('footer')!.getBoundingClientRect();
        return{width,height,theme,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,
          columns:getComputedStyle(grid).gridTemplateColumns,cards,barBottom:bar.bottom,footerTop:footer.top,bottomGap:footer.top-bar.bottom};
      },{width,height,theme}));
      results.push(row);
      assert.equal(row.scrollWidth,width,'No horizontal overflow on desktop');
      assert.equal(row.scrollHeight,height,'Fits viewport height without vertical overflow');
      assert.equal(row.cards[0].y,row.cards[1].y,'Two-column grid');
      assert.equal(row.cards[0].h,row.cards[1].h,'Balanced first row');
      assert(row.bottomGap<=16,'No huge empty bottom gap');
      if(width===1440 || width===1366) await queue.run(()=>page.screenshot({path:safe(`docs/audits/v311/dashboard-${width}-${theme}.png`),fullPage:true}));
    }
  }
} finally {await context.close();}
write('dashboard-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
