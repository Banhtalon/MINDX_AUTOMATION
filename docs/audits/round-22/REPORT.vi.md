# AUDIT-R22 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết chính thức: NO-GO cấp mã nguồn. Chưa nghiệm thu Giai đoạn 5.**

Bộ Vòng 20 nguyên bản đạt **145/145**, Vòng 21 nguyên bản đạt **49/49**, hồi quy Vòng 12/13/16/17 đạt **186/186**. Tuy nhiên, bộ bổ sung Vòng 22 đạt **28/53**, còn **25 ca trượt thuộc 4 nhóm lỗi**. Hiện có **10/14 nhóm CLOSED_SOURCE**, còn **R19-01, R19-06, R19-09, R19-13 sửa một phần**. R19-04 và R19-05 được đóng thêm; lỗi tương thích cổng R12 đã hết trong phạm vi kiểm tra.

Điểm chặn quan trọng nhất: bản đang hiển thị 80 điểm có thể duyệt thành 90 điểm; quyết định GRADE có thể duyệt thành REDO; hai bộ xử lý giao diện độc lập có thể làm bản 60 điểm đến muộn ghi đè bản 90 điểm rồi được duyệt. Bộ lọc phản hồi cũng vẫn có thể xác nhận nhầm một thao tác GraphQL không lưu điểm. Các tình huống này được tái hiện bằng mã thật với dữ liệu giả trong bản chụp, chưa phải sự cố đã quan sát trên LMS thật.

## 1. Đối tượng và dấu vết nguồn

- Ngày kiểm toán: **20/10/2026**. Bản chụp lúc **18:48:49 giờ Việt Nam**, tương ứng `2026-10-20T11:48:49.460139+00:00`.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`.
- Đối tượng là **cây làm việc có thay đổi chưa commit**, gồm cả file mới chưa được Git theo dõi. HEAD không đại diện đầy đủ cho mã đã kiểm.
- Danh mục **75 file nguồn/cấu hình/script và file cấp gốc** có SHA-256 tổng hợp: `32ceec9fd76bfa299f230ad4431a76dc93ed20375351d2a78fe4a3d46ba4a74b`. Chi tiết tại [source-state.json](source-state.json) và [git-status.before.txt](git-status.before.txt).
- So với dấu vết Vòng 21, có **8 file sản phẩm thay đổi**, đúng các vùng: media parser, AI grader, duyệt, lưu nháp, giao diện, SQLite, worker lưu điểm và bộ lọc mạng.
- Đã đối chiếu `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, báo cáo/bộ kiểm chứng R20–R21 và chuỗi tải bài → đọc file → AI → nháp → duyệt → lưu LMS → đọc lại → VERIFIED. Các cổng hồi quy giữ kiểm tra những nhóm đã đóng.

Không sửa mã sản phẩm, cấu hình, script kiểm thử cũ hoặc kế hoạch. Quy định riêng của vòng này chỉ cho ghi trong `docs/audits/round-22/`, nên không thêm hoặc đánh dấu AUDIT-R22 trong `MINDX_AUTOMATION_PLAN.md`.

## 2. Cô lập và bảo toàn

Mọi lệnh kiểm thử, kiểm tra TypeScript và build đều được khởi chạy với thư mục làm việc:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round22-20261020T114849399873Z-mindx-round21-mindx-round20-compat\snapshot
```

Hậu tố tương thích đáp ứng chốt đường dẫn của hai bộ cũ, không sửa các bộ đó để bỏ chốt.

- Sao chép mã, hồ sơ kiểm toán và `node_modules` thành các file riêng; không liên kết thư viện về repo gốc, không cài hoặc cập nhật thư viện.
- Không sao `.env*`, cơ sở dữ liệu thật, hồ sơ đăng nhập `playwright-auth`, bài nộp thật, `.git` hoặc `.next`. Phần dữ liệu chỉ sao `data/config`.
- Tiến trình nhận danh sách biến Windows tối thiểu, npm offline, tắt telemetry và nạp rào socket Node từ `round-19/network-guard.cjs` trong bản chụp. Đây là rào trong Node, không phải tường lửa hệ điều hành.
- R22 dùng SQLite thật trong bộ nhớ, file giả vật lý trong TEMP và bộ giả cho Gemini/API/DOM. Các bộ cũ giữ nguyên cách tạo thư mục fixture riêng trong TEMP. Không mở trình duyệt hoặc dùng tài khoản thật.
- [snapshot-check.json](snapshot-check.json) xác nhận bản chụp ban đầu khớp toàn bộ nguồn và file bảo vệ; [isolation.json](isolation.json) ghi cách cô lập.
- [protected-hashes.json](protected-hashes.json) xác nhận **319/319 file bảo vệ giữ nguyên**, gồm `next-env.d.ts` và mọi file tại `round-12`…`round-21`. Danh mục, kích thước và SHA-256 trước/sau đều khớp; không thêm/xóa file trong các thư mục lịch sử ở repo gốc.
- SHA-256 `next-env.d.ts` gốc vẫn là **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**.
- [preservation-check.json](preservation-check.json) xác nhận **75/75 file nguồn/cấu hình/script và kế hoạch gốc giữ nguyên**. Trong danh mục này, build chỉ làm đổi `next-env.d.ts` của bản chụp. Không cần ghi hoặc khôi phục file gốc.

Các bộ cũ có ghi kết quả mới trong thư mục lịch sử **của bản chụp**. Kết quả đó được sao về tên mới dưới R22; không ghi đè hồ sơ lịch sử của repo gốc.

## 3. Đủ toàn bộ lệnh yêu cầu

Danh sách yêu cầu thực tế có **11 lệnh khác nhau** khi tách riêng bốn vòng hồi quy. Đã chạy đủ cả 11: **10 PASS, 1 FAIL**. Không bỏ lệnh để khớp cách gọi “10 cổng” trong yêu cầu.

| Lệnh chạy trong snapshot | Mã thoát | Kết quả | Bằng chứng mới |
|---|---:|---|---|
| `node docs/audits/round-20/verify-independent.mjs` | 0 | **145/145 PASS** | [log](round20.attempt-1.log), [JSON](round20-results.json) |
| `node docs/audits/round-21/verify-independent.mjs` | 0 | **49/49 PASS** | [log](round21.attempt-1.log), [JSON](round21-results.json) |
| `node docs/audits/round-22/verify-independent.mjs` | **1** | **28/53 PASS; 25 FAIL** | [log cuối](round22.attempt-2.log), [JSON chuẩn](independent-results.json) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | **43/43 PASS** | [log](round12.attempt-1.log), [JSON](round12-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | **89/89 PASS** | [log](round13.attempt-1.log), [JSON](round13-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | 0 | **16/16 PASS** | [log](round16.attempt-1.log), [JSON](round16-results.json) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | **38/38 PASS** | [log](round17.attempt-1.log), [JSON](round17-results.json) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Các mục của script PASS | [log](phase4.attempt-1.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | **7/7 mục PASS** | [log](phase5.attempt-1.log) |
| `npx tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [log](typecheck.attempt-1.log) |
| `npm run build` | 0 | Dựng thành công **22/22 trang** | [log](build.attempt-1.log) |

Hồi quy R12/13/16/17: **43 + 89 + 16 + 38 = 186/186**. Các lỗi mạng hiển thị trong log phase4 là lỗi cố ý tạo trong dữ liệu giả; script vẫn kết thúc thành công. Build và TypeScript đạt không thay thế được kiểm tra duyệt đúng dữ liệu.

[commands.json](commands.json) ghi thư mục, thời gian, mã thoát trực tiếp và hash log; không dùng đường ống làm mất mã thoát. Xóa JSON kết quả cũ chỉ trong bản chụp trước từng lệnh để tránh dùng nhầm bằng chứng lịch sử.

R22 chạy hai lần. Lần đầu có một mẫu JPEG mà bộ giải mã vẫn đọc được, nên ca đó **không đủ cơ sở kết luận lỗi sản phẩm**. Lần cuối thay bằng JPEG có SOF khai báo thành phần 1 nhưng SOS tham chiếu thành phần 2; bộ giải mã thật từ chối. Đồng thời làm phản hồi API giả phản ánh đúng ca alias/skip/sai bài. Không thay thân hàm sản phẩm hay hạ yêu cầu an toàn. Lần cuối vẫn **28/53**, với đủ **25 ca lỗi sản phẩm có quan sát cụ thể**. Giữ cả hai log/JSON; dùng `round22.attempt-2-results.json` làm bằng chứng cuối.

SHA-256 của [verify-independent.mjs](verify-independent.mjs) cuối cùng, khớp chính xác file đã chạy: `ac2e17ba62657db66a87bdb45d6177e55c98cd3bc89b7447e760cf1c3905b950`. Các bộ cũ không cần chạy lại sau khi sửa fixture R22 vì mã sản phẩm và các bộ đó không đổi.

## 4. Trạng thái đầy đủ 14 nhóm

`CLOSED_SOURCE` nghĩa là đã đóng trong phạm vi mã nguồn và dữ liệu giả đã kiểm. Không đồng nghĩa nghiệm thu LMS thật. Chi tiết mã ca tại [issue-status.json](issue-status.json).

| Nhóm | Trạng thái R22 | Căn cứ |
|---|---|---|
| R19-01 | **PARTIALLY_FIXED — P2** | Các mẫu cũ đã chặn; 8 file hỏng mới vẫn PARSED và 1 WebP trong suốt hợp lệ bị từ chối. |
| R19-02 | **CLOSED_SOURCE** | Giữ các ca barem, mã tiêu chí, bằng chứng và tính tổng của R20/R21. |
| R19-03 | **CLOSED_SOURCE** | Hash tổng hợp tiếp tục khóa file, tiêu chí, điểm có hiệu lực, quyết định và nhận xét. |
| R19-04 | **CLOSED_SOURCE** | File đổi/xóa trong lúc AI chạy đều bị bỏ kết quả, kể cả truyền `parsedContent` sẵn. Đối chứng không đổi đạt. |
| R19-05 | **CLOSED_SOURCE** | Cả duyệt đơn, bulk và chỉnh tiêu chí gửi `activeRubric`; cả ba chặn tiêu chí ngoài barem đang chọn. |
| R19-06 | **PARTIALLY_FIXED — P1** | So sánh file/nhận xét đã cải thiện; bulk vẫn bỏ qua điểm/quyết định đã xem, dữ liệu kiểm chứng có thể bị bỏ trống, hash file đã chấm chỉ giữ trong bộ nhớ tiến trình. |
| R19-07 | **CLOSED_SOURCE** | Giữ kiểm tra đúng mã học viên/bài, chặn khớp một phần hoặc modal thiếu ID. |
| R19-08 | **CLOSED_SOURCE** | Giữ chốt lesson/session và đối chứng ánh xạ hợp lệ. |
| R19-09 | **PARTIALLY_FIXED — P1** | Đã chặn comment/query/attachment cũ; alias `score: __typename`, skip, thiếu query và biến không gắn với đối số thực tế vẫn xác nhận được. |
| R19-10 | **CLOSED_SOURCE** | Giữ đối chiếu nhận xét và quyết định đọc lại; GRADE/REDO hợp lệ đều đạt. |
| R19-11 | **CLOSED_SOURCE** | Giữ kiểm tra phiên bản có điều kiện trước khi nâng VERIFIED. |
| R19-12 | **CLOSED_SOURCE** | Giữ chặn phản hồi lớp/buổi cũ ghi đè phạm vi mới. |
| R19-13 | **PARTIALLY_FIXED — P1** | Cùng trường và số thứ tự tăng dần đã chặn bản cũ; hai cửa sổ, cập nhật khác trường và tải lại vẫn có lỗi. |
| R19-14 | **CLOSED_SOURCE** | Tải lỗi tiếp tục dừng AI cả khi `skipAi`; giữ các ca lỗi một phần/phạm vi ID của R20. |

Tổng: **10 CLOSED_SOURCE, 4 PARTIALLY_FIXED**, gồm **3 nhóm P1 và 1 nhóm P2** còn lại. P1 là nguy cơ duyệt/xác nhận sai dữ liệu; P2 ở đây là kiểm tra file hoặc thao tác lưu bị từ chối/mất thay đổi. Không cộng lỗi tương thích R12 thành nhóm thứ 15.

## 5. R19-06 — P1: Bulk ký điểm hoặc quyết định giáo viên chưa xem

**Nguyên nhân:** UI đã gửi đầy đủ `reviewedSubmissions`, nhưng server chỉ so `fileHash` và nhận xét. Server không đối chiếu `criteriaGrades`, `teacherOverrideScore` hoặc `decision` của từng bản đã xem. Việc đối chiếu còn là tùy chọn khi thiếu cả danh sách; thiếu riêng nhận xét cũng bỏ so sánh. Duyệt đơn chỉ bắt buộc `fileHash` khi payload có trường `decision`.

**Vị trí:** [`approve/route.ts:90`](../../../src/app/api/homework-grader/approve/route.ts#L90), nhánh đối chiếu 90–112; duyệt đơn 262–304. UI gửi đủ trường tại [`homework-auto-grader-tab.tsx:572`](../../../src/components/homework-auto-grader-tab.tsx#L572).

**Bằng chứng:** `R22-06-ui-bulk-drift-criteria`, `...override`, `...decision` chạy handler UI thật vào nhánh bulk thật. UI tải bản 80/GRADE; một yêu cầu nháp khác được API thật lưu thành 90 điểm, điểm ghi đè 25 hoặc REDO. UI cũ bấm bulk và cả ba trường hợp đều **APPROVED**, dù đã gửi bản đang xem là 80/GRADE. Hai đối chứng đổi file hoặc nhận xét đều được chặn đúng. Không cần sửa trực tiếp DB để tạo ba thay đổi nội dung này.

Ba ca thiếu bằng chứng `R22-06-single-missing-hash-false`, `...bulk-review-missing-list`, `...bulk-review-missing-feedback` đều trả **200 và APPROVED**. Nhánh duyệt đơn có `decision` nhưng thiếu hash trả 409 đúng. UI hiện luôn gửi `decision`; đường bỏ cả decision/hash là điểm yếu trực tiếp của API, không được mô tả như thao tác UI thường ngày.

**Một phần khác của cùng nhóm:** [`sqlite.ts:707`](../../../src/lib/db/sqlite.ts#L707) lưu `gradedFileHashBySub` trong `Map` của tiến trình, không có trường tương ứng trong SQLite. Ca `R22-06-graded-hash-reload` giữ nguyên cùng cơ sở dữ liệu trong bộ nhớ nhưng nạp lại module repository: hash đã chấm chuyển từ `graded-v1` thành fallback `ungraded-v2`, rồi **APPROVED ungraded-v2** với điểm cũ. Đây là kiểm tra mất trạng thái khi nạp lại module; chưa tắt/mở ứng dụng thật.

**Cách sửa:** Bắt buộc chứng minh phiên bản đã xem cho mọi yêu cầu duyệt; so toàn bộ trường có hiệu lực khi tính điểm/quyết định, hoặc đối chiếu một mã phiên bản tổng hợp lưu bền trong SQLite. Lưu bền hash file gắn với lần chấm/xem; không tự lấy hash file mới làm bằng chứng đã chấm.

**Sau khi sửa:** Cả **7 ca FAIL thuộc R22-06** phải chặn duyệt hoặc giữ bản đã xem chính xác. Ca cùng phiên bản vẫn APPROVED; ca lệch file/nhận xét tiếp tục bị chặn.

## 6. R19-13 — P1: Số thứ tự trên từng cửa sổ chưa bảo vệ được bản mới nhất

**Nguyên nhân:** `latestServerDraftSeq` là Map trong module server; UI tự đếm từ đầu ở mỗi lần tải trang. Server chỉ từ chối số nhỏ hơn, vẫn chấp nhận số bằng nhau. Mỗi yêu cầu gửi phần thay đổi riêng, nên bỏ toàn bộ yêu cầu cũ có thể làm mất một trường khác chưa từng được lưu. Số thứ tự còn được ghi trước khi kiểm tra đúng chủ sở hữu/nội dung và trước khi lưu thành công.

**Vị trí:** [`submissions/route.ts:163`](../../../src/app/api/homework-grader/submissions/route.ts#L163), đặc biệt 196–210, 212–225 và 346–349; bộ đếm UI tại [`homework-auto-grader-tab.tsx:97`](../../../src/components/homework-auto-grader-tab.tsx#L97), cập nhật từng phần tại 378–391 và 449–460.

**Bằng chứng chính:** `R22-13-two-tabs-equal-sequence` tạo hai bộ xử lý UI độc lập trên cùng API/SQLite, tương ứng hai cửa sổ. Cửa sổ thứ nhất gửi 60 điểm nhưng bị giữ lại; cửa sổ thứ hai lưu 90 điểm trước. Cả hai yêu cầu có **draftSeq=1**, đều được server trả **200**. Khi 60 đến sau, SQLite thành 60; cửa sổ thứ hai vẫn thấy 90 và không còn cờ chưa lưu. Bấm bulk từ cửa sổ thứ hai tạo **APPROVED 60**. Lỗi bulk của R19-06 góp phần khiến khác biệt này được duyệt; không tính thành hai sự cố độc lập khi cộng số lỗi.

**Bốn ca còn lại:**

- `R22-13-cross-field-reorder`: sửa nhận xét rồi sửa điểm ghi đè; yêu cầu điểm trả 200, yêu cầu nhận xét đến muộn bị 409. UI còn `LATEST FEEDBACK`, SQLite giữ nhận xét cũ, điểm ghi đè 25 và cờ chưa lưu rỗng. Nhận xét đã nhập bị mất nếu tải lại. Chưa chứng minh ca này duyệt sai nhận xét vì so sánh nhận xét bulk hiện chặn được.
- `R22-13-reload-counter`: sau hai lần lưu, UI mới bắt đầu lại ở 1 và lần sửa hợp lệ bị **409**, không lưu được bản thứ ba. Đây là lỗi sử dụng mức P2 trong nhóm.
- `R22-13-invalid-request-poison`: yêu cầu sai lớp có số 100 bị **400**, nhưng đã đẩy bộ đếm lên 100; yêu cầu đúng tiếp theo có số 1 bị **409**. Đây là tác dụng phụ của một yêu cầu bị từ chối, chưa phải bằng chứng tấn công từ bên ngoài.
- `R22-13-route-reload`: nạp lại module route trên cùng DB làm mất số 2; bản số 1 đến sau được **200**, ghi đè `LATEST` bằng `OLD AFTER RELOAD`.

Đối chứng `R22-13-reordered-same-field` đạt: số 2 lưu trước, số 1 đến sau trên cùng module bị 409 và dữ liệu `LATEST` giữ nguyên. Vì vậy sửa tại R22 đã giải quyết đúng ca cũ của R21, nhưng chưa bảo vệ đủ các tình huống trên.

**Cách sửa:** Lưu phiên bản đã commit ở SQLite, kiểm tra và ghi dữ liệu cùng một bước có điều kiện; UI lấy phiên bản từ server thay vì tự coi bộ đếm của mình là thứ tự chung. Tuần tự hóa lưu từng bài hoặc gửi bản nháp đầy đủ để không bỏ mất cập nhật khác trường. Chỉ nâng phiên bản sau khi kiểm tra định danh/nội dung và lưu thành công. Khi duyệt, tiếp tục đối chiếu bản đã xem như R19-06.

**Sau khi sửa:** Cả **5 ca FAIL thuộc R22-13** phải giữ được nội dung mới nhất hoặc báo xung đột rõ, không mất thay đổi; không duyệt 60 khi bản xem là 90. Giữ ca chặn số cũ của R21/R22.

## 7. R19-09 — P1: Tìm từ khóa trong GraphQL vẫn có thể xác nhận nhầm

**Nguyên nhân:** Đã bỏ comment và chọn operation theo tên, nhưng vẫn dùng biểu thức tìm chữ `grade/score/mark/evaluate` trong cả phần thân thay vì xác nhận trường lưu điểm thực sự. Có `operationName` mà thiếu `query` thì bỏ qua kiểm tra loại mutation. Các ID/điểm/nhận xét trong `variables` được kiểm riêng, không ràng buộc với đối số mà trường nghiệp vụ thật sự dùng; các lệnh `@skip` cũng không được xét.

**Vị trí:** [`grade-worker.ts:408`](../../../src/lib/playwright/grade-worker.ts#L408), các nhánh 424–460 và kiểm biến 462–544.

**Bằng chứng:** Bốn ca `R22-09-operation-missing-query`, `...alias-introspection`, `...skipped-grade`, `...literal-other-submission` đều **verified=1** với DOM đối chứng đang khớp điểm/nhận xét cũ.

- `mutation SaveHomeworkGrade { score: __typename }` chỉ trả tên kiểu dữ liệu dưới tên alias `score`; không có trường lưu điểm. Phản hồi giả đúng hình dạng `{ data: { score: "Mutation" } }` vẫn được nhận làm bằng chứng lưu.
- `saveHomeworkGrade @skip(if: true) { id }` bỏ qua trường lưu; phản hồi giả `{ data: {} }` vẫn được nhận.
- Trường lưu có đối số viết trực tiếp là `SUB_OTHER`, `S_OTHER`, điểm 1, nhận xét `WRONG`; `variables` riêng chứa bản SUB1/S1/80/nhận xét đã duyệt nhưng không được trường đó dùng. Bộ lọc vẫn nhận. Phản hồi giả cho ca này mang ID `SUB_OTHER`.
- Payload chỉ có tên operation và biến, không có query, cũng được nhận dù không đủ bằng chứng xác nhận loại thao tác.

Các ca query có comment, chọn query trong tài liệu nhiều operation và mutation attachment của R21 đều chặn đúng. Mutation hợp lệ và chọn đúng mutation sau query đều đạt đối chứng.

**Giới hạn:** Đây là bằng chứng bộ lọc chấp nhận sai hợp đồng với request/response giả, không phải khẳng định các tên trường, kiểu tham số hoặc hình dạng response minh họa là hợp đồng hiện tại của LMS thật. Chưa gọi endpoint hoặc ghi điểm thật. Giá trị `writes=1` trong kết quả R22 là **một lần bấm nút Lưu giả**, không phải số lần ghi LMS.

**Cách sửa:** Xác nhận chính xác operation được chọn, đúng trường nghiệp vụ ở cấp gốc, các đối số/biến thực sự dùng và điều kiện skip/include. Thiếu tài liệu/hợp đồng thao tác thì không được dùng phản hồi đó để nâng VERIFIED. Dùng bộ phân tích GraphQL phù hợp hoặc hợp đồng cụ thể đã được kiểm chứng; tránh thêm một danh sách từ cấm mới để chỉ vượt các mẫu hiện tại.

**Sau khi sửa:** Cả **4 ca FAIL thuộc R22-09** phải verified=0; đối chứng GRADE/REDO đúng tiếp tục verified=1.

## 8. R19-01 — P2: Header mạnh hơn nhưng dữ liệu file vẫn chưa đủ tin cậy

**Nguyên nhân:** CRC chỉ chứng minh chunk PNG không lệch checksum, không chứng minh dữ liệu giải nén là ảnh. JPEG kiểm số lượng/kích thước header nhưng không ràng buộc thành phần SOF với SOS. WebP nhận header VP8/VP8L rồi kết luận, còn VP8X chỉ kiểm tên chunk kế tiếp. PDF tìm chuỗi trong toàn bộ bytes, kể cả dòng comment, không dựng quan hệ đối tượng/trang.

**Vị trí:** [`media-reader.ts:91`](../../../src/lib/file-parsers/media-reader.ts#L91), 159–185, 209–230 và 239–246.

**Bằng chứng ảnh hỏng:** Sáu ảnh sau đều bị bộ giải mã `sharp` thật từ chối nhưng parser trả **PARSED + 1 inlineData**:

| Ca R22 | Mẫu có chủ đích |
|---|---|
| `01-png-valid-header-broken-deflate` | Header zlib `78 9c` và CRC đúng, dữ liệu nén hỏng. |
| `01-png-invalid-bit-depth` | Bit depth IHDR bằng 0, tính lại CRC đúng. |
| `01-jpeg-valid-markers-invalid-component` | DQT, kích thước SOF/SOS và số thành phần đúng dạng, nhưng SOS trỏ ID 2 không có trong SOF. |
| `01-webp-vp8-header-only` | Có start code, kích thước 1×1 nhưng thiếu dữ liệu ảnh. |
| `01-webp-vp8l-header-only` | Có signature/version 0 nhưng chỉ còn header. |
| `01-webp-vp8x-empty-child` | VP8X đúng dạng, theo sau là tên VP8 với payload 0 byte. |

Các mã trong bảng có tiền tố đầy đủ `R22-`. Lỗi bộ giải mã và số byte được lưu trong `independent-results.json`.

**Bằng chứng PDF:** Hai ca `R22-01-pdf-comments-only` và `...missing-pages` vẫn PARSED: mẫu đầu chỉ có các “khai báo đối tượng” trong dòng comment; mẫu sau có Catalog trỏ đến đối tượng Pages 999 không tồn tại. Không dùng bộ giải mã PDF độc lập; tính sai cấu trúc được chỉ ra trực tiếp từ toàn bộ mẫu 85/86 byte lưu trong kết quả.

**Hồi quy file hợp lệ:** `R22-01-webp-valid-transparent` tạo WebP trong suốt bằng `sharp`, giải mã lại thành công. File có VP8X → ALPH → VP8 nhưng parser trả **PARSE_ERROR** vì chỉ cho VP8/VP8L/ANMF ngay sau VP8X. Đây là file hợp lệ bị chặn, không phải file hỏng lọt qua.

Đối chứng PNG/JPEG/WebP/PDF thường giữ nguyên bytes đều đạt. CRC của IHDR/IDAT/IEND và header zlib không hợp lệ đều bị chặn đúng. Tổng nhóm: **9 FAIL**, gồm **8 mẫu hỏng được nhận và 1 mẫu hợp lệ bị từ chối**.

**Cách sửa:** Kiểm tra cấu trúc/khả năng giải mã thực trong giới hạn tài nguyên; ràng buộc thành phần ảnh và duyệt đầy đủ chuỗi chunk hợp lệ. PDF cần xác thực đối tượng và quan hệ trang, không chỉ tìm từ khóa. File lỗi phải PARSE_ERROR và không sinh inlineData; WebP trong suốt hợp lệ phải được giữ hỗ trợ.

**Sau khi sửa:** Cả **9 ca FAIL thuộc R22-01** đổi sang an toàn, đồng thời mọi đối chứng media hợp lệ của R20/R21/R22 vẫn đạt.

## 9. Những phần đã đóng thêm và hồi quy R12

**R19-04:** Sau AI, điều kiện hiện dùng `if (targetFilePath)` thay vì phụ thuộc việc grader tự parse. R21 đạt đủ 5 chế độ; R22 xác nhận riêng supplied-content với không đổi, đổi file và xóa file. Hai ca đổi/xóa đều `staleIgnored=true`, DB giữ nguyên. Đóng phần còn lại ở cấp mã nguồn.

**R19-05:** Ba handler gửi `rubric: activeRubric`. R22 chạy handler thật, xác nhận payload mang barem C1 và cả ba không cho tiêu chí `UNRELATED` được duyệt/lưu thay điểm. Không phát hiện lại lỗi UI bỏ barem của R21. Phạm vi đóng là barem đang chọn trong giao diện tin cậy và quy trình cục bộ được kiểm; chưa xác nhận barem thực tế trên từng tài khoản LMS.

**Cổng R12:** Bộ nguyên bản đạt **43/43**. Hai ca R22 dùng `mindx.edu.vn` và nhãn `lms-api` đều nhận URL hợp lệ và loại hostname giả/chuỗi đặt trong đường dẫn hoặc tham số. Đối chiếu diễn ra trên `parsedUrl.hostname` như yêu cầu. Bộ lọc nhãn là hợp đồng khớp nhãn hostname, không phải chứng nhận mọi hostname có nhãn đó đều thuộc MindX; worker Phase 5 dùng điều kiện domain `mindx.edu.vn`.

## 10. Độ tin cậy, giới hạn và việc tiếp theo

[verify-independent.mjs](verify-independent.mjs) tự chứa, có chốt chỉ chạy từ TEMP có tên R22. Harness kế thừa minh bạch từ R21/R20; [cases.mjs](cases.mjs) chứa các ca mới. Mã TypeScript sản phẩm được đọc từ snapshot, bỏ import/type để chạy nguyên thân hàm với phụ thuộc giả được chỉ rõ. Không sửa thân hàm sản phẩm. SQLite trong bộ nhớ và file fixture là thật; bộ giải mã ảnh đối chứng là `sharp` có sẵn. Thử nạp lại module dùng cùng DB, không vá code để xóa Map. Kiểm tra UI dùng bộ mô phỏng hooks xác định, không phải Chromium/React thật.

[artifact-check.json](artifact-check.json) xác nhận hash log, hash bộ cuối, kết quả cuối, mã ca duy nhất và liên kết hash nguồn với bản chụp. [audit-summary.json](audit-summary.json) ghi phán quyết và số liệu máy đọc được. Không cộng 145 + 49 + 53 thành số tình huống nghiệp vụ độc nhất vì có phần kiểm tra cùng hành vi. 25 ca mới trượt được phân theo 9 media + 7 duyệt/phiên bản + 4 GraphQL + 5 nháp; một số cùng liên quan một rủi ro đầu cuối.

**Chưa kiểm tra:** LMS/Teaching/Gemini thật, tài khoản và bài nộp thật, Chromium thật, tương tác hai cửa sổ thật, khởi động lại ứng dụng thật, hợp đồng GraphQL đang chạy trên LMS, hiệu năng hoặc nghiệm thu của Owner. Kết quả local/synthetic không thay các bước này.

Ưu tiên vòng sửa riêng: **R19-06 + R19-13**, sau đó **R19-09**, rồi **R19-01**. Không cần sửa lại hai nhóm mới đóng nếu không có bằng chứng hồi quy. Chỉ ký GO khi cả **14/14 CLOSED_SOURCE** và **toàn bộ lệnh bắt buộc PASS** trên cùng dấu vết nguồn.

### Prompt giao việc cho vòng sửa riêng

> Sửa đúng bốn nhóm còn mở theo `docs/audits/round-22/REPORT.vi.md`, không triển khai lại các nhóm đã đóng. R19-06: bắt buộc phiên bản đã xem cho mọi yêu cầu duyệt, so đủ file/nhận xét/tiêu chí/điểm ghi đè/quyết định trong bulk, lưu bền hash file đã chấm thay vì Map. R19-13: dùng phiên bản đã commit ở SQLite, xử lý hai cửa sổ và tải lại, giữ đủ các trường khi yêu cầu đến ngược thứ tự, không nâng bộ đếm khi yêu cầu bị từ chối. R19-09: xác nhận operation/trường nghiệp vụ/đối số thật sự chạy, chặn alias introspection, skip, thiếu query và biến đúng nhưng không được dùng. R19-01: chặn sáu ảnh không giải mã được, hai PDF giả, đồng thời giữ WebP alpha hợp lệ. Không sửa hoặc làm yếu bộ kiểm toán lịch sử. Chạy lại toàn bộ 11 lệnh được liệt kê trong snapshot mới và đối chiếu hash nguồn. Không dùng kết quả kiểm thử giả làm nghiệm thu LMS thật.

**Đã làm:** Kiểm toán chỉ đọc, bộ R22, toàn bộ lệnh yêu cầu và đối chiếu bảo toàn file.

**Kết quả:** **NO-GO**; 10 nhóm đóng, 4 nhóm còn mở; R22 còn 25 ca trượt dù các bộ cũ và build đều đạt.

**Chưa kiểm tra:** Dịch vụ, tài khoản, trình duyệt và nghiệm thu sử dụng thật.

**Việc tiếp theo:** Giao vòng sửa riêng theo prompt trên, rồi kiểm toán lại; không dùng phán quyết này để cho phép tự động ghi điểm thật.
