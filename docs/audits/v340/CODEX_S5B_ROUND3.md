# Kiểm định độc lập v3.4.0 — Chặng S5b, Vòng 3

**Verdict: GO.** Đóng **S5B-02-R2 (MEDIUM)**; toàn bộ **7/7 mục S5B-01–S5B-07 CLOSED**, không phát hiện lỗi chặn mới trong phạm vi tái kiểm. Đợt nộp `both` mới xóa kết quả/lỗi/nút thử lại cũ ngay khi yêu cầu đầu tiên còn chờ. Thử lại riêng từng phần vẫn giữ kết quả tích lũy của phần còn lại.

Chạy mới **17/17 cổng PASS (exit 0 ngay lượt đầu)**, thêm TypeScript tại thư mục dự án thật cũng exit 0; **36 bản ghi quan sát độc lập đạt kỳ vọng**. Đây là số bản ghi kịch bản, không phải tổng số assertion. **GO áp dụng cho S5b trên mã hiện tại và kiểm thử cục bộ/mô phỏng**, chưa phải nghiệm thu dịch vụ thật hoặc toàn bộ v3.4.0.

## 1. Phạm vi và bản mã được kiểm

- Ngày: **30/10/2026**, múi giờ Việt Nam. Reviewer: Codex trực tiếp kiểm định độc lập bản sửa có sẵn; cấu hình được yêu cầu là `gpt-6.1-sol high`, không có công cụ runtime độc lập xác nhận tên model trong lần kiểm này.
- Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`.
- HEAD: **`a78c5a1b1b67735f6e9987d06c437513e771ae06` cộng cây làm việc chưa commit**, được khóa bằng [source-before.json](s5b-round3/source-before.json). Kết luận không áp dụng riêng cho HEAD sạch.
- Đọc [Vòng 2](CODEX_S5B_ROUND2.md), `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, README và các phần mã/test liên quan. Đối chiếu `S5b.1–S5b.9` của kế hoạch duyệt tại `C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md`; lưu [bản dùng để đối chiếu](s5b-round3/approved-plan.source.md).
- So với snapshot Vòng 2, chỉ **3 tệp nguồn/test** khác: `useSpckWorkflow.ts`, `SubmitBar.tsx`, `test-streamline-v340-s5.ts`; ba tài liệu tiến độ cũng đã khác từ trước lần kiểm này. Xem [danh sách](s5b-round3/changes-since-round2.json) và [diff Vòng 2 → Vòng 3](s5b-round3/round2-to-round3.patch).
- Lần theo trang `/final-project` → hook → `SubmitBar` → hàm lưu/duyệt/nộp; kiểm lại route lưu nháp, nhập Demo và kho dữ liệu. Giả định sử dụng: một giáo viên vận hành ứng dụng cục bộ.
- Không sửa mã ứng dụng hoặc test sản phẩm, không commit/push; giữ nguyên thay đổi có sẵn. Chỉ thêm hồ sơ kiểm định và cập nhật ba tài liệu tiến độ theo `AGENTS.md`.

## 2. Bảo vệ dữ liệu thật và môi trường chạy

Trước **mỗi lệnh kiểm thử**, đặt đủ:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\codex_s5b_r3.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\codex_s5b_r3_classes.json"
```

17 cổng và các probe chạy trong bản sao **`C:\Users\QQ\AppData\Local\Temp\codex-s5b-r3-w_38lonr`**. Bản sao chỉ chứa mã, tài liệu, cấu hình mẫu/tài nguyên cần thiết; không sao chép `.env` thật, `data/mindx_bot.db`, `data/running_classes.json` hoặc hồ sơ trình duyệt đã đăng nhập. Dùng thư viện sẵn có qua junction `node_modules`; `.git` được nối để bài S5a đọc các commit lịch sử bằng `git show`, không chạy lệnh thay đổi Git. Không cài lại thư viện.

Một số bộ hồi quy tự đặt lại đường dẫn DB/cache bên trong bài; các đường dẫn đó vẫn nằm trong TEMP hoặc bản sao TEMP. Probe SQLite được chạy sau khi 17 cổng hoàn tất để tránh cùng ghi vào DB kiểm thử. Runner đặt lại ba biến trên cho từng tiến trình con: [run-gates.py](s5b-round3/run-gates.py), [run-probes.py](s5b-round3/run-probes.py).

Không mở/băm/sao chép hai tệp dữ liệu vận hành thật; không gửi dữ liệu lên LMS, Teaching, Gemini, Drive, GitHub hoặc YouTube thật. Các bài giao diện dùng Chromium với phản hồi giả và chặn mạng ngoài. Bài kho dữ liệu dùng route, bộ đọc XLSX và SQLite thật với dữ liệu giả trong TEMP. Các tên học viên và URL trong ảnh/log là dữ liệu giả của bộ kiểm thử.

**139/139 tệp `src/**` và `scripts/**` gốc giữ nguyên SHA-256, kích thước và thời gian ghi**, không thêm tệp nguồn/test sản phẩm; bản sao chạy kiểm thử khớp snapshot của cả 139 tệp. `AGENTS.md`, cấu hình thư viện, TypeScript và `next-env.d.ts` cũng giữ nguyên. Xem [source-integrity.json](s5b-round3/source-integrity.json). Không suy diễn việc bảo toàn dữ liệu thật từ phép băm DB: lần này chủ động không truy cập hai tệp đó.

## 3. S5B-02-R2 — CLOSED

### Đối chiếu mã sửa

- `src/components/final-project/useSpckWorkflow.ts:3390–3412`: với `partToRun === "both"`, xóa `lastSubmissionSummary` và banner; đặt lại `spckSummary`, số/ID VERIFIED Đánh giá, số lỗi, ID thử lại, thông báo lỗi; đồng thời đặt `running: true`, `currentPhase: "spck"`. Tất cả chạy trước lần `await` đầu tiên ở dòng 3436.
- Với `spck_only`/`eval_only`, trạng thái vẫn trải `...prev`; cơ chế gộp kết quả theo ID ở phía sau giữ nguyên.
- `src/components/final-project/SubmitBar.tsx:192–197`: Phần 2 hiện **“Chưa chạy trong đợt này”** khi đang ở pha Sản phẩm và toàn bộ kết quả/lỗi/thử lại Đánh giá còn rỗng. Kết quả phần kia đang có khi thử lại riêng vẫn hiển thị.
- `scripts/test-streamline-v340-s5.ts:426` và `:1071–1144`: đã thêm đợt A có kết quả lỗi một phần, giữ `save-draft` của B bằng `__delaySaveDraftOnce`, kiểm trạng thái trước giải phóng, rồi kiểm lỗi 409. Assertion và kiểm kiểu vẫn bật; không bỏ bài kiểm khỏi dự án.

### Kiểm tra độc lập trên Chromium

[reset-probe.ts](s5b-round3/reset-probe.ts) dùng mã trang/hook/SubmitBar hiện tại và CSS biên dịch thật; lấy phần dựng trang/dữ liệu giả từ bài S5b nhưng bổ sung assertion, kiểm yêu cầu/phản hồi và ảnh độc lập. [Log](s5b-round3/reset-probe.log), [5 bản ghi](s5b-round3/reset-observations.json):

| Kịch bản | Quan sát và kết quả |
|---|---|
| `R3-RESET-A` | Đợt A: Sản phẩm 2/2, Đánh giá 1 xác minh + 1 thử lại, lỗi “Không tìm thấy nút Lưu cho Ngọc”; bảng tổng kết và nút thử lại có thật trước khi bắt đầu B. |
| `R3-RESET-B-PENDING` | B đã gọi `save-draft` nhưng chưa có phản hồi; chưa gọi duyệt/nộp của hai phần. Không còn kết quả 1/1, lỗi, banner hoàn tất, bảng tổng kết hay nút thử lại của A. Phần 1 đang chạy, Phần 2 “Chưa chạy trong đợt này”; nút nộp bị khóa. |
| `R3-RESET-B-409` | Giải phóng lần lưu bằng HTTP 409: Sản phẩm 0/2, có 2 bài cần thử lại; Đánh giá vẫn chạy và xác minh 2/2, không bị lỗi Sản phẩm ngăn lại. |
| `R3-RETRY-SPCK` | Giữ lần lưu đầu của `spck_only` ở trạng thái chờ: Đánh giá vẫn hiển thị 2 xác minh, 0 thử lại. Sau giải phóng, Sản phẩm 2/2 và Đánh giá 2/2; không gọi lại route Đánh giá. |
| `R3-RETRY-EVAL` | Đợt kế tiếp có 1 Đánh giá lỗi; giữ yêu cầu nộp `eval_only` ở trạng thái chờ: Sản phẩm vẫn 2/2 và bảng chi tiết còn nguyên. Chỉ gửi `STU_02`; sau giải phóng Đánh giá cộng thành 2, nút thử lại biến mất, không nộp lại Sản phẩm. |

Ảnh và nội dung màn hình: [A đã hoàn tất](s5b-round3/R3-A-completed.png), [B còn chờ](s5b-round3/R3-B-pending.png), [nội dung B còn chờ](s5b-round3/R3-B-pending.txt), [B sau lỗi 409](s5b-round3/R3-B-early409.png), [thử lại Sản phẩm còn chờ](s5b-round3/R3-spck-retry-pending.png), [thử lại Đánh giá còn chờ](s5b-round3/R3-eval-retry-pending.png), [kết quả sau thử lại](s5b-round3/R3-retries-completed.png). Đã mở xem trực tiếp ba ảnh của B và hai nhánh thử lại lúc còn chờ.

Đây là reset trạng thái màn hình của một đợt mới; không phải xóa lịch sử VERIFIED trong SQLite. Thông báo lỗi của phần đang thử lại riêng có thể còn hiển thị trong lúc chờ; điều đó giữ ngữ cảnh của cùng đợt, không phải trộn kết quả A vào B.

## 4. Kiểm lại toàn vẹn 7 mục

| Mục | Vòng 3 | Bằng chứng chạy mới |
|---|---|---|
| **S5B-01** | **CLOSED** | `R3-P01/P02`: Web Quét → Chụp → Web → Drive dùng phiên bản lưu `2,2,4,4`, giữ ảnh và link; Robotics giữ video/2 ảnh qua YouTube → Drive. `R3-M-saveFail` chặn Web/Drive khi lưu 409 và có retry đúng công cụ. `R3-DB01-*` dùng route/kho thật: phiên bản 2 → 3 → 4 → 5, không mất ảnh/link; `R3-DB02` vẫn chặn phiên bản cũ bằng HTTP 409. |
| **S5B-02**, gồm **S5B-02-R2** | **CLOSED** | 5 quan sát ở mục 3 đóng lỗi trạng thái còn lại. `R3-P03-*` kiểm thêm lưu 409, duyệt lỗi, không ID được duyệt, duyệt lỗi có skipped, upload 500 và exception; tất cả có retry Sản phẩm, Đánh giá chạy riêng, thử lại Sản phẩm không nộp lại Đánh giá. |
| **S5B-03** | **CLOSED** | `R3-P04-*`: hỗn hợp điểm dương/0 và toàn 0 gọi nhập đúng một lần với `onlyMissingStudents: true`; lớp đủ điểm dương không gọi. `R3-DB03`: route + XLSX + SQLite giữ toàn bộ bản ghi người có điểm 4, nhập người thiếu thành 4,5. Nhập lại không đổi dữ liệu; nhập thủ công vẫn cập nhật cả hai (`DB04/05`). |
| **S5B-04** | **CLOSED** | `R3-P05-*`: Buổi 13 chọn đúng 0/2, 1/2, 2/2 khi tải lớp, sau Quét và sau chuyển Buổi 12 → 13; lớp đã nộp hết không bị chọn lại cả lớp. |
| **S5B-05** | **CLOSED** | `R3-P06-spck/eval`: 1 thành công + 1 lỗi, thử lại còn lỗi, rồi thử lại thành công = 2 thành công, không đếm trùng, chỉ gửi `STU_02`, không gọi lại phần kia. Probe reset còn kiểm giữ kết quả phần kia trong thời gian chờ. |
| **S5B-06** | **CLOSED** | TypeScript tại TEMP và workspace đều exit 0; bài S5b exit 0. Dòng `promptSample = aiRes.outboundPromptSample || ""` và assertion nội dung prompt vẫn còn; không vô hiệu hóa kiểm kiểu. |
| **S5B-07** | **CLOSED** | `R3-M-*` kiểm mã có hậu tố số và `.js/.html/.py/.exe/.sb3/.pdf`: Web có Chụp → Web → Drive; App/Python/Scratch/Game Chụp → Drive; thiết kế và Robotics không Playlist chỉ Drive. `R3-P02` kiểm Robotics có Playlist. Khớp ma trận 5 nhánh trong kế hoạch duyệt. |

Đây là chạy lại trên snapshot hiện tại, không lấy kết quả Vòng 2 thay cho bằng chứng mới. Không có phát hiện cần sửa thêm trong phạm vi được yêu cầu.

## 5. Đối chiếu S5b.1–S5b.9

| Mục | Kết quả | Cơ sở/giới hạn |
|---|---|---|
| S5b.1 | ĐẠT cục bộ | Công tắc mặc định bật, thứ tự công cụ, phiên bản/tài nguyên, ma trận 5 nhánh qua S5b và probe. |
| S5b.2 | ĐẠT cục bộ | S5b kiểm xác nhận trước hạ duyệt, hủy thì không chạy công cụ; các hồi quy v270/v272 giữ bảo vệ duyệt. |
| S5b.3 | ĐẠT cục bộ | Công cụ trong ngăn, dòng lỗi có retry và tự ẩn khi thành công; thêm đối chứng lỗi lưu trước Web/Drive. |
| S5b.4 | ĐẠT cục bộ | AI soạn gộp, hai luồng nộp đúng thứ tự, tab Đánh giá trong học viên; lỗi/reset/retry riêng và tích lũy kết quả đạt. |
| S5b.5 | ĐẠT cục bộ | Tự nhập Demo thiếu toàn bộ/một phần; giữ điểm có sẵn qua kho thật; ô nguồn thủ công vẫn hiện. |
| S5b.6 | ĐẠT cục bộ | Chọn Buổi 13 đúng kể cả rỗng; assertion prompt tiến bộ so với Buổi 12 đạt với AI mô phỏng. |
| S5b.7 | ĐẠT trong phạm vi kiểm | S5b kiểm không còn khối `{false &&` tại trang/các thành phần đã liệt kê. |
| S5b.8 | ĐẠT cục bộ | Guardrail tiêu đề/bình luận, Logo MindX và bảo toàn ảnh qua S5b, v270/v272, Phase 6; chưa gọi Gemini/nộp LMS thật. |
| S5b.9 | ĐẠT | TypeScript, bài S5b và 15 cổng hồi quy còn lại đạt; lỗi còn lại Vòng 2 có bằng chứng đóng độc lập. |

## 6. Toàn bộ cổng kiểm thử chạy mới

Tất cả lệnh dưới đây chạy trên bản sao TEMP với ba biến ở mục 2; **không cổng nào phải chạy lại**. Nhật ký lệnh, mã thoát, thời gian và thư mục chạy: [gates.jsonl](s5b-round3/gates.jsonl).

| Lệnh | Exit | Log |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 0 | [TypeScript](s5b-round3/tsc.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | [S5b](s5b-round3/test-streamline-v340-s5.log) |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | 0 | [S5a](s5b-round3/test-streamline-v340-s5a.log) |
| `npx tsx scripts/test-spck-v270.ts` | 0 | [v270](s5b-round3/test-spck-v270.log) |
| `npx tsx scripts/test-spck-v272.ts` | 0 | [v272](s5b-round3/test-spck-v272.log) |
| `npx tsx scripts/test-phase6.ts` | 0 | [Phase 6](s5b-round3/test-phase6.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | [Phase 5](s5b-round3/test-phase5.log) |
| `npx tsx scripts/test-phase7.ts` | 0 | [Phase 7](s5b-round3/test-phase7.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | [Phase 4](s5b-round3/test-phase4-codex-repros.log) |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 0 | [v280](s5b-round3/test-lms-reliability-v280.log) |
| `npx tsx scripts/test-session14-v290.ts` | 0 | [Buổi 14](s5b-round3/test-session14-v290.log) |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | [Teaching](s5b-round3/test-teaching-project-v320.log) |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | [Phiếu điểm](s5b-round3/test-report-card-v330.log) |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 0 | [S1](s5b-round3/test-streamline-v340-s1.log) |
| `npx tsx scripts/test-streamline-v340-s2.ts` | 0 | [S2](s5b-round3/test-streamline-v340-s2.log) |
| `npx tsx scripts/test-streamline-v340-s3.ts` | 0 | [S3](s5b-round3/test-streamline-v340-s3.log) |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | [S4](s5b-round3/test-streamline-v340-s4.log) |

TypeScript còn chạy tại **workspace thật** với cùng ba biến và `--incremental false`, exit 0: [tsc-workspace.log](s5b-round3/tsc-workspace.log). Đây là xác nhận thêm của cùng cổng, không tính thành cổng thứ 18.

Bài S5a đối chiếu hai commit lịch sử `93b77e0`/`a78c5a1`, không đối chiếu giao diện S5b hiện tại; chín cặp HTML/PNG bằng nhau chỉ xác nhận mốc tách trang S5a. Không dùng nó thay bằng chứng hành vi S5b. Ảnh lịch sử của workspace gốc không bị ghi đè.

## 7. Hồ sơ độc lập và khả năng kiểm lại

| Bộ bằng chứng | Số bản ghi | Kết quả |
|---|---:|---|
| [reset-probe.ts](s5b-round3/reset-probe.ts), [reset-observations.json](s5b-round3/reset-observations.json) | 5 | Reset đợt mới, lỗi 409 và hai nhánh retry kể cả lúc còn chờ đều đạt. |
| [independent-probe.ts](s5b-round3/independent-probe.ts), [observations.json](s5b-round3/observations.json) | 16 | Phiên bản/tài nguyên, lỗi sớm, Demo, Buổi 13 và retry tích lũy đạt. |
| [matrix-probe.ts](s5b-round3/matrix-probe.ts), [matrix-observations.json](s5b-round3/matrix-observations.json) | 8 | Bảy biến thể ma trận + lỗi lưu trước Web/Drive đạt. |
| [repository-probe.ts](s5b-round3/repository-probe.ts), [repository-observations.json](s5b-round3/repository-observations.json) | 7 | Route/kho dữ liệu/bộ đọc XLSX thật với dữ liệu TEMP đạt. |

4/4 tiến trình probe exit 0: [probes.jsonl](s5b-round3/probes.jsonl). Các probe phiên bản/ma trận/kho kế thừa ca kiểm Vòng 2 nhưng được dựng/chạy mới với mã hiện tại. Probe reset thay kỳ vọng tái hiện lỗi cũ bằng kỳ vọng đóng lỗi, bổ sung kiểm banner, placeholder, yêu cầu chưa có phản hồi và cả hai nhánh retry còn chờ. Không thay test sản phẩm.

Lưu [bài S5b chính xác đã kiểm](s5b-round3/test-streamline-v340-s5.source.txt), [diff cây có sẵn](s5b-round3/working-tree.patch), [Git trước](s5b-round3/git-status-before.txt)/[sau](s5b-round3/git-status-final.txt), [tổng hợp chạy](s5b-round3/execution-summary.json) và các script dựng/kiểm tra toàn vẹn. Giữ bản sao TEMP cùng dữ liệu giả để có thể kiểm lại, không tự dọn dữ liệu thật hoặc artifact lịch sử.

## 8. Giới hạn và bước tiếp theo

- Chưa đăng nhập/nộp lên LMS, đồng bộ Teaching, triển khai GitHub Pages, tải Drive, lấy YouTube, chụp ứng dụng học viên hoặc gọi Gemini thật trong lần kiểm này.
- Chưa chạy bản dựng phát hành đầy đủ hoặc đo số lần bấm với giáo viên/lớp thật. Các giới hạn này không phải lỗi mới của bản sửa reset và không thay đổi phạm vi GO cục bộ.
- Đủ điều kiện đóng S5b trong chuỗi kiểm định để bước sau có thể triển khai S6; chưa triển khai S6 và chưa nghiệm thu toàn bộ v3.4.0.
- Đã cập nhật `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` để phân biệt GO cục bộ với nghiệm thu thật. Không tạo commit theo yêu cầu Owner.
