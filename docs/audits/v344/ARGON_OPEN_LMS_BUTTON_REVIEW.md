# Independent QA Audit Report — v3.4.4 ("Mở LMS (<Mã lớp>)" Button in `/session-comments`)

- **Reviewer:** Independent QA Reviewer (`gemini-4-argon-medium`)
- **Date:** 2026-11-13
- **Feature:** v3.4.4 — Nút **"Mở LMS (`<Mã lớp>`)"** trên màn hình **Nhận xét buổi học (`/session-comments`)** mở trực tiếp Drawer Lớp học ở tab `Comments` (`tab=10`) trên MindX LMS.
- **Audit Scope:**
  - `src/lib/lms/lms-class-url.ts`
  - `src/lib/lms/lms-class-id-store.ts`
  - `src/lib/db/json-config.ts`
  - `src/lib/db/sqlite.ts`
  - `src/lib/classes/class-directory.ts`
  - `src/lib/playwright/sync-class.ts`
  - `src/app/api/classes/lms-url/route.ts`
  - `src/app/api/session-comments/list/route.ts`
  - `src/app/session-comments/page.tsx`
  - `scripts/test-session-comments-open-lms.ts`

---

## 1. MindX LMS URL Deep-Link Contract & Scheme Security (`src/lib/lms/lms-class-url.ts`)

- **JSON-Quoted Query Parameters (`?search=%22<CODE>%22&id=%22<ID>%22&tab=10`):**
  - `buildLmsClassCommentsUrl({ classCode, lmsClassId, lmsBaseUrl, tabIndex })` encodes `search` via `encodeURIComponent(JSON.stringify(code))` (`%22<CODE>%22`) and `id` via `encodeURIComponent(JSON.stringify(cleanId))` (`%22<ID>%22`), appending `&tab=10` (`LMS_COMMENTS_TAB_INDEX = 10`) to match MindX LMS's `useQueryParams` JSON-encoded state contract.
- **Safe Search-Only Fallback (`?search=%22<CODE>%22` without `id`):**
  - `isValidLmsClassObjectId` rejects empty strings, sentinel strings (`"undefined"`, `"null"`, `"NaN"`, `"Infinity"`, `"true"`, `"false"`, `"[object Object]"`), strings shorter than 8 characters, and tokens containing characters outside `/^[a-zA-Z0-9_-]{8,64}$/`.
  - When `lmsClassId` is missing or invalid, `buildLmsClassCommentsUrl` omits both `id` and `tab`, returning `${origin}/admin/classes?search=%22<CODE>%22` so LMS's `GetClassById` GraphQL query does not crash on an invalid ID.
- **Scheme Injection Prevention (`javascript:` / `data:` / `vbscript:`):**
  - `normalizeLmsBaseOrigin` enforces `/^(https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?)(?:\/|$)/i` and falls back to `https://lms.mindx.edu.vn` on any non-HTTP(S) scheme, userinfo (`@`), or malformed input.
- **Drawer URL Extraction:**
  - `extractLmsClassIdFromDrawerUrl` parses both JSON-quoted (`id=%2269661f21d58b4208159d5940%22`) and unquoted (`id=69661f21d58b4208159d5940`) query parameters and validates the extracted candidate with `isValidLmsClassObjectId`.

**Status:** **PASS**

---

## 2. Local-Only Security, Path Allowlist & Zero-Write Read Behavior

- **Local-Only Request Guard (`/api/classes/lms-url`):**
  - Both `GET` (`line 28`) and `POST` (`line 80`) in `src/app/api/classes/lms-url/route.ts` invoke `validateLocalRequest(req)` as their first statement, blocking non-loopback `Host`, cross-origin `Origin`, and `Sec-Fetch-Site: cross-site` requests with HTTP `403`.
- **Path Allowlist Enforcement (`assertPathAllowed`):**
  - `getLmsClassIdsMap()`, `saveLmsClassIdMapping()`, and `saveLmsClassIdMappingsBatch()` in `src/lib/db/json-config.ts` validate both the config directory and `lms_class_ids.json` file path via `assertPathAllowed`.
  - `readRunningClassesMap()` and `readReportCardsSnapshotMap()` in `src/lib/lms/lms-class-id-store.ts` validate `running_classes.json` and `mindx_bot.db` paths via `assertPathAllowed`.
- **Strict Zero-Write Read Path:**
  - `getLmsClassIdsMap()` checks `if (!fs.existsSync(filePath)) return {};` directly instead of calling `readJsonFile` (which auto-creates missing config files), ensuring zero directory or file creation when `data/config/lms_class_ids.json` does not exist.
  - `readReportCardsSnapshotMap()` checks `if (!fs.existsSync(safeDbPath)) return result;` before calling `getDb()`, ensuring a missing SQLite database is never created on a read lookup.
- **Synthetic / Test Class Isolation:**
  - `ClassSyncer.syncClass`, `ClassSyncer.fetchRunningClasses`, and `ClassSyncer.resolveLmsClassId` check `!/^(TEST|AUDIT|R\d+|CLASS_|SYNTH)/i.test(...)` and `!testPage` before persisting mappings to `lms_class_ids.json`.

**Status:** **PASS**

---

## 3. Browser & UI Edge Cases (`src/app/session-comments/page.tsx`)

- **Reverse Tabnabbing & Popup-Blocker Handling:**
  - **Cached fast-path (`lines 1119–1139`):** Calls `window.open(directUrl, "_blank")` synchronously inside the click handler, checks `!popup` to surface a clear Vietnamese popup-blocker guidance message, and sets `popup.opener = null` inside `try/catch`.
  - **Uncached resolution path (`lines 1141–1230`):** Claims `window.open("about:blank", "_blank")` synchronously inside the user gesture before awaiting `fetch("/api/classes/lms-url", { method: "POST" })`, sets `popup.opener = null`, and handles `!popup` gracefully.
- **DOM XSS Prevention in Loading Popup:**
  - Escapes `targetCode` via `escapeHtmlInline(targetCode)` (`&`, `<`, `>`, `"`, `'`) before writing the loading HTML shell into `popup.document.write(...)`.
- **URL Scheme Verification Before Navigation:**
  - Verifies `/^https?:\/\//i.test(json.url)` before redirecting the popup (`popup.location.replace(finalUrl)`), falling back to `fallbackSearchUrl` (`?search=%22<CODE>%22`) on API failure (`!res.ok`) or network error, and checking `!popup.closed` before touching `popup.location`.
- **Race Safety on Class Switch & Double Click:**
  - Uses `openingLmsInFlightRef.current` to prevent overlapping `POST /api/classes/lms-url` requests on rapid double-click (`disabled={openingLmsClass !== null}` on the button).
  - Tracks `activeClassIdRef.current === targetCode` so status messages from a slow background resolution do not overwrite the UI banner if the teacher has already switched to another class, while still caching the resolved `lmsClassId` in `lmsClassIdsByCode` and redirecting the already-opened tab for `targetCode`.
- **Toolbar Placement:**
  - `button[data-testid="open-class-lms-btn"]` (`Mở LMS (<Mã lớp>)`) is rendered inside `{/* 3. Action Toolbar */}` (`lines 4103–4123`) immediately to the left of `⚡ Điểm danh cả lớp Có mặt` (`lines 4124–4137`), verified both in source and in headless Chromium layout (`openBox.right <= attendBox.left + 2`).

**Status:** **PASS**

---

## 4. `node:vm` Strip-Imports Harness Compatibility & `sqlite.ts` Check

- **`src/app/session-comments/page.tsx`:**
  - Uses only `useState`, `useEffect`, `useRef` from React (`no useCallback`, `no useMemo`).
  - Does not invoke `new URL(...)`.
  - Guards `sharedBuildLmsClassCommentsUrl` with `typeof sharedBuildLmsClassCommentsUrl === "function"` and provides an inline fallback in `buildLmsClassCommentsUrlSafe`.
- **`src/lib/playwright/sync-class.ts`, `src/lib/classes/class-directory.ts`, `src/app/api/session-comments/list/route.ts`:**
  - All imported helpers (`extractLmsClassIdFromDrawerUrl`, `isValidLmsClassObjectId`, `saveLmsClassIdMapping`, `saveLmsClassIdMappingsBatch`, `resolveKnownLmsClassIdsMap`, `resolveKnownLmsClassId`) are guarded with `typeof fn === "function"` checks so stripped-import `node:vm` harnesses continue to execute cleanly.
- **`src/lib/db/sqlite.ts`:**
  - Verified via `git diff HEAD -- src/lib/db/sqlite.ts`: the only change in `sqlite.ts` is guarding `new AsyncLocalStorage<Map<string, string>>()` with `typeof AsyncLocalStorage === "function" ? new AsyncLocalStorage<Map<string, string>>() : null` (`lines 1642–1665`). `initSchema()` (`lines 75–382`) was **NOT** altered.

**Status:** **PASS**

---

## 5. Verification Gates & Adversarial Probes Execution

All 5 required verification gates and an isolated adversarial probe in `$env:TEMP` were executed and passed:

1. `npx tsc --noEmit --incremental false` -> **PASS** (exit code `0`, `0` errors)
2. `npx tsx scripts/test-session-comments-open-lms.ts` -> **PASS** (`ALL OL-01..OL-06 CHECKS PASSED`, including real Headless Chromium E2E layout & popup redirect test)
3. `npx tsx scripts/test-streamline-v340-s3.ts` -> **PASS** (`S3.1..S3.7` & `S3-01..S3-08` 100%)
4. `npx tsx scripts/test-phase4-codex-repros.ts` -> **PASS** (`Round 1 -> Round 17` 100%)
5. `npx tsx scripts/test-spck-portal-idle-no-loop.ts` -> **PASS** (`PT-01 -> PT-09` 100%)
6. **Isolated `$env:TEMP` Adversarial Probe** (testing `isValidLmsClassObjectId` against `"NaN"`, `"Infinity"`, `"[object Object]"`, `<script>` payloads; `normalizeLmsBaseOrigin` against `javascript:`, `data:`, `vbscript:`, `ftp:`, and userinfo `@` URLs; zero-write verification on non-existent `MINDX_CONFIG_DIR` and `MINDX_DB_PATH`; `Sec-Fetch-Site: cross-site` and cross-origin `POST` blocking; malformed JSON `400` response; temp directory cleaned up in `finally`) -> **PASS** (`ADVERSARIAL_PROBE_PASS`)

---

## 6. Real Data Integrity Verification (Shared-Read SHA-256)

Verified after all tests and probes completed:

- `data/mindx_bot.db`: `E193349D81B23FA7DA15CF129D8433A9BF6DE8E2CCC98B17A6BA1DCF5208121E` (**100% match**)
- `data/running_classes.json`: `14C682076B1D76A03BF8C50BE39ACCAE8EBE6077D68D244D02ADECC007CC9E31` (**100% match**)
- `data/config/lms_class_ids.json` exists: `False` (**100% untouched**)

---

## Final Decision

No blocking, high, medium, or low defects found.

VERDICT: GO
