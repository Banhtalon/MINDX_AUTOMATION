# Phase 9 v3.3.0 — Stage 2 closure audit, Round 3

Date: 2026-10-29. Scope: TASK-9.3 and all ten findings (S2-01 through S2-09, plus R2-01). Reviewed the existing working tree based on HEAD `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`. Application code and existing test/probe source were not edited.

**Decision: NO-GO. Eight findings are CLOSED; S2-02 and S2-07 remain partially fixed and OPEN.** All five requested verification commands pass. Additional event-order and missing-title cases reproduce the remaining defects.

| Finding | Round 3 status | Verified behavior |
| --- | --- | --- |
| S2-01, P1 | CLOSED | HTTP/GraphQL errors, missing class capture and unfinished JSON fail without replacing prior scores; delayed JSON is awaited for Coding. Freshness is assessed separately under S2-02. |
| S2-02, P1 | OPEN, partially fixed | Fresh request sets reject the supplied late stale submission response, and foreign class IDs are rejected. Before the first request event, however, an old class response is still accepted and persisted. |
| S2-03, P1 | CLOSED | Lock failures propagate; a second-write failure rolls back the snapshot and its version in real isolated SQLite. |
| S2-04, P1 | CLOSED | CRM roster plus DOM fallback preserves practice 80 and Quiz 90 in the full worker. |
| S2-05, P1 | CLOSED | Crossed display aliases retain A=90 and B=20 in both matrix and snapshot through the CRM bridge. |
| S2-06, P1 | CLOSED | Both outputs retain active CRM-only pupils, including distinct CRM IDs sharing a name. |
| S2-07, P2 | OPEN, partially fixed | Opaque named checkpoints stay missing; explicit CP2 and reversed explicit ordinals resolve correctly. A missing title still produces a synthetic session from array position and assigns CP1/CP2. |
| S2-08, P2 | CLOSED | Unrelated CONTENT feedback leaves default zero templates missing; completed zero DEMO grades retain numeric zero. |
| S2-09, P2 | CLOSED | Small GraphQL/DOM payloads exclude sessions 5/9 by default and retain explicit opt-in behavior. |
| R2-01, P2 | CLOSED | Blank/whitespace strings, null, undefined and booleans remain missing even with graded RATE; explicit numeric/string zero is preserved. |

## Remaining closure blockers

**S2-02 — P1: freshness validation is conditional on seeing any request event.** Locations: `src/lib/playwright/scrape-scores.ts:278`, `:286`, `:312`, `:389`, `:496`.

Both response guards use `sawRequestEvents && !fresh...Requests.has(reqObj)`. While `sawRequestEvents` is false, a response from a request created before the scrape bypasses membership validation entirely. The capture phase is set before awaiting `openClassDrawer`, so this is an actual observation window during drawer navigation.

The additional probe first seeds CP1=4 using a fresh class request. On a second scrape, it emits a response from a stable pre-scrape class request before any new request event, with CP1=5 and the same valid class identity. It emits no fresh GetClassById request. Coding subsequently receives a fresh submission request/response; Robotics receives no request events at all. Both return `success: true` and replace CP1 with 5 in the returned snapshot, real SQLite report card and matrix cache. The required outcome is failure with prior CP1=4 preserved.

Remove the response-only acceptance path: require exact membership in the relevant fresh-request set unconditionally, and update legacy mocks to emit real request lifecycles. Keep regression cases for both an old response after fresh traffic and an old response before the first fresh request. RC-04C's general harness still uses one response listener without request events (`scripts/test-report-card-v330.ts:1225`); its dedicated stale test only covers fresh traffic first (`:1763`). The Round 2 probe likewise emits a fresh class request before testing stale submissions.

**S2-07 — P2: list position still becomes checkpoint identity through a generated title.** Locations: `src/lib/playwright/scrape-scores.ts:1544`, `:1552`, `:224`, `:232`.

The displayOrder range fallback and direct `idx + 1` argument were removed correctly. However, `String(lesson.name || \`Buổi ${idx + 1}\`)` still supplies generated identity to `resolveCheckpointLessonStage`. An unnamed CHECKPOINT with opaque ID and no session/displayOrder becomes `Buổi 5` at array position 5, or `Buổi 9` at position 9. The resolver treats these fabricated names as authoritative session evidence.

The additional probe supplies four or eight ordinary lessons followed by this unidentified checkpoint, with Quiz=80 and practice=60. It incorrectly produces CP1 theory=4 or CP2 theory=4 respectively; both should remain null. Existing opaque-title and reversed-ordinal fixtures pass because they never exercise a missing title at these positions. Resolve checkpoint identity using original source fields only; keep any generated display label out of identity resolution. Add both missing-title positions to RC-04C and the closure probe.

## Fresh verification

All commands used isolated temporary `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH`. `npx.cmd --no-install` is the Windows launcher equivalent using installed dependencies.

| Command | Result |
| --- | --- |
| `npx.cmd --no-install tsc --noEmit --incremental false` | PASS, exit 0; repeated successfully after adding the Round 3 probe |
| `npx.cmd --no-install tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01 through RC-04, including RC-04C |
| `npx.cmd --no-install tsx docs/audits/v330/stage2/probe.ts` | PASS, exit 0; eleven supplied observations |
| `npx.cmd --no-install tsx docs/audits/v330/stage2-round2/probe.ts` | PASS, exit 0; supplied closure assertions and real SQLite checks |
| `npx.cmd --no-install tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0; compatibility suite through Round 17 |
| `npx.cmd --no-install tsx docs/audits/v330/stage2-round3/probe.ts` | Exit 0; four remaining-defect observations plus supplementary DEMO validation checks |

The Round 3 probe deliberately asserts the observed failures as evidence; its successful exit is not a GO signal. The supplied probes' CLOSED labels certify their fixtures only. Evidence: [additional probe](stage2-round3/probe.ts), [observations](stage2-round3/observations.json), [requested-command results and isolation paths](stage2-round3/commands.json), and logs under `stage2-round3/`. The RC suite and original Stage 2 probe install their own disposable database overrides before opening SQLite.

Production file SHA-256 values remained unchanged, with unchanged lengths and modification times:

- `data/mindx_bot.db`: `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`
- `data/running_classes.json`: `614F2CA361B5FE238A3F4BF067945C0F734AEF5524A295A1217688999A6C3581`

Source fingerprints and production integrity checks are recorded in `stage2-round3/baseline.json` and `stage2-round3/integrity.json`. Temporary audit databases remain in the recorded isolated directories: automatic approval review rejected their deletion with the reason "blocked by policy". Changes are limited to audit artifacts, disposable audit databases, observation JSON refreshed by the requested probes, and the three required project tracking documents. No live LMS or later Phase 9 stage is certified. The skill-designated Claude reviewer model is unavailable; this is the direct independent Codex audit requested by the user. TASK-9.3 remains pending acceptance until both blockers are closed and isolated checks rerun.

VERDICT: NO-GO
