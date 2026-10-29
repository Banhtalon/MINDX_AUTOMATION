# v3.3.0 — Stage 4 Closure Audit, Round 2

Date: 2026-10-29 (Asia/Saigon). Scope: **TASK-9.5 / TASK-9.6**. Auditor: Codex, independent Principal Engineer / Security and Quality Auditor. Baseline HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`, **including the pre-existing uncommitted working files**.

**Decision: NO-GO.** Five Round 1 findings are CLOSED. **S4-01 remains PARTIALLY FIXED / OPEN (HIGH)** because a delayed mutation response can replace a newer same-class GET, including its displayed/exported scores. **R2-01 is a new MEDIUM regression:** overlapping operation types can leave a completed operation permanently busy. All six requested commands pass; the additional ordering scenarios below reproduce both blockers through actual local API handlers and disposable SQLite as well as component probes. No application fixes were made.

## Scope and audit method

Read `PROJECT_STATE.md` first, then cross-checked `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, the Round 1 [report](CODEX_STAGE4_AUDIT.md), and `.agents/skills/team-workflow/SKILL.md`. Reviewed the current report-card component, parent scrape callback, RC-06 tests and updated original probe; cross-checked the calculator, report-card routes, repository version checks, client/server import boundaries and operation controls. Consulted the installed Next.js guide at `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md`. The designated Claude reviewer is unavailable in this environment; Codex performed the requested independent audit directly.

The supplied [Stage 4 probe](stage4/probe.mjs) was run unchanged in TEMP. The supplemental [Round 2 probe](stage4-round2/probe.mjs) reuses its fixture/hook/element-tree harness and adds independently written cases. It instruments actual component source **in memory**, preserving state, refs, effect dependencies, callback identity and deferred fetch/JSON ordering. Clipboard and Canvas calls are recorded with mocks. The real-API cases invoke the actual GET, POST and PUT route handlers and actual SQLite repository against fresh synthetic TEMP records; no HTTP server or remote Teaching/LMS write is needed.

Earlier Stage 2/3 closure decisions are unchanged. Passing RC-01..RC-06 here is regression evidence, not fresh acceptance of all earlier/later milestones.

## Data safety and preservation

- **Neither `data/mindx_bot.db` nor `data/running_classes.json` was opened, hashed, copied, modified or used.** No production-data checksum or content comparison was attempted.
- Every command received both `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` below Windows TEMP. Runtime commands ran from a TEMP workspace mirror with copied `src`, `scripts`, `data/config`, the original probe, package/TypeScript metadata and startup scripts. Neither prohibited owner file nor `.env` / `.env.local` was copied. The mirror uses a `node_modules` junction to the installed dependencies.
- This mirror is necessary: `scripts/test-report-card-v330.ts:15-18` still hashes `data/mindx_bot.db` relative to its working directory when that file exists. An environment override alone would not prevent that production read. In the mirror that path has no owner database; the test creates its own further TEMP database/cache paths. Phase 7 configuration writes are likewise confined to the mirror.
- TypeScript ran at the original workspace root with TEMP overrides. It typechecks source without executing application/database initialization.
- All **135/135** pre-recorded source, script, configuration and original-probe files retain their SHA-256, length and modification time. See [before manifest](stage4-round2/source-before.json) and [verification](stage4-round2/source-verification.json). The manifest deliberately excludes both prohibited owner files. No application source, existing test or existing probe was edited.
- Audit changes are this report, new Round 2 evidence/probe files and append-only entries in the three required tracking documents. No browser context, live credentials or remote data mutation was used.

TEMP root for this run: `C:\Users\QQ\AppData\Local\Temp\mindx-stage4-round2-8bc1dc5b08af4f4db28fa0eb3a902af5`. Disposable fixtures remain there. Its path is also recorded in [temp-root.txt](stage4-round2/temp-root.txt).

## Fresh verification results

On Windows, `npx.cmd` was used to execute the requested `npx` commands.

| Requested command | Result | Evidence |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit 0, initial and final after probe finalization | [Initial](stage4-round2/typecheck.log), [final](stage4-round2/typecheck-final.log) |
| `npx tsx docs/audits/v330/stage4/probe.mjs` | PASS, exit 0; 29 records: 15 closure records and 14 controls | [Log](stage4-round2/probe.mjs.log), [observations](stage4-round2/original-probe-observations.json) |
| `npx tsx scripts/test-report-card-v330.ts` | PASS, exit 0; RC-01 through RC-06 | [RC log](stage4-round2/test-report-card-v330.ts.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0 | [Phase 4 log](stage4-round2/test-phase4-codex-repros.ts.log) |
| `npx tsx scripts/test-phase5.ts` | PASS, exit 0 | [Phase 5 log](stage4-round2/test-phase5.ts.log) |
| `npx tsx scripts/test-phase7.ts` | PASS, exit 0 | [Phase 7 log](stage4-round2/test-phase7.ts.log) |
| Additional: `npx tsx docs/audits/v330/stage4-round2/probe.mjs` | Collection/assertions complete, exit 0; **82 records: 60 CLOSED/control, 22 OPEN** | [Supplemental log](stage4-round2/probe.log), [observations](stage4-round2/observations.json) |

These are **observation records, not assertion totals or distinct finding counts**. Of the 22 OPEN records, 18 concern S4-01 (12 delayed-response cases, five rejected-identity notification cases, one real API/SQLite case); four concern R2-01 (three operation types plus one real API/SQLite case). Supplemental exit 0 means evidence collection/assertions completed; its OPEN records make this gate NO-GO.

During supplemental harness development, initial attempts failed because of auditor setup/fixture errors (PowerShell prefix splitting, missing seeded override for a conditionally rendered reset button, and a success fixture without `rows`). Those were corrected in the new audit harness only. The final complete execution above passed its assertions. PowerShell may render native stderr notices as `NativeCommandError`; the recorded exit codes and completed terminal assertions determine command results.

## Round 1 finding disposition

| ID | Severity | Round 2 status | Verified behavior / remaining gap |
| --- | --- | --- | --- |
| S4-01 | HIGH | **PARTIALLY FIXED / OPEN** | Cross-class responses, A→B→A, stale errors/finally updates, old pre-mutation GETs and BTVN filter contamination are blocked. A mutation's older response can still replace a newer GET because only GET payloads receive the version-floor check. See blocker below. |
| S4-02 | HIGH | **CLOSED** | Matching record/snapshot/computed class identities gate actions. Changing to unloaded B clears A; the supplied real TEMP repository case observes zero approval requests and B remains DRAFT until its GET completes. Business/HTTP/network/JSON reload failures clear record/snapshot and block mutation handlers plus TSV/image exports. |
| S4-03 | HIGH | **CLOSED** | Editor captures class and opening version. Both save and clear at v2 are blocked after v3 loads; no mutation is sent, newer scores remain intact and unsaved input `4.75` remains in the modal. Class changes close the editor; stale handlers retain class checks. |
| S4-04 | MEDIUM | **CLOSED** | Explicit `[]` retains zero active sessions, `0/0` submitted/assigned, null raw/normalized averages and no low-average flag. Empty selection survives same-class reload and matches TSV/Canvas output in both scales. One-session/subset/all and class filter initialization controls pass. The calculator's legacy empty-array fallback still exists; this UI deliberately handles empty selection before calling that option. |
| S4-05 | MEDIUM | **CLOSED** | The actual parent callback returns an outcome. Business rejection, HTTP failure, network error and JSON error produce a child error without success toast; the success case produces success. A failed post-scrape read suppresses the child's success toast. Old-class operations cannot publish a later success/error or issue their stale follow-up GET. |
| S4-06 | MEDIUM | **CLOSED** | Formula modal/legend match 40% LT+TH / 60% NL for CP, 60% product / 40% NL for DEMO, and 40% mean CP / 60% DEMO for TBCK, using the calculator's unrounded intermediate means. Fixture results are CP1 4.20, DEMO 3.40, TBCK 3.48. Boundaries 2.49/2.50/3.99/4.00/4.49/4.50 classify correctly; null and zero component tooltips correctly describe C or D according to TBCK. |

Precision about the implementation claims: same-class load failure does **not** clear `selectedBtvnSessions` or `overrideModal`, and `openOverrideEditor` does not itself check `isClassMatched`/`isLoading`. Nevertheless a failed read clears the record/snapshot, the score table disappears, and the guarded save/clear/reset/export handlers issue no request or export. The retained editor/filter is not counted as another blocking data-safety finding. The report does not claim every described cleanup was implemented verbatim.

## Remaining blocker: S4-01 — delayed mutation can regress a newer same-class view

**Severity: HIGH. Status: PARTIALLY FIXED / OPEN.**

**Locations:** `src/components/teaching-report-card-view.tsx:202-239` (`applyApiPayload`, especially `isFromGet` at line 227); `:277-309` (GET captures but does not advance the operation generation); mutation application at `:540`, `:614`, `:683`, `:851`, `:941`, `:1006`.

`latestVersionByClassRef` is updated for accepted payloads, but an incoming version lower than that floor is rejected **only when `isFromGet` is true**. All six mutation handlers call `applyApiPayload(..., false)`. A later GET can read newer state without changing `opGenRef`; the older pending mutation therefore still passes its class/generation guard and bypasses the version floor.

**Reproduction with actual routes and TEMP SQLite** ([probe](stage4-round2/probe.mjs:321)):

1. Seed synthetic class `AUDIT-S4-R2-REAL` at v2, CP1 theory 2. Open its editor, enter 1 and invoke the component's save handler.
2. The actual PUT succeeds at v3. Hold delivery of that response's JSON body.
3. A second valid PUT uses expected version 3 to set CP1 theory to 5; SQLite advances to v4. Trigger the component's normal `scrapeTrigger` refresh effect. Its actual GET loads v4/theory 5.
4. Release the first successful PUT's v3 body. The component replaces v4 with v3/theory 1, closes the editor and announces the old save as successful.
5. Copy TSV: CP1 LT exports **`1.00`**, while the repository remains at **v4/theory 5**. A separate stale write using expected version 3 returns **HTTP 409**, confirming the server version guard still protects persistence.

Synthetic orderings reproduce the same v4→v3 regression for approve, sync, save, clear and reset, with both deferred fetch delivery and deferred JSON consumption. Standalone scrape also temporarily applies v3 before its subsequent GET finishes; its final follow-up can repair the view. No real Teaching sync or LMS scrape was performed for those mocked service cases.

**Impact:** the teacher can view and export superseded scores and approval/status/hash data after having already seen newer data. This is a demonstrated UI/export integrity failure; it is **not** evidence that this ordering overwrites v4 in SQLite or bypasses the server's expected-version check.

**Related boundary:** all five non-scrape mutation handlers ignore `applyApiPayload`'s boolean return. A deliberately wrong-class success payload is rejected for state application but still yields an A-success toast (approve even displays B's hash), and save/clear close the editor. These five records are response-validation controls, not a claim that the current server naturally returns a wrong-class payload. They belong to the same incomplete response-acceptance handling and are not a separate blocker count.

**Required correction / closure criteria:** enforce monotonically accepted versions for mutation payloads as well as GETs; keep conflict/failure payload refresh behavior explicit. Success UI and editor dismissal must depend on acceptance of the matching payload. Add persistent regression cases for mutation-start → newer GET → delayed mutation fetch/JSON completion, all six actions, and rejected identity, while preserving the passing A→B→A cases. The actual SQLite/GET/PUT ordering above must retain v4/theory 5 in the view and export.

## New regression: R2-01 — superseding operation strands the previous busy flag

**Severity: MEDIUM. Status: OPEN.**

**Locations:** `src/components/teaching-report-card-view.tsx:495`, `:588`, `:658`, `:817`, `:914`, `:981` (shared generation increments); guarded cleanup at `:566-572`, `:636-642`, `:704-710`, `:870-876`, `:959-965`, `:1021-1027`; independently enabled operation buttons at `:1687`, `:1698-1705`, `:1713-1719`, `:1880-1885`.

Each operation owns a separate busy flag, but cleanup now also requires its generation to equal a **single shared** `opGenRef`. The JSX allows different operation types concurrently: for example the reset button is enabled while approval is pending, because it checks only class/loading/override-saving state. Reset advances the shared generation and clears only `isSavingOverride`. The first operation's `finally` then refuses to clear `isApproving` even after that request has completed. There is no same-class recovery path that clears that flag.

**Real API/SQLite reproduction** ([probe](stage4-round2/probe.mjs:373)): load a synthetic record with an override; approve through the actual POST and hold its response body; click the **enabled** reset button and complete the actual PUT; release the approval body. Both requests finish, SQLite and the component agree on **v5 / WAITING_APPROVAL**, but `isApproving === true` and `isSavingOverride === false`. The approve button remains disabled and displays “Đang duyệt…”. Changing class/remounting resets the stranded state; simply finishing the requests does not.

Synthetic controls also reproduce permanently busy `isSyncingTeaching` and `isScrapingLms` when their operation is superseded by reset. The reset remains enabled in the actual element tree in all three cases; this does not depend on calling a disabled control artificially.

**Impact:** normal overlapping toolbar actions can disable approval, sync or scrape until the teacher switches class or reloads the page, with a false indication that work is still running. This is a regression of the new generation-scoped cleanup rather than another score-calculation bug.

**Required correction / closure criteria:** either prevent cross-type overlap consistently at both control and handler entry, or track busy ownership per operation/request so each completed request can release its own flag without changing another request's state. Preserve stale-class/generation protections for payloads and banners. Exercise every allowed operation pairing with success, failure and delayed JSON; all completed operations must leave correct, usable controls, including the actual approve/reset sequence above.

## Other regression and security checks

- Existing controls continue to verify raw/scale-5 UI and TSV/Canvas values, zero versus missing values, TSV formula-injection protection, sorting, CP1/CP2/DEMO chart bars/averages/thresholds/toggles, Robotics BTVN hiding and stage-column filters.
- Changed client components have no runtime SQLite/filesystem/Playwright/configuration import or sensitive environment access. The report calculator remains a pure client-safe dependency; the parent grader type import remains type-only. Dashboard database/configuration imports remain in its Server Component.
- Report-card routes retain local-request validation and expected-version checks; scraping/sync still delegates through the server queue. This closure change adds no browser context or unqueued browser automation. Package dev/start commands remain bound to `127.0.0.1`.
- UI streamlining/navigation and retained backend rubric/grading helpers pass the requested Phase 4/5/7 compatibility gates.

## Reproduction and acceptance limits

Run the supplied and supplemental probes from the described TEMP mirror, with a **fresh** DB path and cache path below TEMP for each execution, and `ALLOWED_LOCAL_DIRS` set to that TEMP root. Both probes reject non-TEMP overrides. The supplemental probe writes its own adjacent `observations.json`; the original probe writes its original adjacent observation file **inside the mirror**. Run the existing RC suite only from a mirror without owner data, owing to its working-directory checksum behavior. No existing source/test/probe requires modification to reproduce these results.

Native browser clipboard permissions, actual raster appearance/layout, live LMS/Teaching behavior, a full production build and all unrelated release gates were not exercised. Mocked Canvas/clipboard evidence certifies generated content/call paths, not native rendering. This decision covers the requested current Stage 4 closure scope, not a production release certification.

TASK-9.5 and TASK-9.6 remain pending until S4-01 and R2-01 meet the closure criteria above and the requested gates are rerun on that corrected state. Round 1 is superseded only by the explicit dispositions in this report.

VERDICT: NO-GO
