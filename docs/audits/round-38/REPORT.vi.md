# AUDIT-R38 — Kiểm toán độc lập Giai đoạn 6

**Kết luận: NO-GO — chưa đủ điều kiện nghiệm thu TASK-6.1..TASK-6.5.** Có **12 nhóm lỗi mới: 5 P1 (cần sửa trước khi nộp thật), 7 P2**. Bộ đối kháng mới đạt **24/41**, còn **17 tình huống FAIL**. Không sửa mã sản phẩm.

Ứng dụng giúp một giáo viên quét thư mục sản phẩm cuối khóa trên máy, ghép với học viên, soạn nhận xét, duyệt và upload LMS. Kiểm toán giả định một người dùng cục bộ, nhưng vẫn có phản hồi mạng chậm, đổi lớp, tải lại trang và chỉnh dữ liệu khi tác vụ đang chạy.

## Nguồn và cách kiểm

- Thực hiện trực tiếp bởi Codex; yêu cầu reviewer `gpt-6.1-sol`/`high`, không giao agent khác. Không có chứng thư runtime độc lập để khẳng định danh tính model ngoài cấu hình được yêu cầu.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Cây làm việc đã có nhiều thay đổi trước kiểm toán; bằng chứng gắn với SHA-256 từng file, không gắn với HEAD đơn lẻ.
- Đã đọc sâu 6 tệp sản phẩm được nêu có tồn tại, toàn bộ API SPCK thực tế và phần lưu SPCK trong SQLite, cùng queue, local-guard, allowlist, browser-manager, selectors, network-interceptor và các bài kiểm tra nền.
- Hai đường dẫn yêu cầu không tồn tại: `src/app/api/final-project/route.ts`, `src/lib/db/repositories/spck-submission-repo.ts`. Đã lần theo giao diện đến `src/app/api/spck/{scan,list,save-draft,approve,generate-ai,upload-lms}/route.ts` và `src/lib/db/sqlite.ts`; không tạo đường dẫn giả.
- Bản sao đúng `$env:TEMP\mindx-round31-r38-phase6`: chỉ chép package.json, tsconfig.json, next.config.ts, next-env.d.ts, src, scripts, docs, data/config; node_modules là junction. Không chép `.env*`, DB thật hoặc playwright-auth thật. Cấu hình ESBUILD_BINARY_PATH trỏ `$env:TEMP\mindx-esbuild.exe`.
- Node được chặn TCP/DNS/fetch bằng network-guard lịch sử; Chromium chặn toàn bộ request qua route. SQLite, scanner, route handlers và uploader là mã sản phẩm thật trong TEMP. AI dùng lời gọi giả tại ranh giới Gemini. UI chạy nguyên thân hàm trước JSX với hook giả để điều khiển thứ tự phản hồi; chưa phải ứng dụng React được mount đầy đủ.
- Đã xem ảnh chụp trình duyệt của ca pending-files; ảnh là form giả lập để chứng minh hành vi uploader, không phải ảnh LMS thật.

## Cổng nền

- Phase 6 PASS đủ 4 nhóm; Phase 5 PASS đủ 8 nhóm; TypeScript `--noEmit --incremental false` PASS, 0 lỗi.
- Lệnh R32 nguyên bản đã chạy đúng trong thư mục yêu cầu nhưng **BLOCKED** bởi assertion chỉ chấp nhận tên `mindx-round31-r32-*`. Không đổi kết quả này thành PASS.
- Chạy thêm `docs/audits/round-38/r32-compatible.mjs`: **67/67 PASS**. Diff chỉ thay một literal trong assertion từ tên R32 sang R38, giữ nguyên 67 ca và toàn bộ hồ sơ gốc. Hash bản gốc/bản tương thích ở compatibility-gate.json.
- Bộ mới `adversarial.mjs`: **24 PASS, 17 FAIL / 41 ca**. Mọi FAIL cuối đều có dữ kiện tái hiện tương ứng bên dưới.

## Phát hiện phải sửa

### R38-01 — P1: Link vừa hiện trên form bị coi là bằng chứng LMS đã lưu

- **Nguyên nhân:** Điều kiện hasRenderedNonInputEvidence chấp nhận bất kỳ danh sách link/file khác rỗng. Danh sách này đã được cập nhật ngay khi bấm + Thêm, trước khi có bằng chứng máy chủ lưu thành công.
- **Vị trí:** `src/lib/playwright/spck-uploader.ts:973-981`.
- **Tái hiện / hậu quả:** R38-P-no-persist: form có link mới; phản hồi HTTP 200 đúng mã học viên nhưng máy chủ giả không ghi bản nào (serverRows={}). SQLite vẫn thành VERIFIED. Giáo viên thấy hoàn tất nhưng sản phẩm thực tế chưa được lưu.
- **Cách sửa:** Sau Lưu, đọc lại dữ liệu SPCK từ máy chủ hoặc mở lại khung từ dữ liệu vừa tải; đối chiếu đầy đủ tiêu đề, bình luận và danh sách đã lưu. Không dùng danh sách cục bộ vừa sửa làm bằng chứng.
- **Sau khi sửa:** chạy lại `R38-P-no-persist` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-02 — P1: Phản hồi request của học viên/lớp khác vẫn có thể VERIFIED

- **Nguyên nhân:** Bộ chờ chỉ lọc URL/method và tên operation rất rộng; không khóa variables của request theo classId/studentId. Mã trong response chỉ được so khi có mặt.
- **Vị trí:** `src/lib/playwright/spck-uploader.ts:790-869`.
- **Tái hiện / hậu quả:** R38-P-wrong-request: request SaveStudentSpck gửi OTHER_CLASS/OTHER_STUDENT, response data.saveStudentSpck={persisted:true}. Máy chủ giả chỉ có OTHER_STUDENT nhưng SQLite ghi R38_S1=VERIFIED. Trạng thái hoàn tất bị gắn cho học viên chưa được lưu đúng.
- **Cách sửa:** Khóa phản hồi theo mutation đúng SPCK và variables đúng lớp/học viên; kiểm tra định danh kết quả hoặc lần đọc lại độc lập. Thiếu bằng chứng định danh phải từ chối.
- **Sau khi sửa:** chạy lại `R38-P-wrong-request` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-03 — P1: Chưa tải xong file vẫn bấm Lưu và VERIFIED

- **Nguyên nhân:** setInputFiles chỉ chọn file. Bộ đếm chấp nhận một HTTP 200/201 có chuỗi /file, /media, /storage hoặc /upload; không gắn với từng file, không đợi tất cả upload kết thúc trước Lưu.
- **Vị trí:** `src/lib/playwright/spck-uploader.ts:623-638, 713-720, 786-806, 872-882`.
- **Tái hiện / hậu quả:** R38-P-pending-files: chọn 2 file, cả 2 vẫn pending; chỉ POST /files/telemetry trả 200. Bot gửi Lưu và ghi VERIFIED, attachmentsUploadedCount=2 dù không có request tải file nào hoàn tất. LMS có thể thiếu file dù giáo viên được báo đã tải đủ.
- **Cách sửa:** Theo dõi upload thật của từng tài nguyên và mã file trả về, đợi mọi upload thành công trước bấm Lưu; phản hồi nền không được tính. Đối chiếu manifest đã lưu sau đó.
- **Sau khi sửa:** chạy lại `R38-P-pending-files` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-04 — P1: File mới trùng tên file cũ trên LMS bị bỏ qua

- **Nguyên nhân:** Chống trùng ảnh/tài liệu chỉ so basename. Đối chiếu sau lưu cũng chỉ kiểm tra tên, không chứng minh file trên LMS là phiên bản bytes giáo viên đã duyệt.
- **Vị trí:** `src/lib/playwright/spck-uploader.ts:686-720, 936-947`.
- **Tái hiện / hậu quả:** R38-P-old-file: LMS giả đã có main.py phiên bản cũ, ổ đĩa có main.py bytes khác. Không chọn/upload file nào (uploadChanges=0), hai SHA-256 khác nhau, vẫn VERIFIED khi response có filesUploaded=true. Giáo viên có thể nộp nhầm phiên bản cũ của sản phẩm.
- **Cách sửa:** Giữ manifest phiên bản file/định danh server gắn với hash đã duyệt; file cùng tên nhưng khác nội dung phải thay thế. Nếu LMS không cung cấp bằng chứng đủ tin cậy, không đánh dấu VERIFIED.
- **Sau khi sửa:** chạy lại `R38-P-old-file` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-05 — P1: Stop Bot không chặn học viên kế tiếp trong một lượt cả lớp

- **Nguyên nhân:** stopQueue hủy tác vụ còn chờ, nhưng cả lớp đang nằm trong một tác vụ. Hai vòng lặp AI/upload không kiểm tra tín hiệu dừng giữa các học viên.
- **Vị trí:** `src/lib/gemini/spck-comment.ts:286-289; src/lib/playwright/spck-uploader.ts:517-520; src/lib/queue/task-queue.ts:155-185`.
- **Tái hiện / hậu quả:** R38-G-stop: dừng sau lời gọi AI đầu, vẫn có 2 calls/2 results. R38-P-stop: dừng khi lưu học viên đầu, vẫn lưu và VERIFIED cả R38_S1 lẫn R38_S2, stopFlag=true. Bot tiếp tục gọi AI và ghi lên LMS sau khi giáo viên yêu cầu dừng.
- **Cách sửa:** Truyền tín hiệu hủy chung; kiểm tra trước học viên kế tiếp và trước các bước gây ghi dữ liệu. Học viên chưa chạy phải giữ nguyên, không ghi đè các bản đã VERIFIED.
- **Sau khi sửa:** chạy lại `R38-G-stop`, `R38-P-stop` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-06 — P2: Gói ZIP, Scratch, GameMaker và Office hỏng vẫn được nhận

- **Nguyên nhân:** Ảnh/PDF được kiểm tra cấu trúc, nhưng các gói zip/sb3/yyz/docx/pptx chỉ cần khác 0 bytes và đúng đuôi tên.
- **Vị trí:** `src/lib/local-files/spck-scanner.ts:309-324; src/lib/playwright/spck-uploader.ts:270-299`.
- **Tái hiện / hậu quả:** 5 ca R38-S-corrupt-*: mỗi file chỉ chứa THIS IS NOT A ZIP OR OFFICE PACKAGE nhưng vẫn nằm trong attachments, không có cảnh báo hỏng. Gói không mở được vẫn đi qua bước chuẩn bị nộp.
- **Cách sửa:** Kiểm tra chữ ký và cấu trúc thực của từng loại gói; chặn hoặc cảnh báo bắt buộc xử lý trước duyệt. Không đánh đồng lỗi đọc file với bài làm kém.
- **Sau khi sửa:** chạy lại `R38-S-corrupt-zip`, `R38-S-corrupt-sb3`, `R38-S-corrupt-yyz`, `R38-S-corrupt-docx`, `R38-S-corrupt-pptx` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-07 — P2: API cho duyệt URL không phải HTTP/HTTPS

- **Nguyên nhân:** Bộ đọc links.txt có kiểm tra URL nhưng đường lưu/sửa nháp chỉ trim/cắt số lượng. Bước duyệt và chuẩn bị upload cũng không kiểm tra lại giao thức hay cấu trúc URL.
- **Vị trí:** `src/app/api/spck/save-draft/route.ts:143-165; src/app/api/spck/approve/route.ts:208-227; src/lib/playwright/spck-uploader.ts:88-208`.
- **Tái hiện / hậu quả:** R38-D-unsafe-url: javascript:alert(1) và file:///C:/Windows/system.ini được save-draft=200, approve=200, status=APPROVED, uploadValidation=true. Dữ liệu không hợp lệ lọt qua luồng API cục bộ. Chưa kết luận LMS thực thi script; không chứng minh tấn công từ website ngoài.
- **Cách sửa:** Dùng chung kiểm tra new URL và chỉ nhận http:/https: ở phía server cho cả lưu, duyệt và upload; kiểm tra thêm hostname Youtube cho danh sách Youtube.
- **Sau khi sửa:** chạy lại `R38-D-unsafe-url` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-08 — P2: Đường API bỏ qua danh mục file được phép nộp

- **Nguyên nhân:** API chỉ kiểm tra đường dẫn nằm trong vùng cho phép; approve chỉ kiểm tra số lượng; upload chỉ kiểm tra tồn tại và cấu trúc nếu là PDF. Không dùng chung danh mục đuôi file.
- **Vị trí:** `src/app/api/spck/save-draft/route.ts:137-141; src/app/api/spck/approve/route.ts:208-227; src/lib/playwright/spck-uploader.ts:269-302`.
- **Tái hiện / hậu quả:** R38-D-exe: payload.exe nằm trong thư mục giả được APPROVED và preflightValid=true dù không có trong danh mục LMS hoặc bộ quét. Người gọi API cục bộ có thể đưa nhầm tài nguyên không được LMS hỗ trợ qua bước duyệt.
- **Cách sửa:** Áp dụng danh mục và kiểm tra kiểu file thống nhất ở mọi cửa vào, rồi kiểm tra lại trước upload.
- **Sau khi sửa:** chạy lại `R38-D-exe` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-09 — P2: Sau tải lại trang, sửa nháp mới bị bỏ qua mà UI vẫn báo lưu thành công

- **Nguyên nhân:** Số thứ tự nháp của trình duyệt bắt đầu lại từ 0 mỗi lần tải trang nhưng SQLite giữ số cũ. Server trả staleIgnored=true; UI vẫn return true và không cảnh báo nội dung chưa lưu.
- **Vị trí:** `src/app/final-project/page.tsx:135-137, 369-370, 414-429; src/app/api/spck/save-draft/route.ts:51-62`.
- **Tái hiện / hậu quả:** R38-U-reload: DB draftSeq=900, lần sửa đầu sau reload gửi seq=1. Nội dung vẫn OLD PERSISTED, UI trả success=true và staleIgnored=true. Giáo viên có thể mất phần vừa sửa. Bước kiểm tra snapshot hiện vẫn chặn duyệt nội dung lệch; chưa chứng minh lỗi này vượt khóa duyệt.
- **Cách sửa:** Khởi tạo phiên bản từ server hoặc dùng định danh phiên chỉnh sửa cùng phiên bản bản ghi; staleIgnored phải báo xung đột/tải lại, không được coi như đã lưu sửa mới.
- **Sau khi sửa:** chạy lại `R38-U-reload` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-10 — P2: Đổi lớp trong lúc duyệt/upload làm hiển thị trạng thái của lớp trước

- **Nguyên nhân:** Ô chọn lớp chỉ bị khóa khi đang tải/quét, vẫn đổi được khi duyệt/upload. Handler duyệt/upload không kiểm tra lớp đang hiển thị trước khi ghép kết quả theo studentId.
- **Vị trí:** `src/app/final-project/page.tsx:560-698, 761`.
- **Tái hiện / hậu quả:** R38-U-class-race: lớp A đang chờ duyệt; chuyển sang lớp B có cùng học viên. Phản hồi A đến sau: nội dung B giữ CLASS B STILL WAITING nhưng trạng thái đổi VERIFIED và nhận HASH_OF_CLASS_A. Giao diện gắn nhãn đã nộp sai lớp. Ca này không chứng minh dữ liệu lớp B trên LMS bị ghi sai.
- **Cách sửa:** Khóa yêu cầu và kết quả bằng classId+studentId, bỏ kết quả khỏi UI khi đã đổi lớp; có thể khóa đổi lớp trong bước ghi nếu phù hợp trải nghiệm.
- **Sau khi sửa:** chạy lại `R38-U-class-race` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-11 — P2: AI trả muộn vẫn áp dụng nhận xét dựa trên ghi chú cũ

- **Nguyên nhân:** Snapshot chống ghi đè chỉ so teacherComment/projectTitle/folderPath; bỏ qua teacherNote, quickTags, includePresentation và các tài nguyên đầu vào khác.
- **Vị trí:** `src/app/final-project/page.tsx:465-480, 521-544`.
- **Tái hiện / hậu quả:** R38-U-note-race: đang gọi AI, giáo viên sửa note thành sản phẩm chưa hoàn thành. AI dựa trên note cũ vẫn thay teacherComment thành OLD AI BASED ON OLD NOTE. Nhận xét có thể trái với dữ kiện giáo viên vừa chỉnh, nhưng vẫn cần giáo viên duyệt trước khi upload.
- **Cách sửa:** So phiên bản hoặc dấu kiểm tra toàn bộ đầu vào AI trước khi nhận kết quả. Nếu đã đổi dữ kiện, giữ sửa mới và yêu cầu soạn lại.
- **Sau khi sửa:** chạy lại `R38-U-note-race` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

### R38-12 — P2: Nhận xét cuối khóa chỉ đọc lịch sử của buổi 01

- **Nguyên nhân:** Hai truy vấn lịch sử đều cố định sessionId `${classId}_SESS_01`, không lấy toàn khóa hoặc buổi có ID thực khác.
- **Vị trí:** `src/lib/gemini/spck-comment.ts:233-268`.
- **Tái hiện / hậu quả:** R38-G-history: DB có nhận xét VERIFIED với marker R38_HISTORY_SESSION_TWO ở buổi 02. Prompt không chứa marker và còn báo Chưa có lịch sử điểm/nhận xét. AI tổng kết cuối khóa bỏ sót tiến bộ hoặc vấn đề ở các buổi sau.
- **Cách sửa:** Đọc lịch sử theo classId+studentId xuyên các buổi, có chính sách lọc trạng thái hợp lệ; tổng hợp điểm/nhận xét từ đúng dữ liệu thay vì giả định chỉ buổi đầu.
- **Sau khi sửa:** chạy lại `R38-G-history` với cùng điều kiện mong đợi trong `adversarial.mjs`; tất cả phải PASS.

## Những phần đã có bằng chứng đạt

- Chuẩn hóa tiếng Việt, xử lý tên mơ hồ/trùng tên và va chạm thư mục trong các ca đã chạy.
- Chặn đường dẫn ngoài vùng cho phép, junction thoát vùng; chặn Origin ngoài ở cả 6 API; client không nhập bí mật server; lệnh start/dev bind 127.0.0.1. Đây là kiểm tra handler/cấu hình, chưa phải đo socket một server đang chạy.
- Ảnh/PDF giả hỏng bị chặn ở bộ nền; giới hạn 10 ảnh/10 tài liệu, 5 Youtube/5 liên kết và tiêu đề theo bộ nền.
- Không có tag/note trả INSUFFICIENT_INFO, không gọi Gemini; tên target/peer và thẻ đóng giả được xử lý trong các ca đã chạy; ánh xạ lại tên và loại phần thuyết trình khi không tích chọn đạt. Không coi những ca này là chứng minh AI thật miễn nhiễm mọi prompt injection.
- Thay comment/title/link/file bytes sau duyệt bị phát hiện; snapshot nội dung cũ bị từ chối. computeSpckContentHash đã bao gồm byte hash cục bộ, tương đương phần phát hiện drift local của filesFingerprint; không có trường riêng cùng tên.
- Native browser đối chứng tạo 01, bấm + Thêm và chạy lại không tạo 02; HTTP 500 và đổi DB trước Lưu bị chặn. Các ca R32 cũ còn kiểm tra GraphQL errors, sai ID phản hồi có mặt, drift sau click và một số lỗi upload/card khác.

## Bảo toàn và dọn dẹp

- **1786/1786 file bảo vệ giữ nguyên SHA-256**, gồm **70/70 src/scripts**, **1705/1705 hồ sơ R12–R37**, cấu hình và các tệp nền liên quan. Không thêm/xóa file trong các vùng bảo vệ.
- `next-env.d.ts` giữ đúng `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`.
- Chỉ thêm docs/audits/round-38 và nối một dòng AUDIT-R38 ở cuối MINDX_AUTOMATION_PLAN.md; không đổi các checkbox TASK-6.x hoặc ghi đè lịch sử.
- Đã tháo các junction trước khi xóa TEMP; không đi theo junction node_modules hoặc fixture ra ngoài. TEMP yêu cầu và thư mục giả r32-out do lượt này tạo đã xóa; node_modules gốc còn nguyên. Xem evidence/cleanup.json.
- Trong chuẩn bị có một phép so hash bị lặp thừa nên dừng đúng tiến trình chuẩn bị của lượt này rồi tiếp tục bản sao đã khớp. Có một lượt NODE_OPTIONS dùng dấu gạch đường dẫn Windows chưa đúng khiến Node chưa chạy được; log .previous được giữ. Harness mới được sửa lỗi map(path.basename) và phạm vi const trong script DOM trước khi chốt 41 ca. Các lỗi công cụ này không được tính là lỗi sản phẩm.

## Chưa kiểm tra và việc tiếp theo

- Chưa gọi LMS/Gemini thật; chưa xác nhận selector, API nghiệp vụ thật, nội dung AI thật, tốc độ upload thật hoặc nghiệm thu sản phẩm trên tài khoản giáo viên. Không dùng tài khoản, mật khẩu, DB, profile hoặc bài nộp thật.
- Chưa chạy giao diện React đầy đủ hoặc live end-to-end. Kết quả UI giới hạn ở thân hàm thật với hook giả; ca đổi lớp đã đối chiếu điều kiện disabled trong JSX để bảo đảm thao tác này được phép khi đang duyệt/upload.
- Sửa 5 nhóm P1 trước, sau đó 7 nhóm P2; chạy lại R38, R32 tương thích, Phase 6, Phase 5 và TypeScript trên đúng nguồn cuối. Sau khi hết lỗi cấp mã nguồn mới kiểm tra thật có kiểm soát theo quyết định của Owner.
- Lời giao việc sửa gọn: xem `FIX_PROMPT.vi.md`. Bộ lệnh đã chạy, mã thoát, quan sát từng ca và dấu kiểm tra nguồn nằm ở `evidence/results.json`, `REGRESSION_MATRIX.md` và các file bằng chứng kèm theo. Dấu [x] của AUDIT-R38 chỉ xác nhận đã làm kiểm toán, không nghiệm thu Giai đoạn 6.
