# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP (`v3.4.9`) — TUẦN TỰ ÊM ÁI & KIỂM TRA GỘP 1 LẦN CUỐI LỚP (`GetClassById` 1-SHOT) KHI LƯU NHẬN XÉT BUỔI HỌC LÊN MINDX LMS

- **Phiên bản kiểm định:** `v3.4.9` (Round 1)
- **Ngày kiểm định:** `2026-11-14`
- **Đơn vị kiểm định độc lập:** `@reviewer-v349` (Independent QA Reviewer — Argon Medium)
- **Kết luận nghiệm thu:** **VERDICT: GO** (`0` lỗi P0 / P1 / P2 / P3 mở)

---

## 1. BỐI CẢNH & MỤC TIÊU NÂNG CẤP (`v3.4.9`)

- **Bài toán thực tế:** Ở các phiên bản trước, khi lưu nhận xét cho lớp đông học viên (ví dụ `10` học viên), sau mỗi lần bấm `Save` và chờ `UpdateSlotComment` trả về, hệ thống phải mở lại modal nhận xét lần thứ 2 cho từng học viên để đọc lại DOM (`2 × N` lần mở/đóng hộp thoại). Quá trình mở/đóng liên tục `20` lần hộp thoại MUI trên MindX LMS làm tăng thời gian chờ và tạo tải render lớn trên trình duyệt khi mạng chậm.
- **Giải pháp kiến trúc `v3.4.9` ("Tuần tự êm ái + Kiểm tra gộp 1 lần cuối lớp"):**
  1. **Lưu tuần tự êm ái (`1` lần mở modal / học viên):** Giữ nguyên kỷ luật `SequentialTaskQueue` đơn luồng và tuần tự từng học viên (`0` bấm `Save` song song, `0` mở nhiều dialog đè nhau), có nhịp nghỉ ổn định DOM (`120ms` / `400ms` trước khi mở, `300ms` sau khi đóng modal, `350ms` settle trong `catch` khi đã phát lệnh `Save`), tự dọn `.Forbidden` toast và hộp thoại kẹt.
  2. **Tinh chỉnh ngưỡng chờ `UpdateSlotComment` hợp lý:** Đặt ngưỡng chờ chính **`16000ms`** + gia hạn thông minh **`+5000ms`** khi vòng xoay `.MuiCircularProgress-root` vẫn đang chạy (`0` lần bấm `Save` lặp); nếu quá hạn sẽ đưa vào `postSaveTimeoutReconcileIds` để đối chiếu ở cuối lớp.
  3. **Kiểm tra gộp 1 lần cuối lớp (`GetClassById` 1-shot) kèm Lazy DOM Fallback:** Đối với lượt lưu nhiều học viên buổi thường (`validRecords.length >= 2 && !isCheckpointModal`), sau khi `UpdateSlotComment` trả `HTTP 200/201` (không có lỗi GraphQL), đóng hộp thoại êm và kiểm tra khóa CAS (`preDeferCas`) rồi xếp vào `pendingBatchVerifyIds` ở trạng thái tạm `{ success: true, verified: false }` (chưa ghi `VERIFIED` vào SQLite). Cuối lớp, thực hiện **đúng 1 lần** lấy `GetClassById` mới (Thử 1 bấm nút `RefreshIcon` ngay trong Drawer; Thử 2 đóng & mở lại Drawer nếu Thử 1 không phát gói tin `GetClassById`), đối chiếu toàn bộ học viên cùng lúc và chỉ mở lại modal View-Mode DOM cho những trường hợp cần fallback (máy chủ trả rỗng do replica lag, thiếu gói `GetClassById`, hoặc trùng tên thiếu CRM ID).

---

## 2. ĐÁNH GIÁ KỸ THUẬT MÃ NGUỒN CHI TIẾT

### 2.1. `src/lib/playwright/save-comments.ts` — Tuần tự êm ái, Defer an toàn & Đối chiếu gộp 1-Shot cuối lớp
1. **Đệm nghỉ tuần tự & Tự làm sạch UI (`lines 830–993, 1488–1597, 1789–1797`):**
   - Trước mỗi học viên đều gọi `LmsHelpers.ensureCleanDialogAndToast(page, interceptor)` và kiểm tra `slotItem` còn `.active`.
   - Có đệm nghỉ `prevTimedOut ? 400 : 120` ms trước khi bấm mở modal, `250ms` sau khi modal hiện, `300ms` sau khi đóng modal ở nhánh defer (`line 1597`), và `350ms` settle trong `catch` nếu `saveMutationDispatched === true` (`line 1791`).
   - Ngưỡng chờ `UpdateSlotComment` chính là `16000ms` (`line 1492`), gia hạn `+5000ms` khi hộp thoại còn mở + nút `Save` ẩn + `.MuiCircularProgress-root` đang xoay (`lines 1516–1551`), tuyệt đối **`0` lần click `Save` lặp**.
2. **Điều kiện kích hoạt `useDeferredBatchVerify` & Các ngoại lệ bắt buộc (`lines 1160–1162, 1581–1640`):**
   - `const useDeferredBatchVerify = validRecords.length >= 2 && !isCheckpointModal;` (`line 1584`):
     - Lớp/lượt lưu chỉ có **1 học viên** (`validRecords.length === 1` hoặc lưu thử 1 học viên) giữ nguyên luồng mở lại modal đối chiếu DOM tức thì.
     - **Buổi Kiểm tra / Checkpoint (`isCheckpointModal === true`, Buổi 4/5/8/9)** giữ nguyên luồng mở lại modal đối chiếu DOM tức thì (`detectedAnyCheckpointSession = true`).
     - Học viên đã khớp sẵn ở chế độ View-Mode (`alreadySavedAndVerifiedInViewMode === true`, `line 1160`) đóng modal và kiểm tra CAS tức thì, không đi vào nhánh defer.
   - Trước khi đưa vào `pendingBatchVerifyIds`, bắt buộc kiểm tra `!apiSuccess` (ném lỗi ngay nếu API lỗi), đợi modal đóng (`dialog.waitFor({ state: "hidden", timeout: 3000 })` kèm `closeModalSafely`), và kiểm tra `preDeferCas = checkEligibilityAndCas({ ..., requireNonDraft: true })`. Bản ghi trong SQLite vẫn giữ trạng thái `SAVING` và kết quả trả về tạm là `{ success: true, verified: false }` cho tới khi đối chiếu cuối lớp hoàn tất.
3. **Cơ chế lấy `GetClassById` 1 lần cuối lớp (`lines 1930–2101`):**
   - Hàm `waitForDispatchedGetClassResponse` (`lines 1966–2026`) lắng nghe sự kiện `page.on("request")` trong cửa sổ `dispatchWaitMs = 600ms`: nếu nút bấm hoặc mock тестовый không phát request `GetClassById` thật, hàm thoát ngay sau `~600ms` thay vì treo đủ `15000ms` (bảo đảm tương thích ngược 100% với `T280-02/03` và các mock đơn giản).
   - **Thử 1 (`lines 2031–2052`):** Tìm nút làm mới ngay trong Drawer (`button:has([data-testid="RefreshIcon"]), button[aria-label*="refresh" i], button[aria-label*="làm mới" i], button[title*="Làm mới" i]`) và bấm nếu hiển thị (`0` lần đóng/mở lại Drawer).
   - **Thử 2 (`lines 2054–2084`):** Chỉ khi Thử 1 không lấy được `clsPayload` hợp lệ mới đóng Drawer hiện tại và gọi `LmsHelpers.openClassDrawer(page, classCode)`.
4. **Phân loại đối chiếu máy chủ & Lazy View-Mode DOM Fallback (`lines 2286–2605`):**
   - `inspectServerAttendanceForRecord` phân loại chính xác 4 trạng thái từ `GetClassById`:
     - `EXACT_MATCH`: Khớp duy nhất 1 học viên (theo CRM `student.id` hoặc slug tên duy nhất `isUniqueSlug`) và nội dung sau khi giải mã HTML entities + `.normalize("NFC")` khớp 100% với `approvedText` $\rightarrow$ kiểm tra lại khóa CAS `requireNonDraft: true` rồi nâng lên `VERIFIED` (`0` lần mở lại modal).
     - `MISMATCH`: Đã có nội dung trên máy chủ nhưng lệch với `approvedText` (`SCT-08B`) $\rightarrow$ **Fail-closed ngay lập tức sang `FAILED`**, không gọi fallback DOM.
     - `EMPTY_LAG` hoặc `AMBIGUOUS_OR_MISSING` (hoặc `!isValidServerClassPayload`): Đẩy vào `fallbackDomQueue` để chạy **Lazy View-Mode DOM Read-after-Write** (`verifyStudentInViewModeDom`), đồng thời vẫn chặn nghiêm ngặt trường hợp trùng tên không có `data-student-id` trên DOM (`lines 2186–2191`).
   - **Pass 2B (`postTimeoutCandidates`, `lines 2566–2605`):** Đối với các học viên bị timeout `waitForResponse` ở lượt lưu chính, bắt buộc thỏa **ĐỒNG THỜI cả 2 điều kiện**: `serverCheck.status === "EXACT_MATCH"` trên `GetClassById` **VÀ** `verifyStudentInViewModeDom(rec)` khớp 100% trên DOM, kèm khóa CAS `requireNonDraft: true` (tôn trọng tuyệt đối `SCT-02..SCT-06`).
5. **Tương thích `node:vm` `stripTypeScriptTypes`:**
   - Kiểm tra trực tiếp bằng `module.stripTypeScriptTypes`: toàn bộ `save-comments.ts`, `lms-helpers.ts`, `sync-class.ts` không dùng `enum` hay constructor parameter properties, kiểm tra an toàn `typeof (page as any).on === "function"` / `.off === "function"`, biên dịch sạch 100%.

### 2.2. `src/lib/playwright/lms-helpers.ts` & `src/lib/playwright/sync-class.ts`
- **`lms-helpers.ts` (`lines 313–339`):** Vòng lặp kiểm tra mã lớp trong Drawer chờ `200ms` ở lượt đầu (`attempt === 0 ? 200 : 500`) giúp nhận diện Drawer nhanh hơn mà vẫn giữ đủ 50 lượt thử cho mạng chậm, và chỉ chụp `data/debug_drawer_content.png` khi `!matchesDrawer`.
- **`sync-class.ts` (`lines 1006–1054`):** Khi `options?.forceFreshDrawer` bật và Drawer đang mở đúng lớp `sameClassDrawer`, ưu tiên bấm nút `RefreshIcon` trong Drawer trước và kiểm tra `freshClassByIdRequests.size > 0`; nếu không phát sinh request `GetClassById` mới thì tự động đóng Drawer để mở lại mới như cũ.

---

## 3. KẾT QUẢ THỰC THI 7 CỔNG KIỂM THỬ BẮT BUỘC & PROBE ĐỐI KHÁNG (TRONG `$env:TEMP`)

Toàn bộ các cổng kiểm thử và kịch bản phá hoại đều chạy trong thư mục tạm `$env:TEMP` (`$env:MINDX_DB_PATH` & `$env:MINDX_RUNNING_CLASSES_PATH` trỏ vào `$env:TEMP` và tự xóa sạch sau khi chạy):

| Cổng kiểm thử | Lệnh thực thi (cô lập trong `$env:TEMP`) | Kết quả | Chi tiết nghiệm thu |
| :--- | :--- | :---: | :--- |
| **Gate 1 — TypeScript** | `npx tsc --noEmit --incremental false` | ✅ **PASS (`exit 0`)** | `0` lỗi kiểu dữ liệu trên toàn bộ dự án + `module.stripTypeScriptTypes` PASS 3/3 tệp. |
| **Gate 2 — Suite `v3.4.8 / v3.4.9`** | `npx tsx scripts/test-save-comments-timeout-v348.ts` | ✅ **PASS (`exit 0`)** | Đạt **9/9** kịch bản `SCT-01` $\rightarrow$ `SCT-08B`:<br>- `SCT-01..SCT-07`: Giữ nguyên 100% cơ chế chống timeout giả `v3.4.8`.<br>- `SCT-08A`: Lưu tuần tự `10` học viên `VT-C4K-PTI12` $\rightarrow$ đúng `10` lần bấm `Save`, `10` lần mở modal (không mở lại lần 2), `1` lần gọi `GetClassById` qua `RefreshIcon`, `10/10 VERIFIED`.<br>- `SCT-08B`: Phát hiện 1 học viên lệch nội dung trên `GetClassById` $\rightarrow$ fail-closed `2 VERIFIED, 1 FAILED`. |
| **Gate 3 — Codex Repros** | `npx tsx scripts/test-phase4-codex-repros.ts` | ✅ **PASS (`exit 0`)** | Đạt **100%** toàn bộ các vòng kiểm định `Round 1 -> Round 17`. |
| **Gate 4 — LMS Reliability** | `npx tsx scripts/test-lms-reliability-v280.ts` | ✅ **PASS (`exit 0`)** | Đạt **5/5** bài kiểm thử `T280-01 .. T280-05` (không bị treo bởi `waitForDispatchedGetClassResponse`). |
| **Gate 5 — Checkpoint Suite** | `npx tsx scripts/test-checkpoint-v300.ts` | ✅ **PASS (`exit 0`)** | Đạt **5/5** kịch bản buổi Kiểm tra `CP-01 .. CP-05` (`100%`). |
| **Gate 6 — Streamline S3** | `npx tsx scripts/test-streamline-v340-s3.ts` | ✅ **PASS (`exit 0`)** | Đạt **100%** toàn bộ bài kiểm thử Màn 1 `/session-comments` (`S3.1..S3.7` & `S3-01..S3-08`). |
| **Gate 7 — Open LMS Button** | `npx tsx scripts/test-session-comments-open-lms.ts` | ✅ **PASS (`exit 0`)** | Đạt **6/6** bài kiểm thử `OL-01 .. OL-06` + Chromium headless E2E. |
| **Adversarial Probes (`ADV-01..ADV-04`)** | `probe-v349.ts` (4 kịch bản phá hoại độc lập chạy trong `$env:TEMP` và tự dọn sạch) | ✅ **PASS (`exit 0`)** | - **ADV-01 (Lazy DOM Fallback khi Replica Lag):** Batch 3 học viên (`STU_LAG_01` khớp `GetClassById` $\rightarrow$ mở modal `1` lần, `VERIFIED`; `STU_LAG_02` server rỗng do replica lag nhưng DOM View-Mode khớp $\rightarrow$ tự động mở modal lần `2` và nâng lên `VERIFIED`; `STU_LAG_03` server rỗng + DOM lệch $\rightarrow$ mở modal lần `2` và chặn fail-closed `FAILED`).<br>- **ADV-02 (Khóa CAS `requireNonDraft: true` giữa chừng batch):** Giáo viên sửa nhận xét `STU_LAG_02` về `DRAFT` ngay trước khi đối chiếu gộp cuối lớp kết thúc $\rightarrow$ chặn nâng lên `VERIFIED`, bảo toàn nguyên vẹn `DRAFT` và văn bản mới sửa tay.<br>- **ADV-03 (Buổi Checkpoint nhiều học viên):** Lớp có 2 học viên ở Buổi 5 Checkpoint (`isCheckpointModal = true`) $\rightarrow$ tuyệt đối không đi qua `useDeferredBatchVerify` (`getClassByIdCount === 0`), mở lại modal từng học viên (`2` lần/em) đối chiếu DOM tức thì và đạt `2/2 VERIFIED`.<br>- **ADV-04 (Nút `RefreshIcon` bị liệt không phát gói tin):** `waitForDispatchedGetClassResponse` phát hiện `0` request sau `~600ms` (không treo `15s`, tổng thời gian chạy `6.2s`) và tự động chuyển sang Thử 2 đóng/mở lại Drawer, đạt `2/2 VERIFIED`. |

---

## 4. KIỂM CHỨNG BẢO TOÀN 100% SHA-256 DỮ LIỆU THẬT

Kiểm tra bằng `node -e` (`fs.readFileSync`) trước và sau toàn bộ quá trình kiểm thử:

- `data/mindx_bot.db`:
  - Trước kiểm thử: `04D317ED9C788BE0A8D26C44F731CA03B16C078B5CD5B8D9DC553F48274795B4`
  - Sau kiểm thử: `04D317ED9C788BE0A8D26C44F731CA03B16C078B5CD5B8D9DC553F48274795B4` (**Khớp 100%**)
- `data/running_classes.json`:
  - Trước kiểm thử: `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C`
  - Sau kiểm thử: `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C` (**Khớp 100%**)

---

## 5. KẾT LUẬN NGHIỆM THU

- **Danh sách lỗi phát hiện (P0 / P1 / P2 / P3):** `0` lỗi.
- **Quyết định nghiệm thu:**

VERDICT: GO
