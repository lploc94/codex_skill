---
name: codex-parallel-review
description: Parallel independent review by both Claude (3 agents) and Codex, followed by merge, debate on disagreements, and consensus report. No external plugins required.
---

# Codex Parallel Review

## Purpose
4 reviewers analyze the same codebase simultaneously: 3 Claude Code agents (via native Agent tool) + 1 Codex subprocess. Findings are merged, disagreements debated, consensus reported.

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
1. **Collect inputs**: effort level, review mode (`full-codebase` default / `working-tree` / `branch`), max debate rounds (default: 3). Capture file list (+ diff if applicable).
2. **Launch all 4 reviewers in ONE message** (true parallelism):
   - Start Codex via runner (background subprocess).
   - Spawn 3 `code-reviewer` agents via Agent tool with `run_in_background: true`:
     - Agent 1: correctness + edge cases
     - Agent 2: security + performance
     - Agent 3: maintainability + architecture
   - See `references/workflow.md` Step 2 for exact Agent tool JSON.
3. **Poll Codex + collect agent results**: adaptive intervals while all 4 work.
4. **Merge**: deduplicate Claude agents' findings, cross-match vs Codex. Categorize: agreed / claude-only / codex-only / contradictions.
5. **Apply + Debate**: fix agreed issues. Debate disagreements via Codex thread resume. Max `MAX_ROUNDS` rounds.
6. **Final Report**: consensus, resolved, unresolved, risk assessment.
7. **Cleanup**: always `node "$RUNNER" stop "$STATE_DIR"`.

### Effort Level Guide
| Level    | Depth             | Best for                        |
|----------|-------------------|---------------------------------|
| `low`    | Surface check     | Quick sanity check              |
| `medium` | Standard review   | Most day-to-day work            |
| `high`   | Deep analysis     | Important features              |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     |

## Required References
- Detailed execution + Agent tool JSON: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Claude agents and Codex review independently — no cross-contamination before merge.
- Codex reviews only; it does not edit files.
- Claude applies fixes for agreed and accepted issues.
- Max debate rounds enforced (default 3); user can override.
- On stalemate, present both sides and defer to user.
- If agents or Codex fail, degrade gracefully (see workflow.md Error Handling).
