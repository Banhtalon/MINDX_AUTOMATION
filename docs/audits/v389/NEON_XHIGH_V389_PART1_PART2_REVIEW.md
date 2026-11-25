# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `Gemini 4 Neon (XHigh)` — `v3.8.9` (PHẦN 1 `/admin-center` & PHẦN 2 ROBOTICS SPCK + PURE-NODE LMS WRITE API)

- **Ngày kiểm định:** `25/11/2026`
- **Reviewer độc lập:** `Gemini 4 Neon (XHigh)` (`model: "gemini-4-neon-xhigh"`, worker `neon-v389-auditor`)
- **Môi trường kiểm định:** 100% cô lập trong `os.tmpdir()`, bảo toàn tuyệt đối `100%` chữ ký SHA-256 trên toàn bộ dữ liệu thật trong `data/`
- **Kết luận cuối cùng (Round 3):** **`VERDICT: GO`** (`0` lỗi mở, đóng trọn **`13/13`** phát hiện qua 3 vòng gồm `F01`–`F11` & `R2-F01`–`R2-F02`)

---

## 1. Xác Minh Toàn Vẹn Dữ Liệu Thật (`100%` SHA-256 MATCH)

| Tệp dữ liệu thật | SHA-256 Baseline & Sau Kiểm Định | Trạng thái |
|---|---|---|
| `data/mindx_bot.db` | `CE4B1EB24767DE60F8CC19DD8A7793B5C29B90A2774A13D0FDA51F422EFA2E4C` | **MATCH 100%** |
| `data/running_classes.json` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | **MATCH 100%** |
| `data/config/lms_class_ids.json` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | **MATCH 100%** |

---

## 2. Toàn Bộ Cổng Kiểm Thử Đã Chạy Sau Bản Vá Cuối (`exit 0`)

- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-admin-center-v389.ts` (`[AC389-01..06]` + `F05`/`F06`/`F07` regression) $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-spck-robotics-and-lms-write-v389.ts` (`[ROB389-01..02, API389-03..07]` + `F01`/`F02`/`F03`/`F04`/`F08`) $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-robotics-demo-templates-v389.ts` (`[ROB-TPL-01..05]`) $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-admin-center-v350.ts` (`[AC-01..AC-13]`) $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-spck-streamlined-v355.ts` (`[R355-01..R355-05]`) $\rightarrow$ **`exit 0`**
- `npx.cmd tsx scripts/test-spck-v360.ts` (`[V360-01..05]` + Round-38) $\rightarrow$ **`exit 0`** *(chạy bởi Agent chính sau bản sửa tương ứng)*
- `npx.cmd tsx scripts/test-drive-thumbnails-v363.ts` (`[V363-01..06]`) $\rightarrow$ **`exit 0`** *(chạy bởi Agent chính sau bản sửa tương ứng)*
- Toàn bộ probe đối kháng cô lập Round 1 (`PROBE_1..9`), Round 2 (`R2-P01..P06`) và kiểm chứng trực tiếp Round 3 của `Gemini 4 Neon (XHigh)` $\rightarrow$ **`PASS`** (`0` temp sót).

*(Ghi chú môi trường: `graphify.exe` bị Windows Application Control policy chặn thực thi cục bộ trên máy chủ nên đồ thị AST Graphify không cập nhật tự động được trong lượt này).*

---

## 3. Bảng Tổng Hợp Đóng Phát Hiện (`13/13 CLOSED`)

| Mã | Mức độ | Tóm tắt lỗi & vị trí | Khắc phục & Vòng đóng |
|---|---|---|---|
| `F01` | **P0** | `findSlotBySessionNumber` (`src/lib/lms/lms-write-client.ts`) so `Number(s.index) === sessionNumber` gây lệch +1 buổi trên LMS 0-based (`0..13`, làm B12 trỏ sang B13 và xóa B12 xóa nhầm B13). | Chuẩn hóa 0-based `sessionNumber - 1` (hỗ trợ cả lát cắt 0-based `[11..13]` và 1-based nếu có `index === 14`), sửa seed test `v389` sang `index: sn - 1`. **CLOSED Round 2**. |
| `F02` | **P1** | (a) Coding `CONTENT` bị ghi nhầm nhận xét Robotics & trần `1.25`; (b) Lớp miễn SPCK (`PTB`/`CSB`) bị lỗi fail-closed ở bước đối chiếu `DEMO` (`0/5`). | Khóa `formatRoboticsAwardRankingHtmlForLms` chỉ cho Robotics; bỏ qua `DEMO` & kiểm tra `DEMO` cho `isAdminSpckExemptClass` khi LMS không có vùng `DEMO`. **CLOSED Round 2**. |
| `F03` | **P1** | Cờ `anyMutationDispatched` / `anyEvalMutationDispatched` đặt *trước* mutation & Step A Summary nuốt lỗi nên HTTP 502 ở lệnh ghi đầu tiên không fallback sang Playwright. | Chỉ bật cờ sau khi `runLmsWriteGql` thành công; tách riêng `summaryMutated` và `anyStudentEvalMutated` để lỗi hạ tầng trước mutation luôn fallback cleanly về Playwright. **CLOSED Round 2**. |
| `F04` | **P1** | `spck-scanner.ts` loại toàn bộ `_spck_owner_uploads/owner_*` khỏi gallery Robotics và cho `ownerUploadImages[0]` chiếm `Thumbnail *` khi thiếu ảnh chân dung. | Tách rõ `isOwnerThumbFile` (`thumb_*`, `thumb_gdrive_*`, `chan_dung_*` vs `^owner_*`), bảo toàn ảnh Robot `owner_*` trong gallery và fallback Logo MindX cho `Thumbnail *`. **CLOSED Round 2**. |
| `F05` | **P1** | `admin-lms-scanner.ts` cập nhật `latestHomeworkSessionNumber` ở Buổi 1 hoặc khi 1 HV nộp sớm BTVN buổi hiện tại gây cảnh báo giả `lowSubmissionWarning`. | Chỉ cập nhật `latestHomeworkSessionNumber` cho buổi đã đến hạn (`sessionNumber < currentSessionNumber`), giữ `expectedCount = 0` khi chưa có buổi đến hạn. **CLOSED Round 2**. |
| `F06` | **P2** | `hasLmsSlotTimePassed` (`admin-lms-scanner.ts`) lệch múi giờ với ISO nửa đêm VN (`T17:00:00Z` / `T00:00:00+07:00`), naive ISO, và `startTime` rỗng có `endTime`. | Bổ sung `parseTimestampAssumeVnIfNaive`, `isVnWallClockMidnight` và ưu tiên `startTime`/`timeRange`/`timeSlot`/`fallbackTimeSlot` trước `endTime`. **CLOSED Round 2**. |
| `F07` | **P2** | Quét 1 lớp không xóa `PENDING`; `extractTeachersFromList` không ưu tiên `isActive !== false`, khớp nhầm `"Teaching Staff"` (`includes("ta")`), thiếu lọc trùng `teacherAttendance`; `letterByStudentId` bị đè bởi bản ghi rỗng. | Prune cả khi `SINGLE_CLASS`, điều chỉnh `totalClasses`, ưu tiên `isActive !== false`, dùng regex `/\bta\b/`, lọc trùng `assistantTeacher`, ưu tiên bản ghi thư hợp lệ & đọc `studentLetters` trong Playwright fallback. **PARTIAL Round 2 (`R2-F01`) -> CLOSED Round 3**. |
| `F08` | **P2** | `runLmsWriteGql` bỏ qua retry 401/403 khi `MINDX_LMS_API_URL` được set; thiếu `LMS_GET_CLASS_BY_ID_SAFE_QUERY`; `.replace(...)` hỏng `$&`/`$$50`; gửi placeholder `"default_student_letter"`. | Đi qua `lmsHttpClient.gql` khi trùng URL mặc định LMS + thêm retry 401/403 cho URL tùy chỉnh; thêm `SAFE_QUERY`; dùng callback `() => ...` trong `.replace`; nạp template chuẩn khi `sourceContent` rỗng và bỏ placeholder giả. **CLOSED Round 2**. |
| `F09` | **P2** | Lệch xếp hạng & Quill #4 giữa UI (`buildEnrichedSession14EvalList`), API Write (tính cả HV nghỉ) và Playwright fallback (không truyền `awardRank` + thiếu `isAbsent`). | Hợp nhất `buildEnrichedSession14EvalList` (chỉ HV active + đọc trạng thái vắng Buổi 14 từ `session_feedbacks`) cho cả UI, API Write & Playwright fallback. **CLOSED Round 2**. |
| `F10` | **P2** | `spck-app-screenshotter.ts` truyền `--no-sandbox` vô điều kiện khi mở HTML học sinh & chưa lọc inline `on*=`/`<iframe>`. | Lọc `on*=`, `<iframe>`, `<object>`, `<embed>`, `<meta http-equiv="refresh">`, chèn CSP `script-src 'none'; object-src 'none';` (chuỗi `'''...'''` an toàn) và chạy Chrome **sandbox mặc định trước**, chỉ fallback `--no-sandbox` nếu thất bại. **CLOSED Round 2**. |
| `F11` | **P3** | `student-portal-server.ts` gọi `scanStudentSpckFolderAsync` thiếu `{ classId, isRobotics }` cho lớp Robotics. | Truyền `{ classId, isRobotics: isRoboticsClassCode(...) }` tại cả `processStudentSubmission` và `restoreStudentPreviousBackup` (import `isRoboticsClassCode` từ `sqlite.ts`). **CLOSED Round 2**. |
| `R2-F01` | **P2** | Nhánh Playwright fallback `studentLetters` (`admin-lms-scanner.ts:5599`) truyền sai biến `{ payload: ... }` & `operationName: "FindStudentLettersPagination"` với `LMS_FIND_STUDENT_LETTERS_BY_CLASS_QUERY`. | Sửa thành `gql(lettersQ, { classId: lmsId }, "FindStudentLettersByClass")` khớp 100% schema & `lmsHttpClient`. **CLOSED Round 3**. |
| `R2-F02` | **P3** | Nhánh Playwright fallback (`session14-eval-uploader.ts:1156`) trên LMS thật cần luôn chuẩn hóa Quill #4 qua `formatRoboticsAwardRankingHtmlForLms`. | Dùng `formatRoboticsAwardRankingHtmlForLms` khi `isRobotics && (isLiveLms \|\| !cleanAwardRanking)` để đồng bộ 100% với API Write trong khi giữ tương thích mock DOM `[ROB-TPL-04]`. **CLOSED Round 3**. |
