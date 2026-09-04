---
name: codex-think-about
description: Peer debate between Claude Code and Codex on any technical question. Both think independently, challenge each other, converge to consensus or explicit disagreement.
---

# Codex Think About

## Purpose
Peer reasoning, not code review. Claude and Codex are equal analytical peers.

## When to Use
Debate technical decisions or design questions before implementing. Architecture choices, technology comparisons, reasoning through tradeoffs.

## Prerequisites
- A question or decision topic from the user.

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
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Follow `references/question-sharpening.md`. Confirm rewrite if substantive. Gather effort (default `high`), scope, relevant files, project context. No premature opinion.

### 2. Init + Start Codex (Do NOT poll yet)
Init: `node "$RUNNER" init --skill-name codex-think-about --working-dir "$PWD"`
Render template=`round1`, placeholders: `QUESTION`, `PROJECT_CONTEXT`, `RELEVANT_FILES`, `CONSTRAINTS`.
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT" --sandbox danger-full-access`

### 3. Claude Independent Analysis (BEFORE polling)
**INFORMATION BARRIER**: MUST NOT read Codex output. Codex runs in background.
Render template=`claude-analysis`, same placeholders. Analyze using own knowledge. MAY use MCP tools (web_search, context7). Analysis must be COMPLETE and FINAL before Step 4.

### 4. Poll -> Cross-Analysis -> Resume Loop
Poll: `node "$RUNNER" poll "$SESSION_DIR"`. Report activities.
Parse `review.insights`, `review.considerations`, `review.recommendations`, `review.sources`. Fallback: `review.raw_markdown`.
Classify: Genuine Agreement, Genuine Disagreement, Claude-only Insight, Codex-only Insight, Same Direction Different Depth.
Build response: Agreements, Disagreements (defend with evidence), New Perspectives, Source Cross-validation.

**File Modification Guard** (after each round):
**In git repo**: `BASELINE=$(git status --porcelain --untracked-files=all --ignored)` before round; compare after. New lines = Codex modified files.
**Outside git repo**: Snapshot files with `find`+`stat` before round; compare after. Classify added/deleted/modified by path+mtime.
**If changes detected**: STOP workflow immediately. List every modified/created/deleted file. Warn user: "Codex violated file modification rules." Do NOT auto-revert. Run `stop` once without `finalize`; report the error and wait for explicit user direction. `danger-full-access` is for web research ONLY.

Render template=`round2+`, placeholders: `AGREED_POINTS`, `DISAGREED_POINTS`, `NEW_PERSPECTIVES`, `CONTINUE_OR_CONSENSUS_OR_STALEMATE`.
Resume: `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"`. Back to Poll.

| # | Condition | Action |
|---|-----------|--------|
| 1 | Both sides converged, no significant disagreements | EXIT -> step 5 |
| 2 | convergence.stalemate === true or same disagreements 2 rounds | EXIT -> step 5 (stalemate) |
| 3 | Significant disagreements remain or new perspectives | CONTINUE -> Cross-Analysis |

### 5. Completion + Output
Consensus -> done. Stalemate -> list deadlocked points, recommend which to favor, ask user.
Report: Consensus Points, Remaining Disagreements (Point|Claude|Codex), Recommendations, Consolidated Sources, Open Questions, Confidence Level.

### 6. Finalize + Cleanup
`finalize` + `stop` only after normal consensus or stalemate. Apply the recoverable runner-deadline rule above; all other timeout, failure, stall, or runner-error paths run `stop` once without `finalize` and preserve the same session for inspection or an explicitly allowed later continuation. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, THINK_PEER, THINK_AGREE, THINK_DISAGREE, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- Keep roles as analytical peers; explicit user operational decisions control orchestration, with no reviewer/implementer framing.
- Codex MUST NOT modify project files. Codex MUST cite sources for web claims.
- Separate researched facts (with sources) from opinions.
