---
name: codex-codebase-review
description: Review entire codebases (50-500+ files) by chunking into modules, reviewing each chunk in a separate Codex session, then synthesizing cross-cutting findings. No runner changes needed.
---

# Codex Codebase Review

## Purpose
Review large codebases (50-500+ files) that exceed single-session context limits. Splits codebase into module-based chunks, reviews each in an independent Codex session, then Claude synthesizes cross-cutting findings across modules.

## When to Use
For full codebase audit (50–500+ files). Not for incremental change review — use `/codex-impl-review` for that. Run periodically for architecture/quality sweeps or before major releases.

## Prerequisites
- Source files in working directory.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Collect inputs**: Auto-detect effort and announce default before asking anything.
   - **effort**: Count source files `find . -type f -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' | wc -l` — <50 → `medium`, 50–200 → `high`, >200 → `xhigh`; default `high`.
   - Announce: "Detected: effort=`$EFFORT` (N files changed). Proceeding — reply to override."
   - Set `EFFORT`. Also ask: parallel factor (default 3 chunks), focus areas (optional).
2. **Discovery**: detect project type, list source files, identify module boundaries.
3. **Chunking**: group files into 500-2000 line chunks, present chunk plan.
4. **Review loop**: for each chunk — build prompt, `node "$RUNNER" start`, poll, parse ISSUE-{N}, propagate context.
5. **Cross-cutting analysis**: Claude synthesizes all chunk findings — inconsistencies, API contracts, DRY violations, integration, architecture.
6. **Validation** (effort >= high): feed CROSS-{N} findings to Codex for verification.
7. **Final report**: overview table, per-module findings, cross-cutting findings, action items.
8. **Cleanup**: stop ALL tracked STATE_DIRs — always runs regardless of outcome.

### Effort Level Guide
| Level    | Discovery        | Cross-cutting    | Validation   | Typical time        |
|----------|------------------|------------------|--------------|---------------------|
| `low`    | Auto-detect only | Basic (2 cats)   | Skip         | ~10-20 min/chunk    |
| `medium` | Auto + confirm   | Standard (3 cats)| Skip         | ~15-30 min/chunk    |
| `high`   | Full + confirm   | Full (5 cats)    | 1 round      | ~20-40 min/chunk    |
| `xhigh`  | Full + suggest   | Full + arch      | 2 rounds     | ~30-60 min/chunk    |

## Required References
- Detailed orchestration: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Codex reviews only; it does not edit files.
- No cross-contamination between chunk sessions — each chunk is independent.
- Context propagation: only high/critical findings from prior chunks, capped at ~2000 tokens.
- Cleanup always runs — stop every tracked STATE_DIR regardless of outcome.
- Scope is full codebase only — for diff review use `/codex-impl-review`.
