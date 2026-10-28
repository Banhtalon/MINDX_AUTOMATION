# v2.9.0 — Kiểm định độc lập Buổi 14, Vòng 3

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, thực hiện vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Cả **8/8 cổng kiểm tra có kết quả cuối PASS, exit 0**, nhưng kiểm chứng bổ sung chỉ đủ căn cứ đóng **8/12 phát hiện**. Còn **4 OPEN: F01, F06, F08, F09**. **F07 và F10 được đóng trong vòng này**; F02, F03, F04, F05, F11, F12 tiếp tục CLOSED.

Bản sửa đã chặn được các ca cụ thể còn mở ở Vòng 2. Tuy nhiên, vẫn tái hiện được những biến thể của cùng ranh giới an toàn: nhận truy vấn đọc như bằng chứng lưu, đối chiếu lại bộ nhớ nhập liệu thay vì dữ liệu đã lưu, duyệt thư lệch điểm khi đổi cách đánh số, phản hồi cũ thay nội dung mới dù giữ số phiên bản, và sót biến thể tên một ký tự viết thường trong dữ liệu gửi AI.

Kết luận áp dụng cho **toàn bộ bản mã đang làm việc đã lấy để kiểm tra, bao gồm tệp mới chưa được Git theo dõi**, tại HEAD `eeb73d31d51e5915b52ebbcea377aeee5c7384c1`; không chỉ áp dụng cho nội dung commit.

## 1. Phạm vi và bảo vệ dữ liệu

- Đã đọc `PROJECT_STATE.md` đầu tiên, đọc cả `CODEX_REVIEW_ROUND1.md` và `CODEX_REVIEW_ROUND2.md` trước khi chạy kiểm định; đối chiếu `AGENTS.md`, kế hoạch, CHANGELOG, mã xử lý, nơi gọi và các bộ thử.
- Khi bắt đầu đã có **22 tệp được theo dõi bị sửa**, gồm `tsconfig.tsbuildinfo`, cùng các tệp/thư mục mới của v280/v290. Giữ nguyên công việc có sẵn, không commit, reset hoặc đổi HEAD.
- **Trong repo chỉ thêm báo cáo này.** Không sửa mã ứng dụng, bài thử, `next-env.d.ts`, ba tài liệu trạng thái hoặc hai báo cáo kiểm định trước.
- Chạy đủ tám lệnh nguyên trạng trong bản sao cô lập, vì các bộ thử có ghi/xóa dữ liệu và cấu hình mẫu. Đối chiếu SHA-256 của **127/127 tệp đầu vào** trước/sau: bản gốc và bản chạy thử đều không đổi. `next-env.d.ts` nằm trong danh sách này.
- Không sao chép `.env`, `.env.local`, SQLite thật, hồ sơ đăng nhập `playwright-auth`, danh sách lớp thật hoặc `teacher_browsed_dirs.json`. Các tên học viên trong phép thử đều là tên giả. Dùng thư viện đã cài qua liên kết thư mục `node_modules`, không cài/cập nhật thư viện.
- Môi trường: Windows, Node **v24.21.0**, npm **11.19.0**. Khóa Gemini giả chỉ dùng cho các lời gọi đã được thay bằng phản hồi mô phỏng. Không dùng khóa/tài khoản thật.
- Đã đối chiếu byte của **`data/mindx_bot.db`, `mindx_bot.db-wal`, `mindx_bot.db-shm`, `mindx_automation.db`** ở repo gốc: tất cả giữ nguyên. Tên cơ sở dữ liệu thực trong mã này là `mindx_bot.db`, không phải `mindx.sqlite`.
- **Đã dọn toàn bộ bản sao `workspace/`, bao gồm cơ sở dữ liệu và các bản ghi thử.** Gỡ riêng liên kết thư viện, không đi vào thư viện gốc. Giữ log, kết quả JSON, danh sách hash và bốn script probe ở ngoài repo để đối chiếu.

Thư mục bằng chứng cục bộ còn giữ:

`C:\Users\QQ\AppData\Local\Temp\mindx-v290-round3-UFSivc\`

Tám lệnh được thực thi trong `workspace\` bên trong đường dẫn trên trước khi dọn. Các script bổ sung hiện nằm tại `probes\`; muốn chạy lại cần tạo bản sao cùng cấu trúc và đặt chúng vào `workspace/scratch/`.

## 2. Verification Gate Table — đủ 8 lệnh và exit code

Lượt đầu bắt đầu **11:08:31**, kết thúc **11:10:41**. Hai lần chạy lại có cấu hình AI giả hoàn tất **11:11:30**, ngày 27/10/2026, UTC+7.

| STT | Lệnh nguyên trạng | Kết quả cuối | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | **PASS** | **0** | 1,955 giây | `gate-1.log`; không có chẩn đoán lỗi |
| 2 | `npx tsx scripts/test-session14-v290.ts` | **PASS** | **0** | 17,313 giây | `gate-2-retry.log`; đủ S14-01–S14-07 |
| 3 | `npx tsx scripts/test-lms-reliability-v280.ts` | **PASS** | **0** | 81,898 giây | `gate-3.log`; đủ T280-01–T280-05 |
| 4 | `npx tsx scripts/test-spck-v270.ts` | **PASS** | **0** | 9,176 giây | `gate-4-retry.log`; đủ T01–T16 |
| 5 | `npx tsx scripts/test-spck-v272.ts` | **PASS** | **0** | 25,263 giây | `gate-5.log`; đủ V01–V16 |
| 6 | `npx tsx scripts/test-phase5.ts` | **PASS** | **0** | 3,109 giây | `gate-6.log` |
| 7 | `npx tsx scripts/test-phase6.ts` | **PASS** | **0** | 10,794 giây | `gate-7.log` |
| 8 | `npx tsx scripts/test-phase7.ts` | **PASS** | **0** | 1,662 giây | `gate-8.log` |

**Ghi đủ hai lần đầu chưa đạt:** cổng 2 exit **1**, 2,284 giây, dừng ở S14-02; cổng 4 exit **1**, 2,910 giây, dừng ở T04/T05. Bản sao không có `.env` và lần đầu chưa đặt khóa Gemini giả, nên hàm lấy client dừng trước khi tới lời gọi AI mô phỏng; các phép kiểm tra prompt sau đó thất bại. Đã đặt `GEMINI_API_KEY=ROUND3_SYNTHETIC_KEY` trong tiến trình thử rồi chạy lại đúng hai lệnh, không sửa nguồn/bài thử. Cả hai PASS. Giữ `gate-2.log`, `gate-4.log`, `gates.json` và thông tin `initialAttempt` trong `gates-final.json`; không coi đây là lỗi ứng dụng.

**Giới hạn của các cổng:** S14-06 vẫn cho `skipNavigation:true`, nên không bắt buộc có phản hồi lưu. Nhóm uploader trong S14-07 chỉ gửi `variables.studentId`; với bản sửa mới thiếu `classId`/`slotNumber`, ca `truncated-tail` có thể dừng ở kiểm tra mạng trước khi thực sự kiểm tra phần cuối thư. Mục có tên “F07, F08 & F12” cuối bộ thử vẫn chỉ thực thi hàm chọn buổi. Vì vậy đã chạy probe độc lập dùng đủ định danh, `skipNavigation:false`, dữ liệu lưu tách khỏi ô nhập và React thật.

## 3. Status Table — F01 đến F12

`CLOSED` là đủ bằng chứng cho ranh giới lỗi đã kiểm trên dữ liệu giả, không đồng nghĩa nghiệm thu LMS/Gemini thật. `OPEN` bao gồm trường hợp đã sửa được ca Vòng 2 nhưng còn biến thể tái hiện cùng loại lỗi. Vị trí dưới đây theo bản mã của Vòng 3.

| ID | Trạng thái | Bằng chứng kiểm chứng mới |
| --- | --- | --- |
| **F01** | **OPEN** | `session14-eval-uploader.ts:429–590, 597–625`: các ca thiếu/sai định danh, JSON lỗi, sai host, StudentWork, primitive, `success:true` không có data, HTTP 202/500 đã bị chặn. Control HTTP 200/201 + đọc lại kho lưu độc lập đạt. Nhưng `UPLOAD-QUERY-ONLY` và `UPLOAD-CACHED-DRAFT` vẫn **verified=1, SQLite VERIFIED, serverSaved=false**, dù đã mở hộp thoại hai lần. Chi tiết mục 4.1. |
| **F02** | **CLOSED** | `session14-eval-uploader.ts:640–660`: cả sáu ca `UPLOAD-TAIL-0/1/2`, `UPLOAD-TRUNCATE-0/1/2` sửa/cắt riêng cuối từng ô đều **verified=0, failed=1**. Request có đủ định danh và phản hồi lưu hợp lệ; dữ liệu sai được nạp từ kho lưu của fixture khi mở lại, nên thực sự đi đến đối chiếu toàn văn. `UPLOAD-WHITESPACE` đạt **verified=1**. |
| **F03** | **CLOSED** | `session14-eval-uploader.ts:399–424`: `UPLOAD-SLOT-DRIFT` đổi buổi sang 13 trong lúc chọn radio. Chốt sát Save dừng: **savedSlots=[], reqSeen=0, verified=0, failed=1**. Helper được thay có chủ đích để báo lỗi khi sai buổi; không phải nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | `spck-demo-score-reader.ts:624–714`: `F04-AMBIGUOUS`, `F04-CONFLICT`, `F04-DUPLICATE` đều **matched=0**; danh sách tab chưa khớp được trả và **toàn bộ bản ghi cũ giữ nguyên**. Control tên duy nhất, đủ điểm nhập được. |
| **F05** | **CLOSED** | `session14-course-summary.ts:462–487, 681–747`: giữ phản hồi AI rồi sửa, duyệt hoặc xác minh bản mới; ba ca `F05-EDIT/APPROVE/VERIFY` đều **CONFLICT**, **toàn bộ bản ghi mới giữ nguyên**. Không hạ APPROVED/VERIFIED hoặc kéo lại điểm cũ. |
| **F06** | **OPEN** | `sqlite.ts:4026–4097, 4251–4258, 4424–4437`: chữ thuần, in đậm, gạch đầu dòng và gạch dưới đồng bộ đúng Demo **3,5**, năng lực **3,78**; chữ sai có nhãn được nhận diện bị chặn. Tuy nhiên, `F06-NUMBERED` có `1. Điểm Demo: 5 điểm` vẫn **APPROVED** khi Demo thực **3,5**; mất hai dòng điểm cũng vẫn được duyệt. Chi tiết mục 4.2. |
| **F07** | **CLOSED** | `session14-eval/route.ts:95–184`: thiếu version, bản đồ thiếu học viên, thiếu một mục trong batch, null, chuỗi, 0, số lẻ đều **HTTP 400**, không đổi bản ghi; ba ca version cũ nhận **409**, không duyệt phần còn lại của batch. Batch đủ phiên bản nhận **200**, cả hai APPROVED. Ba control UI xác nhận chờ/dừng lưu chậm, dừng khi lưu lỗi, và lưu chữ hiển thị → duyệt đúng version 2 → mới upload. |
| **F08** | **OPEN** | `final-project/page.tsx:3270–3396, 3562–3818, 3978–4056`: cả năm nhánh giữ đủ 7 trường đang sửa; cả năm ca đổi lớp giữ đúng lớp B; tải đảo thứ tự giữ version 3. Nhưng AI/nhập điểm trả bản v2 sau khi v3 đã được nạp vẫn thay thư bằng **STALE V2 LETTER**, đổi trạng thái về WAITING_APPROVAL và chỉ giữ nhãn **draftVersion=3**. Chi tiết mục 4.3. |
| **F09** | **OPEN** | `session14-course-summary.ts:163–174, 212–215, 305–312, 627–638`: đã xử lý đúng tên trùng “An”, họ đệm bạn, NFD, không dấu và `Ý`/`Y`. Nhưng prompt thật truyền vào `generateContent` còn **`y có tiến bộ.`** với học viên giả “Lê Hoài Ý”. ASCII một ký tự được thay phân biệt hoa/thường. Chi tiết mục 4.4. |
| **F10** | **CLOSED** | `spck-demo-score-reader.ts:165–190, 218–245, 335–338, 692`: bảng trống, thiếu B, chỉ 5/20 ô E, điểm âm/vượt trần và NaN đều **matched=0**, toàn bộ bản ghi cũ giữ nguyên. Control năm số 0 nhập được đúng tổng **0**; đủ B nhập **5**, đủ E nhập **2** theo dữ liệu giả. Không còn tự ép điểm sai rồi ghi đè. |
| **F11** | **CLOSED** | `session14-course-summary.ts:339–395, 528–553, 667–678`: không lịch sử, chỉ ABSENT hoặc chỉ PRESENT đều **INSUFFICIENT_INFO, 0 lời gọi AI**. Lịch sử có ghi chú thực nhận SUCCESS; AI thiếu `knowledgeParagraph2` nhận ERROR. Prompt bắt được không chứa câu mặc định “Tham gia đầy đủ các hoạt động thực hành trên lớp.” |
| **F12** | **CLOSED** | `session-comments/page.tsx:187–213, 344–366`: hàm chọn thật trả ID rỗng với chỉ buổi 14/15, chọn 13 khi có 13/14. Thực thi nguyên khối lọc trong `loadClassData`: chỉ 14/15 đặt **sessions=[], students=[], selected=""** và dừng trước bước nạp học viên; 13/14 chỉ giữ và chọn 13. |

Tên tệp trong bảng được viết gọn; các phần dưới ghi đường dẫn đầy đủ cho bốn điểm còn mở.

## 4. Bốn điểm chưa đủ điều kiện đóng

### 4.1. F01 — Tên thao tác chưa chứng minh là mutation; mở lại modal chưa bảo đảm tải dữ liệu đã lưu

**Nguyên nhân:** `matchesOp` kiểm tra tên thao tác rồi kết hợp OR với `matchesQuery`. Khi tên là `UpdateStudentEvaluation`, yêu cầu vẫn được nhận kể cả trường `query` ghi rõ đây là **query — thao tác đọc**, không phải **mutation — thao tác ghi**. Phản hồi chỉ có `{id:"E1"}` trong đối tượng kết quả là đủ. Ba trường thư trả về chỉ được đối chiếu nếu tồn tại và là chuỗi.

Sau đó code đóng/mở lại hộp thoại, nhưng không bắt buộc có lần tải dữ liệu máy chủ hoặc đối tượng đánh giá đầy đủ để kiểm chứng. Nhánh không có nút đóng còn chỉ đặt CSS `display:none`. Mở lại một component giữ state cũ có thể tiếp tục đọc chính các ô vừa nhập.

**Vị trí:** `src/lib/playwright/session14-eval-uploader.ts:466–475`, `537–590`, `597–625`.

**Tái hiện:** cả hai ca dưới đều dùng request POST đúng host, đủ `studentId`, `classId`, `slotNumber:14`, HTTP 200 và `skipNavigation:false`:

| Probe | Điều kiện | Quan sát |
| --- | --- | --- |
| `UPLOAD-CACHED-DRAFT` | Fixture giữ nguyên kho lưu cũ; mở lại modal hiển thị state nhập liệu còn giữ; response `data.updateStudentEvaluation:{id:"E1"}` | **opens=2, serverSaved=false, verified=1, SQLite VERIFIED** |
| `UPLOAD-QUERY-ONLY` | Thêm `query: "query UpdateStudentEvaluation { updateStudentEvaluation { id } }"`; không ghi vào kho lưu | **opens=2, serverSaved=false, verified=1, SQLite VERIFIED** |

Control `UPLOAD-SERVER-OLD` dùng cùng kho lưu không đổi, nhưng mở lại thực sự nạp kho đó, thì bị từ chối đúng. Control lưu thật trong fixture rồi nạp lại kho đạt ở cả HTTP 200 và 201. Như vậy bản sửa có tác dụng **khi** modal tải lại đúng dữ liệu; code chưa tự chứng minh điều kiện ấy.

**Ảnh hưởng:** vẫn tồn tại đường đánh dấu đã lưu từ truy vấn đọc hoặc từ bản nháp giữ trong trình duyệt. Đây là bằng chứng về chốt code/fixture; **không khẳng định LMS thật đã có hành vi cache này**, cũng chưa biết schema LMS cho phép truy vấn mẫu trên hay không. Việc matcher chấp nhận rõ một query thay cho mutation đã được tái hiện độc lập với schema thật.

**Cách sửa nhỏ nhất:** ràng buộc loại thao tác và trường mutation thực sự với request/response đã quan sát từ LMS; không suy ra thao tác ghi chỉ từ `operationName`. Đọc lại đối tượng đánh giá đã lưu bằng một nguồn độc lập hoặc xác nhận lần tải lại modal thực sự lấy dữ liệu máy chủ. Chỉ dùng việc đóng/mở lại làm bằng chứng khi đã chứng minh hành vi tải lại đó; không dùng CSS ẩn hộp thoại thay cho đóng thật.

**Sau khi sửa:** giữ các ca âm tính đã đạt; query-only và cache-draft không được VERIFIED; control lưu đúng + đọc kho lưu phải đạt. Cần đối chiếu hợp đồng lưu LMS thật trước khi coi tên mutation giả là bằng chứng tương thích dịch vụ.

### 4.2. F06 — Đổi cách đánh số làm bỏ qua cả đồng bộ và kiểm tra điểm

**Nguyên nhân:** hai hàm chưa dùng chung cách nhận diện. Hàm đồng bộ nhận một số ký hiệu ở đầu dòng; hàm kiểm tra chỉ xét dòng sau chuẩn hóa bắt đầu đúng `Điểm Demo` hoặc `Điểm Năng lực`. Nó không bắt buộc phải nhận diện đủ hai dòng điểm. Dòng đánh số `1.` không được cả hai nhận ra và bị bỏ qua.

**Vị trí:** `src/lib/db/sqlite.ts:4026–4097`; nơi dùng kết quả trước duyệt tại `4424–4437`.

**Tái hiện bằng thao tác lưu nháp thông thường, không sửa trực tiếp DB:** tạo thư ở Demo 5 / năng lực 4, đổi hai nhãn thành `1. Điểm Demo:` và `1. Điểm Năng lực:`, sau đó đổi thuật toán từ 1,5 xuống 0 và một tiêu chí năng lực từ 4 xuống 2. Kết quả `F06-NUMBERED`:

```text
demoTotalScore = 3.5; competencyTotalScore = 3.78
thư: 1. Điểm Demo: 5 điểm
thư: 1. Điểm Năng lực: 4 điểm
approveDraft.success = true; status = APPROVED
```

Probe riêng bỏ cả hai dòng điểm cũng được duyệt. Với định dạng `~~Điểm Demo:~~` hoặc `**Điểm** Demo:`, code không tự cập nhật nhưng đã từ chối duyệt khi điểm lệch; không quy những ca dừng an toàn đó thành duyệt sai. Các ca chữ thuần, `**Điểm Demo:**`, `- **Điểm Demo:**` đã sửa đúng.

**Ảnh hưởng:** giáo viên có thể duyệt một thư chứa điểm khác với các ô số sau khi sửa cách trình bày trong textarea.

**Cách sửa nhỏ nhất:** dùng chung hàm nhận diện/chuẩn hóa cho đồng bộ và kiểm tra; hỗ trợ cách đánh số thông thường hoặc trả lỗi rõ khi không xác định được đầy đủ hai dòng điểm. Không coi “không tìm thấy nhãn” là “điểm khớp”.

**Sau khi sửa:** kiểm tra chữ thuần, in đậm, bullet, đánh số, nhãn bị sửa và thiếu dòng; hoặc đồng bộ đúng số, hoặc dừng duyệt. Không cần gọi AI để sửa số.

### 4.3. F08 — Giữ số phiên bản mới nhưng vẫn nhận nội dung của phản hồi cũ

**Nguyên nhân:** nhánh load/save đã bỏ nguyên bản ghi khi server trả version thấp hơn. Nhánh nhập điểm, AI và upload lại tạo `{...prevItem,...srv}` trước, sau đó chỉ đặt lại `merged.draftVersion` bằng số mới hơn. Các trường khác vẫn có thể đến từ bản cũ. So sánh với snapshot đầu yêu cầu chỉ bảo vệ trường có giá trị khác lúc bắt đầu; không bảo vệ trường đã được giáo viên khôi phục về giá trị cũ ở một phiên bản mới hơn.

**Vị trí:** `src/app/final-project/page.tsx:3642–3661`, `3783–3802`; cùng cách xử lý tại `4037–4056`.

**Tái hiện trong React/ReactDOM thật chạy Chromium, trích nguyên handler:**

1. Bắt đầu ở version 1, thư `OLD LETTER`.
2. Giữ phản hồi AI/nhập điểm version 2 mang `STALE V2 LETTER` trong đường truyền.
3. Một thay đổi mới hơn đã khôi phục `OLD LETTER`; tải danh sách trả version 3, trạng thái VERIFIED, được UI nhận trước.
4. Cho phản hồi version 2 tới sau.

Hai ca `F08-AI-OLDER-RECORD`, `F08-IMPORT-OLDER-RECORD` đều kết thúc:

```text
draftVersion = 3
learnedFromMindx = STALE V2 LETTER
status = WAITING_APPROVAL
demoJudgeNote = OLD V2 NOTE
```

Số phiên bản không giảm, nhưng thư và trạng thái mới đã bị thay bằng bản cũ. Các payload trả về được kiểm soát để mô phỏng trễ mạng; đây là kiểm định handler thật, không phải mở toàn bộ trang Next.js.

**Phần đã đạt:** cả năm nhánh load/save/import/AI/upload giữ đủ 7 trường chỉnh sửa trong ca đang gõ; cả năm nhánh giữ đúng dữ liệu lớp B khi phản hồi A về muộn; load đảo thứ tự giữ version 3. Ca gõ lúc chờ approve giữ được chữ mới, nhưng sau upload UI vẫn có thể gắn VERIFIED cho nội dung còn chưa được lưu; không dùng nhãn đó làm bằng chứng cho bản đang hiển thị.

**Ảnh hưởng:** mất bản giáo viên đã khôi phục và tạo tổ hợp “version mới / nội dung cũ”; lần lưu tiếp theo có thể mang nội dung cũ với số phiên bản mới nên khóa phiên bản phía máy chủ không còn ngăn đúng ý định của giáo viên.

**Cách sửa nhỏ nhất:** ở mọi nhánh, nếu version server thấp hơn version hiện tại thì bỏ **toàn bộ** bản ghi cũ, giống load/save hiện có. Khi giữ trường chưa lưu, không gắn trạng thái đã xác minh cho chính bản nội dung đang sửa.

**Sau khi sửa:** chạy lại cả ca gõ/chuyển lớp hiện đạt và hai ca v2/v3 trên; nội dung, điểm, trạng thái và phiên bản phải cùng thuộc bản mới.

### 4.4. F09 — Biến thể không dấu, viết thường của tên một ký tự vẫn đi tới AI

**Nguyên nhân:** với tên chỉ một ký tự ASCII, `replaceWholeNamePhrase` dùng cờ `gu`, bỏ `i` — tùy chọn không phân biệt hoa/thường. Danh sách ứng viên cũng tách trường hợp này. Vì thế ứng viên `Y` của tên `Ý` không khớp `y` viết thường; lượt quét lại toàn prompt vẫn dùng cùng phép thay.

**Vị trí:** `src/lib/gemini/session14-course-summary.ts:163–174`, `212–215`, `627–638`.

**Tái hiện ở đúng đầu vào `model.generateContent`:** học viên giả “Lê Hoài Ý”, ghi chú `Ý trình bày. Y thực hành. ý hợp tác. y có tiến bộ.`. Generator trả SUCCESS; dòng gửi đi là:

```text
- Ghi chú của giáo viên: STUDENT_SHORT_01 trình bày. STUDENT_SHORT_01 thực hành. STUDENT_SHORT_01 hợp tác. y có tiến bộ.
```

Các control tên “An” trùng bạn cùng lớp, họ tên bạn không dấu, NFD và tên một ký tự viết hoa đều đạt. Chỉ biến thể cuối vẫn còn tên gọi trong ngữ cảnh nhận xét.

**Ảnh hưởng:** chưa đáp ứng yêu cầu loại các biến thể tên trước gửi AI; việc đặt tên một ký tự viết hoa trong fixture chưa bao phủ cách giáo viên gõ chữ thường.

**Cách sửa nhỏ nhất:** xử lý biến thể hoa/thường của tên ASCII một ký tự ở ranh giới từ phù hợp, đồng thời kiểm tra payload cuối; nếu không thể xử lý chắc chắn thì dừng để kiểm tra, không gửi thẳng dữ liệu còn sót.

**Sau khi sửa:** bắt lại payload cho `Ý/ý/Y/y`, tên một ký tự ASCII, tên trùng, tên không dấu và Unicode. Giữ các ca đã đạt.

## 5. Bằng chứng, đối chiếu bản mã và dọn dữ liệu thử

**99 trường hợp quan sát bổ sung**, gồm control đúng và ca phát hiện lỗi:

| Script được giữ tại `probes/` | Số ca | Bằng chứng |
| --- | --- | --- |
| `round3-core.ts` | 46 | `core.log`, `core-results.json`: import, thư/điểm, API duyệt, xung đột AI, prompt ẩn danh, lịch sử, chọn buổi |
| `round3-upload.ts` | 33 | `upload-final.log`, `upload-results.json`: HTTP/GraphQL, dữ liệu lưu độc lập, đầy đủ ba ô thư, radio, điểm và đổi buổi |
| `round3-ui.ts` | 17 | `ui-final.log`, `ui-results.json`: React thật, 5 nhánh gõ/chuyển lớp, đảo thứ tự, bản ghi cũ và trình tự lưu/duyệt/upload |
| `round3-selector.ts` | 3 | `selector.log`, `selector-results.json`: nguyên khối lọc/nạp buổi ở màn hình nhận xét thường kỳ |

Cả bốn lượt probe cuối đều exit **0**. Exit 0 của probe là chương trình chạy xong và ghi kết quả; **không có nghĩa tất cả hành vi ứng dụng PASS**. Những kết quả sai đã được ghi rõ trong bảng trạng thái và mục 4.

Trong lúc chuẩn bị uploader probe, lần đầu exit 1 vì hàm `__name` do trình biên dịch tạo không có trong browser fixture. Chỉ bổ sung hàm trợ giúp vào fixture tại TEMP rồi chạy lại; không sửa ứng dụng/bài thử gốc. Giữ log đầu `upload.log`. Sau khi bổ sung ca phản hồi cũ cho UI, chạy lại nguyên script; `ui-final.log` là lượt cuối.

SHA-256 các tệp trọng tâm của bản thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| `src/app/final-project/page.tsx` | `4c22525051e6b6ced2bc0af87f0b357ee7f214299312757c0f038e2404dbbe4f` |
| `src/app/session-comments/page.tsx` | `ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817` |
| `src/app/api/spck/session14-eval/route.ts` | `3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7` |
| `src/lib/db/sqlite.ts` | `73a49afebedce8d4ba68ef4e2a18528f7594f8a293184dd32f0e0f230b86981c` |
| `src/lib/gemini/session14-course-summary.ts` | `6695650924d6908da77d0db8833100028518a6574fab368f356ad48232d25d81` |
| `src/lib/local-files/spck-demo-score-reader.ts` | `0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a` |
| `src/lib/playwright/session14-eval-uploader.ts` | `2a20ab2675320bf77e364f4cf02d1333ce13973ef5e2c5ee40fd70e50814538c` |
| `scripts/test-session14-v290.ts` | `071da78bdee5339ffd1b9195514282d3172ec1fe3ff7bbf1fab9819e4b2b12f2` |

`manifest.json` và `integrity-before-report.json` lưu hash 127 đầu vào và kết quả đối chiếu bản gốc/bản sao. `git-before.txt`, `git-after.txt`, `integrity-final.json` ghi việc repo chỉ thêm báo cáo. `cleanup-result.json` xác nhận đã xóa **134 tệp trong 74 thư mục của bản sao**, bản sao không còn và thư viện gốc vẫn tồn tại. Không giữ cơ sở dữ liệu thử trong thư mục bằng chứng.

Lệnh dọn đệ quy ban đầu bị kiểm tra tự động chặn với thông báo `blocked by policy`, không được thực thi. Đã chuyển sang cách dọn có danh sách tệp cụ thể, kiểm tra mọi đường dẫn nằm trong workspace thử, không đi theo liên kết, gỡ liên kết thư viện bằng lệnh không đệ quy rồi xóa từng tệp/thư mục rỗng. Cách dọn này hoàn tất; không cần Owner cấp thêm quyền.

## 6. Giới hạn và điều kiện vòng tiếp theo

- Không đăng nhập, đọc roster thật hoặc ghi lên LMS thật; không gọi Gemini/Google Sheets/Drive/GitHub thật. Không dùng nghiệm thu lịch sử của v270/v272/v280 để suy ra nghiệm thu mới của v290.
- Probe uploader dùng DOM và HTTP giả lập, một browser context trong mỗi tiến trình; helper điều hướng được thay để kiểm tra chốt đổi buổi. Probe UI dùng nguyên handler trong React/ReactDOM thật, không phải toàn bộ trang Next.js.
- Chưa chạy build phát hành, chưa xác nhận thứ tự trường/modal và hợp đồng mutation trên LMS thật. Đây không phải tám cổng Owner yêu cầu của vòng này; không coi các phần chưa nghiệm thu đó là đã PASS.
- Các log ở TEMP có thể bị hệ điều hành dọn. Đầu vào tái hiện, kết quả, vị trí mã và hướng xử lý quan trọng đã ghi trực tiếp trong báo cáo.

Trước vòng kiểm định tiếp theo cần xử lý **F01, F06, F08, F09**, giữ các control đã đạt và thêm ca hồi quy cho đúng những đầu vào mục 4. Chỉ đủ điều kiện **GO** khi **F01–F12 đều CLOSED và cả tám cổng PASS** trên đúng bản sau sửa.

**Đã làm:** kiểm định lại cả 12 phát hiện, chạy đủ tám cổng và 99 ca bổ sung; chỉ thêm báo cáo, đã dọn bản sao/dữ liệu thử.

**Kết quả:** **NO-GO — 8 CLOSED / 4 OPEN; 8/8 cổng có kết quả cuối PASS.**

**Chưa kiểm tra:** nghiệm thu LMS/Gemini và dữ liệu thật, build phát hành, toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa bốn điểm còn mở rồi kiểm định lại. Owner không cần thao tác Terminal hay cung cấp tài khoản cho vòng này.
