# Giao việc sửa sau AUDIT-R38

Sửa đúng 12 nhóm trong REPORT.vi.md; không tự ký nghiệm thu. Đọc AGENTS.md và MINDX_AUTOMATION_PLAN.md, sao lưu thay đổi đang có trước khi sửa; giữ nguyên lịch sử audit.

Ưu tiên theo thứ tự:
1. **R38-01 (P1)** — Sau Lưu, đọc lại dữ liệu SPCK từ máy chủ hoặc mở lại khung từ dữ liệu vừa tải; đối chiếu đầy đủ tiêu đề, bình luận và danh sách đã lưu. Không dùng danh sách cục bộ vừa sửa làm bằng chứng.
2. **R38-02 (P1)** — Khóa phản hồi theo mutation đúng SPCK và variables đúng lớp/học viên; kiểm tra định danh kết quả hoặc lần đọc lại độc lập. Thiếu bằng chứng định danh phải từ chối.
3. **R38-03 (P1)** — Theo dõi upload thật của từng tài nguyên và mã file trả về, đợi mọi upload thành công trước bấm Lưu; phản hồi nền không được tính. Đối chiếu manifest đã lưu sau đó.
4. **R38-04 (P1)** — Giữ manifest phiên bản file/định danh server gắn với hash đã duyệt; file cùng tên nhưng khác nội dung phải thay thế. Nếu LMS không cung cấp bằng chứng đủ tin cậy, không đánh dấu VERIFIED.
5. **R38-05 (P1)** — Truyền tín hiệu hủy chung; kiểm tra trước học viên kế tiếp và trước các bước gây ghi dữ liệu. Học viên chưa chạy phải giữ nguyên, không ghi đè các bản đã VERIFIED.
6. **R38-06 (P2)** — Kiểm tra chữ ký và cấu trúc thực của từng loại gói; chặn hoặc cảnh báo bắt buộc xử lý trước duyệt. Không đánh đồng lỗi đọc file với bài làm kém.
7. **R38-07 (P2)** — Dùng chung kiểm tra new URL và chỉ nhận http:/https: ở phía server cho cả lưu, duyệt và upload; kiểm tra thêm hostname Youtube cho danh sách Youtube.
8. **R38-08 (P2)** — Áp dụng danh mục và kiểm tra kiểu file thống nhất ở mọi cửa vào, rồi kiểm tra lại trước upload.
9. **R38-09 (P2)** — Khởi tạo phiên bản từ server hoặc dùng định danh phiên chỉnh sửa cùng phiên bản bản ghi; staleIgnored phải báo xung đột/tải lại, không được coi như đã lưu sửa mới.
10. **R38-10 (P2)** — Khóa yêu cầu và kết quả bằng classId+studentId, bỏ kết quả khỏi UI khi đã đổi lớp; có thể khóa đổi lớp trong bước ghi nếu phù hợp trải nghiệm.
11. **R38-11 (P2)** — So phiên bản hoặc dấu kiểm tra toàn bộ đầu vào AI trước khi nhận kết quả. Nếu đã đổi dữ kiện, giữ sửa mới và yêu cầu soạn lại.
12. **R38-12 (P2)** — Đọc lịch sử theo classId+studentId xuyên các buổi, có chính sách lọc trạng thái hợp lệ; tổng hợp điểm/nhận xét từ đúng dữ liệu thay vì giả định chỉ buổi đầu.

Điều kiện đóng: giữ nguyên expectation của 41 ca R38 và bổ sung kiểm tra thực giao diện cho reload/đổi lớp/ghi chú AI; 41/41 PASS, 67/67 R32 tương thích PASS, Phase 6/5 PASS và TypeScript 0 lỗi. Xác nhận từng file được lưu đúng phiên bản/đúng học viên bằng lần đọc lại độc lập, không hạ tiêu chuẩn VERIFIED để làm xanh bài test.

Chỉ gọi LMS/Gemini thật khi Owner đã cho phép phạm vi chạy thật. Không đổi các ca giả thành nghiệm thu vận hành.
