# v3.3.0 — Stage 4 Milestone Audit (TASK-9.5 / TASK-9.6)

Date: 2026-10-29 (Asia/Saigon). Auditor: Codex, independent code/security/quality audit. Baseline HEAD: `4f7a87069f0675c27d89ee5d88fd238ea71b4d88`, **including the existing uncommitted working files**. This is an audit of the current files, not just the committed revision.

**Decision: NO-GO.** All five requested regression commands pass, but independent behavioral probes reproduce six open findings: three HIGH and three MEDIUM. In particular, an old class response can replace the currently selected class, and an unreviewed new class can be approved while its data is still loading. No application fixes were made by this audit.

## Scope and method

Reviewed the complete `src/components/teaching-report-card-view.tsx`, its integration and retained helpers in `src/app/homework-grader/page.tsx`, the Stage 4 changes and relevant state/import boundaries in `src/app/syllabus-config/page.tsx`, `src/app/page.tsx`, `src/components/top-navbar.tsx`, and the RC-06 implementation in `scripts/test-report-card-v330.ts`. Cross-checked calculator formulas, report-card GET/POST/PUT/sync routes, repository version handling, and the existing regression harnesses where they affect these flows.

Read `PROJECT_STATE.md` first, then checked `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, and `.agents/skills/team-workflow/SKILL.md`. Consulted the installed Next.js guide at `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md`. The designated Claude reviewer is not available in this environment; Codex performed this independent audit directly. Earlier Stage 2/3 closure decisions are not reopened by this report, and Stage 1 is not re-certified here.

The independent [probe](stage4/probe.mjs) loads the actual component source, instruments it **in memory**, transpiles TSX with esbuild, and executes it with a React-hook simulator. It preserves state, memoization, callback identity, effect dependencies and deferred fetch ordering, and traverses the returned element tree. Canvas calls and clipboard writes are recorded with mocks. One approval case additionally invokes the actual local API handler and actual SQLite repository against a disposable database. This provides reproducible state/API evidence without launching the app against owner data.

## Data isolation and file preservation

- **Neither `data/mindx_bot.db` nor `data/running_classes.json` was opened, hashed, copied, modified or used by the audit tests.** No production-data checksum was taken: that would itself read a prohibited file.
- All test executions used both `MINDX_DB_PATH` and `MINDX_RUNNING_CLASSES_PATH` below Windows TEMP. The independent probe rejects non-TEMP overrides before any repository import.
- The unchanged RC suite reads `data/mindx_bot.db` relative to its current working directory for a checksum. Therefore it ran in a TEMP workspace mirror containing `src`, `scripts`, configuration fixtures and build/startup metadata, **without either owner data file**. Its internal database/cache overrides also remain under TEMP.
- Phase 4, Phase 5 and Phase 7 also ran in that mirror. Phase 7's configuration writes affect only the mirror. The mirror has no copied `.env` or `.env.local`. Its `node_modules` junction points to the installed dependencies.
- TypeScript ran at the real workspace root with both TEMP overrides; it typechecks without executing the application or opening its database.
- [Source manifest](stage4/source-manifest.json): all **14/14** recorded application/test/dependency source files match the copies taken before test execution. No existing application source or test source was edited. The audit adds its report/evidence and appends the required three tracking documents.
- No live LMS/Teaching browser session, remote score write, credential extraction or production synchronization was performed.

TEMP workspace for this run: `C:\Users\QQ\AppData\Local\Temp\mindx-stage4-142e426eea5a4b83ac3ac3bf32e7ef4d\workspace`. Disposable test files remain there for reproducibility.

## Fresh verification results

| Command | Result | Evidence |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | PASS, exit 0 | [TypeScript log](stage4/typecheck.log) |
| `npx tsx scripts/test-report-card-v330.ts` | PASS, exit 0, RC-01 through RC-06 | [RC log](stage4/test-report-card-v330.ts.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | PASS, exit 0 | [Phase 4 log](stage4/test-phase4-codex-repros.ts.log) |
| `npx tsx scripts/test-phase5.ts` | PASS, exit 0 | [Phase 5 log](stage4/test-phase5.ts.log) |
| `npx tsx scripts/test-phase7.ts` | PASS, exit 0 | [Final Phase 7 log](stage4/test-phase7-final.log) |
| `npx tsx <absolute-path-to-stage4/probe.mjs>` | PASS as an evidence collector, exit 0; **six product findings remain OPEN** | [Probe log](stage4/probe.log), [observations](stage4/observations.json) |

The initial Phase 7 mirror run failed because the auditor had not copied `start-bot.bat` / `start-bot.command` into the mirror. After copying those unchanged startup files, a fresh isolated Phase 7 execution passed. The [initial log](stage4/test-phase7.ts.log) is retained; this was a mirror setup error, not a product regression.

The final independent probe records **32 observations**: 14 control records and 18 records associated with the six findings, including a passing rank-boundary control within S4-06. These are observation records, **not assertion totals or 18 distinct bugs**. Its assertions verify the observed behavior, including the reproduced defects; exit 0 does not mean the product is accepted. Windows PowerShell logs may label native stderr output such as dotenv notices as `NativeCommandError`; exit codes and terminal assertions above determine the results.

To rerun the probe, create a new directory under `$env:TEMP`, set both data overrides there, set `ALLOWED_LOCAL_DIRS` to that TEMP directory, and run the absolute probe path with `npx tsx` from the TEMP mirror. **Do not run the existing RC suite at the production workspace root**, because its checksum code would read the real owner database. Preserve the source/config/startup files in the mirror when rerunning the existing gates.

## What is correctly implemented

| Area | Audit result |
| --- | --- |
| Client security boundary | No sensitive environment names, server configuration, SQLite, filesystem or Playwright runtime imports in the changed client components. The report view's calculator dependency is a pure, import-free transformation module. The auto-grader dependency in the page is `import type`, so it does not pull that component into the client graph. |
| Dashboard server boundary | `src/app/page.tsx` remains a Server Component. Its server-side configuration/database imports are appropriate there, and the configuration rendered is the existing safe public projection. This is not evidence of a client secret leak. |
| Local API and browser ownership | UI mutations call local report-card routes; the existing server routes retain local-request guards and delegate scraping/sync to the server queue. Stage 4 adds no browser context or client filesystem path read. Development/start commands bind `127.0.0.1`. |
| Header and structural blocks | Class/track, status badge, version and truncated hash are present. Coding BTVN and detailed CP1/CP2/DEMO/TBCK/classification/rank tables exist. Header correctness during class transitions is blocked by S4-01/S4-02. |
| BTVN values | UI, TSV and recorded image text use calculator fields; zero remains zero, missing values remain `-`, and warning flags use normalized scores below 2.50. Dual-practice task values appear in the practice tooltip. A proper nonempty session subset recalculates the BTVN average correctly. Empty selection fails: S4-04. |
| Robotics | `showBtvnBlock === false` hides the BTVN table and its image button. CP1/CP2 headers use sessions 4/8 for Robotics and 5/9 for Coding. The four stage filters hide the expected evaluation column groups. |
| Scale and sorting | `raw` applies to BTVN; evaluation stages and charts remain on their canonical scale of 5. Probe verifies raw 80 versus normalized 4.00, zero/missing values, and descending/ascending/original name order. Numeric/rank sorting uses calculator totals. |
| Manual override requests | Set, clear and reset actions include `expectedVersion`, and API responses trigger recomputation. Input validation rejects nonfinite/out-of-range values and converts raw BTVN scores with their maximum. The version is not bound to the editor's opening snapshot: S4-03. |
| TSV security | All generated header/data cells pass `sanitizeReportCardTsvCell`. Whitespace is normalized and leading `=`, `+`, `-`, `@` is apostrophe-prefixed. The probe exercises formula-like student IDs and names in the complete export. |
| Table image values | Recorded BTVN and summary Canvas text agrees with the calculator for both scale modes, including CP1 4.20 and TBCK 3.48 in the fixture. Both image handlers contain clipboard and PNG-download paths. Actual browser clipboard permission and raster appearance were not tested. |
| Charts | CP1/CP2 component bars and DEMO product/competency bars use the matching calculator arrays. Probe checks bar counts/heights, red average-line drawing, arithmetic chart averages, dashed 2.50 threshold, dataset hiding and the image-copy call path for all three stages. Chart average is deliberately distinct from weighted stage total. |
| Page integration | `report_card` is the default tab; raw `scores` tab remains. `<TeachingReportCardView>` receives class selection, scrape trigger and callback. `<HomeworkAutoGraderTab>` is removed from the visible page, while its file and compatibility-sensitive page hooks/helpers remain; Phase 4/5 pass. |
| Configuration/navigation | The rubric tab button is hidden; rubric data/API support remains and Phase 7 verifies rubric writes. Dashboard workspace 2/4 cards and navbar labels reflect the new report-card/configuration roles. |

TSV and the summary-image renderer always export all evaluation stages; the stage selector only hides on-screen columns. This is their current full-report behavior, not a claim that those exports reproduce a filtered viewport. The raw-matrix Excel exporter remains on the `scores` tab; this audit does not certify a new `.xlsx` export of the computed Teaching report card.

## Open findings and acceptance criteria

### S4-01 — HIGH — Mutations bypass request/class ownership and overwrite newer UI state

**Locations:** `src/components/teaching-report-card-view.tsx:194-258`, `333-365`, `375-440`, `502-603`.

`loadReqIdRef` protects only competing `loadReportCard` GETs. `applyApiPayload` unconditionally assigns record, snapshot, overrides and report-card data. The scrape, approve, sync, set-override, clear-override and reset-override handlers all apply their payload after awaiting the network without checking the selected class or operation generation. Their error/toast/finally updates are also unscoped. Scrape additionally calls `loadReportCard` using its captured old class after it finishes, which can become the newest load request and invalidate the current class's pending GET.

**Reproduction:** load A; start one of those six handlers with a deferred response; switch to B and complete its GET; release A's response. For every handler, the probe observes `record.classId === snapshot.classId === 'A'` while the heading remains `LỚP B`. A second case releases A's action while B's GET is pending: A initializes the session selection to `[1,2]`; B subsequently loads its sessions `[6,7]`, but `applyApiPayload` preserves that non-null selection. B then has zero effective BTVN sessions despite a valid B snapshot. A third case starts a same-class GET at v2, accepts a mutation at v3, and then accepts the old GET, regressing the visible version to v2.

**Impact:** scores, status, available-class controls and exports can describe the wrong class; stale filters can suppress BTVN totals. Follow-up actions can use a mismatched record version, and an older GET can restore stale approval/score state after a successful write.

**Required correction:** bind every response/state update to a captured class and request generation, including scrape's follow-up load and error/finally paths. Invalidate pending GETs when a mutation supersedes them, and reject older revisions. Reset/reconcile filters by class identity; do not let another class initialize them.

**Acceptance:** delay both fetch and JSON consumption, reorder GET/mutation completions, and switch A→B→A for all six actions. Only the active class/current revision may update its view; B's session selection must derive from B, and a v2 GET must not replace accepted v3 state. Existing latest-GET control must remain passing.

### S4-02 — HIGH — Approve/sync/export remain usable with the previous class's record during loading

**Locations:** `src/components/teaching-report-card-view.tsx:253-258`, `368-382`, `407-420`, `1254-1297`, `1486-1499`, `1533-1537`.

The class-change effect resets only the session filter and starts loading. It does not clear or qualify `record`, `snapshot`, `overrides` and `serverReportCard`. The loading branch replaces the tables but leaves the header actions and copy toolbar active. Approve checks only for a computed nonempty report and its own busy state; sync checks the retained record's status. Neither requires `record.classId === effectiveClassId`, a matching snapshot or `!isLoading`.

**Reproduction with real temporary SQLite/API:** seed `AUDIT-S4-A` and `AUDIT-S4-B` at draft version 2; load A; select B and hold B's GET. `isLoading` is true, record still belongs to A, and the approve button is enabled. Clicking it sends `{classId:'AUDIT-S4-B', expectedVersion:2}`. The actual local `POST /api/report-card` accepts it and B becomes **APPROVED before B's GET completes**. There is no server conflict because versions are per class and happen to match.

**Impact:** the teacher can approve unseen B scores with A's retained version. If B is already approved/verified and versions match, the analogous sync request can also pass its backend prerequisites. The probe does not execute that remote sync. Copy handlers can export A while the selected header names B.

**Required correction:** define a class-matched, fully-loaded view invariant and require it for approval, sync, override/reset and exports. Clear or hide obsolete state on class changes/load failures. Guard handlers as well as buttons so a stale event callback cannot bypass the invariant. Close or invalidate editors whose class no longer matches.

**Acceptance:** with equal versions and delayed/failing B GETs, no approval/override/sync request or stale export is allowed. Re-enable only after a successful matching B payload. The real temporary repository must show B unchanged until B's data has been loaded for review.

### S4-03 — HIGH — Manual editor silently adopts a newer version and overwrites a newer score

**Locations:** `src/components/teaching-report-card-view.tsx:68-81`, `444-465`, `505-516`.

`OverrideModalState` captures the original score and student/field but neither class nor draft version. When another load or operation replaces the record while the editor remains open, `handleSaveManualOverride` sends the **current** `record.draftVersion` with the **old editor value**. Consequently the optimistic-concurrency check does not protect the data the teacher originally reviewed.

**Reproduction:** open the CP1 theory editor at v2, score 2. Refresh the same class to v3, score 5, without closing the editor. The table now computes 5, but saving the unchanged editor submits `normScore:2, expectedVersion:3`, rather than using v2 and receiving a conflict. A successful write can overwrite the newer 5. This can occur when a scrape already in flight completes while an editor is open; cells are not disabled during scraping.

**Required correction:** capture class and expected version when opening the editor and use that version for set/clear. If the underlying report changes, require explicit refresh/review of the editor or reject the stale save. Preserve unsaved user input when presenting a conflict.

**Acceptance:** open at v2, refresh to v3, then save/clear: receive a stale-editor conflict or require reopening; v3's score must remain intact. Repeat with class switching and a student enrolled in both classes.

### S4-04 — MEDIUM — Deselecting the last BTVN session silently selects every session

**Locations:** `src/components/teaching-report-card-view.tsx:1387-1406`; `src/lib/report-card/report-card-calculator.ts:485-490`.

The checkbox handler allows `selectedBtvnSessions = []`, but the calculator treats both an undefined selection and an empty array as “all sessions”. The checkboxes are rendered from the calculator's effective session list. Starting from only session 1 selected and unchecking it therefore rechecks all sessions and recalculates the average over all sessions, instead of leaving no sessions selected or retaining a documented minimum selection.

**Observed:** requested selection `[]`; effective selection `[1,2]`. A valid selection `[1]` correctly produces BTVN average 3.50, so this is specifically the empty-selection boundary. The fallback is in the earlier calculator, but Stage 4 newly exposes it as a usable checkbox interaction; this is a Stage 4 integration finding rather than attribution of a new calculator edit.

**Required correction:** distinguish omitted selection from explicit empty selection, or disallow removing the final session with clear feedback. Apply the chosen semantics consistently to UI, averages, TSV and Canvas exports.

**Acceptance:** repeatedly uncheck the final selected session; no silent “select all” or unexpected change of grading denominator occurs. Test none/one/subset/all and class changes.

### S4-05 — MEDIUM — Integrated scrape failure is announced as successful

**Locations:** `src/app/homework-grader/page.tsx:269-350`, `740-749`; `src/components/teaching-report-card-view.tsx:333-365`, `220-247`.

The primary page supplies `handleScrapeScores` as `onRequestScrapeLms`. That parent handler records failure in `statusMessage` and resolves normally on an API failure or caught exception; it does not return a success result or throw. The child treats any resolved callback as successful, loads the cached card, and always announces “Đã quét & tính toán… từ LMS!”. `loadReportCard` also catches failures and returns no status, so a failed post-scrape GET still leads to that success toast.

**Reproduction:** run the actual parent's handler with `{success:false,error:'synthetic scrape rejected'}` and pass it as the child callback. Parent reports failure while child reports success. Separately, a successful callback followed by a failed GET displays `reload failed` together with the same success toast.

**Impact:** a teacher may trust old cached scores as a freshly scraped/calculated report, then approve or synchronize them.

**Required correction:** return a typed scrape result or propagate failures from the parent; make reload success explicit too. Announce success only after a successful class-matched scrape and read. Keep one consistent outcome across parent and child messages.

**Acceptance:** business failure, HTTP failure, network exception, cancelled/stale scrape and reload failure all produce no success claim. A successful scrape/read produces exactly the appropriate success outcome for its class.

### S4-06 — MEDIUM — Formula help, rank legend and missing-score explanations contradict computed results

**Locations:** `src/components/teaching-report-card-view.tsx:1752-1768`, `2004-2007`, `2198-2218`; `src/lib/report-card/report-card-calculator.ts:269-307`, `316-342`, `424-455`.

The table/TSV/Canvas totals come from the shared calculator, but the explanatory UI hardcodes a different grading scheme:

| Rule | Shown in UI | Actual calculator |
| --- | --- | --- |
| CP total | `0.5 × TB(LT,TH) + 0.5 × NL` | `0.4 × TB(LT,TH) + 0.6 × NL` |
| DEMO total | `0.5 × Product + 0.5 × NL` | `0.6 × Product + 0.4 × NL` |
| TBCK | `0.6 × TB(CP1,CP2) + 0.4 × DEMO` | `0.4 × TB(CP1,CP2) + 0.6 × DEMO` |
| A boundary | `≥4.00` | `≥4.50`, complete/nonzero components |
| B boundary | `≥3.25` | `≥4.00`, complete/nonzero components |
| Any missing/zero component | Always D | Prevents A/B, but C is possible when TBCK ≥2.50 |

The displayed formula also rounds the LT/TH mean before weighting and the CP mean before weighting. The calculator weights their unrounded means and rounds the resulting totals; that order must be documented accurately too. Partial stages use available LT/TH and zero for missing weighted parts; fully missing stages remain blank.

**Reproduction:** CP1 `(LT=2,TH=4,NL=5)`, CP2 `(4,2,3)`, DEMO `(Product=5,NL=1)`. Actual totals are **4.20 / 3.00 / 3.40, TBCK 3.48**. Following the help text gives **4.00 / 3.00 / 3.00, TBCK 3.30**. All components at 4.00 produce Hạng B although the legend says A; 3.25 produces C although the legend says B. With all components 5 except missing CP1 LT, the actual row has TBCK 5.00 / Hạng C, while the tooltip says it was lowered to D.

**Required correction:** align all help/legend/tooltip text with the accepted shared calculator rules and rounding order, preferably using shared rule constants. If the intended Teaching rules have changed, reconcile calculator, persisted hashes, synchronization and tests as a separate reviewed change; do not simply change score math to match these labels.

**Acceptance:** asymmetric-score, rounding-boundary, 3.25/4.00/4.50, zero, partial and fully missing fixtures must agree across formula help, legend, table, TSV, Canvas and backend. The current finding is the demonstrable internal contradiction; it does not establish which live Teaching rules are authoritative.

## RC-06 coverage and remaining verification limits

RC-06 (`scripts/test-report-card-v330.ts:3096-3211`) checks five sanitizer examples, forbidden-token strings in four client files, presence of UI/action markers, retention of the auto-grader file, absence of the rubric-tab action, and the new navbar text. It **does not mount the UI or exercise delayed responses, version-bound editors, checkbox behavior, formula/rank agreement, Canvas datasets or clipboard handlers**. Thus its pass is compatible with all six findings. Add meaningful behavioral regressions for the cases above; additional marker assertions will not close them.

The supplied reference [Teaching page](https://teachingmindx.top/diem-tong-ket.php) was attempted through the read-only web tool, which returned that the URL was inaccessible. No authenticated page, current PHP source or visual reference was available. **Exact live Teaching layout/formula equivalence is unverified.** The internal formula contradiction is established without needing live access.

No real-browser rendering, pixel comparison, responsive layout/theme acceptance, native clipboard authorization, actual Zalo paste or live LMS/Teaching end-to-end operation was performed. Canvas evidence checks drawing commands and values with mocks, not font metrics, PNG raster quality or OS clipboard behavior. Those limitations are explicit; they are not counted as additional product defects. The requested five regression commands were run; broader project gates such as Phase 6 and the v3.2 Teaching-project suite are outside this run.

## Numbered findings and final decision

| No. | ID | Severity | Status | Finding |
| --- | --- | --- | --- | --- |
| 1 | S4-01 | HIGH | OPEN | Late mutations/GETs overwrite active class or newer revision; stale class filters can survive the winning GET. |
| 2 | S4-02 | HIGH | OPEN | Previous class state leaves approval/sync/export enabled before the new class is loaded; actual unseen-class approval reproduced. |
| 3 | S4-03 | HIGH | OPEN | Manual editor uses a newer record version with an older score, defeating optimistic-concurrency intent. |
| 4 | S4-04 | MEDIUM | OPEN | Removing the final selected BTVN session silently selects all sessions. |
| 5 | S4-05 | MEDIUM | OPEN | Failed integrated scrape/reload still produces a success message. |
| 6 | S4-06 | MEDIUM | OPEN | Help formulas, rank thresholds and missing-score explanations contradict calculated scores/ranks. |

TASK-9.5 / TASK-9.6 remain pending acceptance. Close these six findings with behavioral regressions and fresh requested gates before advancing this milestone. Earlier Stage 2/3 closure acceptance remains unchanged; no production-data or live-service acceptance is implied.

VERDICT: NO-GO
