# CODEX INDEPENDENT AUDIT PROMPT — v3.4.0 STREAMLINING (STAGE S3, ROUND 1)

You are acting as the **Independent Quality & Safety Auditor (`gpt-6.1-sol` `high`)** for the **MindX Automation Bot** repository (`v3.4.0` — Giai đoạn 10: Tinh gọn Luồng Nghiệp vụ & Giảm Thao tác Giáo viên).

## 1. Stage Scope & Target
- **Stage:** `S3` — `Tinh gọn Màn 1 (/session-comments): 5 -> 3 clicks & Thống nhất Zalo Summary Engine`
- **Audit Round:** `Round 1`
- **Baseline / Diff Range:** Working tree against `ab3f570` (`S2` commit)
- **Changed Files:**
  - `src/lib/zalo/zalo-summary.ts` (New unified client/server-safe Zalo summary engine)
  - `src/lib/zalo/broadcast-generator.ts` (Refactored to delegate to `zalo-summary.ts`)
  - `src/app/api/session-comments/zalo-btvn-image/route.ts` (Refactored to import `formatShortZaloName` & `buildBtvnPart2` from `zalo-summary.ts`)
  - `src/app/api/session-comments/save-draft/route.ts` (Added batch `items` support while preserving single-item behavior, `versionMetaJson` freshness checks, and partial batch reporting)
  - `src/app/api/session-comments/approve/route.ts` (Added batch `items` support while preserving `approveConditional` CAS checks, `contentHash = calculateSha256(textToApprove)`, and validation against `INSUFFICIENT_INFO` / `FAILED` / `ABSENT` / inactive students)
  - `src/app/session-comments/page.tsx` (Implemented batch `handleConfirmAllPresent`, 600ms debounce + `onBlur`/`beforeunload` flush, `UNKNOWN` attendance confirmation prompt on `"AI Soạn Nhận Xét"`, 1-click primary button `"✅ Duyệt & Đẩy LMS (Buổi N)"` (`handleApproveAndSaveLms`), 1-click per-row button `"Duyệt & Lưu riêng"` / `"Thử lại"` / `"Đẩy lại"` (`handleApproveAndSaveSingle`), Checkpoint competency reminder, Zalo delegation, and dead code removal)
  - `scripts/test-streamline-v340-s3.ts` (New Stage S3 verification suite)
- **Checklist Items Covered in This Stage:**
  - `S3.1`: Batch `POST /api/session-comments/save-draft` (`items` array) + 1-request `handleConfirmAllPresent` + 600ms debounce on `handleNoteChange` / `handleTextEdit` with immediate flush on `onBlur` / `beforeunload` and before AI / Approve / Save LMS.
  - `S3.2`: Automatic confirmation prompt when clicking `"AI Soạn Nhận Xét"` while `UNKNOWN` students exist (`"Coi N bạn chưa điểm danh là Có mặt (giữ nguyên các bạn Nghỉ học)?"`).
  - `S3.3`: Batch `POST /api/session-comments/approve` (`items` array) + primary 1-click button `"✅ Duyệt & Đẩy LMS (Buổi N)"` (`handleApproveAndSaveLms`) with summary status `"Đã lưu X / Bỏ qua Y (thiếu thông tin) / Lỗi Z"`; secondary `"Chỉ duyệt nháp (chưa đẩy LMS)"` inside `More` (`⋯`) menu.
  - `S3.4`: Per-row 1-click button `"Duyệt & Lưu riêng"` (`"Thử lại"` when `FAILED`, `"Đẩy lại (Buổi N)"` when `APPROVED`) (`handleApproveAndSaveSingle`).
  - `S3.5`: Checkpoint session (Coding 5 & 9; Robotics 4 & 8) helper reminder on per-row action (`"Thầy hãy tích Điểm Năng lực trên LMS rồi bấm Đẩy lại"`).
  - `S3.6`: Unified Zalo Summary Engine (`src/lib/zalo/zalo-summary.ts`) shared across `src/app/session-comments/page.tsx`, `src/lib/zalo/broadcast-generator.ts`, and `src/app/api/session-comments/zalo-btvn-image/route.ts`.
  - `S3.7`: Removed dead `{false && ...}` block and `"Em ${target.fullName}"` prefix in `src/app/session-comments/page.tsx`.
  - `S3.8`: Stage S3 test suite (`scripts/test-streamline-v340-s3.ts`) & regression gates.

## 2. Mandatory Reading Order
1. Read `PROJECT_STATE.md` first (Single Source of Truth).
2. Cross-check `MINDX_AUTOMATION_PLAN.md` (specifically **GIAI ĐOẠN 10 (`v3.4.0`)**) and `CHANGELOG.md`.
3. Read `AGENTS.md` and enforce all 6 core rules:
   - Local-Only Security (`127.0.0.1` binding, no secret leakage to `'use client'`, Path Allowlist enforcement; Student Portal `0.0.0.0` + Cloudflare Quick Tunnel is the documented explicit teacher-activated exception protected by `sessionToken`).
   - Playwright Discipline (single Persistent Context `./playwright-auth`, all browser actions through `SequentialTaskQueue`, network response verification + Read-after-Write DOM verification, Checkpoint rule on Sessions 5 & 9 Coding / 4 & 8 Robotics).
   - Data Integrity & Hashing (`classId`, `sessionId`, `studentId`, `submissionId` keys; `contentHash` SHA-256 lock on approval; automatic demotion to `DRAFT` / `WAITING_APPROVAL` on drift).
   - AI Guardrails (`gemini-3.5-flash-lite`, PII anonymization `STUDENT_01`..., `INSUFFICIENT_INFO` when no tags/notes, 5-level 3-bullet format, Zalo 2-part format, Default MindX Logo thumbnail fallback).

## 3. Strict Audit Isolation & Safety Rules (MANDATORY)
- **DO NOT** modify any application source code (`src/**`), existing test scripts (`scripts/**`), `next-env.d.ts`, or historical audit directories (`docs/audits/round-12` .. `docs/audits/round-41`).
- **DO NOT** open a SQLite connection to, modify, copy, or delete the production database `data/mindx_bot.db` or `data/running_classes.json`. **EXPLICIT READ-ONLY HASH EXCEPTION:** You **ARE EXPLICITLY PERMITTED AND REQUIRED** to run read-only `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` before and after your audit to verify that their SHA-256 hashes remain 100% unchanged.
- Every test or probe execution **MUST** run with isolated environment overrides pointing inside `$env:TEMP`:
  - `ALLOWED_LOCAL_DIRS=<temp_dir>`
  - `MINDX_DB_PATH=<temp_dir>/test.db`
  - `MINDX_RUNNING_CLASSES_PATH=<temp_dir>/running_classes.json`
  - For suites that write config files (`test-phase7.ts`), run in a temporary workspace mirror or verify exact byte-for-byte restoration of `data/config/*.json`.
- **DO NOT** make any live network requests to `lms.mindx.edu.vn` or `teachingmindx.top`.
- Verify that the SHA-256 of `data/mindx_bot.db` (`28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7`) and `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) remain 100% unchanged before and after your audit.

## 4. Mandatory Verification Gates to Execute Freshly
> **SANDBOX EXECUTION NOTE (WINDOWS `spawn EPERM` & TEMP CLEANUP):**
> - You **ARE EXPLICITLY AUTHORIZED** to execute TypeScript test suites either via `npx tsx` or in-process via `node` + `@next/swc-win32-x64-msvc` (`require.extensions['.ts']` / `Module._resolveFilename` loader) and treat those exit codes as the official, primary gate results.
> - **DO NOT** create NTFS junctions (`mklink /J` / `New-Item -ItemType Junction`) for `node_modules` inside `$env:TEMP`. Instead, resolve `node_modules` via `NODE_PATH` or `Module._resolveFilename` directly from the workspace root.
> - When cleaning up your `$env:TEMP` subdirectory at the end of the audit, **ALWAYS use Node.js `fs.rmSync(..., { recursive: true, force: true })`** (`node -e "require('node:fs').rmSync(process.env.AUDIT_TEMP, { recursive: true, force: true })"`) instead of PowerShell `Remove-Item -Recurse -Force` (which is blocked by the shell policy filter).

Run and report exact exit codes for:
1. `npx tsc --noEmit --incremental false`
2. Stage-specific test suites:
   - `npx tsx scripts/test-streamline-v340-s3.ts`
   - `npx tsx scripts/test-quick-tags-v300.ts`
   - `npx tsx scripts/test-streamline-v340-s1.ts`
   - `npx tsx scripts/test-streamline-v340-s2.ts`
3. Regression gates:
   - `npx tsx scripts/test-phase5.ts`
   - `npx tsx scripts/test-phase6.ts`
   - `npx tsx scripts/test-phase7.ts`
   - `npx tsx scripts/test-phase4-codex-repros.ts`
   - `npx tsx scripts/test-spck-v270.ts`
   - `npx tsx scripts/test-spck-v272.ts`
   - `npx tsx scripts/test-lms-reliability-v280.ts`
   - `npx tsx scripts/test-session14-v290.ts`
   - `npx tsx scripts/test-teaching-project-v320.ts`
   - `npx tsx scripts/test-report-card-v330.ts`
4. Author and run an independent adversarial probe for `S3` in a disposable TEMP directory testing edge cases, race conditions, stale versions, debounce flushing before AI/approve/save-lms, partial batch failure rollback, and hash integrity.

## 5. Required Audit Report Format
Write your complete report directly to `docs/audits/v340/CODEX_S3_ROUND1.md` containing:
- **Decision:** `GO` or `NO-GO` for Stage `S3` Round `1`.
- **Gate Execution Summary:** Table of all commands run and their exit codes.
- **Finding Table:** Every finding numbered `S3-01`, `S3-02`... with Severity (`HIGH` / `MEDIUM` / `LOW`), Status (`OPEN` / `CLOSED`), exact `file:line`, reproduction proof, and required fix.
- **Production Data Preservation Check:** Before/after SHA-256 hashes of `data/mindx_bot.db` and `data/running_classes.json`.
