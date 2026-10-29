# Phase 9 v3.3.0 — Stage 2 closure audit, Round 2

Date: 2026-10-29. Scope: TASK-9.3, the nine Round 1 findings, RC-04C, and the updated Stage 2 probe. Reviewed the existing working tree based on HEAD `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`. No application code or existing test code was edited by this audit.

**Decision: NO-GO. Six findings closed; three partially fixed but still open. One additional regression reproduced.** All four requested commands pass; the current tests do not establish complete closure.

| Finding | Status | Evidence / remaining issue |
| --- | --- | --- |
| S2-01, P1 | CLOSED | HTTP failure preserves CP1=4; delayed class JSON yields CP1=5; unfinished JSON fails. Additional independent Coding/Robotics probes reject missing capture and GraphQL errors. |
| S2-02, P1 | OPEN, partially fixed | Conflicting class IDs and nameless foreign class payloads are rejected. A response from a request preceding this scrape still overwrites the fresh response: 80 becomes 99 in the returned matrix, real SQLite cache, and snapshot. |
| S2-03, P1 | CLOSED | Repository lock failure propagates; both writes share an outer transaction. Independent injection of failure in the second write also rolls back the first snapshot write and its version. |
| S2-04, P1 | CLOSED | CRM candidates now acquire DOM fallback rows. Independent full-worker test retains practice=80 and Quiz=90 with CRM capture and no submission response. |
| S2-05, P1 | CLOSED | CRM bridge precedes mutable aliases in both identity implementations. Independent full-worker crossed-alias test preserves A=90 and B=20 in both outputs. |
| S2-06, P1 | CLOSED | Active CRM-only students are included. Independent full-worker test retains two distinct CRM IDs sharing a full name in both matrix and snapshot. |
| S2-07, P2 | OPEN, partially fixed | Explicit `Checkpoint 2` now maps correctly. A generic checkpoint without ordinal/session/displayOrder is still assigned to CP1 through `idx + 1`; unavailable identity must stay missing. |
| S2-08, P2 | OPEN, partially fixed | Completed zero DEMO and an entirely untouched template are distinguished in the supplied tests. Adding an unrelated general comment to an ungraded zero template incorrectly makes Final product=0. |
| S2-09, P2 | CLOSED | Exclusion no longer depends on payload size. Additional probes verify sessions 5, 9, and [5,9] for both GraphQL and DOM metadata, including explicit opt-in. |

## Remaining findings

**S2-02 — P1: capture phase does not bind responses to fresh requests.** Locations: `src/lib/playwright/scrape-scores.ts:281`, `:286`, `:432`, `:453`, `:534`. Only response events are tracked. `capturePhase` describes when a response arrives, not when its request started; matching class identity does not establish freshness. The independent probe emits a fresh request/response with score 80, then a response with score 99 from a stable request object created before the scrape, without emitting a new request event for it. Both real stores persist 99 and the worker reports success. This is the unclosed fresh-request requirement already documented in Round 1. Bind capture to the exact request issued by the drawer/tab action and reject responses for older requests; add this event-order regression to RC-04C.

**S2-07 — P2: the index fallback remains for unidentified checkpoints.** Locations: `src/lib/playwright/scrape-scores.ts:211`, `:236`, `:1532`. The caller substitutes `idx + 1` for missing `displayOrder`, and the resolver treats values 1–6 as CP1. A sole opaque lesson named `Bài kiểm tra`, with no ordinal/session/displayOrder, assigns Quiz 80 and practice 60 to CP1=4/3. Neither lesson ID nor title identifies CP1. Retain explicit identity handling, remove the list-index substitution, and leave unresolved checkpoint scores missing (or expose an identity error). Add unidentified and reversed checkpoint fixtures.

**S2-08 — P2: general feedback is treated as proof that DEMO was graded.** Locations: `src/lib/playwright/scrape-scores.ts:1809`, `:1820`, `:1824`. Five default DEMO zeros plus RATE=0 correctly yield missing; adding a CONTENT area containing only `Con tham gia tích cực.` changes Final product to 0 without any DEMO completion evidence. `Boolean(note)` accepts unrelated feedback. Require evidence tied to completed DEMO grading; test default templates with existing general comments separately from confirmed zero grades.

**R2-01 — P2, new regression: blank DEMO scores become numeric zero.** Locations: `src/lib/playwright/scrape-scores.ts:1816`, `:1820`, `:1841`. With RATE=4 and five DEMO scores set to the empty string, the new zero-grade path emits Final product=0. `Number('')` produces zero before validation, so these missing inputs qualify as five explicit zero scores. Previously the positive-score gate rejected this all-zero array. Validate the original values before coercion; blank, boolean, and absent values must not qualify as scored zeros. This is separate from the general-comment completion error above.

## Verification and limits

| Command (Windows launcher) | Result |
| --- | --- |
| `npx.cmd --no-install tsc --noEmit --incremental false` | PASS, exit 0; repeated after adding the independent audit probe |
| `npx.cmd --no-install tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01–RC-04 including RC-04C |
| `npx.cmd --no-install tsx docs/audits/v330/stage2/probe.ts` | PASS, exit 0; its 11 supplied observations report closed, but miss the cases above |
| `npx.cmd --no-install tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0; existing compatibility suite through Round 17 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2-round2/probe.ts` | PASS, exit 0; reproduces four remaining/new defect observations and verifies the six closed findings with supplementary probes |

The independent probe deliberately asserts observed defects; its exit 0 is not a GO signal. Evidence: [probe](stage2-round2/probe.ts), [observed values](stage2-round2/observations.json), and command logs in `stage2-round2/`. RC-04C's response-only harness has no request-start lifecycle; its checkpoint fixture has an explicit CP2 label, and its default DEMO fixture has neither general feedback nor blank values. These omissions explain why the supplied suites pass despite the remaining defects.

All commands received temporary `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` values. The RC suite and original Stage 2 probe replace their DB paths with their own disposable workspace databases before opening SQLite. Production file hashes before/after match:

- `data/mindx_bot.db`: `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`
- `data/running_classes.json`: `614F2CA361B5FE238A3F4BF067945C0F734AEF5524A295A1217688999A6C3581`

Browser behavior is simulated; persistence checks use real isolated SQLite. No live LMS acceptance or later Phase 9 stage is certified. The skill-designated Claude reviewer model is unavailable; this is the direct independent Codex audit requested by the user. Changes are limited to audit evidence and the three required project tracking documents. GO requires the four issues above to be corrected and the isolated checks rerun.

VERDICT: NO-GO
