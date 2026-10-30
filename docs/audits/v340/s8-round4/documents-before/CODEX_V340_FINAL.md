> **Tr?ng th?i hi?n t?i ? S8 Round 3 (30/10/2026): VERDICT: NO-GO.** **S8-01: CLOSED; S8-02: CLOSED; S8-R2-01: CLOSED ? 3/3 ph?t hi?n c? ?? ??ng.** T?m l?nh/probe b?t bu?c PASS: t?i nguy?n 5/5, path 403, browser 0 context ph?, edge 20/20, TypeScript v? ba suite SPCK/S5/S7. Ki?m tra b? sung ?nh h?p l?/junction **11/14 PASS, 3 FAIL**: hai l?i m?i **S8-R3-01, S8-R3-02 (MEDIUM OPEN)** l?m m?t ?nh n?n trong thu?c t?nh style v? t?p CSS li?n k?t. Hai t?p d? li?u th?t gi? nguy?n SHA-256; 2.892/2.892 t?p b?t bi?n gi? nguy?n. **S8 ch?a ??ng**, ch?a nghi?m thu l?p/d?ch v? th?t. [B?o c?o v? h??ng s?a Round 3](CODEX_V340_FINAL_ROUND3.md).

---

## L?ch s? S8 Round 2 ? gi? nguy?n n?i dung tr??c Round 3 b?n d??i

> **Trạng thái hiện tại — S8 Round 2 (30/10/2026): VERDICT: NO-GO.** **S8-01: CLOSED; S8-02: CLOSED — 2/2 phát hiện cũ đã đóng.** Còn **S8-R2-01 (HIGH OPEN)** mới trong bộ dựng HTML thay thế: đọc ảnh ngoài Path Allowlist qua tài nguyên HTML/CSS chưa được chặn ở tầng PyQt6. Bốn lệnh bắt buộc và hai probe gốc đạt; 20/20 ca bổ sung đạt cuối; ba ca đọc ảnh giả ngoài phạm vi tái hiện được. Hai tệp dữ liệu thật giữ nguyên SHA-256; 2.042/2.042 tệp bảo vệ không đổi trong audit. Chi tiết, bằng chứng và hướng sửa: [CODEX_V340_FINAL_ROUND2.md](CODEX_V340_FINAL_ROUND2.md). **Chưa đóng S8/nghiệm thu toàn bộ v3.4.0.**

---

## Lịch sử S8 Round 1 — giữ nguyên báo cáo gốc bên dưới

# Final Acceptance Audit — MINDX-AUTOMATION v3.4.0 — S8.2

**Final verdict: NO-GO cho nghiệm thu tổng thể v3.4.0 theo các quy tắc hiện hành.**

Ngày: **30/10/2026**, Asia/Saigon. Reviewer: Codex trực tiếp kiểm định độc lập theo vai trò Owner yêu cầu `gpt-6.1-sol high`; không có phép đo runtime riêng để xác nhận tên model. Không sửa mã ứng dụng, bài kiểm thử sản phẩm hoặc dữ liệu thật; không commit/push.

**Tóm tắt:** Đủ **9/9 hồ sơ đóng chặng S0–S7 ghi GO**, gồm S5a và S5b riêng. Chạy mới TypeScript, tám bộ S1–S7 và build Webpack đều có kết quả cuối **PASS**; probe ẩn danh nguyên bản **116/116 PASS**, thu đủ **20 payload**. Tuy nhiên kiểm tra độc lập bổ sung xác nhận **2 mục MEDIUM OPEN**: phần duyệt thư mục bỏ qua Path Allowlist và các bộ xử lý ảnh tạo BrowserContext riêng ngoài quy tắc hiện hành. Cả hai đã có ở snapshot S0; không quy là hồi quy mới của S7. **GO cục bộ của từng chặng vẫn được ghi nhận, không tự chuyển thành GO cho toàn bộ sáu trục nghiệm thu.**

## 1. Mốc mã và phạm vi

- HEAD: **`faf9fbc775b56bed79c766720589783b08fcee5c`**, cộng cây làm việc có sẵn khi bắt đầu. Mốc xuất phát: **`d7e3fe85a4c314631a45e21fd3647a528bb4fd1b`**.
- Hai thay đổi giao diện có sẵn: `src/app/layout.tsx` sửa tiêu đề từ v3.0 thành v3.4.0; `src/app/page.tsx` sửa v3.4 thành v3.4.0. Không bỏ các thay đổi này. Ba tài liệu tiến độ, trạng thái parity-manifest và hai tệp hồ sơ S8 chưa được theo dõi cũng đã có trước audit.
- Nguồn được khóa bằng [protected-before.json](s8-final/protected-before.json), [git-status-before.txt](s8-final/git-status-before.txt), [working-tree.patch](s8-final/working-tree.patch). Bản tài liệu trước audit: [documents-before/](s8-final/documents-before/).
- Đọc `PROJECT_STATE.md` trước, sau đó kế hoạch, changelog, `AGENTS.md`, `GEMINI.md`, chín báo cáo đóng chặng và các tuyến mã liên quan. Thứ tự lịch sử Git: S0 `d7e3fe8` → hồ sơ S0 `bba7c13` → S1 `29e7097` → S2 `ab3f570` → S3 `930132f` → S4 `93b77e0` → S5a `a78c5a1` → S5b `2ce9735` → S6 `2364c93` → S7 `faf9fbc`.
- Bản sao kiểm thử: `C:\Users\QQ\AppData\Local\Temp\mindx-s8-final-7d1r1sf8`. Bản build sạch: `C:\Users\QQ\AppData\Local\Temp\mindx-s8-build-1793369357`.
- Đây là kiểm định mã và kiểm thử cục bộ có dữ liệu giả. Không đăng nhập hoặc ghi LMS, Teaching, Gemini, Drive, GitHub, YouTube thật. Không dùng hồ sơ trình duyệt hoặc danh sách học viên thật.

## 2. Stage closure verification: S0 → S7

| Chặng | Hồ sơ quyết định cuối đã kiểm | Kết quả ghi nhận | Phạm vi và đối chiếu lần này |
|---|---|---|---|
| S0 | [CODEX_S0_ROUND2.md](CODEX_S0_ROUND2.md) | **GO**, S0-01 CLOSED | Snapshot `d7e3fe8`; đối chiếu lại hash production và tệp bảo vệ từ S0. |
| S1 | [CODEX_S1_ROUND2.md](CODEX_S1_ROUND2.md) | **GO**, 5/5 + 2/2 đóng vòng | Chạy mới bộ S1: hàng đợi, Teaching client dùng chung, FAILED retry, hash drift, slot động. |
| S2 | [CODEX_S2_ROUND3.md](CODEX_S2_ROUND3.md) | **GO**, 6/6 CLOSED | Chạy mới bộ S2: danh sách lớp chung, bốn màn dùng ClassPicker, refresh và Stop. |
| S3 | [CODEX_S3_ROUND5.md](CODEX_S3_ROUND5.md) | **GO**, 8/8 CLOSED | Chạy mới bộ S3: lưu nháp chồng lấp, duyệt/đẩy gộp và Zalo; không chạy lại toàn bộ Chromium probe riêng của Round 5. |
| S4 | [CODEX_S4_ROUND3.md](CODEX_S4_ROUND3.md) | **GO cục bộ**, 6/6 CLOSED | Chạy mới bộ S4: quét, duyệt/đồng bộ, nguồn Buổi 14 và cảnh báo cũ. |
| S5a | [CODEX_S5A_ROUND2.md](CODEX_S5A_ROUND2.md) | **GO**, 3/3 CLOSED | Chạy mới bộ S5a; **9/9** đối chiếu HTML/PNG đạt. Bài này cố ý so hai phiên bản lịch sử `93b77e0`/`a78c5a1`, không chứng minh UI hiện tại giống hệt UI trước S5b/S6. |
| S5b | [CODEX_S5B_ROUND3.md](CODEX_S5B_ROUND3.md) | **GO cục bộ**, 7/7 CLOSED | Chạy mới bộ S5: pipeline, thiếu Demo một phần, AI gộp, nộp hai phần, reset và retry độc lập. |
| S6 | [CODEX_S6_ROUND3.md](CODEX_S6_ROUND3.md) | **GO cục bộ**, 7/7 CLOSED | Chạy mới bộ S6, gồm Chromium cho tiến độ/handoff; build sạch lần này đã PASS, vượt giới hạn build chẩn đoán của hồ sơ S6. |
| S7 | [CODEX_S7_ROUND2.md](CODEX_S7_ROUND2.md) | **GO cục bộ**, 2/2 CLOSED | Chạy mới S7-T1–T6 và probe Round 1 nguyên bản: **116/116**, đủ 20 payload. S7.5 vẫn bỏ qua đúng kế hoạch đã duyệt. |

Chín hồ sơ đều tồn tại và phần kết luận cuối ghi GO; fingerprint và đoạn quyết định được lưu trong [static-inspection.json](s8-final/static-inspection.json). Đây là đối chiếu hồ sơ lịch sử cộng chạy mới các bộ được yêu cầu, không phải tuyên bố đã chạy lại mọi cổng/probe của tất cả vòng cũ.

## 3. Hai phát hiện còn mở

### S8-01 — MEDIUM — Duyệt thư mục đọc ngoài Path Allowlist

**Nguyên nhân:** Nhánh `action: list` kiểm tra yêu cầu đến từ máy cục bộ, nhưng nhận `body.path`/`initialDir`, tìm thư mục rồi đọc danh sách con mà không gọi kiểm tra Path Allowlist. Chỉ nhánh `action: select` mới đăng ký thư mục giáo viên chọn. Kiểm tra nguồn yêu cầu cục bộ không thay thế kiểm tra đường dẫn.

**Vị trí:** `src/app/api/spck/browse-folder/route.ts:67` (`fs.readdirSync`), `:84` (`resolveStartDirectory`), `:142`–`:150` (nhận đường dẫn và gọi đọc). Không có khác biệt ở tệp này giữa S0 `d7e3fe8` và cây nguồn được kiểm.

**Bằng chứng mới:** [path-probe.cjs](s8-final/path-probe.cjs), [path-probe.json](s8-final/path-probe.json). Chỉ dùng thư mục giả trong TEMP. Bài dò thu hẹp `config.allowedLocalDirs` trong tiến trình về một thư mục giả, tương tự các suite có cấu hình nội bộ riêng; thư mục đối chứng nằm ngoài cả vùng đó và workspace mirror. Kết quả:

| Quan sát | Mong đợi | Thực tế |
|---|---|---|
| `assertPathAllowed` với thư mục đối chứng | Từ chối | **Từ chối**, đúng đối chứng |
| POST `action=list` với cùng đường dẫn, Host/Origin cục bộ hợp lệ | HTTP 403, không đọc danh sách | **HTTP 200**, trả `SYNTHETIC_PRIVATE_DIRECTORY` |
| Thư mục đã được đăng ký chọn hay chưa | Chưa đăng ký | **Chưa đăng ký** |

Phạm vi tác động đã chứng minh là **đọc tên thư mục ngoài vùng cho phép**; không tuyên bố đã đọc nội dung file, lấy khóa bí mật hoặc khai thác từ Internet.

**Cách sửa nhỏ nhất đề nghị:** Kiểm tra đường dẫn ở nhánh liệt kê và các đường dẫn dự phòng trước khi đọc; chỉ mở rộng vùng cho phép qua hành động chọn thư mục rõ ràng của giáo viên. Nếu sản phẩm cần điều hướng ngoài allowlist trước khi chọn, phải thiết kế và phê duyệt ngoại lệ giới hạn riêng; không tự coi đó là ngoại lệ đã có trong AGENTS.

**Điều kiện đóng:** Bài dò hiện tại phải nhận 403 cho thư mục ngoài vùng cho phép; thư mục hợp lệ vẫn liệt kê được; chọn thư mục hợp lệ vẫn hoạt động; kiểm tra thêm đường dẫn dự phòng và junction trỏ ra ngoài. Không yêu cầu Owner chạy lệnh kỹ thuật.

### S8-02 — MEDIUM — Bộ xử lý ảnh nằm ngoài quy tắc một BrowserContext/hàng đợi

**Nguyên nhân:** `BrowserManager` quản lý một persistent context cho LMS, nhưng hai bộ xử lý ảnh tự gọi `chromium.launch()` và `browser.newContext()`. Route chụp ảnh gọi trực tiếp bộ xử lý, không đi qua `SequentialTaskQueue`. Đây là sai khác với câu chữ tuyệt đối của Rule 3, không phải bằng chứng hai phiên LMS đang dùng chung tài khoản bị đụng nhau.

**Vị trí:** `src/lib/local-files/spck-image-normalizer.ts:59`/`:61`; `src/lib/local-files/spck-app-screenshotter.ts:929`/`:933`; `src/app/api/spck/capture-screenshots/route.ts:220`. Những tệp này không đổi so với S0. `PROJECT_STATE.md` có mô tả Chromium cô lập dùng xử lý ảnh; `AGENTS.md` và `GEMINI.md` chưa quy định ngoại lệ tương ứng.

**Bằng chứng mới:** [static-inspection.json](s8-final/static-inspection.json) liệt kê năm điểm tạo browser/context; [browser-policy-probe.cjs](s8-final/browser-policy-probe.cjs) thay hàm mở trình duyệt bằng đối tượng giả rồi gọi hàm chuẩn hóa ảnh thật. [Kết quả](s8-final/browser-policy-probe.json): **1 standalone launch, 1 newContext, đóng đúng 1 lần, `offline:true`**, không gọi persistent context. Không mở trình duyệt thật trong probe này. Nhánh chụp HTML riêng được xác nhận bằng mã nguồn, không chạy dự án học viên thật.

**Cách xử lý đề nghị:** Làm thống nhất hợp đồng Rule 3 với thiết kế xử lý ảnh. Nếu giữ các renderer cô lập, cần ngoại lệ rõ ràng cho tác vụ ảnh không dùng hồ sơ LMS, kèm ranh giới mạng/tài nguyên và cách điều phối đã kiểm chứng; giữ mọi công việc LMS/Teaching trong hàng đợi. Không đề nghị đưa HTML học viên vào trình duyệt đã đăng nhập LMS chỉ để đạt câu chữ “một context”. Audit này không tự sửa quy tắc hoặc mở rộng ngoại lệ.

**Điều kiện đóng:** Mã và quy tắc thống nhất; kiểm thử phân biệt renderer với browser có đăng nhập; xác nhận route chụp ảnh không làm công việc LMS/Teaching chạy đồng thời ngoài hàng đợi và renderer tuân thủ giới hạn đã duyệt.

## 4. Sáu trục tuân thủ AGENTS.md / GEMINI.md

Lưu ý: mục 6 thật trong hai tệp quy tắc là **Team Workflow & Owner Communication**. “Protected Regression Files” là trục số 6 trong prompt nghiệm thu và mục 5 của PROJECT_STATE; bảng dùng cách đánh số của prompt, không đổi tên quy tắc gốc.

| Trục nghiệm thu | Kết quả | Bằng chứng và giới hạn |
|---|---|---|
| 1. Một nguồn trạng thái, tài liệu/nhãn v3.4.0 | **PASS cho phiên bản và trạng thái audit** | Ba tài liệu ghi v3.4.0; Navbar `:61`, Dashboard `:86`, layout `:7` cùng v3.4.0. Cuối audit cập nhật ba tài liệu với NO-GO S8.2, giữ S8 tổng thể chưa đóng. Nhãn layout/Dashboard là thay đổi có sẵn được audit. `package.json` vẫn có phiên bản gói 1.0.0; không nằm trong ba nhãn UI được prompt yêu cầu. |
| 2. Local-only, không lộ khóa, Path Allowlist | **FAIL — S8-01** | `package.json` dev/start chỉ `127.0.0.1`. Portal có token ngẫu nhiên (`randomBytes`, `:362`), bind `0.0.0.0` (`:507`), kiểm token (`:695`) và đường dẫn lớp/đích (`:872`, `:912`, `:923`). Quét 19 tệp `use client` và 25 mô-đun cục bộ trong đồ thị import không thấy ba khóa nhạy cảm hoặc import config máy chủ. Tuy nhiên nhánh liệt kê thư mục vượt allowlist đã tái hiện. |
| 3. BrowserContext, hàng đợi, đọc lại sau ghi, Checkpoint | **PARTIAL / FAIL theo quy tắc tuyệt đối — S8-02** | `browser-manager.ts:139` dùng một persistent context tại `playwright-auth`, có khóa khởi tạo. `/api/spck/list:284` và `/api/classes/refresh:143` vào hàng đợi; Teaching project/report-card cũng enqueue. S1/S2/S6 kiểm các nhánh hàng đợi/Stop và dịch vụ giả. `save-comments.ts:774`–`:919` bảo vệ editor Checkpoint, không dùng textarea/switch của năng lực; `:1054` trở đi đọc trạng thái năng lực; `:1385`–`:1536` đọc lại và kiểm hash trước VERIFIED. Không phát hiện nhánh tự tích ĐNL mới. Hai renderer tạo context riêng là sai khác còn mở; chưa chạy kiểm thử Checkpoint trên LMS thật. |
| 4. Khóa dữ liệu, SHA-256, phiên bản, hạ duyệt/retry | **PASS trong kiểm thử cục bộ** | SQLite dùng khóa lớp/buổi/học viên và submission riêng; SPCK thêm sessionNumber để không ghi đè buổi khác. S1 kiểm FAILED + hash khớp được thử lại, lệch hash bị hạ duyệt; S3 kiểm ghi chồng lấp/từ chối duyệt dữ liệu cũ; S5 kiểm phiên bản sau công cụ và combo. Route report-card/Teaching trả 409 khi phiên bản cũ; sync kiểm liveHash/expectedVersion và đối chiếu trước VERIFIED. Không ghi DB thật để thử. |
| 5. AI guardrails, Zalo, ảnh bìa | **PASS trong mã/fixture, chưa xác nhận AI thật** | Năm bộ sinh dùng `src/lib/ai/pii-anonymizer.ts`; S7-T6 và probe bắt đủ 20 payload, 116/116 kiểm tra đạt cho tên có/không dấu, tên file nối/viết liền và tên một ký tự. S3 kiểm INSUFFICIENT_INFO, bố cục ba phần và Zalo dùng chung; `comment-generator.ts:263`, `:567`–`:593` có điều kiện dữ liệu và quy tắc giọng văn/định dạng năm cấp độ. Zalo tịnh tiến +7 ngày, phần BTVN chỉ có khi có dữ liệu ảnh; S3 xác nhận cấu trúc sáu mục. Homework có PARSE_ERROR và tính tổng tiêu chí bằng mã; S5 xác nhận Logo MindX mặc định tồn tại/hợp lệ. Không khẳng định mọi đầu ra AI thật luôn đủ 100–300 từ hoặc không bao giờ sai nội dung. |
| 6. Tệp hồi quy và dữ liệu production | **PASS** | `git diff d7e3fe8 -- next-env.d.ts docs/audits/round-12 … round-41` không có tệp đổi. **2.003/2.003** tệp nguồn/test/quy tắc/hồ sơ được theo dõi giữ hash trong audit, gồm **1.853** tệp round-12–round-41 và **145** tệp src/scripts. Hai hash production khớp chuẩn trước/sau. Build chỉ đổi tệp sinh trong TEMP; khôi phục next-env của bản sao sau khi giữ hash chẩn đoán. |

Đồ thị import là phép kiểm tra tĩnh các import cục bộ nhận diện được; không phải chứng minh hình thức cho mọi import động hoặc bên trong thư viện. Rule 6 thật về vai trò/giao tiếp được thực hiện theo yêu cầu Owner chỉ định Codex làm reviewer độc lập; không gán kết quả cho Claude hay một reviewer không được chạy.

## 5. Giảm thao tác và liên thông năm màn hình

Quy ước: các con số mục tiêu là **nhóm thao tác chính trong luồng thuận lợi**, sau khi dữ liệu lớp/thư mục/điểm đã sẵn. Không được diễn giải thành tổng số lần nhấn chuột từ trang trống. Chọn lớp, chọn buổi, mở bộ chọn thư mục, xác nhận điểm danh, xử lý lỗi và Copy Zalo có thể là thao tác riêng.

| Màn/luồng | Mục tiêu | Đối chiếu mã và chạy mới | Kết luận trong phạm vi audit |
|---|---|---|---|
| Màn 1 `/session-comments` | 5 → 3 | ClassPicker + buổi; AI; Duyệt & Đẩy LMS; Copy Thông báo Zalo. S2/S3 PASS, gồm flush nháp trước AI/duyệt và bảo toàn dữ liệu chồng lấp. `handleGenerateAi:2695` hỏi xác nhận UNKNOWN tại `:2719`, rồi chỉ điểm danh UNKNOWN và giữ ABSENT. | **Có luồng gộp**. Ba nút nghiệp vụ AI / Duyệt & Đẩy / Copy sau chuẩn bị; UNKNOWN thêm một lần OK, chưa tính chọn lớp/buổi. Không xác nhận “toàn bộ chỉ đúng 3 lần nhấn”. |
| Màn 2 `/homework-grader` | 4 → 2 | Quét Điểm BTVN & Checkpoint từ LMS (`teaching-report-card-view.tsx:1862`) → Duyệt & Đồng bộ Teaching (`:1883`). Staleness banner `:2153`, nút Quét lại `:2175`. S4 PASS. | **Đạt luồng hai hành động chính** sau chọn lớp/kiểm bảng. Nhãn thực tế khác chữ minh họa trong prompt nhưng cùng hành vi. |
| Màn 3 `/final-project`, Buổi 12/13 | 6 → 4 | Chọn lớp/buổi → Quét & Khớp HV → AI nhận xét → Nộp N bài — Buổi X. `autoRunToolsAfterScan` mặc định true; S5 xác nhận pipeline theo loại lớp, duyệt/nộp và giữ lịch sử từng buổi. | **Có đủ bốn nhóm thao tác** theo cách đếm mục tiêu. Chọn thư mục ban đầu/ghép thủ công/xác nhận hạ duyệt vẫn có thể thêm thao tác. |
| Màn 3 `/final-project`, Buổi 14 | ~11 → ~6 | Pipeline + auto-import Demo còn thiếu → AI soạn tất cả → Nộp Buổi 14 đầy đủ. S5 Chromium xác nhận hai phần độc lập, lỗi sớm/reset kết quả và retry giữ phần kia; S6 kiểm chỉ mở handoff khi đủ VERIFIED. | **Luồng rút gọn hoạt động trong fixture**. Con số ~6 phụ thuộc thư mục, bảng Demo và các xác nhận; không có phép đo lớp thật hoặc bộ đếm click toàn hành trình trong lần này. |
| Màn 5 `/teaching-projects` | 5 → 1–2 | ClassPicker chung; nút cập nhật theo buổi hiện tại; phần chỉnh chi tiết thu trong Nâng cao. S6-T4 chạy Chromium mới; trường hợp thiếu lịch bị khóa, không đoán buổi. | **Đạt một nút cập nhật sau chọn lớp** hoặc hai nhóm gồm chọn lớp. Chưa ghi tiến độ Teaching thật. |
| Trang chủ `/` và handoff | Thẻ việc cần làm, Màn 3 → Teaching/Phiếu điểm | Navbar có năm trang: `/`, `/session-comments`, `/homework-grader`, `/final-project`, `/teaching-projects`; Cài đặt tách bên phải. S6 kiểm Dashboard theo học viên đang học, 99,9% chưa hoàn tất, query class/session/autoScan, chặn gợi ý khi chưa đủ điều kiện. Dashboard có force-dynamic/revalidate=0; build lần này đánh dấu `/` động. | **PASS cục bộ** cho điều kiện và chuyển tiếp đã thử. Không cần tạo “Màn 4” giả; Trang chủ là trang thứ năm trong nhóm điều hướng hiện tại. |

Các hồ sơ S2/S3/S6 đã có browser probes riêng được ghi nhận theo phạm vi lịch sử. Lần này chạy mới Chromium trong S5a/S5/S6; S3 dùng bài kiểm thử VM/route hiện có. Không có phép đo trước/sau với cùng lớp thật để chứng minh tỷ lệ tiết kiệm thời gian hoặc số click tuyệt đối.

## 6. Lệnh kiểm tra và build

Trước mỗi tiến trình kiểm tra, đặt:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = Join-Path $env:TEMP 'mindx_codex_s8_final.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $env:TEMP 'mindx_codex_s8_final_rc.json'
$env:GEMINI_API_KEY = 'test-s8-dummy-key'
```

Không chép `.env`, dữ liệu production hoặc hồ sơ đăng nhập. Thư viện sẵn có được nối vào mirror; guard Node chặn kết nối ngoài và khóa giả đặt ngay từ đầu. Một số suite tự chuyển DB/cache/allowlist sang fixture TEMP bên trong tiến trình; không sửa hành vi đó. Hai probe bổ sung cũng có thay thế nội bộ rõ trong mã. Không có test nào dùng hai đường dẫn production.

| Lệnh | Exit cuối | Thời gian | Bằng chứng |
|---|---:|---:|---|
| `npx tsc --noEmit --incremental false` | **0** | 1,92s | [tsc.log](s8-final/tsc.log) |
| `npx tsx scripts/test-streamline-v340-s1.ts` | **0** | 2,05s | [s1.log](s8-final/s1.log) |
| `npx tsx scripts/test-streamline-v340-s2.ts` | **0** | 2,18s | [s2.log](s8-final/s2.log) |
| `npx tsx scripts/test-streamline-v340-s3.ts` | **0** | 2,00s | [s3.log](s8-final/s3.log) |
| `npx tsx scripts/test-streamline-v340-s4.ts` | **0** | 2,02s | [s4.log](s8-final/s4.log) |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | **0** | 26,77s | [s5a.log](s8-final/s5a.log); 9/9 HTML/PNG parity |
| `npx tsx scripts/test-streamline-v340-s5.ts` | **0** | 8,09s | [s5.log](s8-final/s5.log) |
| `npx tsx scripts/test-streamline-v340-s6.ts` | **0** | 4,85s | [s6.log](s8-final/s6.log) |
| `npx tsx scripts/test-streamline-v340-s7.ts` | **0** | 2,29s | [s7.log](s8-final/s7.log); đủ T1–T6 |
| `npx next build --webpack` — mirror có junction thư viện khác ổ | **1 lần đầu** | 16,18s | [build.log](s8-final/build.log); webpack tạo sai đường dẫn `./F:/…/next/dist/client/…` |
| `npx next build --webpack` — Next/@next chép thật vào TEMP | **0** | 38,70s | [build-native.log](s8-final/build-native.log), [build-native.json](s8-final/build-native.json) |
| Probe PII Round 1 nguyên bản qua `npx tsx` | **0** | 2,52s | [adversarial-results.json](s8-final/adversarial-results.json): **116 PASS / 0 FAIL**, 20 payload |
| Probe allowlist bổ sung | **0 thực thi; FAIL chính sách** | — | [path-probe.json](s8-final/path-probe.json): expected 403, actual 200 |
| Probe BrowserContext bổ sung | **0 thực thi; FAIL quy tắc tuyệt đối** | — | [browser-policy-probe.json](s8-final/browser-policy-probe.json): tạo standalone context, có offline |

Kết quả máy đọc được: [gates.json](s8-final/gates.json), [isolation.json](s8-final/isolation.json). Runner: [run-audit.py](s8-final/run-audit.py), [build-native.py](s8-final/build-native.py). Lượt build cuối không sửa source/next.config, không bỏ TypeScript, không dùng `ignoreBuildErrors`. Lỗi build đầu thuộc cách nối thư viện khác ổ, được giữ nguyên log; không gán là lỗi sản phẩm hoặc giấu lần thất bại. Mã nguồn build cuối khớp workspace, kiểm lại trong [final-verification.json](s8-final/final-verification.json).

## 7. Bảo toàn dữ liệu và tệp hồi quy

Hash production chỉ được đọc để đo SHA-256 theo quyền trong prompt; không mở kết nối SQLite vào DB thật, không sửa, không sao chép dữ liệu thật vào mirror.

| Tệp production | SHA-256 kỳ vọng | Trước audit | Sau kiểm thử/build/probe |
|---|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | **Khớp** | **Khớp, không đổi** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **Khớp** | **Khớp, không đổi** |

- [production-before.json](s8-final/production-before.json), [production-after.json](s8-final/production-after.json), [preservation.json](s8-final/preservation.json) và phép kiểm cuối trong [final-verification.json](s8-final/final-verification.json).
- `next-env.d.ts` tại workspace giữ nguyên **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**; hồ sơ round-12–round-41 không đổi so với S0 hoặc đầu audit.
- **122 tệp src + 23 tệp scripts + 1.853 tệp audit lịch sử + 5 tệp quy tắc/cấu hình được chốt = 2.003 tệp**, không có tệp đổi/thêm trong tập bảo vệ. Các hồ sơ đóng chặng S0–S7 được kiểm lại hash cuối.
- Chỉ thêm báo cáo/bằng chứng S8 và cập nhật ba tài liệu tiến độ; giữ nguyên thay đổi có sẵn. Bản sao TEMP được giữ để có thể điều tra lại; không xóa backup hoặc dữ liệu Owner.

## 8. Quyết định và điều kiện nghiệm thu lại

**GO:** Hồ sơ đóng từng chặng S0–S7; tám bộ kiểm thử được yêu cầu; TypeScript; build Webpack cuối; ẩn danh các trường hợp đã thử; bảo toàn dữ liệu và tệp hồi quy.

**NO-GO:** Nghiệm thu tổng thể **v3.4.0 / S8.2**, vì **S8-01 và S8-02 còn OPEN** theo các quy tắc Owner yêu cầu kiểm. Test xanh và build thành công không xóa hai quan sát này. Chưa có bằng chứng mất dữ liệu thật hoặc lỗi ghi LMS/Teaching thật từ hai mục đó.

Đợt tiếp theo nên chỉ xử lý hai mục trên, rồi chạy lại probe tương ứng và kiểm thử bị ảnh hưởng. Nếu thay đổi hợp đồng ngoại lệ renderer thay vì mã, cần Owner duyệt hành vi đó và kiểm chứng các ranh giới được ghi; không chỉ đổi chữ để biến FAIL thành PASS. Sau khi đủ điều kiện cục bộ mới dùng [phiếu thử thật có sẵn](OWNER_LIVE_TRIAL_CHECKLIST.md) theo một lớp phù hợp. Phiếu hiện là hướng dẫn, chưa có biên bản Owner đã chạy; số lần bấm cần được ghi theo thao tác thực tế, kể cả xác nhận.

**Đã làm:** Hoàn tất audit tổng hợp, ghi bảng đóng chặng/quy tắc/luồng/lệnh/hash và hai phát hiện có bằng chứng.

**Kết quả:** NO-GO tổng thể; mã và dữ liệu Owner giữ nguyên; các cổng bắt buộc có kết quả cuối đạt.

**Chưa kiểm tra:** LMS/Teaching/AI/Drive/GitHub/YouTube thật, đầy đủ Checkpoint trên LMS thật, số click và thời gian tiết kiệm với lớp thật; không chạy lại mọi suite lịch sử ngoài danh sách yêu cầu.

**Việc tiếp theo:** Agent triển khai xử lý S8-01/S8-02 rồi tái kiểm; Owner chưa cần thao tác kỹ thuật hoặc thử ghi dữ liệu thật trong lần audit này.
