# Kiểm định độc lập v3.4.0 — S7 Round 2

Ngày: 2026-10-30. **Final gate verdict: GO — 2/2 CLOSED.**

Phạm vi: kiểm lại S7-01 và S7-02 của [Round 1](CODEX_S7_ROUND1.md) trên HEAD `2364c93793a0b4805e435aa98ad0df7f00e91444` **cộng cây làm việc hiện tại**, không phải riêng mã đã commit. Đã đọc trạng thái dự án, kế hoạch, changelog, quy tắc dự án và mã liên quan. Không sửa tệp nào trong `src/` hoặc `scripts/`, không commit, không gọi LMS/Teaching/Gemini thật.

## Kết luận

Hai lỗi vòng 1 không còn tái hiện. Probe vòng 1 chạy lại nguyên bản đạt **116/116 PASS, `failed: []`**, bắt **20/20 payload** tại năm bộ sinh AI. Bốn lệnh bắt buộc có kết quả cuối **exit code 0**; bộ S7 đạt đủ **S7-T1–S7-T6**. Hai tệp dữ liệu thật khớp mã SHA-256 Owner cung cấp trước và sau kiểm định. Đủ điều kiện đóng S7 cục bộ và chuẩn bị S8; chưa nghiệm thu dịch vụ thật hoặc toàn bộ v3.4.0. S7.5 tiếp tục bỏ qua theo kế hoạch đã duyệt.

## Verification table

Số dòng dưới đây lấy từ mã hiện tại, thay cho số dòng trong prompt.

| ID | Mức độ vòng 1 | Trạng thái | Vị trí sửa đã xác nhận | Bằng chứng đóng |
|---|---|---|---|---|
| **S7-01** | HIGH | **CLOSED** | `src/lib/ai/pii-anonymizer.ts:215`: bật xử lý tên nối mặc định; `:500`, `:523`, `:560`, `:598`: bật rõ trong wrapper danh sách lớp/Buổi 14/SPCK/Teaching. `src/lib/gemini/homework-grader.ts:115`, `:119`, `:121`: xử lý chung tên bản thân và bạn trong lớp, có `matchJoinedFileNames: true`. | Probe đạt mọi ca privacy/boundary, gồm tên viết liền và nối `_` ở cả năm bộ sinh. S7-T6 đạt đủ 20 lần bắt payload, kiểm không còn tên trong danh sách cấm tại `scripts/test-streamline-v340-s7.ts:670`, `:677`. |
| **S7-02** | MEDIUM | **CLOSED** | `src/lib/ai/pii-anonymizer.ts:226`: vẫn yêu cầu ít nhất hai thành phần; `:238`, `:240`: `.filter(Boolean)` giữ tên ngắn; `:248`, `:252`: giữ tương tự cho cụm tên đệm + tên. | Mọi ca tên file một ký tự của probe đạt, không còn hậu tố `Y` sót sau token. S7-T6 tại `scripts/test-streamline-v340-s7.ts:466` kiểm Á/Ý/Y/y/Ỷ/Ứ, dấu/không dấu, bốn cách nối, bản thân/bạn cùng lớp; đạt kiểm tra payload SPCK tại `:683`. |

**Khác biệt với mô tả bản sửa:** Mã thực tế có nhánh mặc định trong `anonymize`, không có hàm `createStudentNameScrubber`; `HomeworkAiGrader.buildNameScrubber` gọi trực tiếp `anonymize`, không gọi `createRosterNameScrubber`. Khác biệt tên hàm/số dòng không ảnh hưởng kết quả đóng lỗi: dữ liệu giả đã đi qua mã thật và được bắt tại ranh giới gọi AI.

Probe đạt toàn bộ `comment/homework/session14/spck/teaching-{0,1,2,3}-boundary` và `-privacy`: câu có dấu, câu không dấu, tên file nối `_`, tên file viết liền. Các ca `joined-Lê Thị Ý-*`, `joined-Phạm Văn Y-*` và `spck-{2,3}-one-char-filename` cũng đạt. Quan sát và payload giả: [adversarial-results.json](s7-round2/adversarial-results.json).

## Môi trường an toàn

Các lệnh chạy tại bản sao `C:\Users\QQ\AppData\Local\Temp\mindx-s7r2-audit-rcvesjt_`. Không chép `.env`, hồ sơ đăng nhập, DB thật hoặc danh sách lớp thật. Chép cấu hình trong `data/config`, bỏ tệp thư mục giáo viên đã duyệt. Thư viện dùng junction tới bản đang cài; chép `.next/types` và `.next/dev/types` nếu có để kiểm TypeScript. Mã nguồn bản sao khớp workspace trước và sau chạy.

Trước mỗi tiến trình, đặt đúng:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = Join-Path $env:TEMP 'mindx_codex_s7r2.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $env:TEMP 'mindx_codex_s7r2_rc.json'
```

Hai đường dẫn dữ liệu tạm chưa tồn tại khi bắt đầu. Riêng S7-T6 tự đổi các biến bên trong tiến trình sang thư mục `mindx-v340-s7-*` do bài kiểm tra tạo; mọi đường dẫn vẫn nằm trong TEMP và được khôi phục sau khi đóng DB. Không sửa hành vi này. Probe và Phase 4 dùng đường dẫn TEMP Owner chỉ định.

Node nạp bộ chặn kết nối ngoài; cho phép liên lạc nội bộ/named pipe/loopback để `tsx` hoạt động. Không nạp khóa thật. S7-T6 thay `GoogleGenerativeAI.prototype.getGenerativeModel` để bắt `generateContent`; probe thay mô-đun client; Teaching dùng `mockAiExecutor`. Các hàm thay thế thu nội dung rồi dừng, không gọi dịch vụ.

Môi trường và SHA-256 probe: [isolation.json](s7-round2/isolation.json). Probe được chép nguyên byte, không thay điều kiện đạt. Trình chạy: [run-audit.py](s7-round2/run-audit.py), [rerun-s7.py](s7-round2/rerun-s7.py).

## Command & test results

| Lệnh | Exit code cuối | Kết quả | Bằng chứng |
|---|---:|---|---|
| `npx tsc --noEmit --incremental false` | **0** | PASS, không lỗi TypeScript; 1,72 giây | [metadata](s7-round2/tsc.json), [log](s7-round2/tsc.log) |
| `npx tsx scripts/test-streamline-v340-s7.ts` | **0** | PASS, S7-T1–S7-T6; chạy lại nguyên bản với khóa giả đặt từ đầu; 2,20 giây | [metadata](s7-round2/test-streamline-v340-s7.json), [log](s7-round2/test-streamline-v340-s7.log) |
| `npx tsx docs/audits/v340/s7-round1/adversarial-probe.cjs` | **0** | **116/116 PASS**, `total: 116`, `failed: []`; 20/20 payload; 2,31 giây | [metadata](s7-round2/adversarial-probe.json), [log](s7-round2/adversarial-probe.log), [kết quả](s7-round2/adversarial-results.json) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | **0** | PASS, toàn bộ mục Round 1–17 theo thông báo cuối; 3,84 giây | [metadata](s7-round2/test-phase4-codex-repros.json), [log](s7-round2/test-phase4-codex-repros.log) |
| SHA-256 dữ liệu thật trước/sau | — | **PASS**, khớp mã kỳ vọng và không đổi | [trước](s7-round2/production-before.json), [sau](s7-round2/production-after.json), [bảo toàn](s7-round2/preservation.json) |

### Lượt đầu không đạt và cách xử lý

S7-T1–T5 đạt, nhưng S7-T6 ban đầu **exit 1**, `comment variant #0`, `capturedPayloads.length = 0`, tại `scripts/test-streamline-v340-s7.ts:670`. Bài kiểm tra đặt khóa giả tại `:528` sau khi import các bộ sinh tại `:516`; cấu hình đã chụp giá trị khóa tại `src/lib/config.ts:34`, client kiểm giá trị đó tại `src/lib/gemini/client.ts:15`. Bản sao không có `.env`, nên client dừng trước hàm bắt payload. Đây là yêu cầu chuẩn bị môi trường kiểm thử, không phải bằng chứng tên còn lọt.

Giữ đầy đủ [log lượt đầu](s7-round2/test-streamline-v340-s7.attempt1.log) và [metadata lượt đầu](s7-round2/test-streamline-v340-s7.attempt1.json). Chạy lại **nguyên mã nguồn và bài kiểm tra**, chỉ đặt `GEMINI_API_KEY=test-s7-dummy-key` từ đầu tiến trình; bộ chặn mạng giữ nguyên. Kết quả S7-T1–T6 đều đạt. Khi tái lập trên môi trường không có cấu hình, cần đặt khóa giả từ đầu như `rerun-s7.py`; không cần khóa thật. Ghi chú này không chặn đóng hai lỗi ẩn danh.

Trước các lệnh kiểm tra, trình chuẩn bị audit có một lần tự dừng vì so sánh khóa đường dẫn Windows dùng `\` với `/` trong bảng kỳ vọng. Đã sửa duy nhất `run-audit.py` để chuẩn hóa đường dẫn; hai mã băm không khác, chưa có lệnh kiểm thử nào chạy ở lần chuẩn bị đó.

## Production data preservation check

Chỉ đọc SHA-256 của hai tệp được Owner cho phép; không mở kết nối SQLite hoặc sao chép nội dung vận hành của chúng.

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | **UNCHANGED / PASS** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED / PASS** |

[preservation.json](s7-round2/preservation.json) xác nhận **2.053/2.053 tệp được bảo vệ giữ nguyên**, không có tệp thêm/đổi trong tập bảo vệ: toàn bộ `src/`, `scripts/`, `next-env.d.ts`, bằng chứng S7 Round 1 và hồ sơ round-12–round-41. Manifest: [protected-before.json](s7-round2/protected-before.json).

So với snapshot nguồn Round 1, chỉ hai tệp ứng dụng `pii-anonymizer.ts`, `homework-grader.ts`, bài kiểm tra S7 và `next-env.d.ts` khác snapshot cũ; các khác biệt đã có trước Round 2. Round 2 không chỉnh hoặc hoàn tác chúng. Chỉ thêm hồ sơ Round 2 và cập nhật `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md` theo quy tắc dự án.

## Giới hạn và việc tiếp theo

Không chạy lại build Webpack hoặc toàn bộ tám cổng Round 1; không coi build cũ là lần chạy mới trên nguồn Round 2. Chưa nghiệm thu LMS/Teaching/Gemini thật hoặc tương tác trình duyệt đầy đủ. Bắt payload chỉ chứng minh nội dung chuẩn bị gửi trong các ca đã kiểm, không chứng minh mọi loại dữ liệu cá nhân hay phản hồi AI.

**Final gate verdict: GO. S7-01 CLOSED; S7-02 CLOSED — 2/2 CLOSED.** Có thể đóng S7 và chuẩn bị S8; Owner chưa cần thao tác thủ công.
