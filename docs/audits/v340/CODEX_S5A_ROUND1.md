# Kiểm định độc lập S5a.1–S5a.3 — v3.4.0

**Verdict: NO-GO**

Ngày kiểm định: 30/10/2026. Nền so sánh: commit đầy đủ 93b77e0098d45becd38ac377e473534682e9d98c. Đối tượng sau S5a là cây làm việc chưa commit, có dấu vân tay trong source-manifest-before.json; không phải một commit S5a đã phát hành.

## Phạm vi và an toàn

- Kiểm tra trang final-project cùng đủ 11 tệp bắt buộc: types.ts, useSpckWorkflow.ts, Step1Header.tsx, ToolsDrawer.tsx, StudentRow.tsx, StudentTable.tsx, SubmitBar.tsx, Session14Panel.tsx, FolderBrowserModal.tsx, SnapshotModal.tsx, index.ts.
- Chỉ đọc kho gốc. Mọi kiểm thử thực hiện trên bản sao mã nguồn trong thư mục repo cạnh báo cáo này.
- Đặt ALLOWED_LOCAL_DIRS vào thư mục TEMP chứa báo cáo; MINDX_DB_PATH vào audit.db và MINDX_RUNNING_CLASSES_PATH vào running_classes.json trong cùng thư mục trước khi chạy.
- Không đọc, sao chép, ghi, xóa hoặc băm data/mindx_bot.db và data/running_classes.json thật. Không sao chép .env, .env.local hay phiên đăng nhập.
- Dùng một chuỗi khóa AI giả khi chạy các ca có mô hình AI giả lập. Không dùng tài khoản hoặc dịch vụ LMS/Teaching thật.
- 13/13 dấu vân tay tệp trong phạm vi, gồm trang, 11 module và bộ kiểm thử S5a, không thay đổi sau kiểm định. Git status kho gốc giống trước kiểm định; tsconfig.tsbuildinfo đã có thay đổi từ trước.
- Không cập nhật PROJECT_STATE.md, CHANGELOG.md hay MINDX_AUTOMATION_PLAN.md vì đây là kiểm định chỉ đọc, không triển khai sửa lỗi.
- Không có Claude Reviewer trong môi trường này; Codex trực tiếp đóng vai Reviewer độc lập theo yêu cầu.

## Các phát hiện phải sửa

### S5A-01 — P2: Mất toàn bộ thông báo thành công, cảnh báo và lỗi

**Nguyên nhân:** Khi tách giao diện, khối JSX hiển thị bannerMessage đã bị bỏ khỏi trang. Các hàm xử lý vẫn gọi setBannerMessage, nhưng không component mới nào hiển thị nội dung đó.

**Vị trí:** src/app/final-project/page.tsx:2707, vị trí giữa Step1Header và khối công cụ. Khối gốc nằm ở commit 93b77e0:src/app/final-project/page.tsx:4679–4700. Trạng thái vẫn được chuyển vào workflow tại trang dòng 2603.

**Tái hiện:** Bấm “Chọn...” và giả lập /api/spck/browse-folder trả success:false, error:S5A_SYNTHETIC_DIRECTORY_ERROR. Cả hai bản gọi cùng API, cùng nội dung yêu cầu và cùng lưu trạng thái lỗi. Bản cũ hiển thị lỗi; bản mới không hiển thị. Bằng chứng: action-repro.json.

**Ảnh hưởng:** Giáo viên không nhận được lý do khi chọn thư mục, lưu nháp, tạo AI, tải tài nguyên hoặc các thao tác khác thất bại; thông báo thành công/cảnh báo và nút đóng cũng biến mất.

**Cách sửa nhỏ nhất:** Khôi phục nguyên khối Status Alert Banner cùng vị trí, điều kiện, màu sắc, nội dung và nút Đóng như bản nền. Không thay đổi các hàm nghiệp vụ.

**Xác nhận sau sửa:** Đối chiếu cả ba loại success/warning/error trên Buổi 12/13/14 và tái chạy tình huống chọn thư mục thất bại. Hiện cả 9/9 trạng thái thông báo lệch HTML so với bản nền.

### S5A-02 — P2: Mất thanh báo đang xử lý và giải thích khóa nút

**Nguyên nhân:** Khối Active Processing Lock Banner bị bỏ khi ghép các component mới. useSpckWorkflow vẫn tính và trả activeBusyDescription, nhưng phần giao diện không dùng giá trị này.

**Vị trí:** src/app/final-project/page.tsx:2704–2707, ngay đầu khối space-y-6, trước Step1Header. Mã mô tả còn ở src/components/final-project/useSpckWorkflow.ts:2696 và được trả ở dòng 2831. Khối gốc ở commit nền dòng 4418–4430.

**Tái hiện:** Đặt uploading=true trên Buổi 12, 13 hoặc 14. Bản nền hiện “Đang nộp SPCK lên LMS…” và lời giải thích “Các nút thao tác xung đột đang tạm khóa cho đến khi hoàn tất”. Bản mới vẫn khóa nút nhưng mất cả thanh thông báo.

**Ảnh hưởng:** Màn hình thay đổi bố cục trong lúc xử lý; giáo viên không biết thao tác nào đang chạy hoặc vì sao nút bị khóa.

**Cách sửa nhỏ nhất:** Khôi phục nguyên khối báo đang xử lý với điều kiện isAnyOperationBusy && activeBusyDescription, biểu tượng Loader2, lớp giao diện và vị trí cũ.

**Xác nhận sau sửa:** Đối chiếu trạng thái đang nộp SPCK trên cả ba buổi và các thao tác có activeBusyDescription. Hiện 3/3 trạng thái uploading lệch HTML.

### S5A-03 — P2: Bộ đối chiếu hiện tại bỏ sót các nhánh đã bị mất

**Vị trí:** scripts/test-streamline-v340-s5a.ts:194, :198, :387.

**Nguyên nhân:** Bộ S5a chỉ đối chiếu sess13, sess14, snapshot-modal, folder-modal, sử dụng một tập CSS đơn giản tự viết. Không có Buổi 12, ba loại thông báo hoặc trạng thái tác vụ đang chạy. Vì vậy các ảnh giống nhau ở bốn kịch bản này không phát hiện S5A-01/S5A-02 và chưa đủ chứng minh toàn bộ giao diện thật không đổi.

**Cách sửa:** Bổ sung Buổi 12, thông báo success/warning/error, trạng thái đang xử lý và kiểm tra nút đóng. Chạy đối chiếu với CSS thật của ứng dụng khi nghiệm thu hình ảnh. Giữ nguyên các điều kiện cũ, không làm yếu kiểm tra để đạt PASS.

## Kết quả kiểm tra bắt buộc

Tất cả lệnh được thực sự thử chạy từ bản sao TEMP, với ba biến cách ly đã đặt. Các lỗi EPERM là giới hạn môi trường, không được tính là PASS hoặc quy thành lỗi của sản phẩm.

| Lệnh | Kết quả lần chạy yêu cầu |
|---|---|
| npx tsc --noEmit | PASS, exit 0; kiểm tra mới trong bản sao chưa có tsbuildinfo |
| npx tsx scripts/test-streamline-v340-s5a.ts | BLOCKED, exit 1: esbuild spawn EPERM |
| npx tsx scripts/test-spck-v270.ts | BLOCKED, exit 1: esbuild spawn EPERM |
| npx tsx scripts/test-spck-v272.ts | BLOCKED, exit 1: esbuild spawn EPERM |
| npx tsx scripts/test-phase6.ts | BLOCKED, exit 1: esbuild spawn EPERM |
| npx tsx scripts/test-session14-v290.ts | BLOCKED, exit 1: esbuild spawn EPERM |

Log nguyên bản: tsc.log, s5a.log, v270.log, v272.log, phase6.log, session14.log; tổng hợp: gates.json.

### Kiểm tra bổ sung không dùng tsx

Dùng Node với loader.mjs tự chuyển TypeScript bằng Babel có sẵn trong Next, đặt ngoài kho gốc. Không sửa mã nguồn hoặc các điều kiện kiểm thử. Đây là bằng chứng bổ sung, không thay cho việc chạy thành công chính xác các lệnh npx tsx.

- test-streamline-v340-s5a.ts: T1/T2 kiểm tra cấu trúc/bảo mật và T3 node:vm pre-JSX đạt. T4 dừng ở git child-process spawnSync EPERM, chưa chụp ảnh mới.
- test-spck-v270.ts: PASS toàn bộ T01–T16, exit 0; có kiểm tra các đoạn hàm UI cũ bằng VM.
- test-spck-v272.ts: dừng ở V01 vì Chromium spawn EPERM.
- test-phase6.ts: TASK-6.1, 6.2, 6.3 đạt; dừng ở nhóm TASK-6.4/6.5 khi Chromium spawn EPERM.
- test-session14-v290.ts: S14-01–S14-05 đạt; dừng ở S14-06 khi Chromium spawn EPERM.
- Không hạ điều kiện kiểm thử và không mô phỏng kết quả PASS của Chromium. Các lần đầu v270/session14 không có khóa AI đã dừng sớm; sau khi dùng khóa giả để kích hoạt mô hình đã được test thay thế, kết quả mới nhất là các kết quả nêu trên.
- Log bổ sung có tiền tố fallback-. fallback-gates.json tổng hợp kết quả cuối của cách chạy thay thế.

## Đối chiếu độc lập

1. Đủ 11/11 tệp bắt buộc, kết nối qua index.ts; các khối giao diện chính đã chuyển sang component.
2. Cấu trúc 59 useState giữ nguyên thứ tự, bao gồm năm state đầu và mốc return cần cho harness pre-JSX.
3. Phân tích cây cú pháp 120 khai báo cũ: 113 giống nguyên cấu trúc ở ít nhất một vị trí mới. Bảy khai báo còn lại được rà soát: bốn hàm thay truy cập biến lớp đang mở bằng getter; hai callback bổ sung setter ổn định và let đổi const; một khai báo bổ sung kiểu. Không phát hiện lỗi nghiệp vụ riêng trong bảy thay đổi này. Đây không phải bằng chứng toàn bộ hành vi đã tương đương.
4. Dựng HTML với ReactDOMServer và các trạng thái hook giả lập, không chạy effect và không gọi dịch vụ thật: **25 kịch bản; 13 khớp, 12 lệch**, quy về hai khối giao diện bị mất.
5. Các trường hợp khớp gồm Buổi 12/13/14 bình thường; mở chi tiết hàng cùng công cụ ở cả ba buổi; màn trống/đang tải; FolderBrowserModal, bộ lọc thư mục; SnapshotModal; Robotics Buổi 14; cổng thu bài đang bật.
6. Các trường hợp lệch gồm 3 trạng thái uploading và 9 tổ hợp thông báo success/warning/error × buổi 12/13/14.
7. Đây là đối chiếu chuỗi HTML, không phải ảnh chụp trình duyệt, không chứng minh bố cục responsive, focus, CSS tính toán, effect hay toàn bộ tương tác mạng.
8. Các ảnh s5a-screenshots có sẵn trong kho không được dùng làm kết quả chạy mới của phiên kiểm định này.

Bằng chứng: ast-comparison.json, ast-differences.json, event-handler-comparison.json, ssr-parity.json, action-repro.json và các cặp *-before.html/*-after.html. ast-differences.json là bản phân tích thô, không phải danh sách lỗi; các thay đổi tương đương đã được đọc đối chiếu riêng.

## Bảo mật client

Lần theo các import/export thực thi sau khi loại phần chỉ phục vụ kiểu dữ liệu: **13 tệp nguồn** gồm trang, 11 module và ClassPicker. Các gói bên ngoài được dùng là react và lucide-react.

Không thấy TEACHING_PASSWORD, LMS_PASSWORD, GEMINI_API_KEY trong nhánh client này; không thấy import trực tiếp hoặc qua tệp trung gian tới db/config/playwright, node:*, fs, path, dotenv, better-sqlite3 hoặc server-only. Bằng chứng: client-security.json.

Kết quả này chỉ thuộc nhánh client được yêu cầu; chưa kiểm tra bundle sản xuất và không mở rộng thành chứng nhận bảo mật toàn ứng dụng.

## Điều kiện để GO

- Sửa S5A-01 và S5A-02 bằng cách phục hồi nguyên giao diện nền.
- Bổ sung các kịch bản S5A-03 để hai lỗi này không lọt qua lần sau.
- Chạy lại cả sáu lệnh yêu cầu trong môi trường cho phép esbuild/Chromium, vẫn cách ly TEMP.
- Đối chiếu ảnh mới của Buổi 12/13/14, hai cửa sổ, trạng thái bận và thông báo với CSS thật; ghi rõ dấu vân tay nguồn được kiểm tra.

## Báo cáo Owner

**Đã làm:** Kiểm định chỉ đọc, đối chiếu bản nền, chạy các lệnh yêu cầu và bổ sung kiểm tra HTML/tình huống lỗi.
**Kết quả:** Chưa đạt điều kiện không đổi hành vi/giao diện; hai khối thông báo đã mất. Nhánh client chưa thấy rò rỉ thông tin bí mật.
**Chưa kiểm tra:** Chưa chạy xong các bộ yêu cầu qua tsx, chưa có ảnh Chromium mới, chưa nghiệm thu LMS/Teaching thật.
**Việc tiếp theo:** Nhóm triển khai phục hồi hai khối thông báo, bổ sung kiểm thử rồi kiểm định lại. Chưa thay đổi mã trong phiên này.

**Verdict: NO-GO**
