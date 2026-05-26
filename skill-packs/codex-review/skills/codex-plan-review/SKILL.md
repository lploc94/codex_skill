---
name: codex-plan-review
description: Review/debate plans before implementation between Claude Code and Codex CLI. Can run in plan mode — debates the plan and edits the plan file to fix accepted issues.
---

# Codex Plan Review

## Purpose
Adversarially review a plan before implementation starts.

## When to Use
After creating a plan, before implementing code.

## Prerequisites
- A Markdown plan file (e.g. `plan.md`) with headings.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the debate is over. MUST check Loop Decision table.
- Loop: Do NOT exit unless APPROVE or stalemate. No round cap.
- Errors: `failed`->retry once (re-poll 15s). `timeout`->report partial, suggest lower effort. `stalled`+recoverable->`stop`->recovery `resume`->poll; not recoverable->report partial. Cleanup sequencing: `finalize`+`stop` ONLY after recovery resolves.
- Cleanup: ALWAYS run `finalize` + `stop`, even on failure/timeout.
- Runner manages all session state -- NEVER read/write session files manually.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Plan-path detection: `ls plan.md PLAN.md`, `find ./docs -maxdepth 3 -name "*plan*.md"`.
Auto-pick if 1; ask if multiple/none. Announce defaults, block only if plan not found.
Inputs: plan path (abs .md), user request, session context, acceptance criteria, effort (default `high`).

### 2. Pre-flight
Read plan -> verify .md + has headings. Derive acceptance criteria from "Goals"/"Outcomes" if not provided.

### 3. Init + Render + Start
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-plan-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
Render template=`round1`, placeholders: `PLAN_PATH`, `USER_REQUEST`, `SESSION_CONTEXT`, `ACCEPTANCE_CRITERIA`.
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"`

### 4. Poll -> Check Verdict -> Apply/Rebut -> Resume Loop

Poll: `node "$RUNNER" poll "$SESSION_DIR"`. Report specific activities.
Parse `review.blocks[]` (id, title, severity, category, problem, suggested_fix). Verdict in `review.verdict.status`.

**Check stalemate FIRST, then verdict** (-> `references/protocol.md` § Debate Loop Protocol):

| # | Condition | Action |
|---|-----------|--------|
| 1 | convergence.stalemate === true | **EXIT** -> step 5 (stalemate). Do NOT render rebuttal. |
| 2 | verdict === "APPROVE" | **EXIT** -> step 5 |
| 3 | verdict === "REVISE" or open issues | **CONTINUE** -> sub-steps below |

**If CONTINUE** — all 4 sub-steps are MANDATORY, even if you fix every issue:
1. **Categorize** each `review.blocks[]` issue: ACCEPT (valid) or DISPUTE (invalid with reasoning).
2. **Fix** accepted issues -> edit plan file, **save before resume** (Codex re-reads). Invalid -> rebut with reasoning.
3. **ALWAYS render rebuttal** — template=`rebuttal`. Placeholders: `PLAN_PATH`, `SESSION_CONTEXT`, `FIXED_ITEMS`, `DISPUTED_ITEMS`. If all issues fixed, `DISPUTED_ITEMS` = `"None — all issues addressed"`. Rebuttal is NEVER skipped.
4. **ALWAYS resume** — `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"`. Back to **Poll**. Codex MUST re-verify fixes and may find new issues.

### 5. Completion + Output
APPROVE -> done. Stalemate -> present deadlocked issues, ask user.
Report: Rounds, Verdict, Issues Found/Fixed/Disputed, edits made, risks, next steps.

### 6. Finalize + Cleanup
`finalize` + `stop`. Always run. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, APPLY_FIX, SEND_REBUTTAL, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- Plan mode active -> stay in plan mode. Debate takes priority over plan mode behavior.
- Do not implement code. Do not claim consensus without VERDICT: APPROVE.
- Each accepted issue -> concrete plan edit.
