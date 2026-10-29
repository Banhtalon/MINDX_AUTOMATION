# Phase 9 v3.3.0 — Stage 2 independent milestone audit

Date: 2026-10-29. Scope: TASK-9.3; `scrape-scores.ts`, calculator integration, snapshot persistence integration, and RC-04. Reviewed the working tree based on HEAD `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`, including its existing uncommitted implementation. Application and existing test source were not changed by this audit.

**Decision: NO-GO.** Nine findings remain open: six P1 and three P2. Successful fixture and compatibility tests do not cover the failure paths below.

## Verification

| Check | Result |
| --- | --- |
| `npx.cmd --no-install tsc --noEmit --incremental false` | PASS, exit 0, including the added audit harness |
| `npx.cmd --no-install tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01, RC-02, RC-03, RC-04 |
| `npx.cmd --no-install tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0; existing VM compatibility suite through Round 17 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2/probe.ts` | Exit 0; 11 defect observations reproduced for nine findings. Assertions deliberately confirm current defects, not acceptance. |

All SQLite executions used disposable `MINDX_DB_PATH` values. The Phase 4 command also used an isolated `MINDX_RUNNING_CLASSES_PATH`. The RC suite installs its own temporary DB override before opening SQLite. The independent harness sets its override before dynamically importing SQLite, uses the real repositories for S2-01/S2-03, and deletes its own temporary DB after closing it. Browser behavior is simulated; no live LMS navigation or writes occurred.

Production `data/mindx_bot.db` SHA-256 before and after:

`93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`

Evidence: [reproducible probe](stage2/probe.ts), [observed values](stage2/observations.json). Synthetic identities are used in the independent probes. The existing RC-04 optional captured VT-JSB16 fixture was present, so its conditional assertions also ran.

## Numbered findings

### 1. S2-01 — P1: Missing or unfinished GetClassById data overwrites valid scores

Locations: `src/lib/playwright/scrape-scores.ts:254-258`, `370-372`, `406-416`, `462-476`, `1705-1713`, `1069`; `src/lib/db/sqlite.ts:5865-5896`.

`GetClassById` HTTP/GraphQL failures are silently ignored. Robotics waits briefly but does not require a successful class response. Its snapshot extractor can manufacture a nonempty roster entirely from `existingStudents`, producing empty scores; the three fixed Robotics columns make the subsequent completeness checks pass. `saveLmsSnapshot` then replaces the previous good snapshot.

Coding waits only for submissions, not the class response/body. An async response callback can still be inside `res.json()` when the submission response is ready; the listener is removed without awaiting pending work, and the snapshot is computed without its CP/Final data.

Reproduced: a Robotics HTTP 500 returned `success: true` and changed persisted CP1 from `4` to `null` in a real temporary SQLite DB. A separate delayed HTTP 200 class body containing CP1=`5` was not awaited; Coding returned success with CP1=`null`.

Required correction: await the exact successful class response and its parsed body for both tracks, distinguish a failed fetch from a genuinely empty score, and preserve prior snapshots when mandatory capture is unavailable. Add full scraper tests for HTTP errors, GraphQL errors, delayed JSON, and timeouts.

### 2. S2-02 — P1: Response capture accepts another class's data

Locations: `src/lib/playwright/scrape-scores.ts:248-274`, `285-319`, especially `302-306`.

The submission identity predicate accepts any 24-character hexadecimal request class ID when the drawer text is verified and the payload omits a class code. It does so even when a successful `GetClassById` has already established a different authoritative `lmsClassId`. The accepted foreign request also replaces that authoritative ID. `GetClassById` itself accepts payloads with no name/code without validating `variables.id` or requiring equality with a known class ID.

Reproduced: class ID `aaaaaaaaaaaaaaaaaaaaaaaa` was verified, but submissions requested for `bbbbbbbbbbbbbbbbbbbbbbbb` were accepted and cached with score `99`. Separately, a no-code class payload with the foreign ID supplied Robotics CP1=`5` and returned success.

The listener also has no request-start boundary or exact initiating-request binding, so late responses from preceding UI work can enter this path. The permissive submission fallback existed in HEAD; Stage 2 retains it despite now capturing an authoritative class ID and adds the weak class-payload acceptance path.

Required correction: bind each capture to the fresh request issued by the relevant drawer/tab action, verify request class ID and response class identity consistently, reject conflicting IDs, and do not accept an unknown ID merely because the drawer title matches.

### 3. S2-03 — P1: Snapshot persistence failures are swallowed after matrix persistence

Locations: `src/lib/playwright/scrape-scores.ts:1048-1070`; `src/lib/db/sqlite.ts:5830-5835`.

The matrix is committed first. Every error from the report-card save is caught by an empty catch, after which the scraper logs success and returns the new snapshot. This includes the repository's deliberate `SAVING`/`SYNCING` lock rejection and ordinary DB failures. The returned result, score cache, and report-card record can disagree without any user-visible error.

Reproduced with the real temporary repositories: a locked report card retained CP1=`4`; the matrix cache stored CP1=`2`; the scraper still returned `success: true`.

Required correction: make both required writes atomic, or explicitly expose/report a failed report-card update and preserve consistent caches. Do not suppress repository errors. Cover the caller/repository integration, not only direct repository rejection.

### 4. S2-04 — P1: DOM fallback loses BTVN when a CRM roster was captured

Locations: `src/lib/playwright/scrape-scores.ts:1658-1684`, `1685-1703`, `1829-1861`.

When submissions are unavailable but `GetClassById` supplies a roster, the CRM candidate branch wins over the fallback-matrix branch. CRM candidates never receive `fallbackRow`; only the later, mutually exclusive fallback branch attaches it. BTVN session columns survive, but the actual DOM scores do not reach the snapshot or calculator.

Reproduced: a fallback row with practice=`80` and Quiz=`90`, plus a valid CRM roster and SQLite identity, produced `practiceRaw: null` in the computed report card.

Required correction: attach DOM rows to canonical candidates by verified identity regardless of which source created the candidate. Test the mixed case of successful class capture and missing submission capture.

### 5. S2-05 — P1: Mutable displayName can override the verified CRM identity

Locations: `src/lib/playwright/scrape-scores.ts:708-730`, `1581-1599`.

After direct local-ID matching, both identity implementations try normalized `displayName` before using the canonical name obtained through the CRM ID. A display name that matches another pupil's unique local name can therefore select the wrong SQLite record even though the CRM bridge identifies the correct person. With two crossed aliases, both mapped IDs remain unique, so the matrix duplicate guard does not detect the swap.

Reproduced: CRM_A's practice=`90` and CRM_B's practice=`20` were assigned to the opposite local pupils. LOCAL_A received `20`.

Required correction: prefer the verified CRM-ID-to-canonical-person bridge over mutable display names; reject conflicting identity evidence. Use the same reconciliation logic for the matrix and report snapshot. Add collision cases alongside the existing shortened-name happy path.

### 6. S2-06 — P1: Active CRM pupils can be omitted by roster reconciliation

Locations: `src/lib/playwright/scrape-scores.ts:633-677`, `695`, `1624-1646`.

The returned Coding matrix supplements submission students from SQLite only; a newly present active CRM student without a Denise account and without a local record is absent from matrix rows, although the report snapshot may include them. More seriously, the snapshot append loop skips a distinct CRM identity whenever its normalized name has already been seen. Two different pupils with the same full name are silently collapsed when one has no submission account. A name is not a safe deduplication key for a known distinct CRM ID.

Reproduced: two active CRM identities yielded one matrix row and two snapshot students. In a separate same-name case, the snapshot itself retained only one of the two distinct CRM IDs.

Required correction: build one canonical roster keyed by stable identity, preserve distinct CRM IDs even when names coincide, and ensure both outputs contain all required active students. If local mapping is ambiguous, report it explicitly rather than dropping the pupil.

### 7. S2-07 — P2: Checkpoint fallback uses list position instead of checkpoint identity

Locations: `src/lib/playwright/scrape-scores.ts:1209-1214`, `1876-1885`.

Fallback CP1 always uses `checkpointLessons[0]`, and CP2 always uses `[1]`. A payload containing only Checkpoint 2, or reversed display ordering, assigns grades to the wrong checkpoint rather than recognizing its session/ordinal.

Reproduced: a sole `Checkpoint 2` lesson with Quiz=`80` and practice=`60` populated CP1 theory=`4`, practice=`3`; CP2 remained null.

Required correction: resolve CP1/CP2 explicitly from validated lesson/session identity. Leave an unavailable checkpoint missing; do not infer its identity from array position. Test sole-CP2 and reordered lessons.

### 8. S2-08 — P2: All-zero DEMO scores become missing

Locations: `src/lib/playwright/scrape-scores.ts:1485-1493`.

After collecting finite nonnegative demo-question scores, the parser requires at least one positive value before summing them. An explicitly scored all-zero demo cannot be represented through this path and becomes `null` unless another source supplies a score. Zero and missing data must remain distinguishable.

Reproduced: five explicit zero demo-question scores with a nonzero RATE area produced `finalProduct: null`.

Required correction: distinguish ungraded default fields from completed all-zero grading using reliable completion evidence, and preserve zero for a completed demo. Test both ungraded defaults and completed zero scores.

### 9. S2-09 — P2: Checkpoint homework exclusion changes with payload size

Locations: `src/lib/playwright/scrape-scores.ts:1223-1228`, `1270-1273`.

The default exclusion of sessions 5/9 is conditional on there being more than two lessons/columns. Small Coding payloads therefore include checkpoint-session homework in BTVN even though the requested exclusion has no such exception. The same defect exists in the DOM metadata fallback.

Reproduced: one `Homework 5` lesson appeared in `btvnSessions` with default options.

Required correction: enforce the checkpoint-session exclusion independently of lesson count, while retaining only any deliberately requested explicit opt-in behavior. Add one- and two-column cases for both sources.

## Confirmed behavior and limits

The existing fixtures confirm Coding single/dual marked-practice averaging, ignoring unmarked task 2, the seven-session happy path, canonical shortened-name bridging, an already-synced pupil without a Denise account, CP RATE averaging excluding the zero survey, local/LMS Final merging, and the calculator's Robotics BTVN hiding. The independent scraper probe additionally confirms Robotics makes zero grading-tab clicks.

RC-04 calls `extractReportCardSnapshotFromGql` and the calculator directly. It does not call `scrapeClassScores` or exercise its snapshot persistence integration; thus its Robotics fixture cannot certify actual tab handling, response races, network failures, or swallowed persistence errors. Extend RC-04 with scraper-level scenarios and real temporary SQLite integration for these findings.

Compatibility naming clarification: both HEAD and the reviewed tree expose `scoreMatrixRepo.save` and `Promise<ClassScoreMatrixResult>`. Neither contains `scoreMatrixRepo.upsert` or `ScoreMatrixPayload`. The existing API and VM suite pass; the literally named `upsert` contract in the request cannot be certified because that API is absent in the baseline too.

This audit does not re-accept all Stage 1 findings, test live LMS availability, or certify Phase 9 stages beyond TASK-9.3. The requested named Claude reviewer model is not available in this environment; this is the direct independent Codex audit requested by the user.

Acceptance requires closing the nine findings and rerunning the isolated RC suite, scraper-level regressions, VM suite, and TypeScript check. No application fixes were made.

VERDICT: NO-GO
