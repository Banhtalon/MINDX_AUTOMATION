# v3.3.0 — Stage 4 Round 3 Independent Closure Audit

Date: 2026-10-29 (Asia/Saigon). Scope: **Phase 9, TASK-9.5 / TASK-9.6 closure**. Auditor: Codex. Baseline HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`, **including the pre-existing uncommitted working files**.

**Decision: GO for the requested Stage 4 closure gate. All seven findings are CLOSED: S4-01 through S4-06 and R2-01.** All seven mandatory commands freshly passed, as did the additional Round 3 probe. No application or existing test/probe source was edited by this audit.

## Scope and method

Read `PROJECT_STATE.md` first; cross-checked `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, [Round 1](CODEX_STAGE4_AUDIT.md), and [Round 2](CODEX_STAGE4_ROUND2.md). Reviewed the five specifically requested component/page/test/probe files, their response-acceptance and busy-state paths, parent scrape contract, retained streamlining controls, and relevant calculator/API behavior. Consulted `.agents/skills/team-workflow/SKILL.md` and the installed Next.js server/client-boundary guide. The designated Claude reviewer is unavailable in this environment; Codex performed this independent audit directly.

The two existing probes ran unchanged inside TEMP. The new [Round 3 probe](stage4-round3/probe.mjs) adds independently authored scenarios using a [copy of the original hook/element-tree harness](stage4-round3/harness.mjs). The actual TSX source is instrumented/transpiled in memory; production files are never rewritten. This harness models state, refs, effects, callbacks, deferred fetch/JSON completion, and recorded Canvas/clipboard calls. It checks rendered button `disabled` properties, not browser pointer access through modal overlays. The existing probes additionally execute actual local route handlers against real disposable SQLite databases; no network server or remote write is required.

## Finding disposition

| ID | Original severity | Round 3 disposition | Fresh verification |
| --- | --- | --- | --- |
| S4-01 | HIGH | **CLOSED** | All payloads now share the monotonic version floor. All six mutation handlers depend on payload acceptance before success notifications, editor dismissal or scrape follow-up GET. Delayed fetch/JSON v3 responses leave newer v4 data and exports intact; wrong-class responses also suppress success effects. Cross-class/A→B→A and old-GET controls remain passing. Actual SQLite/GET/PUT case retains v4/theory 5 and TSV `5.00`; stale expectedVersion 3 still returns HTTP 409. |
| S4-02 | HIGH | **CLOSED** | Changing to an unloaded class clears the previous record. The original actual-route case issues zero approvals for unseen B; B remains DRAFT. Business/HTTP/network/JSON read failures clear record/snapshot and the editor, block writes/exports, and prevent opening a new editor. Opening an editor during a pending same-class load is also blocked. |
| S4-03 | HIGH | **CLOSED** | Editor class/opening draftVersion remain bound to the reviewed score. Both save and clear reject a v2 editor after v3 loads, send no write, preserve the unsaved `4.75` input, and retain the newer score. Class changes close old editors; rejected mutation payloads do not dismiss a retained editor. |
| S4-04 | MEDIUM | **CLOSED** | Explicit empty BTVN selection stays empty after reload: active sessions `[]`, submitted/assigned `0/0`, averages null, no low-average warning. TSV and recorded image text agree in both raw and scale-5 modes. Subset/all-session and class-filter controls remain passing. |
| S4-05 | MEDIUM | **CLOSED** | Actual parent callback propagates business/HTTP/network/JSON failure without a child success toast; success is reported only after a successful matching reload. Failed reload and stale/superseded scrape completion suppress success and stale follow-up GETs. |
| S4-06 | MEDIUM | **CLOSED** | Formula help matches calculator weights: CP 40/60, DEMO 60/40, TBCK 40/60, with unrounded intermediate means. Asymmetric fixture remains CP1 4.20 / DEMO 3.40 / TBCK 3.48. Rank boundaries 2.49/2.50/3.99/4.00/4.49/4.50 and null/zero explanations agree. Existing TSV/Canvas/chart/Robotics controls pass. |
| R2-01 | MEDIUM | **CLOSED** | Each operation owns its busy request ID; its finally clears that owner's flag even when another operation advanced the shared payload generation. All four IDs advance on class change. New pairings verify completion in either order, success and failure on either side, fetch/body delays, and protection of a newly started same-operation request after A→B→A. Actual approve/reset completes with both flags false at v5 / WAITING_APPROVAL. |

## Code-level closure evidence

- `src/components/teaching-report-card-view.tsx:208-246`: `applyApiPayload` checks `incomingVersion < knownVersion` without an `isFromGet` condition. `_isFromGet` remains an unused compatibility argument; it does not bypass the floor. Valid positive versions advance the per-class floor with `Math.max`; equal versions remain acceptable.
- All six handlers assign `const accepted = applyApiPayload(data, targetClassId, false)` and return on `!accepted` before success effects. Application/check locations: scrape **550/555**, approve **628/637**, sync **701/709**, save **875/881**, clear **969/975**, reset **1038/1044**. Business/HTTP errors remain explicit; applying a valid conflict payload can refresh data without claiming success. The integrated scrape callback has no direct payload; its class/generation check and successful `loadReportCard` result gate success.
- Busy refs are declared at **198-201** and all increment on class change at **348-351**. Request creation/finally checks: scrape **505/582**, approve **602/656**, sync **676/728**, and shared override owner **841/900**, **942/993**, **1013/1059**. Finally checks use active class plus the corresponding busy ID, independently of `opGenRef`. Payloads/errors still use class/generation ownership.
- Both read-failure branches close the editor at **308** and **326**. `openOverrideEditor` explicitly checks `!isClassMatched` and `isLoading` at **735-744**.
- `src/app/homework-grader/page.tsx:268-345` retains the explicit scrape outcome and HTTP/business/error propagation; integration remains at **752-763**. Report card remains the default tab, raw scores remain accessible, and the redundant auto-grader UI is removed while compatibility helpers remain.
- `scripts/test-report-card-v330.ts:15-27` only constructs prohibited-path strings for inequality assertions; it **does not open, read, hash or copy either production file**. Its temporary DB/cache derives from the supplied TEMP DB parent. The old production-DB checksum is gone, including final checksum reads. RC-06 now includes behavioral cases for delayed v3 after v4 across all six actions and both response phases, overlapping-operation cleanup, earlier findings, and security/streamlining checks.
- Both existing probes retain their assertion/control scenarios. The Round 2 probe now records **82 CLOSED / zero OPEN**. Its historical case labels still describe the former defects (for example “late v3 body overwrites…”); current `status` and `observed` values show closure, not a fresh reproduction.

## Fresh command verification

All commands used `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH`, and `ALLOWED_LOCAL_DIRS` below Windows TEMP. TypeScript ran at the original workspace root; every runtime command ran from the TEMP mirror. Recorded command/CWD/exit results: [command-results.json](stage4-round3/command-results.json).

| Command | Fresh result | Evidence |
| --- | --- | --- |
| `npx.cmd tsc --noEmit --incremental false` | **PASS, exit 0** | [TypeScript log](stage4-round3/typecheck.log); successful typecheck emits no output |
| `npx.cmd tsx docs/audits/v330/stage4/probe.mjs` | **PASS, exit 0**; 29 records: 15 CLOSED, 14 passing controls | [Log](stage4-round3/original-probe.log), [observations](stage4-round3/original-probe-observations.json) |
| `npx.cmd tsx docs/audits/v330/stage4-round2/probe.mjs` | **PASS, exit 0**; 82 CLOSED, zero OPEN | [Log](stage4-round3/round2-probe.log), [observations](stage4-round3/round2-probe-observations.json) |
| `npx.cmd tsx scripts/test-report-card-v330.ts` | **PASS, exit 0**, RC-01 through RC-06 including behavioral closure suite | [RC log](stage4-round3/report-card.log) |
| `npx.cmd tsx scripts/test-phase4-codex-repros.ts` | **PASS, exit 0**, terminal Round 1–17 regression summary | [Phase 4 log](stage4-round3/phase4.log) |
| `npx.cmd tsx scripts/test-phase5.ts` | **PASS, exit 0**, all eight groups | [Phase 5 log](stage4-round3/phase5.log) |
| `npx.cmd tsx scripts/test-phase7.ts` | **PASS, exit 0**, TASK-7.1 through TASK-7.3 | [Phase 7 log](stage4-round3/phase7.log) |
| Additional: `npx.cmd tsx docs/audits/v330/stage4-round3/probe.mjs` | **PASS, exit 0**; 959 CLOSED, zero OPEN | [Log](stage4-round3/probe.log), [observations](stage4-round3/observations.json) |

The existing probes are evidence collectors, so exit 0 alone would not establish closure; their current observation statuses were checked. The new probe asserts closure expectations and fails nonzero on any failed assertion. Counts above are **scenario/observation records, not unique assertion counts or distinct findings**; do not add duplicated scenarios across suites into a new coverage total. Existing regression logs contain intentional synthetic failure traces and experimental Node notices; terminal assertions and exit codes determine success.

## New independent Round 3 cases

| Group | Records | What was verified |
| --- | ---: | --- |
| Cross-owner operation pairings | 864 | All 24 ordered pairs across the six actions with different busy owners × delayed fetch/body × either completion order × nine outcome pairs. Outcome pairs cover success/success, plus business, HTTP, network or malformed JSON failure on either side with the other successful. A completed request releases its own flag while the other remains busy; superseded completion cannot alter newer payload/banner/editor state. |
| Same-owner override controls | 6 | Save, clear and reset share one busy owner; all six distinct ordered pairings have their second rendered override control disabled until the first request finishes. |
| A→B→A with a new same operation | 60 | All six actions × fetch/body × five old-request outcomes. Old completion cannot clear the new request's busy flag or overwrite the new class state. |
| Rejected-payload effects | 24 | All six actions × fetch/body × older-version/wrong-class success payload. Retain v4, editor and unsaved input; emit no success or follow-up GET; TSV exports theory `5.00`. |
| Explicit cleanup boundaries | 5 | Four load-failure modes close/block editor. A pending same-class read blocks opening; an equal-version successful read is accepted and restores editor access. |
| **Total** | **959** | **All CLOSED; zero OPEN.** |

Network failures have no JSON body, so their “body-delay” dimension holds fetch rejection instead; the probe documents this explicitly. The cross-owner matrix models enabled component controls and handler ownership; it does not claim all toolbar buttons can be pointer-clicked while an editor overlay is open. Same-owner coverage uses the rendered disabled controls rather than artificially invoking a second disabled action.

The unchanged Round 2 actual-route cases provide additional persistence evidence: the late v3 response leaves database/view at **v4**, CP1 theory **5**, exported theory **5.00**, with **no save toast**. An expected-version-3 write returns **409**. Actual POST approve followed by PUT reset ends at **v5 / WAITING_APPROVAL**, `isApproving=false`, `isSavingOverride=false`.

## Production-data safety and preservation

- **Neither `data/mindx_bot.db` nor `data/running_classes.json` was opened, hashed, copied, modified or used.** No production checksum was taken. These two paths are deliberately excluded from all file manifests and copy operations.
- TEMP root: `C:\Users\QQ\AppData\Local\Temp\mindx-stage4-r3-635944c7170e4f34b6de14a705b9843a`; [recorded path](stage4-round3/temp-root.txt). Runtime mirror is its `workspace` child. Each mandatory runtime command received its own TEMP DB/cache paths; RC further creates/deletes its own disposable subdirectory there.
- [Setup](stage4-round3/setup.ps1) copies only explicit source/script/config/probe trees plus package/TypeScript/startup metadata. It does not enumerate or copy the production data root, browser authentication, `.env` or `.env.local`. A dependency junction references installed `node_modules`. Phase 7 ran after other runtime gates completed, and writes only the mirror's copied `data/config`.
- [Before manifest](stage4-round3/source-before.json) and [verification](stage4-round3/source-verification.json): **166/166 pre-existing protected files retain SHA-256, length and last-write time**, covering all `src/**`, `scripts/**`, `data/config/**`, both original probe/evidence directories and copied metadata. The [verification script](stage4-round3/verify-preservation.ps1) rejects unexpected manifest paths. This proves preservation of the enumerated files; it makes no checksum claim about prohibited production files.
- Changes made by this audit are new Round 3 evidence/report files and append-only summaries in `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, and `CHANGELOG.md`. Existing application/test/probe modifications were already present before the audit and were preserved.
- No live LMS/Teaching calls, browser context, credential extraction, remote score writes or production synchronization were performed. Client-sensitive-import checks and local `127.0.0.1` startup checks pass.

One audit-only preservation-script attempt initially failed because Windows PowerShell wrapped a parsed JSON array in another array. The audit script was corrected to enumerate the manifest normally, then successfully verified all 166 files. This was a reporting-helper issue; none of the seven mandatory commands or the Round 3 probe failed.

## Acceptance limits and final decision

This report supersedes the Stage 4 Round 2 NO-GO **for the requested seven-finding closure scope on the current working files**. Earlier Stage 2/3 acceptance remains unchanged. The original broader TASK-9.6 checklist also names Phase 6, the v3.2 Teaching-project suite, and a named reviewer; those were not newly executed/provided here, so this audit does not mark every release checklist item complete.

Native browser rendering/responsiveness, raster appearance, clipboard permissions/Zalo paste, exact live Teaching layout/formula equivalence, production build and live end-to-end operation remain unverified. Canvas evidence checks generated values/drawing calls. No production release or live-service certification is implied.

**All S4-01..S4-06 and R2-01 are CLOSED. All seven requested commands and the additional independent probe PASS. No remaining blocker was found in this closure scope.**

VERDICT: GO
