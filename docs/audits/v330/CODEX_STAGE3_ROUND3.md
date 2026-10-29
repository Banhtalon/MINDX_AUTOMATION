# v3.3.0 Phase 9 — Stage 3 Closure Re-Audit, Round 3

Date: 2026-10-29 (Asia/Saigon). Scope: **TASK-9.4**, Teaching report-card synchronization through `hocsinh.php`, `/api/report-card` (`GET`, `POST`, `PUT`) and `/api/report-card/sync-teaching` (`POST`). Auditor: Codex, performing the requested independent code-auditor role. HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`.

**VERDICT: GO — all nine findings S3-01 through S3-09 are CLOSED within the audited TASK-9.4 sync/API path.** The five Round 2 blockers are resolved, and the four previously closed findings remain closed. No remaining closure blocker or new finding was reproduced in the requested scope.

This decision concerns the **current working files, including pre-existing uncommitted/untracked implementation**; HEAD alone does not contain the audited feature. It supersedes the TASK-9.4 NO-GO in [Round 2](CODEX_STAGE3_ROUND2.md). Earlier reports remain historical evidence. No production application code or existing test/probe was changed by this audit. Codex performed the independent audit directly; no Claude review is claimed.

## Closure matrix

| Finding | Priority | Round 3 result | Current evidence |
| --- | --- | --- | --- |
| S3-01 | HIGH | **CLOSED** | Explicit bindings reject invalid/reused IDs, absent targets, inactive targets, tone mismatches and name ambiguity before weaker matching. Both prefixes reject wrong bindings even when an alternative exact-name student exists. Whole-service failures stop after `getStudents`, write no scores and persist FAILED. Bare numeric IDs still use safe name matching. |
| S3-02 | HIGH | **CLOSED, retained** | Inactive targets remain excluded in explicit, exact-name and no-tone branches. The original service reproduction performs zero inactive-student writes; Round 2's 13-status matrix still passes. |
| S3-03 | HIGH | **CLOSED** | Normalized readback compares `Math.abs(round2(actualNorm) - expectedNorm) > 1e-6`. Both 4.01 and 3.99 for expected 4.00 now fail and persist FAILED. Numeric-string cent mismatches also fail; exact and same-rounded-value controls still reach VERIFIED. Missing/malformed and expected-null checks remain intact. |
| S3-04 | HIGH | **CLOSED** | `requireTeachingMutationAck` acknowledges success only for literal `obj.success === true`. All four specified aliases/wrong-type payloads fail for both mutations. Additional retry controls reject non-object responses and aliases after reauthentication. Login HTTP and failed-read protections remain intact. |
| S3-05 | MEDIUM | **CLOSED, retained** | Eleven invalid/omitted service versions are rejected before transport work. The requested reviewed version reaches both real repository transitions; a stale task queued behind an edit returns 409 before remote mutations. |
| S3-06 | MEDIUM | **CLOSED, retained** | All three mutating handlers return 400 for malformed/non-object JSON. The Round 2 matrix covers 18 combinations; local-request guards still run first. |
| S3-07 | MEDIUM | **CLOSED** | The route counts `updates`, `patchOverrides` and top-level override fields and rejects multiple sources with 400. All pairs and the triple are rejected for legacy, `set_override` and `save_overrides` requests with the actual repository unchanged. Every unambiguous single-source form remains functional. Existing action effects and stale-version checks still pass. |
| S3-08 | HIGH | **CLOSED** | `consumeResponse` runs inside the protected fetch operation, including initial and retry JSON reads for GET/POST. Stop/deadline abort the request during body consumption. All five public transport methods pass direct/retry Stop, timeout, success and malformed-JSON checks; subscriptions are removed after settlement. Whole-service body-phase Stop aborts the signal before the completed audit observation sees the queue released. |
| S3-09 | LOW | **CLOSED for the audited sync path, retained** | Same-hash stale versions and external FAILED-state interference cannot become VERIFIED. Final verification checks version and SAVING/SYNCING ownership inside the SQLite transaction, conditionally updates those states, and rejects an affected-row count other than one. |

## Fresh verification

All five requested commands ran freshly and exited **0**. On Windows, `npx.cmd` was used to launch the requested `npx` commands.

| Command | Result | Evidence |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | **PASS**, exit 0; also PASS after finalizing the new audit probe | [initial log](stage3-round3/tsc.log), [final log](stage3-round3/final-tsc.log) |
| `npx tsx scripts/test-report-card-v330.ts` | **PASS**, exit 0; RC-01 through RC-05 | [log](stage3-round3/report-card.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | **PASS**, exit 0; expected injected network-failure messages in negative cases | [log](stage3-round3/phase4.log) |
| `npx tsx docs/audits/v330/stage3/adversarial-probe.ts` | **PASS**, exit 0; 40 PASS observations, zero BUG_REPRODUCED | [log](stage3-round3/stage3.log), [observations](stage3-round3/stage3-observations.json) |
| `npx tsx docs/audits/v330/stage3-round2/closure-probe.ts` | **PASS**, exit 0; 72 CLOSED observations, zero OPEN | [log](stage3-round3/round2-closure.log), [observations](stage3-round3/round2-closure-observations.json) |
| Additional: `npx tsx docs/audits/v330/stage3-round3/closure-boundaries.ts` | **PASS**, exit 0; 101 CLOSED observations | [probe](stage3-round3/closure-boundaries.ts), [log](stage3-round3/closure-boundaries.log), [observations](stage3-round3/closure-boundaries-observations.json) |

These are **observation records, not assertion counts**. Probe scopes overlap; their totals must not be combined into a unique test-case count. The Round 2 probe's exit status alone is insufficient; its saved observations were inspected and contain zero OPEN records. A missing `class_code` type in the new audit-only fixture was corrected before the final supplemental run and TypeScript PASS; application source was not involved.

## Implementation and boundary evidence

### Explicit identity: S3-01 and retained S3-02

`src/lib/playwright/teaching-report-card-sync.ts:322-381` now treats explicit identity as a binding. The branch immediately throws for a nonpositive/reused ID (`:331-340`), missing remote ID (`:342-349`), inactivity (`:350-354`), and `remoteById.normTone !== localTone` (`:355-359`). Active remote name count and relevant local name count must each equal one (`:361-371`). A successful binding claims the ID and `continue`s; none of its failures can reach the no-tone branch.

The new probe records 16 observations across `TEACHING_` and `TID:`. For each prefix, six whole-service negative cases cover absent targets with a name fallback, inactive targets with an active fallback, a wrong-tone target with an exact-name alternative, wrong-tone-only fallback, duplicate remote names and duplicate remote IDs. Each stops after `getStudents`, with zero declarations/score writes and FAILED in real temporary SQLite. Cross-prefix local reuse is rejected. Nonpositive/very large IDs are also checked; Unicode NFD, whitespace and casing controls retain the valid exact-tone match.

The original numeric-ID/name-priority controls and Round 2 inactive-status matrix also pass unchanged.

### Readback precision: S3-03

`teaching-report-card-sync.ts:1533-1547` retains strict numeric parsing and requires normalized equality at two-decimal precision with epsilon `1e-6`. The unchanged Round 2 cent probes now reject both **4.01** and **3.99** for expected **4.00**, each leaving FAILED. The new service probe adds string-valued cent discrepancies, exact numeric/string positives and a sub-cent value that rounds to the same two-decimal score. Those positives reach VERIFIED, showing the fix preserves the specified rounding policy.

Missing/malformed normalized scores, raw mismatches and stale numeric/malformed values in either expected-null field remain rejected by both earlier probes.

### Business acknowledgment: S3-04

`teaching-report-card-sync.ts:492-528`, specifically `:516`, now permits success only when `obj.success === true`. Both mutations use this validator (`:841`, `:860`). The unchanged Round 2 probe rejects `{ok:true}`, `{status:"success"}`, `{success:"true",ok:true}` and `{success:1,status:"success"}` for both endpoints, while the literal positive succeeds.

The new probe adds 16 observations across both mutation methods **after a synthetic 302, fresh login and retried business response**: null/array/boolean bodies and all four aliases fail closed; literal success succeeds. Prior failed-login/read tests and the denied-read-to-declaration service reproduction remain passing.

### Conflicting override sources: S3-07

`src/app/api/report-card/route.ts:601-628` uses presence checks for the three override sources and returns 400 when `overrideSourceCount > 1`, before constructing or saving updates. Explicit approve/reset/clear branches retain their earlier contradiction guards.

The new probe records 24 observations: all source pairs and the triple across legacy/`set_override`/`save_overrides` (12 records); four partial or empty top-level-source checks per action mode (three grouped records); and all three unambiguous sources in each mode (nine positive records). Every rejected request compares the full actual repository record before/after and leaves it unchanged. The existing two-student action-effect sequence and five stale-version controls still pass.

### Body lifetime, retry and cleanup: S3-08

`teaching-report-card-sync.ts:539-607` accepts `consumeResponse`, awaits it inside `operationPromise` (`:588-600`), and clears the timeout/unsubscribes only in the enclosing `finally` (`:603-605`). `getJson` supplies consumers for the first response (`:700-710`) and retry (`:726-733`); `postForm` does the same (`:757-767`, `:783-790`). Thus `await res.json()` and `await retryRes.json()` remain within the AbortController/deadline/queue-status lifetime.

The new probe adds **40 body-phase observations**: five public methods × direct/retry × Stop/timeout/success/malformed JSON. Each mocked business fetch returns a real `Response` over a controlled `ReadableStream`; the request signal's abort listener errors that stream, modeling fetch body cancellation. During pending `.json()`, exactly one transport status subscription remains active. Stop and a 30ms deadline both abort the signal and reject the pending operation; successful and malformed bodies settle correctly without an abort. All cases finish with zero transport status subscriptions. Retry cases confirm two business attempts. Tests have bounded watchdogs and intercept all HTTP.

The unchanged Round 2 before-headers controls, response-body controls, whole-service body Stop and five service-boundary Stop cases also remain CLOSED. In its whole-service body Stop observation the underlying signal is aborted, the report card is FAILED, and `queueRunning` is false. No continuation writes after Stop were observed.

### Retained version, JSON and ownership protections: S3-05, S3-06, S3-09

The service validates `expectedVersion` at `teaching-report-card-sync.ts:962-977`, checks it again inside the queue at `:1005`, and supplies it to both transitions (`:1101-1105`, `:1575-1588`). The two hash-repair-only calls without versions remain failure-only paths. The Round 2 spies verify successful forwarding; the queued-version reproduction still returns 409 before transport writes.

`route.ts:184-217` parses JSON objects for POST/PUT (`:223`, `:321`); `sync-teaching/route.ts:10-34` implements equivalent inline rejection. The 18-case malformed/non-object matrix passes. Original guards reject nonlocal Host, cross-origin and cross-site requests for all four handlers before parsing.

`src/lib/db/sqlite.ts:6547-6582` checks supplied version, requires SAVING/SYNCING ownership, conditionally updates those states and checks `updateRes.changes`. Both the same-hash stale-version case and the original externally FAILED state case remain rejected. The repository version argument is still optional for arbitrary direct callers; S3-09 remains closed for the audited service path, which supplies its validated version, consistent with Round 2's scope.

## Isolation, preservation and deliverables

Every execution set **`MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` and `MINDX_AUDIT_OBSERVATIONS`** to disposable files beneath `%TEMP%\mindx-stage3-round3-a2fbd9af53d9439094e3ece52f9d1abf\`. The RC suite replaces its overrides with a child directory beneath that TEMP parent; no workspace mirror or test-source modification was needed. Saved observations/logs were copied into the new audit evidence directory after execution. All probe HTTP is intercepted and uses synthetic credentials; no live Teaching/LMS writes occurred.

All **202 pre-existing protected files** retained SHA-256, byte length and last-write timestamp: `src/`, `scripts/`, `data/`, all pre-existing `docs/audits/v330/` evidence/reports, and package/TypeScript metadata. Preservation details are in [preservation.json](stage3-round3/preservation.json). Existing dirty application changes were left intact.

| Production file | SHA-256, unchanged before/after | Bytes | Last write UTC, unchanged |
| --- | --- | --- | --- |
| `data/mindx_bot.db` | `D6A90B5B0795A3DBC0FABFCCAFBCA423E17D4CD5157605CC09A68D24D5F85A40` | 417792 | `2026-10-29T02:51:04.3378692Z` |
| `data/running_classes.json` | `614F2CA361B5FE238A3F4BF067945C0F734AEF5524A295A1217688999A6C3581` | 1879 | `2026-10-28T12:44:41.1214243Z` |

Deliverables are this report, the new `stage3-round3/` probe/evidence, and the required updates to `PROJECT_STATE.md`, `CHANGELOG.md` and `MINDX_AUTOMATION_PLAN.md`. Execution metadata and TEMP override paths are in [verification.json](stage3-round3/verification.json). Installed Next.js route-handler documentation was consulted. No server, build or live account session was started.

**Acceptance: GO for the TASK-9.4 Stage 3 closure gate.** TASK-9.3's prior closure is unchanged. This report does not certify live Teaching behavior, reopen Stage 1 acceptance, or accept TASK-9.5/TASK-9.6 and the rest of Phase 9.
