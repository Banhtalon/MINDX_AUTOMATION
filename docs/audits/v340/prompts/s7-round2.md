# Codex Audit Prompt — Stage S7 Round 2 (`v3.4.0`: Internal Cleanup, Shared PII Anonymizer & Unified Vietnamese Match)

You are the independent Reviewer (`gpt-6.1-sol` `high`) auditing **Stage S7 — Round 2** of the `v3.4.0` workflow streamlining upgrade for `MINDX-AUTOMATION`.

## 1. Round 1 Findings & Remedies Implemented

In [`docs/audits/v340/CODEX_S7_ROUND1.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S7_ROUND1.md), all 8 mandatory gates + `npx next build --webpack` passed (`exit code 0`), and your adversarial probe (`docs/audits/v340/s7-round1/adversarial-probe.cjs`) scored `102/116` with 2 findings:

1. **`S7-01` (`HIGH` — `matchJoinedFileNames` disabled across non-homework AI generators & non-primary roster names in `HomeworkAiGrader`):**
   - **Fix in `src/lib/ai/pii-anonymizer.ts` (`L283`, `L402`, `L421`, `L438`, `L454`):**
     - `matchJoinedFileNames` now defaults to `true` (`options.matchJoinedFileNames !== false`) in `createStudentNameScrubber`.
     - Explicitly passed `matchJoinedFileNames: true` in `createRosterNameScrubber`, `anonymizeSession14Text`, `anonymizeSpckText`, and `anonymizeTeachingHintText`.
   - **Fix in `src/lib/gemini/homework-grader.ts` (`L595-605`):**
     - `HomeworkAiGrader.buildNameScrubber` now passes `matchJoinedFileNames: true` to `createRosterNameScrubber` for peer roster names as well.
   - **Regression Test Added:** `[S7-T6]` in `scripts/test-streamline-v340-s7.ts` intercepts actual `models.generateContent` payloads across all 5 generators and verifies joined filenames (`NguyenMinhKhoi.py`, `Nguyen_Minh_Khoi.py`, `TranGiaBao.py`) never leak into the Gemini request body.

2. **`S7-02` (`MEDIUM` — `matchJoinedFileNames` dropped 1-character given names such as `Lê Thị Ý` $\rightarrow$ `LeThiY.py` / `Le_Thi_Y.py`):**
   - **Fix in `src/lib/ai/pii-anonymizer.ts` (`L290`):**
     - Replaced `.filter((p) => p.length >= 2)` with `.filter(Boolean)` inside the `matchJoinedFileNames` multi-word (`parts.length >= 2`) branch so 1-character given names (`Ý`/`Y`/`Á`/`Ỷ`/`Ứ`) are preserved when matching joined/delimited multi-part identifiers (`LeThiY.py` $\rightarrow$ `STUDENT_01.py`, `Le_Thi_Y.py` $\rightarrow$ `STUDENT_01.py` / `STUDENT_PEER.py`), while single-part names remain excluded by `parts.length >= 2`.
   - **Regression Test Added:** `[S7-T6]` in `scripts/test-streamline-v340-s7.ts` tests `Lê Thị Ý` (`LeThiY.py`, `Le_Thi_Y.py`, `le-thi-y.sb3`, `Le.Thi.Y.py`) as both target student and peer roster name.

## 2. Mandatory Safety & Execution Rules
- **NEVER modify production data:** Always set:
  - `ALLOWED_LOCAL_DIRS` to `$env:TEMP`
  - `MINDX_DB_PATH` to `$env:TEMP\mindx_codex_s7r2.db`
  - `MINDX_RUNNING_CLASSES_PATH` to `$env:TEMP\mindx_codex_s7r2_rc.json`
- Verify before and after that `data/mindx_bot.db` (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16`) and `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) are untouched.
- Do not modify application source files in `src/` or `scripts/`.

## 3. Required Verification Commands
1. `npx tsc --noEmit --incremental false`
2. `npx tsx scripts/test-streamline-v340-s7.ts`
3. `npx tsx docs/audits/v340/s7-round1/adversarial-probe.cjs` (verify `116/116 PASS, failed: []`)
4. `npx tsx scripts/test-phase4-codex-repros.ts`

## 4. Deliverable
Write the complete Round 2 audit report to `docs/audits/v340/CODEX_S7_ROUND2.md` with:
- Verification table for `S7-01` and `S7-02` (`CLOSED` / `OPEN` with exact `file:line` references)
- Command & test results (`tsc`, `test-streamline-v340-s7.ts`, `adversarial-probe.cjs` `116/116`, `test-phase4-codex-repros.ts`, production DB hash check)
- Explicit final gate verdict: **GO** or **NO-GO** (`2/2 CLOSED` $\rightarrow$ **GO**).
