# Kiểm toán độc lập v3.4.0 — S1, Round 1

**Decision: NO-GO.** Hai lỗi HIGH đã tái hiện bằng chạy mã thật với dữ liệu giả. Chưa đủ bằng chứng hồi quy để thông qua S1: các lệnh chuẩn dùng tsx bị chặn bởi môi trường trước khi thực thi kiểm thử.

- Ngày: 2026-10-30 (Asia/Saigon).
- Baseline và HEAD: `bba7c13cccf00a16a96b2a90c82cd989c8d44f9d`; kiểm toán các thay đổi chưa commit, gồm cả tệp chưa được Git theo dõi.
- Đã đọc PROJECT_STATE.md trước, đối chiếu Giai đoạn 10 trong MINDX_AUTOMATION_PLAN.md, CHANGELOG.md và AGENTS.md; đọc các luồng gọi liên quan.
- Chỉ tạo báo cáo này trong kho gốc. Không sửa src/**, scripts/**, next-env.d.ts hoặc tài liệu kiểm toán cũ. 2.203/2.203 tệp trong manifest bảo vệ đầu phiên giữ nguyên SHA-256.
- Bản sao chạy thử nằm trong TEMP; không sao chép data/mindx_bot.db hoặc data/running_classes.json. Mỗi tiến trình được đặt ALLOWED_LOCAL_DIRS, MINDX_DB_PATH và MINDX_RUNNING_CLASSES_PATH vào vùng thử nghiệm dưới thư mục TEMP của Windows. Hai tệp dữ liệu thật chỉ được đo bằng Get-FileHash.
- Không gọi LMS/Teaching thật: HTTP được thay bằng phản hồi giả; bộ chặn mạng ngăn kết nối ngoài máy. Không chạy ứng dụng lên production. Không dùng hoặc kiểm tra tài khoản thật.
- Đây là kiểm toán trực tiếp của agent hiện tại. Không có reviewer Claude khả dụng; không tuyên bố đã có xác nhận của reviewer/model khác.

## Gate Execution Summary

Các lệnh dưới đây đã chạy mới trên bản sao mã hiện tại trong TEMP, dùng chung node_modules đã cài. Không tải/cài thêm thư viện. TypeScript còn được chạy lại tại kho gốc với ba đường dẫn dữ liệu cô lập, exit 0.

| Lệnh chuẩn | Exit code | Kết quả thực tế |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 0 | PASS; cả bản sao TEMP và kho gốc |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-phase5.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-phase6.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-phase7.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-spck-v270.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-spck-v272.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-session14-v290.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-teaching-project-v320.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx scripts/test-report-card-v330.ts` | 1 | BLOCKED: spawn EPERM |
| `npx tsx docs/audits/v330/stage3-round3/closure-boundaries.ts` | 1 | BLOCKED: spawn EPERM |

Lỗi chung: `Error: spawn EPERM` tại `node_modules/esbuild/lib/main.js:2272` (khởi tạo tiến trình biên dịch), trước khi chạy nội dung kiểm thử. Đây là giới hạn môi trường, không phải bằng chứng kiểm thử PASS hoặc lỗi nghiệp vụ của cả 12 bộ.

Để tiếp tục kiểm toán, dùng runtime.cjs trong TEMP chuyển TypeScript bằng SWC có sẵn, không tạo tiến trình esbuild. Mã ứng dụng và mã kiểm thử được giữ nguyên. Đây là **bằng chứng bổ sung**, không thay thế kết quả các lệnh chuẩn bên trên.

| Lệnh bổ sung trong TEMP | Exit code cuối | Bằng chứng |
|---|---:|---|
| `node runtime.cjs scripts/test-streamline-v340-s1.ts` | 0 | Bộ S1 hoàn thành toàn bộ nhóm S1.1–S1.7 |
| `node runtime.cjs scripts/test-phase5.ts` | 0 | 8 nhóm hoàn thành |
| `node runtime.cjs scripts/test-phase7.ts` | 0 | TASK-7.1–7.3 hoàn thành |
| `node runtime.cjs docs/audits/v330/stage3-round3/closure-boundaries.ts` | 0 | OBSERVATIONS=101; CLOSED=101 |
| `node adversarial.cjs` | 1 | 15 tình huống: 9 PASS, 6 FAIL, quy về 5 finding bên dưới |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` | 0 | Đầu/cuối phiên khớp kỳ vọng |

Lịch sử khởi tạo harness (không tính là lỗi ứng dụng): lượt đầu chạy 13 lệnh chuẩn đều exit 1 do đường dẫn NODE_OPTIONS bị mất dấu phân cách; đã sửa riêng harness TEMP rồi chạy lại toàn bộ, kết quả như bảng. Runtime S1 từng exit 1 do thiếu JavaScript API của TypeScript 7, rồi exit 1 do allowlist không chứa thư mục tạm tự sinh; chuyển sang SWC và đặt vùng tạm đúng trước lượt PASS. Closure bổ sung từng exit 1 tại kiểm tra đường dẫn TEMP; đặt lại đường dẫn và chạy được 101/101. Probe ban đầu 8 PASS/6 FAIL có một fixture dự án chưa đủ điều kiện duyệt; sửa fixture trong TEMP, chạy lại 9 PASS/5 FAIL, sau đó bổ sung ca Stop cuối lớp thành 9 PASS/6 FAIL. Mọi lượt probe exit 1; lỗi fixture đã loại khỏi finding.

## Finding Table

| ID | Severity | Status | Vị trí chính xác | Bằng chứng tái hiện | Cách sửa bắt buộc |
|---|---|---|---|---|---|
| S1-01 | HIGH | OPEN | `src/app/api/spck/list/route.ts:358`; lệnh ghi gián tiếp: `src/lib/playwright/sync-class.ts:1313` | P10 gọi POST và **hàm fetchRunningClasses thật**, chỉ giả lập trang LMS. JSON tạm có 2 lớp (Running + Finished cũ); trang giả chứa cả hai. POST trả 200 nhưng JSON còn 1 lớp. Hàm quét lọc Finished rồi gọi saveRunningClasses(runningList). Bỏ lệnh ghi trực tiếp trong route chưa bảo đảm S1.2. | Thêm chế độ quét không ghi cache cho lời gọi từ SPCK; giữ cơ chế cập nhật cache ở luồng quản lý lớp có chủ đích. Không lưu rồi khôi phục JSON vì có thể ghi đè thao tác khác. Bổ sung test gọi scanner thật với trang giả, thay vì thay toàn bộ scanner bằng stub. |
| S1-02 | HIGH | OPEN | `src/lib/teaching/teaching-http-client.ts:500`, `src/lib/teaching/teaching-http-client.ts:528` | P07: Teaching trả học viên có id=true. Phiếu điểm đọc trực tiếp giữ true và chặn ID không hợp lệ. Đọc Dự án trước sẽ ép true thành 1, lưu bản đã biến đổi vào cache; Phiếu điểm đọc cache nhận 1 và bước ghép học viên **chấp nhận**. Kiểm tra an toàn thay đổi theo thứ tự mở màn hình. Không gửi điểm thật trong probe. | Cache phản hồi gốc, tách việc chuẩn hóa theo từng bên sử dụng và chạy lại kiểm tra ở cả cache hit. Không dùng bản đã ép kiểu/lọc của Dự án làm dữ liệu gốc cho Phiếu điểm. Thêm đối chiếu cold-cache/warm-cache với ID boolean, ID sai và dòng học viên bị loại. |
| S1-03 | MEDIUM | OPEN | `src/app/api/spck/list/route.ts:358`, `src/app/api/spck/list/route.ts:413`, `src/app/api/spck/list/route.ts:420` | P09 bật Stop trong lần quét trả danh sách rỗng; P15 bật Stop trong syncClass của lớp cuối. Cả hai vẫn trả HTTP 200, success=true trong khi isStopped=true. Guard chỉ có trước lời gọi và đầu vòng lặp, bỏ sót kết quả cuối. P08 xác nhận tác vụ còn chờ thì bị hủy đúng, scanner không chạy. | Kiểm tra Stop ngay sau mỗi await của scanner/syncClass và trước khi trả kết quả hoàn tất. Giữ Stop là kết quả hủy, không công bố quét thành công. Thêm đủ ca rỗng, lớp cuối và Stop giữa nhiều lớp. |
| S1-04 | MEDIUM | OPEN | `src/lib/playwright/spck-uploader.ts:823` | P14 thực thi callback page.evaluate thật trong VM, giả toàn bộ GraphQL. GetClassSlots trả _id='not-a-24-hex-slot'; work cùng chuỗi ID, thiếu số buổi. Luồng vẫn gọi DeleteWork một lần và báo xóa thành công. Nhánh tra DB có regex 24-hex nhưng nhánh GraphQL chỉ kiểm tra chuỗi không rỗng. | Kiểm tra ID GraphQL bằng cùng quy tắc 24-hex trước khi dùng. Nếu không xác định được slot hợp lệ cho work thiếu số buổi thì dừng trước DeleteWork. Thêm test thực thi callback GraphQL, không chỉ kiểm tra tham số truyền vào evaluate. |
| S1-05 | LOW | OPEN | `src/lib/teaching/teaching-http-client.ts:488` | P06: cùng fetch, origin và mã lớp; đổi config.teachingUsername từ AUDIT_A sang AUDIT_B trong cùng tiến trình. Lần B vẫn nhận ID 101 của A, thay vì 202; chỉ có 1 lần login và 1 lần đọc học viên. Cache không có khóa tài khoản và trả trước ensureLoggedIn. Đây là lỗi biên khi đổi cấu hình trong tiến trình; chưa xác nhận có đường đổi tài khoản nóng từ UI hiện tại. | Dùng khóa phiên có username cho cache học viên; làm mất hiệu lực cache liên quan khi thay/huỷ phiên. Thêm ca A → B cùng mã lớp. Đây là phát hiện có điều kiện, không khẳng định lỗi xảy ra trong luồng một tài khoản cố định. |

**Nguồn gốc:** S1-01 là thiếu sót còn tồn tại trong mục tiêu S1.2, không quy lệnh ghi trong sync-class.ts là mã mới. S1-02/S1-05 xuất hiện từ cache dùng chung mới. S1-03 nằm trong callback hàng đợi mới. Kiểm tra GraphQL yếu của S1-04 đã có ở baseline; S1 đổi điều kiện fallback để cả customPage đi qua nhánh này. Báo cáo giữ finding vì thuộc đường phân giải slot đang được nghiệm thu ở S1.6, không gọi đó là hồi quy mới do S1.

## Bằng chứng probe độc lập

Probe chạy các service/route thật trên SQLite và JSON giả trong TEMP. Callback xóa SPCK chạy bằng VM với fetch giả; không mở trình duyệt thật và không xóa dữ liệu trên LMS.

| Probe | Kết quả cuối | Quan sát |
|---|---|---|
| P01 | PASS | Hai transport đồng thời dùng chung 1 login POST |
| P02 | PASS | GET và POST gặp 302 đều đăng nhập lại; tổng 3 login cho phiên đầu và hai lần hết phiên |
| P03 | PASS | Thay fetch khiến đăng nhập và cache học viên được làm mới; ID 1 → 2 |
| P04 | PASS | Timeout trong lúc đọc JSON vẫn hủy signal |
| P05 | PASS | Stop trong lúc đọc JSON trả QUEUE_STOPPED, signal bị hủy |
| P06 | FAIL | Tài khoản B nhận ID 101 đã cache của A; kỳ vọng 202 |
| P07 | FAIL | id=true bị chặn khi đọc trực tiếp; warm-cache biến thành 1 và ghép học viên thành công |
| P08 | PASS | Stop khi POST còn chờ: HTTP 500/TASK_CANCELLED, scanner gọi 0 lần |
| P09 | FAIL | Stop + kết quả quét rỗng: HTTP 200, success=true, isStopped=true |
| P10 | FAIL | POST qua scanner thật làm JSON từ 2 lớp còn 1 lớp |
| P11 | PASS | Dự án FAILED bị sửa contentHash → WAITING_APPROVAL; 0 lời gọi transport |
| P12 | PASS | Slot DB hợp lệ: xóa đúng work giả, không gọi GetClassSlots |
| P13 | PASS | Slot DB dạng tổng hợp bị bỏ qua; lấy slot 24-hex từ GetClassSlots rồi xóa đúng work giả |
| P14 | FAIL | Slot GraphQL sai định dạng vẫn dẫn đến 1 DeleteWork |
| P15 | FAIL | Stop tại syncClass cuối: HTTP 200, success=true, isStopped=true |

Bộ S1 chạy bổ sung còn xác nhận retry FAILED với hash nguyên vẹn cho cả Phiếu điểm và Dự án; hash Phiếu điểm bị sửa bị chặn và hạ WAITING_APPROVAL. S1.5 và S1.7 được xác nhận qua mã/tài liệu; chưa kiểm tra UI thật của hai hàm tải lớp.

S1.8 hiện chỉ chứng minh bộ test S1 PASS dưới runtime bổ sung; suite hiện tại thay scanner bằng stub nên không bắt được S1-01, và không thử payload/cache xấu để bắt S1-02. Không coi kết quả này là toàn bộ hồi quy đã đạt.

## Production Data Preservation Check

Đo bằng lệnh ngoại lệ chỉ đọc được Owner cấp phép. Không mở SQLite, không đọc nội dung, không sao chép hoặc sửa hai tệp dữ liệu thật.

| Tệp | SHA-256 trước kiểm toán | SHA-256 sau kiểm toán | Kết quả |
|---|---|---|---|
| data/mindx_bot.db | 06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB | 06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB | UNCHANGED; khớp kỳ vọng |
| data/running_classes.json | ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2 | ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2 | UNCHANGED; khớp kỳ vọng |

## Điều kiện kiểm toán lại

Sửa S1-01/S1-02 trước; đóng S1-03/S1-04 và xử lý hoặc ghi nhận rõ giới hạn S1-05. Bổ sung ca hồi quy tương ứng. Chạy lại đủ 13 lệnh chuẩn trong môi trường cho phép công cụ kiểm thử khởi động, cùng probe độc lập và SHA-256 trước/sau. Chưa đủ điều kiện sang S2 theo kết luận kiểm toán này.

Chưa kiểm tra: build đầy đủ (không thuộc gate S1 được yêu cầu), UI tương tác thật, LMS/Teaching thật, bảo mật toàn bộ Student Portal. S1.7 chỉ xác nhận nội dung ngoại lệ đã được ghi nhất quán, không chứng nhận lại toàn bộ máy chủ thu bài.

## Phụ lục bằng chứng có thể tái lập

Các tệp harness và probe được tạo trong TEMP; nội dung được giữ ngay trong báo cáo để tái lập sau khi dọn chúng. **Dọn TEMP chưa hoàn tất:** bộ duyệt tự động từ chối hai lệnh dọn, gồm thao tác gỡ junction node_modules đã xác minh, với thông báo `blocked by policy`; không cung cấp lý do chi tiết. Không thử xóa đệ quy khi junction còn tồn tại. Thư mục còn lại: `C:\Users\QQ\AppData\Local\Temp\mindx-codex-s1-r1-b2576545f9ec41ea93cc5ee7e4a1160f`. Junction `snapshot/node_modules` trỏ về thư viện gốc; thư viện gốc không bị xóa. Đây là một yêu cầu cách ly/dọn dẹp chưa hoàn tất do giới hạn công cụ.

Đường dẫn AUDIT_ROOT trỏ tới thư mục tạm riêng; snapshot là bản sao mã hiện tại, không chứa hai tệp dữ liệu thật. Đặt AUDIT_MODULE_ROOT tới node_modules đã cài, đặt NODE_OPTIONS=--require=<AUDIT_ROOT>/offline.cjs; trước mỗi tiến trình đặt ba biến cô lập như mô tả trên. Đây là cách chạy bổ sung SWC, không phải tsx chuẩn.

SHA-256 bản cuối:
- adversarial.cjs: 8C9E9C280DDD828A8584C0565534AE1B9720A6BE42D08AAFAE12CAB233D0CF2E
- runtime.cjs: C0927C39CCADBBA43719D26C8EB9EB6E486B8AB2178AD266FF1A9367925BBAAC
- offline.cjs: F143A472D2A54C6461AB247BECFCED15AF2716722139F295F68B6D9E8A12801A

<details>
<summary>runtime.cjs</summary>

```javascript
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const swc = require(process.env.AUDIT_MODULE_ROOT + '/@next/swc-win32-x64-msvc');
const snapshot = path.join(__dirname,'snapshot');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request,parent,...rest) {
 if (request.startsWith('@/')) request=path.join(snapshot,'src',request.slice(2));
 return originalResolve.call(this,request,parent,...rest);
};
for(const ext of ['.ts','.tsx']) require.extensions[ext]=function(mod,filename) {
 const source = fs.readFileSync(filename,'utf8');
 const output=swc.transformSync(source,false,Buffer.from(JSON.stringify({filename,jsc:{target:'es2022',parser:{syntax:'typescript',tsx:filename.endsWith('.tsx')},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}))).code;
 mod._compile(output,filename);
};
if (require.main===module) require(path.resolve(process.argv[2]));
```

</details>


<details>
<summary>offline.cjs</summary>

```javascript
const net = require('node:net');
const oldConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  const options = typeof a === 'object' ? a : { port: a, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!options.path && options.port && !['localhost','127.0.0.1','::1'].includes(options.host || 'localhost')) throw new Error('AUDIT_NETWORK_BLOCKED');
  return oldConnect.apply(this,args);
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('AUDIT_NETWORK_BLOCKED: ' + url.hostname);
  return nativeFetch(input,init);
};
const pw = require(process.env.AUDIT_MODULE_ROOT + '/playwright');
for (const method of ['launch','launchPersistentContext']) {
 const orig = pw.chromium[method].bind(pw.chromium);
 pw.chromium[method] = (...args) => {
  const idx = method === 'launch' ? 0 : 1;
  const options = args[idx] || {};
  args[idx] = {...options,args:[...(options.args || []),'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=localhost;127.0.0.1','--disable-background-networking']};
  return orig(...args);
 };
}
```

</details>


<details>
<summary>adversarial.cjs</summary>

```javascript
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./runtime.cjs');
const base=path.join(__dirname,'snapshot');
const {config}=require(base+'/src/lib/config.ts');
const {taskQueue}=require(base+'/src/lib/queue/task-queue.ts');
const db=require(base+'/src/lib/db/sqlite.ts');
const json=require(base+'/src/lib/db/json-config.ts');
const http=require(base+'/src/lib/teaching/teaching-http-client.ts');
const tp=require(base+'/src/lib/playwright/teaching-project-service.ts');
const rc=require(base+'/src/lib/playwright/teaching-report-card-sync.ts');
const {ClassSyncer}=require(base+'/src/lib/playwright/sync-class.ts');
const {BrowserManager}=require(base+'/src/lib/playwright/browser-manager.ts');
const {authService}=require(base+'/src/lib/playwright/auth.ts');
const {SpckUploader}=require(base+'/src/lib/playwright/spck-uploader.ts');
const {POST}=require(base+'/src/app/api/spck/list/route.ts');
const rows=[];
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const local=()=>new Request('http://127.0.0.1:3000/api/spck/list',{method:'POST',headers:{Host:'127.0.0.1:3000',Origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:'{}'});
const oldFetch=fetch;
const oldSync=ClassSyncer.syncClass;
const oldScan=ClassSyncer.fetchRunningClasses;
async function check(id,fn) {
 taskQueue.resumeQueue(); http.clearSharedTeachingSession();
 try { const evidence=await fn(); rows.push({id,result:'PASS',evidence});}
 catch(e){rows.push({id,result:'FAIL',error:e.message});}
 console.log(JSON.stringify(rows.at(-1)));
}
function mockTeaching(dataFactory, override) {
 let posts=0,gets=0,students=0;
 const calls=[];
 const fn=async(input,init={})=>{
  const url=String(input), method=init.method||'GET'; calls.push({url,method,cookie:init.headers?.Cookie});
  if(url.endsWith('/login.php')) {
   if(method==='POST') posts++; else gets++;
   return response({},method==='POST'?302:200,{'set-cookie':'PHPSESSID='+config.teachingUsername+'_'+posts+'; Path=/'});
  }
  if(override){const result=await override(url,init);if(result)return result;}
  if(url.includes('get_students_of_class')){students++;return response(dataFactory());}
  return response([]);
 };
 globalThis.fetch=fn;
 return {fn,calls,counts:()=>({posts,gets,students})};
}
function loc() {const x={}; Object.assign(x,{first:()=>x,nth:()=>x,locator:()=>x,waitFor:async()=>{},evaluate:async()=>true,evaluateAll:async()=>false,isVisible:async()=>false,count:async()=>0,click:async()=>{},getAttribute:async()=>null,isEnabled:async()=>false});return x;}
function scannerPage(onRows) {
 return {url:()=> 'https://lms.mindx.edu.vn/admin/classes', locator:()=>loc(),keyboard:{press:async()=>{}},waitForTimeout:async()=>{},evaluate:async()=>onRows()};
}
async function clearWithGraphql(classId,dbId,remoteId) {
 if(dbId) db.classSessionRepo.upsert({classId,className:classId,sessionId:dbId,sessionNumber:13,date:'2026-10-28',topic:'S13'});
 const calls=[],deleted=[];const works=[{id:'WORK13',studentId:'STU13',classSessionId:remoteId,classId:'LMS_CLASS',isDeleted:false,latestData:{title:'fixture'}}];
 const fake=async(_url,init)=>{
  const {query,variables}=JSON.parse(init.body);calls.push(query.match(/(?:query|mutation)\s+(\w+)/)?.[1]);
  if(query.includes('FindClass'))return response({data:{classes:{data:[{id:'LMS_CLASS',name:classId}]}}});
  if(query.includes('GetClassSlots'))return response({data:{class:{slots:Array.from({length:14},(_,i)=>({_id:i===12?remoteId:'f'.repeat(24)}))}}});
  if(query.includes('DeleteWork')){deleted.push(variables.payload.id);works[0].isDeleted=true;return response({data:{studentWorks:{del:{id:works[0].id,isDeleted:true}}}});}
  return response({data:{findAllStudentWorks:{data:works.map(w=>({...w}))}}});
 };
 const page={on:()=>{},off:()=>{},url:()=> 'https://lms.mindx.edu.vn/admin/classes',waitForTimeout:async()=>{},keyboard:{press:async()=>{}},locator:()=>loc(),
 evaluate:async(fn,arg)=>{
  if(typeof fn==='string')return;
  return vm.runInNewContext('('+fn.toString()+')(arg)',{arg,fetch:fake,console,URL,URLSearchParams,setTimeout,clearTimeout});
 }};
 let result,error;
 try{result=await SpckUploader.clearSessionSpck({classId,sessionNumber:13,customPage:page});}catch(e){error=e.message;}
 return {calls,deleted,result,error};
}
async function main(){
 config.teachingUsername='AUDIT_A'; config.teachingPassword='SYNTHETIC';
 await check('P01-shared-login',async()=>{
  const m=mockTeaching(()=>[{id:17,student_name:'Fixture Student',class_code:'AUDIT-CLS',status:'đang học'}]);
  const a=new tp.LiveTeachingHttpTransport('https://teachingmindx.top');
  const b=new rc.LiveTeachingReportCardHttpTransport('https://teachingmindx.top');
  await Promise.all([a.getStudents('AUDIT-CLS'),b.getExercises('AUDIT-CLS')]);
  assert.equal(m.counts().posts,1); return m.counts();
 });
 await check('P02-302-GET-and-POST-relogin',async()=>{
  let expiredGet=false,expiredPost=false;
  const m=mockTeaching(()=>[],async(url,init)=>{
   if(url.includes('probe_get')&&!expiredGet){expiredGet=true;return response({},302,{location:'/login.php'});}
   if(init.method==='POST'&&!url.endsWith('login.php')&&!expiredPost){expiredPost=true;return response({},302,{location:'/login.php'});}
   return response({success:true});
  });
  const client=new http.TeachingHttpClient();
  await client.getJson('?probe_get=1');await client.postForm(new URLSearchParams({action:'probe_post'}));
  assert.equal(m.counts().posts,3);return m.counts();
 });
 await check('P03-fetch-replacement-invalidates',async()=>{
  const c=new http.TeachingHttpClient();
  const first=mockTeaching(()=>[{id:1,student_name:'Fixture Student'}]);await c.getStudentsOfClass('AUDIT-CLS');
  const second=mockTeaching(()=>[{id:2,student_name:'Fixture Student'}]);const list=await c.getStudentsOfClass('AUDIT-CLS');
  assert.equal(list[0].id,2);assert.equal(second.counts().posts,1);return {first:first.counts(),second:second.counts()};
 });
 await check('P04-timeout-body-aborts',async()=>{
  let signal;
  mockTeaching(()=>[],async(_url,init)=>{signal=init.signal;return {ok:true,status:200,json:()=>new Promise(()=>{})};});
  const c=new http.TeachingHttpClient(undefined,25);
  await assert.rejects(()=>c.getJson('?body=1'),/Quá thời gian chờ/);assert.equal(signal.aborted,true);return {aborted:signal.aborted};
 });
 await check('P05-stop-body-aborts',async()=>{
  let start;const started=new Promise(r=>start=r);let signal;
  mockTeaching(()=>[],async(_url,init)=>{signal=init.signal;start();return {ok:true,status:200,json:()=>new Promise(()=>{})};});
  const c=new http.TeachingHttpClient(undefined,500);
  const pending=c.getJson('?body=1').then(()=>({ok:true}),e=>({error:e.message}));
  await started;taskQueue.stopQueue();const result=await pending;assert.match(result.error,/QUEUE_STOPPED/);assert.equal(signal.aborted,true);return result;
 });
 await check('P06-account-cache-boundary',async()=>{
  const m=mockTeaching(()=>[{id:config.teachingUsername==='AUDIT_A'?101:202,student_name:'Fixture Student',class_code:'AUDIT-CLS'}]);
  const c=new http.TeachingHttpClient();
  config.teachingUsername='AUDIT_A';await c.getStudentsOfClass('AUDIT-CLS');
  config.teachingUsername='AUDIT_B';const list=await c.getStudentsOfClass('AUDIT-CLS');
  const evidence={expectedId:202,actualId:list[0].id,counts:m.counts()};rows.push({id:'P06-evidence',result:'INFO',evidence});
  assert.equal(list[0].id,202,'cached roster of AUDIT_A returned after switching to AUDIT_B');
  return evidence;
 });
 config.teachingUsername='AUDIT_A';
 await check('P07-strict-cache-boundary',async()=>{
  const m=mockTeaching(()=>[{id:true,student_name:'Fixture Student',class_code:'AUDIT-CLS',status:'đang học'}]);
  const a=new tp.LiveTeachingHttpTransport(),b=new rc.LiveTeachingReportCardHttpTransport();
  const localRows=[{studentId:'LMS_01',fullName:'Fixture Student',isActive:true,btvnScores:{},stageScores:{}}];
  const cold=await b.getStudents('AUDIT-CLS');
  assert.throws(()=>rc.matchReportCardStudentsToTeaching(localRows,cold,'AUDIT-CLS',true),/ID học sinh/);
  http.clearSharedTeachingSession();
  await a.getStudents('AUDIT-CLS');const warmed=await b.getStudents('AUDIT-CLS');
  let blocked=false;try{rc.matchReportCardStudentsToTeaching(localRows,warmed,'AUDIT-CLS',true);}catch{blocked=true;}
  const evidence={coldId:cold[0].id,warmId:warmed[0].id,warmBlocked:blocked,counts:m.counts()};rows.push({id:'P07-evidence',result:'INFO',evidence});
  assert.equal(blocked,true,'project-normalized cache bypassed strict report-card student ID guard');return evidence;
 });
 await check('P08-queued-stop-does-not-scan',async()=>{
  let release;let called=0;const blocking=taskQueue.enqueue({id:'AUDIT_BLOCK',jobType:'CUSTOM',description:'fixture',execute:()=>new Promise(r=>release=r)});
  ClassSyncer.fetchRunningClasses=async()=>{called++;return {success:true,classes:[]};};
  const pending=POST(local());await new Promise(r=>setImmediate(r));taskQueue.stopQueue();const res=await pending;
  release();await blocking;taskQueue.resumeQueue();assert.equal(called,0);assert.notEqual(res.status,200);return {status:res.status,called};
 });
 await check('P09-stop-after-empty-scan',async()=>{
  json.saveRunningClasses([]);
  ClassSyncer.fetchRunningClasses=async()=>{taskQueue.stopQueue();return {success:true,classes:[]};};
  const res=await POST(local());const data=await res.json();rows.push({id:'P09-evidence',result:'INFO',evidence:{status:res.status,success:data.success,isStopped:taskQueue.getStatus().isStopped}});
  assert.equal(data.success,false,'POST reported success while Stop was active');return data;
 });
 ClassSyncer.fetchRunningClasses=oldScan;
 await check('P10-real-scanner-preserves-running-json',async()=>{
  const initial=[{classCode:'AUDIT-ACTIVE',status:'Running'},{classCode:'AUDIT-EXPIRED',status:'Finished',endDate:'01/01/2025'}];
  json.saveRunningClasses(initial);const before=fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,'utf8');
  const manager=BrowserManager.getInstance(),oldPage=manager.getPage,oldAuth=authService.ensureAuthenticated;
  manager.getPage=async()=>scannerPage(()=>[{classCode:'AUDIT-ACTIVE',courseName:'Fixture',center:'Fixture',status:'Running',rowStartDate:'01/01/2026',rowEndDate:'01/12/2026'},{classCode:'AUDIT-EXPIRED',courseName:'Fixture',center:'Fixture',status:'Finished',rowStartDate:'01/01/2024',rowEndDate:'01/01/2025'}]);
  authService.ensureAuthenticated=async()=>{};
  ClassSyncer.syncClass=async()=>({success:true,classId:'AUDIT-ACTIVE',className:'Fixture',sessionsCount:0,studentsCount:0});
  try {
   const res=await POST(local());const after=fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,'utf8');
   rows.push({id:'P10-evidence',result:'INFO',evidence:{status:res.status,beforeCount:JSON.parse(before).length,afterCount:JSON.parse(after).length,codes:JSON.parse(after).map(x=>x.classCode)}});
   assert.equal(after,before,'real fetchRunningClasses still overwrites shared JSON during POST');
  }finally{manager.getPage=oldPage;authService.ensureAuthenticated=oldAuth;ClassSyncer.syncClass=oldSync;}
 });
 await check('P11-project-FAILED-tamper-demotes',async()=>{
  const classId='AUDIT-RETRY-TP';
  const row=db.teachingProjectRepo.getOrInit(classId,{projectName:'Fixture',startDate:'2026-01-01',endDate:'2026-12-01',description:'Fixture',students:[{id:801,studentName:'Fixture Student',classCode:classId,status:'đang học'}],tasks:[1,2,3,4,5].map(slotIndex=>({slotIndex,taskName:'Task'+slotIndex,description:'Fixture',weightPercent:20,deadline:'2026-12-01',assignedStudentIds:[801]}))});
  const approved=db.teachingProjectRepo.approveDraft(classId,row.draftVersion);assert.equal(approved.success,true);
  db.teachingProjectRepo.markFailed(classId,'fixture');db.getDb().prepare("UPDATE teaching_final_projects SET contentHash='tampered' WHERE classId=?").run(classId);
  let calls=0;const result=await tp.TeachingProjectService.syncProjectAndTasksToTeaching(classId,{transport:{getProject:async()=>{calls++;throw Error('must not run');}}});
  assert.equal(result.success,false);assert.equal(result.record.status,'WAITING_APPROVAL');assert.equal(calls,0);return {status:result.record.status,calls};
 });
 await check('P12-dynamic-valid-db',async()=>{
  const id='abcdef012345678901234513';const r=await clearWithGraphql('AUDIT-SLOT-DB',id,id);
  assert.equal(r.error,undefined);assert.equal(r.result.effectiveSessionId,id);assert.equal(r.calls.includes('GetClassSlots'),false);assert.equal(r.deleted.length,1);return {calls:r.calls,deleted:r.deleted,slot:r.result.effectiveSessionId};
 });
 await check('P13-dynamic-synthetic-db-falls-back',async()=>{
  const id='abcdef012345678901234514';const r=await clearWithGraphql('AUDIT-SLOT-GQL','AUDIT-SLOT-GQL_SESS_13',id);
  assert.equal(r.error,undefined);assert.equal(r.result.effectiveSessionId,id);assert.equal(r.calls.includes('GetClassSlots'),true);assert.equal(r.deleted.length,1);return {calls:r.calls,deleted:r.deleted,slot:r.result.effectiveSessionId};
 });
 await check('P14-malformed-graphql-slot-blocks-delete',async()=>{
  const r=await clearWithGraphql('AUDIT-SLOT-BAD',null,'not-a-24-hex-slot');
  rows.push({id:'P14-evidence',result:'INFO',evidence:{deleted:r.deleted,slot:r.result?.effectiveSessionId,error:r.error}});
  assert.equal(r.deleted.length,0,'malformed GraphQL slot allowed destructive delete');return {error:r.error};
 });
 await check('P15-stop-after-last-class-sync',async()=>{
  json.saveRunningClasses([{classCode:'AUDIT-LAST',status:'Running'}]);
  ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'AUDIT-LAST',status:'Running'}]});
  ClassSyncer.syncClass=async()=>{taskQueue.stopQueue();return {success:true,classId:'AUDIT-LAST',sessionsCount:0,studentsCount:0};};
  const res=await POST(local());const data=await res.json();
  rows.push({id:'P15-evidence',result:'INFO',evidence:{status:res.status,success:data.success,isStopped:taskQueue.getStatus().isStopped}});
  ClassSyncer.fetchRunningClasses=oldScan;ClassSyncer.syncClass=oldSync;
  assert.equal(data.success,false,'last class sync reported success after Stop');return data;
 });
 ClassSyncer.fetchRunningClasses=oldScan;ClassSyncer.syncClass=oldSync;taskQueue.resumeQueue();globalThis.fetch=oldFetch;db.closeDb();
 const summary={passed:rows.filter(r=>r.result==='PASS').length,failed:rows.filter(r=>r.result==='FAIL').length,rows};
 fs.writeFileSync(path.join(__dirname,'probe-results.json'),JSON.stringify(summary,null,2));
 console.log('SUMMARY '+JSON.stringify({passed:summary.passed,failed:summary.failed}));
 process.exitCode=summary.failed?1:0;
}
main().catch(e=>{console.error(e);try{db.closeDb();}catch{}process.exitCode=2;});
```

</details>


