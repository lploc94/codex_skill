---
name: codex-parallel-review
description: Parallel independent review by both Claude and Codex, followed by merge, debate on disagreements, and consensus report.
---

# Codex Parallel Review

## Purpose
Both Claude and Codex review the same codebase independently and in parallel. After both complete, findings are merged, disagreements are debated, and a consensus report is produced.

## Prerequisites
- **Working-tree mode** (default): working tree has staged or unstaged changes.
- **Branch mode**: current branch differs from base branch.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Ask user** for effort level (`low`/`medium`/`high`/`xhigh`, default: `high`), review mode (`working-tree`/`branch`), and max debate rounds (default: 3).
2. **Phase 1 — Parallel Review (all concurrent)**:
   - Start Codex via runner (background subprocess).
   - Spawn 3 `code-reviewer` agents in parallel via Agent tool, each covering different categories. See `references/workflow.md` for agent assignments.
   - Poll Codex while agents run. All 4 reviewers work simultaneously.
3. **Phase 2 — Merge**: Aggregate findings from 3 Claude agents + Codex. Categorize into agreed / claude-only / codex-only / contradictions.
4. **Phase 3 — Debate**: Apply agreed fixes. For disagreements, Claude rebuts or concedes; resume Codex thread for response. Loop until resolved or round limit.
5. **Phase 4 — Final Report**: Present consensus, resolved disagreements, unresolved items, and risk assessment.
6. **Cleanup**: Always run `node "$RUNNER" stop "$STATE_DIR"`.

### Effort Level Guide
| Level    | Depth             | Best for                        |
|----------|-------------------|---------------------------------|
| `low`    | Surface check     | Quick sanity check              |
| `medium` | Standard review   | Most day-to-day work            |
| `high`   | Deep analysis     | Important features              |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     |

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Claude and Codex review independently before seeing each other's findings.
- Codex reviews only; it does not edit files.
- Claude applies fixes for agreed and accepted issues.
- Max debate rounds enforced (default 3); user can override.
- On stalemate, present both sides and defer to user.
