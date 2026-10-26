# Ma trận hồi quy AUDIT-R31

Nguồn kết luận: [source-manifest.json](evidence/source-manifest.json). Mọi kết quả dưới đây đều chạy mới trong TEMP; cột kết quả dùng lượt cuối, mọi lượt trước được giữ trong [commands.json](evidence/commands.json).

819 ca chính giữ nguyên ID, tiêu chí và kỳ vọng R30. Native (import mô-đun thật) và oracle (bộ đối chiếu riêng) là kiểm chứng chéo, không cộng trùng vào 819. 28 ca biên R31 là bộ bổ sung riêng.

| Cổng | Kết quả | Trạng thái | Mã thoát | Log / kết quả |
|---|---|---|---:|---|
| round31 | 819/819 | PASS | 0 | [log](evidence/round31.attempt-1.log) / [JSON](evidence/round31.attempt-1-results.json) |
| native31-media | 221/221 | PASS | 0 | [log](evidence/native31-media.attempt-1.log) / [JSON](evidence/native31-media.attempt-1-results.json) |
| native31-worker | 88/88 | PASS | 0 | [log](evidence/native31-worker.attempt-1.log) / [JSON](evidence/native31-worker.attempt-1-results.json) |
| pdf-name | 4/4 | PASS | 0 | [log](evidence/pdf-name.attempt-2.log) / [JSON](evidence/pdf-name.attempt-2-results.json) |
| export-worker-cases | 88 mẫu giả, không import sản phẩm | PASS | 0 | [log](evidence/export-worker-cases.attempt-1.log) / [JSON](evidence/export-worker-cases.attempt-1-results.json) |
| pdf-name-oracle | 4/4 | PASS | 0 | [log](evidence/pdf-name-oracle.attempt-2.log) / [JSON](evidence/pdf-name-oracle.attempt-2-results.json) |
| pdf-dict-oracle | 54/54 | PASS | 0 | [log](evidence/pdf-dict-oracle.attempt-1.log) / [JSON](evidence/pdf-dict-oracle.attempt-1-results.json) |
| pdf-oracle | 54/54 kỳ vọng từ điển; quan sát 117 PDF | PASS | 0 | [log](evidence/pdf-oracle.attempt-1.log) / [JSON](evidence/pdf-oracle.attempt-1-results.json) |
| graphql-js-oracle | 88/88 | PASS | 0 | [log](evidence/graphql-js-oracle.attempt-1.log) / [JSON](evidence/graphql-js-oracle.attempt-1-results.json) |
| graphql-worker-oracle | 88/88 | PASS | 0 | [log](evidence/graphql-worker-oracle.attempt-1.log) / [JSON](evidence/graphql-worker-oracle.attempt-1-results.json) |
| r31-boundary | 28/28 | PASS | 0 | [log](evidence/r31-boundary.attempt-1.log) / [JSON](evidence/r31-boundary.attempt-1-results.json) |
| round30 | 819/819 | PASS | 0 | [log](evidence/round30.attempt-2.log) / [JSON](evidence/round30.attempt-2-results.json) |
| native30-media | 221/221 | PASS | 0 | [log](evidence/native30-media.attempt-2.log) / [JSON](evidence/native30-media.attempt-2-results.json) |
| native30-worker | 88/88 | PASS | 0 | [log](evidence/native30-worker.attempt-2.log) / [JSON](evidence/native30-worker.attempt-2-results.json) |
| round29 | 815/815 | PASS | 0 | [log](evidence/round29.attempt-2.log) / [JSON](evidence/round29.attempt-2-results.json) |
| native29-media | 217/217 | PASS | 0 | [log](evidence/native29-media.attempt-2.log) / [JSON](evidence/native29-media.attempt-2-results.json) |
| native29-worker | 88/88 | PASS | 0 | [log](evidence/native29-worker.attempt-2.log) / [JSON](evidence/native29-worker.attempt-2-results.json) |
| round28 | 737/737 | PASS | 0 | [log](evidence/round28.attempt-2.log) / [JSON](evidence/round28.attempt-2-results.json) |
| native28-media | 163/163 | PASS | 0 | [log](evidence/native28-media.attempt-2.log) / [JSON](evidence/native28-media.attempt-2-results.json) |
| native28-worker | 64/64 | PASS | 0 | [log](evidence/native28-worker.attempt-2.log) / [JSON](evidence/native28-worker.attempt-2-results.json) |
| round27 | 662/662 | PASS | 0 | [log](evidence/round27.attempt-2.log) / [JSON](evidence/round27.attempt-2-results.json) |
| native27-media | 120/120 | PASS | 0 | [log](evidence/native27-media.attempt-2.log) / [JSON](evidence/native27-media.attempt-2-results.json) |
| native27-worker | 32/32 | PASS | 0 | [log](evidence/native27-worker.attempt-2.log) / [JSON](evidence/native27-worker.attempt-2-results.json) |
| round26 | 510/510 | PASS | 0 | [log](evidence/round26.attempt-2.log) / [JSON](evidence/round26.attempt-2-results.json) |
| native26-media | 94/94 | PASS | 0 | [log](evidence/native26-media.attempt-2.log) / [JSON](evidence/native26-media.attempt-2-results.json) |
| native26-worker | 54/54 | PASS | 0 | [log](evidence/native26-worker.attempt-2.log) / [JSON](evidence/native26-worker.attempt-2-results.json) |
| round25 | 344/344 | PASS | 0 | [log](evidence/round25.attempt-2.log) / [JSON](evidence/round25.attempt-2-results.json) |
| native25-media | 25/25 | PASS | 0 | [log](evidence/native25-media.attempt-2.log) / [JSON](evidence/native25-media.attempt-2-results.json) |
| native25-worker | 9/9 | PASS | 0 | [log](evidence/native25-worker.attempt-1.log) / [JSON](evidence/native25-worker.attempt-1-results.json) |
| round24 | 230/230 | PASS | 0 | [log](evidence/round24.attempt-2.log) / [JSON](evidence/round24.attempt-2-results.json) |
| round23 | 116/116 | PASS | 0 | [log](evidence/round23.attempt-2.log) / [JSON](evidence/round23.attempt-2-results.json) |
| round22 | 53/53 | PASS | 0 | [log](evidence/round22.attempt-2.log) / [JSON](evidence/round22.attempt-2-results.json) |
| native24-media | 8/8 | PASS | 0 | [log](evidence/native24-media.attempt-2.log) / [JSON](evidence/native24-media.attempt-2-results.json) |
| round12 | 43/43 | PASS | 0 | [log](evidence/round12.attempt-1.log) / [JSON](evidence/round12.attempt-1-results.json) |
| round13 | 89/89 | PASS | 0 | [log](evidence/round13.attempt-1.log) / [JSON](evidence/round13.attempt-1-results.json) |
| round15 | 2 baseline đạt; 8 assertion lỗi/lệch lịch sử | FAIL_HISTORICAL_CONTRACT | 1 | [log](evidence/round15.attempt-1.log) / [JSON](evidence/round15.attempt-1-results.json) |
| round16 | 15/16 | FAIL_HISTORICAL_CONTRACT | 1 | [log](evidence/round16.attempt-1.log) / [JSON](evidence/round16.attempt-1-results.json) |
| round17 | 38/38 | PASS | 0 | [log](evidence/round17.attempt-1.log) / [JSON](evidence/round17.attempt-1-results.json) |
| round19 | 89/94 | FAIL_HISTORICAL_CONTRACT | 1 | [log](evidence/round19.attempt-1.log) / [JSON](evidence/round19.attempt-1-results.json) |
| round20 | 140/145 | FAIL_HISTORICAL_CONTRACT | 1 | [log](evidence/round20.attempt-1.log) / [JSON](evidence/round20.attempt-1-results.json) |
| round21 | 45/49 | FAIL_HISTORICAL_CONTRACT | 1 | [log](evidence/round21.attempt-1.log) / [JSON](evidence/round21.attempt-1-results.json) |
| historical14 | Tự chặn ghi đè bằng chứng đã có | BLOCKED_REPLAY_PRECONDITION | 1 | [log](evidence/historical14.attempt-1.log) |
| historical18 | Tự chặn ghi đè bằng chứng đã có | BLOCKED_REPLAY_PRECONDITION | 1 | [log](evidence/historical18.attempt-1.log) |
| phase4 | Đạt | PASS | 0 | [log](evidence/phase4.attempt-1.log) |
| phase5 | Đạt | PASS | 0 | [log](evidence/phase5.attempt-1.log) |
| typecheck-before | Đạt | PASS | 0 | [log](evidence/typecheck-before.attempt-1.log) |
| build | 22/22 trang | PASS | 0 | [log](evidence/build.attempt-1.log) |
| typecheck-after | Đạt | PASS | 0 | [log](evidence/typecheck-after.attempt-1.log) |

## 14 nhóm nguồn

| Nhóm | Điều được kiểm | Ca gắn nhóm | Trạng thái |
|---|---|---:|---|
| R19-01 | Đọc file/ảnh/PDF an toàn | 414/414 | CLOSED_SOURCE |
| R19-02 | Kiểm tiêu chí và tự cộng điểm | 2/2 | CLOSED_SOURCE |
| R19-03 | Hash bản đã duyệt | 2/2 | CLOSED_SOURCE |
| R19-04 | AI cũ và phiên bản file | 5/5 | CLOSED_SOURCE |
| R19-05 | Chặn duyệt file lỗi | 5/5 | CLOSED_SOURCE |
| R19-06 | Bản đã xem và duyệt không lỗi thời | 68/68 | CLOSED_SOURCE |
| R19-07 | Đúng học viên/bài nộp trên modal | 2/2 | CLOSED_SOURCE |
| R19-08 | Đúng lớp/buổi/cột bài tập | 3/3 | CLOSED_SOURCE |
| R19-09 | Đúng yêu cầu và phản hồi lưu điểm | 277/277 | CLOSED_SOURCE |
| R19-10 | Đọc lại điểm/quyết định/nhận xét | 5/5 | CLOSED_SOURCE |
| R19-11 | Chỉ VERIFIED khi bản duyệt còn nguyên | 3/3 | CLOSED_SOURCE |
| R19-12 | Phản hồi giao diện về sai thứ tự | 2/2 | CLOSED_SOURCE |
| R19-13 | Lưu nháp nguyên khối và thứ tự bền | 22/22 | CLOSED_SOURCE |
| R19-14 | Dừng AI khi tải lỗi/chỉ chấm bài mới tải | 2/2 | CLOSED_SOURCE |

Các nhóm dùng cùng định nghĩa và danh sách ID của R30, đối chiếu lại với kết quả mới. Không dùng kết quả R30 cũ làm bằng chứng PASS. Bảy ca chính còn lại là các kiểm soát chung ngoài 14 nhóm.

## Diễn giải lịch sử

- R16: kỳ vọng 7 bảng, hiện có 8 bảng do bổ sung bảng lưu phiên bản nháp; đối chứng cấu trúc hiện tại đạt.
- R19: bốn mẫu ảnh/PDF cũ không hoàn chỉnh bị chặn; một yêu cầu duyệt thiếu bản đã xem bắt buộc.
- R20: bốn yêu cầu duyệt thiếu bản đã xem; một phản hồi dùng `saveGrade` thay vì trường mutation đã chọn `saveHomeworkGrade`.
- R21: bốn phản hồi có cùng sai khác trường trả về; ca kiểm chỉnh sửa trong lúc đọc lại chưa đi tới bước đọc lại trong bộ cũ.
- R15: là bộ tái hiện lỗi cũ, giữ nguyên 0 lỗi cũ tái hiện, 2 baseline đạt, 8 assertion lỗi/lệch yêu cầu. Không gọi bộ này là PASS.
- R14/R18: runner ghi nhận một lần từ chối ghi đè bằng chứng có sẵn. Giữ BLOCKED_REPLAY_PRECONDITION; không xóa hoặc sửa bộ cũ để chạy ép.

Danh sách ID trượt giống hệt R30; 10 đối chứng tương thích chạy mới đều đạt. Xem [historical-contract-differences.json](evidence/historical-contract-differences.json).

## Lỗi môi trường đã xử lý

Có 71 lượt cho 48 cổng; 21 lượt ban đầu lỗi Windows `WinError 267` trước khi Node chạy vì cwd quá dài. Rút tiền tố `compat` thành `x` trong tên TEMP, giữ đủ nhãn vòng cho assertion cũ; chạy lại đủ 21 cổng và đều đạt. `ESBUILD_BINARY_PATH` luôn trỏ bản sao cùng hash tại TEMP ngắn. Không thay mã sản phẩm/harness lịch sử.

## Giới hạn

PASS ở đây là bằng chứng nguồn và dữ liệu giả. Không chạy giao diện/trình duyệt thật, đăng nhập thật, LMS/Gemini thật hoặc kiểm định toàn bộ định dạng PDF. Các bộ lịch sử FAIL/BLOCKED được giữ rõ, không tuyên bố mọi bộ nguyên bản đều xanh.
