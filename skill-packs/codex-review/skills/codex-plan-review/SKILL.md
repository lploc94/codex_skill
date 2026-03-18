---
name: codex-plan-review
description: Review/debate plans before implementation between Claude Code and Codex CLI.
---

# Codex Plan Review

## Purpose
Use this skill to adversarially review a plan before implementation starts.

## When to Use
Use **after creating a plan** but **before implementing code**.

Typical workflow:
1. Create plan (plan.md) → 2. `/codex-plan-review` → 3. Refine plan → 4. Implement → 5. `/codex-impl-review`

Not a substitute for code review. Reviews plan quality, not implementation.

## Prerequisites
- A Markdown plan file exists (e.g. `plan.md`) with headings for sections, steps, or phases.
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **plan-path**: Scan CWD for `plan.md`, `PLAN.md`, `docs/plan.md`. If single match found, use it. If multiple matches, list them and ask user to choose. If none, ask user for path.
   - **effort**: Default `high` for plan review (plans typically cover significant scope).
   - Announce detected plan path and effort. Proceeding — reply to override.
   - Set `PLAN_PATH` and `EFFORT`. Block only if plan file cannot be found or resolved.
2. Run pre-flight checks (see `references/workflow.md` §1.5).
3. Build prompt from `references/prompts.md` (`Plan Review Prompt`), following the Placeholder Injection Guide.
4. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
5. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is reading, what topic it is analyzing). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
6. Parse Codex issues (`ISSUE-{N}` + `VERDICT`) using `references/output-format.md`.
7. Apply valid fixes to the plan, **save the plan file**, rebut invalid points, and resume with `--thread-id`.
8. Repeat until `APPROVE`, stalemate, or hard cap (5 rounds).
9. Return final debate summary, residual risks, and final plan path.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|-------------|
| `low`    | Surface check     | Quick sanity check              | ~2-3 min |
| `medium` | Standard review   | Most day-to-day work            | ~5-8 min |
| `high`   | Deep analysis     | Important features              | ~10-15 min |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~20-30 min |

## Required References
- Detailed execution steps: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- If Claude Code plan mode is active, stay in plan mode during the debate. Otherwise, operate normally.
- Do not implement code in this skill.
- Do not claim consensus without explicit `VERDICT: APPROVE` or user-accepted stalemate.
- Preserve traceability: each accepted issue maps to a concrete plan edit.
