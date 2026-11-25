# Báo cáo Kiểm định Độc lập — `Gemini 4 Neon (XHigh)` (`v3.8.9` Bước 0 mở rộng: Đấu nối 10 Thư mục Google Drive `ROBOTICS - SPCK`)

- **Ngày kiểm định:** `25/11/2026`
- **Kiểm định viên độc lập:** `neon-drive-auditor` (`gemini-4-neon-xhigh`)
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** (`3/3` phát hiện Round 1 `F01–F03` **CLOSED**, `0` lỗi P0/P1/P2 mở, `F04` P3 advisory ghi nhận ngoài phạm vi chặn, `100%` SHA-256 dữ liệu thật `data/` bảo toàn).

---

## 1. Phạm vi kiểm định & Callers đã rà soát
- `src/lib/playwright/spck-drive-uploader.ts`: Bổ sung `UMBRELLA_SPCK_ROOT_FOLDER_ID` (`1HM7clsAO31a_Dp6DLO02vVZf4yt4EMhG`), `ROBOTICS_SPCK_ROOT_FOLDER_ID` (`1AEprw35bOnkwyzBFTbefZd55o3jhkNJz`), 3 thư mục cụm (`ROBOTICS_PRE_GROUP_FOLDER_ID`, `ROBOTICS_ARM_GROUP_FOLDER_ID`, `ROBOTICS_SEMI_GROUP_FOLDER_ID`), `ROBOTICS_SPCK_COURSE_FOLDER_MAP` (`10` khóa `PREB..SEMII`, `ROB -> RBT - 4+`), trải vào `CODING_SPCK_COURSE_FOLDER_MAP` (`SPCK_COURSE_FOLDER_MAP`), `isSpckRootFolderId`, `resolveTargetCourseDriveFolderId`, `resolveDriveUploadParentOrThrow`, và mở rộng lọc file/đuôi Robotics.
- `src/lib/playwright/spck-demo-sheet.ts`: Tích hợp `resolveTargetCourseDriveFolderId` trước bước gọi AI pre-score, xuất `DriveFolderItemSummary` & `listDriveFilesInFolder` nhận diện `Bảng chấm điểm buổi (Demo|cuối khóa|cuối khoá)` cùng 6 đuôi tệp Robotics.
- `src/lib/local-files/spck-demo-score-reader.ts`: Bổ sung nhận diện `"bang cham diem buoi cuoi khoa"` trong `resolveDefaultDemoSheetPathForClass`.
- `src/app/api/spck/upload-drive/route.ts`: Trả `HTTP 400` cho lỗi lệch nhóm thư mục khóa học.
- Callers rà soát sạch: `src/app/api/spck/list/route.ts`, `src/app/api/spck/create-demo-sheet/route.ts`, `src/lib/student-portal/student-portal-server.ts`, `src/components/final-project/useSpckWorkflow.ts`, `src/app/final-project/page.tsx`.

---

## 2. Phát hiện Round 1 & Xác minh Đóng tại Round 2
1. **F01 [P2 -> CLOSED]:** `resolveDriveUploadParentOrThrow` chặn lệch nhóm (`ROBOTICS_PRE_GROUP_FOLDER_ID` + `VT-ROB-ARMA18`) và khóa chưa cấu hình (`TEST_ROBO_UNCONFIGURED_01`) ngay từ đầu ở cả `uploadClassSpckToGoogleDrive` (trước nhánh `0` bản ghi, fast-skip digest không đổi và `taskQueue.enqueue`) lẫn `executeDriveUploadJob` (`forceReupload: true`), `0` lần mở `BrowserManager`; giữ fast-skip đúng khi cùng nhóm; `POST /api/spck/upload-drive` trả `HTTP 400`; `PTB`/`CSB` bị chặn ở cả 3 thư mục gốc nhưng cho phép link lớp riêng.
2. **F02 [P2 -> CLOSED]:** `createAndUploadClassDemoSheetToDrive` kiểm tra `preCheckDriveFolderId` + `routedDrive` **trước** `generateDemoSheetAiPreScoresForClass` -> `0` lượt gọi Gemini AI và `0` mở trình duyệt khi lệch nhóm hoặc URL Drive sai định dạng.
3. **F03 [P2 -> CLOSED]:** Xác minh trực tiếp `listDriveFilesInFolder` trên Chromium DOM có `—` nhận diện đúng `{ isGoogleSheet: true, isFolder: false, isExcelFile: false }` cho cả `"cuối khóa"` lẫn `"cuối khoá"` (kể cả khi có tiền tố `PREA14-` hoặc hậu tố `- ARMA18`), phân biệt đúng 6 đuôi tệp Robotics (`isFolder: false`), và `isBotOrSystemIgnoredDriveFile` lọc sạch file `.xlsx` tạm ở cả hai kiểu bỏ dấu.
4. **F04 [P3 Advisory — Ghi chú tương lai]:** Lớp chưa cấu hình tương lai có `-ROB-` (ví dụ `VT-ROB-VEX01`) sẽ khớp tiền tố `ROB` vào `RBT - 4+`; không ảnh hưởng 10 khóa hiện tại hay `TEST_ROBO_UNCONFIGURED_01`.

---

## 3. Toàn bộ cổng kiểm thử sau bản vá cuối (`exit 0`, cô lập `os.tmpdir()`)
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` -> **PASS** (`exit 0`)
- `npx.cmd tsx scripts/test-robotics-demo-templates-v389.ts` (`ROB-TPL-01..05` + hồi quy `F01–F03`) -> **PASS** (`5/5`)
- `npx.cmd tsx scripts/test-demo-sheet-resilience-v364.ts` (`V364-01..05`) -> **PASS** (`5/5`)
- `npx.cmd tsx scripts/test-native-demo-gsheet.ts` (`GS-01..05`) -> **PASS** (`5/5`)
- `npx.cmd tsx scripts/test-drive-tray-and-autoprep-v354.ts` (`R354-01..06`) -> **PASS** (`6/6`)
- Probe độc lập Round 2 (`R2-F01..R2-F03`, tự dọn sạch `%TEMP%`) -> **PASS** (`3/3`)

---

## 4. Đối chiếu SHA-256 dữ liệu thật trong `data/` (bảo toàn 100%)
- `data/mindx_bot.db`: `CE4B1EB24767DE60F8CC19DD8A7793B5C29B90A2774A13D0FDA51F422EFA2E4C`
- `data/running_classes.json`: `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40`
- `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
