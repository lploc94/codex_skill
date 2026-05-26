---
name: codex-commit-review
description: Peer debate between Claude Code and Codex on committed code quality. Report + suggest only, no modifications.
---

# Codex Commit Review

## Purpose
Debate committed code quality after committing, before pushing. No code modified -- report + suggest only.

## When to Use
After committing code (before push). Modes: staged (pre-commit preview) or last (already-committed).

## Prerequisites
- **Staged**: staged changes available (`git diff --cached`).
- **Last**: recent commits exist.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the debate is over. MUST check Loop Decision table.
- Loop: Do NOT exit unless consensus or stalemate. No round cap.
- Errors: `failed`->retry once (re-poll 15s). `timeout`->report partial, suggest lower effort. `stalled`+recoverable->`stop`->recovery `resume`->poll; not recoverable->report partial. Cleanup sequencing: `finalize`+`stop` ONLY after recovery resolves.
- Cleanup: ALWAYS run `finalize` + `stop`, even on failure/timeout.
- Runner manages all session state -- NEVER read/write session files manually.
- **Information barrier**: Claude MUST complete independent analysis BEFORE reading Codex output.
- **NEVER modify code** -- report + suggest only.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Mode: `git diff --cached --quiet` exit 1=`staged`, exit 0=`last`. Effort: <=200 lines=`low`, 201-1000=`medium`, >1000=`high`.
Staged: `git diff --cached`, files changed. Last: `git log -n N`, clamp N to history, diff.
Context discovery: language/framework, linters, test frameworks, CI config.

### 2. Init + Render + Start (Do NOT poll yet)
Init: `node "$RUNNER" init --skill-name codex-commit-review --working-dir "$PWD"`
Render: template=`staged-round1` or `last-round1`. Placeholders: `FILES_CHANGED`, `DIFF_CONTEXT`, `USER_REQUEST`, `SESSION_CONTEXT`, `PROJECT_CONTEXT`, `COMMIT_LIST` (last only).
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"`

### 3. Claude Independent Analysis (BEFORE polling)
**INFORMATION BARRIER**: MUST NOT read Codex output.
Render: template=`claude-staged` or `claude-last`. Read diff/code, write FINDING-{N} per `references/claude-analysis-template.md`. Last mode: Evidence MUST reference SHA+subject. Overall Assessment + Strongest Positions. COMPLETE before Step 4.

### 4. Poll -> Cross-Analysis -> Resume Loop
Poll + report activities.
Parse `review.blocks[]` (id, title, severity, category, location, problem, evidence) + `review.overall_assessment`. Fallback: `review.raw_markdown`.
Compare Claude FINDING-{N} vs Codex ISSUE-{N}: Agreement, Disagreement, Claude-only, Codex-only, Same Direction Different Severity.
Build response: Agreements, Disagreements, New findings. Claude orchestration is authoritative -- Codex VERDICT is advisory.
Render: template=`staged-round2+` or `last-round2+`. Placeholders: `SESSION_CONTEXT`, `PROJECT_CONTEXT`, `AGREED_POINTS`, `DISAGREED_POINTS`, `NEW_FINDINGS`, `CONTINUE_OR_CONSENSUS_OR_STALEMATE`, `DIFF_CONTEXT`, `COMMIT_LIST`.
Resume + back to Poll.

| # | Condition | Action |
|---|-----------|--------|
| 1 | Full/Partial Consensus (no severity >= medium disagreements) | EXIT -> step 5 |
| 2 | convergence.stalemate === true | EXIT -> step 5 (stalemate) |
| 3 | Disagreements severity >= medium remain | CONTINUE -> Cross-Analysis |

### 5. Completion + Output
Report: Rounds, Verdict, Claude/Codex Findings, Agreed/Disagreed counts, Files Reviewed, FINDING<->ISSUE Mapping, Overall Assessment (Code quality/Security/Test coverage/Maintainability).

### 6. Finalize + Cleanup
`finalize` + `stop`. Always run. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, THINK_PEER, THINK_AGREE, THINK_DISAGREE, SEND_REBUTTAL, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- **Safety**: NEVER `git commit --amend`, `git rebase`, or modify commit history.
- Both Claude and Codex are equal peers. For `last` mode N>1: reference specific commit SHA in Evidence.
