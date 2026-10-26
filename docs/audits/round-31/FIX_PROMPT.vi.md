# FIX_PROMPT — AUDIT-R31

**Không có sửa mã nguồn bắt buộc từ kết quả R31. Quyết định: GO cấp mã nguồn, 14/14 CLOSED_SOURCE.**

Hai ca `R30-01-pdf-nested-empty-name` và `R30-01-pdf-array-empty-name` đã đạt PARSED với đúng 1 inlineData nguyên byte; hai đối chứng `/Nonempty` giữ PASS. 819/819 ca chính, 221/221 native media, 88/88 native worker, 54/54 oracle từ điển, 88/88 oracle GraphQL và các cổng nguồn hiện hành đều đạt. Chi tiết và giới hạn ở [REPORT.vi.md](REPORT.vi.md) và [REGRESSION_MATRIX.md](REGRESSION_MATRIX.md).

Nếu cần chuyển giao cho bên triển khai, dùng nguyên văn:

```text
Đối chiếu hồ sơ docs/audits/round-31/REPORT.vi.md và source-manifest.json trước mọi bước tiếp theo.
R31 đã GO cấp mã nguồn, đủ 14/14 CLOSED_SOURCE; không có yêu cầu sửa bổ sung từ kiểm toán này.
Giữ bản sửa Name rỗng hợp lệ trong validateRawPdfDict và parsePdfDictEntries; giữ kiểm thiếu giá trị,
khóa trùng, dấu phân cách, INT/REAL, NUL, cây trang, stream và mọi rào định danh/hash/API/đọc lại.
Không chỉnh sản phẩm chỉ để làm xanh các harness lịch sử lệch yêu cầu; giữ nguyên hồ sơ R12..R31.
Không coi GO nguồn là đã lưu và đọc lại thành công trên LMS thật.
Không thay checkbox/kế hoạch hoặc dùng tài khoản, dữ liệu, Gemini/LMS thật chỉ dựa vào prompt này.
Bước tiếp theo là chuẩn bị phạm vi nghiệm thu vận hành để Owner xem xét; chỉ thực hiện khi đã được giao.
Nếu nguồn thay đổi sau manifest R31, kiểm lại đúng nguồn cuối và lập bằng chứng mới trước kết luận mới.
```

Owner không cần chạy Terminal, cung cấp mật khẩu/khóa hoặc tự sửa code cho lượt kiểm toán này.
