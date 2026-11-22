# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `v3.8.2` — `Gemini 4 Neon (XHigh)` (Round 2: `VERDICT: GO`)

- **Ngày kiểm định:** 2026-11-22
- **Reviewer độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `neon-auditor-v382` trong `os.tmpdir()`)
- **Kết luận cuối cùng:** **`VERDICT: GO`** (`4/4` phát hiện Vòng 1 đã đóng hoàn toàn, `0` lỗi P0/P1/P2/P3 mở)

---

## 1. Phạm vi thay đổi (`v3.8.2`)
1. `src/lib/db/sqlite.ts`: Bổ sung `isCsiClassCode()`, cập nhật trần điểm Demo chuẩn MindX LMS cho `CSI` (`algorithm: 2.0`, `creativity: 0.5`, `communication: 1.0`, `problemSolving: 1.0`, `computerSkills: 0.5`), tự động dồn phần dư `creativity` (`0.5..1.0`) sang `algorithm` (`<= 1.5`) trong `parseSession14DemoScores()`, và bảo toàn 3 chữ số thập phân `demoRawTotalScore` trong `session14EvalRepo.saveDraft`.
2. `src/lib/spck/spck-ui-helpers.ts`: Đồng bộ trần điểm Demo `CSI` trên giao diện (`getDemoScoreItemsForClassUi`).
3. `src/lib/local-files/spck-demo-score-reader.ts`: Thêm `sumWeightColC`, nhận diện bảng điểm `CSI` mẫu cũ (`1.5 / 1.0`) để dồn 3 chữ số thập phân bảo toàn nguyên vẹn tổng điểm BGK (đồng thời chặn chặt `> 0.5` trên bảng `CSI` mẫu mới), và cộng chính xác `cWeight * mult` tới 4 chữ số thập phân trong `sumCellRange` (xử lý `0.125 × 0.5 = 0.0625`).
4. `src/lib/playwright/spck-demo-sheet.ts`: Bảo toàn 4 chữ số thập phân (`0.0625`) cho từng dòng tiêu chí khi ghi giá trị đệm XML `applyAiAnnotationsToStudentWorksheetXml`.
5. `data/config/demo-sheet-templates/CSI.xlsx`: Chuẩn hóa trọng số Cột C (`C9:C12` = `2.0`, `C13:C16` = `0.5`), giữ nguyên 100% kiểu số `#,##0.000`, công thức `<f t="shared">` và dropdown `D9:D26`; khớp `14/14` mẫu khóa học.
6. `src/lib/playwright/session14-eval-uploader.ts`: Bổ sung chốt chặn kiểm tra trần điểm trên LMS **trước khi bấm Lưu** (`max` attribute + kích hoạt `el.blur()` / `focusout` / `inputLoc.blur()` + kiểm tra lại toàn bộ 5 ô sau khi rời focus sang Quill), cùng `closeDialogSafely()` đa tầng (`Cancel/Hủy/Đóng` → nút đóng ngoài `.MuiAlert-root` → `Escape` → `LmsHelpers.ensureCleanDialogAndToast`).
7. `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx`: Nâng nhãn phiên bản lên `MindX Bot v3.8.2`.
8. `scripts/test-csi-demo-limits-v382.ts`: Bộ kiểm thử tự động cô lập `[CSI-01..CSI-04]` kèm hồi quy `F01`–`F04`.

---

## 2. Kết quả đóng phát hiện qua 2 vòng kiểm định

| Mã | Mức độ | Trạng thái | Tóm tắt nguyên nhân & Bằng chứng xác minh Vòng 2 |
|---|:---:|:---:|---|
| **F01** | P1 | **CLOSED** | Chốt chặn trước khi bấm Lưu (`session14-eval-uploader.ts`) bổ sung `el.blur()` + `FocusEvent("focusout")` + `inputLoc.blur()` và kiểm tra lại 5 ô ngay trước `saveBtn.click()`. Probe Chromium Vòng 2 (`R2-F01a`, `R2-F01b`) dừng an toàn với `saveClicks=0`. |
| **F02** | P1 | **CLOSED** | `sqlite.ts:5308` so sánh `nextDemoJson !== JSON.stringify(currentDemo)` thay vì chuỗi cũ chưa chuẩn hóa, bảo toàn `demoRawTotalScore` 3dp (`4.375`, `3.875`) khi lưu ghi chú hoặc dữ liệu không đổi. Probe `R2-F02a`, `R2-F02b` PASS. |
| **F03** | P2 | **CLOSED** | Bỏ làm tròn từng dòng 3dp cho trọng số `0.125` (`0.0625`), giữ tổng chính xác tới 4dp trước khi làm tròn tổng 3dp. Probe `R2-F03a`, `R2-F03b` xác nhận `4×HT = 4.750`, đồng hạng `4.875 === 4.875`, `E13..E16 = 0.0625`, `F9 = 4.313`. |
| **F04** | P2 | **CLOSED** | `closeDialogSafely()` kiểm tra `dialog.isVisible()` qua từng tầng và bỏ qua nút đóng bên trong `.MuiAlert-root`. Probe `R2-F04` xác nhận đóng sạch modal trong cả 3 kịch bản bẫy (`dialogStillOpen=false`). |

---

## 3. Cổng kiểm thử sau bản vá cuối (`exit 0`)
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false`: **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-csi-demo-limits-v382.ts`: **PASS (`[CSI-01..CSI-04]`)**
- `npx.cmd tsx scripts/test-demo-sheet-yellow-v365.ts`: **PASS (`3/3`, `14/14` mẫu)**
- `npx.cmd tsx scripts/test-demo-ai-and-drive-reupload-v351.ts`: **PASS (`5/5`)**
- `npx.cmd tsx scripts/test-demo-sheet-resilience-v364.ts`: **PASS (`5/5`)**
- `npx.cmd tsx scripts/test-session14-v290.ts`: **PASS (`7/7`)**
- `npx.cmd tsx scripts/test-spck-v360.ts`: **PASS (`5/5` + `Round-38`)**
- Probe đối kháng độc lập Vòng 2 của `Gemini 4 Neon (XHigh)` trong `os.tmpdir()`: **`7/7` PASS, `0` FAIL**
- `graphify update .` (100% offline `--code-only`): **PASS (`2.517` nodes, `9.172` edges, `95` communities)**
- Bảo toàn 100% SHA-256 dữ liệu thật trong suốt quá trình kiểm thử & kiểm định:
  - `data/mindx_bot.db`: `E90E160D0DC9F0796D3156851A4072879FC5E813FDEC04F1B9928DFE50E85EF1`
  - `data/running_classes.json`: `226C2412CCF917CCC803B7D94019DDE253B08F9B31A86BDCE91E3A4EF2CC2EA1`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
