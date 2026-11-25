# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP (`Gemini 4 Neon (XHigh)`) — BƯỚC 0 (`v3.8.9`: 10 MẪU BẢNG CHẤM ĐIỂM DEMO ROBOTICS & THANG ĐIỂM `Demo2024 | ROB`)

- **Ngày kiểm định:** `2026-11-25`
- **Model Kiểm định viên Độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `neon-auditor`)
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** — Đóng trọn **`6/6` phát hiện Vòng 1 (`F01`–`F06`)**, **`0` lỗi P0/P1/P2/P3 mở**, toàn bộ `8` cổng kiểm thử tự động & `6` probe tái kiểm định Round 2 (`R2-PROBE-01..06`) đều **PASS `exit 0`** trong môi trường cô lập `os.tmpdir()`.

---

## 1. Phạm vi kiểm định
- `scripts/generate-robotics-demo-templates.ts` & 10 file mẫu OOXML tại `data/config/demo-sheet-templates/{PREB,PREA,PREI,ARMB,ARMA,ARMI,SEMIB,SEMIA,SEMII,ROB}.xlsx` (khớp giáo trình `data/config/courses_syllabus.json` và thang `Demo2024 | ROB` trên MindX LMS: `1.25 / 0.75 / 1.0 / 0.5 / 1.5 = 5.0`).
- `src/lib/playwright/spck-demo-sheet.ts` (`COURSE_DEMO_TITLE_MAP`).
- `src/lib/gemini/spck-demo-sheet-scorer.ts` (`classifyDemoCriterion` cho R15 phụ huynh bình chọn & `extractDemoTemplateRubricStructure`).
- `src/lib/db/sqlite.ts` (`SESSION14_DEMO_LIMITS_ROBOTICS`, `parseSession14DemoScores`, `session14EvalRepo.saveDraft`).
- `src/lib/spck/spck-ui-helpers.ts` (`DEMO_SCORE_ITEMS_ROBOTICS_UI`, `getDemoScoreItemsForClassUi`).
- `src/lib/playwright/session14-eval-uploader.ts` (`demoKeys`, `demoValuesInDomOrder`, `demoLabelsInDomOrder` khớp DOM `Demo2024 | ROB`).
- `src/lib/local-files/spck-demo-score-reader.ts` (`resolveNextCourseWishLabel`, `buildClassSession14SummaryDraft`, `parseCategorySpansFromSheetXml`, `extractDemoScoresFromWorksheet`, bỏ qua tab placeholder `"Barem"`/`"Mẫu"`).

---

## 2. Kết quả kiểm định Vòng 1 & Vòng 2

| Mã phát hiện | Mức độ | Mô tả vấn đề (Vòng 1) | Trạng thái (Vòng 2) | Bằng chứng xác minh |
| :--- | :---: | :--- | :---: | :--- |
| **`F01`** | **P1** | `maxCritEndRow` ghim sàn `27` khiến nhận xét BGK tại `B27`/`C27` trên 10/10 mẫu Robotics bị bỏ sót (`judgeNote === ""`). | **CLOSED** | `R2-PROBE-01` & `ROB-TPL-02`: đọc trọn nhận xét BGK1 (`B27`) & BGK2 (`C27`), không rò tiêu đề hay ghi chú Cột G. |
| **`F02`** | **P2** | Ô `A26` trong 10 file mẫu Robotics mang chữ `"BGK1"` màu đỏ đậm trùng lặp cạnh `B26`. | **CLOSED** | `R2-PROBE-02` & `ROB-TPL-01`: cả 10/10 file `.xlsx` để trống `A26`, giữ `B26="BGK1"`, `C26="BGK2"`, `sheet2.xml` chuẩn `1.25/0.75/1/0.5/1.5`. |
| **`F03`** | **P2** | `extractDemoTemplateRubricStructure` dùng initial `27` làm `nhanXetRow = 28` lệch khỏi hàng `Nhận xét` (`R25`). | **CLOSED** | `R2-PROBE-03` & `ROB-TPL-01`: `nhanXetRow === 25` trên 10/10 mẫu Robotics (`24/24` mẫu khớp hàng `Nhận xét` thật). |
| **`F04`** | **P2** | Sửa 1 ô (hoặc lưu form UI) vượt trần trên bản ghi Robotics mới bị nhánh rebalance tự nâng điểm `problemSolving`. | **CLOSED** | `R2-PROBE-04` & `ROB-TPL-03`: bổ sung `allowLegacyRebalance`, sửa 1 ô hoặc full UI save chỉ kẹp ô sai về `0.5`, không sửa chéo `problemSolving`; bản ghi DB cũ `4.375` vẫn cân bằng đúng và giữ hash khi `saveDraft({ teacherNote })`/`approveDraft`. |
| **`F05`** | **P2** | `resolveNextCourseWishLabel` & Summary Buổi 14 bị lặp `"khóa khóa"` và gán nhầm `ARM = VEX IQ`, `SEMI = Robotics & Bán dẫn`. | **CLOSED** | `R2-PROBE-05` & `ROB-TPL-02`: chuẩn `26/26` mã khóa (`ARMB..ARMI = VEX GO Truy tìm bí ẩn Robot`, `SEMIB..SEMII = VEX IQ Sáng tạo Robot`), `0` lặp `"khóa khóa"`. |
| **`F06`** | **P3** | `getDemoScoreItemsForClassUi("VT-ROB-ARMA13")` khi bỏ trống tham số 2 trả nhầm thang Coding. | **CLOSED** | `R2-PROBE-06` & `ROB-TPL-01`: tự nhận diện Robotics theo `classId` khi không truyền override `false`. |

---

## 3. Các cổng kiểm thử đã chạy sau bản vá cuối (`100%` trong `os.tmpdir()`, `exit 0`)
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` → **PASS**
- `scripts/test-robotics-demo-templates-v389.ts` (`ROB-TPL-01..04` + hồi quy `F01`–`F06`) → **PASS**
- `scripts/test-demo-sheet-yellow-v365.ts` (`V365-01..03`, đủ `24/24` mẫu Coding & Robotics) → **PASS**
- `scripts/test-csi-demo-limits-v382.ts` (`CSI-01..04`, đủ `24/24` mẫu) → **PASS**
- `scripts/test-demo-sheet-resilience-v364.ts` (`V364-01..05`) → **PASS**
- `scripts/test-spck-v360.ts` (`V360-01..05` + `Round-38`) → **PASS**
- `scripts/test-session14-v290.ts` (`S14-01..07`) → **PASS**
- `R2-PROBE-01..06` (tái kiểm định độc lập Round 2 + `15` probe Vòng 1 trong `os.tmpdir()`) → **PASS**

---

## 4. Xác minh toàn vẹn dữ liệu thật (`100%` SHA-256 bảo toàn)
- `data/mindx_bot.db`: `ce4b1eb24767de60f8cc19dd8a7793b5c29b90a2774a13d0fda51f422efa2e4c`
- `data/running_classes.json`: `fcba555cbc9f75871ae6187f597e3884f3556ec2e3b77529e143d32c73d4ba40`
- `data/config/lms_class_ids.json`: `ac93c6a821e9d6fa8b148e82ec1d56b5ffeb627ee300935de97ae3a62f7fa188`
