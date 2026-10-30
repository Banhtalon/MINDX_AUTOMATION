const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.cwd(), base = __dirname, mirror = path.join(base,'workspace');
fs.mkdirSync(mirror,{recursive:true});
for(const dir of ['src','scripts','data/config','.agents/skills']) fs.cpSync(path.join(root,dir),path.join(mirror,dir),{recursive:true});
for(const file of ['package.json','tsconfig.json','next-env.d.ts','start-bot.bat','start-bot.command']) if(fs.existsSync(path.join(root,file))) fs.copyFileSync(path.join(root,file),path.join(mirror,file));
function collect(dir,out={}){ if(!fs.existsSync(dir))return out; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.isDirectory())collect(p,out);else out[path.relative(root,p)]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}return out; }
const before={}; for(const dir of ['src','scripts','data/config','docs/audits'])collect(path.join(root,dir),before);
for(const file of ['next-env.d.ts','PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md'])before[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(base,'protected-before.json'),JSON.stringify(before,null,2));
fs.writeFileSync(path.join(base,'paths.json'),JSON.stringify({root,base,mirror}));
console.log(JSON.stringify({mirror,protectedFiles:Object.keys(before).length}));
