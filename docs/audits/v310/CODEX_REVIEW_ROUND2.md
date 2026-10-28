# v3.1.0 — Independent review, Round 2

Date: 2026-10-28. Reviewer: Codex, acting as the independent reviewer requested by the Owner. Comparison: `git diff backup/pre-v3.1-theme-redesign`; backup and HEAD both resolve to `f903edd480011672a26f356786d1b836947dd836`. Included the untracked `src/components/top-navbar.tsx`, which ordinary `git diff` omits. No application code was changed during this review.

**Verdict: NO-GO. Both Round 1 findings are CLOSED; two reproducible Light Mode contrast regressions remain.**

## Findings

### R2-01 — P2: Exercise column titles are nearly unreadable in Light Mode

- Location: `src/app/globals.css:387-390`, with the ineffective exception at line 398; affected markup: `src/app/homework-grader/page.tsx:838`.
- Trigger: load a score matrix containing exercise columns, then select Light Mode.
- The global `.text-white:not(button):not(a[class*="bg-"])` rule has specificity `(0,4,3)`, which beats the later `.mindx-thead .text-white` exception `(0,4,2)`. Both use `!important`. Consequently the exercise title `div.text-white` computes to `rgb(15, 23, 42)` (`#0f172a`) inside the navy `#172554` table header. Styling the `th` white does not override the child's explicit color.
- Independently reproduced using the current CSS compiled through the installed Tailwind/PostCSS plugin and the exact relevant DOM structure in Chromium. Reproduces with either OS color preference; Dark Mode computes white correctly.
- Required correction: narrow the general text adaptation or strengthen the table-header exception so nested exercise titles remain light on the navy header. Verify computed child colors with a populated matrix.

### R2-02 — P2: The total student count disappears in Light Mode

- Location: `src/app/globals.css:397`, in combination with the white-panel adaptation at lines 351-353; affected markup: `src/app/homework-grader/page.tsx:685-686`.
- Trigger: load a cached or freshly scraped score matrix and select Light Mode.
- The summary's `span.bg-slate-950` becomes white under the generic light-panel rule. Its child `strong.text-white` remains white under the hero descendant exception because the entire score-page header is now `.mindx-hero`. The label stays dark but the numeric total is white on white (`#ffffff` / `#ffffff`, contrast 1:1).
- Independently reproduced with a synthetic total of `7`; the number exists in DOM but disappears visually. Reproduces with either OS color preference; Dark Mode retains the dark background.
- Required correction: keep the numeric count dark inside the adapted light summary badge, or preserve a contrasting badge background. Do not apply the hero-white rule indiscriminately to light panels within the hero.

## Round 1 verification

| Finding | Status | Evidence |
| --- | --- | --- |
| Bind Tailwind `dark:*` to `[data-theme=dark]` | CLOSED | `src/app/globals.css:2` declares `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`. Tested the compiled CSS across all four combinations of app theme and emulated OS color scheme. |
| Restore white class-picker text in Dark Mode | CLOSED | Both the select at `src/app/session-comments/page.tsx:2022` and manual input at line 2048 have `text-slate-900 dark:text-white`. Computed text is `#0f172a` in Light Mode and white in Dark Mode, independent of the emulated OS setting. |

## Checks and limits

- PASS: `node_modules\.bin\tsc.cmd --noEmit --incremental false` in the original checkout, exit 0.
- PASS: `scripts/test-quick-tags-v300.ts` in an isolated copy without `.env` files, real DB, or real browser profile, exit 0.
- PASS: `scripts/test-checkpoint-v300.ts`, including CP-01..CP-05, in the isolated copy, exit 0.
- PASS: four compiled-CSS browser probes covering app Light/Dark × OS Light/Dark. Both requested fixes behave correctly; R2-01 and R2-02 reproduce in both Light Mode cases.
- `npm.cmd run build -- --webpack` in a same-volume isolated copy compiled the frontend successfully, then failed the generated route type checks: `buildEnrichedClassSpckRecords` and `buildEnrichedSession14EvalList` are extra exports from route files. `git diff --quiet` against the backup confirms both route files are unchanged (exit 0). This is a pre-existing build limitation, not a newly attributed theme regression. A successful production build is not claimed.
- The default Turbopack attempt from a cross-volume TEMP copy was blocked by the external `node_modules` junction/root boundary; the first webpack attempt there also hit cross-volume resolution. These are isolation-harness limitations, not product findings.
- An additional full-app development-server smoke attempt did not complete because repeated development reloads prevented `networkidle`. No 10-screen runtime acceptance or persistence-test pass is claimed. The contrast findings rely on the completed compiled-CSS Chromium reproduction, not this incomplete attempt.
- Reviewed the complete tracked UI/config diff and the new navbar. Server/API/automation/data-integrity implementation files are unchanged from the backup. The new bottom save button in syllabus configuration calls the existing save handler.
- The working tree was being updated externally during review: the v3.1.0 changelog entry appeared after the initial status capture. Its earlier GO/12-suite/10-screenshot claim is not evidence from this independent round; this report records the Round 2 result.
- No LMS, Gemini, real class data, or real automation actions were used. Browser reproduction used one isolated persistent context at a time with sequential operations.

Reproduction artifacts: `round2/theme-probe.mjs`, `round2/theme-probe-results.json`, and `round2/theme-probe-light.png`. Run the probe with the project dependencies available and an isolated project copy as the working directory; it creates only test CSS/results/screenshots and a local `playwright-auth` test profile there.

Approval condition: resolve R2-01 and R2-02, then repeat the populated score-matrix Light/Dark checks. The two Round 1 fixes should remain intact.
