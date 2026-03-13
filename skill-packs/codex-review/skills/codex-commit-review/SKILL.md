---
name: codex-commit-review
description: Have Codex CLI review commit messages for clarity, conventions, and accuracy against diffs. Claude proposes revised messages, iterates until consensus or stalemate.
---

# Codex Commit Review

## Purpose
Use this skill to review commit messages before or after committing. Codex checks message quality — not code quality.

## Prerequisites
- **Draft mode**: user provides draft commit message text. Staged changes available for alignment check.
- **Last mode**: recent commits exist (`git log -n N`). Repository has commit history.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `medium`). Ask input source: `draft` (user provides message text) or `last` (review last N commits, default 1). Set `EFFORT` and `MODE`.
2. Run pre-flight checks (see `references/workflow.md` §1.5).
3. Build prompt from `references/prompts.md`, following the Placeholder Injection Guide.
4. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
5. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output. See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
6. Parse issue list with `references/output-format.md`.
7. Propose revised commit message(s) for valid issues; rebut invalid findings with evidence.
8. Resume debate via `--thread-id` until `APPROVE`, stalemate, or hard cap (5 rounds).
9. Return final revised message(s) and review summary.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|-------------|
| `low`    | Surface check     | Quick sanity check              | ~1-2 min |
| `medium` | Standard review   | Most day-to-day work            | ~3-5 min |
| `high`   | Deep analysis     | Important features              | ~5-10 min |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~10-15 min |

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- **Safety**: NEVER run `git commit --amend`, `git rebase`, or any command that modifies commit history. Only **propose** revised messages — user applies manually.
- Codex reviews message quality only; it does not review code.
- Every accepted issue must map to a concrete message edit.
- Discover project conventions before reviewing (see `references/workflow.md` §1.6).
- For `last` mode with N > 1: findings must reference specific commit SHA/subject in Evidence.
- If stalemate persists (same unresolved issues for 2 consecutive rounds), present both sides and defer to user.
