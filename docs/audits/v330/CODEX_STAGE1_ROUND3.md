# v3.3.0 Phase 9 Stage 1 — Round 3 closure audit

Date: 2026-10-29. Scope: remaining F02/F04 from Round 2 and closure recheck of F01–F07, TASK-9.1/TASK-9.2. Result: **6 CLOSED, 1 OPEN**.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit 0. |
| `npx tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01, RC-02 and RC-03 complete. |
| Independent boundary probes | F02 normalized-only theory/practice updates on an LMS maximum of 100 persist and compute as 80/100. F04 in-flight sync-entry mismatch still leaves editing blocked; reproduction below. |
| Production DB SHA-256 before/after all executions | `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA` — exact match, unchanged. |
| Write restrictions | Only this report written persistently. All files in `src/` and `scripts/`, the production DB and the three project tracking documents retain their initial SHA-256 values. Suite temporary databases cleaned up. |

Inspected `sqlite.ts:5569–6579`, the complete regression script and relevant calculator code. Supplemental probes used an inline `npx.cmd tsx -e` harness with an in-memory wrapper around the suite's first snapshot save, using separate fixture classes inside its isolated database. No source/test file was edited. No live LMS/Teaching acceptance or multi-connection stress test is claimed.

## Closure table

| Finding | Status | Closure evidence |
| --- | --- | --- |
| F01 — Atomic optimistic locking | CLOSED | Save, restore and approval retain transactional read/check/write, version-qualified updates and affected-row checks (`sqlite.ts:5919,6160,6171,6216,6294,6305,6342,6407,6411`). Stale-version regression checks pass. Atomicity assessed by inspection. |
| F02 — Raw/normalized/max consistency | CLOSED | Parser and repository now classify canonical `btvn_N_theory/practice` keys consistently (`:5583,6012`). Regression tests use valid keys and assert specific validation errors, plus explicit/derived 80/100 round trips (`test-report-card-v330.ts:483–531`). Independent normalized-only updates preserve the snapshot maximum of 100 for both kinds and compute raw 80. |
| F03 — Complete approval hash | CLOSED | Canonical payload retains assignment flags, task counts, raw/max/normalized scores, notes and computed totals (`sqlite.ts:5653–5735`). Metadata-drift demotion regression passes. |
| F04 — SAVING/FAILED drift handling | **OPEN (P2)** | Original Round 2 rollback defect is fixed: transactions return an error outcome and throw after committing (`:6484–6486,6542–6544`); persisted-state regression checks pass. However, sync-entry invalidation during an existing sync retains `SYNCING` and blocks recovery through ordinary edits. See below. |
| F05 — Mandatory approval version | CLOSED | Required signature, runtime missing/null/invalid version rejection, stale check and atomic update remain (`:6326–6429`). Missing/stale regression checks pass. |
| F06 — Decimal half-up rounding | CLOSED | Calculator `:201–206` and executed tie regressions confirm `4.015 → 4.02`, `2.005 → 2.01`, `1.005 → 1.01`, `3.555 → 3.56`, and `80.3/100 → 4.02`. |
| F07 — Snapshot class identity | CLOSED | Both classId and classCode conflicts are rejected before writes (`sqlite.ts:5813–5823`); both regression cases pass. |

## Remaining F04 boundary

**P2 — `markSyncingTeaching` can persist WAITING_APPROVAL / SYNCING with no approval hash.** Its rejection branch preserves every sync status except VERIFIED (`sqlite.ts:6450–6464`). A call while already SAVING therefore clears approval but retains the same `SYNCING` flag that all edit/restore/rescrape/approval guards reject (`:5829,5929,6226,6352`).

Executed reproduction on an isolated fixture class:

1. Save a valid snapshot and approve its current draftVersion.
2. Call `markSyncingTeaching(classId, approvedHash)` successfully.
3. Call `markSyncingTeaching(classId, "wrong-hash")` and catch its contentHash error.
4. Reread with `findOne`, then attempt a valid score update with the current draftVersion.

Observed persisted result:

```json
{"status":"WAITING_APPROVAL","syncStatus":"SYNCING","hash":"","editSuccess":false,"editConflict":true}
```

The current regression script covers sync-entry mismatch from APPROVED, and verification mismatch from SAVING, but misses sync-entry rejection from SAVING. Handle this transition without retaining an unusable sync lock: either reject re-entry while preserving the active approved operation, or durably invalidate into a recoverable non-SYNCING state. Add a reread-and-edit regression before closing F04. Stage 1 cannot yet confirm all seven findings CLOSED.

VERDICT: NO-GO
