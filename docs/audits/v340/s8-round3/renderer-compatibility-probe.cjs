const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const req = createRequire(path.join(process.cwd(), 'package.json'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-s8-r3-compat-'));
const allowed = path.join(root, 'allowed'), denied = path.join(root, 'denied');
fs.mkdirSync(allowed); fs.mkdirSync(denied);
const make = spawnSync('python', ['-c', 'import sys\nfrom PyQt6.QtGui import QImage,QColor\nim=QImage(600,400,QImage.Format.Format_RGB32);im.fill(QColor(255,0,0));assert im.save(sys.argv[1])', path.join(denied, 'red.png')], {encoding:'utf8', env:{...process.env, QT_QPA_PLATFORM:'offscreen'}});
if(make.status !== 0) throw Error(make.stderr);
async function main() {
  const {config} = req('./src/lib/config.ts'); config.allowedLocalDirs = [allowed];
  const {captureStudentAppScreenshots, resolveSafeStaticFile} = req('./src/lib/local-files/spck-app-screenshotter.ts');
  const forms = [
    ['quoted-img', r => `<img src="${r}" width="600" height="400">`],
    ['unquoted-img', r => `<img src=${r} width=600 height=400>`],
    ['body-background', r => `<body background="${r}"><p>synthetic</p></body>`],
    ['inline-css', r => `<body style="background-image:url(${r})"><p>synthetic</p></body>`],
    ['style-css', r => `<style>body {background-image:url(${r});}</style><body><p>synthetic</p></body>`],
    ['stylesheet-quoted', () => '<link rel="stylesheet" href="css/site.css"><body><p>synthetic</p></body>'],
    ['stylesheet-unquoted', () => '<link rel=stylesheet href=css/site.css><body><p>synthetic</p></body>']
  ];
  const pending = [];
  for (const mode of ['allowed','junction']) {
    for (const [form, html] of forms) {
      const name = mode + '-' + form, dir = path.join(allowed, name);
      fs.mkdirSync(dir); fs.mkdirSync(path.join(dir,'css'));
      if(mode === 'allowed') {
        fs.mkdirSync(path.join(dir,'images'));
        fs.copyFileSync(path.join(denied,'red.png'),path.join(dir,'images','red.png'));
      } else fs.symlinkSync(denied,path.join(dir,'images'),'junction');
      fs.writeFileSync(path.join(dir,'css','site.css'),'body {background-image:url(../images/red.png);}');
      const markup = html('images/red.png');
      fs.writeFileSync(path.join(dir,'index.html'),`<html>${markup}</html>`);
      const resolver = resolveSafeStaticFile(dir,'/images/red.png');
      const cap = await captureStudentAppScreenshots({studentId:'S8_R3_'+name,folderPath:dir,useAiVision:false});
      pending.push({name,mode,form,markup,resolver,capturedCount:cap.capturedCount,shot:cap.thumbnailPath});
    }
  }
  const scan = spawnSync('python',['-c',`import sys,json\nfrom PyQt6.QtGui import QImage\nout=[]\nfor p in json.loads(sys.stdin.read()):\n im=QImage(p);n=0\n for y in range(im.height()):\n  for x in range(im.width()):\n   c=im.pixelColor(x,y)\n   if c.red()>240 and c.green()<15 and c.blue()<15:n+=1\n out.append({'width':im.width(),'height':im.height(),'redPixels':n})\nprint(json.dumps(out))`],{input:JSON.stringify(pending.map(x=>x.shot)),encoding:'utf8',env:{...process.env,QT_QPA_PLATFORM:'offscreen'},timeout:120000});
  if(scan.status !== 0) throw Error(scan.stderr);
  const pixels = JSON.parse(scan.stdout);
  const results = pending.map((r,i)=>({...r,...pixels[i],pass:r.capturedCount>0 && pixels[i].width===960 && pixels[i].height===540 && (r.mode==='allowed' ? pixels[i].redPixels>1000 : pixels[i].redPixels===0)}));
  const output = {fixtureOnly:true,root,allowed,denied,results,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length};
  fs.writeFileSync(process.env.AUDIT_COMPAT_OUT,JSON.stringify(output,null,2));
  console.log(JSON.stringify(output,null,2));
  if(output.failed) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
