# Think-About Workflow

## 1) Inputs
- User question/topic.
- Scope and constraints.
- Relevant files or external facts.
- Reasoning effort level.

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

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description of what Codex is doing or just did.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Claude Response
After Codex output:
- List agreements.
- List disagreements and why.
- Add missing angles.
- Set status (`CONTINUE`, `CONSENSUS`, `STALEMATE`).

## 5) Resume Round 2+
```bash
STATE_OUTPUT=$(printf '%s' "$RESPONSE_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
```

**→ Go back to step 3 (Poll).** After poll completes, repeat step 4 (Claude Response) and check stop conditions below. If not met, resume again (step 5). Continue this loop until a stop condition is reached.

## 6) Stop Conditions
- Consensus reached.
- Stalemate detected (repeated claims with no new evidence for two rounds).
- Hard cap reached.

## 7) Final User Output

### Consensus Points
- {agreed points}

### Remaining Disagreements
| Point | Claude | Codex |
|-------|--------|-------|
| ... | ... | ... |

### Recommendations
- {actionable recommendations}

### Open Questions
- {unresolved questions}

### Confidence Level
- low | medium | high

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

When stalemate detected (repeated claims with no new evidence for two rounds):
1. List specific deadlocked points.
2. Show each side's final argument for each point.
3. Recommend which perspective user should favor.
4. Ask user: accept current synthesis or force one more round.
