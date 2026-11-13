# Independent QA & Security Audit Report — v3.4.6

**Feature:** Skip Missing/Inactive Students on Teaching During Report Card Sync (Fix `VT-JSB16`) & Clear Teaching Link Button  
**Reviewer:** `reviewer-v346` (`gemini-4-argon-medium`)  
**Date:** 2026-11-13  

---

## 1. Executive Summary

An independent line-by-line QA, security, and behavioral audit was performed across all 5 files changed in v3.4.6 (`src/lib/playwright/teaching-report-card-sync.ts`, `src/app/api/report-card/sync-teaching/route.ts`, `src/lib/report-card/report-card-batch-sync.ts`, `src/components/teaching-report-card-view.tsx`, `src/components/report-card-batch-sync-panel.tsx`, and `scripts/test-report-card-batch-sync.ts`). All 7 verification gates and custom isolated adversarial probes in `$env:TEMP` passed 100% with zero regressions and 100% preservation of live SQLite/JSON data hashes.

- **Findings:** `0 P0`, `0 P1`, `0 P2`

---

## 2. Detailed File-by-File Audit Findings

### 2.1. `src/lib/playwright/teaching-report-card-sync.ts` — **PASS**
- **Detailed Matcher & Legacy Wrapper Contract:**
  - `matchReportCardStudentsToTeachingDetailed(localStudents, remoteStudents, rawClassCode, isRobotics, options)` cleanly returns `{ matchedMap, skippedStudents }`.
  - `matchReportCardStudentsToTeaching(...)` wraps `matchReportCardStudentsToTeachingDetailed(..., { allowPartialMatch: false }).matchedMap`, preserving 100% strict legacy behavior for existing callers and regression suites.
- **Safety Guards Preserved Under `allowPartialStudentMatch: true`:**
  - **Cross-Class Guard:** Remote students or exercises/scores whose `class_code` disagrees with target `classCode` immediately throw `[Cross-Class Guard Error]`.
  - **Remote Student ID Integrity:** Non-positive/non-integer remote IDs (`parseStrictPositiveIntInput(rs?.id) === null`) and duplicate remote IDs (`seenRemoteIds.has(id)`) throw `[Student Match Error]`.
  - **Ambiguity Guards:** Duplicate active local or remote names (both tone-preserving Priority 2 and tone-insensitive Priority 3) throw `[Student Match Error] ... trùng tên ...` instead of guessing or skipping.
  - **Explicit `TEACHING_123` / `TID:123` Strict Binding (Priority 1):** Explicit ID bindings still fail loudly on missing ID, inactive status, tone mismatch, or duplicate active names even when `allowPartialMatch: true`.
  - **Zero-Match Guard:** When `allowPartialMatch: true` and `matchedMap.size === 0` (with `skippedStudents.length > 0 || relevantLocals.length > 0`), the matcher throws the first skipped student detail error instead of vacuous success.
  - **Zero Syncable Scores Guard:** If matched students have no finite scores (`scoresToSave.length === 0`, e.g., only the skipped student had scores), `syncReportCardToTeaching` throws a descriptive error including `skippedWarning` rather than calling `saveScores([])`.
- **Partial Sync (`VT-JSB16` 9/10 Case) & Read-after-Write Verification:**
  - Missing (`NOT_FOUND_ON_TEACHING`) or inactive (`INACTIVE_ON_TEACHING`) students on Teaching are recorded in `skippedStudents` while the remaining matched students (e.g., 9/10 in `VT-JSB16` when `"Dương Đăng Khôi"` is missing on Teaching) proceed through exercise declaration, `save_scores`, and full Read-after-Write `get_scores` verification.
  - `reportCardRepo.markTeachingVerified` persists `studentCount`, `totalLocalStudentCount`, `skippedStudentCount`, and `skippedStudents` inside `teachingVerifiedSnapshotJson`, and `syncReportCardToTeaching` returns `matchedStudentCount`, `skippedStudentCount`, `skippedStudents`, and `warning`.

### 2.2. `src/app/api/report-card/sync-teaching/route.ts` — **PASS**
- Enforces `validateLocalRequest(request)` at entry (rejects non-local Host/Origin with `403`).
- Validates `classId`/`classCode` consistency and `expectedVersion` via `parseStrictPositiveIntInput`.
- Safely returns `matchedStudentCount`, `skippedStudentCount`, `skippedStudents`, and optional `warning` without leaking any server environment secrets (`TEACHING_PASSWORD`, `LMS_PASSWORD`, `GEMINI_API_KEY`).

### 2.3. `src/lib/report-card/report-card-batch-sync.ts` — **PASS**
- **Defensive Snapshot Parser (`extractPriorSkippedTeachingStudents`):**
  - Safely handles `null`, `undefined`, `""`, malformed JSON (`"{bad"`), primitive JSON (`"null"`, `"123"`), arrays (`"[1,2]"`), and malformed item entries without throwing.
  - Even if `skippedStudents` array is missing or empty, if `Number(parsed.skippedStudentCount) > 0`, it returns a synthetic `SkippedTeachingStudentInfo` item so backfill is still triggered.
- **Automatic Backfill on Subsequent Batch Sync:**
  - `SKIPPED_UNCHANGED` fast-skip requires `priorSkipped.length === 0`. Any class that previously verified with `skippedStudentCount > 0` automatically bypasses `SKIPPED_UNCHANGED` on subsequent batch runs to backfill newly added Teaching students, and resumes `SKIPPED_UNCHANGED` fast-skipping once `skippedStudentCount === 0`.

### 2.4. `src/components/teaching-report-card-view.tsx` & `src/components/report-card-batch-sync-panel.tsx` — **PASS**
- **Client Component Boundary Security:**
  - Both files start with `"use client";`, contain zero server/DB/Playwright imports, zero references to `TEACHING_PASSWORD`/`LMS_PASSWORD`/`GEMINI_API_KEY`, and zero `{false &&` dead-code patterns.
- **External Teaching Links & Valid HTML Semantics:**
  - Header button `🌐 Mở Teaching (<Mã lớp>) ↗` in `TeachingReportCardView` and per-row `Teaching ↗` link in `ReportCardBatchSyncPanel` both point to `https://teachingmindx.top/diem-tong-ket.php?from=hocsinh&class_code=${encodeURIComponent(...)}` with `target="_blank"` and `rel="noopener noreferrer"`.
  - In `ReportCardBatchSyncPanel`, each class row uses `<div role="button" tabIndex={0} ...>` (avoiding invalid nested `<a>` inside `<button>`), and the inner `<a>` calls `onClick={(e) => e.stopPropagation()}` and `onKeyDown={(e) => e.stopPropagation()}` so clicking `Teaching` opens the external tab without hijacking row selection.
- **Warning & Badge Rendering:**
  - `TeachingReportCardView` appends `data.warning` to the sync toast and renders `data-testid="report-card-skipped-students-banner"` whenever `record.teachingSyncStatus === "VERIFIED"` and `verifiedSkippedStudents.length > 0`.
  - `ReportCardBatchSyncPanel` renders the amber badge `Bỏ qua {item.skippedStudentCount} HV thiếu trên Teaching` when `item.status === "SYNCED"` and `skippedStudentCount > 0`.

### 2.5. `scripts/test-report-card-batch-sync.ts` (`BS-01..BS-09`) — **PASS**
- Covers discovery filtering & stopped queue (`BS-01`), mixed batch outcomes & error isolation (`BS-02`), manual overrides & concurrent edit guard (`BS-03`), empty-snapshot regression guard (`BS-04`), per-class 409 lock & `SequentialTaskQueue` non-deadlock (`BS-05`), API security (`BS-06`), client boundary & VM harness (`BS-07`), headless Chromium E2E (`BS-08`), and `VT-JSB16` partial match (`NOT_FOUND_ON_TEACHING`, `INACTIVE_ON_TEACHING`, duplicate name rejection, 0-match rejection, and auto-backfill on batch re-sync in `BS-09`).

---

## 3. Verification Gates (7 / 7 Passed)

| # | Command | Exit Code | Result |
|---|---------|-----------|--------|
| 1 | `npx tsc --noEmit --incremental false` | `0` | **PASS** |
| 2 | `npx tsx scripts/test-report-card-batch-sync.ts` | `0` | **PASS** (`BS-01..BS-09` passed) |
| 3 | `npx tsx scripts/test-report-card-v330.ts` | `0` | **PASS** (`RC-01..RC-06` passed) |
| 4 | `npx tsx scripts/test-streamline-v340-s4.ts` | `0` | **PASS** (`S4-T1..S4-T5` passed) |
| 5 | `npx tsx scripts/test-streamline-v340-s1.ts` | `0` | **PASS** (`S1.1..S1.7` + `S1-01..S1-05` passed) |
| 6 | `npx tsx scripts/test-phase4-codex-repros.ts` | `0` | **PASS** (Rounds 1..17 passed) |
| 7 | `npx tsx scripts/test-audit-remediation-v341.ts` | `0` | **PASS** (`T1..T11` passed) |

---

## 4. Isolated Adversarial Probe (`$env:TEMP`)

Executed a one-off isolated probe script in `$env:TEMP` (`MINDX_DB_PATH`, `MINDX_CONFIG_DIR`, `MINDX_RUNNING_CLASSES_PATH`, `MINDX_LMS_CLASS_IDS_PATH` pointed to temp dir, cleaned up after completion; `TEMP_CLEANED=True`):
- **Probe A (Corrupt/Count-Only `teachingVerifiedSnapshotJson`):** Verified `extractPriorSkippedTeachingStudents` returns `[]` on `null`, `undefined`, `""`, `"{bad"`, `"null"`, `"123"`, `"[1,2,3]"`, `"{}"`, and returns a synthetic entry on `{"skippedStudentCount": 2}` (missing `skippedStudents` array), which causes `syncSingleClassReportCardFlow` to bypass `SKIPPED_UNCHANGED` and trigger backfill (`backfillCalled === 1`).
- **Probe B (`allowPartialStudentMatch: false` vs `true` & `scoresToSave.length === 0`):** Verified `syncReportCardToTeaching` with `allowPartialStudentMatch: false` fails on missing `"Dương Đăng Khôi"`, succeeds on default (`true`), and rejects when matched students have all-null scores while only the skipped student has scores (`scoresToSave.length === 0`).
- **Probe C (Cross-Class Guard, Duplicate Remote IDs, Explicit `TEACHING_9999` Guard & UI/API Checks):** Verified Cross-Class mismatch, duplicate remote IDs, and missing explicit `TEACHING_9999` ID all fail loudly even when `allowPartialMatch: true` and another student matches.

---

## 5. Data Integrity & SHA-256 Verification

Measured via shared-read `[System.IO.File]::Open((Resolve-Path $path), 'Open', 'Read', 'ReadWrite')` before and after all verification gates and adversarial probes:

- `data/mindx_bot.db`:
  - **Before:** `E193349D81B23FA7DA15CF129D8433A9BF6DE8E2CCC98B17A6BA1DCF5208121E`
  - **After:**  `E193349D81B23FA7DA15CF129D8433A9BF6DE8E2CCC98B17A6BA1DCF5208121E` (**100% Match**)
- `data/running_classes.json`:
  - **Before:** `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C`
  - **After:**  `89A9CFEF7634643652A78331E49948717ECAC28567280160C9A4C051C4AFEF5C` (**100% Match**)

VERDICT: GO
