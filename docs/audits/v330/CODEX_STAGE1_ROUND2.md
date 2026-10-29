# v3.3.0 Phase 9 Stage 1 — Round 2 closure audit

Date: 2026-10-29. Scope: F01–F07 from `CODEX_STAGE1_AUDIT.md`, TASK-9.1/TASK-9.2, and RC-01–RC-03. Result: **5 CLOSED, 2 OPEN**.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit 0; executed unchanged. |
| `npx tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01, RC-02 and RC-03 all complete. |
| Additional runtime probes | 20 closure assertions PASS; separately reproduced the F02 and F04 residual defects below. |
| Production database SHA-256 before/after all runs | `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA` — exact match, unchanged. |
| Write restrictions | Only this report was written persistently. Source/test files and the three project tracking documents retain their initial SHA-256 values; production DB untouched. Test-created temporary databases were cleaned up. |

Inspected the calculator, repository section at `src/lib/db/sqlite.ts:5495–6563` (including the relocated approval/sync methods), and the complete regression script. Supplemental probes used an inline `npx.cmd tsx -e` harness with an in-memory wrapper around the suite's first snapshot save, running against the suite's own isolated database before its normal cleanup; no source/test file was edited. No live LMS/Teaching acceptance is claimed.

## Closure table

| Finding | Status | Evidence |
| --- | --- | --- |
| F01 — Atomic optimistic locking | CLOSED | Save, restore and approval now wrap read/check/write in SQLite transactions, use `WHERE classId = ? AND draftVersion = ?`, and check `changes === 1` (`sqlite.ts:5919,6160,6171,6216,6294,6305,6342,6407,6411`). Stale edit/restore/approval probes reject correctly. Atomicity verified by code inspection; no simultaneous multi-connection stress run. |
| F02 — Raw/normalized/max consistency | **OPEN (P1)** | BTVN key classification differs between validator/calculator and repository/parser. Valid raw-score updates are rejected, normalized-only updates change the raw scale, and existing overrides lose their maxima. Reproduced below. |
| F03 — Complete approval hash | CLOSED | Canonical hash includes assignment flags, task counts, raw/max/normalized scores, notes and computed totals (`sqlite.ts:5653–5735`). Runtime probes distinguish both assignment-flag changes and raw/max changes that preserve the normalized score; the suite confirms demotion after metadata drift. |
| F04 — SAVING/FAILED drift handling | **OPEN (P2)** | Edit/restore/rescrape/approval guards during SAVING and invalidation after FAILED are fixed. However, hash-mismatch invalidations in both sync methods are rolled back by their own thrown exceptions (`sqlite.ts:6435–6464,6489–6513`). |
| F05 — Mandatory approval version | CLOSED | Required signature plus runtime rejection of missing/null/invalid versions, stale-version check and atomic update (`sqlite.ts:6326–6429`). Suite and supplemental invalid-version probes pass. |
| F06 — Decimal half-up rounding | CLOSED | Base-10 shifting fixes the reported ties (`report-card-calculator.ts:196–207`). Executed suite verifies `4.015 → 4.02`, `2.005 → 2.01`, `1.005 → 1.01`, `3.555 → 3.56`, and `80.3/100 → 4.02`. |
| F07 — Snapshot class identity | CLOSED | Conflicting snapshot classId/classCode are rejected before any write (`sqlite.ts:5813–5823`). Supplemental probes confirm the stored snapshot remains unchanged after either rejection. |

## Remaining defects and reproduction

**F02 — BTVN scale handling is broken by an unreachable classifier.** Accepted field keys are `btvn_1_theory` / `btvn_1_practice` (`report-card-calculator.ts:258,523–524`), while `sqlite.ts:6012` matches `^btvn_s(\d+)_(theory|practice)$` and the parser at `:5583` tests `btvn_s`. Consequently every accepted BTVN field is treated as a stage field with maximum 5; the intended BTVN validation branch is unreachable.

Using a valid snapshot with a theory maximum of 100 and the current expectedVersion:

- `{ fieldKey: "btvn_1_theory", normScore: 4, rawScore: 80, maxScore: 100 }` returns `success:false`, with an error saying this is a stage field restricted to maximum 5. Expected: valid update.
- `{ fieldKey: "btvn_1_theory", normScore: 4 }` returns `success:true` but persists and displays raw `4`, maximum `5`. Expected: derive raw `80`, preserve maximum `100`.
- Parsing an existing canonical-key override `{ normScore:4, rawScore:80, maxScore:100 }` produces maximum `5` and drops rawScore (`sqlite.ts:5595–5618`), changing the effective raw report on read.

The negative-raw, contradictory-raw and null-normalized BTVN tests at `scripts/test-report-card-v330.ts:485–511` use the invalid key `btvn_s1_theory`. They pass at the field-key rejection gate (`sqlite.ts:6003`), without exercising raw/max validation. Align all key classifiers; test valid BTVN theory/practice updates on a non-5 scale and assert the specific rejection reason for invalid values.

**F04 — Error handling rolls back its intended state repair.** Both `markSyncingTeaching` and `markTeachingVerified` update the row to WAITING_APPROVAL/empty hash and then throw inside `db.transaction`. The installed `better-sqlite3/lib/methods/transaction.js` rolls back on that exception; a fresh repository read confirms the repair was not saved.

- Approve a valid report, call `markSyncingTeaching(classId, approvedHash)`, then call `markTeachingVerified(classId, "wrong-hash", {})` and catch the error. Actual persisted state: **SAVING / SYNCING with the approval hash retained**. Intended mismatch state: WAITING_APPROVAL / FAILED with an empty hash. Subsequent ordinary edits remain blocked by SAVING.
- From APPROVED, calling `markSyncingTeaching(classId, "wrong-hash")` likewise throws while retaining APPROVED and the existing hash.

Commit the invalidation before propagating the error (for example, return an error outcome from the transaction and throw after it commits). Add mismatch tests that catch the error and then reread the persisted state. Existing RC-03 exercises successful verification only.

Close F02 and F04, rerun the two required commands plus these boundary cases, and preserve the production database hash before accepting Stage 1.

VERDICT: NO-GO
