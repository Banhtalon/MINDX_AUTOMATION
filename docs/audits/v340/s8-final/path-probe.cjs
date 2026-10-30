const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const req = createRequire(path.join(process.cwd(),'package.json'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'mindx-s8-path-'));
const allowed = path.join(fixture,'allowed');
const denied = path.join(fixture,'outside-allowlist');
fs.mkdirSync(allowed); fs.mkdirSync(denied);
fs.mkdirSync(path.join(denied,'SYNTHETIC_PRIVATE_DIRECTORY'));
async function main(){
  const {config} = req('./src/lib/config.ts');
  // In-process synthetic negative test, like the mandatory suites' own overrides.
  config.allowedLocalDirs = [allowed];
  const security = req('./src/lib/security/path-allowlist.ts');
  let assertionDenied=false;
  try{security.assertPathAllowed(denied);}catch{assertionDenied=true;}
  const {POST} = req('./src/app/api/spck/browse-folder/route.ts');
  const response=await POST(new Request('http://127.0.0.1:3000/api/spck/browse-folder',{
    method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},
    body:JSON.stringify({action:'list',path:denied})}));
  const body=await response.json();
  const result={fixtureOnly:true,configurationOverride:'config.allowedLocalDirs=[synthetic allowed folder] inside test',
    assertPathAllowedDenied:assertionDenied,routeStatus:response.status,
    returnedSyntheticDirectory:body.directories?.some(x=>x.name==='SYNTHETIC_PRIVATE_DIRECTORY'),
    expectedStatus:403,policyPass:response.status===403,
    directoryUnregistered:!security.getAllowedDirectories().some(x=>x===denied)};
  fs.writeFileSync(process.env.AUDIT_PATH_OUT,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
