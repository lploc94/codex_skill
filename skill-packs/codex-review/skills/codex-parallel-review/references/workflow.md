# Parallel Review Workflow

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
  3. Fallback order: `main` → `master` → remote HEAD (`git symbolic-ref refs/remotes/origin/HEAD`).
  4. Confirm with user if using fallback.
- **Clean working tree required**: `git diff --quiet && git diff --cached --quiet`. If dirty, tell user to commit/stash or switch to working-tree mode.
- Branch diff: `git diff <base>...HEAD`.
- Commit log: `git log <base>..HEAD --oneline`.

### Max Debate Rounds
Ask user for max debate rounds (default: 3). Store as `MAX_ROUNDS`.

## 2) Start Codex Review

Build Codex prompt from `references/prompts.md` (Working Tree or Branch Review Prompt). Include `references/output-format.md` content as `{OUTPUT_FORMAT}`.

```bash
STATE_OUTPUT=$(printf '%s' "$CODEX_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

## 3) Claude Parallel Review (Agent Spawning)

**Immediately after starting Codex**, spawn 3 `code-reviewer` agents in parallel using the Agent tool. Each agent reviews the same files but focuses on different categories. All run concurrently with Codex.

### Agent Assignments

**Agent 1 — Correctness & Edge Cases** (run_in_background: true)
```
Review files in {WORKING_DIR} for:
1. Correctness: logic errors, wrong return values, missing null checks, incorrect conditions, type mismatches
2. Edge cases: boundary conditions, empty inputs, overflow, concurrent access, off-by-one errors

{DIFF_CONTEXT}

For each issue, use this format:
### FINDING-{N}: {title}
- Category: bug | edge-case
- Severity: low | medium | high | critical
- File: {path}
- Location: {line range or function name}
- Problem: {description}
- Suggested fix: {fix}
```

**Agent 2 — Security & Performance** (run_in_background: true)
```
Review files in {WORKING_DIR} for:
1. Security: injection (SQL/XSS/command), auth bypass, data exposure, insecure defaults, missing input validation
2. Performance: O(n²) loops, unnecessary allocations, missing caching, N+1 queries, blocking I/O in async context

{DIFF_CONTEXT}

Use same FINDING-{N} format. Categories: security | performance
```

**Agent 3 — Maintainability & DRY** (run_in_background: true)
```
Review files in {WORKING_DIR} for:
1. Maintainability: naming clarity, DRY violations, missing error handling, overly complex logic, dead code
2. Architecture: separation of concerns, module boundaries, API consistency

{DIFF_CONTEXT}

Use same FINDING-{N} format. Categories: maintainability
```

### FINDING Format (all agents use this)
```
### FINDING-{N}: {title}
- Category: bug | edge-case | security | performance | maintainability
- Severity: low | medium | high | critical
- File: {path}
- Location: {line range or function name}
- Problem: {description}
- Suggested fix: {fix}
```

### Execution
1. Spawn all 3 agents with `run_in_background: true` in a single message (parallel launch).
2. Include diff context (`git diff` or `git diff <base>...HEAD`) in each agent prompt.
3. Include the list of changed files so agents know what to read.
4. Agents run concurrently with Codex — no waiting between them.
5. Collect results from all 3 agents after Codex polling completes (or sooner if agents finish first).

## 4) Poll Codex

```bash
POLL_OUTPUT=$(node "$RUNNER" poll "$STATE_DIR")
```

Adaptive intervals:

**Round 1 (initial review):**
- Poll 1: wait 60s → Claude reviews during wait
- Poll 2: wait 60s → Claude continues review
- Poll 3: wait 30s
- Poll 4+: wait 15s

**Round 2+ (debate rounds):**
- Poll 1: wait 30s
- Poll 2+: wait 15s

Parse poll output for user reporting:
- `Codex thinking: "topic"` → Report: "Codex analyzing: {topic}"
- `Codex running: ...git diff...` → Report: "Codex reading repo diffs"
- `Codex running: ...cat src/foo.ts...` → Report: "Codex reading `src/foo.ts`"
- Multiple completed → Summarize: "Codex read {N} files, analyzing results"

**Report template:** "Codex [{elapsed}s]: {specific activity}" — always include elapsed time.

Continue while `POLL:running`. Stop on `completed|failed|timeout|stalled`.

## 5) Merge Findings

After all 4 reviewers complete (3 Claude agents + Codex):

1. Parse Codex `review.txt` for `ISSUE-{N}` blocks. Extract: title, category, severity, file, problem, fix.
2. Collect `FINDING-{N}` blocks from all 3 Claude agents. Deduplicate across agents (same file + same location → keep the more detailed one). Renumber sequentially.
3. Match Claude findings vs Codex findings using heuristic:
   - **Same file + overlapping location + same category** → `agreed`
   - **Same file + same category + different location** → check if same root cause → `agreed` or `unique`
   - **No match in other set** → `claude-only` or `codex-only`
   - **Same file + same location + contradictory assessment** → `contradiction`
4. Prefer false-negatives over false-positives (mark as unique if unsure).
5. Parse `THREAD_ID` from poll stdout for debate rounds.

Present merge summary:
```
## Merge Results
- Agreed: {N} findings (both reviewers found)
- Claude-only: {N} findings
- Codex-only: {N} findings
- Contradictions: {N} findings
```

## 6) Apply Agreed + Debate Disagreements

### Agreed Findings
Claude applies fixes immediately. Record fix evidence.
- **Branch mode**: commit fixes before debate (`git add` + `git commit`).

### Debate Loop (max `MAX_ROUNDS` rounds)

For each round:

1. Build debate prompt from `references/prompts.md` (Debate Prompt):
   - Include codex-only findings Claude disagrees with + rebuttals.
   - Include claude-only findings for Codex to evaluate.
   - Include contradictions with both arguments.
   - Exclude already-resolved items.

2. Resume Codex thread:
   ```bash
   STATE_OUTPUT=$(printf '%s' "$DEBATE_PROMPT" | node "$RUNNER" start \
     --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
   STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
   ```

3. Poll (Round 2+ intervals: 30s/15s...).

4. Parse Codex response (`RESPONSE-{N}` blocks):
   - `Action: accept` → resolved, Claude applies fix if needed.
   - `Action: reject` with new evidence → Claude reconsiders.
   - `Action: revise` → Codex offers modified position; Claude evaluates.

5. Track per-finding resolution. Remove resolved items from next round prompt.

6. Check exit conditions:
   - All disagreements resolved → stop debate.
   - Round limit (`MAX_ROUNDS`) reached → stop, report unresolved.
   - Stalemate: same arguments repeated 2 consecutive rounds → stop.

### Branch Mode Note
Commit fixes before each resume. Codex reads `git diff <base>...HEAD` — uncommitted fixes are invisible.

## 7) Final Report

```
## Parallel Review Summary
| Metric | Value |
|--------|-------|
| Claude agents | 3 (correctness, security, maintainability) |
| Claude findings | {N} (deduplicated across agents) |
| Codex findings | {N} |
| Agreed | {N} |
| Resolved via debate | {N} |
| Unresolved | {N} |
| Debate rounds | {N}/{MAX_ROUNDS} |
| Verdict | CONSENSUS / PARTIAL / STALEMATE |

### Consensus Issues (both agree)
{list with fixes applied, grouped by severity}

### Resolved Disagreements
{list with resolution outcome: who conceded and why}

### Unresolved Disagreements
| Finding | Claude's Position | Codex's Position | Recommendation |
|---------|-------------------|-------------------|----------------|
{table — present both sides fairly, recommend action}

### Risk Assessment
{residual risk from unresolved items}
```

## 8) Cleanup

```bash
node "$RUNNER" stop "$STATE_DIR"
```
Always run regardless of outcome (success, failure, timeout, stalemate).

## Error Handling

Runner `poll` returns status via `POLL:<status>:<elapsed>[:exit_code:details]`:

- `POLL:completed:...` → success, read `review.txt`.
- `POLL:failed:...:3:...` → turn failed. Retry once. If still fails, report error.
- `POLL:timeout:...:2:...` → timeout. Use partial results if `review.txt` exists. Suggest lower effort.
- `POLL:stalled:...:4:...` → stalled. Use partial results. Suggest lower effort.

Runner `start` exit codes:
- 1 → generic error. Report message.
- 5 → Codex CLI not found. Tell user to install.

Fallback for unparseable poll output: log error, report infra issue, suggest retry.

Always run cleanup (step 8) regardless of error.

## Stalemate Handling

When stalemate detected (same unresolved points for 2 consecutive rounds):
1. List specific deadlocked points.
2. Show each side's final argument.
3. Recommend which side to favor based on evidence strength.
4. Ask user: accept current state or force one more round.
