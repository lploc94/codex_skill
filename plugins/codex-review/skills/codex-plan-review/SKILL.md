---
name: codex-plan-review
description: Debate implementation plans between Claude Code and Codex CLI. After Claude Code creates a plan, invoke this skill to have Codex review it. Both AIs debate through multiple rounds until reaching full consensus before implementation begins.
---

# Codex Plan Review — Skill Guide

## Overview
This skill orchestrates an adversarial debate between Claude Code and OpenAI Codex CLI to stress-test implementation plans. The goal is to catch flaws, blind spots, and improvements **before** any code is written.

**Flow:** Claude Code's plan → Codex reviews → Claude Code rebuts → Codex rebuts → ... → Consensus → Implement

## Prerequisites
- You (Claude Code) must already have a plan ready. If no plan exists yet, ask the user to create one first (e.g., via plan mode or `/plan`).
- The plan must be saved to a file that Codex can read (e.g., `plan.md`, `.claude/plan.md`, or the plan mode output file).
- The Codex CLI (`codex`) must be installed and available in PATH.

## Step 1: Gather Configuration

Ask the user (via `AskUserQuestion`) **only one question**:
- Which reasoning effort to use (`xhigh`, `high`, `medium`, or `low`)

**Do NOT ask** which model to use — always use Codex's default model (no `-m` flag).
**Do NOT ask** how many rounds — the loop runs automatically until consensus (initial target: 3 rounds, auto-extends until APPROVE or stalemate).

## Progress Monitoring Strategy

Codex runs in background — no hardcoded timeout needed. Instead, Claude Code polls the JSONL output file periodically and reports progress to the user.

### Polling Loop

1. Launch Codex with `run_in_background: true` in the Bash tool (see Step 3 for the exact command). The first line of output will be the absolute path to the JSONL file — **save this path** for use in all subsequent poll and extract commands.
2. **Every ~60 seconds**, poll the output file with the Bash tool using the **absolute path** saved in step 1. **You MUST wait before each poll** by running `sleep 60` first in the same Bash call:
   ```bash
   sleep 60 && tail -20 /tmp/codex-review-xxxx.jsonl
   ```
3. Parse the last few JSONL lines and report a **short progress update** to the user (plain text, not tool output). Examples:
   - "Codex is thinking... (*Reading the plan file*)"
   - "Codex is running: `cat .claude/plan.md`"
   - "Codex finished reading the plan, now analyzing..."
4. **Check for completion**: if `turn.completed` appears in the output, Codex is done — proceed to extract the review.
5. **Check for turn failure**: if `turn.failed` appears in the output, Codex encountered an error at the turn level (network, auth, server). Extract the `error.message` field, report it to the user, and stop polling.
6. **Check for process failure**: if the background Bash task itself has exited with an error (non-zero exit, or the process is gone but no `turn.completed` or `turn.failed`), read the stderr file and report the error to the user.

### Stall Detection

If 3 consecutive polls (~3 minutes) show **no new lines** in the output file, Codex may be stuck. In that case:
1. Report to the user: "Codex appears to be stalled — no new output for ~3 minutes."
2. Ask the user (via `AskUserQuestion`): **Wait longer** or **Abort and retry**.

## Step 2: Prepare the Plan

1. Ensure the plan is saved to a file in the project directory. If the plan only exists in conversation, write it to a file first (e.g., `.claude/plan.md`).
2. Note the **absolute path** to the plan file — you will pass this path to Codex so it can read the file itself.
3. **Do NOT paste the plan content into the Codex prompt.** Codex will read the file directly.

## Prompt Construction Principle

**Only include in the Codex prompt what Codex cannot access on its own:**
- The path to the plan file (so Codex knows where to read it)
- The user's original request / task description
- Important context from the conversation: user comments, constraints, preferences, architectural decisions discussed verbally
- Any clarifications or special instructions the user gave

**Do NOT include:**
- The plan content itself (Codex reads the file)
- Code snippets Codex can read from the repo
- Information Codex can derive by reading files

## Step 3: Send Plan to Codex for Review (Round 1)

### Running Codex with Progress Monitoring

Run Codex in background with `--json` output to a temp file so you can monitor progress and report it to the user. Use the Bash tool with `run_in_background: true`:

```bash
RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --config model_reasoning_effort="<EFFORT>" --sandbox read-only -C <WORKING_DIR> 2>"$CODEX_ERR" <<'EOF' > "$CODEX_OUTPUT"
<REVIEW_PROMPT content here>
EOF
```

**IMPORTANT**: The first line of stdout contains both absolute paths (JSONL and ERR, space-separated). **Save both paths** — you will need them for all subsequent poll, extract, and cleanup commands. Each Bash tool call is a new shell, so shell variables do not persist between calls. Always use the literal absolute paths (e.g., `/tmp/codex-review-1737000000-12345.jsonl`).

Also save the `thread_id` from the first `thread.started` event in the JSONL — you will need it to resume the correct session in subsequent rounds (instead of `resume --last` which may pick the wrong session).

Then **poll for progress** approximately every 60 seconds using the Bash tool to read the temp file (see "Progress Monitoring Strategy" section above for full details):

```bash
tail -5 /tmp/codex-review-XXXXXXXXXX.jsonl
```

**How to interpret JSONL events and what to report to the user:**

| Event | Meaning | Report to user |
| --- | --- | --- |
| `{"type":"turn.started"}` | Codex has started processing | "Codex is thinking..." |
| `{"type":"item.completed","item":{"type":"reasoning",...}}` | Codex finished a thinking step | Report the `text` field (e.g., "Codex is reading the plan file...") |
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

Clean up the temp files after extracting the result:

```bash
rm -f /tmp/codex-review-XXXXXXXXXX.jsonl /tmp/codex-review-XXXXXXXXXX.err
```

**NOTE**: No `-m` flag — use Codex's default model.

The `<REVIEW_PROMPT>` must follow this structure:

```
You are participating in a plan review debate with Claude Code (Claude Opus 4.6).

## Your Role
You are the REVIEWER. Your job is to critically evaluate an implementation plan. Be thorough, constructive, and specific.

## Plan Location
Read the implementation plan from: <ABSOLUTE_PATH_TO_PLAN_FILE>

## User's Original Request
<The user's original task/request that prompted this plan>

## Session Context
<Any important context from the conversation that Codex cannot access on its own:
- User comments, preferences, or constraints
- Architectural decisions discussed verbally
- Clarifications the user provided
- Special instructions or priorities>

(If there is no additional context beyond the plan file, write "No additional context — the plan file is self-contained.")

## Instructions
1. Read the plan file above.
2. Read any source files referenced in the plan to understand the current codebase state.
3. Analyze the plan and produce your review in the EXACT format below.

## Required Output Format

For each issue found, use this structure:

### ISSUE-{N}: {Short title}
- **Category**: Critical Issue | Improvement | Question
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Plan Reference**: Step {X} / Section "{name}" / Decision "{name}"
- **Description**: What the problem is, in detail.
- **Why It Matters**: Concrete scenario showing how this causes a real failure, bug, or degraded outcome.
- **Suggested Fix**: Specific proposed change to the plan. (Required for Critical Issue and Improvement. Optional for Question.)

After all issues, provide:

### VERDICT
- **Result**: REJECT | APPROVE_WITH_CHANGES | APPROVE
- **Summary**: 2-3 sentence overall assessment.

Rules:
- Be specific: reference exact steps, file paths, or decisions in the plan.
- Do NOT rubber-stamp the plan. Your value comes from finding real problems.
- Do NOT raise vague concerns without concrete scenarios.
- Every Critical Issue MUST have a Suggested Fix.
```

**After receiving Codex's review**, summarize it for the user before proceeding.

## Step 4: Claude Code Rebuts (Round 1)

After receiving Codex's review, you (Claude Code) must:

1. **Carefully analyze** each ISSUE Codex raised.
2. **Accept valid criticisms** - If Codex found real issues, acknowledge them and update the plan file.
3. **Push back on invalid points** - If you disagree with Codex's assessment, explain why with evidence. Use your own knowledge, web search, or documentation to support your position.
4. **Update the plan file** with accepted changes (use Edit tool).
5. **Summarize** for the user what you accepted, what you rejected, and why.
6. **Immediately proceed to Step 5** — do NOT ask the user whether to continue. Always send the updated plan back to Codex for re-review.

## Step 5: Continue the Debate (Rounds 2+)

Resume the Codex session using the **saved `thread_id`** from the `thread.started` event in Round 1. Use the same background + polling pattern:

```bash
RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only -C <WORKING_DIR> resume <THREAD_ID> 2>"$CODEX_ERR" <<'EOF' > "$CODEX_OUTPUT"
<REBUTTAL_PROMPT content here>
EOF
```

Save the new output path and poll/extract the same way as Step 3.

The `<REBUTTAL_PROMPT>` must follow this structure:

```
This is Claude Code (Claude Opus 4.6) responding to your review.

## Issues Accepted & Fixed
<For each accepted issue, reference by ISSUE-{N} and describe what was changed in the plan>

## Issues Disputed
<For each disputed issue, reference by ISSUE-{N} and explain why with evidence>

## Your Turn
Re-read the plan file (same path as before) to see the updated plan, then re-review.
- Have your previous concerns been properly addressed?
- Do the changes introduce any NEW issues?
- Are there any remaining problems?

Use the same output format as before (ISSUE-{N} structure + VERDICT).
Verdict options: REJECT | APPROVE_WITH_CHANGES | APPROVE
```

**After each Codex response:**
1. Summarize Codex's response for the user.
2. If Codex's verdict is `APPROVE` → proceed to Step 6.
3. If Codex's verdict is `APPROVE_WITH_CHANGES` → address the suggestions, then **automatically** send one more round to Codex for confirmation. Do NOT ask the user.
4. If Codex's verdict is `REJECT` → address the issues and **automatically** continue to next round. Do NOT ask the user.

**IMPORTANT**: The debate loop is fully automatic. After fixing issues or updating the plan, ALWAYS send it back to Codex without asking the user. The loop only stops when Codex returns `APPROVE`. The user is only consulted at the very end (Step 6) or if a stalemate is detected.

### Early Termination & Round Extension

- **Early termination**: If Codex returns `APPROVE`, end the debate immediately and proceed to Step 6.
- **Round extension**: There is no hard round limit. Continue the fix → re-review loop until either:
  - Codex returns `APPROVE`, OR
  - The same points go back and forth without progress for 2 consecutive rounds (stalemate detected) → present the disagreement to the user and let them decide.

**Repeat** Steps 4-5 until consensus or stalemate.

## Step 6: Finalize and Report

After the debate concludes, present the user with a **Debate Summary**:

```
## Debate Summary

### Rounds: X
### Final Verdict: [CONSENSUS REACHED / STALEMATE - USER DECISION NEEDED]

### Key Changes from Debate:
1. [Change 1 - accepted from Codex]
2. [Change 2 - accepted from Codex]
...

### Points Where Claude Prevailed:
1. [Point 1 - Claude's position was maintained]
...

### Points Where Codex Prevailed:
1. [Point 1 - Codex's position was accepted]
...

### Final Plan:
<Path to the updated plan file>
```

Then ask the user (via `AskUserQuestion`):
- **Approve & Implement** - Proceed with the final plan
- **Request more rounds** - Continue debating specific points
- **Modify manually** - User wants to make their own adjustments before implementing

## Step 7: Implementation

If the user approves:
1. Exit plan mode if still in it.
2. Begin implementing the final debated plan.
3. The plan has been stress-tested — implement with confidence.

## Codex Command Reference

| Action | Command |
| --- | --- |
| Initial review | `RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only --config model_reasoning_effort="<EFFORT>" -C <DIR> 2>"$CODEX_ERR" <<'EOF' ... EOF > "$CODEX_OUTPUT"` |
| Subsequent rounds | `RUN_ID=$(date +%s)-$$ && CODEX_OUTPUT=/tmp/codex-review-$RUN_ID.jsonl && CODEX_ERR=/tmp/codex-review-$RUN_ID.err && echo "$CODEX_OUTPUT $CODEX_ERR" && codex exec --skip-git-repo-check --json --sandbox read-only -C <WORKING_DIR> resume <THREAD_ID> 2>"$CODEX_ERR" <<'EOF' ... EOF > "$CODEX_OUTPUT"` |
| Poll progress | `tail -5 /tmp/codex-review-XXXXXXXXXX.jsonl` |
| Extract final review | `grep '"type":"agent_message"' /tmp/codex-review-XXXXXXXXXX.jsonl \| tail -1 \| python3 -c "import sys,json; print(json.loads(sys.stdin.read())['item']['text'])"` |
| Check errors on failure | `tail -20 /tmp/codex-review-XXXXXXXXXX.err` |

## Important Rules

1. **Codex reads the plan file itself** - Do NOT paste plan content into the prompt. Just give Codex the file path. This avoids bloating the prompt and ensures Codex always sees the latest version.
2. **Only send what Codex can't access** - The prompt should contain: file paths, user's original request, session context (user comments/constraints/preferences). NOT: file contents, diffs, code snippets.
3. **Always use heredoc (`<<'EOF'`) for prompts** - Never use `echo "<prompt>" |`. Heredoc with single-quoted delimiter prevents shell expansion of `$`, backticks, `"`, etc.
4. **Always use `--sandbox read-only`** - This is a review-only process. No file edits should happen during debate.
5. **Always use `-C <WORKING_DIR>`** - So Codex runs in the correct project directory.
6. **Always use `--skip-git-repo-check`** - Required for Codex CLI operation.
7. **Redirect stderr to file, not /dev/null** - Use `2>"$CODEX_ERR"` so errors can be inspected on failure. Never use `2>/dev/null`.
8. **No `-m` flag** - Always use Codex's default model. If the user wants a different model, they configure it in Codex directly.
9. **Use absolute paths for temp files** - Each Bash tool call is a new shell. `$CODEX_OUTPUT` does not persist. Save the absolute path from the first echo and use it literally in all subsequent commands.
10. **Resume by thread ID, not `--last`** - Parse `thread_id` from the `thread.started` JSONL event and use `resume <THREAD_ID>` to avoid resuming the wrong session.
11. **Never skip the user summary** - After each round, tell the user what happened before continuing.
12. **Be genuinely adversarial** - Don't just accept everything Codex says. Push back when you have good reason to. The value of this process comes from genuine disagreement and resolution.
13. **Don't rubber-stamp** - If you think Codex missed something in its review, point it out in your rebuttal. You are an equal participant, not a passive recipient of feedback.
14. **Track the plan evolution** - Update the plan file after each round so Codex always reads the latest version.
15. **Require structured output** - If Codex's response doesn't follow the required ISSUE-{N} format, ask it to reformat in the resume prompt.

## Error Handling
- If the Codex background process exits with an error (no `turn.completed` in output), read the stderr file (`tail -20 /tmp/codex-review-XXXXXXXXXX.err`) and report the error content to the user.
- If Codex stalls (no new output for ~3 minutes / 3 consecutive polls), ask the user whether to wait or abort (see Stall Detection in Progress Monitoring Strategy).
- If Codex gives an unclear or malformed response, ask for clarification via resume.
- If the debate stalls (same points going back and forth without resolution), present the disagreement to the user and let them decide.
