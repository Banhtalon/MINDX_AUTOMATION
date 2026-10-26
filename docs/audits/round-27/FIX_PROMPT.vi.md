# Yêu cầu sửa sau AUDIT-R27

Phán quyết: **NO-GO Giai đoạn 5**, còn **R19-09 (P1)** và **R19-01 (P2)**. Bộ R26 hiện đạt toàn bộ; R27 đạt 650/662, native xác nhận 12 ca trượt mới. Đây là đầu việc cho lượt triển khai tiếp theo; R27 chưa sửa sản phẩm.

Có thể chuyển nguyên nội dung sau cho bên triển khai:

```text
Sửa tối thiểu hai nhóm còn mở theo docs/audits/round-27/REPORT.vi.md.

Đọc MINDX_AUTOMATION_PLAN.md và AGENTS.md. Kiểm tra công việc chưa commit, giữ điểm khôi phục, không ghi đè thay đổi có sẵn. Không sửa docs/audits/round-12/ đến round-27/ để làm xanh kiểm tra. Giữ next-env.d.ts ở workspace chính đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

Mọi chạy thử, SQLite giả, native repro, TypeScript và build phải ở bản sao TEMP, không dùng tài khoản, dữ liệu, DB hay dịch vụ thật. Dùng tiền tố tương thích như audit-runner.py R27. Không cài lại môi trường hoặc thay cả cấu trúc dự án chỉ để sửa hai nhóm này.

1. Ưu tiên R19-09 — src/lib/playwright/grade-worker.ts, vùng token chuỗi dòng 426, operation dòng 439, giá trị đối số dòng 622–647.

Hai ca R27-09-block-quote-decoy-deleteAttachment và R27-09-block-quote-decoy-previewHomework thực sự gọi root khác lưu điểm. Operation saveHomeworkGrade và $input chỉ nằm trong block string ba dấu nháy. Dấu nháy đơn hợp lệ bên trong block string làm bộ thay chuỗi hiện tại lộ operation giả. Với API/DOM giả khớp, worker vẫn VERIFIED, native import trực tiếp xác nhận. Đây là phản ví dụ cho rào xác nhận, chưa phải bằng chứng schema LMS thật có các trường này hay đã xảy ra sự cố thật.

Đọc GraphQL theo cấu trúc, nhận biết chuỗi thường, block string, comment, tên/enum, biến và số; chọn đúng operation đang thực thi, root field/alias và đối số của root đó. Chỉ dùng biến thực sự được tham chiếu trong đối số đã chọn. Không dùng regex giới hạn độ sâu hoặc text trong chuỗi làm bằng chứng nghiệp vụ. Chọn cách nhỏ nhất bảo đảm đúng, không vá riêng từng payload.

Giữ loại token tách khỏi nội dung người gửi. R27-09-placeholder-enum-decoy dùng feedback:__GQL_STR_0__, nhưng bộ hiện tại lấy nhầm chuỗi từ note làm feedback. Đây là mẫu sai hợp đồng cố ý; không được coi tên enum người gửi là token chuỗi nội bộ.

Sửa luôn năm false negative trong cùng nguyên nhân: literal-exponent-score (8e1 = 80), literal-block-string, literal-block-string-braces, nested-selection và deep-nested-selection. Cả năm phải được chấp nhận khi các đối số thực tế và phản hồi khớp bản duyệt. Không cấm dấu ngoặc trong nhận xét hoặc chỉ chấp nhận selection sâu một mức.

Giữ tất cả bảo vệ scalar, null/object/array, response đồng nghĩa, đúng trường/alias đã chọn, HTTP 200/201, GraphQL errors, đọc lại điểm/quyết định/feedback, hash và CAS cuối trước VERIFIED. Không nới kiểm response để làm lại các test lịch sử thiếu hợp đồng.

2. R19-01 — src/lib/file-parsers/media-reader.ts, dòng 1156–1160 và 1320–1325.

Ba ca pdf-stream-early-marker của R27 có Root 9 không được khai báo trong xref; văn bản object 9 nằm hoàn toàn trong stream 4 với Length đúng. Bộ hiện tại tìm endstream đầu tiên bằng regex, dừng giữa payload và nhận văn bản tiếp theo thành object thật. Kết quả PARSED + inlineData, native xác nhận.

Xử lý ranh giới object/stream theo cấu trúc và Length đã xác minh, bao gồm tham chiếu Length an toàn nếu hỗ trợ; xác nhận endstream/endobj tại ranh giới đúng. Không tìm catalog trong dữ liệu stream và không phục hồi âm thầm để cấp PARSED. Không cấm mọi payload chứa chữ endstream: ba PDF đối chứng cùng payload nhưng Root thật phải tiếp tục đạt.

Ca pdf-kids-foreign-scalar có /Kids [3 0 R 999], số 999 không phải node reference nhưng bị bỏ qua. Yêu cầu mọi phần tử Kids đúng kiểu tham chiếu; không chỉ nhặt những đoạn giống reference rồi bỏ phần dư. Giữ generation, Parent, khóa trùng và kiểm chu kỳ.

Bốn PDF lỗi phải PARSE_ERROR, không inlineData; không tự chấm 0 hay chọn REDO. pypdf có thể tự tìm lại object bị thiếu, vì vậy khả năng mở bằng pypdf không chứng minh cấu trúc hợp lệ. Giữ 104/104 WebP mới, 94/94 media R26 và mọi đối chứng hợp lệ cũ.

3. Kiểm chứng trên đúng snapshot nguồn cuối.

- R27 chính 662/662; native media 120/120; native worker 32/32.
- Giữ điều kiện và kỳ vọng của 12 ca trượt, không đổi nhãn hoặc bỏ ca để đạt các số này.
- R26 chính 510/510; native media 94/94; native worker 54/54.
- R25 344/344; native media 25/25; native worker 9/9.
- R24 230/230; R23 116/116; R22 53/53; native R24 8/8.
- Phase 4/5, TypeScript --noEmit --incremental false trước và sau next build --webpack đều đạt.
- Chạy nguyên bản R12/R13/R16/R17 và R19/R20/R21; báo nguyên kết quả thô. Hiện R16 15/16 do 7 bảng so với 8; R19 89/94 do 4 inline placeholder lỗi và 1 approval thiếu snapshot; R20 140/145, R21 45/49 do snapshot/response cũ. Không sửa lịch sử hay bỏ rào mới để lấy PASS.
- Giữ đối chứng R23-COMPAT-R16-schema, 4 đối chứng snapshot R24 và 5 đối chứng response R26 đạt. Tách kết quả tương thích khỏi kết quả thô.

Lệnh chạy từ snapshot TEMP, không chạy trong workspace chính:
node docs/audits/round-27/verify-independent.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-27/native-media-repro.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-27/native-worker-repro.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
node node_modules/typescript/bin/tsc --noEmit --incremental false

Trả danh sách file sửa, diff, hash nguồn cuối, log/mã thoát và các phần chưa kiểm thực tế. Không tự kết luận 14/14 hoặc nghiệm thu LMS thật trước kiểm toán độc lập mới.
```
