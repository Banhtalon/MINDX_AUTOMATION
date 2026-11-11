# Kiểm định nghiệm thu độc lập v3.4.1 — Vòng 4

Ngày kiểm định: **11/11/2026**, Windows, Node **v24.21.0**.

Workspace duy nhất: `C:\Users\QQ\AppData\Local\Temp\mindx-v341-codex-review-r4`.

## 1. Kết luận dành cho Owner

**Đủ điều kiện nghiệm thu v3.4.1 trong phạm vi bản sao và các tình huống cục bộ được kiểm tra.**

- **14/14 lệnh bắt buộc PASS**, tất cả mã thoát 0. Bộ v3.4.1 chạy đủ **12 nhóm**, gồm T1–T11 và D3/B5/C2. SPCK v272 đạt **19/19 kịch bản**. Cổng G14 đã có đủ hai launcher thật và PASS.
- **F3-01, F3-02 CLOSED**; F01–F08 và F2-01–F2-04 đều đủ bằng chứng đóng trong phạm vi ghi dưới đây. Không còn P0/P1/P2 mở từ những phát hiện này và các đường kiểm định Stage A–D.
- Probe bổ sung Vòng 4 đạt **30/30 mục**, gồm **28 tiến trình Node mới hoàn toàn**, kiểm cả SQLite pending bằng 1 và bằng 0; thêm kiểm tra tạo/nâng cấp cấu trúc SQLite và giữ cờ qua lưu/mở lại.
- Đối chiếu cuối: **20.467/20.467 tệp có sẵn ngoài `_review_evidence/` giữ nguyên SHA-256; 0 sửa, 0 thêm, 0 mất ở trạng thái bàn giao**. **Có sai lệch cô lập tạm thời trong các lượt thiết lập đầu**, được công khai tại mục 2.3; không thay đổi tệp có sẵn của sản phẩm.

Kết luận này cho phép đội triển khai chuyển sang bước Stage E theo kế hoạch đã duyệt. Lượt auditor này **không sửa ba tài liệu trạng thái, không commit/push**, không truy cập dự án gốc hay tài khoản thật.

## 2. Cách làm, cô lập và bảo toàn tệp

### 2.1 Tài liệu và ranh giới bằng chứng

Đã đọc `PROJECT_STATE.md` trước tiên; đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, kế hoạch triển khai, báo cáo Vòng 3, toàn bộ bảy nguồn probe được yêu cầu và diff trong `_audit_refs/`. Đối chiếu thêm báo cáo các vòng trước khi xác định ý nghĩa F01–F08/F2-01–F2-04. Kết luận gắn với **tệp hiện tại và bản kê SHA-256**, không lấy kết quả lịch sử thay cho lượt chạy mới.

Không mở đường dẫn dự án gốc, bộ nhớ hay skill ngoài workspace; không gọi Git tìm ngược thư mục cha. Bản sao **không có `.git`, `data/mindx_bot.db` hoặc `data/running_classes.json`**. Vì vậy không có cơ sở tuyên bố đã kiểm chứng hash dữ liệu thật hay HEAD/GitHub; các dữ liệu này không được mang vào lượt thử.

### 2.2 Bộ chạy thử cuối cùng

Mã bộ chạy: [round4-run.cjs](round4-run.cjs), [round4-guard.cjs](round4-guard.cjs). Mỗi lệnh có thư mục riêng dưới `_review_evidence/runs/`; đặt `TEMP`, `TMP`, `TMPDIR`, `MINDX_DB_PATH`, `MINDX_CONFIG_DIR`, `MINDX_RUNNING_CLASSES_PATH`, `ALLOWED_LOCAL_DIRS`, cache npm và tệp cấu hình npm vào đó; `MINDX_DISABLE_PORTAL_TUNNEL=1`. Chromium dùng `_review_evidence/browsers`; Python dùng chế độ Qt không mở cửa sổ.

Một số test lịch sử tự ghi đè biến đường dẫn hoặc dùng cứng `data`, `temp_submissions`, `playwright-auth`. Bộ nạp trước của auditor chuyển các đường dẫn đó vào vùng bằng chứng, kể cả trước khi SQLite/Python nhận đường dẫn; chặn ghi bằng Node ra ngoài bằng chứng. Các lần đọc Node tới đường dẫn ngoài workspace, ngoại trừ thư mục chương trình Node, được từ chối tại ranh giới hệ thống tệp. Không sửa nguồn sản phẩm, test, assertion, thuật toán, kết quả SQLite hay phản hồi nghiệp vụ để đạt cổng.

Đối với probe gây lỗi, chỉ thay đầu nối lỗi đọc/ghi, đổi tên, chương trình con hoặc xếp Drive trong bộ nhớ của tiến trình thử; không sửa tệp nguồn. Xếp Drive được thay bằng bộ đếm để quan sát chính xác 0/1 lần, không ghi Google Drive thật. Các thử giao diện dùng trang giả lập/local; bộ Drive Vòng 3 dùng Locator thật của Chromium để kiểm tra phần tử hiển thị.

### 2.3 Sai lệch cô lập tạm thời và xử lý

**Không tuyên bố mọi lần ghi thử trong toàn phiên đều ở `_review_evidence/` ngay từ đầu.** Trong các lượt khởi tạo trước khi hoàn thiện chuyển hướng đường dẫn:

1. SQLite ghi trực tiếp qua thư viện native, không đi qua bộ chuyển hướng `fs` ban đầu, đã tạo **một tệp mới** `data/tmp-test-teaching-v320.db` (233.472 byte). Tệp này **không tồn tại trong bản kê trước**. Đã chuyển nguyên byte vào [bootstrap-test-teaching-v320.db](bootstrap-test-teaching-v320.db), hash `94c2628c44fd33dc9c5ce5ca76e0b3df1679ba94756f1df7bb5acc26087e0e37` giữ nguyên. Xem [bootstrap-isolation-note.json](bootstrap-isolation-note.json).
2. Python trong lượt SPCK ban đầu tạo một cây **thư mục trống, không có tệp** dưới `temp_submissions`. Đã chuyển nguyên cây vào `empty-bootstrap-directories/`. Lệnh dọn thư mục đã bị bộ kiểm soát tự động chặn, không cung cấp lý do chi tiết; sau đó dùng cách chuyển lưu giữ, không xóa dữ liệu.

Bản kê trung gian đã giữ lại tại [round4-sha256-interim-comparison.json](round4-sha256-interim-comparison.json), thể hiện đúng tệp phát sinh, không che bằng cách đổi baseline. Đã khắc phục bộ chạy bằng chuyển hướng `path.resolve` trước khi SQLite/Python nhận đường dẫn và chạy lại đủ cổng/probe. Một lượt probe của auditor cũng sửa cách đọc mảng đường dẫn `attachments` thay vì nhầm đó là mảng object; bản lỗi được lưu riêng, không tính là lỗi sản phẩm.

Các lỗi khởi động do trích dẫn đường dẫn Windows, pipe của tsx và cơ chế trả lỗi của bộ chặn đọc được xử lý ở mã bằng chứng. Log `G01.log`–`G14.log` và `round4-gates.json` là lượt hoàn chỉnh sau cùng. Các lượt thiết lập thất bại không được tính là cổng PASS và không phải phát hiện sản phẩm. Hash cuối chứng minh mọi **tệp có sẵn** vẫn nguyên vẹn và các tệp phát sinh đã được đưa về đúng vùng bằng chứng.

### 2.4 SHA-256 trước/sau

Nguồn: [round4-sha256-before.json](round4-sha256-before.json), [round4-sha256-after.json](round4-sha256-after.json), [round4-sha256-comparison.json](round4-sha256-comparison.json), [round4-report-data.json](round4-report-data.json). Bộ kê không theo liên kết ra ngoài; baseline không có symlink.

SHA tổng hợp dưới đây được tính từ các dòng `đường dẫn<TAB>kích thước<TAB>SHA-256`, sắp thứ tự, nối bằng LF; không chứa timestamp của bản kê.

| Nhóm | Trước | Sau | SHA-256 tổng hợp giống nhau | Kết quả |
|---|---:|---:|---|---|
| Toàn bộ tệp ngoài _review_evidence | 20.467 | 20.467 | `05a7a488159c5e95a5e9fb3cc3431c3052a8abe07a9341ea76395e5ce8d1691e` | KHỚP |
| Sản phẩm, tài liệu, cấu hình, kiểm thử, tham chiếu | 3.897 | 3.897 | `11d8b1efddff17dc16998da4a1b1d1ed90cce417c5b5057dd97733bbad3d3243` | KHỚP |
| Mã src và scripts | 152 | 152 | `424bf2a1a1d260417e331279a566786432a7734236471ec12ee62c00fc96b89e` | KHỚP |
| Hồ sơ lịch sử docs/audits | 3.692 | 3.692 | `2aaf5a601166905f84a6fd405adafc3e0193c2d3ad5929b116f7042f47ee9cd5` | KHỚP |
| Tham chiếu _audit_refs | 14 | 14 | `e36057eb63a669763516314a0338870b186682f4bc781f4b2300e2c48ff7c6af` | KHỚP |
| Thư viện node_modules | 16.570 | 16.570 | `fa18004420c6d8a8bc62f2dbd08283de79b9111c41d76702a6a37665cd36f76d` | KHỚP |

Kết quả so sánh: **changed=[]; added=[]; removed=[]; pass=true**. Đây là bảo toàn tệp của bản sao được cung cấp, không phải xác nhận toàn bộ dự án/dữ liệu thật ngoài workspace.

## 3. Bảng đủ 14 cổng bắt buộc

| # | Lệnh bắt buộc | Kết quả | Mã thoát | Giây | Bằng chứng |
|---:|---|---|---:|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | **PASS** | 0 | 1.305 | [G01](G01.log) |
| 2 | `npx tsx scripts/test-audit-remediation-v341.ts` | **PASS** | 0 | 6.752 | [G02](G02.log) |
| 3 | `npx tsx scripts/test-portal-directory.ts` | **PASS** | 0 | 1.998 | [G03](G03.log) |
| 4 | `npx tsx scripts/test-streamline-v340-s1.ts` | **PASS** | 0 | 1.592 | [G04](G04.log) |
| 5 | `npx tsx scripts/test-streamline-v340-s3.ts` | **PASS** | 0 | 1.727 | [G05](G05.log) |
| 6 | `npx tsx scripts/test-streamline-v340-s5.ts` | **PASS** | 0 | 11.916 | [G06](G06.log) |
| 7 | `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS** | 0 | 38.373 | [G07](G07.log) |
| 8 | `npx tsx scripts/test-streamline-v340-s7.ts` | **PASS** | 0 | 1.759 | [G08](G08.log) |
| 9 | `npx tsx scripts/test-teaching-project-v320.ts` | **PASS** | 0 | 21.468 | [G09](G09.log) |
| 10 | `npx tsx scripts/test-report-card-v330.ts` | **PASS** | 0 | 1.761 | [G10](G10.log) |
| 11 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | 0 | 26.015 | [G11](G11.log) |
| 12 | `npx tsx scripts/test-phase5.ts` | **PASS** | 0 | 1.711 | [G12](G12.log) |
| 13 | `npx tsx scripts/test-phase6.ts` | **PASS** | 0 | 14.759 | [G13](G13.log) |
| 14 | `npx tsx scripts/test-phase7.ts` | **PASS** | 0 | 1.190 | [G14](G14.log) |

Mọi lệnh chạy nguyên script dự án, không bỏ assertion. [G02.log](G02.log) xác nhận đủ 12 nhóm; [G07.log](G07.log) có 4/4 nhóm S6; [G11.log](G11.log) có V01–V19; [G14.log](G14.log) xác nhận cả TASK-7.1, TASK-7.2 và TASK-7.3.

## 4. Đóng F3-01: trạng thái chờ xác nhận bền vững và xử lý lỗi an toàn

### 4.1 Mã hiện tại

- `src/lib/db/sqlite.ts:184,368–372,2328–2333,2377`: cột `pendingPortalConfirmation INTEGER NOT NULL DEFAULT 0`; thêm cột khi mở DB cũ; `upsert` không được truyền cờ vẫn giữ giá trị đã có.
- `src/lib/student-portal/student-portal-server.ts:479–549`: `inspectDiskPortalUnconfirmedMarker` gọi trực tiếp `fs.lstatSync`, **không gọi `existsSync`**. Lỗi lstat ENOENT/ENOTDIR được phân biệt với lỗi không xác minh được. Symlink, không phải tệp, lỗi đọc và JSON/metadata không hợp lệ giữ trạng thái UNVERIFIABLE. Wrapper chỉ trả false khi ABSENT.
- `student-portal-server.ts:1666,1824–1881`: nhận bài ghi pending=1; hàm `hasUnconfirmedSubmission` kiểm bộ nhớ, SQLite rồi marker. Lỗi tra SQLite cũng giữ chờ. Bản ghi đã được giáo viên xác nhận rõ ràng có cơ chế bỏ qua marker cũ không gỡ được vì lỗi ổ đĩa.
- `src/app/api/spck/save-draft/route.ts:214–232,443–449,525–533`: khi pending, cờ xác nhận cũ trong trình duyệt không đủ; phải có `confirmTeacherAssignment === true` cùng yêu cầu xác nhận. Lưu thường giữ pending=1, không xếp Drive; xác nhận rõ ràng ghi pending=0 rồi xếp Drive.
- `src/app/api/spck/scan/route.ts:171–184,362`: quét lại cũng kiểm pending, không tự xác nhận vì tên thư mục khớp.

### 4.2 Kiểm chứng độc lập Vòng 4

Mã: [round4-focused.mts](round4-focused.mts), [round4-cold-child.mts](round4-cold-child.mts). Kết quả: [round4-focused-results.json](round4-focused-results.json), [log](round4-focused.log); log từng tiến trình tại `cold-db0-*.log` và `cold-db1-*.log`.

Mỗi ca: tạo bài bằng **hàm nhận Portal thật của sản phẩm**, dừng Portal, xóa hai bộ nhớ tạm, đặt pending bằng 1 hoặc giả lập bằng 0, đóng SQLite rồi khởi động **một tiến trình Node mới**. PID con được kiểm khác PID cha. Các ca lỗi đọc/lstat được gây đúng tại marker của học sinh tổng hợp. Classifier lấy nguyên thân hàm hiện tại, chạy qua TypeScript trong hộp kiểm tra; luồng lưu/quét gọi trực tiếp mã sản phẩm.

| Biến thể marker | Classifier | DB pending=1 | DB pending=0 |
|---|---|---|---|
| Marker đúng lớp/học sinh | PRESENT | Giữ chờ | Giữ chờ |
| readFile EACCES | UNVERIFIABLE | Giữ chờ | Giữ chờ, lỗi đọc thực sự được kích hoạt |
| lstat EACCES | UNVERIFIABLE | Giữ chờ | Giữ chờ, lỗi lstat thực sự được kích hoạt |
| readFile ENOENT sau lstat thành công | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| JSON bị cắt/hỏng | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| JSON thiếu thông tin `{}` | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| JSON mảng `[]` | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| JSON `null` | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| Junction/symlink thật tới thư mục trong vùng thử | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| Marker là thư mục thường | UNVERIFIABLE | Giữ chờ | Giữ chờ |
| lstat ENOENT | ABSENT | Cột SQLite vẫn giữ chờ | Không pending, ca đối chứng phân loại |
| lstat ENOTDIR | ABSENT | Cột SQLite vẫn giữ chờ | Không pending, ca đối chứng phân loại |
| JSON hợp lệ thuộc lớp khác | ABSENT | Cột SQLite vẫn giữ chờ | Không pending, ca đối chứng phân loại |
| JSON hợp lệ thuộc học sinh khác | ABSENT | Cột SQLite vẫn giữ chờ | Không pending, ca đối chứng phân loại |

**28/28 tiến trình mới PASS.** Trong **24 ca có pending**, sau khi xóa nhớ tạm và đặt lại cờ DB trước từng thao tác:

1. `hasUnconfirmedSubmission` có hoặc không truyền thư mục đều true.
2. Lưu nháp với `isConfirmedByTeacher:true` cũ nhưng không có explicit-confirm: **HTTP 200, xác nhận=0, pending=1, 0 lần gọi xếp Drive**.
3. Quét API: **HTTP 200, xác nhận=0, pending=1, 0 lần xếp Drive**.
4. Xác nhận rõ ràng: **HTTP 200, xác nhận=1, pending=0, đúng 1 lần xếp Drive**; xóa nhớ tạm rồi hỏi lại không còn pending.

Bốn ca DB=0/ABSENT là đối chứng âm của classifier, không dùng để tuyên bố bài Portal mất cả hai dấu vẫn có thể được nhận diện. Không dùng các ca ABSENT đó làm bằng chứng “lưu thường bị chặn”. Khi DB pending=1, có thể không cần đọc marker; các ca DB=0 cố ý loại bỏ sự che chắn này và xác nhận lỗi đọc/lstat đã được kích hoạt. Classifier được kiểm tra **0 lần gọi existsSync tại marker**.

Kiểm tra SQLite bổ sung: [round4-db.mts](round4-db.mts), [round4-db-results.json](round4-db-results.json). Đạt: cấu trúc mới NOT NULL/default 0; lưu thiếu trường vẫn giữ pending=1; đóng/mở giữ pending=1; giả lập DB cũ không có cột rồi mở lại tự thêm cột, giữ nguyên bản ghi. Đây là DB tổng hợp, không thử nâng cấp DB thật.

**F3-01 CLOSED; đồng thời đóng phần còn lại của F2-02/F05/A3.**

## 5. Đóng F3-02: lỗi ghi marker không làm khuyết bài đang dùng

`student-portal-server.ts:1542` hoàn tất `writeDiskPortalUnconfirmedMarker(stagingDir, ...)` trước cả bước kiểm tra/bảo toàn nội dung thư mục đang dùng; đổi tên bài cũ sang rollback nằm sau đó tại dòng 1599. Không còn bước ghi marker nằm giữa việc chuyển bài cũ và hoán đổi bài mới.

Probe độc lập gây lỗi tại `writeFileSync` của đúng `portal_unconfirmed.json`, kiểm tra bản ghi SQLite thô và hash từng tệp trước–sau. Không mở lại Portal để phục hồi.

| Lỗi gây thử | Phản hồi | Lần đổi tên bài cũ | old.txt ngay sau lỗi | SQLite | Quét ngay | Thư mục staging/rollback còn sót |
|---|---|---:|---|---|---|---:|
| ENOSPC | success=false / R4_MARKER_ENOSPC | 0 | ONLY ORIGINAL SOURCE | Nguyên bản ghi | Thấy main.py và old.txt | 0 |
| EACCES | success=false / R4_MARKER_EACCES | 0 | ONLY ORIGINAL SOURCE | Nguyên bản ghi | Thấy main.py và old.txt | 0 |

**2/2 PASS**, mọi tệp bài cũ giữ hash; vị trí ghi lỗi thuộc staging; chưa chạm đổi tên bài cũ. Xem hai mục `R4-F302-*` trong [kết quả](round4-focused-results.json). Các ca P01/N01/N02 cũ vẫn được chạy lại để bảo đảm không làm mất cơ chế giữ rollback khi phục hồi cũng lỗi.

**Lưu ý về probe Vòng 3 nguyên bản:** [round3-marker-write.mts](round3-marker-write.mts) có assertion yêu cầu `activeBeforeRecovery === false` và 1 rollback, nhằm chứng minh lỗi cũ. Chạy nguyên nguồn trên bản sửa trả **exit 1, actual true !== expected false**, đúng tại assertion đó: bài cũ thực tế vẫn tồn tại. Không sửa probe lịch sử để biến kết quả này thành xanh. Hai ca nghiệm thu mới phía trên kiểm điều kiện đúng mới, bao gồm lỗi EACCES và SQLite/quét ngay lập tức. Vì vậy mã thoát 1 của probe tái hiện lỗi cũ **không được tính là một lỗi sản phẩm đang mở**.

**F3-02 CLOSED; A1 đủ điều kiện nghiệm thu trong các nhánh đã thử.**

## 6. G14 và hai tệp khởi động

Hai tệp có sẵn ở gốc bản sao, nội dung đầy đủ theo assertion gốc:

| Tệp | Số byte | SHA-256 |
|---|---:|---|
| start-bot.bat | 2.753 | `1ea28ac014605c038b6c9c58ad62f0eb1abbe4740c9d721b1ad5ca0059e745ca` |
| start-bot.command | 2.116 | `d18b8138042c747dfd1e6f96311b5fdac3c5b21ad1d45a0d6485bf55911afafd` |

`scripts/test-phase7.ts:488–520` kiểm tồn tại, shebang macOS, kiểm Node/node_modules, địa chỉ `127.0.0.1:3000` và `npm run dev`. **G14 PASS exit 0**. Không tạo launcher giả, không bỏ assertion. Chưa thực thi launcher macOS trên máy macOS hoặc kiểm đầy đủ thao tác nhấp đúp của người dùng.

## 7. Nghiệm thu toàn bộ phát hiện

| Mã | Kết luận | Bằng chứng mới trong Vòng 4 và giới hạn |
|---|---|---|
| F01 — Giữ bài/rollback khi lỗi | CLOSED | T1/T9, P01, N01; F3-02 bổ sung 2 lỗi ghi marker giữ nguyên ngay. P01 cố tình làm cả SQLite và phục hồi đổi tên cùng lỗi: giữ bản duy nhất tại rollback và trả đường dẫn để khôi phục. Không gọi đó là phục hồi tức thì khi chính thao tác phục hồi cũng bị gây lỗi. |
| F02 — Sao lưu đủ trước thay bài | CLOSED | P02/N02 gây lỗi đọc/copy/lstat và bản sao thiếu byte: dừng, bản gốc còn nguyên. P03 giữ protected/latest cho bài cũ 136.314.881 byte. |
| F03 — Drive tải đủ rồi mới dọn | CLOSED cục bộ | T7, N03 và 25 ca Locator thật; lỗi/busy trước/sau đọc danh sách đều 0 dọn, hoàn tất mới dọn 1. Không ghi Drive thật. |
| F04 — Không mất chữ Teaching đang sửa | CLOSED | P05 giữ Draft B và cờ chưa lưu khi phản hồi A đến; T3/T9, Teaching v320 và S6 đạt. |
| F05 — Nháp không tự xác nhận bài Portal | CLOSED | P06/N04; 28 tiến trình mới, riêng DB=0 buộc kiểm lớp đĩa; lưu/quét thường 0→0 và 0 xếp Drive, explicit-confirm mới 0→1. |
| F06 — Không mượn ảnh ngoại học sinh | CLOSED trong ma trận | P07, 7 ca N06, 14 biến thể Vòng 3; mỗi ảnh có vùng xanh hợp lệ, 0 đỏ ngoại học sinh, 960×540. Python nhúng biên dịch/chạy được; đã xem ảnh styleSheetDouble. |
| F07 — Đúng khóa và đúng buổi khi chọn barem | CLOSED | P09/N09/N14; 6 cặp token đúng kỳ vọng; 3 ca sai trả 400, 2 ca đúng trả 200. Không fallback tùy ý. |
| F08 — Không chạy chụp/chuẩn hóa Python đồng bộ trên luồng yêu cầu | CLOSED trong đường đã đo | P08/N08/N12/N13; ảnh Qt/GameMaker thật; 4 đường chuẩn hóa đều 0 spawnSync và còn nhịp xử lý khác. |
| F2-01 — Nhiều progress/error/dialog và lỗi kiểm tra | CLOSED | 25 ca với Locator thật kiểm 0/1/2/5 phần tử, trước/sau DOM; lỗi locator/first/isVisible đều chặn dọn. |
| F2-02 — Chờ xác nhận qua restart, scan, nhớ tạm | CLOSED | N04, 5 ca Portal Vòng 3, cold child Vòng 3 và 28 cold child Vòng 4, cả pending SQLite=0; không còn fail-open F3-01. |
| F2-03 — Python nhúng/ảnh không được xanh giả | CLOSED trong kiểm tra hiện tại | Python sau lớp TypeScript compile được; ảnh thật, pixel đối chứng đỏ >0; 14 ảnh xanh đúng và 0 đỏ ngoại học sinh. T9/T10 chuẩn chạy đạt. Không chạy lại bốn phép mutation ngoài bảy nguồn probe được cung cấp. |
| F2-04 — Chuẩn hóa ảnh JPEG fallback bất đồng bộ | CLOSED trong đường đã đo | normalizer/student/class/API: 0 spawnSync, nhịp >0, ảnh 960×540; Stop/timeout đóng tiến trình Python trực tiếp. |
| F3-01 — Đọc marker lỗi phải giữ chờ | CLOSED | Mục 4: read/lstat EACCES, JSON hỏng, symlink thật; DB=0 và DB=1, tiến trình mới; chỉ xác nhận rõ ràng mới nâng trạng thái và xóa cờ pending. |
| F3-02 — Ghi marker trước khi chuyển bài cũ | CLOSED | Mục 5: ENOSPC/EACCES giữ bài cũ, SQLite, hash và scan ngay; 0 lần đổi tên thư mục bài cũ. |

Quan sát phụ **N05 PASS**: máy chủ xác nhận=0 luôn hạ giao diện về false/WAITING_APPROVAL/hash rỗng nhưng giữ ghi chú. **N11 PASS**: 100 vòng thời gian thật không va chạm; đóng băng đồng hồ vẫn tạo thời gian tăng cho cả 4 mục, token cũ bị HTTP 409.

## 8. Stage A → D

| Hạng mục | Kết luận | Căn cứ |
|---|---|---|
| A1 — Staging, swap, backup, phục hồi | PASS các nhánh thử | T1/T9, P01–P03/N01–N02 và F3-02. Giữ rollback nếu cố tình làm cả phục hồi thất bại. |
| A2 — Đuôi cấm, độ sâu, trùng tên, tệp rỗng | PASS | T2 và Portal directory: chặn đuôi trước điều kiện độ sâu; không cắt cây; từ chối trùng hoa/thường; giữ tệp 0 byte hợp lệ khi tổng dữ liệu >0. |
| A3 — Giáo viên xác nhận bài tự nộp | PASS | Cột SQLite, classifier ba trạng thái, save-draft/scan và cold matrix tại mục 4. |
| A4 — Drive tải đủ cây rồi dọn | PASS cục bộ | T7, P04/N03, ma trận 25 ca thật về Locator; dọn sau thành công cả cây trong các ca giả lập. |
| B1 — Nháp Teaching không mất chữ | PASS | Số lần sửa cục bộ được chụp trước request; P05/T3/T9 giữ nháp mới. |
| B2 — Polling không ghi đè chữ đang gõ | PASS | T4/P06/N05 giữ nội dung dirty, nối Drive mới; cờ xác nhận cũ không được giữ khi máy chủ đã hạ về 0. |
| B3 — Khóa phiên bản cấu hình | PASS | courses/rubrics/quickTags/zaloTemplates: revision/timestamp cũ 409 sau 10 GET; đồng hồ cố định vẫn an toàn. |
| B4 — Trang chủ chỉ xong khi đủ học viên hợp lệ | PASS | T6: 1/20 VERIFIED chưa xong, 20/20 mới xong; xét active và không ABSENT. S6 đạt; giữ quy tắc tiến độ Teaching riêng. |
| B5 — Một hàng đợi khi mô-đun nạp lại | PASS cục bộ | `globalThis.__mindxSequentialTaskQueue`, nhóm D3/B5/C2. Chưa thử Next nạp lại giữa tác vụ dịch vụ thật. |
| C1 — Cô lập tài nguyên ảnh; ngoại lệ ảnh có chủ đích | PASS ma trận | Không mượn sibling/class; ảnh riêng vẫn xanh; HTML/CSS/QSS đã thử không rò đỏ. AGENTS/GEMINI có ngoại lệ ảnh rõ ràng. |
| C2 — Polling nhẹ; hash theo request | PASS | N15 HTTP 200/unchanged/0 đọc nội dung tệp; T4 và cache đạt; API list dùng cache trong request. |
| C3 — Chụp/chuẩn hóa không khóa luồng | PASS các đường đo | Qt/GameMaker/normalizer/student/class/API còn nhịp; Stop/timeout đóng Python trực tiếp. Không chứng nhận mọi cây tiến trình phức tạp trên Windows. |
| D1 — Gỡ thư viện trực tiếp và tệp chết | PASS mã/khai báo | 5 khai báo @google/genai/zod/autoprefixer/clsx/tailwind-merge không còn ở package.json và phần khai báo gốc lockfile; utils.ts không tồn tại. Giữ @google/generative-ai và @tailwindcss/postcss. Không cài lại thư viện. |
| D2 — Helper SPCK chung, giữ hồ sơ kiểm thử | PASS phạm vi | Page/hook dùng spck-ui-helpers; nguyên 3 ca R38-U-reload/class-race/note-race đều PASS; 3.692 tệp hồ sơ lịch sử giữ hash. Không tuyên bố đã chạy toàn bộ Round 38. |
| D3 — Chọn barem đúng, cầu nối Zalo | PASS | P09/N09/N14, S3/Phase5/Phase7; broadcast-generator chuyển sang bộ Zalo chung. Giữ mô-đun chấm bài cho kiểm thử cũ. |

## 9. Replay nguyên nguồn Vòng 1–3 và diễn giải

[round4-replay-source-verification.json](round4-replay-source-verification.json) ghi SHA-256 hai phía khớp **7/7 tệp**. Sáu bộ cha được chạy; `portal-cold-child.mts` được bộ extra khởi động như tiến trình riêng. Nguồn `_audit_refs` không thay đổi.

| Bộ | Mã/log | Kết quả và cách đọc |
|---|---|---|
| Vòng 1 P01–P09 | [Nguồn](round1-replay.mts), [log](round1-replay.log), [JSON](independent-probe-results.json) | 9 quan sát được đánh giá lại. P04 ghi PROBE_ERROR vì nguồn cũ không bắt ngoại lệ an toàn khi tải chưa xong; N03 bổ sung kiểm 0 dọn, không chỉ dựa mã thoát. |
| Vòng 2 extra N01–N11 | [Nguồn](round2-extra-replay.mts), [log](round2-extra-replay.log), [JSON](extra-probe-results.json) | 29 quan sát. Harness N03 cũ có strictErrors=40 khi nhiều phần tử vì không mô phỏng first() thu hẹp; hành vi vẫn 0 dọn. Ma trận Locator thật Vòng 3 giải quyết giới hạn này. |
| Vòng 2 focused N12–N16 | [Nguồn](round2-focused-replay.mts), [log](round2-focused-replay.log), [JSON](focused-probe-results.json) | 8 mục, gồm 3 ca UI lịch sử bên trong N16, đều đúng điều kiện. Ca Portal chỉ nộp text có 0 nhịp/không đi qua chuẩn hóa, không dùng riêng ca này để chứng minh fallback ảnh. |
| Vòng 3 independent | [Nguồn](round3-independent.mts), [log](round3-independent.log), [JSON](round3-independent-results.json) | **50/50 PASS, 0 FAIL**: 25 Drive, 5 Portal, 1 mục clock/4 phân vùng, 1 Python compile/đối chứng pixel, 14 ảnh, 4 luồng chuẩn hóa. |
| Vòng 3 extra và child | [Nguồn](round3-extra.mts), [child](portal-cold-child.mts), [log](round3-extra.log), [JSON](round3-extra-results.json) | **6/6 PASS**. Ba ca marker cũ được SQLite pending=1 chặn trước nên số lỗi fs kích hoạt=0; không dùng chúng thay thế kiểm lớp đĩa DB=0 Vòng 4. Stop khoảng 517 ms/13 nhịp; timeout khoảng 10.316 ms/638 nhịp, tiến trình trực tiếp đóng. |
| Vòng 3 marker-write | [Nguồn](round3-marker-write.mts), [log](round3-marker-write.log) | Exit 1 do assertion yêu cầu lỗi cũ xảy ra; actual activeOld=true chứng minh thay đổi. Nghiệm thu đúng điều kiện mới là 2/2 F302 Vòng 4. Không cộng probe cũ này vào số PASS tự động. |
| Vòng 4 focused | [Nguồn](round4-focused.mts), [child](round4-cold-child.mts), [JSON](round4-focused-results.json) | **30/30 PASS**; 28 tiến trình mới và 2 lỗi ghi marker. |
| Vòng 4 SQLite | [Nguồn](round4-db.mts), [JSON](round4-db-results.json) | PASS cấu trúc mới/cũ và độ bền pending. |

Đánh giá chéo dữ liệu quan sát bằng [round4-evaluate.cjs](round4-evaluate.cjs): [round4-replay-evaluation.json](round4-replay-evaluation.json) có **134/134 điều kiện đánh giá đạt, 0 không đạt**. Con số này gồm 132 quan sát/mục từ sáu bộ kết quả, 1 mục SQLite và 1 mục đối chiếu nguồn; không gọi đó là 134 bài test độc lập không trùng lặp.

Ảnh: 14 biến thể mỗi ca có **36.000 pixel xanh hợp lệ, 0 pixel đỏ ngoại học sinh**, kích thước 960×540; ảnh đỏ đối chứng có pixel đỏ nên bộ đếm không bị vô hiệu. Đã xem trực tiếp ảnh Qt styleSheetDouble để đối chiếu vùng xanh và phần giữ chỗ trung tính. Không chứng nhận mọi cú pháp HTML/Qt đều được hiển thị đầy đủ.

| Luồng chuẩn hóa Vòng 3 chạy lại | spawnSync | Nhịp bộ đếm 10 ms | Thời gian | Đầu ra |
|---|---:|---:|---:|---|
| normalizer | 0 | 7 | 113 ms | 960×540 |
| scanStudentSpckFolderAsync | 0 | 9 | 161 ms | 960×540 |
| scanClassSpckDirectoryAsync | 0 | 9 | 190 ms | 960×540 |
| POST /api/spck/scan | 0 | 9 | 259 ms | HTTP 200, 960×540 |

Các nhịp đo chứng minh Node còn xử lý việc khác trong đúng fixture được đo, không phải cam kết hiệu năng cả lớp hay số đo dưới tải thật.

## 10. Phạm vi đã/chưa xác nhận và việc tiếp theo

**Đã làm:** đọc/đối chiếu đường mã và kế hoạch Stage A–D; đủ 14 cổng; replay nguyên bảy nguồn; gây lỗi độc lập cold-process DB=0/1 và ghi marker ENOSPC/EACCES; thử SQLite cũ/mới; đo ảnh thật/pixel/nhịp; kiểm nội dung hai launcher; băm toàn bộ tệp ngoài bằng chứng trước–sau; ghi mã, log, JSON, ảnh và sai lệch thiết lập vào vùng bằng chứng.

**Kết quả:** hết các phát hiện P0/P1/P2 mở trong phạm vi kiểm định, Stage A–D đạt với các giới hạn đã nêu; mọi tệp sản phẩm có sẵn được bảo toàn. Các cổng PASS thuộc chính bộ tệp trong bản kê của lượt này.

**Chưa kiểm tra:** dữ liệu/tài khoản/lớp/dịch vụ thật; tải/xóa trên Drive thật; LMS/Teaching/Gemini thật; build phát hành; cài mới thư viện từ lockfile; thực thi launcher macOS; Git/HEAD/GitHub/sự trùng khớp với dự án gốc; mất điện/tháo ổ đĩa thật; tải đồng thời toàn lớp; toàn bộ cây Python con khi Stop/timeout; mọi định dạng/cú pháp ngoài ma trận; bốn mutation ảnh T9/T10 của vòng trước không có trong bảy nguồn được cung cấp. Không dùng việc PASS cục bộ để chứng nhận vận hành thật.

**Việc tiếp theo:** đội triển khai có thể thực hiện Stage E: cập nhật `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md`, gắn báo cáo và bằng chứng với đúng bản mã rồi đồng bộ GitHub theo kế hoạch Owner đã duyệt. Trước phát hành/vận hành thật, giữ riêng bước xác nhận build và luồng dịch vụ thật. Owner không cần chạy lệnh hay tác động dữ liệu thật để hoàn thành lượt kiểm định này.

VERDICT: GO
