# AUDIT-R38 — Ma trận hồi quy

Kết luận: **NO-GO**. 12 nhóm lỗi mới (5 P1, 7 P2), 17/41 tình huống mới chưa đạt. PASS nền không thay thế kiểm toán đối kháng.

## Cổng nền trong TEMP

| Cổng | Kết quả thực tế | Bằng chứng |
|---|---|---|
| R32, lệnh nguyên bản | BLOCKED: assertion tên TEMP chỉ cho R32, exit 1; chưa chạy 67 ca | evidence/01-r32.log |
| R32, bản tương thích | 67/67 PASS, exit 0; chỉ đổi tên TEMP trong assertion | evidence/01b-r32-compatible.log, r32-phase6-results.json |
| Phase 6 | PASS đủ 4 nhóm, exit 0 | evidence/02-phase6.log |
| Phase 5 | PASS đủ 8 nhóm, exit 0 | evidence/03-phase5.log |
| TypeScript | PASS 0 lỗi, exit 0 | evidence/04-typescript.log |
| R38 đối kháng mới | 24/41 PASS; 17 FAIL, exit 1 | evidence/05-adversarial.log, r38-adversarial-results.json |

## Từng ca R38 mới

| Ca | TASK | Điều kiện cần đạt | Thực tế | Nhóm lỗi |
|---|---|---|---|---|
| R38-N01 | 6.1 | Tên NFD, tiền tố số, tên trùng và va chạm thư mục vẫn yêu cầu xác nhận | PASS | — |
| R38-S-outside-root | 6.2 | Chặn đường dẫn hoặc junction thoát allowlist: outside-root | PASS | — |
| R38-S-child-junction | 6.2 | Chặn đường dẫn hoặc junction thoát allowlist: child-junction | PASS | — |
| R38-S-file-via-junction | 6.2 | Chặn đường dẫn hoặc junction thoát allowlist: file-via-junction | PASS | — |
| R38-S-corrupt-zip | 6.2 | Loại gói zip hỏng cấu trúc | FAIL | R38-06 |
| R38-S-corrupt-sb3 | 6.2 | Loại gói sb3 hỏng cấu trúc | FAIL | R38-06 |
| R38-S-corrupt-yyz | 6.2 | Loại gói yyz hỏng cấu trúc | FAIL | R38-06 |
| R38-S-corrupt-docx | 6.2 | Loại gói docx hỏng cấu trúc | FAIL | R38-06 |
| R38-S-corrupt-pptx | 6.2 | Loại gói pptx hỏng cấu trúc | FAIL | R38-06 |
| R38-S-links | 6.2 | links.txt chặn giao thức lạ và giới hạn 5+5 | PASS | — |
| R38-L-scan | 6.5 | API scan từ chối website bên ngoài | PASS | — |
| R38-L-list | 6.5 | API list từ chối website bên ngoài | PASS | — |
| R38-L-save-draft | 6.5 | API save-draft từ chối website bên ngoài | PASS | — |
| R38-L-approve | 6.5 | API approve từ chối website bên ngoài | PASS | — |
| R38-L-generate-ai | 6.5 | API generate-ai từ chối website bên ngoài | PASS | — |
| R38-L-upload-lms | 6.5 | API upload-lms từ chối website bên ngoài | PASS | — |
| R38-L-client | 6.5 | Client không nhập mật khẩu, khóa API hoặc thư viện server | PASS | — |
| R38-D-student | 6.5 | Không lưu nháp cho studentId ngoài lớp | PASS | — |
| R38-D-drift-teacherComment | 6.5 | Sửa teacherComment sau duyệt hạ WAITING_APPROVAL | PASS | — |
| R38-D-drift-projectTitle | 6.5 | Sửa projectTitle sau duyệt hạ WAITING_APPROVAL | PASS | — |
| R38-D-drift-youtubeUrlsJson | 6.5 | Sửa youtubeUrlsJson sau duyệt hạ WAITING_APPROVAL | PASS | — |
| R38-D-drift-relatedLinksJson | 6.5 | Sửa relatedLinksJson sau duyệt hạ WAITING_APPROVAL | PASS | — |
| R38-D-file-drift | 6.4 | Đổi bytes file sau duyệt chặn upload | PASS | — |
| R38-D-unsafe-url | 6.5 | API không duyệt URL javascript: dù bỏ qua UI | FAIL | R38-07 |
| R38-D-exe | 6.2/6.5 | API không duyệt file ngoài danh mục LMS | FAIL | R38-08 |
| R38-D-approval-snapshot | 6.5 | Snapshot nội dung cũ không được duyệt | PASS | — |
| R38-G-stop | 6.3 | Stop Bot giữa danh sách AI không gọi học viên kế tiếp | FAIL | R38-05 |
| R38-G-empty | 6.3 | Thiếu tag và note không gọi AI | PASS | — |
| R38-G-privacy | 6.3 | Ẩn tên target/peer và khóa thẻ đóng sandbox giả | PASS | — |
| R38-G-history | 6.3 | Lịch sử buổi 2 phải được dùng khi tổng kết cuối khóa | FAIL | R38-12 |
| R38-U-reload | 6.5 | Sau tải lại trang, lần sửa mới không bị coi là nháp cũ | FAIL | R38-09 |
| R38-U-class-race | 6.5 | Đổi lớp khi đang duyệt: phản hồi lớp A không ghi trạng thái/hash lên lớp B | FAIL | R38-10 |
| R38-U-note-race | 6.3/6.5 | Đổi ghi chú khi AI đang chạy không nhận kết quả dựa trên ghi chú cũ | FAIL | R38-11 |
| R38-P-happy | 6.4 | Đối chứng: tạo 01, bấm Thêm, retry không tạo 02 | PASS | — |
| R38-P-no-persist | 6.4 | Link hiện ở form chưa lưu không được dùng làm bằng chứng lưu bền vững | FAIL | R38-01 |
| R38-P-wrong-request | 6.4 | Request lưu sai studentId/classId không được VERIFIED | FAIL | R38-02 |
| R38-P-pending-files | 6.4 | Một network không liên quan không thay cho mọi file tải hoàn tất | FAIL | R38-03 |
| R38-P-old-file | 6.4 | Tên file giống nhau không chứng minh bytes LMS khớp file đã duyệt | FAIL | R38-04 |
| R38-P-stop | 6.4 | Stop Bot sau học viên đầu không lưu học viên thứ hai | FAIL | R38-05 |
| R38-P-drift | 6.4 | Sửa DB khi đang điền phải chặn trước bấm Lưu | PASS | — |
| R38-P-http500 | 6.4 | HTTP 500 không được VERIFIED | PASS | — |

## Đối chiếu toàn phạm vi

| TASK | Kết luận trong phạm vi kiểm |
|---|---|
| 6.1 | Chuẩn hóa, trùng tên, fuzzy và va chạm: các ca đã chạy đạt; không suy rộng sang roster LMS thật. |
| 6.2 | Allowlist/junction, ảnh/PDF, giới hạn links/ảnh/file nền đạt; gói ZIP/Office hỏng và cửa vào API còn R38-06/08. |
| 6.3 | Không đủ dữ kiện không gọi AI; ẩn danh/hủy thẻ sandbox/thuyết trình/stale cơ bản đạt. Stop, note mới và lịch sử còn R38-05/11/12. |
| 6.4 | Queue, tạo/reuse 01, + Thêm, HTTP lỗi, drift trước/sau lưu nền đạt. Persisted, định danh response, file/phiên bản và Stop còn R38-01..05. |
| 6.5 | Local guard, khóa lớp/học viên đầu vào, snapshot duyệt và hạ duyệt khi sửa cơ bản đạt. URL/file API, reload, đổi lớp còn R38-07..11. |

Hàm computeSpckContentHash có SHA-256 bytes của tài nguyên cục bộ; không có trường riêng tên filesFingerprint. Kiểm tra đổi bytes sau duyệt đạt. Không coi tên trường khác hợp đồng là lỗi độc lập; việc đối chiếu file server vẫn thất bại ở R38-04.

Các file .previous.log ghi lượt chuẩn bị trước khi hoàn thiện harness; không được cộng vào số PASS/FAIL cuối. Lượt cuối là 05-adversarial.log và r38-adversarial-results.json.
