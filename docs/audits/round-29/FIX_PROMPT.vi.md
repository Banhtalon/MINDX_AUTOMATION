# Yêu cầu sửa sau AUDIT-R29

**NO-GO cấp mã nguồn: 13/14 nhóm CLOSED_SOURCE.** Đã đóng đủ 9 ca lỗi R28; R19-09 đã đóng trong phạm vi kiểm chứng. Còn **R19-01, P2**, với 8 ca PDF trượt mới, được xác nhận bằng nạp trực tiếp mô-đun sản phẩm. Chưa có lỗi P1 tái hiện trong bộ kiểm này.

Chuyển nội dung dưới đây cho bên triển khai:

```text
Sửa tối thiểu bộ đọc PDF theo docs/audits/round-29/REPORT.vi.md và evidence/fixture-manifest.json.

Đọc AGENTS.md và MINDX_AUTOMATION_PLAN.md. Giữ công việc chưa commit và điểm khôi phục. Không sửa hồ sơ round-12 đến round-29 hoặc thay kỳ vọng để làm xanh. Giữ next-env.d.ts ở workspace chính đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

Chỉ chạy sản phẩm, SQLite giả, kiểm thử, TypeScript và build trong bản sao TEMP cô lập; không mang mật khẩu, hồ sơ đăng nhập, DB hoặc bài nộp thật vào đó. Không cài lại môi trường hoặc đổi cấu trúc dự án.

Chỉ cần sửa src/lib/file-parsers/media-reader.ts, phần parsePdfDictEntries tại dòng 1221–1286 của hash nguồn R29 c019389c427ca6c0ce0607309850100f1d46020a0c942727e585aa6fbddb9a1a.

1. Sáu PDF sai cú pháp vẫn PARSED và có một inlineData.

Các mẫu /Length 8> , 8{ , 8} và /Count 1> , 1{ , 1} có dấu phân cách rời không tạo thành giá trị từ điển hợp lệ. scalarDict.match(...) chỉ nhặt token khớp và bỏ qua các ký tự > { }, khiến phần cú pháp sai biến mất.

Các ID phải PARSE_ERROR, không có inlineData:
- R29-01-pdf-length-delimiter-lone-gt
- R29-01-pdf-count-delimiter-lone-gt
- R29-01-pdf-length-delimiter-brace-open
- R29-01-pdf-count-delimiter-brace-open
- R29-01-pdf-length-delimiter-brace-close
- R29-01-pdf-count-delimiter-brace-close

Đọc liên tục từ vị trí hiện tại; mỗi byte ngoài whitespace/comment phải thuộc một token hoặc cấu trúc hợp lệ. Gặp ký tự rời hoặc không tiêu thụ được phải từ chối. Không chỉ vá một danh sách ba ký tự hoặc dùng match toàn cục khiến ký tự lạ bị mất. Bảo toàn chuỗi, tên, mảng và từ điển con hợp lệ; ký tự > { } bên trong literal string là dữ liệu, không phải dấu phân cách rời.

2. Hai PDF hợp lệ dùng byte NUL làm khoảng phân cách bị PARSE_ERROR.

PDF 32000-1 mục 7.2.2, Table 1 xác định whitespace gồm byte 00, 09, 0A, 0C, 0D, 20. JavaScript \s không gồm NUL. /Length 8<NUL> và /Count 1<NUL> bị đọc thành token số có đuôi lạ.

Hai ID phải PARSED và giữ đúng nguyên byte trong một inlineData:
- R29-01-pdf-length-whitespace-nul
- R29-01-pdf-count-whitespace-nul

Dùng đúng tập whitespace PDF tại ranh giới token của bộ đọc liên quan. Không xóa NUL toàn file vì có thể thay đổi nội dung stream/chuỗi hoặc lệch Length. Giữ các đối chứng tab, LF, FF, CR, SPACE đạt.

Giữ toàn bộ bảo vệ đã đạt: phân biệt INT/REAL đầy đủ, Length 8.5/8.0 và Count 1.5/1.0 phải lỗi; khóa thiếu giá trị phải lỗi; khóa bổ sung đủ giá trị vẫn hợp lệ. /Other /Dangling là một cặp khóa/giá trị Name hợp lệ, không phải hai khóa thiếu giá trị. Giữ nguyên Length reference, generation, ranh giới stream theo số byte, endstream/endobj, Kids chỉ reference, Parent, Count, khóa trùng và chu kỳ.

Không cần sửa grade-worker.ts: BlockStringValue đã đạt corpus hiện tại. Giữ các rào chọn đúng mutation/root/alias, biến được tham chiếu, loại STRING/ENUM, HTTP 200/201, GraphQL errors, phản hồi đúng trường, đọc lại và cập nhật VERIFIED theo hash.

Bằng chứng bắt buộc trên đúng nguồn cuối:
- R29: 815/815; native media 217/217; native worker 88/88. Giữ nguyên 737 ca R28 và 78 ca R29.
- R28: 737/737; native media 163/163; native worker 64/64.
- R27: 662/662; native media 120/120; native worker 32/32.
- R26: 510/510; native media 94/94; native worker 54/54.
- R25: 344/344; native media 25/25; native worker 9/9.
- R24 230/230; R23 116/116; R22 53/53; native R24 8/8.
- Phase 4/5, tsc --noEmit --incremental false trước/sau next build --webpack phải đạt.
- Chạy nguyên bản R12..R21, giữ kết quả thô và giải thích lệch hợp đồng; giữ 10 đối chứng tương thích đạt. Không biến R14/R18 bị chặn hoặc R15 tái hiện hợp đồng cũ thành PASS.
- Oracle PDF phải kiểm đủ 54 kỳ vọng R29 bằng byte từ điển chưa che; oracle GraphQL đạt 88/88. Việc pypdf mở được PDF không chứng minh cú pháp hợp lệ.

Chạy từ snapshot TEMP theo audit-runner.py R29. Đường dẫn tương thích dài có thể chạm giới hạn Windows: runner hiện dùng bản sao esbuild.exe cùng SHA-256 ở đường dẫn TEMP ngắn và bản sao phụ lịch sử ngắn; không đổi thư viện trong workspace chính.

Trả diff, danh sách file sửa, SHA-256 nguồn cuối, lệnh/mã thoát/log và phần chưa kiểm thực tế. Bản TEMP R28 cũ hiện không còn khớp hash nguồn trong hồ sơ R28; không dùng nó làm baseline nếu chưa khôi phục và kiểm hash đúng. Chỉ đề nghị GO sau kiểm toán mới; không tự ký nghiệm thu LMS thật từ dữ liệu giả.
```
