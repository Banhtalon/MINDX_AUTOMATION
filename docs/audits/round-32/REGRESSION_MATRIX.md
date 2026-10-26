# Ma trận kiểm chứng AUDIT-R32

Phán quyết Giai đoạn 6: **NO-GO cấp mã nguồn**. Lượt độc lập cuối: **34/67 đạt, 33 trượt**, thuộc 13 nhóm lỗi. Kết quả dưới đây đều chạy mới trong TEMP; giữ nguyên raw FAIL của R16. Không cộng trùng các bộ lịch sử thành tổng nghiệm thu.

| Cổng | Lượt | Mã thoát | Kết quả | Bằng chứng |
|---|---:|---:|---|---|
| independent | 3 | 1 | FAIL · 34/67 | [log](evidence/independent.attempt-3.log) / [JSON](evidence/independent.attempt-3-results.json) |
| phase6 | 2 | 0 | PASS | [log](evidence/phase6.attempt-2.log) |
| phase5 | 2 | 0 | PASS | [log](evidence/phase5.attempt-2.log) |
| phase4 | 2 | 0 | PASS | [log](evidence/phase4.attempt-2.log) |
| r12 | 2 | 0 | PASS · 43/43 | [log](evidence/r12.attempt-2.log) / [JSON](evidence/r12.attempt-2-results.json) |
| r13 | 2 | 0 | PASS · 89/89 | [log](evidence/r13.attempt-2.log) / [JSON](evidence/r13.attempt-2-results.json) |
| r16 | 2 | 1 | FAIL · 15/16 · hợp đồng cũ 7 bảng, hiện có 8 | [log](evidence/r16.attempt-2.log) / [JSON](evidence/r16.attempt-2-results.json) |
| r17 | 2 | 0 | PASS · 38/38 | [log](evidence/r17.attempt-2.log) / [JSON](evidence/r17.attempt-2-results.json) |
| r31 | 2 | 0 | PASS · 819/819 | [log](evidence/r31.attempt-2.log) / [JSON](evidence/r31.attempt-2-results.json) |
| typecheck-before | 2 | 0 | PASS | [log](evidence/typecheck-before.attempt-2.log) |
| build | 2 | 0 | PASS · 28/28 trang | [log](evidence/build.attempt-2.log) |
| typecheck-after | 2 | 0 | PASS | [log](evidence/typecheck-after.attempt-2.log) |

Đối chứng `R32-REG-SCHEMA` đạt: đủ tám bảng hiện tại, học viên thuộc đúng lớp và cấm đổi chủ bài nộp. Không đổi R16 thành PASS. Lượt preload lỗi và JSON lịch sử không dùng kết luận; xem [nhật ký](evidence/harness-development-notes.md) và [commands.json](evidence/commands.json).

| Nhiệm vụ | Bằng chứng tốt | Giới hạn/lỗi mở |
|---|---|---|
| TASK-6.1 | N01..N06: chuẩn hóa, mơ hồ, trùng tên, đụng độ | R32-03: API quét tái dùng xác nhận cũ |
| TASK-6.2 | S01..S06: allowlist/junction, ảnh/PDF giả, thumb/ảnh đầu, 10+10, 5+5, title 100 | R32-04: file đổi sau bước quét không bị khóa byte |
| TASK-6.3 | G01/G02/G05/G07: thiếu dữ kiện, đầy đủ họ tên, sandbox, chống comment cũ | R32-07/08/10 |
| TASK-6.4 | D01/D02, P01..P04/P11: hash trường, queue, retry/link, chặn lỗi rõ | R32-02/04/05/06/12/13 |
| TASK-6.5 | A01/A04, M01, L-*, U05: snapshot một phần, chặn trùng nguyên văn, local-only, Client | R32-01/02/03/09/10/11 |
| Giai đoạn 1–5 | R12/R13/R17/R31, Phase 4/5, tsc, build | R16 cũ 15/16, đối chứng schema mới đạt; chưa nghiệm thu vận hành thật |

| Nhóm lỗi | Mức | Task | Ca trượt | Trạng thái |
|---|---|---|---|---|
| R32-01: Snapshot duyệt thiếu trường/không bắt buộc; batch ghi dở dang | P1 | 6.5 | R32-A02, R32-A03-screenshotsJson, R32-A03-attachmentsJson, R32-A03-youtubeUrlsJson, R32-A03-relatedLinksJson, R32-A03-thumbnailPath, R32-A03-isConfirmedByTeacher, R32-A05 | OPEN |
| R32-02: Cùng thư mục có thể gán hai học viên qua alias đường dẫn | P1 | 6.5/6.4 | R32-M02, R32-M03 | OPEN |
| R32-03: Xác nhận folder cũ được giữ cho folder mơ hồ mới | P1 | 6.1/6.5 | R32-M04 | OPEN |
| R32-04: Hash chưa khóa byte tài nguyên; không kiểm lại media | P1 | 6.4 | R32-D03, R32-D04 | OPEN |
| R32-05: Phản hồi không đúng nghiệp vụ và DOM chưa persisted vẫn VERIFIED | P1 | 6.4 | R32-P05, R32-P06, R32-P07 | OPEN |
| R32-06: Không chặn thay đổi trước Save; chỉ phát hiện sau ghi | P1 | 6.4 | R32-P12 | OPEN |
| R32-07: Tên riêng mục tiêu/peer lọt vào prompt | P1 | 6.3 | R32-G03, R32-G04 | OPEN |
| R32-08: AI không khóa toàn phiên bản; nhánh thiếu dữ kiện xóa nhận xét | P1 | 6.3 | R32-G08, R32-G09 | OPEN |
| R32-09: Nháp/API/UI về sai thứ tự; lưu lỗi vẫn gọi duyệt/upload | P1 | 6.5 | R32-M06, R32-U02, R32-U03, R32-U04 | OPEN |
| R32-10: Tự chọn tags tích cực; lọt diễn đạt kỹ năng thuyết trình | P2 | 6.3/6.5 | R32-G06, R32-U01 | OPEN |
| R32-11: Thiếu luồng chuyển ghép khỏi học viên cũ | P2 | 6.5 | R32-M05 | OPEN |
| R32-12: Thiếu xác minh thumbnail và upload hoàn tất | P1 | 6.4 | R32-P08, R32-P09, R32-P10 | OPEN |
| R32-13: Selector card quá rộng và kiểm link bằng chuỗi con | P1 | 6.4 | R32-P13, R32-P14 | OPEN |

67 ca của bộ kiểm độc lập cuối, giữ đủ ID và tiêu chí:

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
| R32-D03 | 6.4 | Khóa nội dung byte file sau duyệt | FAIL | R32-04 |
| R32-D04 | 6.4 | Kiểm lại chữ ký media trước upload khi file đã đổi | FAIL | R32-04 |
| R32-A01 | 6.5 | Snapshot đúng cho phép duyệt | PASS | — |
| R32-A02 | 6.5 | Bắt buộc có snapshot reviewedItems | FAIL | R32-01 |
| R32-A03-screenshotsJson | 6.5 | Từ chối snapshot lệch screenshotsJson | FAIL | R32-01 |
| R32-A03-attachmentsJson | 6.5 | Từ chối snapshot lệch attachmentsJson | FAIL | R32-01 |
| R32-A03-youtubeUrlsJson | 6.5 | Từ chối snapshot lệch youtubeUrlsJson | FAIL | R32-01 |
| R32-A03-relatedLinksJson | 6.5 | Từ chối snapshot lệch relatedLinksJson | FAIL | R32-01 |
| R32-A03-thumbnailPath | 6.5 | Từ chối snapshot lệch thumbnailPath | FAIL | R32-01 |
| R32-A03-isConfirmedByTeacher | 6.5 | Từ chối snapshot lệch isConfirmedByTeacher | FAIL | R32-01 |
| R32-A04 | 6.5 | Từ chối snapshot lệch comment | PASS | — |
| R32-A05 | 6.5 | Batch conflict không duyệt dở một phần | FAIL | R32-01 |
| R32-M01 | 6.5 | Chặn gán trùng đường dẫn nguyên văn | PASS | — |
| R32-M02 | 6.5 | Chặn cùng thư mục qua đường dẫn ../ tương đương | FAIL | R32-02 |
| R32-M03 | 6.5 | Chặn cùng thư mục khi một đường dùng / và một đường dùng \ | FAIL | R32-02 |
| R32-M04 | 6.1/6.5 | Quét folder mơ hồ mới phải bỏ xác nhận của folder cũ | FAIL | R32-03 |
| R32-M05 | 6.5 | Đổi gợi ý ghép từ S1 sang S2 qua luồng UI phải có cách lưu | FAIL | R32-11 |
| R32-M06 | 6.5 | Nháp cũ đến sau không ghi đè nháp mới | FAIL | R32-09 |
| R32-L-approve | 6.5 | Local-only chặn Origin bên ngoài tại approve | PASS | — |
| R32-L-save-draft | 6.5 | Local-only chặn Origin bên ngoài tại save-draft | PASS | — |
| R32-L-scan | 6.5 | Local-only chặn Origin bên ngoài tại scan | PASS | — |
| R32-L-list | 6.5 | Local-only chặn Origin bên ngoài tại list | PASS | — |
| R32-L-generate-ai | 6.5 | Local-only chặn Origin bên ngoài tại generate-ai | PASS | — |
| R32-L-upload-lms | 6.5 | Local-only chặn Origin bên ngoài tại upload-lms | PASS | — |
| R32-G01 | 6.3 | Trống tag và note không gọi AI, trả INSUFFICIENT_INFO | PASS | — |
| R32-G02 | 6.3 | Ẩn đủ họ tên mục tiêu/peer và khóa sandbox đóng giả | PASS | — |
| R32-G03 | 6.3 | Ẩn tên riêng của peer trong prompt thực gửi AI | FAIL | R32-07 |
| R32-G04 | 6.3 | Ẩn tên mục tiêu không dấu khi chỉ nhắc một phần tên | FAIL | R32-07 |
| R32-G05 | 6.3 | Không có bằng chứng thuyết trình thì xóa câu thuyết trình thông thường | PASS | — |
| R32-G06 | 6.3 | Không để lại kỹ năng nói trước đám đông khi không tích chọn | FAIL | R32-10 |
| R32-G07 | 6.3 | AI chậm không ghi đè comment giáo viên vừa sửa | PASS | — |
| R32-G08 | 6.3 | AI cũ bị bỏ khi gói dự án/title đổi trong lúc chờ | FAIL | R32-08 |
| R32-G09 | 6.3 | Thiếu dữ kiện AI không xóa bản giáo viên đã viết/duyệt | FAIL | R32-08 |
| R32-U01 | 6.5 | Không tự chọn tag đánh giá tích cực thay giáo viên khi nạp DB | FAIL | R32-10 |
| R32-U02 | 6.5 | Phản hồi lưu nháp cũ không trả UI về bản cũ | FAIL | R32-09 |
| R32-U03 | 6.5 | Lưu nháp lỗi phải dừng trước duyệt/upload | FAIL | R32-09 |
| R32-U04 | 6.5 | AI trả muộn không ghi đè nội dung người dùng vừa gõ trên UI | FAIL | R32-09 |
| R32-U05 | 6.5 | Client không nhập cấu hình/bí mật server | PASS | — |
| R32-REG-SCHEMA | 1 | Đủ 8 bảng và khóa học viên/bài nộp (đối chứng hợp đồng R16 cũ) | PASS | — |
| R32-P01 | 6.4 | Native browser: tạo 01, bấm + Thêm từng link, retry không tạo 02 | PASS | — |
| R32-P02 | 6.4 | Native browser: HTTP 500 không VERIFIED | PASS | — |
| R32-P03 | 6.4 | Native browser: GraphQL errors không VERIFIED | PASS | — |
| R32-P04 | 6.4 | Native browser: ID phản hồi sai không VERIFIED | PASS | — |
| R32-P05 | 6.4 | Native browser: phản hồi GraphQL khác nghiệp vụ không VERIFIED | FAIL | R32-05 |
| R32-P06 | 6.4 | Native browser: success:false không VERIFIED | FAIL | R32-05 |
| R32-P07 | 6.4 | Native browser: DOM ô nhập chưa lưu không chứng minh persisted | FAIL | R32-05 |
| R32-P08 | 6.4 | Native browser: không upload được thumbnail phải thất bại | FAIL | R32-12 |
| R32-P09 | 6.4 | Native browser: chưa có network upload hoàn tất không VERIFIED | FAIL | R32-12 |
| R32-P10 | 6.4 | Native browser: tên file trong comment không thay bằng chứng upload | FAIL | R32-12 |
| R32-P11 | 6.4 | Native browser: đổi DB trong request không đánh dấu VERIFIED | PASS | — |
| R32-P12 | 6.4 | Native browser: sửa DB khi đang điền phải chặn trước click Save | FAIL | R32-06 |
| R32-P13 | 6.4 | Native browser: card 03 không được dùng như card 01 | FAIL | R32-13 |
| R32-P14 | 6.4 | Native browser: URL dài chứa URL ngắn không được coi là cùng link | FAIL | R32-13 |

Scanner/SQLite/API/uploader nạp module sản phẩm trực tiếp. AI dùng thân mã thật với Gemini giả; UI dùng thân hàm trước JSX với hook điều khiển được, chưa phải trình duyệt React thật. Chromium chỉ dùng trang/request giả; không nghiệm thu LMS/Gemini thật. Chi tiết từng quan sát ở [phase6-results.json](evidence/phase6-results.json), [browser-scenarios.json](evidence/browser-scenarios.json).
