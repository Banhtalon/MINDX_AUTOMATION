# Kiểm định độc lập v3.4.0 — S2, Round 3

**Decision: GO cho Stage S2 Round 3.** Ngày kiểm định: **2026-10-30**, múi giờ `Asia/Saigon`.

Chạy mới **13/13 gate bắt buộc PASS, đều exit 0**, và **66/66 kiểm tra độc lập PASS** (39 phía máy chủ, 27 trên Chromium). Đóng **6/6 phát hiện cũ**: `S2-01`–`S2-05` và `S2-R2-01`. Gate v320 nguyên bản đạt đủ TP-01–06; không sửa script hoặc assertion để đạt PASS. Không còn mục OPEN trong phạm vi kiểm định này. Quyết định GO áp dụng cho S2 với bằng chứng cô lập, chưa phải nghiệm thu hệ thống thật hay toàn bộ v3.4.0.

## Phạm vi và mốc mã

- HEAD/baseline: `29e7097e303da668c32a0588917c3864223588a1` — Stage S1. Kiểm định working tree, gồm các tệp S2 mới chưa được Git theo dõi.
- Đọc `PROJECT_STATE.md` trước; đối chiếu kế hoạch Giai đoạn 10, `CHANGELOG.md`, quy tắc `AGENTS.md` và báo cáo S2 Vòng 1/Vòng 2.
- Đối chiếu 15 hash trong phạm vi S2 của Vòng 2: **chỉ `src/components/class-picker.tsx` thay đổi**, 14 tệp còn lại khớp từng byte. `git diff --quiet 29e7097 -- scripts` trả exit 0: các script đã được Git theo dõi, gồm v320, giữ nguyên so với baseline. Suite S2 mới chưa được theo dõi vẫn khớp bản đã chạy ở Vòng 2.
- Không sửa mã ứng dụng, script hiện có, `next-env.d.ts`, tài liệu trạng thái hoặc audit cũ. Tệp bàn giao duy nhất trong kho là báo cáo Vòng 3 này.

## Môi trường và cách thực thi

`$A=C:\Users\QQ\AppData\Local\Temp\mindx-s2-r3-V0dCL0`, `$W=$A\snapshot`.

Trước mỗi tiến trình kiểm thử/probe, đặt `ALLOWED_LOCAL_DIRS=$A`; `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH`, `TEMP`, `TMP` trỏ vào thư mục thử bên trong `$A`. TypeScript chạy tại kho gốc với ba đường dẫn dữ liệu cô lập; các suite/probe còn lại chạy tại `$W`. Các suite tự chọn đường dẫn khác vẫn ở trong TEMP; v320 dùng `data/tmp-test-*` tương đối với `$W`.

Không sao chép `.env`, `.env.local`, hồ sơ trình duyệt hoặc hai tệp production. `$W/data/running_classes.json` là fixture `[]` tự tạo. Phase 7 chạy trong bản sao, nên các lần ghi cấu hình không chạm cấu hình thật.

Nạp TypeScript bằng `node` + SWC native theo quyền thực thi tương đương đã cấp từ Vòng 1; giữ nguyên assertion và nội dung suite. `@/` trỏ về bản sao, thư viện từ `node_modules` có sẵn qua `Module._resolveFilename`/`NODE_PATH`; esbuild thật được bổ sung `nodePaths`. Không tạo junction `node_modules`; giữ nguyên fixture junction V14 riêng trong TEMP.

Chặn mạng ngoài ở `fetch`, `http`, `https` của Node; Chromium dùng proxy cục bộ `127.0.0.1:9`, các phản hồi LMS/Teaching được intercept hoặc giả lập. Không có yêu cầu thật tới LMS/Teaching/Gemini, không mở SQLite production. Các suite dùng tài khoản/khóa giả.

## Gate Execution Summary

Tất cả kết quả dưới đây được chạy mới trong Vòng 3. `node $A/runtime.cjs scripts/<suite>.ts` là cách chạy tương đương `npx tsx scripts/<suite>.ts` được cho phép. TypeScript dùng thêm `--no-install` để không tải gói.

| # | Lệnh yêu cầu | Lệnh thực thi | Exit code | Kết quả |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit --incremental false` | `npx --no-install tsc --noEmit --incremental false` | **0** | PASS |
| 2 | `npx tsx scripts/test-streamline-v340-s2.ts` | `node $A/runtime.cjs scripts/test-streamline-v340-s2.ts` | **0** | PASS, gồm S2-R1 REGRESSIONS |
| 3 | `npx tsx scripts/test-streamline-v340-s1.ts` | `node $A/runtime.cjs scripts/test-streamline-v340-s1.ts` | **0** | PASS |
| 4 | `npx tsx scripts/test-phase5.ts` | `node $A/runtime.cjs scripts/test-phase5.ts` | **0** | PASS |
| 5 | `npx tsx scripts/test-phase6.ts` | `node $A/runtime.cjs scripts/test-phase6.ts` | **0** | PASS |
| 6 | `npx tsx scripts/test-phase7.ts` | `node $A/runtime.cjs scripts/test-phase7.ts` | **0** | PASS |
| 7 | `npx tsx scripts/test-phase4-codex-repros.ts` | `node $A/runtime.cjs scripts/test-phase4-codex-repros.ts` | **0** | PASS |
| 8 | `npx tsx scripts/test-spck-v270.ts` | `node $A/runtime.cjs scripts/test-spck-v270.ts` | **0** | PASS T01–T16 |
| 9 | `npx tsx scripts/test-spck-v272.ts` | `node $A/runtime.cjs scripts/test-spck-v272.ts` | **0** | PASS V01–V16 |
| 10 | `npx tsx scripts/test-lms-reliability-v280.ts` | `node $A/runtime.cjs scripts/test-lms-reliability-v280.ts` | **0** | PASS T280-01–05 |
| 11 | `npx tsx scripts/test-session14-v290.ts` | `node $A/runtime.cjs scripts/test-session14-v290.ts` | **0** | PASS S14-01–07 |
| 12 | `npx tsx scripts/test-teaching-project-v320.ts` | `node $A/runtime.cjs scripts/test-teaching-project-v320.ts` | **0** | PASS TP-01–06, gồm F03 |
| 13 | `npx tsx scripts/test-report-card-v330.ts` | `node $A/runtime.cjs scripts/test-report-card-v330.ts` | **0** | PASS RC-01–06 |
| 14 | Probe độc lập phía máy chủ | `node $A/adversarial.cjs` | **0** | PASS 39/39 |
| 15 | Probe độc lập giao diện | `node $A/ui-probe.cjs` | **0** | PASS 27/27 |

Không cộng số assertion của suite vào 66 kiểm tra độc lập. Hai probe được khôi phục từ phụ lục Vòng 2 trong TEMP, giữ nguyên các ca cũ; thêm năm ca giao diện đúng phạm vi thay đổi Vòng 3.

## Disposition of Prior Findings

| ID | Mức | Status | Vị trí hiện tại | Bằng chứng chạy mới |
|---|---|---|---|---|
| **S2-01** | HIGH | **CLOSED** | `src/app/final-project/page.tsx:1110`, `:1130`, `:1167`, `:1212`, `:4463`; `src/components/class-picker.tsx:228` | Chỉ một yêu cầu khôi phục B. B trả muộn sau khi A đã tải xong không đổi học viên/hàng bài A; ô chọn vẫn A, có STUDENT_A, không có STUDENT_B. B cũ trả khi A mới còn chờ không tắt trạng thái đang tải A. Năm `useState` đầu khớp baseline. |
| **S2-02** | MEDIUM | **CLOSED** | `src/app/api/classes/refresh/route.ts:247`, `:281`, `:292`, `:351` | Running/Finished sync lỗi đều trả 500, `success:false`, đúng mã lớp/lỗi. Thành công một phần giữ mã đã sync và danh sách mã lỗi. Finished quá hạn không gọi sync. Stop vẫn trả 499; discovery lỗi không tiếp tục sync. |
| **S2-03** | MEDIUM | **CLOSED** | `src/components/class-picker.tsx:301`, `:309`, `:473`; `src/app/homework-grader/page.tsx:232`, `:240`; `src/app/teaching-projects/page.tsx:1030` | Màn 2/Màn 5 hiển thị lỗi HTTP, lỗi kết nối và JSON hỏng; hết trạng thái đang quét sau lỗi. Không có `pageerror` trong probe. |
| **S2-04** | MEDIUM | **CLOSED** | `src/components/class-picker.tsx:263`, `:404`, `:407`, `:416` | Nhập tay/nút Chọn/Enter bị chặn ở đủ ba trạng thái `disabled`, `isRefreshing`, `internalRefreshing`. Không ghi B vào bộ nhớ và không gọi đổi lớp khi đang bận. Bộ chọn DOM vẫn disabled. |
| **S2-05** | MEDIUM | **CLOSED** | `src/app/session-comments/page.tsx:650`, `:657`; `src/app/homework-grader/page.tsx:211`, `:215` | Với danh sách A/B trước đó, phản hồi thành công `classes:[]` xóa B cũ khỏi cả hai bộ chọn. Giữ mã hiện tại A theo thiết kế, không giữ toàn bộ danh sách cũ. |
| **S2-R2-01** | MEDIUM | **CLOSED** | `src/components/class-picker.tsx:242`, `:245`, `:250`, `:255`, `:356`; `scripts/test-teaching-project-v320.ts:1514`, `:1517`, `:1527` | Gate v320 nguyên bản chạy đầy đủ TP-01–06, exit 0. Probe Vòng 3 xác nhận DOM khóa thao tác người dùng; sự kiện giả chọn mã lớp được phép khi chỉ có `disabled=true`; hai lệnh đặc biệt và các trạng thái refresh vẫn bị chặn. Các script đã theo dõi giữ nguyên so với baseline. |

## Xác minh riêng thay đổi Vòng 3

Chính sách được Owner mô tả trong yêu cầu Vòng 3 cho phép sự kiện đổi mã lớp do script phát trong khi prop `disabled=true`, còn DOM tiếp tục khóa thao tác người dùng. Không coi sự kiện giả là thao tác chuột/phím thực tế. Bản sửa này được đánh giá theo chính sách đó, đồng thời kiểm tra rằng nó không mở khóa nhập tay hoặc khởi động quét trong lúc bận.

Năm ca bổ sung trên Chromium thật:

| Ca | Bằng chứng |
|---|---|
| `R3-disabled-native-blocks-synthetic-code-allowed` | `select.disabled=true`; không thể focus bằng lệnh focus DOM, click/ArrowDown/Enter không đổi lớp hoặc bộ nhớ. Sau đó setter + `dispatchEvent(change)` với mã B gọi đúng callback, ghi B, trong khi DOM vẫn disabled. |
| `R3-disabled-blocks-__REFRESH_LMS__` | Phát sự kiện giả chọn Quét khi disabled: không có yêu cầu refresh, không đổi lớp/bộ nhớ. |
| `R3-disabled-blocks-__MANUAL_INPUT__` | Phát sự kiện giả chọn Nhập mã khi disabled: không mở input, không đổi lớp/bộ nhớ. |
| `R3-isRefreshing-blocks-synthetic-class-change` | Cờ refresh bên ngoài bật: sự kiện giả mã B không gọi callback và không đổi bộ nhớ. |
| `R3-internalRefreshing-blocks-synthetic-class-and-refresh` | Giữ một yêu cầu quét đang chạy; cả sự kiện giả mã B và yêu cầu quét thứ hai bị chặn. Chỉ có một yêu cầu refresh, mã đã nhớ vẫn A. |

Các ca Vòng 2 vẫn chạy lại đầy đủ, gồm kiểm tra nhập tay ở ba cờ bận và phản hồi lớp đến muộn trên Màn 3/Màn 5. Probe giao diện dùng React/ReactDOM, esbuild và Chromium thật. Harness chỉ thêm điểm truy cập vào các hàm sẵn có của Màn 3/Màn 5 trong bundle TEMP để tạo hai lượt tải chồng nhau; không thay logic hoặc sửa tệp mã nguồn trên đĩa.

## Đối chiếu phạm vi an toàn

- Sáu route tiếp tục dùng cùng directory; probe gọi route thật trên SQLite TEMP, xác nhận `running/spck/all`, lớp giả, lớp hết hạn và danh sách học viên đang/ngừng học.
- POST refresh vẫn qua `validateLocalRequest`, một tác vụ `SYNC_CLASS`, kiểm tra Stop quanh các bước await; không tạo BrowserContext mới trong mã ứng dụng.
- Thay đổi duy nhất từ Vòng 2 nằm ở xử lý lựa chọn phía giao diện; không thay máy chủ, Path Allowlist, khóa hash khi duyệt, bộ gửi checkpoint, bộ sinh AI hoặc Student Portal. Giữ nguyên ngoại lệ cổng thu bài học sinh đã được tài liệu hóa.
- Kết quả hồi quy giả lập không được coi là nghiệm thu ghi dữ liệu lên LMS/Teaching hoặc chất lượng nội dung Gemini thật.

## Production Data Preservation Check

Lệnh chỉ đọc được chạy trước kiểm thử, sau kiểm thử và sau dọn TEMP:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau kiểm thử | SHA-256 sau dọn TEMP | Kết quả |
|---|---|---|---|---|
| `data/mindx_bot.db` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` | UNCHANGED |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | UNCHANGED |

Đối chiếu đã thực hiện: **2.230/2.230 tệp được ghi nhận giữ nguyên**, gồm **122/122 tệp src/scripts**, **19 tệp data/config**, `next-env.d.ts`, tài liệu trạng thái và các báo cáo audit cũ. **122/122 tệp mã/script trong bản sao** khớp mã đang kiểm định. Tệp production chỉ được đọc theo ngoại lệ tính hash; không sao chép nội dung hoặc mở kết nối SQLite.

**Dọn TEMP: HOÀN TẤT, exit 0.** Đã xác minh đường dẫn tuyệt đối nằm trong TEMP, root không phải liên kết và bên trong còn 0 junction/symlink. Xóa đúng `$A` bằng Node.js `fs.rmSync(..., {recursive:true, force:true})`; xác nhận `existsSync($A)=false`. Hai hash production đo lại sau dọn tiếp tục khớp. Không xóa thư mục TEMP chung hoặc dữ liệu/thư mục của phiên khác.

## Giới hạn và bước tiếp theo

Chưa chạy `npm run build`, chưa nghiệm thu thao tác thật trên LMS/Teaching/Gemini và chưa triển khai hoặc kiểm định S3–S8. Quyết định cuối chỉ áp dụng cho S2 trên working tree đã kiểm tra.

Đủ điều kiện thông qua S2 và chuẩn bị triển khai S3 theo kế hoạch. Nhóm triển khai cập nhật trạng thái/changelog/kế hoạch theo quy trình dự án khi chốt chặng; auditor chỉ ghi báo cáo này. Không cần sửa thêm trong phạm vi xác minh Vòng 3.


## Phụ lục: mã probe và kết quả độc lập

Các tệp dưới đây được tạo/chạy trong TEMP và được giữ trong báo cáo trước khi dọn. Để tái hiện, tạo snapshot mới trong TEMP, loại trừ production và .env, tạo context.json với root (kho gốc), a (TEMP riêng), w (snapshot); đặt các biến dữ liệu và TEMP/TMP trong a. Các script hồi quy của ứng dụng được giữ nguyên.

<details>
<summary>scope-comparison.json</summary>

```json
{
  "changedSinceRound2": [
    "src/components/class-picker.tsx"
  ],
  "first5Before": [
    "classes, setClasses",
    "selectedClassId, setSelectedClassId",
    "students, setStudents",
    "folderPathInput, setFolderPathInput",
    "rows, setRows"
  ],
  "first5After": [
    "classes, setClasses",
    "selectedClassId, setSelectedClassId",
    "students, setStudents",
    "folderPathInput, setFolderPathInput",
    "rows, setRows"
  ],
  "sameFirst5": true,
  "existingTrackedScriptsMatchBaseline": true,
  "focusDigest": "95bad2cdf164adca08d21416a10de4dfe9e910e3601da6dfac4b401d5ddfacf1"
}
```

</details>

<details>
<summary>scope-hashes.json</summary>

```json
[
  {
    "file": "src/lib/classes/class-directory.ts",
    "sha256": "99b97537cb25ad926116da646fb1d444213f0a64e4ad989996a1d55c7092ae8f"
  },
  {
    "file": "src/app/api/classes/refresh/route.ts",
    "sha256": "d56d89d09617ad3a3cedb8f5dbae35e97bbad1b6afe73452012332decbf3ae30"
  },
  {
    "file": "src/components/class-picker.tsx",
    "sha256": "0aca50f0ca525b3101eb3a1dcfbd4aab082e961197ff2e1e990ab7998148e06f"
  },
  {
    "file": "src/app/api/session-comments/list/route.ts",
    "sha256": "158b764b79a97ac84bb8a8455bd87acf0bc94469657af0b3d5efda4654461ccd"
  },
  {
    "file": "src/app/api/session-comments/fetch-classes/route.ts",
    "sha256": "f1a16f8bea3860cd16b1da4f1481f77e90c1c6c38f1c28a198a5210f89e56108"
  },
  {
    "file": "src/app/api/report-card/route.ts",
    "sha256": "249716a82eeb010e5c3dce6a58c48ba941a9ec6defba8fe63482c88e552a669e"
  },
  {
    "file": "src/app/api/teaching-projects/route.ts",
    "sha256": "186a6e4185b82f955e312afeb729dc8d4c0fd39e094751e6730c2f5a90b6d996"
  },
  {
    "file": "src/app/api/spck/list/route.ts",
    "sha256": "75dab37075b5f19cf803172817f41227a660fd84ec05228b2bbb2cbe340ced90"
  },
  {
    "file": "src/app/api/homework-grader/scores/route.ts",
    "sha256": "8ed8ed23220da7af291b996b30f7e67cd47314551e359a927acacd724d1929a3"
  },
  {
    "file": "src/app/session-comments/page.tsx",
    "sha256": "4e60fd430b11703ccf57bb5c36d61464592d625d249ccc3bd7caa1d2df8eedcd"
  },
  {
    "file": "src/app/homework-grader/page.tsx",
    "sha256": "8a7d1f92d5f301a56fbb9b7bfc0690fa0a67b26012c022f192a740d97914b3b7"
  },
  {
    "file": "src/components/teaching-report-card-view.tsx",
    "sha256": "bdc80443e04279653df8e98b0f749f512fdc67f3c41ade6eda68cfec6faf04b3"
  },
  {
    "file": "src/app/final-project/page.tsx",
    "sha256": "5165387f9a1e5db8b7a888621dbc5f62f1445d17697bda09c72481197b20b04a"
  },
  {
    "file": "src/app/teaching-projects/page.tsx",
    "sha256": "7a857435a0339bf43b66a21d96f4da3fef39bb6634a00f235d8bc5ef9a902a87"
  },
  {
    "file": "scripts/test-streamline-v340-s2.ts",
    "sha256": "eb36a46084338910e32743f17a369482608192a17026e4851853118e3980d155"
  }
]
```

</details>

<details>
<summary>probe-backend-results.json</summary>

```json
[
  {
    "id": "D01-running-filter",
    "pass": true
  },
  {
    "id": "D02-spck-filter",
    "pass": true
  },
  {
    "id": "D03-all-includes-old",
    "pass": true
  },
  {
    "id": "D04-grace-override",
    "pass": true
  },
  {
    "id": "D05-grace-boundary",
    "pass": true
  },
  {
    "id": "D06-roster-active",
    "pass": true
  },
  {
    "id": "D07-roster-all",
    "pass": true
  },
  {
    "id": "D08-synthetic-regex",
    "pass": true
  },
  {
    "id": "R-session-comments/list",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "data"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-session-comments/fetch-classes",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-report-card",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-teaching-projects",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-spck/list",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "classes",
        "selectedClassId",
        "selectedSessionNumber",
        "stageInfo",
        "spckSessions",
        "students",
        "records",
        "quickTags",
        "demoSheetMeta"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "R-homework-grader/scores",
    "pass": true,
    "detail": {
      "keys": [
        "success",
        "data"
      ],
      "codes": [
        "VT-C4K-DBNEW",
        "VT-C4K-EARLY",
        "VT-C4K-FRESH",
        "VT-C4K-LATE"
      ]
    }
  },
  {
    "id": "G-running",
    "pass": true
  },
  {
    "id": "G-spck",
    "pass": true
  },
  {
    "id": "G-all",
    "pass": true
  },
  {
    "id": "V-{",
    "pass": true
  },
  {
    "id": "V-[]",
    "pass": true
  },
  {
    "id": "V-null",
    "pass": true
  },
  {
    "id": "V-1",
    "pass": true
  },
  {
    "id": "V-{\"scope\":\"bad\"}",
    "pass": true
  },
  {
    "id": "V-{\"classId\":\"A\",\"classCode\":\"B\"}",
    "pass": true
  },
  {
    "id": "V-cross-origin",
    "pass": true
  },
  {
    "id": "Q-single-task",
    "pass": true
  },
  {
    "id": "Q-selected-failure",
    "pass": true
  },
  {
    "id": "Q-spck-sync-failure-visible",
    "pass": true
  },
  {
    "id": "Q-stop-before",
    "pass": true
  },
  {
    "id": "Q-stop-discovery",
    "pass": true
  },
  {
    "id": "Q-stop-selected",
    "pass": true
  },
  {
    "id": "Q-stop-spck",
    "pass": true
  },
  {
    "id": "Q-live-discovery-excludes-old-cache",
    "pass": true,
    "detail": [
      "VT-C4K-DBNEW",
      "VT-C4K-EARLY",
      "VT-C4K-FRESH",
      "VT-C4K-LATE"
    ]
  },
  {
    "id": "R2-running-failure-details",
    "pass": true,
    "detail": {
      "status": 500,
      "failed": [
        {
          "classCode": "VT-C4K-LATE",
          "error": "RUNNING_503"
        }
      ]
    }
  },
  {
    "id": "R2-finished-failure-details",
    "pass": true,
    "detail": {
      "status": 500,
      "failed": [
        {
          "classCode": "VT-C4K-FRESH",
          "error": "FINISHED_503"
        }
      ]
    }
  },
  {
    "id": "R2-expired-finished-not-synced",
    "pass": true,
    "detail": {
      "status": 200,
      "calls": 0
    }
  },
  {
    "id": "R2-partial-success-preserved",
    "pass": true,
    "detail": {
      "status": 500,
      "synced": [
        "VT-C4K-LATE"
      ],
      "failed": [
        "VT-C4K-FRESH"
      ]
    }
  },
  {
    "id": "R2-selected-failure-details",
    "pass": true
  },
  {
    "id": "R2-stop-dominates-sync-failure",
    "pass": true
  },
  {
    "id": "R2-discovery-failure-prevents-sync",
    "pass": true
  }
]
```

</details>

<details>
<summary>probe-ui-results.json</summary>

```json
[
  {
    "id": "UI01-picker-normalize-restore",
    "pass": true
  },
  {
    "id": "UI02-picker-spck-filter",
    "pass": true
  },
  {
    "id": "UI-screen-session-restore-switch",
    "pass": true,
    "detail": [
      "/api/session-comments/list?classId=VT-C4K-BETA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-BETA&sessionId=VT-C4K-BETA_SESS_13",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=VT-C4K-BETA_SESS_13",
      "/api/session-comments/sync",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=",
      "/api/session-comments/list?classId=VT-C4K-ALPHA&sessionId=VT-C4K-ALPHA_SESS_13"
    ]
  },
  {
    "id": "UI-screen-homework-restore-switch",
    "pass": true,
    "detail": [
      "/api/report-card?classId=VT-C4K-PTA12",
      "/api/report-card?classId=VT-C4K-BETA",
      "/api/homework-grader/scores?classId=VT-C4K-BETA",
      "/api/report-card?classId=VT-C4K-ALPHA",
      "/api/homework-grader/scores?classId=VT-C4K-ALPHA"
    ]
  },
  {
    "id": "UI-screen-final-restore-switch",
    "pass": true,
    "detail": [
      "/api/spck/list",
      "/api/spck/list?classId=VT-C4K-BETA",
      "/api/spck/student-portal?classId=VT-C4K-BETA",
      "/api/spck/student-portal?classId=VT-C4K-BETA",
      "/api/spck/list?classId=VT-C4K-ALPHA",
      "/api/spck/student-portal?classId=VT-C4K-ALPHA",
      "/api/spck/student-portal?classId=VT-C4K-ALPHA"
    ]
  },
  {
    "id": "UI-screen-teaching-restore-switch",
    "pass": true,
    "detail": [
      "/api/teaching-projects",
      "/api/teaching-projects?classCode=VT-C4K-BETA&force=0",
      "/api/teaching-projects?classCode=VT-C4K-ALPHA&force=0"
    ]
  },
  {
    "id": "UI-final-ineligible-saved-fallback",
    "pass": true,
    "detail": {
      "saved": "VT-C4K-EARLY",
      "selected": "VT-C4K-ALPHA"
    }
  },
  {
    "id": "UI-homework-refresh-failure-visible",
    "pass": true
  },
  {
    "id": "UI-teaching-refresh-failure-visible",
    "pass": true
  },
  {
    "id": "UI-homework-empty-list-clears",
    "pass": true
  },
  {
    "id": "UI-session-empty-list-clears",
    "pass": true
  },
  {
    "id": "UI-picker-refresh-blocks-manual-commit",
    "pass": true
  },
  {
    "id": "UI-final-late-restore-must-not-overwrite-new-class",
    "pass": true
  },
  {
    "id": "R2-homework-network-failure-visible",
    "pass": true
  },
  {
    "id": "R2-homework-json-failure-visible",
    "pass": true
  },
  {
    "id": "R2-teaching-network-failure-visible",
    "pass": true
  },
  {
    "id": "R2-teaching-json-failure-visible",
    "pass": true
  },
  {
    "id": "R2-manual-disabled-blocks-commit",
    "pass": true
  },
  {
    "id": "R2-manual-isRefreshing-blocks-commit",
    "pass": true
  },
  {
    "id": "R2-stale-final-response-keeps-latest-loading",
    "pass": true
  },
  {
    "id": "R2-teaching-real-overlap-keeps-latest-class",
    "pass": true,
    "detail": {
      "selected": "VT-C4K-ALPHA",
      "projectName": "VT-C4K-ALPHA",
      "staleBDiscarded": true
    }
  },
  {
    "id": "R3-disabled-native-blocks-synthetic-code-allowed",
    "pass": true,
    "detail": {
      "nativeUiBlocked": true,
      "syntheticClassChangeAllowed": true
    }
  },
  {
    "id": "R3-disabled-blocks-__REFRESH_LMS__",
    "pass": true
  },
  {
    "id": "R3-disabled-blocks-__MANUAL_INPUT__",
    "pass": true
  },
  {
    "id": "R3-isRefreshing-blocks-synthetic-class-change",
    "pass": true
  },
  {
    "id": "R3-internalRefreshing-blocks-synthetic-class-and-refresh",
    "pass": true
  },
  {
    "id": "UI-errors",
    "pass": true
  }
]
```

</details>

<details>
<summary>final-restore-race.json</summary>

```json
{
  "selected": "VT-C4K-ALPHA",
  "hasStudentA": true,
  "hasStudentB": false,
  "requests": [
    {
      "url": "/api/spck/student-portal?classId=VT-C4K-BETA",
      "method": "GET"
    },
    {
      "url": "/api/spck/student-portal?classId=VT-C4K-ALPHA",
      "method": "GET"
    },
    {
      "url": "/api/spck/student-portal?classId=VT-C4K-ALPHA",
      "method": "GET"
    }
  ]
}
```

</details>

<details>
<summary>runtime.cjs</summary>

```javascript

const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {root,a,w}=JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
process.chdir(w);process.env.NODE_PATH=path.join(root,'node_modules');Module._initPaths();
const rr=Module.createRequire(path.join(root,'package.json')),origResolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request.startsWith('@/'))request=path.join(w,'src',request.slice(2));try{return origResolve.call(this,request,parent,...rest)}catch(e){if(!request.startsWith('.')&&!path.isAbsolute(request)){return rr.resolve(request)}throw e}};
const swc=rr('@next/swc-win32-x64-msvc');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>{let src=fs.readFileSync(f,'utf8').replace(/import\.meta\.url/g,JSON.stringify(require('node:url').pathToFileURL(f).href));const out=swc.transformSync(src,false,Buffer.from(JSON.stringify({filename:f,jsc:{parser:{syntax:'typescript',tsx:f.endsWith('.tsx'),decorators:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));m._compile(out.code,f)};
const localhost=h=>!h||['localhost','127.0.0.1','::1','[::1]'].includes(h);
const originalFetch=globalThis.fetch;globalThis.fetch=async (u,o)=>{const url=new URL(typeof u==='string'?u:u.url||String(u));if(!localhost(url.hostname))throw Error('AUDIT_NETWORK_BLOCKED '+url.hostname);return originalFetch(u,o)};
for(const proto of ['node:http','node:https']){const mod=require(proto);for(const meth of ['request','get']){const orig=mod[meth];mod[meth]=function(u,...args){let host;if(typeof u==='string'||u instanceof URL)host=new URL(u).hostname;else host=u?.hostname||u?.host?.split(':')[0];if(!localhost(host))throw Error('AUDIT_NETWORK_BLOCKED '+host);return orig.call(this,u,...args)}}}
const pw=rr('playwright');for(const k of ['chromium','firefox','webkit'])for(const m of ['launch','launchPersistentContext']){const orig=pw[k][m].bind(pw[k]);pw[k][m]=(...args)=>{const pos=m==='launch'?0:1;args[pos]={...(args[pos]||{}),proxy:{server:'http://127.0.0.1:9',bypass:'<loopback>'}};return orig(...args)}};
const eb=rr('esbuild'),wrappedEsbuild={...eb};for(const m of ['build','buildSync'])wrappedEsbuild[m]=(opts)=>eb[m]({...opts,nodePaths:[path.join(root,'node_modules'),...(opts.nodePaths||[])]});
const originalLoad=Module._load;Module._load=function(name,...rest){return name==='esbuild'?wrappedEsbuild:originalLoad.call(this,name,...rest)};
const originalRm=fs.rmSync;fs.rmSync=function(p,o){return originalRm(p,o?.recursive?{maxRetries:10,retryDelay:100,...o}:o)};
if(process.argv[2])require(path.resolve(process.argv[2]));
```

</details>

<details>
<summary>run-gates.cjs</summary>

```javascript
const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');
const {root,a,w}=JSON.parse(fs.readFileSync(p.join(__dirname,'context.json'),'utf8'));
const suites=['test-streamline-v340-s2','test-streamline-v340-s1','test-phase5','test-phase6','test-phase7','test-phase4-codex-repros','test-spck-v270','test-spck-v272','test-lms-reliability-v280','test-session14-v290','test-teaching-project-v320','test-report-card-v330'];
fs.mkdirSync(p.join(a,'logs'),{recursive:true});const results=[];
for(const name of suites){const d=p.join(a,'scratch',name);fs.mkdirSync(d,{recursive:true});const env={...process.env,ALLOWED_LOCAL_DIRS:a,MINDX_DB_PATH:p.join(d,'test.db'),MINDX_RUNNING_CLASSES_PATH:p.join(d,'running_classes.json'),TEMP:d,TMP:d,NODE_PATH:p.join(root,'node_modules'),TEACHING_USERNAME:'audit',TEACHING_PASSWORD:'audit',LMS_USERNAME:'audit',LMS_PASSWORD:'audit',GEMINI_API_KEY:'audit',MINDX_USERNAME:'audit',MINDX_PASSWORD:'audit',NEXT_TELEMETRY_DISABLED:'1'};const log=p.join(a,'logs',name+'.txt'),fd=fs.openSync(log,'w'),start=Date.now();console.log('START '+name);const r=cp.spawnSync(process.execPath,[p.join(a,'runtime.cjs'),'scripts/'+name+'.ts'],{cwd:w,env,stdio:['ignore',fd,fd],timeout:600000,windowsHide:true});fs.closeSync(fd);const result={name,exit:r.status,signal:r.signal,error:r.error?.message,ms:Date.now()-start};results.push(result);fs.writeFileSync(p.join(a,'gates.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));}
```

</details>

<details>
<summary>adversarial.cjs</summary>

```javascript
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {a,w,root} = JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
require('./runtime.cjs');
const dbm = require(path.join(w,'src/lib/db/sqlite.ts'));
const directory = require(path.join(w,'src/lib/classes/class-directory.ts'));
const {ClassSyncer} = require(path.join(w,'src/lib/playwright/sync-class.ts'));
const {taskQueue} = require(path.join(w,'src/lib/queue/task-queue.ts'));
const refresh = require(path.join(w,'src/app/api/classes/refresh/route.ts'));
const results=[];
async function check(id, fn) {try{const detail=await fn();results.push({id,pass:true,detail});console.log('PASS '+id+' '+JSON.stringify(detail??''));}catch(e){results.push({id,pass:false,error:e.message});console.log('FAIL '+id+' '+e.message)}fs.writeFileSync(path.join(a,'probe-backend-results.json'),JSON.stringify(results,null,2));}
const headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'};
const request=(url='/api/classes/refresh',body,extra={})=>new Request('http://127.0.0.1:3000'+url,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
const fmt=(ms)=>{const d=new Date(ms);return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`};
const day=86400000,now=Date.now(),d=dbm.getDb();
function seed(code,num,date=''){d.prepare('INSERT INTO classes_sessions(classId,className,sessionId,sessionNumber,topic,date) VALUES(?,?,?,?,?,?)').run(code,code,code+'_SESS_'+num,num,'Topic',date)}
const cache=[{classCode:'VT-C4K-EARLY',status:'Running'},{classCode:'VT-C4K-LATE',status:'Running'},{classCode:'VT-C4K-FRESH',status:'Finished',endDate:fmt(now-10*day)},{classCode:'VT-C4K-EXPIRED',status:'Finished',endDate:fmt(now-20*day)},{classCode:'AUDIT-HIDDEN',status:'Running'}];
fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,JSON.stringify(cache));
seed('VT-C4K-EARLY',8,fmt(now));seed('VT-C4K-LATE',13,fmt(now));seed('VT-C4K-FRESH',14,fmt(now-10*day));seed('VT-C4K-EXPIRED',14,fmt(now-20*day));seed('VT-C4K-DBOLD',14,fmt(now-20*day));seed('VT-C4K-DBNEW',12,fmt(now));seed('AUDIT-HIDDEN',13,fmt(now));
for(const c of ['TEST-HIDDEN','R12-HIDDEN','CLASS_HIDDEN','SYNTH-HIDDEN'])seed(c,13,fmt(now));
d.prepare('INSERT INTO students(studentId,classId,fullName,isActive) VALUES(?,?,?,?)').run('ACTIVE','VT-C4K-LATE','Student Active',1);d.prepare('INSERT INTO students(studentId,classId,fullName,isActive) VALUES(?,?,?,?)').run('INACTIVE','VT-C4K-LATE','Student Inactive',0);
const codes=(l)=>l.map(x=>typeof x==='string'?x:x.classCode||x.classId).sort();
const expected=['VT-C4K-EARLY','VT-C4K-LATE','VT-C4K-FRESH','VT-C4K-DBNEW'].sort();
const expectedSpck=expected.filter(x=>x!=='VT-C4K-EARLY');
async function main(){
await check('D01-running-filter',()=>assert.deepEqual(codes(directory.listClasses()),expected));
await check('D02-spck-filter',()=>assert.deepEqual(codes(directory.listClasses({scope:'spck'})),expectedSpck));
await check('D03-all-includes-old',()=>assert.deepEqual(codes(directory.listClasses({scope:'all'})),[...expected,'VT-C4K-EXPIRED','VT-C4K-DBOLD'].sort()));
await check('D04-grace-override',()=>assert(!codes(directory.listClasses({includeFinishedDays:5})).includes('VT-C4K-FRESH')));
await check('D05-grace-boundary',()=>{const s14=new Date(now);s14.setHours(23,59,59,999);const graceEnd=s14.getTime()-10*day+15*day;assert(codes(directory.listClasses({nowMs:graceEnd})).includes('VT-C4K-FRESH'));assert(!codes(directory.listClasses({nowMs:graceEnd+1})).includes('VT-C4K-FRESH'))});
await check('D06-roster-active',()=>assert.deepEqual(directory.listStudents(' vt-c4k-late ').map(s=>s.studentId),['ACTIVE']));
await check('D07-roster-all',()=>assert.equal(directory.listStudents('VT-C4K-LATE',{activeOnly:false}).length,2));
await check('D08-synthetic-regex',()=>{for(const c of ['test1',' AUDIT1 ','r2x','class_1','synth1',''])assert(directory.isSyntheticClassCode(c));assert(!directory.isSyntheticClassCode('VT-C4K-R2'));});
const routes=[['session-comments/list','data.runningClasses'],['session-comments/fetch-classes','classes'],['report-card','classes'],['teaching-projects','classes'],['spck/list','classes'],['homework-grader/scores','data.runningClasses']];
for(const [name,key] of routes)await check('R-'+name,async()=>{const m=require(path.join(w,'src/app/api',name,'route.ts')),r=await m.GET(request('/api/'+name));assert.equal(r.status,200);const j=await r.json(),l=key.split('.').reduce((v,k)=>v[k],j);assert.equal(j.success,true);assert.deepEqual(codes(l),name==='spck/list'?expectedSpck:expected);return {keys:Object.keys(j),codes:codes(l)};});
for(const scope of ['running','spck','all'])await check('G-'+scope,async()=>{const r=await refresh.GET(request('/api/classes/refresh?scope='+scope));assert.equal(r.status,200);const j=await r.json();assert.deepEqual(codes(j.classes),codes(directory.listClasses({scope})));});
for(const body of ['{','[]','null','1','{"scope":"bad"}','{"classId":"A","classCode":"B"}'])await check('V-'+body,async()=>assert.equal((await refresh.POST(request(undefined,body))).status,400));
await check('V-cross-origin',async()=>assert.equal((await refresh.POST(request(undefined,{}, {origin:'https://evil.example','sec-fetch-site':'cross-site'}))).status,403));
const origFetch=ClassSyncer.fetchRunningClasses,origSync=ClassSyncer.syncClass,origEnqueue=taskQueue.enqueue;
let trace=[],queued=0;
ClassSyncer.fetchRunningClasses=async opts=>{trace.push(['discover',opts]);return {success:true,classes:cache.filter(c=>!c.classCode.startsWith('AUDIT'))}};
ClassSyncer.syncClass=async code=>{trace.push(['sync',code]);return {success:true,classId:code,students:[],sessions:[]}};
taskQueue.enqueue=function(t){queued++;assert.equal(t.jobType,'SYNC_CLASS');return origEnqueue.call(this,t)};
await check('Q-single-task',async()=>{trace=[];queued=0;const r=await refresh.POST(request(undefined,{scope:'running',classCode:' vt-c4k-late '}));assert.equal(r.status,200);assert.equal(queued,1);assert.deepEqual(trace,[['discover',{persistToConfig:true}],['sync','VT-C4K-LATE']]);});
await check('Q-selected-failure',async()=>{ClassSyncer.syncClass=async()=>({success:false,error:'selected sync failure'});const r=await refresh.POST(request(undefined,{classCode:'VT-C4K-LATE'}));assert.equal(r.status,500);assert.equal((await r.json()).success,false)});
await check('Q-spck-sync-failure-visible',async()=>{trace=[];ClassSyncer.syncClass=async c=>{trace.push(c);return {success:false,error:'fixture upstream HTTP 503'}};const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true}));const j=await r.json();const observation={status:r.status,success:j.success,synced:j.syncedClassCodes,attempts:trace,error:j.error};fs.writeFileSync(path.join(a,'spck-failed-sync.json'),JSON.stringify(observation,null,2));assert.equal(j.success,false,'SPCK sync failure was hidden: '+JSON.stringify(observation));});
for(const point of ['before','discovery','selected','spck'])await check('Q-stop-'+point,async()=>{taskQueue.resumeQueue();let syncCalls=0;ClassSyncer.fetchRunningClasses=async()=>{if(point==='discovery')taskQueue.stopQueue();return {success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]}};ClassSyncer.syncClass=async()=>{syncCalls++;taskQueue.stopQueue();return {success:true}};if(point==='before')taskQueue.stopQueue();const r=await refresh.POST(request(undefined,{scope:point==='spck'?'spck':'running',...(point==='selected'?{classCode:'VT-C4K-LATE'}:{})}));assert.equal(r.status,499);if(point==='before'||point==='discovery')assert.equal(syncCalls,0);taskQueue.resumeQueue()});
await check('Q-live-discovery-excludes-old-cache',async()=>{ClassSyncer.fetchRunningClasses=async()=>{fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH,JSON.stringify([{classCode:'VT-C4K-LATE',status:'Running'}]));return {success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]}};const r=await refresh.POST(request(undefined,{scope:'running'}));assert.equal(r.status,200);return codes((await r.json()).classes)});
await check('R2-running-failure-details',async()=>{ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]});ClassSyncer.syncClass=async()=>({success:false,error:'RUNNING_503'});const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true})),j=await r.json();assert.equal(r.status,500);assert.equal(j.success,false);assert.deepEqual(j.failedClassCodes,['VT-C4K-LATE']);assert.deepEqual(j.failedClasses,[{classCode:'VT-C4K-LATE',error:'RUNNING_503'}]);assert.deepEqual(j.syncedClassCodes,[]);return {status:r.status,failed:j.failedClasses}});
await check('R2-finished-failure-details',async()=>{ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'VT-C4K-FRESH',status:'Finished',endDate:fmt(now-10*day)}]});ClassSyncer.syncClass=async()=>({success:false,error:'FINISHED_503'});const r=await refresh.POST(request(undefined,{scope:'spck'})),j=await r.json();assert.equal(r.status,500);assert.deepEqual(j.failedClassCodes,['VT-C4K-FRESH']);assert.equal(j.failedClasses[0].error,'FINISHED_503');return {status:r.status,failed:j.failedClasses}});
await check('R2-expired-finished-not-synced',async()=>{let calls=0;ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'VT-C4K-EXPIRED',status:'Finished',endDate:fmt(now-20*day)}]});ClassSyncer.syncClass=async()=>{calls++;return {success:false,error:'MUST_NOT_CALL'}};const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true})),j=await r.json();assert.equal(r.status,200);assert.equal(j.success,true);assert.equal(calls,0);return {status:r.status,calls}});
await check('R2-partial-success-preserved',async()=>{ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'},{classCode:'VT-C4K-FRESH',status:'Finished',endDate:fmt(now-10*day)}]});ClassSyncer.syncClass=async c=>c==='VT-C4K-LATE'?{success:true}:{success:false,error:'FRESH_FAILURE'};const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true})),j=await r.json();assert.equal(r.status,500);assert.deepEqual(j.syncedClassCodes,['VT-C4K-LATE']);assert.deepEqual(j.failedClassCodes,['VT-C4K-FRESH']);return {status:r.status,synced:j.syncedClassCodes,failed:j.failedClassCodes}});
await check('R2-selected-failure-details',async()=>{ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[]});ClassSyncer.syncClass=async()=>({success:false,error:'SELECTED_FAILURE'});const r=await refresh.POST(request(undefined,{classCode:'VT-C4K-LATE'})),j=await r.json();assert.equal(r.status,500);assert.deepEqual(j.failedClassCodes,['VT-C4K-LATE']);assert.equal(j.failedClasses[0].error,'SELECTED_FAILURE')});
await check('R2-stop-dominates-sync-failure',async()=>{ClassSyncer.fetchRunningClasses=async()=>({success:true,classes:[{classCode:'VT-C4K-LATE',status:'Running'}]});ClassSyncer.syncClass=async()=>{taskQueue.stopQueue();return {success:false,error:'UPSTREAM_ERROR'}};const r=await refresh.POST(request(undefined,{scope:'spck',forceResyncAll:true}));assert.equal(r.status,499);taskQueue.resumeQueue()});
await check('R2-discovery-failure-prevents-sync',async()=>{let calls=0;ClassSyncer.fetchRunningClasses=async()=>({success:false,error:'DISCOVERY_FAILURE'});ClassSyncer.syncClass=async()=>{calls++;return {success:true}};const r=await refresh.POST(request(undefined,{classCode:'VT-C4K-LATE'})),j=await r.json();assert.equal(r.status,500);assert.equal(j.success,false);assert.equal(calls,0);assert.equal(j.error,'DISCOVERY_FAILURE')});
ClassSyncer.fetchRunningClasses=origFetch;ClassSyncer.syncClass=origSync;taskQueue.enqueue=origEnqueue;dbm.closeDb();
console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));process.exitCode=results.some(x=>!x.pass)?1:0;
}
main().catch(e=>{console.error(e);dbm.closeDb();process.exitCode=2});
```

</details>

<details>
<summary>ui-entry.tsx</summary>

```tsx
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ClassPicker} from './snapshot/src/components/class-picker';
import Session from './snapshot/src/app/session-comments/page';
import Homework from './snapshot/src/app/homework-grader/page';
import Final from './snapshot/src/app/final-project/page';
import Teaching from './snapshot/src/app/teaching-projects/page';
const root=createRoot(document.getElementById('root')!);
const pages:any={session:Session,homework:Homework,final:Final,teaching:Teaching};
function PickerHarness(){const [value,setValue]=useState((window as any).pickerInitial||'');const [overrides,setOverrides]=useState({});(window as any).updatePickerProps=setOverrides;return <ClassPicker {...(window as any).pickerProps} {...overrides} value={value} onChange={c=>{(window as any).changes.push(c);setValue(c)}}/>}
(window as any).mount=(name:string)=>{root.render(React.createElement(name==='picker'?PickerHarness:pages[name],{key:Date.now()+Math.random()}));};
(window as any).ready=true;
```

</details>

<details>
<summary>ui-probe.cjs</summary>

```javascript
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {a,w,root}=JSON.parse(fs.readFileSync(path.join(__dirname,'context.json'),'utf8'));
const rr=Module.createRequire(path.join(root,'package.json'));
require('./runtime.cjs');
const eb=rr('esbuild');
async function build(){await eb.build({entryPoints:[path.join(a,'ui-entry.tsx')],outfile:path.join(a,'ui-bundle.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],alias:{'@':path.join(w,'src')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'audit-observe-existing-page-handlers',setup(b){b.onLoad({filter:/final-project[\\/]page\.tsx$/},({path:f})=>{const source=fs.readFileSync(f,'utf8');const marker='  const isAnyOperationBusy =';assert(source.includes(marker));return {contents:source.replace(marker,'  if (typeof window !== "undefined") (window as any).__auditFinal = {handleClassChange, loadClassData};\n'+marker),loader:'tsx',resolveDir:path.dirname(f)}});b.onLoad({filter:/teaching-projects[\\/]page\.tsx$/},({path:f})=>{const source=fs.readFileSync(f,'utf8'),marker='  const handleLoadManualClass =';assert(source.includes(marker));return {contents:source.replace(marker,'  if (typeof window !== "undefined") (window as any).__auditTeaching = {handleSelectClassChange};\n'+marker),loader:'tsx',resolveDir:path.dirname(f)}})}}]});}
const {chromium}=rr('playwright');
const results=[];async function check(id,fn){try{const v=await fn();results.push({id,pass:true,detail:v});console.log('PASS '+id+' '+JSON.stringify(v??''))}catch(e){results.push({id,pass:false,error:e.message});console.log('FAIL '+id+' '+e.message)}fs.writeFileSync(path.join(a,'probe-ui-results.json'),JSON.stringify(results,null,2));}
const A='VT-C4K-ALPHA',B='VT-C4K-BETA',EARLY='VT-C4K-EARLY';
async function main(){await build();const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
async function prepare(saved='',mode='normal'){await page.goto('http://127.0.0.1:43127');await page.evaluate(({saved,mode,A,B,EARLY})=>{
localStorage.clear();if(saved)localStorage.setItem('mindx_last_class_code',saved);(window).requests=[];(window).changes=[];(window).refreshMode=mode;(window).hold=false;(window).releaseHold=null;
const classes=[{classId:A,classCode:A,className:A,status:'Running',currentSessionNumber:13},{classId:B,classCode:B,className:B,status:'Running',currentSessionNumber:13}];
(window).fetch=async(url,options={})=>{const u=new URL(String(url),location.origin);const method=options.method||'GET';(window).requests.push({url:u.pathname+u.search,method,body:options.body});
if((window).hold&&(u.pathname==='/api/classes/refresh'||u.pathname==='/api/homework-grader/scores'&&method==='POST'))await new Promise(resolve=>{(window).releaseHold=resolve});
const code=u.searchParams.get('classId')||u.searchParams.get('classCode')||A;let payload={success:true};let status=200;
if(u.pathname==='/api/classes/refresh'){if((window).refreshMode==='fail'){payload={success:false,error:'AUDIT LMS UNAVAILABLE',classes:[],runningClasses:[],spckClasses:[],allClasses:[]};status=500}else{const list=(window).refreshMode==='empty'?[]:[...classes,{classId:'VT-C4K-NEW',classCode:'VT-C4K-NEW',currentSessionNumber:13}];payload={success:true,classes:list,runningClasses:list,spckClasses:list,allClasses:list}}}
else if(u.pathname==='/api/session-comments/list')payload={success:true,data:{classId:code,resolvedClassId:code,sessions:[{sessionId:code+'_SESS_13',sessionNumber:13,date:'30/10/2026',topic:'Lesson'}],students:[],feedbacks:[],quickTags:[],syllabusList:[],runningClasses:classes}};
else if(u.pathname==='/api/session-comments/sync')payload={success:true,classId:JSON.parse(options.body||'{}').classCode,sessions:[],students:[]};
else if(u.pathname==='/api/homework-grader/scores')payload={success:true,data:{matrix:null,updatedAt:null,sessions:[],students:[],rubrics:[],runningClasses:classes.map(c=>c.classCode)}};
else if(u.pathname==='/api/report-card')payload={success:true,classId:code,classCode:code,classes,record:null,snapshot:null,overrides:{},reportCard:null};
else if(u.pathname==='/api/spck/list')payload={success:true,classes,selectedClassId:code,selectedSessionNumber:13,students:[],records:[],quickTags:[],demoSheetMeta:null};
else if(u.pathname==='/api/teaching-projects')payload=u.searchParams.has('classCode')?{success:true,classes,record:{classId:code,projectName:code,tasksJson:'[]',studentsJson:'[]',progressJson:'{}',status:'DRAFT',draftVersion:1},tasks:[],students:[],progress:{}}:{success:true,classes};
else if(u.pathname==='/api/spck/session14-eval')payload={success:true,evaluations:[]};
return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}})};
},{saved,mode,A,B,EARLY});await page.addScriptTag({path:path.join(a,'ui-bundle.js')});await page.waitForFunction(()=>window.ready);}
async function mount(name){await page.evaluate(name=>window.mount(name),name);await page.waitForTimeout(180);}
async function pickSelect(){return page.locator('select').filter({has:page.locator('option[value="__REFRESH_LMS__"]')}).first();}
await check('UI01-picker-normalize-restore',async()=>{await prepare(B);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A.toLowerCase(),A,B],scope:'running'}},{A,B});await mount('picker');assert.equal(await (await pickSelect()).inputValue(),B);assert.equal(await page.locator('option[value="'+A+'"]').count(),1);await (await pickSelect()).selectOption(A);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);});
await check('UI02-picker-spck-filter',async()=>{await prepare(EARLY);await page.evaluate(({A,EARLY})=>{window.pickerInitial='';window.pickerProps={classes:[{classId:EARLY,currentSessionNumber:8},{classId:A,currentSessionNumber:13}],scope:'spck',allowManualInput:false}},{A,EARLY});await mount('picker');assert.equal(await page.locator('option[value="'+EARLY+'"]').count(),0);assert.equal(await page.getByTitle('Gõ mã lớp thủ công').count(),0);});
for(const name of ['session','homework','final','teaching'])await check('UI-screen-'+name+'-restore-switch',async()=>{await prepare(B);await mount(name);const select=await pickSelect();await page.waitForFunction(B=>Array.from(document.querySelectorAll('select')).some(s=>s.value===B),B);assert.equal(await select.inputValue(),B);await select.selectOption(A);await page.waitForTimeout(220);assert.equal(await select.inputValue(),A);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);return await page.evaluate(()=>window.requests.map(x=>x.url));});
await check('UI-final-ineligible-saved-fallback',async()=>{await prepare(EARLY);await mount('final');assert.equal(await (await pickSelect()).inputValue(),A);assert.equal(await page.locator('option[value="'+EARLY+'"]').count(),0);return {saved:await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),selected:await (await pickSelect()).inputValue()};});
await check('UI-homework-refresh-failure-visible',async()=>{await prepare(A,'fail');await mount('homework');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const text=await page.locator('body').innerText();assert(text.includes('AUDIT LMS UNAVAILABLE'),'No error shown after /api/classes/refresh HTTP 500; teacher sees unchanged screen');});
await check('UI-teaching-refresh-failure-visible',async()=>{await prepare(A,'fail');await mount('teaching');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const text=await page.locator('body').innerText();assert(text.includes('AUDIT LMS UNAVAILABLE'),'ClassPicker silently discards success:false/error after HTTP 500');});
await check('UI-homework-empty-list-clears',async()=>{await prepare(A,'empty');await mount('homework');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const vals=await (await pickSelect()).locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert(!vals.includes(B),'Previous class B remains selectable after successful empty refresh: '+JSON.stringify(vals));});
await check('UI-session-empty-list-clears',async()=>{await prepare(A,'empty');await mount('session');await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(200);const vals=await (await pickSelect()).locator('option').evaluateAll(opts=>opts.map(o=>o.value));assert(!vals.includes(B),'Previous class B remains selectable after successful empty refresh: '+JSON.stringify(vals));});
await check('UI-picker-refresh-blocks-manual-commit',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running'};window.hold=true},{A,B});await mount('picker');await page.getByTitle('Gõ mã lớp thủ công').click();await page.locator('input').fill(B);await page.getByRole('button',{name:'Quét lại từ LMS'}).click();await page.waitForFunction(()=>window.releaseHold!==null);assert.equal(await page.locator('input').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Chọn',exact:true}).isDisabled(),true);await page.locator('input').dispatchEvent('keydown',{key:'Enter',bubbles:true});await page.getByRole('button',{name:'Chọn',exact:true}).dispatchEvent('click');assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A,'Manual commit changed class while refresh was busy');assert.deepEqual(await page.evaluate(()=>window.changes),[]);await page.evaluate(()=>window.releaseHold());});
await check('UI-final-late-restore-must-not-overwrite-new-class',async()=>{
await prepare(B);
await page.evaluate(({A,B})=>{
const original=window.fetch;window.heldB=[];
window.fetch=async(url,opts)=>{const u=new URL(String(url),location.origin);if(u.pathname!=='/api/spck/list'||opts?.method==='POST')return original(url,opts);
const code=u.searchParams.get('classId')||A;
if(code===B)await new Promise(resolve=>window.heldB.push(resolve));
const id=code===B?'STUDENT_B':'STUDENT_A';
return new Response(JSON.stringify({success:true,classes:[{classId:A,classCode:A,currentSessionNumber:13},{classId:B,classCode:B,currentSessionNumber:13}],selectedClassId:code,selectedSessionNumber:13,students:[{studentId:id,fullName:id,classId:code}],records:[{classId:code,studentId:id,localFolderPath:'C:/fixture/'+id,projectTitle:'PROJECT_'+id,isConfirmedByTeacher:1,status:'DRAFT',activeSessionNumber:13}],quickTags:[]}));};
},{A,B});
await mount('final');
await page.waitForFunction(()=>window.heldB.length===1);
await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.heldB.length),1,'Mount must issue one saved-class request');
const select=await pickSelect();assert.equal(await select.isDisabled(),true);
// Force the existing page handler to overlap requests, without changing its logic.
await page.evaluate(A=>{void window.__auditFinal.handleClassChange(A)},A);await page.waitForTimeout(200);
assert((await page.locator('body').innerText()).includes('STUDENT_A'));
await page.evaluate(()=>window.heldB[0]());await page.waitForTimeout(200);
const observation={selected:await select.inputValue(),hasStudentA:(await page.locator('body').innerText()).includes('STUDENT_A'),hasStudentB:(await page.locator('body').innerText()).includes('STUDENT_B'),requests:await page.evaluate(()=>window.requests)};
fs.writeFileSync(path.join(a,'final-restore-race.json'),JSON.stringify(observation,null,2));
assert.equal(observation.selected,A);assert.equal(observation.hasStudentB,false,'Stale saved-class B response replaced rows while selector remained A: '+JSON.stringify(observation));
});
for(const name of ['homework','teaching'])for(const kind of ['network','json'])await check('R2-'+name+'-'+kind+'-failure-visible',async()=>{await prepare(A);await page.evaluate(kind=>{const orig=window.fetch;window.fetch=async(url,opts)=>{if(String(url).includes('/api/classes/refresh')){if(kind==='network')throw new Error('AUDIT NETWORK FAILURE');return new Response('{',{status:200,headers:{'content-type':'application/json'}})}return orig(url,opts)}},kind);await mount(name);await (await pickSelect()).selectOption('__REFRESH_LMS__');await page.waitForTimeout(160);const text=await page.locator('body').innerText();assert(kind==='network'?text.includes('AUDIT NETWORK FAILURE'):/JSON|Unexpected|Expected|property|position/i.test(text),'Error must be visible');assert.equal(await (await pickSelect()).isDisabled(),false);});
for(const flag of ['disabled','isRefreshing'])await check('R2-manual-'+flag+'-blocks-commit',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running'}},{A,B});await mount('picker');await page.getByTitle('Gõ mã lớp thủ công').click();await page.locator('input').fill(B);await page.evaluate(flag=>window.updatePickerProps({[flag]:true}),flag);await page.waitForTimeout(50);assert.equal(await page.locator('input').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Chọn',exact:true}).isDisabled(),true);await page.locator('input').dispatchEvent('keydown',{key:'Enter',bubbles:true});await page.getByRole('button',{name:'Chọn',exact:true}).dispatchEvent('click');assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);assert.deepEqual(await page.evaluate(()=>window.changes),[]);});
await check('R2-stale-final-response-keeps-latest-loading',async()=>{await prepare('');await mount('final');await page.evaluate(({A,B})=>{const orig=window.fetch;window.pending={};window.fetch=async(url,opts)=>{const u=new URL(String(url),location.origin);if(u.pathname==='/api/spck/list'&&u.searchParams.has('classId')){const c=u.searchParams.get('classId');await new Promise(r=>window.pending[c]=r)}return orig(url,opts)}},{A,B});await page.evaluate(B=>{void window.__auditFinal.handleClassChange(B)},B);await page.waitForFunction(B=>!!window.pending[B],B);await page.evaluate(A=>{void window.__auditFinal.handleClassChange(A)},A);await page.waitForFunction(A=>!!window.pending[A],A);await page.evaluate(B=>window.pending[B](),B);await page.waitForTimeout(100);assert.equal(await (await pickSelect()).isDisabled(),true,'Stale finally must not clear loading of latest A');assert.equal(await (await pickSelect()).inputValue(),A);await page.evaluate(A=>window.pending[A](),A);await page.waitForTimeout(120);assert.equal(await (await pickSelect()).isDisabled(),false);});
await check('R2-teaching-real-overlap-keeps-latest-class',async()=>{await prepare(A);await mount('teaching');await page.evaluate(B=>{const orig=window.fetch;window.pendingTeachingB=null;window.fetch=async(url,opts)=>{if(String(url).includes('/api/teaching-projects?classCode='+B))await new Promise(r=>window.pendingTeachingB=r);return orig(url,opts)}},B);await page.evaluate(B=>window.__auditTeaching.handleSelectClassChange(B),B);await page.waitForFunction(()=>!!window.pendingTeachingB);assert.equal(await (await pickSelect()).isDisabled(),true);await page.evaluate(A=>window.__auditTeaching.handleSelectClassChange(A),A);await page.waitForTimeout(150);const before=await page.locator('input[placeholder="VD: SPCK - GA38"]').inputValue();assert.equal(before,A);await page.evaluate(()=>window.pendingTeachingB());await page.waitForTimeout(150);const after=await page.locator('input[placeholder="VD: SPCK - GA38"]').inputValue();assert.equal(after,A);assert.equal(await (await pickSelect()).inputValue(),A);return {selected:A,projectName:after,staleBDiscarded:true};});
async function forceSelect(value){await page.evaluate(value=>{const sel=Array.from(document.querySelectorAll('select')).find(s=>s.querySelector('option[value="__REFRESH_LMS__"]'));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,value);sel.dispatchEvent(new Event('change',{bubbles:true}));},value);await page.waitForTimeout(60);}
await check('R3-disabled-native-blocks-synthetic-code-allowed',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running',disabled:true}},{A,B});await mount('picker');const sel=await pickSelect();assert.equal(await sel.isDisabled(),true);await sel.evaluate(s=>s.focus());assert.equal(await sel.evaluate(s=>document.activeElement===s),false);await sel.click({force:true});await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.changes),[]);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);await forceSelect(B);assert.deepEqual(await page.evaluate(()=>window.changes),[B]);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),B);assert.equal(await sel.isDisabled(),true);return {nativeUiBlocked:true,syntheticClassChangeAllowed:true};});
for(const option of ['__REFRESH_LMS__','__MANUAL_INPUT__'])await check('R3-disabled-blocks-'+option,async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running',disabled:true}},{A,B});await mount('picker');await forceSelect(option);assert.deepEqual(await page.evaluate(()=>window.changes),[]);assert.equal(await page.evaluate(()=>window.requests.length),0);assert.equal(await page.locator('input').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);});
await check('R3-isRefreshing-blocks-synthetic-class-change',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running',isRefreshing:true}},{A,B});await mount('picker');await forceSelect(B);assert.deepEqual(await page.evaluate(()=>window.changes),[]);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);});
await check('R3-internalRefreshing-blocks-synthetic-class-and-refresh',async()=>{await prepare(A);await page.evaluate(({A,B})=>{window.pickerInitial=A;window.pickerProps={classes:[A,B],scope:'running'};window.hold=true},{A,B});await mount('picker');await page.getByRole('button',{name:'Quét lại từ LMS'}).click();await page.waitForFunction(()=>window.releaseHold!==null);assert.equal(await (await pickSelect()).isDisabled(),true);await forceSelect(B);await forceSelect('__REFRESH_LMS__');assert.equal(await page.evaluate(()=>window.requests.filter(x=>x.url==='/api/classes/refresh').length),1);assert.deepEqual(await page.evaluate(()=>window.changes),[]);assert.equal(await page.evaluate(()=>localStorage.getItem('mindx_last_class_code')),A);await page.evaluate(()=>window.releaseHold());});
await check('UI-errors',()=>assert.deepEqual(errors,[]));
await browser.close();console.log(JSON.stringify({checks:results.length,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));process.exitCode=results.some(x=>!x.pass)?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=2});
```

</details>


## Bằng chứng thực thi

<details>
<summary>gates.json</summary>

```json
[
  {
    "name": "test-streamline-v340-s2",
    "exit": 0,
    "signal": null,
    "ms": 707
  },
  {
    "name": "test-streamline-v340-s1",
    "exit": 0,
    "signal": null,
    "ms": 740
  },
  {
    "name": "test-phase5",
    "exit": 0,
    "signal": null,
    "ms": 556
  },
  {
    "name": "test-phase6",
    "exit": 0,
    "signal": null,
    "ms": 10710
  },
  {
    "name": "test-phase7",
    "exit": 0,
    "signal": null,
    "ms": 520
  },
  {
    "name": "test-phase4-codex-repros",
    "exit": 0,
    "signal": null,
    "ms": 1936
  },
  {
    "name": "test-spck-v270",
    "exit": 0,
    "signal": null,
    "ms": 7743
  },
  {
    "name": "test-spck-v272",
    "exit": 0,
    "signal": null,
    "ms": 28335
  },
  {
    "name": "test-lms-reliability-v280",
    "exit": 0,
    "signal": null,
    "ms": 84268
  },
  {
    "name": "test-session14-v290",
    "exit": 0,
    "signal": null,
    "ms": 149767
  },
  {
    "name": "test-teaching-project-v320",
    "exit": 0,
    "signal": null,
    "ms": 13295
  },
  {
    "name": "test-report-card-v330",
    "exit": 0,
    "signal": null,
    "ms": 927
  }
]
```

</details>

<details>
<summary>preservation.json</summary>

```json
{
  "files": 2230,
  "sourceScriptCount": 122,
  "configCount": 19,
  "changed": [],
  "mirrorCodeChanged": []
}
```

</details>

<details>
<summary>logs/test-teaching-project-v320.txt</summary>

```text
◇ injected env (0) from .env.local
◇ injected env (0) from .env
=== [v3.2.0] STARTING ISOLATED TEACHING FINAL PROJECT TEST SUITE ===
-> Running TP-01: Date resolution, YMD/DMY parsing (F10) & LMS network guard (F11)...
   [PASS] TP-01 passed.
-> Running TP-02: Course tracks, partial merge (F02) & overlapping PII redaction (F06)...
   [PASS] TP-02 passed.
-> Running TP-03: Strict non-coercing validation (F08), fractional weights & concurrency (F07)...
   [PASS] TP-03 passed.
-> Running TP-04: TeachingProjectService sync & 4-field Read-after-Write on new & existing projects (F01, F02, F04)...
   [PASS] TP-04 passed.
-> Running TP-05: Progress sync, F05 guards (unapproved task & empty assignees) & F09...
   [PASS] TP-05 passed.
-> Running TP-06: Extracted page classes contrast (normal + :hover) & class-switch race guard (F03, F12)...
   [PASS] TP-06 passed.
=== [v3.2.0] ALL 6 TEACHING PROJECT TEST GROUPS PASSED ON ISOLATED DB ===
```

</details>

<details>
<summary>logs/test-streamline-v340-s2.txt</summary>

```text
=== [v3.4.0-S2] UNIFIED CLASS DIRECTORY & SHARED CLASSPICKER SUITE ===
◇ injected env (0) from .env.local
◇ injected env (0) from .env
-> [S2.1] Seeding isolated DB & running_classes.json...
   [PASS] S2.1 class-directory scopes, 15d grace, synthetic regex, and listStudents verified.
-> [S2.2] Verifying all 6 routes return identical scope-filtered class sets...
   [PASS] S2.2 all 6 routes return consistent scope-filtered class lists.
-> [S2.3] Verifying POST /api/classes/refresh single-task queueing & security...
   [PASS] S2.3 POST /api/classes/refresh single-task queueing & stop abort verified.
-> [S2.4 & S2.5] Verifying ClassPicker helpers, localStorage fallback & 4-screen integration...
   [PASS] S2.4 & S2.5 ClassPicker behavior and 4-screen integration verified.
-> [S2-R1 REGRESSIONS] Verifying closure of S2-01..S2-05...
(node:2204) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
   [PASS] S2-R1 REGRESSIONS (S2-01..S2-05) verified 100%.
=== [v3.4.0-S2] ALL STAGE S2 TESTS PASSED 100% ===
```

</details>
