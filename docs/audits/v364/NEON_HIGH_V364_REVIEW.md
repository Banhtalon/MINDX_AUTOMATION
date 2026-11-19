# Independent Adversarial Audit — MINDX-AUTOMATION v3.6.4 (Round 3 Final Verification)

- **Reviewer:** Independent Senior Adversarial Auditor (`auditor`)
- **Date:** 2026-11-19
- **Scope:** Full diff & source review of `src/lib/gemini/client.ts`, `src/lib/gemini/spck-demo-sheet-scorer.ts`, `src/lib/playwright/spck-demo-sheet.ts`, `src/components/final-project/useSpckWorkflow.ts`, `src/app/api/spck/create-demo-sheet/route.ts`, `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx`, and `scripts/test-demo-sheet-resilience-v364.ts`, verifying all 8 Codex Round 1 findings (`docs/audits/v364/codex-review.md`) and all 5 Round 2 findings (`R2-MEDIUM-1`, `R2-LOW-1`, `R2-LOW-2`, `R2-INFO-1`, `R2-INFO-2`).

---

## Round 1 Findings Verification (`docs/audits/v364/codex-review.md`) — 8/8 CLOSED

| Round 1 ID | Finding Summary | Status | Verification Evidence |
|---|---|---|---|
| **HIGH-1** | Student names can reach Gemini in link URLs (`spck-demo-sheet-scorer.ts`) | **CLOSED** | `sanitizeRelatedLinkUrlForPrompt` + `scrubContiguousNameSlugs` (`src/lib/gemini/spck-demo-sheet-scorer.ts:427-554, 642-650, 843-858`) strips valid & malformed URL credentials, runs 2-pass percent-decoding (NFC & NFD), and redacts accented/ASCII hyphenated, underscored, dot, `+`, whitespace, and concatenated slugs across the target student plus all active and inactive (`isActive = 0`) class DB peers (`PROBE-A2`, `PROBE-B1..B7`, `R3-P1`, `R3-P2`, `V364-05` 5e). |
| **HIGH-2** | PII can reach logs (`spck-demo-sheet-scorer.ts`, `client.ts`) | **CLOSED** | Fallback logs use `${normalizedClassId}/${anonymousToken}` (never `stu.studentId`) + allowlist-only `summarizeSafeGeminiErrorForLog` + `sanitizeRetryLabelForLog` (`src/lib/gemini/client.ts:176-222`, `src/lib/gemini/spck-demo-sheet-scorer.ts:1091-1095`, `src/lib/playwright/spck-demo-sheet.ts:2533-2536, 2604-2608`). Verified with hostile `err.message`, `err.code`, URLs, API keys, and `STU_*` labels (`PROBE-A1B`, `PROBE-C5`, `R3-P1`). |
| **HIGH-3** | Stop Bot does not abort an in-flight Gemini call (`client.ts`) | **CLOSED** | `awaitWithAbortRace` (`src/lib/gemini/client.ts:256-311`) polls `isAbortRequested` every 20ms (`.unref()`), re-checks before settle, cleans up timer, and attaches `workPromise.catch(() => null)`. Verified for both `shouldAbort` (`V364-05` 5d) and global `process.__mindxQueueStopped` with late rejection (`PROBE-C6`, aborted in 62ms, 0 `unhandledRejection`). |
| **MEDIUM-1** | Permanent API errors get a second call in the scorer (`spck-demo-sheet-scorer.ts`) | **CLOSED** | `invokeLiveRawText(0.2)` (`src/lib/gemini/spck-demo-sheet-scorer.ts:967-993`) sits outside the JSON-parse `try/catch`. Verified `401`, `403`, `400`, and `SAFETY` each make strictly 1 API call; malformed JSON makes 1 repair call at `temperature=0.1`; Stop Bot before repair suppresses the 2nd call (`PROBE-D-LIVE-SCORER-CALLS`). |
| **MEDIUM-2** | Several common network codes are not classified as transient (`client.ts`) | **CLOSED** | `collectErrorChainSummary` (`src/lib/gemini/client.ts:56-112`) traverses both `.cause` and `AggregateError.errors` via bounded BFS (`visited < 16`, `depth < 3`, cycle guard `seen`), and `TRANSIENT_NETWORK_RE` matches 14 POSIX/Undici network codes (`ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ENETUNREACH`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `EPIPE`, `UND_ERR_*`). Verified direct, 3-hop `.cause`, circular `.cause`, and standalone/nested/circular `AggregateError` (`PROBE-C1`, `PROBE-C3`, `R3-P3`). |
| **MEDIUM-3** | `maxRetries: Infinity` is accepted (`client.ts`) | **CLOSED** | `MAX_GEMINI_RETRIES_CAP = 6`, `normalizeMaxRetries`, and `normalizeBoundedMs` (`src/lib/gemini/client.ts:6, 25-48, 320-333`) bound `Infinity`, `999`, negative, `NaN`, and float values cleanly (`PROBE-C4-MAXRETRIES-BOUNDS`). |
| **LOW-1** | Retry hints longer than the cap are shortened (`client.ts`) | **CLOSED** | `extractRawRetryHintMs` + `maxRetryHintMs` (`src/lib/gemini/client.ts:245-254, 328-333, 350-360`) honors both `retry in Xs` and `"retryDelay": "Xs"` hints up to `maxRetryHintMs` without shortening down to `maxDelayMs`, and fails fast if the server asks longer than `maxRetryHintMs` (`V364-05` 5c, `PROBE-C5`). |
| **LOW-2** | The all-fallback banner can misstate why scoring was skipped (`useSpckWorkflow.ts`) | **CLOSED** | Structured `skipReasons` (`noEvidenceCount`, `parseErrorCount`, `aiErrorCount`) is computed in `spck-demo-sheet-scorer.ts`, propagated via `spck-demo-sheet.ts` and `src/app/api/spck/create-demo-sheet/route.ts:116`, and rendered accurately in `src/components/final-project/useSpckWorkflow.ts:1859-1884`. |

---

## Round 2 Findings Verification — 5/5 CLOSED

| Round 2 ID | Severity | Finding Summary | Status | Round 3 Verification Evidence |
|---|---|---|---|---|
| **R2-MEDIUM-1** | MEDIUM | `peerNames` omitted inactive/unselected DB classmates, and `V364-05` (5e) silently swallowed its own failing PII assertion | **CLOSED** | `src/lib/gemini/spck-demo-sheet-scorer.ts:642-650` now merges `studentRepo.findByClass(normalizedClassId, false)` (verified in `src/lib/db/sqlite.ts:564-570` that `onlyActive = false` returns both active and `isActive = 0` students) with `params.studentTabs` into deduplicated `peerNames`. `scripts/test-demo-sheet-resilience-v364.ts:908-1001` seeds inactive `Phạm Gia Huy` (`isActive: 0`), captures `promptText` in `capturedPromptTexts`, runs all PII assertions **outside** `generateDemoSheetAiPreScoresForClass` on `CÁC ĐƯỜNG DẪN LIÊN QUAN:`, and asserts `joinedWarns.includes("HTTP 503 (high_demand)")`. Independently confirmed by `R3-P1`. |
| **R2-LOW-1** | LOW | `collectErrorChainSummary` did not traverse `AggregateError.errors` | **CLOSED** | `src/lib/gemini/client.ts:56-112` implements bounded BFS (`visited < 16`, `depth < 3`, cycle guard `seen`) traversing both `.cause` and `cur.errors.slice(0, 4)`. Independently confirmed by `R3-P3` on standalone, nested, circular, and permanent (`403`) `AggregateError` instances. |
| **R2-LOW-2** | LOW | Narrow popup tab leak window on Stop Bot before `convertedPage` assignment | **CLOSED** | `src/lib/playwright/spck-demo-sheet.ts:2055-2135, 2336-2404` hoists `openedPopupPage` and closes any orphaned popup tab in `finally` in both `createNativeGoogleSheetViaDriveAndImport` and `createNativeGoogleSheetViaSaveAsFallback`. Independently confirmed by `R3-P4B` (Stop Bot fired right after `/slow-popup` opened -> 0 leaked tabs). |
| **R2-INFO-1** | INFO | Malformed credential URL without TLD retained embedded password | **CLOSED** | `src/lib/gemini/spck-demo-sheet-scorer.ts:532-535` strips `user:pass@` via fallback regex in `catch`. Independently confirmed by `R3-P2` (`http://kimdactruong:SuperSecretPass99@localhost:badport/pham-gia-huy` -> `http://localhost:badport/STUDENT_PEER`). |
| **R2-INFO-2** | INFO | Initial `#docs-file-menu` wait ignored custom `totalTimeoutMs` | **CLOSED** | `src/lib/playwright/spck-demo-sheet.ts:1948-1951` honors `params.totalTimeoutMs !== undefined ? Math.max(1000, totalTimeoutMs) : 25_000`. Independently confirmed by `R3-P4A` (0 leaked tabs, rapid fail on missing `#docs-file-menu`). |

---

## Open Findings (Round 3)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
None.

### INFO
None.

---

## Round 3 Commands & Results

| Command | Exit Code | Result Summary |
|---|---|---|
| `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | `0` | Clean — 0 TypeScript errors |
| `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-sheet-resilience-v364.ts` | `0` | `V364-01`..`V364-05` PASS (100%), including fixed external PII & 503 canary verification in `V364-05` 5e |
| `node .\node_modules\tsx\dist\cli.mjs scripts/test-native-demo-gsheet.ts` | `0` | `GS-01`..`GS-05` PASS (5/5) |
| `node .\node_modules\tsx\dist\cli.mjs scripts/test-demo-ai-and-drive-reupload-v351.ts` | `0` | `T1`..`T5` PASS (5/5) |
| `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-reupload-v353.ts` | `0` | `R353-01`..`R353-04` PASS (4/4) |
| `node .\node_modules\tsx\dist\cli.mjs "$env:TEMP\mindx-v364-r3-probe.ts"` *(deleted immediately after run)* | `0` | Round 3 independent adversarial probes (`R3-P1`, `R3-P2`, `R3-P3`, `R3-P4A`, `R3-P4B`): **5/5 PASS, 0 FINDINGS**, 0 `unhandledRejection`, 0 leaked tabs |

---

## Protected Live Data SHA-256 Verification

Computed via Node `fs.readFileSync` + `crypto.createHash('sha256')` BEFORE and AFTER all Round 2 and Round 3 checks (100% match to baseline):

| File | Baseline SHA-256 | Before | After | Match |
|---|---|---|---|---|
| `data/mindx_bot.db` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | **100% MATCH** |
| `data/mindx_bot.db-wal` | `61CAC43B350609F81495EFE7D3D2DFE5290B187CB7DB9119B7EE54362239404F` | `61CAC43B350609F81495EFE7D3D2DFE5290B187CB7DB9119B7EE54362239404F` | `61CAC43B350609F81495EFE7D3D2DFE5290B187CB7DB9119B7EE54362239404F` | **100% MATCH** |
| `data/running_classes.json` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | **100% MATCH** |
| `data/config/lms_class_ids.json` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | **100% MATCH** |

All temporary scratch scripts/directories in `os.tmpdir()` were deleted, and zero files in `src/`, `scripts/`, `package.json`, `data/`, or `playwright-auth/` were modified by the auditor.

---

**VERDICT: GO**
