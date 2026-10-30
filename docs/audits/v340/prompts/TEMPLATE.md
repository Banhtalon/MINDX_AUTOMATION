# CODEX INDEPENDENT AUDIT PROMPT TEMPLATE — v3.4.0 STREAMLINING (STAGE S<N>, ROUND <K>)

You are acting as the **Independent Quality & Safety Auditor (`gpt-6.1-sol` `high`)** for the **MindX Automation Bot** repository (`v3.4.0` — Giai đoạn 10: Tinh gọn Luồng Nghiệp vụ & Giảm Thao tác Giáo viên).

## 1. Stage Scope & Target
- **Stage:** `S<N>` — `<STAGE_TITLE>`
- **Audit Round:** `Round <K>`
- **Baseline / Diff Range:** `<BASE_COMMIT>..HEAD` (or working tree against `<BASE_COMMIT>`)
- **Changed Files:**
  - `<LIST_OF_CHANGED_FILES>`
- **Checklist Items Covered in This Stage:**
  - `<CHECKLIST_ITEMS>`

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
> - **DO NOT** create NTFS junctions (`mklink /J` / `New-Item -ItemType Junction`) for `node_modules` inside `$env:TEMP`. Instead, resolve `node_modules` via `NODE_PATH` or `Module._resolveFilename` directly from the workspace root. (Test fixtures inside `$env:TEMP` such as `test-spck-v272.ts` `V14` are allowed to create their own temporary junction inside `$env:TEMP`).
> - When cleaning up your `$env:TEMP` subdirectory at the end of the audit, **ALWAYS use Node.js `fs.rmSync(..., { recursive: true, force: true })`** (`node -e "require('node:fs').rmSync(process.env.AUDIT_TEMP, { recursive: true, force: true })"`) instead of PowerShell `Remove-Item -Recurse -Force` (which is blocked by the shell policy filter).

Run and report exact exit codes for:
1. `npx tsc --noEmit --incremental false`
2. Stage-specific test suite(s): `<STAGE_TEST_COMMANDS>`
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
4. Author and run an independent adversarial probe for `S<N>` in a disposable TEMP directory testing edge cases, race conditions, stale versions, queue discipline, and hash integrity.

## 5. Required Audit Report Format
Write a concise, evidence-backed Markdown report containing:
- **Decision:** `GO` or `NO-GO` for Stage `S<N>` Round `<K>`.
- **Gate Execution Summary:** Table of all commands run and their exit codes.
- **Finding Table:** Every finding numbered `S<N>-01`, `S<N>-02`... with Severity (`HIGH` / `MEDIUM` / `LOW`), Status (`OPEN` / `CLOSED`), exact `file:line`, reproduction proof, and required fix. (For Round $\ge 2$, include disposition of all prior round findings).
- **Production Data Preservation Check:** Before/after SHA-256 hashes of `data/mindx_bot.db` and `data/running_classes.json`.
