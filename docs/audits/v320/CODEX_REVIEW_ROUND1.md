## Executive Summary

**VERDICT: NO-GO**

The reviewed implementation has **6 High, 7 Medium, and 1 Low findings**. Blocking issues include false `VERIFIED` results, loss of saved drafts, cross-class UI races, unscoped progress writes, and incomplete student anonymization.

This was a **read-only source audit** of all requested files and relevant shared helpers. No files or application data were changed. The automated suite was **not run** because it opens the workspace database and deletes test records. Findings below follow directly from source; small, copied-expression probes confirmed the date, anonymization, missing-progress, and contrast cases.

## Checklist Verification

| Checklist item | Result | Verification |
|---|---|---|
| All five API routes call `validateLocalRequest(request)` | **PASS** | Present in main GET/POST at lines 57/96; generate-ai:14; sync:11; progress:10; fetch-lms-dates:8. |
| Server binds to `127.0.0.1` | **PASS — configuration** | Both `dev` and `start` scripts specify `-H 127.0.0.1`. Live listener was not tested. |
| Sensitive environment variables stay server-side | **PASS — reviewed imports/payloads** | Neither client component imports configuration or secrets. No direct password/API-key response exposure found. |
| File access uses Path Allowlist | **PARTIAL** | SQLite and JSON configuration readers use `assertPathAllowed`. The new test script reads source files directly without it. |
| Sync, progress, and LMS-date browser work use the queue | **PASS** | Service enqueue calls at lines 664 and 1021; date route at line 21. Production browser work reuses `BrowserManager`. |
| Project fields and five tasks are verified before `markVerified` | **FAIL** | All five requested task fields are compared, but existing project fields are skipped and project description is never compared. |
| Progress uses `get_duan_task_progress` readback | **PARTIAL** | Readback exists, but missing entries count as verified zero progress. |
| SHA-256 covers required project/task content | **PASS — normalized content** | Includes every listed field. Slot indexes are derived from array order; task IDs are excluded as remote metadata. |
| Edits after `APPROVED`/`VERIFIED` downgrade and clear hash | **PASS — `saveDraft` path** | Hash changes cause `WAITING_APPROVAL` and clear `contentHash`. Normalization can silently change what the user submitted. |
| `expectedVersion` produces HTTP 409 | **PARTIAL** | Save/approve/AI paths check supplied versions. Checks remain optional, and one sync branch ignores even a supplied stale version. |
| Required Gemini model | **CONDITIONAL PASS** | Defaults to `gemini-3.5-flash-lite`; `GEMINI_MODEL` can override it. |
| Student PII stripped before Gemini | **FAIL** | Only exact full names and final two-word names in `teacherHint` are replaced. |
| Class switching handles out-of-order responses | **PARTIAL** | `activeLoadSeqRef` protects class GET responses only. Mutation responses and actions during loading remain unsafe. |
| All badges/buttons maintain high contrast | **FAIL** | Main status badges use the requested pattern. Several secondary badges fall below 4.5:1 in Light Mode. |
| Course detection and five-task templates | **PARTIAL** | Seven template groups provide five tasks totaling 100%. Unmatched courses fall through to generic content without an insufficient-information guard. |

## Findings

### High

**F01 — Existing project changes can be falsely marked `VERIFIED`.**  
At [teaching-project-service.ts:688](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:688>), an existing project is never updated. At [line 811](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:811>), name/start/end comparisons run only when the project was newly created; description is never compared. Editing an existing project’s name, dates, or description can therefore leave Teaching unchanged while reporting success. `markVerified` reconstructs project fields from SQLite, so it cannot detect that discrepancy ([sqlite.ts:5321](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:5321>)).  
**Required:** Save or explicitly reject unsupported project changes, then compare every project field against remote readback.

**F02 — Loading a project can approve and verify synthesized data.**  
[teaching-project-service.ts:541](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:541>) automatically calls `approveDraft` and `markVerified` during loading, without teacher approval. The merge fills empty remote assignees from the roster without setting `wasAutoCompleted` ([generator:398](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:398>)); missing project dates can likewise come from local estimates. Thus locally repaired content can receive `VERIFIED` despite never existing remotely. The approval result is also ignored.  
**Required:** Keep repaired/imported content pending review; verify raw remote values independently.

**F03 — Class switching can mix one class’s data with another class’s writes.**  
The sequence guard protects only GET loading ([page.tsx:214](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:214>)). Date, AI, save, sync, and progress handlers apply responses without checking the current class—for example [line 371](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:371>) and [line 579](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:579>). The selector remains enabled, previous form data remains visible, and sync is not disabled during class loading ([line 1327](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1327>)). A delayed response from class A can overwrite class B’s form, or A’s old form can be submitted under B’s code.  
**Required:** Bind every response and action to the loaded class/version, and block writes until that class finishes loading.

**F04 — Normal class loading can discard saved drafts, including during Teaching failure.**  
Initial loading and class selection request `force=true` ([page.tsx:324](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:324>), [line 340](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:340>)). The force branch overwrites SQLite content ([service:562](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:562>)). If remote fetching fails, execution still reaches this branch with empty remote tasks, potentially replacing a saved five-task draft with templates.  
**Required:** Preserve saved drafts by default and perform no destructive refresh after an incomplete remote fetch.

**F05 — Progress writes are not scoped to the requested class.**  
[teaching-project-service.ts:996](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:996>) validates only positive task/student IDs. At [line 1047](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1047>), it writes them without checking task ownership or student assignment. A request labelled class A can modify a class B task before A’s readback detects anything. Local-only access does not prevent accidental cross-class corruption.  
**Required:** Validate every task/project/student relationship before the first write.

**F06 — Student anonymization is incomplete.**  
[sanitizeTeachingAiHint:446](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:446>) replaces exact full names and two-word short names only. For roster name “Nguyễn Minh Khôi”, a hint containing “Khôi” survives, as do email addresses and phone numbers. Missing cached students produce no name redaction. Other interpolated fields, including caller-supplied `courseName`, bypass this sanitizer ([line 571](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:571>)).  
**Required:** Sanitize all outgoing free text, handle name variants and contact information, and use stable `STUDENT_XX` aliases.

### Medium

**F07 — Optimistic concurrency has bypasses.**  
[sync/route.ts:79](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/sync/route.ts:79>) skips version validation for already approved/verified records when no full payload is supplied. A stale `expectedVersion` can therefore trigger a sync instead of HTTP 409. Repository checks are optional ([sqlite.ts:5051](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:5051>)); LMS-date writes supply no expected version.  
**Required:** Require and enforce versions on every draft-changing operation and sync request.

**F08 — Normalization silently changes explicit approval input.**  
[sqlite.ts:4786](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:4786>) truncates six tasks to five; invalid weights become 20; invalid deadlines become the project end date; explicitly empty assignees become the fallback roster. Consequently, “deselect all” can become “assign everyone” during approve-and-sync. Validation sees repaired values rather than rejecting the submitted values.  
**Required:** Separate default generation from strict approval validation; preserve explicit empty values.

**F09 — Missing progress readback passes verification for 0%.**  
At [service:1064](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1064>), `verifiedProgress[key] ?? 0` treats an absent record as verified zero. An empty response after a failed/no-op reset can return success.  
**Required:** Require the requested key and a valid numeric value before comparing percentages.

**F10 — Date resolution can produce incorrect calendar dates.**  
The new date resolver uses the existing unanchored DMY-first parser ([sync-class.ts:219](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:219>), [parser:34](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:34>)). Copied-source probes produce:

- `2026-10-28` → **2028-10-26**
- `31/02/2026` → **2026-03-03**

The new strict SQLite date helper does not protect this path.  
**Required:** Use one anchored parser with calendar round-trip validation throughout.

**F11 — Failed or estimated LMS dates can overwrite drafts or be presented as live results.**  
The scraper waits fixed durations without checking the matching business API response ([sync-class.ts:1303](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:1303>)). Missing rows can return estimated/cache dates with `success:true` ([line 1403](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:1403>)). The route also saves returned fallback dates even when `success:false` ([fetch-lms-dates:31](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/fetch-lms-dates/route.ts:31>)), while the UI labels successful fallback results as directly fetched from LMS.  
**Required:** Verify the matching API response, return explicit provenance, and avoid saving unsuccessful fallback results.

**F12 — Secondary badges fail the contrast requirement.**  
New task/status badges use `mindx-badge-*` instead of the protected solid-700 pattern ([page:1195](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1195>)). Their Light Mode CSS yields these white-text contrast ratios:

| Badge | Background | Contrast |
|---|---|---:|
| Amber | `#d97706` | **3.19:1** |
| Blue | `#0284c7` | **4.10:1** |
| Emerald | `#059669` | **3.77:1** |

Colors originate at [globals.css:244](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/globals.css:244>). These small labels fall below the suite’s own 4.5:1 threshold.  
**Required:** Correct every rendered badge and verify the actual page in both themes.

**F13 — The test suite is not isolated and misses the blocking cases.**  
[test-teaching-project-v320.ts:180](<D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:180>) opens the workspace database; cleanup deletes fixed synthetic project IDs and their logs ([line 660](<D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:660>)). Row-count comparisons cannot prove existing row contents were preserved. TP-06 tests hand-written HTML rather than the React page ([line 561](<D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:561>)), omitting the failing secondary badges and class-switch races.

The suite also misses existing-project metadata mismatches, synthesized verification, cross-class writes, empty zero-progress readbacks, and stale-version sync. The AI generator has no `INSUFFICIENT_INFO` branch when both syllabus context and teacher hints are absent ([generator:559](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:559>)).  
**Required:** Isolate the database, add these negative cases, test the real component, and implement/test Rule 5’s missing-information behavior.

### Low

**F14 — Required project documentation has not been updated for v3.2.0.**  
[PROJECT_STATE.md:5](<D:/MY PROJECT/MINDX_AUTOMATION/PROJECT_STATE.md:5>), [CHANGELOG.md:7](<D:/MY PROJECT/MINDX_AUTOMATION/CHANGELOG.md:7>), and [MINDX_AUTOMATION_PLAN.md:5](<D:/MY PROJECT/MINDX_AUTOMATION/MINDX_AUTOMATION_PLAN.md:5>) still describe v3.1.1. None contains a v3.2.0 or `/teaching-projects` entry, contrary to Rule 1.

## Final Verdict

**VERDICT: NO-GO**

Resolve the verification, class-isolation, draft-preservation, and privacy findings before release. Acceptance testing must then run against an isolated database and the actual page.