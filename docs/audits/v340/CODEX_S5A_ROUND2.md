# Kiểm định độc lập S5a — Round 2

**Verdict: GO** trong phạm vi kiểm định S5a Round 2: đóng **3/3 phát hiện**, chạy mới **6/6 cổng kiểm chứng PASS**, đối chiếu **9/9 kịch bản HTML và PNG giống hệt từng byte**. Không phát hiện vấn đề còn mở ngăn nghiệm thu ba bản sửa được yêu cầu.

## 1. Phạm vi và bản mã đã kiểm tra

- Ngày kiểm định: **30/10/2026**, múi giờ Việt Nam. Sáu cổng chạy từ khoảng **16:02 đến 16:06**.
- Reviewer: Codex, trực tiếp kiểm định độc lập theo yêu cầu Owner; không có reviewer `claude-sonnet-5-5-high` trong môi trường này.
- Mốc trước khi tách module: `93b77e0098d45becd38ac377e473534682e9d98c`.
- Bản được kiểm định: HEAD trên **cộng các thay đổi chưa commit** ở `src/app/final-project/page.tsx`, `src/components/final-project/*`, và `scripts/test-streamline-v340-s5a.ts`. Kết luận không áp dụng cho riêng HEAD hoặc một bản sửa về sau.
- Phạm vi: xác minh S5A-01, S5A-02, S5A-03 của [Round 1](CODEX_S5A_ROUND1.md); giữ nguyên hành vi khi tách trang `/final-project` thành module. Không sửa lỗi hay mở rộng sang S5b.
- Đã đọc `PROJECT_STATE.md`, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, quy tắc dự án và mã liên quan trước khi chạy kiểm chứng.

## 2. An toàn và cách ly dữ liệu

**Không đọc, đo hash, sao chép hoặc ghi hai tệp vận hành `data/mindx_bot.db` và `data/running_classes.json`. Không đưa ra tuyên bố “hash dữ liệu thật không đổi”, vì lần kiểm định này không đo chúng.**

Chạy kiểm thử trên bản sao mã nguồn tại:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-s5a-round2-20261030-160201\workspace
```

Trước mỗi lần chạy test/script đã đặt:

```text
ALLOWED_LOCAL_DIRS = C:\Users\QQ\AppData\Local\Temp\mindx-s5a-round2-20261030-160201
MINDX_DB_PATH = <TEMP trên>\isolation\gate-N\mindx_test.db
MINDX_RUNNING_CLASSES_PATH = <TEMP trên>\isolation\gate-N\running_classes_test.json
GEMINI_API_KEY = TEST_DUMMY_KEY nếu biến chưa được đặt
```

Mỗi cổng dùng một đường dẫn dữ liệu riêng. Bản sao không chứa hai tệp vận hành, `.env`, `.env.local` hay phiên đăng nhập `playwright-auth`; chỉ sao chép tài nguyên logo mặc định cần cho kiểm thử từ `data/config`. Thư viện đã cài được dùng qua liên kết `node_modules`, không cài lại. Cổng đối chiếu chỉ dùng Git để đọc mã trang tại commit nền qua `git show`; không checkout/reset/commit/push.

Đã đối chiếu SHA-256 của **138 tệp trong `src/**` và `scripts/**`** trước/sau: không tệp nào thay đổi, cả bản gốc lẫn bản sao kiểm thử. Các dấu vân tay này chỉ thuộc mã nguồn, không thuộc dữ liệu thật. Chỉ bổ sung báo cáo này và bằng chứng tại `s5a-round2/`; giữ nguyên hồ sơ ảnh đối chiếu có sẵn.

## 3. Kết quả đóng phát hiện Round 1

| Mã | Trạng thái | Bằng chứng và kết luận |
|---|---|---|
| **S5A-01 · P2** | **CLOSED** | Khối `bannerMessage` tại `src/app/final-project/page.tsx:2723` nằm sau `Step1Header`, trước thẻ Bước 2. Giữ đủ nhánh success/warning/error, nội dung thông báo và nút **Đóng** gọi `setBannerMessage(null)`. So riêng khối mã với bản nền sau chuẩn hóa xuống dòng: khớp hoàn toàn. Ba kịch bản thông báo khớp HTML/PNG; thao tác bấm **Đóng** làm biến mất lỗi ở cả bản trước và sau. |
| **S5A-02 · P2** | **CLOSED** | Khối `isAnyOperationBusy && workflow.activeBusyDescription` tại `page.tsx:2707` nằm trên `Step1Header`. Khối hiển thị giữ nguyên bản nền, chỉ đổi tham chiếu mô tả sang `workflow.activeBusyDescription`. Kịch bản `busy-uploading` chờ trạng thái đang xử lý thật trong trang giả lập, rồi đối chiếu HTML/PNG thành công. |
| **S5A-03 · P2** | **CLOSED** | `scripts/test-streamline-v340-s5a.ts:70` biên dịch `src/app/globals.css` bằng PostCSS cùng `@tailwindcss/postcss`; đưa CSS kết quả vào trang kiểm thử. Đủ 9 kịch bản, kiểm tra `innerHTML` bằng so sánh chuỗi nghiêm ngặt và PNG bằng `Buffer.compare`, có kiểm tra nút Đóng. Manifest ghi commit nền, 12 dấu vân tay mã nguồn, SHA-256 HTML/PNG và số byte. Chạy mới cổng này đạt exit 0. |

Kiểm tra bổ sung trực tiếp xác nhận thứ tự **59/59 cặp trạng thái `useState`** giữ nguyên so với bản nền. Cổng S5a xác nhận đủ **11 module** và mốc cắt giao diện phục vụ bộ kiểm thử `node:vm` vẫn thực thi được.

Rà các tệp client liên quan, gồm trang, 11 module và `class-picker.tsx`: các nhập mã nội bộ chỉ đi qua nhóm component này; không thấy nhập thư viện cơ sở dữ liệu, cấu hình máy chủ, điều khiển LMS hoặc đưa ba biến bí mật bị cấm vào các tệp client. Đây là kiểm tra ranh giới client trong phạm vi S5a, không phải kiểm toán bảo mật toàn hệ thống.

## 4. Sáu cổng kiểm chứng chạy mới

Môi trường: Windows/PowerShell, Node **v24.21.0**, npm/npx **11.19.0**. Dùng `npx.cmd` để gọi npx trên Windows. Không thay thế lệnh kiểm thử bằng trình chạy khác.

| # | Lệnh yêu cầu | Kết quả | Phạm vi đã chạy |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | **PASS · exit 0** | Kiểm tra kiểu mã nguồn. Đã chạy bổ sung cùng lệnh sau khi đưa cả `next.config.ts`, các tệp TypeScript kiểm toán cũ và kiểu sinh sẵn của Next vào bản sao; vẫn PASS. |
| 2 | `npx tsx scripts/test-streamline-v340-s5a.ts` | **PASS · exit 0** | T1/T2 cấu trúc và client; T3 `node:vm`; T4 đủ 9 kịch bản với CSS biên dịch thật. |
| 3 | `npx tsx scripts/test-spck-v270.ts` | **PASS · exit 0** | Đủ **T01–T16**. |
| 4 | `npx tsx scripts/test-spck-v272.ts` | **PASS · exit 0** | Đủ **V01–V16**. |
| 5 | `npx tsx scripts/test-phase6.ts` | **PASS · exit 0** | Ghép tên, quét tệp, quy tắc AI, khóa chống sửa sau duyệt, chống nộp trùng, kiểm tra đọc lại và luồng Buổi 12/13/14. |
| 6 | `npx tsx scripts/test-session14-v290.ts` | **PASS · exit 0** | Đủ **S14-01–S14-07**, gồm các tình huống an toàn với phản hồi chậm/sai và kiểm tra sau lưu trên trang LMS mô phỏng. |

Nhật ký có thông báo thử nghiệm của Node về `stripTypeScriptTypes` và thông báo nạp cấu hình rỗng của dotenv. PowerShell định dạng một số dòng stderr thành `NativeCommandError`; tiến trình thực tế của cả sáu cổng đều kết thúc **exit 0**, không có assertion thất bại. Không còn lỗi môi trường `spawn EPERM` của Round 1.

Bằng chứng: [kết quả sáu cổng](s5a-round2/gate-results.json), [kiểm tra TypeScript với phạm vi đầy đủ](s5a-round2/gate-1-full-surface.json), [nhật ký chạy](s5a-round2/logs/).

## 5. Đối chiếu HTML và ảnh

Trình duyệt Chromium chạy thật ở chế độ không mở cửa sổ; viewport **1440 × 1800**, chụp toàn trang. Hai phía được đóng gói riêng từ mã trước/sau, dùng cùng dữ liệu giả lập và CSS ứng dụng đã biên dịch.

| Kịch bản | HTML giống từng byte | PNG giống từng byte | PNG SHA-256, 16 ký tự đầu |
|---|---|---|---|
| `sess12` | PASS | PASS | `e74ccc806b9b26c5` |
| `sess13` | PASS | PASS | `bf56196093a314ca` |
| `sess14` | PASS | PASS | `315bf24f92810305` |
| `snapshot-modal` | PASS | PASS | `45474d015166fdef` |
| `folder-modal` | PASS | PASS | `5b01b471986d04c5` |
| `banner-error` + bấm Đóng | PASS | PASS | `3ee89f2969ace90d` |
| `banner-success` | PASS | PASS | `1640bff8c628b959` |
| `banner-warning` | PASS | PASS | `91460406a9c9f8e7` |
| `busy-uploading` | PASS | PASS | `0f98a2d73c7fc0b1` |

Ảnh của `banner-error` được chụp khi thông báo còn mở; hành động Đóng được xác nhận riêng sau chụp. Reviewer đã xem trực tiếp ảnh lỗi và ảnh đang nộp để xác nhận thông báo xuất hiện đúng vị trí.

Kiểm tra lại độc lập: **12/12 dấu vân tay nguồn** khớp mã gốc hiện tại; **9/9 cặp ảnh** khớp nhau và khớp hash trong manifest. Manifest tạo mới giống nguyên văn manifest hiện có; hash của cả 9 ảnh sau kiểm thử cũng khớp ảnh hiện có. Vì vậy không ghi đè hồ sơ ảnh cũ.

- [Manifest tại đường dẫn yêu cầu](s5a-screenshots/parity-manifest.json).
- [Bản manifest tạo mới từ lần chạy độc lập](s5a-round2/parity-manifest.fresh.json).
- [Kết quả kiểm tra lại ảnh và nguồn](s5a-round2/independent-artifact-checks.json).
- [So khối thông báo, thứ tự trạng thái và kiểm tra mã nguồn không đổi](s5a-round2/independent-source-checks.json).
- [Dấu vân tay 138 tệp trước chạy](s5a-round2/source-fingerprints-before.json).

Các dấu vân tay quan trọng:

```text
src/app/final-project/page.tsx
5624f33913df87291e53b6e05e3dbb36a2f02309b80dada85accb16dbb31d731

scripts/test-streamline-v340-s5a.ts
5156dabc8148eab982a1198464514c8539ef0ea56c16ca2ed989a582d6640013

src/app/globals.css
501a77cbade1e543cb6934fea174655f6ec4c35b46f0650131d86fdfa8d42802
```

## 6. Giới hạn và quyết định nghiệm thu

- Các API trong bộ đối chiếu giao diện được giả lập. Các kiểm thử hồi quy dùng dữ liệu tạm và trang mô phỏng; không xác nhận đã nộp thành công lên LMS, Drive, GitHub hay Teaching thật.
- Có biên dịch CSS ứng dụng thật, nhưng trang kiểm thử dùng lớp bọc và thiết lập nền/phông riêng, tắt hoạt ảnh; không chạy nguyên ứng dụng Next với toàn bộ bố cục, mọi chủ đề màu, kích thước màn hình hoặc mọi tổ hợp thao tác.
- Bằng chứng “không đổi hành vi/giao diện” áp dụng cho 9 kịch bản và các cổng hồi quy đã nêu; không phải chứng minh tuyệt đối cho mọi trạng thái có thể có. Không chạy bản dựng phát hành hoặc nghiệm thu S5b/toàn bộ v3.4.0.
- Không sửa `src/**`, `scripts/**`, cấu hình dự án hay ba tài liệu trạng thái. Chỉ ghi hồ sơ kiểm định; không cập nhật kế hoạch sản phẩm ngoài phạm vi yêu cầu.

**Đã làm:** Kiểm tra lại ba bản sửa, chạy đủ sáu cổng trong TEMP, đối chiếu ảnh/nội dung và lưu bằng chứng.

**Kết quả:** **3/3 CLOSED; 6/6 cổng PASS; 9/9 đối chiếu HTML/PNG PASS.** Không còn phát hiện chặn S5a Round 2.

**Chưa kiểm tra:** Nghiệm thu hệ thống thật, bản dựng phát hành và các tổ hợp giao diện ngoài phạm vi trên.

**Việc tiếp theo:** Có thể dùng báo cáo này làm căn cứ nghiệm thu S5a và chuyển sang S5b theo kế hoạch; Owner không cần thao tác kỹ thuật để hoàn tất lần kiểm định này.

**Verdict: GO**
