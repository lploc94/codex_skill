---
name: codex-impl-review
description: Have Codex CLI review uncommitted code changes or branch diff against a base branch. Claude applies valid fixes, rebuts invalid points, and iterates until consensus or user-approved stalemate.
---

# Codex Implementation Review

## Purpose
Use this skill to run adversarial review on uncommitted changes before commit, or on branch changes before merge.

## When to Use
After writing code, before committing. Use for uncommitted working-tree changes or comparing a branch against base. For security-sensitive code, run `/codex-security-review` alongside this.

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
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **scope** (detected first): Run `git status --short | grep -v '^??'` — non-empty output → `working-tree`. Else run `git rev-list @{u}..HEAD` — non-empty → `branch`. If both conditions true, use `working-tree`. If neither, ask user.
   - **effort** (adapts to detected scope): If scope=`branch`, count `git diff --name-only @{u}..HEAD`; else count `git diff --name-only`. Result <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high` if undetectable.
   - Announce: "Detected: scope=`$SCOPE`, effort=`$EFFORT` (N files changed). Proceeding — reply to override scope, effort, or both."
   - Set `SCOPE` and `EFFORT`. Only block for inputs that remain undetectable.
2. Run pre-flight checks (see `references/workflow.md` §1.5).
3. Build prompt from `references/prompts.md` (Working Tree or Branch Review Prompt), following the Placeholder Injection Guide.
4. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
5. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is reading, what topic it is analyzing). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
6. Parse issue list with `references/output-format.md`.
7. Fix valid issues in code; rebut invalid findings with evidence.
8. Resume debate via `--thread-id` until `APPROVE`, stalemate, or hard cap (5 rounds).
9. Return final review summary, residual risks, and recommended next steps.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|-------------|
| `low`    | Surface check     | Quick sanity check              | ~2-3 min |
| `medium` | Standard review   | Most day-to-day work            | ~5-8 min |
| `high`   | Deep analysis     | Important features              | ~10-15 min |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~20-30 min |

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- If invoked during Claude Code plan mode, exit plan mode first — this skill requires code editing.
- Codex reviews only; it does not edit files.
- Preserve functional intent unless fix requires behavior change.
- Every accepted issue must map to a concrete code diff.
- If stalemate persists, present both sides and defer to user.
