---
name: codex-pr-review
description: Have Codex CLI review a PR (branch diff, commit history, and PR description). Claude addresses valid issues, rebuts invalid points, and iterates until consensus or stalemate.
---

# Codex PR Review

## Purpose
Use this skill to run adversarial review on branch changes before merge — covering code quality, PR description, commit hygiene, and scope.

## Prerequisites
- Current branch differs from base branch (has commits not in base).
- `git diff <base>...HEAD` produces output.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask for base branch (discover and validate — see workflow.md). Ask for PR title and description (optional). Set `EFFORT`.
2. Gather branch diff, commit log, file stats. Build prompt from `references/prompts.md`.
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
4. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is reading, what topic it is analyzing). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
5. Parse issue list with `references/output-format.md`.
6. Fix valid code issues; rebut invalid findings with evidence.
7. Resume debate via `--thread-id` until `APPROVE` or stalemate.
8. Return final review summary with PR-level recommendations.

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
- Codex reviews only; it does not edit files.
- Preserve functional intent unless fix requires behavior change.
- Every accepted code issue must map to a concrete code diff.
- PR-level issues (description, commit hygiene, scope) result in recommendations, not code edits.
- If stalemate persists, present both sides and defer to user.
