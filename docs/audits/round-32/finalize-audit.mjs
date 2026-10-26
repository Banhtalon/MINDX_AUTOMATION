// Read-only inventory of the main tree; all writes are confined to round-32.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..'),ev=path.join(out,'evidence');
const read=n=>JSON.parse(fs.readFileSync(path.join(ev,n),'utf8'));
const write=(n,v)=>fs.writeFileSync(path.join(ev,n),JSON.stringify(v,null,2)+'\n');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=read('preservation-before.json'),r=read('phase6-results.json'),commands=read('commands.json');
assert.equal(sha(path.join(out,'verify-phase6.mjs')),r.harnessSha256,'Final harness must match executed artifact');
for(const [file,hash]of Object.entries(r.sourceHashes))assert.equal(sha(path.join(root,file)),hash,'Exact source drift: '+file);
const definitions=[
 ['R32-01','P1','6.5','Snapshot duyệt thiếu trường/không bắt buộc; batch ghi dở dang',['src/app/api/spck/approve/route.ts:77','src/app/final-project/page.tsx:516']],
 ['R32-02','P1','6.5/6.4','Cùng thư mục có thể gán hai học viên qua alias đường dẫn',['src/app/api/spck/save-draft/route.ts:54','src/lib/playwright/spck-uploader.ts:333']],
 ['R32-03','P1','6.1/6.5','Xác nhận folder cũ được giữ cho folder mơ hồ mới',['src/app/api/spck/scan/route.ts:56']],
 ['R32-04','P1','6.4','Hash chưa khóa byte tài nguyên; không kiểm lại media',['src/lib/db/sqlite.ts:987','src/lib/playwright/spck-uploader.ts:207']],
 ['R32-05','P1','6.4','Phản hồi không đúng nghiệp vụ và DOM chưa persisted vẫn VERIFIED',['src/lib/playwright/spck-uploader.ts:638','src/lib/playwright/spck-uploader.ts:701']],
 ['R32-06','P1','6.4','Không chặn thay đổi trước Save; chỉ phát hiện sau ghi',['src/lib/playwright/spck-uploader.ts:650','src/lib/playwright/spck-uploader.ts:750']],
 ['R32-07','P1','6.3','Tên riêng mục tiêu/peer lọt vào prompt',['src/lib/gemini/spck-comment.ts:109','src/lib/gemini/spck-comment.ts:130']],
 ['R32-08','P1','6.3','AI không khóa toàn phiên bản; nhánh thiếu dữ kiện xóa nhận xét',['src/lib/gemini/spck-comment.ts:287','src/lib/gemini/spck-comment.ts:440']],
 ['R32-09','P1','6.5','Nháp/API/UI về sai thứ tự; lưu lỗi vẫn gọi duyệt/upload',['src/app/api/spck/save-draft/route.ts:137','src/app/final-project/page.tsx:347']],
 ['R32-10','P2','6.3/6.5','Tự chọn tags tích cực; lọt diễn đạt kỹ năng thuyết trình',['src/app/final-project/page.tsx:183','src/lib/gemini/spck-comment.ts:66']],
 ['R32-11','P2','6.5','Thiếu luồng chuyển ghép khỏi học viên cũ',['src/app/final-project/page.tsx:851','src/app/api/spck/save-draft/route.ts:54']],
 ['R32-12','P1','6.4','Thiếu xác minh thumbnail và upload hoàn tất',['src/lib/playwright/spck-uploader.ts:562','src/lib/playwright/spck-uploader.ts:731']],
 ['R32-13','P1','6.4','Selector card quá rộng và kiểm link bằng chuỗi con',['src/lib/playwright/selectors.ts:98','src/lib/playwright/spck-uploader.ts:551']]
];
const issues=definitions.map(([id,priority,task,title,locations])=>({id,priority,task,title,locations,status:'OPEN',cases:r.results.filter(t=>t.issue===id).map(t=>t.id),failedCases:r.results.filter(t=>t.issue===id&&!t.pass).map(t=>t.id)}));
assert(issues.every(i=>i.failedCases.length>0));assert(r.results.filter(t=>!t.pass).every(t=>issues.some(i=>i.id===t.issue)));
write('issue-status.json',{verdict:'NO-GO_SOURCE_PHASE6',total:issues.length,P1:issues.filter(i=>i.priority==='P1').length,P2:issues.filter(i=>i.priority==='P2').length,issues});
write('source-review.json',{reviewedAt:new Date().toISOString(),rules:['AGENTS.md','MINDX_AUTOMATION_PLAN.md: Giai đoạn 6 TASK-6.1..6.5 + nghiệm thu','Installed Next guide: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md'],scope:'UI -> six native API routes -> SQLite/scanner/AI -> SequentialTaskQueue -> uploader -> HTTP/DOM verification; phase 1-5 regression gates',productSourceHashes:r.sourceHashes,issues,staticControls:[{control:'dev/start bind 127.0.0.1',source:'package.json:8'},{control:'one persistent context with initialization promise',source:'src/lib/playwright/browser-manager.ts:36'},{control:'public uploader entry enqueues job',source:'src/lib/playwright/spck-uploader.ts:286'},{control:'six SPCK routes invoke local request guard before processing',evidence:r.results.filter(t=>t.id.startsWith('R32-L-')).map(t=>({id:t.id,pass:t.pass}))},{control:'scanner reads through allowlist and validates media',source:'src/lib/local-files/spck-scanner.ts:259'},{control:'Client imports reviewed; prohibited names/imports absent',evidence:'R32-U05'}]});
const latest={};for(const c of commands)latest[c.name]=c;
const order=['independent','phase6','phase5','phase4','r12','r13','r16','r17','r31','typecheck-before','build','typecheck-after'];
let matrix='# Ma trận kiểm chứng AUDIT-R32\n\nPhán quyết Giai đoạn 6: **NO-GO cấp mã nguồn**. Lượt độc lập cuối: **34/67 đạt, 33 trượt**, thuộc 13 nhóm lỗi. Kết quả dưới đây đều chạy mới trong TEMP; giữ nguyên raw FAIL của R16. Không cộng trùng các bộ lịch sử thành tổng nghiệm thu.\n\n| Cổng | Lượt | Mã thoát | Kết quả | Bằng chứng |\n|---|---:|---:|---|---|\n';
for(const n of order){const c=latest[n];assert(c);let desc=c.exitCode===0?'PASS':'FAIL';if(c.results&&c.freshResults){const d=read(c.results);if(Number.isFinite(d.passed)&&Number.isFinite(d.failed))desc+=` · ${d.passed}/${d.passed+d.failed}`;}if(n==='r16')desc+=' · hợp đồng cũ 7 bảng, hiện có 8';if(n==='build')desc+=' · 28/28 trang';matrix+=`| ${n} | ${c.attempt} | ${c.exitCode} | ${desc} | [log](evidence/${c.log})${c.results&&c.freshResults?' / [JSON](evidence/'+c.results+')':''} |\n`;}
matrix+='\nĐối chứng `R32-REG-SCHEMA` đạt: đủ tám bảng hiện tại, học viên thuộc đúng lớp và cấm đổi chủ bài nộp. Không đổi R16 thành PASS. Lượt preload lỗi và JSON lịch sử không dùng kết luận; xem [nhật ký](evidence/harness-development-notes.md) và [commands.json](evidence/commands.json).\n\n| Nhiệm vụ | Bằng chứng tốt | Giới hạn/lỗi mở |\n|---|---|---|\n| TASK-6.1 | N01..N06: chuẩn hóa, mơ hồ, trùng tên, đụng độ | R32-03: API quét tái dùng xác nhận cũ |\n| TASK-6.2 | S01..S06: allowlist/junction, ảnh/PDF giả, thumb/ảnh đầu, 10+10, 5+5, title 100 | R32-04: file đổi sau bước quét không bị khóa byte |\n| TASK-6.3 | G01/G02/G05/G07: thiếu dữ kiện, đầy đủ họ tên, sandbox, chống comment cũ | R32-07/08/10 |\n| TASK-6.4 | D01/D02, P01..P04/P11: hash trường, queue, retry/link, chặn lỗi rõ | R32-02/04/05/06/12/13 |\n| TASK-6.5 | A01/A04, M01, L-*, U05: snapshot một phần, chặn trùng nguyên văn, local-only, Client | R32-01/02/03/09/10/11 |\n| Giai đoạn 1–5 | R12/R13/R17/R31, Phase 4/5, tsc, build | R16 cũ 15/16, đối chứng schema mới đạt; chưa nghiệm thu vận hành thật |\n\n| Nhóm lỗi | Mức | Task | Ca trượt | Trạng thái |\n|---|---|---|---|---|\n';
for(const i of issues)matrix+=`| ${i.id}: ${i.title} | ${i.priority} | ${i.task} | ${i.failedCases.join(', ')} | OPEN |\n`;
matrix+='\n67 ca của bộ kiểm độc lập cuối, giữ đủ ID và tiêu chí:\n\n| ID | Task | Kỳ vọng | Kết quả | Nhóm lỗi |\n|---|---|---|---|---|\n';
for(const t of r.results)matrix+=`| ${t.id} | ${t.task} | ${t.criterion.replaceAll('|','/')} | ${t.pass?'PASS':'FAIL'} | ${t.issue??'—'} |\n`;
matrix+='\nScanner/SQLite/API/uploader nạp module sản phẩm trực tiếp. AI dùng thân mã thật với Gemini giả; UI dùng thân hàm trước JSX với hook điều khiển được, chưa phải trình duyệt React thật. Chromium chỉ dùng trang/request giả; không nghiệm thu LMS/Gemini thật. Chi tiết từng quan sát ở [phase6-results.json](evidence/phase6-results.json), [browser-scenarios.json](evidence/browser-scenarios.json).\n';
fs.writeFileSync(path.join(out,'REGRESSION_MATRIX.md'),matrix);
const paths=[];function walk(d){if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())paths.push(p)}}
for(const d of ['src','scripts','data/config'])walk(path.join(root,d));for(let n=12;n<=31;n++)walk(path.join(root,'docs/audits/round-'+n));for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&!/^\.env(?:\.|$)/i.test(e.name))paths.push(path.join(root,e.name));
const after=Object.fromEntries(paths.sort().map(p=>[path.relative(root,p).replaceAll('\\','/'),{size:fs.statSync(p).size,sha256:sha(p)}]));
const initial=Object.fromEntries(before.files.map(p=>[p.path,{size:p.size,sha256:p.sha256}])),changed=[],missing=[],added=[];
for(const [p,v]of Object.entries(initial)){if(!after[p])missing.push(p);else if(JSON.stringify(after[p])!==JSON.stringify(v))changed.push(p)}for(const p of Object.keys(after))if(!initial[p])added.push(p);
const status=execFileSync('git',['--no-optional-locks','status','--porcelain=v1','--untracked-files=all'],{cwd:root,encoding:'utf8'});
const outside=s=>s.split(/\r?\n/).filter(l=>l&&!l.includes('docs/audits/round-32/')).sort();
const gitUnchanged=JSON.stringify(outside(status))===JSON.stringify(outside(before.status));
const protection=Object.keys(initial).filter(p=>p==='next-env.d.ts'||/^docs\/audits\/round-(1[2-9]|2\d|3[01])\//.test(p));
const preservation={checkedAt:new Date().toISOString(),totalBefore:before.files.length,totalAfter:Object.keys(after).length,changed,missing,added,protectedCount:protection.length,protectedMismatches:protection.filter(p=>changed.includes(p)||missing.includes(p)),srcScriptsCount:before.files.filter(f=>/^(src|scripts)\//.test(f.path)).length,headBefore:before.head,headAfter:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),gitStatusOutsideRound32Unchanged:gitUnchanged,nextEnvSha256:sha(path.join(root,'next-env.d.ts')).toUpperCase(),allPreserved:!changed.length&&!missing.length&&!added.length&&gitUnchanged};
write('preservation-check.json',preservation);write('source-manifest.json',{files:before.files.filter(f=>/^(src|scripts|data\/config)\//.test(f.path)||!f.path.includes('/')),sourceFrom:'preservation-before.json',productSourceUnchanged:preservation.allPreserved});
write('git-status-after.json',{capturedAt:new Date().toISOString(),status});
write('harness-provenance.json',{finalR32HarnessSha256:sha(path.join(out,'verify-phase6.mjs')),executedR32HarnessSha256:r.harnessSha256,R31HarnessSha256:sha(path.join(root,'docs/audits/round-31/verify-independent.mjs')),executedR31HarnessSha256:read(latest.r31.results).harnessSha256,sourceVsWorkingTreeMatch:true,latestR32Receipt:latest.independent});
const badLinks=[];for(const f of ['REPORT.vi.md','FIX_PROMPT.vi.md','REGRESSION_MATRIX.md']){const text=fs.readFileSync(path.join(out,f),'utf8');for(const m of text.matchAll(/\]\(([^)]+)\)/g)){const link=m[1].split('#')[0];if(link&&!/^https?:/.test(link)&&!fs.existsSync(path.resolve(out,link)))badLinks.push({file:f,link})}}
write('document-validation.json',{checkedAt:new Date().toISOString(),requiredFiles:['REPORT.vi.md','FIX_PROMPT.vi.md','REGRESSION_MATRIX.md','verify-phase6.mjs'].map(file=>({file,present:fs.existsSync(path.join(out,file))})),badLinks,latestSummary:{total:r.total,passed:r.passed,failed:r.failed},issues:issues.length,priorityCounts:{P1:11,P2:2},finalHarnessMatchesExecuted:true});
assert(preservation.allPreserved,JSON.stringify(preservation));assert.equal(preservation.nextEnvSha256,'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000');assert.equal(badLinks.length,0,JSON.stringify(badLinks));
const artifacts=[];function inventory(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())inventory(p);else if(e.isFile()&&e.name!=='evidence-manifest.json')artifacts.push({path:path.relative(out,p).replaceAll('\\','/'),size:fs.statSync(p).size,sha256:sha(p)})}}inventory(out);write('evidence-manifest.json',{generatedAt:new Date().toISOString(),excludesSelf:true,files:artifacts});
console.log(JSON.stringify({preservation,artifactCount:artifacts.length,summary:{total:r.total,passed:r.passed,failed:r.failed,issues:issues.length,P1:11,P2:2},badLinks},null,2));
