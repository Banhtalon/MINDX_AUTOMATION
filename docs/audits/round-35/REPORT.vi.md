# AUDIT-R35 — Kiểm toán độc lập Giai đoạn 5

**Kết luận: NO-GO.** Cả 7 lệnh bắt buộc đều đạt, nhưng 7 tình huống bổ sung đã tái hiện lỗi ngoài bộ thử cũ. Có 1 lỗi P1 làm sai thang điểm và 6 lỗi P2 cần xử lý trước khi nghiệm thu TASK-5.1..TASK-5.5.

Kiểm toán ngày 21/10/2026 trên cây làm việc hiện tại, gồm cả thay đổi chưa commit; HEAD `2570d96b6770957e218031c91f14ce98e766dfa7`. Hai lượt rà soát độc lập được cấu hình `gpt-6.1-sol`, suy luận `high`. Không sửa mã sản phẩm hay hồ sơ R12–R34.

## 1. Kiểm chứng thực tế

Chạy trong `%TEMP%\mindx-round31-r35-check`, đặt `ESBUILD_BINARY_PATH=%TEMP%\mindx-esbuild.exe`. Bản sao chứa nguyên nội dung nguồn/config/hồ sơ kiểm thử; dùng chung thư viện đã cài qua liên kết `node_modules`, không cài hay sửa thư viện. Không sao chép mật khẩu, hồ sơ đăng nhập, DB hoặc bài nộp thật. Chặn kết nối mạng bằng `network-guard.cjs` sẵn có.

| Lệnh | Kết quả mới | Mã thoát |
|---|---:|---:|
| `node docs/audits/round-31/verify-independent.mjs` | 819/819 | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-media-repro.mjs` | 221/221 | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/native-worker-repro.mjs` | 88/88 | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-name-repro.mjs` | 4/4 | 0 |
| `node node_modules/tsx/dist/cli.mjs docs/audits/round-31/pdf-boundary-repro.mjs` | 28/28 | 0 |
| `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | Đủ 7 nhóm | 0 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Không lỗi | 0 |

Tổng 1.160 lượt kiểm tra của năm bộ đầu có phần trùng phạm vi, không phải 1.160 tình huống duy nhất. Lần khởi chạy đầu lỗi đường dẫn preload Windows trước khi chạy thử; đã lưu riêng, sửa cấu hình TEMP và chạy lại đủ 7 lệnh. Bộ chính ghi JSON tại `round-31/verify-results.json`, khác vị trí `evidence/` của các bộ phụ; kết quả đã được thu đúng đường dẫn.

## 2. Lỗi phải sửa

**R35-01 — P1: Barem mới thang 10 được duyệt thành điểm thang 100.**

- **Vị trí:** `src/app/syllabus-config/page.tsx:661–679`, `src/app/api/config/route.ts:182–203`, `src/lib/gemini/score-auditor.ts:210`, `src/lib/playwright/grade-worker.ts:340–347,1362`.
- **Tái hiện / ảnh hưởng:** Barem mặc định 5+5, học viên đạt 4+4. API cấu hình trả 200, kiểm điểm hợp lệ, API duyệt trả 200 và lưu `APPROVED`, điểm 8. Luồng hiển thị/lưu dùng `/100`, worker điền nguyên 8: bài đạt 80% có thể thành 8/100. Đã chạy cấu hình, kiểm điểm và duyệt bằng nguồn thật trong môi trường giả lập; phần điền LMS xác nhận bằng đọc nguồn.
- **Cách sửa / kiểm lại:** Theo hợp đồng hiện tại là thang 100, đổi mặc định 50+50 và từ chối barem tổng khác 100 tại cấu hình lẫn đầu vào chấm/duyệt; thông báo rõ cho barem cũ thang 10. Kiểm lại ca 40+40 phải ra 80/100; barem 5+5 phải bị chặn trước khi gọi AI/duyệt. Đây là lỗi tích hợp cụ thể với chức năng cấu hình Giai đoạn 7.

**R35-02 — P2: Làm mới xóa nhận xét chưa lưu thành công.**

- **Vị trí:** `src/components/homework-auto-grader-tab.tsx:220–231,262`, nút làm mới tại `1034–1040`.
- **Tái hiện / ảnh hưởng:** Lưu nháp gặp lỗi kết nối; nội dung mới còn trên màn hình và được đánh dấu chưa lưu. Bấm Làm mới thay bằng nhận xét cũ và xóa dấu chưa lưu, mất phần giáo viên vừa viết.
- **Cách sửa / kiểm lại:** Giữ nội dung và dấu chưa lưu của từng bài khi nạp lại; chỉ thay các bài đã lưu thành công. Ca mất kết nối → sửa nhận xét → làm mới phải giữ nguyên nội dung mới; chỉ bỏ khi giáo viên chủ động hủy.

**R35-03 — P2: Đổi buổi khi chấm đang chạy khiến danh sách trắng và tải mãi.**

- **Vị trí:** `src/components/homework-auto-grader-tab.tsx:196–211,269–270,309–310`.
- **Tái hiện / ảnh hưởng:** Bắt đầu chấm buổi 1 → chuyển buổi 2 → chấm buổi 1 hoàn tất và gọi tải lại buổi cũ. Yêu cầu cũ tăng số thứ tự chung khiến phản hồi buổi mới bị bỏ. Thực đo: đã chọn buổi 2, danh sách rỗng, `isLoadingSubs=true` dù mọi yêu cầu đã kết thúc.
- **Cách sửa / kiểm lại:** Chặn yêu cầu của lớp/buổi cũ trước khi tăng số thứ tự; đối chiếu phạm vi ban đầu trước cập nhật màn hình sau mỗi thao tác chờ. Thử lại thứ tự trên: buổi 2 phải hiện đúng bài và kết thúc trạng thái tải.

**R35-04 — P2: Stop vẫn cho AI bắt đầu chấm học viên kế tiếp.**

- **Vị trí:** `src/app/api/homework-grader/download-and-grade/route.ts:177–183`, `src/lib/gemini/homework-grader.ts:660–668`, `src/lib/queue/task-queue.ts:190–191`.
- **Tái hiện / ảnh hưởng:** AI đang chấm SUB1 → Stop → SUB1 hoàn tất. SUB2 vẫn được gọi; API trả thành công trong khi hàng đợi báo đã dừng. AI chạy ngoài phần tải bài được xếp hàng nên nút Stop Giai đoạn 7 không kiểm soát hết công việc Giai đoạn 5.
- **Cách sửa / kiểm lại:** Truyền tín hiệu dừng cho cả lượt chấm, kiểm tra trước mỗi học viên và trước ghi kết quả; trả trạng thái đã dừng. Sau Stop không được bắt đầu SUB2. Chưa tái hiện hành vi ghi LMS sau Stop, không kết luận phần đó.

**R35-05 — P2: Bài mới nộp bị bỏ sót vì bảng điểm lưu cũ.**

- **Vị trí:** `src/lib/playwright/download-submissions.ts:149–157,248–270`; nơi gọi tại `src/app/api/homework-grader/download-and-grade/route.ts:71`.
- **Tái hiện / ảnh hưởng:** Bảng lưu cũ ghi S1 chưa nộp, LMS mới đã có NEW_SUB. Bấm tải bài trả thành công với 0 bài, số lần đọc bảng LMS mới bằng 0. Không dựa vào giả định LMS giữ cùng ID khi nộp lại.
- **Cách sửa / kiểm lại:** Tải bài phải đọc mới danh sách trước khi lọc; bảng lưu cũ dùng để hiển thị. Thử nộp bài sau lần đọc bảng trước: lần tải tiếp theo phải thấy NEW_SUB.

**R35-06 — P2: Scratch mất toán hạng trong biểu thức lồng nhau.**

- **Vị trí:** `src/lib/file-parsers/game-reader.ts:75–86`.
- **Tái hiện / ảnh hưởng:** Hai gói Scratch có đủ sân khấu, nhân vật và tài nguyên, lần lượt di chuyển `1+2` và `100+200`, đều được đọc thành cùng chuỗi `STEPS=(operator_add)`. AI không thể phân biệt kết quả 3 và 300 để đối chiếu đề bài.
- **Cách sửa / kiểm lại:** Đọc tiếp đầu vào của biểu thức con, giới hạn độ sâu và chặn vòng lặp. Hai bài trên phải có nội dung trích xuất khác nhau, giữ đủ toán hạng; trường hợp biểu thức sâu hoặc tham chiếu vòng phải kết thúc an toàn.

**R35-07 — P2: GameMaker bỏ qua mã hỏng rồi cho phép chấm phần còn lại.**

- **Vị trí:** `src/lib/file-parsers/game-reader.ts:577–585,586–640`.
- **Tái hiện / ảnh hưởng:** YYZ có tài nguyên object khai báo Create/Step; Create hợp lệ, Step chứa byte hỏng. Parser vẫn trả thành công, loại mất Step khỏi nội dung. Vi phạm yêu cầu báo `PARSE_ERROR` khi không đọc được bài; gói ZIP thường đã chặn trường hợp tương đương.
- **Cách sửa / kiểm lại:** GML hỏng hoặc YY tài nguyên bắt buộc không đọc được phải làm cả bài chuyển `PARSE_ERROR`, giữ tên tệp lỗi để giáo viên xem. Kiểm lại gói hỏng phải bị chặn chấm/duyệt; gói đầy đủ hợp lệ vẫn đọc được. Nhánh YY nuốt lỗi được xác nhận qua nguồn; ca chạy dùng GML hỏng.

## 3. Phạm vi và giới hạn kết luận

Đã rà toàn bộ nhóm parser, hai mô-đun AI/kiểm điểm, downloader, scraper bảng điểm, worker lưu điểm, toàn bộ API homework-grader, hai màn hình/thành phần liên quan và các hàm SQLite về bài nộp/hash/phiên bản/duyệt/xác minh. Đối chiếu TASK-5.1..5.5, local guard, path allowlist, một browser context, hàng đợi, lọc bài độc lập điểm danh, ẩn danh, cộng điểm bằng code, bảo vệ sau duyệt và xác minh API + đọc lại.

Đã xem các điểm dùng chung Giai đoạn 6/7: SQLite, selectors, cấu hình barem/giáo trình, hàng đợi và Stop. So với danh mục nguồn R31, 8 đường dẫn có thay đổi; chi tiết trong `evidence/results.json`. Các bộ R31 không phát hiện hồi quy trong phạm vi đã thử. Tuy nhiên R35-01 và R35-04 chứng minh luồng tích hợp Giai đoạn 7 chưa đáp ứng hợp đồng Giai đoạn 5. Không gán những lỗi còn lại cho một lần sửa Giai đoạn 6/7 nếu chưa có đối chứng lịch sử tương ứng.

Ba tệp `core-repro.mjs`, `ui-repro.mjs`, `rubric-repro.mjs` cùng JSON/log chứng minh đủ 7 lỗi. Parser game nạp trực tiếp mô-đun sản phẩm; các thử API/UI/queue khác thực thi thân hàm nguồn với dữ liệu/mạng/DB hoặc React hooks giả lập. Script core thoát 1 vì yêu cầu đúng bị vi phạm; script UI/rubric thoát 0 vì bộ dò tái hiện đúng lỗi — **không phải chức năng đạt nghiệm thu**.

Chưa kiểm tra trình duyệt thật, tương tác React thật, LMS/Gemini thật, tải/lưu bài thật hoặc chạy bản đóng gói. Không dùng tuyên bố Live Flight Test trong kế hoạch cũ làm bằng chứng của R35. Đây là kiểm toán mã nguồn và thử cô lập cho quy mô ứng dụng một giáo viên trên máy cục bộ, chưa phải nghiệm thu vận hành.

## 4. Bảo toàn và bước tiếp theo

Đã đối chiếu SHA-256 trước/sau: **1.653/1.653 tệp bảo vệ giữ nguyên**, gồm 70 tệp `src/**` + `scripts/**`, 4 tệp config, 1.578 tệp hồ sơ R12–R34 và `next-env.d.ts`. Hash `next-env.d.ts`: `B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`. Danh mục tệp được so lại để phát hiện cả thêm/xóa; chi tiết tại `evidence/integrity.json`.

Đã xóa bản sao TEMP, thư mục dữ liệu giả do lượt chạy này tạo và hai script điều phối tạm; giữ `mindx-esbuild.exe` đã tồn tại từ trước. Chỉ thêm hồ sơ R35 và mục xác nhận hoàn tất AUDIT-R35 trong kế hoạch; không đổi dấu nghiệm thu TASK-5.x hay sửa hồ sơ cũ.

**Việc tiếp theo:** Sửa đúng 7 lỗi nêu trên trong một lượt riêng, thêm các ca R35 vào kiểm thử rồi kiểm toán lại đúng nguồn cuối. Giữ kết luận **NO-GO** cho đến khi các tình huống này đạt; Owner chưa cần thao tác hay cung cấp tài khoản.
