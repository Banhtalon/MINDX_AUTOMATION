# Kiểm định độc lập v3.4.0 — Chặng S5b, Vòng 2

**Verdict: NO-GO.** Đóng **6/7** mục Vòng 1; **S5B-02 còn PARTIALLY FIXED**. Lỗi nghiêm trọng báo hoàn tất khi Sản phẩm lỗi sớm đã được sửa, nhưng yêu cầu bổ sung của Vòng 2 — **xóa trạng thái đợt cũ ngay khi bắt đầu `partToRun === "both"`** — chưa được thực hiện trên trạng thái giao diện. Còn một thiếu sót **MEDIUM**, có tái hiện bằng Chromium và ảnh chụp.

**17/17 cổng kiểm thử đạt kết quả cuối**, kể cả TypeScript. Có **32 bản ghi quan sát độc lập**: 31 bản ghi đóng lỗi/đối chứng và 1 bản ghi tái hiện thiếu sót còn lại; đây không phải tổng số assertion. Cổng xanh không thay thế yêu cầu hành vi chưa đạt.

## 1. Phạm vi, bản mã và dữ liệu

- Ngày kiểm định: **30/10/2026**, múi giờ Việt Nam. Codex trực tiếp thực hiện vai trò Reviewer độc lập được yêu cầu; không lấy lời tự kiểm của người triển khai làm kết luận nghiệm thu. Tên `gpt-6.1-sol high` là cấu hình được yêu cầu, không phải danh tính model đã được một công cụ runtime độc lập xác nhận.
- Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`.
- HEAD: **`a78c5a1b1b67735f6e9987d06c437513e771ae06` cộng cây làm việc chưa commit**. Kết luận gắn với nội dung trong [source-before.json](s5b-round2/source-before.json), không áp dụng riêng cho HEAD sạch.
- Đã đối chiếu [Vòng 1](CODEX_S5B_ROUND1.md), `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, và `S5b.1–S5b.9` của kế hoạch duyệt tại `C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md`. Bản kế hoạch dùng trong lần kiểm này: [approved-plan.source.md](s5b-round2/approved-plan.source.md).
- Lần theo trang, hook, nơi gọi công cụ, các route và kho bản nháp; giả định sử dụng là một giáo viên vận hành bot trên máy cục bộ.
- Không sửa mã sản phẩm hoặc bài kiểm thử sản phẩm, không commit/push. Giữ nguyên mọi thay đổi có sẵn. Chỉ thêm hồ sơ kiểm định và cập nhật ba tài liệu tiến độ theo `AGENTS.md`.

Trước các lệnh chạy, đặt:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\codex_s5b_r2.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\codex_s5b_r2_classes.json"
```

Toàn bộ 17 cổng chạy trong bản sao **`C:\Users\QQ\AppData\Local\Temp\codex-s5b-r2-d7g4vo_s`**, không chứa `.env` thật hoặc hai tệp dữ liệu vận hành. Một số bài cũ tự đặt lại đường dẫn dữ liệu; các đường dẫn đó vẫn nằm trong bản sao TEMP. Thư viện đã cài và lịch sử Git được dùng chung qua junction để chạy đúng mã/thư viện và đọc `git show`; không cài lại thư viện. Khóa Gemini dùng trong kiểm thử là chuỗi giả, các lời gọi AI được bài kiểm thử mô phỏng.

Không mở/băm/sao chép hai tệp `data/mindx_bot.db`, `data/running_classes.json` thật. Không đăng nhập hoặc ghi lên LMS/Teaching/Drive/GitHub/YouTube thật. Bài kiểm giao diện dùng trang cục bộ, phản hồi giả và chặn yêu cầu mạng thực. Bài kiểm kho dữ liệu dùng route, bộ đọc XLSX và SQLite thật với dữ liệu giả trong TEMP.

**139/139 tệp `src/**` và `scripts/**` có sẵn giữ nguyên SHA-256, kích thước, thời gian ghi.** Xem [source-integrity.json](s5b-round2/source-integrity.json), [working-tree.patch](s5b-round2/working-tree.patch), [bản bài S5b chưa được Git theo dõi](s5b-round2/test-streamline-v340-s5.source.txt). Bản sao TEMP và dữ liệu giả được giữ lại để có thể kiểm lại.

## 2. Kết quả từng phát hiện Vòng 1

| Mục | Mức độ Vòng 1 | Kết quả Vòng 2 | Bằng chứng chính |
|---|---|---|---|
| S5B-01 | HIGH | **CLOSED** | `currentRows` nhận kết quả từng bước. Web chạy Quét → Chụp → Web → Drive; các lần lưu dùng phiên bản `2,2,4,4`, không xung đột, giữ ảnh/link. Robotics chạy Quét → YouTube → Drive, giữ video/ảnh. Lỗi lưu trước Web/Drive chặn gọi công cụ và tạo nút thử lại đúng dòng. |
| S5B-02 | HIGH | **PARTIALLY FIXED** | Các lỗi sớm đã có summary/retry, phần Đánh giá vẫn chạy, thử lại riêng Sản phẩm không nộp lại Đánh giá. Tuy nhiên, bắt đầu đợt `both` mới vẫn giữ kết quả/lỗi/retry của đợt cũ trên giao diện trong lúc chờ; chi tiết bên dưới. Phần còn lại xếp **MEDIUM**, không giữ nguyên mức HIGH của lỗi đã sửa. |
| S5B-03 | MEDIUM | **CLOSED** | Lớp hỗn hợp điểm dương/0 và lớp toàn 0 gọi nhập một lần với `onlyMissingStudents: true`; lớp toàn điểm dương không gọi. Route thật + XLSX + SQLite giữ toàn bộ bản ghi điểm dương, chỉ cập nhật dòng thiếu. |
| S5B-04 | MEDIUM | **CLOSED** | Kiểm 0/2, 1/2, 2/2 học viên cần nộp qua tải lớp, sau Quét và chuyển Buổi 12 → 13 đều đúng; không chọn lại cả lớp khi đã nộp hết. |
| S5B-05 | MEDIUM | **CLOSED** | Kiểm cả Sản phẩm và Đánh giá: 1 VERIFIED + 1 lỗi → thử lại còn lỗi → thử lại thành công = 2 VERIFIED. Chỉ gửi `STU_02`, không gọi lại phần kia, không đếm trùng. |
| S5B-06 | MEDIUM | **CLOSED** | `promptSample = aiRes.outboundPromptSample || ""` vẫn phải vượt assertion nội dung prompt; TypeScript và S5b cùng exit 0. Không tắt kiểm kiểu hoặc bỏ test khỏi dự án. |
| S5B-07 | MEDIUM | **CLOSED** | Kế hoạch và mã thống nhất 5 nhánh. Đối chứng bằng `.js`, `.html`, `.py`, `.exe`, `.sb3`, `.pdf`, mã có hậu tố số, và Robotics có/không Playlist. App/Python/Scratch/Game có Chụp → Drive là tiêu chí đã thống nhất của Vòng 2. |

### S5B-01 — Đã giữ phiên bản và tài nguyên qua các bước

Các điểm đã đối chiếu: `useSpckWorkflow.ts:1158`, `:1355`, `:1627`, `:3325`, `:3562`; `page.tsx:1508`, `:2473`; route Web/Drive tại dòng `56`/`46` có đồng bộ tài nguyên vào đúng bản nháp buổi đang chọn.

- `R2-P01`: phản hồi ảnh mới và link mới được truyền qua các lần lưu, không chỉ tăng số phiên bản trên phản hồi giả.
- `R2-P02`: YouTube → Drive không làm mất video hoặc hai ảnh thuyết trình.
- `R2-M-saveFail`: lưu nháp 409 trước Web/Drive không gọi hai API công cụ, có hai nút thử lại tương ứng.
- `R2-DB01-capture/web/drive`: kho dữ liệu và route lưu thật lần lượt giữ bản nháp **2 → 3 → 4 → 5**, trả HTTP 200 với phiên bản hiện hành; link Web vẫn còn sau bước Drive. `R2-DB02` chứng minh phiên bản cũ vẫn bị chặn HTTP 409, không làm yếu khóa bảo vệ.

Hàm trả kết quả và `runAutoPrepAfterScan` đủ để đóng lỗi phiên bản Vòng 1. Chưa thực hiện chụp ứng dụng, triển khai Web hoặc tải Drive thật.

### S5B-02 — Lỗi sớm đã sửa; trạng thái đợt cũ chưa được xóa ngay đầu đợt mới

**Phần đã đạt:** `page.tsx:1945` đã trả/lưu summary khi trùng học viên, lưu nháp lỗi, duyệt lỗi/không duyệt được ai, upload lỗi và exception. Nhánh `both` có bộ tổng hợp mới và fallback khi hàm Sản phẩm trả về giá trị không phải object. Sáu ca `R2-P03-*` kiểm lưu 409, từ chối duyệt, không có ID duyệt, phản hồi lỗi có skipped, upload 500 và mất mạng; đều hiện retry Sản phẩm, giữ kết quả Đánh giá, sau đó thử lại đúng phần. Nhánh trùng học viên và fallback được đối chiếu thêm bằng đọc mã; không tính là ca trình duyệt độc lập.

**Phần còn thiếu — MEDIUM (`S5B-02-R2`, không phải phát hiện độc lập thứ tám):**

- **Nguyên nhân:** `setSession14ComboStatus` ở `useSpckWorkflow.ts:3390` trải `...prev`, chỉ đổi `running/currentPhase`. Lần cập nhật ở `:3413` tiếp tục giữ `prev`. Các biến `nextSpckSummary`, `nextEvalVerified`, `nextEvalRetryIds`, `nextEvalError` được xóa ở `:3396–3409` chỉ là biến của hàm, chưa thay đổi trạng thái đang hiển thị. Bảng `lastSubmissionSummary` cũ cũng chưa được xóa. `SubmitBar.tsx:40`, `:62`, `:200`, `:220` tiếp tục đọc các giá trị cũ.
- **Tái hiện:** Đợt A nộp Sản phẩm 2/2; Đánh giá có 1 VERIFIED + 1 lỗi. Bắt đầu đợt B bằng nút **Nộp Buổi 14 đầy đủ**, giữ yêu cầu lưu nháp đầu tiên ở trạng thái chờ. Đợt B chưa gọi duyệt/upload Đánh giá, nhưng màn hình vẫn ghi **“Đã lưu & xác minh 1 học viên (1 cần thử lại)”**, lỗi cũ **“Không tìm thấy nút Lưu cho Ngọc”**, và nút thử lại Đánh giá của A. Bảng kết quả Sản phẩm cũ 2/2 cũng còn. Xác nhận bằng yêu cầu mạng và ảnh, không dựa riêng vào tìm kiếm chuỗi trong mã.
- **Ảnh hưởng:** Trong lúc mạng chậm, kết quả hai đợt bị trộn trên bảng theo dõi. Giáo viên không có một trạng thái mới sạch như tiêu chí Vòng 2 yêu cầu. **Nút cũ đã bị vô hiệu hóa khi đang chạy**, nên chưa chứng minh có thể bấm nó để nộp nhầm. **Kết quả cuối của B được đặt lại đúng**: sau trả 409, Sản phẩm có 2 retry và Đánh giá 2 thành công. Không kết luận lỗi báo hoàn tất sai của Vòng 1 còn nguyên, không có bằng chứng xóa dữ liệu VERIFIED trong SQLite.
- **Cách sửa nhỏ nhất:** Ngay trước lần `await` đầu tiên của nhánh `both`, đặt trạng thái giao diện của đợt mới về giá trị rỗng: summary Sản phẩm, số/ID VERIFIED Đánh giá, số lỗi, retry IDs và lỗi Đánh giá. Xóa hoặc tách rõ bảng kết quả tạm của đợt cũ khỏi đợt mới. Nhánh thử lại riêng vẫn giữ kết quả phần kia. Chỉ thay trạng thái màn hình, không xóa lịch sử VERIFIED đã lưu.
- **Sau khi sửa:** Kiểm tại thời điểm yêu cầu đầu tiên còn đang chờ: không có số xác minh/lỗi/retry đợt A trong bảng đợt B. Sau phản hồi lỗi sớm vẫn có retry Sản phẩm, Đánh giá vẫn chạy độc lập. Kiểm lại thử riêng từng phần không mất tổng tích lũy.

Bằng chứng: [reset-probe.ts](s5b-round2/reset-probe.ts), [reset-observations.json](s5b-round2/reset-observations.json), [nội dung màn hình lúc chờ](s5b-round2/reset-during.txt), [ảnh chụp lúc chờ](s5b-round2/R2-reset-during.png), [log](s5b-round2/reset-probe.log). Exit 0 của probe này có nghĩa **đã tái hiện đúng thiếu sót**, không có nghĩa tiêu chí xóa trạng thái đã đạt.

### S5B-03–S5B-07 — Các ranh giới đã kiểm thêm

- **Demo:** Điều kiện còn thiếu ở `useSpckWorkflow.ts:2493`; cờ chỉ nhập dòng thiếu ở `:2390`; route truyền cờ tại `import-demo-scores/route.ts:14–26`; bộ đọc kiểm điểm dương trước lưu tại `spck-demo-score-reader.ts:731`. `R2-DB03` dùng XLSX cùng hai học viên: giữ **toàn bộ bản ghi** của người có điểm 4, nhập người còn thiếu thành 4,5. `R2-DB04` nhập lại không đổi phiên bản hoặc dữ liệu người đã có điểm; `R2-DB05` nhập thủ công vẫn cho phép cập nhật cả hai.
- **Buổi 13:** Cả ba điểm `page.tsx:1107`, `:1481`, `:2678` dùng danh sách chưa nộp kể cả rỗng. `R2-P05-*` kiểm đủ ba đường chuyển trạng thái với ba mức chọn.
- **Retry:** `types.ts:401` có ID VERIFIED Đánh giá; `useSpckWorkflow.ts:3049` trả ID; `:3436–3475` và `:3491–3513` gộp theo ID. `R2-P06-spck/eval` kiểm cả retry thất bại lặp lại lẫn thành công sau đó.
- **TypeScript:** `scripts/test-streamline-v340-s5.ts:157` dùng giá trị chuỗi dự phòng; các assertion tiếp theo vẫn yêu cầu nội dung prompt thật, nên prompt rỗng sẽ không làm test xanh.
- **Ma trận:** `useSpckWorkflow.ts:3585–3600` nhận hậu tố chữ/số. `R2-M-JSI01`, `UNCLASSIFIED01`, `PTA08`, `GMA22`, `SB28`, `CANVA01`, `ROB01` kiểm lần lượt Web theo mã, Web theo HTML, Python, Game, Scratch, thiết kế và Robotics không Playlist; `R2-P02` kiểm Robotics có Playlist. Ma trận này khớp bản kế hoạch Vòng 2, giải quyết sai khác tiêu chí của Vòng 1.

## 3. Đối chiếu S5b.1–S5b.9

| Mục | Kết quả cục bộ | Bằng chứng/giới hạn |
|---|---|---|
| S5b.1 | ĐẠT | Công tắc mặc định bật, chuỗi phiên bản/tài nguyên và ma trận đúng qua S5b + probe Web/Robotics/7 loại tệp/mã lớp. |
| S5b.2 | ĐẠT | Hủy xác nhận không gọi công cụ, giữ cơ chế bảo vệ dòng đã duyệt; S5b và hồi quy v270/v272 đạt. |
| S5b.3 | ĐẠT | Retry công cụ lỗi được hiện và ẩn sau thành công; thêm đối chứng lỗi lưu trước Web/Drive. |
| S5b.4 | **CHƯA ĐẠT trọn vẹn** | AI gộp, hai luồng nộp, tab học viên, lỗi sớm và tổng retry đã đạt; còn trạng thái cũ khi bắt đầu đợt mới (`S5B-02-R2`). |
| S5b.5 | ĐẠT | Tự nhập Demo toàn thiếu/thiếu một phần, bỏ qua khi đủ; giữ điểm hiện có bằng API + SQLite thật; ô nguồn thủ công còn hiện. |
| S5b.6 | ĐẠT | Chọn Buổi 13 0/N đúng; prompt vẫn có tiến bộ so với Buổi 12 và bằng chứng được kiểm trong S5b. |
| S5b.7 | ĐẠT | S5b kiểm các thành phần không còn khối `{false &&`; đối chiếu các tệp liên quan. |
| S5b.8 | ĐẠT trong phạm vi kiểm | Guardrail tên/nhận xét và Logo MindX qua S5b, v270/v272, Phase 6; chưa xác nhận Gemini hoặc tải LMS thật. |
| S5b.9 | Cổng đạt, nghiệm thu còn chờ | TypeScript và S5b đạt; probe độc lập tìm thấy một tình huống bắt đầu lại chưa được bài S5b gốc kiểm. |

Không nghiệm thu số lần bấm 6 → 4 / ~11 → ~6 với giáo viên và lớp thật trong lần này.

## 4. Cổng kiểm thử chạy mới

Các lệnh dưới đây chạy trên bản sao nguồn hiện tại trong TEMP, với ba biến môi trường nói trên. TypeScript còn được chạy lại ở thư mục gốc với `--incremental false`, exit 0: [tsc-final.log](s5b-round2/tsc-final.log).

| Lệnh | Exit cuối | Log |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 0 | [tsc.log](s5b-round2/tsc.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | [S5b](s5b-round2/test-streamline-v340-s5.log) |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | 0 | [S5a](s5b-round2/test-streamline-v340-s5a.log) |
| `npx tsx scripts/test-spck-v270.ts` | 0 | [v270](s5b-round2/test-spck-v270.log) |
| `npx tsx scripts/test-spck-v272.ts` | 0 | [v272](s5b-round2/test-spck-v272.log) |
| `npx tsx scripts/test-phase6.ts` | 0 | [Phase 6](s5b-round2/test-phase6.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | [Phase 5](s5b-round2/test-phase5.log) |
| `npx tsx scripts/test-phase7.ts` | 0 | [Phase 7](s5b-round2/test-phase7.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | [Phase 4](s5b-round2/test-phase4-codex-repros.log) |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 0 | [v280](s5b-round2/test-lms-reliability-v280.log) |
| `npx tsx scripts/test-session14-v290.ts` | 0 | [Buổi 14](s5b-round2/test-session14-v290.log) |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | [Lượt chạy lại](s5b-round2/test-teaching-project-v320-rerun.log) |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | [Phiếu điểm](s5b-round2/test-report-card-v330.log) |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 0 | [S1](s5b-round2/test-streamline-v340-s1.log) |
| `npx tsx scripts/test-streamline-v340-s2.ts` | 0 | [S2](s5b-round2/test-streamline-v340-s2.log) |
| `npx tsx scripts/test-streamline-v340-s3.ts` | 0 | [S3](s5b-round2/test-streamline-v340-s3.log) |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | [S4](s5b-round2/test-streamline-v340-s4.log) |

**Lần chạy đầu Teaching v320 exit 1** do Windows trả `EPERM` lúc bài kiểm tự xóa thư mục TEMP tại dòng 1534; không có assertion sản phẩm được báo lỗi trước đó. Chạy lại **nguyên bài, không sửa mã/test**, cả TP-01–TP-06 đạt, exit 0. Giữ [log đầu](s5b-round2/test-teaching-project-v320.log), [nhật ký các cổng](s5b-round2/gates.jsonl) và [nhật ký chạy lại](s5b-round2/rerun-gates.jsonl). Không tính lượt chạy lại thành cổng thứ 18.

Bài S5a so sánh `93b77e0` với commit cố định `a78c5a1`, **không so sánh giao diện S5b hiện tại**. Chín cặp HTML/PNG bằng nhau chứng minh mốc tách trang S5a; không dùng kết quả đó thay bằng chứng hành vi mới S5b. Tệp ảnh lịch sử của dự án gốc không bị ghi đè.

## 5. Hồ sơ độc lập và cách diễn giải

| Bộ bằng chứng | Số bản ghi | Kết quả |
|---|---:|---|
| [independent-probe.ts](s5b-round2/independent-probe.ts), [observations.json](s5b-round2/observations.json) | 16 | Các ca phiên bản, lỗi sớm, Demo, chọn Buổi 13, retry hai phần đạt kỳ vọng đóng lỗi. |
| [matrix-probe.ts](s5b-round2/matrix-probe.ts), [matrix-observations.json](s5b-round2/matrix-observations.json) | 8 | Bảy biến thể ma trận và lỗi lưu trước Web/Drive đạt. |
| [repository-probe.ts](s5b-round2/repository-probe.ts), [repository-observations.json](s5b-round2/repository-observations.json) | 7 | API/kho dữ liệu/đọc XLSX thật với dữ liệu TEMP đạt các đối chứng đóng lỗi. |
| [reset-probe.ts](s5b-round2/reset-probe.ts), [reset-observations.json](s5b-round2/reset-observations.json) | 1 | Tái hiện thiếu reset đầu đợt; trạng thái kết thúc sau đó đúng. |

Probe giao diện dùng lại phần dựng trang và dữ liệu giả của test S5b hiện tại, nhưng có kiểm tra riêng, phản hồi tăng phiên bản, tài nguyên phân biệt giữa từng bước, phản hồi lỗi và yêu cầu chờ có thể chủ động giải phóng. Không sửa test sản phẩm. Probe kho dữ liệu kiểm chứng riêng lớp bảo vệ phiên bản và việc giữ điểm, không gọi dịch vụ từ xa.

Các lần chuẩn bị probe đầu có lỗi tên nhãn nút, chuỗi nhận diện bảng kết quả hoặc thiếu thư mục đích ở bản sao. Đã sửa **chỉ hồ sơ probe kiểm định**, giữ log đầu `*-initial.log`; kết quả trong bảng lấy lần chạy cuối đúng. Đây không phải lỗi ứng dụng. Những probe khác đã thu đủ bằng chứng không bị chạy lại sau đó chỉ để tăng số lượt.

## 6. Điều kiện chuyển GO và việc tiếp theo

1. Người triển khai xử lý đúng **`S5B-02-R2`**: đặt lại trạng thái màn hình ngay khi bắt đầu đợt `both`; giữ nguyên tích lũy của nhánh retry riêng và dữ liệu VERIFIED đã lưu.
2. Bổ sung kiểm thử bắt đầu đợt mới khi đợt trước còn lỗi, giữ phản hồi đầu tiên ở trạng thái chờ để kiểm **trước khi hoàn tất**, sau đó kiểm lỗi sớm và retry riêng.
3. Reviewer kiểm lại tình huống này và các phần có nguy cơ bị ảnh hưởng trên đúng bản sau sửa. Không sửa thêm sáu mục đã đóng nếu không có hồi quy.

**Đã làm:** Kiểm lại đủ bảy phát hiện, 17 cổng, 32 bản ghi độc lập; lưu bằng chứng và đề xuất sửa nhỏ nhất.

**Kết quả:** **NO-GO cho S5b Vòng 2** vì một yêu cầu reset đầu đợt chưa đạt. Sáu mục đã đóng; nguyên nhân HIGH ở S5B-02 đã sửa, chỉ còn phần MEDIUM nêu rõ trên.

**Chưa kiểm tra:** vận hành LMS/Teaching thật, đăng nhập/tải Drive/GitHub/YouTube thật, Gemini thật, toàn bộ bố cục trên nhiều kích thước màn hình, số bấm thực tế và bản dựng phát hành đầy đủ (`npm run build`).

**Việc tiếp theo:** Người triển khai sửa phần trạng thái đợt mới rồi gửi kiểm lại. Owner chưa cần thao tác kỹ thuật; chưa chuyển chặng chỉ dựa vào các cổng xanh.
