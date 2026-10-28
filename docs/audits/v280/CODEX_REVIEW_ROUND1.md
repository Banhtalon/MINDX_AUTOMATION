# v2.8.0 — Kiểm định độc lập, vòng 1

Ngày: 2026-10-26. Reviewer: Codex. Phạm vi: năm tệp Playwright được yêu cầu, `scripts/test-lms-reliability-v280.ts`, ba tài liệu trạng thái và các hàm gọi/kiểm tra dữ liệu liên quan. Giả định vận hành: một giáo viên, một hàng đợi trình duyệt tuần tự.

Bản nâng cấp tránh bấm tắt buổi học đang mở, tránh chọn nhầm tab Homework và thêm tự phục hồi/thử lại. Hướng sửa chính có tác dụng trong kiểm thử thông thường, nhưng giới hạn an toàn của việc thử lại và phục hồi chưa được bảo đảm.

## Bản mã được kiểm định

HEAD: `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`; kiểm định phần thay đổi **chưa commit** so với HEAD, gồm cả tệp kiểm thử v280 chưa được Git theo dõi. Không sửa mã chức năng hay bài kiểm thử của dự án.

SHA-256 của bản đã kiểm tra, đường dẫn dưới `src/lib/playwright/` trừ dòng cuối:

| Tệp | SHA-256 |
| --- | --- |
| `lms-helpers.ts` | `dd71b31857736e0b82b88795423aeab2456d795f9d231456f977aead029d5d84` |
| `save-comments.ts` | `272e32722d6d681cd10aef7c098f94f55ddac4abdf977a10f56e83365487904b` |
| `spck-uploader.ts` | `8cf04e04e721c70a290f6a4b3e43b0feb14ad89a3c0f12a6e8f9c7d5692c6aa7` |
| `sync-class.ts` | `7df954bbe4dbd68cfefd9fd83c8b2eb513c33c288f4011e3bf9f3542aa2ba419` |
| `grade-worker.ts` | `796af2c1d97a2fead5129bc3472c5e2d79f665bcd72990ac3658778a38e8d371` |
| `scripts/test-lms-reliability-v280.ts` | `795e593c4b5623d3983855aedba10fe9f0828670f457346b6d95a55e9af9ecf8` |

## Phát hiện

### F01 — P1: Thử lại cả lỗi xảy ra sau khi đã bấm Lưu

- **Vị trí:** `src/lib/playwright/save-comments.ts:1361–1384`, `src/lib/playwright/spck-uploader.ts:1811–1857`. Điểm gửi lệnh/chờ phản hồi: Comments `909–1085`; SPCK `3373–3408`.
- **Nguyên nhân:** Bộ lọc chỉ xét chuỗi `Timeout ... exceeded`/`role="dialog"`, không ghi nhận thao tác đã đến bước gửi lệnh lưu hay chưa. Vì vậy mất phản hồi hoặc lỗi mở lại hộp thoại để đối chiếu sau lưu cũng bị xem là lỗi trước lưu. Các chuỗi loại trừ không chặn được lỗi Playwright chưa được bọc bằng thông báo Read-after-Write.
- **Tái hiện:** Chặn phản hồi sau lần bấm Save đầu. Comments gửi **2 lệnh lưu**, SPCK cũng gửi **2 lệnh lưu**; cả hai cuối cùng báo `VERIFIED=1`. Một ca Comments khác giữ nội dung hiển thị cục bộ sau lỗi mạng: lượt 2 đi vào nhánh `alreadySavedAndVerifiedInViewMode` (`798–807`), kết quả **`VERIFIED=1` dù không có phản hồi API lưu 200/201 nào**.
- **Ảnh hưởng / sửa tối thiểu:** Có thể gửi lặp hoặc báo đã lưu khi chỉ còn nội dung cục bộ. Ghi nhận giai đoạn xử lý; đánh dấu đã bắt đầu lưu **trước** khi gọi click. Chỉ cho lượt 2 chạy nếu chắc chắn chưa gửi lệnh lưu. Sau thời điểm đó, giữ trạng thái chưa xác minh và đối chiếu dữ liệu đã lưu, không tự gửi lại hoặc dùng nội dung cục bộ để bỏ qua yêu cầu xác nhận API.

### F02 — P1: Phục hồi thất bại vẫn tiếp tục lưu vào buổi khác

- **Vị trí:** `src/lib/playwright/lms-helpers.ts:468–495`; các nơi bỏ qua kết quả: `save-comments.ts:560–563,641–645,1397–1400`, `spck-uploader.ts:1850–1855,2573–2576,2606–2609`.
- **Nguyên nhân:** Hết ba lần kích hoạt vẫn trả về `isSlotActive=false`; lỗi chờ bảng cũng bị bỏ qua. Các nơi gọi không kiểm tra giá trị trả về. Một bảng đang hiển thị ở buổi khác vẫn được chấp nhận bởi selector chung.
- **Tái hiện:** Sau kiểm tra ban đầu, chuyển Buổi 1 sang `.inactive`, để Buổi 2 mở và cho ba lần bấm phục hồi Buổi 1 không có tác dụng. Luồng Comments vẫn lưu vào **Buổi 2**, trong khi yêu cầu và bản ghi cục bộ là **Buổi 1**; kết quả **`targetActive=false`, `actualSavedSlots=[2]`, `VERIFIED=1`**. Phản hồi giả lập dùng `slotId` dạng MongoDB mà bộ lọc hiện tại chấp nhận.
- **Ảnh hưởng / sửa tối thiểu:** Có thể lưu đúng học viên nhưng sai buổi rồi đánh dấu thành công. Helper phải báo lỗi nếu không xác nhận được buổi đích `.active` và bảng tương ứng đã sẵn sàng; nơi gọi phải dừng học viên đó. Không nuốt lỗi phục hồi trước khi ghi dữ liệu.

### F03 — P2: Dọn hộp thoại chưa chọn đúng hộp đang mở

- **Vị trí:** `src/lib/playwright/lms-helpers.ts:413–424`.
- **Nguyên nhân / tái hiện:** `.first()` có thể chọn một dialog ẩn trong khi dialog thứ hai đang mở: kiểm thử nhận **`Escape=0`, một dialog vẫn hiện**. Nếu Escape không đóng được dialog, selector nền `.MuiBackdrop-root, [role="presentation"] > div` lấy phần tử đầu toàn trang, không gắn với dialog đó. Trong fixture có nền Drawer đứng trước nền dialog, helper **đóng Drawer và để dialog còn mở**.
- **Ảnh hưởng / sửa tối thiểu:** Hộp thoại cũ tiếp tục cản lượt kế tiếp hoặc làm mất ngăn kéo lớp học. Chọn dialog thực sự hiển thị, lấy nền trong đúng vùng `.MuiDialog-root` của nó và xác nhận đã đóng; nếu vẫn mở thì trả lỗi rõ ràng. Ca bấm nhầm nền được chứng minh trên DOM giả lập, chưa xác nhận bố cục/lớp phủ này xuất hiện trên LMS thật.

### F04 — P2: Bộ kiểm thử mới bỏ sót các ranh giới nguy hiểm

- **Vị trí:** `scripts/test-lms-reliability-v280.ts:393–400,416–418,535–568` và danh sách import của tệp.
- **Vấn đề:** T280-03 làm slot rơi `.inactive` ngay sau lưu Homework; đoạn xử lý metadata cũ (`save-comments.ts:408–421`) đã bật lại trước vòng học viên. Ca này chưa chứng minh phục hồi **giữa hai học viên**. T280-04 kiểm tra Hash drift/ABSENT nhưng chưa đếm lượt thử; không kiểm tra âm cho lỗi sau Save, IN_FLIGHT_DRIFT, Read-after-Write, inactive roster và trùng tên. Tệp cũng không chạy các nhánh mới của SPCK, Grade Worker hay syncClass.
- **Sửa tối thiểu:** Thêm ca mất phản hồi sau Save với khẳng định không gửi lần hai/không VERIFIED giả; phục hồi thất bại phải có **0 lệnh lưu**; dialog ẩn/hiện đồng thời; slot rơi giữa hai học viên; mỗi nhánh phục hồi mới của SPCK/Grade Worker/syncClass; các trường hợp cấm thử lại phải đếm đúng số lần xử lý. Các kiểm thử hiện tại đều xanh nhưng vẫn để lọt F01–F03.

## Kiểm tra đã thực hiện

Tất cả bài dùng SQLite chạy **lần lượt**, với thư mục làm việc và `data/mindx_bot.db` riêng trong TEMP. Các phép thử bổ sung chạy mã thật với Chromium và phản hồi mạng giả lập; không đăng nhập hoặc ghi LMS thật.

| Lệnh / bộ kiểm tra | Kết quả cuối |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| `tsx scripts/test-lms-reliability-v280.ts` | PASS T280-01–04 |
| `tsx scripts/test-phase5.ts` | PASS |
| `tsx scripts/test-phase6.ts` | PASS |
| `tsx scripts/test-spck-v270.ts` | PASS T01–T16 |
| `tsx scripts/test-spck-v272.ts` | PASS V01–V16 |
| `tsx scripts/test-phase7.ts` | PASS |
| Hai script tái hiện độc lập | Xác nhận F01–F03 bằng các số liệu trên |
| `git diff --check` | PASS; chỉ có thông báo chuẩn hóa LF/CRLF |

Các lệnh `tsx` thực tế gọi CLI đã cài trong repo bằng đường dẫn tuyệt đối; có `--tsconfig` trỏ về repo khi cần. Lần chuẩn bị TEMP ban đầu thiếu ánh xạ import/tệp nguồn/tệp khởi chạy; đã bổ sung bản sao rồi chạy lại đạt. v270 cần khóa Gemini giả để đi qua bước kiểm tra cấu hình trong phần đã giả lập AI; không dùng khóa thật.

Mã tái hiện được giữ tại `C:\Users\QQ\AppData\Local\Temp\mindx-v280-review-f5d379da721e42dca9166758ff55b207\`: `v280-independent-probe.mts` và `v280-spck-postsave-probe.mts`. Chạy từ chính thư mục TEMP đó với CLI `tsx` của repo và `--tsconfig` của repo; không chạy các probe từ thư mục dữ liệu thật. Probe SPCK rút thời gian chờ phản hồi từ 30 giây xuống 1 giây, giữ nguyên các bước gửi/lưu/kiểm tra.

Chưa kiểm tra: LMS/Gemini/Drive/GitHub thật; build Next.js và nghiệm thu giao diện thủ công. Tuyên bố `7/7 VERIFIED` trên lớp thật trong CHANGELOG là bằng chứng được tài liệu ghi nhận, chưa được vòng review này xác minh lại. `sync-class.ts` kiểm tra `.active` đúng hướng; Grade Worker giữ các chốt định danh và đối chiếu dữ liệu, nhưng nhánh phục hồi mới chưa được bộ v280 kiểm thử trực tiếp.

Cần đóng F01–F03 và bổ sung kiểm thử F04 trước khi duyệt bản nâng cấp. Kết quả các bộ kiểm thử hiện có không đủ thay thế các điều kiện an toàn còn thiếu.

VERDICT: NO-GO
