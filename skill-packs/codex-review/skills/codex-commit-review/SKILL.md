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
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `medium`). Ask input source: `draft` (user provides message text) or `last` (review last N commits, default 1). Ask output format: `markdown` (default), `json`, `sarif`, or `both`. Set `EFFORT`, `MODE`, and `FORMAT`.
2. Gather commit message(s) and diff context. Build prompt from `references/prompts.md`.
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT" --format "$FORMAT"`.
4. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is reading, what topic it is analyzing). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
5. Parse issue list with `references/output-format.md`.
6. Propose revised commit message for valid issues; rebut invalid findings with evidence.
7. Resume debate via `--thread-id` until `APPROVE` or stalemate.
8. Return final revised message and review summary.

### Effort Level Guide
| Level    | Depth             | Best for                        |
|----------|-------------------|---------------------------------|
| `low`    | Surface check     | Quick sanity check              |
| `medium` | Standard review   | Most day-to-day work            |
| `high`   | Deep analysis     | Important features              |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     |

### Output Format Guide
| Format     | Output Files                          | Best for                        |
|------------|---------------------------------------|---------------------------------|
| `markdown` | `review.txt` (human-readable)         | Default, interactive review     |
| `json`     | `review.txt` + `review.json`          | CI/CD integration, automation   |
| `sarif`    | `review.txt` + `review.sarif.json`    | IDE integration (VS Code, etc.) |
| `both`     | All above + `review.md` (rendered)    | Complete documentation          |

**Note**: `review.txt` is always written for backward compatibility.

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- **Safety**: NEVER run `git commit --amend`, `git rebase`, or any command that modifies commit history. Only **propose** revised messages — user applies manually.
- Codex reviews message quality only; it does not review code.
- Every accepted issue must map to a concrete message edit.
- If stalemate persists, present both sides and defer to user.
