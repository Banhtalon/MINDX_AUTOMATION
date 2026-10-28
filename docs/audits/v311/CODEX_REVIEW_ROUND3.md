# Kiểm định độc lập v3.1.1 — Codex, Vòng 3

**Ngày:** 28/10/2026. **Commit kiểm định:** `3afb54c41f71ff6d7097963c7e217638b238521d` (`3afb54c`). **Đối chiếu:** hai finding P2 `R2-01`, `R2-02` và điều kiện chuyển GO trong [báo cáo Vòng 2](CODEX_REVIEW_ROUND2.md).

**Kết luận: GO trong phạm vi kiểm định Round 3 được yêu cầu.** Cả hai finding đã **CLOSED**. Chạy mới **7/7 cổng PASS**, probe gốc **18/18**, probe mở rộng Vòng 2 **57/57**; toàn bộ **10 assertion từng lỗi nay PASS**, giữ nguyên điều kiện kiểm tra. Bổ sung **48 assertion** kiểm tra điểm danh cả lớp với thẻ đang chờ lưu/xóa và thẻ mặc định: **48/48 PASS**. Không phát hiện lỗi chặn bàn giao mới trong phạm vi này.

## 1. Phương pháp, nguồn mã và cách ly dữ liệu

- Đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, skill `team-workflow` và hướng dẫn testing/server-client của Next.js đang cài. Theo yêu cầu trực tiếp của Owner, Codex đảm nhiệm Reviewer độc lập và không sửa mã ứng dụng.
- Working tree ban đầu sạch, HEAD đúng `3afb54c`. Tạo bản sao từ Git tại `C:\Users\QQ\AppData\Local\Temp\mindx-v311-review-round3-y7novb2k\repo`. Không chép DB Owner, `.env` thật hoặc hồ sơ đăng nhập; SQLite mới chỉ chứa dữ liệu tổng hợp. Gỡ biến mật khẩu, API key, token và thông tin tài khoản khỏi môi trường các tiến trình kiểm thử.
- Dùng thư viện đã cài qua junction `node_modules`; không cài/cập nhật gói. Node `v24.15.0`, Next.js `16.4.2`, React `19.3.1`, TypeScript `7.0.2`, tsx `4.23.15`, Playwright `1.64.1`, better-sqlite3 `13.0.3`. Trên Windows dùng `npx.cmd` với nguyên chương trình/tham số được yêu cầu.
- Đối chiếu 12 tệp nguồn/probe với Git blob của commit; phục hồi chính xác byte của các tệp này trong bản sao trước khi chạy. Nội dung working tree cũng khớp sau chuẩn hóa LF/CRLF. Xem [dấu SHA-256](round3/reviewed-source-hashes.json) và [môi trường](round3/environment.json).
- Chạy nối tiếp bảy cổng. Hai probe trình duyệt dùng lần lượt một persistent BrowserContext cô lập; thao tác trang qua SequentialTaskQueue. Cổng theme dựng CSS mới từ nguồn hiện tại, rồi Dashboard dùng chính CSS đó. Không chạy máy chủ, không mở LMS thật và không gọi Gemini trả phí.
- Probe nghiệp vụ thực thi handler GET/POST và SQLite thật. Bộ mô phỏng hooks chạy hàm xử lý của component thật; thay tầng vận chuyển để giữ request đầu và chủ động cho nó trả HTTP 500 sau khi request kế tiếp đã lưu thành công. Việc tải lại được kiểm tra bằng GET thật và khởi tạo lại component qua harness, không dùng thao tác reload trong trình duyệt có hydration.

## 2. Đối chiếu hai finding còn lại

| Finding | Trạng thái | Mã đã kiểm tra | Bằng chứng chạy mới |
|---|---|---|---|
| **R2-01 — Bỏ sót xóa trắng thẻ khi lưu ghi chú/điểm danh chồng nhau** | **CLOSED** | `src/app/session-comments/page.tsx:1122`, `:1172` | Bốn ca `clear/note`, `clear/attendance`, `inherit-clear/note`, `inherit-clear/attendance` chuyển tiếp `quickTags: []`; SQLite lưu đúng mảng rỗng. Hai ca xóa thẻ kế thừa vẫn rỗng khi khởi tạo lại component. Cả **8 assertion từng FAIL đều PASS**. |
| **R2-02 — Điểm danh cả lớp bỏ qua thẻ đang chờ lưu** | **CLOSED** | `src/app/session-comments/page.tsx:1555`, `:1562`, `:1564`, `:1573` | Ca gốc `replace/bulk` chuyển tiếp cả hai thẻ và lưu đúng DB dù request thẻ đầu trả HTTP 500 muộn; **2 assertion từng FAIL đều PASS**. Probe bổ sung giữ được cả thao tác thêm và xóa thẻ khi bật/tắt thẻ mặc định. |

### R2-01: mảng rỗng được lưu như một chỉnh sửa chủ động

Hai handler nay xét cờ `__qt_pending__<studentId>` trước điều kiện thẻ kế thừa có nội dung. Khi đang có chỉnh sửa thẻ chưa xác nhận, patch luôn chứa mảng `quickTags`, bao gồm `[]`. Vì vậy, luồng `saveDraftToServer` đưa `quickTags` vào danh sách trường chỉnh sửa tại `page.tsx:1334`; endpoint xử lý độ mới của trường tại `save-draft/route.ts:264` và lưu mảng tại `:294`.

Đã giữ nguyên trình tự tái hiện Vòng 2: gỡ thẻ cuối → giữ request đầu → lưu ghi chú/điểm danh thành công → cho request đầu trả HTTP 500. Giao diện, DB và các phép kiểm tra tải lại đều đúng kỳ vọng. Kiểm tra trực tiếp thêm bốn bản ghi sau probe xác nhận `quickTagsJson` là `[]` và **`versionMetaJson.fields.quickTags` có metadata phiên bản**, không chỉ tình cờ rỗng do giá trị mặc định. Bằng chứng: [extended-results.json](round3/extended-results.json), [r201-field-metadata.json](round3/r201-field-metadata.json).

### R2-02: điểm danh cả lớp tôn trọng chỉnh sửa đang chờ

`hasPendingQuickTagsEdit` nay tham gia cả hai quyết định: chặn thêm thẻ mặc định khi giáo viên đang sửa/xóa thẻ, và chuyển tiếp thẻ hiện tại vào request điểm danh kể cả mảng rỗng. Nhánh thẻ kế thừa không rỗng vẫn được giữ. Bảo vệ phản hồi cũ và việc xóa cờ pending sau phản hồi lưu hợp lệ không bị thay đổi; các kiểm tra tương ứng đạt.

Probe bổ sung chạy sáu tình huống, mỗi tình huống có bảy assertion:

| Nguồn thẻ trước chỉnh sửa | Chỉnh sửa đang chờ | Bật thẻ mặc định khi điểm danh | Kết quả |
|---|---|---|---|
| Đã lưu ở buổi hiện tại | Xóa hết | Không | **7/7 PASS** |
| Đã lưu ở buổi hiện tại | Xóa hết | Có | **7/7 PASS** |
| Kế thừa từ buổi trước | Xóa hết | Không | **7/7 PASS** |
| Kế thừa từ buổi trước | Xóa hết | Có | **7/7 PASS** |
| Đã lưu ở buổi hiện tại | Thêm `👀 Mất tập trung` | Có | **7/7 PASS** |
| Kế thừa từ buổi trước | Thêm `👀 Mất tập trung` | Có | **7/7 PASS** |

Trong từng tình huống, request thẻ đầu được giữ chờ, request điểm danh thực sự nhận HTTP 200 rồi request đầu mới trả HTTP 500. Bảy assertion kiểm tra: payload, thẻ trong SQLite, metadata `fields.quickTags`, điểm danh `PRESENT`, giao diện sau lỗi cũ, cờ pending đã được giải phóng và thẻ sau tải lại. Thêm hai ca đối chứng học viên chưa có thẻ/chưa chỉnh sửa, mỗi ca ba assertion: tắt mặc định thì không gắn thẻ; bật mặc định vẫn gắn thẻ tốt Robotics. Tổng mới **48/48 PASS**.

Mã tái hiện: [supplemental-probe.ts](round3/supplemental-probe.ts). Kết quả: [supplemental-results.json](round3/supplemental-results.json). Probe này giữ 57 assertion Vòng 2 và thêm 48 assertion, nên kết quả tổng là **105/105**, không phải 105 ca mới. Chỉ chạy trong bản sao tạm có tên chứa `mindx-v311-review-`.

## 3. Kết quả bảy cổng bắt buộc

| # | Lệnh | Exit | Thời gian | Kết quả chạy mới |
|---|---|---:|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | 0 | 1,22s | **PASS**, không lỗi TypeScript |
| 2 | `npx tsx scripts/test-quick-tags-v300.ts` | 0 | 2,28s | **PASS**, Quick Tags/Checkpoint và bảo vệ dữ liệu fixture |
| 3 | `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | 3,16s | **PASS**, bộ hồi quy hiện có tới Round 17 |
| 4 | `node docs/audits/v310/round3/theme-probe.mjs` | 0 | 3,38s | **PASS**, đủ 4 tổ hợp màu ứng dụng/hệ điều hành; CSS dựng mới |
| 5 | `npx tsx docs/audits/v311/independent-probe.ts` | 0 | 1,91s | **18 PASS / 0 FAIL** |
| 6 | `npx tsx docs/audits/v311/dashboard-probe.tsx` | 0 | 2,44s | **8/8 tổ hợp viewport/chế độ màu PASS** |
| 7 | `npx tsx docs/audits/v311/round2/extended-probe.ts` | 0 | 2,81s | **57 PASS / 0 FAIL**, nguyên điều kiện kiểm tra Vòng 2 |

Lệnh thực tế trên Windows dùng `npx.cmd`; cổng 4 dùng `node` nguyên bản. Metadata thời gian UTC, lệnh và mã thoát: [gate-results.json](round3/gate-results.json). Log đầy đủ: `round3/gate1.log` đến `round3/gate7.log`.

Log phase4 có lỗi mạng do test chủ động tạo để kiểm tra nhánh thất bại; cuối bộ test báo PASS và tiến trình trả exit 0. Cảnh báo `stripTypeScriptTypes` là API thử nghiệm của Node. Đã chạy lại TypeScript sau khi thêm probe Round 3: **exit 0**, không sửa cấu hình để loại probe khỏi kiểm tra.

Probe Vòng 2 đã chứa lại 18 assertion gốc; probe Round 3 lại chứa 57 assertion Vòng 2. Vì vậy, không cộng trùng các tổng 18, 57 và 105 để trình bày số ca độc lập.

## 4. Hồi quy và giao diện

- **R1-01:** sentinel lớp thật và ba bản ghi ngoài phạm vi dọn fixture vẫn nguyên nội dung; test Quick Tags chạy thành công.
- **R1-02:** ca gốc hai ghi chú chồng nhau/lần đầu lỗi vẫn giữ thẻ; hai thiếu sót còn lại `R2-01`, `R2-02` nay đã đóng. Không còn finding mở của các vòng trước trong phạm vi tái kiểm này.
- **R1-03:** chỉ kế thừa từ buổi trước hợp lệ; các ca số buổi không xác định, số âm/thập phân, buổi tương lai, hậu tố không hợp lệ và fallback hợp lệ đều đạt trong 57 assertion.
- **Theme:** đủ bốn tổ hợp màu ứng dụng/hệ điều hành đạt kiểm tra tiêu đề, số học viên, ô chọn/nhập và nhãn trạng thái của probe. Tương phản nhỏ nhất đo được ở năm nhãn trạng thái là **5,36:1**. Các mã `R2-01/R2-02` được in bởi theme probe thuộc audit **v3.1.0**, khác hai finding lưu thẻ **v3.1.1** của báo cáo này.

| Viewport | Chiều cao tài liệu Sáng | Chiều cao tài liệu Tối | Tràn ngang | Khoảng thanh lớp–footer |
|---|---:|---:|---|---:|
| 1440×900 | 900px | 900px | Không | 8px |
| 1366×768 | 768px | 768px | Không | 8px |
| 1920×1080 | 1080px | 1080px | Không | 8px |
| 1024×768 | 768px | 768px | Không | 8px |

Hai cột Dashboard cùng hàng/cùng chiều cao ở đủ tám tổ hợp. Đã xem ảnh mới 1366×768 Sáng/Tối: footer hiển thị đầy đủ, không thấy nội dung bị cắt. Dashboard được render tĩnh bằng component/layout thật và dữ liệu tổng hợp; đặt `data-theme` trực tiếp, nhãn nút theme chưa hydration nên không dùng ảnh này để xác nhận hành vi nút chuyển màu. Xem [dashboard-results.json](round3/dashboard-results.json), [ảnh Sáng](round3/dashboard-1366-light.png), [ảnh Tối](round3/dashboard-1366-dark.png).

## 5. Hồ sơ bàn giao, giới hạn và quyết định

Bằng chứng chạy mới được lưu riêng trong `docs/audits/v311/round3/`:

- `gate-results.json`, `gate1.log`–`gate7.log`: kết quả và log bảy cổng.
- `independent-results.json`, `extended-results.json`: 18 và 57 assertion chạy lại từ probe không sửa.
- `supplemental-probe.ts`, `supplemental-results.json`, `supplemental-probe.log`, `supplemental-run.json`: 48 assertion bổ sung, tổng 105/105; `supplemental-typecheck.log`: TypeScript sau khi thêm probe.
- `r201-field-metadata.json`: xác nhận bốn ca xóa trắng qua ghi chú/điểm danh đã ghi metadata trường vào SQLite.
- `dashboard-results.json`, bốn ảnh Dashboard, `theme-probe-results.json`, bốn ảnh theme, `status-contrast-findings.json`, `probe.css`: số đo và CSS mới.
- `reviewed-source-hashes.json`, `environment.json`: định danh nguồn và môi trường cô lập.

Không thay đổi mã ứng dụng, probe/test gốc, DB Owner, `next-env.d.ts` hoặc các hồ sơ audit cũ trong workspace. Chỉ thêm báo cáo/bằng chứng Round 3 và cập nhật `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md` theo AGENTS.md.

Vòng này không chạy production build, toàn bộ test của dự án, toàn bộ năm màn hình có hydration, lưu thật lên LMS hay Gemini thật. Harness hooks không thay thế kiểm thử tương tác React hoàn chỉnh trong trình duyệt. Kết luận GO áp dụng cho commit `3afb54c`, việc đóng hai finding và các cổng/hồi quy đã yêu cầu; không mở rộng thành nghiệm thu toàn bộ hệ thống trên LMS.

Cả ba điều kiện chuyển GO của Vòng 2 đều đã đáp ứng: xóa trắng được chuyển tiếp và lưu bền; điểm danh cả lớp giữ thẻ đang chờ kể cả khi request cũ lỗi; đủ cổng chạy mới đạt cùng 18/18, 8/8 và 57/57 kết quả yêu cầu. Không còn việc sửa bắt buộc cho `R2-01` hoặc `R2-02` trước khi bàn giao trong phạm vi này.

**VERDICT: GO**
