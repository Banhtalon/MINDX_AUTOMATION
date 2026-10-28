# v3.1.0 — Independent review, Round 3

Date: 2026-10-28. Reviewer: Codex, acting as the independent reviewer requested by the Owner. Compared the working tree, including the untracked navbar, against `backup/pre-v3.1-theme-redesign` (`f903edd480011672a26f356786d1b836947dd836`; also current HEAD). No application code was changed during this review.

**Verdict: NO-GO. R2-01 and R2-02 are CLOSED. One additional reproducible Light Mode regression, R3-01, remains.**

## Finding

### R3-01 — P2: Student status badges become dark text on dark fills in Light Mode

- Location: `src/app/globals.css:387-390`; affected status markup: `src/app/session-comments/page.tsx:2542-2555`.
- Trigger: open the session-comments student table with a draft, approved, saving, or failed student and select Light Mode.
- The global `.text-white:not(button):not(a[class*="bg-"])` adaptation overrides the white text on the redesigned status `span` elements with `#0f172a !important`. Their solid indigo/blue/rose/slate fills remain unchanged. The exceptions at lines 393-400 cover hero headings and table headers, not status badges in table bodies.
- Most visibly, `Bản nháp` computes to `rgb(15,23,42)` on `rgb(49,65,88)`, only **1.72:1** contrast at `text-xs`. `Đã duyệt` is **2.76:1**, `Đang lưu` **3.40:1**, and `Thất bại` **3.94:1**. This makes teachers' approval/save-state labels difficult to read. Both emulated OS color preferences reproduce the same Light Mode result.
- The backup uses `bg-slate-800 text-slate-400` for drafts and tinted backgrounds with light colored text for the other statuses. The redesign changes these to solid fills plus `text-white`, introducing their interaction with the new global override. This is attributable to the redesign, although it was not reported in Round 2.
- Required correction: give these status badges explicit theme-aware foreground/background pairs, or a scoped exception that preserves light text on their solid dark fills. Recheck draft, approved, saving, failed, and verified states in both app themes. Preserve the two homework-grader fixes.
- Evidence: `round3/theme-probe-results.json`, `round3/status-contrast-findings.json`, and `round3/theme-light-os-dark.png`. These use badge classes extracted directly from the current TSX, placed inside `.mindx-main` with the compiled current stylesheet.

## Requested Round 2 verification

| Finding | Status | Independent evidence |
| --- | --- | --- |
| R2-01: exercise column titles inside `.mindx-thead` | CLOSED | Strengthened exceptions in `src/app/globals.css:397-399` now beat the general text adaptation. The unchanged nested `div.text-white` at `src/app/homework-grader/page.tsx:838` computes white on navy `#172554` in Light Mode: **14.69:1** contrast. Two populated exercise columns were probed. Dark Mode remains white on `#0d162b`: **18.00:1**. |
| R2-02: total student count inside the summary badge | CLOSED | `src/app/homework-grader/page.tsx:686` uses `text-slate-900 dark:text-white`. Hero exceptions are now scoped to headings instead of all hero `.text-white` descendants. The synthetic total `7` computes dark on white in Light Mode: **17.83:1**; white on dark in Dark Mode: **20.16:1**. |

Both closures passed all four app Light/Dark × OS Light/Dark combinations. Tailwind's OKLCH colors were converted by Chromium canvas to sRGB before calculating ratios; the rendered `text-slate-900` count is `rgb(15,23,43)`.

## Checks and limits

- PASS: `node_modules\.bin\tsc.cmd --noEmit --incremental false`, exit 0, in the original checkout.
- PASS: `scripts/test-quick-tags-v300.ts`, exit 0, in a same-volume isolated source/config copy without real `.env` files, DB, or browser profile.
- PASS: `scripts/test-checkpoint-v300.ts`, including CP-01..CP-05, exit 0, in that isolated copy.
- PASS: the Round 1 `data-theme` Tailwind variant and session-comments select/manual input text remain correct across all four app/OS combinations.
- The compiled-CSS Chromium probe closes both Round 2 findings, records all four combinations, and **exits 1 for R3-01**. Run `node docs/audits/v310/round3/theme-probe.mjs` from the repository root. Its `PASS` message refers only to R2/Round 1 checks; the following `FAIL R3-01` and process exit code are the overall result.
- Used one isolated persistent browser context with sequential queued operations. No LMS, Gemini, network business calls, or real student data were used. The fixtures extract current TSX classes and summary markup; they are not a full-app runtime acceptance test. Screenshots cover these fixtures, not all five application pages.
- Reviewed the tracked UI/config diff and untracked navbar against the backup. `git diff --quiet` confirms `src/app/api`, `src/lib`, `data/config`, `package.json`, and `package-lock.json` are unchanged from the backup (exit 0). The extra syllabus save button calls the existing save handler.
- Production build was not rerun. Round 2 recorded pre-existing route-export build failures in `buildEnrichedClassSpckRecords` and `buildEnrichedSession14EvalList`; the containing API files remain unchanged. This review does not certify production-build readiness or claim a fresh 12-suite/10-screen acceptance pass.
- The first probe attempts exposed harness-only issues (JSX `className` conversion and browser OKLCH serialization); these were corrected before recording the final results. No application fixes were made to obtain these results.
- Reviewed source hashes are captured in `round3/reviewed-source-hashes.json`.

Approval condition: resolve R3-01 and repeat the status-badge Light/Dark check while retaining the verified R2-01/R2-02 closures.
