# Kiểm định độc lập Student Portal v3.4.3 — Vòng 2

Ngày: 12/11/2026. **F01–F05: CLOSED.** Không còn phát hiện P0/P1/P2 mở trong phạm vi sửa lỗi được giao; đủ điều kiện nghiệm thu bản vá ở mức kiểm định cô lập.

## Đã làm

Đã đọc năm tệp được chỉ định, báo cáo Vòng 1, `PROJECT_STATE.md` và phần nối tiếp liên quan: tải lớp/buổi, dựng hàng học viên, trộn bài nộp, nút mở/đóng và tuyến xử lý Student Portal. **18/18 đoạn thay đổi trong patch khớp mã hiện tại**. Không sửa mã sản phẩm hoặc các bộ kiểm thử trong `scripts/`.

## Kết quả kiểm tra

| Cổng kiểm tra | Kết quả và bằng chứng |
|---|---|
| `npx --no-install tsc --noEmit --incremental false` | **PASS, exit 0** |
| `npx --no-install tsx scripts/test-spck-portal-idle-no-loop.ts` | **PASS PT-01…PT-09, exit 0** |
| Phát lại nguyên bản `_audit_refs/portal-adversarial.mjs` | **16/16 phép xác nhận đạt, exit 0** |
| Bộ mở rộng có tín hiệu hủy thật | **30/30 đạt, 0 lỗi, exit 0**: 16 ca phát lại với giả lập hỗ trợ hủy và 14 ca bổ sung |
| Chạy riêng phần S5a-T1/T2/T3 nguyên mẫu | **PASS, exit 0**; S5a-T3 kiểm tra đủ sáu hàm |

`--no-install` buộc dùng thư viện sẵn có, không tải/cài thêm. Cảnh báo `stripTypeScriptTypes` là tính năng thực nghiệm của Node, không làm hai cổng liên quan thất bại.

## Trạng thái F01–F05

| Mã | Kết luận | Bằng chứng đóng lỗi |
|---|---|---|
| **F01 — P1** | **CLOSED** | Khóa thứ tự thao tác, đối chiếu lớp hiện tại và kiểm tra buổi trước khi nạp hàng tại `src/components/final-project/useSpckWorkflow.ts` (`L479`, `L1590–1806`). P06/P07 và R2-01…04/R2-14 đạt: phản hồi mở/đóng cũ không thay hàng, thư mục hay trạng thái của lớp mới; phản hồi đóng cũ không tắt giao diện sau khi lớp mới đã mở cổng. Giữ đúng hàng Buổi 14 sau phản hồi đóng Buổi 13; nạp đúng Buổi 12 và danh sách học viên mới nhất. |
| **F02 — P1** | **CLOSED** | Nhánh đóng tại `src/components/final-project/useSpckWorkflow.ts` (`L1704`, `L1737–1796`), yêu cầu phản hồi thành công xác nhận cổng tắt. P08/P09 và R2-05…08 đạt: HTTP 500, mất kết nối, nội dung phản hồi hỏng, phản hồi vẫn ON và hết hạn chờ khoảng **6.004 giây** đều giữ ON, giữ lịch hỏi và hiện lỗi. Nhịp kiểm tra tiếp theo vẫn phát hiện OFF thực tế; đóng bình thường dừng lịch hỏi. |
| **F03 — P2** | **CLOSED** | Khóa yêu cầu theo lớp/buổi, đếm bên đang dùng và hủy khi không còn bên dùng tại `src/components/final-project/useSpckWorkflow.ts` (`L2949`, `L2967–3047`). P04/P13 và R2-12 đạt: đổi nhanh 13→12→14→13→12→13 hủy năm yêu cầu cũ; mỗi lần chỉ còn một yêu cầu chưa xong, không chồng cùng mục. |
| **F04 — P2** | **CLOSED** | Hạn chờ **3000 ms** bao trùm cả nhận phản hồi và đọc nội dung tại `src/components/final-project/useSpckWorkflow.ts` (`L2965`, `L3000–3037`). R2-09 dùng `fetch` thật của Chromium, giữ yêu cầu bằng Playwright và quan sát trình duyệt báo yêu cầu đã hủy. R2-10 kiểm tra treo lúc đọc nội dung. R2-11 dùng đồng hồ thật: hủy sau **3003.7 ms**, lần hỏi tiếp theo cách lần trước **3501.8 ms**, nhận OFF, dừng lịch hỏi; tối đa một GET đang chờ. R2-13 xác nhận phản hồi cũ đến sau hạn chờ không xóa khóa mới hoặc ghi đè kết quả mới. |
| **F05 — bộ kiểm thử** | **CLOSED** | Đã có lệnh nạp bộ hàm thật tại `scripts/test-streamline-v340-s5a.ts` (`L26`). Chạy nguyên phần S5a-T3 trong `node:vm` thành công, đủ sáu hàm; PT-09 cũng đạt. Năm trạng thái đầu vẫn là `classes`, `selectedClassId`, `students`, `folderPathInput`, `rows`; `page.tsx` không gọi `useRef` và giữ nguyên mốc cắt trước phần giao diện. |

Các ca còn xác nhận: OFF chỉ kiểm tra một lần cho mục đang chọn; sửa đường dẫn/mở chi tiết không tạo vòng lặp; ON hỏi đúng nhịp 3,5 giây; giữ nhận xét/thẻ đang sửa và hạ xác nhận khi máy chủ yêu cầu.

## Bảo toàn và phạm vi

**183/183 tệp ban đầu giữ nguyên SHA-256**, gồm `src`, `scripts`, `data`, cấu hình/tài liệu gốc và các tệp đầu vào kiểm định. Chỉ tạo bằng chứng/công cụ trong `_audit_refs/`. Đã kiểm tra `node_modules` là thư mục riêng và không có liên kết ra ngoài; thư mục tạm, hồ sơ trình duyệt và cache của các lệnh kiểm tra nằm trong workspace. Không truy cập kho dự án bên ngoài, không dùng dữ liệu/dịch vụ thật; chỉ dùng Node/Chromium hệ thống theo ngoại lệ cho phép.

VERDICT: GO
