# Yêu cầu sửa sau AUDIT-R30

**NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE; còn R19-01 P2.** Đã đóng đủ tám lỗi R29. Còn hai PDF hợp lệ chứa Name rỗng trong mảng/từ điển con bị từ chối; nguồn R29 đúng hash nhận chúng, pypdf strict và oracle byte độc lập xác nhận hợp lệ. [Báo cáo](REPORT.vi.md), [mẫu và hash](evidence/new-findings.json).

Chuyển nội dung dưới đây cho bên triển khai:

```text
Đọc AGENTS.md, MINDX_AUTOMATION_PLAN.md và docs/audits/round-30/REPORT.vi.md. Giữ công việc chưa commit; không sửa bất kỳ hồ sơ round-12..round-30 hoặc thay kỳ vọng để làm xanh. Giữ next-env.d.ts ở workspace chính đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

Sửa tối thiểu src/lib/file-parsers/media-reader.ts, hash nguồn R30 3d677823077a3c7eb36f7261f45970ca7b7903e9797b1568ce602f86109760ac. Không sửa grade-worker.ts.

Lỗi tại validateRawPdfDict, dòng 1222: return idx > ns ? "NAME" : null từ chối giá trị Name rỗng '/'. PDF 32000-1 mục 7.3.5 xác định dấu '/' không có ký tự tên theo sau là Name hợp lệ. Hai mẫu thêm /Other << /Value / >> hoặc /Other [/] vào từ điển Pages hợp lệ hiện trả PARSE_ERROR/0 inlineData; phải PARSED/1 inlineData nguyên byte:
- R30-01-pdf-nested-empty-name
- R30-01-pdf-array-empty-name

Phân biệt đã tiêu thụ dấu '/' tạo Name hợp lệ với trường hợp khóa không có giá trị. Giữ hai đối chứng /Nonempty đạt, không nhận sai khóa thiếu giá trị hoặc delimiter rời. Không chỉ bỏ validateRawPdfDict hoặc bỏ rào quét liên tục.

Giữ tám ca R29 đã đóng và toàn bộ rào INT/REAL, sáu whitespace PDF 00/09/0A/0C/0D/20, mười delimiter, khóa trùng/thiếu giá trị, Length reference/generation, stream boundary/endstream/endobj, Kids/Parent/Count và chu kỳ. Giữ worker và các rào HTTP 200/201, đúng mutation/alias/root/biến tham chiếu, GraphQL errors, đọc lại và VERIFIED theo hash.

Chỉ chạy sản phẩm, SQLite giả, test, TypeScript và build trong TEMP cô lập theo audit-runner.py R30; không sao chép mật khẩu, hồ sơ đăng nhập, DB hoặc bài nộp thật. Dùng ESBUILD_BINARY_PATH ở đường dẫn TEMP ngắn và bản sao ngắn cho SQLite/Python khi cần; không cài lại thư viện hoặc sửa kiểm thử lịch sử.

Bằng chứng trên đúng nguồn cuối:
- R30: 819/819, native media 221/221, native worker 88/88; giữ nguyên 815 ca R29 và bốn ca R30. pdf-name oracle 4/4; đối chứng nguồn R29 nhận hai mẫu phải giữ đúng hash.
- R29: 815/815, native media 217/217, native worker 88/88; R28: 737/737, 163/163, 64/64; R27: 662/662, 120/120, 32/32; R26: 510/510, 94/94, 54/54.
- R25: 344/344, native media 25/25, native worker 9/9; R24 230/230, R23 116/116, R22 53/53; native R24 8/8.
- PDF oracle đủ 54 kỳ vọng R29; GraphQL oracle 88/88. Không coi pypdf tự phục hồi file sai là bằng chứng cú pháp hợp lệ.
- Phase 4/5, tsc --noEmit --incremental false trước/sau next build --webpack phải đạt.
- Chạy R12..R21 nguyên bản, giữ FAIL/BLOCKED và giải thích hợp đồng cũ; 10 đối chứng tương thích phải đạt. Không sửa/xóa lịch sử R14/R18 để bỏ rào.

Trả diff, danh sách file sửa, SHA-256 nguồn cuối, lệnh/mã thoát/log và giới hạn chưa kiểm thực tế. Chỉ đề nghị GO sau kiểm toán mới; không ký nghiệm thu LMS thật từ dữ liệu giả.
```
