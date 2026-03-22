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

## 1.8) Prompt Assembly

1. Read the appropriate Round 1 template from `references/prompts.md` (Working Tree or Branch).
2. Replace `{USER_REQUEST}` with user's task description (or default).
3. Build `{SESSION_CONTEXT}` using the structured schema from `references/prompts.md` Placeholder Injection Guide.
4. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.
5. For branch mode: replace `{BASE_BRANCH}` with the validated base branch name.

## 2) Start Round 1
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-impl-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}

START_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT")
```

**Validate init output:** Verify `INIT_OUTPUT` starts with `CODEX_SESSION:`. If not, report error.
**Validate start output:** Verify `START_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

## 2.5) Information Barrier — Claude Independent Code Analysis

MUST complete before polling Codex output.
Codex is running in background — use this time productively.

**working-tree mode**: run `git diff` and `git diff --cached` yourself
   (or reuse the diff already collected in Step 1 — working tree hasn't changed)
**branch mode**: run `git diff $BASE_BRANCH...HEAD` yourself
   (or reuse the diff already collected in Step 1)

Form an independent FINDING-{N} list in working context (do NOT write to a file):
- Bugs and edge cases
- Security issues
- Performance concerns
- Maintainability problems

Use the same FINDING-{N} format as `output-format.md` ISSUE-{N} (same field names).
Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

INFORMATION BARRIER ends after Round 1 poll completes.

## 3) Poll

```bash
POLL_OUTPUT=$(node "$RUNNER" poll "$SESSION_DIR")
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

After each poll, report **specific activities** to the user using the `SUMMARY:` line from poll stdout. NEVER say generic messages like "Codex is running" or "still waiting" — these provide no information.

**Poll stdout format:**
- Line 1: `POLL:{status}:{elapsed}[:{exit_code}:{details}]`
- Line 2 (if completed): `THREAD_ID:{id}`
- Line 2 (if running): `SUMMARY:{activity description}`

**Report template:** `"Codex [{elapsed}s]: {summary}"` — read the SUMMARY line and report it directly to the user.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

## 4) Apply/Rebut

### 4a) Parse Codex Output
Read all `ISSUE-{N}` blocks from `$SESSION_DIR/review.md`.

### 4b) Build FINDING↔ISSUE Mapping Table
Map Claude's FINDING-{N} (from Step 2.5) against Codex's ISSUE-{N}:

| Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
|--------------------|-----------------|----------------|
| ...                | ...             | ...            |

Classification options:
- **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same code problem
- **Codex-only**: ISSUE-{M} has no matching Claude FINDING
- **Claude-only**: FINDING-{N} has no matching Codex ISSUE
- **Genuine Disagreement**: Conflicting assessments of the same code

### 4c) Apply/Rebut using cross-analysis context
For each ISSUE-{N}:
- If genuine agreement or Codex-only → apply fix to code
- If Claude-only → include in final report as Claude finding
- If genuine disagreement → write rebuttal with concrete proof (paths, tests, behavior)

- For valid issues: edit code and record fix evidence.
- For invalid issues: write rebuttal with concrete proof (paths, tests, behavior).
- **Branch mode only**: after applying fixes, commit them (`git add` + `git commit`) before resuming. Codex reads `git diff <base>...HEAD` which only includes committed changes — uncommitted fixes will be invisible to Codex and cause repeated issues.
- After applying fixes, verify with the narrowest relevant automated check:
  - If test suite exists: run relevant tests.
  - If type-checked language: run typecheck/compile.
  - If no suitable automation: document manual fix evidence (diff + reasoning + affected paths).
  - Do NOT claim an issue is fixed without some form of verification evidence.
- Record the set of open (unresolved) ISSUE-{N} IDs for stalemate tracking.

After parsing each round's review, append round summary to `$SESSION_DIR/rounds.json`:
- Read existing rounds.json or start with empty array `[]`
- Append: `{ "round": N, "elapsed_seconds": ..., "verdict": "...", "issues_found": ..., "issues_fixed": ..., "issues_disputed": ... }`
- Write back to `$SESSION_DIR/rounds.json`

## 5) Resume Thread

Build the rebuttal prompt from `references/prompts.md` — use the **Working-tree mode** or **Branch mode** Rebuttal Prompt template depending on the review mode. For branch mode, replace all `{BASE_BRANCH}` placeholders so Codex re-reads the correct diff scope. Replace all other placeholders (`{SESSION_CONTEXT}`, `{OUTPUT_FORMAT}`, etc.).

```bash
START_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT")
```

Then **go back to step 3 (Poll).** After poll completes, repeat step 4 (Apply/Rebut) and check completion criteria below. If not met, resume again (step 5). Continue this loop until a completion criterion is reached.

## 6) Completion Criteria
- Codex returns `VERDICT: CONSENSUS`.
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
| Verdict | {CONSENSUS/CONTINUE/STALEMATE} |
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
node "$RUNNER" stop "$SESSION_DIR"
```
Kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout.

## Session Finalization

After the final round completes, write session metadata to the session directory (review.md is already present from poll):

```bash
cat > "$SESSION_DIR/meta.json" << METAEOF
{
  "skill": "codex-impl-review",
  "version": 15,
  "effort": "$EFFORT",
  "scope": "$SCOPE",
  "rounds": ${ROUND_COUNT:-0},
  "verdict": "$FINAL_VERDICT",
  "timing": { "total_seconds": ${ELAPSED_SECONDS:-0} },
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
