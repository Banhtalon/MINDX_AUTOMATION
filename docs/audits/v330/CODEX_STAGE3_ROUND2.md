# v3.3.0 Phase 9 — Stage 3 Closure Re-Audit, Round 2

Date: 2026-10-29 (Asia/Saigon). Scope: **TASK-9.4**, Teaching report-card sync through `hocsinh.php`, `/api/report-card` and `/api/report-card/sync-teaching`. Auditor: Codex, acting as the requested independent code auditor. HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`. Reviewed the current working files, including the pre-existing uncommitted fixes; HEAD alone does not contain the implementation. The named Claude reviewer is unavailable; no Claude review is claimed.

**VERDICT: NO-GO. Four findings CLOSED; five PARTIALLY FIXED / OPEN.** The original reproductions now pass, but additional boundary cases still violate the requested closure conditions. An explicit Teaching binding can still write to a different Vietnamese name and reach VERIFIED. A one-cent normalized-score mismatch can also reach VERIFIED. Mutation acknowledgments remain permissive, cancellation ends before response-body consumption, and conflicting PUT score payloads are silently resolved instead of rejected.

## Closure matrix

| Finding | Priority | Round 2 result | Evidence and remaining condition |
| --- | --- | --- | --- |
| S3-01 | HIGH | **PARTIAL / OPEN** | Bare numeric IDs now defer to name matching and duplicate names are blocked. Valid `TEACHING_101` / `TID:101` bindings check activity, tone and uniqueness in the explicit branch. However, a failed explicit tone check falls through to the no-tone branch: An is mapped to Ân. Whole-sync probe writes 9 scores and reaches VERIFIED. |
| S3-02 | HIGH | **CLOSED** | Inactive pupils are excluded in all three matching branches. Tested 13 inactive statuses through exact and no-tone branches, plus both explicit prefixes. No inactive fallback or score write occurs. |
| S3-03 | HIGH | **PARTIAL / OPEN** | Missing/malformed normalized values now fail; numeric and malformed values in either field of expected-null slots fail. However, the comparison accepts normalized 3.99 or 4.01 when the expected score is 4.00; both whole-sync runs become VERIFIED. |
| S3-04 | HIGH | **PARTIAL / OPEN** | Login HTTP failures and failed/non-array reads now fail closed. Both mutations still accept `ok: true` or `status: "success"` without literal `success === true`, including wrong-type `success` values. |
| S3-05 | MEDIUM | **CLOSED** | Service rejects 11 omitted/invalid version inputs before transport work; actual successful sync forwards the reviewed version into both repository transitions. Queued stale-version control also passes. |
| S3-06 | MEDIUM | **CLOSED** | All three mutating handlers return 400 for malformed JSON and non-object JSON. Supplemental matrix: 18 cases. The sync route duplicates the object-parser logic inline rather than calling a helper named `parseJsonObjectBody`; its required observable behavior is equivalent. |
| S3-07 | MEDIUM | **PARTIAL / OPEN** | All five explicit actions work and reject stale versions; unknown actions and the original `clear_override + updates` contradiction now return 400. However, conflicting top-level and `updates` score instructions within `set_override` return 200 and silently apply `updates`. |
| S3-08 | HIGH | **PARTIAL / OPEN** | Every service transport call is guarded. Stop at each of the five transport method boundaries prevents subsequent service calls and records FAILED. Live fetch cancellation/timeout work before response headers. After headers, the stop subscription and deadline have already been removed; a pending response body is not aborted, and the service can release its queue slot while that HTTP operation remains outstanding. |
| S3-09 | LOW | **CLOSED for the audited sync path** | Actual service supplies expectedVersion; repository rejects a changed version even with unchanged content/hash. SAVING/SYNCING ownership is checked before the conditional update and `updateRes.changes !== 1` throws. Original external-FAILED-state reproduction stays FAILED. |

## Fresh verification

All executions set **both** `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` to unique disposable files below `%TEMP%\mindx-stage3-round2-e93d94e101f94a2785649717115f4c57\`. No production database/cache was opened for mutation by the audit.

| Command | Fresh result |
| --- | --- |
| `npx.cmd tsc --noEmit --incremental false` | PASS, exit 0; repeated successfully after the supplemental probe was finalized. |
| `npx.cmd tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01 through RC-05. |
| `npx.cmd tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0; expected injected network-failure messages appear in negative cases. |
| `npx.cmd tsx docs/audits/v330/stage3/adversarial-probe.ts` | PASS, exit 0; **40 PASS observation records, zero BUG_REPRODUCED records**. The current supplied probe contains closure expectations; this result does not exercise every remaining boundary. |
| `npx.cmd tsx docs/audits/v330/stage3-round2/closure-probe.ts` | Completes, exit 0; **72 observation records: 55 CLOSED, 17 OPEN**, grouped into the five remaining findings. Exit 0 means evidence collection and assertions completed; OPEN observations deliberately remain in the output. It is not a release-pass result. |

These are observation counts, not assertion counts. Positive matrices contain additional assertions and must not be summed as a purported test-case total.

Unlike the original Stage 3 script revision, the current RC suite creates its own subdirectory under the parent of `MINDX_DB_PATH` (`scripts/test-report-card-v330.ts:20-27`), and also sets a temporary running-class cache. Its replacement paths therefore remain beneath TEMP. No workspace mirror or modification to the existing test scripts was necessary. `MINDX_AUDIT_OBSERVATIONS` also points beneath TEMP during both probes. Artifact copies below were made after the runs completed.

## Remaining closure blockers

### S3-01 — Explicit binding failures fall through to a weaker identity match

Locations: `src/lib/playwright/teaching-report-card-sync.ts:322-363` (explicit binding), `:390-423` (no-tone fallback).

The explicit branch accepts a remote ID only when `r.normTone === localTone`. A failed match does not reject an explicitly bound student; execution continues to ordinary name matching. With local `{ studentId: "TEACHING_101", fullName: "Nguyễn Văn An" }` and only active Teaching student `{ id: 101, student_name: "Nguyễn Văn Ân" }`, no-tone fallback returns #101. The same happens with `TID:101`.

Supplemental observations `S3-01-wrong-tone-TEACHING_101` and `S3-01-wrong-tone-TID:101` both report accepted mappings. In `S3-01-explicit-wrong-tone-end-to-end`, the real service and temporary SQLite repository write **9 scores to #101**, return `success: true`, and persist **VERIFIED** despite the tone mismatch. All HTTP is replaced by a controlled transport; no real student was affected.

Required closure: once a local ID is interpreted as an explicit Teaching binding, enforce that binding's identity requirements across the whole matching operation. Reject a mismatched tone, inactive/missing target or nonunique binding before any mutation; do not let a failed binding re-enter the weaker no-tone fallback. Keep the new numeric-ID and duplicate-name protections.

### S3-03 — One-cent normalized discrepancies still count as a match

Location: `src/lib/playwright/teaching-report-card-sync.ts:1468-1480`, especially `Math.abs(round2(actualNorm) - expectedNorm) > 0.01` at line 1477.

The omission/null/malformed checks requested in the original finding are implemented. Supplemental tests reject ten invalid normalized representations for pushed scores and twenty numeric/malformed representations across both expected-null fields.

The remaining numeric comparison permits a full two-decimal unit of error. Returning **4.01** or **3.99** for every expected normalized **4.00** passes the real service and persists **VERIFIED** in both cases (`S3-03-normalized-cent-0.01`, `S3-03-normalized-cent--0.01`). Raw scores remain correct, so the discrepancy is specifically in authoritative normalization. Floating-point representation makes the absolute difference slightly below 0.01 in these examples.

Required closure: compare the normalized scores at the agreed two-decimal precision using equality or a floating-point epsilon smaller than one cent. A different two-decimal scale-5 score must fail read-after-write verification. The original missing-value defect is fixed; this residual concerns numeric equality under the requested strict matching rule.

### S3-04 — Mutation protocol still accepts aliases for literal success

Locations: `src/lib/playwright/teaching-report-card-sync.ts:469-505`, especially line 493; used by `addMultiExercise` at line 776 and `saveScores` at line 795.

`requireTeachingMutationAck` currently accepts `obj.success === true || obj.ok === true || obj.status === "success"`. Actual live-transport tests intercept login and business fetches and observe `{ success: true }` returned for **both** mutation methods when upstream sends any of:

```json
{"ok":true}
{"status":"success"}
{"success":"true","ok":true}
{"success":1,"status":"success"}
```

Eight OPEN records cover four payloads across two mutation endpoints. The literal `{ "success": true }` positive control works. Separate checks confirm that both login stages reject HTTP 400/503 and all three read methods reject error objects and invalid payloads. The original denied-read-to-declaration chain is fixed; strict mutation acknowledgment is still missing.

Required closure: only a structured object with **literal `success === true`** may acknowledge a successful mutation. Do not promote other fields or wrong-type values to this acknowledgment. Preserve the failed-read and login-status protections.

### S3-07 — Conflicting score instructions are silently prioritized

Locations: `src/app/api/report-card/route.ts:346-550` (explicit dispatch) and `:601-665` (payload-source precedence).

The five required actions now exist. A supplemental two-student sequence verifies the actual effects of setting, clearing one field, resetting one student, resetting all overrides and approval. Each action returns 409 for a stale version. Unknown action, `clear_override + updates`, and `approve + restoreLms` controls return 400.

The route still accepts this contradictory request:

```json
{
  "classId":"<temporary audit class>",
  "expectedVersion":2,
  "action":"set_override",
  "studentId":"LMS_01",
  "fieldKey":"cp1_theory",
  "normScore":1,
  "updates":[{"studentId":"LMS_01","fieldKey":"cp1_theory","normScore":5}]
}
```

`S3-07-conflicting-score-payloads` receives **HTTP 200** and the real repository contains override **5**; the top-level instruction **1** is ignored. This is an additional contradictory-input boundary within the requested action-validation closure, rather than a claim that the original clear action is still ignored.

Required closure: validate a single unambiguous operation/payload source before dispatch. Reject mutually inconsistent top-level, `updates`, `patchOverrides` or restoration instructions with 400 before changing the repository. Preserve working legacy forms when supplied unambiguously.

### S3-08 — Cancellation/deadline lifetime ends at headers

Locations: `src/lib/playwright/teaching-report-card-sync.ts:516-578` (fetch guard cleanup), `:684-690` and `:723-729` (JSON consumed after cleanup), plus `:156-188` (service race).

All service calls are now wrapped in `runWithStopGuard`. Supplemental Stop controls at `getStudents`, `getExercises`, `addMultiExercise`, `saveScores` and `getScores` all prevent subsequent calls and leave FAILED. The live transport also genuinely aborts stalled fetches on Stop/timeout **before headers**; the supplemental controls inspect `signal.aborted`, rather than only signal presence.

`fetchWithStopAndTimeout` returns the `Response` as soon as headers arrive. Its `finally` then clears the timer and removes the queue subscription. `getJson`/`postForm` subsequently await `.json()` outside that lifetime.

To reproduce, the intercepted fetch returns a real `Response` with an unfinished `ReadableStream` body. Its abort listener would fail the body reader if the request signal were aborted. With a **20ms** configured timeout, after **60ms** the mutation remains pending with **`signal.aborted === false`**. The same remains true after `stopQueue()`; both observations are OPEN. This is a bounded deterministic observation, not a claim about an HTTP stack's ultimate timeout.

The whole-service variant stops during the student response body: the outer guard returns failure, SQLite becomes **FAILED**, and `queueRunning` becomes **false**, while the outstanding request signal is still **not aborted** (`S3-08-service-body-stop`). The probe explicitly finishes the synthetic stream afterward for cleanup. No post-Stop declaration was observed; that original symptom is fixed. The remaining defect is an uncancelled in-flight HTTP body and premature release of the queue's ownership of that operation.

Required closure: keep cancellation and timeout active through full body consumption/decoding, including retry responses, and stop the underlying request before releasing the active operation. Add body-phase Stop and timeout regressions alongside the passing before-headers controls.

## Closed findings: evidence and limits

- **S3-02:** `isRemoteStudentInactive` at `teaching-report-card-sync.ts:123-146` normalizes machine separators and Vietnamese status text. All three matching branches require `!r.isInactive`; the former active-or-all fallback is removed. The supplemental matrix covers `inactive`, `dropped`, `nghỉ học`, `nghi_hoc`, `tam_nghi`, `bao_luu`, `tạm nghỉ`, `bảo lưu`, `chuyen_lop`, `bo_hoc`, `da_nghi`, `disabled`, `archived`.
- **S3-05:** service parsing at `:897-912`, queue-local comparison at `:940`, transition at `:1036-1040`, and final transition at `:1510-1523`. Supplemental spies verify the reviewed version reaches both actual repository methods. Original queued-version control remains passing. The two hash-repair-only calls omit a version but never enter a successful sync; they do not bypass the validated normal transition.
- **S3-06:** report route parser at `route.ts:184-217`, invoked at `:223` / `:321`; sync route equivalent validation at `sync-teaching/route.ts:10-34`. Malformed and scalar/array/null bodies all return 400 before class/version handling.
- **S3-09:** `sqlite.ts:6547-6564` checks supplied version and SAVING/SYNCING state inside the transaction; `:6567-6582` conditionally updates those states and checks affected rows. The repository parameter remains optional at the type/API level; this closure certifies the actual service path, which now always supplies its validated version, not a new mandatory argument policy for arbitrary direct repository callers. The stale-version supplemental check and original external-state-interference check both reject VERIFIED.

## Preservation and deliverables

All **145 pre-existing protected files** retained SHA-256, length and last-write timestamp: every file under `src/`, `scripts/`, `data/`, the original `stage3/` evidence directory, and `next-env.d.ts`. Production values measured before and after this audit:

| File | SHA-256 | Bytes | Last write, UTC |
| --- | --- | --- | --- |
| `data/mindx_bot.db` | `D6A90B5B0795A3DBC0FABFCCAFBCA423E17D4CD5157605CC09A68D24D5F85A40` | 417792 | `2026-10-29T02:51:04.3378692Z` |
| `data/running_classes.json` | `614F2CA361B5FE238A3F4BF067945C0F734AEF5524A295A1217688999A6C3581` | 1879 | `2026-10-28T12:44:41.1214243Z` |

These are this audit's baseline values, not a claim that the database still has the older Stage 3 report's hash. No production source or existing test/probe was edited. Changes are limited to this report, the original audit's current-status note, new Round 2 evidence/probe, and the three required tracking documents. No live LMS/Teaching calls or remote writes occurred; all network behavior in the probes is intercepted with synthetic credentials. Installed Next route-handler documentation was consulted.

Evidence: [supplemental probe](stage3-round2/closure-probe.ts), [supplemental observations](stage3-round2/closure-observations.json), [supplemental log](stage3-round2/closure-probe.log), [current original-probe observations](stage3-round2/observations.json), [original-probe log](stage3-round2/stage3.log), [RC suite](stage3-round2/report-card.log), [Phase 4](stage3-round2/phase4.log), [verification manifest](stage3-round2/verification.json), [preservation](stage3-round2/preservation.json).

**Acceptance remains pending for TASK-9.4.** Close S3-01, S3-03, S3-04, S3-07 and S3-08, add regressions for the demonstrated residual boundaries, and rerun the four mandatory commands plus the supplemental probe. This decision does not reopen the earlier TASK-9.3 Stage 2 closure, nor certify live Teaching operation or later Phase 9 work.
