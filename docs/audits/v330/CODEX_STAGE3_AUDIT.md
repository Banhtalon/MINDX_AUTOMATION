# v3.3.0 Phase 9 — Independent Stage 3 Audit (TASK-9.4)

> **Current closure status — Round 2, 2026-10-29: VERDICT: NO-GO.** Four findings CLOSED (`S3-02`, `S3-05`, `S3-06`, `S3-09` for the audited sync path); five PARTIALLY FIXED / OPEN (`S3-01`, `S3-03`, `S3-04`, `S3-07`, `S3-08`). All four requested commands pass and the current original probe has 40 PASS observations. The supplemental probe records 55 CLOSED and 17 OPEN observations across 72 records. Remaining boundaries include explicit-ID tone fallback, one-cent normalized mismatches, permissive acknowledgments, conflicting score payloads, and response-body cancellation. See [Round 2 closure report](CODEX_STAGE3_ROUND2.md) and [new evidence](stage3-round2/). The original findings/results below are historical and preserved.

Date: 2026-10-29 (Asia/Saigon). Auditor: Codex, acting as the requested independent code auditor. Baseline HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`; the working tree already contained uncommitted Phase 9 work. This audit covers those working files, not HEAD alone. The Claude reviewer named in the project workflow is unavailable in this environment; no Claude review is claimed.

**VERDICT: NO-GO.** Nine findings: **0 CRITICAL, 5 HIGH, 3 MEDIUM, 1 LOW**. The principal blockers are demonstrated writes to the wrong student, writes to inactive pupils, false VERIFIED results, failed prerequisite reads treated as empty exercise lists, and remote mutations after Stop. Passing the supplied suites does not cover these cases.

## Scope and method

Reviewed the complete Teaching sync service and live HTTP transport, both report-card route files, RC-05 and its RC-01..RC-04 compatibility, the report-card repository/hash/state transitions, calculator, sequential queue, local request guard, and scraper persistence integration. Read `PROJECT_STATE.md` first, then the relevant plan/changelog and project workflow. Consulted the installed Next route-handler documentation before adding the independent probe.

No application code or existing test scripts were edited. Added the report and independent evidence under `docs/audits/v330/stage3/`, and updated the three required project tracking documents. No live LMS/Teaching requests or writes were made. Network calls in the independent probe are intercepted, and unexpected network access fails the probe. Live transport cases use synthetic credentials; production `.env` files were not copied into the isolated workspace.

Several names in the request differ from this implementation:

| Requested concept | Actual code reviewed |
| --- | --- |
| `browserTaskQueue` / queue bypass | `taskQueue`, a `SequentialTaskQueue` singleton; service always enqueues, with no bypass option |
| `expectedDraftVersion` | `expectedVersion` in service options and API bodies; database column is `draftVersion` |
| `markSyncedTeaching` / `markFailedTeaching` | `markTeachingVerified` / `markTeachingSyncFailed` |
| `ScoreScraper.scrapeClassReportCard` | `scrapeClassScores`, which also extracts and atomically persists the report-card snapshot |
| `buildRequiredExerciseDeclarations` | Inline declaration and required-exercise logic, `teaching-report-card-sync.ts:846-989` |
| `buildExpectedTeachingScores` | Inline score construction/null tracking, `teaching-report-card-sync.ts:992-1156` |
| `verifyRemoteTeachingScores` | Inline readback verification, `teaching-report-card-sync.ts:1177-1267` |
| `ReportCardVersionConflictError` | No such class in this implementation; repository result objects carry `conflict` and routes translate that to HTTP 409 |

These naming differences alone are not counted as findings. The requested PUT action contract is separately assessed in S3-07 because it changes observable operations.

## Verification and evidence

| Command/check | Result |
| --- | --- |
| `npx.cmd tsc --noEmit --incremental false` | PASS, exit 0 on the original workspace. Repeated after adding/type-correcting the independent probe; final run PASS. |
| `npx.cmd tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01, RC-02, RC-03, RC-04 including Stage 2 regressions, and RC-05. Executed from an isolated TEMP mirror with unchanged source/script bytes. |
| `npx.cmd tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0. Expected injected network-error messages occur in negative cases. Executed from the same TEMP mirror with a separate disposable DB/cache. |
| `npx.cmd tsx docs/audits/v330/stage3/adversarial-probe.ts` | PASS, exit 0; **40 observation records: 29 BUG_REPRODUCED observations grouped into the 9 findings below, and 11 PASS control records.** These are observation counts, not assertion counts or 29 separate bugs. |
| Production DB/cache and original source/script preservation | All **117 pre-existing protected files** retain their SHA-256, length and last-write timestamp. Includes `data/mindx_bot.db`, `data/running_classes.json`, `src/` and `scripts/`. See `preservation.json`. |

Artifacts: [probe](stage3/adversarial-probe.ts), [observations](stage3/observations.json), [probe log](stage3/probe.log), [report-card suite log](stage3/report-card.log), [Phase 4 log](stage3/phase4.log), [final TypeScript result](stage3/verification.json), [preservation evidence](stage3/preservation.json).

Isolation matters: the supplied RC script unconditionally replaces `MINDX_DB_PATH` with `process.cwd()/data/_temp_test_rc_v330_...` at `scripts/test-report-card-v330.ts:19-22`. An environment override alone would not keep that test database under TEMP. Therefore the unchanged script was run with **both its copied location and working directory beneath TEMP**. All audit command environments set `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` to TEMP paths; the RC script's replacement path also remained beneath TEMP. The mirror contains copied `src/`, `scripts/`, configuration JSON and package/TypeScript files, plus a junction to installed dependencies. Production DB/cache and credentials were not copied.

## Findings

### S3-01 — HIGH: Bare numeric local IDs override safer name matching and can write to a different pupil

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:268-295`, specifically the bare numeric ID at 270-275 and accent-insensitive name check at 283-285. Subsequent ambiguity guards at 298-315 are bypassed by the early `continue`.

**Reproduction:** Use a local student `{studentId: "101", fullName: "Nguyễn Văn An"}`. Teaching returns active student #101 **Nguyễn Văn Ân** and #102 **Nguyễn Văn An**. The matcher chooses #101 before consulting the exact tone-preserving match for #102. A numeric LMS/CRM ID is not proof of a Teaching ID binding. The same branch silently accepts #101 when Teaching contains two identical names, instead of rejecting ambiguity.

**Observed:** `S3-01-accent-collision` returns the wrong-name mapping. `S3-01-duplicate-bypass` accepts an ambiguous roster. In `S3-01-end-to-end`, the real service writes every score to #101 and the real isolated SQLite row becomes **VERIFIED**, although #102 is the exact-name match.

**Required correction:** Distinguish source-system IDs from explicitly trusted Teaching bindings. Do not infer Teaching identity from an arbitrary numeric `studentId`. Validate binding/name consistency without discarding Vietnamese tones when a contradictory exact match exists. Fail before any remote mutation on unresolved ambiguity; add both matcher and whole-sync regressions.

### S3-02 — HIGH: Inactive students are preferred less often, but are not excluded

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:123-129`, `:283-285`, `:305-310`, `:337-342`.

**Reproduction:** An active local student has only a same-name remote entry with status `inactive`, `dropped`, or `nghỉ học`. `effectiveToneCandidates` falls back to **all** candidates when the active subset is empty, selecting the inactive entry. The explicit-ID branch ignores inactivity altogether. Separately, `nghi_hoc` is not recognized by the status regex, so an inactive and active same-name pair becomes a false ambiguity.

**Observed:** All four statuses are matched in `S3-02-*`. The `S3-02-end-to-end` case writes 9 scores to an inactive remote student and marks **VERIFIED**. The ASCII-status case throws duplicate-name ambiguity instead of filtering `nghi_hoc` and selecting the active entry.

**Required correction:** Normalize the actual status vocabulary, including machine values such as `nghi_hoc`, before matching. Exclude inactive candidates from all branches for active-pupil sync, including explicit IDs. If only inactive candidates exist, return a roster mismatch for teacher review. Any deliberate historical-pupil policy should be explicit and separately approved/tested.

### S3-03 — HIGH: Readback can mark VERIFIED without verifying normalized scores or normalized stale-null slots

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:1236-1253` and `:1256-1266`.

**Reproduction A:** Return the exact pushed raw scores but set `normalized_score` to missing, null, `""`, whitespace or `[]`. The guard checks the field's presence/string representation before parsing, so these representations skip the numeric comparison. In particular, `String([]) === ""` bypasses the check even though `parseStrictFiniteScore([])` correctly rejects arrays.

**Reproduction B:** For a local expected-null BTVN practice slot, return a Teaching row with `raw_score: null, normalized_score: 5`. Null-slot verification inspects only `raw_score`.

**Observed:** All six variants finish **success=true / VERIFIED** (`S3-03-normalized-*`, `S3-03-null-slot-normalized`). Controls show that a present wrong numeric normalized score, a wrong raw score, and stale numeric raw scores do fail correctly; the gap is specifically the omitted validation paths.

**Required correction:** Require and strictly parse the authoritative normalized value for every pushed score, and compare it against the expected scale-5 value. If the remote contract legitimately omits it, obtain independent authoritative normalization evidence rather than silently skipping verification. Expected-null verification must reject numeric values in either representation. Keep malformed representations distinct from a legitimate empty score.

### S3-04 — HIGH: Live protocol validation treats failed exercise reads as a valid empty list

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:393-444` (login), `:521-539` (array coercion), `:846-848` (prerequisite read), and declaration writes starting at `:869`.

**Reproduction:** Intercept the actual live transport's first `get_class_exercises` response as HTTP 200 with `{success: false, message: "Audit read denied"}`. `getExercises` returns `[]` for every non-array JSON payload; the service interprets the failed read as “all exercises missing” and performs writes. In the same deterministic transport test, both login GET and POST return HTTP 503 with a session cookie; login status is never checked and the cookie is accepted as sufficient session evidence.

**Observed:** `S3-04-live-protocol` issues three Robotics `add_multi_exercise` writes after the error-shaped prerequisite response, then saves scores and reaches **VERIFIED** once the stub serves successful later responses. Both 503 login responses were ignored. This uses the production live-transport form serialization and service, not a replacement transport implementation.

**Impact:** A denied/failed read triggers unauthorized-in-the-workflow declarations instead of a fail-closed stop. It may attempt to redeclare existing exercises. Whether the real PHP endpoint rejects, duplicates or updates existing declarations was not tested and is not asserted.

**Required correction:** Validate login statuses and authenticated-session evidence. Require the expected response shape at each business endpoint; throw on error objects/non-arrays rather than manufacturing empty lists. Validate mutation acknowledgments as structured responses with `success === true`. Do not declare anything after a failed prerequisite read. Preserve legitimate empty arrays as a distinct case.

### S3-05 — MEDIUM: The sync service allows callers to omit the version gate

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:642-645`, `:678-692`, `:723-739`.

**Reproduction:** Approve a snapshot and call `syncReportCardToTeaching(classId, {transport})` without `expectedVersion`, or with an undefined option. `parsedExpectedVersion` stays null and the queue-local version comparison is bypassed.

**Observed:** `S3-05-omitted-service-version` returns success and **VERIFIED**. The public sync API does require `expectedVersion` (`sync-teaching/route.ts:39-47`), so this is a service-boundary gap, **not a demonstrated HTTP bypass**. Explicit stale versions are correctly rejected inside the queue, including when a record changes while the task is waiting.

**Required correction:** Make a valid reviewed version mandatory at the service boundary. Keep its check inside the queued operation and include the expected version in the atomic transition contract if strict cross-process version exclusion is required. `markSyncingTeaching` currently accepts only the hash, not the reviewed version.

### S3-06 — MEDIUM: Malformed JSON is reported as an internal server error

**Location:** `src/app/api/report-card/route.ts:189`, `:267-274`, `:283`, `:423-430`; `src/app/api/report-card/sync-teaching/route.ts:11`, `:85-92`.

**Reproduction:** Send a local request with body `{` and JSON content type to POST/PUT `/api/report-card` and POST `/api/report-card/sync-teaching`.

**Observed:** All three respond HTTP **500** with the JSON parser message (`S3-06-malformed-*`). No write occurs in these cases, but malformed client input is misclassified as an application failure. Missing identities and invalid versions take the intended HTTP 400 path.

**Required correction:** Handle JSON decoding/body-schema errors explicitly as HTTP 400 and reserve 500 for unexpected server failures. Validate a non-array object body before resolving identity or dispatching actions.

### S3-07 — MEDIUM: Requested PUT actions are not implemented and action values are ignored during writes

**Location:** `src/app/api/report-card/route.ts:278-304`, `:304-339`, `:341-402`. Approval is instead POST-only at `:229-261`.

**Reproduction:** PUT a valid class/version with any requested action (`approve`, `set_override`, `clear_override`, `reset_student_overrides`, `reset_all_overrides`) and the corresponding top-level student/field/value inputs. No action dispatch exists. All five receive HTTP 400 “No updates / patchOverrides.” More seriously, combine `action: "clear_override"` with a valid `updates` array assigning a score of 2: the route returns 200 and **creates/updates the override**. The action is not inspected, so unrecognized actions are also not rejected when updates are supplied.

**Observed:** `S3-07-action-*` demonstrates the five missing action paths; `S3-07-action-ignored` shows a clear request treated as a write.

**Existing alternative contract:** POST `{action:"approve", expectedVersion,...}` approves; PUT `updates`/`patchOverrides` saves; PUT `restoreLms:{studentId,fieldKey}` clears one; omitting `fieldKey` clears a pupil; `restoreLms:{studentId:"*"}` clears all. These are real implemented alternatives, so this finding does **not** mean restoration is wholly unavailable. The requested action contract is absent and contradictory action intent is silently ignored.

**Required correction:** Implement the specified explicit action dispatch, or formally settle the API contract before integrating the next phase. Reject unknown/contradictory operations; validate action-specific fields; add successful save/clear/reset/approve and stale-version tests for each operation.

### S3-08 — HIGH: Stop does not prevent subsequent declarations or interrupt an outstanding Teaching fetch

**Location:** `src/lib/playwright/teaching-report-card-sync.ts:842-847`, declaration calls `:869`, `:894`, `:918`, `:942`, next stop check `:1164-1166`; live fetch calls at `:394`, `:411`, `:450`, `:462`, `:486`, `:500` have no cancellation signal/application deadline. Queue interaction: `src/lib/queue/task-queue.ts:194-224`; public stop action: `src/app/api/queue/control/route.ts:24-30`.

**Reproduction A:** Trigger `taskQueue.stopQueue()` during the first `getExercises`. Return an empty valid exercise list. The service has already passed its previous stop check and creates CP1, CP2 and final exercises before checking Stop immediately before score saving.

**Observed A:** `S3-08-stop-side-effects` records **three remote declaration mutations after Stop**. Score saving is prevented and the row eventually becomes FAILED, which does not undo those mutations.

**Reproduction B:** Hold the actual live transport's student-list fetch unresolved, then Stop. There is no request AbortSignal and stopping the queue drains only pending tasks.

**Observed B:** `S3-08-stalled-read-stop` observes the current task still pending, queue running and row **SAVING** after Stop. The test explicitly releases the fake network wait with an error to clean up; only then does the real catch persist FAILED. This is a bounded deterministic liveness test, not a claim to have waited indefinitely or measured the HTTP stack's default timeout.

**Required correction:** Recheck cancellation before every mutation and after prerequisite awaits; pass shared cancellation to requests and impose explicit request/operation deadlines. Stop/timeout must finish the active task and durably resolve its sync state. Do not release the queue slot while an uncancelled mutating request can still run.

### S3-09 — LOW: Final repository transition checks the hash but not ownership of the SAVING state

**Location:** `src/lib/db/sqlite.ts:6506-6511`, `:6533-6542`. The stronger claim in the service comment at `teaching-report-card-sync.ts:1269` is not implemented.

**Reproduction:** While the network operation is in flight, use an external SQLite update to set `status='FAILED', teachingSyncStatus='FAILED'` without altering content/hash. Return otherwise correct score readback.

**Observed:** `S3-09-state-transition` becomes VERIFIED and reports success. `markTeachingVerified` checks only content hashes and writes with `WHERE classId = ?`; it never requires `SAVING/SYNCING` or a sync-attempt token.

**Qualification:** The ordinary edit/restore/approve APIs reject edits during SAVING, and the global queue serializes the current supported sync path. This reproduction requires external state interference; no ordinary API-only route to it was demonstrated. It is a state-machine hardening gap, not a demonstrated score-drift bypass: changed score content is correctly rejected.

**Required correction:** Check current sync state and preferably an attempt identifier, and use an affected-row-checked conditional transition. An obsolete attempt must not overwrite a newer failure/cancellation result.

## Checklist results and working safeguards

| Area | Audit result |
| --- | --- |
| Local-only route guards | **PASS.** All four handlers call `validateLocalRequest` before request-body parsing or database work: report route lines 126, 185, 279; sync route line 7. Independent controls reject nonlocal Host, foreign Origin and cross-site fetch headers for each handler. Existing dev/start commands bind `127.0.0.1` (`package.json:7,9`). |
| Environment hygiene | No direct password/API-key exposure found in these routes' normal response/log construction; credential reads stay in server-side dependencies. No Client Component imports the sync service/config in the inspected app tree. This is source inspection and mocked execution, not a production browser-bundle certification. Raw upstream error text is returned/logged, so this conclusion does not assert that arbitrary upstream text is sanitized. |
| Queue execution | **PASS for current API callers.** State/version/hash checks and the SAVING transition are inside `taskQueue.enqueue`. There is no bypass option or second queue in this service. Parent tasks must not await this always-enqueued service from inside the same queue; no such caller exists in scope. |
| Persistent browser context / page finally | **Not implemented as described in the request.** The live transport uses Node `fetch` and its own cookie header; it never calls a browser-context helper, opens a page or closes one in `finally`. It does not create a second BrowserContext or leak a page. Shared browser-session behavior and DOM readback therefore are not certified. Login/protocol and cancellation defects are S3-04/S3-08. |
| HTTP and JSON | Business-response HTTP failures and invalid JSON syntax are rejected in independent controls. Schema errors and login statuses are not strictly handled: S3-04. Reads only retry 301/302 with a fresh login, and the retry fetch uses default redirect handling. Real account/session-expiry behavior remains untested. |
| Approval/hash before writes | **PASS for explicit versions and normal flow.** Finds current record, compares explicit version, requires APPROVED/VERIFIED, computes canonical SHA-256 and compares approved hash in the queue; repository rechecks the hash/state transactionally before SAVING. Optional service version is S3-05. |
| Durable error cleanup | Ordinary rejected writes/readback errors after entering SAVING persist FAILED. Independent raw/normalized mismatch controls confirm this. If content drifted, failure handling clears approval and persists WAITING_APPROVAL. An unresolved request never reaches catch until it settles: S3-08. Storage failure itself cannot be guaranteed recoverable by another write. |
| Mid-flight data changes | Supported snapshot/override/restore/approval mutations reject SAVING; repository finalization recomputes the hash in a transaction. Independent direct-SQL snapshot-score mutation is rejected and durably clears approval, matching the existing RC-05 override-drift case. State-only interference is S3-09. |
| Vietnamese identity and inactive pupils | **FAIL:** S3-01/S3-02. Ordinary name duplicates, duplicate remote IDs and supplied cross-class identities are otherwise rejected. |
| Coding declarations | Implemented: missing BTVN theory/practice by snapshot session; CP1 session 5 and CP2 session 9 with theory/practice/nang_luc; final session 14 with practice/nang_luc. Required exercise presence is reread after declarations. Partial groups are submitted as full form groups, so real PHP idempotence/update semantics still need validation. |
| Robotics declarations/scores | **PASS in supplied and independent tests:** no BTVN writes, CP1=4, CP2=8, final=14, required forms preserved. |
| Strict finite scores | **PASS:** blanks, whitespace, booleans, arrays/objects, NaN and infinities rejected; zero is retained. Domain/range validation is separate. Numeric strings are accepted by design. |
| Read-after-write | Verifies all pushed raw values and present numeric normalized values; rejects duplicate score keys and cross-class score rows. **Incomplete normalized/null verification: S3-03.** Expected-null stale numeric raw values correctly fail; there is no automatic clear-score write in the current protocol. |
| API identities/versions/ranges | Missing class identity and mismatched supplied class IDs fail with 400. Invalid versions fail with 400 and explicit stale edit/sync versions return 409. Repository validates finite numeric 0..5 scores and raw/max consistency. GET without identity intentionally lists classes with 200. JSON and action gaps are S3-06/S3-07. |
| LMS scrape route | POST `action:"scrape_lms"` enqueues the current `scrapeClassScores` implementation, which persists snapshot/matrix together and preserves overrides. It does not call the differently named method in the request. Stage 2 regressions remain green; live scraping was not repeated for this audit. |

## RC-05 coverage gaps

The supplied RC-05 is useful: it covers ordinary ambiguous names, version conflicts, Coding/Robotics declarations, failed declarations, raw readback mismatches, blank raw zero, stale raw scores for nulls, and mid-flight override drift. It does not exercise numeric cross-system ID collisions, inactive-only rosters or `nghi_hoc`, missing/malformed normalized fields, stale normalized-only null slots, live transport login/status/schema behavior, Stop during prerequisites, or the requested PUT action contract. Its transport mock constructs correct normalized values automatically (`scripts/test-report-card-v330.ts:2151-2168`), concealing those failure paths. API tests start at line 2660; only nonlocal GET is tested there, whereas the independent probe tests all four guards.

## Reproduce safely

The independent probe can run directly from the repository because it asserts both storage overrides are under TEMP, uses the real allowlist, intercepts all network calls, and never replaces those DB/cache variables:

```powershell
$stage3Temp = Join-Path $env:TEMP ('mindx-stage3-repro-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage3Temp | Out-Null
$env:MINDX_DB_PATH = Join-Path $stage3Temp 'probe.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $stage3Temp 'running_classes.json'
$env:MINDX_AUDIT_OBSERVATIONS = Join-Path $stage3Temp 'observations.json'
$env:ALLOWED_LOCAL_DIRS = $stage3Temp
npx.cmd tsx docs/audits/v330/stage3/adversarial-probe.ts
```

The probe is an evidence harness: exit 0 means current behavior matched its explicitly recorded bug/control expectations, **not** that the release is safe. After fixes, change bug observations into desired-behavior assertions or add equivalent regression cases, then rerun the required suites. Run the supplied RC script only in a copied TEMP workspace if the strict TEMP-only condition is to be preserved; its current unconditional DB override is documented above.

## Acceptance conditions and limitations

Resolve S3-01 through S3-08, add regressions for their actual failing branches, settle the API action contract, and rerun all three requested commands plus the independent cases on isolated storage. Harden or explicitly document the S3-09 state-ownership constraint. Recheck the production DB/cache and original-source preservation after that review.

Real Teaching endpoint behavior, actual login/session renewal, declaration idempotence, production browser rendering and DOM verification have **not** been exercised. This report does not accept later Phase 9 work, re-certify every historical Stage 1 finding, or reverse the historical Stage 2 closure decision. It rejects the current Stage 3 sync/API acceptance gate based on the reproduced local code behavior.

**VERDICT: NO-GO**
