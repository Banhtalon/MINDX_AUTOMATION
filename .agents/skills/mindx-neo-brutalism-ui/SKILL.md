---
name: mindx-neo-brutalism-ui
description: >-
  Hệ chuẩn Thiết kế Neo-Brutalism MindX & Chống Chữ Rác (Antigravity Design Guardrails):
  kết hợp bố cục Trang 1 MindX với tinh thần Anti-Slop Copy (Leonxlnx/taste-skill)
  và Neubrutalism UI/UX Pro Max (nextlevelbuilder/ui-ux-pro-max-skill) — viền mực đen 2px,
  bóng cứng lệch góc 0px blur, tối đa 2 tầng lồng khung, ẩn nội dung phụ sau 1 dòng bấm mở,
  và đạt chuẩn tương phản WCAG AA >= 4.5:1 ở cả Chế độ Sáng lẫn Chế độ Tối.
---

# MindX Neo-Brutalism UI & Decluttering Standard (`v3.9.0`)

## 1. Triết lý Cốt lõi (Page 1 Benchmark + Taste Skill + UI/UX Pro Max)
Mọi màn hình trong MindX Automation Bot phải cho cảm giác **gọn, rõ, sắc nét và dứt khoát ngay từ cái nhìn đầu tiên**:
- **Dữ liệu và Nút hành động chiếm vị trí trung tâm:** Giáo viên mở trang ra là thấy ngay **Chọn lớp -> Trạng thái / Bảng học viên -> Nút bấm hành động chính** trong màn hình đầu tiên, không phải cuộn qua nhiều đoạn văn hướng dẫn.
- **Mỗi màn hình chỉ có 1 điểm nhấn thị giác rõ ràng:** Màu sắc phục vụ phân loại trạng thái nghiệp vụ (Chờ làm, Đã xong, Lỗi, Cảnh báo), không tô nền lòe loẹt hay viền phát sáng mờ.

## 2. Hệ Hình học & Màu sắc Neo-Brutalism (Neubrutalism #38)
- **Viền & Bóng cứng (`0px blur`):**
  - Thẻ / Khối nội dung (`.neo-section-card`, `.neo-ws-card`, `.neo-group-box`): `border: 2px solid #0f172a`, `box-shadow: 3px 3px 0px #0f172a` hoặc `4px 4px 0px #0f172a`.
  - Nút bấm, ô chọn, thanh tìm kiếm (`.neo-btn-*`, `.neo-select`, `.neo-input`, `.neo-search-box`): `border: 2px solid #0f172a`, `box-shadow: 2px 2px 0px #0f172a`.
  - Phản hồi nhấn cơ học: rê chuột dịch `translate(-1px, -1px)` và tăng bóng `3px 3px 0`; khi bấm dịch `translate(1px, 1px)` và hạ bóng `1px 1px 0`.
  - Thanh nhấn màu bên trái (`6px`–`7px` solid) cho thẻ phân khu (`.neo-ws-amber/blue/emerald/purple/indigo`).
- **Phân cấp Nút & Tab:**
  - **Tab đang chọn & CTA Vàng (`.neo-btn-yellow`, `.neo-tab-btn-active`, `.mindx-nav-link-active`):** Nền Vàng tươi `#facc15`, chữ `#0f172a`, viền `2px solid #0f172a`.
  - **Hành động chính quy trình (`.neo-btn-blue`):** Nền Xanh `#2563eb`, chữ `#ffffff`.
  - **Xác nhận / Hoàn thành (`.neo-btn-emerald`):** Nền Xanh lá đậm `#15803d`, chữ `#ffffff`.
  - **Trung tính / Phụ (`.neo-btn-neutral`):** Nền `#e2e8f0`, chữ `#0f172a`.
- **Đối ứng Chế độ Tối (`html[data-theme="dark"]` — Bắt buộc WCAG AA `>= 4.5:1`):**
  - Nền trang `#0b1224`; bề mặt thẻ `#141f38` / `#16223d`; ô nhập `#0b1324`; chữ chính `#f8fafc`; chữ phụ `#cbd5e1`.
  - Viền thẻ `2px solid #475569` (hoặc màu nhấn `#38bdf8`/`#f59e0b`/`#10b981`) kèm bóng cứng `3px 3px 0px #020617` (`0px blur`).
  - Nút Vàng `#facc15` giữ nguyên chữ `#0f172a` trong cả Light & Dark để bảo đảm tương phản vượt `>= 10:1`.
  - Thẻ `.mindx-hero` luôn khai báo `background-color` đặc tường minh để bộ đo tương phản tự động và trình duyệt đọc chuẩn.

## 3. Quy tắc Chống Chữ Rác & Tối giản Không gian (`Leonxlnx/taste-skill`)
1. **Cấm dòng giải thích phụ (`0 caption bloat`):**
   - KHÔNG đặt đoạn `<p>` giải thích dài dưới tiêu đề trang (`h1`), tiêu đề khối (`h2`/`h3`), bên dưới con số KPI, hoặc bên dưới/cạnh nút bấm.
   - Nếu cần ghi chú hướng dẫn cách dùng cho giáo viên mới, đưa vào thuộc tính `title="..."` (tooltip khi rê chuột).
2. **Tối đa 2 tầng khung lồng nhau (`Max 2-level nesting`):**
   - Dùng `Thẻ mục > Bảng / Hàng dữ liệu`. Tuyệt đối tránh lồng hộp giải thích bên trong hộp cấu hình bên trong thẻ.
3. **Nhãn nút "Động từ + Đối tượng" (2–4 chữ):**
   - Đúng: `🔄 Đồng bộ`, `✅ Duyệt & Đẩy`, `📸 Ảnh BTVN`, `📋 Copy Sheets`, `⚡ Đồng bộ tất cả lớp`.
   - Tránh: `"⚡ Quét & Đồng bộ tất cả lớp đang dạy lên Teaching (chỉ quét những lớp có điểm mới)"`.
4. **Progressive Disclosure (Ẩn phụ theo 1 lần bấm):**
   - Nội dung giáo trình chi tiết từng buổi, ghi chú quy chế Checkpoint hay công cụ ít dùng phải mặc định **thu gọn** trong `<details>` hoặc ngăn kéo 1 dòng (`.neo-details-bar`) để danh sách học sinh hiện ngay lên trên cùng màn hình.
5. **Một dòng điều hướng trên mọi màn hình (`1280px+`):**
   - Thanh `TopNavbar` giữ tất cả mục trên đúng `1` hàng ngang (`height <= 60px`), không tràn ngang (`scrollWidth <= innerWidth + 1`).

## 4. MindX Workspace Note
- Quy tắc tại `AGENTS.md` và `GEMINI.md` luôn có mức ưu tiên cao nhất:
  - **Không bao giờ rút gọn nội dung đầu ra nghiệp vụ:** Giữ nguyên 100% chuẩn Nhận xét Học sinh 3 gạch đầu dòng (`.agents/skills/nhan-xet-hoc-sinh`) và Thông báo Zalo 6 mục + Phần 2 BTVN (`.agents/skills/nhan-xet-hoc-sinh-zalo`).
  - Bảo toàn tuyệt đối logic chấm điểm, quy tắc LEGO/Robotics/Coding, Playwright single Persistent Context + Read-after-Write, bảo mật `127.0.0.1` + Path Allowlist, và không bao giờ đưa biến môi trường nhạy cảm vào `'use client'`.
  - Khi báo cáo cho Owner, luôn trình bày ngắn gọn bằng tiếng Việt đời thường, tránh thuật ngữ lập trình phức tạp.
