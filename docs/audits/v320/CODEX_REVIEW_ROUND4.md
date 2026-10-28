**Round 4: 12 findings CLOSED, 2 OPEN, plus one additional P2 issue. Release remains blocked.**

Reviewed the working tree based on `060f04b`, including uncommitted changes. “CLOSED” below reflects source inspection and targeted probes; the required full checks could not run.

**Status of F01–F14**

| Finding | Status | Evidence |
|---|---|---|
| F01 | CLOSED | All four project fields are compared for existing/new projects; remote values reach hash verification. [Service:816](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:816>) |
| F02 | CLOSED | Loading imported/repaired content leaves it `DRAFT`; no automatic approval or verification. [Service:561](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:561>) |
| F03 | CLOSED | Mutation responses check class/sequence; actions require the selected class to finish loading. [Page:370](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:370>) |
| F04 | CLOSED | Default loading preserves drafts; remote failures return existing local content; metadata updates are separate. [Service:469](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:469>) |
| F05 | CLOSED | Approval, task ownership, roster and assignments are checked before writing. Negative probes produced zero writes. [Service:1069](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1069>) |
| F06 | CLOSED | Probes confirmed `Khoi → STUDENT_01`, `Bach → STUDENT_03`, and overlapping full-name aliases remain correct. [Generator:612](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/gemini/teaching-project-generator.ts:612>) |
| F07 | CLOSED | Save/approve, AI, LMS-date and sync paths enforce draft versions, including the approved-record sync branch. [Sync route:90](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/sync/route.ts:90>) |
| F08 | CLOSED | Fractional weights remain unchanged and fail approval; extra tasks, empty assignments and invalid deadlines are rejected. [SQLite:4953](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/db/sqlite.ts:4953>) |
| F09 | CLOSED | Both transport and service parse readback strictly. Missing/malformed values fail zero-progress verification; valid `0` succeeds. [Service:1183](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1183>) |
| F10 | CLOSED | Probes confirmed correct YMD parsing, invalid-date rejection and leap-year handling. [Parser:30](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:30>) |
| F11 | **OPEN — P2** | Invalid JSON, missing payloads and unexpected schemas still pass payload validation and permit stale DOM results. [Sync-class:153](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:153>) |
| F12 | CLOSED | Reviewed badge/button colors and hover states are corrected; static palette checks remain above 4.5:1. Browser verification was unavailable. [Page:1452](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/teaching-projects/page.tsx:1452>) |
| F13 | **OPEN — P2** | DB/cache isolation is implemented, including cleanup/hash assertions. Coverage still omits the reproducible F11 malformed-payload failures. [Tests:350](<D:/MY PROJECT/MINDX_AUTOMATION/scripts/test-teaching-project-v320.ts:350>) |
| F14 | CLOSED | State, changelog and implementation plan contain v3.2.0 coverage and the Teaching endpoint. [Plan:612](<D:/MY PROJECT/MINDX_AUTOMATION/MINDX_AUTOMATION_PLAN.md:612>) |

**Remaining F11 failure**

The payload helper returns `true` for absent/non-object payloads and unrecognized class-list shapes. JSON parsing failures become `null`, which is consequently accepted. [Payload helper:153](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:153>), [caller:1467](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/sync-class.ts:1467>).

Executing the current method body with in-memory page/cache dependencies produced:

| Search response, with an existing DOM row | Result | Cache writes |
|---|---|---:|
| HTTP 200, invalid JSON | **Incorrect `LMS_LIVE`** | 1 |
| HTTP 200, `null` or `{}` | **Incorrect `LMS_LIVE`** | 1 |
| HTTP 200, `{success:false}` | **Incorrect `LMS_LIVE`** | 1 |
| HTTP 200, unrelated payload schema | **Incorrect `LMS_LIVE`** | 1 |
| Wrong class array, GraphQL errors or HTTP 403 | Correct rejection | 0 |
| Valid target-class payload | Correct `LMS_LIVE` | 1 |

Reject parsing failures and absent/unrecognized payload shapes before reading DOM or saving cache. Add these cases to TP-01.

**Additional issue: R4-01 — P2, malformed incoming progress silently overwrites valid progress**

Incoming percentages still use:

```ts
Math.max(0, Math.min(100, Math.round(Number(u.progressPercent) || 0)))
```

The route forwards `updates` without percentage validation. [Service:1026](<D:/MY PROJECT/MINDX_AUTOMATION/src/lib/playwright/teaching-project-service.ts:1026>), [route:29](<D:/MY PROJECT/MINDX_AUTOMATION/src/app/api/teaching-projects/progress/route.ts:29>).

Independent service probes starting at **80%** confirmed that omitted, `null`, empty, nonnumeric or `false` percentages write **0%** and return success. Readback correctly confirms that unintended write, so the F09 fix cannot prevent it.

Validate the entire batch before writing; reject invalid percentages instead of defaulting, rounding or clamping. The milestone input needs equivalent validation. This is newly identified here; it is not established as a Round 4 regression.

No additional P0/P1 issues were identified in the reviewed paths.

**Required command results**

| Command | Result |
|---|---|
| `npx tsc --noEmit --incremental false` | **BLOCKED** — `npx` not found; exit 1 before compilation |
| `npx tsx scripts/test-teaching-project-v320.ts` | **BLOCKED** — `npx` not found; exit 1 before suite execution |

The Node/npx absolute paths listed in `PATH` were also unavailable. Targeted probes used extracted source bodies with TypeScript annotations removed and in-memory dependencies; they do not replace these checks.

No files were changed or live Teaching/LMS/Gemini services called. Both production-file SHA-256 values remained unchanged during this audit; this does not establish a successful isolated suite run.

**VERDICT: NO-GO**

Close F11 and R4-01, extend regression coverage, and obtain fresh passing results from both required commands.