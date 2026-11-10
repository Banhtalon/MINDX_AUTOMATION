# Kiểm định độc lập Round 2 — Teaching progress Dashboard, Cách 2

Ngày kiểm định: **10/11/2026**, múi giờ **Asia/Saigon**. Bốn lệnh chạy mới trong khoảng **13:19:46–13:21:23 (+07:00)**.

**Kết quả: GO trong phạm vi bản sao cô lập. F01 và F02: CLOSED. Không phát hiện lỗi chặn nghiệm thu trong phạm vi đã kiểm tra.**

## Phạm vi và tiêu chí

Kiểm tra quy tắc hoàn tất bước Teaching trong `Việc cần làm hôm nay`, từ dữ liệu SQLite qua `getDashboardTodayTodoCards`, `hasClassUpdatedTeachingProgressForSession` đến `buildClassTodayTodoCard`; đọc thêm phần chuẩn hóa công việc, ánh xạ buổi học và cách giao diện chia nhóm theo `allDone`.

| Buổi | Nhãn bước | Số công việc khác nhau tối thiểu có tiến độ dương |
| --- | --- | --- |
| 11 | Tiến độ 20% | 1 |
| 12 | Tiến độ 60% | 3 |
| 13 | Tiến độ 80% | 4 |
| 14 | Tiến độ 100% | 5 |

Mỗi công việc được tính khi có `taskId` nguyên dương và ít nhất một học viên được giao việc có tiến độ hữu hạn `> 0`. Khi `studentsJson` là danh sách không rỗng, học viên đó phải còn trong danh sách và không mang trạng thái `Bảo lưu`, `Nghỉ học` hoặc `inactive`. Mốc này xác nhận đã cập nhật báo cáo phụ huynh; học viên khác vẫn có thể ở 0% hoặc dưới 100%.

Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` và `AGENTS.md`. Đây là kiểm định, không triển khai tính năng hay sửa lỗi.

## Phát hiện và xác nhận Round 1

| Mã | Trạng thái Round 2 | Bằng chứng |
| --- | --- | --- |
| F01 — Không giao học viên nhưng còn tiến độ cũ | **CLOSED** | `today-tasks.ts:446` trả `false` khi danh sách được giao rỗng; không quét khóa tiến độ cũ để thay thế. Ca `explicit-no-assignees-with-stale-progress` đạt ở cả hàm kiểm tra và Dashboard cho đủ Buổi 11–14. Ca `REPO-explicit-deselection-preserves-stale-progress-but-must-not-complete` cũng đạt: lưu bỏ toàn bộ học viên vẫn giữ tiến độ cũ, Dashboard báo chưa xong. |
| F02 — Học viên đã rời danh sách lớp vẫn được tính | **CLOSED** | `today-tasks.ts:408–432` tạo tập học viên đang học; `:449–453` lấy phần giao với danh sách được giao. Ca `assignee-no-longer-in-current-roster` đạt ở cả hai tầng cho đủ Buổi 11–14. Ca `SERVICE-roster-refresh-removes-learner-but-historical-progress-must-not-complete` đạt với kết nối giả lập: tải lại danh sách lớp loại học viên 99, dù phân công/tiến độ lịch sử còn lưu, Dashboard vẫn báo chưa xong. |

Các điểm đã xác nhận thêm:

- `today-tasks.ts:401` chỉ nhận mã công việc nguyên dương; `:461–466` dùng `Set` để đếm mã công việc khác nhau. Phần chống đếm trùng được xác nhận bằng đọc mã; bộ probe hiện có không chứa ca mã công việc trùng riêng.
- Các ca đủ số công việc ở mức 1%, mức hỗn hợp dưới 100%, thiếu một công việc, công việc ở vị trí cuối, học viên bảo lưu/nghỉ học/inactive và học viên không được giao đều đạt.
- `today-tasks.ts:849–896` đọc cả `studentsJson`, truyền kết quả quy tắc vào thẻ Dashboard. Các ca `CARD-S11..S14-explicit-true/false-overrides-percent` xác nhận kết quả này quyết định `isDone`, kể cả khi phần trăm trung bình cho kết luận ngược lại.
- Các ca tiến độ JSON hỏng, dạng mảng và `null` đều trả chưa hoàn tất. Các ca Dashboard còn đối chiếu `progressJson` sau khi đọc, xác nhận việc tính trạng thái không tự nâng tiến độ học viên.
- Hai ca chống tái phát trực tiếp trong `scripts/test-streamline-v340-s6.ts:481` và `:503` đã chạy đạt cùng toàn bộ bộ S6.

## Bốn lệnh bắt buộc — kết quả chạy mới

| Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | **PASS**, exit 0, không có chẩn đoán lỗi | [Thông tin lần chạy](round2-typecheck.json) |
| `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, exit 0, **4/4 nhóm S6-T1..T4** | [Nhật ký S6](round2-s6.log), [thông tin lần chạy](round2-s6.json) |
| `npx tsx docs/audits/v340/teaching-progress-cach2-independent/probe.mjs` | **PASS**, exit 0, **119 PASS / 0 FAIL / 0 ERROR** | [Kết quả từng ca](independent-results.json), [nhật ký](round2-synthetic.log), [thông tin lần chạy](round2-synthetic.json) |
| `npx tsx docs/audits/v340/teaching-progress-cach2-independent/probe.mjs --real` | **PASS**, exit 0, **3 PASS / 0 FAIL / 0 ERROR** | [Kết quả bản sao dữ liệu](snapshot-results.json), [nhật ký](round2-snapshot.log), [thông tin lần chạy](round2-snapshot.json) |

Môi trường quan sát: Node.js `v24.21.0`, npm `11.19.0`. Một số nhật ký có khung `NativeCommandError` do PowerShell trình bày thông báo nạp cấu hình từ stderr; cả bốn mã thoát thực tế đều là 0, các bộ kiểm tra kết thúc thành công.

`--real` mở SQLite đầu vào ở chế độ chỉ đọc, sao lưu sang thư mục tạm rồi mới cho ứng dụng đọc/khởi tạo cấu trúc trên bản sao (`probe.mjs:24–25`). Không cần tài khoản và không gửi tiến độ lên Teaching thật. Hai lớp được kiểm tra:

| Lớp trong dữ liệu có sẵn | Buổi | Trạng thái bước Teaching | Toàn bộ thẻ |
| --- | --- | --- | --- |
| `VT-C4K-PTA13` | 12 | `isDone=true`, `đã cập nhật (38%) ✓` | `allDone=true` |
| `VT-C4K-GA38` | 13 | `isDone=true`, `đã cập nhật (75%) ✓` | `allDone=true` |

## Bảo toàn dữ liệu và gắn bằng chứng với mã nguồn

Đã lấy SHA-256 trước các lệnh và đối chiếu sau cả bốn lệnh. Cả hai lần chạy probe cũng tự kiểm tra dấu vân tay trước/sau.

| Tệp được bảo vệ | SHA-256 trước = sau | Kết quả |
| --- | --- | --- |
| `data/mindx_bot.db` | `3f996294025a94b7dd19fc4db8368babd7d24f437b49bfc834e0ef901ee1416c` | **Giữ nguyên 100%** |
| `data/running_classes.json` | `171f75d944fb37c604d6c6ee31bc53b23786d5240f03c20e4252b22260c8c2b4` | **Giữ nguyên 100%** |

**159/159 tệp đầu vào giữ nguyên SHA-256**, gồm toàn bộ tệp trong `src/`, `scripts/`, probe và các tài liệu/cấu hình được ghi nhận. Chi tiết: [mốc trước kiểm tra](round2-baseline.json), [đối chiếu sau kiểm tra](round2-final-integrity.json).

Bản sao không có thư mục `.git`; các lệnh xem trạng thái, mã phiên bản và địa chỉ kho Git đều trả `not a git repository`. Vì vậy kết luận gắn với dấu vân tay tệp tại đây, không xác nhận phiên bản trên GitHub. Các tệp trọng tâm:

| Tệp | SHA-256 |
| --- | --- |
| `src/lib/dashboard/today-tasks.ts` | `3971710ebedc59a324e91db279a92226e9eeab10ae96fc90b139a2681684dcf3` |
| `scripts/test-streamline-v340-s6.ts` | `bdffa3fd26fd7fce6a874f6be8ebac8d1b00aefa3e6a035edc85e9d375073121` |
| `docs/audits/v340/teaching-progress-cach2-independent/probe.mjs` | `e7ef1180754a43ea60534844f2e84e2d7c019a9646156eece425774f9a817135` |

## Giới hạn và việc tiếp theo

- Đã kiểm tra hành vi cục bộ, trình duyệt với dữ liệu/kết nối giả lập trong S6 và hai lớp trên bản sao dữ liệu được cung cấp. Chưa đăng nhập Teaching/LMS thật, chạy quét mạng thật, đánh giá trực quan Dashboard đang chạy hoặc tạo bản phát hành.
- Đợt này chỉ tạo báo cáo và tệp bằng chứng trong thư mục kiểm định; mã ứng dụng, bộ thử hiện có, cấu hình và ba tài liệu trạng thái giữ nguyên. Không thực hiện commit/push trong bản sao không có Git.
- Có thể đóng F01/F02 và chấp nhận Round 2 cho quy tắc Cách 2 trên đúng bộ tệp đã ghi nhận. Người điều phối chuyển báo cáo về dự án chính và đối chiếu dấu vân tay trước khi dùng kết quả cho bản khác.

VERDICT: GO
