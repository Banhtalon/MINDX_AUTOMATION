@echo off
cd /d "f:\MINDX_project test\MINDX-AUTOMATION"
codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" -s workspace-write --skip-git-repo-check -o "docs\audits\v272\CODEX_REVIEW.md" "Read docs/audits/v272/REVIEW_BRIEF.md and perform the independent review exactly as instructed there. Do not modify any source files. Write the final report in Vietnamese." < NUL > "docs\audits\v272\codex_run.log" 2>&1
