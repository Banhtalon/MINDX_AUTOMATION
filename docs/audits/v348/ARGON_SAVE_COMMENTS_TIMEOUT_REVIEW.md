# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP (`v3.4.8`) — KHẮC PHỤC LỖI BÁO TIMEOUT GIẢ `page.waitForResponse: Timeout 15000ms exceeded` KHI LƯU NHẬN XÉT BUỔI HỌC LÊN MINDX LMS & TỰ ĐỘNG ĐỐI CHIẾU HỒI PHỤC 1-CHẠM

- **Phiên bản kiểm định:** `v3.4.8` (Round 1)
- **Ngày kiểm định:** `2026-11-14`
- **Đơn vị kiểm định độc lập:** `@reviewer-v348` (Independent QA Reviewer — Argon Medium)
- **Kết luận nghiệm thu:** **VERDICT: GO** (`0` lỗi P0 / P1 / P2 / P3 mở)

---

## 1. BỐI CẢNH SỰ CỐ THỰC TẾ (FORENSIC EVIDENCE)

- **Thời điểm & lớp xảy ra sự cố:** Sáng Thứ Bảy `2026-11-14 08:19`, giáo viên bấm lưu nhận xét Buổi 3 lớp `VT-ROB-ARMI13`.
- **Nguyên nhân gốc rễ:** Máy chủ GraphQL `lms-api.mindx.edu.vn` phản hồi chậm đột biến (`16s–22s`) trong khung giờ cao điểm sáng cuối tuần. Khi lưu học viên `Nguyễn Chấn Lâm` (`STU_VT-ROB-ARMI13_NGUYEN_CHAN_LAM`), `interceptor.waitForApiResponse` vượt ngưỡng cứng `15000ms` trong khi hộp thoại nhận xét vẫn đang mở và biểu tượng xoay `MuiCircularProgress-root` vẫn đang chạy thay chỗ nút `Save` (ghi nhận tại `data/debug_save_comment_error.png`). Vài giây sau máy chủ MindX lưu thành công đủ `7/7` học viên, nhưng SQLite cục bộ đã gắn `status = "FAILED"`, làm hiển thị cảnh báo `⚠️` giả trên `/session-comments` và giữ lớp `VT-ROB-ARMI13` ở mục việc cần làm trên Trang chủ `/`.

---

## 2. PHẠM VI & ĐÁNH GIÁ KỸ THUẬT MÃ NGUỒN (`v3.4.8`)

### 2.1. `src/lib/playwright/save-comments.ts` — Kiến trúc 3 tầng chống Timeout giả & Không click đúp `Save`
1. **Tầng 1A — Mở rộng ngưỡng chờ chính & Chuẩn hóa Unicode/HTML Entity (`lines 1106–1314`):**
   - Tăng `timeoutMs` của `waitForApiResponse` cho mutation `UpdateSlotComment|CreateSlotComment|SaveSlotComment|CommentMakeup` từ `15000ms` lên **`45000ms`**.
   - Bổ sung `.normalize("NFC")` và giải mã numeric HTML entities (`&#160;`, `&#xa0;`, `&#38;`, `&#60;`, `&#62;`, `&#34;`, `&#39;`) trong `saveMutationPredicate`, đồng thời **giữ nguyên allowlist thẻ Quill nghiêm ngặt** (`p|div|br|li|ul|ol` và `strong|b|em|i|u|span`) để không làm suy yếu hàng rào chống chèn thẻ HTML lạ (`Round 16/17`).
2. **Tầng 1B — Gia hạn chờ thông minh khi Spinner MUI đang xoay (`lines 1330–1373`):**
   - Khi hết `45000ms` vì lỗi `waitForResponse: Timeout` (và không phải lỗi thiếu điểm năng lực Checkpoint), kiểm tra đồng thời 3 điều kiện DOM:
     - `dialog.isVisible()` (hộp thoại vẫn mở),
     - `!(await saveBtn.isVisible())` (nút `Save` đã ẩn),
     - `dialog.locator('[role="progressbar"], .MuiCircularProgress-root').first().isVisible()` (vòng xoay đang chạy).
   - Tự động chờ thêm **`20000ms`** cho đúng gói tin mutation đang bay mà **tuyệt đối không bấm lại nút `Save` (`0` click lặp)**. Sau khi nhận phản hồi HTTP `200/201` không có lỗi GraphQL, tiếp tục thực hiện đầy đủ **DOM Read-after-Write** và kiểm tra khóa **CAS (`contentHash`, `finalText`, `status !== "DRAFT"`, `isActive`, `attendanceStatus`)** trước khi nâng lên `VERIFIED`.
3. **Tầng 2 — Pass 2B Đối chiếu máy chủ sau Timeout (`lines 1763–2206`):**
   - Chạy sau Pass 1 & Pre-Save Auto-Retry Pass 2, chỉ áp dụng cho các bản ghi đã bấm `Save` (`saveMutationDispatched = true`) nhưng bị `waitForResponse: Timeout` và chưa bị giáo viên sửa thành `DRAFT`.
   - Đóng hộp thoại còn mở, đóng Class Drawer hiện tại (ưu tiên nút `Back` hoặc `Escape`, kèm fallback click `.MuiBackdrop-root` tại `{ x: 10, y: 10 }`), sau đó gọi `LmsHelpers.openClassDrawer(page, classCode)` để bắt gói tin mạng mới **`GetClassById` (HTTP 200/201)** trực tiếp từ `lms-api.mindx.edu.vn`.
   - Kiểm tra nghiêm ngặt:
     - Phản hồi `GetClassById` hợp lệ, không có `errors[]`, đúng `classCode`/`classId` và đúng `slotNumber`.
     - Khớp duy nhất 1 học viên theo `student.id === rec.studentId` hoặc slug tên duy nhất trong lớp (`isUniqueSlug`, chặn hoàn toàn trường hợp trùng tên thiếu CRM ID).
     - Nội dung nhận xét trên máy chủ (`commentByAreas` / `comment` sau khi giải mã HTML entity & `.normalize("NFC")`) khớp 100% với `approvedText`.
     - Thực hiện **DOM Read-after-Write ở chế độ View-Mode** (hoặc mở rộng dòng Checkpoint vào `.ql-editor` đối với buổi Kiểm tra) với **`0` lần bấm `Save`**.
     - Kiểm tra lại khóa CAS (`contentHash`, `finalText`, `status !== "DRAFT"`, `isActive === 1`, `attendanceStatus !== "ABSENT"`) ngay trước khi cập nhật `VERIFIED` và xóa `errorMessage = null`.

### 2.2. `src/lib/playwright/sync-class.ts` & `src/app/api/session-comments/sync/route.ts` — Tự phục hồi 1-chạm qua nút `"🔄 Đồng bộ buổi học"`
1. **`forceFreshDrawer` (`sync-class.ts:1005–1031`):**
   - Đóng `[role="dialog"]` còn mở trước khi nhấn `Escape` / `Back` và bổ sung fallback click `.MuiBackdrop-root` (`{ x: 10, y: 10 }`) nếu Drawer vẫn hiển thị, đảm bảo `openClassDrawer` luôn kích hoạt request `GetClassById` mới.
2. **`syncLmsSlotCompletionToSqlite` (`sync-class.ts:1344–1393`):**
   - Bổ sung cờ `isExactMatchFailedOrApproved`: ngay cả khi `preferLmsVerified === false` (được dùng bởi `POST /api/session-comments/sync`), nếu bản ghi cục bộ đang ở `FAILED` hoặc `APPROVED` và có `finalText` chuẩn hóa khớp 100% với nhận xét thực tế trên `GetClassById` của LMS, hệ thống tự động nâng trạng thái lên `VERIFIED`, xóa sạch `errorMessage = NULL` và giữ nguyên định dạng `**in đậm**` trong `finalText`.
   - Bảo toàn nguyên vẹn:
     - Bản ghi `FAILED` hoặc `APPROVED` có nội dung khác với LMS **không** bị ghi đè.
     - Bản ghi `DRAFT` giáo viên đang gõ dở **không** bị ghi đè khi `preferLmsVerified === false`.

---

## 3. KẾT QUẢ THỰC THI CÁC CỔNG KIỂM THỬ BẮT BUỘC & PROBE ĐỐI KHÁNG (TRONG `$env:TEMP`)

| Cổng kiểm thử | Lệnh thực thi (cô lập trong `$env:TEMP`) | Kết quả | Chi tiết nghiệm thu |
| :--- | :--- | :---: | :--- |
| **Gate 1 — TypeScript** | `npx tsc --noEmit --incremental false` | ✅ **PASS (`exit 0`)** | `0` lỗi kiểu dữ liệu trên toàn bộ dự án. |
| **Gate 2 — Suite `v3.4.8`** | `npx tsx scripts/test-save-comments-timeout-v348.ts` | ✅ **PASS (`exit 0`)** | Đạt **7/7** kịch bản `SCT-01` $\rightarrow$ `SCT-07`: Spinner Grace Window (`0` click lặp), Pass 2B `GetClassById` + DOM Read-after-Write + Dashboard `allDone=true`, chặn cache DOM cục bộ thiếu server (`SCT-03`), chặn lệch nội dung (`SCT-04`), khóa CAS bảo vệ `DRAFT` (`SCT-05`), chặn trùng tên thiếu CRM ID (`SCT-06`), và tự xóa `FAILED` giả khi bấm `🔄 Đồng bộ buổi học` (`SCT-07`). |
| **Gate 3 — Codex Repros** | `npx tsx scripts/test-phase4-codex-repros.ts` | ✅ **PASS (`exit 0`)** | Đạt **100%** toàn bộ các vòng kiểm định `Round 1 -> Round 17` (bao gồm `node:vm` `stripTypeScriptTypes` harness & allowlist thẻ Quill). |
| **Gate 4 — LMS Reliability** | `npx tsx scripts/test-lms-reliability-v280.ts` | ✅ **PASS (`exit 0`)** | Đạt **5/5** bài kiểm thử `T280-01 .. T280-05` (ranh giới Pre-Save Retry vs Post-Save Non-Retry `F01`, chống lưu nhầm buổi `F02`, 6 Guardrail dữ liệu `F04`). |
| **Gate 5 — Adversarial Probes** | `probe-v348.ts` (6 kịch bản phá hoại độc lập `ADV-01..ADV-06` chạy trong `$env:TEMP` và tự dọn sạch) | ✅ **PASS (`exit 0`)** | - **ADV-01 & ADV-04:** Nhận xét NFD đối chiếu với HTML NFC chứa `&#160;` & `&#x20;` trên buổi **Checkpoint** (mở rộng dòng `[ĐNL]` sang `.ql-editor` trong Pass 2B, `1` lần bấm `Save` duy nhất) $\rightarrow$ `VERIFIED`.<br>- **ADV-02:** `GetClassById` trả `HTTP 500` hoặc trả nhầm mã lớp `VT-OTHER-CLASS` $\rightarrow$ Fail-closed giữ nguyên `FAILED`.<br>- **ADV-03:** Học viên chuyển sang `ABSENT` giữa chừng trước khi Pass 2B kết thúc $\rightarrow$ Chặn nâng lên `VERIFIED`.<br>- **ADV-05:** `syncLmsSlotCompletionToSqlite` (`preferLmsVerified: false`) nâng `APPROVED` khớp NFD/NFC lên `VERIFIED`, giữ nguyên `APPROVED` lệch nội dung, giữ nguyên `SAVING`, và chặn đối chiếu trùng tên thiếu CRM ID.<br>- **ADV-06:** Cả `save-comments.ts` và `sync-class.ts` đều biên dịch sạch qua `module.stripTypeScriptTypes`. |

---

## 4. KIỂM CHỨNG BẢO TOÀN 100% SHA-256 DỮ LIỆU THẬT

Kiểm tra bằng `node -e` (`fs.readFileSync` an toàn với SQLite WAL) trước và sau toàn bộ quá trình kiểm thử:

- `data/mindx_bot.db`:
  - Trước kiểm thử: `04D317ED9C788BE0A8D26C44F731CA03B16C078B5CD5B8D9DC553F48274795B4`
  - Sau kiểm thử: `04D317ED9C788BE0A8D26C44F731CA03B16C078B5CD5B8D9DC553F48274795B4` (**Khớp 100%**)
- `data/running_classes.json`:
  - Trước kiểm thử: `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C`
  - Sau kiểm thử: `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C` (**Khớp 100%**)

---

## 5. KẾT LUẬN NGHIỆM THU

- **Danh sách lỗi phát hiện (P0 / P1 / P2 / P3):** `0` lỗi.
- **Quyết định nghiệm thu:** **VERDICT: GO** — Bản sửa lỗi `v3.4.8` đủ điều kiện phát hành và đồng bộ lên nhánh chính.
