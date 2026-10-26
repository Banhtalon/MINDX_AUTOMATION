# Yêu cầu sửa sau kiểm toán Vòng 17

Đọc `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md` và `docs/audits/round-17/REPORT.vi.md` trước khi sửa. Hiện tại NO-GO cấp mã nguồn cho Giai đoạn 5. Giữ phạm vi bốn lỗi dưới đây; không viết lại phần đã chạy đúng.

1. **R17-01 / P1 — bảo vệ nhận xét đã duyệt ở mọi nhánh AI.** Đưa kiểm tra trạng thái hiện hành APPROVED/VERIFIED trước cả nhánh thiếu dữ kiện và có dữ kiện trong `src/lib/gemini/comment-generator.ts`. Giữ nguyên nội dung/ba phần/hash/verifiedAt, trả kết quả bị bỏ qua, không gọi AI. Giữ kiểm tra `expectedRowVer >= 0` và lớp kiểm tra sau khi AI trả kết quả. Bản DRAFT hợp lệ vẫn sinh được nhận xét.
2. **R17-02 / P2 — phản hồi thiếu thông tin phải khớp nội dung được giữ.** Khi đã có bản nháp, phản hồi và màn hình/Copy phải giữ đúng nội dung cùng ba phần cũ; tách thông báo thiếu dữ kiện ra riêng. Không che mất khả năng đọc/sửa bản nháp đang có. Khi chưa có nội dung, vẫn báo thiếu dữ kiện và không gọi AI.
3. **R17-03 / P2 — bảo toàn bảng điểm đầy đủ ở nhánh GraphQL.** Kiểm tra toàn bộ roster gồm inactive trước khi ghi cache ở cả nhánh mạng và DOM. Phản hồi thiếu học viên phải trả thất bại, không ghi cache; dùng SQLite thật trong bộ nhớ kiểm tra cache cũ giữ nguyên, kèm ca đối chứng phản hồi đủ. Không dùng riêng số học viên active làm điều kiện đầy đủ.
4. **R17-04 / P2 — hiển thị đúng giá trị xung đột theo trường.** Với Quick Tags, lấy và định dạng `quickTagsJson` của bản đã lưu; không hiển thị attendanceStatus thay danh sách thẻ. Giữ bản chưa lưu trên màn hình, thông báo lỗi, GET đúng lớp/buổi/học viên và trả false; không tự gửi lại bản cũ.

Bổ sung các ca thiếu vào `scripts/test-phase4-codex-repros.ts`. Không sửa điều kiện của các kiểm thử độc lập để che lỗi. `docs/audits/round-17/verify-independent.mjs` có 38 ca cuối, trong đó 6 ca thuộc bốn nhóm trên đang trượt; dùng chúng làm bằng chứng đối chiếu. Với giao diện, chạy lại ứng dụng thật bằng dữ liệu giả để kiểm tra nút Copy và xung đột thẻ.

Trước khi thay đổi, kiểm tra các tệp chưa commit và tạo điểm khôi phục phù hợp. Không dùng tài khoản, dữ liệu học viên, hồ sơ đăng nhập thật hoặc gọi dịch vụ trả phí cho các ca này. Giữ nguyên từng byte `next-env.d.ts` và toàn bộ `docs/audits/round-12/` đến `round-17/`; chạy các script có ghi kết quả/build trên bản sao nguồn khớp byte và đặt bằng chứng mới trong một thư mục vòng tiếp theo.

Sau khi sửa, thực thi và lưu mã thoát/log thật cho:

```text
npx tsx scripts/test-phase4-codex-repros.ts
node docs/audits/round-12/verify-independent.mjs
node docs/audits/round-13/verify-independent.mjs
node docs/audits/round-16/verify-independent.mjs
npx tsc --noEmit --incremental false
npm run build
```

Đối chiếu lại 61 mã và bốn nhóm mới, báo phần đã đạt/chưa kiểm tra; chỉ đổi GO sau khi có bằng chứng cho đúng bản sửa. Không triển khai Giai đoạn 5 hoặc thay dữ liệu LMS thật trong yêu cầu sửa này.
