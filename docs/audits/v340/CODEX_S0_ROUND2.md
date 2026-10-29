# S0 Round 2 — Đóng S0-01

**Decision: GO for S0 Baseline**  
**S0-01: CLOSED. S0.5: hoàn tất (GO).**

- Thời gian: 2026-10-29–2026-10-30 (Asia/Saigon).
- HEAD/snapshot: `d7e3fe85a4c314631a45e21fd3647a528bb4fd1b`.
- Báo cáo đầy đủ và bảng vị trí S1.1–S1.7: [`CODEX_S0_BASELINE.md`](CODEX_S0_BASELINE.md).

## Kết quả chạy mới

| Kiểm tra | Kết quả | Mã thoát |
| --- | --- | --- |
| Hash và thông tin hai tệp dữ liệu trước/sau | Khớp 100% kỳ vọng; kích thước và thời gian ghi giữ nguyên | `0` |
| `npx tsc --noEmit --incremental false` | PASS; output 0 byte | `0` |
| Đối chiếu 1.403 tệp được bảo vệ | 1.403/1.403 khớp Round 1; không đổi hash/kích thước/thời gian ghi trong vòng này | `0` |
| HEAD, danh sách tệp và các tệp nguồn neo S1 | HEAD đúng snapshot; danh sách không đổi; bảy tệp nguồn/quy tắc khớp HEAD sau chuẩn hóa xuống dòng của Git | `0` |

TypeScript có `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` trỏ vào TEMP riêng, npm chạy offline. Không mở kết nối SQLite tới dữ liệu thật, sao chép/ghi/xóa hai tệp dữ liệu hoặc truy cập LMS/Teaching thật.

## Phát hiện đã đóng

| ID | Mức độ | Trạng thái | Vị trí bằng chứng trước đó | Căn cứ đóng |
| --- | --- | --- | --- | --- |
| S0-01 | MEDIUM — thiếu bằng chứng | **CLOSED** | `s0-round1/verification.json:11` | Owner cho phép phép đo chỉ đọc; các số đo mới trước/sau khớp kỳ vọng. Không cần sửa mã sản phẩm. |

## Bảo toàn dữ liệu thật

| Tệp | SHA-256 trước | SHA-256 sau |
| --- | --- | --- |
| `data/mindx_bot.db` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` |

- DB: **1.527.808 byte**, LastWriteTimeUtc **`2026-10-29T07:57:02.6342898Z`**, trước = sau.
- Danh sách lớp: **2.392 byte**, LastWriteTimeUtc **`2026-10-29T10:09:04.3932646Z`**, trước = sau.

## Bằng chứng và giới hạn

- [`s0-round2/verification.json`](s0-round2/verification.json), [`source-verification.json`](s0-round2/source-verification.json), [`tsc-run.json`](s0-round2/tsc-run.json): kết quả, HEAD, danh sách, lệnh và đường dẫn cô lập.
- [`data-before.json`](s0-round2/data-before.json), [`data-after.json`](s0-round2/data-after.json), [`protected-before.json`](s0-round2/protected-before.json), [`protected-after.json`](s0-round2/protected-after.json): số đo chi tiết.
- [`s1-anchors.json`](s0-round2/s1-anchors.json), [`anchor-hashes-before.json`](s0-round2/anchor-hashes-before.json): vị trí S1 và các tệp neo. Danh sách 1.403 tệp nằm ở `s0-round1/protected-before.json`; `baseline-source-hashes.json` chỉ có 12 mục. Những khác biệt tài liệu được phép có giải thích trong báo cáo đầy đủ.
- [`round1-report-original.txt`](s0-round2/round1-report-original.txt) giữ nguyên báo cáo ngắn cũ. Ba tài liệu tiến độ được cập nhật S0/S0.5 GO; không sửa mã ứng dụng hoặc kiểm thử cũ.
- Mười bộ hồi quy trong `BASELINE.md` không chạy lại; không nghiệm thu vận hành thật hoặc S1. Codex trực tiếp kiểm định; không có phiên reviewer Claude thứ hai.

**Bước tiếp theo: triển khai S1 theo kế hoạch, rồi kiểm định riêng chặng S1.**
