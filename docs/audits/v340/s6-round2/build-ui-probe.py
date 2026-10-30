import pathlib
out=pathlib.Path(__file__).resolve().parent
root=pathlib.Path((out/'mirror-path.txt').read_text(encoding='utf8'))
source=(root/'scripts/test-streamline-v340-s6.ts').read_text(encoding='utf8')
def fixture(name, end):
    start=source.index(f'      await {name}.evaluate(() => {{')
    return source[start:source.index(end,start)]
tp=fixture('pageTp','      await pageTp.addScriptTag')
spck=fixture('pageSpck','      await pageSpck.addScriptTag')
imports='''// @ts-nocheck -- reviewer probes, synthetic browser and HTTP fixtures only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as esbuild from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwindcssPostcss from '@tailwindcss/postcss';
const ROOT=process.cwd(), OUT=process.env.AUDIT_OUT!;
const results=[];
function record(id,expected,actual,detail=''){const item={id,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual),detail};results.push(item);console.log(JSON.stringify(item));fs.writeFileSync(path.join(OUT,'ui-observations.json'),JSON.stringify(results,null,2));}
const aliases={name:'alias-at',setup(build){build.onResolve({filter:/^@\\//},args=>{const base=path.join(ROOT,'src',args.path.slice(2));for(const ext of ['.tsx','.ts','.js','/index.tsx','/index.ts'])if(fs.existsSync(base+ext))return{path:base+ext};return{path:base};});}};
async function bundle(module){return(await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${module}';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:ROOT,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',target:['es2020'],plugins:[aliases],define:{'process.env.NODE_ENV':'"development"'}})).outputFiles[0].text;}
async function run(){
const css=(await postcss([tailwindcssPostcss({base:ROOT})]).process(fs.readFileSync(path.join(ROOT,'src/app/globals.css'),'utf8'),{from:path.join(ROOT,'src/app/globals.css')})).css;
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'codex-s6-r2-browser-')),{headless:true,viewport:{width:1366,height:900}});
await context.addInitScript("window.__name=(fn)=>fn;window.confirm=()=>true;window.alert=()=>{};");
await context.route('**/*',async route=>{if(route.request().resourceType()==='document' && route.request().url().startsWith('http://127.0.0.1:3000/'))await route.fulfill({contentType:'text/html',body:'<!DOCTYPE html><html><head><meta charset="utf-8"></head><body class="bg-slate-950 text-white"><div id="root"></div></body></html>'});else await route.abort();});
async function open(url){const p=await context.newPage();p.on('pageerror',e=>fs.appendFileSync(path.join(OUT,'ui-errors.log'),e.stack+'\\n'));await p.goto(url);await p.addStyleTag({content:css});return p;}
try {
const tpBundleCode=await bundle('./src/app/teaching-projects/page');
const spckBundleCode=await bundle('./src/app/final-project/page');
const hwBundleCode=await bundle('./src/app/homework-grader/page');
let pageTp=await open('http://127.0.0.1:3000/teaching-projects-test?classId=VT-C4K-JSB12');
'''
checks=(out/'ui-checks.ts.txt').read_text(encoding='utf8')
ending="\n}finally{await context.close();}\n}\nrun().catch(e=>{console.error(e);process.exitCode=1;});\n"
(out/'independent-ui.ts').write_text(imports+tp+checks.replace('/* SPCK_FIXTURE */',spck).replace('/* SPCK_UNASSIGN_FIXTURE */',spck.replace('pageSpck','unassign')).replace('/* TP_UNKNOWN_FIXTURE */',tp)+ending,encoding='utf8')
print('Built independent UI probes using real components and extended synthetic fixtures.')
