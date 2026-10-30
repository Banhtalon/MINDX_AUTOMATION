# Kiểm định độc lập v3.4.0 — S5b, Vòng 1

**Verdict: NO-GO.** Chưa đủ điều kiện nghiệm thu `S5b.1`–`S5b.9` hoặc chuyển chặng. Có **6 lỗi xác nhận được** (2 HIGH, 4 MEDIUM) và **1 sai khác MEDIUM giữa mã hiện tại và ma trận công cụ trong yêu cầu kiểm định**. Không sửa mã ứng dụng hay bài kiểm thử sản phẩm trong lần kiểm định này.

Màn hình đã có công tắc chuẩn bị tự động, nút AI/nộp gộp Buổi 14 và hai tab trong từng học viên. Tuy nhiên, chuỗi chuẩn bị có thể dừng sau chụp ảnh vì dùng phiên bản bản nháp cũ; phần Sản phẩm lỗi sớm có thể bị báo hoàn tất mà không có nút thử lại; chọn sẵn Buổi 13 và đọc điểm Demo còn thiếu chưa đúng ở các trường hợp biên.

## 1. Phạm vi và bản mã được kiểm

- Ngày: **30/10/2026**, múi giờ Việt Nam.
- Vai trò: Reviewer độc lập theo yêu cầu `gpt-6.1-sol high`. Không sử dụng kết luận tự kiểm của người triển khai làm bằng chứng nghiệm thu.
- Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`.
- HEAD: **`a78c5a1b1b67735f6e9987d06c437513e771ae06`**, **cộng cây làm việc chưa commit**. Kết luận không áp dụng riêng cho HEAD sạch.
- Khi bắt đầu: 13 tệp đã theo dõi có thay đổi và `scripts/test-streamline-v340-s5.ts` chưa được Git theo dõi. Các thay đổi đó được giữ nguyên.
- Đọc `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`; đối chiếu kế hoạch duyệt tại `C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md`, đặc biệt dòng 202–224.
- Lần theo trang `/final-project`, hook điều phối, các thành phần giao diện, các route Quét/lưu nháp/AI/công cụ/nộp, kho bản nháp từng buổi, bộ tạo nhận xét và các bài kiểm thử liên quan. Giả định tải sử dụng: một giáo viên vận hành bot cục bộ.
- Dấu vết bản mã: [source-before.json](s5b-round1/source-before.json), [source-integrity.json](s5b-round1/source-integrity.json), [working-tree.patch](s5b-round1/working-tree.patch). Bài S5b chưa được theo dõi có bản lưu riêng trong [test-streamline-v340-s5.source.txt](s5b-round1/test-streamline-v340-s5.source.txt).

## 2. An toàn dữ liệu và cách chạy

Mọi tiến trình kiểm thử đều được khởi chạy với:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = Join-Path $env:TEMP 'codex_s5b.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $env:TEMP 'codex_s5b_classes.json'
```

**Không mở, băm hoặc sao chép `data/mindx_bot.db` và `data/running_classes.json` thật.** Không thay cấu hình tài khoản, không nộp dữ liệu lên LMS/Teaching thật, không commit/push. Các thử nghiệm giao diện dùng Chromium, trang dựng cục bộ và phản hồi giả; phép kiểm kho dữ liệu dùng SQLite tạm.

Một số bài cũ tự thay đường dẫn dữ liệu, đọc đường dẫn “production” tính từ thư mục chạy, hoặc ghi ảnh vào hồ sơ S5a. Vì vậy S5a và nhóm hồi quy mở rộng được chạy trong **bản sao thư mục dưới TEMP**, không có hai tệp dữ liệu thật, không có `.env` thật. `src`, `scripts`, tài liệu và cấu hình mẫu được sao chép; thư viện đã cài được dùng chung. Những bài tự đặt lại biến môi trường chỉ thao tác trong TEMP. Ảnh và manifest S5a lịch sử ở dự án gốc không bị ghi đè.

Lượt chạy đầu trong bản sao thiếu `start-bot.bat`, `start-bot.command`, `GEMINI.md` và khóa Gemini giả, khiến Phase 7, S1 và S14 lần lượt lỗi do chuẩn bị môi trường kiểm thử. Đã bổ sung đúng các tệp gốc còn thiếu và khóa **giả**, rồi chạy lại cả ba bài đạt. Giữ cả log đầu và log chạy lại; không tính các lỗi chuẩn bị này là lỗi sản phẩm.

**138/138 tệp mã nguồn/bài kiểm thử có sẵn giữ nguyên SHA-256, kích thước và thời gian ghi** so với trước khi chạy. Chỉ thêm hồ sơ kiểm định và ghi chú kết quả vào ba tài liệu tiến độ theo `AGENTS.md`.

## 3. Các phát hiện cần xử lý

| Mã | Mức độ | Kết quả | Vấn đề |
|---|---|---|---|
| S5B-01 | HIGH | OPEN | Chuỗi tự chuẩn bị dùng lại bản nháp từ lúc Quét; Web/Drive bị lỗi phiên bản sau chụp ảnh |
| S5B-02 | HIGH | OPEN | Phần Sản phẩm lỗi trước khi có bảng kết quả: nút nộp gộp báo hoàn tất và mất nút thử lại phần Sản phẩm |
| S5B-03 | MEDIUM | OPEN | Có một điểm Demo dương là ngừng tự đọc, dù học viên khác còn điểm 0 |
| S5B-04 | MEDIUM | OPEN | Cả lớp đã nộp Buổi 13 vẫn bị tự chọn lại cả lớp |
| S5B-05 | MEDIUM | OPEN | Sau thử lại, bộ đếm Buổi 14 chỉ giữ số thành công của lần thử cuối |
| S5B-06 | MEDIUM | OPEN | Cổng TypeScript không đạt do hai truy cập giá trị có thể chưa tồn tại trong test S5b |
| S5B-07 | MEDIUM | OPEN — sai khác yêu cầu | App/Python vẫn tự chụp ảnh trước Drive, khác ma trận trong yêu cầu kiểm định hiện tại |

### S5B-01 — Sau chụp ảnh, Up Web và Drive dùng phiên bản cũ

**Nguyên nhân:** `runAutoPrepAfterScan` truyền cùng mảng `scannedItems` vào mọi bước. Chụp ảnh với `syncActiveSession: true` cập nhật tài nguyên và tăng `draftVersion` của bản nháp. Bước Web/Drive vẫn lấy `sourceRows` cũ, rồi `persistRowDraft` gửi lại toàn bộ nội dung cùng `expectedVersion` cũ. Máy chủ từ chối 409 — nghĩa là “bản nháp trên máy chủ đã mới hơn”.

**Vị trí:** `src/components/final-project/useSpckWorkflow.ts:3441`, `:3455`, `:3457`, `:3469`, `:3471`; phần lấy `activeRows` tại `:1344` và lưu trước công cụ tại `:1205`, `:1384`. Bên gọi gửi phiên bản tại `src/app/final-project/page.tsx:1556`. Kiểm tra phiên bản thật ở `src/app/api/spck/save-draft/route.ts:104`.

**Tái hiện:** Lớp Web có hai bản nháp phiên bản 1; bấm Quét khi công tắc bật. Cho bước Chụp trả tài nguyên mới và phiên bản 2. Cả Web lẫn Drive gửi phiên bản 1, bị 409 tại bước lưu nháp; **không có yêu cầu `/deploy-web` hoặc `/upload-drive`**. Bản kiểm giao diện `P01` xác nhận hai xung đột. Kiểm thêm bằng kho dữ liệu và route thật `DB01`: bản nháp **2 → 3**, lưu lại với **2 → HTTP 409**, không dựa riêng vào phản hồi giả.

**Ảnh hưởng:** Luồng Quét → chuẩn bị tự động không hoàn thành trong tình huống bình thường có ảnh mới. Các hàm công cụ nuốt lỗi và trả về bình thường; vòng tổng không ghi nhận thất bại. Lỗi lưu nháp này cũng không tạo cờ lỗi riêng cho công cụ, nên có thể không hiện nút thử lại tương ứng trên dòng học viên.

**Cách sửa ít nhất:** Sau mỗi bước, lấy các dòng và phiên bản mới nhất làm đầu vào cho bước tiếp theo, hoặc truyền kết quả mới sang bước sau. Không bỏ kiểm tra phiên bản và không lưu chồng mảng cũ. Cho mỗi bước trả kết quả thành công/thất bại để tổng hợp đúng.

**Sau khi sửa:** Dùng phản hồi có tăng phiên bản thật; chứng minh thứ tự Chụp → Web → Drive hoàn thành, không có 409, giữ ảnh/link từ các bước trước và đồng bộ đúng buổi đang chọn trước Duyệt.

**Bằng chứng:** [P01](s5b-round1/observations.json), [DB01](s5b-round1/repository-observations.json), [probe kho dữ liệu](s5b-round1/repository-probe.ts).

### S5B-02 — Lỗi sớm của phần Sản phẩm bị báo hoàn tất, thiếu thử lại riêng

**Nguyên nhân:** Hàm nộp SPCK có nhiều nhánh `return` khi lưu nháp thất bại hoặc khi không thể tiếp tục; nó không trả bảng kết quả ở các nhánh đó. Hàm nộp gộp chỉ cập nhật `nextSpckSummary` nếu có đối tượng trả về, rồi tiếp tục Đánh giá. Cuối cùng, nó đánh giá lỗi qua danh sách retry; không có summary bị xem như không có lỗi.

**Vị trí:** `src/app/final-project/page.tsx:2005`–`:2012`; `src/components/final-project/useSpckWorkflow.ts:3320`, `:3333`–`:3336`, `:3363`–`:3378`. Nút thử lại phần Sản phẩm chỉ xuất hiện khi có summary có retry tại `src/components/final-project/SubmitBar.tsx:40`–`:59`.

**Tái hiện:** Buổi 14, chọn hai học viên. Cho `/api/spck/save-draft` trả 409 ở phần Sản phẩm; cho phần Đánh giá thành công. Không có lần nộp Sản phẩm nào. Kết quả là **banner xanh “Hoàn tất nộp Buổi 14 đầy đủ … Sản phẩm 0/2 … Đánh giá 2/2”**, phần Sản phẩm ghi “Chưa chạy trong đợt này”, và **không có nút “Thử lại riêng phần Sản phẩm”**. Lỗi 409 ban đầu bị thông báo tổng che mất. Nếu đã có summary trước đó, mã còn có thể giữ lại summary cũ.

**Ảnh hưởng:** Giáo viên không biết lý do phần Sản phẩm chưa nộp và không thể dùng luồng thử lại riêng đã được yêu cầu. Việc tiếp tục phần Đánh giá tự nó không phải lỗi; lỗi là thiếu kết quả thất bại và phục hồi riêng cho phần Sản phẩm.

**Cách sửa ít nhất:** Mọi đường thoát của phần Sản phẩm phải có kết quả rõ ràng cho các học viên chưa hoàn tất. Khi không có kết quả hợp lệ, tạo trạng thái thất bại với retry IDs và lý do; không dùng kết quả đợt cũ hay banner thành công. Giữ nguyên kết quả phần kia.

**Sau khi sửa:** Kiểm lưu nháp 409, mất mạng và duyệt bị từ chối. Mỗi trường hợp phải hiện lỗi đúng phần, có nút thử lại phần Sản phẩm và không nộp lại phần Đánh giá đã thành công.

**Bằng chứng:** `P04` trong [observations.json](s5b-round1/observations.json), [ảnh giao diện P04](s5b-round1/P04.png).

### S5B-03 — Không tự đọc Demo khi mới có điểm của một học viên

**Nguyên nhân:** Hiệu ứng dùng `some(demoTotalScore > 0)` rồi dừng cả lớp. Điều kiện này không tương đương với yêu cầu tự nhập cho các dòng `demoTotalScore === 0`.

**Vị trí:** `src/components/final-project/useSpckWorkflow.ts:2440`–`:2443`.

**Tái hiện:** Mở Buổi 14 có hai học viên: một người 4,5 điểm, người kia 0 điểm. Không có yêu cầu `/session14-eval/import-demo-scores`. Cùng bộ dữ liệu khi cả hai đều 0 thì bài S5b gốc có yêu cầu nhập điểm.

**Ảnh hưởng:** Lớp đã nhập điểm một phần không tự bổ sung phần còn thiếu, khiến giáo viên vẫn phải nhớ bấm đọc điểm thủ công.

**Cách sửa ít nhất:** Xét còn dòng cần nhập, thay vì chỉ cần thấy một điểm dương là bỏ cả lớp. Giữ cơ chế chống gọi lặp và bảo vệ điểm giáo viên đã chỉnh.

**Sau khi sửa:** Kiểm lớp tất cả 0, hỗn hợp dương/0, tất cả có điểm; kiểm điểm đã chỉnh không bị ghi đè ngoài ý muốn. Ô nhập nguồn Demo thủ công phải tiếp tục hiện.

**Bằng chứng:** `P02` trong [observations.json](s5b-round1/observations.json).

### S5B-04 — Buổi 13 không chọn rỗng khi mọi học viên đã nộp

**Nguyên nhân:** Cả ba đường chọn tự động chỉ dùng danh sách chưa nộp nếu `length > 0`. Khi danh sách đó rỗng, mã rơi xuống chọn bài đủ điều kiện hoặc toàn bộ học viên.

**Vị trí:** `src/app/final-project/page.tsx:1107`, `:1481`, `:2587`–`:2595`.

**Tái hiện:** Cả hai học viên có lịch sử đã nộp Buổi 13. Tải lớp cho kết quả **“Đang chọn: 2/2”** thay vì 0/2. Bài kiểm thử gốc chỉ kiểm trường hợp một người đã nộp, một người chưa nộp nên không phát hiện.

**Ảnh hưởng:** Giáo viên có thể nộp lại những bài đã nộp khi tin rằng bộ chọn sẵn đang chỉ chọn bài còn thiếu.

**Cách sửa ít nhất:** Ở Buổi 13, luôn dùng danh sách chưa nộp, kể cả danh sách rỗng. Không dùng điều kiện độ dài để quay về chọn tất cả. Áp dụng nhất quán ở tải lớp, chuyển buổi và sau Quét.

**Sau khi sửa:** Kiểm 0/N, một phần/N và N/N học viên đã nộp, qua cả ba đường trên; giữ khả năng giáo viên tự chọn nộp lại khi muốn.

**Bằng chứng:** `P03` trong [observations.json](s5b-round1/observations.json).

### S5B-05 — Thử lại riêng làm mất số thành công trước đó trên bảng trạng thái

**Nguyên nhân:** Sau retry phần Đánh giá, `nextEvalVerified = evalRes.verifiedCount` thay số tổng bằng số thành công của tập retry. Phần Sản phẩm cũng thay toàn bộ summary bằng summary của tập retry.

**Vị trí:** `src/components/final-project/useSpckWorkflow.ts:3335`, `:3347`–`:3349`; hiển thị tại `src/components/final-project/SubmitBar.tsx:185`–`:209`.

**Tái hiện:** Nộp Đánh giá hai học viên: người đầu VERIFIED, người thứ hai FAILED. Bấm thử lại riêng cho người thứ hai và cho thành công. Bảng tổng vẫn ghi **“Đã lưu & xác minh 1 học viên (0 cần thử lại)”**, dù cộng hai lần phải là 2. Yêu cầu retry chỉ gửi người thứ hai và không gửi lại phần Sản phẩm: phần này đúng.

**Ảnh hưởng:** Mất độ tin cậy của bảng theo dõi hai phần. Đây là lỗi tổng hợp kết quả trên giao diện; chưa thấy bằng chứng nó xóa VERIFIED trong SQLite.

**Cách sửa ít nhất:** Gộp kết quả theo `studentId` trong đợt gốc, cập nhật các ID được thử lại và tính lại tổng; không cộng mù vì cùng một người có thể được thử lại nhiều lần.

**Sau khi sửa:** Kiểm 1 thành công + 1 lỗi → retry thành công = 2 thành công; lặp lại nhiều lần không đếm trùng. Kiểm tương tự cho phần Sản phẩm và giữ trạng thái phần không chạy lại.

**Bằng chứng:** `P05` trong [observations.json](s5b-round1/observations.json).

### S5B-06 — Cổng TypeScript bắt buộc đang không đạt

**Nguyên nhân:** `outboundPromptSample` là trường có thể chưa tồn tại, nhưng bài S5b gọi `.includes()` trực tiếp mà chưa xác nhận nó là chuỗi.

**Vị trí:** `scripts/test-streamline-v340-s5.ts:159`, `:163`.

**Tái hiện:** Chạy `npx tsc --noEmit --incremental false`: **exit 1**, hai lỗi `TS18048`. Chạy lại cuối kiểm định vẫn đúng hai lỗi đó. Bài `npx tsx scripts/test-streamline-v340-s5.ts` đạt không thay thế cổng kiểm kiểu dữ liệu này.

**Cách sửa ít nhất:** Kiểm rõ trường đó tồn tại và là chuỗi trước khi gọi `.includes()`, đồng thời giữ assertion bảo đảm có prompt. Không tắt kiểm kiểu dữ liệu hoặc loại bài kiểm thử khỏi dự án để làm cổng xanh.

**Sau khi sửa:** TypeScript exit 0 và bài S5b vẫn kiểm được nội dung prompt như trước.

**Bằng chứng:** [tsc.log](s5b-round1/tsc.log), [tsc-final.log](s5b-round1/tsc-final.log).

### S5B-07 — App/Python chưa khớp ma trận công cụ trong yêu cầu hiện tại

**Nguyên nhân:** Điều kiện hiện tại thêm bước Chụp khi có tệp `.py` hoặc khi nhận diện App. Vì thế App/Python không chỉ chạy Drive.

**Vị trí:** `src/components/final-project/useSpckWorkflow.ts:3417`–`:3435`.

**Tái hiện:** Lớp giả `VT-C4K-PTA15`, tệp `project.py`, bấm Quét. Quan sát **Quét → Chụp → Drive**. Yêu cầu kiểm định hiện tại ghi **App/Python/Canva/Robotics: upload-drive**; do đó trường hợp App/Python chưa đáp ứng tiêu chí này.

**Đối chiếu công bằng:** Kế hoạch duyệt tại dòng 205 lại yêu cầu **App/Game tự chụp giao diện**, và dòng 204 có ngoại lệ Robotics có Playlist thì nhập YouTube. Vì vậy đây là **sai khác giữa hai bộ tiêu chí**, không khẳng định mã đã vi phạm ý App/Game trong kế hoạch cũ. Không dùng trường hợp Robotics có Playlist để kết luận sai chỉ vì có bước YouTube.

**Cách xử lý:** Chốt một ma trận thống nhất trong yêu cầu triển khai và kế hoạch: nếu áp dụng đúng yêu cầu kiểm định mới thì App/Python phải bỏ Chụp tự động; nếu giữ kế hoạch App/Game thì phải ghi lại ngoại lệ đó trong tiêu chí nghiệm thu. Bổ sung kiểm thử từng loại lớp với đúng loại tệp, không dùng HTML cho mọi lớp.

**Sau khi xử lý:** Các nhánh JSB, SB, App/Python, Canva, Robotics có/không Playlist được kiểm bằng ma trận thống nhất. Reviewer không tự sửa quyết định sản phẩm trong lần kiểm định này.

**Bằng chứng:** `P07` trong [observations.json](s5b-round1/observations.json); đối chứng `P06` xác nhận SB `.sb3` chạy Quét → Chụp → Drive.

## 4. Đối chiếu S5b.1–S5b.9

| Mục | Đánh giá | Bằng chứng và giới hạn |
|---|---|---|
| S5b.1 | CHƯA ĐẠT | Công tắc mặc định ON, lưu lựa chọn và nhãn tiến trình có; có thứ tự gọi đúng trong test đơn giản. `S5B-01` làm chuỗi thật có tăng phiên bản bị chặn; `S5B-07` là sai khác ma trận App/Python. |
| S5b.2 | ĐẠT trong phạm vi kiểm | Các thao tác thủ công Drive/Web/Chụp gọi `confirmBeforeDemotingApprovedRows`; hủy xác nhận không gọi công cụ trong test S5b. Tự chuẩn bị loại dòng APPROVED/VERIFIED khỏi tập Drive/Web/Chụp. Chưa nghiệm thu thao tác thật. |
| S5b.3 | ĐẠT có giới hạn | Các nút thường được gom trong ToolsDrawer; StudentRow chỉ hiện retry theo lỗi. Test Drive lỗi → hiện retry → thành công thì ẩn đạt. Lỗi trước API công cụ trong `S5B-01` chưa có đường retry riêng đầy đủ. |
| S5b.4 | CHƯA ĐẠT | Có AI SPCK rồi AI Thư 3 phần; có nộp Sản phẩm rồi Đánh giá, hai tab trong dòng học viên, đã bỏ danh sách học viên riêng phía dưới. Retry Đánh giá gọi đúng học viên lỗi, không gọi lại Sản phẩm. Lỗi sớm và tổng kết retry chưa đạt (`S5B-02`, `S5B-05`). |
| S5b.5 | CHƯA ĐẠT | Ô nhập nguồn Demo thủ công đã hiện; tự đọc khi cả lớp chưa có điểm đạt test gốc. Trường hợp thiếu một phần không đạt (`S5B-03`). |
| S5b.6 | CHƯA ĐẠT toàn mục | Prompt có yêu cầu nêu tiến bộ khi có bằng chứng Buổi 12; đường đọc bằng chứng từ kho dữ liệu vẫn có. Chọn một phần chưa nộp đạt; trường hợp không còn ai chưa nộp sai (`S5B-04`). |
| S5b.7 | ĐẠT | Không còn khối `false &&` trong các tệp `.tsx` của hai thư mục được yêu cầu, qua tìm kiếm và bài S5b. |
| S5b.8 | ĐẠT trong phạm vi cục bộ | Làm sạch tiêu đề/nhận xét và Logo MindX mặc định đạt S5b, v270, v272, Phase 6. Luồng ảnh vẫn ưu tiên ảnh Owner; không có thay đổi bộ chọn ảnh trong diff S5b. Không xác nhận đầu ra Gemini thật hay LMS thật. |
| S5b.9 | CHƯA ĐẠT | Bài S5b chạy đạt nhưng TypeScript lỗi; test giả hiện tại không tăng phiên bản sau công cụ, không kiểm lỗi sớm phần Sản phẩm hoặc tổng tích lũy sau retry. Cần các ca thất bại có ý nghĩa trước khi nghiệm thu. |

Không xác nhận mục tiêu **6 → 4** hoặc **~11 → ~6 lần bấm** đã đạt trọn vẹn, vì các lỗi trên có thể buộc giáo viên thao tác lại. Giao diện có các nút gộp không đủ chứng minh toàn bộ quy trình sử dụng đã đạt mục tiêu.

## 5. Cổng kiểm thử chạy mới

**17 cổng khác nhau: 16 PASS, 1 FAIL. Sáu cổng được nêu đích danh trong yêu cầu: 5 PASS, 1 FAIL.** Số này tính kết quả cuối của mỗi cổng, không cộng lượt chạy lại.

| Lệnh | Exit | Kết quả cuối / log |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 1 | FAIL — [tsc-final.log](s5b-round1/tsc-final.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | PASS — [log](s5b-round1/test-streamline-v340-s5.log) |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-streamline-v340-s5a.log) |
| `npx tsx scripts/test-spck-v270.ts` | 0 | PASS — [log](s5b-round1/test-spck-v270.log) |
| `npx tsx scripts/test-spck-v272.ts` | 0 | PASS — [log](s5b-round1/test-spck-v272.log) |
| `npx tsx scripts/test-phase6.ts` | 0 | PASS — [log](s5b-round1/test-phase6.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-phase5.log) |
| `npx tsx scripts/test-phase7.ts` | 0 | PASS sau bổ sung tệp khởi chạy cho bản sao — [log](s5b-round1/test-phase7-rerun.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-phase4-codex-repros.log) |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-lms-reliability-v280.log) |
| `npx tsx scripts/test-session14-v290.ts` | 0 | PASS sau cấp khóa Gemini giả cho bài có mô phỏng AI — [log](s5b-round1/test-session14-v290-rerun.log) |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-teaching-project-v320.log) |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-report-card-v330.log) |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 0 | PASS sau bổ sung GEMINI.md cho bản sao — [log](s5b-round1/test-streamline-v340-s1-rerun.log) |
| `npx tsx scripts/test-streamline-v340-s2.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-streamline-v340-s2.log) |
| `npx tsx scripts/test-streamline-v340-s3.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-streamline-v340-s3.log) |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | PASS trong TEMP — [log](s5b-round1/test-streamline-v340-s4.log) |

S5a hiện lấy bản trước từ `93b77e0` và bản sau từ **commit cố định `a78c5a1`** (`scripts/test-streamline-v340-s5a.ts:182`), nên kết quả ảnh/HTML của bài này chỉ chứng minh cặp mốc S5a đó. Không dùng nó để tuyên bố giao diện S5b hiện tại giống S5a hoặc các luồng mới đã được bảo chứng.

Thêm **7 ca quan sát giao diện** và **1 ca kho dữ liệu/route thật** trong TEMP: các assertion mô tả kết quả hiện tại đều đạt. Có 5 ca lỗi chức năng (`P01`–`P05`), 1 ca đối chứng (`P06`), 1 ca sai khác ma trận (`P07`) và 1 ca xác nhận nguyên nhân phiên bản (`DB01`); không cộng DB01 thành lỗi mới. Exit 0 của probe nghĩa là đã thu bằng chứng đúng kỳ vọng, **không phải kết luận sản phẩm đạt**.

- [independent-probe.ts](s5b-round1/independent-probe.ts), [log](s5b-round1/independent-probe.log), [observations.json](s5b-round1/observations.json).
- [repository-probe.ts](s5b-round1/repository-probe.ts), [log](s5b-round1/repository-probe.log), [repository-observations.json](s5b-round1/repository-observations.json).
- Nhật ký exit: [gates.jsonl](s5b-round1/gates.jsonl), [mirror-gates.jsonl](s5b-round1/mirror-gates.jsonl), [mirror-rerun-gates.jsonl](s5b-round1/mirror-rerun-gates.jsonl).

Probe giao diện dùng lại phần dựng trang và dữ liệu giả của bài S5b để chạy mã giao diện hiện tại, nhưng thay hoàn toàn phần kiểm tra và bổ sung điều kiện phiên bản/lỗi. Mô phỏng xung đột phiên bản đã được đối chiếu riêng với kho dữ liệu và route thật. Đây không phải kiểm thử kết nối LMS thật.

## 6. Điều kiện để kiểm lại và chuyển GO

1. Sửa `S5B-01` và `S5B-02` trước: chuỗi công cụ giữ dữ liệu/phiên bản mới; mọi lỗi phần Sản phẩm đều có kết quả và nút thử lại riêng.
2. Sửa `S5B-03`–`S5B-06`: nhập Demo còn thiếu, chọn rỗng đúng, gộp kết quả retry và làm cổng TypeScript đạt.
3. Thống nhất ma trận App/Python của `S5B-07`, ghi rõ ngoại lệ App/Game và Robotics có Playlist nếu giữ theo kế hoạch cũ.
4. Bổ sung các ca biên tương ứng vào test S5b; chạy lại 17 cổng và các ca đối kháng trên bản mã sau sửa, vẫn cô lập dữ liệu.
5. Kiểm lại bảo toàn VERIFIED từng phần khi phần kia thất bại, cả lỗi trước khi nộp lẫn lỗi từng học viên sau khi nộp. Không đánh dấu VERIFIED chỉ theo lời báo thành công trên giao diện.

**Chưa kiểm tra:** thao tác thật trên LMS/Teaching, đăng nhập và tải Drive/GitHub/YouTube thật, Gemini thật, toàn bộ bố cục/responsive và số lần bấm với lớp thật. Đây là nghiệm thu mã và hành vi cục bộ có mô phỏng; chưa phải nghiệm thu vận hành.

**Việc tiếp theo:** Người triển khai xử lý từng mã trên rồi gửi bản sau sửa để kiểm định Vòng 2. Owner chưa cần thao tác kỹ thuật.
