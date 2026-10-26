# Independent Review Brief — MindX Automation Bot v2.7.2

You are an independent senior reviewer (adversarial code review + QA audit). **Do NOT modify any source file** under `src/`, `scripts/`, `data/`, or project docs. You may read anything and you may run read-only commands and the test commands listed below. Write your final report in **Vietnamese**.

Read first: `AGENTS.md` (project rules — mandatory), `PROJECT_STATE.md`, and the `[v2.7.2]` entry at the top of `CHANGELOG.md`.

## Scope (changes in v2.7.2)

1. **Bug fix — AI comments for Session 12/13 discarded when Session 14 is already VERIFIED**
   - `src/lib/gemini/spck-comment.ts`: concurrent-edit detection now uses `initialSessionStatus` / `initialDbStatus` (only treat APPROVED/VERIFIED as conflict if the status changed while Gemini was running). `sanitizeStage1ProgressClaims` no longer injects internal labels ("buổi 12", "giai đoạn 1").
   - `src/app/final-project/page.tsx`: `handleGenerateAiComments` banner now reports success / INSUFFICIENT_INFO / FAILED counts honestly; `handleScanFolder` keeps on-screen quickTags / teacherNote / teacherComment when DB values are empty.
   - Regression added in `scripts/test-spck-v270.ts` (inside T04/T05 block).
2. **Owner photo priority for Thumbnail**
   - `src/lib/local-files/spck-scanner.ts`: new `findOwnerProvidedRootPhotos()`, new `thumbnailSource` on `StudentSpckPackage`, new priority branch in `scanStudentSpckFolder`.
   - `src/lib/local-files/spck-app-screenshotter.ts`: new Thumbnail/Gallery rule in `captureStudentAppScreenshots` (owner upload `thumb_*` → owner upload → owner root photo → AI best app shot → MindX logo; owner content never silently dropped; auto shots trimmed to LMS max 10).
   - `src/app/api/spck/scan/route.ts`: owner photo overrides previously captured app-shot Thumbnail on rescan.
3. **LMS-safe 960×540 screenshots**
   - New `src/lib/local-files/spck-image-normalizer.ts` (local headless Chromium, `contain` / `cover`).
   - `captureHtmlWebScreenshots`: layout 1440×810 CSS px, `deviceScaleFactor = 2/3` → 960×540 output, animations forced to final state, `animations: "disabled"`, `forceRevealVisibleContent`.
   - PyQt captures normalized via `normalizeCapturedAppWindowsToLms` (raw capture deleted only if not referenced by any session snapshot).
4. **Robotics: YouTube playlist import**
   - New `src/lib/local-files/spck-youtube-import.ts` and `src/app/api/spck/import-youtube/route.ts`; UI section "1D" + `handleImportYoutubeProducts` in `src/app/final-project/page.tsx`.
   - Parses playlist / video links, reads `ytInitialData`, matches video titles to students (MATCHED / AMBIGUOUS / CONFLICT / UNMATCHED), downloads 2 frames (`i.ytimg.com` maxres/sd/hq, player-capture fallback), writes frames into `<studentFolder>/_spck_youtube_frames/` or `data/spck_youtube/<class>/<student>/`, updates `spck_uploads` + syncs the selected session draft unless that session is APPROVED/VERIFIED. Thumbnail = owner photo or MindX logo, never a YouTube frame.
   - Tests: `scripts/test-spck-v272.ts` (V01–V08).

## What to check (be adversarial)

- **Project rules in `AGENTS.md`**: local-only (127.0.0.1 guard on new route), Path Allowlist on every disk read/write, no secrets to client components, data keyed by classId/studentId/sessionNumber, approved/verified sessions must never be altered, contentHash/demotion semantics, MindX logo fallback for Thumbnail, no silent slicing of owner content, Playwright discipline (note: the new code launches separate isolated headless Chromium for local rendering only — judge whether this is acceptable vs. the single persistent context / SequentialTaskQueue rule).
- **Correctness**: stale-detection logic (can a genuine concurrent edit now slip through?), owner-photo detection false positives/negatives (Python/PyQt assets referenced dynamically, website assets in root), thumbnail priority edge cases, gallery limit handling, rescan behavior in scan route, file deletion safety (could a file referenced by a verified/approved snapshot or the shared pool be deleted?), Windows path case/escaping issues, YouTube title→student matching (Vietnamese names, duplicate given names, class code stripping, stop-words removing real name tokens like "An"), playlist parsing robustness, frame download fallbacks, re-import behavior, session sync and `syncedToSession` reporting, UI state races (dirty rows, class switch during import), error handling and honest reporting to the teacher.
- **Security**: SSRF / arbitrary URL fetch, input size limits, path traversal via studentId/classId in managed folder names, HTML/data-URL injection in the normalizer page.
- **Regressions**: anything in v2.7.0 behavior broken (T01–T16), Phase 6 tests.

## Commands you may run

```
npx tsc --noEmit --incremental false
npx tsx scripts/test-spck-v272.ts
npx tsx scripts/test-spck-v270.ts
npx tsx scripts/test-phase6.ts
```
(These tests create and clean up their own TEST_* rows and temp folders. Do not run anything that uploads to the real MindX LMS.)

## Report format (Vietnamese)

1. Tóm tắt & kết luận **GO / NO-GO**.
2. Bảng phát hiện: mã (`V272-F01`...), mức độ (Critical / High / Medium / Low), file:dòng, mô tả, cách tái hiện, đề xuất sửa.
3. Kết quả các lệnh kiểm thử đã chạy.
4. Các điểm đã kiểm tra và xác nhận đúng.
