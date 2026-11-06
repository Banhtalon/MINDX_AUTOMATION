# Báo cáo Vòng 2 (Round 2 Final Closure Audit) — /final-project & Logo MindX

**Verdict: GO. F01–F05: CLOSED (5/5).** Chạy mới **G1–G6: 6/6 PASS; P1: 90/90 PASS, 0 FAIL, 0 lỗi chạy; P2: 36/36 hàm nhập/sửa giữ nguyên**. Hai tệp dữ liệu thật khớp SHA-256 Owner cung cấp trước và sau kiểm định. Đủ điều kiện đóng năm phát hiện trong phạm vi kiểm định cục bộ; chưa chứng nhận dịch vụ hoặc lớp thật.

## Mốc kiểm định và bản mã được thử

- Ngày: **06/11/2026**, giờ Việt Nam. Bắt đầu `2026-11-06T03:51:36.963Z`, hoàn tất đối chiếu `2026-11-06T03:59:32.627Z` (UTC).
- Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, toàn bộ báo cáo Vòng 1 và các thay đổi F01–F05. Các kết luận GO lịch sử không thay thế bằng chứng chạy mới.
- HEAD cục bộ: `a829af4ffaa4169c5c107fb2690dbf7cc8d73d29`. Đối tượng nghiệm thu là **nội dung làm việc hiện có, gồm 5 tệp giao diện đã sửa nhưng chưa commit**, không chỉ HEAD. Các dấu vân tay bên dưới ràng buộc kết luận với đúng bản đã sao chép và chạy thử.
- Dùng khung Vòng 1 làm điểm xuất phát nhưng tạo bản sao mới tại `C:\Users\QQ\AppData\Local\Temp\mindx-final-ui-round2-Her8lW`. Không dùng lại kết quả PASS cũ. Node `v24.21.0`; dùng thư viện sẵn có, không cài thêm.
- Trong vòng này, auditor chỉ cập nhật báo cáo này. Không sửa `src/**`, `scripts/**`, `data/config/**`, ba tài liệu trạng thái hay lịch sử kiểm định khác; không commit/push các sửa đổi đang có của Owner.

### Dấu vân tay bản mã đã nghiệm thu

| Tệp | SHA-256 |
|---|---|
| `src/app/globals.css` | `3F7E69973B9F77DDF93D5846C97853F20EC4BF4C6E904B4A0D4C1FB23E28F722` |
| `src/components/final-project/Step1Header.tsx` | `4878F0FA5C795197A2BC2AF622AB1C54D8EDAC4BF4DAB314CD15B2F0CFA9E388` |
| `src/components/final-project/StudentRow.tsx` | `53D14B295C00AC05896FA7E892EDF283B9841BDD2484D8AAA52C59F562D84780` |
| `src/components/final-project/SubmitBar.tsx` | `C373A12A39377CB226C63F053A409690832C2BC400E0675C2D16EE702EE031D4` |
| `src/components/final-project/ToolsDrawer.tsx` | `B2C2602AC3A358D15EAD5C98E79B8DDA114722F498F56F7E2A7C174AD7A8F0A6` |
| `data/config/mindx-bot.ico` | `9E907B0DCBD1A22ADF5F8A204202F1CA507CBBD38689F4FEEA68F3C6B87DBD47` |

167/167 tệp `src/**`, `scripts/**`, `data/config/**` trong bản sao khớp bản gốc trước và sau kiểm thử. SHA-256 của danh sách 167 tệp đã thử: `4ECFDB34EBA798EE5260901880D6F05D253DDFCE25B28964A827A1AF438F8999`.

## Gate Execution Summary — G1–G6 + P1 + P2

Toàn bộ lệnh chạy lần lượt trong thư mục `<TEMP Round 2>/workspace`; mỗi cổng có tệp dữ liệu giả riêng. Mã thoát 0 được đối chiếu cùng nội dung log, không chỉ dựa vào dòng tổng kết.

| Mã | Lệnh | Exit code | Kết quả | Giây |
|---|---|---:|---|---:|
| G1 | `npx tsc --noEmit --incremental false` | 0 | PASS — TypeScript: không phát hiện lỗi kiểu dữ liệu | 2.980 |
| G2 | `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | PASS — S5b-T1..T6: PASS | 12.285 |
| G3 | `npx tsx scripts/test-streamline-v340-s6.ts` | 0 | PASS — S6-T1..T4: PASS | 5.888 |
| G4 | `npx tsx scripts/test-spck-v270.ts` | 0 | PASS — T01..T16: 16/16 PASS | 10.825 |
| G5 | `npx tsx scripts/test-spck-v272.ts` | 0 | PASS — V01..V17: 17/17 PASS | 20.831 |
| G6 | `npx tsx scripts/test-session14-v290.ts` | 0 | PASS — S14-01..S14-07: 7/7 PASS | 151.698 |
| P1 | `node <TEMP Round 2>/probe.cjs` | 0 | **90/90 PASS, 0 FAIL, 0 lỗi chạy** | 15.525 |
| P2 | `node <TEMP Round 2>/compare-handlers.cjs` | 0 | **36/36 giữ nguyên** cấu trúc và thứ tự onChange/onBlur | 0.444 |

### P1 — đầy đủ 90 phép kiểm tra

Giữ nguyên tập 90 mã phép kiểm tra của Vòng 1. Chỉ cập nhật tiêu chí ICO theo yêu cầu Round 2 và tăng bằng chứng trong các phép kiểm tra có sẵn: Tab qua đủ 16 học viên, Playlist mở lại được, đo cả màu hover, đối chiếu đúng biểu thức hậu tố nhãn hai tab. Không sửa các kịch bản gốc trong `scripts/**`.

| Nhóm | PASS / Tổng |
|---|---:|
| S5a-T1: cấu trúc 11 module | 1/1 |
| S5a-T2: ranh giới client và biến nhạy cảm | 12/12 |
| S5a-T3: VM round-38, 59 useState và 5 hook đầu, mốc return | 1/1 |
| ICO: PNG RGBA hợp lệ và đúng số lượng/kích thước | 2/2 |
| CSS: 15 lớp chức năng có Sáng/Tối | 15/15 |
| AST: hai tab và 7 loại nhãn còn lại | 2/2 |
| Bundle: không kéo module server vào trình duyệt | 1/1 |
| Dòng thu gọn: 3 buổi × 3 trạng thái × có/không nhận xét × Sáng/Tối | 36/36 |
| Tương tác và hình học giao diện: 9 kiểm tra × Sáng/Tối | 18/18 |
| Màn hình 390×844, Buổi 13/14 không cuộn ngang | 2/2 |
| **Tổng** | **90/90** |

### Chạy lại 9 phép kiểm tra từng không đạt ở Vòng 1

| Mã phép kiểm tra | Kết quả mới | Bằng chứng |
|---|---|---|
| `DOM-light-keyboard-focus-not-covered` | PASS | 81 lần Tab; đủ 16/16 học viên; 0 ô bị che; khoảng cách nhỏ nhất 75.828 px |
| `DOM-dark-keyboard-focus-not-covered` | PASS | 81 lần Tab; đủ 16/16 học viên; 0 ô bị che; khoảng cách nhỏ nhất 74.828 px |
| `DOM-light-success-button-contrast` | PASS | #ffffff / #15803d; 5,015597478:1; hover #166534 |
| `DOM-dark-success-button-contrast` | PASS | Giống Sáng: 5,015597478:1; hover #166534 |
| `DOM-light-robotics-playlist-hide` | PASS | Số khung: mặc định 1 → Ẩn 0 → Mở lại 1 |
| `DOM-dark-robotics-playlist-hide` | PASS | Số khung: mặc định 1 → Ẩn 0 → Mở lại 1 |
| `AST-two-tabs-required-testids` | PASS | Đủ hai tiền tố và đúng biểu thức row.assignedStudentId || idx |
| `AST-other-required-testids` | PASS | Đủ 7 loại nhãn còn lại; missing = [] |
| `ICO-required-count-and-sizes` | PASS | count === 7; đúng [16, 24, 32, 48, 64, 128, 256] |

## Bảng trạng thái đóng F01–F05

| Mã | Mức độ Vòng 1 | Trạng thái Vòng 2 | Vị trí và cơ sở đóng |
|---|---|---|---|
| F01 | MEDIUM | **CLOSED** | `SubmitBar.tsx:230` đăng ký focusin và dọn listener khi rời thành phần; `globals.css:965` chừa scroll-padding-bottom 140px và `globals.css:974` chừa scroll-margin-bottom 140px. Tab thật qua đủ 16 học viên ở hai chế độ không có ô chồng lên thanh nộp, bị thanh nộp che tại tâm hoặc ngoài khung nhìn. |
| F02 | MEDIUM | **CLOSED** | `globals.css:947`: nền #15803d, chữ #ffffff; hover #166534. Màu đã kết xuất ở Sáng/Tối đạt **5,015597478:1**, làm tròn **5,016:1 ≥ 4,5:1**; chữ 12px/700. |
| F03 | LOW | **CLOSED** | `Step1Header.tsx:43`, `Step1Header.tsx:214`, `Step1Header.tsx:233`: roboticsYoutubeHidden tách việc tự mở mặc định khỏi lựa chọn ẩn/mở của giáo viên. Chromium xác nhận chuỗi số lượng khung **1 → 0 → 1** ở cả Sáng/Tối. |
| F04 | LOW | **CLOSED** | `StudentRow.tsx:443`, `StudentRow.tsx:457`, `StudentRow.tsx:895`, `ToolsDrawer.tsx:635`, `SubmitBar.tsx:279`, `SubmitBar.tsx:551`: đủ 9 loại data-testid. AST xác nhận hậu tố hai tab đúng học viên hoặc idx; P2 giữ nguyên 36/36 onChange/onBlur; diff chỉ bổ sung nhãn và chỉ số nhóm phục vụ nhãn tại phần liên quan. |
| F05 | LOW | **CLOSED — thống nhất tiêu chí** | `data/config/mindx-bot.ico`, `CHANGELOG.md:33`: Owner đã chốt **7** kích thước. Probe bắt buộc count === 7 và đủ đúng danh sách [16, 24, 32, 48, 64, 128, 256]. Không sửa ICO hoặc CHANGELOG. ICO còn nguyên SHA-256 và khớp byte của tệp tại HEAD. |

### Chi tiết F01: phím Tab thật trên danh sách 16 học viên

Chromium dùng viewport **1440×1000**, Buổi 13, các dòng thu gọn. Bắt đầu ở ô chọn lớp, gửi sự kiện `Tab` thật và chờ hai khung hình trước mỗi phép đo; đi đến thanh nộp sau khi đã ghé đủ 16 học viên. Đo `document.activeElement`, hình chữ nhật phần tử/thanh nộp và `document.elementFromPoint` tại tâm ô.

| Chế độ | Lần Tab | Học viên đã ghé | Ô bị che/chồng thanh nộp hoặc ngoài màn hình | Khoảng cách nhỏ nhất giữa đáy ô và đỉnh thanh nộp |
|---|---:|---:|---:|---:|
| Sáng | 81 | 16/16 | 0 | 75.828 px |
| Tối | 81 | 16/16 | 0 | 74.828 px |

Giá trị CSS đã kết xuất: html/body scroll-padding-bottom = 140px; dòng học viên scroll-margin-bottom = 140px. Đã xem trực tiếp ảnh `focus-clear-light.png` và `s14-dark.png` trước khi dọn TEMP. Kết quả F01 áp dụng cho các tình huống đã đo, không suy rộng thành chứng nhận mọi kích thước màn hình hay mọi trạng thái mở rộng.

### Chi tiết F04: hợp đồng nhãn và hàm nhập/sửa

Đủ chín loại nhãn:

1. `s14-row-tab-spck-${row.assignedStudentId || idx}`
2. `s14-row-tab-eval14-${row.assignedStudentId || idx}`
3. `s5b-quick-tags-group-1-row1`
4. `s5b-quick-tags-group-2-row2`
5. `s14-open-all-tab2-btn`
6. `s14-combo-retry-failed-btn`
7. `s6-post-spck-suggestion-banner`
8. `s6-push-teaching-progress-btn`
9. `s6-open-report-card-link`

P2 so sánh cây cấu trúc mã (AST) với mốc `2adf096`, bỏ vị trí dòng và chú thích; yêu cầu đúng cả tổng số, cấu trúc và thứ tự hàm. Kết quả:

| Thành phần | Trước | Sau | AST và thứ tự |
|---|---:|---:|---|
| `Step1Header.tsx` | 4 | 4 | Giữ nguyên |
| `ToolsDrawer.tsx` | 6 | 6 | Giữ nguyên |
| `StudentRow.tsx` | 26 | 26 | Giữ nguyên |
| `StudentTable.tsx` | 0 | 0 | Giữ nguyên |
| `SubmitBar.tsx` | 0 | 0 | Giữ nguyên |
| `Session14Panel.tsx` | 0 | 0 | Giữ nguyên |
| **Tổng** | **36** | **36** | **36/36 giữ nguyên** |

Không coi P2 là bằng chứng mọi hàm xử lý đều bất biến: phép này tập trung onChange/onBlur. Thay đổi xử lý focus và nút ẩn Playlist thuộc F01/F03 đã được kiểm tra riêng. Những luồng sửa sau duyệt, hạ WAITING_APPROVAL/xóa contentHash, chọn học viên, mở Tab 2 và thử lại từng phần tiếp tục PASS qua P1 và các suite bắt buộc.

### Chi tiết F05: ICO theo tiêu chí đã được Owner chốt

Tệp **46.449 byte**, header `00 00 01 00 07 00`. Đủ đúng 7 ảnh vuông 16/24/32/48/64/128/256; từng entry là PNG RGBA 8 bit/kênh, không interlace, đúng rộng/cao. Đã kiểm tra chữ ký PNG, CRC từng chunk, giải nén IDAT, giới hạn/không chồng offset và kết thúc đúng cuối tệp. Đây là đóng bất nhất tiêu chí “8” của Vòng 1 theo yêu cầu mới của Owner; không phải tạo hoặc sửa ảnh thứ tám.

## Production Data Preservation Check

Chỉ dùng Node.js `fs.readFileSync` để đọc byte và tính SHA-256 hai tệp thật. Không mở SQLite thật, không chạy truy vấn, không sao chép cơ sở dữ liệu thật vào môi trường thử và không ghi vào hai tệp này.

| Tệp thật | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `4870EDCEDD02A026B015B75E7F91B3C91EFDC2C0819463D6A7C9ADB87429DE7A` | `4870EDCEDD02A026B015B75E7F91B3C91EFDC2C0819463D6A7C9ADB87429DE7A` | Khớp Owner, trước và sau |
| `data/running_classes.json` | `D4F49C5B3B7553DEA033ADAB23CBD0A49522FCA53DC751328BBC40A5EE4E88EC` | `D4F49C5B3B7553DEA033ADAB23CBD0A49522FCA53DC751328BBC40A5EE4E88EC` | Khớp Owner, trước và sau |

- **2.836/2.836 tệp đã được Git theo dõi trước kiểm định giữ nguyên SHA-256**, kể cả 5 tệp giao diện đã có sửa đổi khi bắt đầu, ICO, scripts, cấu hình, ba tài liệu trạng thái và lịch sử kiểm định cũ. Không mất tệp.
- **167/167 tệp nguồn/kiểm thử/cấu hình trong TEMP khớp bản gốc và không bị kiểm thử sửa đổi.**
- Báo cáo Vòng 1 được giữ nguyên thành khối byte ở cuối tài liệu này. SHA-256 khối Vòng 1 trước/sau: **`B7C585F79834514851739D96814D2242B422F1D900AFFE89357388E7008084C0`**; không chuẩn hóa xuống dòng, không sửa dấu hoặc cập nhật kết luận lịch sử.
- Trạng thái Git cuối giữ nguyên 5 tệp sửa sẵn; auditor chỉ ghi thêm Vòng 2 vào báo cáo vốn đang chưa được theo dõi. Không gộp các sửa đổi của Owner vào commit kiểm định.

## Cô lập, bằng chứng và dọn TEMP

Mỗi cổng có `MINDX_DB_PATH` và `MINDX_RUNNING_CLASSES_PATH` trỏ vào TEMP; danh sách lớp khởi tạo `[]`, khóa AI là chuỗi giả. S6 tự chuyển sang thư mục con TEMP do suite tạo. Không sao chép `.env*`, hồ sơ trình duyệt hay thông tin đăng nhập Owner; thư viện đã cài chỉ được dùng qua liên kết thư mục.

Preload `guard.cjs` chặn fetch/HTTP/HTTPS/TCP/TLS ở Node và loại biến đăng nhập khỏi tiến trình con. Chromium dùng proxy `127.0.0.1:9`, chặn phân giải tên miền, tắt tác vụ mạng nền; P1 chặn toàn bộ request qua route. Các suite dùng API/DOM mô phỏng. Không khởi động ứng dụng thật, không dùng hồ sơ trình duyệt Owner, không truy cập LMS/Teaching/Drive/YouTube/Gemini/GitHub thật. Không có tệp ghi nhận lần gọi mạng Node bị chặn trong lần chạy này.

Theo yêu cầu Owner, thư mục TEMP mới của Vòng 2 được dọn bằng Node `fs.rmSync` sau khi kiểm tra đường dẫn tuyệt đối thuộc TEMP, gỡ liên kết node_modules và xác minh báo cáo. Khung TEMP Vòng 1 còn nguyên để giữ lịch sử; không dọn hoặc ghi đè nó. Bảng kết quả, số đo và dấu vân tay dưới đây được lưu trực tiếp trong báo cáo; các tệp Vòng 2 sau khi dọn không còn là đường dẫn bằng chứng có thể mở.

| Tệp công cụ/log/kết quả Vòng 2 | SHA-256 trước khi dọn |
|---|---|
| `probe.cjs` | `92A1BF8C92D06F8CBAC3164788DE626090DDDD0D45A591D7A529E25A9CDA3199` |
| `probe-entry.tsx` | `893704739C206D604679368E62E16293E14E13E0BADCEF7E543D1D58190835B1` |
| `probe-results.json` | `A64552B31441EA530BA9147B9890355915982A3023E0D7BC872C87ED19874499` |
| `compare-handlers.cjs` | `E5D5E710A5DE55D97C3735563330D2D73AA10FD72A74C2291632874DCA78FBA1` |
| `handler-comparison.json` | `078DAC4485DED6B36C6EEB9147E049AE63AB6691B6C33BCBAA6544C22549FEC3` |
| `gates.json` | `39F51A1C6F5BB5AF0F4C1A250F153859FF033CAFBDE0EA0DF8104AB83D1BA7F7` |
| `guard.cjs` | `12CC110A3DD54A16A4DA6DEA3A69857EF3F7CF8C961F446ACD3525BEB1440E7D` |
| `tested-source-manifest.json` | `4ECFDB34EBA798EE5260901880D6F05D253DDFCE25B28964A827A1AF438F8999` |
| `gate-1.log` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
| `gate-2.log` | `FB0DECDE311EBAAFF60F6D0CE5960D66E0BF9CA391BFA3681F0AE0C04EA0AE80` |
| `gate-3.log` | `12AE2981834BEFCB279E35FBF8B60CB0E74FAEFCA525B0E6B72A8B9EBBEB968D` |
| `gate-4.log` | `BD06F1B3102C916EFFAD40F476E7F6B20588E0254AEE1F0F79B0938C5273BB74` |
| `gate-5.log` | `E1411C46821D353FA64E9CA122D2DC820276AF2E3BA482D6D630B3FCA465DEF2` |
| `gate-6.log` | `15094B9F62627FC3673CC36E2498F70A461CA19BD3246A74ED6D76A370CEF93B` |
| `probe.cjs.log` | `D65C4AF63FEFA4CF7FEA2FACF938972123BF9422A1D156BA10E03FB67FCA83C3` |
| `compare-handlers.cjs.log` | `087ABA033D72E0AB564D5FF5C1DE8A581C17B72A8AEA986A53878D9CD26ADA44` |
| `focus-clear-light.png` | `184C37EB917FA560E60ACBBB7C39BA32A0E39915A76FB30A785C57714A2E93B3` |
| `s14-dark.png` | `58D6DF9ADF23E743E28FA06D9955D71423E36705DF5E07F0F296E6156C052306` |

## Giới hạn và bước tiếp theo

- **Chưa kiểm tra:** lớp thật, việc ghi lên LMS/Teaching thật, dịch vụ Drive/Gemini/YouTube/GitHub, bản đóng gói production mới và shortcut/cache biểu tượng Windows ngoài Desktop. Tệp ICO hợp lệ trong kho không tự chứng minh biểu tượng Desktop đã đổi.
- P1 kết xuất các thành phần nguyên bản với CSS thật trong Chromium và dùng dữ liệu giả; không thay thế nghiệm thu toàn bộ ứng dụng hay chứng minh số lần bấm ngoài thực tế.
- **Việc tiếp theo:** có thể đóng F01–F05 cho đúng bản mã có SHA-256 nêu trên. Agent triển khai phụ trách lưu các bản sửa vào Git/GitHub theo quy trình dự án; nếu nội dung thay đổi sau mốc này thì cần đối chiếu lại bằng chứng liên quan. Owner không cần chạy lệnh hoặc cung cấp thông tin đăng nhập cho lần kiểm định này.

**Đã làm:** Chạy mới sáu cổng, P1/P2 trên bản sao; xác minh F01–F05 và dữ liệu thật.

**Kết quả:** GO cục bộ; 5/5 CLOSED, 6/6 cổng PASS, P1 90/90 PASS, P2 36/36 giữ nguyên; dữ liệu thật bảo toàn.

**Chưa kiểm tra:** Dịch vụ/lớp thật, bản production mới và shortcut Desktop.

**Việc tiếp theo:** Agent triển khai lưu bản sửa và báo cáo; không cần Owner thao tác cho vòng kiểm định này.

---

# Lịch sử đối chứng — Báo cáo Vòng 1 (giữ nguyên 100% nội dung gốc)

# Kiểm định độc lập giao diện và luồng thao tác /final-project — v3.4.0

**Verdict: NO-GO.** Sáu cổng bắt buộc đều PASS, nhưng probe độc lập còn 9 phép kiểm tra không đạt, quy về 5 phát hiện bên dưới. Không phát hiện lỗi HIGH hoặc dấu hiệu sửa dữ liệu thật trong phạm vi đã kiểm tra. Chưa đủ điều kiện nghiệm thu đợt tinh gọn giao diện này.

- Thời điểm đối chiếu cuối: 2026-11-06T03:43:31.832Z (UTC), ngày 06/11/2026 theo giờ Việt Nam.
- Phạm vi chính xác: `2adf0969a623344a09c7a0d7a797ba8f175ded68..a829af4ffaa4169c5c107fb2690dbf7cc8d73d29`.
- Hai commit: `f76b0ee6f8b493d60f4cdcd689e0c3ae7eb7a4e3` và `a829af4ffaa4169c5c107fb2690dbf7cc8d73d29`.
- HEAD và `refs/remotes/origin/main` lưu trên máy cùng là `a829af4ffaa4169c5c107fb2690dbf7cc8d73d29`. Không truy vấn GitHub trực tiếp; kết luận này chỉ áp dụng cho bản Git cục bộ.
- Đã đọc `PROJECT_STATE.md` trước, sau đó đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md` và mã nguồn liên quan. Kết luận GO đã ghi trong tài liệu là bằng chứng lịch sử, không thay thế lần chạy mới này.
- Bản thay đổi có 12 tệp: 3 tài liệu, 1 ICO, 1 trang, 1 CSS và 6 thành phần giao diện. Tải sử dụng được giả định: một giáo viên dùng ứng dụng cục bộ; probe có danh sách 1, 2 và 16 học viên giả.

## Gate Execution Summary

Các lệnh dưới chạy mới trên bản sao trong `TEMP`, không sửa bài kiểm tra. Node `v24.21.0`; dùng đúng các thư viện đang cài, không tải hoặc cài thêm. `npx` được đặt chế độ ngoại tuyến. Thời gian là số đo của tiến trình gọi từng lệnh.

| Mã | Lệnh | Exit code | Kết quả | Giây | Log |
|---|---|---:|---|---:|---|
| G1 | `npx tsc --noEmit --incremental false` | 0 | PASS | 3.300 | [gate-1.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-1.log>) |
| G2 | `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | PASS | 12.762 | [gate-2.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-2.log>) |
| G3 | `npx tsx scripts/test-streamline-v340-s6.ts` | 0 | PASS | 6.741 | [gate-3.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-3.log>) |
| G4 | `npx tsx scripts/test-spck-v270.ts` | 0 | PASS | 10.975 | [gate-4.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-4.log>) |
| G5 | `npx tsx scripts/test-spck-v272.ts` | 0 | PASS | 23.373 | [gate-5.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-5.log>) |
| G6 | `npx tsx scripts/test-session14-v290.ts` | 0 | PASS | 151.916 | [gate-6.log](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gate-6.log>) |
| P1 | `node <TEMP>/probe.cjs` | 1 | FAIL: 81/90 PASS, 9 FAIL, 0 lỗi chạy ở lần cuối | — | [probe-results.json](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/probe-results.json>) |
| P2 | `node <TEMP>/compare-handlers.cjs` | 0 | PASS: 36/36 hàm xử lý nhập/sửa giữ nguyên cấu trúc | — | [handler-comparison.json](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/handler-comparison.json>) |

Chi tiết các suite: S5b-T1..T6 đạt; S6-T1..T4 đạt; v2.7.0 T01..T16 đạt; v2.7.2 V01..V17 đạt; Buổi 14 S14-01..S14-07 đạt. Chỉ đếm những trường hợp thực sự xuất hiện trong log mới.

### Probe độc lập: cách làm và phạm vi bằng chứng

Probe dùng bộ phân tích cấu trúc TypeScript/JSX đi kèm Next.js, `node:vm`, bộ đọc ICO/PNG tự viết, PostCSS/Tailwind thật và Chromium. Sáu thành phần Step1Header, ToolsDrawer, StudentTable/StudentRow, SubmitBar, Session14Panel được đóng gói từ nguyên bản mã nguồn và kết xuất trong trình duyệt. Dữ liệu và các điểm gọi dịch vụ được thay bằng dữ liệu giả; không thay phần JSX, CSS hoặc hàm xử lý nhập liệu của thành phần.

| Nhóm kiểm tra | Kết quả mới |
|---|---|
| S5a-T1, cấu trúc | Đúng 11 tệp thành phần/hook; không thiếu hoặc thừa tệp trong thư mục |
| S5a-T2, ranh giới client | 12/12 tệp gồm trang và 11 module: không có ba biến nhạy cảm được chỉ định hoặc import thư viện server bị cấm; cây đóng gói không chứa DB/config/Playwright server |
| S5a-T3 và round-38 | VM thực thi được phần trước JSX; 59/59 tên hook giữ nguyên so với mốc đầu; 5 hook đầu đúng classes, selectedClassId, students, folderPathInput, rows; mốc return bắt buộc còn nguyên |
| ICO | Header, bảng entry, PNG, CRC từng chunk, kích thước, RGBA và dữ liệu giải nén hợp lệ; số lượng thực tế 7, xem F05 |
| CSS | 15/15 lớp có mặc định dùng cho chế độ sáng và định nghĩa dark; PostCSS phân tích được toàn bộ tệp, Tailwind biên dịch thành công |
| Ma trận dòng thu gọn | 36/36: Buổi 12/13/14 × VERIFIED_CURRENT/FAILED/WAITING_APPROVAL × có/không nhận xét × Sáng/Tối |
| Xem trước | Có lời nhận xét hoặc lời nhắc khi trống, thuộc tính CSS line-clamp bằng 2; không hiện chuỗi hash hoặc phiên bản nội bộ trong chữ nhìn thấy |
| Bước 1 | 1A/1B/1C cùng hàng ở 1440 px; nút tạo thư mục, công tắc tự chạy và tiến độ còn đủ; khung 1D có mặt; nút Ẩn Robotics không hoạt động, xem F03 |
| Bước 2 và chọn học viên | Nút AI theo đúng Buổi 12/13 hoặc 14; bỏ chọn, chọn tất cả, mở Tab 2 cả danh sách hoạt động |
| Dòng mở rộng | Đủ số mục 1..6, nhóm thẻ đánh giá; hai tab Buổi 14 hoạt động; Tab 2 có 5 ô điểm Demo, 9 ô năng lực và Thư 3 phần |
| Sửa sau duyệt | Sửa nhận xét SPCK hoặc Thư Buổi 14 chuyển về WAITING_APPROVAL và xóa contentHash; SPCK đồng thời đánh dấu nháp có thay đổi |
| Thử lại từng phần | Hiện riêng nút thử lại Sản phẩm và Đánh giá khi có danh sách lỗi tương ứng; không suy luận từ việc thiếu data-testid rằng mất chức năng |
| Session14Panel | Mặc định thu gọn; tự mở khi đánh giá FAILED hoặc có lỗi trong kết quả nộp gộp; nút thu gọn hoạt động |
| Thẻ sau VERIFIED | Gợi ý tăng tiến độ Teaching và liên kết Phiếu điểm còn hoạt động kết xuất; chưa bấm gửi lên dịch vụ thật |
| Thanh nộp | Hiện ở đáy khung nhìn khi cuộn 0/500/1100 px; kiểm tra Tab phát hiện phần đang được chọn bị che hoàn toàn, xem F01 |
| Màn hình nhỏ | Buổi 13 và 14, mở rộng, 390×844: không phát hiện cuộn ngang trong hai trường hợp đã chạy |

Lớp sáng được khai báo bằng selector mặc định `.spck-*`, sau đó ghi đè bằng `html[data-theme="dark"]`. Không có selector sáng tường minh `html:not([data-theme="dark"])` cho 15 lớp mới. Cách mặc định này vẫn cho đủ giá trị ở chế độ sáng; probe kiểm tra cả cấu trúc lẫn kết quả kết xuất, không coi khác cách viết selector là lỗi chức năng.

Ở quá trình xây dựng probe, lần thử đầu dùng giao diện phân tích mã cũ của TypeScript và bị lỗi do TypeScript 7 không còn xuất API đó tại đường dẫn mặc định. Đã sửa riêng probe trong TEMP sang bộ phân tích có sẵn của Next.js và hoàn chỉnh dữ liệu giả cho kết quả thử lại. Các lần thử chưa hoàn chỉnh được giữ riêng trong TEMP; kết luận và bảng trên chỉ dùng lần cuối 90 phép kiểm tra, không gán lỗi của công cụ thử cho sản phẩm.

## Finding Table

| Mã | Mức độ | Vị trí | Phát hiện và ảnh hưởng | Hướng sửa nhỏ nhất |
|---|---|---|---|---|
| F01 | MEDIUM | `src/components/final-project/SubmitBar.tsx:230` | Thanh sticky mới che hoàn toàn ô đang được chọn bằng phím Tab trong danh sách dài. Giáo viên dùng bàn phím không thấy mình đang thao tác ở học viên nào. Tái hiện ở cả Sáng/Tối. | Bảo đảm vùng cuộn/focus chừa đủ chỗ cho chiều cao thanh nộp thực tế và tự đưa ô được chọn ra khỏi vùng bị che. Giữ nguyên mốc return của round-38; kiểm tra lại với danh sách dài và Tab. |
| F02 | MEDIUM | `src/app/globals.css:947`; `src/components/final-project/Session14Panel.tsx:99` | Nút xanh lá mới dùng chữ trắng 12 px/700 trên nền #16a34a, tương phản chỉ 3,296:1 ở cả hai chế độ, dưới ngưỡng chữ nhỏ 4,5:1 dùng trong kiểm định. | Làm nền xanh đậm hơn hoặc chọn màu chữ đạt tối thiểu 4,5:1; đo lại màu đã kết xuất ở cả Sáng/Tối. |
| F03 | LOW | `src/components/final-project/Step1Header.tsx:202`; `src/components/final-project/Step1Header.tsx:215` | Với lớp Robotics, bấm “Ẩn nhập Playlist YouTube” không thu gọn: điều kiện showYoutubeImport OR isRoboticsClass luôn đúng. | Tách việc tự mở ban đầu cho Robotics khỏi trạng thái đóng/mở do giáo viên chọn, hoặc bỏ lời hứa “Ẩn” nếu chủ đích luôn hiển thị. |
| F04 | LOW | `src/components/final-project/StudentRow.tsx:436`; `src/components/final-project/StudentRow.tsx:874`; `src/components/final-project/ToolsDrawer.tsx:633`; `src/components/final-project/SubmitBar.tsx:248`; `src/components/final-project/SubmitBar.tsx:522` | Thiếu 9 loại nhãn data-testid mà nhiệm vụ yêu cầu. Các nút/nhóm vẫn tồn tại và chạy qua kiểm tra bằng vai trò/chữ hiển thị, nhưng kịch bản dùng đúng nhãn đã chỉ định sẽ không tìm được chúng. | Bổ sung nhãn ổn định đúng hợp đồng; hai tab phải gắn hậu tố học viên và không trùng nhau. Không thêm hành vi nghiệp vụ. |
| F05 | LOW | `data/config/mindx-bot.ico:1` (tệp nhị phân, byte 4–5); `CHANGELOG.md:33` | ICO có 7 entry hợp lệ, đúng cả 7 kích thước được liệt kê; không đạt câu “đủ 8” trong nhiệm vụ. Chính danh sách yêu cầu chỉ nêu 7 kích thước, nên đây là điểm chưa thống nhất tiêu chí, không phải tệp ICO hỏng. | Thống nhất tiêu chí là 7 kích thước đang liệt kê hoặc chỉ rõ kích thước thứ 8 trước khi yêu cầu tạo thêm. Không tự suy đoán kích thước còn thiếu. |

### F01 — Tái hiện bằng bàn phím và đo vị trí

Nguyên nhân: thanh nộp được đưa lên trên nội dung bằng sticky/z-index, nhưng việc cuộn khi đổi focus không chừa vùng cho thanh này. Đây là hành vi mới do thay đổi CSS/vị trí trong commit a829af4.

Với viewport 1440×1000, danh sách 16 học viên giả, bắt đầu từ ô chọn lớp rồi bấm Tab qua các ô:

- Sáng: ô checkbox “Chọn học viên này để nộp theo danh sách đã chọn” ở y=938,859, cao 13 px; thanh nộp ở y=908, cao 80 px. Toàn bộ ô nằm sau thanh nộp.
- Tối: ô ở y=930,859, cao 13 px; thanh nộp ở y=912, cao 76 px. Cũng bị che hoàn toàn.
- `document.activeElement` xác nhận focus thật ở checkbox; `document.elementFromPoint` tại tâm ô trả về phần tử trong thanh nộp. Probe dùng sự kiện Tab thật của Chromium.

Bằng chứng: [focus-covered-light.png](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/focus-covered-light.png>), [focus-covered-dark.png](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/focus-covered-dark.png>). Sau khi sửa, lặp lại Tab trên danh sách dài và yêu cầu mọi ô được chọn còn nhìn thấy; không chỉ kiểm tra thanh nộp có class sticky.

### F02 — Màu đã đo trong trình duyệt

Cả Sáng và Tối đều thu được `color: rgb(255,255,255)`, `background-color: rgb(22,163,74)`, `font-size: 12px`, `font-weight: 700`. Tỷ lệ tính từ độ sáng tương đối là `3.2957336053312796:1` (làm tròn 3,296:1). Nút liên quan là “Duyệt & Đẩy Đánh Giá Buổi 14 Lên LMS” trong khung nâng cao. Chưa có bằng chứng lỗi gửi bài do màu; vấn đề là khả năng đọc chữ của giao diện mới.

### F03/F04 — Phân biệt tồn tại trước đó và thay đổi mới

- F03: điều kiện OR với Robotics đã có trước, nhưng bản mới tạo nút luôn hiện lời “Ẩn nhập Playlist” ngay khi khung đang mở. Probe xác nhận lời hứa mới của nút không được thực hiện.
- F04: đối chiếu cả mốc 2adf096 và a829af4 đều không có các nhãn sau: `s14-row-tab-spck-*`, `s14-row-tab-eval14-*`, `s5b-quick-tags-group-1-row1`, `s5b-quick-tags-group-2-row2`, `s14-open-all-tab2-btn`, `s14-combo-retry-failed-btn`, `s6-post-spck-suggestion-banner`, `s6-push-teaching-progress-btn`, `s6-open-report-card-link`. Đây là khoảng trống so với yêu cầu kiểm định, không kết luận commit mới đã xóa chúng.
- Các nhãn có thực tế và đã kiểm tra: `s5b-init-student-folders-btn`, `s5b-auto-run-tools-checkbox`, `s5b-auto-prep-progress`, `s14-step2-prep-bar`, `s14-manual-parts-panel`, `s14-manual-parts-toggle`.

### F05 — Cấu trúc ICO thực tế

Header: `00 00 01 00 07 00`; kích thước tệp 46.449 byte. Mỗi entry chứa PNG bắt đầu `89 50 4E 47 0D 0A 1A 0A`, đúng rộng/cao khai báo; PNG dùng color type 6, 8 bit/kênh, không interlace. Không chồng vùng dữ liệu, không tràn tệp, không byte dư ở cuối, không lỗi CRC hoặc giải nén. Đã trích và nhìn ảnh 256×256: biểu tượng X màu đỏ trên nền trong suốt.

| Kích thước | Offset byte | Số byte PNG | Kiểm chứng |
|---|---:|---:|---|
| 16×16 | 118 | 612 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 24×24 | 730 | 949 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 32×32 | 1679 | 1416 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 48×48 | 3095 | 2859 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 64×64 | 5954 | 4347 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 128×128 | 10301 | 10821 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |
| 256×256 | 21122 | 25327 | PNG RGBA, 8 bit/kênh; CRC và giải nén PASS |

## Production Data Preservation Check

Chỉ dùng Node `fs.readFileSync` để đọc byte và tính SHA-256 của hai tệp thật; không mở SQLite thật, không chạy truy vấn và không ghi vào chúng. Bản sao chạy thử không chứa `data/mindx_bot.db`, không chứa thông tin đăng nhập của Owner hoặc hồ sơ trình duyệt Owner. Danh sách lớp giả khởi tạo bằng `[]`.

| Tệp thật | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `4870EDCEDD02A026B015B75E7F91B3C91EFDC2C0819463D6A7C9ADB87429DE7A` | `4870EDCEDD02A026B015B75E7F91B3C91EFDC2C0819463D6A7C9ADB87429DE7A` | Khớp trước, sau và Owner |
| `data/running_classes.json` | `D4F49C5B3B7553DEA033ADAB23CBD0A49522FCA53DC751328BBC40A5EE4E88EC` | `D4F49C5B3B7553DEA033ADAB23CBD0A49522FCA53DC751328BBC40A5EE4E88EC` | Khớp trước, sau và Owner |

- 2836/2836 tệp đã được Git theo dõi trước kiểm định vẫn nguyên SHA-256; không mất tệp. Bao gồm lịch sử kiểm định, tài liệu trạng thái, scripts và cấu hình đã theo dõi.
- 167/167 tệp `src/**`, `scripts/**`, `data/config/**` trong bản sao TEMP khớp bản gốc; các bài thử không làm thay đổi mã đem kiểm định.
- Bắt đầu: Git sạch. Kết thúc: chỉ tạo mới báo cáo này; không sửa nguồn ứng dụng, scripts, cấu hình, tài liệu lịch sử hoặc ba tài liệu trạng thái. Không commit/push vì yêu cầu hiện tại cấm truy cập GitHub và chỉ cho lập báo cáo.
- Kết luận bảo toàn dựa trên phép đọc trước/sau trong phiên này, không dựa vào báo cáo cũ.

## Cô lập và chặn dịch vụ thật

Thư mục bằng chứng: `C:\Users\QQ\AppData\Local\Temp\mindx-final-ui-audit-20261106-102642`. Bản sao mã nằm trong thư mục con `workspace`. Đã sao chép byte nguyên bản các tệp được theo dõi, trừ dữ liệu lớp thật; dùng các thư viện đã cài qua liên kết thư mục chỉ để chạy, không cài hoặc sửa thư viện.

Mỗi lệnh kiểm thử/probe được khởi chạy với:

```text
ALLOWED_LOCAL_DIRS=<gốc TEMP của Windows>
MINDX_DB_PATH=<thư mục TEMP riêng của lệnh>/audit.db
MINDX_RUNNING_CLASSES_PATH=<thư mục TEMP riêng của lệnh>/running_classes.json
GEMINI_API_KEY=audit-dummy-key
```

Lần cuối probe dùng `audit.db` dưới thư mục TEMP bằng chứng; không mở cơ sở dữ liệu. Suite S6 tự đổi ba đường dẫn bên trong tiến trình sang thư mục con TEMP do chính nó tạo; vẫn không thể chạm dữ liệu thật. Các lệnh được chạy lần lượt để tránh dùng chung dữ liệu thử.

- Tệp preload `guard.cjs` chặn fetch, HTTP/HTTPS và socket TCP/TLS của Node; bỏ các biến đăng nhập LMS/Teaching/GitHub khỏi tiến trình con. Khóa AI chỉ là chuỗi giả.
- Chromium dùng proxy vòng về `127.0.0.1:9`, chặn phân giải tên miền và tắt các hoạt động nền liên quan. Probe còn chặn tất cả yêu cầu bằng route; suite gốc dùng route/mô phỏng cho LMS, Teaching, Drive, YouTube và AI. Không dùng hồ sơ trình duyệt thật, không đăng nhập, không liên hệ GitHub.
- Log chặn mạng của Node không ghi nhận lần gọi mạng thật ngoài mô phỏng. Không khởi động máy chủ ứng dụng thật, không thay đổi tường lửa hoặc cấu hình hệ thống.
- Giữ lại TEMP để người kiểm định sau có thể xem probe, log và ảnh; chưa dọn thư mục bằng chứng. Bài thử tự dọn các tệp giả do chúng tạo theo mã gốc. Nếu dọn thủ công về sau, chỉ dọn đường dẫn TEMP riêng đã xác minh, bằng Node rmSync như Owner yêu cầu.

## Phân nhóm 9 phép kiểm tra không đạt

Không phải 9 lỗi sản phẩm khác nhau: hai chế độ màu tái hiện cùng một lỗi; kiểm tra hợp đồng nhãn được chia làm hai nhóm.

| Phép kiểm tra | Phát hiện |
|---|---|
| `ICO-required-count-and-sizes` | F05 |
| `AST-two-tabs-required-testids` | F04 |
| `AST-other-required-testids` | F04 |
| `DOM-light-robotics-playlist-hide` | F03 |
| `DOM-light-success-button-contrast` | F02 |
| `DOM-light-keyboard-focus-not-covered` | F01 |
| `DOM-dark-robotics-playlist-hide` | F03 |
| `DOM-dark-success-button-contrast` | F02 |
| `DOM-dark-keyboard-focus-not-covered` | F01 |

## Bằng chứng và dấu vân tay công cụ

Các liên kết TEMP có thể mất khi Windows dọn tệp tạm. Báo cáo này lưu lại kết luận, số đo, SHA-256 dữ liệu thật và kết quả từng cổng; mã probe/log gốc hiện vẫn còn ở đường dẫn trên.

| Tệp bằng chứng | SHA-256 |
|---|---|
| [probe.cjs](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/probe.cjs>) | `0022DEA637EC125F76A584A5867CB0241592FB332E334D25600E8C941CE67CB8` |
| [probe-entry.tsx](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/probe-entry.tsx>) | `893704739C206D604679368E62E16293E14E13E0BADCEF7E543D1D58190835B1` |
| [probe-results.json](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/probe-results.json>) | `FC0BE9E89CA644198266262A9D3E0D15D2DACF9C5412EA68E904621BD6BB79C2` |
| [handler-comparison.json](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/handler-comparison.json>) | `54BCDEAD7DB9F432CE103C1AC92D75E97636D59E622BEA8DCA37B730C55F7F63` |
| [guard.cjs](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/guard.cjs>) | `12CC110A3DD54A16A4DA6DEA3A69857EF3F7CF8C961F446ACD3525BEB1440E7D` |
| [gates.json](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/gates.json>) | `EBD9375D9346D186ED1FAC7F26E5DFCE1B0B59995EAA894F327C22697D86EBC3` |

Ảnh đã xem trực tiếp: [s13-light.png](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/s13-light.png>), [s14-dark.png](<C:/Users/QQ/AppData/Local/Temp/mindx-final-ui-audit-20261106-102642/s14-dark.png>); đã lưu thêm Buổi 13 Tối, Buổi 14 Sáng và hai ảnh màn hình nhỏ. Ảnh và DOM chỉ dùng dữ liệu giả; không phải ảnh lớp thật.

## Phạm vi chưa kiểm tra

- Chưa thử với lớp thật, LMS thật, Teaching thật, Google Drive, GitHub, YouTube hoặc Gemini; không chứng nhận việc nộp bài thật, dữ liệu đã lưu thật hoặc số lần bấm của giáo viên ngoài thực tế.
- Chưa chạy bản đóng gói production mới hoặc kiểm tra shortcut/cache biểu tượng Windows ngoài Desktop. ICO trong kho hợp lệ không tự chứng minh shortcut ngoài Desktop đã cập nhật.
- Probe thành phần dùng dữ liệu giả, không thay thế nghiệm thu toàn bộ ứng dụng. Các suite bắt buộc bổ sung bằng chứng về mã xử lý và trình duyệt mô phỏng.
- Chưa sửa bất kỳ phát hiện nào. Không dùng kết quả PASS của các suite để bỏ qua lỗi tái hiện từ probe độc lập.

## Công việc đề xuất tiếp theo

Ưu tiên F01 và F02 trước khi nghiệm thu giao diện; sửa F03/F04 để khớp các hành vi và nhãn đã yêu cầu. F05 cần thống nhất cách đếm; không tự tạo kích thước thứ 8.

Prompt sửa có thể giao cho agent triển khai:

```text
Chỉ sửa F01..F04 trong docs/audits/v340/CODEX_FINAL_PROJECT_UI_AUDIT.md:
1. Giữ thanh nộp ở đáy nhưng không che ô đang được chọn bằng Tab, kiểm tra với 16 học viên ở Sáng/Tối.
2. Nút spck-btn-success phải có tương phản chữ nhỏ tối thiểu 4.5:1 ở hai chế độ.
3. Nút Ẩn Playlist ở lớp Robotics phải thực sự thu gọn và có thể mở lại; giữ việc tự mở ban đầu.
4. Thêm đúng 9 loại data-testid còn thiếu, không đổi luồng nghiệp vụ hoặc trạng thái duyệt.
Giữ nguyên 5 hook đầu, toàn bộ thứ tự useState và mốc return của round-38.
Không sửa ICO để đoán kích thước thứ 8; ghi riêng điểm chưa thống nhất F05.
Sao lưu phù hợp trước khi sửa; không dùng dữ liệu thật cho kiểm thử.
Chạy lại sáu cổng bắt buộc và probe độc lập; chỉ báo GO khi không còn lỗi chặn nghiệm thu.
Giữ báo cáo kiểm định này làm lịch sử, ghi kết quả sửa vào báo cáo mới.
```

**Đã làm:** Đọc hồ sơ, đối chiếu hai commit, chạy mới sáu cổng và probe độc lập, kiểm tra dữ liệu trước/sau.

**Kết quả:** NO-GO cho nghiệm thu giao diện trong phạm vi trên; 6/6 cổng PASS, probe 81/90 PASS. Dữ liệu thật và 2.836 tệp cũ giữ nguyên.

**Chưa kiểm tra:** Dịch vụ/lớp thật, bản production mới và shortcut Desktop.

**Việc tiếp theo:** Agent triển khai sửa các điểm đã nêu, rồi kiểm định lại. Owner không cần chạy lệnh hoặc cung cấp thông tin đăng nhập cho đợt kiểm định này.
