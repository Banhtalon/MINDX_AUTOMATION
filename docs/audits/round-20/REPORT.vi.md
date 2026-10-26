# Kiểm toán độc lập Vòng 20 — Kiểm chứng R19-01…R19-14 và nghiệm thu Giai đoạn 5

**Kết luận: NO-GO cấp mã nguồn cho Giai đoạn 5. Chưa ký nghiệm thu.** Cả 94 ca Vòng 19 hiện đạt, nhưng kiểm tra mở rộng tái hiện 16 trường hợp lỗi còn sót trong 8 nhóm. Đóng 6/14 nhóm trong phạm vi đã kiểm; 8 nhóm mới sửa một phần vẫn mở, gồm 7 P1 và 1 P2. Không sửa mã sản phẩm trong cuộc kiểm toán này.

## 1. Phiên bản và phương pháp

- Kiểm toán ngày 20/10/2026, giờ Việt Nam UTC+7. Snapshot được chụp lúc `2026-10-20T10:43:52.477Z` (17:43:52 giờ Việt Nam); xem [source-state.json](source-state.json), trường `capturedAt`.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Đối tượng kiểm toán là **cây làm việc hiện tại có thay đổi chưa commit**, không chỉ nội dung HEAD. Xem [git-status.before.txt](git-status.before.txt) và [git-status.after.txt](git-status.after.txt).
- SHA-256 danh mục nguồn đầu vòng: `6b696ae94e101cf608870eb6ccf892003e81814e29c6c9500cd701b46f3701c1`. Có hash từng file trong [source-state.json](source-state.json), phạm vi rà soát trong [review-scope.json](review-scope.json), kế hoạch trước cập nhật trong [plan.before.md](plan.before.md).
- Đã đọc AGENTS.md, kế hoạch, báo cáo/trạng thái/bộ kiểm tra R19; rà soát đủ các file được yêu cầu và các phần gọi liên quan: tải → đọc file → AI → lưu nháp → duyệt → lưu LMS → đọc lại → ghi VERIFIED.
- Bộ độc lập đọc nguồn thật, bỏ import/type rồi chạy nguyên thân hàm trong môi trường JavaScript cách ly (VM). Các phần phụ thuộc được cấp rõ: SQLite thật trong bộ nhớ, DOM/API/Gemini giả. Không thay thân hàm sản phẩm để làm ca kiểm tra đạt. Ca giao diện chạy handler và hook mô phỏng; không thay cho chạy giao diện trong Chromium thật.
- Một nhóm chỉ được đóng khi cả tái hiện cũ và phần sửa liên quan đã qua kiểm tra bổ sung. Việc 20 ca lỗi cũ chuyển sang đạt **không tự chứng minh toàn bộ 14 nhóm đã được sửa đầy đủ**.

## 2. Cô lập và bảo toàn

Toàn bộ 10 lệnh bắt buộc chạy tại:

`C:\Users\QQ\AppData\Local\Temp\mindx-round20-HNBfDA\snapshot`

Bản sao có node_modules riêng, sao từ thư viện đã cài; không cài hoặc cập nhật thư viện. Không sao chép `.env`, `.env.local`, mật khẩu/khóa dịch vụ, DB thật, `playwright-auth` hay bài nộp thật. Chỉ sao chép `data/config`. Môi trường tiến trình dùng danh sách biến hệ thống tối thiểu, npm offline, tắt telemetry và nạp rào socket Node từ bản sao của `round-19/network-guard.cjs`. Rào này thuộc tiến trình Node, **không phải tường lửa của Windows**. Không mở trình duyệt hay gọi LMS/Gemini thật.

[snapshot-check.json](snapshot-check.json) xác nhận nguồn và file bảo vệ ở bản sao ban đầu khớp hash; dữ liệu nhạy cảm bị loại đều vắng mặt. [isolation.json](isolation.json) nêu cách cô lập và giới hạn. Các script cũ có thể tạo dữ liệu giả trong bản sao; bộ R20 tạo thư mục fixture riêng ở TEMP và dùng SQLite `:memory:`.

[preservation-check.json](preservation-check.json) ghi danh mục **trước và sau của 233/233 file bảo vệ**, gồm `next-env.d.ts` và toàn bộ file trong `docs/audits/round-12`…`round-19`. Kết quả:

- **100% giữ nguyên số byte và SHA-256; không thêm, xóa hoặc đổi file trong phạm vi bảo vệ.**
- `next build` chỉ làm đổi `next-env.d.ts` ở bản sao; file gốc không bị ghi hoặc phải khôi phục.
- Danh mục nguồn ở cây gốc chỉ đổi `MINDX_AUTOMATION_PLAN.md`, bằng đúng một mục AUDIT-R20 ngay dưới AUDIT-R19. Mã sản phẩm, cấu hình, script cũ, AGENTS.md và `tsconfig.tsbuildinfo` giữ nguyên hash đầu vòng.
- Kết quả chạy lại các vòng cũ được lưu dưới **round-20**, không ghi đè kết quả lịch sử ở cây gốc. Vì vậy hồ sơ R19 gốc vẫn phản ánh kết luận lịch sử của R19.

## 3. Kết quả các lệnh bắt buộc

| Lệnh chạy trong bản sao | Mã thoát cuối | Kết quả | Bằng chứng |
|---|---:|---|---|
| `npx tsx scripts/test-phase5.ts` | 0 | Đạt 7 mục kiểm tra của script | [phase5.log](phase5.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Đạt toàn bộ mục của script | [phase4.log](phase4.log) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | 43/43 đạt | [round12-independent.log](round12-independent.log) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | 89/89 đạt | [round13-independent.log](round13-independent.log) |
| `node docs/audits/round-16/verify-independent.mjs` | 0 | 16/16 đạt | [round16-independent.log](round16-independent.log) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | 38/38 đạt | [round17-independent.log](round17-independent.log) |
| `node docs/audits/round-19/verify-independent.mjs` | 0 | 94/94 đạt, chạy nguyên script R19 | [round19-independent.log](round19-independent.log) |
| `node docs/audits/round-20/verify-independent.mjs` | **1** | **129/145 đạt; 16 trượt** | [round20-independent.attempt-2.log](round20-independent.attempt-2.log) |
| `npx tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [typecheck.log](typecheck.log) |
| `npm run build` | 0 | Dựng thành công, sinh đủ 22/22 trang | [build.log](build.log) |

Đã chạy đủ **10/10 lệnh khác nhau**; 9 lệnh thoát 0. R20 thoát 1 do 16 ca phát hiện lỗi, không phải lỗi khởi chạy bộ thử. [commands.json](commands.json) lưu trực tiếp mã thoát, thư mục chạy, giờ bắt đầu/kết thúc và SHA-256 nhật ký của mọi lần chạy, không dùng đường ống làm mất mã thoát.

R20 có hai lần chạy, đều 129/145 đạt và cùng 16 ca trượt. Lần cuối thay các dữ liệu media mẫu bằng file hợp lệ và làm chắc tái hiện phiên bản file bằng file vật lý; không sửa sản phẩm. Giữ cả hai nhật ký/kết quả; [independent-results.json](independent-results.json) là kết quả chuẩn cuối và khớp `round20-independent.attempt-2-results.json`.

Các bộ Vòng 12/13/16/17 đạt **186/186**; chưa thấy hồi quy Giai đoạn 1–4 trong tập kiểm tra này. Nhật ký phase4 có lỗi được cố ý tạo trong ca mô phỏng, đã đọc hết kết quả và mã thoát. Các kết quả này không phải nghiệm thu với LMS thật.

## 4. Bao phủ đủ 94 ca R19 và 51 ca bổ sung

[verify-independent.mjs](verify-independent.mjs) chỉ ghi kết quả vào `docs/audits/round-20/independent-results.json` của bản sao. Có chốt từ chối chạy ở cây dự án gốc trước khi tạo fixture.

- Giữ đủ **94 mã ca, thứ tự, điều kiện và câu lệnh kiểm tra của R19**. [inheritance-check.json](inheritance-check.json) đối chiếu mã ca/thứ tự và nguồn khối kiểm tra sau đúng bốn phép thay dữ liệu mẫu được ghi rõ.
- Bốn ca INLINE vẫn kiểm tra MIME/Base64 bảo toàn bytes. R20 dùng PNG/JPG/WebP thật do `sharp` đã cài sẵn mã hóa, và PDF tối thiểu có cấu trúc trang/xref. Thay dữ liệu mẫu là cần thiết vì mẫu JPG/WebP/PDF cũ chỉ có vài byte/chữ ký; yêu cầu đồng thời “chấp nhận mẫu hỏng” và “từ chối mẫu hỏng” sẽ làm bộ thử tự mâu thuẫn. Không hạ điều kiện kiểm tra nào; nguyên bản R19 cũng đã chạy riêng và đạt 94/94.
- Thêm **51 ca**, trong đó **35 đạt, 16 trượt**. Ảnh hợp lệ có ca đối chứng; ảnh lỗi được bộ giải mã `sharp` thật từ chối trước khi đưa vào parser sản phẩm. Ca worker có đối chứng đủ ID/payload/nhận xét đọc lại và đạt VERIFIED; các ca âm dùng cùng đường chạy.
- Kết quả 94 ca kế thừa đều đạt trong R20. Không cộng lặp 94 ca này thành “ca độc lập mới” khi báo tổng.

## 5. Trạng thái từng nhóm R19

“Đóng” trong bảng chỉ là đóng ở phạm vi mã nguồn và dữ liệu giả đã kiểm, chưa phải xác nhận website/tài khoản thật. Chi tiết máy đọc được, mã ca và quan sát nằm trong [issue-status.json](issue-status.json).

| Nhóm | Trạng thái R20 | Phần đã xác nhận và phần còn thiếu |
|---|---|---|
| R19-01 | **Sửa một phần — mở, P2 còn lại** | ZIP có file code hỏng và PNG chỉ có chữ ký đã bị chặn. Media giả cấu trúc vẫn được nhận; 3 ca mới trượt. |
| R19-02 | **Đóng cấp mã nguồn** | Chặn mã trùng/thiếu, điểm tối đa sai và tổng không khớp; barem sai bị chặn trước AI. Xóa giữa rồi thêm sinh CRIT_04, không trùng CRIT_03. |
| R19-03 | **Đóng cấp mã nguồn** | Bỏ chấp nhận hash chỉ nhận xét; hash cũ hạ trạng thái, duyệt lại được. Sáu loại trường đã khóa đổi đều làm xác minh thất bại. |
| R19-04 | **Sửa một phần — mở, P1** | Bảo vệ drift của hash/path/parseStatus trong SQLite đã đạt. Chưa đối chiếu file trên đĩa khi file đổi trước/trong AI; 2 ca trượt. |
| R19-05 | **Sửa một phần — mở, P1** | Duyệt đơn/hàng loạt kiểm toán tiêu chí; bài chưa tải không tự thành PARSED. Barem vẫn có thể được tạo từ chính điểm do client gửi; 1 ca trượt. |
| R19-06 | **Sửa một phần — mở, P1** | Chặn nhận xét/điểm/quyết định cũ; duyệt lại bản mới đạt. Chưa khóa phiên bản file đã xem; 1 ca trượt. |
| R19-07 | **Đóng cấp mã nguồn** | Cần đúng cả ID học viên và bài nộp; chặn trùng tên, modal trống, ID chỉ khớp một phần. Chưa xác nhận vị trí ID trên LMS thật. |
| R19-08 | **Sửa một phần — mở, P1** | Có ánh xạ thì chặn lesson/session khác nhau ở tải, danh sách và worker. Khi không có cache, worker bỏ qua lessonId và đoán cột; 1 ca trượt. |
| R19-09 | **Sửa một phần — mở, P1** | Chặn các ví dụ cũ và payload có điểm sai. Query tên khác, thao tác khác thiếu payload và URL khác vẫn được nhận; 3 ca trượt. |
| R19-10 | **Sửa một phần — mở, P1** | Chặn thiếu editor lúc ghi và nhận xét khác có chữ; có mở modal đọc lại. Nhận xét trống/đọc lỗi và quyết định sai vẫn VERIFIED; 3 ca trượt. |
| R19-11 | **Đóng cấp mã nguồn** | Kiểm tra cuối sau đọc DOM và cập nhật VERIFIED có điều kiện theo hash/trạng thái. Hash cũ không nâng bản mới; race cũ đạt. |
| R19-12 | **Đóng cấp mã nguồn** | Phản hồi buổi/lớp cũ đến muộn không thay danh sách hiện tại; kiểm tra bằng handler/hook mô phỏng. |
| R19-13 | **Sửa một phần — mở, P1** | Lỗi lưu nháp có thông báo và chặn duyệt đơn. Duyệt hàng loạt vượt chốt, làm mất bản nhập; phản hồi lưu cũ xóa cờ mới; 2 ca trượt. Nâng mức còn lại từ P2 lên P1 do có duyệt nhầm nội dung cũ. |
| R19-14 | **Đóng cấp mã nguồn** | Tải lỗi trả 502 và không AI, kể cả skipAi; lỗi một phần dừng rõ; lượt thành công chỉ chấm ID đã xác minh, không chấm cache ngoài lượt. |

Tổng: **6 nhóm đóng; 8 nhóm sửa một phần còn mở**. 20 ca tái hiện lỗi gốc đã đạt, nhưng chưa đủ điều kiện đóng 8 nhóm còn lại.

## 6. Chi tiết các phần sửa chưa đủ

### R19-09 — P1 — Vẫn nhầm phản hồi khác với xác nhận lưu điểm

**Nguyên nhân:** Khi có operationName, worker không bắt buộc đó là mutation lưu điểm cụ thể. Chỉ cần tên chứa các từ như submission và có hai ID; điểm/quyết định/nhận xét chỉ được kiểm tra nếu tình cờ xuất hiện. URL dùng tìm chuỗi `mindx.edu.vn`.

**Vị trí:** `grade-worker.ts:393–500`, `network-interceptor.ts:72–112`.

**Bằng chứng:** `R20-09-named-query` và `R20-09-missing-payload` đều cho verified=1 với query đọc hoặc thao tác attachment. `R20-09-exact-origin` chạy bộ lọc mạng thật và nhận matched=true với URL giả `https://unrelated.invalid/?return=mindx.edu.vn`. Không có yêu cầu mạng thật nào được gửi.

**Cách sửa:** Khóa origin/path và đúng mutation nghiệp vụ từ bằng chứng hợp lệ; bắt buộc đủ ID, điểm, quyết định và nhận xét đã chuẩn hóa. Không suy tên thao tác bằng từ khóa. **Sau sửa:** ba ca trên phải bị loại, đối chứng lưu đúng vẫn đạt.

### R19-10 — P1 — VERIFIED khi chưa đọc đủ bản đã lưu

**Nguyên nhân:** Điều kiện `editorDomText && ...` bỏ qua nhận xét trống; lỗi đọc được đổi thành chuỗi rỗng rồi cũng bỏ qua. Worker không đọc lại radio quyết định và không chờ xác nhận modal tải lại trước so sánh.

**Vị trí:** `grade-worker.ts:574–604`, đặc biệt `594–597`.

**Bằng chứng:** `R20-10-empty`, `R20-10-unreadable`, `R20-10-wrong-decision` đều verified=1. Đã mở/đọc modal hai lần nhưng radioReads=0. Đối chứng nhận xét sai có chữ bị chặn; đối chứng đầy đủ dữ liệu đạt.

**Cách sửa:** Đợi modal đúng tải lại, đọc bắt buộc điểm, quyết định và nhận xét; trống hoặc lỗi đọc phải thất bại. **Sau sửa:** cả ba ca không VERIFIED, không dựa vào điểm cũ đang hiển thị.

### R19-13 — P1 — Duyệt hàng loạt dùng bản cũ sau lỗi lưu nháp

**Nguyên nhân:** Chốt unsaved chỉ có trong duyệt đơn; duyệt hàng loạt không kiểm tra. Một lần lưu thành công bất kỳ xóa cờ chưa lưu của bài mà không đối chiếu phiên bản nhập.

**Vị trí:** `homework-auto-grader-tab.tsx:361–366`, `419–424`, `493–506`, `532–543`. Nút Duyệt hàng loạt tại `729–730` cũng không bị khóa theo cờ chưa lưu.

**Bằng chứng:** `R20-13-bulk-unsaved` nối handler thật với API duyệt thật và SQLite giả. Sau HTTP 500 lúc lưu `UNSAVED LATEST`, duyệt hàng loạt vẫn gọi API một lần, đánh dấu APPROVED cho nhận xét cũ, rồi tải lại làm mất nội dung vừa nhập. `R20-13-response-order`: lần lưu cũ trả thành công sau lần mới bị lỗi làm unsaved={} và cho gửi yêu cầu duyệt. Ca thứ hai chưa chứng minh server chấp nhận bản cũ vì server vẫn trả 409; lỗi là xóa sai cờ trên UI.

**Cách sửa:** Gắn phiên bản/thứ tự theo từng bài; chỉ xóa cờ đúng phiên bản đã lưu. Chặn duyệt/lưu LMS cả đơn và hàng loạt khi còn thay đổi lỗi hoặc đang lưu; giữ nội dung mới khi tải lại. **Sau sửa:** không gọi API duyệt hàng loạt trong ca lỗi, không xóa cờ mới bởi phản hồi cũ.

### R19-04 — P1 — Điểm AI không còn gắn đúng bytes của file

**Nguyên nhân:** Bản sửa so sánh trạng thái SQLite, nhưng không đối chiếu hash file vừa parse hay file vật lý trước khi ghi. Khi ghi đề xuất lại ưu tiên `existingDb.fileHash`.

**Vị trí:** `homework-grader.ts:230–277`, `355–371`, `530–545`, `576–579`.

**Bằng chứng:** `R20-04-disk-before` và `R20-04-disk-during` dùng file thật trong TEMP, đổi `print(1)` thành `print(2)` trước hoặc trong lời gọi model giả. Kết quả vẫn WAITING_APPROVAL, staleIgnored=false, DB giữ hash `d287…efe99` trong khi bytes trên đĩa có hash `fc92…ae7c`.

**Cách sửa:** Đối chiếu parsed.fileHash với bản tải đã khóa; kiểm tra lại file trước khi lưu đề xuất. Nếu đổi trong lúc AI chạy thì bỏ đề xuất và phân tích lại. **Sau sửa:** điểm/file/hash phải thuộc cùng phiên bản, không chỉ các trường SQLite khớp nhau.

### R19-05 — P1 — Kết quả chấm trở thành barem của chính nó

**Nguyên nhân:** Khi chưa có criteriaGrades, API nháp dùng chính body.criteriaGrades làm nguồn maxPoints/mã tiêu chí. API duyệt lấy danh sách đó làm “locked rubric”, ưu tiên hơn barem được gửi; bảng bài nộp chưa lưu barem có thẩm quyền riêng.

**Vị trí:** `submissions/route.ts:211–237`, `approve/route.ts:14–35`, `214–219`; cấu trúc bảng tại `sqlite.ts:111–134`.

**Bằng chứng:** `R20-05-authoritative-rubric` bắt đầu bằng bài đã tải/parse có file/hash thật, chưa có điểm thành phần. Gửi tiêu chí UNRELATED 100 điểm qua API nháp, rồi duyệt với barem C1. Hai API đều HTTP 200 và UNRELATED được APPROVED. Không sửa trực tiếp bảng sau khi gửi API trong tái hiện này.

**Cách sửa:** Lưu riêng barem và phiên bản barem đã chọn cho bài; dùng nó kiểm toán cả nháp lẫn duyệt. **Sau sửa:** tiêu chí lạ không thể tự trở thành barem; các ca điểm giáo viên chỉnh hợp lệ vẫn hoạt động.

### R19-06 — P1 — Duyệt bản cũ vẫn ký cho file mới

**Nguyên nhân:** So điểm/nhận xét/quyết định không thay thế phiên bản toàn bộ bài. UI không gửi phiên bản file đã xem; server cũng bỏ qua fileHash cũ nếu được gửi.

**Vị trí:** `approve/route.ts:230–293`, `homework-auto-grader-tab.tsx:444–456`.

**Bằng chứng:** `R20-06-file-version` dùng hai phiên bản file vật lý, cập nhật hash bản mới và trạng thái PENDING nhưng giữ nhận xét/điểm cũ. Yêu cầu duyệt chứa hash cũ vẫn HTTP 200 và ký APPROVED cho hash mới.

**Cách sửa:** Yêu cầu duyệt phải kèm phiên bản gồm file/barem/nội dung đang xem; lệch trả 409 và giữ bản mới. Áp dụng cả duyệt hàng loạt. **Sau sửa:** ca thay file bị chặn, tải bản mới rồi duyệt lại đạt.

### R19-08 — P1 — Bỏ qua lessonId khi thiếu ánh xạ

**Nguyên nhân:** Worker mặc định colIndex=sessionNumber−1 và chỉ đối chiếu lessonId bên trong nhánh có cached columns. Không có cache thì tham số lessonId không được xác minh.

**Vị trí:** `grade-worker.ts:160–187`.

**Bằng chứng:** `R20-08-worker-no-mapping` gửi L2/session01 khi không có cache; writes=1, verified=1. Ca có cache L2 thuộc buổi 2 bị chặn đúng. Tái hiện chứng minh worker bỏ qua phạm vi được yêu cầu, chưa chứng minh đã ghi nhầm một bài thật trên LMS.

**Cách sửa:** Thiếu ánh xạ thì đọc lại ánh xạ hợp lệ hoặc dừng; không suy cột để lưu. **Sau sửa:** thiếu cache hoặc cặp không hợp lệ phải bị chặn trước Save, cặp đúng có bằng chứng vẫn đạt.

### R19-01 — P2 còn lại — Media hỏng vẫn được gửi AI

**Nguyên nhân:** Kiểm tra mới vẫn dựa vào vài marker: PNG chỉ cần IHDR/kích thước/IEND, JPEG có đầu/cuối, WebP có RIFF/WEBP. Chưa chứng minh giải mã được nội dung ảnh.

**Vị trí:** `media-reader.ts:36–85`. Phần ZIP tại `archive-reader.ts:362–380` đã chặn file code hỏng đúng yêu cầu.

**Bằng chứng:** `R20-01-malformed-png/jpg/webp`: bộ giải mã ảnh thật từ chối cả ba file 37/8/21 byte, parser lại PARSED và có 1 inlineData. Các PNG/JPG/WebP thật do bộ mã hóa tạo đều qua ca đối chứng. Hạ mức lỗi còn lại trong nhóm xuống P2 vì phần ZIP P1 đã được sửa.

**Cách sửa:** Xác minh bằng bộ đọc định dạng đáng tin cậy hoặc kiểm tra cấu trúc đầy đủ, xử lý lỗi thành PARSE_ERROR trước AI. **Sau sửa:** các ảnh hỏng bị chặn; ảnh hợp lệ tiếp tục đạt. Chưa có ca bổ sung chứng minh bộ giải mã PDF đầy đủ trong vòng này.

## 7. Đối chiếu nghiệm thu Giai đoạn 5

| Điều kiện kế hoạch | Đánh giá |
|---|---|
| Khóa bài nộp/học viên, không chấm/lưu nhầm | R19-07 đạt cấp nguồn; chưa đủ ký vì R19-04/06/08 còn khe hở phiên bản/phạm vi. |
| Tổng điểm đúng bằng code, đủ bằng chứng theo barem | Các kiểm tra cộng điểm và R19-02 đạt; R19-05 vẫn cho barem tự xác lập từ kết quả chấm. |
| Lưu LMS và đọc lại khớp 100% | Chưa đạt: R19-09/10 còn xác nhận API/đọc lại thiếu; R19-13 còn duyệt bản cũ. R19-11 đã sửa đúng race cuối. |

Các rào đã đối chiếu: dev/start cấu hình `127.0.0.1`; tải và lưu qua SequentialTaskQueue; BrowserManager giữ một persistent context; file parser/đường dẫn bài nộp qua allowlist. Không thấy cấu hình chứa mật khẩu/khóa Gemini được import vào component chấm bài. Rào đúng API nghiệp vụ và đủ đọc lại vẫn chưa đạt như các phát hiện trên. Đây là kiểm tra nguồn, chưa đo server/browser thật đang chạy.

## 8. Giới hạn và quyết định

- Không đăng nhập, đọc tài khoản/tên/bài thật, tải hay ghi LMS; không gọi Gemini hoặc phát sinh phí model. Không mở DB thật và không thực thi code học viên.
- Chưa chạy giao diện chấm bài trong Chromium, chưa kiểm tra concurrent rendering đầy đủ của React. Ca UI thể hiện thứ tự handler/phản hồi xác định và API/SQLite giả, không chứng nhận mọi tương tác trình duyệt.
- Chưa xác nhận selector ID hoặc tên/cấu trúc mutation lưu điểm hiện tại trên LMS thật. Đặc biệt R19-07 “đóng cấp nguồn” chỉ chứng minh chặn đầu vào sai và đối chứng tổng hợp đúng, chưa chứng minh ID thật có sẵn trong modal.
- Chưa thử tải lớn gây cạn bộ nhớ, mất điện/mất mạng thật, nhiều tiến trình cùng ghi; chưa nghiệm thu Giai đoạn 6–7. Bộ kiểm tra ZIP vẫn là các mẫu có kiểm soát.
- Ca ẩn danh/sandbox cũ đạt với văn bản giả. Chưa chứng minh ẩn danh tên nằm trong bytes ảnh/PDF hoặc hành vi Gemini thật trước mọi chỉ dẫn độc hại.

**NO-GO cấp mã nguồn Giai đoạn 5.** Không thể ký nghiệm thu từ kết quả build xanh hoặc 94/94 ca cũ khi 16 ca mở rộng vẫn trượt. Cần sửa tám nhóm còn mở, giữ các ca hiện đạt và chạy lại cùng bộ lệnh trong bản sao cô lập. Ưu tiên R19-09/10/13, tiếp đến R19-04/05/06/08, rồi hoàn thiện media R19-01. Chỉ sau khi cấp nguồn đạt mới đánh giá một lượt nghiệm thu dịch vụ thật với phạm vi Owner cho phép.

**Đã làm:** kiểm chứng đủ 14 nhóm, chạy đủ lệnh, lập hồ sơ R20 và cập nhật AUDIT-R20.

**Kết quả:** 6 nhóm đóng cấp nguồn, 8 nhóm còn mở; R20 129/145, R19 94/94, hồi quy cũ 186/186; TypeScript/build đạt; 233/233 file bảo vệ nguyên byte.

**Chưa kiểm tra:** tài khoản/dữ liệu/dịch vụ thật và UI trình duyệt như giới hạn trên.

**Việc tiếp theo:** giao sửa đúng tám nhóm còn mở; Owner không cần chạy Terminal hoặc cung cấp tài khoản cho vòng kiểm toán này.
