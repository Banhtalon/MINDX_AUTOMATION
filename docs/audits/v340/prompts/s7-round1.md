# CODEX INDEPENDENT AUDIT PROMPT — v3.4.0 STREAMLINING (STAGE S7, ROUND 1)

You are acting as the **Independent Quality & Safety Auditor (`gpt-6.1-sol` `high`)** for the **MindX Automation Bot** repository (`v3.4.0` — Giai đoạn 10: Tinh gọn Luồng Nghiệp vụ & Giảm Thao tác Giáo viên).

## 1. Stage Scope & Target
- **Stage:** `S7` — Dọn dẹp bên trong (Gỡ `homework-auto-grader-tab.tsx` & 2 tab chết trên `/syllabus-config`, chuyển `⚙ Cài đặt` sang góc phải `TopNavbar`, hợp nhất 1 bộ ẩn danh học sinh dùng chung `src/lib/ai/pii-anonymizer.ts` cho cả 5 bộ sinh AI, hợp nhất chuẩn hóa tiếng Việt `src/lib/utils/vietnamese-match.ts`, xóa sạch `{false && …}` / `Boolean(0)` và tách hàm phụ khỏi `route.ts` để `next build --webpack` đạt PASS).
- **Audit Round:** `Round 1`
- **Baseline / Diff Range:** Working tree against HEAD `2364c93` (`feat(v3.4.0-s6): 1-click Teaching progress sync, cross-screen handoff & dashboard today-tasks`)
- **Changed / Added / Deleted Files in S7:**
  - `src/components/homework-auto-grader-tab.tsx` *(deleted)*
  - `src/lib/types/index.ts` *(added — `CriterionGradeItem`, `GradingCriterion`, `GradingRubric`, `SubmissionRowItem`)*
  - `src/lib/db/json-config.ts` *(re-exports `GradingCriterion`, `GradingRubric` from `../types`)*
  - `src/app/syllabus-config/page.tsx` *(removed ~630 lines of unreachable `rubrics` and `zaloTemplates` tabs; preserved JSON files)*
  - `src/components/top-navbar.tsx` *(moved `/syllabus-config` out of 5-item `NAV_ITEMS` into right-side `⚙ Cài đặt` link next to theme toggle)*
  - `src/lib/ai/pii-anonymizer.ts` *(added — shared student PII anonymizer & de-anonymizer across all 5 AI generators)*
  - `src/lib/gemini/comment-generator.ts` *(switched to `../ai/pii-anonymizer`)*
  - `src/lib/gemini/homework-grader.ts` *(switched to `../ai/pii-anonymizer`)*
  - `src/lib/gemini/session14-course-summary.ts` *(switched to `../ai/pii-anonymizer`)*
  - `src/lib/gemini/spck-comment.ts` *(switched to `../ai/pii-anonymizer`)*
  - `src/lib/gemini/teaching-project-generator.ts` *(switched to `../ai/pii-anonymizer`)*
  - `src/lib/utils/vietnamese-match.ts` *(added `stripVietnameseAccentsPreserveCase`, `normalizeVietnameseNamePreserveTones`, `toVietnameseUpperSlug`, `formatVietnameseCallName`)*
  - `src/lib/db/sqlite.ts`, `src/lib/playwright/scrape-scores.ts`, `src/lib/local-files/spck-demo-score-reader.ts`, `src/lib/playwright/spck-uploader.ts`, `src/lib/playwright/sync-class.ts`, `src/lib/playwright/teaching-report-card-sync.ts` *(replaced local `.normalize("NFD")` implementations with `vietnamese-match.ts` helpers)*
  - `src/lib/report-card/report-card-staleness.ts`, `src/app/api/report-card/route.ts`, `src/app/api/homework-grader/scores/route.ts`, `src/app/api/homework-grader/export/route.ts`, `src/app/api/spck/session14-eval/route.ts`, `src/app/api/spck/session14-eval/generate-ai/route.ts`, `src/app/api/spck/session14-eval/import-demo-scores/route.ts`, `src/app/api/spck/session14-eval/upload-lms/route.ts` *(moved non-HTTP helper exports out of `route.ts` files so Next.js 16.4.2 Webpack production build passes)*
  - `scripts/test-streamline-v340-s7.ts` *(added — Stage S7 verification suite `S7-T1`..`S7-T5`)*
  - `scripts/test-phase5.ts`, `scripts/test-report-card-v330.ts`, `scripts/test-streamline-v340-s4.ts` *(updated imports/assertions for S7.1 & route helper extraction)*
- **Checklist Items Covered in This Stage:**
  - **S7.1:** Gỡ `homework-auto-grader-tab.tsx` (chuyển kiểu `GradingRubric` sang `src/lib/types`). Giữ backend chấm bài + `test-phase5`/`test-lms-reliability-v280`.
  - **S7.2:** Màn 4 (`/syllabus-config`): xóa 2 tab Barem/Mẫu Zalo không mở được (~600 dòng); dữ liệu JSON vẫn giữ. Chuyển mục "Giáo trình & Thẻ" từ thanh menu chính sang nút **⚙ Cài đặt** ở góc phải.
  - **S7.3:** 1 bộ ẩn tên học sinh dùng chung `src/lib/ai/pii-anonymizer.ts` (`anonymize` / `deanonymize`, dựa trên `vietnamese-match.ts`), thay cho 5 bản riêng trong `comment-generator`, `homework-grader`, `session14-course-summary`, `spck-comment`, `teaching-project-generator`. Kiểm thử: họ tên đầy đủ, tên đệm + tên, tên gọi 1 từ, viết không dấu, trùng tên; không lọt tên nào ra lời nhắn gửi AI.
  - **S7.4:** Gom các hàm bỏ dấu tiếng Việt viết lại cục bộ (`sqlite.ts`, `scrape-scores.ts`, `spck-demo-score-reader.ts`, `spck-uploader.ts`, `sync-class.ts`) về `vietnamese-match.ts`, **giữ** biến thể "giữ dấu thanh" mà Teaching cần (`normalizeVietnameseNamePreserveTones`).
  - *(Note: `S7.5` is explicitly marked optional in the approved plan and skipped to preserve battle-tested SQLite repo stability).*
  - **S7.6:** Quét lại toàn bộ `{false && …}` / `Boolean(0)` trong `src/`: còn 0 chỗ.

## 2. Mandatory Reading Order
1. Read `PROJECT_STATE.md` first (Single Source of Truth).
2. Cross-check `MINDX_AUTOMATION_PLAN.md` (specifically **GIAI ĐOẠN 10 (`v3.4.0`) — CHẶNG S7**) and `CHANGELOG.md`.
3. Read `AGENTS.md` and enforce all 6 core rules.

## 3. Strict Audit Isolation & Safety Rules (MANDATORY)
- **DO NOT** modify any application source code (`src/**`), existing test scripts (`scripts/**`), `next-env.d.ts`, or historical audit directories (`docs/audits/round-12` .. `docs/audits/round-41`).
- **DO NOT** open a SQLite connection to, modify, copy, or delete the production database `data/mindx_bot.db` or `data/running_classes.json`. **EXPLICIT READ-ONLY HASH EXCEPTION:** Run read-only `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` before and after your audit to verify that their SHA-256 hashes remain 100% unchanged before and after your audit (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` for `data/mindx_bot.db` [1,925,120 bytes] and `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` for `data/running_classes.json`).
- Every test or probe execution **MUST** run with isolated environment overrides pointing inside `$env:TEMP`:
  - `ALLOWED_LOCAL_DIRS=<temp_dir>`
  - `MINDX_DB_PATH=<temp_dir>/test.db`
  - `MINDX_RUNNING_CLASSES_PATH=<temp_dir>/running_classes.json`
- **DO NOT** make any live network requests to `lms.mindx.edu.vn` or `teachingmindx.top`.
- When saving probe evidence in `docs/audits/v340/s7-round1/`, **DO NOT leave `.ts` files inside `docs/audits/`** (or rename them to `.ts.txt` before finishing) because `tsconfig.json` includes `**/*.ts` and extra `.ts` files in `docs/audits/` can affect `npx tsc --noEmit`.

## 4. Mandatory Verification Gates to Execute Freshly
> **FAST EXECUTION GUIDELINE:** Keep your audit focused and fast (~3–5 minutes total). Execute the targeted gates below and a focused adversarial S7 probe (testing PII anonymization edge cases across all 5 AI generators, Vietnamese normalization tone-preservation vs accent-stripping, `/syllabus-config` & `TopNavbar` rendering, and zero `{false &&` / `Boolean(0)` / duplicate `NFD`). Do NOT re-run slow 4-minute browser-timeout suites (`test-session14-v290.ts`) unless your probe finds a direct issue in them.

Run and report exact exit codes for:
1. `npx tsc --noEmit --incremental false`
2. `npx tsx scripts/test-streamline-v340-s7.ts`
3. `npx tsx scripts/test-streamline-v340-s4.ts`
4. `npx tsx scripts/test-phase4-codex-repros.ts`
5. `npx tsx scripts/test-phase5.ts`
6. `npx tsx scripts/test-phase7.ts`
7. `npx tsx scripts/test-teaching-project-v320.ts`
8. `npx tsx scripts/test-report-card-v330.ts`
9. Author and run an independent adversarial S7 probe testing:
   - `src/lib/ai/pii-anonymizer.ts` directly and through all 5 AI generators (`comment-generator.ts`, `homework-grader.ts`, `session14-course-summary.ts`, `spck-comment.ts`, `teaching-project-generator.ts`): full names, 2-word sub-phrases, 1-word given names, 1-character Vietnamese given names (`Ý`, `Y`, `ý`, `y`), unaccented variants, duplicate given/middle names in the same class roster, peer names, joined filenames, and round-trip de-anonymization.
   - `src/lib/utils/vietnamese-match.ts`: verify `normalizeVietnameseNamePreserveTones` preserves tone marks for Teaching while `stripVietnameseDiacritics` / `stripVietnameseAccentsPreserveCase` strip diacritics cleanly, and verify 0 `.normalize("NFD")` calls exist outside `vietnamese-match.ts`.
   - `S7.1`, `S7.2`, `S7.6` invariants.

## 5. Required Deliverables
1. Write your full audit report to `docs/audits/v340/CODEX_S7_ROUND1.md` containing:
   - **Decision:** `GO` or `NO-GO` for Stage `S7` Round `1`.
   - **Gate Execution Summary:** Table of all commands run and their exit codes.
   - **Finding Table:** Any finding numbered `S7-01`, `S7-02`... with Severity (`HIGH` / `MEDIUM` / `LOW`), Status (`OPEN` / `CLOSED`), exact `file:line`, reproduction proof, and required fix.
   - **Production Data Preservation Check:** Before/after SHA-256 hashes of `data/mindx_bot.db` and `data/running_classes.json`.
2. Update `PROJECT_STATE.md`, `CHANGELOG.md`, and `MINDX_AUTOMATION_PLAN.md` with a concise summary of your S7 Round 1 audit verdict.
