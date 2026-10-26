# AUDIT-R36 — Tái kiểm định / xác minh đóng lỗi Giai đoạn 5

**Kết luận: NO-GO cấp mã nguồn cho nghiệm thu toàn bộ Giai đoạn 5.** Bảy tình huống gốc `R35-01`..`R35-07` đã được khắc phục trong phạm vi thử cô lập; phát hiện thêm **R36-01 (P2)** ngay tại nhánh giữ bản nháp mới sửa. Vì vậy chưa thể xác nhận yêu cầu “không có lỗi mới phát sinh”. Không sửa mã sản phẩm trong vòng này.

Kiểm định ngày 21/10/2026, trực tiếp bởi Codex trong phiên hiện tại, không ủy quyền agent khác; cấu hình được Owner yêu cầu: `gpt-6.1-sol`, mức suy luận `high`. Đây là cấu hình yêu cầu, không phải chứng thư nhận dạng mô hình từ một dịch vụ khác. HEAD `2570d96b6770957e218031c91f14ce98e766dfa7`; đối tượng kiểm định là toàn bộ nội dung hiện tại, gồm file chưa commit. Dấu vân tay nguồn nằm trong `evidence/integrity-before.json`.

## 1. Lỗi mới cần xử lý

### R36-01 — P2: File mới đã hiện nhưng dấu nháp cũ vẫn chặn Duyệt

**Nguyên nhân:** Khi tải lại danh sách, mã đặt trạng thái React `unsavedSubIds` trước khi kiểm tra phiên bản file. Nếu file đã đổi, nhánh ghép dữ liệu chỉ xóa cờ phụ `unsavedFlagBySub`; trạng thái dùng để chặn nút Duyệt vẫn còn.

**Vị trí:** `src/components/homework-auto-grader-tab.tsx:227–246,278–290`; điều kiện chặn duyệt tại `557–566`. Đây là nhánh mới giữ bản nháp khi làm mới, liên quan bản sửa R35-02.

**Tái hiện:** Với bài `SUB1`, sửa nhận xét của `file-v1` trong lúc lưu nháp mất kết nối → phản hồi làm mới trả cùng bài nhưng `fileHash=file-v2`, `draftSeq=0` → màn hình thay bằng nội dung máy chủ của file mới, nhưng `unsavedSubIds.SUB1=true` → bấm Duyệt trả `false`, **không gửi yêu cầu duyệt nào**. Thông báo yêu cầu lưu bản nháp không còn hiển thị. Làm mới lần thứ hai xóa cờ, Duyệt mới gửi được. Đã thử thêm đối chứng này để xác định lỗi có thể khôi phục; không kết luận mất dữ liệu máy chủ hoặc ghi sai LMS.

**Bằng chứng:** `evidence/new-file-observation.json`, `evidence/closure-results.json`, ca `R36-UI-new-file-clears-unsaved-marker` (FAIL). Thử thực thi thân hàm nguồn với bộ mô phỏng React hooks và dữ liệu giả; chưa phải thao tác trong trình duyệt thật.

**Cách sửa hẹp đề xuất:** Tính danh sách hàng cuối cùng và cờ chưa lưu sau khi đối chiếu cả `draftSeq` và `fileHash`; khi thay bằng file mới, đồng bộ cả hai bộ cờ. Không sửa trạng thái dùng chung bên trong hàm cập nhật React. Giữ nguyên hành vi giữ nháp nếu file chưa đổi.

**Sau khi sửa:** Ca R36 phải hết cờ sai và gửi được yêu cầu duyệt file mới sau khi giáo viên xem lại; ca mất kết nối/làm mới cùng file vẫn phải giữ nội dung chưa lưu. Chạy lại cổng UI gốc R35, ca R36, Phase 5 và TypeScript trên nguồn cuối. Kiểm định này không tự sửa lỗi.

## 2. Kết quả các cổng bắt buộc

Đã thực thi nguyên văn **đủ 10 lệnh yêu cầu** trong `%TEMP%\mindx-round31-r36-check`, sau đó chạy **4 lệnh đối ứng đúng vị trí Vòng 31**. Bốn đường dẫn được yêu cầu không có trong cây nguồn: `round-22/native-media-repro.mjs`, `round-24/native-worker-repro.mjs`, `round-25/pdf-name-repro.mjs`, `round-26/pdf-boundary-repro.mjs`. Cả bốn lượt nguyên văn thoát 1 vì `MODULE_NOT_FOUND`; không sửa, tạo thay hay chuyển kết quả của chúng thành PASS.

| Phạm vi thực tế | Kết quả mới | Mã thoát |
|---|---:|---:|
| R31 `verify-independent.mjs` | 819/819 PASS | 0 |
| R31 `native-media-repro.mjs`, nạp qua tsx | 221/221 PASS | 0 |
| R31 `native-worker-repro.mjs`, nạp qua tsx | 88/88 PASS | 0 |
| R31 `pdf-name-repro.mjs`, nạp qua tsx | 4/4 PASS | 0 |
| R31 `pdf-boundary-repro.mjs`, nạp qua tsx | 28/28 PASS | 0 |
| `scripts/test-phase5.ts` | Cả 8 nhóm in kết quả PASS | 0 |
| TypeScript `--noEmit --incremental false` | 0 lỗi | 0 |
| R35 `core-repro.mjs` | 3/3 `pass:true` (R35-05/06/07) | 0 |
| R35 `ui-repro.mjs` | 3/3 `bugReproduced:false` (R35-02/03/04) | 1, đúng quy ước bộ dò cũ |
| R35 `rubric-repro.mjs` | R35-01 `bugReproduced:false` | 1, đúng quy ước bộ dò cũ |
| R36 `closure-repro.mjs` | 9/10 PASS, 1 FAIL R36-01 | 1 |

Hai script UI/barem lịch sử chủ động đặt mã thoát 1 nếu có tình huống **không còn tái hiện lỗi**. Đã đọc mã và đối chiếu JSON, không đánh đồng mã thoát này với lỗi sản phẩm, không sửa script lịch sử. Chi tiết lệnh, thời gian, mã thoát gốc và log ở `evidence/gate-runs.json` và `REGRESSION_MATRIX.md`. Các tổng lượt thử có trùng phạm vi, không cộng thành số tình huống duy nhất.

Lượt khởi chạy bổ sung đầu tiên sai dấu phân cách đường dẫn preload Windows nên chưa chạy thử. Một lượt thử R36 tiếp theo thiếu đối tượng `auditCriterionGrades` trong bộ mô phỏng; đã giữ log, bổ sung đúng đối tượng và chạy lại. Kết quả cuối của Stop là AI 1 lần, ghi kết quả 0 lần, trả `TASK_CANCELLED`; chỉ R36-01 còn FAIL. Hai lỗi chuẩn bị này không tính là lỗi sản phẩm.

## 3. Xác minh đóng từng lỗi cũ và rà nguồn

| Lỗi | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| R35-01 | CLOSED_SOURCE | Mặc định giao diện 50+50; cấu hình thang 10 trả 400, không lưu; ScoreAuditor từ chối; bộ chấm từ chối trước AI; API chấm trả 400; API duyệt từ chối thang 10 và duyệt 40+40 thành 80/100. Các cổng trọng yếu đã thử riêng, không chỉ dựa vào bộ dò gốc. |
| R35-02 | CLOSED_SOURCE cho tình huống gốc | Mất kết nối → làm mới cùng file giữ chữ và cờ chưa lưu; phản hồi xác nhận phiên bản mới xóa cờ. Nhánh đổi file có lỗi mới R36-01, nên không kết luận toàn bộ quản lý nháp đã hoàn thiện. |
| R35-03 | CLOSED_SOURCE | Chuyển buổi trong lúc chấm: danh sách có SUB2, đúng buổi 2, `isLoadingSubs=false`; lượt cũ không khởi tạo GET làm mất hiệu lực lượt mới. |
| R35-04 | CLOSED_SOURCE | Stop giữa SUB1 ngăn bắt đầu SUB2, API báo không thành công/đã dừng; thử riêng thân hàm chấm đơn xác nhận không ghi đề xuất sau Stop. Không khẳng định hủy được yêu cầu AI đã gửi ra ngoài. |
| R35-05 | CLOSED_SOURCE | Mã nguồn đọc bảng điểm mới trước lọc bài; bộ gốc đo 1 lần gọi scraper thay vì 0. Bộ gốc cố ý dừng tại BrowserManager giả, không chứng minh tải file thật thành công. |
| R35-06 | CLOSED_SOURCE | Hai gói phân biệt được 1+2 và 100+200, giữ toán hạng; ca vòng tham chiếu và sâu 20 mức đều kết thúc, có dấu giới hạn. |
| R35-07 | CLOSED_SOURCE | GML hỏng làm cả YYZ thất bại với tên Step_0.gml; thử thêm YY JSON hỏng bị chặn và gói YY/GML hợp lệ vẫn đọc được. |

Đã trực tiếp đọc, rà các nhánh thay đổi và bên gọi liên quan trong đủ 8 file Owner nêu: `src/app/syllabus-config/page.tsx`, `src/app/api/config/route.ts`, `src/lib/gemini/score-auditor.ts`, `src/lib/gemini/homework-grader.ts`, `src/app/api/homework-grader/download-and-grade/route.ts`, `src/components/homework-auto-grader-tab.tsx`, `src/lib/playwright/download-submissions.ts`, `src/lib/file-parsers/game-reader.ts`. Đối chiếu thêm API duyệt, hàng đợi Stop, parser đầu vào và các kiểm thử liên quan. Ngoài R36-01, chưa xác nhận thêm lỗi mới trong phạm vi đã rà và chạy.

So dấu vân tay với bằng chứng R35: thay đổi ở đúng 8 file sản phẩm trên cùng `scripts/test-phase5.ts` và `scripts/test-phase7.ts`. Đây là so sánh file, không phải so sánh bản commit đã sạch. `test-phase5.ts` đặt tên nhóm 8 là R35-01..R35-07 nhưng chỉ có ca trực tiếp cho 01,06,07; các ca 02,03,04,05 được xác minh riêng bằng bộ gốc và R36, không suy diễn từ dòng PASS chung. Không kiểm định lại toàn bộ Giai đoạn 7.

## 4. Cô lập, tính toàn vẹn và dọn dẹp

Bản sao chứa đúng các tệp cấu hình dự án yêu cầu, `src`, `scripts`, `docs`, `data/config`; `node_modules` là junction đến thư viện sẵn có. **1.689 tệp được bảo vệ có trong bản sao khớp SHA-256 nguồn ban đầu.** Không sao chép `.env*`, DB thật, `playwright-auth` hay bài nộp thật. Gỡ biến môi trường có tên chứa PASSWORD/API_KEY/TOKEN/SECRET khỏi tiến trình kiểm thử; dùng `network-guard.cjs` cũ chặn TCP, DNS và fetch. Không đăng nhập hoặc gọi LMS/Gemini thật, không cài thư viện. `ESBUILD_BINARY_PATH=%TEMP%\mindx-esbuild.exe`; giữ nguyên tệp công cụ đã tồn tại.

Đối chiếu trước/sau và sau dọn dẹp: **1.691/1.691 tệp bảo vệ giữ nguyên**, gồm **1.611 tệp lịch sử R12–R35**, 70 tệp `src/scripts`, 4 tệp `data/config`, 4 cấu hình cấp gốc và 2 tệp quy tắc agent. Không thêm/xóa tệp trong các nhóm bảo vệ. `next-env.d.ts` đúng SHA-256 yêu cầu:

`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`

Chỉ thêm hồ sơ `round-36` và nối dòng trạng thái AUDIT-R36 vào cuối `MINDX_AUTOMATION_PLAN.md`; phần nội dung kế hoạch trước đó giữ nguyên từng byte. Đã gỡ junction trước khi xóa bản sao TEMP, đồng thời xóa hai thư mục dữ liệu giả do các bộ thử tạo. Kết quả kiểm tra sau dọn dẹp nằm trong `evidence/results.json`.

## 5. Giới hạn và bước tiếp theo

Chưa thử React trong trình duyệt thật, LMS/Gemini thật, dữ liệu thật, bản dựng ứng dụng hoặc luồng Giai đoạn 6/7 đầy đủ. Không dùng tuyên bố Live Flight Test trong kế hoạch cũ làm bằng chứng của R36. Các kết quả này xác minh mã nguồn và xử lý dữ liệu giả; không ký nghiệm thu vận hành TASK-5.x.

**Yêu cầu sửa có thể chuyển cho lượt triển khai riêng:** “Sửa duy nhất R36-01 trong `homework-auto-grader-tab.tsx`: đồng bộ cờ chưa lưu với kết quả ghép hàng sau khi so `fileHash`/`draftSeq`, tránh đổi trạng thái phụ trong hàm cập nhật React. Thêm ca hồi quy đổi file sau lưu nháp lỗi; giữ ca cùng file không mất nháp. Chạy lại R36 closure, UI R35 (đọc cờ bugReproduced), Phase 5 và TypeScript. Giữ nguyên hồ sơ R12–R36, không dùng dữ liệu thật.”

Owner chưa cần thao tác hoặc cung cấp tài khoản. Dấu hoàn tất AUDIT-R36 chỉ xác nhận đã làm kiểm định, không xác nhận GO hoặc nghiệm thu.
