# AUDIT-R32 — Giai đoạn 6 và hồi quy Giai đoạn 1–5

**Phán quyết: NO-GO cấp mã nguồn cho Giai đoạn 6.** Bộ kiểm độc lập đạt **34/67 ca**; **33 ca trượt thuộc 13 nhóm lỗi mở (11 P1, 2 P2)**. P1 là lỗi có thể làm sai bản duyệt, ghép sai tài nguyên, mất bản nháp hoặc báo lưu thành công sai; P2 là lỗi chức năng/chất lượng cần sửa trước nghiệm thu. Đây là kết luận trên mã nguồn và dữ liệu giả, chưa phải nghiệm thu LMS thật.

Các lỗi cần ưu tiên: bản đã xem không khóa đủ file/link; phản hồi không phải nghiệp vụ lưu vẫn có thể được coi là thành công; nội dung file đổi sau duyệt không bị phát hiện; và phần đọc lại đang kiểm chính các ô vừa điền. [Kết quả từng ca](evidence/phase6-results.json), [prompt sửa](FIX_PROMPT.vi.md), [ma trận](REGRESSION_MATRIX.md).

## Nguồn được kiểm và ranh giới an toàn

Kiểm ngày **21/10/2026**, trên working tree tại HEAD `2570d96b6770957e218031c91f14ce98e766dfa7`, có sẵn nhiều thay đổi chưa commit. HEAD chỉ nhận diện nền Git; dấu SHA-256 trong [manifest trước kiểm](evidence/preservation-before.json) nhận diện chính xác nguồn thực tế. So với manifest R31: **55/68 file src/scripts giữ nguyên**, hai file đổi là `sqlite.ts`, `final-project/page.tsx`, và 11 file mới thuộc Giai đoạn 6. [Đối chiếu R31](evidence/changes-since-r31.json).

Đã đọc AGENTS.md, yêu cầu TASK-6.1..6.5, các điều kiện nghiệm thu, và luồng liên quan từ giao diện → sáu API SPCK → SQLite/scanner/AI → hàng đợi → uploader → xác minh. Đã đọc hướng dẫn Route Handlers đi kèm bản Next đang cài. Phạm vi hồi quy dùng các bộ R12/R13/R16/R17 và R31 chạy mới, cùng test Giai đoạn 4/5, TypeScript và build; không lấy kết quả cũ thay bằng chứng mới.

Mọi lần thực thi sản phẩm, SQLite giả, test, TypeScript và build đều chạy trong **bản sao vật lý** tại `C:\WINDOWS\Temp\mindx-round31-r32-mvhdlh7s`. Không dùng junction về workspace. Không sao chép/đọc `.env.local`, `.env`, DB, bài nộp hoặc phiên đăng nhập thật. Môi trường tiến trình chỉ giữ các biến hệ thống cần thiết, không kế thừa thông tin tài khoản/khóa AI. `ESBUILD_BINARY_PATH` trỏ tới `eb.exe` ở TEMP ngắn, cùng SHA-256 với bản gốc. [Cô lập](evidence/isolation.json), [đối chiếu snapshot](evidence/snapshot-source-check.json), [lệnh và mã thoát](evidence/commands.json).

Rào Node chặn TCP/DNS/fetch, vẫn cho named pipe nội bộ; đây không phải tường lửa hệ điều hành. Bộ R32 dùng Chromium mới với toàn bộ yêu cầu trang bị chặn hoặc trả dữ liệu giả; không dùng persistent profile của giáo viên. Test Phase 6 nguyên bản cũng chỉ chạy trang giả và chặn endpoint GraphQL bằng dữ liệu giả. Không mở LMS/Teaching/Gemini thật.

## Kết quả các cổng

| Cổng chạy mới | Kết quả cuối | Nhận định |
|---|---:|---|
| R32 độc lập | **34/67**, mã thoát 1 | 33 ca tái hiện lỗi Giai đoạn 6 |
| `scripts/test-phase6.ts` | Mã thoát 0, đủ 4 nhóm | Đường chạy thuận lợi đạt; chưa phủ các lỗi mới |
| `scripts/test-phase5.ts` | Mã thoát 0 | PASS |
| `scripts/test-phase4-codex-repros.ts` | Mã thoát 0 | PASS |
| R12 / R13 / R16 / R17 nguyên bản | **43/43, 89/89, 15/16, 38/38** | Giữ nguyên một FAIL hợp đồng cũ của R16 |
| R31 `verify-independent.mjs` nguyên bản | **819/819** | PASS hồi quy Giai đoạn 5 trong phạm vi bộ kiểm |
| Đối chứng R16 theo schema hiện tại | **1/1** | Đủ 8 bảng, đúng lớp/học viên, không đổi chủ bài nộp |
| `tsc --noEmit --incremental false` trước/sau build | Mã thoát **0 / 0** | PASS |
| `next build --webpack` | Mã thoát **0**, **28/28 trang** | PASS |

R16 kỳ vọng cứng **7 bảng**, trong khi có thêm `homework_submission_meta` phục vụ bảo vệ nháp Giai đoạn 5. Bộ cũ dừng ở kiểm đếm, nên R32 kiểm lại cả tám tên bảng và hai điều kiện nằm sau đó. Ca `R32-REG-SCHEMA` đạt. Không sửa R16 và không đổi kết quả nguyên bản thành PASS. Các bộ lịch sử có thể phủ trùng chức năng; không cộng số ca của chúng thành tổng nghiệm thu sản phẩm.

## Các phát hiện cần sửa

### R32-01 · P1 · Bản đã xem chưa khóa đầy đủ; duyệt cả lớp có thể dở dang

**Nguyên nhân:** `reviewedItems` có thể bị bỏ hẳn; khi có thì chỉ đối chiếu thư mục, tiêu đề và nhận xét. Thumbnail, ảnh, tài liệu, link và xác nhận ghép nối không được đối chiếu. Vòng lặp ghi từng học viên trước khi kiểm xong cả nhóm.

**Vị trí:** `src/app/api/spck/approve/route.ts:77`, `:87`, `:155`; `src/app/final-project/page.tsx:516`.

**Bằng chứng:** `R32-A02` thiếu snapshot vẫn HTTP 200/APPROVED; sáu biến thể `R32-A03-*` snapshot lệch vẫn được duyệt; `R32-A05` trả HTTP 409 cho học viên sau nhưng học viên trước đã APPROVED. Đối chứng snapshot đúng và nhận xét lệch hoạt động đúng.

**Cách sửa:** bắt buộc snapshot đầy đủ của nội dung và phiên bản file đã xem; kiểm toàn bộ trước khi ghi, rồi duyệt nguyên khối bằng giao dịch SQLite. **Sau sửa:** thiếu/lệch bất kỳ trường nào phải bị từ chối và không học viên nào trong nhóm bị duyệt dở dang.

### R32-02 · P1 · Cùng thư mục vẫn có thể gán cho hai học viên

**Nguyên nhân:** chống trùng chỉ so chuỗi viết thường. Kết quả chuẩn hóa của `assertPathAllowed()` không được dùng làm khóa thư mục lưu trong bản nháp; các bước duyệt/upload cũng so chuỗi theo cách tương tự.

**Vị trí:** `src/app/api/spck/save-draft/route.ts:51`, `:54`; `approve/route.ts:42`; `src/lib/playwright/spck-uploader.ts:333`.

**Bằng chứng:** `R32-M02/M03` lưu học viên thứ hai HTTP 200 bằng đường `student\..\student` hoặc đổi `\` thành `/`, dù `realpath` là cùng thư mục. Cùng chuỗi nguyên văn bị chặn đúng (`M01`).

**Cách sửa:** dùng một khóa đường dẫn thật, chuẩn hóa nhất quán trên Windows ở lưu/quét/duyệt/upload; kiểm trùng trong giao dịch. **Sau sửa:** cả hai biến thể phải bị chặn, không sinh bản ghép thứ hai.

### R32-03 · P1 · Xác nhận thư mục cũ bị mang sang thư mục mơ hồ mới

**Nguyên nhân:** scanner nhận diện đúng cần xác nhận thủ công, nhưng API quét giữ `existing.isConfirmedByTeacher` khi `autoConfirmed` là false, kể cả đã đổi thư mục.

**Vị trí:** `src/app/api/spck/scan/route.ts:56`.

**Bằng chứng:** `R32-M04`: folder mới `01_Ngo_Khoi_Nguyen` có `requiresManualConfirmation=true` nhưng DB vẫn lưu `isConfirmedByTeacher=1`.

**Cách sửa:** xác nhận phải gắn đúng cặp học viên–thư mục; khi cặp hoặc điều kiện mơ hồ thay đổi, xóa xác nhận/hash và yêu cầu duyệt lại. **Sau sửa:** folder mới chưa được giáo viên xác nhận không được duyệt/upload.

### R32-04 · P1 · Hash chỉ khóa đường dẫn, chưa khóa byte tài nguyên

**Nguyên nhân:** `contentHash` chứa tên đường dẫn và JSON, không chứa dấu vân tay nội dung file. Preflight chỉ kiểm đường dẫn/tồn tại, không kiểm lại media.

**Vị trí:** `src/lib/db/sqlite.ts:987`; `src/lib/playwright/spck-uploader.ts:207`.

**Bằng chứng:** `R32-D03`: file `.py` đổi byte sau duyệt, hash bản ghi không đổi và upload vẫn hợp lệ. `D04`: thumbnail đã đổi thành văn bản giả PNG vẫn được nhận. Scanner ban đầu có kiểm media đúng; thiếu sót xuất hiện sau bước quét/duyệt.

**Cách sửa:** khóa manifest tài nguyên gồm đường dẫn và SHA-256 byte tại duyệt; đối chiếu lại trước upload/lưu, kiểm lại media cần thiết. **Sau sửa:** file đổi phải hạ WAITING_APPROVAL và không gửi bản chưa được xem.

### R32-05 · P1 · Nhận nhầm phản hồi và đọc lại ô nhập chưa lưu

**Nguyên nhân:** chỉ cần POST/PUT/PATCH vào URL chứa `graphql/spck/final-project`; không khóa đúng yêu cầu lưu, payload và kết quả nghiệp vụ. Thiếu `saveStudentSpck` vẫn đi tiếp. Phần đọc lại dùng `inputValue()` của chính ô vừa `fill()`, không mở lại dữ liệu đã lưu.

**Vị trí:** `src/lib/playwright/spck-uploader.ts:638`, `:673`, `:701`.

**Bằng chứng native:** `R32-P05` dùng `GetViewer`; `P06` trả `success:false/status:REJECTED`; `P07` máy chủ giả không lưu. Cả ba vẫn **VERIFIED**. HTTP 500, GraphQL errors và ID phản hồi sai được chặn đúng ở các đối chứng `P02..P04`. [Quan sát trình duyệt](evidence/browser-scenarios.json).

**Cách sửa:** nhận đúng mutation/request lưu gắn đúng lớp/học viên, yêu cầu kết quả nghiệp vụ xác nhận thành công; mở lại khung từ dữ liệu đã lưu rồi đối chiếu toàn bộ bản duyệt. **Sau sửa:** ba ca âm tính trên không được VERIFIED.

### R32-06 · P1 · Phát hiện thay đổi quá muộn, sau khi đã bấm lưu

**Nguyên nhân:** kiểm DB trước khi bắt đầu điền và khi đánh dấu VERIFIED, nhưng không kiểm lại sát trước nút Lưu.

**Vị trí:** `src/lib/playwright/spck-uploader.ts:466`, `:650`, `:750`.

**Bằng chứng:** `R32-P12` ghi nhận chỉnh DB khi `saveRequestsSoFar=0`; sau đó vẫn phát sinh một yêu cầu lưu. Hệ thống có từ chối VERIFIED và giữ WAITING_APPROVAL, nhưng yêu cầu ghi bản cũ đã được gửi. [Ảnh trang giả](evidence/drift-before-click.png).

**Cách sửa:** đối chiếu lại trạng thái, xác nhận ghép, hash và manifest file ngay trước Save; hủy khi lệch. **Sau sửa:** ca này phải có **0 yêu cầu lưu**, không chỉ 0 VERIFIED.

### R32-07 · P1 · Tên riêng vẫn lọt vào prompt gửi AI

**Nguyên nhân:** peer chỉ được thay cả họ tên; phần tên mục tiêu không dấu chỉ được thay khi khớp đủ họ tên. Token tên riêng không dấu không được che đầy đủ.

**Vị trí:** `src/lib/gemini/spck-comment.ts:109`, `:130`.

**Bằng chứng:** `R32-G03` giữ “Khang” trong ghi chú gửi AI; `G04` giữ “Nguyen”. Cả họ tên có dấu/không dấu và thẻ đóng sandbox giả đã được che đúng trong đối chứng. Tất cả tên trong kiểm toán là dữ liệu giả; không gửi Gemini thật.

**Cách sửa:** tái sử dụng cách che danh tính đã kiểm ở Giai đoạn 5, xử lý Unicode, tên đầy đủ/tên riêng có dấu và không dấu, mục tiêu và peer; kiểm mọi đoạn văn ghép vào prompt. **Sau sửa:** prompt không còn các tên thuộc fixture, vẫn có `STUDENT_01/STUDENT_PEER`.

### R32-08 · P1 · AI cũ chưa nhận biết đổi dự án; nhánh thiếu dữ kiện xóa nhận xét đã duyệt

**Nguyên nhân:** guard chỉ so nhận xét/hash và một số trạng thái, không so toàn bộ phiên bản đầu vào. Nhánh trống tags/note chủ động ghi `teacherComment:""`.

**Vị trí:** `src/lib/gemini/spck-comment.ts:280`, `:287`, `:440`.

**Bằng chứng:** `R32-G08` đổi tiêu đề khi AI chờ vẫn ghi kết quả cũ vào dự án mới; `G09` gọi với dữ kiện trống xóa nhận xét đã duyệt. Đổi nhận xét giáo viên trong lúc chờ được bảo vệ đúng (`G07`).

**Cách sửa:** gắn AI với phiên bản đầy đủ của gói dự án/dữ kiện; ghi có điều kiện. Thiếu thông tin chỉ báo trạng thái/kết quả, không xóa bản giáo viên đã viết. **Sau sửa:** AI cũ bị bỏ và nhận xét có sẵn giữ nguyên.

### R32-09 · P1 · Thứ tự nháp/UI và lỗi lưu chưa được khóa

**Nguyên nhân:** API không có thứ tự bản nháp; UI áp phản hồi cũ nguyên hàng, áp AI cũ lên nội dung mới và nuốt lỗi `persistRowDraft()` nên vẫn gọi duyệt/upload.

**Vị trí:** `src/app/api/spck/save-draft/route.ts:137`; `src/app/final-project/page.tsx:347`, `:375`, `:455`, `:512`.

**Bằng chứng:** `R32-M06` nháp OLD đến sau ghi đè NEW trong SQLite. `U02` phản hồi cũ trả UI về OLD; `U04` AI cũ đè nội dung vừa gõ; `U03` lưu nháp HTTP 500 nhưng vẫn gọi cả approve và upload. Các ca UI chạy đúng thân hàm với phản hồi/hook điều khiển được, chưa phải kiểm toàn bộ bộ lập lịch React.

**Cách sửa:** bảo vệ thứ tự bền ở API theo lớp/học viên/phiên bản; UI bỏ phản hồi lỗi thời theo hàng và lớp, theo dõi sửa sau khi gọi AI; lưu nháp phải trả lỗi rõ và dừng dây chuyền duyệt/upload. **Sau sửa:** NEW luôn giữ nguyên, lỗi lưu không phát sinh lời gọi duyệt/upload.

### R32-10 · P2 · Tự chọn dữ kiện đánh giá và lọt diễn đạt thuyết trình

**Nguyên nhân:** tải DB hoặc quét folder đều tự tích hai tag tích cực thay giáo viên. Bộ lọc thuyết trình chỉ dựa một danh sách cụm từ nên nhận xét đồng nghĩa vẫn lọt.

**Vị trí:** `src/app/final-project/page.tsx:183`, `:317`; `src/lib/gemini/spck-comment.ts:66`.

**Bằng chứng:** `R32-U01` chưa có đánh giá giáo viên nhưng đã có hai tag tích cực. `G06` cờ thuyết trình false nhưng vẫn giữ câu “diễn đạt lưu loát trước đám đông ... khán giả”. Guard trống dữ kiện và câu chứa “thuyết trình” thông thường hoạt động đúng (`G01/G05`).

**Cách sửa:** mặc định tags rỗng hoặc khôi phục đúng lựa chọn đã lưu; giới hạn các phần đánh giá theo dữ kiện/cờ đã chọn, không coi prompt hay vài từ khóa là bảo đảm tuyệt đối. **Sau sửa:** chưa có lựa chọn phải INSUFFICIENT_INFO; không có cờ/bằng chứng không sinh nhận xét thuyết trình.

### R32-11 · P2 · Đổi gợi ý ghép học viên trên UI bị bản ghép cũ chặn

**Nguyên nhân:** scanner đã lưu folder vào S1; đổi dropdown sang S2 chỉ gửi lưu S2, không có thao tác chuyển quyền ghép khỏi S1.

**Vị trí:** `src/app/final-project/page.tsx:851`, `:869`; `src/app/api/spck/save-draft/route.ts:54`.

**Bằng chứng:** `R32-M05` tái hiện request mà dropdown gửi: HTTP 409, folder vẫn thuộc S1. Việc API chặn trùng là đúng; lỗi nằm ở luồng chuyển ghép chưa đầy đủ, không phải cần bỏ hàng rào chống trùng.

**Cách sửa:** bổ sung chuyển ghép có đối chiếu bản cũ, xác nhận người dùng và giao dịch nguyên khối; vô hiệu bản duyệt cũ. **Sau sửa:** chuyển hợp lệ chỉ còn một chủ folder; request lỗi thời không được tự cướp folder.

### R32-12 · P1 · Chưa chờ upload xong và chưa xác minh tài nguyên thật

**Nguyên nhân:** không tìm được control thumbnail vẫn đi tiếp; `setInputFiles()` được coi như đã tải lên; nhận diện file dựa chữ xuất hiện ở bất kỳ đâu trong card. Không xác minh thumbnail sau lưu.

**Vị trí:** `src/lib/playwright/spck-uploader.ts:562`, `:584`, `:598`, `:731`.

**Bằng chứng native:** `R32-P08` thiếu control thumbnail vẫn VERIFIED; `P09` chỉ hiện tên file trong UI, không có request upload hoàn tất vẫn VERIFIED; `P10` tên `main.py` trong đoạn chữ làm bỏ upload rồi VERIFIED.

**Cách sửa:** thiếu control bắt buộc phải thất bại; chờ đúng phản hồi upload và trạng thái hoàn tất; xác minh danh sách tài nguyên đã lưu theo định danh/đường dẫn/tên và phiên bản thích hợp, không dùng toàn bộ `innerText`. **Sau sửa:** cả ba ca không được VERIFIED. [Ảnh thiếu thumbnail](evidence/thumbnail-not-uploaded.png).

### R32-13 · P1 · Chọn nhầm card sản phẩm và coi URL chứa nhau là cùng link

**Nguyên nhân:** selector nhận mọi `.spck-item`, rồi lấy phần tử đầu; chỉ kiểm riêng card 02 ở cuối. Kiểm link bằng phép tìm chuỗi con.

**Vị trí:** `src/lib/playwright/selectors.ts:98`; `src/lib/playwright/spck-uploader.ts:520`, `:551`, `:621`, `:693`.

**Bằng chứng native:** `R32-P13` trang chỉ có card **03** vẫn bị sửa và VERIFIED, báo đã dùng lại card 01; `P14` có `https://youtu.be/abc-longer` thì bỏ nút + Thêm cho `https://youtu.be/abc` mà vẫn VERIFIED. [Ảnh card 03](evidence/wrong-item03.png).

**Cách sửa:** định danh chính xác card 01 trước mọi thao tác ghi; trạng thái nhiều/khác card phải xử lý an toàn. So URL đầy đủ từ danh sách link thật, không dùng tìm chuỗi trong toàn card. **Sau sửa:** không ghi card 02/03 ngoài phạm vi; link mới được bấm + Thêm đúng một lần, retry không thêm trùng.

## Những phần đã có bằng chứng tốt

Thuật toán tên xử lý dấu, Đ/đ, chuỗi Unicode tổ hợp, tên mơ hồ, trùng tên và đụng độ thư mục đúng trong các ca N01..N06. Scanner chặn thoát allowlist và junction, chọn thumb/bìa/ảnh đầu, loại ảnh/PDF giả, giới hạn 10 ảnh/10 tài liệu, loại `links.txt` khỏi tài liệu, giới hạn link 5+5 và tiêu đề 100 ký tự. Không suy rộng thành mọi file/media đều an toàn.

Sáu API SPCK đều chặn Origin bên ngoài; giao diện không nhập cấu hình server hoặc ba biến bí mật bị cấm. Dev/start bind `127.0.0.1`. BrowserManager dùng singleton persistent context và khóa khởi tạo; uploader công khai xếp việc qua `SequentialTaskQueue`. Rà mã và hồi quy xác nhận những cơ chế này còn được giữ, không chứng nhận an toàn tuyệt đối.

Luồng thuận lợi tạo card 01, bấm + Thêm đủ hai YouTube và một link liên quan, rồi chạy lại không tạo card 02 và không thêm link trùng đã đạt bằng native Chromium. Hash trường nội dung, hạ trạng thái khi sửa nhận xét và cập nhật VERIFIED có điều kiện cũng đạt các đối chứng. Các ca âm tính nêu trên vẫn ngăn kết luận GO.

## Tính độc lập, bảo toàn và giới hạn

[verify-phase6.mjs](verify-phase6.mjs) import trực tiếp module TypeScript cho scanner, SQLite, API và uploader. Phần AI dùng nguyên thân mã sản phẩm, chỉ bỏ import/kiểu TypeScript và thay Gemini bằng phản hồi giả. Phần UI chạy nguyên đoạn hàm trước JSX với hook/phản hồi điều khiển được để kiểm thứ tự. Không sửa nguồn sản phẩm nhằm làm test chạy. [Hash nguồn và kết quả](evidence/phase6-results.json), [lịch sử phát triển bộ kiểm](evidence/harness-development-notes.md).

Đối chiếu cuối: **1497/1497 file trong tập kiểm bảo toàn nguyên byte**, gồm **1412 file bảo vệ** (`next-env.d.ts` và toàn bộ R12–R31), **68/68 src/scripts**, kế hoạch và cấu hình mẫu. Git status ngoài R32 không đổi. [Bảo toàn](evidence/preservation-check.json). Không cập nhật checkbox kế hoạch vì yêu cầu lượt này chỉ cho ghi trong R32; dấu [x] có sẵn của TASK-6.x không thay thế phán quyết kiểm toán.

SHA-256 `next-env.d.ts` ở workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Next chỉ tái tạo file trong TEMP khi build. Tập bảo toàn không bao gồm nội dung `.env*`, dữ liệu thật, toàn bộ `node_modules/.next` hoặc hồ sơ ngoài các đường dẫn đã kê trong manifest.

Chưa kiểm giao diện React đầy đủ trên ứng dụng thật, tài khoản/DB/bài nộp thật, schema/API LMS thật, upload thật, Gemini thật, hoặc phục hồi sau mất mạng thật. Các trang Chromium là trang giả; phản hồi AI là giả; đây là bằng chứng lỗi mã nguồn và hồi quy, không phải nghiệm thu vận hành. Không chạy lại toàn bộ oracle/native R22–R31; lượt này chạy nguyên bộ R31 chính 819 ca và các cổng được liệt kê.

**Đã làm:** hoàn tất kiểm toán độc lập, tạo bộ tái hiện, hồi quy và hồ sơ mới tại R32.

**Kết quả:** NO-GO Giai đoạn 6; 13 nhóm lỗi mở, dù TypeScript, build và các cổng sản phẩm có sẵn đạt.

**Chưa kiểm tra:** tài khoản, dữ liệu, LMS/Gemini thật và toàn bộ giao diện thực tế.

**Việc tiếp theo:** giao [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho lượt sửa riêng; kiểm toán lại trên đúng nguồn sau sửa trước khi nghiệm thu Giai đoạn 6. Owner không cần chạy lệnh hoặc cung cấp thông tin đăng nhập cho hồ sơ R32 này.
