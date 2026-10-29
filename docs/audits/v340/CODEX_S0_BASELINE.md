# Kiểm định độc lập v3.4.0 — S0 Baseline, Round 2

**Decision: GO for S0 Baseline**  
**S0-01: CLOSED. S0.5: hoàn tất (GO).**

- Thời gian: 2026-10-29–2026-10-30 (Asia/Saigon; bắt đầu trước nửa đêm).
- Snapshot và HEAD: `d7e3fe85a4c314631a45e21fd3647a528bb4fd1b` — `chore: snapshot before v3.4.0 streamlining`.
- Phạm vi: đóng khoảng trống bằng chứng SHA-256 của S0 Round 1; chạy mới TypeScript; đối chiếu tệp bảo vệ và vị trí xuất phát S1.1–S1.7. Không triển khai S1.
- Owner đã cho phép đo hash chỉ đọc, theo yêu cầu Round 2 và mục 3 của [`prompts/TEMPLATE.md`](prompts/TEMPLATE.md). Không mở kết nối SQLite, sao chép, ghi hoặc xóa hai tệp dữ liệu thật.
- Kết luận này thay thế NO-GO của Round 1. Báo cáo ngắn cũ được giữ nguyên byte tại [`s0-round2/round1-report-original.txt`](s0-round2/round1-report-original.txt); bằng chứng `s0-round1/` không thay đổi.

## 1. Các cổng kiểm chứng chạy mới

| Kiểm tra / lệnh | Kết quả | Mã thoát / bằng chứng |
| --- | --- | --- |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` và `Get-Item` trước/sau | PASS; hash, kích thước và thời gian ghi giữ nguyên | `0`; `s0-round2/data-before.json`, `data-after.json` |
| `npx tsc --noEmit --incremental false` | PASS; output 0 byte | `0`; `s0-round2/tsc-run.json`, `tsc-output.txt`, `tsc-exit.txt` |
| Đối chiếu SHA-256 của 1.403 tệp với Round 1; kích thước/thời gian ghi trước–sau vòng này | PASS; 1.403/1.403 | `0`; `s0-round2/protected-before.json`, `protected-after.json`, `verification.json` |
| `git rev-parse HEAD` | Đúng snapshot đầy đủ nêu trên | `0`; `s0-round2/source-verification.json` |
| `git diff --exit-code HEAD -- src scripts next-env.d.ts AGENTS.md` | Không có khác biệt | `0`; kiểm tra bổ sung các thư mục lịch sử `round-12` đến `round-41` cũng đạt |
| Danh sách qua `rg --files` và `git ls-files`; bảy tệp nguồn/quy tắc neo qua `git hash-object --path=…` so với `git rev-parse HEAD:…` | Danh sách khớp; bảy tệp khớp HEAD sau chuẩn hóa xuống dòng của Git | `0`; `s0-round2/source-verification.json`, `anchor-hashes-before.json` |

TypeScript chạy từ thư mục dự án, với ba đường dẫn cô lập dưới TEMP:

```text
ALLOWED_LOCAL_DIRS=C:\Users\QQ\AppData\Local\Temp\mindx-v340-s0-r2-5ebf41eae89a4943b34c64f3e451c570
MINDX_DB_PATH=<thư mục trên>\test.db
MINDX_RUNNING_CLASSES_PATH=<thư mục trên>\running_classes.json
```

Đặt thêm `npm_config_offline=true` và bộ nhớ đệm npm trong TEMP. Lệnh chạy từ `2026-10-29T16:56:27.4059906Z` đến `2026-10-29T16:56:28.5241762Z`; không tạo DB/cache dữ liệu thử và không thực thi mã ứng dụng. Thông số thực tế được lưu trong `tsc-run.json`. Không gọi LMS/Teaching thật, không khởi động trình duyệt hoặc máy chủ.

Mười bộ kiểm thử ngoài TypeScript trong [`BASELINE.md`](BASELINE.md) là **kết quả nền được ghi nhận trước đó**, không phải kết quả chạy mới của Round 2. Vòng này không mở rộng sang kiểm thử chức năng hoặc nghiệm thu hệ thống thật.

## 2. Phát hiện Round 1

| ID | Mức độ | Trạng thái | Vị trí / bằng chứng trước đó | Căn cứ đóng / sửa còn lại |
| --- | --- | --- | --- | --- |
| S0-01 | MEDIUM — thiếu bằng chứng bảo toàn dữ liệu | **CLOSED** | `docs/audits/v340/s0-round1/verification.json:11`: `NOT_READ_OWNER_CLARIFICATION_UNANSWERED`; Round 1 chưa được phép đo hash | Owner cho phép phép đo chỉ đọc; cả hai tệp khớp kỳ vọng trước/sau và giữ nguyên kích thước/thời gian ghi. Không cần sửa mã ứng dụng. |

Không còn phát hiện OPEN trong phạm vi đóng S0. Các mục S1 bên dưới vẫn là công việc của chặng tiếp theo, **chưa sửa/chưa nghiệm thu**.

## 3. Bảo toàn dữ liệu thật

| Tệp | SHA-256 trước | SHA-256 sau | Kỳ vọng |
| --- | --- | --- | --- |
| `data/mindx_bot.db` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | **100% khớp** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **100% khớp** |

| Tệp | Kích thước trước = sau (byte) | LastWriteTimeUtc trước = sau |
| --- | --- | --- |
| `data/mindx_bot.db` | 1.527.808 | `2026-10-29T07:57:02.6342898Z` |
| `data/running_classes.json` | 2.392 | `2026-10-29T10:09:04.3932646Z` |

Thời điểm đo từng tệp nằm trong `data-before.json` và `data-after.json`. Hash chứng minh byte tệp không đổi giữa hai lần đo và khớp dấu vân tay Owner yêu cầu; không chứng minh dữ liệu nghiệp vụ bên trong DB đúng.

## 4. Danh sách bảo vệ và snapshot

- Danh sách **1.403 tệp** nằm trong `s0-round1/protected-before.json`: 101 tệp `src/**`, 15 tệp `scripts/**`, 1 tệp `next-env.d.ts`, 1.286 tệp lịch sử `docs/audits/round-12` đến `round-41`. Tất cả khớp SHA-256 Round 1; kích thước và thời gian ghi giữ nguyên trong Round 2. Danh sách hiện tại qua `rg --files` và Git khớp hoàn toàn.
- `s0-round1/baseline-source-hashes.json` có **12 mục**, không phải 1.403. Sáu tệp mã nguồn S1 cùng `AGENTS.md` khớp byte Round 1; `BASELINE.md` cũng khớp. Ba tài liệu tiến độ và `prompts/TEMPLATE.md` đã khác Round 1 ngay khi bắt đầu vòng này: đó là cập nhật báo cáo Round 1 và ngoại lệ hash được Owner xác nhận. Bản thay đổi tài liệu có trước Round 2 được giữ tại `s0-round2/initial-tracking.diff`.
- Bảy tệp nguồn/quy tắc neo có nội dung Git đúng snapshot. Một số SHA-256 byte thô của bản lưu Git khác bản Windows do `core.autocrlf=true`; phép đối chiếu snapshot dùng chuẩn hóa xuống dòng của Git, còn phép bảo toàn Round 1 dùng SHA-256 byte thực tế. Không đánh đồng hai phép so sánh.
- `BASELINE.md` và `prompts/TEMPLATE.md` chưa nằm trong snapshot; không tuyên bố chúng tồn tại tại commit đó. Ba tài liệu tiến độ được phép thay đổi để ghi nhận S0.
- Khi dựng danh sách ban đầu, quét mọi tệp đã tính thêm các `.log` được kho mã bỏ qua. Phép kiểm tra cuối dùng cùng tập bảo vệ qua `rg --files`, kiểm tra độc lập bằng Git; không thêm/mất tệp trong tập 1.403.

## 5. Bảy vị trí xuất phát S1

| Mục | Vị trí file:dòng đã đọc | Trạng thái tại S0 |
| --- | --- | --- |
| S1.1 | `src/app/api/spck/list/route.ts:348`, `:373`, `:399` | Ba lệnh gọi `ClassSyncer` vẫn chạy trực tiếp ngoài `taskQueue.enqueue`. |
| S1.2 | `src/app/api/spck/list/route.ts:406`, `:411` | Vẫn lọc `expiredFinishedCodes` rồi gọi `saveRunningClasses(prunedList)` để ghi danh sách rút gọn. |
| S1.3 | `src/lib/playwright/teaching-project-service.ts:148`, `:221`, `:256`; `src/lib/playwright/teaching-report-card-sync.ts:156`, `:529`, `:539` | Hai bộ kết nối và phiên cookie vẫn riêng; report-card có Stop/Timeout, project dùng `fetch` trực tiếp. Bộ dùng chung và xử lý 401 là yêu cầu S1 chưa triển khai. |
| S1.4 | `src/lib/playwright/teaching-report-card-sync.ts:1028`; `src/components/teaching-report-card-view.tsx:1759`, `:1763` | Điều kiện chỉ nhận `APPROVED`/`VERIFIED` vẫn chặn thử lại từ `FAILED`. |
| S1.5 | `src/app/final-project/page.tsx:1134`, `:1136`; `src/app/api/spck/list/route.ts:306`, `:445` | Trang đọc `data.activeSessionNumber` và dùng nhánh dự phòng; API trả `selectedSessionNumber`. |
| S1.6 | `src/lib/playwright/spck-uploader.ts:792` đến `:795` | Vẫn có mã buổi học viết cứng cho `VT-C4K-PTA12` trong đường chạy thật. |
| S1.7 | `AGENTS.md:5`; `PROJECT_STATE.md:104`; `src/lib/student-portal/student-portal-server.ts:362`, `:378`, `:507`, `:695` | Quy tắc chung ghi `127.0.0.1`; mô tả cổng thu bài chưa nêu rõ ngoại lệ `0.0.0.0`. Mã cổng vẫn có token, khởi tạo tunnel và lắng nghe `0.0.0.0`. Chỉ xác nhận vị trí xuất phát, không chứng nhận đầy đủ an toàn của cổng. |

Đoạn trích có số dòng nằm tại [`s0-round2/s1-anchors.json`](s0-round2/s1-anchors.json). Không thay đổi các vị trí này trong vòng kiểm định.

## 6. Bàn giao và giới hạn

- Đã ghi báo cáo này và [`CODEX_S0_ROUND2.md`](CODEX_S0_ROUND2.md); cập nhật `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` để đánh dấu S0/S0.5 **GO**.
- Chỉ ghi báo cáo, bằng chứng mới trong `docs/audits/v340/` và ba tài liệu tiến độ. Không commit/push hoặc sửa mã sản phẩm, kiểm thử cũ, cấu hình Next.js hay dữ liệu thật; bằng chứng Round 1 giữ nguyên.
- Codex trực tiếp thực hiện kiểm định độc lập theo yêu cầu Owner. Không có phiên kiểm định thứ hai của `claude-sonnet-5-5-high` trong môi trường hiện tại; không quy kết kết quả cho model đó.
- **Đủ điều kiện chuyển sang triển khai S1.** S1–S8, bản dựng đầy đủ, mười bộ hồi quy và vận hành LMS/Teaching thật chưa được nghiệm thu trong Round 2. GO này chỉ chốt mốc xuất phát S0.

