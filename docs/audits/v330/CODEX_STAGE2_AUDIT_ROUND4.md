# Phase 9 v3.3.0 — Stage 2 closure audit, Round 4

Date: 2026-10-29. Scope: TASK-9.3, all nine original Stage 2 findings (`S2-01`..`S2-09`), and the Round 2 regression `R2-01`.

**Decision: GO for this Stage 2 closure gate. All 10 findings are CLOSED.** Both Round 3 blockers, S2-02 and S2-07, are now closed by source inspection and fresh execution of the former failing cases. All six verification commands exited 0. No remaining blocker was identified in the requested closure scope.

## Reviewed state and scope

Audited the existing working tree based on HEAD `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`, including the implementation and tests already modified or untracked before this audit. This verdict applies to the file fingerprints recorded below, not to HEAD alone.

Reviewed all eight requested files:

- `src/lib/playwright/scrape-scores.ts`
- `src/lib/db/sqlite.ts`
- `scripts/test-report-card-v330.ts`
- `docs/audits/v330/stage2/probe.ts`
- `docs/audits/v330/stage2-round2/probe.ts`
- `docs/audits/v330/stage2-round3/probe.ts`
- `scripts/test-phase4-codex-repros.ts`
- `docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND3.md`

Also consulted `PROJECT_STATE.md` first, then `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, the original Stage 2 audit, the Round 2 audit, and the applicable repository/team-workflow instructions. The Round 3 report remains an unchanged historical NO-GO record; the fresh Round 4 results supersede its closure status for these ten findings.

## Finding status table

| Finding | Original priority | Round 4 status | Source and fresh verification evidence |
| --- | --- | --- | --- |
| S2-01 | P1 | CLOSED | Capture tracks pending class/submission JSON tasks and checks class capture before persistence (`scrape-scores.ts:280`, `:512`, `:565`, `:591`). HTTP 500 preserves prior Robotics CP1=4 and makes zero grading-tab clicks; delayed Coding class JSON resolves to CP1=5; unfinished JSON returns failure. Round 2 probe also rejects GraphQL errors and missing class capture for both tracks without replacing prior snapshots. |
| S2-02 | P1 | CLOSED | Exact fresh-request membership is unconditional for both operations (`scrape-scores.ts:310`, `:387`); class/request identities are checked before accepting payloads. Foreign submissions and nameless foreign class payloads fail. Late stale submission score 99 cannot replace fresh 80 in the returned matrix, real SQLite cache, or report snapshot. An old class response before the first fresh request fails for Coding and Robotics and preserves CP1=4 in both stores. Both legacy mocks now emit request before response with the same object. See detailed closure below. |
| S2-03 | P1 | CLOSED | Snapshot and matrix writes share an outer transaction (`scrape-scores.ts:1361`, `:1387`); repository lock errors propagate (`sqlite.ts:5829`). A locked report card returns failure, retains CP1=4, and creates no new matrix. Round 2's injected second-write failure rolls back the already attempted snapshot write and draftVersion, retaining cached score 80 in real SQLite. |
| S2-04 | P1 | CLOSED | Every registered canonical candidate acquires a matching DOM fallback row (`scrape-scores.ts:1949` onward), regardless of the roster source. Extractor/calculator checks and the Round 2 full-worker case with successful CRM capture and no submission response retain practice=80 and Quiz/theory=90. |
| S2-05 | P1 | CLOSED | Both identity implementations prefer the verified CRM bridge before mutable display aliases (`scrape-scores.ts:994`, `:2003`). Crossed aliases preserve LOCAL_A=90 and LOCAL_B=20 in both the worker's matrix and report snapshot. |
| S2-06 | P1 | CLOSED | Matrix and snapshot roster reconciliation preserve stable CRM identities (`scrape-scores.ts:881` onward, `:2078` onward). Active CRM-only pupils without local/Denise records are included; two distinct CRM IDs sharing a name yield two matrix rows and two snapshot students in the Round 2 full-worker probe. |
| S2-07 | P2 | CLOSED | The checkpoint resolver receives trimmed original sourceTitle, never the generated display label (`scrape-scores.ts:1542`, `:1551`). Sole CP2 maps to CP2=4/3 with CP1 missing; reversed explicit checkpoint ordinals retain their own scores; opaque named checkpoints stay missing. Unnamed CHECKPOINT lessons at positions 5 and 9 leave CP1 and CP2 theory null in RC-04C; the Round 3 probe independently confirms the former fabricated CP1/CP2 assignment is gone. See detailed closure below. |
| S2-08 | P2 | CLOSED | Explicit completed zero DEMO grades are distinguishable from untouched defaults (`scrape-scores.ts:1858`). Five scored zeros with completion evidence produce numeric 0. Default zero templates remain null, including when an unrelated CONTENT comment is present. General feedback alone no longer establishes DEMO completion. |
| S2-09 | P2 | CLOSED | Checkpoint-session BTVN exclusion is independent of payload size for GraphQL and DOM metadata (`scrape-scores.ts:1572`, `:1618`). Round 2 covers [5], [9], and [5,9] from both sources: all are excluded by default and retained with explicit includeCheckpointSessionBtvn opt-in. |
| R2-01 | P2 | CLOSED | Raw DEMO question values are validated before numeric coercion (`scrape-scores.ts:1837`). The Round 3 probe checks empty/whitespace strings, null, undefined, true, and false with RATE=4: each remains missing. Explicit numeric 0 and string "0" remain numeric zero. |

## Round 3 blocker closure: S2-02

The `sawRequestEvents` variable and bypass have been removed. A fresh scan of `scrape-scores.ts` found no occurrence. The request listener is installed before drawer navigation; requests are registered only during the active capture window, and submissions only during GRADING_TAB (`:283`..`:294`, `:472`..`:473`).

The response guards now read:

```ts
if (opName === "GetClassById") {
  if (!freshClassByIdRequests.has(reqObj)) {
    return;
  }
  // ...
}

if (opName === "FindStudentSubmissionByClass") {
  if (capturePhase !== "GRADING_TAB") return;
  if (!freshSubmissionRequests.has(reqObj)) {
    return;
  }
  // ...
}
```

These are Set checks on the actual request object, with no response-only compatibility branch. Source inspection confirmed both relevant legacy harnesses in `scripts/test-phase4-codex-repros.ts` were adapted:

- General scraper mock (`:115`..`:136`): stores the request listener, calls `_reqFn(reqObj)`, then supplies `request: () => reqObj` to the response listener.
- Round 17 scraper mock (`:4458`..`:4504`): registers `requestListener1703`, calls it with `req1703`, then supplies `request: () => req1703` to `responseListener1703`.

Fresh regression evidence:

| Event order | Expected and observed result |
| --- | --- |
| Fresh class identity, fresh submission score 80, late old submission score 99 without its request event | Success with 80 retained in returned matrix, SQLite matrix cache, and persisted report-card snapshot; RC-04C S2-02c and Round 2 probe pass. |
| Old GetClassById response before any new request event, then fresh Coding submission traffic | Failure; CP1=4 retained in real SQLite report card and cached snapshot; Round 3 probe passes. |
| Old GetClassById response with no fresh request events at all, Robotics | Failure; CP1=4 retained in both real SQLite stores; Round 3 probe passes. |

RC-04C also contains the before-first-request cases for both tracks (`test-report-card-v330.ts:1906`). The successful full Phase 4 compatibility suite confirms that updating the legacy request lifecycles did not break that suite.

## Round 3 blocker closure: S2-07

The extraction loop now separates source identity from a generated display label:

```ts
const sourceTitle = String(lesson.name || lesson.title || "").trim();
const rawTitle = sourceTitle || `Buổi ${idx + 1}`;
// ...
const stage = resolveCheckpointLessonStage({
  id: lessonId,
  title: sourceTitle,
  displayOrder:
    typeof lesson.displayOrder === "number" && Number.isFinite(lesson.displayOrder)
      ? lesson.displayOrder
      : undefined,
});
```

The sole resolver call is at `scrape-scores.ts:1551`. It receives `sourceTitle`; the generated `rawTitle` is not supplied. The resolver at `:211` uses source title/ID evidence and returns null when it cannot resolve a stage; it has no array-index or displayOrder-range inference.

Fresh RC-04C S2-07d cases (`test-report-card-v330.ts:2015`) supply four/eight ordinary lessons followed by an opaque, unnamed CHECKPOINT with Quiz=80 and practice=60. For both positions 5 and 9, CP1 theory and CP2 theory are null. The Round 3 probe (`stage2-round3/probe.ts:110`) independently confirms the corresponding CP1/CP2 theory remains null. The sole-CP2, unidentified named checkpoint, and reversed explicit ordinal fixtures also pass. The former generated-Buổi route to checkpoint identity is closed.

## Fresh verification commands

Executed from `D:\MY PROJECT\MINDX_AUTOMATION` using installed dependencies, Node `v24.15.0`, and the Windows `npx.cmd --no-install` launcher. Every invocation, including TypeScript, received explicit isolated `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` values before process startup. Each command had its own subdirectory, so runs did not share a database or cache.

| Command | Exit | Result | Elapsed seconds |
| --- | --- | --- | --- |
| `npx.cmd --no-install tsc --noEmit --incremental false` | 0 | PASS; no compiler diagnostics | 1.38 |
| `npx.cmd --no-install tsx scripts/test-report-card-v330.ts` | 0 | PASS; RC-01, RC-02, RC-03 and RC-04, including RC-04C and both new Round 3 closure cases | 1.49 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2/probe.ts` | 0 | PASS; 11 observation records, all CLOSED | 1.06 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2-round2/probe.ts` | 0 | PASS; 10 observation records, all CLOSED; real SQLite rollback and both-output worker checks included | 0.98 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2-round3/probe.ts` | 0 | PASS; 6 observation records, all CLOSED; both prior blockers and DEMO validation checked | 0.99 |
| `npx.cmd --no-install tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS; existing compatibility assertions through Round 17 | 2.85 |

Observation records are not assertion counts or additional distinct findings. The Round 2/3 probe header comments still describe the old defect-observation purpose; the current assertion bodies were inspected and now assert closure expectations. In particular, Round 3 asserts failure and CP1 preservation for stale responses, and null checkpoint scores for unnamed lessons. GO is based on those expectations and source inspection, not just exit codes or printed CLOSED labels.

`stripTypeScriptTypes` experimental warnings and the Phase 4 suite's deliberately injected network-failure messages appeared; the asserted outcomes completed successfully. No failed test command was omitted.

## Isolation, integrity, and cleanup

Run root, now deleted:

`D:\MY PROJECT\MINDX_AUTOMATION\data\_temp_stage2_round4_75800ed852db4fedb983d86a6c1819b7`

For each subdirectory `tsc`, `rc330`, `stage2`, `round2`, `round3`, and `phase4`, the launcher supplied `MINDX_DB_PATH=<root>\<subdirectory>\audit.db` and `MINDX_RUNNING_CLASSES_PATH=<root>\<subdirectory>\running_classes.json`. CI mode and telemetry suppression were also set. The RC suite and original Stage 2 probe subsequently replace the DB override with their own disposable workspace DB and remove those directories in their cleanup. Repository path validation permits the workspace isolation paths.

Before execution, fingerprinted every file under `src/` and `scripts/`, both protected production files, the three requested probes, and the Round 3 report: **118 files total**. After all six commands, every file had the same SHA-256, byte length, and LastWriteTimeUtc; the file count was still 118. A final check after report/tracker updates reconfirmed this result.

| Protected production file | Before and after SHA-256 | Bytes | Unchanged LastWriteTimeUtc |
| --- | --- | --- | --- |
| `data/mindx_bot.db` | `D6A90B5B0795A3DBC0FABFCCAFBCA423E17D4CD5157605CC09A68D24D5F85A40` | 417792 | `2026-10-29T02:51:04.3378692Z` |
| `data/running_classes.json` | `614F2CA361B5FE238A3F4BF067945C0F734AEF5524A295A1217688999A6C3581` | 1879 | `2026-10-28T12:44:41.1214243Z` |

These are this audit's live before/after baselines. The older Round 3 production DB hash is historical and was not used as a substitute for the current baseline.

Reviewed-file fingerprints, unchanged by this audit:

| File | SHA-256 |
| --- | --- |
| `src/lib/playwright/scrape-scores.ts` | `B98B2152FB488E569E38D3DE5F47D7F8EB5C60171D76E5C0C3E9431AFA7B78F6` |
| `src/lib/db/sqlite.ts` | `E7B0CAD9127BC7C3AB5A4EEB4AE871D70E206CC333C1C2164F25DD3880239A4C` |
| `scripts/test-report-card-v330.ts` | `A91007700612FB09C3FE2D434697A8B0744BE999B80CD0E7FFECF9B5CD2102AC` |
| `docs/audits/v330/stage2/probe.ts` | `FEEA493A2C2CA8E32B2FF93593BED258FD0AA3A4F1C70F6B7180069B8F368273` |
| `docs/audits/v330/stage2-round2/probe.ts` | `EC33088C0D3F5EB3BE32CBF630CCD0E565CF4581F34774D59BC02C48E1549B94` |
| `docs/audits/v330/stage2-round3/probe.ts` | `DED1ACECB3C1B8B0DE2FE81813DED936C4E0EF4955F30E98E78DEE2B92BBCE12` |
| `scripts/test-phase4-codex-repros.ts` | `ED31335FB5F17D154A02F3829833C3976CBCC7BC1F0D8E5D1F1AFC59A30146B2` |
| `docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND3.md` | `1D47D863651F7ABE420B86877A1E333755561A53F553F8335DD35727BBA0C021` |

The supplied probes write observation JSON to fixed historical audit paths. Their fresh output was inspected and summarized here; the prior JSON contents were then restored from temporary backups to preserve the existing evidence. All audit-created temporary databases, caches, logs, backups, and directories were removed. Cleanup used individually checked file deletions followed by removal of empty directories, and absence of the audit root was verified. The two suites' own disposable directories were also absent after execution.

Persistent changes from this audit are limited to this report and the required appended Round 4 entries in `PROJECT_STATE.md`, `CHANGELOG.md`, and `MINDX_AUTOMATION_PLAN.md`. No source, scripts, probe source, or production data was modified.

## Acceptance boundary

This closes the requested Stage 2 findings for TASK-9.3. Browser events are simulated; persistence failure paths use real isolated SQLite. No live LMS/Teaching navigation or writes were performed. This report does not certify production operation, re-accept all Stage 1 findings, or accept later Phase 9 tasks/RC-05/RC-06 or a full application build.

The team-workflow skill's designated `claude-sonnet-5-5-high` reviewer is unavailable in the exposed tools/models. This is the direct independent Codex closure audit requested by the user; no Claude review is claimed.

VERDICT: GO
