# Plan Review Workflow

## 0) Choose Effort Level

Select debate effort based on plan complexity and time constraints:

| Effort | Time Estimate | Analysis Depth | Best For |
|--------|--------------|----------------|----------|
| `low` | 2-5 min | Quick sanity check | Simple plans, time-sensitive reviews, obvious issues only |
| `medium` | 5-10 min | Balanced review | Most plans, good depth without excessive time |
| `high` | 10-20 min | Thorough analysis | Complex plans, critical features, pre-implementation validation |
| `xhigh` | 20-40 min | Exhaustive review | Mission-critical features, architectural decisions, high-risk changes |

**Recommendation**: Start with `medium` for most cases. Use `low` when time-constrained. Reserve `xhigh` for critical architectural decisions only.

**Note**: Adaptive timeout is automatically calculated based on repository size. Times above are per review round.

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

After each poll, parse the status lines and report **specific activities** to the user. NEVER say generic messages like "Codex đang hoạt động" or "tiếp tục chờ" — these provide no information.

**How to parse poll output for user reporting:**
Poll output contains lines like `[Ns] Codex thinking: ...`, `[Ns] Codex running: ...`, `[Ns] Codex completed: ...`. Extract and summarize:
- `Codex thinking: "**Some topic**"` → Report: "Codex đang phân tích: {topic}"
- `Codex running: /bin/zsh -lc 'git diff ...'` → Report: "Codex đang đọc diff của repo"
- `Codex running: /bin/zsh -lc 'cat src/foo.ts'` → Report: "Codex đang đọc file `src/foo.ts`"
- `Codex running: /bin/zsh -lc 'rg -n "pattern" ...'` → Report: "Codex đang tìm kiếm `pattern` trong code"
- Multiple completed commands → Summarize: "Codex đã đọc {N} files, đang phân tích kết quả"

**Progress tracking enhancement:**
- Count `Codex completed: cat ...` lines to track files read
- Group by file type: "Đã đọc 5 implementation files, 2 config files"
- Show cumulative progress: "Đã đọc 12/~50 files dự kiến"
- Estimate remaining time based on elapsed time and progress

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description of what Codex is doing or just did.

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

### Review Summary
| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {APPROVE/REVISE/STALEMATE} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

Then present:
- Accepted issues and plan edits.
- Disputed issues with reasoning.
- Final plan path.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the debate ended due to failure or timeout.

## Error Handling

Runner `poll` trả status qua output string `POLL:<status>:<elapsed>[:exit_code:details]`. Thông thường exit 0, nhưng có thể exit non-zero khi state dir invalid hoặc I/O error — cần xử lý cả hai trường hợp:

**Parse POLL string (exit 0):**
- `POLL:completed:...` → thành công, đọc review.txt
- `POLL:failed:...:3:...` → turn failed. Retry 1 lần. Nếu vẫn fail, report error.
- `POLL:timeout:...:2:...` → timeout. Report partial results nếu review.txt tồn tại. Suggest retry với lower effort.
- `POLL:stalled:...:4:...` → stalled. Report partial results. Suggest lower effort.

**Fallback khi poll exit non-zero hoặc output không parse được:**
- Log error output, report lỗi hạ tầng cho user, suggest retry.

Runner `start` có thể fail với exit code:
- 1 → generic error (invalid args, I/O). Report error message.
- 5 → Codex CLI not found. Tell user to install.

Always run cleanup (step 8) regardless of error.

## Stalemate Handling

When stalemate detected (same unresolved points for two consecutive rounds):
1. List specific deadlocked points.
2. Show each side's final argument for each point.
3. Recommend which side user should favor.
4. Ask user: accept current state or force one more round.
