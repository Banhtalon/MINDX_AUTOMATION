# Kiểm định độc lập v3.4.0 — S2, Round 1

**Decision: NO-GO.** Ngày kiểm định: **2026-10-30**, múi giờ `Asia/Saigon`.

13/13 lệnh TypeScript và các suite được chỉ định có kết quả cuối **exit 0**. Tuy nhiên, probe độc lập có **39/46 kiểm tra đạt, 7 kiểm tra thất bại**, quy về **5 phát hiện OPEN**, gồm **1 HIGH và 4 MEDIUM**. Đặc biệt, Màn 3 có thể đang chọn lớp A nhưng hiển thị bài và học viên lớp B khi phản hồi khôi phục lớp đến chậm. Vì vậy chưa đủ điều kiện thông qua S2.

## Phạm vi và mốc mã

- HEAD và mốc so sánh: `29e7097e303da668c32a0588917c3864223588a1` — S1. Kiểm định **working tree**, gồm cả tệp S2 mới chưa được Git theo dõi.
- Đã đọc `PROJECT_STATE.md` trước, đối chiếu Giai đoạn 10 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, rồi `AGENTS.md`. Các tài liệu chưa đánh dấu S2 hoàn thành; đây không phải một kết luận GO có sẵn.
- Đã đọc 14 tệp ứng dụng và suite S2 được nêu trong yêu cầu, các hàm gọi liên quan, bộ đồng bộ lớp, hàng đợi, kiểm tra yêu cầu cục bộ, lưu trữ và các bài thử hồi quy. Đã tham khảo tài liệu Route Handlers / Server and Client Components đi kèm bản Next.js đang cài.
- Đánh giá theo mô hình một giáo viên sử dụng ứng dụng trên máy cá nhân. Vẫn kiểm tra phản hồi chậm và các thao tác chồng nhau trong cùng giao diện.
- Không sửa ứng dụng, script kiểm thử có sẵn, `next-env.d.ts`, ba tài liệu trạng thái hoặc thư mục audit lịch sử. Tệp bàn giao duy nhất trong kho là báo cáo này.

## Cách cô lập

Đã tạo `$A=C:\Users\QQ\AppData\Local\Temp\mindx-s2-r1-FNaY4y`, bản sao mã `$W=$A\snapshot`. Không sao chép `.env`, `.env.local`, hồ sơ trình duyệt hoặc hai tệp dữ liệu production. Tệp `$W/data/running_classes.json` là fixture tự tạo chứa `[]`, không lấy từ production.

Trước **mỗi tiến trình kiểm thử/probe** đều đặt:

```text
ALLOWED_LOCAL_DIRS=$A
MINDX_DB_PATH=$A/scratch/<suite>/test.db
MINDX_RUNNING_CLASSES_PATH=$A/scratch/<suite>/running_classes.json
TEMP=$A/scratch/<suite>
TMP=$A/scratch/<suite>
NODE_PATH=<kho gốc>/node_modules
```

TypeScript chạy tại kho gốc với ba đường dẫn dữ liệu trỏ vào `$A`; các suite và probe chạy trên bản sao trong TEMP. Suite S1/S2 tự chọn thư mục con của TEMP; v320 tự đặt `data/tmp-test-*` tương đối với `$W`. Tất cả vẫn nằm trong TEMP. Phase 7 chạy trong bản sao nên các lần ghi cấu hình không chạm vào cấu hình thật.

Nạp `.ts`/`.tsx` bằng `node` + `@next/swc-win32-x64-msvc`, phân giải `@/` vào mã trong `$W`, phân giải thư viện qua `Module._resolveFilename`/`NODE_PATH` về `node_modules` có sẵn. Đây là cách chạy chính thức được prompt cho phép. Không thay assertion hoặc sửa nội dung test. Esbuild dùng bản thật, chỉ bổ sung đường dẫn thư viện cho bản sao.

Chặn mạng ngoài ở `fetch`, `http`, `https` của Node; Chromium chạy qua proxy cục bộ không có dịch vụ nhận kết nối tại `127.0.0.1:9`. Những yêu cầu LMS/Teaching trong fixture được giả lập/intercept. Không gửi yêu cầu thật tới LMS/Teaching, không đăng nhập tài khoản thật. Không tạo junction `node_modules`; fixture V14 được phép tạo junction thử nghiệm riêng trong TEMP.

## Gate Execution Summary — 13 lệnh bắt buộc

Các hàng có `node $A/runtime.cjs ...` là cách thực thi tương đương `npx tsx ...` được Owner cho phép. TypeScript thực thi chính xác bằng `npx --no-install tsc --noEmit --incremental false` để dùng trình kiểm tra đã cài, không tải thêm gói.

| # | Lệnh yêu cầu | Lệnh thực thi | Exit code theo thứ tự | Kết quả cuối |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit --incremental false` | `npx --no-install tsc --noEmit --incremental false` | **0** | PASS |
| 2 | `npx tsx scripts/test-streamline-v340-s2.ts` | `node $A/runtime.cjs scripts/test-streamline-v340-s2.ts` | **0** | PASS S2.1–S2.5 theo suite |
| 3 | `npx tsx scripts/test-streamline-v340-s1.ts` | `node $A/runtime.cjs scripts/test-streamline-v340-s1.ts` | **0** | PASS S1 và các ca hồi quy đi kèm |
| 4 | `npx tsx scripts/test-phase5.ts` | `node $A/runtime.cjs scripts/test-phase5.ts` | **0** | PASS |
| 5 | `npx tsx scripts/test-phase6.ts` | `node $A/runtime.cjs scripts/test-phase6.ts` | **0** | PASS, đủ các nhóm của suite |
| 6 | `npx tsx scripts/test-phase7.ts` | `node $A/runtime.cjs scripts/test-phase7.ts` | **1 → 0** | PASS sau bổ sung tệp launcher còn thiếu trong bản sao |
| 7 | `npx tsx scripts/test-phase4-codex-repros.ts` | `node $A/runtime.cjs scripts/test-phase4-codex-repros.ts` | **0** | PASS |
| 8 | `npx tsx scripts/test-spck-v270.ts` | `node $A/runtime.cjs scripts/test-spck-v270.ts` | **0** | PASS T01–T16 |
| 9 | `npx tsx scripts/test-spck-v272.ts` | `node $A/runtime.cjs scripts/test-spck-v272.ts` | **0** | PASS V01–V16, gồm fixture junction V14 nguyên bản |
| 10 | `npx tsx scripts/test-lms-reliability-v280.ts` | `node $A/runtime.cjs scripts/test-lms-reliability-v280.ts` | **0** | PASS T280-01–05 |
| 11 | `npx tsx scripts/test-session14-v290.ts` | `node $A/runtime.cjs scripts/test-session14-v290.ts` | **0** | PASS S14-01–07 |
| 12 | `npx tsx scripts/test-teaching-project-v320.ts` | `node $A/runtime.cjs scripts/test-teaching-project-v320.ts` | **1 → 0** | PASS TP-01–06 sau sửa cách tìm thư viện của harness |
| 13 | `npx tsx scripts/test-report-card-v330.ts` | `node $A/runtime.cjs scripts/test-report-card-v330.ts` | **0** | PASS RC-01–06 |

Hai lượt hiệu chỉnh môi trường thử không phải lỗi ứng dụng:

1. Phase 7 ban đầu exit 1 vì bước sao chép bỏ sót `start-bot.command`. Sao chép nguyên tệp hiện có từ kho vào `$W`, chạy lại **toàn bộ** suite, exit 0. Không sửa launcher hoặc assertion.
2. v320 ban đầu exit 1 ở TP-06 vì esbuild không tìm được React/lucide trong bản sao không có `node_modules`. Harness trả về wrapper cho `esbuild.build/buildSync` để thêm `nodePaths:[<kho gốc>/node_modules]`, giữ nguyên bộ dựng thật. Chạy lại **toàn bộ** TP-01–06, exit 0. Không sửa mã/test.

## Probe độc lập

| Lệnh thực thi trong môi trường cô lập | Exit code | Kết quả |
|---|---|---|
| `node $A/adversarial.cjs` | **1** | 31/32 đạt; tái hiện đồng bộ SPCK thất bại nhưng trả thành công |
| `node $A/ui-probe.cjs` | **1** | 8/14 đạt; 6 kiểm tra thất bại quy về 4 nhóm lỗi giao diện |

Tổng **46 kiểm tra độc lập**, không cộng với số assertion của suite. Probe giao diện đã chạy hai lượt: lượt đầu chưa thêm tình huống phản hồi chậm có 13 kiểm tra; lượt cuối có 14 kiểm tra và là kết quả được dùng trong tổng 46. Không cộng trùng hai lượt.

Probe phía máy chủ dùng SQLite thật trong TEMP và gọi các route thật, chỉ thay thao tác quét LMS bằng phản hồi giả. Probe giao diện dùng **React/ReactDOM, esbuild và Chromium thật**, dựng trực tiếp bốn trang cùng `ClassPicker` hiện tại; chỉ thay nguồn trả lời HTTP. Không thay logic component bằng bản mô phỏng.

Các kiểm tra đạt xác nhận:

- Bộ lọc lớp giả, chuẩn hóa khoảng trắng/chữ hoa, các phạm vi running/SPCK/all, lớp hết hạn và biên đúng 15 ngày / quá 1 ms; tùy chọn đổi số ngày giữ lớp.
- Danh sách học viên đang học và cả học viên ngừng học; cùng danh sách lớp theo phạm vi trên **cả sáu route**. Các vỏ JSON hiện có `success/data`, `success/classes`, `selectedClassId/selectedSessionNumber` vẫn dùng được; dữ liệu lớp có thêm các trường chung của directory.
- GET refresh cho ba phạm vi; chặn yêu cầu khác nguồn; body JSON hỏng/sai kiểu, scope sai và hai mã lớp mâu thuẫn.
- POST refresh xếp **đúng một** tác vụ `SYNC_CLASS`; gọi discovery trước selected-class sync; selected-class sync thất bại trả 500. Stop trước tác vụ, sau discovery, sau selected sync và trong SPCK sync đều trả 499, không tiếp tục bước kế sau Stop.
- Nhớ lớp, chọn lớp khác và ghi lại lớp đã chọn trên **cả bốn màn hình**; SPCK không đưa lớp Buổi 8 vào lựa chọn đủ điều kiện. Khi mã đã nhớ là lớp Buổi 8, Màn 3 hiển thị lớp Buổi 13 đầu tiên. Không coi việc bộ nhớ vẫn giữ lớp Buổi 8 là lỗi riêng, vì có thể cần giữ lựa chọn dùng chung cho các màn khác.
- Không có `pageerror` trong các tình huống trình duyệt đã chạy.

## Finding Table

| ID | Severity | Status | Vị trí chính xác | Bằng chứng tái hiện | Yêu cầu sửa |
|---|---|---|---|---|---|
| **S2-01** | **HIGH** | **OPEN** | `src/app/final-project/page.tsx:1146`; liên quan `src/components/class-picker.tsx:232`, `src/app/final-project/page.tsx:1166`, `:1179`, `:1186` | Probe `UI-final-late-restore-must-not-overwrite-new-class`: nhớ B, API mặc định A; phát sinh hai lượt tải B. Cho một lượt B hoàn tất, đổi sang A, rồi cho lượt B còn lại trả về. Kết quả: `selected=VT-C4K-ALPHA`, `hasStudentA=false`, `hasStudentB=true`. | Chỉ có một nơi điều phối khôi phục lớp. Thêm số thứ tự yêu cầu/kiểm tra lớp hiện tại trước khi cập nhật mọi dữ liệu trả về; phản hồi cũ không được cập nhật hàng bài/học viên, buổi học hoặc cờ đang tải. Giữ năm `useState` đầu. Bổ sung bài thử đảo thứ tự phản hồi như probe. |
| **S2-02** | **MEDIUM** | **OPEN** | `src/app/api/classes/refresh/route.ts:219`, `:243`, `:252` | Probe `Q-spck-sync-failure-visible`: discovery thành công; mọi selected-eligible sync trả `{success:false,error:'fixture upstream HTTP 503'}`. Route vẫn trả **HTTP 200**, `success:true`, `syncedClassCodes:[]`, không có lỗi. | Thu thập lỗi theo mã lớp ở cả nhánh Running và Finished; trả trạng thái thất bại hoặc trạng thái hoàn thành một phần có lỗi rõ ràng để UI không hiểu là đã quét/đồng bộ thành công. Không đánh đồng lớp không cần sync với lớp sync thất bại. |
| **S2-03** | **MEDIUM** | **OPEN** | `src/components/class-picker.tsx:272`, `:285`; caller `src/app/teaching-projects/page.tsx:1022`; tương tự `src/app/homework-grader/page.tsx:211`, `:221` | Probe `UI-teaching-refresh-failure-visible`, `UI-homework-refresh-failure-visible`: chọn “Quét lại danh sách lớp” và trả HTTP 500 `{success:false,error:'AUDIT LMS UNAVAILABLE'}`. Cả hai màn không hiển thị lỗi. | Component chung phải công bố lỗi quét bằng thông báo nhìn thấy được hoặc callback lỗi; xử lý cả `success:false` và ngoại lệ kết nối/đọc JSON, luôn kết thúc trạng thái đang quét. Nối xử lý lỗi tương ứng cho callback riêng ở Màn 2. |
| **S2-04** | **MEDIUM** | **OPEN** | `src/components/class-picker.tsx:252`, `:376`, `:387` | Probe `UI-picker-refresh-blocks-manual-commit`: mở nhập tay khi lớp A, gõ B, bắt đầu quét A và giữ phản hồi; nhấn Enter trong ô nhập vẫn ghi `mindx_last_class_code=B` và gọi đổi lớp trong lúc đang quét. | Khóa input và nút “Chọn” bằng `effectiveBusy`; kiểm tra lại cờ này ngay trong hàm chốt mã lớp để cả Enter và click đều bị chặn. Áp dụng nhất quán khi `disabled`, `isRefreshing` hoặc `internalRefreshing` bật. |
| **S2-05** | **MEDIUM** | **OPEN** | `src/app/session-comments/page.tsx:650`; `src/app/homework-grader/page.tsx:211` | Probe `UI-session-empty-list-clears`, `UI-homework-empty-list-clears`: đã có A/B, quét thành công trả `classes:[]`. Cả hai ô chọn vẫn giữ **cả A và B**; B không phải lớp đang chọn vẫn có thể chọn. Màn 1 còn diễn giải kết quả thành công/rỗng thành lỗi “không lấy được”. | Khi phản hồi thành công với mảng rỗng, cập nhật danh sách thành `[]` và giải thích chưa có lớp phù hợp. Phân biệt với lỗi quét; có thể giữ mã nhập tay hiện tại theo thiết kế nhưng không giữ toàn bộ danh sách cũ như danh sách hợp lệ. |

**Nguồn gốc phát hiện:** S2-01 phát sinh từ hai cơ chế khôi phục lớp mới cùng chạy trên Màn 3; trước S2 không có lần khôi phục đệ quy này. S2-02 và lỗi mặc định của ClassPicker ở Màn 5 trong S2-03 nằm trong mã mới. S2-04 nằm trong ô nhập mới. Việc nuốt lỗi ở callback riêng Màn 2 trong S2-03 và điều kiện chỉ nhận mảng có phần tử trong S2-05 **đã có tại baseline**; không quy là lỗi mới do S2 tạo ra. Chúng vẫn được ghi OPEN vì nằm trực tiếp trên luồng tích hợp đang nghiệm thu. Bộ lọc hết hạn chung mới có thể trả mảng rỗng khi mọi lớp cũ đã quá hạn, nhưng hai caller chưa xử lý được kết quả đó. Ngay cả khi tách các vấn đề kế thừa khỏi điều kiện nghiệm thu, **S2-01 vẫn đủ để kết luận NO-GO**.

### S2-01 — Lớp đang chọn và bài hiển thị bị lệch nhau

**Nguyên nhân:** Trang tự đọc lớp đã nhớ và gọi `loadClassData(savedClassId)` sau khi đã đưa danh sách lớp vào state. Đồng thời, `ClassPicker` mới nhận danh sách này, cũng đọc bộ nhớ và gọi `onChange(saved)`, tạo thêm một lượt tải lớp đó. Mỗi lượt đều được phép tắt cờ đang tải; không có kiểm tra phản hồi cũ trước khi ghi học viên và hàng bài lên màn hình.

**Cách tái hiện đã chạy trong Chromium:**

1. Hai lớp đủ điều kiện A/B; `localStorage.mindx_last_class_code=B`; GET mặc định trả danh sách A/B và mặc định A.
2. Giữ cả hai GET có `classId=B`. Quan sát đúng hai lượt tải B.
3. Cho một lượt B trả về. Ô chọn lớp được bật dù lượt B thứ hai vẫn chưa xong.
4. Chọn A và cho phản hồi A hoàn tất. Màn hình đang hiển thị `STUDENT_A`.
5. Cho lượt B còn lại trả về. Ô chọn vẫn là A nhưng `STUDENT_A` biến mất, `STUDENT_B` xuất hiện.

```json
{"selected":"VT-C4K-ALPHA","hasStudentA":false,"hasStudentB":true}
```

Đây là lỗi đã xác nhận ở dữ liệu hiển thị, không phải tuyên bố đã gửi nhầm dữ liệu thật lên LMS. Probe không bấm gửi thật. Rủi ro là giáo viên tiếp tục thao tác với các hàng bài không thuộc lớp đang chọn.

### S2-02 — Báo thành công khi các lớp không đồng bộ được

Kết quả quan sát đã lưu từ route thật trong môi trường cô lập:

```json
{
  "status": 200,
  "success": true,
  "synced": [],
  "attempts": [
    ["discover", {"persistToConfig": true}],
    "VT-C4K-EARLY",
    "VT-C4K-LATE",
    "VT-C4K-FRESH",
    "VT-C4K-EXPIRED"
  ]
}
```

Trong probe có `forceResyncAll:true`; dữ liệu discovery do fixture cung cấp, gồm cả lớp Finished để chạy hai nhánh. Không dùng lớp thật. Chỉ riêng lớp Running ở Buổi 13 thất bại đã đủ tái hiện; kết luận không phụ thuộc việc scanner thật có trả lớp Finished quá hạn hay không. Nhánh sync lớp được chỉ định trực tiếp đã trả 500 đúng; lỗi nằm ở vòng lặp các lớp SPCK còn lại.

### S2-03 đến S2-05 — Bằng chứng giao diện

```text
FAIL UI-teaching-refresh-failure-visible:
  ClassPicker silently discards success:false/error after HTTP 500
FAIL UI-homework-refresh-failure-visible:
  No error shown after /api/classes/refresh HTTP 500
FAIL UI-picker-refresh-blocks-manual-commit:
  actual mindx_last_class_code = VT-C4K-BETA
  expected                   = VT-C4K-ALPHA
FAIL UI-homework-empty-list-clears / UI-session-empty-list-clears:
  options = [VT-C4K-ALPHA, VT-C4K-BETA, __REFRESH_LMS__, __MANUAL_INPUT__]
  response classes = []
```

## Đối chiếu các yêu cầu an toàn

| Yêu cầu | Kết quả trong phạm vi S2 |
|---|---|
| Chỉ phục vụ trên máy cá nhân | Lệnh dev/start tiếp tục bind `127.0.0.1`; route mới dùng `validateLocalRequest`; probe khác nguồn trả 403. Không khởi động server thật. |
| Không đưa mật khẩu/khóa AI ra giao diện | Component chung chỉ nhập React/lucide, không nhập cấu hình máy chủ; bundle bốn màn được dựng bằng mã hiện tại, không đọc `.env`. Không thấy thay đổi S2 làm đưa các biến bí mật đã nêu vào component. |
| Giới hạn thư mục đọc/ghi | Directory đi qua `json-config`, SQLite và các hàm giải ngày hiện có; những đường dữ liệu này dùng kiểm tra đường dẫn. Kiểm thử dùng đường dẫn được phép trong TEMP. Không chứng nhận lại toàn bộ bộ kiểm tra đường dẫn của dự án. |
| Một phiên trình duyệt, tác vụ lần lượt | Route mới xếp một tác vụ, không tạo BrowserContext mới; các thao tác discovery/sync ở trong callback hàng đợi. Probe xác nhận thứ tự và Stop ở bốn vị trí. Các browser thử nghiệm là của harness trong TEMP. |
| Xác nhận lưu LMS, buổi checkpoint | S2 không thay mã gửi nhận xét/điểm checkpoint. Các suite Phase 6, v270/v280/v290 chạy mới đạt với fixture; không suy rộng thành nghiệm thu ghi LMS thật. |
| Khóa định danh, hash khi duyệt và hạ duyệt khi nội dung đổi | Các bộ hồi quy liên quan chạy mới đạt. S2-01 là vi phạm tính nhất quán lớp/học viên ở giao diện và vẫn OPEN. |
| Ẩn danh AI, thiếu thông tin, định dạng nhận xét/Zalo và logo mặc định | Không có thay đổi S2 vào bộ sinh AI; các suite liên quan chạy mới đạt trong môi trường giả lập. Không gọi Gemini thật hoặc chứng nhận lại chất lượng nội dung thật. |
| Ngoại lệ Cổng thu bài học sinh | Không thay mã cổng, cơ chế bật bằng giáo viên hoặc token. Ngoại lệ đã được mô tả trong tài liệu; không mở cổng/tunnel thật trong audit. |

Năm `useState` đầu của Màn 3 được so trực tiếp với `29e7097` và giữ nguyên thứ tự: `classes`, `selectedClassId`, `students`, `folderPathInput`, `rows`. Việc giữ hook không ngăn được S2-01; suite cần thêm ca phản hồi đảo thứ tự.

## Production Data Preservation Check

Lệnh chỉ đọc đã chạy **trước audit**, **sau các kiểm thử**, và chạy lại **sau dọn TEMP**:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau kiểm thử | SHA-256 sau dọn TEMP | Kết quả |
|---|---|---|---|---|
| `data/mindx_bot.db` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | UNCHANGED trước/sau kiểm thử |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | UNCHANGED trước/sau kiểm thử |

Không mở kết nối SQLite tới production, không sao chép/đọc nội dung hai tệp này ngoài ngoại lệ hash chỉ đọc. Các suite tự hash những tệp tên tương tự trong `$W` chỉ thấy fixture trong TEMP.

Đối chiếu trước/sau: **2.225/2.225 tệp đã ghi nhận trong kho giữ nguyên**, trong đó **122/122 tệp src/scripts**, `next-env.d.ts`, **19 tệp data/config**, và tài liệu/audit lịch sử. **122/122 tệp mã/script trong bản sao** khớp mã gốc được kiểm định. Không có chỉnh sửa mã giữa các lượt chạy.

**Dọn TEMP: HOÀN TẤT, exit 0.** Đã xác minh đường dẫn tuyệt đối nằm trong TEMP, root không phải liên kết và bên trong còn 0 junction/symlink; sau đó xóa đúng `$A` bằng Node.js `fs.rmSync(..., {recursive:true, force:true})`. `existsSync($A)=false`. Không dùng PowerShell xóa đệ quy. Hai hash đo lại sau dọn tiếp tục khớp.

## Điều kiện kiểm định lại

1. Sửa S2-01 trước: một luồng khôi phục lớp và chặn phản hồi cũ; chạy lại đúng tình huống B chậm → đổi A → B trả muộn.
2. Đóng S2-02–S2-04 trên luồng mới; xử lý các thiếu sót caller đã ghi rõ nguồn gốc ở S2-03/S2-05.
3. Bổ sung các ca thất bại trên vào suite S2, giữ đủ sáu route, bốn màn hình và năm state đầu của Màn 3.
4. Chạy lại 13 gate cùng probe độc lập trong TEMP, kiểm tra hai hash trước/sau. Sau đó yêu cầu S2 Round 2.

Chưa chạy `npm run build`, chưa nghiệm thu LMS/Teaching/Gemini thật, chưa đánh giá các chặng S3–S8. Không thực hiện sửa lỗi trong vòng kiểm định này.


## Ph? l?c b?ng ch?ng ?? t?i hi?n

C?c t?p d??i ??y ???c t?o v? ch?y trong TEMP, kh?ng n?m trong src/scripts c?a kho. L?u nguy?n n?i dung t?i ??y tr??c khi d?n TEMP ?? v?ng sau c? th? t?i hi?n m? kh?ng ph? thu?c th? m?c ?? x?a. Khi ch?y l?i c?n t?o snapshot m? m?i trong TEMP, sao ch?p m?/c?u h?nh/launcher nh?ng lo?i tr? d? li?u production v? .env, r?i t?o context.json g?m root (kho g?c), a (TEMP), w (snapshot). ??t ba bi?n d? li?u v? TEMP/TMP d??i a tr??c khi ch?y t?ng probe. ui-entry.tsx ph?i n?m c?nh context.json v? th? m?c snapshot.

<details>
<summary>gates.json</summary>

```json
[
  {
    "name": "test-streamline-v340-s2",
    "exit": 0,
    "signal": null,
    "ms": 628
  },
  {
    "name": "test-streamline-v340-s1",
    "exit": 0,
    "signal": null,
    "ms": 679
  },
  {
    "name": "test-phase5",
    "exit": 0,
    "signal": null,
    "ms": 572
  },
  {
    "name": "test-phase6",
    "exit": 0,
    "signal": null,
    "ms": 10460
  },
  {
    "name": "test-phase7",
    "exit": 1,
    "signal": null,
    "ms": 550
  },
  {
    "name": "test-phase4-codex-repros",
    "exit": 0,
    "signal": null,
    "ms": 1980
  },
  {
    "name": "test-spck-v270",
    "exit": 0,
    "signal": null,
    "ms": 4672
  },
  {
    "name": "test-spck-v272",
    "exit": 0,
    "signal": null,
    "ms": 29487
  },
  {
    "name": "test-lms-reliability-v280",
    "exit": 0,
    "signal": null,
    "ms": 83166
  },
  {
    "name": "test-session14-v290",
    "exit": 0,
    "signal": null,
    "ms": 147223
  },
  {
    "name": "test-teaching-project-v320",
    "exit": 1,
    "signal": null,
    "ms": 11617
  },
  {
    "name": "test-report-card-v330",
    "exit": 0,
    "signal": null,
    "ms": 870
  }
]
```

</details>

<details>
<summary>gates-retry.json</summary>

```json
[
  {
    "name": "test-phase7",
    "exit": 0,
    "signal": null,
    "ms": 530
  },
  {
    "name": "test-teaching-project-v320",
    "exit": 0,
    "signal": null,
    "ms": 12256
  }
]
```

</details>

<details>
<summary>preservation.json</summary>

```json
{
  "files": 2225,
  "changed": [],
  "missing": [],
  "mirrorCodeChanged": [],
  "first5Before": [
    "classes, setClasses",
    "selectedClassId, setSelectedClassId",
    "students, setStudents",
    "folderPathInput, setFolderPathInput",
    "rows, setRows"
  ],
  "first5After": [
    "classes, setClasses",
    "selectedClassId, setSelectedClassId",
    "students, setStudents",
    "folderPathInput, setFolderPathInput",
    "rows, setRows"
  ],
  "sameFirst5": true
}
```

</details>

<details>
<summary>scope-hashes.json</summary>

```json
[
  {
    "file": "src/lib/classes/class-directory.ts",
    "sha256": "99b97537cb25ad926116da646fb1d444213f0a64e4ad989996a1d55c7092ae8f"
  },
  {
    "file": "src/app/api/classes/refresh/route.ts",
    "sha256": "43bec2156240d8b3a825db0bc6d2ef212e2613dcb2255645ae93dc94fd82b3fb"
  },
  {
    "file": "src/components/class-picker.tsx",
    "sha256": "d86860c5e59eb541f85716cf4d96698832b0b9365d240b3be926d6dfe1776d8f"
  },
  {
    "file": "src/app/api/session-comments/list/route.ts",
    "sha256": "158b764b79a97ac84bb8a8455bd87acf0bc94469657af0b3d5efda4654461ccd"
  },
  {
    "file": "src/app/api/session-comments/fetch-classes/route.ts",
    "sha256": "f1a16f8bea3860cd16b1da4f1481f77e90c1c6c38f1c28a198a5210f89e56108"
  },
  {
    "file": "src/app/api/report-card/route.ts",
    "sha256": "249716a82eeb010e5c3dce6a58c48ba941a9ec6defba8fe63482c88e552a669e"
  },
  {
    "file": "src/app/api/teaching-projects/route.ts",
    "sha256": "186a6e4185b82f955e312afeb729dc8d4c0fd39e094751e6730c2f5a90b6d996"
  },
  {
    "file": "src/app/api/spck/list/route.ts",
    "sha256": "75dab37075b5f19cf803172817f41227a660fd84ec05228b2bbb2cbe340ced90"
  },
  {
    "file": "src/app/api/homework-grader/scores/route.ts",
    "sha256": "8ed8ed23220da7af291b996b30f7e67cd47314551e359a927acacd724d1929a3"
  },
  {
    "file": "src/app/session-comments/page.tsx",
    "sha256": "76c74e2d51b8a856b380ff51c87222c812a500865a0c7bd1a5e1305772cb1c54"
  },
  {
    "file": "src/app/homework-grader/page.tsx",
    "sha256": "937f3b74dbdd361ec6ae819cfcfbddbb3cdcd23478d28b68f65b12c0376e1087"
  },
  {
    "file": "src/components/teaching-report-card-view.tsx",
    "sha256": "bdc80443e04279653df8e98b0f749f512fdc67f3c41ade6eda68cfec6faf04b3"
  },
  {
    "file": "src/app/final-project/page.tsx",
    "sha256": "1f57617fcb98100f6197dc2f597272c92f83b6d593df079881712cf19c881a60"
  },
  {
    "file": "src/app/teaching-projects/page.tsx",
    "sha256": "152d5cd557ea7041315f772165f14c398f80659b05e4dc496d962f4f4c968c53"
  },
  {
    "file": "scripts/test-streamline-v340-s2.ts",
    "sha256": "0ad813597db7cba934cb1ef53e60fb78980d6642668b6a06703b7a8f1e92a7e9"
  }
]
```

</details>

<details>
<summary>probe-backend-results.json</summary>

```json
[
  {
    "id": "D01-running-filter",
    "pass": true
  },
  {
    "id": "D02-spck-filter",
    "pass": true
  },
  {
    "id": "D03-all-includes-old",
    "pass": true
  },
  {
    "id": "D04-grace-override",
    "pass": true
  },
  {
    "id": "D05-grace-boundary",
    "pass": true
  },
  {
    "id": "D06-roster-active",
    "pass": true
  },
  {
    "id": "D07-roster-all",
    "pass": true
  },
  {
    "id": "D08-synthetic-regex",
    "pass": true
  },
  {
    "id": "R-session-comments/list",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "data"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-session-comments/fetch-classes",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-report-card",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-teaching-projects",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-spck/list",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes",
        "selectedClassId",
        "selectedSessionNumber",
        "stageInfo",
        "spckSessions",
        "students",
        "records",
        "quickTags",
        "demoSheetMeta"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-homework-grader/scores",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "data"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "G-running",
    "pass": true
  },
  {
    "id": "G-spck",
    "pass": true
  },
  {
    "id": "G-all",
    "pass": true
  },
  {
    "id": "V-{",
    "pass": true
  },
  {
    "id": "V-[]",
    "pass": true
  },
  {
    "id": "V-null",
    "pass": true
  },
  {
    "id": "V-1",
    "pass": true
  },
  {
    "id": "V-{\"scope\":\"bad\"}",
    "pass": true
  },
  {
    "id": "V-{\"classId\":\"A\",\"classCode\":\"B\"}",
    "pass": true
  },
  {
    "id": "V-cross-origin",
    "pass": true
  },
  {
    "id": "Q-single-task",
    "pass": true
  },
  {
    "id": "Q-selected-failure",
    "pass": true
  },
  {
    "id": "Q-spck-sync-failure-visible",
    "pass": false,
    "error": "SPCK sync failure was hidden: {\"status\":200,\"success\":true,\"synced\":[],\"attempts\":[[\"discover\",{\"persistToConfig\":true}],\"VT-C4K-EARLY\",\"VT-C4K-LATE\",\"VT-C4K-FRESH\",\"VT-C4K-EXPIRED\"]}\n\ntrue !== false\n"
  },
  {
    "id": "Q-stop-before",
    "pass": true
  },
  {
    "id": "Q-stop-discovery",
    "pass": true
  },
  {
    "id": "Q-stop-selected",
    "pass": true
  },
  {
    "id": "Q-stop-spck",
    "pass": true
  },
  {
    "id": "Q-live-discovery-excludes-old-cache",
    "pass": true,
    "detail": [
      "VT-C4K-DBNEW",
      "VT-C4K-EARLY",
      "VT-C4K-FRESH",
      "VT-C4K-LATE"
    ]
  }
]
```

</details>

<details>
<summary>probe-ui-results.json</summary>

```json
[
  {
    "id": "UI01-picker-normalize-restore",
    "pass": true
  },
  {
    "id": "UI02-picker-spck-filter",
    "pass": true
  },
  {
    "id": "UI-screen-session-restore-switch",
    "pass": true,
    "detail": [
      "/api/session-comments/list?classId=VT-C4K-BETA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-BETA&sessionId=VT-C4K-BETA_SESS_13",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=VT-C4K-BETA_SESS_13",
      "/api/session-comments/sync",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=VT-C4K-ALPHA_SESS_13"
    ]
  },
  {
    "id": "UI-screen-homework-restore-switch",
    "pass": true,
    "detail": [
      "/api/report-card?classId=VT-C4K-PTA12",
      "/api/report-card?classId=VT-C4K-BETA",
      "/api/homework-grader/scores?classId=VT-C4K-BETA",
      "/api/report-card?classId=VT-C4K-ALPHA",
      "/api/homework-grader/scores?classId=VT-C4K-ALPHA"
    ]
  },
  {
    "id": "UI-screen-final-restore-switch",
    "pass": true,
    "detail": [
      "/api/spck/list",
      "/api/spck/list?classId=VT-C4K-BETA",
      "/api/spck/list?classId=VT-C4K-BETA",
      "/api/spck/student-portal?classId=VT-C4K-BETA",
      "/api/spck/student-portal?classId=VT-C4K-BETA",
      "/api/spck/list?classId=VT-C4K-ALPHA",
      "/api/spck/student-portal?classId=VT-C4K-ALPHA",
      "/api/spck/student-portal?classId=VT-C4K-ALPHA"
    ]
  },
  {
    "id": "UI-screen-teaching-restore-switch",
    "pass": true,
    "detail": [
      "/api/teaching-projects",
      "/api/teaching-projects?classCode=VT-C4K-BETA&force=0",
      "/api/teaching-projects?classCode=VT-C4K-ALPHA&force=0"
    ]
  },
  {
    "id": "UI-final-ineligible-saved-fallback",
    "pass": true,
    "detail": {
      "saved": "VT-C4K-EARLY",
      "selected": "VT-C4K-ALPHA"
    }
  },
  {
    "id": "UI-homework-refresh-failure-visible",
    "pass": false,
    "error": "No error shown after /api/classes/refresh HTTP 500; teacher sees unchanged screen"
  },
  {
    "id": "UI-teaching-refresh-failure-visible",
    "pass": false,
    "error": "ClassPicker silently discards success:false/error after HTTP 500"
  },
  {
    "id": "UI-homework-empty-list-clears",
    "pass": false,
    "error": "Previous class B remains selectable after successful empty refresh: [\"VT-C4K-ALPHA\",\"VT-C4K-BETA\",\"__REFRESH_LMS__\",\"__MANUAL_INPUT__\"]"
  },
  {
    "id": "UI-session-empty-list-clears",
    "pass": false,
    "error": "Previous class B remains selectable after successful empty refresh: [\"VT-C4K-ALPHA\",\"VT-C4K-BETA\",\"__REFRESH_LMS__\",\"__MANUAL_INPUT__\"]"
  },
  {
    "id": "UI-picker-refresh-blocks-manual-commit",
    "pass": false,
    "error": "Manual commit changed class while refresh was busy\n+ actual - expected\n\n+ 'VT-C4K-BETA'\n- 'VT-C4K-ALPHA'\n          ^\n"
  },
  {
    "id": "UI-final-late-restore-must-not-overwrite-new-class",
    "pass": false,
    "error": "Stale saved-class B response replaced rows while selector remained A: {\"selected\":\"VT-C4K-ALPHA\",\"hasStudentA\":false,\"hasStudentB\":true,\"requests\":[{\"url\":\"/api/spck/student-portal?classId=VT-C4K-BETA\",\"method\":\"GET\"},{\"url\":\"/api/spck/student-portal?classId=VT-C4K-BETA\",\"method\":\"GET\"},{\"url\":\"/api/spck/student-portal?classId=VT-C4K-ALPHA\",\"method\":\"GET\"},{\"url\":\"/api/spck/student-portal?classId=VT-C4K-ALPHA\",\"method\":\"GET\"},{\"url\":\"/api/spck/student-portal?classId=VT-C4K-ALPHA\",\"method\":\"GET\"}]}\n\ntrue !== false\n"
  },
  {
    "id": "UI-errors",
    "pass": true
  }
]
```

</details>

<details>
<summary>runtime.cjs</summary>

```javascript

const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {root,a,w}=JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
process.chdir(w);process.env.NODE_PATH=path.join(root,'node_modules');Module._initPaths();
const rr=Module.createRequire(path.join(root,'package.json')),origResolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request.startsWith('@/'))request=path.join(w,'src',request.slice(2));try{return origResolve.call(this,request,parent,...rest)}catch(e){if(!request.startsWith('.')&&!path.isAbsolute(request)){return rr.resolve(request)}throw e}};
const swc=rr('@next/swc-win32-x64-msvc');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>{let src=fs.readFileSync(f,'utf8').replace(/import\.meta\.url/g,JSON.stringify(require('node:url').pathToFileURL(f).href));const out=swc.transformSync(src,false,Buffer.from(JSON.stringify({filename:f,jsc:{parser:{syntax:'typescript',tsx:f.endsWith('.tsx'),decorators:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));m._compile(out.code,f)};
const localhost=h=>!h||['localhost','127.0.0.1','::1','[::1]'].includes(h);
const originalFetch=globalThis.fetch;globalThis.fetch=async (u,o)=>{const url=new URL(typeof u==='string'?u:u.url||String(u));if(!localhost(url.hostname))throw Error('AUDIT_NETWORK_BLOCKED '+url.hostname);return originalFetch(u,o)};
for(const proto of ['node:http','node:https']){const mod=require(proto);for(const meth of ['request','get']){const orig=mod[meth];mod[meth]=function(u,...args){let host;if(typeof u==='string'||u instanceof URL)host=new URL(u).hostname;else host=u?.hostname||u?.host?.split(':')[0];if(!localhost(host))throw Error('AUDIT_NETWORK_BLOCKED '+host);return orig.call(this,u,...args)}}}
const pw=rr('playwright');for(const k of ['chromium','firefox','webkit'])for(const m of ['launch','launchPersistentContext']){const orig=pw[k][m].bind(pw[k]);pw[k][m]=(...args)=>{const pos=m==='launch'?0:1;args[pos]={...(args[pos]||{}),proxy:{server:'http://127.0.0.1:9',bypass:'<loopback>'}};return orig(...args)}};
const eb=rr('esbuild'),wrappedEsbuild={...eb};for(const m of ['build','buildSync'])wrappedEsbuild[m]=(opts)=>eb[m]({...opts,nodePaths:[path.join(root,'node_modules'),...(opts.nodePaths||[])]});
const originalLoad=Module._load;Module._load=function(name,...rest){return name==='esbuild'?wrappedEsbuild:originalLoad.call(this,name,...rest)};
const originalRm=fs.rmSync;fs.rmSync=function(p,o){return originalRm(p,o?.recursive?{maxRetries:10,retryDelay:100,...o}:o)};
if(process.argv[2])require(path.resolve(process.argv[2]));
```

</details>

<details>
<summary>adversarial.cjs</summary>

```javascript
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {a,w,root} = JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
require('./runtime.cjs');
const dbm = require(path.join(w,'src/lib/db/sqlite.ts'));
const directory = require(path.join(w,'src/lib/classes/class-directory.ts'));
const {ClassSyncer} = require(path.join(w,'src/lib/playwright/sync-class.ts'));
const {taskQueue} = require(path.join(w,'src/lib/queue/task-queue.ts'));
const refresh = require(path.join(w,'src/app/api/classes/refresh/route.ts'));
const results=[];
async function check(id, fn) {try{const detail=await fn();results.push({id,pass:true,detail});console.log('PASS '+id+' '+JSON.stringify(detail??''));}catch(e){results.push({id,pass:false,error:e.message});console.log('FAIL '+id+' '+e.message)}fs.writeFileSync(path.join(a,'probe-backend-results.json'),JSON.stringify(results,null,2));}
const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'};
const request=(url='/api/classes/refresh',body,extra={})=>new Request('http://127.0.0.1:3000'+url,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
const fmt=(ms)=>{const d=new Date(ms);return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`};
const day=86400000,now=Date.now(),d=dbm.getDb();
function seed(code,num,date=''){d.prepare('INSERT INTO classes_sessions(classId,className,sessionId,sessionNumber,topic,date) VALUES(?,?,?,?,?,?)').run(code,code,code+'_SESS_'+num,num,'Topic',date)}
const cache=[{classCode:'VT-C4K-EARLY',status:'Running'},{classCode:'VT-C4K-LATE',status:'Running'},{classCode:'VT-C4K-FRESH',status:'Finished',endDate:fmt(now-10*day)},{classCode:'VT-C4K-EXPIRED',status:'Finished',endDate:fmt(now-20*day)},{classCode:'AUDIT-HIDDEN',status:'Running'}];
fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,JSON.stringify(cache));
seed('VT-C4K-EARLY',8,fmt(now));seed('VT-C4K-LATE',13,fmt(now));seed('VT-C4K-FRESH',14,fmt(now-10*day));seed('VT-C4K-EXPIRED',14,fmt(now-20*day));seed('VT-C4K-DBOLD',14,fmt(now-20*day));seed('VT-C4K-DBNEW',12,fmt(now));seed('AUDIT-HIDDEN',13,fmt(now));
for(const c of ['TEST-HIDDEN','R12-HIDDEN','CLASS_HIDDEN','SYNTH-HIDDEN'])seed(c,13,fmt(now));
d.prepare('INSERT INTO students(studentId,classId,fullName,isActive) VALUES(?,?,?,?)').run('ACTIVE','VT-C4K-LATE','Student Active',1);d.prepare('INSERT INTO students(studentId,classId,fullName,isActive) VALUES(?,?,?,?)').run('INACTIVE','VT-C4K-LATE','Student Inactive',0);
const codes=(l)=>l.map(x=>typeof x==='string'?x:x.classCode||x.classId).sort();
const expected=['VT-C4K-EARLY','VT-C4K-LATE','VT-C4K-FRESH','VT-C4K-DBNEW'].sort();
const expectedSpck=expected.filter(x=>x!=='VT-C4K-EARLY');
async function main(){
await check('D01-running-filter',()=>assert.deepEqual(codes(directory.listClasses()),expected));
await check('D02-spck-filter',()=>assert.deepEqual(codes(directory.listClasses({scope:'spck'})),expectedSpck));
await check('D03-all-includes-old',()=>assert.deepEqual(codes(directory.listClasses({scope:'all'})),[...expected,'VT-C4K-EXPIRED','VT-C4K-DBOLD'].sort()));
await check('D04-grace-override',()=>assert(!codes(directory.listClasses({includeFinishedDays:5})).includes('VT-C4K-FRESH')));
await check('D05-grace-boundary',()=>{const s14=new Date(now);s14.setHours(23,59,59,999);const graceEnd=s14.getTime()-10*day+15*day;assert(codes(directory.listClasses({nowMs:graceEnd})).includes('VT-C4K-FRESH'));assert(!codes(directory.listClasses({nowMs:graceEnd+1})).includes('VT-C4K-FRESH'))});
await check('D06-roster-active',()=>assert.deepEqual(directory.listStudents(' vt-c4k-late ').map(s=>s.studentId),['ACTIVE']));
await check('D07-roster-all',()=>assert.equal(directory.listStudents('VT-C4K-LATE',{activeOnly:false}).length,2));
await check('D08-synthetic-regex',()=>{for(const c of ['test1',' AUDIT1 ','r2x','class_1','synth1',''])assert(directory.isSyntheticClassCode(c));assert(!directory.isSyntheticClassCode('VT-C4K-R2'));});
const routes=[['session-comments/list','data.runningClasses'],['session-comments/fetch-classes','classes'],['report-card','classes'],['teaching-projects','classes'],['spck/list','classes'],['homework-grader/scores','data.runningClasses']];
for(const [name,key] of routes)await check('R-'+name,async()=>{const m=require(path.join(w,'src/app/api',name,'route.ts')),r=await m.GET(request('/api/'+name));assert.equal(r.status,200);const j=await r.json(),l=key.split('.').reduce((v,k)=>v[k],j);assert.equal(j.success,true);assert.deepEqual(codes(l),name==='spck/list'?expectedSpck:expected);return {keys:Object.keys(j),codes:codes(l)};});
for(const scope of ['running','spck','all'])await check('G-'+scope,async()=>{const r=await refresh.GET(request('/api/classes/refresh?scope='+scope));assert.equal(r.status,200);const j=await r.json();assert.deepEqual(codes(j.classes),codes(directory.listClasses({scope})));});
for(const body of ['{','[]','null','1','{"scope":"bad"}','{"classId":"A","classCode":"B"}'])await check('V-'+body,async()=>assert.equal((await refresh.POST(request(undefined,body))).status,400));
await check('V-cross-origin',async()=>assert.equal((await refresh.POST(request(undefined,{}, {origin:'https://evil.example','sec-fetch-site':'cross-site'}))).status,403));
const origFetch=ClassSyncer.fetchRunningClasses,origSync=ClassSyncer.syncClass,origEnqueue=taskQueue.enqueue;
let trace=[],queued=0;
ClassSyncer.fetchRunningClasses=async opts=>{trace.push(['discover',opts]);return {success:true,classes:cache.filter(c=>!c.classCode.startsWith('AUDIT'))}};
ClassSyncer.syncClass=async code=>{trace.push(['sync',code]);return {success:true,classId:code,students:[],sessions:[]}};
taskQueue.enqueue=function(t){queued++;assert.equal(t.jobType,'SYNC_CLASS');return origEnqueue.call(this,t)};
await check('Q-single-task',async()=>{trace=[];queued=0;const r=await refresh.POST(request(undefined,{scope:'running',classCode:' vt-c4k-late '}));assert.equal(r.status,200);assert.equal(queued,1);assert.deepEqual(trace,[['discover',{persistToConfig:true}],['sync','VT-C4K-LATE']]);});
await check('Q-selected-failure',async()=>{ClassSyncer.syncClass=async()=>({success:false,error:'selected sync failure'});const r=await refresh.POST(request(undefined,{classCode:'VT-C4K-LATE'}));assert.equal(r.status,500);assert.equal((await r.json()).success,false)});
await check('Q-spck-sync-failure-visible',async()=>{trace=[];ClassSyncer.syncClass=async c=>{trace.push(c);return {success:false,error:'fixture upstream HTTP 503'}};const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true}));const j=await r.json();const observation={status:r.status,success:j.success,synced:j.syncedClassCodes,attempts:trace,error:j.error};fs.writeFileSync(path.join(a,'spck-failed-sync.json'),JSON.stringify(observation,null,2));assert.equal(j.success,false,'SPCK sync failure was hidden: '+JSON.stringify(observation));});
for(const point of ['before','discovery','selected','spck'])await check('Q-stop-'+point,async()=>{taskQueue.resumeQueue();let syncCalls=0;ClassSyncer.fetchRunningClasses=async()=>{if(point==='discovery')taskQueue.stopQueue();return {success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]}};ClassSyncer.syncClass=async()=>{syncCalls++;taskQueue.stopQueue();return {success:true}};if(point==='before')taskQueue.stopQueue();const r=await refresh.POST(request(undefined,{scope:point==='spck'?'spck':'running',...(point==='selected'?{classCode:'VT-C4K-LATE'}:{})}));assert.equal(r.status,499);if(point==='before'||point==='discovery')assert.equal(syncCalls,0);taskQueue.resumeQueue()});
await check('Q-live-discovery-excludes-old-cache',async()=>{ClassSyncer.fetchRunningClasses=async()=>{fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,JSON.stringify([{classCode:'VT-C4K-LATE',status:'Running'}]));return {success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]}};const r=await refresh.POST(request(undefined,{scope:'running'}));assert.equal(r.status,200);return codes((await r.json()).classes)});
ClassSyncer.fetchRunningClasses=origFetch;ClassSyncer.syncClass=origSync;taskQueue.enqueue=origEnqueue;dbm.closeDb();
console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));process.exitCode=results.some(x=>!x.pass)?1:0;
}
main().catch(e=>{console.error(e);dbm.closeDb();process.exitCode=2});
```

</details>

<details>
<summary>ui-entry.tsx</summary>

```tsx
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ClassPicker} from './snapshot/src/components/class-picker';
import Session from './snapshot/src/app/session-comments/page';
import Homework from './snapshot/src/app/homework-grader/page';
import Final from './snapshot/src/app/final-project/page';
import Teaching from './snapshot/src/app/teaching-projects/page';
const root=createRoot(document.getElementById('root')!);
const pages:any={session:Session,homework:Homework,final:Final,teaching:Teaching};
function PickerHarness(){const [value,setValue]=useState((window as any).pickerInitial||'');return <ClassPicker {...(window as any).pickerProps} value={value} onChange={c=>{(window as any).changes.push(c);setValue(c)}}/>}
(window as any).mount=(name:string)=>{root.render(React.createElement(name==='picker'?PickerHarness:pages[name],{key:Date.now()+Math.random()}));};
(window as any).ready=true;
```

</details>

<details>
<summary>ui-probe.cjs</summary>

```javascript
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {a,w,root}=JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
const rr=Module.createRequire(path.join(root,'package.json'));
require('./runtime.cjs');
const eb=rr('esbuild');
eb.buildSync({entryPoints:[path.join(a,'ui-entry.tsx')],outfile:path.join(a,'ui-bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],alias:{'@':path.join(w,'src')},define:{'process.env.NODE_ENV':'"production"'}});
const {chromium}=rr('playwright');
const results=[];async function check(id,fn){try{const v=await fn();results.push({id,pass:true,detail:v});console.log('PASS '+id+' '+JSON.stringify(v??''))}catch(e){results.push({id,pass:false,error:e.message});console.log('FAIL '+id+' '+e.message)}fs.writeFileSync(path.join(a,'probe-ui-results.json'),JSON.stringify(results,null,2));}
const A='VT-C4K-ALPHA',B='VT-C4K-BETA',EARLY='VT-C4K-EARLY';
async function main(){const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
async function prepare(saved='',mode='normal'){await page.goto('http://127.0.0.1:43127');await page.evaluate(({saved,mode,A,B,EARLY})=>{
localStorage.clear();if(saved)localStorage.setItem('mindx_last_class_code',saved);(window).requests=[];(window).changes=[];(window).refreshMode=mode;(window).hold=false;(window).releaseHold=null;
const classes=[{classId:A,classCode:A,className:A,status:'Running',currentSessionNumber:13},{classId:B,classCode:B,className:B,status:'Running',currentSessionNumber:13}];
(window).fetch=async(url,options={})=>{const u=new URL(String(url),location.origin);const method=options.method||'GET';(window).requests.push({url:u.pathname+u.search,method,body:options.body});
if((window).hold&&(u.pathname==='/api/classes/refresh'||u.pathname==='/api/homework-grader/scores'&&method==='POST'))await new Promise(resolve=>{(window).releaseHold=resolve});
const code=u.searchParams.get('classId')||u.searchParams.get('classCode')||A;let payload={success:true};let status=200;
if(u.pathname==='/api/classes/refresh'){if((window).refreshMode==='fail'){payload={success:false,error:'AUDIT LMS UNAVAILABLE',classes:[],runningClasses:[],spckClasses:[],allClasses:[]};status=500}else{const list=(window).refreshMode==='empty'?[]:[...classes,{classId:'VT-C4K-NEW',classCode:'VT-C4K-NEW',currentSessionNumber:13}];payload={success:true,classes:list,runningClasses:list,spckClasses:list,allClasses:list}}}
else if(u.pathname==='/api/session-comments/list')payload={success:true,data:{classId:code,resolvedClassId:code,sessions:[{sessionId:code+'_SESS_13',sessionNumber:13,date:'30/10/2026',topic:'Lesson'}],students:[],feedbacks:[],quickTags:[],syllabusList:[],runningClasses:classes}};
else if(u.pathname==='/api/session-comments/sync')payload={success:true,classId:JSON.parse(options.body||'{}').classCode,sessions:[],students:[]};
else if(u.pathname==='/api/homework-grader/scores')payload={success:true,data:{matrix:null,updatedAt:null,sessions:[],students:[],rubrics:[],runningClasses:classes.map(c=>c.classCode)}};
else if(u.pathname==='/api/report-card')payload={success:true,classId:code,classCode:code,classes,record:null,snapshot:null,overrides:{},reportCard:null};
else if(u.pathname==='/api/spck/list')payload={success:true,classes,selectedClassId:code,selectedSessionNumber:13,students:[],records:[],quickTags:[],demoSheetMeta:null};
else if(u.pathname==='/api/teaching-projects')payload=u.searchParams.has('classCode')?{success:true,classes,record:{classId:code,projectName:code,tasksJson:'[]',studentsJson:'[]',progressJson:'{}',status:'DRAFT',draftVersion:1},tasks:[],students:[],progress:{}}:{success:true,classes};
else if(u.pathname==='/api/spck/session14-eval')payload={success:true,evaluations:[]};
return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}})};
},{saved,mode,A,B,EARLY});await page.addScriptTag({path:path.join(a,'ui-bundle.js')});await page.waitForFunction(()=>window.ready);}
async function mount(name){await page.evaluate(name=>window.mount(name),name);await page.waitForTimeout(180);}
async function pickSelect(){return page.locator('select').filter({has:page.locator('option[value="__REFRESH_LMS__"]')}).first();}
await check('UI01-picker-normalize-restore',async()=>{await prepare(B);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A.toLowerCase(),A,B],scope:'running'}},{A,B});await mount('picker');assert.equal(await (await pickSelect()).inputValue(),B);assert.equal(await page.locator('option[value="'+A+'"]').count(),1);await (await pickSelect()).selectOption(A);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);});
await check('UI02-picker-spck-filter',async()=>{await prepare(EARLY);await page.evaluate(({A,EARLY})=>{window.pickerInitial='';window.pickerProps={classes:[{classId:EARLY,currentSessionNumber:8},{classId:A,currentSessionNumber:13}],scope:'spck',allowManualInput:false}},{A,EARLY});await mount('picker');assert.equal(await page.locator('option[value="'+EARLY+'"]').count(),0);assert.equal(await page.getByTitle('Gõ mã lớp thủ công').count(),0);});
for(const name of ['session','homework','final','teaching'])await check('UI-screen-'+name+'-restore-switch',async()=>{await prepare(B);await mount(name);const select=await pickSelect();await page.waitForFunction(B=>Array.from(document.querySelectorAll('select')).some(s=>s.value===B),B);assert.equal(await select.inputValue(),B);await select.selectOption(A);await page.waitForTimeout(220);assert.equal(await select.inputValue(),A);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);return await page.evaluate(()=>window.requests.map(x=>x.url));});
await check('UI-final-ineligible-saved-fallback',async()=>{await prepare(EARLY);await mount('final');assert.equal(await (await pickSelect()).inputValue(),A);assert.equal(await page.locator('option[value="'+EARLY+'"]').count(),0);return {saved:await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),selected:await (await pickSelect()).inputValue()};});
await check('UI-homework-refresh-failure-visible',async()=>{await prepare(A,'fail');await mount('homework');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const text=await page.locator('body').innerText();assert(text.includes('AUDIT LMS UNAVAILABLE'),'No error shown after /api/classes/refresh HTTP 500; teacher sees unchanged screen');});
await check('UI-teaching-refresh-failure-visible',async()=>{await prepare(A,'fail');await mount('teaching');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const text=await page.locator('body').innerText();assert(text.includes('AUDIT LMS UNAVAILABLE'),'ClassPicker silently discards success:false/error after HTTP 500');});
await check('UI-homework-empty-list-clears',async()=>{await prepare(A,'empty');await mount('homework');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const vals=await (await pickSelect()).locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert(!vals.includes(B),'Previous class B remains selectable after successful empty refresh: '+JSON.stringify(vals));});
await check('UI-session-empty-list-clears',async()=>{await prepare(A,'empty');await mount('session');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const vals=await (await pickSelect()).locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert(!vals.includes(B),'Previous class B remains selectable after successful empty refresh: '+JSON.stringify(vals));});
await check('UI-picker-refresh-blocks-manual-commit',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running'};window.hold=true},{A,B});await mount('picker');await page.getByTitle('Gõ mã lớp thủ công').click();await page.locator('input').fill(B);await page.getByRole('button',{name:'Quét lại từ LMS'}).click();await page.waitForFunction(()=>window.releaseHold!==null);await page.locator('input').press('Enter');assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A,'Manual commit changed class while refresh was busy');});
await check('UI-final-late-restore-must-not-overwrite-new-class',async()=>{
await prepare(B);
await page.evaluate(({A,B})=>{
const original=window.fetch;window.heldB=[];
window.fetch=async(url,opts)=>{const u=new URL(String(url),location.origin);if(u.pathname!=='/api/spck/list'||opts?.method==='POST')return original(url,opts);
const code=u.searchParams.get('classId')||A;
if(code===B)await new Promise(resolve=>window.heldB.push(resolve));
const id=code===B?'STUDENT_B':'STUDENT_A';
return new Response(JSON.stringify({success:true,classes:[{classId:A,classCode:A,currentSessionNumber:13},{classId:B,classCode:B,currentSessionNumber:13}],selectedClassId:code,selectedSessionNumber:13,students:[{studentId:id,fullName:id,classId:code}],records:[{classId:code,studentId:id,localFolderPath:'C:/fixture/'+id,projectTitle:'PROJECT_'+id,isConfirmedByTeacher:1,status:'DRAFT',activeSessionNumber:13}],quickTags:[]}));};
},{A,B});
await mount('final');
await page.waitForFunction(()=>window.heldB.length===2);
await page.evaluate(()=>window.heldB[0]());
const select=await pickSelect();await page.waitForFunction(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>s.querySelector('option[value="__REFRESH_LMS__"]'));return s&&!s.disabled});
await select.selectOption(A);await page.waitForTimeout(200);
assert((await page.locator('body').innerText()).includes('STUDENT_A'));
await page.evaluate(()=>window.heldB[1]());await page.waitForTimeout(200);
const observation={selected:await select.inputValue(),hasStudentA:(await page.locator('body').innerText()).includes('STUDENT_A'),hasStudentB:(await page.locator('body').innerText()).includes('STUDENT_B'),requests:await page.evaluate(()=>window.requests)};
fs.writeFileSync(path.join(a,'final-restore-race.json'),JSON.stringify(observation,null,2));
assert.equal(observation.selected,A);assert.equal(observation.hasStudentB,false,'Stale saved-class B response replaced rows while selector remained A: '+JSON.stringify(observation));
});
await check('UI-errors',()=>assert.deepEqual(errors,[]));
await browser.close();console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));process.exitCode=results.some(x=>!x.pass)?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=2});
```

</details>
