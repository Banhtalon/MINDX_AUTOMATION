# Independent QA & Security Audit Report — v3.4.5 ("Quét & Đồng bộ tất cả lớp đang dạy lên Teaching" on `/homework-grader`)

- **Reviewer:** `@reviewer-v345`
- **Date:** 2026-11-13
- **Scope Audited:**
  - `src/lib/report-card/report-card-batch-sync.ts`
  - `src/app/api/report-card/batch-sync/route.ts`
  - `src/components/report-card-batch-sync-panel.tsx`
  - `src/app/homework-grader/page.tsx`
  - `scripts/test-report-card-batch-sync.ts`

---

## 1. Concurrency, `SequentialTaskQueue` Discipline & React Lifecycle Audit

1. **Zero Nested-Enqueue Deadlock (`src/lib/report-card/report-card-batch-sync.ts`):**
   - `discoverRunningClassesForBatchSync` enqueues a single top-level `SYNC_CLASS` job (`batch_rc_discover_<ts>`) wrapping `ClassSyncer.fetchRunningClasses({ persistToConfig: true })`.
   - `syncSingleClassReportCardFlow` **never** wraps `enqueueScrapeClassScores` or `TeachingReportCardSyncService.syncReportCardToTeaching` inside an outer `taskQueue.enqueue(...)` call, preventing nested-enqueue deadlocks on the single-threaded `SequentialTaskQueue`.
2. **In-Flight Locks & Cleanup (`globalThis`):**
   - Per-class lock set `__mindxReportCardSingleClassBatchLocks` rejects concurrent duplicate requests for the same class with HTTP `409 Conflict` (`conflict: true`) and always deletes `classId` in a `finally` block (`locks.delete(classId)`).
   - Server-side full-batch lock `__mindxReportCardBatchSyncInFlight` rejects concurrent `runBatchReportCardSync` calls with HTTP `409 Conflict` and always resets to `false` in `finally`.
3. **Stop Bot (`QUEUE_STOPPED` / `TASK_CANCELLED`) & Graceful vs. Emergency Stop:**
   - Server checks `isQueueStoppedFn()` (`(process as any).__mindxQueueStopped || taskQueue.getStatus().isStopped`) before discovery, inside the discovery task before/after `fetchRunningClassesFn`, before each class flow, and on any caught error matching `/QUEUE_STOPPED|TASK_CANCELLED/i`, returning HTTP `409` with `cancelled: true` and `outcome: "CANCELLED"`.
   - Client (`ReportCardBatchSyncPanel`) provides both **graceful stop** (`stopAfterCurrentRef.current = true`, finishing the in-flight class cleanly and marking remaining `PENDING` rows `CANCELLED`) and **emergency stop** (`emergencyStopRef.current = true`, aborting the active `AbortController` and posting `{ action: "stop" }` to `/api/queue/control`, plus exposing the `▶ Mở khóa hàng đợi` button).
4. **React Closure & Unmount Safety (`src/components/report-card-batch-sync-panel.tsx`, `src/app/homework-grader/page.tsx`):**
   - Callback props (`onRunningStateChange`, `onClassesDiscovered`, `onClassProcessed`) are stored in refs updated on every render to avoid stale closures during multi-class async loops.
   - `mountedRef` and `runSeqRef` guard every `await` resumption so unmounted or superseded runs never call `setState`, and the unmount cleanup aborts `abortControllerRef.current`.
   - In `homework-grader/page.tsx`, `onClassProcessed` checks `doneCode.trim().toUpperCase() === activeClassIdRef.current` before calling `loadCachedScores(activeClassIdRef.current)`, ensuring live refresh when the active class completes without clobbering a different selected class.

---

## 2. Local-Only Security & Boundary Audit

1. **Local-Only Guard (`src/app/api/report-card/batch-sync/route.ts`):**
   - Both `GET` and `POST` handlers call `validateLocalRequest(request)` as their first statement (`403 Forbidden` on non-local Host/Origin).
2. **Strict Input Validation:**
   - Rejects malformed JSON, `null`, arrays, or primitive JSON bodies with HTTP `400`.
   - Rejects unknown `action` values with HTTP `400`.
   - Validates `classCode` (`sync_single_class`) and `classCodes` (`sync_all`) against `isSafeBatchClassCode` (`/^[A-Z0-9][A-Z0-9_-]{1,63}$/` and `!isSyntheticClassCode(code)`), returning HTTP `400` on empty/non-string/synthetic codes.
3. **Client Boundary Hygiene (`src/components/report-card-batch-sync-panel.tsx`, `src/app/homework-grader/page.tsx`):**
   - Verified zero references to `TEACHING_PASSWORD`, `LMS_PASSWORD`, `GEMINI_API_KEY`, `@/lib/config`, `@/lib/db/`, `@/lib/playwright/`, or `better-sqlite3`.

---

## 3. Data Integrity & Domain Rules Audit

1. **Manual Overrides Preservation & Edit-After-Batch Downgrade:**
   - `ScoreScraper` / `saveLmsSnapshot` updates `lmsSnapshotJson` without wiping `manualOverridesJson`.
   - `syncSingleClassReportCardFlow` computes `liveHash = computeReportCardContentHash(snapshot, overrides)` and auto-approves with manual overrides intact before pushing to Teaching.
   - Editing a score after batch sync increments `draftVersion` and downgrades status from `VERIFIED` to `WAITING_APPROVAL`.
2. **Mid-Scrape Concurrent Teacher Edit Guard (`CONCURRENT_EDIT`):**
   - Records `overridesBeforeJson = beforeRecord?.manualOverridesJson || "{}"` prior to `scrapeFn(classId)`. If `(afterScrape.manualOverridesJson || "{}") !== overridesBeforeJson`, aborts auto-approve/sync for that class with `outcome: "NEEDS_ATTENTION"`, `stage: "CONCURRENT_EDIT"`, preserving the teacher's newly saved manual override.
3. **Prior-Synced Empty / Zero-Score Regression Guard:**
   - Computes `hadPriorTeachingSync = Boolean(beforeRecord?.teachingSyncedAt || beforeRecord?.teachingSyncStatus === "VERIFIED" || beforeRecord?.status === "VERIFIED")`.
   - If a previously synced class returns 0 students or `countSyncableReportCardScores(computed) === 0` (including a prior-synced Robotics class whose CP scores disappeared), returns `outcome: "NEEDS_ATTENTION"` (`success: false`) instead of silently skipping as `SKIPPED_NO_SCORES`.
4. **Robotics Pre-CP1 & Newly Opened Classes (`SKIPPED_NO_SCORES`):**
   - `countSyncableReportCardScores` ignores `btvnCells` when `computed.isRobotics === true` and counts only finite CP1/CP2/Final stage values. Pre-CP1 Robotics classes with no prior sync return `outcome: "SKIPPED_NO_SCORES"` (`success: true`) and remain `DRAFT` in SQLite without calling Teaching.
5. **Unchanged `VERIFIED` Fast-Skip vs. `FAILED` / `OUT_OF_SYNC` Retry:**
   - Fast-skips (`SKIPPED_UNCHANGED`) **only** when `afterScrape.status === "VERIFIED" && afterScrape.teachingSyncStatus === "VERIFIED" && Boolean(afterScrape.contentHash) && afterScrape.contentHash === liveHash`. Classes in `FAILED` or `OUT_OF_SYNC` states are never skipped as unchanged.
6. **Per-Class Error Isolation:**
   - Exceptions or `success: false` from `scrapeFn`, `approveReportCard`, or `syncTeachingFn` (unless caused by Stop Bot) resolve to `outcome: "NEEDS_ATTENTION"` (`statusCode: 200`), allowing the batch loop to proceed to subsequent classes.

---

## 4. `node:vm` Strip-Imports Harness Compatibility (`src/app/homework-grader/page.tsx`)

- Verified `scrapeTrigger=""` on `<TeachingReportCardView ... />` (line 716).
- Verified `const renderCellBadge = (student: StudentScoreRow, col: ScoreColumnInfo) => {` (line 480).
- Verified top-level helpers (`formatCellForExport`, `sanitizeTsvCell`, `htmlToPlainText`) prior to `export default function HomeworkGraderPage()` execute cleanly inside a bare `node:vm` context after stripping imports and TypeScript types.

---

## 5. Verification Gates & Adversarial Probe Results

| Gate / Probe | Command / Target | Result |
|---|---|---|
| Gate 1 | `npx tsc --noEmit --incremental false` | **PASS** (exit 0) |
| Gate 2 | `npx tsx scripts/test-report-card-batch-sync.ts` (BS-01..BS-08 + Chromium E2E) | **PASS** (exit 0) |
| Gate 3 | `npx tsx scripts/test-report-card-v330.ts` (RC-01..RC-06) | **PASS** (exit 0) |
| Gate 4 | `npx tsx scripts/test-streamline-v340-s4.ts` (S4-T1..S4-T5) | **PASS** (exit 0) |
| Gate 5 | `npx tsx scripts/test-streamline-v340-s1.ts` (S1.1..S1.7 + S1-R1) | **PASS** (exit 0) |
| Gate 6 | `npx tsx scripts/test-phase4-codex-repros.ts` (Rounds 1..17) | **PASS** (exit 0) |
| Gate 7 | `npx tsx scripts/test-audit-remediation-v341.ts` (T1..T11) | **PASS** (exit 0) |
| Isolated `$env:TEMP` Probe | (a) Invalid/non-object `sync_all` `classCodes` & unknown action -> `400`; (b) Prior-synced Robotics class returning 0 CP scores -> `NEEDS_ATTENTION` (not `SKIPPED_NO_SCORES`); (c) Concurrent `runBatchReportCardSync` `409` & `finally` lock release on exception; (d) `FAILED` and `OUT_OF_SYNC` classes with matching `contentHash` are synced (`SYNCED`), never skipped as `SKIPPED_UNCHANGED`. | **PASS** (exit 0, temp dir deleted) |

---

## 6. Real Data Preservation Verification (SHA-256)

Verified before and after all tests and probes using `FileShare.ReadWrite`:
- `data/mindx_bot.db`: `E193349D81B23FA7DA15CF129D8433A9BF6DE8E2CCC98B17A6BA1DCF5208121E` (100% match)
- `data/running_classes.json`: `A304D7E7C8B7D41912BA24F52156281D21723F4E16C81BCC755D8F7D100588B3` (100% match)

---

## 7. Findings Summary

- **P0 Findings:** 0
- **P1 Findings:** 0
- **P2 Findings:** 0

VERDICT: GO
