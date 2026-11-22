# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `v3.8.4` — GEMINI 4 NEON (XHIGH)

- **Ngày kiểm định:** `22/11/2026`
- **Mô hình Reviewer độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `neon-auditor-v384` chạy cô lập trong `os.tmpdir()`)
- **Phạm vi kiểm định:**
  - `src/lib/local-files/spck-streamlit-screenshotter.ts`: Bộ tự chạy và chụp ảnh giao diện ứng dụng Streamlit (`app.py` / `streamlit_app.py` / `pages/*.py`) qua Python `data/streamlit-venv` trên `127.0.0.1` + headless Chrome/Edge CDP WebSocket (`1440×810` $\rightarrow$ `960×540` PNG), giữ nguyên quy tắc `1 BrowserContext` (0 import `playwright`, 0 `spawnSync`, 0 `0.0.0.0`), lọc sạch biến môi trường nhạy cảm (`buildSafeStreamlitEnv`), giải quyết `sys.executable` tuyệt đối từ tiến trình host (`resolveStreamlitPythonExecutableAsync`, cấm tuyệt đối chạy `.venv` của học viên), khóa symlink/junction ở cả thư mục học viên lẫn `outDir` (`resolveSafeDirWithinStudent`), lọc `stException` hiển thị & trang trống (`F05`/`F06`), và dừng tức thì theo nút Stop Bot (`TASK_CANCELLED` + `taskkill /T /F`).
  - `src/lib/local-files/spck-app-screenshotter.ts`: Gọi `captureStreamlitAppScreenshotsAsync` trong `captureStudentAppScreenshots` khi chưa có ảnh `.ui`/`.html`/Game, kèm cảnh báo vào `aiSelectedReason`, xuất `findProjectHtmlFiles`.
  - `src/lib/local-files/spck-scanner.ts`: Tự động chụp Streamlit trong `scanStudentSpckFolderAsync` chỉ khi bật `allowStreamlitAutoRender: true` (từ thao tác quét của giáo viên `scanClassSpckDirectoryAsync`, tắt ở Cổng Thu Bài trực tuyến `student-portal-server.ts` theo `F01`) và dọn `.active_shots.json` cũ khi tạo được ảnh mới (`F04`).
  - `scripts/test-spck-streamlit-capture-v384.ts` (`[ST-01..ST-07]`), `.gitignore` (`/data/streamlit-venv/`), `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx` (`v3.8.4`).

## 1. Kết quả các vòng kiểm định
- **Vòng 1 (`22/11/2026 17:04`):** `VERDICT: NO-GO` — phát hiện **`7/7` điểm (`1× P0`, `3× P1`, `2× P2`, `1× P3`)**:
  - `F01 [P0]`: `student-portal-server.ts` gọi `scanStudentSpckFolderAsync()` trước khi giáo viên xác nhận, có nguy cơ chạy mã Python từ xa ngoài hàng đợi khi học viên nộp `app.py` qua Cổng Thu Bài. -> **Đã đóng ở Vòng 2** (chỉ bật `allowStreamlitAutoRender: true` ở `scanClassSpckDirectoryAsync`).
  - `F02 [P1]`: Junction tại `outDir` (`_spck_app_shots`) có thể trỏ sang thư mục khác trong `ALLOWED_LOCAL_DIRS`. -> **Đã đóng ở Vòng 2** (`resolveSafeDirWithinStudent` kiểm tra từng cấp + chặn symlink trước `writeFileSync`).
  - `F03 [P1]`: Fallback `"python"` / `"py"` chạy với `cwd` là thư mục học viên trên Windows dễ bị `python.exe` giả trong thư mục bài làm chiếm quyền. -> **Đã đóng ở Vòng 2** (`probePythonHasStreamlit` chạy tại `process.cwd()` và lưu đường dẫn tuyệt đối `sys.executable`).
  - `F04 [P1]`: Tệp `.active_shots.json` cũ (`{"files": []}`) làm `scanStudentSpckFolderAsync` ẩn mất ảnh Streamlit vừa chụp. -> **Đã đóng ở Vòng 2** (xóa sạch `.active_shots.json` cũ không phải symlink khi `renderedAny === true`).
  - `F05 [P2]`: Lỗi `stException` sau header hoặc ở Tab 2 / trang phụ thoát khỏi bộ đếm `widgetCount <= 2`. -> **Đã đóng ở Vòng 2** (lọc theo `stException` đang hiển thị `isElVisible`, từ chối Hero nếu có traceback hiển thị và bỏ qua Tab/Trang con lỗi).
  - `F06 [P2]`: Ứng dụng Streamlit rỗng (`import streamlit as st\nx = 1+1`) chờ 20s rồi lưu ảnh trắng. -> **Đã đóng ở Vòng 2** (loại `[data-testid="stHeader"]` khỏi bộ đếm widget nội dung, thoát nhanh sau 3s trống và trả cảnh báo tiếng Việt).
  - `F07 [P3]`: Bổ sung `maxRetries` khi xóa `tmpProfileDir`, cải thiện `isStreamlitSourceCode` bỏ qua docstring `"""`/`'''` và hỗ trợ `import os, streamlit`, thêm `clearTimeout` trong `finally`, timeout `/json/list` 2s, và kiểm tra `ensureCaptureNotStopped()` + `normalized[0]` trước khi ghi ảnh. -> **Đã đóng ở Vòng 2**.
- **Vòng 2 (`22/11/2026 17:15`):** **`VERDICT: GO`** — đóng trọn **`7/7`** phát hiện (`0` lỗi P0–P3 mở), **`16/16`** probe đối kháng Round 2 PASS (`0` tiến trình sót, Stop Bot cắt trong `461ms`, ảnh `960×540` chuẩn, `.venv` giả bị chặn `100%`).

## 2. Kết quả kiểm thử & đối chiếu SHA-256 dữ liệu thật
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-streamlit-capture-v384.ts` (`[ST-01..ST-07]` + hồi quy `F01–F07` + bản sao `Trần Minh Khang/app.py` 3 ảnh `960×540` đã kiểm tra trực quan) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-reupload-and-auth-v383.ts` (`[V383-01..V383-04]` + `F01–F06`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-streamlined-v355.ts` (`R355-01..R355-05`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-v360.ts` (`V360-01..V360-05` + `Round-38`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-v272.ts` (`V01..V19`) -> **PASS (`exit 0`)**
- `$env:GRAPHIFY_BACKEND="none"; graphify update .` -> **PASS (`exit 0`, `2.578` nodes / `9.347` edges / `89` communities)**
- **Bảo toàn `100%` SHA-256 dữ liệu thật trước = sau kiểm định:**
  - `data/mindx_bot.db`: `4018E659F9D4C892C10A535ECBE9F38658A56FF009691E4897FA7A44C58BFFCD`
  - `data/running_classes.json`: `1D0EE2A624B5108E35E791A98465DB48060798560841F6E2880D045D011D37FA`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
