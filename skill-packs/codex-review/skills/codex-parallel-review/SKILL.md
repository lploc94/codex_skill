---
name: codex-parallel-review
description: Parallel independent review by 4 Claude agents + Codex, followed by merge, debate, and consensus report.
---

# Codex Parallel Review

## Purpose
5 reviewers analyze code simultaneously: 4 Claude agents (Correctness, Security, Performance, Maintainability) + 1 Codex. Findings merged, disagreements debated, consensus reported.

## When to Use
When you want independent dual-reviewer analysis with higher-confidence cross-validated findings.

## Prerequisites
- **Full-codebase** (default), **working-tree**, or **branch** mode. No external plugins required.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the debate is over. MUST check Loop Decision table.
- Loop: Do NOT exit unless all findings resolved or stalemate. No round cap.
- Errors: `failed`->retry once (re-poll 15s). `timeout`->report partial, suggest lower effort. `stalled`+recoverable->`stop`->recovery `resume`->poll; not recoverable->report partial. Cleanup sequencing: `finalize`+`stop` ONLY after recovery resolves.
- Cleanup: ALWAYS run `finalize` + `stop`, even on failure/timeout.
- Runner manages all session state -- NEVER read/write session files manually.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Mode: full-codebase/working-tree/branch. Auto-detect effort (<50 files=`medium`, 50-200=`high`, >200=`xhigh`).
Branch mode: validate base branch, clean working tree, bind `BASE`. Prepare `FILES` and `DIFF` per mode.

### 2. Launch All 5 Reviewers (ONE message -- true parallelism)
**2a) Init + Start Codex:**
Init: `node "$RUNNER" init --skill-name codex-parallel-review --working-dir "$PWD"`
Render: template=`full-round1`/`working-tree-round1`/`branch-round1`. Placeholders: `USER_REQUEST`, `SESSION_CONTEXT`, `BASE_BRANCH` (branch only).
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"`

**2b) Spawn 4 Claude Agents** (same message as 2a, all `run_in_background: true`):
- **Agent 1 -- Correctness & Edge Cases**: logic errors, null checks, off-by-one, race conditions.
- **Agent 2 -- Security (OWASP Top 10)**: A01-A10, secrets, crypto, input handling, dependencies.
- **Agent 3 -- Performance**: algorithmic, memory, I/O, N+1, caching, bundle.
- **Agent 4 -- Maintainability & Architecture**: naming, DRY, complexity, coupling, module boundaries.
Each writes FINDING-{N} with Category, Severity, File, Location, Problem, Suggested fix.

### 3. Poll Codex + Collect Agent Results
Poll Codex. Collect agent results as they finish. If agent fails, continue with remaining.

### 4. Merge Findings
4a) Deduplicate Claude findings across agents -- same file + overlapping lines -> keep higher severity.
4b) Cross-match Claude vs Codex: agreed, claude-only, codex-only, contradiction. Prefer false-negatives over false-positives.
4c) Present merge summary: Claude (deduplicated), Codex, Agreed, Claude-only, Codex-only, Contradictions.

### 5. Apply Agreed + Debate Loop
Apply agreed issues. Branch mode: commit fixes before debate.
Render template=`debate`, placeholders: `CODEX_ONLY_WITH_REBUTTALS`, `CLAUDE_ONLY_FINDINGS`, `CONTRADICTIONS`.
Resume + back to Poll. Parse `RESPONSE-{N}`: accept->apply, reject->reconsider, revise->evaluate. Remove resolved from next round. Branch: commit fixes before resume.

| # | Condition | Action |
|---|-----------|--------|
| 1 | All disputed/claude-only/codex-only resolved | EXIT -> step 6 |
| 2 | convergence.stalemate === true | EXIT -> step 6 (stalemate) |
| 3 | Unresolved findings remain | CONTINUE -> debate |

### 6. Final Report
Reviewers: 5. Report: Claude/Codex findings, Agreed, Resolved via debate, Unresolved, Debate rounds, Verdict.
Present: Consensus Issues by severity, Resolved Disagreements, Unresolved table, Risk Assessment.

### 7. Finalize + Cleanup
`finalize` + `stop`. Always run. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, PARALLEL_LAUNCH, POLL_WAITING, CODEX_RETURNED, PARALLEL_MERGE, APPLY_FIX, SEND_REBUTTAL, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- All 5 reviewers independent -- no cross-contamination before merge. Degrade gracefully on failure.
- Codex reviews only, no edits. Claude applies fixes for agreed/accepted issues.
