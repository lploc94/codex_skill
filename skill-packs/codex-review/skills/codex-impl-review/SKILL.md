---
name: codex-impl-review
description: Have Codex CLI review uncommitted code changes or branch diff against a base branch. Claude applies valid fixes, rebuts invalid points, and iterates until consensus or user-approved stalemate.
---

# Codex Implementation Review

## Purpose
Use this skill to run adversarial review on uncommitted changes before commit, or on branch changes before merge.

## Prerequisites
- **Working-tree mode** (default): working tree has staged or unstaged changes.
- **Branch mode**: current branch differs from base branch (has commits not in base).
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask review mode: `working-tree` (default) or `branch`. If branch mode, ask for base branch name and validate (see workflow.md for base branch discovery). Ask output format: `markdown` (default), `json`, `sarif`, or `both`. Set `EFFORT`, `MODE`, and `FORMAT`.
2. Build prompt from `references/prompts.md` (Working Tree or Branch Review Prompt).
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT" --format "$FORMAT"`.
4. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is reading, what topic it is analyzing). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
5. Parse issue list with `references/output-format.md`.
6. Fix valid issues in code; rebut invalid findings with evidence.
7. Resume debate via `--thread-id` until `APPROVE` or stalemate.
8. Return final review summary and unresolved risks.

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
- Codex reviews only; it does not edit files.
- Preserve functional intent unless fix requires behavior change.
- Every accepted issue must map to a concrete code diff.
- If stalemate persists, present both sides and defer to user.
