Verdict: GO

# Kiểm định độc lập v3.4.0 — Chặng S6, Vòng 3

- Ngày: **2026-10-30**. Reviewer: **Codex độc lập**, theo vai trò Owner yêu cầu `gpt-6.1-sol`, high reasoning.
- Mốc kiểm: HEAD **`2ce97352959be286aecb87d8371c70ea6a4fb484` cộng cây làm việc chưa commit**, không phải riêng HEAD. Nguồn được chốt trong [source-before.json](s6-round3/source-before.json), [working-tree.patch](s6-round3/working-tree.patch) và [bản chụp bốn tệp được sửa](s6-round3/reviewed-source/).
- Đã đối chiếu `PROJECT_STATE.md`, `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, [Round 1](CODEX_S6_ROUND1.md) và [Round 2](CODEX_S6_ROUND2.md).
- Phạm vi: đóng ba lỗi còn mở và kiểm hồi quy S6 cho ứng dụng cục bộ của một giáo viên. Không sửa mã ứng dụng hoặc bài kiểm thử sản phẩm.

## Kết quả chính

**7/7 phát hiện `S6-01`–`S6-07` CLOSED trong phạm vi kiểm định S6 cục bộ.** Ba lỗi còn mở `S6-02`, `S6-03`, `S6-04` không còn tái hiện; bốn mục đã đóng ở Round 2 không bị mở lại. Không phát hiện lỗi mới cần chặn trong phạm vi đã kiểm.

**Chạy mới: 20/20 kiểm tra dữ liệu/API và 34/34 kiểm tra giao diện PASS; TypeScript PASS; bộ S6 đủ S6-T1–S6-T4 PASS.** Đọc trực tiếp các trường `expected`, `actual`, `pass` trong JSON, không dùng riêng mã thoát của probe để kết luận. Không có lần chạy lại hoặc thay đổi probe để làm kết quả đạt.

**Final Verdict: GO cho việc đóng S6 trong phạm vi cục bộ.** Chưa xác nhận bản đóng gói production sạch, LMS/Teaching thật hoặc toàn bộ v3.4.0. Giới hạn build đã ghi ở Round 2 vẫn cần được xử lý riêng trước nghiệm thu production.

## Trạng thái cả bảy phát hiện

| Mã | Mức độ ban đầu | Trạng thái Round 3 | Bằng chứng và kết luận |
| --- | --- | --- | --- |
| S6-01 | HIGH | **CLOSED** | `UI06`–`UI09`, `R2-UI30`–`R2-UI32` PASS: đổi A → B chưa nộp không mở nút 100%/Phiếu điểm và không gửi tiến độ cho B; phản hồi A muộn không hiện ở B; đổi buổi không khôi phục gợi ý cũ. Hook và các tệp ngoài bốn tệp Round 3 giữ nguyên so với Round 2. |
| S6-02 | MEDIUM | **CLOSED** | `UI13`, `R2-UI21`, `R2-UI27`–`R2-UI29` PASS: bài FAILED ngoài đợt mới nhất vẫn chặn; `rows=[]` không dùng thống kê cũ mở nút; thao tác bỏ ghép cả hai học viên sau combo trên trang thật làm ẩn cả hai gợi ý. |
| S6-03 | MEDIUM | **CLOSED** | `UI10`–`UI12`, `R2-UI18`, toàn bộ `R2-UI19-*`, `R2-UI20`, `R2-UI22`, `R2-UI25`, `R2-UI26` PASS: đủ đúng học viên/VERIFIED thì mở; đánh giá DRAFT/WAITING_APPROVAL/FAILED/thiếu/sai ID hoặc SPCK bẩn đều khóa. Sửa thư làm mất link ngay khi gõ và vẫn khóa sau khi lưu nháp. |
| S6-04 | MEDIUM | **CLOSED** | `DB01`–`DB08`, `DB11`, `R2-DB12`–`R2-DB17` PASS: thiếu dòng của người đang học vẫn chặn, ABSENT không chặn Nhận xét; người đã nghỉ có DRAFT/FAILED không chặn Nhận xét, SPCK hoặc Đánh giá. Bộ S6 cũng bổ sung ba đối chứng inactive. |
| S6-05 | MEDIUM | **CLOSED** | `DB09`, `R2-DB18`, `R2-DB19` PASS: 99,9% và thiếu khóa tiến độ chưa hoàn tất, đủ 100% mới hoàn tất. Phép tính tiến độ không thay đổi ở Round 3. |
| S6-06 | MEDIUM | **CLOSED** | `API01`, `R2-UI23`, `R2-UI24` PASS: thiếu lịch trả buổi 0, khóa nút tự động và không POST tiến độ. API/mapper/trang Teaching giữ nguyên so với Round 2. |
| S6-07 | MEDIUM | **CLOSED về mã và bằng chứng chẩn đoán đã có** | `src/app/page.tsx` giữ nguyên hash Round 2, vẫn có `dynamic="force-dynamic"`, `revalidate=0`; S6-T3 chạy mới kiểm cấu hình này. Tái sử dụng [bằng chứng production chẩn đoán Round 2](s6-round2/production-observation.json) cho đúng nguồn không đổi: hai request thấy lần lượt Buổi 12 và 14. Không chạy lại build/start ở Round 3; không tuyên bố production sạch. |

Kết quả chi tiết: [repository-observations.json](s6-round3/repository-observations.json), [ui-observations.json](s6-round3/ui-observations.json).

## Đánh giá bốn tệp Round 3

[Đối chiếu nguồn](s6-round3/source-changes-since-round2.json) xác nhận **chỉ bốn tệp `src/**`/`scripts/**` khác Round 2**, đúng phạm vi yêu cầu. Diff được dựng từ HEAD + patch Round 2 đối với tệp đã được Git quản lý, và từ bản chụp Round 2 đối với tệp mới: [round2-to-round3.patch](s6-round3/round2-to-round3.patch).

### `SubmitBar.tsx` — khóa theo bài và đánh giá hiện tại

Tại dòng 60–109, số bài VERIFIED chỉ lấy từ dòng đang ghép, sạch và VERIFIED đúng buổi. Mọi dòng chưa ghép hoặc chưa đạt đều tham gia số chưa hoàn tất; tập rỗng không quay về kết quả lịch sử. Vì thế cả ca `rows=[]` và thao tác bỏ ghép thật đều chặn đúng gợi ý.

Tại dòng 111–150, bản đồ đánh giá theo `studentId` yêu cầu từng học viên đang ghép có đánh giá VERIFIED, đồng thời toàn bộ đánh giá trong lớp phải VERIFIED. Không dùng `evalVerifiedCount` của combo cũ thay cho trạng thái hiện tại. Danh sách thử lại/lỗi combo vẫn chặn. Đối chứng đủ hai phần giữ link đúng `classId` và `autoScan=1`; `UI14/15` xác nhận quét đúng lớp một lần và tải lại Phiếu điểm sau quét.

### `StudentRow.tsx` — mất trạng thái đã duyệt ngay khi sửa

Đã đọc cả bốn `onChange` của `learnedFromMindx`, `suggestionsFromMindx`, `futureDirection`, `awardRanking` tại dòng 1122–1254 và luồng lưu nháp trong `useSpckWorkflow.ts`. Cả bốn đều xóa `contentHash`; bản VERIFIED/APPROVED chuyển ngay thành WAITING_APPROVAL, các trạng thái chưa duyệt khác giữ nguyên. Việc hạ trạng thái không còn đợi `onBlur`.

`R2-UI25/26` kiểm thực tế trường thư trên trang/component thật, trước và sau rời ô. Ba trường còn lại được đối chiếu mã cùng cách cập nhật; không tuyên bố đã gõ riêng cả bốn trường trong trình duyệt.

### `today-tasks.ts` — dùng danh sách đang học làm căn cứ

Tại dòng 322–450, khi lớp đã có danh sách trong `students`, chỉ `isActive=1` thuộc tập bắt buộc. Quy tắc áp dụng thống nhất cho Nhận xét, SPCK theo buổi và Đánh giá 14; không hợp thêm ID từ dữ liệu cũ của người đã nghỉ. Nhận xét tiếp tục bỏ qua ABSENT. Khi chưa có danh sách trong DB mới dùng ID từ các bảng nghiệp vụ; khi có danh sách nhưng không còn ai active, không đánh dấu hoàn tất nhờ dữ liệu cũ.

### `test-streamline-v340-s6.ts` — thêm hồi quy đúng ba nhóm lỗi

Đã bổ sung ba ca inactive ở S6-T2 và luồng sửa thư/bỏ ghép ở S6-T4. Bộ đầy đủ chạy mới đạt bốn nhóm. Một giới hạn của bài UI mới: đoạn sửa thư dùng `if (count > 0)`, nên có thể bỏ qua nhánh nếu giao diện mất ô/nút tương ứng; ca bỏ ghép cũng chạy sau khi đã sửa đánh giá. Đây là điểm cần biết khi dùng riêng bộ S6 làm cổng về sau. Round 3 vẫn có bằng chứng độc lập không bỏ qua: `R2-UI25/26` và luồng combo thành công mới → bỏ ghép `R2-UI28/29` đều PASS. Không còn thiếu bằng chứng đóng lỗi ở vòng này.

## Lệnh và kết quả chạy mới

| Lệnh | Nơi chạy | Exit | Kết quả |
| --- | --- | --- | --- |
| `npx tsc --noEmit --incremental false` | Workspace gốc | 0 | PASS; không đưa probe `.ts` vào workspace |
| `npx tsx repository-probe.ts` | Bản sao TEMP | 0 | **20/20 PASS**; probe Round 2 nguyên bản |
| `npx tsx independent-ui.ts` | Bản sao TEMP | 0 | **34/34 PASS**; probe Round 2 nguyên bản, Chromium và component/trang thật |
| `npx tsx scripts/test-streamline-v340-s6.ts` | Bản sao TEMP | 0 | **S6-T1–S6-T4 PASS** |

Nhật ký/thời lượng/thư mục/biến cô lập: [checks.jsonl](s6-round3/checks.jsonl). Log: [TypeScript](s6-round3/tsc.log), [repository](s6-round3/repository-probe.log), [UI](s6-round3/independent-ui.log), [S6](s6-round3/test-streamline-v340-s6.log). Mã dựng môi trường và chạy: [prepare.py](s6-round3/prepare.py), [run-checks.py](s6-round3/run-checks.py).

**Không chạy lại toàn bộ 18 cổng hoặc build production ở Round 3.** Kết quả 18/18 và bốn lỗi route gây hỏng build là bằng chứng lịch sử Round 2, không phải số kiểm thử chạy mới vòng này. Chỉ tái sử dụng kiểm production của S6-07 sau khi xác nhận nguồn liên quan không đổi.

## An toàn, tính toàn vẹn và giới hạn

- Trước mọi tiến trình kiểm thử đã cấp `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` và `ALLOWED_LOCAL_DIRS` trỏ vào TEMP. Probe dữ liệu và bộ S6 tự đặt đường dẫn con riêng, vẫn dưới TEMP. Có khóa Gemini giả để không dùng khóa thật.
- Bản sao chỉ chứa nguồn, bài kiểm tra, cấu hình xây dựng và ảnh mặc định cần thiết; không chép `.env`, DB/cache vận hành hoặc `playwright-auth`. Thư viện đã cài được dùng qua junction, không cài/cập nhật môi trường.
- Probe giao diện dùng một persistent BrowserContext mới trong TEMP, chạy tuần tự. Phản hồi nghiệp vụ được giả lập; mạng ngoài trang localhost giả bị chặn. Không đọc/ghi LMS/Teaching/Gemini thật.
- **Không mở, băm, sao chép hoặc kết nối `data/mindx_bot.db`, `data/running_classes.json` hay hồ sơ đăng nhập thật.** Không đưa ra khẳng định hash dữ liệu Owner giữ nguyên vì không đọc các tệp đó.
- **142/142 tệp nguồn/test cùng `next-env.d.ts` giữ nguyên trong quá trình audit**, bản sao nguồn khớp workspace; hai probe khớp bản Round 2. Xác nhận trong [source-integrity.json](s6-round3/source-integrity.json). Chỉ thêm hồ sơ kiểm định và cập nhật ba tài liệu bắt buộc; không commit.

## Bàn giao

S6 đủ điều kiện **đóng cục bộ**, không còn phát hiện mở trong bảy mục đã kiểm. Có thể chuyển sang lập/kiểm chặng tiếp theo theo kế hoạch; audit này không tự triển khai S7. Trước nghiệm thu production cần kiểm lại build sạch và dịch vụ thật trong một phạm vi được duyệt riêng. Owner chưa cần thao tác với tài khoản hoặc dữ liệu thật cho kết quả Round 3 này.
