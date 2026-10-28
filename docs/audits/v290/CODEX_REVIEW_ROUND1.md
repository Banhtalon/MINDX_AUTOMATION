# v2.9.0 — Kiểm định độc lập Buổi 14, Vòng 1

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**KẾT LUẬN: NO-GO.** Cả **8/8 cổng kiểm tra được yêu cầu đều PASS**, nhưng kiểm tra bổ sung đã tái hiện **12 nhóm lỗi: 9 HIGH, 3 MEDIUM; 0 CRITICAL, 0 LOW**. Những lỗi phải sửa gồm xác nhận lưu LMS sai, khả năng lưu nhầm buổi, ghép nhầm điểm học viên, mất bản giáo viên đang sửa/đã duyệt và lọt tên thật trong dữ liệu gửi AI.

Kết luận áp dụng cho **nội dung thư mục làm việc hiện tại, gồm cả các tệp mới chưa được Git theo dõi**, không chỉ bản commit HEAD. Chưa sửa các lỗi trong vòng kiểm định này.

## 1. Phạm vi, bản mã và cách bảo vệ dữ liệu

- Thư mục gốc: `F:\MINDX_project test\MINDX-AUTOMATION`; HEAD: `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`.
- Đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, mã thay đổi, nơi gọi, cơ sở dữ liệu và các bài thử liên quan. Đọc thêm báo cáo v280 Vòng 4 để phân biệt bảo vệ cũ với bộ uploader mới.
- Khi bắt đầu đã có **21 tệp được Git theo dõi bị sửa** và các đường dẫn mới của v280/v290. Giữ nguyên toàn bộ công việc có sẵn.
- Theo giới hạn trực tiếp của Owner, **chỉ tạo báo cáo này trong repo**; không sửa mã ứng dụng, bài thử hoặc ba tài liệu trạng thái. Không thay đổi các hồ sơ kiểm định trước.
- Các bài thử có thao tác ghi/xóa dữ liệu mẫu, nên chạy nguyên trạng, lần lượt trong bản sao TEMP. Đã đối chiếu SHA-256 — dấu kiểm tra nội dung tệp — của **133/133 tệp đầu vào**; sau các cổng kiểm tra và probe bổ sung, **133/133 tệp gốc và 133/133 tệp đầu vào bản sao vẫn trùng byte**.
- Không sao chép `.env`, `.env.local`, SQLite thật, `playwright-auth`, `teacher_browsed_dirs.json`; không dùng tài khoản thật. Các tên Việt Nam trong probe đều là tên giả. Dùng khóa Gemini giả cho lời gọi AI đã được mô phỏng.
- Bản sao dùng các thư viện đã cài qua junction `node_modules` — đường dẫn nối tới thư viện hiện có. Không cài/cập nhật thư viện.
- TypeScript được chạy trên bản sao, rồi chạy thêm **trực tiếp tại repo gốc**, đều exit `0`. Bảy bộ thử chạy tại bản sao có cùng mã nguồn, không chạy trên cơ sở dữ liệu thật.
- Môi trường: Windows, Node `v24.21.0`, npm `11.19.0`. Quy mô đánh giá: ứng dụng cục bộ cho một giáo viên; có tính đến mạng chậm, sửa liên tiếp, chuyển lớp và hai thao tác đang chờ cùng lúc.

Bản sao và bằng chứng cục bộ:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-review-20261027-100117\`

Thư mục thực thi bảy bộ thử: `workspace\` bên trong đường dẫn trên. Chương trình kiểm tra bổ sung nằm trong `workspace\scratch\`, **không thêm vào thư mục kiểm thử của repo gốc**.

## 2. Kết quả thực chạy đủ 8 cổng

Đợt chạy tuần tự: **10:01:33–10:03:57 ngày 27/10/2026, UTC+7**.

| STT | Lệnh nguyên trạng | Kết quả | Exit | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit --incremental false` | **PASS** | `0` | 1,080 giây | Không có chẩn đoán lỗi; `01-typescript.log` rỗng |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | `0` | 8,249 giây | Đủ S14-01–S14-06; `02-session14-v290.log` |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | `0` | 85,326 giây | Đủ T280-01–T280-05; `03-lms-v280.log` |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | `0` | 3,537 giây | Đủ T01–T16; `04-spck-v270.log` |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | `0` | 33,489 giây | Đủ V01–V16; `05-spck-v272.log` |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | `0` | 1,372 giây | Đủ các nhóm của Giai đoạn 5; `06-phase5.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | `0` | 9,495 giây | Toàn bộ bộ thử Giai đoạn 6 đạt; `07-phase6.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | `0` | 1,086 giây | Toàn bộ bộ thử Giai đoạn 7 đạt; `08-phase7.log` |

Lần TypeScript trực tiếp tại repo gốc kết thúc **10:05:03**, thời gian **1,080 giây**, exit `0`.

**Ý nghĩa của PASS:** các điều kiện có sẵn trong tám cổng được đáp ứng trên mã đã kiểm. Không đồng nghĩa mọi tình huống an toàn đã được kiểm tra. Đặc biệt S14-06 dùng `skipNavigation: true`, không tạo phản hồi lưu HTTP và để nguyên các ô vừa nhập trong hộp thoại, nên chưa chứng minh nhánh lưu LMS thật hoặc việc đọc lại dữ liệu đã được máy chủ lưu.

## 3. Đối chiếu 6 hạng mục được yêu cầu

| Hạng mục | Đã xác nhận | Điểm chưa đạt |
| --- | --- | --- |
| 1. Tách Buổi 14 khỏi `/session-comments` | Dropdown lọc `< 14`, có banner tới `/final-project`; API chặn `_SESS_14` bằng HTTP 400; `CommentSaver` ném lỗi trước khi thao tác trình duyệt | Hàm chọn buổi và dữ liệu nạp vẫn quay lại danh sách Buổi 14 khi không còn buổi 1–13: **F12** |
| 2. Nhận xét SPCK hai mục | Có hai nhóm thẻ cấu hình; tên gọi rút gọn; quét tiêu đề/số trang HTML, CSS Flexbox/Grid/Responsive; nhánh Buổi 14 có bằng chứng thuyết trình ghép đúng hai mục. S14-02, v270, Phase 6 đạt | Không phát hiện lỗi mới được tái hiện trong nhánh ghép hai mục. Quét `.js` chủ yếu đếm tệp; việc đọc nội dung còn phụ thuộc hai attachment đầu tiên |
| 3. Đọc bảng điểm và lưu riêng Buổi 14 | Có bảng riêng, giới hạn từng điểm `1.5/1/0.5/1/1`, tổng tính bằng TypeScript; đọc BGK B30/C30; file ngoài thư mục được phép bị chặn; nhánh xuất Google Sheet được kiểm bằng HTTP mô phỏng | Ghép học viên không xử lý mơ hồ/xung đột/trùng tab (**F04**); ô chưa chấm biến thành điểm 0 (**F10**); thay điểm không cập nhật số trong thư (**F06**) |
| 4. Thư từ MindX ba phần | Có lời chào, các mục tiếng Việt và ba ô đầu ra; số được ghép bằng TypeScript ở lần tạo AI; phản hồi mẫu có thể khôi phục tên; ca hoàn toàn trống của bộ v290 bị chặn | AI ghi đè bản mới (**F05**); lọt biến thể tên (**F09**); lịch sử chỉ có điểm danh vẫn sinh bằng chứng không có thật (**F11**). Không có bản mẫu giáo viên độc lập ngoài tài liệu/fixture để xác nhận “100%” văn phong |
| 5. Uploader và API | Cả GET và bốn POST mới đều dùng `validateLocalRequest`, chính là lớp bảo vệ local của repo; origin bên ngoài bị HTTP 403. Đường chạy thật được đưa qua `taskQueue`, dùng browser manager hiện có. Có 9 nhóm radio, 5 ô số, 3 Quill và chốt hash trước Save; không tự thử lại sau Save | Phản hồi mạng không khóa đúng nghiệp vụ (**F01**), chỉ so đầu thư (**F02**), thiếu chốt buổi trước Save (**F03**), Duyệt không khóa phiên bản bản giáo viên vừa xem (**F07**) |
| 6. Giao diện `/final-project` | Có khu riêng khi `selectedSessionNumber === 14`; giữ đúng năm `useState` đầu: `classes`, `selectedClassId`, `students`, `folderPathInput`, `rows`; giữ neo `return` của round-38; các khối trích xuất trong v270 vẫn chạy đạt | Chưa chờ lưu chữ trước Duyệt (**F07**); phản hồi chậm thay cả danh sách, xóa chữ mới/trộn lớp (**F08**) |

Không gọi nhầm tên hàm bảo vệ là lỗi: repo dùng `validateLocalRequest`, không có yêu cầu phải đổi tên thành `verifyLocalRequest` nếu tác dụng bảo vệ vẫn đầy đủ.

## 4. Các phát hiện phải sửa

Tất cả vị trí dưới đây là số dòng của **bản mã đã kiểm**. Các probe kết thúc exit `0` để ghi nhận hành vi quan sát được; các kết quả tái hiện lỗi **không phải PASS chất lượng sản phẩm**.

### F01 — HIGH — Nhận phản hồi API không liên quan rồi báo đã lưu LMS

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:416–440`, bước `markVerified` ở `172–176`.

**Nguyên nhân:** Bộ chờ chỉ xét URL chứa `lms-api.mindx.edu.vn` hoặc `/graphql` và phương thức POST. Không đối chiếu tên thao tác GraphQL — loại yêu cầu cụ thể — hay lớp, buổi, học viên trong yêu cầu; cũng không bắt buộc có đối tượng kết quả lưu. Khi dialog còn mở, phần đọc lại dùng chính những ô vừa điền.

**Tái hiện:** `UPLOADER_UNRELATED-RESPONSE` chỉ phát sinh POST `GetTeacherProfile` trả HTTP 200, không có thao tác lưu đánh giá. Kết quả vẫn là `verified=1`, `failed=0`, SQLite `VERIFIED`, với `skipNavigation:false`.

**Ảnh hưởng:** Giáo viên nhận thông báo thành công dù đánh giá chưa được lưu trên LMS; một phản hồi lỗi của API phụ cũng có thể làm báo lỗi sai nghiệp vụ.

**Cách sửa nhỏ nhất:** Khóa đúng hostname, tên thao tác lưu và định danh lớp/buổi/học viên; chỉ chấp nhận HTTP 200/201 cùng đối tượng lưu hợp lệ. Đọc lại từ dữ liệu đã lưu, không lấy các ô còn đang sửa làm bằng chứng.

**Kiểm tra sau sửa:** API phụ HTTP 200 không được làm hoàn tất; thao tác lưu đúng trả lỗi phải dừng; thao tác lưu đúng và dữ liệu đọc lại đầy đủ khớp mới được `VERIFIED`.

### F02 — HIGH — Cuối cả ba phần thư bị sai vẫn vượt đối chiếu

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:459–471`.

**Nguyên nhân:** Chỉ dùng `includes` với 60 ký tự đầu của Learned và 40 ký tự đầu của Suggestions/Future. Phần còn lại, gồm điểm và lời khuyên, không được so sánh.

**Tái hiện:** `UPLOADER_TRUNCATED-TAIL` đổi cuối cả ba ô thành `CORRUPTED_TAIL`, đóng rồi mở lại dialog. Chỉ giữ đúng 60/40/40 ký tự đầu. Kết quả vẫn `verified=1`, SQLite `VERIFIED`.

**Ảnh hưởng:** Mất/sai nội dung hoặc điểm trong học bạ vẫn được xác nhận là trùng bản giáo viên duyệt.

**Cách sửa nhỏ nhất:** So sánh bằng nhau toàn bộ nội dung sau khi chuẩn hóa khoảng trắng/định dạng hợp lệ, trên cả ba ô.

**Kiểm tra sau sửa:** Sửa một ký tự ở cuối từng ô phải làm đối chiếu thất bại; khác biệt khoảng trắng không mang ý nghĩa được xử lý có chủ đích.

### F03 — HIGH — Buổi đích đổi trong lúc điền nhưng vẫn Save và VERIFIED

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:264–269`, `399–425`.

**Nguyên nhân:** Chốt buổi 14 chạy trước khi mở dialog. Sau thời gian điền 45 radio/điểm/thư, trước Save chỉ kiểm tra dữ liệu cục bộ, không xác nhận lớp và buổi đích còn đúng. Uploader mới chưa giữ chốt an toàn trước Save đã có ở các uploader v280.

**Tái hiện:** `UPLOADER_SLOT-DRIFT` bắt đầu ở buổi 14; fixture chuyển buổi đang hoạt động sang 13 trong khi chọn radio. Save được ghi nhận ở buổi 13 (`savedSlots:[13]`), trong khi bản đánh giá buổi 14 vẫn thành `VERIFIED`.

Probe dùng helper điều hướng thay thế để mô phỏng buổi đang hoạt động; helper chỉ trả thành công khi buổi đúng 14. Các bước điền, Save, nhận mạng, đối chiếu và cập nhật SQLite vẫn là mã uploader hiện tại.

**Ảnh hưởng:** Có thể ghi đánh giá cuối khóa vào sai buổi và báo hoàn tất sai.

**Cách sửa nhỏ nhất:** Xác nhận lại lớp/buổi và dialog ngay sát Save. Nếu việc phục hồi buổi làm đổi/hủy dialog, mở và điền lại an toàn trước Save; khi không thể xác nhận phải dừng.

**Kiểm tra sau sửa:** Buổi 14 biến mất, bị khóa hoặc đổi sau khi mở dialog đều không được phát sinh Save sang buổi khác.

### F04 — HIGH — Bảng điểm có thể ghép nhầm học viên hoặc ghi đè từ tab trùng

**Vị trí:** `src/lib/local-files/spck-demo-score-reader.ts:535–560`, phần lưu ở `580–588`.

**Nguyên nhân:** Dùng `students.find()` chọn kết quả đầu tiên, gộp điều kiện B2 và tên tab bằng OR; phép khớp một phần không kiểm tra có nhiều ứng viên. Tập `matchedStudentIds` không được kiểm tra ở nhánh khớp tên chính xác.

**Ba tình huống đã tái hiện:**

- `IMPORT_AMBIGUOUS`: lớp có tên giả “Nguyễn Minh An” và “Trần Minh An”; tab/B2 chỉ ghi “Minh An”. Bot tự gán 5 điểm cho người đầu tiên, `unmatched=[]`.
- `IMPORT_CONFLICT_IDENTITY`: tên tab là người A, B2 là họ tên đầy đủ của người B. Bot gán cho A, trái với việc ưu tiên B2 được ghi trong comment.
- `IMPORT_DUPLICATE`: hai tab cùng họ tên đầy đủ A; kết quả `matchedCount=2`, `ids=["A","A"]`; điểm 5 của tab đầu bị ghi thành 3,7 từ tab sau.

**Ảnh hưởng:** Điểm và nhận xét giám khảo có thể vào nhầm học bạ, không có cảnh báo cho giáo viên.

**Cách sửa nhỏ nhất:** Thu thập danh sách ứng viên, chỉ ghi khi xác định duy nhất; xử lý rõ xung đột B2/tên tab; chặn hai tab cùng một `studentId`. Trường hợp mơ hồ trả về cho giáo viên xác nhận trước khi ghi.

**Kiểm tra sau sửa:** Cả ba ca trên phải báo xung đột, không sửa điểm học viên; tệp khớp duy nhất vẫn nhập đúng.

### F05 — HIGH — AI trả lời chậm ghi đè điểm và nội dung vừa được duyệt

**Vị trí:** `src/lib/gemini/session14-course-summary.ts:32`, `515–530`; đầu vào API tại `src/app/api/spck/session14-eval/generate-ai/route.ts:55–65`.

**Nguyên nhân:** Đã nhận `expectedVersion` — số phiên bản bản nháp giáo viên đang dùng — nhưng không truyền nó vào `saveDraft` sau khi chờ Gemini. Kết quả AI mang cả điểm và ghi chú đã đọc trước khi chờ; không kiểm tra trạng thái/phiên bản mới hoặc kết quả xung đột.

**Tái hiện:** `AI_STALE_OVERWRITE` tạm giữ phản hồi AI; giáo viên sửa Future thành `USER_NEW_FUTURE`, sửa algorithm thành 1,5 và bấm duyệt; sau đó cho AI cũ trả lời. Kết quả báo `SUCCESS`, Future bị thay bằng `AI_OLD_FUTURE`, tổng Demo bị kéo về 0, trạng thái thành `WAITING_APPROVAL`.

**Ảnh hưởng:** Mất nội dung và điểm mà giáo viên vừa chốt; bản duyệt không được bảo toàn.

**Cách sửa nhỏ nhất:** Ghi nhớ phiên bản/trạng thái ban đầu, kiểm tra lại sau Gemini, truyền `expectedVersion` vào lần ghi và xử lý xung đột. Không ghi kết quả cũ vào bản đã đổi/đã duyệt trong lúc chờ; trả trạng thái rõ và giữ bản mới.

**Kiểm tra sau sửa:** Cho giáo viên sửa điểm, chữ hoặc duyệt khi AI chậm; phản hồi AI cũ không được ghi đè bất kỳ thay đổi nào.

### F06 — HIGH — Đổi điểm nhưng thư vẫn chứa điểm cũ và được duyệt

**Vị trí:** `src/lib/db/sqlite.ts:4160–4185`, `4289–4375`; ghép điểm trong thư chỉ diễn ra tại `src/lib/gemini/session14-course-summary.ts:279–285`, `501–513`.

**Nguyên nhân:** `saveDraft` tính lại tổng điểm nhưng giữ nguyên chuỗi Learned nếu không được gửi lại. `approveDraft` chỉ kiểm tra ba ô có chữ, không kiểm tra hai dòng điểm trong thư có khớp số hiện tại.

**Tái hiện:** `SCORE_LETTER_DRIFT` tạo thư Demo 4,5 điểm, rồi chỉ đổi algorithm để tổng còn 3,5. Duyệt vẫn thành công với `status=APPROVED`, `demoTotal=3.5`, trong thư vẫn là `Điểm Demo: 4.5 điểm`.

**Ảnh hưởng:** Radio/ô điểm LMS và nội dung thư gửi phụ huynh mâu thuẫn. Khóa hash có thể hoàn toàn hợp lệ cho một bản nội dung tự mâu thuẫn.

**Cách sửa nhỏ nhất:** Đồng bộ riêng hai dòng điểm bằng TypeScript mỗi khi điểm đổi; nếu chưa thể đồng bộ an toàn thì đánh dấu thư cần cập nhật và chặn duyệt. Không cần gọi AI để sửa số điểm.

**Kiểm tra sau sửa:** Đổi từng điểm Demo và năng lực sau khi tạo thư, kể cả nhập lại bảng chấm điểm; nội dung thư phải khớp trước khi cho Duyệt.

### F07 — HIGH — Bấm Đẩy ngay sau sửa chữ có thể duyệt và gửi bản cũ

**Vị trí:** `src/app/final-project/page.tsx:3439–3467`, `5885–5889`, `5912–5916`, `5938–5942`; `src/app/api/spck/session14-eval/route.ts:95–96`.

**Nguyên nhân:** Ba ô chữ chỉ lưu khi rời ô (`onBlur`). Nút Duyệt/Đẩy không chờ các lần lưu đang chạy và không lưu toàn bộ bản đang hiển thị trước khi duyệt. API duyệt bỏ qua phiên bản, dù hàm `approveDraft` đã hỗ trợ tham số đó.

**Tái hiện:** `UI_APPROVE_BEFORE_BLUR_SAVE` giữ yêu cầu lưu `NEW VISIBLE LETTER` đang chờ. Luồng nút bấm vẫn gọi `approve`, rồi `upload-lms`; tại bước gửi, dữ liệu được duyệt là `OLD LETTER`. Phép thử `APPROVE_STALE` gửi phiên bản cũ đến API duyệt vẫn nhận HTTP 200 và `APPROVED`.

**Ảnh hưởng:** Giáo viên vừa xem/sửa bản mới nhưng hệ thống có thể gửi bản cũ. Trường hợp ngược lại, một bản mới từ thao tác khác có thể được duyệt dù giáo viên chưa xem.

**Cách sửa nhỏ nhất:** Chờ và xác nhận mọi lần lưu liên quan, lưu bản đang hiển thị nếu còn thay đổi, sau đó duyệt đúng phiên bản trả về; API bắt buộc đối chiếu phiên bản cho từng học viên. Lưu thất bại hoặc xung đột phải dừng.

**Kiểm tra sau sửa:** Làm chậm yêu cầu lưu khi bấm nút; không được gọi upload trước khi lưu và duyệt đúng phiên bản hoàn tất. Phiên bản cũ phải bị HTTP 409 hoặc kết quả xung đột tương đương.

### F08 — HIGH — Phản hồi chậm xóa chữ đang gõ và đưa dữ liệu lớp cũ vào lớp mới

**Vị trí:** `src/app/final-project/page.tsx:3270–3278`, `3295–3309`, `3334–3336`, `3394–3396`, `3471–3472`.

**Nguyên nhân:** Các nhánh đánh giá Buổi 14 thay toàn bộ `session14Evals` bằng `data.records`, không kiểm tra lớp đang mở, thứ tự yêu cầu hoặc nội dung giáo viên gõ sau khi yêu cầu bắt đầu. Nhánh lưu nháp còn nuốt lỗi bằng `catch {}`. UI cũng không gửi `expectedVersion` trong thao tác lưu này.

**Tái hiện bằng khối handler trích nguyên trạng từ trang và biên dịch tương tự v270:**

- `UI_LATE_RESPONSE`: trong khi chờ lưu điểm, gõ `NEW UNSAVED LETTER`; phản hồi cũ trở về, chữ bị thay lại bằng `OLD LETTER`.
- `UI_CLASS_SWITCH`: bắt đầu yêu cầu của lớp A, chuyển màn hình sang lớp B; phản hồi A vẫn đặt vào danh sách đang hiển thị, `selectedClassId="CLASS-B"` nhưng `visibleRecordClass` là lớp A.

**Ảnh hưởng:** Mất bản đang soạn; giáo viên có thể nhìn nhầm học viên/nội dung của lớp khác khi thao tác tiếp.

**Cách sửa nhỏ nhất:** Dùng lại cách chống phản hồi cũ đã có ở luồng SPCK: khóa yêu cầu theo lớp/học viên và số thứ tự; giữ các trường đã được sửa sau khi gửi; cập nhật từng bản ghi cùng phiên bản, không thay cả danh sách vô điều kiện. Báo lỗi lưu/xung đột cho giáo viên.

**Kiểm tra sau sửa:** Phản hồi đảo thứ tự, gõ chữ trong lúc lưu và chuyển lớp khi đang tải đều phải giữ nguyên bản mới/lớp hiện tại.

### F09 — HIGH — Tên rút gọn và tên không dấu vẫn lọt vào Gemini

**Vị trí:** `src/lib/gemini/session14-course-summary.ts:165–178`; các lời gọi xử lý ghi chú/lịch sử tại `377–414`.

**Nguyên nhân:** Chỉ thay nguyên họ tên hoặc đúng tên gọi hai từ; bạn cùng lớp chỉ thay nguyên họ tên. Không xử lý tên một từ thường dùng trong ghi chú, biến thể không dấu hoặc chuẩn Unicode như bộ ẩn danh SPCK hiện có.

**Tái hiện:** `PII_SHORT` đưa ghi chú giả `Phúc phối hợp với Minh An tốt.` với học viên mục tiêu “Nguyễn Thiên Phúc”, bạn cùng lớp “Trần Minh An”. Hàm trả nguyên ghi chú. `AI_STALE_OVERWRITE` bắt được cả prompt thực truyền cho Gemini mô phỏng và xác nhận vẫn chứa `Phúc`.

**Ảnh hưởng:** Không đáp ứng cam kết ẩn danh tên trước khi gửi tới dịch vụ AI.

**Cách sửa nhỏ nhất:** Dùng lại hoặc bổ sung bộ xử lý biến thể tên đã có ở `anonymizeSpckText`, đồng thời bảo toàn riêng token họ tên/tên gọi; xử lý bạn cùng lớp và bổ sung kiểm tra đầu ra prompt trước gửi.

**Kiểm tra sau sửa:** Họ tên đầy đủ, tên gọi, tên một từ, tên không dấu, tên bạn cùng lớp và Unicode tương đương đều phải được thay. Kiểm tra đúng payload gửi đi, không chỉ lời chào của prompt.

### F10 — MEDIUM — Bảng điểm chưa chấm vẫn được nhập thành Demo 0 và năng lực 4

**Vị trí:** `src/lib/local-files/spck-demo-score-reader.ts:204–223`, `294–300`, `580–588`.

**Nguyên nhân:** Không tìm thấy điểm số ở cả các ô E và ô tổng hợp thì trả 0; bước nhập không phân biệt chưa chấm với điểm 0 thật. Hàm gợi ý còn coi điểm nhỏ hơn hoặc bằng 0 là mặc định 4/5.

**Tái hiện:** `IMPORT_BLANK` dùng workbook có tên đúng nhưng không có ô điểm. Kết quả `matched=1`, Demo `0`, năng lực `4`; dữ liệu hiện có được cập nhật như một lần nhập thành công.

**Ảnh hưởng:** File mẫu trống hoặc chấm dở có thể xóa điểm cũ và tạo đánh giá không có căn cứ.

**Cách sửa nhỏ nhất:** Giữ thông tin có/không có điểm theo từng tiêu chí; thiếu điểm phải báo chưa chấm và không ghi đè. Điểm 0 đã được nhập rõ ràng cần được giữ và xử lý như điểm thật, không đổi thành mức 4 mặc định.

**Kiểm tra sau sửa:** Phân biệt đúng tệp trống, tệp thiếu một tiêu chí, tệp có 0 thật và tệp đủ điểm; giữ nguyên dữ liệu cũ khi nhập thiếu.

### F11 — MEDIUM — Chỉ có điểm danh vắng vẫn vượt cổng thiếu dữ kiện và tự thêm nhận định tích cực

**Vị trí:** `src/lib/gemini/session14-course-summary.ts:214–249`, điều kiện thiếu dữ kiện tại `345–352`.

**Nguyên nhân:** Chỉ cần có một dòng `session_feedbacks` là `hasHistory=true`, dù dòng đó không có thẻ, ghi chú hay nhận xét. Khi không có đoạn mô tả, code tự thêm “Tham gia đầy đủ các hoạt động thực hành trên lớp.”

**Tái hiện:** `EMPTY_HISTORY_GATE` tạo duy nhất một dòng điểm danh `ABSENT`, không có dữ kiện đánh giá khác. Prompt vừa ghi nhận `0/1 buổi` vừa khẳng định tham gia đầy đủ hoạt động; vẫn gọi Gemini một lần và trả `SUCCESS`.

**Ảnh hưởng:** Đầu vào gửi AI đã chứa bằng chứng do hệ thống tự bịa; cổng `INSUFFICIENT_INFO` không chặn tình huống thường gặp khi dữ liệu điểm danh có trước nhận xét.

**Cách sửa nhỏ nhất:** Chỉ coi lịch sử là dữ kiện đánh giá khi có nội dung thực chất; giữ điểm danh là số liệu riêng và bỏ câu suy diễn mặc định. Khi không đủ dữ kiện phải trả `INSUFFICIENT_INFO`.

**Kiểm tra sau sửa:** Không có dòng lịch sử, dòng chỉ có điểm danh, và dòng có nhận xét thực đều phải có kết quả phù hợp; không thêm lời khen không có nguồn.

### F12 — MEDIUM — Hàm chọn buổi vẫn trả về Buổi 14 khi lớp chỉ còn buổi cuối

**Vị trí:** `src/app/session-comments/page.tsx:187–190`, `348–352`.

**Nguyên nhân:** Sau khi lọc `<14`, hai chỗ lại dùng toàn bộ danh sách ban đầu nếu danh sách đã lọc rỗng.

**Tái hiện:** `SESSION14_FALLBACK` trích hàm `findLatestActiveSessionId` nguyên trạng; đầu vào duy nhất `ONLY_SESS_14`, kết quả vẫn là `ONLY_SESS_14`. Dropdown tiếp tục lọc nên có thể không có lựa chọn nhưng trạng thái trang vẫn trỏ vào buổi 14.

**Ảnh hưởng:** Chưa tách hoàn toàn Buổi 14 khỏi màn hình 1 theo yêu cầu. Dữ liệu buổi cuối vẫn có thể được nạp/soạn ở màn hình nhận xét thường kỳ; hai chốt lưu phía máy chủ hiện có vẫn ngăn ghi trường hợp `_SESS_14`, nên không coi đây là lỗi đã chứng minh ghi nhầm LMS.

**Cách sửa nhỏ nhất:** Không quay lại danh sách chưa lọc; trả danh sách rỗng và ID rỗng, hiển thị hướng dẫn sang SPCK khi không có buổi 1–13.

**Kiểm tra sau sửa:** Danh sách chỉ có buổi 14 hoặc các buổi lớn hơn phải không chọn/nạp buổi thường kỳ nào; danh sách hỗn hợp vẫn chọn đúng buổi 1–13.

## 5. Kiểm chứng bổ sung và giới hạn của bằng chứng

Các script bổ sung tại TEMP:

| Script | Cách thực hiện | Kết quả chính |
| --- | --- | --- |
| `workspace/scratch/review-probes.ts` | Gọi mã cơ sở dữ liệu/API/generator hiện tại; Gemini bị giữ phản hồi có chủ đích; Chromium với mọi HTTP được chặn và trả dữ liệu giả | Tái hiện F01–F06, F09–F11; HTTP 500 sau Save chỉ Save **1 lần**, `verified=0`, `failed=1` |
| `workspace/scratch/ui-probes.ts` | Trích nguyên handler UI/hàm chọn buổi từ tệp nguồn, biên dịch bằng SWC giống cách v270 kiểm tra handler; điều khiển thứ tự phản hồi | Tái hiện F07, F08, F12 |
| `workspace/scratch/reader-extra.ts` | Workbook tổng hợp trong bộ nhớ; mô phỏng fetch xuất Google Sheet; thử đường dẫn nằm ngoài workspace bản sao | Bổ sung xung đột B2/tên tab của F04; URL xuất Sheet đúng `/export?format=xlsx`; file ngoài thư mục được phép bị HTTP **400** |
| `workspace/scratch/path-probe.ts` | Thử tạo liên kết tệp để kiểm tra quét Web đi ra ngoài thư mục được phép | Hệ điều hành trả **EPERM**, chưa thực hiện được ca này; không dùng nó làm phát hiện đã tái hiện |

Các giới hạn cần giữ rõ:

- S14-06 đạt trên DOM giả lập và bỏ qua yêu cầu có phản hồi mạng bằng `skipNavigation:true`. Các probe F01–F03 dùng `skipNavigation:false`; điều hướng/kiểm tra slot được mô phỏng để cô lập ranh giới an toàn, không mở tài khoản LMS.
- Uploader có vòng lặp kiểm tra đủ 9 radio và 5 giá trị số; chưa chứng minh thứ tự trường trên LMS thật bằng vòng kiểm định này. Không có tự retry sau Save trong uploader mới; ca HTTP 500 bổ sung xác nhận một lần bấm.
- Bộ quét Web mới ở `spck-comment.ts:395–430` kiểm tra allowlist ở thư mục gốc nhưng không gọi lại cho từng tệp con trước đọc. Ca liên kết tệp chưa chạy được vì EPERM; cần kiểm tra thêm đường dẫn liên kết trên môi trường cho phép, không kết luận đã tái hiện rò rỉ tệp.
- Đối chiếu cấu trúc thư dựa trên tài liệu hiện tại và mẫu trong `test-session14-v290.ts`; chưa có bản mẫu giáo viên độc lập để đối chiếu nguyên văn. Phản hồi AI thật và mức độ tuân thủ mẫu chưa được nghiệm thu.
- Không chạy toàn bộ `round-38/adversarial.mjs`; đã đối chiếu neo và năm hook mà bộ đó sử dụng. v270 chạy nguyên trạng đạt, gồm các phép trích handler của nó.
- Chưa chạy build Next.js hoặc kiểm tra giao diện thủ công đầy đủ. Chưa nghiệm thu LMS, Gemini, Google Sheet riêng tư, Drive hoặc GitHub thật. Nhánh Google Sheet trong phép thử bổ sung dùng dữ liệu HTTP giả.
- Không coi kết quả nghiệm thu v270/v272/v280 được ghi trong tài liệu cũ là nghiệm thu mới của v290.

## 6. Dấu bản mã và tệp bằng chứng

Các tệp trọng tâm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `3673e45ab2604cbdd1c132a79bb5e6bf4de7ed8f45aa23eb842d314a297f5a16` |
| `src/app/session-comments/page.tsx` | `d1bf9c34cabfc4b397eac97c57ac420019f7ea2b99bd527e302209d03b0606f4` |
| `src/lib/db/sqlite.ts` | `b592f21f230741ab94bf495e2808a70baa1104220958edafdb2f03a9a606a0c0` |
| `src/lib/gemini/session14-course-summary.ts` | `0d122c4ef4e5db32367891483ac24eb19d3ee394364f92df61472d1b50726848` |
| `src/lib/gemini/spck-comment.ts` | `117159bc883d17f133ae8cb3cc56f023788c6a878e2261eb4171a41645bca83c` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `fdeced87fa8d74593f8e31e91e459edd5ed05c83d2700791150efb16db6febfb` |
| `src/lib/playwright/session14-eval-uploader.ts` | `c62ac8ed2b2f5b33eb806f663ddf1d5d9fd6bd6889ed251e159f20fc1a43a873` |
| `scripts/test-session14-v290.ts` | `9118a7bbef2e1a6ceaf25a5b2aacb01d8956dd0216b960be40c4c7fca52a1d6c` |

Bằng chứng được giữ ở thư mục TEMP nêu tại mục 1:

- `source-manifest.json`: 133 tệp đầu vào và dấu SHA-256 trước khi chạy.
- `git-status-before.txt`: trạng thái ban đầu, giữ rõ các thay đổi có sẵn.
- `run-gates.ps1`, `gates.json`, `01-*.log` đến `08-*.log`: trình chạy, thời điểm, thời gian, exit và toàn bộ đầu ra tám cổng.
- `probes.log`, `probe-results.json`, `ui-probes.log`, `reader-extra.log`, `path-probe.log`: kết quả kiểm tra bổ sung.
- `workspace/scratch/`: toàn bộ mã tái hiện để vòng sửa có thể chạy lại mà không sửa test gốc.
- `integrity-before-report.json`: kiểm tra 133/133 tệp gốc và 133/133 tệp đầu vào bản sao giữ nguyên.
- `integrity-final.json`, `git-status-after.txt`: đối chiếu sau khi ghi báo cáo.

TEMP có thể được hệ điều hành dọn; kết quả chính và vị trí mã đã được lưu trong báo cáo này. Không commit hoặc đổi HEAD trong vòng kiểm định.

## 7. Điều kiện để kiểm định lại

1. Sửa F01–F09 trước khi dùng luồng mới với dữ liệu thật; xử lý F10–F12 để đáp ứng đủ phạm vi Buổi 14.
2. Thêm ca hồi quy thực chất cho từng ranh giới đã tái hiện. Đặc biệt phải có phản hồi nghiệp vụ đúng định danh, dữ liệu lưu bị cắt cuối, đổi buổi trước Save, tên trùng, AI chậm, lưu chữ chậm và chuyển lớp khi đang chờ.
3. Chạy lại nguyên trạng tám cổng, rồi chạy lại các tình huống bổ sung trên đúng bản mã sau sửa. Chỉ đóng lỗi khi hành vi sai không còn và điều kiện an toàn được kiểm tra.
4. Khi kiểm định mã đạt, mới thực hiện nghiệm thu có kiểm soát trên LMS thật: giáo viên xem bản cụ thể trước lưu, xác nhận lại đầy đủ radio, điểm và ba phần thư sau tải lại.

**Trạng thái bàn giao:** Hoàn thành kiểm định Vòng 1 và báo cáo; **chưa đủ điều kiện GO cho v2.9.0**. Không yêu cầu Owner thao tác Terminal hoặc cung cấp thông tin đăng nhập để hoàn thành vòng kiểm định này.
