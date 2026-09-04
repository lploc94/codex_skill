---
name: codex-pr-review
description: Peer debate between Claude Code and Codex on PR quality and merge readiness. No code modifications.
---

# Codex PR Review

## Purpose
Peer debate on branch changes before merge -- code quality, PR description, commit hygiene, scope, merge readiness.

## When to Use
Before opening or merging a PR. More thorough than `/codex-impl-review` for pre-merge scenarios.

## Prerequisites
- Current branch differs from base branch with commits not in base.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the debate is over. MUST check Loop Decision table.
- Loop: Do NOT exit unless consensus or stalemate. No round cap.
- **Operational authority**: the user's explicit operational decisions are highest priority for waiting, stopping, resuming, retrying, effort, and review termination. Codex findings and recommendations are advisory. This rule governs review operation only and does not authorize product, API, schema, persistence, compatibility, or other application-contract changes.
- **Timeout recovery**: resume the same session only for a poll with `status:"timeout"`, `timeout_reason:"runner_deadline"`, `recoverable:true`, non-empty `thread_id`, and `progress_observed:true`; preserve partial output, run `stop` once without `finalize`, and let a later invocation resume that same `$SESSION_DIR`. Never create a recovery session or resume the current session automatically. `turn.failed`, process/runner/infrastructure errors, invalid state, missing `thread_id`, `CODEX_NOT_FOUND`, and every `stalled` result are non-recoverable stop-only paths.
- Cleanup: run `finalize` + `stop` only after normal consensus/stalemate; error paths are `stop` only and preserve the session directory.
- Runner manages all session state -- NEVER read/write session files manually.
- **Information barrier**: Claude MUST complete independent analysis BEFORE reading Codex output.
- **NEVER edit code or create commits** -- debate only.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Base-branch: `git symbolic-ref refs/remotes/origin/HEAD`, fallback main/master. Validate `git rev-parse --verify`.
Effort: <10 files=`medium`, 10-50=`high`, >50=`xhigh`. Announce defaults.
Inputs: base branch, PR title/description (optional), branch diff, commit log, file stats, effort.
Pre-flight: diff must exist, commits ahead > 0.

### 2. Init + Render + Start (Do NOT poll yet)
Init: `node "$RUNNER" init --skill-name codex-pr-review --working-dir "$PWD"`
Render: template=`round1`. Placeholders: `PR_TITLE`, `PR_DESCRIPTION`, `BASE_BRANCH`, `COMMIT_COUNT`, `COMMIT_LIST`, `USER_REQUEST`, `SESSION_CONTEXT`.
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"`

### 3. Claude Independent Analysis (BEFORE polling)
**INFORMATION BARRIER**: MUST NOT read Codex output.
Render: template=`claude-analysis`. Read diff, commits, file stats, PR description. Write FINDING-{N} per `references/claude-analysis-template.md`. Overall Assessment + Merge Readiness Pre-Assessment. COMPLETE before Step 4.

### 4. Poll -> Cross-Analysis -> Resume Loop
Poll + report activities.
Parse `review.blocks[]` + `review.overall_assessment` (code_quality, pr_description_accuracy, commit_hygiene, scope_appropriateness). Fallback: `review.raw_markdown`.
Compare Claude FINDING-{N} vs Codex ISSUE-{N}: Agreement, Disagreement, Claude-only, Codex-only, Same Direction Different Severity.
User operational decisions control orchestration -- Codex VERDICT is advisory.
Render: template=`round2+`. Placeholders: `SESSION_CONTEXT`, `PR_TITLE`, `BASE_BRANCH`, `COMMIT_COUNT`, `COMMIT_LIST`, `AGREED_POINTS`, `DISAGREED_POINTS`, `NEW_FINDINGS`, `CONTINUE_OR_CONSENSUS_OR_STALEMATE`.
Resume + back to Poll.

| # | Condition | Action |
|---|-----------|--------|
| 1 | Full/Partial Consensus (no severity >= medium disagreements) | EXIT -> step 5 |
| 2 | convergence.stalemate === true | EXIT -> step 5 (stalemate) |
| 3 | Disagreements severity >= medium remain | CONTINUE -> Cross-Analysis |

### 5. Completion + Output
Report: Review Summary (Rounds, Verdict, Findings, Agreed/Disagreed), FINDING<->ISSUE Mapping, Overall Assessment table (Code quality/PR description/Commit hygiene/Scope), **Merge Readiness Scorecard** (must-pass: bug, security; conditional: edge-case if high+).
Merge Recommendation: any agreed critical must-pass=REJECT; >=3 agreed high must-pass=REJECT; any agreed high must-pass=REVISE; else MERGE.
Stalemate: produce scorecard from agreed findings, present disagreements, defer to user.

### 6. Finalize + Cleanup
`finalize` + `stop` only after normal consensus or stalemate. Apply the recoverable runner-deadline rule above; all other timeout, failure, stall, or runner-error paths run `stop` once without `finalize` and preserve the same session for inspection or an explicitly allowed later continuation. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, THINK_PEER, THINK_AGREE, THINK_DISAGREE, SEND_REBUTTAL, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- **Safety**: NEVER `git commit`, `git add`, `git rebase`, or modify code/history.
- Both Claude and Codex are equal analytical peers; explicit user operational decisions control orchestration. Codex reviews only, no edits.
