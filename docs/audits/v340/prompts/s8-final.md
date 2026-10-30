# Codex Final Acceptance Audit Prompt — `v3.4.0` (`S8.2`: Nghiệm Thu Tổng Giai Đoạn 10 `S0` $\rightarrow$ `S8`)

You are the independent Reviewer (`gpt-6.1-sol` `high`) conducting the **Final Acceptance Audit (`CODEX_V340_FINAL.md`)** for `MINDX-AUTOMATION` version `v3.4.0` (Giai đoạn 10: Tinh gọn Luồng Nghiệp vụ, Giảm Số lần bấm & Liên thông 5 Màn hình).

## 1. Scope of Final Audit (`S8.2`)
1. **Stage Closure Verification (`S0` $\rightarrow$ `S7`):**
   - Verify that every stage from `S0` (`d7e3fe8` baseline) through `S7` (`faf9fbc`) has reached **GO** in `docs/audits/v340/`:
     - `S0`: [`CODEX_S0_ROUND2.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S0_ROUND2.md) (`GO`)
     - `S1`: [`CODEX_S1_ROUND2.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S1_ROUND2.md) (`GO`)
     - `S2`: [`CODEX_S2_ROUND3.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S2_ROUND3.md) (`GO`)
     - `S3`: [`CODEX_S3_ROUND5.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S3_ROUND5.md) (`GO`)
     - `S4`: [`CODEX_S4_ROUND3.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S4_ROUND3.md) (`GO`)
     - `S5a`: [`CODEX_S5A_ROUND2.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S5A_ROUND2.md) (`GO`)
     - `S5b`: [`CODEX_S5B_ROUND3.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S5B_ROUND3.md) (`GO`)
     - `S6`: [`CODEX_S6_ROUND3.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S6_ROUND3.md) (`GO`)
     - `S7`: [`CODEX_S7_ROUND2.md`](file:///f:/MINDX_project%20test/MINDX-AUTOMATION/docs/audits/v340/CODEX_S7_ROUND2.md) (`GO`)
2. **Audit Against All 6 Core Rules in `AGENTS.md` / `GEMINI.md`:**
   - **Rule 1 (Single Source of Truth):** `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md` are synchronized with `v3.4.0` and UI version badges (`src/components/top-navbar.tsx`, `src/app/page.tsx`, `src/app/layout.tsx`).
   - **Rule 2 (Local-Only Security):** Main server binds to `127.0.0.1` (`student-portal-server.ts` documented exception with `sessionToken` + Path Allowlist); zero leaks of `TEACHING_PASSWORD`, `LMS_PASSWORD`, or `GEMINI_API_KEY` into `'use client'` files; all local file reads go through `path-allowlist.ts`.
   - **Rule 3 (Playwright Discipline):** Single persistent context (`./playwright-auth`), all Playwright & Teaching sync jobs run through `SequentialTaskQueue` (including `/api/spck/list` and `/api/classes/refresh`), Read-after-Write verification before `VERIFIED`, and strict Checkpoint session protection (Sessions 5 & 9 Coding / 4 & 8 Robotics only write `.ql-editor`).
   - **Rule 4 (Data Integrity & Hashing):** Keyed by `classId`, `sessionId`, `studentId`, `submissionId`; SHA-256 `contentHash` + `draftVersion` (`409` on conflict) + automatic demotion to `WAITING_APPROVAL` on edit; retry allowed from `FAILED` when `contentHash === liveHash`.
   - **Rule 5 (AI Guardrails):** Shared `src/lib/ai/pii-anonymizer.ts` across all 5 AI generators (`STUDENT_01`..., joined filenames, 1-char names), `INSUFFICIENT_INFO` when no tags/notes, 5-level 3-bullet student comments, 2-part Zalo summary (`src/lib/zalo/zalo-summary.ts`), default MindX logo thumbnail fallback.
   - **Rule 6 (Protected Regression Files):** `next-env.d.ts` and `docs/audits/round-12` .. `docs/audits/round-41` untouched; `data/mindx_bot.db` (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16`) and `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) 100% preserved.
3. **Click-Count Reduction & Cross-Screen Flow Verification vs. `v3.4.0` Targets:**
   - **Screen 1 (`/session-comments`):** `5 -> 3` primary clicks (`<ClassPicker>` + session $\rightarrow$ `"✨ AI Soạn Nhận Xét"` with auto-confirm attendance/default tags for `UNKNOWN` $\rightarrow$ `"✅ Duyệt & Đẩy LMS"` + `"📋 Copy Zalo"`).
   - **Screen 2 (`/homework-grader`):** `4 -> 2` primary clicks (`"📥 Quét điểm mới nhất từ LMS"` $\rightarrow$ `"✅ Duyệt & 🚀 Đồng bộ Teaching"`, plus staleness banner `"🔄 Quét lại ngay"`).
   - **Screen 3 (`/final-project` — Buổi 12/13):** `6 -> 4` primary clicks (`<ClassPicker>` + Buổi 12/13 $\rightarrow$ `"Quét & Khớp HV"` with auto-pipeline $\rightarrow$ `"✨ AI nhận xét SPCK"` $\rightarrow$ `"Duyệt & Nộp N bài — Buổi X"`).
   - **Screen 3 (`/final-project` — Buổi 14):** `~11 -> ~6` primary clicks (`<ClassPicker>` + Buổi 14 $\rightarrow$ `"Quét & Khớp HV"` with auto-pipeline + auto-import Demo scores $\rightarrow$ `"✨ AI soạn tất cả (SPCK + Thư MindX)"` $\rightarrow$ `"🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)"`).
   - **Screen 5 (`/teaching-projects`) & Cross-Screen Hand-offs:** `5 -> 1-2` primary clicks (`"🚀 Cập nhật tiến độ theo buổi hiện tại (Buổi X → Y%)"`, 1-click Teaching progress card and Report Card link on Screen 3 after `VERIFIED`, and `"📌 Việc cần làm hôm nay"` cards on `/` Dashboard).

## 2. Mandatory Safety & Verification Commands
Always set in every process:
- `ALLOWED_LOCAL_DIRS=$env:TEMP`
- `MINDX_DB_PATH=$env:TEMP\mindx_codex_s8_final.db`
- `MINDX_RUNNING_CLASSES_PATH=$env:TEMP\mindx_codex_s8_final_rc.json`
- `GEMINI_API_KEY=test-s8-dummy-key`

Run and record results for:
1. `npx tsc --noEmit --incremental false`
2. `npx tsx scripts/test-streamline-v340-s1.ts`
3. `npx tsx scripts/test-streamline-v340-s2.ts`
4. `npx tsx scripts/test-streamline-v340-s3.ts`
5. `npx tsx scripts/test-streamline-v340-s4.ts`
6. `npx tsx scripts/test-streamline-v340-s5a.ts`
7. `npx tsx scripts/test-streamline-v340-s5.ts`
8. `npx tsx scripts/test-streamline-v340-s6.ts`
9. `npx tsx scripts/test-streamline-v340-s7.ts`
10. `npx next build --webpack` (in an isolated TEMP copy or with `MINDX_DB_PATH` & `MINDX_RUNNING_CLASSES_PATH` set to `$env:TEMP`, restoring `next-env.d.ts` if Next build touches it)
11. Production SHA-256 check before & after (`data/mindx_bot.db` and `data/running_classes.json`).

## 3. Deliverable
Write the complete Final Acceptance Audit report to `docs/audits/v340/CODEX_V340_FINAL.md` with:
- Stage `S0`–`S7` closure summary table
- 6-rule `AGENTS.md` compliance table
- Click-count & workflow streamlining verification table across all 5 screens
- Command & build verification table + production data SHA-256 preservation table
- Explicit final verdict: **GO** or **NO-GO** for `v3.4.0`.
