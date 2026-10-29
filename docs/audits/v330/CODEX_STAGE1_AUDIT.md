# v3.3.0 Phase 9 Stage 1 audit

Date: 2026-10-29. Scope: TASK-9.1, TASK-9.2 and RC-01..RC-03. Independent audit; no changes to `src/`, `scripts/` or the production database.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit --incremental false` | Shell exit 1: `npx` unavailable to this session; compiler did not launch through this command. |
| Installed native TypeScript compiler, `node_modules/@typescript/typescript-win32-x64/lib/tsc.exe --noEmit --incremental false` | PASS, exit 0. Verified that the installed TypeScript launcher delegates to this executable. |
| `npx tsx scripts/test-report-card-v330.ts` | Shell exit 1: `npx` unavailable; full suite and SQLite RC-03 NOT EXECUTED. Node/npx paths under the user's Local Programs directory are inaccessible in this sandbox. |
| Extracted RC-01 and RC-02 calculation blocks | 139 assertions PASS in the tool JavaScript isolate, using the actual calculator bundled by the installed esbuild. Only TypeScript annotations were removed. This is partial validation, not a successful run of the requested Node suite. |
| Independent boundary probes | Confirmed rounding error, contradictory raw/normalized scores, and hash omissions below. |
| Production database SHA-256 | Unchanged before/after audit: `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`. |

The normal CP1/CP2/Final weighting, rounded-stage TBCK, missing/zero component ranking, Robotics BTVN hiding and existing chart expectations pass the extracted mathematical cases. RC-03's database isolation is established by code inspection only: `MINDX_DB_PATH` is assigned before lazy `getDb()` opens the database. No claim of an executed SQLite integration test is made.

## Findings

1. **F01 — P1: Optimistic locking is not atomic.** `src/lib/db/sqlite.ts:5813`, `:5829`, `:5940-5955`; also restore at `:5999`, `:6046-6061` and approval at `:6083`, `:6111-6117`. Version checks read a row separately from an unconditional `UPDATE ... WHERE classId = ?`; these methods lack a transaction covering the read/check/write or a version predicate on the update. Two database connections can both read version N, both pass, then overwrite one another's complete overrides JSON while both report success. Approval can similarly commit a hash computed before a concurrent edit. Use an atomic compare-and-swap with an affected-row check, or an appropriate write transaction. This is a statically established interleaving; a multi-connection runtime reproduction could not run without Node.

2. **F02 — P1: Raw-score validation permits contradictory grades.** `src/lib/db/sqlite.ts:5887-5917`; consumed at `src/lib/report-card/report-card-calculator.ts:527-538` and `:551-565`. Only `normScore` is range-validated. A BTVN update with `normScore: 5, rawScore: -10, maxScore: 100` passes the save checks and the actual calculator displays raw `-10` alongside normalized `5`. Positive out-of-range or inconsistent raw scores are likewise accepted; invalid maxima are silently discarded. Validate finite values, `0 <= rawScore <= maxScore`, and consistency with the normalized value, or derive one representation from the other.

3. **F03 — P1: Content hash misses changes to the approved BTVN report.** `src/lib/db/sqlite.ts:5627-5645`. The canonical payload includes session numbers and normalized cells but omits `hasTheory`, `hasPractice`, raw scores and maxima. With a single theory submission and no practice submission, changing that session's `hasTheory` from true to false changes assigned items from 2 to 1 and the BTVN average from `4.01` to null, while the actual canonical hash payload remains byte-identical. `saveLmsSnapshot` therefore retains APPROVED/VERIFIED. A raw/max change preserving the normalized score is also invisible. Hash the report's relevant metadata and score representations, or its complete effective approved payload.

4. **F04 — P2: Drift handling skips SAVING and FAILED states.** `src/lib/db/sqlite.ts:5751`, `:5929`, `:6034`; verification mismatch at `:6175-6177`. After approval and `markSyncingTeaching`, a score save, restore or rescrape can change the approved content but retain SAVING/SYNCING and the old approval hash. A failed sync also retains its approval hash across subsequent edits. The verification hash check does reject changed scores, but only throws; it does not repair the state. Reject edits while saving or invalidate any existing approval hash on effective changes and consistently mark the report as needing approval/out of sync.

5. **F05 — P2: Approval accepts an omitted expectedVersion.** `src/lib/db/sqlite.ts:6083-6086`. `approveReportCard(classId)` and a runtime null version bypass the version guard, approving the latest draft even if the teacher reviewed an older one. Require a valid expected version for approval and protect its write atomically, just as score edits require a version.

6. **F06 — P2: round2 is not reliably decimal half-up.** `src/lib/report-card/report-card-calculator.ts:199-201`, `:224-226`. Executing the actual function gives `round2(4.015) === 4.01` and `normalizeScoreToScale5(80.30, 100) === 4.01`; the declared half-up rule requires `4.02`. Adding one Number.EPSILON does not resolve floating-point ties at this magnitude. Use a decimal-safe rounding strategy and add boundary tests.

7. **F07 — P2: Snapshot class identity can be silently reassigned.** `src/lib/db/sqlite.ts:5710`, `:5723-5727`. `saveLmsSnapshot('CLASS_A', snapshotForClassB)` replaces the snapshot's classId with CLASS_A without rejecting the mismatch, while retaining class B's code, students and grades. Those student IDs then enter the accepted override roster at `:5848-5854`. Validate class identity before saving so a mixed-up response cannot replace another class's report.

The existing tests do not exercise these boundaries: concurrent writers, raw/max inconsistencies, metadata/raw hash drift, edits during SAVING/FAILED, missing approval versions, rounding ties or mismatched snapshot identities. Add isolated regression cases for the findings before repeating the complete required suite.

## Exit criteria

Resolve the findings, rerun both requested commands successfully in an environment with accessible Node/npx, and recheck the production database hash. Only audit documentation and the three required project tracking documents were updated during this review.

VERDICT: NO-GO
