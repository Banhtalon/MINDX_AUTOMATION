# Giao sửa sau kiểm toán R19

Hãy sửa đúng 14 nhóm lỗi mở trong docs/audits/round-19/REPORT.vi.md, theo issue-status.json và tiêu chí Sau khi sửa của từng nhóm. Đọc AGENTS.md và MINDX_AUTOMATION_PLAN.md trước. Kiểm tra trạng thái hiện tại, tạo điểm khôi phục và giữ mọi thay đổi của Owner. Không coi đây là quyền dùng LMS/Gemini/dữ liệu thật.

Ưu tiên R19-07/08/09/10/11; tiếp R19-01/04/05/06/14; cuối R19-02/03/12/13. Sửa ít nhất có thể, không viết lại dự án. Giữ nguyên từng byte hồ sơ Round 12–19 và next-env.d.ts ở cây gốc. Tạo hồ sơ kiểm chứng vòng mới. Khi cần đổi bộ kiểm tra, sao chép sang vòng mới, giải thích lý do, không xóa/đổi yêu cầu để che lỗi.

Chạy lại 9 lệnh tại mục 3 của báo cáo trong bản sao cô lập, không mang .env, DB hoặc browser profile thật. 74 ca control hiện đạt và 186 nhóm cũ phải còn đạt; 20 ca lỗi phải được xử lý theo đúng điều kiện. Bản sửa phải kiểm tra định danh, barem, phiên bản file/bản duyệt, phản hồi đúng mutation, đọc lại cả điểm/quyết định/nhận xét và cập nhật VERIFIED có điều kiện. Không đoán tên mutation/ID DOM rồi tự tuyên bố nghiệm thu LMS thật.

Báo cáo tiếng Việt: đã sửa gì, file nào thay đổi, vì sao, bằng chứng từng mã, lệnh/mã thoát, giới hạn còn lại và GO/NO-GO. Cập nhật kế hoạch trung thực; không ghi nghiệm thu bằng dữ liệu thật nếu mới có dữ liệu giả.
