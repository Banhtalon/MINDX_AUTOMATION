---
name: graphify
description: Build or refresh the local offline code-only knowledge graph for MINDX-AUTOMATION (zero external API calls, strict PII isolation)
---

# Workflow: graphify (Offline Code-Only Mode)

In `MINDX-AUTOMATION`, ALWAYS run Graphify in **100% local AST code-only mode** so zero student PII, `.env`, SQLite databases, or `docs/audits/` files are ever read or sent to any LLM API:

1. Verify `.graphifyignore` is present and `/graphify-out/` is in `.gitignore`.
2. Run offline extraction and clustering in PowerShell:
   ```powershell
   $env:GRAPHIFY_BACKEND = "none"
   $env:GEMINI_API_KEY = ""
   $env:GOOGLE_API_KEY = ""
   graphify extract . --code-only
   graphify cluster-only . --no-label
   graphify export callflow-html . --label "MindX Automation Bot"
   ```
3. Query relationships locally via `graphify query "<question>"`, `graphify explain "<symbol>"`, or `graphify path "<A>" "<B>"`.
