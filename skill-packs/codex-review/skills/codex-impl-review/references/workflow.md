# Implementation Review Workflow

## 0) Choose Effort Level

Select debate effort based on change complexity and time constraints:

| Effort | Time Estimate | Analysis Depth | Best For |
|--------|--------------|----------------|----------|
| `low` | 2-5 min | Quick sanity check | Small diffs, typo fixes, obvious issues only |
| `medium` | 5-10 min | Balanced review | Most changes, good depth without excessive time |
| `high` | 10-20 min | Thorough analysis | Complex changes, security-sensitive code, refactors |
| `xhigh` | 20-40 min | Exhaustive review | Critical bug fixes, API changes, high-risk refactors |

**Recommendation**: Start with `medium` for most cases. Use `low` for trivial changes. Reserve `xhigh` for security-critical or high-impact changes only.

**Note**: Adaptive timeout is automatically calculated based on repository size. Times above are per review round.

## 1) Collect Inputs

### Mode Selection
Ask user: `working-tree` (default) or `branch`.

### Working-tree mode:
- Working directory path.
- User request and acceptance criteria.
- Uncommitted changes (`git status`, `git diff`, `git diff --cached`).
- Optional plan file for intent alignment.

### Branch mode:
- **Base branch discovery:**
  1. Ask user for base branch, suggest default.
  2. Validate ref: `git rev-parse --verify <base>` — fail-fast if not found.
  3. Fallback order if user doesn't specify: `main` → `master` → remote HEAD (`git symbolic-ref refs/remotes/origin/HEAD`).
  4. Confirm with user if using fallback.
- **Clean working tree required**: run `git diff --quiet && git diff --cached --quiet`. If uncommitted changes exist, tell user to commit or stash first, or switch to working-tree mode.
- Branch diff: `git diff <base>...HEAD`.
- Commit log: `git log <base>..HEAD --oneline`.
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
- Group by file type: "Đã đọc 8 changed files, 3 context files"
- Show cumulative progress: "Đã review 15/23 files trong diff"
- Estimate remaining time based on elapsed time and progress

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description of what Codex is doing or just did.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Apply/Rebut
- Parse `ISSUE-{N}` blocks.
- For valid issues: edit code and record fix evidence.
- For invalid issues: write rebuttal with concrete proof (paths, tests, behavior).
- **Branch mode only**: after applying fixes, commit them (`git add` + `git commit`) before resuming. Codex reads `git diff <base>...HEAD` which only includes committed changes — uncommitted fixes will be invisible to Codex and cause repeated issues.

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
- Fixed defects by severity.
- Disputed items and rationale.
- Residual risk (if any).

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
3. Recommend which side user should favor.
4. Ask user: accept current state or force one more round.
