# v3.3.0 Phase 9 Stage 1 — Round 4 closure audit

Date: 2026-10-29. Independent recheck of the final F04 boundary in `CODEX_STAGE1_ROUND3.md` and F01–F07 for TASK-9.1/TASK-9.2. Result: **7 CLOSED, 0 OPEN**.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit 0. |
| `npx tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01, RC-02 and RC-03 complete, including the new F04 re-entry regression. |
| Production DB SHA-256 before/after execution | `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA` — exact match, unchanged. |
| Write restrictions | All 116 protected files (every file in `src/` and `scripts/`, the three project tracking documents and production DB) retain their initial SHA-256 values. Only this report written persistently; suite temporary databases cleaned up. |

Inspected `src/lib/db/sqlite.ts:5740–6560`, adjacent parsing/hash/failure code through `:6585`, `scripts/test-report-card-v330.ts:620–680` and related regressions, plus calculator rounding. Existing workspace changes were preserved.

## Closure table

| Finding | Status | Closure evidence |
| --- | --- | --- |
| F01 — Atomic optimistic locking | CLOSED | Save, restore and approval use transactions, version-qualified updates and affected-row checks (`sqlite.ts:5921,6162,6173,6218,6296,6307,6344,6409,6413`). Stale-edit regression passes. Atomicity assessed by inspection. |
| F02 — Raw/normalized/max consistency | CLOSED | Parser and save classify canonical `btvn_N_theory/practice` keys consistently (`sqlite.ts:5583,6014`); validation rejects invalid or contradictory raw scores and derives omitted raw values. Executed regressions assert specific errors and theory/practice 80/100 round trips (`test-report-card-v330.ts:483–531`). |
| F03 — Complete approval hash | CLOSED | Canonical payload includes assignment flags, task counts, raw/max/normalized scores, notes and totals (`sqlite.ts:5653–5735`). Metadata drift clears approval in the executed regression (`test-report-card-v330.ts:561–584`). |
| F04 — SAVING/FAILED drift handling | CLOSED | Sync-entry rejection maps existing SYNCING to FAILED (`sqlite.ts:6452–6457`); repair commits before the error is thrown (`:6490–6492`). New regression rereads WAITING_APPROVAL / FAILED / empty hash and successfully edits afterward (`test-report-card-v330.ts:637–667`). Verification-mismatch and FAILED-edit regressions also pass. |
| F05 — Mandatory approval version | CLOSED | Required signature and runtime missing/null/invalid/stale checks remain (`sqlite.ts:6328–6386`), with atomic approval update. Executed missing/stale regressions pass (`test-report-card-v330.ts:550–559`). |
| F06 — Decimal half-up rounding | CLOSED | Base-10 shifting remains (`report-card-calculator.ts:201–206`); executed RC-01 tie cases pass, including `4.015 → 4.02` and `80.3/100 → 4.02`. |
| F07 — Snapshot class identity | CLOSED | Conflicting classId/classCode are rejected before writes (`sqlite.ts:5815–5825`); both executed rejection regressions pass (`test-report-card-v330.ts:690–700`). |

The Round 3 F04 reproduction now reaches a durable, editable state rather than retaining the SYNCING lock. No genuine defect remains in the requested closure scope. This verdict covers Stage 1 only; no live LMS/Teaching acceptance or simultaneous multi-connection stress test was performed.

VERDICT: GO
