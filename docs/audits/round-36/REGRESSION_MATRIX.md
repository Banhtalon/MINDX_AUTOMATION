# AUDIT-R36 — Ma trận hồi quy

Kết luận: **NO-GO_SOURCE**, 7/7 tình huống gốc R35 đóng; R36-01 (P2) còn mở.

## Lệnh thực thi nguyên bản và đối ứng

| ID | Lệnh | Exit | Đánh giá |
|---|---|---:|---|
| 01-independent | `node docs/audits/round-31/verify-independent.mjs` | 0 | PASS (819/819); [log](evidence/01-independent.log) |
| 02-requested-media | `node docs/audits/round-22/native-media-repro.mjs` | 1 | UNAVAILABLE_REQUESTED_PATH; [log](evidence/02-requested-media.log) |
| 03-requested-worker | `node docs/audits/round-24/native-worker-repro.mjs` | 1 | UNAVAILABLE_REQUESTED_PATH; [log](evidence/03-requested-worker.log) |
| 04-requested-name | `node docs/audits/round-25/pdf-name-repro.mjs` | 1 | UNAVAILABLE_REQUESTED_PATH; [log](evidence/04-requested-name.log) |
| 05-requested-boundary | `node docs/audits/round-26/pdf-boundary-repro.mjs` | 1 | UNAVAILABLE_REQUESTED_PATH; [log](evidence/05-requested-boundary.log) |
| 06-phase5 | `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | 0 | PASS; [log](evidence/06-phase5.log) |
| 07-typescript | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 0 | PASS; [log](evidence/07-typescript.log) |
| 08-core | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/core-repro.mjs` | 0 | PASS; [log](evidence/08-core.log) |
| 09-ui | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/ui-repro.mjs` | 1 | CLOSURE_CRITERIA_PASS; [log](evidence/09-ui.log) |
| 10-rubric | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/rubric-repro.mjs` | 1 | CLOSURE_CRITERIA_PASS; [log](evidence/10-rubric.log) |
| 11-media | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-media-repro.mjs` | 0 | PASS (221/221); [log](evidence/11-media.log) |
| 12-worker | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-worker-repro.mjs` | 0 | PASS (88/88); [log](evidence/12-worker.log) |
| 13-name | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-name-repro.mjs` | 0 | PASS (4/4); [log](evidence/13-name.log) |
| 14-boundary | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-boundary-repro.mjs` | 0 | PASS (28/28); [log](evidence/14-boundary.log) |

Bốn đường dẫn yêu cầu không tồn tại được giữ nguyên UNAVAILABLE; bốn cổng R31 đối ứng chạy bằng tsx. UI/barem R35 dùng quy ước mã thoát đảo khi lỗi đã hết; đã xác nhận JSON đầy đủ, không đổi mã thoát gốc.

## Trạng thái từng lỗi cũ

| Mã | Trạng thái | Bằng chứng mới |
|---|---|---|
| R35-01 | CLOSED_SOURCE tình huống gốc | [Kết quả rubric](evidence/fresh-rubric-repro-results.json) |
| R35-02 | CLOSED_SOURCE tình huống gốc; nhánh đổi file còn R36-01 | [Kết quả ui](evidence/fresh-ui-repro-results.json) |
| R35-03 | CLOSED_SOURCE tình huống gốc | [Kết quả ui](evidence/fresh-ui-repro-results.json) |
| R35-04 | CLOSED_SOURCE tình huống gốc | [Kết quả ui](evidence/fresh-ui-repro-results.json) |
| R35-05 | CLOSED_SOURCE tình huống gốc | [Kết quả core](evidence/fresh-core-repro-results.json) |
| R35-06 | CLOSED_SOURCE tình huống gốc | [Kết quả core](evidence/fresh-core-repro-results.json) |
| R35-07 | CLOSED_SOURCE tình huống gốc | [Kết quả core](evidence/fresh-core-repro-results.json) |

## Ca xác minh bổ sung R36

| Ca | Kết quả |
|---|---|
| `R35-01-config-reject10-accept100` | PASS |
| `R35-01-auditor-reject10-accept80` | PASS |
| `R35-01-approve-reject10-approve80` | PASS |
| `R35-01-grader-reject10-before-ai` | PASS |
| `R35-01-route-reject10-before-ai` | PASS |
| `R35-04-stop-before-write-real-single-grader` | PASS |
| `R35-02-refresh-preserve-then-confirm-draft` | PASS |
| `R36-UI-new-file-clears-unsaved-marker` | FAIL — R36-01 (P2) |
| `R35-06-cycle-and-depth-terminate` | PASS |
| `R35-07-valid-and-corrupt-yy` | PASS |

Tổng bổ sung: **9/10**, exit 1. [Dữ liệu ca thử](evidence/closure-results.json), [quan sát R36-01](evidence/new-file-observation.json).

## Toàn vẹn và giới hạn

- 1691/1691 tệp bảo vệ giữ nguyên, gồm 1.611 tệp R12–R35; next-env.d.ts đúng SHA-256 yêu cầu.
- Bản sao có 1.689 tệp được bảo vệ khớp nguồn; mã sản phẩm trong bản sao giữ nguyên sau thử.
- Đã xóa bản sao TEMP và hai thư mục dữ liệu giả mới tạo; node_modules gốc giữ nguyên.
- Chưa kiểm tra trình duyệt thật/LMS/Gemini thật/build hoặc toàn bộ Giai đoạn 6/7.
- Không dùng tổng lượt thử trùng phạm vi làm số tình huống duy nhất.
