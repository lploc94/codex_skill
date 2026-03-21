---
name: codex-commit-review
description: Peer debate between Claude Code and Codex on commit message quality. Both sides review independently, then debate until consensus — no modifications made.
---

# Codex Commit Review

## Purpose
Use this skill to debate commit message quality before or after committing. Claude and Codex are equal analytical peers — Claude orchestrates the debate loop and final synthesis. No commit messages are modified.

## When to Use
After staging changes (draft mode) or after committing (last mode). Use to verify commit message quality and alignment with the actual diff before push.

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
3. Build Codex prompt + Claude analysis prompt from `references/prompts.md`, following the Placeholder Injection Guide. **Start Codex** (background) with `node "$RUNNER" start`.
4. **Claude Independent Analysis** (BEFORE reading Codex output): Claude analyzes commit message(s) independently using format from `references/claude-analysis-template.md`. **INFORMATION BARRIER** — do NOT read `$STATE_DIR/review.md` until analysis is complete. See `references/workflow.md` Step 2.5.
5. Poll Codex with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output. See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
6. **Cross-Analysis**: Compare Claude's FINDING-{N} with Codex's ISSUE-{N}. Identify genuine agreements, genuine disagreements, and unique findings from each side. See `references/workflow.md` Step 4.
7. Resume debate via `--thread-id` until consensus, stalemate, or hard cap (5 rounds).
8. Present final consensus report with agreements, disagreements, and both sides' overall assessments. **NEVER propose revised commit messages.**
9. Cleanup: `node "$RUNNER" stop "$STATE_DIR"`.

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
- Claude analysis format: `references/claude-analysis-template.md`

## Rules
- **Safety**: NEVER run `git commit --amend`, `git rebase`, or any command that modifies commit history. This skill is debate-only.
- Both Claude and Codex are equal peers — no reviewer/implementer framing.
- **Information barrier**: Claude MUST complete independent analysis (Step 2.5) before reading Codex output. This prevents anchoring bias.
- **NEVER propose revised commit messages** — only debate quality. The final output is a consensus report, not a fix.
- Codex reviews message quality only; it does not review code.
- Discover project conventions before reviewing (see `references/workflow.md` §1.6).
- For `last` mode with N > 1: findings must reference specific commit SHA/subject in Evidence.
- If stalemate persists (same unresolved points for 2 consecutive rounds), present both sides and defer to user.
