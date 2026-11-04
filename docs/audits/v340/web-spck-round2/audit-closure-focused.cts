const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),AdmZip=require('adm-zip');
const scanner=require('./src/lib/local-files/spck-scanner');
const archive=require('./src/lib/file-parsers/archive-reader');
const root=path.join(process.cwd(),'temp_submissions','round2-closure-focused-'+Date.now());
const out=path.join(path.dirname(process.cwd()),'round2','closure-focused-results.json');
assert.equal(process.env.ALLOWED_LOCAL_DIRS,process.env.TEMP);
assert.equal(process.env.MINDX_DB_PATH,path.join(process.env.TEMP,'mindx_codex_web_spck.db'));
fs.mkdirSync(root,{recursive:true});const checks=[];
function check(id,fn){try{checks.push({id,status:'PASS',evidence:fn()});console.log('PASS',id);}catch(e){checks.push({id,status:'FAIL',error:String(e.stack||e)});console.error('FAIL',id,e.message);}}
check('C01_F02_successful_zip_preserves_unbundled_over15MB',()=>{
const dir=path.join(root,'SourceSizes');fs.mkdirSync(path.join(dir,'CSS'),{recursive:true});
fs.writeFileSync(path.join(dir,'index.html'),'<h1>Boundary audit</h1>');fs.writeFileSync(path.join(dir,'CSS/style.css'),'body{color:red}');
const medium=path.join(dir,'medium.js'),large=path.join(dir,'over15.js');
fs.writeFileSync(medium,crypto.randomBytes(3*1024*1024).toString('hex'));fs.writeFileSync(large,'x'.repeat(15*1024*1024+1));
const pkg=scanner.scanStudentSpckFolder(dir),zipPath=pkg.allAttachments.find(p=>/_web_package\.zip$/.test(p));
assert.ok(zipPath);assert.equal(scanner.validateSpckAttachmentFile(zipPath).valid,true);
const entries=new AdmZip(zipPath).getEntries().filter(e=>!e.isDirectory).map(e=>e.entryName).sort();
assert.deepEqual(entries,['CSS/style.css','index.html','medium.js']);assert.deepEqual([...pkg.allAttachments].sort(),[zipPath,large].sort());assert.ok(pkg.warnings.some(w=>w.includes('over15.js')&&w.includes('15MB')));
return {mediumBytes:fs.statSync(medium).size,unbundledBytes:fs.statSync(large).size,entries,attachments:pkg.allAttachments.map(p=>path.basename(p)),warnings:pkg.warnings};});
check('C02_F01_F04_text_extensions_consistent_validation',()=>{
const source=fs.readFileSync(path.join(process.cwd(),'src/lib/local-files/spck-scanner.ts'),'utf8');
const match=source.match(/const TEXT_ATTACHMENT_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/);assert.ok(match);
const exts=[...match[1].matchAll(/"(\.[a-z0-9]+)"/g)].map(m=>m[1]);assert.ok(exts.length>10);
for(const ext of exts){const blank=path.join(root,'blank'+ext),nullFile=path.join(root,'null'+ext);fs.writeFileSync(blank,' \n\t');fs.writeFileSync(nullFile,Buffer.from([97,0,98]));assert.equal(scanner.validateSpckAttachmentFile(blank).valid,false,ext+' blank');assert.equal(scanner.validateSpckAttachmentFile(nullFile).valid,false,ext+' null');}
const zip=new AdmZip();for(const ext of ['.htm','.mjs','.text','.md','.csv','.xml']){const file=path.join(root,'valid'+ext);fs.writeFileSync(file,'audit valid text');assert.equal(scanner.validateSpckAttachmentFile(file).valid,true,ext);zip.addFile('valid'+ext,Buffer.from('audit valid text'));}
const parsed=archive.parseZipArchiveBuffer(zip.toBuffer(),'extensions.zip');assert.equal(parsed.success,true);assert.equal(parsed.summary.parsedCodeFiles,6);return{extensions:exts,invalidCases:exts.length*2,readableZipFiles:parsed.summary.parsedCodeFiles};});
fs.writeFileSync(out,JSON.stringify({time:new Date().toISOString(),checks},null,2));process.exitCode=checks.some(c=>c.status!=='PASS')?1:0;
