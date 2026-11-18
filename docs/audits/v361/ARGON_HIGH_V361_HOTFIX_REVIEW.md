# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP BẢN VÁ NÓNG `v3.6.1` (`ARGON HIGH` — `Gemini 4 Argon (High)`)

- **Phiên bản kiểm định:** `v3.6.1` (Hotfix triệt để cảnh báo `Encountered a script tag while rendering React component` & Hydration Mismatch trên Next.js `16.4.6` Turbopack / React `19.3.1` tại `http://127.0.0.1:3000`)
- **Kiểm định viên độc lập:** `argon-hotfix-verifier` (`Gemini 4 Argon (High)`)
- **Ngày kiểm định:** `2026-11-18`
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** (`0` lỗi P0/P1/P2/P3 mở; đóng `1/1` phát hiện Vòng 1 `V361-F01`)

---

## 1. Phạm vi & Các hạng mục đã khắc phục trong `v3.6.1`

1. **Xử lý triệt để Issue 1/2 (`Encountered a script tag while rendering React component` tại `src/app/layout.tsx` & `src/components/top-navbar.tsx`):**
   - Loại bỏ hoàn toàn khối `<head><script dangerouslySetInnerHTML=... /></head>` thủ công trong `RootLayout` (vốn kích hoạt cảnh báo `createElement("script")` của React `19.3.1` `react-dom-client.development.js`).
   - Chuyển sang `<Script id="mindx-theme-init" strategy="afterInteractive">` của `next/script` kết hợp `useLayoutEffect` + `MutationObserver` trong `TopNavbar` để đồng bộ `data-theme` (`light`/`dark` từ `localStorage.getItem("mindx_ui_theme")`) trước khi trình duyệt vẽ khung hình mà không sinh `<script>` HostComponent trên cây VDOM.
   - Đồng bộ nhãn phiên bản: `metadata.title = "MindX Automation Bot (v3.6.1)"` (`src/app/layout.tsx`), `MindX Bot v3.6.1` (`src/components/top-navbar.tsx`), `"version": "3.6.1"` (`package.json`), và bộ chọn `/^MindX Bot v3\.6\.\d+$/` (`scripts/test-spck-v360.ts`).

2. **Xử lý triệt để Issue 2/2 & Phát hiện Vòng 1 `V361-F01` (Hydration Mismatch trên `TopNavbar` & `/session-comments` — `CLOSED`):**
   - **Vòng 1 (`V361-F01` — P1 Hydration Mismatch trên `/session-comments` khi `localStorage` có `mindx_last_class_code`):** Khi kiểm thử độc lập bằng headless Chromium trên `http://127.0.0.1:3000/session-comments` sau khi `localStorage.getItem("mindx_last_class_code")` được lưu (`"VT-C4K-PTA12"`), `initialSavedClass` đọc `window.localStorage` ngay trong lượt render đầu tiên khiến `<ClassPicker>` trên Client chèn thêm `<option value="VT-C4K-PTA12">🟢 VT-C4K-PTA12</option>` lệch với HTML SSR (`<option value="__REFRESH_LMS__">📥 Quét lại danh sách lớp từ LMS...</option>`), kích hoạt `Error: Hydration failed because the server rendered text didn't match the client` và mở hộp thoại Next.js Dev Overlay.
   - **Khắc phục trong Vòng 2 (`src/app/session-comments/page.tsx:384-400, 499-500, 537-636`):**
     - Trên trình duyệt (`typeof document !== "undefined"`), `initialSavedClass` luôn trả về `""` để SSR và Client Hydration khớp tuyệt đối `100%` (chỉ giữ nhánh đồng bộ `typeof window !== "undefined" && typeof document === "undefined"` cho môi trường `node:vm` của `OL-05`).
     - Hợp nhất `useEffect` khôi phục `mindx_last_class_code` với `hasRestoredClassCodeRef` + `restoredTargetClassRef` (theo mẫu chuẩn của `src/app/homework-grader/page.tsx`), khôi phục lớp ngay sau khi hydrate và gọi `loadClassData(savedClass, normSess)` đúng 1 lần mà không phát sinh request rỗng `?classId=`.

---

## 2. Kết quả Kiểm thử Độc lập (Round 2)

| Cổng kiểm định | Lệnh / Kịch bản thực thi | Kết quả |
| :--- | :--- | :--- |
| **1. Headless Chromium Live E2E (`http://127.0.0.1:3000`)** | Tải lạnh + chuyển đổi `☀️ Sáng` $\leftrightarrow$ `🌙 Tối` (`mindx_ui_theme`) + `F5 reload` khi `localStorage` có `mindx_last_class_code="VT-C4K-PTA12"` trên đủ **7 route** (`/`, `/final-project`, `/session-comments`, `/homework-grader`, `/teaching-projects`, `/admin-center`, `/syllabus-config`), kiểm tra cả `nextjs-portal` Shadow DOM | **PASS (`0` `console.error`, `0` `console.warning`, `0` `pageerror`, `0` Next.js Dev Overlay Issues, `badgeHidden: true`)** |
| **2. TypeScript Typecheck** | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** |
| **3. Bộ kiểm thử `/session-comments` & Open LMS** | `node .\node_modules\tsx\dist\cli.mjs scripts\test-session-comments-open-lms.ts` (`OL-01..OL-06`) | **PASS (`6/6`, `exit 0`)** |
| **4. Bộ kiểm thử SPCK `v3.6.0` & `v3.5.4` & `S3`** | `scripts/test-spck-v360.ts` (`5/5` + `Round-38`), `scripts/test-drive-tray-and-autoprep-v354.ts` (`6/6`), `scripts/test-streamline-v340-s3.ts` (`S3`) | **PASS (`exit 0`)** |

---

## 3. Kiểm chứng Bảo toàn Dữ liệu Thật (SHA-256)

- `data/mindx_bot.db`: `D4AAA6428F83F601BC1C196DBE4164673CB227B3B813DD08FBE85EFC949FA5F7` (`mtime=2026-11-18T04:51:05.827Z` — **bảo toàn 100%**)
- `data/config/lms_class_ids.json`: `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` (`mtime=2026-11-16T00:59:30.846Z` — **bảo toàn 100%**)
- `data/running_classes.json`: `F0161E3ABBAF11CAC8DE661A457967B307F907B1973E1585E8EB21EB77E2E431` (`mtime=2026-11-18T09:27:55.585Z` — cập nhật từ lượt mở trang chủ của Owner lúc `16:27:55+07:00` trước khi swarm khởi tạo và **giữ nguyên bất biến 100%** trong suốt quá trình vá & kiểm định)

---

## 4. Phán quyết

**`VERDICT: GO`** — Bản vá nóng `v3.6.1` đủ điều kiện cập nhật 3 tài liệu gốc (`CHANGELOG.md`, `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`), làm mới `graphify update .` offline và đồng bộ lên GitHub (`git commit` + `git push origin main`).
