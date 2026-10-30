const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.cwd(),'package.json'));
const {chromium}=req('playwright');
const original=chromium.launch;
let launches=0,contexts=0,closed=0,options;
chromium.launch=async()=>{launches++;return {
  newContext:async o=>{contexts++;options=o;return {newPage:async()=>({
    setContent:async()=>{},evaluate:async()=>false})};},
  close:async()=>{closed++;}
};};
async function main(){
  const {normalizeImagesToLms16x9}=req('./src/lib/local-files/spck-image-normalizer.ts');
  const result=await normalizeImagesToLms16x9([{buffer:Buffer.from('synthetic-image'),fit:'contain'}]);
  const output={mockOnly:true,realBrowserStarted:false,standaloneLaunches:launches,newContexts:contexts,
    closed,offline:options?.offline,returnedItems:result.length,usesPersistentContext:false,
    strictSinglePersistentContextPolicyPass:launches===0&&contexts===0};
  fs.writeFileSync(process.env.AUDIT_BROWSER_OUT,JSON.stringify(output,null,2));
  console.log(JSON.stringify(output));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{chromium.launch=original;});
