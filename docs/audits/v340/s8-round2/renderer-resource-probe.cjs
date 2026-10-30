const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.cwd(),'package.json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mindx-s8-render-resources-'));
const allowed=path.join(root,'allowed'),denied=path.join(root,'denied');
fs.mkdirSync(allowed);fs.mkdirSync(denied);
const image=path.join(denied,'SYNTHETIC_PRIVATE_IMAGE.png');
const py=spawnSync('python',['-c','import sys\nfrom PyQt6.QtGui import QImage,QColor\na=QImage(600,400,QImage.Format.Format_RGB32);a.fill(QColor(255,0,0));assert a.save(sys.argv[1])',image],{encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});
if(py.status!==0)throw Error(py.stderr);
async function main(){
 const {config}=req('./src/lib/config.ts');config.allowedLocalDirs=[allowed];
 const {isPathAllowed}=req('./src/lib/security/path-allowlist.ts');
 const {captureStudentAppScreenshots,resolveSafeStaticFile}=req('./src/lib/local-files/spck-app-screenshotter.ts');
 const url=pathToFileURL(image).href;
 const results=[];
 for(const [name,markup] of [
   ['control-no-image','<p>Offline synthetic control</p>'],
   ['quoted-file-img',`<img src="${url}" width="600" height="400">`],
   ['unquoted-file-img',`<img src=${url} width=600 height=400>`],
   ['body-background',`<body background="${url}"><p>Offline synthetic background</p></body>`],
   ['css-file-background',`<body style="background-image:url(${url})"><p>Offline synthetic CSS</p></body>`]
 ]){
  const dir=path.join(allowed,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'index.html'),`<html>${markup}</html>`);
  const cap=await captureStudentAppScreenshots({studentId:'S8_RESOURCE_'+name,folderPath:dir,useAiVision:false});
  const shot=cap.thumbnailPath;
  const read=spawnSync('python',['-c',`import sys,json\nfrom PyQt6.QtGui import QImage\nim=QImage(sys.argv[1]);n=0\nfor y in range(im.height()):\n for x in range(im.width()):\n  c=im.pixelColor(x,y)\n  if c.red()>240 and c.green()<15 and c.blue()<15:n+=1\nprint(json.dumps({'width':im.width(),'height':im.height(),'redPixels':n}))`,shot],{encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});
  if(read.status!==0)throw Error(read.stderr);
  const pixels=JSON.parse(read.stdout);
  results.push({name,markup,shot,capturedCount:cap.capturedCount,...pixels,policyPass:pixels.redPixels===0});
 }
 const output={fixtureOnly:true,root,privateImage:image,privateImageAllowed:isPathAllowed(image),resolverRejects:resolveSafeStaticFile(allowed,'/../denied/SYNTHETIC_PRIVATE_IMAGE.png'),results,passed:results.filter(x=>x.policyPass).length,failed:results.filter(x=>!x.policyPass).length};
 fs.writeFileSync(process.env.AUDIT_RENDERER_OUT,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));if(output.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
