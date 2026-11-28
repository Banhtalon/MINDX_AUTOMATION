# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP — MINDX AUTOMATION BOT `v3.9.2` (CHẶNG 1 & CHẶNG 2: TINH GỌN LUỒNG GIÁO VIÊN — GÓI A, B & C)

- **Phiên bản:** `v3.9.2` (`28/11/2026`)
- **Đơn vị Kiểm định Độc lập:** **`Gemini 4 Neon (XHigh)`** (`gemini-4-neon-xhigh` — `@reviewer-neon`)
- **Phạm vi kiểm định:**
  - **Chặng 1 (Gói A & Gói B):** Tra cứu BTVN buổi trước trực tiếp từ LMS cho `/session-comments` & `/classroom-manager` (`A1`), bảo toàn điểm danh `PRESENT`/`LATE`/`ABSENT` khi đồng bộ (`A2`), lọc không kế thừa thẻ lỗi hành vi (`A3`), AI soạn riêng từng học viên / thanh nhắc nạp Nhật ký Giờ học / giữ nháp Zalo qua `localStorage` (`A4`), đẩy thẳng nhận xét Buổi 1–13 qua Node GraphQL API + tự động bỏ qua `VERIFIED` (`B1`), và hỗ trợ đầy đủ LEGO Checkpoint `[5, 9]` 7 sao `/7` (`B2`).
  - **Chặng 2 (Gói C):** Tự chảy điểm năng lực `[ĐNL]` Checkpoint (Coding `[5,9]`, VEX `[4,8]`, LEGO `[5,9]`) sang Phiếu điểm `class_report_cards` (`C1`), nút `⚡ Chấm riêng` 1 học viên không chạm bài đã duyệt/lưu của bạn khác (`C2`), đọc `.docx` an toàn OOXML (`C3a`), API `POST /api/homework-grader/open-local-file` khóa chặt `127.0.0.1` + `temp_submissions/` (`C3b`), chấm tay có kiểm soát cho dòng `PARSE_ERROR` trên UI & `approve` + `grade-worker` (`C3c`), và đưa nút `📸 Ảnh BTVN` lên thanh công cụ trên `/homework-grader` kèm ghi nhớ bộ lọc `mindx_hw_ui_prefs_v1` không lỗi SSR hydration (`C4`).
- **Kết luận Chính thức:**
  - **Chặng 1 (`#26` — Round 3):** **`STAGE 1 VERDICT: GO`** (`0` lỗi mở P0/P1/P2/P3; đóng trọn `13/13` phát hiện `F01`–`F11` & `R2-F01`–`R2-F02`).
  - **Chặng 2 (`#41` — Round 2):** **`STAGE 2 VERDICT: GO`** (`0` lỗi mở P0/P1/P2/P3; đóng trọn `2/2` phát hiện `S2-F01`–`S2-F02`).

---

## 1. TỔNG HỢP PHÁT HIỆN & KHẮC PHỤC QUA CÁC VÒNG KIỂM ĐỊNH

### A. Chặng 1 (Gói A + Gói B — Đóng 100% tại Round 3 `#26`)
| Mã | Mức độ | Tệp liên quan | Tóm tắt vấn đề & Cách khắc phục | Trạng thái |
| :--- | :---: | :--- | :--- | :---: |
| **F01** | P1 | `src/lib/lms/lms-write-client.ts` | Khi `GetClassWriteContext` không select `.checkpoint`, `enrichCheckpointSlotDetailsIfNeeded` bổ sung chi tiết từ `GetClassById` / `GetClassByIdSafe`; fail-closed `CHECKPOINT_DETAIL_MISSING` trước `UpdateSlotComment` nếu vẫn thiếu `.checkpoint`. | **CLOSED** |
| **F02** | P1 | `src/lib/lms/lms-write-client.ts` | Tách `summaryMutated` và `anyStudentMutated` để cập nhật `Summary/Homework` trước vòng lặp học viên không chặn Playwright fallback nếu học viên #1 lỗi recoverable (`HTTP 503`); sắp xếp `courses_syllabus` giảm dần theo độ dài mã khóa. | **CLOSED** |
| **F03** | P1 | `src/lib/lms/lms-write-client.ts` | Phân loại `CONTENT` Checkpoint rõ ràng; fail-closed `AMBIGUOUS_CHECKPOINT_CONTENT_AREA` trước mutation nếu vùng `CONTENT` mơ hồ; Read-after-Write đối chiếu khớp `verifiedGeneralArea`. | **CLOSED** |
| **F04** | P1 | `src/lib/playwright/sync-class.ts` | `upsertFbCheckpointDraftStmt` bảo toàn `attendanceStatus` nếu bản ghi đang `APPROVED`/`VERIFIED`/`SAVING` hoặc bị khóa tay (`isAttendanceManuallyLocked`). | **CLOSED** |
| **F05** | P2 | `src/lib/checkpoint/checkpoint-competency.ts` | `buildCheckpointZaloSummaryBlock` hỗ trợ lớp LEGO (`isLego`): giữ học viên có `competencyAverage` khi `LT`/`TH` là `null`, bỏ câu nhắc `"kiến thức lý thuyết"`, tuyệt đối không lộ điểm cá nhân. | **CLOSED** |
| **F06–F07** | P1/P2 | `src/lib/homework/lms-btvn-lookup.ts`, `src/app/api/classroom-manager/sync-btvn/route.ts` | Khi thiếu cột BTVN mục tiêu trong cache hoặc thiếu `score_matrix_cache`, ưu tiên gọi live `ScoreScraper` trước để không đổ oan `SUBMITTED_UNGRADED`; chỉ fallback `REPORT_CARD_SNAPSHOT` khi offline (trừ `forceLiveScrape: true`). | **CLOSED** |
| **F08** | P1 | `src/app/api/session-comments/list/route.ts` | Loại trừ học viên đang `VERIFIED`/`SAVING` khỏi `pendingClassroomLogsCount`, chặn lặp thanh nhắc `📥 Nạp Giờ học`. | **CLOSED** |
| **F09–F10** | P2/P3 | `src/app/session-comments/page.tsx` | Hiển thị banner `info` khi tất cả bản ghi đều đã `VERIFIED` (`skippedVerifiedCount > 0`), bỏ icon `<Sparkles />` lặp, hỗ trợ `Shift + click` cho `forceLiveScrape` ở nút `📥 Lấy BTVN LMS`. | **CLOSED** |
| **F11** | P1 | `src/lib/gemini/comment-generator.ts`, `src/app/api/session-comments/{save-draft,approve}/route.ts`, `src/lib/zalo/zalo-summary.ts` | Đồng bộ nhận diện LEGO (`KIRO`/`LEGO`/`ROB4`/`ROB6`/`KIND-ROB*`) cho Buổi `5`/`9` chia `/7`, ẩn tiêu đề LT/TH và chặn lỗi `409` khi duyệt LEGO. | **CLOSED** |
| **R2-F01** | P1 | `src/lib/lms/lms-write-client.ts` | `isCheckpointAreaPayloadIncomplete` kiểm tra đủ `id`/`title`/`score` trong `checkpointQuestions`; chặn fail-closed `CHECKPOINT_DETAIL_MISSING` trước khi mutate nếu `GetClassByIdSafe` trả về câu hỏi bị cụt trường. | **CLOSED** |
| **R2-F02** | P2 | `src/lib/homework/lms-btvn-lookup.ts` | `buildMatrixFromReportCardSnapshot` tra cứu đủ cả `_SESS_01..09`, `_SESS_1..9` và `classSessionRepo` theo thứ tự ưu tiên trạng thái (`VERIFIED > APPROVED > non-REDO > REDO`). | **CLOSED** |

### B. Chặng 2 (Gói C — Đóng 100% tại Round 2 `#41`)
| Mã | Mức độ | Tệp liên quan | Tóm tắt vấn đề & Cách khắc phục | Trạng thái |
| :--- | :---: | :--- | :--- | :---: |
| **S2-F01** | P1 | `src/lib/playwright/grade-worker.ts` | Guardrail A (`L381–399`) mở cho phép thử lại (`Thử lại LMS`) các bản ghi `PARSE_ERROR` đã chấm tay hợp lệ khi ở trạng thái `FAILED` còn nguyên `contentHash`, đồng thời bổ sung chốt `Number.isInteger(freshRecord.teacherOverrideScore)`. | **CLOSED** |
| **S2-F02** | P1 | `src/lib/db/sqlite.ts` | `collectManualCheckpointEditsByStage` (`L7578–7599`) yêu cầu đủ 7/9 khóa hợp lệ qua `hasCompleteCheckpointCompetencyObj(parsed.lmsCompetencyScores, isLego)`; khi bản ghi từng `VERIFIED` bị sửa về `DRAFT`, chỉ tính từ `lmsCompetencyScores` cũ thay vì lấy `competencyAverage` nháp chưa duyệt, giữ nguyên `APPROVED` & `contentHash` trên Phiếu điểm. | **CLOSED** |

---

## 2. XÁC MINH BẢO MẬT, TOÀN VẸN & GIAO DIỆN

- **Local-Only & Path Allowlist:** `validateLocalRequest` (`127.0.0.1`) + `parseJsonPlainObjectBody` khóa đủ route mới (`open-local-file`, `btvn-from-lms`, `sync-btvn`). `open-local-file/route.ts` tra đường dẫn từ DB theo `submissionId`, kiểm tra `assertPathAllowed` + `fs.realpathSync` nằm trong `temp_submissions/` dự án, chặn null-byte/thư mục/symlink và dùng `execFile("explorer.exe", ...)` với `shell: false`.
- **Safe `.docx` Parser (`parseDocxBufferSafely`):** Đọc qua `inspectZipArchiveSafely` (chặn zip-slip, tỷ lệ nén bất thường, giới hạn dung lượng/số tệp), giải mã XML entity 1 lượt (`0` double-unescape, `0` XXE), trả `PARSE_ERROR` nếu rỗng chữ hoặc hỏng cấu trúc ZIP.
- **Guardrail Chấm Tay `PARSE_ERROR`:** `approveAll: true` tiếp tục bỏ qua `100%` bản ghi `PARSE_ERROR`; duyệt đơn lẻ chỉ chấp nhận khi có `manualTeacherGradeOnParseError: true`, khớp `studentId`, `decision === "GRADE"`, điểm nguyên `0..maxScore`, nhận xét text thuần `>= 10` ký tự và gắn dấu kiểm toán `MANUAL_PARSE_ERROR_GRADE`; `HomeworkGradeWorker` kiểm tra đủ 4 điều kiện + `verifyHomeworkContentIntegrity` trước khi đẩy `#tabpanel-3`.
- **Client Boundary & SSR Hydration:** `0` rò rỉ biến môi trường bí mật hay module Node sang `'use client'`. `localStorage` (`mindx_zalo_draft_v1_*` & `mindx_hw_ui_prefs_v1`) chỉ đọc/ghi trong `useEffect` sau mount (`0` hydration mismatch). `9/9` trang Neo-Brutalism Light/Dark đạt chuẩn WCAG AA `>= 4.5:1` ở `1280×800` & `1440×900`.

---

## 3. KẾT QUẢ KIỂM THỬ ĐỘC LẬP SAU BẢN SỬA CUỐI (`os.tmpdir()`)

Toàn bộ bộ kiểm thử và probe đối kháng đều chạy cô lập hoàn toàn trong `os.tmpdir()` qua `MINDX_DB_PATH` (riêng `test-report-card-v330.ts` bọc thêm `MINDX_CONFIG_DIR` tạm; `test-phase5.ts` được khóa tự cô lập `os.tmpdir()` vĩnh viễn) với **0 tệp tạm tồn đọng (`mindx-stage2-*`, `mindx-phase5-*`, `TEST_S2_*`)**:

1. `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` -> **PASS (`0` lỗi)**
2. `npx.cmd tsx scripts/test-workflow-streamline-stage2.ts` (`S2-01..S2-05`, `S2-F01a/b`, `S2-F02`, `S2-UI` Next.js `:3093` Chromium) -> **PASS 100%**
3. `npx.cmd tsx scripts/test-workflow-streamline-stage1.ts` (`S1-01..S1-05`, `F01..F11`, `R2-F01`, `R2-F02`) -> **PASS 100%**
4. `npx.cmd tsx scripts/test-checkpoint-grader-v386.ts` (`CPG-01..CPG-06`) -> **PASS 100%**
5. `npx.cmd tsx scripts/test-checkpoint-csa04-v386.ts` (`V386-01..V386-07` + `:3095` Light/Dark) -> **PASS 100%**
6. `npx.cmd tsx scripts/test-report-card-v330.ts` (`RC-01..RC-06`, `S2-01..S2-09`, `S4-01..S4-06`) -> **PASS 100%**
7. `npx.cmd tsx scripts/test-report-card-batch-sync.ts` (`BS-01..BS-09`) -> **PASS 100%**
8. `npx.cmd tsx scripts/test-streamline-v340-s4.ts` (`S4-T1..S4-T5`) -> **PASS 100%**
9. `npx.cmd tsx scripts/test-homework-hide-scores-v369.ts` -> **PASS 100%**
10. `npx.cmd tsx scripts/test-phase5.ts` (tự cô lập `os.tmpdir()`) -> **PASS 100%**
11. `npx.cmd tsx scripts/test-ui-v362.ts` (`UI362-01` PASS; bỏ qua phần live `:3000` do server local không bật; phần live UI/SSR được phủ bởi `stage2` `:3093` & `v390`) -> **PASS**
12. `npx.cmd tsx scripts/test-neo-brutalism-ui-v390.ts` (`9/9` trang Sáng/Tối × `1280/1440`) -> **PASS 100%**
13. Bộ hồi quy Chặng 1 đã chạy sau sửa cuối Chặng 1 (`#20`, `#25`, `#26`): `test-streamline-v340-s3.ts`, `test-save-comments-timeout-v348.ts` (`9/9`), `test-admin-center-lego-and-summary-v3811.ts` (`6/6`), `test-quick-tags-v300.ts`, `test-classroom-manager-v367.ts` (`CM-01..CM-05`), `test-checkpoint-auto-v370.ts` (`V370-01..V370-09`), cùng probe đối kháng Round 3 Chặng 1 (`R2-F01`, `R2-F02`) & Round 2 Chặng 2 (`S2_R2_PROBE_1_PASS`, `S2_R2_PROBE_2_PASS`) của `@reviewer-neon` -> **PASS 100%**.

---

## 4. BẢO TOÀN DỮ LIỆU THẬT `data/` & GHI CHÚ MINH BẠCH SỰ CỐ `test-phase5.ts`

- **Ghi chú minh bạch (`#32`–`#34`):** Trước khi bắt đầu Chặng 1, `data/mindx_bot.db` có SHA-256 baseline là `7A097171155334B364E1ECD2AA63B4C7BFE6556A665A2EB676BA2152211DEADF` (được giữ nguyên 100% qua suốt Chặng 1 đến `STAGE 1 VERDICT: GO` tại `#26`). Trong Chặng 2 (`#32`), khi chạy kiểm thử `scripts/test-phase5.ts`, script này khi đó chưa tự gán `MINDX_DB_PATH` sang `os.tmpdir()`, dẫn đến ghi thêm 3 dòng metadata kiểm thử (`SUB_P5_*`/`SUB_API_*`) vào bảng `homework_submission_meta` trên `data/mindx_bot.db` (dữ liệu lớp học, học viên và bài nộp thật nguyên vẹn 100%; 4 tệp JSON cấu hình giữ nguyên 100% baseline `#26`). Theo phê duyệt của `@coordinator` tại `#34`, đã giữ nguyên hiện trạng không chỉnh/xóa thủ công vào DB thật, **khóa vĩnh viễn mốc SHA-256 mới cho `data/mindx_bot.db`**, và bổ sung rào chắn tự cô lập `os.tmpdir()` + `closeDb()` ngay trong `scripts/test-phase5.ts` để ngăn lặp lại vĩnh viễn.
- **Bảng đối chiếu SHA-256 sau toàn bộ kiểm thử Chặng 2 & kiểm định độc lập (`#41`):**
  - `data/mindx_bot.db`: `65DA7AECD08486E5E888CAF070610F3ED2A3B71A96C8C0F932B9C720DCB3D6A3` (**MATCH** mốc khóa `#34`)
  - `data/running_classes.json`: `61836CB19B36F13D1C137B2DE4BA07AE57F868B06C2F7DAADF498ED5D5432A4F` (**MATCH** mốc `#26`/`#34`)
  - `data/config/lms_class_ids.json`: `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F` (**MATCH** mốc `#26`/`#34`)
  - `data/config/courses_syllabus.json`: `E4112B43C48E106D55F9B76AABD0603F809FD200B64FDBC4BC1619CAFD96896D` (**MATCH** mốc `#26`/`#34`)
  - `data/config/quick_tags.json`: `5E4D7D9E85F635400B68F0E211799C48AB965F51284A134F1617936A739E4F40` (**MATCH** mốc `#26`/`#34`)
