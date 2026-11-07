# CODEX DASHBOARD TRACKING AUDIT — Round 5 (Final SHA-256 Baseline Re-verification)

**VERDICT: GO**

- Ngày kiểm định: **07/11/2026**, múi giờ **Asia/Saigon**.
- **Closure Matrix: F01 CLOSED; F02 CLOSED; F03 CLOSED; F04 CLOSED; F05 CLOSED — 5/5 CLOSED.**
- **4/4 Gates PASS, 628/628 Probes PASS, 0 FAIL, 0 ERROR.** Kế thừa bằng chứng Round 4 trên bản mã bất biến; Round 5 chạy mới **P6: 3/3 PASS** và **G1: PASS**, **2/2 lệnh exit 0**. Ba ca P6 đã nằm trong tổng 628, không cộng lặp.
- **SHA-256 dữ liệu thật bảo toàn 100%: 2/2 tệp khớp mốc Owner mới trước và sau kiểm định.**
- **6/6 tệp trong phạm vi khớp từng byte giữa repo gốc, TEMP và Round 4; giữ nguyên trước/sau.** Toàn bộ danh mục **158/158 mục nguồn/cấu hình repo gốc** và **164/164 mục nguồn/cấu hình/probe TEMP** cũng giữ nguyên so với Round 4.

## R5.1. Mốc dữ liệu mới và phạm vi kết luận

Owner xác nhận đã quét danh sách lớp trên ứng dụng thật lúc **10:18:25 ngày 07/11/2026** (`2026-11-07T03:18:25.761Z`), cập nhật dữ liệu thật và cung cấp lại mốc SHA-256. Đọc trực tiếp JSON hiện tại xác nhận **10 lớp, tất cả Running**, cùng thời điểm cập nhật trên; **không còn VT-JSB15 và VT-C4K-PTA12**. Lượt này không mở DB thật bằng SQLite để đọc `job_logs`; thông tin thao tác thật và `job_logs` là bối cảnh do Owner xác nhận.

Round 4 đã đóng F01–F05 và đạt mọi kiểm tra mã, nhưng kết luận NO-GO do dữ liệu thay đổi trong lúc ứng dụng thật được sử dụng. **Giữ nguyên kết luận lịch sử đó.** Round 5 xác minh mốc dữ liệu mới do Owner cung cấp và dùng kết quả kỹ thuật Round 4 sau khi kiểm chứng mã cùng bằng chứng không đổi.

`AUDIT_TEMP = C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770`  
`RUN_REPO = AUDIT_TEMP\run-repo`  
`R4 = AUDIT_TEMP\round4`  
`R5 = AUDIT_TEMP\round5`

Bản mã thuộc working tree trên HEAD `ffc3cfb9c75861cd40ce2e34ddf721be7575c51c`, còn sáu tệp sửa sẵn chưa commit. Kết luận ràng buộc với SHA-256 của từng tệp, không gán cho riêng nội dung đã commit tại HEAD.

## R5.2. Đối chiếu bản mã và bằng chứng Round 4

| Tệp | SHA-256 Round 4 = gốc trước/sau = TEMP trước/sau |
|---|---|
| `src/lib/playwright/sync-class.ts` | `17dad3786e02e833c90b89642efc4326ef4dfc439a8a0c627f68d8744abd3fe6` |
| `src/lib/classes/class-directory.ts` | `b82ab0931928912a9b2a3b34cc0cebd86d6486b693346cb068f1aba65ff8d335` |
| `src/lib/dashboard/today-tasks.ts` | `1aff56270a84e0ee21728a501e4bcc7b95d35b955217f8a9aaa7a798795a69ca` |
| `src/app/api/dashboard/scan-weekly-tasks/route.ts` | `bda0e62c45cae255aeaa1c987d2ee1db5569fc83d44173b4889a4bba15d55477` |
| `src/app/api/spck/list/route.ts` | `d0467019e9d6d747cefe581e7380450c2781a0183051971829a52e0b641c13cf` |
| `scripts/test-streamline-v340-s6.ts` | `1df6dd68eaa3d7252d85acbc36de9ebc1ae8d088f820db3d028d1cc7191d8bd5` |

Đã đọc lại `R4\execution-results.json`, đối chiếu **10/10 lệnh exit 0**, đủ sáu tệp kết quả P1–P6 và **628/628 bản ghi `ok:true`**. Closure Matrix trong `R4\final-preservation-and-verdict.json` xác nhận **F01–F05 CLOSED**. **20/20 tệp bằng chứng Round 4** được ghi SHA-256 và giữ nguyên sau lượt chạy. Chi tiết: `R5\round4-evidence-verification.json`.

## R5.3. Kết quả tổng hợp và lượt chạy mới

| Cổng / Probe | Kết quả hiện hành | Nguồn bằng chứng |
|---|---|---|
| G1 — `npx tsc --noEmit --incremental false` | **PASS**, exit 0 | Chạy mới Round 5; `R5\G1.log` |
| G2 — `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, exit 0 | Round 4 bất biến; `R4\G2.log` |
| G3 — `npx tsx scripts/test-streamline-v340-s2.ts` | **PASS**, exit 0 | Round 4 bất biến; `R4\G3.log` |
| G4 — `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS**, exit 0 | Round 4 bất biến; `R4\G4.log` |
| P1 — `probe-independent.ts` | **590/590 PASS** | Round 4 bất biến; `R4\P1-results.json` |
| P2 — `probe-fetch.ts` | **12/12 PASS** | Round 4 bất biến; `R4\P2-results.json` |
| P3 — `probe-connected.ts` | **17/17 PASS** | Round 4 bất biến; `R4\P3-results.json` |
| P4 — `probe-round2-empty-allowset.ts` | **4/4 PASS** | Round 4 bất biến; `R4\P4-results.json` |
| P5 — `probe-round2-readiness.ts` | **2/2 PASS** | Round 4 bất biến; `R4\P5-results.json` |
| P6 — `npx tsx probe-round3-readiness.ts` | **3/3 PASS**, exit 0 | Chạy mới Round 5; `R5\P6.log`, `P6-results.json` |
| **Tổng** | **4/4 Gates, 628/628 Probes PASS; 0 FAIL, 0 ERROR** | **G1/P6 chạy mới; các bộ còn lại kế thừa có đối chiếu SHA-256** |

Lượt chạy mới tại RUN_REPO từ **10:27:23 đến 10:27:59 ngày 07/11/2026 (Asia/Saigon)**. Cả hai tiến trình được đặt `ALLOWED_LOCAL_DIRS=C:\Users\QQ\AppData\Local\Temp`, `MINDX_DB_PATH=R5\gates-default.db`, `MINDX_RUNNING_CLASSES_PATH=R5\gates-running.json`, `npm_config_offline=true`. Probe P6 nguyên trạng tự thu hẹp allowlist về AUDIT_TEMP, dùng DB/JSON giả trong `round3`; kết quả cũ được sao lưu tại `R5\prior-P6-results.json` và khôi phục nguyên byte sau khi lưu kết quả mới vào R5. Không sửa probe, không cài thư viện.

Ba ca P6 xác nhận: trang báo lỗi dù còn ô tìm kiếm thì giữ cache; trang báo lỗi dù còn khung bảng thì giữ cache; bảng rỗng hợp lệ thì trả thành công và lưu danh sách rỗng. Cả ba kết quả thực tế khớp mong đợi.

## R5.4. SHA-256 dữ liệu thật trước/sau

Đọc nguyên byte bằng **Node `fs.readFileSync`**, tính **`crypto.createHash('sha256')`**; chỉ đọc tệp gốc, không dùng SQLite để mở DB thật. Ghi mốc trước lúc **10:27:22**, sau hai lệnh lúc **10:27:59 ngày 07/11/2026 (Asia/Saigon)**, rồi đo lại khi hoàn tất báo cáo.

| Tệp tại repo gốc | SHA-256 Owner mới = trước = sau | Kết luận |
|---|---|---|
| `data/mindx_bot.db` | `b61f1a2aa3ebeb7a55e8fc3994983694116eafbaa750125e2ca9d8bfc624edd4` | **Khớp 100%** |
| `data/running_classes.json` | `50a365658aa1914de854851befd72824a26544315053a238babd17aa84a02520` | **Khớp 100%** |

Bằng chứng: `R5\before.json`, `after.json`, `execution-results.json`, `summary.json`, `final-preservation-and-verdict.json`; dấu vết thực thi tại `AUDIT_TEMP\run-round5.cjs`. Bản báo cáo trước chỉnh sửa được lưu nguyên byte ở `R5\report-before.md`.

**Chỉ cập nhật đầu báo cáo này trong repo gốc; giữ nguyên byte của toàn bộ lịch sử Round 4 trở về trước.** Không thay mã ứng dụng, kiểm thử, cấu hình hoặc dữ liệu thật; không gom sáu thay đổi có sẵn vào commit/push. Đây là lượt kiểm định và cập nhật báo cáo, không triển khai tính năng.

**Chưa kiểm tra:** không chạy mới trên LMS/Teaching/Drive/Gemini thật, không kiểm định lại bằng thao tác lớp thật, không tạo bản build phát hành. Thao tác quét thật do Owner thực hiện và xác nhận; các ca P6 là kiểm tra cục bộ với trang/dữ liệu giả trong TEMP.

**Kết luận cuối Round 5: VERDICT: GO — F01–F05: 5/5 CLOSED; 4/4 Gates PASS; 628/628 Probes PASS; SHA-256 hai tệp dữ liệu thật bảo toàn 100% theo mốc Owner mới.**

---

## Lịch sử kiểm định Round 4 — giữ nguyên byte

Phần dưới là hồ sơ lịch sử tại thời điểm Round 4; kết luận hiện hành là **Round 5: GO** ở đầu báo cáo.


# CODEX DASHBOARD TRACKING AUDIT — Round 4 (Final Closure of F05)

**VERDICT: NO-GO**

- Ngày kiểm định: **07/11/2026**, múi giờ **Asia/Saigon**.
- **Closure Matrix: F01 CLOSED; F02 CLOSED; F03 CLOSED; F04 CLOSED; F05 CLOSED — 5/5 CLOSED.**
- Chạy mới **4/4 Gates PASS**, **628/628 ca trong 6 bộ probe độc lập PASS**, **0 FAIL, 0 ERROR**; **10/10 lệnh exit 0**.
- Bốn ca hành vi **F05-R3-1..4 PASS trong G2**. Bộ probe readiness Round 3 từng có 2 ca FAIL nay đạt **3/3 PASS** trên đúng bản sửa cuối.
- **Chưa đạt điều kiện bảo toàn dữ liệu: 2/2 tệp khớp SHA-256 Owner ở đầu lượt, nhưng 0/2 khớp ở cuối lượt. Vì vậy chưa thể chốt GO tổng thể dù F01–F05 đã CLOSED.** Sáu tệp trong phạm vi và sáu probe được cung cấp giữ nguyên nội dung.
- Phiên kiểm định trực tiếp đọc mã và chạy lại các lệnh; **không tạo probe mới, không gọi thêm `codex exec` hoặc reviewer lồng bên trong**.

## R4.1. Bản mã, môi trường và bằng chứng

Đã đọc `PROJECT_STATE.md`, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` và quy tắc dự án; rà bản sửa F05, bốn ca hành vi mới, sáu tệp trong phạm vi cùng các nơi gọi liên quan. Kết quả thuộc **working tree có 6 tệp sửa chưa commit** trên HEAD `ffc3cfb9c75861cd40ce2e34ddf721be7575c51c`; kết luận ràng buộc với các SHA-256 bên dưới, không phải riêng mã đã commit tại HEAD.

`AUDIT_TEMP = C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770`  
`RUN_REPO = AUDIT_TEMP\run-repo`  
`R4 = AUDIT_TEMP\round4`

**6/6 tệp gốc khớp từng byte với bản TEMP được cung cấp, giữ nguyên trước và sau kiểm định:**

| Tệp | SHA-256 của bản gốc và bản TEMP |
|---|---|
| `src/lib/playwright/sync-class.ts` | `17dad3786e02e833c90b89642efc4326ef4dfc439a8a0c627f68d8744abd3fe6` |
| `src/lib/classes/class-directory.ts` | `b82ab0931928912a9b2a3b34cc0cebd86d6486b693346cb068f1aba65ff8d335` |
| `src/lib/dashboard/today-tasks.ts` | `1aff56270a84e0ee21728a501e4bcc7b95d35b955217f8a9aaa7a798795a69ca` |
| `src/app/api/dashboard/scan-weekly-tasks/route.ts` | `bda0e62c45cae255aeaa1c987d2ee1db5569fc83d44173b4889a4bba15d55477` |
| `src/app/api/spck/list/route.ts` | `d0467019e9d6d747cefe581e7380450c2781a0183051971829a52e0b641c13cf` |
| `scripts/test-streamline-v340-s6.ts` | `1df6dd68eaa3d7252d85acbc36de9ebc1ae8d088f820db3d028d1cc7191d8bd5` |

Đối chiếu **157 mục nguồn/cấu hình chạy chương trình: 133 khớp từng byte, 24 chỉ khác xuống dòng/BOM và khớp nội dung sau chuẩn hóa**. Riêng `AGENTS.md` trong TEMP còn mô tả reviewer cũ; đây là tài liệu hướng dẫn, không phải khác biệt mã chạy. Phiên này tuân thủ quy tắc repo gốc và chỉ thị Round 4 của Owner. Không đồng bộ hay sửa thêm tệp nào. Bằng chứng: `R4\baseline.json`, `dependency-source-comparison.json`, `review-notes.json`.

Mười lệnh chạy tuần tự tại RUN_REPO, từ **07/11/2026, 10:15:27 đến 07/11/2026, 10:18:42 (Asia/Saigon)**. Mỗi tiến trình được đặt `ALLOWED_LOCAL_DIRS=C:\Users\QQ\AppData\Local\Temp`, `MINDX_DB_PATH=R4\gates-default.db`, `MINDX_RUNNING_CLASSES_PATH=R4\gates-running.json`, `npm_config_offline=true`. Một số script/probe nguyên trạng tự thu hẹp allowlist và dùng DB/JSON giả riêng dưới TEMP. Không cài/cập nhật thư viện; `node_modules` dùng junction sẵn có. Nhật ký và kết quả máy đọc được nằm tại `R4\G1.log`…`G4.log`, `P1.log`…`P6.log`, `P1-results.json`…`P6-results.json`, `execution-results.json`, `summary.json`.

Các probe nguyên trạng vẫn ghi kết quả vào đường dẫn cũ ở AUDIT_TEMP/round2/round3. Đã sao lưu sáu tệp kết quả có sẵn tại `R4\prior-results` trước lượt chạy và giữ riêng kết quả mới trong R4. Báo cáo Round 3 trước chỉnh sửa được lưu nguyên byte tại `R4\report-round3.md`; phần lịch sử ở dưới được bảo toàn nguyên văn.

## R4.2. Closure Matrix — F01–F05: 5/5 CLOSED

| Phát hiện | Kết luận | Bằng chứng kiểm định hiện tại |
|---|---|---|
| **F01** — nhầm bằng chứng Buổi 12 sang Buổi 13 | **CLOSED** | `today-tasks.ts:518–570` chỉ nhận bằng chứng đúng buổi khi lịch sử đã xác định buổi; G2 và các ca `SPCK-*-legacy-other-session-only` trong P1 PASS. |
| **F02** — che lỗi nộp lại sau sửa nháp/lịch sử FAILED | **CLOSED** | `today-tasks.ts:526–565` ưu tiên trạng thái FAILED của đúng buổi/lần nộp; P3 chạy đường lưu nháp SQLite thật trên DB giả, P1 chạy lịch sử FAILED; đều PASS. Nháp sửa bình thường sau lần VERIFIED vẫn được tính hoàn thành. |
| **F03** — nhận nhầm lớp kế tiếp chưa Running | **CLOSED** | Tập lớp kế tiếp dùng `isConfirmedRunningStatus`; P1 đạt **464/464** ca ghép mã kế tiếp, các ca FINISHED/Cancelled/Planning/trống không làm ẩn lớp cũ; G2/P2 PASS. |
| **F04** — cửa sổ Trang chủ 7 ngày ảnh hưởng SPCK 15 ngày | **CLOSED** | `spck/list/route.ts:362–365` truyền thời hạn 15 ngày; P3 xác nhận lớp ngày 10 còn chọn được ở SPCK sau quét và vẫn ẩn trên Trang chủ. |
| **F05** — phân biệt rỗng hợp lệ với lỗi tải, không phục hồi lớp cũ | **CLOSED** | Nhánh readiness kiểm tra lỗi API, lỗi tải/đang tải và thông báo rỗng rõ ràng; G2 đạt **F05-R3-1..4**; P4/P5/P6 đạt **4/4 + 2/2 + 3/3**. P2/P3 xác nhận kết quả thành công rỗng không phục hồi lớp hết hạn, không quét lại lớp đó. |

## R4.3. Bốn cổng bắt buộc — 4/4 PASS

| Cổng | Lệnh đã chạy | Kết quả | Nhật ký |
|---|---|---|---|
| G1 | `npx tsc --noEmit --incremental false` | **PASS**, exit 0 | `R4\G1.log` |
| G2 | `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, exit 0 | `R4\G2.log` |
| G3 | `npx tsx scripts/test-streamline-v340-s2.ts` | **PASS**, exit 0 | `R4\G3.log` |
| G4 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS**, exit 0 | `R4\G4.log` |

G2 chạy trọn S6-T1…T4, gồm các assertion F05-R3-1..4 trước thông báo PASS cuối; G3 đạt bộ hồi quy S2; G4 đạt T280-01…T280-05. Đây là kết quả chạy mới của Round 4.

## R4.4. Sáu bộ probe độc lập — 628/628 PASS

| Probe | Lệnh đã chạy | PASS / tổng | FAIL | ERROR | Exit | Nhật ký |
|---|---|---:|---:|---:|---:|---|
| P1 | `npx tsx probe-independent.ts` | **590/590** | 0 | 0 | 0 | `R4\P1.log` |
| P2 | `npx tsx probe-fetch.ts` | **12/12** | 0 | 0 | 0 | `R4\P2.log` |
| P3 | `npx tsx probe-connected.ts` | **17/17** | 0 | 0 | 0 | `R4\P3.log` |
| P4 | `npx tsx probe-round2-empty-allowset.ts` | **4/4** | 0 | 0 | 0 | `R4\P4.log` |
| P5 | `npx tsx probe-round2-readiness.ts` | **2/2** | 0 | 0 | 0 | `R4\P5.log` |
| P6 | `npx tsx probe-round3-readiness.ts` | **3/3** | 0 | 0 | 0 | `R4\P6.log` |
| **Tổng** | **6 bộ probe nguyên trạng** | **628/628** | **0** | **0** | **6/6 exit 0** | |

P1 gồm SPCK **81/81**, ghép mã kế tiếp **464/464**, mốc ngày **14/14**, danh sách lớp **27/27**, route Trang chủ **4/4**. Bốn ca F05 mới thuộc G2, không cộng lặp vào tổng 628 probe.

## R4.5. Đóng F05 — xác nhận hành vi sau bản sửa

Trong [sync-class.ts](../../../src/lib/playwright/sync-class.ts#L1474), listener theo dõi lỗi HTTP/GraphQL được gắn trước khi đọc danh sách và gỡ trong `finally`. Khi không đọc được dòng lớp nào, [nhánh readiness](../../../src/lib/playwright/sync-class.ts#L1823) yêu cầu bảng có thông báo rỗng rõ ràng, không có dấu hiệu lỗi tải hoặc đang tải. Lỗi đi vào `catch`, trả `success:false` và giữ danh sách đã lưu; kết quả thành công rỗng đi tới nhánh lưu `[]` theo `persistToConfig`.

| Ca hành vi trong G2 | Kết quả quan sát | Kết luận |
|---|---|---|
| **F05-R3-1** — còn ô tìm kiếm, trang báo lỗi tải | `success:false`, cache giữ nguyên lớp VT-JSB87 | **PASS** |
| **F05-R3-2** — còn khung bảng rỗng, trang báo lỗi tải | `success:false`, cache giữ nguyên | **PASS** |
| **F05-R3-3** — bảng “No classes”, API danh sách trả HTTP 500 | `success:false`, cache giữ nguyên | **PASS** |
| **F05-R3-4** — bảng “No classes” hợp lệ, không có lỗi | `success:true`, `classes:[]`, cache `[]` | **PASS** |

Các ca nằm tại [test-streamline-v340-s6.ts:1375](../../../scripts/test-streamline-v340-s6.ts#L1375), gọi **hàm ClassSyncer thật** trên trang giả lập, thay bước lấy trang/đăng nhập và dùng dữ liệu dưới TEMP. **Hai phản ví dụ từng FAIL ở Round 3 nay PASS trong P6**, cùng đối chứng rỗng hợp lệ; kết quả chi tiết tại `R4\P6-results.json`. P4 tiếp tục xác nhận tập mã được phép rỗng không phục hồi cache và POST SPCK báo lỗi khi fetch thất bại. Không còn mục mở F01–F05 trong phạm vi bằng chứng của lượt kiểm định này.

## R4.6. SHA-256 dữ liệu thật và ranh giới kết luận

Đọc hai tệp gốc bằng **Node `fs.readFileSync`**, tính `crypto.createHash('sha256')` trên nguyên byte trước và sau toàn bộ lệnh. Không mở DB thật qua SQLite.

| Tệp tại repo gốc | SHA-256 Owner cung cấp và khớp đầu lượt | SHA-256 cuối lượt | Trước / Sau |
|---|---|---|---|
| `data/mindx_bot.db` | `98496269153d8a192d305c73050dfd69016f42735381a482b93c12107944ac40` | `b61f1a2aa3ebeb7a55e8fc3994983694116eafbaa750125e2ca9d8bfc624edd4` | **Khớp / KHÔNG KHỚP** |
| `data/running_classes.json` | `63a3f2e5a756aa4a2930dd5c28577888e6112b0927160dc1befef80183ea286f` | `50a365658aa1914de854851befd72824a26544315053a238babd17aa84a02520` | **Khớp / KHÔNG KHỚP** |

**Điều kiện chưa đạt — dữ liệu thật đã thay đổi:** Hai tệp có LastWriteTimeUtc cùng khoảng **2026-11-07 03:18:25 UTC (10:18:25 Asia/Saigon)**, trong thời gian P6 đang chạy (10:18:08–10:18:42). Máy có server thật đang nghe tại `127.0.0.1:3000`, PID **6148**, đã chạy từ khoảng 08:11; đây là dấu hiệu có hoạt động đồng thời, **chưa đủ chứng minh tiến trình nào đã ghi hai tệp**. Đã đối chiếu cấu hình runner và sáu probe: đường dẫn DB/JSON kiểm thử nằm dưới TEMP, mã nguồn/bộ probe không đổi, mã DB/config của RUN_REPO không trỏ qua junction về repo gốc. Danh sách lớp thật hiện có 10 mục, không chứa các mã lớp giả của probe đã kiểm tra. **Không tự ghi đè/khôi phục hai tệp thật**, vì có thể làm mất dữ liệu mới. Cần xác định thao tác đồng thời và xác nhận mốc dữ liệu đúng trước khi có thể khẳng định bảo toàn/chốt GO. Không sửa baseline cũ để hợp thức hóa kết quả.

**158/158 mục nguồn/cấu hình repo gốc và 164/164 mục nguồn/cấu hình/probe TEMP giữ nguyên SHA-256 so với baseline**, gồm đủ sáu tệp trong phạm vi và sáu probe. Bằng chứng tổng hợp: `R4\final-preservation-and-verdict.json`. Chỉ cập nhật báo cáo này trong repo gốc; sáu tệp sửa sẵn tiếp tục thuộc working tree của bên triển khai. Đây là lượt kiểm định, không phải lượt sửa tính năng; không gom các thay đổi đó vào commit/push.

**Đã xác nhận:** đóng F01–F05 trên đúng bản sửa được cung cấp, 4/4 Gates, 628/628 probe, bốn ca F05-R3-1..4 và bảo toàn mã nguồn/probe. **Không xác nhận được bảo toàn hai tệp dữ liệu thật: SHA-256 cuối lượt không khớp mốc Owner.**

**Chưa kiểm tra:** đăng nhập/lớp thật và LMS/Teaching/Drive/Gemini thật, thao tác quét trực tiếp trên dịch vụ thật, bản build phát hành mới. Các kiểm tra mã và hành vi cục bộ đã đạt; **kết luận tổng thể NO-GO do điều kiện SHA-256 chưa đạt**, không phải do tái mở F05.

**Kết luận cuối Round 4: VERDICT: NO-GO — 5/5 CLOSED, 4/4 Gates PASS, 628/628 Probes PASS, SHA-256 dữ liệu thật cuối lượt không khớp Owner ở cả 2/2 tệp; chưa đủ điều kiện GO.**

---

## Lịch sử kiểm định Round 3 — giữ nguyên văn

Các kết luận NO-GO bên dưới thuộc bản mã và thời điểm cũ; kết luận hiện hành là Round 4 ở đầu báo cáo.

# CODEX DASHBOARD TRACKING AUDIT — Round 3 (Final Closure Audit)

**VERDICT: NO-GO**

- Ngày kiểm định: **07/11/2026**, múi giờ **Asia/Saigon**.
- **Closure Matrix: F01 CLOSED; F02 CLOSED; F03 CLOSED; F04 CLOSED; F05 OPEN — 4/5 CLOSED.**
- Đã chạy mới đúng **4/4 Gates PASS**, **625/625 ca trong 5 bộ probe được yêu cầu PASS**, tất cả 9 lệnh exit 0.
- **Chưa thể chốt GO:** probe bổ sung đúng nhánh tải danh sách của F05 tái hiện **2 FAIL / 3 ca, 1 PASS, 0 ERROR**, exit 1. Khi trang báo lỗi nhưng còn ô tìm kiếm hoặc khung bảng, hàm vẫn báo thành công và ghi rỗng danh sách đã lưu.
- **SHA-256 của cả hai tệp dữ liệu thật nguyên vẹn 100%, khớp Owner trước và sau toàn bộ kiểm tra.** Sáu tệp được kiểm định và 5 probe gốc giữ nguyên nội dung.
- Phiên kiểm định này trực tiếp đọc mã và chạy kiểm tra; **không gọi thêm `codex exec` hoặc reviewer lồng bên trong**, theo yêu cầu Owner.

## R3.1. Bản mã và môi trường kiểm định

Đã đọc `PROJECT_STATE.md`, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` và quy tắc dự án; rà sáu tệp được chỉ định, diff và các nơi gọi hàm liên quan. Kết quả thuộc **working tree có 6 tệp sửa chưa commit** trên HEAD `ffc3cfb9c75861cd40ce2e34ddf721be7575c51c`, không phải riêng mã đã commit tại HEAD.

```text
AUDIT_TEMP = C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770
RUN_REPO   = AUDIT_TEMP\run-repo
R3         = AUDIT_TEMP\round3
```

**6/6 tệp gốc khớp từng byte với bản TEMP đã được cung cấp; không cần đồng bộ lại.** Các mã SHA-256 dưới đây giữ nguyên trước và sau kiểm định:

| Tệp | SHA-256 của bản gốc và bản TEMP |
|---|---|
| `src/lib/playwright/sync-class.ts` | `98c2804091227c555b4db00cca8a71eb51044108ebd8c85aa1b2344f1ea46799` |
| `src/lib/classes/class-directory.ts` | `b82ab0931928912a9b2a3b34cc0cebd86d6486b693346cb068f1aba65ff8d335` |
| `src/lib/dashboard/today-tasks.ts` | `1aff56270a84e0ee21728a501e4bcc7b95d35b955217f8a9aaa7a798795a69ca` |
| `src/app/api/dashboard/scan-weekly-tasks/route.ts` | `bda0e62c45cae255aeaa1c987d2ee1db5569fc83d44173b4889a4bba15d55477` |
| `src/app/api/spck/list/route.ts` | `d0467019e9d6d747cefe581e7380450c2781a0183051971829a52e0b641c13cf` |
| `scripts/test-streamline-v340-s6.ts` | `380f48e8d7419ee7562e8312861c0309fc5fd8f874f084be5dfca2ba0c33b7e4` |

Đối chiếu thêm 156 mục nguồn/cấu hình liên quan: **132 khớp từng byte; 24 chỉ khác kiểu xuống dòng hoặc dấu BOM, nội dung khớp sau chuẩn hóa**. Không sửa các mục này. Bằng chứng: `R3\dependency-source-comparison.json`.

Các tiến trình được chạy tuần tự tại RUN_REPO với:

```powershell
$env:ALLOWED_LOCAL_DIRS = 'C:\Users\QQ\AppData\Local\Temp'
$env:MINDX_DB_PATH = 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\round3\gates-default.db'
$env:MINDX_RUNNING_CLASSES_PATH = 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\round3\gates-running.json'
$env:npm_config_offline = 'true'
```

Các script/probe có thể tự thu hẹp đường dẫn và đặt DB/JSON giả riêng dưới TEMP. Hai probe Round 2 vẫn ghi kết quả vào thư mục `round2` theo mã nguyên trạng; đã lưu kết quả cũ tại `R3\prior-results` trước khi chạy và sao chép kết quả mới vào R3. Trình duyệt dùng trang giả lập, chặn yêu cầu mạng; không dùng thông tin đăng nhập hoặc mở DB thật bằng SQLite. Không cài/cập nhật thư viện.

## R3.2. Closure Matrix — F01–F05

| Phát hiện | Kết luận | Bằng chứng hiện tại |
|---|---|---|
| **F01** — nhầm bằng chứng Buổi 12 sang Buổi 13 | **CLOSED** | `today-tasks.ts` không dùng trạng thái chung để bù Buổi 13 khi lịch sử đã chỉ rõ buổi khác; `SPCK-13-legacy-other-session-only` và kiểm thử hồi quy trong G2 PASS. |
| **F02** — che lỗi nộp lại sau sửa nháp/lịch sử FAILED | **CLOSED** | Đọc `lastAttemptStatus` của đúng buổi và ưu tiên lỗi nộp lại; G2 và probe kết nối qua đường lưu SQLite PASS. Bản nháp sửa bình thường sau lần xác thực thành công vẫn giữ hoàn thành. |
| **F03** — nhận nhầm lớp kế tiếp chưa Running | **CLOSED** | Các tập lớp kế tiếp dùng chung `isConfirmedRunningStatus`; ca FINISHED/Cancelled/Planning/trống không làm ẩn lớp cũ; **464/464** ca ghép mã kế tiếp PASS. |
| **F04** — cửa sổ Trang chủ 7 ngày làm mất quyền chọn SPCK 15 ngày | **CLOSED** | POST SPCK truyền `includeFinishedDays: FINISHED_CLASS_GRACE_DAYS` vào hàm quét; probe kết nối xác nhận lớp ngày 10 vẫn chọn được ở SPCK nhưng ẩn trên Trang chủ. |
| **F05** — phân biệt rỗng hợp lệ với lỗi tải, không phục hồi lớp cũ | **OPEN** | Đã đạt tập lọc rỗng, POST SPCK báo lỗi khi fetch thất bại và trang lỗi không có bảng/ô tìm kiếm. Tuy nhiên chỉ cần còn ô tìm kiếm hoặc khung bảng, trang lỗi vẫn bị coi là quét rỗng thành công; hai ca bổ sung tái hiện ghi rỗng cache. Chi tiết R3.4. |

## R3.3. Các lệnh được yêu cầu — 4/4 Gates và 625/625 Probes PASS

Chạy mới từ **09:59:06 đến 10:01:10 ngày 07/11/2026**. Không dùng kết quả lưu từ vòng trước để thay lượt chạy này.

| Cổng | Lệnh | Kết quả | Nhật ký |
|---|---|---|---|
| G1 | `npx tsc --noEmit --incremental false` | **PASS**, exit 0 | `R3\G1.log` |
| G2 | `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, exit 0; S6-T1…T4 đạt | `R3\G2.log` |
| G3 | `npx tsx scripts/test-streamline-v340-s2.ts` | **PASS**, exit 0 | `R3\G3.log` |
| G4 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS**, exit 0; T280-01…T280-05 đạt | `R3\G4.log` |

| Probe | Lệnh | PASS / tổng | FAIL | ERROR | Exit | Nhật ký |
|---|---|---:|---:|---:|---:|---|
| P1 | `npx tsx probe-independent.ts` | **590/590** | 0 | 0 | 0 | `R3\P1.log` |
| P2 | `npx tsx probe-fetch.ts` | **12/12** | 0 | 0 | 0 | `R3\P2.log` |
| P3 | `npx tsx probe-connected.ts` | **17/17** | 0 | 0 | 0 | `R3\P3.log` |
| P4 | `npx tsx probe-round2-empty-allowset.ts` | **4/4** | 0 | 0 | 0 | `R3\P4.log` |
| P5 | `npx tsx probe-round2-readiness.ts` | **2/2** | 0 | 0 | 0 | `R3\P5.log` |
| **Tổng yêu cầu** | **5 bộ probe** | **625/625** | **0** | **0** | **5/5 exit 0** | |

Thống kê P1: SPCK **81/81**, ghép mã kế tiếp **464/464**, mốc ngày **14/14**, danh sách lớp **27/27**, route Trang chủ **4/4**. Kết quả máy đọc được: `R3\execution-results.json`, `summary.json` và 5 tệp `*-results.json` tương ứng. `summary.json` xác nhận các lệnh bắt buộc PASS; **kết luận kiểm định cuối cùng** có tính cả kiểm tra bổ sung nằm tại `R3\final-preservation-and-verdict.json`.

## R3.4. F05 vẫn mở — hai tình huống đã chạy và tái hiện

**Mức độ: P1 — quét lỗi có thể ghi đè danh sách lớp đã lưu bằng danh sách rỗng.**

**Nguyên nhân:** [sync-class.ts:1586](../../../src/lib/playwright/sync-class.ts#L1586) mới chỉ kiểm tra sự tồn tại của `table`, ô `Search classes`, hoặc chữ báo rỗng. Điều kiện tại [dòng 1599](../../../src/lib/playwright/sync-class.ts#L1599) cho qua ngay khi có khung bảng hoặc ô tìm kiếm, kể cả nội dung trang báo lỗi. Khi không đọc được dòng lớp nào và DB giả không có lớp bổ sung, hàm đi tới [dòng 1844](../../../src/lib/playwright/sync-class.ts#L1844), ghi `[]` vào cache rồi trả `success:true` tại dòng 1861. Việc có khung giao diện chưa xác nhận dữ liệu lớp đã tải thành công.

**Cách tái hiện:** Dùng bản sao riêng từ probe readiness Round 2, giữ nguyên 5 probe được yêu cầu. Gọi **hàm `ClassSyncer.fetchRunningClasses({ persistToConfig: true })` thật**, chỉ thay trang LMS bằng HTML giả và thay bước đăng nhập/lấy trang. Mỗi ca bắt đầu với cache `[{"classCode":"VT-JSB87","status":"Running"}]`, DB riêng dưới TEMP.

| Tình huống | Mong đợi | Thực tế | Kết quả |
|---|---|---|---|
| Có `<input placeholder="Search classes" />` và thông báo `Unable to load classes. Try again.`, không có bảng | `success:false`, giữ cache lớp cũ | **`success:true`, cache `[]`** | **FAIL** |
| Có khung `<table>` với tiêu đề, `<tbody>` rỗng và cùng thông báo lỗi tải | `success:false`, giữ cache lớp cũ | **`success:true`, cache `[]`** | **FAIL** |
| Đối chứng: bảng hiển thị `No classes` | `success:true`, `classes:[]`, cache `[]` | Đúng mong đợi | **PASS** |

Lệnh bổ sung tại RUN_REPO: `npx tsx probe-round3-readiness.ts`. Kết quả **3 ca: 1 PASS, 2 FAIL, 0 ERROR; exit 1**. Hai ca FAIL thuộc **cùng F05**, không mở thêm phát hiện hoặc thay đổi điều kiện F01–F04. Các ca này không nằm trong 625 ca đã được chỉ định; vì vậy 625/625 PASS vẫn chính xác nhưng chưa đủ đóng F05.

Bằng chứng: `RUN_REPO\probe-round3-readiness.ts`, bản lưu `R3\probe-round3-readiness.ts.txt`, `R3\supplemental-readiness.log`, `R3\supplemental-readiness-probe-results.json`. Thông báo `NativeCommandError` trong log là cách PowerShell ghi luồng stderr của dotenv; **exit 1 ở đây do hai assertion FAIL**, không phải lỗi khởi chạy probe.

**Cách sửa tối thiểu cần giao lại:** Chỉ công nhận danh sách rỗng sau khi có bằng chứng tải dữ liệu lớp thành công và rỗng hợp lệ. Ô tìm kiếm hoặc khung bảng đơn thuần không đủ. Khi lỗi tải, còn chờ tải hoặc chưa xác minh được kết quả, trả thất bại và giữ cache. Kiểm tra phản hồi đúng yêu cầu lấy danh sách lớp nếu dùng bằng chứng mạng; không dùng phản hồi trang HTML hoặc API không liên quan để công nhận thành công.

> Chỉ hoàn tất nhánh readiness của F05 tại `fetchRunningClasses`: chặn hai tình huống trong R3.4 trước khi ghi cache, giữ đối chứng rỗng hợp lệ và toàn bộ F01–F04. Bổ sung kiểm thử hành vi cho ô tìm kiếm còn hiện khi tải lỗi, khung bảng rỗng khi tải lỗi, lỗi phản hồi nghiệp vụ và kết quả rỗng hợp lệ. Không sửa dữ liệu thật hoặc mở rộng giao diện/nghiệp vụ. Chạy lại G1–G4, 625 ca hiện có và ca tái hiện bổ sung trong TEMP; đối chiếu SHA-256 trước/sau rồi kiểm định lại F05.

## R3.5. SHA-256 dữ liệu thật và giới hạn kết luận

Đọc trực tiếp hai tệp tại **repo gốc** bằng **Node.js `fs.readFileSync`**, tính SHA-256 từ byte đọc được; không mở DB Owner bằng SQLite. Đối chiếu lúc **09:59:06** và sau toàn bộ kiểm tra kể cả probe bổ sung lúc **10:01:45**:

| Tệp | Giá trị Owner = trước = sau | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `98496269153d8a192d305c73050dfd69016f42735381a482b93c12107944ac40` | **Khớp, nguyên vẹn 100%** |
| `data/running_classes.json` | `63a3f2e5a756aa4a2930dd5c28577888e6112b0927160dc1befef80183ea286f` | **Khớp, nguyên vẹn 100%** |

- **2.839/2.839 tệp đã được Git theo dõi tại repo gốc giữ nguyên SHA-256** so với lúc bắt đầu; gồm cả sáu bản sửa đang có. Không sửa hoặc hoàn nguyên mã triển khai.
- **6/6 tệp chỉ định khớp giữa gốc/TEMP và giữ nguyên; 5/5 probe gốc bất biến.** Chỉ tạo probe bổ sung trong TEMP và cập nhật báo cáo này tại repo gốc.
- Bản báo cáo trước cập nhật được lưu tại `R3\report-before.md`; dấu vết chạy ở `AUDIT_TEMP\run-round3.cjs`, `R3\before.json`, `after.json`, `preservation-results.json`, `final-preservation-and-verdict.json`.
- Không commit/push sáu bản sửa đang kiểm định: đây là kiểm định và cập nhật báo cáo, **chưa có bản sửa tính năng được nghiệm thu**.
- **Chưa kiểm tra:** lớp thật, LMS/Teaching/Drive/Gemini thật, đăng nhập thật, bản build phát hành mới. Các trang giả lập chỉ chứng minh hành vi cục bộ của mã đang kiểm định.

**Kết luận cuối Round 3: VERDICT: NO-GO.** Đạt 4/4 Gates, 625/625 Probes được yêu cầu và bảo toàn dữ liệu thật; **F01–F04 CLOSED, F05 OPEN** do hai phản ví dụ đã chạy. Không đủ cơ sở ghi 5/5 CLOSED hoặc GO.

---

## Lịch sử kiểm định Round 2 — giữ nguyên văn

Phần dưới là hồ sơ lịch sử; kết quả hiện tại và kết luận cuối nằm trong phần **Round 3** ở trên.

# CODEX DASHBOARD TRACKING AUDIT — Round 2

**VERDICT: NO-GO**

- Ngày kiểm định: **07/11/2026**, múi giờ **Asia/Saigon**.
- **Round 2 Closure Matrix: F01 CLOSED; F02 CLOSED; F03 CLOSED; F04 CLOSED; F05 OPEN.** Đóng **4/5** phát hiện; chưa đủ điều kiện GO.
- **4/4 Gates PASS**, tất cả exit 0. **Ba probe nguyên trạng: 619/619 PASS, 0 FAIL, 0 ERROR.**
- Kiểm tra bổ sung đúng các nhánh còn thiếu của F05: **6 ca, 2 PASS, 4 FAIL, 0 ERROR**. Có tái hiện qua chính POST `/api/spck/list`, không chỉ suy luận từ mã.
- **SHA-256 hai tệp dữ liệu thật bảo toàn 100%, khớp giá trị Owner cung cấp trước và sau toàn bộ kiểm định.**
- Reviewer độc lập **Codex CLI, `gpt-6.1-sol`, `xhigh`, exit 0** cũng kết luận **NO-GO**, F01–F04 CLOSED, F05 OPEN. Reviewer rà soát mã; các lệnh kiểm thử do phiên kiểm định chính thực thi.

## R2.1. Đúng bản mã và phạm vi

Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`; đọc đủ sáu tệp được yêu cầu và các nơi nối luồng liên quan. Bản kiểm định là **working tree có sáu tệp sửa chưa commit**, trên HEAD `ffc3cfb9c75861cd40ce2e34ddf721be7575c51c`; không gắn kết quả với riêng HEAD chưa chứa các bản sửa này. `git diff` được dùng để đối chiếu thay đổi mã.

Thư mục cô lập theo đúng yêu cầu:

```text
AUDIT_TEMP = C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770
RUN_REPO   = AUDIT_TEMP\run-repo
R2         = AUDIT_TEMP\round2
```

Đã đồng bộ lại **6/6 tệp** từ dự án gốc vào RUN_REPO và đối chiếu SHA-256 từng byte. Các giá trị sau là của cả bản gốc lẫn bản chạy kiểm tra:

| Tệp | SHA-256 |
|---|---|
| `src/lib/playwright/sync-class.ts` | `027d5d66284e29bcf1e254571376f17d54e6883ea0799e212b4a1f3f2fde4888` |
| `src/lib/classes/class-directory.ts` | `130be395a28deb4fb63694f42baedbe57dc1a87e037121d96071ab19651e408d` |
| `src/lib/dashboard/today-tasks.ts` | `1aff56270a84e0ee21728a501e4bcc7b95d35b955217f8a9aaa7a798795a69ca` |
| `src/app/api/dashboard/scan-weekly-tasks/route.ts` | `bda0e62c45cae255aeaa1c987d2ee1db5569fc83d44173b4889a4bba15d55477` |
| `src/app/api/spck/list/route.ts` | `acb314feaccf9ae968ad94dd15a64c298fc78f6458461f7d786e133c6a6a5bf5` |
| `scripts/test-streamline-v340-s6.ts` | `4f3f0891eaa6dca9362ffde7ad5134f9a3cc7123b37e89f30a1fe761b042c1c3` |

Thiết lập trước khi chạy:

```powershell
Set-Location -LiteralPath 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\run-repo'
$env:ALLOWED_LOCAL_DIRS = 'C:\Users\QQ\AppData\Local\Temp'
$env:MINDX_DB_PATH = 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\round2\gates-default.db'
$env:MINDX_RUNNING_CLASSES_PATH = 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\round2\gates-running.json'
$env:npm_config_offline = 'true'
```

Các script/probe tự tạo thêm dữ liệu giả dưới TEMP và có thể thu hẹp danh sách đường dẫn được phép trong tiến trình của chúng. Không sao chép thông tin đăng nhập; không dùng dữ liệu thật để chạy SQLite. Trình duyệt thử nghiệm chặn yêu cầu mạng và trả trang giả lập; các lời gọi đồng bộ trong probe route được thay bằng hàm thử nghiệm. Không cài/cập nhật thư viện.

**Ranh giới lịch sử:** `R2\run-repo-before` và `R2\round1-artifacts` là bản lưu của TEMP có sẵn ngay trước lượt này. Sáu tệp trong bản lưu đã trùng nội dung bản sửa và một số kết quả có sẵn đã được chạy lại; chúng **không chứng minh trạng thái mã/kết quả ban đầu của Round 1**. Kết quả hiện tại chỉ lấy từ lượt chạy mới của Round 2. Báo cáo Round 1 nguyên văn được giữ ở cuối tài liệu và tại `R2\report-round1.md`.

## R2.2. Round 2 Closure Matrix — F01–F05

| Phát hiện | Kết luận | Kiểm tra mã và bằng chứng hành vi |
|---|---|---|
| **F01** — nhầm bằng chứng Buổi 12 sang Buổi 13 | **CLOSED** | `today-tasks.ts` xác định lịch sử đã có khóa buổi; không dùng trạng thái chung VERIFIED để bù Buổi 13 khi bản đồ hợp lệ chỉ có Buổi 12. Ca `SPCK-13-legacy-other-session-only` PASS; G2 có kiểm thử hồi quy tương ứng. Nhánh tương thích lịch sử cũ không xác định buổi vẫn là giới hạn đã có, không được coi là bằng chứng mới xác thực LMS. |
| **F02** — che lỗi nộp lại sau sửa nháp/lịch sử FAILED | **CLOSED** | Đọc `lastAttemptStatus` của đúng buổi và ưu tiên FAILED; chặn mục lịch sử đúng buổi đang FAILED dù còn bằng chứng thành công cũ. Các ca `CONNECTED-SPCK-12/13/14-after-edit-still-pending` và `SPCK-12/13/14-legacy-FAILED-with-prior-receipt` PASS. Đối chiếu đường lưu VERIFIED trong SQLite: lần nộp thành công cập nhật được trạng thái; nháp bình thường sau thành công vẫn giữ hoàn thành. |
| **F03** — coi FINISHED/Cancelled/Planning/trống là lớp kế tiếp đang học | **CLOSED** | Các tập mã lớp kế tiếp dùng chung `isConfirmedRunningStatus`, chỉ nhận RUNNING/ACTIVE sau chuẩn hóa. Các ca đối chứng trên danh sách và Trang chủ PASS; đủ **464/464** ca ghép mã lớp kế tiếp PASS. |
| **F04** — thời hạn Trang chủ 7 ngày làm mất quyền chọn SPCK 15 ngày | **CLOSED** | `/api/spck/list` truyền rõ `includeFinishedDays: FINISHED_CLASS_GRACE_DAYS` (15) vào cả nhánh quét bảng và bổ sung SQLite. Trang chủ/quét tuần lọc riêng 7 ngày. Các ca `CONNECTED-shared-fetch-preserves-SPCK15-source`, `CONNECTED-SPCK15-after-refresh-with-allowedSet-has-day10`, `CONNECTED-dashboard-day10-remains-hidden` PASS. |
| **F05** — phục hồi lớp cũ khi danh sách rỗng/phân biệt quét thất bại | **OPEN** | Đã sửa trả/lưu rỗng trong hàm quét và bỏ nhánh lấy cache chỉ vì rỗng tại quét tuần. Các ca cũ PASS. Tuy nhiên SPCK vẫn lấy lại lớp cũ qua tập được phép rỗng và vẫn báo thành công khi fetch thất bại; thêm nhánh không tải được bảng bị nhận thành rỗng hợp lệ. Các tình huống bổ sung bên dưới đã tái hiện. |

## R2.3. Bốn cổng bắt buộc

Tất cả chạy tuần tự tại RUN_REPO, từ **09:40:18 đến 09:41:54 ngày 07/11/2026**.

| Cổng | Lệnh | Kết quả | Bằng chứng mới |
|---|---|---|---|
| G1 | `npx tsc --noEmit --incremental false` | **PASS**, exit 0 | `R2\G1.log` |
| G2 | `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, exit 0; S6-T1…T4 đạt | `R2\G2.log` |
| G3 | `npx tsx scripts/test-streamline-v340-s2.ts` | **PASS**, exit 0 | `R2\G3.log` |
| G4 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS**, exit 0; T280-01…T280-05 đạt | `R2\G4.log` |

**Tổng: 4/4 Gates PASS.** Chi tiết thời điểm, thời gian chạy và mã thoát: `R2\execution-results.json`.

## R2.4. Ba probe nguyên trạng — 619/619 PASS

| Lệnh | Tổng | PASS | FAIL | ERROR | Exit |
|---|---:|---:|---:|---:|---:|
| `npx tsx probe-independent.ts` | 590 | 590 | 0 | 0 | 0 |
| `npx tsx probe-fetch.ts` | 12 | 12 | 0 | 0 | 0 |
| `npx tsx probe-connected.ts` | 17 | 17 | 0 | 0 | 0 |
| **Tổng** | **619** | **619** | **0** | **0** | **3/3 thành công** |

Nhóm trong probe chính: SPCK **81/81**, ghép mã kế tiếp **464/464**, mốc ngày **14/14**, danh sách lớp **27/27**, route Trang chủ **4/4**. Ba probe kết thúc lúc **09:42:03**, được giữ nguyên mã trước/sau lượt chạy, có SHA-256 trong `R2\probe-hashes-before.json` và `R2\preservation-results.json`.

Bằng chứng mới: `R2\P1.log`, `P2.log`, `P3.log`, `probe-results.json`, `fetch-probe-results.json`, `connected-probe-results.json`. Một số log PowerShell có bản ghi `NativeCommandError` do thông báo khởi tạo dotenv được in ra luồng stderr; cả mã thoát thực tế và thống kê máy đọc được ở bảng trên đều xác nhận các bộ này thành công, không có ERROR của probe.

**Giới hạn của 619 ca:** chưa gọi trực tiếp POST `/api/spck/list` ở nhánh fetch rỗng/thất bại, cũng chưa thử trang không tải được bảng lớp. Vì thế 619/619 PASS chưa đủ đóng F05.

## R2.5. F05 còn mở — bằng chứng bổ sung

### A. Quét thành công rỗng nhưng màn SPCK phục hồi lớp cũ

**Nguyên nhân:** [class-directory.ts:267](../../../src/lib/classes/class-directory.ts#L267) coi `allowedClassCodes.size === 0` là không giới hạn. Sau fetch thành công trả `[]`, [spck/list/route.ts:445](../../../src/app/api/spck/list/route.ts#L445) truyền đúng tập rỗng vào bộ lọc nhưng vẫn nhận lại lớp từ cache/SQLite.

**Tái hiện đã chạy:** Cache cô lập có `VT-JSB88` Running; SQLite có buổi 14; thay riêng kết quả fetch bằng `{success:true, classes:[]}`. Gọi **POST thật của route** với lớp này. Mong đợi danh sách rỗng và không chọn lớp; thực tế **HTTP 200, success:true, classes:[VT-JSB88], selectedClassId:VT-JSB88**. Kiểm tra trực tiếp hàm danh sách cũng tái hiện cùng lỗi. Đối chứng tập được phép không rỗng và không chứa lớp cũ thì loại được lớp đó.

### B. Màn SPCK vẫn báo thành công khi fetch thất bại

**Nguyên nhân:** [spck/list/route.ts:363](../../../src/app/api/spck/list/route.ts#L363) không kiểm tra `runningRes.success` trước khi xử lý `classes` và trả `success:true` tại dòng 475. Hàm fetch có thể trả danh sách cache kèm `success:false` khi lỗi; đó không phải kết quả quét mới hợp lệ.

**Tái hiện đã chạy:** Thay fetch bằng `{success:false, classes:[{classCode:VT-JSB88,status:Running}], error:"Class-list API unavailable"}`; các chỗ đồng bộ được giả lập an toàn. POST thật vẫn trả **HTTP 200, success:true**, thay vì báo thất bại.

**Bằng chứng A/B:** `RUN_REPO\probe-round2-empty-allowset.ts`, `R2\empty-allowset-probe.log`, `R2\empty-allowset-probe-results.json`: **4 ca, 1 PASS, 3 FAIL, 0 ERROR; exit 1**. Tất cả dữ liệu và thư mục SPCK thử được tự chuyển dưới TEMP bằng `MINDX_DB_PATH`; không ghi vào `F:\MINDX_SPCK_FINAL`.

### C. Không tải được bảng lớp bị coi là kết quả rỗng hợp lệ

**Nguyên nhân:** [sync-class.ts:1578](../../../src/lib/playwright/sync-class.ts#L1578) bỏ qua lỗi chờ dòng trong bảng. Nếu không có bảng hoặc xác nhận rỗng hợp lệ, hàm vẫn đi tới [sync-class.ts:1822](../../../src/lib/playwright/sync-class.ts#L1822), lưu `[]` và trả `success:true` tại dòng 1839.

**Tái hiện đã chạy:** URL trang lớp đã đăng nhập được giả lập, chỉ hiển thị `Unable to load classes. Try again.`, không có bảng. Cache có `VT-JSB87` Running, SQLite cô lập rỗng. Gọi hàm fetch thật với `persistToConfig:true`; sau hết thời gian chờ, thực tế **success:true, cache:[]**. Mong đợi phải báo lỗi và giữ cache. Đối chứng bảng hợp lệ ghi “No classes” thì trả/lưu rỗng thành công đúng yêu cầu.

**Bằng chứng C:** `RUN_REPO\probe-round2-readiness.ts`, `R2\readiness-probe.log`, `R2\readiness-probe-results.json`: **2 ca, 1 PASS, 1 FAIL, 0 ERROR; exit 1**.

**Tác động:** Có thể vẫn chọn/quét lớp cũ khi LMS xác nhận danh sách rỗng; cũng có thể báo quét thành công hoặc làm mất danh sách đang theo dõi khi việc tải dữ liệu thực tế thất bại. Đây là phần chưa đạt của F05, không được bỏ qua để ghi GO.

## R2.6. SHA-256 dữ liệu thật và bảo toàn mã

Đọc hai tệp tại **repo gốc** bằng **Node.js `fs.readFileSync`**, chỉ để tính SHA-256; không mở DB thật bằng SQLite, không dừng ứng dụng đang chạy.

| Tệp | Owner yêu cầu / trước / sau toàn bộ kiểm định | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `98496269153d8a192d305c73050dfd69016f42735381a482b93c12107944ac40` | **Khớp 3/3, nguyên vẹn 100%** |
| `data/running_classes.json` | `63a3f2e5a756aa4a2930dd5c28577888e6112b0927160dc1befef80183ea286f` | **Khớp 3/3, nguyên vẹn 100%** |

- **2.839/2.839 tệp đã được Git theo dõi giữ nguyên** so với lúc bắt đầu Round 2; gồm cả sáu bản sửa chưa commit của agent triển khai, không hoàn nguyên hoặc sửa chúng.
- **6/6 tệp trong RUN_REPO và bản gốc giữ nguyên SHA-256** sau chạy gates, probe và reviewer.
- **3/3 probe gốc giữ nguyên SHA-256.** Hai probe bổ sung chỉ được tạo trong TEMP.
- Trong dự án gốc, lượt kiểm định này chỉ cập nhật báo cáo đang đọc. Không sửa mã ứng dụng, cấu hình, ba tài liệu trạng thái; không commit/push các thay đổi đang chờ của agent triển khai. Đây là kiểm định, không phải lượt triển khai bản sửa.

Bằng chứng: `R2\real-data-before.json`, `real-data-after.json`, `tracked-before.json`, `source-manifest.json`, `preservation-results.json`, `round2-summary.json`, `artifact-hashes.json`.

## R2.7. Kiểm tra chéo độc lập và ranh giới kết luận

Đã chạy thật `codex exec` không tương tác trên RUN_REPO với `--ephemeral --sandbox read-only --model gpt-6.1-sol -c model_reasoning_effort="xhigh" --json`, **exit 0**. Reviewer đọc mã và hồ sơ kết quả, **không tự chạy gates/probe**; kết luận **F01–F04 CLOSED, F05 OPEN, VERDICT NO-GO**. Reviewer xác định độc lập hai nhánh A/B; phiên chính đã tái hiện thêm qua route thật bằng dữ liệu giả như trên. Bằng chứng: `R2\review-prompt.txt`, `cli-review.txt`, `cli-review.jsonl`; lệnh gọi ở `AUDIT_TEMP\run-round2-review.ps1`.

Lần gọi reviewer đầu tiên truyền thiếu phần prompt qua trình bao lệnh Windows đã được dừng; không dùng làm kết luận. Nhật ký được giữ riêng ở `R2\cli-review-incomplete-prompt.jsonl`. Lần hợp lệ đọc trực tiếp tệp hướng dẫn đầy đủ.

**Đã xác nhận:** đúng sáu bản sửa, 4/4 cổng, 619 ca gốc, các tình huống bổ sung F05, đối chiếu mã độc lập và dữ liệu thật nguyên vẹn. **Chưa xác nhận:** LMS/Teaching/Drive/Gemini thật, thao tác trên lớp thật, đăng nhập thật, bản build phát hành mới. Không dùng trang giả lập để kết luận dịch vụ thật đã được nghiệm thu.

### Phạm vi sửa cần giao lại

> Chỉ hoàn tất F05 của báo cáo Round 2: (1) POST `/api/spck/list` phải dừng và báo lỗi khi fetch không thành công; (2) fetch thành công với `classes:[]` phải giữ danh sách SPCK rỗng, không phục hồi lớp cũ qua tập `allowedClassCodes` rỗng; phân biệt rõ “không truyền tập lọc” với “truyền tập rỗng” và rà các nơi gọi trước khi đổi hàm dùng chung; (3) `fetchRunningClasses` chỉ lưu kết quả rỗng khi xác nhận bảng/trạng thái rỗng hợp lệ, còn không tải được bảng/phản hồi lỗi phải báo lỗi và giữ cache. Giữ quy tắc 7 ngày của Trang chủ, 15 ngày của SPCK và F01–F04 đã đóng. Không thay dữ liệu thật. Thêm kiểm thử hành vi cho ba nhánh trên và các đối chứng thành công rỗng, chạy lại G1–G4 cùng 619 ca gốc và probe bổ sung trong TEMP, đối chiếu SHA-256 rồi yêu cầu kiểm định lại. Không mở rộng sang thay đổi giao diện hay nghiệp vụ khác.

**Kết luận cuối Round 2: VERDICT: NO-GO.** Điều kiện 619/619 PASS và 4/4 Gates PASS đã đạt, nhưng F05 chưa đóng đủ nên chưa đạt 100% điều kiện GO.

---

## Lịch sử kiểm định Round 1 — giữ nguyên văn

Phần dưới là kết quả lịch sử của bản trước sửa. Kết quả hiện tại và bảng đóng phát hiện nằm trong phần Round 2 ở trên.


# CODEX DASHBOARD TRACKING AUDIT — Round 1

**VERDICT: NO-GO**

- Ngày kiểm định: **07/11/2026**, múi giờ **Asia/Saigon**.
- Bản được kiểm định: `bd21bb8219404a887c945575844a6deed314c81a` (`bd21bb8`).
- HEAD của thư mục làm việc: `ffc3cfb9c75861cd40ce2e34ddf721be7575c51c`. Commit sau chỉ đổi hướng dẫn/quy trình/README; không đổi mã trong phạm vi kiểm định.
- **G1–G4: 4/4 PASS ở lần chạy hợp lệ cuối cùng.**
- **Probe độc lập: 619 ca, 592 PASS, 27 FAIL, 0 ERROR.** Các FAIL được quy về **5 phát hiện: 2 P1, 3 P2**.
- **Hai tệp dữ liệu thật giữ nguyên SHA-256 trước/sau.** Không sửa mã, bộ kiểm thử hay cấu hình gốc. Chỉ tạo tệp báo cáo này trong dự án.

## 1. Thay đổi được kiểm định

Bản nâng cấp cho phép Trang chủ tiếp tục tính SPCK đã nộp khi đúng buổi đã có bằng chứng xác thực trên LMS, dù giáo viên sửa bản nháp sau đó. Lớp đã kết thúc phải ngừng được theo dõi sau 7 ngày hoặc khi có lớp đang học ở cấp cao hơn cùng mã khóa và hậu tố.

Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, sau đó kiểm tra:

1. `src/lib/dashboard/today-tasks.ts`: `getDashboardTodayTodoCards`, hàm lồng `checkSpckSessionVerified`, nguồn danh sách học viên và lịch sử SPCK.
2. `src/lib/playwright/sync-class.ts`: hai hằng số 7/15 ngày, nhận diện lớp kế tiếp, mốc ngày kết thúc, `ClassSyncer.fetchRunningClasses`.
3. `src/lib/classes/class-directory.ts`: trạng thái đang học được ghi rõ, lọc lớp kết thúc, các phạm vi `running / spck / all`.
4. `src/app/api/dashboard/scan-weekly-tasks/route.ts`: GET/POST, danh sách cần quét, giới hạn 24 thẻ và các nhánh lỗi.
5. `scripts/test-streamline-v340-s6.ts`.
6. Các nơi nối luồng cần thiết: hàm lưu nháp/lịch sử SPCK trong `src/lib/db/sqlite.ts`, màn SPCK qua `src/app/api/spck/list/route.ts`, bộ chọn/làm mới lớp.

Giả định sử dụng: ứng dụng cục bộ của một giáo viên; kiểm tra tập trung vào tính đúng của trạng thái và việc giữ/bỏ lớp.

## 2. Cách cô lập và bảo toàn

Thư mục bằng chứng tạm:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770
```

Trong báo cáo, gọi thư mục trên là **AUDIT_TEMP**.

- Tạo bản sao bằng `git archive bd21bb8` tại `AUDIT_TEMP\run-repo`; không dùng mã của một bản sửa mới hơn.
- Chỉ liên kết thư viện đã cài qua `node_modules`; không cài/cập nhật thư viện.
- Không sao chép `.env` hay hồ sơ đăng nhập trình duyệt. Mọi đường dẫn dữ liệu khi chạy kiểm tra trỏ vào thư mục tạm bằng `MINDX_DB_PATH` và `MINDX_RUNNING_CLASSES_PATH`.
- Các probe tự tạo dữ liệu giả; không mở dữ liệu thật bằng SQLite. Probe trình duyệt chặn toàn bộ yêu cầu của trang thử và trả nội dung giả lập; probe route thay thế các chỗ gọi dịch vụ ngoài.
- Lập bảng SHA-256 của **2.839 tệp đã được Git theo dõi** trước kiểm định và đối chiếu lại sau kiểm định. **0 tệp đổi, 0 tệp mất**; báo cáo mới là tệp chưa được Git theo dõi.
- **169/169 tệp thuộc `src/**`, `scripts/**`, `data/config/**` trong bản sao kiểm thử khớp byte với commit đích.** Git không ghi nhận khác biệt nội dung của ba nhóm này giữa thư mục gốc và `bd21bb8`. Một số tệp checkout có kiểu xuống dòng khác blob Git; đó không phải thay đổi do kiểm định.
- Bảng băm gốc: `AUDIT_TEMP\tracked-before.json`, SHA-256 `1b7ee0a5ccafceb2b2b7b7197e64072f5790bd8a947f280c16c3e01052f0b8fb`.
- Không sửa ba tài liệu trạng thái, không commit/push: đây là đợt chỉ kiểm định và chỉ được ghi một báo cáo.

### SHA-256 dữ liệu thật

| Tệp | Trước kiểm định | Sau toàn bộ kiểm thử/probe | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `98496269153d8a192d305c73050dfd69016f42735381a482b93c12107944ac40` | `98496269153d8a192d305c73050dfd69016f42735381a482b93c12107944ac40` | Giữ nguyên 100% |
| `data/running_classes.json` | `63a3f2e5a756aa4a2930dd5c28577888e6112b0927160dc1befef80183ea286f` | `63a3f2e5a756aa4a2930dd5c28577888e6112b0927160dc1befef80183ea286f` | Giữ nguyên 100% |

Ứng dụng đang mở tệp SQLite nên `Get-FileHash` thông thường không đọc được tệp đó. Đã đọc chỉ để tính băm với quyền chia sẻ đọc/ghi của Windows, không dừng ứng dụng, không thay đổi dữ liệu. Biên bản máy đọc được nằm ở `real-data-before.json`, `real-data-after.json`, `preservation-results.json` trong AUDIT_TEMP.

## 3. Các cổng kiểm tra bắt buộc

Tất cả lệnh dưới đây chạy tại `AUDIT_TEMP\run-repo`, với dữ liệu cô lập.

| Cổng | Lệnh | Kết quả cuối | Bằng chứng trong AUDIT_TEMP |
|---|---|---|---|
| G1 | `npx tsc --noEmit --incremental false` | PASS, exit 0 | `G1.log`, `gates.json` |
| G2 | `npx tsx scripts/test-streamline-v340-s6.ts` | PASS, exit 0; S6-T1…T4 đạt | `G2-retry.log` |
| G3 | `npx tsx scripts/test-streamline-v340-s2.ts` | PASS, exit 0 | `G3.log`, `gates.json` |
| G4 | `npx tsx scripts/test-lms-reliability-v280.ts` | PASS, exit 0; T280-01…T280-05 đạt | `G4.log`, `gates.json` |

**Ghi nhận lần chạy đầu của G2:** exit 1 do thiết lập cô lập cấp quyền cho AUDIT_TEMP, trong khi S6 tự tạo thư mục anh em `$TEMP\mindx-v340-s6-*`. Đã chạy lại nguyên bộ S6 với `ALLOWED_LOCAL_DIRS=$env:TEMP`; exit 0. Không sửa script, mã ứng dụng hay cơ chế bảo vệ đường dẫn để vượt kiểm tra. Giữ cả `G2.log` và `G2-retry.log`; mục G2 trong `gates.json` là lần đầu, kết quả cuối là log chạy lại.

## 4. Probe độc lập

Các probe gọi hàm sản phẩm thật, không chép lại thuật toán để tự kiểm tra chính nó. Hàm `checkSpckSessionVerified` được kiểm tra qua kết quả bước “Nộp SPCK” của `getDashboardTodayTodoCards`, vì nó là hàm lồng không được xuất ra ngoài.

| Bộ probe | Tổng | PASS | FAIL | ERROR |
|---|---:|---:|---:|---:|
| `probe-independent.ts`: SPCK, mã lớp kế tiếp, ngày, danh sách, route | 590 | 576 | 14 | 0 |
| `probe-fetch.ts`: bộ quét thật trên trang LMS giả lập | 12 | 8 | 4 | 0 |
| `probe-connected.ts`: lưu nháp thật và các luồng nối màn hình | 17 | 8 | 9 | 0 |
| **Tổng** | **619** | **592** | **27** | **0** |

Mỗi bộ kết thúc với exit 1 vì tái hiện được lỗi nghiệp vụ; không có lỗi hạ tầng thực thi probe.

### Những phần đã đạt

- **464/464 ca nhận diện mã lớp kế tiếp:** đủ 8 họ `JSB→JSA→JSI`, `PTB→PTA→PTI`, `SB→SA→SI`, `GB→GA→GI`, `CSB→CSA→CSI`, `PREB→PREA→PREI`, `ARMB→ARMA→ARMI`, `SEMIB→SEMIA→SEMII`.
- Bao gồm chuyển B→A, A→I, B→I; tiền tố `VT-` và `VT-C4K-`; có/không `-HB`; số `2/02` ở cả hai phía; chữ hoa/thường và khoảng trắng.
- Không ghép nhầm khác số khóa, khác tiền tố, khác họ mã, khác hậu tố, cùng cấp, chuyển ngược cấp hoặc khi tập lớp đang học rỗng.
- Mốc **7 ngày − 1 ms**, **đúng 7 ngày**, **7 ngày + 1 ms** được kiểm tra ở hàm ngày, danh sách lớp và bộ quét thật trên trang giả lập. Đúng mốc còn được giữ; vượt mốc bị loại khi không có lỗi danh sách cũ tại F05.
- Lớp ghi rõ `Running / Active` vẫn được giữ dù ngày kết thúc đã cũ; lớp Running không bị loại chỉ vì xuất hiện cấp kế tiếp.
- Ở cả Buổi 12/13/14: nháp `WAITING_APPROVAL / DRAFT` có bằng chứng đúng buổi qua thời gian, mã băm hoặc lịch sử được tính đã nộp; học viên đang học chưa từng nộp vẫn chặn hoàn thành.
- Học viên `isActive=0` có bài lỗi không chặn các học viên đang học; lớp chỉ có học viên ngừng học không được tự coi là đã đủ bài. Vắng một buổi nhưng vẫn `isActive=1` tiếp tục phải nộp SPCK.
- Dòng từng buổi đang `FAILED` được giữ chưa hoàn thành. Những nhánh FAILED còn thiếu được nêu tại F02.
- GET và các nhánh POST thành công, lỗi lấy danh sách, ngoại lệ đều trả tối đa **24 thẻ**; POST bỏ lớp hết hạn/lớp đã có kế tiếp khi đầu vào có trạng thái đúng.

### Cách chạy lại probe

Các tệp probe chỉ nằm trong thư mục tạm. Lệnh hoàn chỉnh:

```powershell
Set-Location -LiteralPath 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770\run-repo'
$env:ALLOWED_LOCAL_DIRS = 'C:\Users\QQ\AppData\Local\Temp\mindx-dashboard-audit-bd21bb8-20261107-091003-9c4bc770'
$env:MINDX_DB_PATH = Join-Path $env:ALLOWED_LOCAL_DIRS 'probe-rerun-default.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $env:ALLOWED_LOCAL_DIRS 'probe-rerun-default-running.json'
npx tsx probe-independent.ts
npx tsx probe-fetch.ts
npx tsx probe-connected.ts
```

Kết quả chi tiết từng ca: `probe-results.json`, `fetch-probe-results.json`, `connected-probe-results.json`. Log tương ứng: `probe.log`, `fetch-probe.log`, `connected-probe.log`. Mã băm các bằng chứng nằm trong `artifact-hashes.json`.

## 5. Phát hiện cần sửa

### F01 — P1 — Buổi 13 báo đã nộp dù chỉ có bằng chứng của Buổi 12

**Vị trí:** [today-tasks.ts:539](../../../src/lib/dashboard/today-tasks.ts#L539), đặc biệt dòng 541.

**Nguyên nhân:** Khi thiếu dòng riêng của Buổi 13, mã chấp nhận `spck_uploads.status === "VERIFIED"`. Trạng thái chung này không xác định buổi nào đã nộp.

**Tái hiện đã chạy:** Một học viên đang học; lớp ở Buổi 13; không có dòng `spck_session_submissions` cho Buổi 13; `spck_uploads.status="VERIFIED"`; lịch sử chỉ có `{"12":{"status":"VERIFIED","verifiedAt":"2026-11-06"}}`.

- Mong đợi: SPCK Buổi 13 **chưa xong**.
- Thực tế: **đã xong**.
- Ca: `SPCK-13-legacy-other-session-only`, **1 FAIL**.

**Tác động:** Giáo viên có thể bỏ sót buổi chưa từng nộp vì Trang chủ báo hoàn thành.

**Cách sửa nhỏ nhất:** Chỉ chấp nhận bằng chứng thuộc đúng buổi. Nếu phải hỗ trợ lịch sử rất cũ không rõ buổi, cần phân biệt rõ trường hợp đó; không dùng trạng thái chung để ghi đè một bản đồ lịch sử hợp lệ chỉ chứa buổi khác.

**Kiểm tra sau sửa:** Chỉ Buổi 12 đã nộp thì Buổi 13 phải chờ; thêm bằng chứng đúng Buổi 13 mới được hoàn thành.

### F02 — P1 — Kết quả nộp thất bại có thể bị che bởi bằng chứng thành công cũ

**Vị trí:** [today-tasks.ts:472](../../../src/lib/dashboard/today-tasks.ts#L472), [today-tasks.ts:515](../../../src/lib/dashboard/today-tasks.ts#L515), [today-tasks.ts:529](../../../src/lib/dashboard/today-tasks.ts#L529). Nối luồng với [sqlite.ts:3104](../../../src/lib/db/sqlite.ts#L3104) và [sqlite.ts:3621](../../../src/lib/db/sqlite.ts#L3621).

Có **hai nhánh tái hiện độc lập**, cùng vi phạm yêu cầu không tính xong khi lần nộp vẫn lỗi:

1. **Sau khi sửa nháp:** Dòng từng buổi có bằng chứng nộp thành công cũ, `lastAttemptStatus="FAILED"` và `draftStatus="FAILED"`. Gọi hàm sản phẩm `spckSessionRepo.saveSessionDraft` để sửa nhận xét. Hàm chuyển nháp sang `WAITING_APPROVAL`, giữ `lastAttemptStatus="FAILED"`. Trang chủ chỉ đọc/chặn `draftStatus`, nên đổi từ chưa xong thành **đã xong**. Lịch sử SPCK vẫn nhận diện “Lỗi nộp lại”.
2. **Chỉ có lịch sử cũ:** Không có dòng từng buổi; `sessionResultsJson[targetSess].status="FAILED"` nhưng vẫn giữ `lastVerifiedAt / lastVerifiedContentHash` của lần thành công trước. Bộ kiểm tra nhận bằng chứng cũ và trả **đã xong** mà không chặn trạng thái FAILED trong mục lịch sử đó.

**Bằng chứng:** Ở cả Buổi 12/13/14, `CONNECTED-SPCK-*-after-edit-still-pending` và `SPCK-*-legacy-FAILED-with-prior-receipt`: **6 FAIL**. Các ca xác nhận trạng thái trước/sau lưu nháp đều PASS.

**Tác động:** Giáo viên không thấy việc cần xử lý trên Trang chủ dù lần nộp gần nhất chưa thành công.

**Cách sửa nhỏ nhất:** Đọc và ưu tiên `lastAttemptStatus` của đúng buổi; kiểm tra FAILED trong lịch sử khi dùng nhánh dự phòng. Giữ nguyên bằng chứng đã nộp cũ, nhưng chỉ bỏ cảnh báo lỗi sau lần nộp thành công tiếp theo. Nháp chỉnh sửa bình thường sau một lần nộp thành công vẫn được tính xong theo yêu cầu mới.

**Kiểm tra sau sửa:** Thành công → nộp lại lỗi → sửa nháp/duyệt lại phải vẫn chưa xong; nộp lại thành công mới hết lỗi. Kiểm tra cả dữ liệu chỉ có lịch sử cũ.

### F03 — P2 — Lớp kế tiếp chưa đang học vẫn có thể làm lớp cũ biến mất

**Vị trí:** [class-directory.ts:154](../../../src/lib/classes/class-directory.ts#L154), [today-tasks.ts:345](../../../src/lib/dashboard/today-tasks.ts#L345); cùng kiểu lọc xuất hiện tại [scan-weekly-tasks/route.ts:75](../../../src/app/api/dashboard/scan-weekly-tasks/route.ts#L75).

**Nguyên nhân:** Tập lớp dùng để tìm cấp kế tiếp được tạo bằng điều kiện “khác Finished”, thay vì chỉ nhận trạng thái đang học được xác nhận. Riêng danh sách lớp dùng so sánh phân biệt hoa/thường, trong khi ngay bên dưới lại nhận `FINISHED` bằng cách chuẩn hóa.

**Tái hiện đã chạy:** `VT-JSB15` là `Finished` mới kết thúc 3 ngày. `VT-JSA15` có trạng thái `FINISHED` và kết thúc 30 ngày trước. Lớp sau được chính danh sách phân loại là Finished, nhưng vẫn lọt vào tập “đang học”; vì vậy lớp trước bị ẩn.

- Thử thêm `" finished "`, `Cancelled`, `Planning`, trạng thái trống: cùng lỗi.
- `Finished` đúng cách viết hiện tại không gây lỗi.
- Kiểm tra trực tiếp danh sách và Trang chủ: **10 FAIL**, các ca đối chứng Running/Active đạt.

**Tác động:** Lớp còn trong tuần hỗ trợ bị ngừng theo dõi dù chưa có lớp kế tiếp thực sự đang học.

**Cách sửa nhỏ nhất:** Chuẩn hóa trạng thái một lần, dùng thống nhất điều kiện `RUNNING / ACTIVE` cho tập lớp kế tiếp tại các nơi gọi. Không coi trạng thái thiếu, đã kết thúc, dự kiến mở hay đã hủy là bằng chứng đang học.

**Kiểm tra sau sửa:** Chỉ Running/Active cùng mã khóa mới ẩn lớp trước; FINISHED/Cancelled/Planning/trống phải giữ lớp trước trong thời hạn.

### F04 — P2 — Mốc 7 ngày của Trang chủ làm thiếu lớp trong luồng SPCK còn hạn 15 ngày

**Vị trí:** [sync-class.ts:1675](../../../src/lib/playwright/sync-class.ts#L1675), [sync-class.ts:1768](../../../src/lib/playwright/sync-class.ts#L1768). Nơi bị ảnh hưởng: [spck/list/route.ts:363](../../../src/app/api/spck/list/route.ts#L363), [spck/list/route.ts:247](../../../src/app/api/spck/list/route.ts#L247), [spck/list/route.ts:445](../../../src/app/api/spck/list/route.ts#L445).

**Nguyên nhân:** `fetchRunningClasses` là nguồn dùng chung cho cả Trang chủ lẫn màn SPCK. Đổi nguồn này thành 7 ngày làm mất lớp ngày thứ 8–15 trước khi màn SPCK áp dụng thời hạn riêng 15 ngày và tập mã được phép chọn.

**Tái hiện đã chạy:** SQLite có lớp `VT-C4K-GI96` ở Buổi 14, kết thúc 10 ngày trước, không có cấp kế tiếp. Có thêm `VT-C4K-PTI97` đang Running để kết quả quét không rỗng. Trang LMS giả lập trả đủ hai lớp.

- Trước quét: `queryClassDirectory({scope:"spck", includeFinishedDays:15})` còn lớp ngày thứ 10.
- Bộ quét thật loại lớp đó ở mốc 7 ngày.
- Áp dụng tập mã từ kết quả quét theo đúng cách màn SPCK dùng: lớp ngày thứ 10 **không còn được chọn**.
- Trang chủ ẩn lớp ngày thứ 10 là đúng; lỗi nằm ở việc ảnh hưởng sang màn SPCK.
- Hai ca `CONNECTED-shared-fetch-preserves-SPCK15-source`, `CONNECTED-SPCK15-after-refresh-with-allowedSet-has-day10`: **2 FAIL**.

**Tác động:** Giáo viên mất lớp còn hạn bổ sung SPCK; theo mã chọn lớp của route, nếu có lớp khác đủ điều kiện thì lựa chọn có thể chuyển sang lớp khác.

**Cách sửa nhỏ nhất:** Giữ nguồn dùng chung đủ thời hạn SPCK 15 ngày, rồi lọc 7 ngày riêng ở Trang chủ/quét tuần; hoặc truyền thời hạn theo từng nơi gọi với mặc định giữ hành vi cũ. Không đổi toàn bộ màn SPCK sang 7 ngày khi yêu cầu chỉ đổi theo dõi trên Trang chủ.

**Kiểm tra sau sửa:** Lớp kết thúc 10 ngày trước còn trên SPCK sau quét lại, đồng thời không xuất hiện trên Trang chủ. Probe đã chạy phần quyết định danh sách; chưa bấm luồng SPCK trên dịch vụ thật.

### F05 — P2 — Quét ra danh sách rỗng lại phục hồi lớp cũ, tiếp tục theo dõi lớp đã kết thúc

**Vị trí:** [sync-class.ts:1799](../../../src/lib/playwright/sync-class.ts#L1799), đặc biệt dòng 1800 và 1804. Liên quan [class-directory.ts:193](../../../src/lib/classes/class-directory.ts#L193), [scan-weekly-tasks/route.ts:68](../../../src/app/api/dashboard/scan-weekly-tasks/route.ts#L68).

**Nguyên nhân:** Chỉ lưu danh sách khi `runningList.length > 0`; nếu rỗng lại trả `getRunningClasses()` với `success:true`. Cơ chế lấy lại dữ liệu cũ đã tồn tại trước commit này; quy tắc 7 ngày mới tiếp tục chịu lỗi đó.

**Tái hiện đã chạy:**

1. Bản lưu trước quét có duy nhất `VT-C4K-GI98`, trạng thái `Running`.
2. Trang LMS giả lập xác nhận lớp đã `Finished` 10 ngày trước.
3. Bộ quét thật loại lớp vì vượt 7 ngày, nhưng kết quả trở thành rỗng nên trả lại bản Running cũ.
4. Trang chủ vẫn có lớp; gọi POST quét tuần tiếp tục gọi `syncClass` cho lớp đã kết thúc đó.

**Bằng chứng:** Các ca `CONNECTED-staleRunning-*` có **4 FAIL**. Thêm dữ liệu cũ đã ghi Finished: các ca `FETCH-all-expired-*`, `FETCH-no-persist-all-expired-returns-empty`, `FETCH-weekly-route-all-expired-no-sync` có **4 FAIL**. Tổng **8 FAIL**.

Với cache đã ghi Finished đúng, Trang chủ/quét tuần có lớp lọc sau nên có thể chặn được; lỗi rõ nhất là cache còn Running, như ca nối luồng đã chạy.

**Tác động:** Lớp cuối cùng đã hết hạn vẫn nằm trên Trang chủ và vẫn bị quét lại, trái mục tiêu tự ngừng theo dõi.

**Cách sửa nhỏ nhất:** Phân biệt “quét thành công và không còn lớp hợp lệ” với “quét thất bại”. Trường hợp thành công phải trả rỗng, lưu rỗng nếu được yêu cầu; các nơi gọi không tự lấy lại cache chỉ vì kết quả thành công rỗng. Nếu chưa đủ bằng chứng quét thành công thì phải báo lỗi, không coi dữ liệu cũ là kết quả mới.

**Kiểm tra sau sửa:** Cache cũ Running hoặc Finished đều không phục hồi lớp đã hết hạn; Trang chủ rỗng và quét tuần không gọi đồng bộ lớp đó. `persistToConfig:false` phải trả rỗng nhưng giữ nguyên tệp cache.

## 6. Kiểm tra chéo bằng Codex CLI

Đã thực sự chạy tiến trình không tương tác trên bản sao cô lập, theo yêu cầu model/mức suy luận:

```text
codex exec --cd <AUDIT_TEMP>\run-repo --skip-git-repo-check --ephemeral --sandbox read-only --model gpt-6.1-sol -c model_reasoning_effort="xhigh" --json ...
```

- **Exit 0**, kết luận rà soát mã **NO-GO**.
- Kết quả ở `AUDIT_TEMP\cli-review.txt`; nhật ký ở `cli-review.jsonl`; prompt ở `review-prompt.txt`.
- Reviewer đọc mã và lần theo các nơi gọi; **không tự chạy G1–G4/probe**. Kết quả chạy kiểm tra trong báo cáo này do phiên kiểm định chính thực hiện và đối chiếu.
- Bốn nhận định của reviewer đã được đối chiếu với probe: sai buổi, lỗi nộp lại bị che sau sửa nháp, ảnh hưởng thời hạn SPCK 15 ngày, phục hồi lớp cũ khi rỗng.
- Nhánh lịch sử FAILED và nhận diện nhầm trạng thái lớp kế tiếp được bổ sung từ probe độc lập của phiên chính; tổng hợp thành F01–F05 ở trên.

## 7. Ranh giới kết luận và điều kiện kiểm định lại

**Đã xác nhận:** Mã đúng commit đích, 4 cổng bắt buộc, 619 ca probe đã thực thi, 5 nhóm lỗi có tình huống tái hiện, dữ liệu thật và mã gốc bất biến.

**Chưa xác nhận:** LMS/Teaching/Drive/Gemini thật, luồng đăng nhập thật, bấm quét trên lớp thật, bản build phát hành mới. Không dùng kết quả giả lập để kết luận các dịch vụ thật đã được nghiệm thu.

**Điều kiện để GO:** Sửa F01–F05 trong một đợt triển khai riêng; thêm kiểm thử hành vi cho các ca lỗi trên; chạy lại G1–G4 và probe trên đúng bản sửa cuối; đối chiếu lại SHA-256 của dữ liệu thật. Báo cáo này không thực hiện sửa lỗi.

### Yêu cầu sửa có thể giao cho agent triển khai

> Sửa đúng F01–F05 trong CODEX_DASHBOARD_TRACKING_AUDIT.md: chỉ nhận bằng chứng SPCK đúng buổi; không che lần nộp FAILED sau sửa nháp hoặc trong dữ liệu lịch sử; chỉ dùng lớp Running/Active thật để xác định cấp kế tiếp; giữ thời hạn bổ sung SPCK 15 ngày trong nguồn dùng chung và áp dụng 7 ngày riêng cho Trang chủ/quét tuần; không phục hồi danh sách cũ khi quét thành công trả rỗng. Giữ dữ liệu thật, quy tắc duyệt và bằng chứng nộp cũ. Thêm các ca kiểm tra tái hiện, chạy G1–G4 trên bản sao cô lập, rồi yêu cầu Audit Round 2. Không mở rộng sang thiết kế lại giao diện hay thay đổi nghiệp vụ khác.

**Kết luận cuối: VERDICT: NO-GO.**

