---
name: codex-impl-review
description: Have Codex CLI review uncommitted code changes. Claude Code then fixes valid issues and rebuts invalid ones. Codex re-reviews. Repeat until consensus. Codex never touches code — it only reviews.
---

# Codex Implementation Review — Skill Guide

## Overview
This skill sends uncommitted changes to Codex CLI for **review only**. Codex reads the diff itself, finds bugs/edge cases/security issues, and reports back. Claude Code then evaluates the review — fixes what's valid, pushes back on what's not — and sends the updated diff back to Codex for re-review. This repeats until both sides agree the code is solid.

**Codex NEVER modifies code.** It only reads and reviews. All fixes are done by Claude Code.

**Flow:** Point Codex to the repo → Codex reads diff + plan → Codex reviews → Claude Code fixes & rebuts → Codex re-reviews → ... → Consensus → Done

## Prerequisites
- There must be uncommitted changes (staged or unstaged) in the working directory.
- The Codex CLI (`codex`) must be installed and available in PATH.

## Step 1: Gather Configuration

Ask the user (via `AskUserQuestion`) **only one question**:
- Which reasoning effort to use (`xhigh`, `high`, `medium`, or `low`)

**Do NOT ask** which model to use — always use Codex's default model (no `-m` flag).
**Do NOT ask** how many rounds — the loop runs automatically until consensus (initial target: 3 rounds, auto-extends until APPROVE or stalemate).

## Progress Monitoring Strategy

Codex runs in background — no hardcoded timeout needed. Instead, Claude Code polls the JSONL output file periodically and reports progress to the user.

### Polling Loop

1. Launch Codex with `run_in_background: true` in the Bash tool (see Step 3 for the exact command). The Bash tool will return a `task_id` for the background process — **save this `task_id`** for cleanup after extraction. The first line of output will be the absolute path to the JSONL file — **save this path** for use in all subsequent poll and extract commands.
2. **Every ~60 seconds**, poll the output file with the Bash tool using the **absolute path** saved in step 1. **You MUST wait before each poll** by running `sleep 60` first in the same Bash call:
   ```bash
   sleep 60 && tail -20 /tmp/codex-review-xxxx.jsonl
   ```
3. Parse the last few JSONL lines and report a **short progress update** to the user (plain text, not tool output). Examples:
   - "Codex is thinking... (*Analyzing error handling patterns*)"
   - "Codex is running: `git diff HEAD`"
   - "Codex finished reading the diff, now analyzing..."
4. **Check for any terminal event**: when `turn.completed`, `turn.failed`, or process exit (no new output + task gone) is detected — **your very first action MUST be calling `TaskOutput(task_id, block:true, timeout=10000)`** before doing anything else (ignore the returned output). This dequeues the background task completion notification from the runtime's internal queue. **If you skip this or delay it, the notification will leak and print "Background command completed" at the end of the session.** This applies to ALL terminal paths, not just success. Then:
   - If `turn.completed`: proceed to extract the review.
   - If `turn.failed`: extract `error.message` from the event, report it to the user, and stop polling.
5. **Check for process failure**: if the background Bash task itself has exited with an error (non-zero exit, or the process is gone but no `turn.completed` or `turn.failed`), **immediately call `TaskOutput(task_id, block:true, timeout=10000)` first** (same reason — dequeue the notification), then read the stderr file and report the error to the user.

### Stall Detection

If 3 consecutive polls (~3 minutes) show **no new lines** in the output file, Codex may be stuck. In that case:
1. Report to the user: "Codex appears to be stalled — no new output for ~3 minutes."
2. Ask the user (via `AskUserQuestion`): **Wait longer** or **Abort and retry**.

## Step 2: Collect Uncommitted Changes

1. Run `git status --porcelain` to detect ALL changes including untracked (new) files.
2. If there are no changes at all, inform the user and stop.
3. **Detect if HEAD exists** — run `git rev-parse --verify HEAD 2>/dev/null`. If it fails (exit code non-zero), this is a fresh repo with no commits. Use `git diff --cached` and `git diff --cached --stat` (to capture staged changes) **plus** `git diff` and `git diff --stat` (to capture unstaged changes). If HEAD exists, use `git diff HEAD` and `git diff --stat HEAD` as normal (which covers both staged and unstaged).
4. **Stage untracked files for diffing** — if there are untracked files (`??` in porcelain output), run `git add -N <file>` (intent-to-add) for each one so they appear in git diff. This does NOT actually stage the files for commit — it only makes them visible to diff.
5. Run the appropriate `git diff --stat` command (with or without `HEAD` per step 3) to get a summary of all changed files.
6. If the number of changed files is very large, ask the user which files to focus on, or split into multiple review sessions.
7. **Locate the plan file** — check for the implementation plan that guided these changes. Common locations:
   - `.claude/plan.md`
   - `plan.md`
   - The plan mode output file
   - Ask the user if the plan file location is unclear.
   If no plan file exists, proceed without it (but having one significantly improves review quality).

## Prompt Construction Principle

**Only include in the Codex prompt what Codex cannot access on its own:**
- The path to the plan file (so Codex can cross-reference the implementation intent)
- The user's original request / task description
- Important context from the conversation: user comments, constraints, preferences, architectural decisions discussed verbally
- Clarifications or special instructions the user gave
- Which specific files to focus on (if the user specified)

**Do NOT include:**
- The diff content (Codex runs `git diff HEAD` itself)
- The plan content (Codex reads the file itself)
- Code snippets Codex can read from the repo
- Information Codex can derive by reading files

## Step 3: Send Changes to Codex for Review (Round 1)

### Running Codex with Progress Monitoring

Run Codex in background with `--json` output to a temp file so you can monitor progress and report it to the user. Use the Bash tool with `run_in_background: true`:

```bash
RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only --config model_reasoning_effort="<EFFORT>" -C <WORKING_DIR> 2>"$CODEX_ERR" <<'EOF' > "$CODEX_OUTPUT"
<REVIEW_PROMPT content here>
EOF
```

**IMPORTANT**: The Bash tool returns a `task_id` for the background process — **save this `task_id`** (you will need it to stop the background task after extraction). The first line of stdout contains both absolute paths (JSONL and ERR, space-separated). **Save both paths** — you will need them for all subsequent poll, extract, and cleanup commands. Each Bash tool call is a new shell, so shell variables do not persist between calls. Always use the literal absolute paths (e.g., `/tmp/codex-review-1737000000-12345.jsonl`).

Also save the `thread_id` from the first `thread.started` event in the JSONL — you will need it to resume the correct session in subsequent rounds (instead of `resume --last` which may pick the wrong session).

Then **poll for progress** approximately every 60 seconds using the Bash tool to read the temp file (see "Progress Monitoring Strategy" section above for full details):

```bash
tail -5 /tmp/codex-review-XXXXXXXXXX.jsonl
```

**How to interpret JSONL events and what to report to the user:**

| Event | Meaning | Report to user |
| --- | --- | --- |
| `{"type":"turn.started"}` | Codex has started processing | "Codex is thinking..." |
| `{"type":"item.completed","item":{"type":"reasoning",...}}` | Codex finished a thinking step | Report the `text` field (e.g., "Codex is analyzing the diff...") |
| `{"type":"item.completed","item":{"type":"agent_message",...}}` | Codex produced a message | This may be an intermediate status message from Codex |
| `{"type":"item.started","item":{"type":"command_execution",...}}` | Codex is running a command | "Codex is running: `<command>`" |
| `{"type":"item.completed","item":{"type":"command_execution",...}}` | Command finished | "Codex finished running: `<command>`" |
| `{"type":"turn.completed","usage":{...}}` | Codex is done | Extract final result |
| `{"type":"turn.failed","error":{...}}` | Codex turn failed (network/auth/server) | Extract `error.message`, report to user, stop polling |

When `turn.completed` appears, Codex is done. When `turn.failed` appears, Codex encountered an error — extract `error.message` from the event, report it to the user, and stop polling (do not continue waiting). Extract the final review by collecting all `agent_message` items from the JSONL. The last `agent_message` is typically the full review.

**Extracting the final review** (use the saved absolute path):

```bash
grep '"type":"agent_message"' /tmp/codex-review-XXXXXXXXXX.jsonl | tail -1 | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['item']['text'])"
```

Clean up after extracting the result — this is **mandatory for ALL terminal paths** (`turn.completed`, `turn.failed`, process failure, stall-abort):

1. **Dequeue notification (if not already done)**: call `TaskOutput` with the saved `task_id` and `block: true, timeout: 10000`. If you already called this in the polling loop (step 4), calling it again is safe — it will return immediately. This is a safety net: **the notification MUST be dequeued before your turn ends**, or it will print "Background command completed" at the end of the session.

2. **Drain and stop the background Bash task**: call `TaskOutput` with the saved `task_id` and `block: false` to drain any remaining buffered output (ignore the content). Then call `TaskStop` with the same `task_id` to terminate the background task. If either call returns an error (task already exited), this is safe to ignore.

3. **Remove temp files**:
```bash
rm -f /tmp/codex-review-XXXXXXXXXX.jsonl /tmp/codex-review-XXXXXXXXXX.err
```

**Why this matters**: Background task completion notifications are enqueued when a task exits. If this notification is not consumed by `TaskOutput(block:true)` before the current turn ends, Claude Code's runtime will flush it as a visible message ("Background command completed") at session end. The two-phase approach — dequeue in polling loop (step 4) + safety-net dequeue here — ensures the notification is always consumed regardless of which code path executes. Each round creates a new background task — you must clean up each one.

**NOTE**: No `-m` flag — use Codex's default model. Always use `--sandbox read-only` — Codex only needs to read files and run `git diff`. The prompt instructs Codex to only review, not modify code.

The `<REVIEW_PROMPT>` must follow this structure:

```
You are participating in a code review with Claude Code (Claude Opus 4.6).

## Your Role
You are the CODE REVIEWER. You review ONLY — you do NOT modify any code. Your job is to inspect uncommitted changes and report bugs, missing edge cases, error handling gaps, security vulnerabilities, and code quality issues. Be thorough, specific, and constructive. Claude Code will handle all fixes based on your feedback.

## How to Inspect Changes
1. Run `git status --porcelain` to see all changes including untracked files.
2. Check if HEAD exists: `git rev-parse --verify HEAD 2>/dev/null`. If it fails, use `git diff --cached --stat` and `git diff --cached` (for staged changes) plus `git diff --stat` and `git diff` (for unstaged changes). If it succeeds, use `git diff --stat HEAD` and `git diff HEAD`.
3. Run the appropriate git diff command to see the full diff. (Note: untracked files have already been marked with `git add -N` so they appear in the diff.)
4. Read any relevant source files for additional context if needed.

## Implementation Plan
Read the plan file for context on what these changes are supposed to achieve: <ABSOLUTE_PATH_TO_PLAN_FILE>
(If no plan file exists, write: "No plan file available — review the diff based on code quality alone.")

## User's Original Request
<The user's original task/request>

## Session Context
<Any important context from the conversation that Codex cannot access on its own:
- User comments, preferences, or constraints
- Architectural decisions discussed verbally
- Clarifications the user provided
- Special instructions or priorities
- Specific files to focus on (if specified by the user)>

(If there is no additional context, write "No additional context.")

## Instructions
1. Read the diff using the git commands above.
2. If a plan file is provided, read it and cross-reference: does the implementation match the plan? Are there deviations?
3. Analyze every changed file and produce your review in the EXACT format below.

## Required Output Format

For each issue found, use this structure:

### ISSUE-{N}: {Short title}
- **Category**: Bug | Edge Case | Error Handling | Security | Code Quality | Plan Deviation
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **File**: `{file_path}:{line_number or line_range}`
- **Description**: What the problem is, in detail.
- **Why It Matters**: Concrete scenario or example showing how this causes a real failure.
- **Suggested Fix**: Specific code change or approach to fix this. (Required for CRITICAL and HIGH severity. Recommended for others.)

After all issues, provide:

### VERDICT
- **Result**: REJECT | APPROVE_WITH_CHANGES | APPROVE
- **Summary**: 2-3 sentence overall assessment.
- **Plan Alignment**: Does the implementation correctly follow the plan? Note any deviations. (Skip if no plan file.)

Rules:
- Reference exact files and line numbers/hunks in the diff.
- Explain WHY each issue is a problem with a concrete scenario.
- Do NOT rubber-stamp the code. Your value comes from finding real problems.
- Do NOT nitpick style or formatting unless it causes actual issues.
- Do NOT attempt to fix or modify any files. Report issues only.
- Every CRITICAL or HIGH severity issue MUST have a Suggested Fix.
```

**After receiving Codex's review**, summarize the findings for the user, grouped by severity.

## Step 4: Claude Code Responds (Round 1)

After receiving Codex's review, you (Claude Code) must:

1. **Analyze each ISSUE-{N}** against the actual code.
2. **Fix valid issues** - If Codex found real bugs, edge cases, or security issues:
   - Apply the fixes directly to the code files using Edit tool.
   - Keep fixes minimal and focused — don't refactor surrounding code.
3. **Push back on invalid points** - If Codex flagged something incorrectly:
   - Explain why it's not actually a problem (e.g., the edge case is handled upstream, the framework guarantees safety, etc.)
   - Use evidence: read the relevant code, check documentation, web search if needed.
4. **Summarize for the user**: What you fixed, what you disputed, and why.
5. **Immediately proceed to Step 5** — do NOT ask the user whether to continue. Always send the updated code back to Codex for re-review.

## Step 5: Continue the Debate (Rounds 2+)

After applying fixes, resume the Codex session using the **saved `thread_id`** from the `thread.started` event in Round 1. Use the same background + polling pattern:

```bash
RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only -C <WORKING_DIR> resume <THREAD_ID> 2>"$CODEX_ERR" <<'EOF' > "$CODEX_OUTPUT"
<REBUTTAL_PROMPT content here>
EOF
```

Save the new `task_id`, output path, and error path, then poll/extract/cleanup the same way as Step 3. Remember: each round creates a new background task with its own `task_id` — you must drain and stop each one after extracting its review.

The `<REBUTTAL_PROMPT>` must follow this structure:

```
This is Claude Code (Claude Opus 4.6) responding to your review. I have applied fixes and want you to re-review.

## Issues Fixed
<For each fixed issue, reference by ISSUE-{N} and describe the specific change made>

## Issues Disputed
<For each disputed issue, reference by ISSUE-{N} and explain why with evidence>

## Your Turn
Run `git diff HEAD` again to see the updated changes (or `git diff --cached` plus `git diff` if this is a fresh repo with no commits), then re-review.
- Have your previous concerns been properly addressed?
- Do the fixes introduce any NEW issues?
- Are there any remaining problems you still see?

Use the same output format as before (ISSUE-{N} structure + VERDICT).
Verdict options: REJECT | APPROVE_WITH_CHANGES | APPROVE
```

**After each Codex response:**
1. Summarize Codex's response for the user.
2. If verdict is `APPROVE` → proceed to Step 6.
3. If verdict is `APPROVE_WITH_CHANGES` → evaluate suggestions, apply if valid, then **automatically** send one more round to Codex for confirmation. Do NOT ask the user.
4. If verdict is `REJECT` → fix remaining issues and **automatically** continue to next round. Do NOT ask the user.

**IMPORTANT**: The debate loop is fully automatic. After fixing issues, ALWAYS send the updated code back to Codex without asking the user. The loop only stops when Codex returns `APPROVE`. The user is only consulted at the very end (Step 6) or if a stalemate is detected.

### Early Termination & Round Extension

- **Early termination**: If Codex returns `APPROVE`, end the debate immediately and proceed to Step 6.
- **Round extension**: There is no hard round limit. Continue the fix → re-review loop until either:
  - Codex returns `APPROVE`, OR
  - The same points go back and forth without progress for 2 consecutive rounds (stalemate detected) → present the disagreement to the user and let them decide.

**Repeat** Steps 4-5 until consensus or stalemate.

## Step 6: Finalize and Report

Present the user with a **Code Review Debate Summary**:

```
## Code Review Debate Summary

### Rounds: X
### Final Verdict: [CONSENSUS REACHED / STALEMATE - USER DECISION NEEDED]

### Bugs Fixed:
1. [Bug description - file:line]
...

### Edge Cases Added:
1. [Edge case - file:line]
...

### Error Handling Improved:
1. [What was added - file:line]
...

### Security Issues Resolved:
1. [Issue - file:line]
...

### Plan Deviations Found:
1. [Deviation - context]
...

### Disputed Points (Claude's position maintained):
1. [Point - reasoning]
...

### Remaining Concerns (if stalemate):
1. [Unresolved issue - context]
...
```

Then ask the user (via `AskUserQuestion`):
- **Accept & Commit** - Code is ready, user can commit
- **Request more rounds** - Continue debating specific concerns
- **Review changes manually** - User wants to inspect the fixes themselves before deciding

## Codex Command Reference

| Action | Command |
| --- | --- |
| Initial review | `RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only --config model_reasoning_effort="<EFFORT>" -C <DIR> 2>"$CODEX_ERR" <<'EOF' ... EOF > "$CODEX_OUTPUT"` |
| Subsequent rounds | `RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only -C <WORKING_DIR> resume <THREAD_ID> 2>"$CODEX_ERR" <<'EOF' ... EOF > "$CODEX_OUTPUT"` |
| Poll progress | `tail -5 /tmp/codex-review-XXXXXXXXXX.jsonl` |
| Extract final review | `grep '"type":"agent_message"' /tmp/codex-review-XXXXXXXXXX.jsonl \| tail -1 \| python3 -c "import sys,json; print(json.loads(sys.stdin.read())['item']['text'])"` |
| Check errors on failure | `tail -20 /tmp/codex-review-XXXXXXXXXX.err` |
| Stop background task | `TaskOutput(task_id=<SAVED_TASK_ID>, block=true, timeout=10000)` **immediately** on terminal event (dequeues notification — MUST happen before turn ends), then `TaskOutput(block=false)` + `TaskStop(task_id=<SAVED_TASK_ID>)` after extraction, then `TaskOutput(block=true, timeout=10000)` again as safety net in cleanup |

## Important Rules

1. **Codex reads the diff and plan itself** - Do NOT paste diff content or plan content into the prompt. Just give Codex the plan file path and instruct it to run `git diff`. This avoids bloating the prompt and ensures Codex always sees the latest state.
2. **Only send what Codex can't access** - The prompt should contain: file paths, user's original request, session context (user comments/constraints/preferences). NOT: diffs, file contents, code snippets.
3. **Always `git add -N` untracked files first** - So new files appear in `git diff`. Without this, Codex won't see newly created files.
4. **Always use heredoc (`<<'EOF'`) for prompts** - Never use `echo "<prompt>" |`. Heredoc with single-quoted delimiter prevents shell expansion of `$`, backticks, `"`, etc.
5. **Always provide the plan file path** - So Codex can cross-reference implementation against intent. If no plan exists, explicitly state that.
6. **Always use `--sandbox read-only`** - Codex only needs to read files and run `git diff`. Sandbox prevents accidental writes.
7. **Always use `-C <WORKING_DIR>`** - So Codex runs in the correct project directory.
8. **Always use `--skip-git-repo-check`** - Required for Codex CLI operation.
9. **Redirect stderr to file, not /dev/null** - Use `2>"$CODEX_ERR"` so errors can be inspected on failure. Never use `2>/dev/null`.
10. **No `-m` flag** - Always use Codex's default model. If the user wants a different model, they configure it in Codex directly.
11. **Use absolute paths for temp files** - Each Bash tool call is a new shell. `$CODEX_OUTPUT` does not persist. Save the absolute path from the first echo and use it literally in all subsequent commands.
12. **Resume by thread ID, not `--last`** - Parse `thread_id` from the `thread.started` JSONL event and use `resume <THREAD_ID>` to avoid resuming the wrong session.
13. **Handle repos with no HEAD** - Before running `git diff HEAD`, check `git rev-parse --verify HEAD`. If HEAD doesn't exist (fresh repo), use `git diff --cached` (staged) plus `git diff` (unstaged) instead of `git diff HEAD`.
14. **Claude Code does all the fixing** - Codex identifies issues, Claude Code applies fixes. Codex is instructed via prompt not to modify files.
15. **Be genuinely adversarial** - Don't blindly accept all of Codex's findings. Some flagged "issues" may be false positives. Push back with evidence when Codex is wrong.
16. **Don't over-fix** - Only fix what's actually broken or risky. Don't add defensive code for impossible scenarios. Don't refactor working code that wasn't part of the changes.
17. **Summarize after every round** - The user should always know what happened before the next round begins.
18. **Respect the diff boundary** - Only review and fix code within the uncommitted changes. Don't expand scope to unrelated code unless a change introduces a bug in connected code.
19. **Require structured output** - If Codex's response doesn't follow the required ISSUE-{N} format, ask it to reformat in the resume prompt.
20. **Acknowledge completion then clean up after each round** - When polling detects any terminal event (`turn.completed`, `turn.failed`, or process exit), **your very first action** must be calling `TaskOutput(task_id, block:true, timeout=10000)` before extracting/reporting (ignore returned output). **This dequeues the completion notification — if skipped, it will print "Background command completed" at end of session.** This applies to ALL terminal paths — not just success. Then after extraction/reporting, always run full cleanup: `TaskOutput(task_id, block:true, timeout=10000)` (safety net) → `TaskOutput(task_id, block:false)` → `TaskStop(task_id)` → `rm -f`. Each round has its own `task_id` — handle each one.

## Error Handling
- If `git status --porcelain` shows no changes (no modified, staged, or untracked files), inform the user and stop.
- If `git rev-parse --verify HEAD` fails, this is a fresh repo — use `git diff --cached` + `git diff` (both cached and unstaged) instead of `git diff HEAD`.
- If the Codex background process exits with an error (no `turn.completed` in output), read the stderr file (`tail -20 /tmp/codex-review-XXXXXXXXXX.err`) and report the error content to the user.
- If Codex stalls (no new output for ~3 minutes / 3 consecutive polls), ask the user whether to wait or abort (see Stall Detection in Progress Monitoring Strategy).
- If the diff is too large for a single prompt, suggest splitting by file or directory.
- If the debate stalls on a point, present both positions to the user and let them decide.
- If `TaskOutput` or `TaskStop` returns an error when cleaning up a background task (e.g., task already exited), this is safe to ignore — the task is already gone.
- If `TaskOutput(block:true, timeout=10000)` times out while acknowledging a terminal event, proceed with extraction/reporting anyway and run full cleanup. The task may not have fully settled — a background notification may still appear after ESC, but this is recoverable.
