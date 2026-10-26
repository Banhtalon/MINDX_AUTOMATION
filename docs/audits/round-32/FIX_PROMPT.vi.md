# Prompt sửa sau AUDIT-R32

**Kết luận hiện tại: NO-GO cấp mã nguồn Giai đoạn 6.** Có 13 nhóm lỗi mở, 33 ca trượt/67 ca độc lập. Đây là prompt giao cho **lượt sửa riêng**; kiểm toán R32 không sửa sản phẩm.

---

Hãy sửa đúng 13 nhóm lỗi AUDIT-R32 trong dự án MINDX-AUTOMATION. Đọc `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, `docs/audits/round-32/REPORT.vi.md`, `REGRESSION_MATRIX.md` và `evidence/phase6-results.json` trước khi sửa. Giữ nguyên ID, tiêu chí và kỳ vọng bộ kiểm độc lập; không sửa test để che lỗi. Không suy ra hoàn thành từ checkbox đang có.

Làm việc bằng tiếng Việt, giải thích ngắn gọn cho Owner. Tự đọc/sửa/chạy kiểm tra; Owner không phải chạy Terminal hay cung cấp mật khẩu trong chat. Ưu tiên thay đổi nhỏ phù hợp luồng hiện tại. Trước sửa, ghi Git status và tạo điểm khôi phục cho file liên quan, giữ nguyên mọi thay đổi đang có của Owner. Không dùng reset/clean hoặc ghi đè toàn bộ checkout.

Không sửa hồ sơ `docs/audits/round-12..round-32`, không sửa `next-env.d.ts` tại workspace chính. Dấu SHA-256 cần giữ: `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`. Hồ sơ sửa/kiểm mới ghi vào thư mục mới. Không đọc `.env.local`, dùng tài khoản/DB/bài nộp/phiên đăng nhập thật, hoặc ghi LMS thật. Mọi test, SQLite giả, TypeScript và build chạy trong bản sao vật lý TEMP đường dẫn ngắn; `ESBUILD_BINARY_PATH` dùng bản sao `esbuild.exe` ở TEMP ngắn. Không dùng junction về workspace và không kế thừa mật khẩu/khóa từ môi trường. Nếu cần thay đổi lược đồ SQLite, phải giữ dữ liệu cũ và có kiểm tra nâng cấp bằng dữ liệu giả.

Sửa theo thứ tự ưu tiên dưới đây. Các file ghi theo vị trí nguồn R32; kiểm lại vị trí hiện tại trước sửa.

1. **R32-01 / P1 — Khóa đầy đủ bản đã xem.** Ở API `spck/approve` và payload `reviewedItems` của `final-project/page.tsx`, bắt buộc snapshot của toàn bộ trường duyệt: học viên/lớp, thư mục, xác nhận ghép, tiêu đề, thumbnail, ảnh, tài liệu, YouTube, link liên quan gồm tên+URL, nhận xét, phiên bản tài nguyên. Kiểm đủ cả batch trước khi ghi; ghi nguyên khối trong giao dịch. Thiếu/lệch snapshot phải 400/409 và không duyệt dở dang. Giữ đối chứng snapshot đúng đạt. Các ca: A02, A03-*, A05.

2. **R32-02, R32-03, R32-11 — Ghép thư mục an toàn và sửa được gợi ý sai.** Chuẩn hóa đường dẫn thật nhất quán sau allowlist, gồm dấu phân cách, `..`, khác hoa/thường trên Windows. Dùng cùng khóa ở scan/save-draft/approve/uploader, chống cùng thư mục cho nhiều học viên. Xác nhận giáo viên chỉ có hiệu lực cho đúng cặp học viên–thư mục; folder mới/mơ hồ phải bỏ xác nhận cũ. Hoàn thiện luồng chuyển ghép S1→S2 từ dropdown bằng một giao dịch có đối chiếu chủ cũ, bỏ duyệt/hash cũ, chỉ giữ một chủ thư mục. Không giải quyết bằng bỏ kiểm trùng hoặc cho phép cướp thư mục. Các ca: M01..M05; M01 phải tiếp tục chặn trùng.

3. **R32-04 / P1 — Khóa byte file đã duyệt.** Bổ sung manifest SHA-256 nội dung các tài nguyên, không chỉ hash chuỗi đường dẫn. Kiểm allowlist, file/định dạng media và dấu vân tay tại duyệt, trước upload và trước Save. Byte đổi sau duyệt phải WAITING_APPROVAL, không gửi file mới. Không đọc file quá mức cần thiết hoặc vượt allowlist. Giữ tương thích dữ liệu cũ bằng yêu cầu duyệt lại bản chưa có manifest. Các ca: D03/D04; D01/D02 vẫn đạt.

4. **R32-05 / P1 — Đúng yêu cầu lưu, đúng phản hồi và đọc lại dữ liệu đã lưu.** Thay predicate URL rộng của uploader bằng kiểm đúng nghiệp vụ, method, lớp/học viên và nội dung bản duyệt. Yêu cầu HTTP 200/201 và kết quả lưu có ý nghĩa thành công; thiếu payload lưu, mutation khác, `success:false`, rejected, lỗi GraphQL, ID sai không được VERIFIED. Không đoán schema thật hoặc hardcode theo test giả; tận dụng cách kiểm nghiệp vụ đã có ở Phase 5 và ghi rõ phần schema chưa xác nhận. Sau lưu phải mở/đọc lại bản persisted và so đủ bản duyệt; không kiểm chính các ô input vừa fill. Các ca: P05..P07; P02..P04 vẫn phải chặn lỗi.

5. **R32-06 / P1 — Chặn thay đổi ngay trước Save.** Kiểm lại trạng thái APPROVED, cặp ghép, hash và manifest sau khi điền xong, sát trước click Save. Có thay đổi phải dừng, không chỉ chặn cập nhật VERIFIED ở cuối. P12 phải có **0 yêu cầu lưu**; P11 tiếp tục không VERIFIED khi thay đổi trong request.

6. **R32-12 / P1 — Xác nhận tài nguyên upload thật.** Thiếu control thumbnail/file bắt buộc phải báo lỗi. Chờ đúng phản hồi upload và trạng thái hoàn tất trước Save. Tên file chỉ hiện trong UI hay trong nhận xét không phải bằng chứng tải lên. Đọc lại danh sách tài nguyên đã lưu và thumbnail từ đúng vùng, gắn với định danh/phiên bản thích hợp; không dựa `innerText.includes(basename)`. P08..P10 không được VERIFIED.

7. **R32-13 / P1 — Chọn đúng card 01 và link đầy đủ.** Bỏ selector nhận bừa mọi `.spck-item` như card 01. Khóa đúng học viên và card 01 trước mọi thao tác ghi; gặp card khác hoặc cấu trúc mơ hồ thì dừng an toàn, không ghi đè card 02/03. Đọc các URL thật trong đúng danh sách, so URL đầy đủ; URL dài chứa URL ngắn không được coi là cùng link. Mỗi link thiếu phải bấm + Thêm đúng một lần. P13/P14 phải đạt; P01 retry không tạo 02, không thêm link trùng vẫn đạt.

8. **R32-07 / P1 — Che danh tính trong toàn bộ prompt.** Cải thiện `anonymizeSpckText`: tên đầy đủ và tên riêng có/không dấu, Unicode tổ hợp, mục tiêu và peer. Tái sử dụng cách đã kiểm ở Phase 5 khi thích hợp. Không làm hỏng `STUDENT_01/STUDENT_PEER` hoặc phá cấu trúc sandbox. Kiểm mọi văn bản đưa vào prompt, không chỉ ghi chú. G03/G04 không được còn tên fixture; G02 vẫn đạt. Không kiểm bằng Gemini thật.

9. **R32-08 / P1 — Giữ bản nháp mới và nhận xét giáo viên.** Gắn kết quả AI với phiên bản đầy đủ gói dự án và dữ kiện giáo viên. Đổi tiêu đề/file/link/folder trong lúc chờ phải bỏ kết quả cũ; ghi DB có điều kiện. Thiếu tag/note thì trả INSUFFICIENT_INFO, không xóa nhận xét giáo viên đã nhập/duyệt. G08/G09 phải đạt; G01/G07 vẫn đạt.

10. **R32-09 / P1 — Thứ tự nháp/API/UI và chuỗi duyệt.** API lưu nháp cần thứ tự phiên bản bền theo lớp/học viên và từ chối request cũ; tránh reset bộ đếm khi đổi hàng/lớp hoặc tải lại. UI chỉ áp phản hồi đúng hàng/lớp/phiên bản, giữ thay đổi gõ sau khi gọi AI. `persistRowDraft` phải trả trạng thái lỗi hoặc ném lỗi để chặn approve/upload; không tiếp tục khi lưu nháp thất bại. M06, U02..U04 phải giữ NEW và không gọi bước sau khi lỗi. Thêm đối chứng đổi lớp khi đang chờ phản hồi.

11. **R32-10 / P2 — Không tự tạo dữ kiện sư phạm.** Tags ban đầu rỗng hoặc khôi phục đúng lựa chọn đã lưu, không tự tích nhận xét tích cực. Khi chưa có tag/note thực sự phải INSUFFICIENT_INFO. Không có cờ/bằng chứng thuyết trình thì không đưa nhận xét kỹ năng trình bày trước khán giả vào các phần khác; giới hạn phạm vi dữ kiện và kiểm kết quả, không chỉ thêm một chuỗi regex hẹp hoặc tin prompt. U01/G06 phải đạt, G01/G05 vẫn đạt.

Giữ các hàng rào đang tốt: bind `127.0.0.1`; `validateLocalRequest` trên cả sáu API; không đưa bí mật ra Client; một persistent BrowserContext; thao tác uploader qua SequentialTaskQueue; allowlist/symlink; media parser; giới hạn 10 ảnh/10 tài liệu/5 YouTube/5 link/100 ký tự; SHA-256 và cập nhật VERIFIED có điều kiện. Không mở rộng sang Giai đoạn 7.

Sau sửa, chạy lại trong TEMP tối thiểu:

- `scripts/test-phase6.ts`, `scripts/test-phase5.ts`, `scripts/test-phase4-codex-repros.ts` bằng tsx.
- Bộ R32 nguyên trạng: `node --import tsx docs/audits/round-32/verify-phase6.mjs`. Harness có khóa TEMP theo tên `mindx-round31-r32-`; dùng tên snapshot tương thích, đầu ra chỉ ở TEMP và sao chép sang hồ sơ mới, không ghi đè R32 chính.
- R31 `verify-independent.mjs` nguyên trạng; R12/R13/R16/R17. Giữ một FAIL cũ R16 đếm 7 bảng nếu schema vẫn 8, kèm đối chứng tám bảng và các khóa; không sửa hồ sơ/test cũ hoặc đổi kết quả thành PASS.
- `tsc --noEmit --incremental false` trước và sau `next build --webpack`.

Không chỉ chạy 33 ca đỏ: các đối chứng đang đạt cũng phải giữ. Nếu hợp đồng dữ liệu phải đổi, bổ sung ca đối chứng tương thích và mô tả rõ; không xóa/đổi kỳ vọng kiểm toán để tạo xanh. Lưu command, mã thoát, log, hash mã nguồn, hash bộ kiểm, quan sát request/DB/DOM và các ca mới. Đối chiếu cuối workspace để chứng minh không sửa `next-env.d.ts`, hồ sơ cũ, dữ liệu hoặc phiên đăng nhập thật.

Báo cáo **Đã làm / Kết quả / Chưa kiểm tra / Việc tiếp theo**. Chỉ đề nghị GO khi tất cả nhóm lỗi đã được đóng bằng bằng chứng trên đúng nguồn cuối và các cổng hồi quy đạt hoặc được phân loại minh bạch. Không tự ký nghiệm thu LMS thật hoặc đổi checkbox TASK-6.x chỉ vì sửa xong code.

---

Owner chỉ cần giao prompt này cho lượt sửa riêng rồi yêu cầu kiểm toán lại; không cần thao tác kỹ thuật cho hồ sơ R32 hiện tại.
