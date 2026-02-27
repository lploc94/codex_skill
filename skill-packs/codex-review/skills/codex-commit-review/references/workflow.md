# Commit Review Workflow

## 1) Collect Inputs
- **Input source** (`draft` or `last`).
- **Draft mode**: user-provided commit message text. Run `git diff --cached` for staged changes context.
- **Last mode**: `git log -n "$N" --format='%H%n%B---'` to get message(s). For diff context: clamp N to available history (`MAX=$(git rev-list --count HEAD)`; if N > MAX, set N=MAX; if MAX is 0, abort with "no commits to review"). Use `git diff HEAD~"$N"..HEAD` when N < MAX. When N >= MAX (reviewing entire history including root commit), use `EMPTY_TREE=$(git hash-object -t tree /dev/null) && git diff "$EMPTY_TREE"..HEAD` to get a complete diff from empty tree.
- Review effort level (`low|medium|high|xhigh`).
- Project conventions (Conventional Commits, character limits, etc.) if discoverable from repo.

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

## 4) Apply/Rebut
- Parse `ISSUE-{N}` blocks from Codex output.
- For valid issues: propose revised commit message incorporating the fix.
- For invalid issues: write rebuttal with concrete reasoning.
- **NEVER** run `git commit --amend` or `git rebase` — only propose text.

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

### Review Summary
| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {APPROVE/REVISE/STALEMATE} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

Then present:
- **Original message** (verbatim).
- **Revised message** (if changes were made).
- Issue details with reasoning.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout.

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
3. Recommend which version of the commit message user should favor.
4. Ask user: accept current revision or force one more round.
