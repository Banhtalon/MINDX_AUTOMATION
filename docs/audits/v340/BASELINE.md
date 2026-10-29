# BASELINE VERIFICATION REPORT — BEFORE GIAI ĐOẠN 10 (`v3.4.0`)

- **Date:** 2026-10-29 (Asia/Saigon)
- **Stage:** `S0` — Chuẩn bị & Chốt mốc xuất phát (`v3.4.0`)
- **Production Database SHA-256 (`data/mindx_bot.db`):** `06E698070D6D3F50D4CD749169E5D3B3993A80F2BB3B3CDE4EC74A149D2304DB` (100% preserved)
- **Running Classes Cache SHA-256 (`data/running_classes.json`):** `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` (100% preserved)

## 1. Baseline Gate Execution Summary (Isolated TEMP DB & Cache)

All 11 mandatory baseline gates executed in an isolated `$env:TEMP` environment (`ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH`) and passed with `exit code 0`:

| # | Command | Result | Exit Code |
| :---: | :--- | :---: | :---: |
| 1 | `npx tsc --noEmit --incremental false` | PASS | `0` |
| 2 | `npx tsx scripts/test-phase5.ts` | PASS | `0` |
| 3 | `npx tsx scripts/test-phase6.ts` | PASS | `0` |
| 4 | `npx tsx scripts/test-phase7.ts` | PASS | `0` |
| 5 | `npx tsx scripts/test-phase4-codex-repros.ts` | PASS | `0` |
| 6 | `npx tsx scripts/test-spck-v270.ts` | PASS | `0` |
| 7 | `npx tsx scripts/test-spck-v272.ts` | PASS | `0` |
| 8 | `npx tsx scripts/test-lms-reliability-v280.ts` | PASS | `0` |
| 9 | `npx tsx scripts/test-session14-v290.ts` | PASS | `0` |
| 10 | `npx tsx scripts/test-teaching-project-v320.ts` | PASS | `0` |
| 11 | `npx tsx scripts/test-report-card-v330.ts` | PASS | `0` |

## 2. Known Pre-Streamlining Architectural & Workflow Findings (Targets for S1–S7)

1. **`S1` Targets (Safety & Reliability Fixes):**
   - `src/app/api/spck/list/route.ts` (`POST`) invokes `ClassSyncer.fetchRunningClasses()` and `ClassSyncer.syncClass()` outside `taskQueue.enqueue` (violating Rule 3 single-queue discipline) and mutates `data/running_classes.json` by pruning non-SPCK classes.
   - `src/lib/playwright/teaching-project-service.ts` (`LiveTeachingHttpTransport`) duplicates `LiveTeachingReportCardHttpTransport` without timeout/Stop-guard protection (`fetchWithStopAndTimeout`, `runWithStopGuard`) and uses a separate login session.
   - `src/lib/playwright/teaching-report-card-sync.ts` and `src/components/teaching-report-card-view.tsx` block retrying Teaching sync when `status === "FAILED"` even when `contentHash` matches the approved snapshot, forcing redundant re-approval.
   - `src/app/final-project/page.tsx` reads `data.activeSessionNumber` before falling back, whereas `api/spck/list` returns `selectedSessionNumber`.
   - `src/lib/playwright/spck-uploader.ts` contains hardcoded fallback slot IDs for `VT-C4K-PTA12`.
   - `AGENTS.md` / `PROJECT_STATE.md` should explicitly document the teacher-triggered Student Portal (`0.0.0.0` + Cloudflare Quick Tunnel, protected by `sessionToken`) as the intentional classroom exception to `127.0.0.1`.
2. **`S2` Targets (Unified Class Directory & `<ClassPicker>`):**
   - 5 separate class-listing implementations across `session-comments/list`, `session-comments/fetch-classes`, `report-card`, `teaching-projects`, `spck/list`, and `homework-grader/scores`.
3. **`S3` Targets (Screen 1 Streamlining: 5 clicks $\rightarrow$ 3 clicks):**
   - Bulk draft saving (`POST /api/session-comments/save-draft` array support + 600ms debounce on text/note input), bulk approval + 1-click `"✅ Duyệt & Đẩy LMS"`, unified Zalo summary module `src/lib/zalo/zalo-summary.ts`.
4. **`S4` Targets (Screen 2 Streamlining: 4 clicks $\rightarrow$ 2 clicks):**
   - Single LMS scrape button, 1-click `"✅ Duyệt & 🚀 Đồng bộ Teaching"`, stale Buổi 14 evaluation warning banner, unified export/TSV formatter.
5. **`S5a` & `S5b` Targets (Screen 3 Modularization & Streamlining):**
   - Extract modular subcomponents from `src/app/final-project/page.tsx` while preserving the `round-38` harness invariants, add auto-tool chaining toggle after scan,approval-demotion confirmation, and 1-click Buổi 14 combined AI + combined upload.
6. **`S6` Targets (Screen 5 & Cross-Screen Workflow Handoff):**
   - 1-click current-session milestone update on `/teaching-projects`, post-SPCK Teaching progress suggestion banner on `/final-project`, and Today's Action checklist on Dashboard `/`.
7. **`S7` Targets (Internal Cleanup & Shared PII/Vietnamese Helpers):**
   - Remove unreachable UI dead code (`homework-auto-grader-tab.tsx`, unreachable tabs on `/syllabus-config`, `{false && ...}` blocks), unify PII anonymizer (`src/lib/ai/pii-anonymizer.ts`) and Vietnamese normalization helpers (`src/lib/utils/vietnamese-match.ts`).
