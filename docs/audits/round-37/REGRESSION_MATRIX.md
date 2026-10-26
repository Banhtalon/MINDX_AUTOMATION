# AUDIT-R37 — Ma trận kiểm chứng / đóng lỗi Giai đoạn 5

Kết luận: **GO cấp mã nguồn**, đóng đủ **R35-01..R35-07 và R36-01** trong phạm vi kiểm chứng cô lập. Mọi kết quả dưới đây được chạy mới trên cây làm việc có dấu vân tay ở `evidence/integrity-before.json`.

## 11 cổng yêu cầu

| # | Lệnh nguyên văn | Kết quả mới | Mã thoát gốc |
|---|---|---|---:|
| 1 | `node docs/audits/round-31/verify-independent.mjs` | 819/819 PASS | 0 |
| 2 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-media-repro.mjs` | 221/221 PASS | 0 |
| 3 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-worker-repro.mjs` | 88/88 PASS | 0 |
| 4 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-name-repro.mjs` | 4/4 PASS | 0 |
| 5 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-boundary-repro.mjs` | 28/28 PASS | 0 |
| 6 | `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | 8/8 nhóm PASS, có hồi quy R35 và R36-01 | 0 |
| 7 | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 0 lỗi | 0 |
| 8 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/core-repro.mjs` | 3/3 pass:true | 0 |
| 9 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/ui-repro.mjs` | 3/3 bugReproduced:false | 1 |
| 10 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-35/rubric-repro.mjs` | 1/1 bugReproduced:false | 1 |
| 11 | `node node_modules/tsx/dist/cli.mjs docs/audits/round-36/closure-repro.mjs` | 10/10 PASS, gồm R36-UI-new-file-clears-unsaved-marker | 0 |

Hai cổng 9–10 có mã thoát 1 theo quy ước đảo của script lịch sử: `results.some(r => !r.bugReproduced)` đặt exit 1. Đã đọc mã và kiểm tra toàn bộ JSON mới; đây là PASS theo tiêu chí Owner yêu cầu. Không sửa script hoặc che mã thoát. Các bộ có trùng phạm vi, không cộng thành số tình huống duy nhất.

Log nguyên bản và thời gian: `evidence/gate-runs.json`, `evidence/01-independent.log` .. `11-r36-closure.log`. JSON được sao lưu rồi loại khỏi bản sao TEMP trước khi chạy từng cổng để tránh dùng lại bằng chứng cũ; bản gốc trong repo giữ nguyên.

## Đóng từng lỗi

| Mã | Trạng thái | Bằng chứng và hành vi đã xác nhận |
|---|---|---|
| R35-01 | CLOSED_SOURCE | Thang 10 bị cấu hình/kiểm điểm/chấm/duyệt từ chối; thang 100 cho 40+40=80, duyệt APPROVED. AI calls=0 với barem sai. |
| R35-02 | CLOSED_SOURCE | Lưu lỗi rồi làm mới cùng file giữ chữ và cờ chưa lưu; xác nhận draftSeq mới xóa cờ. |
| R35-03 | CLOSED_SOURCE | Đổi sang buổi 2 khi chấm buổi 1: SUB2 hiện đúng và isLoadingSubs=false; không phát GET cũ làm vô hiệu lượt mới. |
| R35-04 | CLOSED_SOURCE | Stop ngăn SUB2; API success=false; chấm đơn gọi AI giả 1 lần, ghi 0 lần, trả TASK_CANCELLED. |
| R35-05 | CLOSED_SOURCE | Đọc bảng mới trước khi lọc: scrapeCalls=1 dù cache cũ chưa có bài. Bộ gốc cố ý dừng tại BrowserManager giả, chưa chứng minh tải thật. |
| R35-06 | CLOSED_SOURCE | Giữ đủ toán hạng 1+2 và 100+200; ca vòng tham chiếu và sâu đều kết thúc có giới hạn. |
| R35-07 | CLOSED_SOURCE | GML hỏng làm PARSE_ERROR với tên Step_0.gml; YY JSON hỏng bị từ chối; gói hợp lệ vẫn đọc được. |
| R36-01 | CLOSED_SOURCE | file-v2 thay nháp cũ, unsaved={} ngay lần làm mới đầu; approveResult=true, approvalCalls=1. Test Phase5 kiểm tra cả giữ nháp cùng file và Duyệt sau đổi file. |

## Giới hạn

Giao diện được kiểm bằng thân hàm nguồn trong bộ mô phỏng React hooks, không phải trình duyệt thật. SQLite/dữ liệu/file thử đều giả và cô lập; mạng TCP/DNS/fetch bị chặn. Không gọi LMS/Gemini thật, không chạy build hoặc nghiệm thu vận hành. Nhóm 8 Phase5 kiểm trực tiếp 01/06/07 và nhánh 02/R36-01; các ca 03/04/05 được chứng minh bằng bộ R35/R36 riêng. Không suy diễn PASS của cả nhóm thành chứng cứ riêng cho mọi lỗi.
