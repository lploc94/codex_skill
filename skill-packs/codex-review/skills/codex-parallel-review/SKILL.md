---
name: codex-parallel-review
description: Parallel independent review by both Claude (4 agents) and Codex, followed by merge, debate on disagreements, and consensus report. No external plugins required.
---

# Codex Parallel Review

## Purpose
5 reviewers analyze the same codebase simultaneously: 4 Claude Code agents (via native Agent tool) + 1 Codex subprocess. Findings are merged, disagreements debated, consensus reported.

## When to Use
When you want independent dual-reviewer analysis. Produces higher-confidence findings than single-reviewer skills because findings are cross-validated between Claude agents and Codex before being reported.

## Prerequisites
- **Working-tree mode** (default): working tree has staged or unstaged changes.
- **Branch mode**: current branch differs from base branch.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).
- **No external plugins required** — Agent tool is built into Claude Code.

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Collect inputs**: Auto-detect effort and announce default.
   - **effort**: Depends on mode. `full-codebase`: count source files (`find . -type f -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' | wc -l`) — <50 → `medium`, 50–200 → `high`, >200 → `xhigh`. `working-tree`/`branch`: use `git diff --name-only | wc -l` — <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high`.
   - Announce: "Detected: effort=`$EFFORT` (N files changed). Proceeding — reply to override effort. Review mode: `full-codebase` (default) / `working-tree` / `branch`."
   - Set `EFFORT`. Ask `MODE` only if user doesn't confirm default.
2. **Launch all 5 reviewers in ONE message** (true parallelism):
   - Start Codex via runner (background subprocess).
   - Spawn 4 `code-reviewer` agents via Agent tool with `run_in_background: true`:
     - Agent 1: correctness + edge cases
     - Agent 2: security (DEEP — OWASP Top 10, secrets, crypto, deps, auth flow)
     - Agent 3: performance
     - Agent 4: maintainability + architecture
   - See `references/workflow.md` Step 2 for exact Agent tool JSON.
3. **Poll Codex + collect agent results**: adaptive intervals while all 5 work.
4. **Merge**: deduplicate Claude agents' findings, cross-match vs Codex. Categorize: agreed / claude-only / codex-only / contradictions.
5. **Apply + Debate**: fix agreed issues. Debate disagreements via Codex thread resume. Max `MAX_ROUNDS` rounds.
6. **Final Report**: consensus, resolved, unresolved, risk assessment.
7. **Cleanup**: always `node "$RUNNER" stop "$STATE_DIR"`.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|--------------|
| `low`    | Surface check     | Quick sanity check              | ~5-10 min    |
| `medium` | Standard review   | Most day-to-day work            | ~10-20 min   |
| `high`   | Deep analysis     | Important features              | ~20-30 min   |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~30-45 min   |

## Required References
- Detailed execution + Agent tool JSON: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- All 4 Claude agents and Codex review independently — no cross-contamination before merge.
- Codex reviews only; it does not edit files.
- Claude applies fixes for agreed and accepted issues.
- Max debate rounds enforced (default 3); user can override.
- On stalemate, present both sides and defer to user.
- If agents or Codex fail, degrade gracefully (see workflow.md Error Handling).
