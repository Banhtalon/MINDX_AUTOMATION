import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root = process.cwd();
const cssPath = path.join(root, 'src/app/globals.css');
const css = (await postcss([tailwind({base:root})]).process(fs.readFileSync(cssPath,'utf8'),{from:cssPath})).css;
fs.writeFileSync('probe.css',css);
class SequentialTaskQueue { tail=Promise.resolve(); run(fn){ return this.tail=this.tail.then(fn); } }
const queue=new SequentialTaskQueue();
const context = await chromium.launchPersistentContext(path.join(root,'playwright-auth'), {headless:true});
try {
 const page=await context.newPage();
 await queue.run(()=>page.setContent(`<html data-theme="light"><head><style>${css}</style></head><body class="mindx-body"><main class="mindx-main"><div class="mindx-hero"><h1>Hero</h1><div class="bg-white/95 dark:bg-slate-900/90"><select id="picker" class="bg-transparent text-slate-900 dark:text-white"><option>REVIEW-CLASS</option></select><input id="input" class="bg-transparent text-slate-900 dark:text-white" value="REVIEW-CLASS" /></div><span id="count-bg" class="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-200 font-semibold">Học viên: <strong id="count" class="text-white">7</strong></span></div><table><thead class="mindx-thead"><tr><th><div id="title" class="text-white">Lesson title</div></th></tr></thead></table></main></body></html>`));
 const results=[];
 for (const os of ['light','dark']) for (const app of ['light','dark']) {
  await queue.run(()=>page.emulateMedia({colorScheme:os}));
  await queue.run(()=>page.evaluate(t=>document.documentElement.dataset.theme=t,app));
  results.push(await queue.run(()=>page.evaluate(({os,app})=>{
   const style=id=>{const c=getComputedStyle(document.getElementById(id));return {color:c.color,bg:c.backgroundColor};};
   return {os,app,picker:style('picker'),input:style('input'),pickerWrapper:getComputedStyle(document.getElementById('picker').parentElement).backgroundColor,count:style('count'),countBg:style('count-bg'),title:style('title')};
  },{os,app})));
 }
 console.log(JSON.stringify(results,null,2));
 fs.writeFileSync('theme-probe-results.json',JSON.stringify(results,null,2));
 await queue.run(()=>page.evaluate(()=>document.documentElement.dataset.theme='light'));
 await queue.run(()=>page.screenshot({path:'theme-probe-light.png'}));
} finally { await context.close(); }
