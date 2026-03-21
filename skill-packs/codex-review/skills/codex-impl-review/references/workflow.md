# Implementation Review Workflow

## Smart Default Detection

> **Context:** These detection commands run inside Claude Code where `git` is available. They assume a git repository. All `git` commands are wrapped in `2>/dev/null` to fail silently for non-git directories or edge cases (detached HEAD, no upstream tracking branch set). Detection is best-effort — if a command fails, the fallback default is used.

Before asking the user anything, auto-detect and announce:

**scope detection (FIRST):**
```bash
HAS_WORKING_CHANGES=$(git status --short 2>/dev/null | grep -v '^??' | wc -l)
HAS_BRANCH_COMMITS=$(git rev-list @{u}..HEAD 2>/dev/null | wc -l)
if [ "$HAS_WORKING_CHANGES" -gt 0 ]; then SCOPE="working-tree"
elif [ "$HAS_BRANCH_COMMITS" -gt 0 ]; then SCOPE="branch"
else SCOPE=""  # ask user
fi
```

**effort detection (AFTER scope — adapts to detected scope):**
```bash
if [ "$SCOPE" = "branch" ]; then
  FILES_CHANGED=$(git diff --name-only @{u}..HEAD 2>/dev/null | wc -l)
else
  FILES_CHANGED=$(git diff --name-only 2>/dev/null | wc -l)
fi
if [ "$FILES_CHANGED" -lt 10 ]; then EFFORT="medium"
elif [ "$FILES_CHANGED" -lt 50 ]; then EFFORT="high"
else EFFORT="xhigh"
fi
# Fallback: default high
EFFORT=${EFFORT:-high}
```

Announce: `"Detected: scope=working-tree, effort=high (23 files changed). Proceeding — reply to override."`

Only block execution for `$SCOPE` when both detection methods return 0 (no changes anywhere).

---

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
- **Stale base warning**: If base branch is local-only, recommend `git fetch origin <base>` before review. Stale base can cause incorrect diff scope.
- Branch diff: `git diff <base>...HEAD`.
- Commit log: `git log <base>..HEAD --oneline`.
- Optional plan file for intent alignment.

## 1.5) Pre-flight Checks

Before starting Round 1:
1. Working-tree mode: verify working tree has changes: `git diff --quiet && git diff --cached --quiet` should FAIL (exit 1). If both succeed (exit 0), there are no changes — report to user and stop.
2. Branch mode: verify branch diff exists: `git diff <base>...HEAD --quiet` should FAIL. If no diff, report to user and stop.
3. Verify `codex` CLI is in PATH: `command -v codex`. If not found, tell user to install.
4. Verify working directory is writable (for state directory creation).

## 1.8) Prompt Assembly

1. Read the appropriate Round 1 template from `references/prompts.md` (Working Tree or Branch).
2. Replace `{USER_REQUEST}` with user's task description (or default).
3. Build `{SESSION_CONTEXT}` using the structured schema from `references/prompts.md` Placeholder Injection Guide.
4. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.
5. For branch mode: replace `{BASE_BRANCH}` with the validated base branch name.

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
- `Codex running: /bin/zsh -lc 'git diff ...'` → Report: "Codex is reading the repo diff"
- `Codex running: /bin/zsh -lc 'cat src/foo.ts'` → Report: "Codex is reading file `src/foo.ts`"
- `Codex running: /bin/zsh -lc 'rg -n "pattern" ...'` → Report: "Codex is searching for `pattern` in code"
- Multiple completed commands → Summarize: "Codex has read {N} files, analyzing results"

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description of what Codex is doing or just did.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Apply/Rebut
- Parse `ISSUE-{N}` blocks.
- For valid issues: edit code and record fix evidence.
- For invalid issues: write rebuttal with concrete proof (paths, tests, behavior).
- **Branch mode only**: after applying fixes, commit them (`git add` + `git commit`) before resuming. Codex reads `git diff <base>...HEAD` which only includes committed changes — uncommitted fixes will be invisible to Codex and cause repeated issues.
- After applying fixes, verify with the narrowest relevant automated check:
  - If test suite exists: run relevant tests.
  - If type-checked language: run typecheck/compile.
  - If no suitable automation: document manual fix evidence (diff + reasoning + affected paths).
  - Do NOT claim an issue is fixed without some form of verification evidence.
- Record the set of open (unresolved) ISSUE-{N} IDs for stalemate tracking.

## 5) Resume Thread

Build the rebuttal prompt from `references/prompts.md` — use the **Working-tree mode** or **Branch mode** Rebuttal Prompt template depending on the review mode. For branch mode, replace all `{BASE_BRANCH}` placeholders so Codex re-reads the correct diff scope. Replace all other placeholders (`{SESSION_CONTEXT}`, `{OUTPUT_FORMAT}`, etc.).

```bash
STATE_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

**Update STATE_DIR** (each round creates a new state directory). Then **go back to step 3 (Poll).** After poll completes, repeat step 4 (Apply/Rebut) and check completion criteria below. If not met, resume again (step 5). Continue this loop until a completion criterion is reached.

## 6) Completion Criteria
- Codex returns `VERDICT: APPROVE`.
- Or user accepts a documented stalemate.
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
- Residual risks and unresolved assumptions.
- Recommended next steps.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout.

## Session Output

After the final round completes (or after Round 1 for single-round skills), create a persistent session directory:

```bash
SESSION_DIR=".codex-review/sessions/codex-impl-review-$(date +%s)-$$"
mkdir -p "$SESSION_DIR"
cp "$STATE_DIR/review.md" "$SESSION_DIR/review.md"
cat > "$SESSION_DIR/meta.json" << 'METAEOF'
{
  "skill": "codex-impl-review",
  "version": 14,
  "effort": "$EFFORT",
  "scope": "$SCOPE",
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
