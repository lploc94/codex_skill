---
name: codex-pr-review
description: Peer debate between Claude Code and Codex on PR quality and merge readiness. Both sides review independently, then debate until consensus — no code modifications made.
---

# Codex PR Review

## Purpose
Use this skill to run peer debate on branch changes before merge — covering code quality, PR description, commit hygiene, scope, and merge readiness. Claude and Codex are equal analytical peers — Claude orchestrates the debate loop and final synthesis. No code is modified.

## When to Use
Before opening or merging a pull request. Covers branch diff, commit history, and PR description together in one pass — more thorough than `/codex-impl-review` for pre-merge scenarios.

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
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask for base branch (discover and validate — see workflow.md §1). Ask for PR title and description (optional). Set `EFFORT`.
2. Run pre-flight checks (see `references/workflow.md` §1.5).
3. Gather branch diff, commit log, file stats. Build prompts from `references/prompts.md`, following the Placeholder Injection Guide. **Start Codex** (background) with `node "$RUNNER" start`.
4. **Claude Independent Analysis** (BEFORE reading Codex output): Claude analyzes the PR independently using format from `references/claude-analysis-template.md`. **INFORMATION BARRIER** — do NOT read `$STATE_DIR/review.md` until analysis is complete. See `references/workflow.md` Step 2.5.
5. Poll Codex with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output. See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
6. **Cross-Analysis**: Compare Claude's FINDING-{N} with Codex's ISSUE-{N}. Identify genuine agreements, genuine disagreements, and unique findings from each side. See `references/workflow.md` Step 4.
7. Resume debate via `--thread-id` until consensus, stalemate, or hard cap (5 rounds).
8. Final: consensus report + **Merge Readiness Scorecard** + **MERGE / REVISE / REJECT** recommendation. **NEVER edit code.**
9. Cleanup: `node "$RUNNER" stop "$STATE_DIR"`.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|--------------|
| `low`    | Surface check     | Quick sanity check              | ~3-5 min     |
| `medium` | Standard review   | Most day-to-day work            | ~8-12 min    |
| `high`   | Deep analysis     | Important features              | ~15-20 min   |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~25-40 min   |

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`
- Claude analysis format: `references/claude-analysis-template.md`

## Rules
- **Safety**: NEVER run `git commit`, `git add`, `git rebase`, or any command that modifies code or history. This skill is debate-only.
- Both Claude and Codex are equal peers — no reviewer/implementer framing.
- **Information barrier**: Claude MUST complete independent analysis (Step 2.5) before reading Codex output. This prevents anchoring bias.
- **NEVER edit code or create commits** — only debate quality and assess merge readiness. The final output is a consensus report + merge readiness scorecard, not a fix.
- Codex reviews only; it does not edit files.
- If stalemate persists (same unresolved points for 2 consecutive rounds), present both sides, produce Merge Readiness Scorecard from agreed findings, and defer to user.
