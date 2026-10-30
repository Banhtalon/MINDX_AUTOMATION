const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cp=require('node:child_process'),spawn=cp.spawnSync;
const {createRequire}=require('node:module');
const req=createRequire(path.join(process.cwd(),'package.json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mindx-s8-r3-payload-'));
const payloads=[];
cp.spawnSync=function(cmd,args,opts){
  if(cmd==='python' && args?.[1]?.includes('class SafeTextDocument')){
    const p=JSON.parse(opts.input);
    payloads.push({html:p.html,resourceKeys:Object.keys(p.resources),resourceByteLengths:Object.fromEntries(Object.entries(p.resources).map(([k,v])=>[k,Buffer.from(v,'base64').length]))});
  }
  return spawn.apply(this,arguments);
};
async function main(){
  const {config}=req('./src/lib/config.ts');config.allowedLocalDirs=[root];
  const {captureStudentAppScreenshots}=req('./src/lib/local-files/spck-app-screenshotter.ts');
  const cases=[
    ['inline-double', '<body style="background-image:url(images/red.png)"><p>synthetic</p></body>'],
    ['inline-single-control', "<body style='background-image:url(images/red.png)'><p>synthetic</p></body>"],
    ['stylesheet', '<link rel="stylesheet" href="css/site.css"><body><p>synthetic</p></body>'],
    ['style-control', '<style>body{background-image:url(images/red.png);}</style><body><p>synthetic</p></body>']
  ];
  const results=[];
  for(const [name,html] of cases){
    const dir=path.join(root,name);fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'images'));fs.mkdirSync(path.join(dir,'css'));
    const image=path.join(dir,'images/red.png');
    const mk=spawn('python',['-c','import sys\nfrom PyQt6.QtGui import QImage,QColor\nim=QImage(600,400,QImage.Format.Format_RGB32);im.fill(QColor(255,0,0));assert im.save(sys.argv[1])',image],{encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});if(mk.status!==0)throw Error(mk.stderr);
    fs.writeFileSync(path.join(dir,'index.html'),`<html>${html}</html>`);
    fs.writeFileSync(path.join(dir,'css/site.css'),'body{background-image:url(../images/red.png);}');
    const cap=await captureStudentAppScreenshots({studentId:'S8_R3_PAYLOAD_'+name,folderPath:dir,useAiVision:false});
    results.push({name,inputHtml:html,...payloads.at(-1),capturedCount:cap.capturedCount,shot:cap.thumbnailPath});
  }
  const scan=spawn('python',['-c',`import sys,json\nfrom PyQt6.QtGui import QImage\nns=[]\nfor p in json.loads(sys.stdin.read()):\n im=QImage(p);n=0\n for y in range(im.height()):\n  for x in range(im.width()):\n   c=im.pixelColor(x,y)\n   if c.red()>240 and c.green()<15 and c.blue()<15:n+=1\n ns.append(n)\nprint(json.dumps(ns))`],{input:JSON.stringify(results.map(x=>x.shot)),encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'}});if(scan.status!==0)throw Error(scan.stderr);
  const ns=JSON.parse(scan.stdout);results.forEach((r,i)=>r.redPixels=ns[i]);
  const out={fixtureOnly:true,sourceUnmodified:true,observedAt:'child_process.spawnSync input immediately before Python renderer',results};
  fs.writeFileSync(process.env.AUDIT_PAYLOAD_OUT,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>cp.spawnSync=spawn);
