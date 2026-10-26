# AUDIT-R37 — Closure Verification Giai đoạn 5

**Kết luận: GO cấp mã nguồn cho Giai đoạn 5 trong phạm vi kiểm định.** Đóng đủ **8/8 mã R35-01..R35-07 và R36-01**; không phát hiện lỗi cần sửa thêm trong phần nguồn đã rà. Kết luận này thay thế NO-GO cấp mã nguồn của AUDIT-R36, không thay cho nghiệm thu tài khoản/dữ liệu/LMS thật.

Kiểm định ngày 21/10/2026, do chính Codex của phiên hiện tại thực hiện, không ủy quyền agent khác. Cấu hình Owner yêu cầu: `gpt-6.1-sol`, suy luận `high`; không có chứng thư độc lập xác nhận cấu hình mô hình thực chạy. HEAD `2570d96b6770957e218031c91f14ce98e766dfa7`; đối tượng là cây làm việc hiện tại, gồm thay đổi chưa commit/chưa được Git theo dõi. Không sửa mã sản phẩm, không tạo commit.

## 1. Kết quả chạy mới

Đã chạy **đủ 11/11 lệnh nguyên văn** trong `%TEMP%\mindx-round31-r36-check`, với `ESBUILD_BINARY_PATH=%TEMP%\mindx-esbuild.exe`. Năm bộ nền tảng đạt **819/819, 221/221, 88/88, 4/4, 28/28**; Phase5 đạt đủ 8 nhóm (gồm ca mới R36-01); TypeScript 0 lỗi; core R35 đạt 3/3; UI R35 có 3/3 `bugReproduced:false`; barem R35 có 1/1 `bugReproduced:false`; R36 closure đạt **10/10**, không còn FAIL.

Có **9 lệnh thoát 0 và 2 lệnh thoát 1 theo quy ước bộ dò cũ**. Hai script R35 UI/barem cố ý thoát 1 khi lỗi gốc không còn tái hiện. Đã giữ nguyên mã thoát, đọc đủ JSON mới và đọc mã script, không sửa script lịch sử để đổi thành 0. Ma trận đầy đủ, lệnh/log/JSON và giới hạn từng ca ở `REGRESSION_MATRIX.md` và `evidence/results.json`.

## 2. Rà trực tiếp bản sửa R36-01

Đối chiếu SHA-256 với dấu vân tay nguồn trước R36 cho thấy chỉ hai tệp sau thay đổi trong tập nguồn/config/quy tắc được R36 bảo vệ:

- `scripts/test-phase5.ts`: `C009A17A052F9EA8955541B0A6F25D14D7C58A2FC9C214D1F4515DBB3DAD323C`
- `src/components/homework-auto-grader-tab.tsx`: `3BCBBA6F6EC50178F5F4B66EC75CFC05A47AF7703C4752D4837CE4864ABC80F0`

Tại `homework-auto-grader-tab.tsx:231–274`, mã lập bản ghép cuối từ hàng máy chủ và bản nháp cục bộ trước. Nó so cả `draftSeq` và `fileHash`: cùng file chưa được xác nhận lưu thì giữ điểm/nhận xét và cờ chưa lưu; file mới thì dùng dữ liệu máy chủ, xóa cờ phụ và thay bản nháp. Sau đó `:306–307` mới đặt `unsavedSubIds` và `submissions` từ cùng kết quả. Không còn cập nhật cờ dùng chung bên trong hàm cập nhật React của nhánh này. Phạm vi lớp/buổi và thứ tự phản hồi vẫn được kiểm trước khi ghép.

Tại `scripts/test-phase5.ts:686–835`, ca hồi quy chạy thân hàm nguồn thật với dữ liệu giả: lưu nháp lỗi → làm mới cùng file giữ nguyên chữ/cờ → đổi `fileHash` sang file-v2 → ngay lần làm mới đầu, chữ cũ được thay và cờ hết → hàm Duyệt trả true, gửi đúng một yêu cầu. Test không chỉ kiểm tra chuỗi mã hoặc cờ ngoài giao diện. Bộ R36 độc lập cho cùng quan sát: `unsaved={}`, `approveResult=true`, `approvalCalls=1`; lần làm mới thứ hai vẫn ổn định.

Đã đọc thêm các bên gọi và nhánh liên quan: API submissions/approve/download-and-grade, cấu hình barem/mặc định giao diện, ScoreAuditor, chấm đơn/chấm lô, tải bài và parser Scratch/GameMaker. R35-01 chặn thang 10 ở các cổng và chấp nhận 80/100; R35-02 giữ nháp cùng file; R35-03 không để phản hồi buổi cũ lấn buổi mới; R35-04 Stop chặn học viên kế tiếp và ghi kết quả; R35-05 đọc bảng mới trước lọc; R35-06 giữ toán hạng, giới hạn đệ quy; R35-07 từ chối GML/YY hỏng. Chi tiết định vị và chứng cứ từng mã: `evidence/source-review.json`.

## 3. Tính toàn vẹn và an toàn

- Bản sao chứa đúng `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `src`, `scripts`, `docs`, `data/config`; `node_modules` là junction tới thư viện sẵn có. **1,735 tệp thuộc tập bảo vệ có trong bản sao khớp từng SHA-256**. Không sao chép `.env*`, DB thật hay `playwright-auth`; không cài thư viện.
- Chỉ tiến trình thử nhận đường dẫn esbuild yêu cầu; gỡ biến môi trường có tên chứa PASSWORD/API_KEY/TOKEN/SECRET và dùng network-guard lịch sử chặn TCP/DNS/fetch. Dòng dotenv “injected env (0)” trong log không có nghĩa đã sao chép file bí mật; kiểm tra bản sao xác nhận không có file bị cấm.
- Bằng chứng R35/R36 được sao lưu riêng trong R37 trước khi chạy; chỉ bản sao TEMP của JSON đầu ra bị thay. Không chạy cổng thử có ghi bằng chứng trong repo chính, không dùng lại JSON lịch sử làm kết quả mới.
- Sau kiểm thử và sau dọn dẹp, **1,738/1,738 tệp bảo vệ nguyên vẹn**, gồm **1,657 tệp R12–R36**. Không thêm/xóa tệp trong các tập bảo vệ. `next-env.d.ts` giữ đúng `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`.
- Đã gỡ junction riêng trước khi xóa TEMP; xác nhận không còn liên kết con rồi xóa bản sao và hai thư mục dữ liệu giả do bộ thử tạo. Thư viện gốc và tệp esbuild đã tồn tại được giữ lại. Lượt dọn có Force bị kiểm tra tự động từ chối với lý do “blocked by policy”; cách không dùng Force đã hoàn tất. PowerShell cũ lỗi khi gỡ junction nên dùng xóa liên kết không đệ quy, sau đó dọn thư mục thường bằng PowerShell. Chi tiết: `evidence/cleanup.json`.

Chỉ thêm hồ sơ `round-37` và nối đúng một dòng AUDIT-R37 vào cuối kế hoạch. Phần kế hoạch có sẵn được giữ nguyên từng byte; `[x]` xác nhận hoàn tất kiểm định, không tự mở rộng nghiệm thu TASK-5.x. Dấu vân tay trước/sau, bản kế hoạch trước và trạng thái Git được giữ trong `evidence/` để đối chiếu.

## 4. Chưa kiểm tra và việc tiếp theo

Chưa chạy giao diện trong trình duyệt thật, bản dựng ứng dụng, LMS/Gemini thật, dữ liệu thật hoặc toàn bộ Giai đoạn 6/7 trong R37. Ca tải bài R35-05 dừng có chủ ý tại BrowserManager giả, chỉ xác nhận việc đọc mới trước khi lọc. Stop chưa chứng minh hủy được yêu cầu AI đã gửi ra ngoài. Bộ mô phỏng hooks không phải chứng minh về mọi lịch chạy React.

Không còn việc sửa mã cần làm cho 8 mã thuộc vòng đóng lỗi này. Owner chưa cần thao tác hay cung cấp tài khoản. Nghiệm thu vận hành thật vẫn cần một lượt riêng có phạm vi được duyệt.
