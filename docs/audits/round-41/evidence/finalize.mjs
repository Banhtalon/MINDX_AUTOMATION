import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(), auditDir=path.join(root,'docs/audits/round-41'), evidence=path.join(auditDir,'evidence');
const readJson=name=>JSON.parse(fs.readFileSync(path.join(evidence,name),'utf8').replace(/^\uFEFF/,''));
const writeJson=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
const gates=readJson('gates.json'), adversarial=readJson('adversarial-results.json'), before=readJson('integrity-before.json');
const coverage=readJson('tsc-file-coverage.json');
const sessionDrift=readJson('post-gate-drift.json');
assert.equal(coverage.exitCode,0);
assert(coverage.includesSyllabus&&coverage.includesConfigRoute&&coverage.includesGradeWorker&&coverage.includesQueue);
assert.deepEqual(adversarial.summary,{total:65,pass:65,fail:0});
assert.equal(gates.gates.length,5);
assert(gates.gates.every(g=>g.exitCode===0));
assert(gates.integrity.unchanged&&gates.cleanup.cloneRemoved&&gates.cleanup.nodeModulesPreserved);
assert(gates.copyIntegrity.checkedBeforeGates&&gates.copyIntegrity.identical&&gates.copyIntegrity.filesCompared===before.length);
assert(!fs.existsSync(gates.clone));
const expectedHash='B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000';
assert.equal(sha(path.join(root,'next-env.d.ts')),expectedHash);
const expectedTests=[12,6,7,1,1,1,1,1];
const explanations=[
  'Từ chối mảng rỗng, cấu trúc sai, mã khóa sai kiểu, chủ đề trống, số buổi không hợp lệ và mẫu Zalo lỗi; không thay đổi dữ liệu khi từ chối.',
  'Chặn trùng mã buổi/tiêu chí/nhóm/thẻ/mẫu Zalo; xóa rồi thêm tiêu chí trên UI tạo mã duy nhất (ảnh fixture có C2 và C3).',
  'Từ chối điểm âm, 0, NaN, null, boolean, tràn Infinity và số dương làm tròn thành 0.',
  'Tình huống hai phiên đọc trước rồi lưu nối tiếp không còn âm thầm ghi đè thay đổi của phiên trước; bộ gốc chấp nhận HTTP 409 hoặc hợp nhất giữ cả hai thay đổi.',
  'Sau Stop trong tương tác học viên đầu, học viên tiếp theo vẫn APPROVED và không bị xử lý.',
  'Đoạn cài đặt Windows dừng khi npm giả trả mã 37; không đi tiếp đến bước mở server. Dùng !errorlevel! trong khối ngoặc.',
  'Phản hồi lưu cũ không thay thế phần tên khóa học vừa gõ thêm khi đang đợi phản hồi.',
  'Bản tin trạng thái cuối phát isRunning=false khi hàng đợi về nghỉ.'
];
const mechanisms=[
  'src/app/api/config/route.ts: kiểm tra mảng/kiểu/số nguyên dương/nội dung trước khi ghi; zaloTemplates rỗng cũng bị chặn qua đọc nguồn.',
  'src/app/api/config/route.ts: Set chặn trùng; src/app/syllabus-config/page.tsx: dò mã Cn chưa tồn tại.',
  'src/app/api/config/route.ts: number hữu hạn, >0 và kiểm tra lại sau làm tròn.',
  'src/app/api/config/route.ts: snapshot/baseline và phát hiện giá trị quay lui trước khi ghi courses.',
  'src/lib/queue/task-queue.ts: đặt/xóa cờ dừng; src/lib/playwright/grade-worker.ts: kiểm tra cờ trước mỗi học viên.',
  'start-bot.bat: EnableDelayedExpansion và if !errorlevel! neq 0 sau call npm install.',
  'src/app/syllabus-config/page.tsx: editVersionRef và versionAtSubmit, chỉ nhận lại dữ liệu khi chưa có chỉnh sửa mới.',
  'src/lib/queue/task-queue.ts: emitStatus sau khi isProcessing=false nếu không còn việc kế tiếp.'
];
const findings=expectedTests.map((expected,index)=>{
  const id=`R40-${String(index+1).padStart(2,'0')}`, tests=adversarial.tests.filter(t=>t.finding===id);
  assert.equal(tests.length,expected); assert(tests.every(t=>t.status==='PASS'));
  return {id,status:'CLOSED',scope:'original AUDIT-R40 reproducible cases',total:tests.length,pass:tests.length,fail:0,testIds:tests.map(t=>t.id),verification:explanations[index],sourceEvidence:mechanisms[index]};
});
const reviewerEnvelope=readJson('reviewer-packet-response.json');
assert.equal(reviewerEnvelope.status,'SUCCESS');
assert(reviewerEnvelope.response?.trim(),'No independent reviewer conclusion');
assert.equal((reviewerEnvelope.denied_actions??[]).length,0);
let reviewer;
try {reviewer=JSON.parse(reviewerEnvelope.response.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
catch {throw Error('Reviewer response must be inspected and normalized before finalization');}
writeJson('reviewer-assessment.json',reviewer);
assert(/^GO\b|^ĐẠT/i.test(reviewer.decision),'Reviewer decision is not GO');
assert.equal(reviewer.findings.length,8);
assert(reviewer.findings.every(f=>/^CLOSED|^REPRODUCER_CLOSED_ONLY/.test(f.status)));
const current=before.map(row=>({path:row.path,sha256:sha(path.join(root,row.path))}));
assert.deepEqual(current,before,'Protected files changed since gates');
const walk=dir=>!fs.existsSync(dir)?[]:fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.relative(root,path.join(dir,e.name)).replaceAll('\\','/')]);
const protectedPaths=['src','scripts','data/config',...Array.from({length:29},(_,i)=>`docs/audits/round-${i+12}`)].flatMap(p=>walk(path.join(root,p)));
const expectedPaths=new Set(before.map(r=>r.path));
assert(protectedPaths.every(p=>expectedPaths.has(p)),'Unexpected protected file added');
const historical=before.filter(r=>/^docs\/audits\/round-/.test(r.path)).length;
const finalIntegrity={checkedAt:new Date().toISOString(),scope:'final complete five-gate run through finalization; full-session drift is recorded separately',beforeCount:before.length,afterCount:current.length,unchanged:true,differences:[],historicalFiles:historical,nextEnvSha256:expectedHash,cloneRemoved:!fs.existsSync(gates.clone)};
writeJson('integrity-final.json',finalIntegrity);
const results={
  audit:'AUDIT-R41',type:'Closure Verification',createdAt:new Date().toISOString(),decision:'GO',decisionScope:'GO cấp mã nguồn Giai đoạn 7, đóng các tình huống gốc R40-01..R40-08; chưa nghiệm thu vận hành thật',
  source:{head:gates.head,workingTree:'pre-existing uncommitted changes; tested current working tree, not clean HEAD',manifest:'integrity-before.json',manifestSha256:sha(path.join(evidence,'integrity-before.json'))},
  execution:{startedAt:gates.startedAt,completedAt:gates.completedAt,platform:process.platform,node:process.version,clone:gates.clone,esbuildBinaryPath:path.join(path.dirname(gates.clone),'mindx-esbuild.exe'),sequential:true,envFilesCopied:false,sensitiveChildEnvironmentRemoved:true,realAccountsUsed:false},
  copyIntegrity:gates.copyIntegrity,summary:{closedFindings:8,totalFindings:8,gatesPassed:5,gatesTotal:5,adversarial:adversarial.summary,findingSpecificTests:30,otherRegressionAndSecurityTests:35},
  findings,gates:gates.gates.map(g=>({...g,status:'PASS',...(g.id==='adversarial'?{summary:adversarial.summary}:{}),...(g.id==='tsc'?{diagnosticCount:0}:{})})),
  tests:adversarial.tests,integrity:finalIntegrity,sessionDrift:{baseline:'session-integrity-before.json',changes:sessionDrift,count:sessionDrift.length,actor:'not established; none of this audit execution commands writes these target paths',resolution:'preserved changes and reran all five gates against current snapshot; did not restore source or historical records'},cleanup:gates.cleanup,supplementalTypeScriptCoverage:coverage,
  reviewer:{requestedModel:'claude-sonnet-5-5-high',requestedEffort:'high',conversationId:reviewerEnvelope.conversation_id,method:'independent reasoning review of inline source excerpts and coordinator-run evidence; did not rerun tests',decision:reviewer.decision,identityLimit:'CLI requested model; response envelope has no independent provider runtime model attestation',firstAttempt:'Tool read auto-denied; empty response despite exit 0/SUCCESS; excluded from review acceptance',assessment:'reviewer-assessment.json',invocation:'reviewer-packet-invocation.json',quantitativeCorrection:'Reviewer prose says 11 R40-01 tests; machine-verified count is 12. Preserve raw response; use results.json counts.',driftInspection:'drift-inspection.json; current source diff vs HEAD inspected, exact pre-drift source content not retained'},
  limitations:[
    'Local synthetic fixtures and mocked API/browser boundaries; no real Teaching/LMS/Gemini accounts or production data.',
    'R40-04 covers the original courses stale-write sequence only; does not prove all interleavings, other config sections or cross-process persistence.',
    'Chromium interaction proof uses an esbuild fixture without full Next.js styles; screenshot is not a visual acceptance test of the deployed app.',
    'Windows launcher checks execute isolated extracted blocks with fake npm/node; no full install or manual double-click acceptance. macOS launcher inspected as source only.',
    'Reviewer received selected source excerpts and execution evidence; did not independently rerun the five gates.'
  ]
};
writeJson('results.json',results);
const rows=findings.map(f=>`| ${f.id} | **ĐÓNG** | ${f.pass}/${f.total} PASS | ${f.verification} |`).join('\n');
const gateRows=results.gates.map(g=>`| ${g.id} | \`${g.command}\` | ${g.id==='adversarial'?'65/65 PASS, 0 FAIL':g.id==='tsc'?'0 lỗi':'PASS'} | ${g.exitCode} | [log](evidence/${g.log}) |`).join('\n');
const matrix=`# AUDIT-R41 — Ma trận xác nhận đóng lỗi Giai đoạn 7\n\nQuyết định: **ĐẠT — GO cấp mã nguồn Giai đoạn 7**, theo tình huống gốc AUDIT-R40. Chạy mới ngày 21/10/2026 trên bản sao TEMP; không dùng lại kết quả cũ.\n\n| Mã | Trạng thái | Kiểm thử gắn mã | Kết quả đối chiếu |\n| --- | --- | --- | --- |\n${rows}\n\nTổng: **8/8 nhóm đóng, 30/30 phép thử gắn mã PASS**; **35/35** phép thử bảo mật/hồi quy khác PASS; toàn bộ **65/65 PASS, 0 FAIL**. Danh sách từng test ID và kết quả nằm trong [results.json](evidence/results.json).\n\n| Cổng | Lệnh | Kết quả | Mã thoát | Bằng chứng |\n| --- | --- | --- | --- | --- |\n${gateRows}\n\nNguồn được kiểm: cây làm việc hiện tại trên HEAD \`${gates.head}\`, có thay đổi chưa chốt từ trước. Bảo toàn **${before.length}/${before.length} tệp**, gồm **${historical}/${historical} hồ sơ lịch sử R12–R40**; không thêm/xóa tệp trong các vùng bảo vệ. \`next-env.d.ts\`: \`${expectedHash}\`. Bản sao TEMP đã xóa, node_modules gốc còn nguyên.\n\nGiới hạn: R40-04 chỉ xác minh trình tự hai phiên trong bộ gốc; không chứng minh mọi tình huống lưu đồng thời. Bộ thử trình duyệt dùng dữ liệu giả và API mô phỏng; chưa nghiệm thu tài khoản thật, giao diện Next.js đầy đủ, khởi chạy bằng nhấp đúp hoặc macOS thật.\n`;
const driftNote=`\n## Thay đổi xuất hiện ngoài lượt kiểm thử\n\nSau lượt cổng trước đã kết thúc, kiểm tra cuối phát hiện hai tệp thay đổi: src/lib/playwright/save-comments.ts (08:20:25 UTC) và docs/audits/round-12/independent-results.json (08:20:37 UTC). Các lệnh của kiểm toán này không ghi hai đường dẫn đó; chưa xác định tiến trình gây thay đổi. Không hoàn tác hoặc ghi đè các tệp. Lưu hash trước/sau tại [post-gate-drift.json](evidence/post-gate-drift.json), giữ snapshot ban đầu ở evidence/session-integrity-before.json, giữ bằng chứng lượt trước tại evidence/pre-drift-run.\n\nĐã chạy lại đủ cả 5 cổng trên nguồn hiện tại; kết quả 65/65 và cả 5 cổng vẫn PASS. Số tệp giữ nguyên 1.871/1.871 và 1.791/1.791 hồ sơ lịch sử trong báo cáo là **so với snapshot của lượt chạy cuối**, không phải khẳng định chúng bất biến từ đầu phiên. So với đầu phiên có 2 tệp đã thay đổi như trên. Quyết định GO chỉ gắn với snapshot cuối có hash trong results.json.\n`;
fs.writeFileSync(path.join(auditDir,'REGRESSION_MATRIX.md'),matrix.replace('Bảo toàn **','Trong lượt chạy cuối, bảo toàn **')+driftNote);
const report=`# AUDIT-R41 — Báo cáo phúc tra đóng lỗi Giai đoạn 7\n\n- **Ngày:** 21/10/2026 (Asia/Saigon).\n- **Phạm vi:** TASK-7.1..TASK-7.3: /syllabus-config, Barem, Live Log Drawer, start-bot.bat / start-bot.command.\n- **Quyết định:** **ĐẠT — GO cấp mã nguồn Giai đoạn 7**; đóng **8/8** nhóm phát hiện R40-01..R40-08 theo các tình huống gốc. Thay thế NO-GO của AUDIT-R40 trong phạm vi nguồn và phép thử này.\n- **Nguồn:** cây làm việc hiện tại trên HEAD \`${gates.head}\`; có các thay đổi chưa chốt từ trước, được lưu dấu bằng danh mục SHA-256, không đồng nhất kết quả này với HEAD sạch.\n\n## Kết quả kiểm chứng\n\nBộ đối kháng R40 nguyên bản chạy mới đạt **65/65 PASS, 0 FAIL** (Vòng 40 trước đó: 35/65 PASS, 30 FAIL). Có **30/30** phép thử gắn trực tiếp với 8 mã phát hiện, cộng **35/35** phép thử bảo mật và hồi quy. Cả 5 cổng đều có mã thoát 0.\n\n| Cổng | Lệnh | Kết quả | Mã thoát | Bằng chứng |\n| --- | --- | --- | --- | --- |\n${gateRows}\n\n## Đối chiếu đóng 8 nhóm lỗi\n\n| Mã | Trạng thái | Bằng chứng | Nội dung xác nhận |\n| --- | --- | --- | --- |\n${rows}\n\n[Bảng hồi quy](REGRESSION_MATRIX.md) và [kết quả định lượng](evidence/results.json) chứa danh sách test ID, từng trạng thái, thời gian, mã thoát và cơ chế nguồn tương ứng.\n\n## Cách chạy và bảo toàn dữ liệu\n\nChạy 5 lệnh nối tiếp trong cùng bản sao tại \`${gates.clone}\`, đúng tên đường dẫn khóa cứng của adversarial.mjs. Sao chép package.json, tsconfig.json, next.config.ts, next-env.d.ts, kế hoạch, hai launcher, src, scripts, docs, data/config; riêng node_modules là Junction về thư viện hiện có. Dùng ESBUILD_BINARY_PATH trỏ tới mindx-esbuild.exe trong TEMP. Không sửa bộ thử hoặc mã sản phẩm để đạt kết quả.\n\nKhông sao chép .env/.env.local, cơ sở dữ liệu thật hoặc hồ sơ đăng nhập gốc. Loại các mật khẩu, khóa Gemini, tên đăng nhập và đường dẫn cho phép kế thừa khỏi tiến trình con; các bài thử chạy bằng dữ liệu giả. Không in hoặc lưu giá trị bí mật vào hồ sơ kiểm toán.\n\nĐã chụp SHA-256 trước/sau và kiểm lại cuối: **${before.length}/${before.length} tệp không đổi**, gồm **${historical}/${historical} hồ sơ round-12..round-40**, 77 tệp thuộc vùng sản phẩm bị cấm sửa và 3 tệp cấu hình chạy/biên dịch bổ sung. Không thêm/xóa tệp trong các vùng này.\n\nSHA-256 next-env.d.ts giữ đúng:\n\n\`${expectedHash}\`\n\nGỡ Junction trước khi xóa đệ quy TEMP; kiểm tra đường dẫn đích chính xác trước khi dọn. **TEMP đã được xóa ngay sau 5 cổng; node_modules gốc còn nguyên.** Nhật ký và kết quả mới được chép sang round-41 trước khi dọn; không ghi ngược vào round-40 gốc. Trường audit=\"AUDIT-R40\" trong adversarial-results.json là nhãn do bộ thử lịch sử sinh ra; thời gian chạy và hồ sơ gates.json/results.json xác định lượt phúc tra R41.\n\n## Kiểm tra chéo độc lập\n\nGọi Reviewer với cấu hình \`claude-sonnet-5-5-high\`, effort high. Lượt đọc bằng công cụ bị từ chối quyền, trả nội dung rỗng dù nhãn SUCCESS/mã thoát 0; lượt đó **không được tính là kiểm định đạt**. Lượt tiếp theo dùng gói bằng chứng trực tiếp, không cần công cụ, đã trả kết luận **${reviewer.decision}**. Lưu phản hồi và mã phiên trong evidence/reviewer-packet-response.json, bản đọc được trong [reviewer-assessment.json](evidence/reviewer-assessment.json).\n\nReviewer đối chiếu các trích đoạn nguồn, 65 kết quả, 5 log, toàn vẹn và dọn dẹp; không tự chạy lại kiểm thử. Danh tính model ở mức cấu hình CLI yêu cầu; phản hồi không có chứng thư runtime độc lập từ nhà cung cấp.\n\n## Giới hạn nghiệm thu\n\n${results.limitations.map(s=>'- '+s).join('\n')}\n\nQuyết định này xác nhận đóng các phát hiện gốc ở **cấp mã nguồn**. Các nhận xét bổ sung của Reviewer, nếu có, được giữ nguyên trong hồ sơ và không được mô tả thành những tình huống đã kiểm bởi bộ R40. Không tự xác nhận sử dụng thật với giáo viên hoặc thay đổi trạng thái nghiệm thu vận hành các TASK-7.x.\n\n## Hồ sơ và kế hoạch\n\nChỉ thêm hồ sơ round-41 và nối dòng nhật ký AUDIT-R41 vào cuối MINDX_AUTOMATION_PLAN.md. Bản kế hoạch trước cập nhật được giữ ở evidence/plan-before.md. Các dấu TASK-7.x và nhật ký lịch sử giữ nguyên.\n`;
fs.writeFileSync(path.join(auditDir,'REPORT.vi.md'),report.replace('Không sửa bộ thử hoặc mã sản phẩm để đạt kết quả.','Trước cổng đầu tiên, so sánh SHA-256 của đủ 1.871 tệp bảo vệ trong bản sao với cây làm việc: khớp 1.871/1.871, không khác biệt (gates.json: copyIntegrity). Lượt cuối là một lần chạy liên tiếp đủ cả 5 cổng sau khi bổ sung bằng chứng đồng nhất này; bằng chứng lượt đầu được giữ riêng tại evidence/initial-run. Không sửa bộ thử hoặc mã sản phẩm để đạt kết quả.').replace('## Giới hạn nghiệm thu',`Đối chiếu thêm các lưu ý của Reviewer: lệnh đọc danh sách tệp TypeScript (không sinh mã) trả exit 0, bao phủ **${coverage.totalFiles} tệp**, gồm **${coverage.projectSourceFiles} tệp nguồn dự án**, có đủ syllabus-config, config route, grade-worker và queue; xem [tsc-file-coverage.json](evidence/tsc-file-coverage.json). Danh mục SHA-256 của snapshot nguồn được băm lại trong results.json để tham chiếu lâu dài. Trong lượt R41 này, người kiểm toán không sửa sản phẩm; không có bằng chứng để quy kết ai đã sửa nguồn trước lượt kiểm. Các assertion R40 gốc nằm trong vùng lịch sử được so SHA-256 trước/sau, không thay đổi.\n\n## Giới hạn nghiệm thu`));
const reportPath=path.join(auditDir,'REPORT.vi.md');
fs.writeFileSync(reportPath,fs.readFileSync(reportPath,'utf8').replace('Đã chụp SHA-256 trước/sau và kiểm lại cuối:','Trong lượt chạy cổng cuối, đã chụp SHA-256 trước/sau và kiểm lại cuối:')+driftNote+'\nĐã xem khác biệt hiện tại của save-comments.ts so với HEAD (evidence/save-comments-vs-head.diff): luồng lưu nhận xét, đối chiếu ID/nội dung và xử lý lỗi; không dùng việc xem này để tự nghiệm thu chức năng ngoài Giai đoạn 7. Không còn bản nội dung trước drift để tái tạo chính xác hai lần ghi; chỉ có hash trước/sau, chưa xác định tiến trình gây thay đổi. Xem evidence/drift-inspection.json. Hồ sơ R12 bị đổi không được dùng làm bằng chứng R41. Reviewer có lỗi đếm trong lời văn (11 test R40-01); dữ liệu máy xác nhận đúng **12/12**, tổng **65/65** không đổi.\n');
const planPath=path.join(root,'MINDX_AUTOMATION_PLAN.md'),planBefore=fs.readFileSync(path.join(evidence,'plan-before.md')),planCurrent=fs.readFileSync(planPath);
assert(planCurrent.equals(planBefore),'Plan changed externally; refuse to overwrite');
const entry=`\n\n* [x] **AUDIT-R41:** Đã hoàn tất Closure Verification Giai đoạn 7 (\`TASK-7.1\`..\`TASK-7.3\`) tại \`docs/audits/round-41/REPORT.vi.md\`; **GO cấp mã nguồn Giai đoạn 7**, đóng **8/8 nhóm phát hiện R40-01..R40-08** theo các tình huống gốc. Chạy mới đủ 5 cổng trong bản sao TEMP đúng tên: đối kháng R40 **65/65 PASS, 0 FAIL**, Phase 7/6/5 **PASS**, TypeScript **0 lỗi**, tất cả exit 0. Bảo toàn **${before.length}/${before.length} tệp** gồm **${historical}/${historical} hồ sơ round-12..round-40**; next-env.d.ts đúng SHA-256 \`${expectedHash}\`; đã xóa TEMP và giữ nguyên node_modules gốc. Reviewer cấu hình claude-sonnet-5-5-high kiểm tra chéo gói bằng chứng, không chạy lại các cổng. Chỉ nghiệm thu mã nguồn theo bộ gốc, chưa nghiệm thu LMS/Gemini/dữ liệu thật hoặc khởi chạy thực tế macOS. Bằng chứng: \`docs/audits/round-41/evidence/results.json\`.\n`;
const finalEntry=entry.replace('Bảo toàn **','Trong lượt chạy cuối, giữ nguyên **').replace('Bằng chứng:','Ghi nhận 2 tệp thay đổi ngoài các lệnh kiểm toán sau lượt trước (save-comments.ts và hồ sơ R12); đã giữ nguyên, lưu chênh lệch và kiểm lại đủ 5 cổng trên snapshot cuối, không khẳng định toàn bộ tệp bất biến suốt phiên. Bằng chứng:');
fs.appendFileSync(planPath,finalEntry);
assert(fs.readFileSync(planPath).subarray(0,planBefore.length).equals(planBefore));
writeJson('plan-update.json',{appendOnly:true,beforeSha256:crypto.createHash('sha256').update(planBefore).digest('hex').toUpperCase(),afterSha256:sha(planPath),entry:'AUDIT-R41',previousBytes:planBefore.length,addedBytes:Buffer.byteLength(finalEntry)});
console.log(JSON.stringify({decision:results.decision,closed:findings.length,gatesPassed:5,adversarial:adversarial.summary,protectedFiles:before.length,tempRemoved:true,planAppendOnly:true}));
