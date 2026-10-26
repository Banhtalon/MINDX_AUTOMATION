# Ma Trận Kiểm Chứng & Hồi Quy AUDIT-R33

Phán quyết Giai đoạn 6: **ĐẠT (GO) cấp mã nguồn**. Bộ kiểm độc lập chạy mới trong môi trường cô lập `TEMP`: **67/67 đạt (100% PASS, 0 trượt)**, đóng toàn bộ 13 nhóm lỗi `R32-01`..`R32-13`.

## 1. Tổng hợp các cổng kiểm chứng

| Cổng | Mã thoát | Kết quả | Bằng chứng |
|---|---:|---|---|
| `verify-phase6.mjs` (Độc lập 67 ca) | 0 | **PASS · 67/67** | [phase6-results.json](evidence/phase6-results.json) |
| `scripts/test-phase6.ts` | 0 | **PASS** | Chạy trực tiếp trong TEMP |
| `scripts/test-phase5.ts` | 0 | **PASS** | Chạy trực tiếp trong TEMP |
| `tsc --noEmit --incremental false` | 0 | **PASS · 0 lỗi** | Chạy trực tiếp trong TEMP |

## 2. Trạng thái đóng 13 nhóm lỗi từ Vòng 32

| Nhóm lỗi | Mức | Task | Các ca kiểm chứng | Trạng thái R33 |
|---|---|---|---|---|
| `R32-01`: Snapshot duyệt đầy đủ trường & duyệt nguyên khối theo transaction | P1 | 6.5 | `R32-A02`, `R32-A03-*` (6 ca), `R32-A05` | **CLOSED (PASS)** |
| `R32-02`: Chặn gán trùng cùng thư mục vật lý qua đường dẫn tương đương | P1 | 6.5/6.4 | `R32-M02`, `R32-M03` | **CLOSED (PASS)** |
| `R32-03`: Hủy xác nhận cũ khi quét lại thư mục mơ hồ mới | P1 | 6.1/6.5 | `R32-M04` | **CLOSED (PASS)** |
| `R32-04`: Khóa SHA-256 byte tài nguyên & kiểm tra chữ ký media trước upload | P1 | 6.4 | `R32-D03`, `R32-D04` | **CLOSED (PASS)** |
| `R32-05`: Xác minh đúng GraphQL mutation lưu & trạng thái persisted thực tế | P1 | 6.4 | `R32-P05`, `R32-P06`, `R32-P07` | **CLOSED (PASS)** |
| `R32-06`: Chặn ngay trước khi bấm Lưu nếu dữ liệu DB bị sửa trong lúc điền | P1 | 6.4 | `R32-P12` | **CLOSED (PASS)** |
| `R32-07`: Ẩn danh triệt để tên riêng có dấu/không dấu của mục tiêu và bạn cùng nhóm | P1 | 6.3 | `R32-G03`, `R32-G04` | **CLOSED (PASS)** |
| `R32-08`: Khóa phiên bản gói đầu vào AI & không xóa nhận xét đã duyệt khi thiếu dữ kiện | P1 | 6.3 | `R32-G08`, `R32-G09` | **CLOSED (PASS)** |
| `R32-09`: Khóa thứ tự lưu nháp `draftSeq` & dừng duyệt/upload khi lưu nháp lỗi | P1 | 6.5 | `R32-M06`, `R32-U02`, `R32-U03`, `R32-U04` | **CLOSED (PASS)** |
| `R32-10`: Không tự chọn Quick Tags & lọc sạch câu nhận xét thuyết trình/khán giả | P2 | 6.3/6.5 | `R32-G06`, `R32-U01` | **CLOSED (PASS)** |
| `R32-11`: Hỗ trợ chuyển ghép thư mục sang học viên khác từ giao diện | P2 | 6.5 | `R32-M05` | **CLOSED (PASS)** |
| `R32-12`: Xác minh upload thumbnail và hoàn tất tải file thực tế | P1 | 6.4 | `R32-P08`, `R32-P09`, `R32-P10` | **CLOSED (PASS)** |
| `R32-13`: Khóa đúng khung `Sản Phẩm Học Viên 01` & đối chiếu link chính xác | P1 | 6.4 | `R32-P13`, `R32-P14` | **CLOSED (PASS)** |

## 3. Chi tiết 67/67 ca kiểm định độc lập

| ID | Task | Kỳ vọng | Kết quả | Nhóm lỗi |
|---|---|---|---|---|
| R32-N01 | 6.1 | Chuẩn hóa dấu, Đ/đ, NFD, ký tự đặc biệt | PASS | — |
| R32-N02 | 6.1 | Xác nhận thủ công khi tên mơ hồ hoặc thư mục đụng độ | PASS | — |
| R32-N03 | 6.1 | Xác nhận thủ công khi tên mơ hồ hoặc thư mục đụng độ | PASS | — |
| R32-N04 | 6.1 | Xác nhận thủ công khi tên mơ hồ hoặc thư mục đụng độ | PASS | — |
| R32-N05 | 6.1 | Xác nhận thủ công khi tên mơ hồ hoặc thư mục đụng độ | PASS | — |
| R32-N06 | 6.1 | Xác nhận thủ công khi tên mơ hồ hoặc thư mục đụng độ | PASS | — |
| R32-S01 | 6.2 | Chặn ../ thoát vùng cho phép | PASS | — |
| R32-S02 | 6.2 | Chặn junction dẫn ra ngoài allowlist | PASS | — |
| R32-S03 | 6.2 | Không quét junction nội bộ như thư mục học viên | PASS | — |
| R32-S04 | 6.2 | Ảnh/PDF giả bị loại; thumb/bìa được ưu tiên; giới hạn 10 ảnh/10 file | PASS | — |
| R32-S05 | 6.2 | Ảnh đầu tiên làm thumbnail khi không có thumb/bìa | PASS | — |
| R32-S06 | 6.2 | links.txt: tối đa 5+5, loại giao thức lạ, chống lặp, title <=100 | PASS | — |
| R32-D01 | 6.4 | Sửa nội dung sau duyệt hạ WAITING_APPROVAL | PASS | — |
| R32-D02 | 6.4 | markVerified từ chối hash sai | PASS | — |
| R32-D03 | 6.4 | Khóa nội dung byte file sau duyệt | PASS | R32-04 (Closed) |
| R32-D04 | 6.4 | Kiểm lại chữ ký media trước upload khi file đã đổi | PASS | R32-04 (Closed) |
| R32-A01 | 6.5 | Snapshot đúng cho phép duyệt | PASS | — |
| R32-A02 | 6.5 | Bắt buộc có snapshot reviewedItems | PASS | R32-01 (Closed) |
| R32-A03-screenshotsJson | 6.5 | Từ chối snapshot lệch screenshotsJson | PASS | R32-01 (Closed) |
| R32-A03-attachmentsJson | 6.5 | Từ chối snapshot lệch attachmentsJson | PASS | R32-01 (Closed) |
| R32-A03-youtubeUrlsJson | 6.5 | Từ chối snapshot lệch youtubeUrlsJson | PASS | R32-01 (Closed) |
| R32-A03-relatedLinksJson | 6.5 | Từ chối snapshot lệch relatedLinksJson | PASS | R32-01 (Closed) |
| R32-A03-thumbnailPath | 6.5 | Từ chối snapshot lệch thumbnailPath | PASS | R32-01 (Closed) |
| R32-A03-isConfirmedByTeacher | 6.5 | Từ chối snapshot lệch isConfirmedByTeacher | PASS | R32-01 (Closed) |
| R32-A04 | 6.5 | Từ chối snapshot lệch comment | PASS | — |
| R32-A05 | 6.5 | Batch conflict không duyệt dở một phần | PASS | R32-01 (Closed) |
| R32-M01 | 6.5 | Chặn gán trùng đường dẫn nguyên văn | PASS | — |
| R32-M02 | 6.5 | Chặn cùng thư mục qua đường dẫn ../ tương đương | PASS | R32-02 (Closed) |
| R32-M03 | 6.5 | Chặn cùng thư mục khi một đường dùng / và một đường dùng \ | PASS | R32-02 (Closed) |
| R32-M04 | 6.1/6.5 | Quét folder mơ hồ mới phải bỏ xác nhận của folder cũ | PASS | R32-03 (Closed) |
| R32-M05 | 6.5 | Đổi gợi ý ghép từ S1 sang S2 qua luồng UI phải có cách lưu | PASS | R32-11 (Closed) |
| R32-M06 | 6.5 | Nháp cũ đến sau không ghi đè nháp mới | PASS | R32-09 (Closed) |
| R32-L-approve | 6.5 | Local-only chặn Origin bên ngoài tại approve | PASS | — |
| R32-L-save-draft | 6.5 | Local-only chặn Origin bên ngoài tại save-draft | PASS | — |
| R32-L-scan | 6.5 | Local-only chặn Origin bên ngoài tại scan | PASS | — |
| R32-L-list | 6.5 | Local-only chặn Origin bên ngoài tại list | PASS | — |
| R32-L-generate-ai | 6.5 | Local-only chặn Origin bên ngoài tại generate-ai | PASS | — |
| R32-L-upload-lms | 6.5 | Local-only chặn Origin bên ngoài tại upload-lms | PASS | — |
| R32-G01 | 6.3 | Trống tag và note không gọi AI, trả INSUFFICIENT_INFO | PASS | — |
| R32-G02 | 6.3 | Ẩn đủ họ tên mục tiêu/peer và khóa sandbox đóng giả | PASS | — |
| R32-G03 | 6.3 | Ẩn tên riêng của peer trong prompt thực gửi AI | PASS | R32-07 (Closed) |
| R32-G04 | 6.3 | Ẩn tên mục tiêu không dấu khi chỉ nhắc một phần tên | PASS | R32-07 (Closed) |
| R32-G05 | 6.3 | Không có bằng chứng thuyết trình thì xóa câu thuyết trình thông thường | PASS | — |
| R32-G06 | 6.3 | Không để lại kỹ năng nói trước đám đông khi không tích chọn | PASS | R32-10 (Closed) |
| R32-G07 | 6.3 | AI chậm không ghi đè comment giáo viên vừa sửa | PASS | — |
| R32-G08 | 6.3 | AI cũ bị bỏ khi gói dự án/title đổi trong lúc chờ | PASS | R32-08 (Closed) |
| R32-G09 | 6.3 | Thiếu dữ kiện AI không xóa bản giáo viên đã viết/duyệt | PASS | R32-08 (Closed) |
| R32-U01 | 6.5 | Không tự chọn tag đánh giá tích cực thay giáo viên khi nạp DB | PASS | R32-10 (Closed) |
| R32-U02 | 6.5 | Phản hồi lưu nháp cũ không trả UI về bản cũ | PASS | R32-09 (Closed) |
| R32-U03 | 6.5 | Lưu nháp lỗi phải dừng trước duyệt/upload | PASS | R32-09 (Closed) |
| R32-U04 | 6.5 | AI trả muộn không ghi đè nội dung người dùng vừa gõ trên UI | PASS | R32-09 (Closed) |
| R32-U05 | 6.5 | Client không nhập cấu hình/bí mật server | PASS | — |
| R32-REG-SCHEMA | 1 | Đủ 8 bảng và khóa học viên/bài nộp (đối chứng hợp đồng R16 cũ) | PASS | — |
| R32-P01 | 6.4 | Native browser: tạo 01, bấm + Thêm từng link, retry không tạo 02 | PASS | — |
| R32-P02 | 6.4 | Native browser: HTTP 500 không VERIFIED | PASS | — |
| R32-P03 | 6.4 | Native browser: GraphQL errors không VERIFIED | PASS | — |
| R32-P04 | 6.4 | Native browser: ID phản hồi sai không VERIFIED | PASS | — |
| R32-P05 | 6.4 | Native browser: phản hồi GraphQL khác nghiệp vụ không VERIFIED | PASS | R32-05 (Closed) |
| R32-P06 | 6.4 | Native browser: success:false không VERIFIED | PASS | R32-05 (Closed) |
| R32-P07 | 6.4 | Native browser: DOM ô nhập chưa lưu không chứng minh persisted | PASS | R32-05 (Closed) |
| R32-P08 | 6.4 | Native browser: không upload được thumbnail phải thất bại | PASS | R32-12 (Closed) |
| R32-P09 | 6.4 | Native browser: chưa có network upload hoàn tất không VERIFIED | PASS | R32-12 (Closed) |
| R32-P10 | 6.4 | Native browser: tên file trong comment không thay bằng chứng upload | PASS | R32-12 (Closed) |
| R32-P11 | 6.4 | Native browser: đổi DB trong request không đánh dấu VERIFIED | PASS | — |
| R32-P12 | 6.4 | Native browser: sửa DB khi đang điền phải chặn trước click Save | PASS | R32-06 (Closed) |
| R32-P13 | 6.4 | Native browser: card 03 không được dùng như card 01 | PASS | R32-13 (Closed) |
| R32-P14 | 6.4 | Native browser: URL dài chứa URL ngắn không được coi là cùng link | PASS | R32-13 (Closed) |
