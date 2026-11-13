---
trigger: always_on
description: Consult the local offline Graphify knowledge graph (graphify-out/) for cross-file call/dependency tracing while preserving MindX PII & Single-Source-of-Truth rules.
---

## Graphify (Offline Code-Only Knowledge Graph)

This project maintains a 100% local, offline AST knowledge graph at `graphify-out/graph.json` (`graphifyy`, excluded from Git via `.gitignore` and fenced by `.graphifyignore`).

Rules:
- **Single Source of Truth first:** Always read `@PROJECT_STATE.md` first for live LMS rules and project overview (per Rule 1 in `AGENTS.md`).
- **Fast code navigation:** When `graphify-out/graph.json` exists and you need to trace callers, callees, cross-file dependencies, or impact radius, run `graphify query "<question>"`, `graphify explain "<symbol>"`, or `graphify path "<A>" "<B>"` before reading/grepping many raw files.
- **Strict Privacy & Zero-API Guard (MANDATORY):** NEVER run Graphify semantic/LLM passes on docs, images, or `data/`. Keep `.graphifyignore` intact. Whenever building or refreshing the graph in this project, ALWAYS run strictly offline (`$env:GRAPHIFY_BACKEND="none"` + `graphify update .` or `graphify extract . --code-only` followed by `graphify cluster-only . --no-label`).
- **Keep graph fresh after code edits:** After modifying source files in `src/` or `scripts/`, run `graphify update .` (AST-only, local, 0 API tokens) if `graphify` is installed.
