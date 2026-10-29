# Kiểm toán độc lập v3.4.0 — S1, Round 2

**Decision: GO cho Stage S1 Round 2.** Cả 5/5 finding vòng 1 và hai mục R2-01/R2-02 đã CLOSED. Bốn suite còn thiếu chạy đầy đủ, exit 0; Node.js đã xóa toàn bộ TEMP, xác nhận không còn tồn tại; hai hash production vẫn nguyên vẹn.

- Ngày: 2026-10-30, Asia/Saigon. Lượt closure tiếp nối cùng phiên `01a18a01-f4af-7c23-86c4-b955ea9225ef`.
- Baseline = HEAD: `bba7c13cccf00a16a96b2a90c82cd989c8d44f9d`; đối tượng là working tree, gồm module Teaching/test S1 chưa được Git theo dõi.
- Đã đọc PROJECT_STATE.md trước; đối chiếu Giai đoạn 10 trong kế hoạch, CHANGELOG, AGENTS và Round 1. Agent hiện tại kiểm toán độc lập trực tiếp; không tuyên bố có reviewer/model khác xác nhận.
- Chỉ sửa báo cáo này trong kho gốc. Không sửa ứng dụng, test gốc, next-env.d.ts, tài liệu kiểm toán cũ hoặc ba tài liệu theo dõi.
- **1.631/1.631 tệp được bảo vệ giữ nguyên SHA-256** từ đầu kiểm toán đến trước dọn TEMP. **118/118 tệp src/scripts trong bản sao khớp mã hiện tại**; không có thay đổi mã giữa hai lượt.
- Owner cấp quyền cho Chromium/esbuild chạy trên host, fixture junction V14 nguyên bản trong TEMP và dọn đúng TEMP bằng Node.js. Quyền bảo vệ dữ liệu/mã nguồn tiếp tục giữ nguyên.

## Gate Execution Summary

`$A=C:\Users\QQ\AppData\Local\Temp\mindx-s1-r2-fb5bc7ec1ccb4c2e91d2388c1ea46e64`; `$W=$A/snapshot`. Node chạy tại $W; node_modules từ kho gốc qua Module._resolveFilename/NODE_PATH; @/ trỏ vào bản sao. Không tạo junction node_modules.

Trước **mỗi tiến trình**, ALLOWED_LOCAL_DIRS=$A; MINDX_DB_PATH, MINDX_RUNNING_CLASSES_PATH, MINDX_AUDIT_OBSERVATIONS trỏ vào $A/scratch/<gate>/test.db, running_classes.json, obs.json. TEMP/TMP cũng dưới $A. v320 tự dùng đường dẫn data/tmp-test-* tương đối với $W, vẫn hoàn toàn cô lập. Không sao chép .env hoặc hai tệp production. Các tài khoản/khóa thử là chuỗi giả; mạng ngoài bị chặn bằng offline.cjs và proxy browser cục bộ.

**13/13 gate bắt buộc có kết quả PASS trên cùng mã nguồn.** Chín gate PASS được giữ từ lượt đầu; chỉ bốn gate từng BLOCKED được chạy lại trong lượt closure theo yêu cầu Owner. Không tuyên bố chín gate kia được chạy lại ở lượt closure. Probe biên bổ sung cũng PASS; số quan sát không được cộng thành số assertion.

| Lệnh | Exit code lượt đầu / closure | Bằng chứng cuối |
|---|---|---|
| `npx tsc --noEmit --incremental false` | 0 / không chạy lại | PASS |
| `node $A/runtime.cjs scripts/test-streamline-v340-s1.ts` | 0 / không chạy lại | PASS S1.1–S1.7 + S1-01..S1-05 |
| `node $A/adversarial.cjs` | 0 / không chạy lại | PASS P01–P15, 15/15 |
| `node $A/runtime.cjs scripts/test-phase5.ts` | 0 / không chạy lại | PASS đủ 8 nhóm |
| `node $A/runtime.cjs scripts/test-phase7.ts` | 1 → 0 / không chạy lại | PASS TASK-7.1–7.3 |
| `node $A/runtime.cjs scripts/test-phase4-codex-repros.ts` | 0 / không chạy lại | PASS, Round 1–17 |
| `node $A/runtime.cjs scripts/test-spck-v270.ts` | 1 → 0 / không chạy lại | PASS T01–T16 |
| `node $A/runtime-closure.cjs scripts/test-spck-v272.ts` | 1 → 1 / **0** | PASS V01–V16; 25,22 giây |
| `node $A/runtime-closure.cjs scripts/test-lms-reliability-v280.ts` | 1 → 1 / **0** | PASS T280-01..05; 80,38 giây |
| `node $A/runtime-closure.cjs scripts/test-session14-v290.ts` | 1 → 1 / **0** | PASS S14-01..07; 143,71 giây |
| `node $A/runtime-closure.cjs scripts/test-teaching-project-v320.ts` | 1 → 1 / 1 → 1 → **0** | PASS TP-01..06; lượt cuối 11,15 giây |
| `node $A/runtime.cjs scripts/test-report-card-v330.ts` | 1 → 0 / không chạy lại | PASS RC-01..06 |
| `node $A/runtime.cjs docs/audits/v330/stage3-round3/closure-boundaries.ts` | 0 / không chạy lại | PASS, 101 CLOSED / 0 OPEN |
| `node $A/boundaries.cjs` | 1 → 0 / không chạy lại | PASS 37/37 ca mới, ngoài 13 gate |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` | 0 / 0 trước test, sau test và sau dọn | Khớp hai hash yêu cầu |
| PowerShell Remove-Item ở lượt đầu | N/A, bị chặn trước khởi động | Lịch sử: blocked by policy; không phải exit 1 của tiến trình |
| `node -e "require('node:fs').rmSync('C:/Users/QQ/AppData/Local/Temp/mindx-s1-r2-fb5bc7ec1ccb4c2e91d2388c1ea46e64', { recursive: true, force: true })"` | Không chạy lượt đầu / **0** | PASS; TEMP_REMOVED=true |

Lượt đầu dùng runtime.cjs cho cả bốn suite, bị chặn Chromium. Closure dùng runtime-closure.cjs: giữ SWC nạp TypeScript, **dùng esbuild thật** và bỏ hoàn toàn việc chuyển junction thành symbolic link. Fixture `scripts/test-spck-v272.ts:565` chạy nguyên bản, `PASS V14`; trước khi dọn toàn bộ TEMP đã kiểm tra **0 reparse point còn lại**.

Closure v320 có hai lượt hiệu chỉnh harness: (1) exit 1 sau TP-01..05 vì esbuild không tìm thấy React/lucide trong bản sao không có node_modules; thêm `nodePaths:[AUDIT_MODULE_ROOT]` vào lời gọi esbuild thật; (2) exit 1 trong fs.rmSync dọn profile Chromium do khóa tệp Windows sau đóng browser; thêm retry có giới hạn (10 lần, 100 ms) cho fs.rmSync **chỉ khi xóa đệ quy bên trong $A**, không bỏ qua ngoại lệ. Lượt thứ ba chạy lại **toàn bộ TP-01..06**, exit 0. Không sửa test, assertion hoặc mã ứng dụng. Các hiệu chỉnh lượt đầu được giữ trong phụ lục lịch sử.

## Prior Findings Disposition

| ID | Mức vòng 1 | Trạng thái | Bằng chứng chạy mới và vị trí mã |
|---|---|---|---|
| S1-01 | HIGH | **CLOSED** | P10 gọi POST và scanner thật với trang giả: HTTP 200; JSON TEMP giữ nguyên từng byte, 2 lớp trước/sau gồm AUDIT-ACTIVE và AUDIT-EXPIRED. Route truyền `persistToConfig:false` tại `src/app/api/spck/list/route.ts:358`; scanner kiểm tra cờ tại `src/lib/playwright/sync-class.ts:1314`. Probe mới xác nhận false bảo toàn JSON, chế độ mặc định vẫn cập nhật có chủ đích. |
| S1-02 | HIGH | **CLOSED** | P07: cold-cache và cache Project làm nóng đều giữ `id:true`; Report Card đều chặn ghép học viên. `src/lib/teaching/teaching-http-client.ts:495,545,569` định dạng trên clone riêng và cache payload gốc. 13 ca ID + 6 payload mới có kết quả cold/warm giống nhau; sửa dữ liệu trả về, kể cả trường lồng nhau, không làm bẩn cache. |
| S1-03 | MEDIUM | **CLOSED** | P08: Stop khi đang chờ, scanner gọi 0 lần, HTTP 500. P09/P15: Stop sau scanner rỗng/sync lớp cuối đều HTTP 500, `success:false`, QUEUE_STOPPED. Probe mới cho danh sách hai lớp Running/Finished: chỉ sync lớp đầu rồi dừng. Guard sau await tại `route.ts:361,391,418`, cuối callback `425` và sau enqueue `434`. |
| S1-04 | MEDIUM | **CLOSED** | P14 chạy callback GraphQL thật trong VM: slot sai định dạng dẫn tới lỗi bảo vệ, **0 DeleteWork**. P12/P13 giữ đường DB hợp lệ và fallback từ ID tổng hợp sang GraphQL hợp lệ. `src/lib/playwright/spck-uploader.ts:809,812,828` kiểm tra 24-hex cả target/candidate. Probe mới: ID dài 23/25, ngoài hex, rỗng, hex viết hoa/trim và 4 target sai kiểu/định dạng đều xử lý đúng. |
| S1-05 | LOW | **CLOSED** | P06: đổi A → B cùng lớp trả 101 → 202; 2 login POST và 2 lần đọc học viên. Khóa cache chứa origin + username + lớp tại `teaching-http-client.ts:175,532`. Probe mới A → B → A, đổi origin và invalidate đạt 4 login/4 lần đọc đúng kỳ vọng. |

Suite S1 còn xác nhận retry FAILED với hash nguyên vẹn cho cả Dự án/Phiếu điểm; hash bị sửa bị chặn/hạ WAITING_APPROVAL. P11: Dự án bị sửa hash gọi transport **0 lần**. S1.5 được đối chiếu hai hàm tải/quét lại lớp tại `src/app/final-project/page.tsx:1135,1213`; S1.7 xác nhận ngoại lệ Student Portal nhất quán trong tài liệu. Không coi đây là nghiệm thu UI thật hoặc chứng nhận lại toàn bộ Student Portal.

## Round 2 Disposition

| ID | Loại | Trạng thái | Bằng chứng đóng |
|---|---|---|---|
| R2-01 | Thiếu kiểm chứng, không phải lỗi ứng dụng | **CLOSED** | Bốn suite chạy đầy đủ trên Chromium thật với dữ liệu/mạng giả lập; cả bốn exit 0. V14 dùng junction gốc, TP-06 dựng bằng esbuild thật và chạy kiểm tra giao diện/chuyển lớp. |
| R2-02 | Dọn môi trường thử, không phải lỗi ứng dụng | **CLOSED** | Node.js fs.rmSync xóa đúng $A theo quyền Owner, exit 0; kiểm tra existsSync và Test-Path đều xác nhận không còn thư mục. Hai hash production kiểm tra lại sau dọn vẫn khớp. |

Không phát hiện thêm lỗi ứng dụng. Năm finding vòng 1 giữ CLOSED; không suy rộng kiểm thử local/giả lập thành nghiệm thu dữ liệu thật trên LMS/Teaching.

## Production Data Preservation Check

Ngoại lệ chỉ đọc Get-FileHash được giữ nguyên. Không mở SQLite, đọc nội dung, sao chép, sửa hoặc xóa hai tệp production. Hash trước/sau lượt đầu, trước/sau chạy bốn suite closure và sau khi dọn TEMP đều khớp:

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | UNCHANGED |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | UNCHANGED |

**Dọn TEMP: HOÀN TẤT.** Đã xóa toàn bộ $A bằng Node.js, exit 0; existsSync và Test-Path đều false. Trước khi xóa đã đối chiếu đúng đường dẫn Owner chỉ định, root không phải reparse point và bên trong còn 0 junction/symlink. Không xóa thư mục TEMP chung, node_modules, dữ liệu production hoặc thư mục cũ của phiên khác.

## Giới hạn và bước tiếp theo

Đủ điều kiện thông qua S1 Round 2 và chuẩn bị S2 trong phạm vi được yêu cầu; chưa triển khai S2. Chưa chạy bản dựng đầy đủ, chưa nghiệm thu tài khoản/thao tác thật trên LMS/Teaching hoặc các chặng S2–S8. Không thay đổi checklist dự án vì Owner chỉ cho phép ghi báo cáo này.

<details>
<summary>Lịch sử lượt đầu: NO-GO do Chromium bị chặn và chưa dọn TEMP</summary>

## Gate Execution Summary

`$A` là thư mục TEMP riêng; `$W=$A/snapshot`. Các lệnh Node chạy tại `$W`, phân giải node_modules từ kho gốc qua `Module._resolveFilename`/`NODE_PATH` và `@/` vào bản sao mã. Không tạo junction node_modules. TypeScript chạy tại kho gốc.

Trước **mỗi tiến trình**, đặt `ALLOWED_LOCAL_DIRS=$A`; `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH`, `MINDX_AUDIT_OBSERVATIONS` vào `$A/scratch/<gate>/test.db`, `running_classes.json`, `obs.json`. TEMP/TMP cũng trỏ dưới `$A`. Test tự đổi đường dẫn vẫn chạy hoàn toàn trong TEMP; v320 dùng `data/tmp-test-*.db/json` tương đối với `$W`, không phải kho thật. Không sao chép .env hoặc hai tệp production. Khóa AI thử nghiệm là chuỗi giả; phản hồi Teaching/LMS/AI trong probe được giả lập.

Runtime dùng `@next/swc-win32-x64-msvc` đã cài, đăng ký .ts/.tsx, chuyển sang CommonJS và thay import.meta.url theo tên tệp. `esbuild.transformSync` bên trong RC-06 cũng được thay bằng SWC; cùng assertion gốc, không bỏ nhóm test nào. Không dùng tsx, không coi lỗi tsx/esbuild là lý do NO-GO.

| Lệnh thực thi | Exit code theo thứ tự chạy | Kết quả cuối |
|---|---|---|
| `npx tsc --noEmit --incremental false` | 0 | PASS |
| `node $A/runtime.cjs scripts/test-streamline-v340-s1.ts` | 0 | PASS S1.1–S1.7 và hồi quy S1-01..S1-05 |
| `node $A/adversarial.cjs` | 0 | PASS P01–P15: 15/15 |
| `node $A/runtime.cjs scripts/test-phase5.ts` | 0 | PASS, đủ 8 nhóm |
| `node $A/runtime.cjs scripts/test-phase7.ts` | 1 → 0 | PASS TASK-7.1–7.3 |
| `node $A/runtime.cjs scripts/test-phase4-codex-repros.ts` | 0 | PASS, hoàn tất Round 1–17 |
| `node $A/runtime.cjs scripts/test-spck-v270.ts` | 1 → 0 | PASS T01–T16 |
| `node $A/runtime.cjs scripts/test-spck-v272.ts` | 1 → 1 | BLOCKED Chromium, chưa hoàn tất V01 |
| `node $A/runtime.cjs scripts/test-lms-reliability-v280.ts` | 1 → 1 | BLOCKED Chromium khi khởi tạo |
| `node $A/runtime.cjs scripts/test-session14-v290.ts` | 1 → 1 | S14-01..05 PASS; BLOCKED Chromium tại S14-06 |
| `node $A/runtime.cjs scripts/test-teaching-project-v320.ts` | 1 → 1 | BLOCKED Chromium trong TP-01; chưa chạy đủ TP-01..06 |
| `node $A/runtime.cjs scripts/test-report-card-v330.ts` | 1 → 0 | PASS RC-01..RC-06 |
| `node $A/runtime.cjs docs/audits/v330/stage3-round3/closure-boundaries.ts` | 0 | PASS, 101 CLOSED / 0 OPEN |
| `node $A/boundaries.cjs` | 1 → 0 | PASS 37/37 tình huống biên mới |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` | 0, trước và sau | UNCHANGED; khớp hash kỳ vọng |
| `Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop` (trong lệnh dọn có kiểm tra đường dẫn) | N/A: bị chặn trước khởi động | BLOCKED BY POLICY; TEMP còn lại |

**9/13 lệnh bắt buộc PASS; 4/13 BLOCKED khi mở Chromium.** Probe biên bổ sung PASS riêng. Số ca/quan sát không được cộng thành số assertion hoặc số bộ hồi quy.

Hiệu chỉnh harness TEMP: Phase 7 đầu thiếu launcher trong bản sao; chép đúng start-bot.bat/command rồi PASS. v270/v290 đầu thiếu khóa AI giả khiến mock không nhận prompt; thêm chuỗi giả thì v270 PASS, v290 đi tới lỗi Chromium. RC-06 đầu gọi esbuild nội bộ bị EPERM; thay trình biên dịch bằng SWC thì toàn bộ RC PASS. Probe mới đầu 36 PASS/1 FAIL vì kỳ vọng sai rằng slot 24-hex có khoảng trắng phải bị từ chối: mã trim cả slot và work, nên kỳ vọng đúng là xóa một work giả; sửa riêng probe TEMP, đạt 37/37. Không sửa nguồn/test gốc để làm xanh kết quả.

</details>

<details>
<summary>Runtime closure: SWC + esbuild thật, junction nguyên bản, retry dọn profile trong TEMP</summary>

```javascript
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {pathToFileURL} = require('node:url');
const root = process.env.AUDIT_WORKSPACE_ROOT;
const nm = process.env.AUDIT_MODULE_ROOT;
const swc = require(nm + '/@next/swc-win32-x64-msvc');
const nativeLoad = Module._load;
Module._load = function(request, parent, isMain) {
 const loaded = nativeLoad.call(this, request, parent, isMain);
 if(request !== 'esbuild') return loaded;
 return {...loaded, build: options => loaded.build({
  ...options, nodePaths: [nm, ...(options.nodePaths || [])]
 })};
};
const nativeRmSync = fs.rmSync;
fs.rmSync = function(target, options) {
 const absolute = path.resolve(String(target)).toLowerCase();
 const auditPrefix = path.resolve(__dirname).toLowerCase() + path.sep;
 if(options?.recursive && absolute.startsWith(auditPrefix)) {
  return nativeRmSync.call(fs, target, {...options, maxRetries:10, retryDelay:100});
 }
 return nativeRmSync.call(fs, target, options);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
 if (request.startsWith('@/')) request=path.join(root,'src',request.slice(2));
 try { return resolve.call(this,request,parent,...rest); }
 catch(e) {
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:'))
   return resolve.call(this,request,{...parent,paths:[nm,...(parent?.paths||[])]},...rest);
  throw e;
 }
};
for(const ext of ['.ts','.tsx']) require.extensions[ext]=function(mod,filename) {
 let source=fs.readFileSync(filename,'utf8');
 source=source.replace(/\bimport\.meta\.url\b/g,JSON.stringify(pathToFileURL(filename).href));
 const output=swc.transformSync(source,false,Buffer.from(JSON.stringify({filename,jsc:{target:'es2022',parser:{syntax:'typescript',tsx:filename.endsWith('.tsx')},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}))).code;
 mod._compile(output,filename);
};
if(require.main===module) require(path.resolve(process.argv[2]));
```

</details>

<details>
<summary>Runtime SWC lượt đầu — lịch sử, closure dùng runtime mới bên dưới</summary>

```javascript
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {pathToFileURL} = require('node:url');
const root = process.env.AUDIT_WORKSPACE_ROOT;
const nm = process.env.AUDIT_MODULE_ROOT;
const swc = require(nm + '/@next/swc-win32-x64-msvc');
const oldLoad = Module._load;
Module._load = function(request, parent, isMain) {
 if(request === 'esbuild') return {
  transformSync(source, options = {}) {
   const output = swc.transformSync(source, false, Buffer.from(JSON.stringify({
    filename: options.loader === 'tsx' ? 'audit.tsx' : 'audit.ts',
    jsc: {target:options.target || 'es2022',parser:{syntax:'typescript',tsx:options.loader==='tsx'},
     transform:{react:{runtime:options.jsx === 'automatic' ? 'automatic' : 'classic'}}}
   })));
   return {code:output.code,warnings:[]};
  },
  async build() { throw Error('AUDIT: browser bundle not executed; native browser spawn must work first'); }
 };
 return oldLoad.call(this,request,parent,isMain);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
 if (request.startsWith('@/')) request=path.join(root,'src',request.slice(2));
 try { return resolve.call(this,request,parent,...rest); }
 catch(e) {
  if (!request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('node:'))
   return resolve.call(this,request,{...parent,paths:[nm,...(parent?.paths||[])]},...rest);
  throw e;
 }
};
for(const ext of ['.ts','.tsx']) require.extensions[ext]=function(mod,filename) {
 let source=fs.readFileSync(filename,'utf8');
 source=source.replace(/\bimport\.meta\.url\b/g,JSON.stringify(pathToFileURL(filename).href));
 const output=swc.transformSync(source,false,Buffer.from(JSON.stringify({filename,jsc:{target:'es2022',parser:{syntax:'typescript',tsx:filename.endsWith('.tsx')},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}))).code;
 mod._compile(output,filename);
};
const nativeSymlink=fs.symlinkSync;
fs.symlinkSync=function(target,dest,type) {
 if(type==='junction') {
  console.log('AUDIT: substituting directory symbolic link for prohibited junction');
  return nativeSymlink.call(fs,target,dest,'dir');
 }
 return nativeSymlink.apply(fs,arguments);
};
if(require.main===module) require(path.resolve(process.argv[2]));
```

</details>

<details>
<summary>Probe biên mới: tái dựng và nội dung main</summary>

Lấy phần đầu adversarial.cjs trong phụ lục Round 1, trước `async function main(){`. Giữ helper; mở rộng chữ ký `clearWithGraphql(classId,dbId,remoteId,forcedTarget)` và chèn `if(forcedTarget !== undefined && arg) arg.targetSessionId=forcedTarget;` sau `if(typeof fn==='string')return;` trong trang giả. Ghép main dưới đây, lưu $A/boundaries.cjs và chạy `node $A/boundaries.cjs` với bốn biến cô lập. Dùng cùng offline.cjs của Round 1, NODE_PATH/AUDIT_MODULE_ROOT trỏ node_modules gốc, AUDIT_WORKSPACE_ROOT trỏ $A/snapshot và runtime ở trên.

```javascript
async function main() {
 config.teachingUsername='AUDIT_A'; config.teachingPassword='SYNTHETIC';
 const localRows=[{studentId:'LMS_01',fullName:'Fixture Student',isActive:true,btvnScores:{},stageScores:{}}];
 function matching(rows) {try {return {ok:true,id:rc.matchReportCardStudentsToTeaching(localRows,rows,'AUDIT-CLS',true).get('LMS_01')?.teachingStudentId};}catch(e){return {ok:false,error:e.message};}}
 const ids=[true,false,null,0,-1,1.5,'','001','garbage',{},[1],1,'17'];
 for(const id of ids) await check('R2-ID-'+JSON.stringify(id),async()=>{
  const m=mockTeaching(()=>[{id,student_name:'Fixture Student',class_code:'AUDIT-CLS',status:'active'}]);
  const project=new tp.LiveTeachingHttpTransport(),report=new rc.LiveTeachingReportCardHttpTransport();
  const cold=await report.getStudents('AUDIT-CLS'),coldMatch=matching(cold);
  http.clearSharedTeachingSession();
  await project.getStudents('AUDIT-CLS');
  const warm=await report.getStudents('AUDIT-CLS'),warmMatch=matching(warm);
  assert.deepEqual(warm,cold);assert.deepEqual(warmMatch,coldMatch);
  return {coldMatch,warmMatch,studentReads:m.counts().students};
 });
 for(const [label,payload] of [
  ['blank-name',[{id:17,student_name:'',class_code:'AUDIT-CLS'}]],
  ['duplicate-id',[{id:17,student_name:'Fixture Student',class_code:'AUDIT-CLS'},{id:17,student_name:'Other',class_code:'AUDIT-CLS'}]],
  ['wrong-class',[{id:17,student_name:'Fixture Student',class_code:'OTHER'}]],
  ['inactive',[{id:17,student_name:'Fixture Student',class_code:'AUDIT-CLS',status:'inactive'}]],
  ['success-envelope',{success:true,data:[{id:true,student_name:'Fixture Student',class_code:'AUDIT-CLS'}]}],
  ['protocol-rejected',{success:false,data:[{id:17,student_name:'Fixture Student'}],message:'denied'}],
 ]) await check('R2-payload-'+label,async()=>{
  mockTeaching(()=>payload);
  const project=new tp.LiveTeachingHttpTransport(),report=new rc.LiveTeachingReportCardHttpTransport();
  const read=async()=>{try{const value=await report.getStudents('AUDIT-CLS');return {value,matched:matching(value)};}catch(e){return {error:e.message};}};
  const cold=await read();http.clearSharedTeachingSession();await project.getStudents('AUDIT-CLS');const warm=await read();
  assert.deepEqual(warm,cold);
  assert(cold.error || cold.matched.ok===false);
  return {cold,warm};
 });
 await check('R2-cache-deep-clone',async()=>{
  const m=mockTeaching(()=>[{id:17,student_name:'Fixture Student',class_code:'AUDIT-CLS',nested:{value:1}}]);
  const c=new http.TeachingHttpClient();
  const a=await c.getStudentsOfClass('AUDIT-CLS',{strictArrayProtocol:true});
  a[0].id=true;a[0].nested.value=999;a.push({id:99});
  const b=await c.getStudentsOfClass('AUDIT-CLS',{strictArrayProtocol:true});
  assert.equal(b.length,1);assert.equal(b[0].id,17);assert.equal(b[0].nested.value,1);
  b[0].nested.value=777;
  const p=await c.getStudentsOfClass('AUDIT-CLS');
  p[0].id=200;
  const d=await c.getStudentsOfClass('AUDIT-CLS',{strictArrayProtocol:true});
  assert.equal(d[0].id,17);assert.equal(d[0].nested.value,1);assert.equal(m.counts().students,1);
  return {studentReads:1,unchangedNested:1};
 });
 await check('R2-cache-account-roundtrip-origin-invalidate',async()=>{
  const m=mockTeaching(()=>[{id:config.teachingUsername==='AUDIT_A'?101:202,student_name:'Fixture Student'}]);
  const a=new http.TeachingHttpClient('https://one.example');
  config.teachingUsername='AUDIT_A';assert.equal((await a.getStudentsOfClass('AUDIT-CLS'))[0].id,101);
  config.teachingUsername='AUDIT_B';assert.equal((await a.getStudentsOfClass('AUDIT-CLS'))[0].id,202);
  config.teachingUsername='AUDIT_A';assert.equal((await a.getStudentsOfClass('AUDIT-CLS'))[0].id,101);
  const b=new http.TeachingHttpClient('https://two.example');await b.getStudentsOfClass('AUDIT-CLS');
  a.invalidateSession();await a.getStudentsOfClass('AUDIT-CLS');
  assert.equal(m.counts().students,4);assert.equal(m.counts().posts,4);
  return m.counts();
 });
 await check('R2-cache-bypass-and-expiration',async()=>{
  let next=0;
  const m=mockTeaching(()=>[{id:++next,student_name:'Fixture Student'}]);
  const c=new http.TeachingHttpClient();
  assert.equal((await c.getStudentsOfClass('AUDIT-CLS'))[0].id,1);
  assert.equal((await c.getStudentsOfClass('AUDIT-CLS'))[0].id,1);
  assert.equal((await c.getStudentsOfClass('AUDIT-CLS',{useCache:false}))[0].id,2);
  assert.equal((await c.getStudentsOfClass('AUDIT-CLS',{ttlMs:-1}))[0].id,3);
  assert.equal(m.counts().students,3);return m.counts();
 });
 for(const persist of [false,true]) await check('R2-scanner-persist-'+persist,async()=>{
  const initial=[{classCode:'AUDIT-KEEP',status:'Finished',endDate:'01/01/2025'}];
  json.saveRunningClasses(initial);
  const before=fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,'utf8');
  const manager=BrowserManager.getInstance(),oldPage=manager.getPage,oldAuth=authService.ensureAuthenticated;
  manager.getPage=async()=>scannerPage(()=>[{classCode:'AUDIT-LIVE',courseName:'Fixture',center:'Fixture',status:'Running',rowStartDate:'01/01/2026',rowEndDate:'01/12/2026'}]);
  authService.ensureAuthenticated=async()=>{};
  try {
   const result=await oldScan.call(ClassSyncer,persist ? undefined : {persistToConfig:false});
   assert.equal(result.success,true);
   const after=fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,'utf8');
   if(!persist)assert.equal(after,before);else {assert.notEqual(after,before);assert.equal(JSON.parse(after)[0].classCode,'AUDIT-LIVE');}
   return {success:true,preserved:after===before};
  }finally{manager.getPage=oldPage;authService.ensureAuthenticated=oldAuth;}
 });
 for(const status of ['Running','Finished']) await check('R2-stop-loop-'+status,async()=>{
  let calls=0;
  ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'AUDIT-FIRST-'+status,status,endDate:'01/01/2025'},{classCode:'AUDIT-SECOND-'+status,status,endDate:'01/01/2025'}]});
  ClassSyncer.syncClass=async()=>{calls++;taskQueue.stopQueue();return {success:true};};
  try{const response=await POST(local());const data=await response.json();assert.equal(data.success,false);assert.equal(calls,1);assert.match(data.error,/QUEUE_STOPPED/);return {calls,status:response.status};}
  finally{ClassSyncer.fetchRunningClasses=oldScan;ClassSyncer.syncClass=oldSync;}
 });
 let serial=0;
 for(const remote of ['','a'.repeat(23),'a'.repeat(25),'g'.repeat(24),'not-a-slot','A'.repeat(24),' '+ 'b'.repeat(24)+' ']) await check('R2-slot-'+JSON.stringify(remote),async()=>{
  const r=await clearWithGraphql('AUDIT-R2-SLOT-'+(++serial),null,remote);
  const valid=/^[a-f0-9]{24}$/i.test(remote.trim());
  assert.equal(r.deleted.length,valid?1:0);
  if(!valid)assert(r.error);
  return {valid,deleted:r.deleted.length,error:r.error};
 });
 for(const forced of ['bad',true,123,'a'.repeat(23)]) await check('R2-captured-slot-'+JSON.stringify(forced),async()=>{
  const remote='abcdef012345678901234567';
  const r=await clearWithGraphql('AUDIT-R2-CAPTURED-'+(++serial),null,remote,forced);
  assert.equal(r.error,undefined);assert.equal(r.result.effectiveSessionId,remote);
  assert(r.calls.includes('GetClassSlots'));assert.equal(r.deleted.length,1);
  return {fallback:true,deleted:r.deleted.length};
 });
 taskQueue.resumeQueue();ClassSyncer.fetchRunningClasses=oldScan;ClassSyncer.syncClass=oldSync;globalThis.fetch=oldFetch;db.closeDb();
 const summary={passed:rows.filter(r=>r.result==='PASS').length,failed:rows.filter(r=>r.result==='FAIL').length,rows};
 fs.writeFileSync(process.env.MINDX_AUDIT_OBSERVATIONS,JSON.stringify(summary,null,2));
 console.log('SUMMARY '+JSON.stringify({passed:summary.passed,failed:summary.failed}));
 process.exitCode=summary.failed?1:0;
}
main().catch(e=>{console.error(e);try{db.closeDb();}catch{}process.exitCode=2;});
```

</details>