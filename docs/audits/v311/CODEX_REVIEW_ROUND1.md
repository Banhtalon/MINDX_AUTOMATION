# Kiểm định độc lập v3.1.1 — Codex, Vòng 1

**Ngày:** 28/10/2026. **Phạm vi:** `e2c9128..52adb1ba09372399145eacf19b05c20064c28c24` (`HEAD` lúc kiểm định).

**Kết luận: NO-GO.** Bốn cổng bắt buộc đều chạy mới đạt, nhưng probe độc lập tái hiện được **3 lỗi mới**, gồm một lỗi có thể xóa dữ liệu thật khi chạy lệnh kiểm thử bắt buộc. Ngoài ra, yêu cầu Dashboard vừa khung nhìn chưa đạt ở màn hình laptop 1366×768; đây là vấn đề đã có tại commit nền, không phải hồi quy mới trong hai commit v3.1.1.

## 1. Phương pháp và phạm vi bằng chứng

- Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md` và skill `team-workflow`. Theo yêu cầu trực tiếp của Owner, Codex đảm nhiệm vai trò Reviewer độc lập; không sửa mã ứng dụng để làm cho bài kiểm tra đạt.
- Hai commit được xem xét: `9c3e645` và `52adb1b`. `src/app/page.tsx` và bộ nhận diện `ROBOTICS_CLASS_REGEX` đã có ở commit nền `e2c9128`; không có thay đổi Dashboard trong khoảng diff này. Vẫn đánh giá Dashboard theo tiêu chí nghiệm thu được yêu cầu.
- Chạy trong bản sao tạm `C:\Users\QQ\AppData\Local\Temp\mindx-v311-review-fc47a57a42d94e8d826e8ec3475120e9\repo`, dùng SQLite riêng, cấu hình không có khóa Gemini/mật khẩu thật và dùng chung thư viện đã cài qua junction `node_modules`. Không chạy lệnh test ghi/xóa dữ liệu trên SQLite của Owner.
- Node `v24.15.0`, TypeScript `7.0.2`. Dùng `npx.cmd` trên Windows, cùng chương trình và tham số với các lệnh yêu cầu.
- Probe nghiệp vụ gọi handler GET/POST thật và SQLite thật. Probe giao diện chạy các hàm xử lý của component thật bằng bộ mô phỏng React hooks; probe AI chạy mã generator thật, chỉ thay phản hồi Gemini bằng dữ liệu mẫu, không gọi AI trả phí.
- Probe Dashboard render tĩnh component Dashboard và TopNavbar thật, lấy lớp bố cục từ `layout.tsx`, dùng CSS Tailwind được biên dịch từ dự án. Một persistent BrowserContext cô lập tại `./playwright-auth` trong bản sao tạm, thao tác qua SequentialTaskQueue; không mở LMS hay hồ sơ đăng nhập thật. Đã xem ảnh Sáng/Tối.

## 2. Findings cần xử lý

### R1-01 — P1: Lệnh test bắt buộc có thể xóa toàn bộ nhận xét của một lớp thật

**Vị trí chính:** `scripts/test-quick-tags-v300.ts:258`. **Liên quan:** `scripts/test-quick-tags-v300.ts:164`, `src/lib/db/sqlite.ts:34`.

Test dùng mã lớp cố định `VT-ROB-SEMIA05`, mở SQLite tại `process.cwd()/data/mindx_bot.db`, rồi chạy trong `finally`:

```sql
DELETE FROM session_feedbacks WHERE classId = ?
```

Điều kiện xóa chỉ giới hạn theo lớp, không giới hạn học viên/buổi do test vừa tạo. Nếu chạy đúng lệnh yêu cầu ngay trong thư mục dự án đang sử dụng, toàn bộ nhận xét sẵn có của lớp đó cũng bị xóa, bao gồm dữ liệu không thuộc fixture. Nhánh `finally` còn chạy cả khi một assertion trước đó thất bại.

**Tái hiện độc lập, chỉ trên DB tạm:**

1. Tạo nhận xét sentinel cho `VT-ROB-SEMIA05_SESS_07`, học viên `AUDIT_SENTINEL`, khác hoàn toàn hai buổi và các ID học viên của fixture.
2. Chạy nguyên bản `npx tsx scripts/test-quick-tags-v300.ts` bằng tiến trình con.
3. Lệnh trả **exit 0**, nhưng đọc lại sentinel cho kết quả **không còn bản ghi**.

**Tác động:** mất dữ liệu nhận xét cục bộ khi thực hiện chính quy trình QA được yêu cầu. Test báo PASS không chứng minh an toàn dữ liệu.

**Hướng sửa:** cô lập DB/thư mục làm việc ngay trong test hoặc dùng DB được inject; tránh dùng mã lớp thật. Nếu cần dọn fixture, chỉ xóa đúng các khóa test tự tạo và bảo toàn dữ liệu có sẵn. Thêm kiểm tra sentinel trước/sau khi chạy test.

### R1-02 — P2: Xóa dấu kế thừa trước khi lưu thành công làm thẻ không được lưu trong tình huống nhập liên tiếp và lỗi mạng

**Vị trí chính:** `src/app/session-comments/page.tsx:1281`. **Liên quan:** `src/app/session-comments/page.tsx:1119`, `src/app/session-comments/page.tsx:1167`, `src/app/session-comments/page.tsx:1256`, `src/app/session-comments/page.tsx:1356`.

`saveDraftToServer` xóa `inheritedFromSession` ngay khi cập nhật giao diện lạc quan, trước khi có phản hồi lưu thành công. Các lần sửa ghi chú/điểm danh sau đó chỉ đính kèm thẻ kế thừa nếu dấu này vẫn còn.

**Tái hiện bằng handler component thật và endpoint lưu nháp thật:**

1. Buổi 2 có thẻ Robotics tốt; Buổi 3 chưa có bản ghi. Trang điền thẻ và `inheritedFromSession = 2` đúng.
2. Nhập ghi chú lần 1. Request chứa thẻ, nhưng giữ phản hồi ở trạng thái chờ; giao diện đã mất dấu kế thừa.
3. Nhập tiếp ghi chú lần 2. Request lần 2 **không có `quickTags`** và lưu thành công vào DB.
4. Cho lần lưu đầu trả HTTP 500. Do đã có chỉnh sửa mới hơn, phản hồi lỗi bị coi là cũ và không khôi phục snapshot/dấu kế thừa.
5. Đọc SQLite: ghi chú lần 2 đã lưu nhưng `quickTagsJson = "[]"`; giao diện vẫn có thẻ được chọn và không còn dấu kế thừa.

**Tác động:** màn hình và dữ liệu lưu không khớp; các lần sửa ghi chú/điểm danh tiếp theo cũng không chủ động lưu thẻ này. Tải lại có thể lấy lại thẻ từ lịch sử, nhưng đó không phải việc lưu bền vững vào buổi hiện tại như yêu cầu.

**Hướng sửa:** chỉ xác nhận thẻ đã được lưu/xóa dấu chờ lưu sau phản hồi thành công của đúng phiên bản; hoặc theo dõi riêng trạng thái thẻ chưa lưu và đính kèm chúng trong các request kế tiếp cho đến khi được xác nhận. Giữ nguyên bảo vệ chống ghi đè chỉnh sửa mới khi phản hồi cũ về muộn.

### R1-03 — P2: Nhánh dự phòng cho số buổi không xác định cho phép kế thừa sai thứ tự thời gian

**Vị trí chính:** `src/app/api/session-comments/list/route.ts:132`, `src/app/api/session-comments/list/route.ts:135`. **Liên quan:** `src/app/api/session-comments/list/route.ts:101`, `src/app/api/session-comments/list/route.ts:124`.

Chỉ khi cả hai số buổi đều lớn hơn 0 mới áp dụng `rNum < curSessNum`. Các trường hợp còn lại trả `true`, dù không chứng minh được bản ghi thuộc buổi trước. `LEFT JOIN` giữ lại cả lịch sử không có bản ghi buổi học tương ứng.

**Hai ca tái hiện qua GET thật:**

- Buổi hiện tại là Buổi 3 hợp lệ; lịch sử có `..._SESS_UNKNOWN` không nối được bảng buổi học và không có đuôi số. API vẫn trả thẻ từ bản ghi này, không có `fromSessionNumber`.
- Buổi hiện tại `..._SESS_PENDING` không có số buổi và không có hàng `classes_sessions`; một học viên chỉ có thẻ ở **Buổi 5**. API trả thẻ **Buổi 5** làm dữ liệu trước đó.

**Tác động:** vi phạm điều kiện bắt buộc `sessionNumber < curSessNum` khi dữ liệu lịch học thiếu/không nhất quán. Trường hợp lịch sử không có số còn tạo thẻ không có nguồn; các nhánh lưu dựa vào `inheritedFromSession` cũng không nhận diện chúng là thẻ cần lưu. Với các buổi đã đồng bộ đầy đủ và có số hợp lệ, probe chọn buổi gần nhất đúng.

**Hướng sửa:** chỉ cho kế thừa khi xác định được hai số buổi hợp lệ và thỏa điều kiện nhỏ hơn. Khi không xác định được số buổi hiện tại, trả map rỗng hoặc lỗi dữ liệu rõ ràng; không coi mọi bản ghi khác là quá khứ. Nếu hỗ trợ ID cũ, phân tích định dạng có kiểm chứng thay vì lấy mọi đuôi số tùy ý.

## 3. Khoảng thiếu nghiệm thu đã có tại commit nền

### R1-04 — P2, có sẵn: Dashboard chưa vừa khung nhìn ở laptop 1366×768

**Vị trí:** `src/app/page.tsx:87`, `src/app/page.tsx:128`, `src/app/page.tsx:132`, `src/app/page.tsx:291`.

Hai cột cân nhau và không có khoảng trắng lớn dưới cùng. Tuy nhiên, ở 1366×768, render có 5 lớp gần đây tạo chiều cao tài liệu **890px**, vượt khung nhìn **122px**, cả Sáng lẫn Tối; thanh lớp gần đây nằm một phần dưới mép màn hình, footer cần cuộn mới thấy. Ở 1024×768, chiều cao là **1041px**. Vì vậy không thể xác nhận yêu cầu “2-column viewport fit” cho mọi khung desktop đã kiểm tra.

| Khung nhìn | Chiều cao tài liệu Sáng/Tối | Hai cột, không tràn ngang | Khoảng từ thanh lớp đến footer | Vừa chiều cao màn hình |
|---|---:|---|---:|---|
| 1440×900 | 900px | Đạt | 8px | Đạt |
| 1366×768 | 890px | Đạt | 8px | Chưa đạt |
| 1920×1080 | 1080px | Đạt | 8px | Đạt |
| 1024×768 | 1041px | Đạt | 8px | Chưa đạt |

Đây là bố cục đã nằm trong chính `e2c9128`, không phải thay đổi của `e2c9128..HEAD`. Cần giảm độ cao nội dung/padding hoặc bổ sung cách bố trí theo chiều cao màn hình nếu tiêu chí phát hành bắt buộc vừa màn laptop. Probe render tĩnh không bao gồm drawer nhật ký, hydration hay font do môi trường máy khác cung cấp; kết quả trên là giới hạn của cấu hình kiểm tra này.

## 4. Đối chiếu từng yêu cầu

| Yêu cầu | Kết quả | Bằng chứng/giới hạn |
|---|---|---|
| Dashboard cân đối, 2 cột, không khoảng trống lớn dưới cùng | Đạt cân đối; chưa đạt đầy đủ vừa khung nhìn | R1-04; ảnh và số đo 8 tổ hợp kích thước/chế độ |
| Tự nhận diện lớp ROB và dùng 6 thẻ Robotics, Coding 7 thẻ | Đạt các ca cấu hình/mã lớp được kiểm thử | Cổng quick-tags kiểm tra 3 ví dụ ROB nêu trong yêu cầu; helper và bộ lọc track được đối chiếu với cấu hình |
| Bỏ hộp đổi bộ thẻ, không nối thêm nút legacy | Đạt qua đọc diff/render JSX | Đã bỏ cả hộp toolbar và vòng lặp thêm `selLabel`; không khẳng định dữ liệu legacy của buổi hiện tại đã được di trú vì yêu cầu này chỉ bỏ nút thừa |
| Trả lịch sử gần nhất trước buổi hiện tại | Đạt khi số buổi hợp lệ; lỗi khi không xác định số | R1-03; loại được buổi tương lai có số khi hiện tại có số |
| Chuẩn hóa legacy/cross-track; tôn trọng xóa trắng | Đạt các ca được kiểm thử | Legacy `👍 Đạt yêu cầu` thành Robotics tốt; explicit clear ở buổi trước chặn tìm lùi; clear ở buổi hiện tại chặn điền lại |
| Điền thẻ + nguồn khi buổi mới chưa có dữ liệu; bảo toàn finalText hiện có | Đạt các ca bình thường | Probe component thực thi `loadClassData` |
| Lưu kế thừa khi ghi chú/điểm danh đơn lẻ/điểm danh cả lớp/AI thành công | Đạt đường thành công; lỗi đường lưu chồng nhau | 4 đường thành công có đọc lại SQLite; R1-02 |
| Bỏ các helper text trên SPCK | Đạt qua diff | Đã đối chiếu đủ các vị trí được liệt kê: 1A, 1B, 1C, Bước 2, Chuẩn bị Demo, thanh lọc, Bước 3, Bước 4; mô tả gọi “6 cụm” nhưng thực tế liệt kê 8 vị trí |

Những thay đổi SPCK chỉ nằm ở phần trình bày; không thấy thay đổi luồng nộp, đọc/ghi LMS, điểm năng lực, thumbnail hay khóa duyệt trong diff này. Không có thay đổi mới trả bí mật ra client hoặc tạo trình duyệt LMS khác trong mã ứng dụng được sửa.

## 5. Kết quả các cổng bắt buộc

| Lệnh yêu cầu | Exit | Kết quả mới |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 0 | PASS; log không có lỗi |
| `npx tsx scripts/test-quick-tags-v300.ts` | 0 | PASS; vẫn có lỗi an toàn dữ liệu R1-01 |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS toàn bộ bộ kiểm tra hiện có đến Round 17 |
| `node docs/audits/v310/round3/theme-probe.mjs` | 0 | PASS bốn tổ hợp màu ứng dụng/hệ điều hành |

Các thông báo lỗi mạng mẫu trong log phase4 là tình huống lỗi được test chủ động tạo ra; tiến trình kết thúc thành công. Theme probe chỉ kiểm tra fixture/theme mà script xây dựng, không thay thế việc nghiệm thu Dashboard hoặc toàn bộ luồng trên LMS.

Lần thử đầu trong bản sao `git archive` gặp lỗi bộ mô phỏng JSX vì archive tạo CRLF trong khi marker của test yêu cầu LF. Đã chép lại nguyên byte thư mục `src` và `scripts` từ working tree sạch, giữ đúng xuống dòng hiện tại, rồi chạy lại đủ bốn lệnh thành công. Không sửa test/source để né lỗi. Các log bàn giao là lần chạy đạt sau cùng.

**Probe độc lập bổ sung:** 18 kiểm tra, **12 PASS / 6 FAIL**, exit 1 có chủ đích. Sáu assertion thất bại thuộc ba lỗi R1-01–R1-03, không phải sáu nguyên nhân riêng. Probe Dashboard hoàn tất 8 tổ hợp; các assertion về cân cột/khoảng trống/tràn ngang đạt, còn số đo chiều cao chỉ được ghi nhận và nêu tại R1-04, không được script coi là PASS “vừa màn hình”.

## 6. Hồ sơ và giới hạn

Các tệp cùng thư mục báo cáo:

- `gate1-tsc.log`, `gate2-quick-tags.log`, `gate3-phase4.log`, `gate4-theme.log`: log đầy đủ bốn cổng.
- `independent-probe.ts`, `independent-results.json`, `independent-probe.log`: ca tái hiện API, component, AI và xóa sentinel. Script chủ động từ chối chạy ngoài thư mục tạm có tên `mindx-v311-review-`; dùng bản sao cô lập để tái hiện, không chạy test gốc trên DB thật.
- `dashboard-probe.tsx`, `dashboard-results.json`, `dashboard-probe.log`: cách dựng và số đo bố cục.
- `dashboard-1440-light.png`, `dashboard-1440-dark.png`, `dashboard-1366-light.png`, `dashboard-1366-dark.png`: ảnh render đầy đủ chiều dài trang; ảnh 1366px rộng có chiều cao 890px, không phải ảnh vừa viewport 768px.
- `theme-probe-results.json`, `reviewed-source-hashes.json`: kết quả theme và dấu vết mã được kiểm định.

Chưa chạy bản dựng production, bộ 12 test toàn dự án, trình duyệt tương tác đầy đủ trên cả năm trang hay lưu lên LMS thật. Không suy rộng các cổng PASS thành nghiệm thu các phạm vi đó. Không thay đổi mã ứng dụng, test có sẵn, dữ liệu Owner hay lịch sử audit v3.1.0; chỉ bổ sung hồ sơ vòng này và cập nhật ba tài liệu quản lý theo AGENTS.md.

## 7. Điều kiện kiểm định lại

1. Cô lập test Quick Tags và chứng minh nhận xét có sẵn ở lớp trùng mã vẫn nguyên vẹn sau test.
2. Bảo đảm thẻ kế thừa được lưu ngay cả khi lần lưu đầu thất bại và một chỉnh sửa mới hơn đã thành công; giữ bảo vệ chỉnh sửa mới.
3. Loại mọi lịch sử không chứng minh được `sessionNumber < curSessNum`; thêm test cho số buổi không xác định.
4. Xử lý R1-04 nếu tiêu chí phát hành bao gồm vừa khung nhìn laptop 1366×768; ghi rõ kích thước nghiệm thu và kiểm tra lại.
5. Chạy lại đủ bốn cổng cùng probe độc lập. Chỉ đổi verdict sau khi có bằng chứng đóng các lỗi trên.

**VERDICT: NO-GO**
