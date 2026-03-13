# Commit Review Workflow

## 1) Collect Inputs
- **Input source** (`draft` or `last`).
- **Draft mode**: user-provided commit message text. Run `git diff --cached` for staged changes context.
- **Last mode**: `git log -n "$N" --format='%H%n%B---'` to get message(s). For diff context: clamp N to available history (`MAX=$(git rev-list --count HEAD)`; if N > MAX, set N=MAX; if MAX is 0, abort with "no commits to review"). Use `git diff HEAD~"$N"..HEAD` when N < MAX. When N >= MAX (reviewing entire history including root commit), use `EMPTY_TREE=$(git hash-object -t tree /dev/null) && git diff "$EMPTY_TREE"..HEAD` to get a complete diff from empty tree.
- Review effort level (`low|medium|high|xhigh`).

## 1.5) Pre-flight Checks
1. Verify inside a git repository: `git rev-parse --show-toplevel`. If not a git repo, abort.
2. Verify `codex` CLI is in PATH: `command -v codex`. If not found, tell user to install.
3. Verify working directory is writable (for `.codex-review/runs/` creation).
4. **Draft mode**: `git diff --cached --quiet` must FAIL (exit 1). If exit 0, there are no staged changes — abort with "no staged changes to verify message against". Note: `--quiet` implies `--exit-code`, so Git returns 1 when differences exist.
5. **Last mode**: Validate `N` is a positive integer. Verify `git rev-list --count HEAD` > 0 (history exists). Clamp N to available history. Warn if aggregate diff is empty (metadata-only commits).

## 1.6) Convention Discovery
Discover project commit conventions in priority order. Stop at first match:
1. **User instruction**: if user explicitly states conventions (e.g. "we use Conventional Commits"), use that.
2. **Repo config**: check `git config --local commit.template` for a repo-specific commit template file. Only consider templates that are local to the repo — ignore global/system git config.
3. **Repo tooling**: look for commitlint config (`.commitlintrc*`, `commitlint.config.*`), or commit conventions in `CONTRIBUTING.md`.
4. **Recent history heuristic**: scan last 20 commits (`git log -20 --format='%s'`). If 80%+ use `type:` or `type(scope):` prefix, assume Conventional Commits.
5. **Fallback**: use Git's general guideline — short subject line, blank line, optional body. Do NOT assume Conventional Commits without evidence.

Store result as `{PROJECT_CONVENTIONS}` for prompt injection.

## 1.8) Prompt Assembly

1. Read the appropriate Round 1 template from `references/prompts.md` (Draft or Last).
2. Replace `{COMMIT_MESSAGES}` with commit message text (draft: user text; last: formatted log output).
3. Replace `{DIFF_CONTEXT}` with diff command for Codex to run (draft: `git diff --cached`; last: `git diff HEAD~N..HEAD` or empty-tree variant).
4. Replace `{USER_REQUEST}` with user's task description (or default).
5. Replace `{SESSION_CONTEXT}` with structured context block (or "Not specified").
6. Replace `{PROJECT_CONVENTIONS}` with discovered conventions from §1.6 (or "None discovered — use Git general guidelines").
7. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.
8. For last mode (all N, including N=1): replace `{COMMIT_LIST}` with formatted list of SHA + subject for each commit.

## 2) Start Round 1

Set `ROUND=1`.

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

**Poll output parsing guide:**

| Poll line pattern | Report to user |
|-------------------|---------------|
| `Codex thinking: "**topic**"` | Codex analyzing: {topic} |
| `Codex running: ... 'git diff --cached'` | Codex reading staged diff |
| `Codex running: ... 'git diff HEAD~N..HEAD'` | Codex reading commit range diff |
| `Codex running: ... 'git show <sha>'` | Codex inspecting commit `<sha>` |
| `Codex running: ... 'git log ...'` | Codex reading commit history |
| `Codex running: ... 'cat src/foo.ts'` | Codex reading file `src/foo.ts` |
| `Codex running: ... 'rg -n "pattern" ...'` | Codex searching for `pattern` in code |
| `Codex running: ... 'git config commit.template'` | Codex checking commit template config |
| Multiple completed commands | Codex read {N} files, analyzing results |

**Report template:** "Codex [{elapsed}s]: {specific activity summary}" — always include elapsed time and concrete description.

Continue while status is `running`.
Stop on `completed|failed|timeout|stalled`.

**On `POLL:completed`:**
1. Extract thread ID from poll output: look for `THREAD_ID:<id>` line.
2. Read Codex output: `cat "$STATE_DIR/review.md"`.
3. Save for Round 2+: `THREAD_ID=<extracted id>`.

## 4) Apply/Rebut
- Parse `ISSUE-{N}` blocks from Codex output using `references/output-format.md`.
- For valid issues: propose revised commit message incorporating the fix.
- For invalid issues: write rebuttal with concrete reasoning.
- **NEVER** run `git commit --amend` or `git rebase` — only propose text.
- For `last` mode N > 1: ensure per-commit attribution — note which commit SHA each issue applies to.
- Record set of unresolved `ISSUE-{N}` IDs for stalemate detection.

## 5) Resume Round 2+

Build Round 2+ prompt from `references/prompts.md` (appropriate Rebuttal template — Draft or Last):
- Replace `{FIXED_ITEMS}` with accepted issues and how they were fixed.
- Replace `{DISPUTED_ITEMS}` with rebuttals for rejected issues.
- Replace `{REVISED_MESSAGE}` with proposed revised message text. For last N > 1: include per-commit revised messages.
- Replace `{DIFF_CONTEXT}` with the same diff command used in Round 1 (draft: `git diff --cached`; last: `git diff HEAD~N..HEAD` or empty-tree variant).
- Replace `{SESSION_CONTEXT}` with the same structured context block from Round 1.
- Replace `{PROJECT_CONVENTIONS}` with the same discovered conventions from §1.6.
- For last mode: replace `{COMMIT_LIST}` with the same formatted list of SHA + subject from Round 1.
- Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.

```bash
STATE_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

**Important:** Update `STATE_DIR` after every `start --thread-id` — the runner creates a new state directory each round.

**→ Go back to step 3 (Poll).** Increment `ROUND` counter. After poll completes, repeat step 4 and check stop conditions. If `ROUND >= 5`, force final output — do NOT resume. Otherwise, continue until a stop condition is reached.

## 6) Stop Conditions
- Codex returns `VERDICT: APPROVE`.
- Stalemate detected (same unresolved `ISSUE-{N}` IDs for 2 consecutive rounds with no new issues).
- Hard cap reached (5 rounds maximum).
- User explicitly stops.

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
- **Original message(s)** (verbatim). For last N > 1: list per commit SHA.
- **Revised message(s)** (if changes were made). For last N > 1: list per commit SHA.
- Issue details with reasoning.

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout. Use the latest `STATE_DIR` from the most recent round.

## Error Handling

Runner `poll` returns status via output string `POLL:<status>:<elapsed>[:exit_code:details]`. Normally exits 0, but may exit non-zero when state dir is invalid or I/O error — handle both cases:

**Parse POLL string (exit 0):**
- `POLL:completed:...` → Success, read review.md from state dir.
- `POLL:failed:...:3:...` → Turn failed. Retry once. If still fails, report error.
- `POLL:timeout:...:2:...` → Timeout. Report partial results if review.md exists. Suggest retry with lower effort.
- `POLL:stalled:...:4:...` → Stalled. Report partial results. Suggest lower effort.

**Fallback when poll exits non-zero or output cannot be parsed:**
- Log error output, report infrastructure error to user, suggest retry.

**Validate start output:** Verify `STATE_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

Runner `start` may fail with exit code:
- 1 → Generic error (invalid args, I/O). Report error message.
- 5 → Codex CLI not found. Tell user to install.

Always run cleanup (step 8) regardless of error.

## Stalemate Handling

When stalemate detected (same unresolved `ISSUE-{N}` IDs for 2 consecutive rounds with no new issues):
1. List specific deadlocked points.
2. Show each side's final argument for each point.
3. Recommend which version of the commit message user should favor.
4. If `ROUND < 5`, ask user: accept current revision or force one more round. If `ROUND >= 5` (hard cap), force final output — do NOT offer another round.
