# Implementation Review Workflow

## 1) Collect Inputs
- Working directory path.
- User request and acceptance criteria.
- Uncommitted changes.
- Optional plan file for intent alignment.

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

## 4) Apply/Rebut
- Parse `ISSUE-{N}` blocks.
- For valid issues: edit code and record fix evidence.
- For invalid issues: write rebuttal with concrete proof (paths, tests, behavior).

## 5) Resume Thread
```bash
STATE_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
```

**→ Go back to step 3 (Poll).** After poll completes, repeat step 4 (Apply/Rebut) and check completion criteria below. If not met, resume again (step 5). Continue this loop until a completion criterion is reached.

## 6) Completion Criteria
- Codex returns `VERDICT: APPROVE`.
- Or user accepts a documented stalemate.

## 7) Final Output
- Round count and verdict.
- Fixed defects by severity.
- Disputed items and rationale.
- Residual risk (if any).

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout.
