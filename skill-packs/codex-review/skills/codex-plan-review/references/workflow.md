# Plan Review Workflow

## 1) Gather Inputs
- Plan file path.
- User request text.
- Session context and constraints.
- Debate effort (`low|medium|high|xhigh`).

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

After each poll, report to user what Codex is doing (extract status lines from poll output).
Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Parse Review
- Read `THREAD_ID:` and `review.txt` from runner output/state directory.
- Extract `ISSUE-{N}` blocks.
- Apply accepted fixes to plan.
- Build rebuttal packet for disputed items.

## 5) Resume (Round 2+)
```bash
STATE_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
```

**→ Go back to step 3 (Poll).** After poll completes, repeat step 4 (Parse) and check stop conditions below. If not met, resume again (step 5). Continue this loop until a stop condition is reached.

## 6) Stop Conditions
- `VERDICT: APPROVE`.
- Stalemate (same unresolved points for two consecutive rounds).
- User stops debate.

## 7) Final Report
- Round count.
- Final verdict.
- Accepted issues and plan edits.
- Disputed issues with reasoning.
- Final plan path.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the debate ended due to failure or timeout.
