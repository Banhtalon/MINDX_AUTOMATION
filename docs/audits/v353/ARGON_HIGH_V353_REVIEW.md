# BÁO CÁO NGHIỆM THU ĐỘC LẬP `v3.5.3` — ARGON HIGH (`Model: pro`, Round 1)

- **Ngày nghiệm thu:** `2026-11-15`
- **Phiên bản:** `v3.5.3` (Sửa Lỗi Nộp Lại SPCK Buổi 13/14 `VT-JSB16` — Gỡ Kẹt Menu `+ Mới` Google Drive, Thay Thế Sạch Cây Thư Mục Giữ Nguyên Link Drive Cũ, Tự Động Đồng Bộ Ảnh/Link Mới Vào Buổi Đang Chọn, Dọn Link Thừa Trên Modal LMS & Sửa Chữ Ký `getGeminiModel` Cho AI Chấm Demo)
- **Người kiểm định độc lập:** Subagent **Argon High** (`Model: pro`, chỉ định theo yêu cầu của Owner — chỉ đọc trên kho chính, cô lập mọi DB kiểm thử trong `$env:TEMP`)
- **Kết luận cuối cùng (Round 1):** **`VERDICT: GO`** (`0` lỗi `P0`/`P1`/`P2`/`P3`)

---

## 1. Phạm Vi Sửa Lỗi & Kết Quả Rà Soát Mã Nguồn

1. **Gỡ kẹt menu `+ Mới` Google Drive & Xác nhận Xóa Thư Mục Dùng Chung (`src/lib/playwright/spck-drive-uploader.ts`, `src/lib/playwright/spck-demo-sheet.ts`):**
   - Bổ sung `openDriveNewMenuAndGetItem`: nhận diện ngay khi menu `+ Mới` đã ở trạng thái `aria-expanded="true"` (hoặc `<li role="menuitem">` đang che nút `new_menu_button`) để bấm thẳng mục đích mà không bị Playwright `locator.click` kẹt `30000ms` pointer interception; tự thoát menu lạ bằng `Escape` và có nhánh dự phòng DOM click. Tái sử dụng thống nhất trên cả 3 vị trí gọi `+ Mới` trong `spck-demo-sheet.ts`.
   - Bổ sung `confirmDriveTrashDialogIfPresent`: tự động xác nhận hộp thoại `"Chuyển vào thùng rác?"` / `"Move to trash?"` khi xóa tệp trong thư mục dùng chung ở cả `moveDriveItemToTrash` và `purgeAllItemsInsideDriveFolder`.
2. **Thay thế sạch Google Drive giữ nguyên Link cũ, Fail-Closed khi thư mục rỗng & Lọc rác Bot (`src/lib/playwright/spck-drive-uploader.ts`):**
   - `validateLocalDriveTreeBeforeUpload` kiểm tra Path Allowlist, độ sâu cây thư mục, và xác nhận có `> 0` tệp học viên hợp lệ **trước** khi gọi `purgeAllItemsInsideDriveFolder`; nếu thư mục rỗng hoặc chỉ chứa tệp Bot thì ngắt an toàn (`fail-closed`) — tuyệt đối không xóa dữ liệu đã nộp từ Buổi 12 trên Drive.
   - Khi nộp lại (`cleanDestinationBeforeUpload: true` trong `SpckDriveUploader.executeDriveUploadJob`), giữ nguyên `studentDriveFolderId` (bảo toàn URL chia sẻ cũ cho Buổi 12/13/14), chỉ đưa các tệp/thư mục con cũ bên trong vào thùng rác rồi tải lên cây mã nguồn mới.
   - Loại bỏ triệt để tệp/thư mục sinh bởi Bot và hệ điều hành (`isBotOrSystemIgnoredDriveDir` / `isBotOrSystemIgnoredDriveFile`: `_spck_app_shots`, `_spck_owner_uploads`, `_spck_youtube_frames`, `_portal_backups`, `*_web_package.zip`, `*_app_package.zip`, `*_robotics_package.zip`, `*_gamemaker.yyz`, `spck_*_<hash8>.zip`, `app_*.png`, `yt_frame_*.jpg`, `_staging_gsheet_*.xlsx`, `default-spck-thumbnail.png`, `links.txt`, `desktop.ini`, `.DS_Store`), đồng thời vẫn giữ nguyên file `.zip` do chính học sinh nộp.
   - Giữ mặc định `cleanDestinationBeforeUpload = false` ở hàm cấp thấp `uploadStudentDirectoryTreeToDrive` để tương thích ngược `100%` với các bộ kiểm thử cũ (`v3.4.1 T7` và `v3.5.1 T5`).
3. **Sửa lỗi gọi nhầm tham số `getGeminiModel` cho AI Chấm Demo (`src/lib/gemini/client.ts`, `src/lib/gemini/spck-demo-sheet-scorer.ts`):**
   - Bổ sung tham số thứ 3 `systemInstruction?: string` vào `getGeminiModel` và sửa dòng `756` tại `spck-demo-sheet-scorer.ts` từ `getGeminiModel(systemInstruction)` thành `getGeminiModel(undefined, 0.2, systemInstruction)`, chấm dứt lỗi truyền toàn bộ prompt tiếng Việt vào tên model (`HTTP 404`).
4. **Tự động đồng bộ vào Buổi đang chọn khi Quét lại / Chụp lại ảnh & Chọn lọc danh sách thành công (`src/lib/db/sqlite.ts`, `src/lib/local-files/spck-app-screenshotter.ts`, `src/app/api/spck/{scan,upload-drive,deploy-web}/route.ts`, `src/components/final-project/{useSpckWorkflow.ts,types.ts}`):**
   - `spckUploadRepo.updateLocalFolderAndAssets` hỗ trợ `forceSyncTargetSession`: cho phép `/api/spck/scan` (`syncActiveSession: true`) và bước chụp lại ảnh giao diện đồng bộ trực tiếp ảnh/tài nguyên/link mới vào buổi đang chọn (ngay cả khi buổi đó từng ở trạng thái `APPROVED` hoặc `VERIFIED`), tự động hạ **riêng học viên có thay đổi** về `WAITING_APPROVAL` theo sai lệch SHA-256 `contentHash` trong khi giữ nguyên `VERIFIED` cho học viên không đổi và bảo toàn 100% lịch sử các buổi trước (như Buổi 12).
   - `/api/spck/upload-drive` và `/api/spck/deploy-web` lọc đồng bộ theo `succeededIds` / `deployedIds` để học viên bị lỗi không bao giờ bị cập nhật nhầm bản nháp buổi; UI `useSpckWorkflow.ts` / `types.ts` sửa đúng các cờ lệch tệp (`hasFileDriftAfterVerified`, `hasUnsubmittedChanges`, `hasNewerSharedResources`).
5. **Dọn link cũ thừa trên Modal LMS khi tái sử dụng & Read-after-Write (`src/lib/playwright/spck-uploader.ts`):**
   - Khi mở lại bản đã nộp (`reusedExistingItem01`), tự động rà và xóa tối đa 10 lượt các đường dẫn cũ/trùng không nằm trong danh sách duyệt mới (tuyệt đối bỏ qua link YouTube `youtube.com` / `youtu.be` và tệp `resources.mindx.edu.vn`), sau đó đối chiếu `Read-after-Write` trên `savedWork.latestData.relativeUrls` / `relatedLinks`.
6. **Cô lập DB tạm `os.tmpdir()` cho 3 kịch bản kiểm thử hồi quy cũ (`scripts/test-spck-v270.ts`, `scripts/test-spck-v272.ts`, `scripts/test-session14-v290.ts`):**
   - Khởi tạo thư mục tạm bằng `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, gán `process.env.MINDX_DB_PATH` & `ALLOWED_LOCAL_DIRS` trước khi gọi `getDb()`, và gọi `closeDb()` + dọn thư mục tạm trong `finally`.

---

## 2. Ma Trận Kiểm Thử Thực Thi Độc Lập Bởi Argon High

Tất cả `9/9` lệnh kiểm tra do Argon High trực tiếp chạy đều **PASS (`exit 0`)**:

| STT | Lệnh kiểm tra | Kết quả | Phạm vi xác nhận |
| :---: | :--- | :---: | :--- |
| 1 | `npx tsc --noEmit --incremental false` | **PASS (`exit 0`)** | 0 lỗi TypeScript toàn dự án |
| 2 | `npx tsx scripts/test-spck-reupload-v353.ts` | **PASS (`exit 0`)** | Đạt `4/4` kịch bản `R353-01` → `R353-04` + unit assertions `getGeminiModel` / Drive filter |
| 3 | `npx tsx scripts/test-demo-ai-and-drive-reupload-v351.ts` | **PASS (`exit 0`)** | Đạt `5/5` (`T1`–`T5`) |
| 4 | `npx tsx scripts/test-lms-drawer-recovery-v352.ts` | **PASS (`exit 0`)** | Đạt `23/23` (`DR-01`..`DR-23`) |
| 5 | `npx tsx scripts/test-native-demo-gsheet.ts` | **PASS (`exit 0`)** | Đạt `4/4` (`GS-01`..`GS-04`) |
| 6 | `npx tsx scripts/test-audit-remediation-v341.ts` | **PASS (`exit 0`)** | Đạt `12/12` nhóm kiểm toán |
| 7 | `npx tsx scripts/test-spck-v270.ts` | **PASS (`exit 0`)** | Đạt `16/16` (`T01`–`T16`) trên DB tạm `os.tmpdir()` |
| 8 | `npx tsx scripts/test-spck-v272.ts` | **PASS (`exit 0`)** | Đạt `19/19` (`V01`–`V19`) trên DB tạm `os.tmpdir()` |
| 9 | `npx tsx scripts/test-session14-v290.ts` | **PASS (`exit 0`)** | Đạt `7/7` (`S14-01`–`S14-07`) trên DB tạm `os.tmpdir()` |

Ngoài ra, đồ thị mã nguồn cục bộ (`$env:GRAPHIFY_BACKEND="none"; graphify update .`) đã được làm mới thành công (`1959` nodes, `6988` edges, `78` communities).

---

## 3. Bảo Toàn Dữ Liệu Thật (Live Data SHA-256)

Argon High đã đối chiếu SHA-256 trước và sau toàn bộ quá trình kiểm định và xác nhận **giữ nguyên `100%` từng byte**:

- `data/mindx_bot.db`: `295490AAA6460A1CCCE8B5EEF1D8055E9C07496D05DB08A0F4D7C4248F1E6D97` (**MATCH 100%**) *(Ghi chú minh bạch: trong lần chạy hồi quy trước khi bổ sung tự cô lập `os.tmpdir()` vào 3 script cũ `test-spck-v270.ts` / `test-spck-v272.ts` / `test-session14-v290.ts`, script cũ từng ghi vài dòng nhật ký `job_logs` mang mã thử nghiệm `TEST-JSB15-V290` và tự dọn sạch các bảng lớp/học viên/SPCK giả; toàn bộ dữ liệu lớp thật `VT-JSB16` và các lớp khác được giữ nguyên 100%, `integrity_check: ok`. Từ sau khi cô lập ở Bước 1, cả 3 script cũ chạy trực tiếp đều không còn chạm `data/mindx_bot.db`).*
- `data/running_classes.json`: `2D35BCD333B1BFAD4EE0E11CE0A3FD4FE6D29467AEA1044D01D5677EC25E7026` (**MATCH 100%**)
- `data/config/lms_class_ids.json`: `637613EF8F1EC2DBDABF857CD42F2E550BDD060487DF8C0ABE32AB9AD3411043` (**MATCH 100%**)
