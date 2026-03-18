# Plan Review Workflow

## Smart Default Detection

**plan-path detection** (matches spec: `plan.md`, `PLAN.md`, `docs/*plan*` only):
```bash
# Check exact names at CWD root level
PLAN_ROOT=$(ls plan.md PLAN.md 2>/dev/null | head -1)
# Check docs/ subdirectory for any *plan* file
PLAN_DOCS=$(find ./docs -maxdepth 2 -name "*plan*" 2>/dev/null | head -5)

# Count total candidates
ALL="$([ -n "$PLAN_ROOT" ] && echo "$PLAN_ROOT")
$PLAN_DOCS"
COUNT=$(echo "$ALL" | grep -v '^$' | wc -l)

if [ "$COUNT" -eq 1 ]; then
  PLAN_PATH=$(echo "$ALL" | grep -v '^$')
elif [ "$COUNT" -gt 1 ]; then
  # List candidates and ask user to choose
  echo "Multiple plan files found: $ALL"
  # Ask: "Which plan file should I use?"
else
  # Ask user for path
  PLAN_PATH=""
fi
```

> **Scope:** Only searches `plan.md`/`PLAN.md` at CWD root, and `docs/` subdirectory. Does NOT do deep recursive search to avoid false positives.

**effort detection:** Default `high` for plan review.

Announce: `"Detected: plan=docs/superpowers/plans/2026-03-18-example.md, effort=high. Proceeding — reply to override."`

---

## 1) Gather Inputs
- Plan file path (absolute). Must be a Markdown file.
- User request text (or default: "Review this plan for quality and completeness").
- Session context: constraints, assumptions, tech stack.
- Acceptance criteria (user-provided or derived from plan).
- Debate effort level (`low|medium|high|xhigh`).

## 1.5) Pre-flight Checks

Before starting Round 1:
1. Verify plan file exists and is readable: `test -r "$PLAN_PATH"`. If not, report error and stop.
2. Verify plan file is writable: `test -w "$PLAN_PATH"`. If not writable, stop and ask user to provide a writable plan path. Multi-round debate requires saving plan edits in-place.
3. Verify plan file is Markdown (`.md` extension or contains markdown headings).
4. Verify `codex` CLI is in PATH: `command -v codex`. If not found, tell user to install.
5. Verify working directory is writable (for state directory creation).
6. If acceptance criteria not provided by user, derive from plan: scan for headings like "Goals", "Outcomes", "Success criteria", "Expected results" and extract content.

## 1.8) Prompt Assembly

1. Read the Round 1 template from `references/prompts.md`.
2. Replace `{PLAN_PATH}` with the absolute path to the plan file.
3. Replace `{USER_REQUEST}` with user's task description (or default).
4. Build `{SESSION_CONTEXT}` using the structured schema from `references/prompts.md` Placeholder Injection Guide.
5. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md` (the single block after "Use this exact shape").
6. Replace `{ACCEPTANCE_CRITERIA}` with user-provided criteria or derived criteria from step 1.5.

## 2) Start Round 1
```bash
STATE_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

## 3) Poll

```bash
POLL_OUTPUT=$(node "$RUNNER" poll "$STATE_DIR")
```

Adaptive intervals — start slow, speed up:

**Round 1 (first review):**
- Poll 1: wait 60s
- Poll 2: wait 60s
- Poll 3: wait 30s
- Poll 4+: wait 15s

**Round 2+ (rebuttal rounds):**
- Poll 1: wait 30s
- Poll 2+: wait 15s

After each poll, parse the status lines and report **specific activities** to the user. NEVER say generic messages like "Codex is running" or "still waiting" — these provide no information.

**How to parse poll output for user reporting:**
Poll output contains lines like `[Ns] Codex thinking: ...`, `[Ns] Codex running: ...`, `[Ns] Codex completed: ...`. Extract and summarize:
- `Codex thinking: "**Some topic**"` → Report: "Codex is analyzing: {topic}"
- `Codex running: /bin/zsh -lc 'cat plan.md'` → Report: "Codex is reading the plan file"
- `Codex running: /bin/zsh -lc 'rg -n "pattern" ...'` → Report: "Codex is searching for `pattern` in the codebase"
- Multiple completed commands → Summarize: "Codex has read {N} files, analyzing results"

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description of what Codex is doing or just did.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Parse Review
- Read `THREAD_ID:` and `review.md` from runner output/state directory.
- Extract `ISSUE-{N}` blocks.
- Apply accepted fixes to plan.
- **Save the updated plan file before resuming.** Codex round 2+ will re-read it from the plan path.
- Build rebuttal packet for disputed items.
- Record the set of open (unresolved) ISSUE-{N} IDs for stalemate tracking.

## 5) Resume (Round 2+)

Build the rebuttal prompt from `references/prompts.md` (Rebuttal Prompt template). Replace all placeholders including `{PLAN_PATH}` so Codex re-reads the updated plan.

```bash
STATE_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

**Update STATE_DIR** (each round creates a new state directory). Then **go back to step 3 (Poll).** After poll completes, repeat step 4 (Parse) and check stop conditions below. If not met, resume again (step 5). Continue this loop until a stop condition is reached.

## 6) Stop Conditions
- `VERDICT: APPROVE`.
- Stalemate detected (see below).
- User stops debate.
- **Hard cap: 5 rounds.** At cap, force final synthesis with unresolved issues listed as residual risks.

## Stalemate Detection

Stalemate occurs when the set of unresolved ISSUE-{N} IDs is identical across 2 consecutive rounds:
- Track: after each round, record the set of open (not fixed, not withdrawn) issue IDs.
- If round N and round N-1 have the same open set AND Codex proposed no new issues, declare stalemate.
- Issue renaming or splitting counts as a new issue (different ID).

At stalemate:
1. List specific deadlocked points with both sides' final arguments.
2. Recommend which side to favor based on evidence strength.
3. If current round < 5, ask user: accept current state or force one more round.
4. If current round = 5 (hard cap), do NOT offer another round. Force final synthesis.

## 7) Final Report

### Review Summary
| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {APPROVE/REVISE/STALEMATE} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

Then present:
- Accepted issues and plan edits made.
- Disputed issues with reasoning from both sides.
- Residual risks and unresolved assumptions.
- Recommended next steps before implementation.
- Final plan path.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the debate ended due to failure or timeout.

## Session Output

After the final round completes (or after Round 1 for single-round skills), create a persistent session directory:

```bash
SESSION_DIR=".codex-review/sessions/codex-plan-review-$(date +%s)-$$"
mkdir -p "$SESSION_DIR"
cp "$STATE_DIR/review.md" "$SESSION_DIR/review.md"
cat > "$SESSION_DIR/meta.json" << 'METAEOF'
{
  "skill": "codex-plan-review",
  "version": 14,
  "effort": "$EFFORT",
  "rounds": $ROUND_COUNT,
  "verdict": "$FINAL_VERDICT",
  "timing": { "total_seconds": $ELAPSED_SECONDS },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
METAEOF
echo "Session saved to: $SESSION_DIR"
```

Report `$SESSION_DIR` path to the user in the final summary.

## Error Handling

Runner `poll` returns status via output string `POLL:<status>:<elapsed>[:exit_code:details]`. Normally exits 0, but may exit non-zero on invalid state dir or I/O error — handle both:

**Parse POLL string (exit 0):**
- `POLL:completed:...` → success, read review.md
- `POLL:failed:...:3:...` → turn failed. Retry once. If still failing, report error to user.
- `POLL:timeout:...:2:...` → timeout. Report partial results if review.md exists. Suggest retry with lower effort.
- `POLL:stalled:...:4:...` → stalled. Report partial results. Suggest lower effort.

**Fallback when poll exits non-zero or output is unparseable:**
- Log error output, report infrastructure error to user, suggest retry.

Runner `start` may fail with exit code:
- 1 → generic error (invalid args, I/O). Report error message to user.
- 5 → Codex CLI not found. Tell user to install codex.

Always run cleanup (step 8) regardless of error.
