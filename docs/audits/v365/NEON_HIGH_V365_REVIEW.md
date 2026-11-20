# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `v3.6.5` — ROUND 3 (CHỐT NGHIỆM THU — `auditor-2`)

- **Ngày chốt nghiệm thu:** 20/11/2026 (Round 1: 19/11/2026; Round 2 & Round 3: 20/11/2026)
- **Kiểm toán viên độc lập:** `auditor-2` (Subagent độc lập — chỉ đọc mã nguồn, chạy kiểm thử chính thức & probe đối kháng cô lập trong `os.tmpdir()`)
- **Phạm vi kiểm định (`v3.6.5`):**
  - `src/lib/playwright/spck-demo-sheet.ts` (`JUDGE_SCORING_YELLOW_FILL_ARGB`, `collectCellStyleIdsForJudgeRows`, `injectYellowHighlightStylesIntoStylesXml`, `applyYellowStyleToJudgeScoringCellsInSheetXml`, `upsertInlineCellInSheetXml`, `widenColumnGInColsXml`, `cloneTemplateXlsxBufferForStudents`, `buildDemoScoringWorkbookBuffer`)
  - `src/lib/gemini/spck-demo-sheet-scorer.ts` (`stripLeadingAiSuggestionLabel`, prompt & lọc Cột `G` + `bgkQuestions`, câu fallback không chứa nhãn `"AI"`)
  - `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx` (phiên bản `3.6.5`)
  - `scripts/test-demo-sheet-yellow-v365.ts`, `scripts/test-demo-ai-and-drive-reupload-v351.ts`, `scripts/test-demo-sheet-resilience-v364.ts`

---

## 1. KẾT QUẢ CHẠY TOÀN BỘ CỔNG KIỂM THỬ SAU BẢN VÁ CUỐI (ROUND 3)

| # | Lệnh kiểm tra | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** | `0` lỗi biên dịch TypeScript |
| 2 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-sheet-yellow-v365.ts` | **PASS (`exit 0`)** | `V365-01..V365-03` (`14/14` mẫu khóa học, synthetic fallback thật, đệm ECMA-376, bộ test `V365-R2-F01`) |
| 3 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-sheet-resilience-v364.ts` | **PASS (`exit 0`)** | `V364-01..V364-05` |
| 4 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-native-demo-gsheet.ts` | **PASS (`exit 0`)** | `GS-01..GS-05` |
| 5 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-ai-and-drive-reupload-v351.ts` | **PASS (`exit 0`)** | `T1..T5` |
| 6 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-reupload-v353.ts` | **PASS (`exit 0`)** | `R353-01..R353-04` |
| 7 | Bộ probe đối kháng độc lập Round 3 (`os.tmpdir()`, đã xóa sạch sau chạy) | **PASS (`exit 0`)** | `R3_ALL_ADVERSARIAL_PROBES_PASS` (`0` phát hiện) |

---

## 2. XÁC MINH ĐÓNG TOÀN BỘ 6/6 PHÁT HIỆN (ROUND 1 & ROUND 2)

| Mã phát hiện | Mức độ | Trạng thái | Tóm tắt xác minh độc lập |
|---|---|---|---|
| `V365-F01` | HIGH | **CLOSED** | `upsertInlineCellInSheetXml` (`spck-demo-sheet.ts:833-836`) & `widenColumnGInColsXml` (`:731`) đã dùng callback `() => ...`, bảo toàn thuộc tính `<sheetData>`. Chèn dòng `34` trên mẫu thật `PSI.xlsx` & `PTI.xlsx` kèm `$&`, `$'`, `` $` ``, `$$`, `$1`, `$100` sinh đúng `1` `<sheetData>` và giữ dữ liệu khớp từng ký tự. |
| `V365-F02` | HIGH | **CLOSED** | `stripLeadingAiSuggestionLabel` (`spck-demo-sheet-scorer.ts:574-583`) bảo toàn `100%` câu mô tả dự án học sinh (`"AI gợi ý món ăn..."`, `"Hệ thống gợi ý sách..."`, `"AI đánh giá bài luận..."`, `"Ứng dụng AI LLM..."`, `"Chatbot AI..."`). |
| `V365-F03` | MEDIUM | **CLOSED** | Lọc sạch `100%` các biến thể ngoặc `[Gợi ý của AI]`, `[Gợi ý nhanh của AI: ...]`, `[Gợi ý từ AI: ...] -`, `(Gợi ý của AI: ...)`, `(Theo AI: ...)`, `[AI gợi ý: Tốt]:`, `[AI gợi ý: Tốt] -`, nhãn nối tiếp và toàn bộ `bgkQuestions`; kiểm tra ReDoS hoàn tất `< 5ms`. |
| `V365-F04` | MEDIUM | **CLOSED** | `_forceSyntheticFallbackForTest: true` kiểm chứng trực tiếp nhánh synthetic (`buildStandardStudentWorksheetXml` + `buildStylesXml`: `fills count="6"`, `cellXfs count="13"`), tô vàng đồng bộ cả `20` dòng tiêu chí `8..27` cột `B..E` ở cả hai chế độ có/không `aiTabAnnotations`, đọc điểm ngược khớp `5`. |
| `V365-F05` | LOW | **CLOSED** | `injectYellowHighlightStylesIntoStylesXml` tự đệm `none` (0) & `gray125` (1) theo chuẩn ECMA-376 §18.8.21 khi `<fills>` có `< 2` mục (`yellowFillId >= 2`), và tự đệm `cellXfs[0]` mặc định không vàng khi `<cellXfs/>` rỗng (`styleMap.get(0) === 1`). |
| `V365-R2-F01` | LOW | **CLOSED** | Đã bỏ `|\s+` ở nhánh phụ không có dấu phân cách trước rating (`spck-demo-sheet-scorer.ts:579`). Probe Round 3 xác nhận bảo toàn `100%` các câu trạng từ `"tốt"` / `"hoàn thành"` / `"chưa đạt"` không có `:`/`-` (`"AI gợi ý tốt cho người dùng khi chọn món ăn."`, `"AI đánh giá tốt câu trả lời người dùng."`, `"Hệ thống gợi ý tốt các bộ phim phù hợp."`, `"AI gợi ý tốt nhất là lọc theo sở thích."`, `"AI gợi ý hoàn thành bài tập đúng hạn."`), đồng thời vẫn xóa sạch `"AI gợi ý Tốt: Hàm clean."`, `"AI gợi ý Hoàn thành - ..."`, và `"AI gợi ý Tốt"`. |

---

## 3. ĐỐI CHIẾU YÊU CẦU OWNER (`v3.6.5`)

1. **Tô màu vàng `#FFE599` (`FFFFE599`) CHỈ trong 4 ô chấm điểm `B..E` ở các dòng Giám khảo chấm trực tiếp:**
   - Đạt `100%` trên toàn bộ `14/14` mẫu khóa học (`CSA`, `CSI`, `GA`, `GB`, `GI`, `JSA`, `JSB`, `JSI`, `PSI`, `PTA`, `PTI`, `SA`, `SB`, `SI`) và nhánh synthetic fallback.
   - `0` ô dính vàng ngoài vùng cấm: Cột `A` (gồm cả vùng gộp hỗn hợp `A21:A24` trong `CSI.xlsx`), Cột `F` (gộp `Tổng Điểm`), Cột `G`, vùng tiêu đề `1..headerRow`, khối `Nhận xét`/`BGK1`/`BGK2`/`LO` phía dưới, và tab phụ `"Phân bổ điểm"`.
   - Bảo toàn `100%` `borderId`, `fontId`, `numFmtId`, `alignment`/`wrapText`, `<xf>` gốc (từng byte), công thức `<f>` (kể cả `t="shared"`), `<dataValidations>`, `<mergeCells>`, xử lý ô thưa/tự đóng `<c .../>` & `<row .../>`, và đọc điểm ngược Buổi 14 khớp tuyệt đối.
2. **Bỏ toàn bộ nhãn hệ thống `"AI gợi ý"` / `"của AI"` trên bảng chấm điểm:**
   - Tiêu đề Cột `G`: `"Ghi chú đối chiếu & Câu hỏi BGK"`.
   - Dòng đã chấm nháp chỉ hiển thị bằng chứng đối chiếu (`evidenceNote`), tự xóa các nhãn gợi ý nếu Gemini tự chèn ở đầu `evidenceNote` và `bgkQuestions`, bảo toàn `100%` từ `"AI"` thuộc đề tài học sinh, câu dự phòng rỗng / `AI_ERROR` / fallback sạch chữ `"AI"`, ẩn danh PII (kể cả học viên đã nghỉ) đạt `0` rò rỉ.

---

## 4. KIỂM CHỨNG BẢO TOÀN DỮ LIỆU THẬT & DỌN DẸP (ROUND 3)

Kiểm tra trực tiếp bằng Node (`fs.readFileSync` + `crypto.createHash('sha256')`) trước và sau toàn bộ 3 vòng kiểm định; đã xóa sạch toàn bộ script & thư mục tạm trong `$env:TEMP` (`TEMP_EXISTS=False`) và không sửa bất kỳ tệp mã nguồn, test, cấu hình hay dữ liệu nào:

| Tệp dữ liệu thật | SHA-256 kỳ vọng | Kết quả sau Round 3 |
|---|---|---|
| `data/mindx_bot.db` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | **MATCH 100%** |
| `data/mindx_bot.db-wal` | `7B738FF9DBADC119380D6BE3E7924437B77FBEAED545231E70C1B26D4C4C7B91` | **MATCH 100%** |
| `data/running_classes.json` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | **MATCH 100%** |
| `data/config/lms_class_ids.json` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | **MATCH 100%** |

---

## 5. KẾT LUẬN CUỐI CÙNG

Toàn bộ **`6/6` phát hiện** (`V365-F01`..`V365-F05` & `V365-R2-F01`) đã được **ĐÓNG** hoàn toàn (**`0` CRITICAL / `0` HIGH / `0` MEDIUM / `0` LOW / `0` INFO mở**). Toàn bộ cổng biên dịch, kiểm thử tự động, hồi quy và probe đối kháng độc lập đều **PASS `100%` (`exit 0`)**, bảo toàn `100%` SHA-256 dữ liệu thật. Đủ điều kiện phát hành `v3.6.5`.

**VERDICT: GO**
