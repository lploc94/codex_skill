# Parallel Review Workflow

## 1) Collect Inputs

### Mode Selection
Ask user: `full-codebase` (default), `working-tree`, or `branch`.

### Full-codebase mode (default):
- List all source files: `find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cs" \) | grep -v node_modules | grep -v .git | grep -v dist | grep -v build`
- Or use project-specific patterns (read `package.json`, `pyproject.toml`, etc. for source dirs).
- User request and acceptance criteria.
- Optional plan/docs files for context.

### Working-tree mode:
- Uncommitted changes (`git status`, `git diff`, `git diff --cached`).
- Optional plan file for intent alignment.

### Branch mode:
- **Base branch discovery:**
  1. Ask user for base branch, suggest default.
  2. Validate ref: `git rev-parse --verify <base>` — fail-fast if not found.
  3. Fallback order: `main` → `master` → remote HEAD.
  4. Confirm with user if using fallback.
- **Clean working tree required**: if dirty, tell user to commit/stash or switch to working-tree mode.
- Branch diff: `git diff <base>...HEAD`.

### Max Debate Rounds
Ask user for max debate rounds (default: 3). Store as `MAX_ROUNDS`.

### Prepare Context
Based on mode:
- **Full-codebase**: `FILES=$(find . ...)` — list all source files. No DIFF needed — reviewers read files directly.
- **Working-tree**: `DIFF=$(git diff && git diff --cached)`, `FILES=$(git diff --name-only)`
- **Branch**: `DIFF=$(git diff <base>...HEAD)`, `FILES=$(git diff --name-only <base>...HEAD)`

## 2) Launch All 4 Reviewers Simultaneously

**CRITICAL**: Steps 2a and 2b MUST execute in the SAME message to achieve true parallelism.

### 2a) Start Codex via Runner

Build Codex prompt from `references/prompts.md`. Start as background subprocess:

```bash
STATE_OUTPUT=$(printf '%s' "$CODEX_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

### 2b) Spawn 3 Claude Reviewer Agents

Use Claude Code's **native Agent tool** (built-in, no plugins needed) to spawn 3 parallel reviewers. Each uses `subagent_type: "code-reviewer"` with `run_in_background: true`.

**All 3 agents MUST be spawned in the same message as the Codex start command.**

#### Agent 1 — Correctness & Edge Cases

```json
{
  "subagent_type": "code-reviewer",
  "description": "Review correctness and edge cases",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately — you will NOT see their findings. Be thorough.\n\nWorking directory: {WORKING_DIR}\nMode: {MODE}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on:\n1. Correctness: logic errors, wrong return values, missing null checks, incorrect conditions, type mismatches, off-by-one\n2. Edge cases: boundary conditions, empty inputs, overflow, concurrent access, race conditions\n\nRead each file listed above. For each issue found, output:\n\n### FINDING-{N}: {title}\n- Category: bug | edge-case\n- Severity: low | medium | high | critical\n- File: {path}\n- Location: {line range or function name}\n- Problem: {description}\n- Suggested fix: {concrete fix}\n\n{DIFF_OR_EMPTY}\n\nIf no issues found in your categories, state that explicitly."
}
```

#### Agent 2 — Security & Performance

```json
{
  "subagent_type": "code-reviewer",
  "description": "Review security and performance",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately — you will NOT see their findings. Be thorough.\n\nWorking directory: {WORKING_DIR}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on:\n1. Security: injection (SQL/XSS/command), auth bypass, data exposure, insecure defaults, missing input validation, hardcoded secrets\n2. Performance: O(n²) loops, unnecessary allocations, missing caching, N+1 queries, blocking I/O in async context, memory leaks\n\nRead each changed file. Use FINDING-{N} format (same as other reviewers). Categories: security | performance\n\nDiff context:\n```\n{DIFF}\n```\n\nIf no issues found in your categories, state that explicitly."
}
```

#### Agent 3 — Maintainability & Architecture

```json
{
  "subagent_type": "code-reviewer",
  "description": "Review maintainability and architecture",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately — you will NOT see their findings. Be thorough.\n\nWorking directory: {WORKING_DIR}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on:\n1. Maintainability: naming clarity, DRY violations, missing error handling, overly complex logic, dead code, missing comments for complex logic\n2. Architecture: separation of concerns, module boundaries, API consistency, coupling issues\n\nRead each changed file. Use FINDING-{N} format (same as other reviewers). Categories: maintainability\n\nDiff context:\n```\n{DIFF}\n```\n\nIf no issues found in your categories, state that explicitly."
}
```

### Execution Timeline
```
T=0s   Start Codex + Spawn Agent 1 + Agent 2 + Agent 3 (all in ONE message)
T=0-60s All 4 reviewers working simultaneously
T=60s  First poll of Codex. Agents may finish before or after Codex.
T=?    All complete → proceed to Merge
```

## 3) Poll Codex + Collect Agent Results

### Poll Codex
```bash
POLL_OUTPUT=$(node "$RUNNER" poll "$STATE_DIR")
```

Adaptive intervals:

**Round 1:**
- Poll 1: wait 60s
- Poll 2: wait 60s
- Poll 3: wait 30s
- Poll 4+: wait 15s

**Round 2+ (debate):**
- Poll 1: wait 30s
- Poll 2+: wait 15s

Parse poll output for user reporting:
- `Codex thinking: "topic"` → Report: "Codex analyzing: {topic}"
- `Codex running: ...git diff...` → Report: "Codex reading repo diffs"
- `Codex running: ...cat src/foo.ts...` → Report: "Codex reading `src/foo.ts`"

**Report template:** "Codex [{elapsed}s]: {specific activity}"

Continue while `POLL:running`. Stop on `completed|failed|timeout|stalled`.

### Collect Agent Results
After Codex completes (or during polling if agents finish first), read results from all 3 background agents. Each agent returns its FINDING-{N} blocks.

**If an agent fails**: log the error, continue with remaining agents' findings. Partial coverage is better than no coverage.

## 4) Merge Findings

After all reviewers complete:

### 4a) Deduplicate Claude Findings
Across the 3 agents, some findings may overlap (e.g., Agent 1 flags a null check, Agent 3 flags same code as poor error handling). Deduplicate:
- Same file + overlapping line range → keep the higher-severity one
- Renumber all Claude findings sequentially: FINDING-1, FINDING-2, ...

### 4b) Cross-match Claude vs Codex
1. Parse Codex `review.txt` for `ISSUE-{N}` blocks.
2. Match using heuristic:
   - **Same file + overlapping location + same category** → `agreed`
   - **Same file + same category + different location** → check if same root cause → `agreed` or `unique`
   - **No match in other set** → `claude-only` or `codex-only`
   - **Same file + same location + contradictory assessment** → `contradiction`
3. Prefer false-negatives over false-positives (mark as unique if unsure).
4. Parse `THREAD_ID` from poll stdout for debate rounds.

### 4c) Present Merge Summary
```
## Merge Results
| Source | Findings |
|--------|----------|
| Claude (3 agents, deduplicated) | {N} |
| Codex | {M} |
| **Agreed** | {A} |
| **Claude-only** | {C} |
| **Codex-only** | {X} |
| **Contradictions** | {D} |
```

## 5) Apply Agreed + Debate Disagreements

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

## 6) Final Report

```
## Parallel Review Report

### Review Stats
| Metric | Value |
|--------|-------|
| Reviewers | 4 (3 Claude agents + Codex) |
| Claude findings (deduplicated) | {N} |
| Codex findings | {M} |
| Agreed | {A} |
| Resolved via debate | {R} |
| Unresolved | {U} |
| Debate rounds | {D}/{MAX_ROUNDS} |
| Verdict | CONSENSUS / PARTIAL / STALEMATE |

### Consensus Issues (both AI systems agree)
{list with fixes applied, grouped by severity}

### Resolved Disagreements
{list with resolution: who conceded, why, what changed}

### Unresolved Disagreements
| # | Finding | Claude's Position | Codex's Position | Recommendation |
|---|---------|-------------------|-------------------|----------------|
{table — present both sides, recommend action}

### Risk Assessment
{residual risk from unresolved items}
```

## 7) Cleanup

```bash
node "$RUNNER" stop "$STATE_DIR"
```
Always run regardless of outcome (success, failure, timeout, stalemate).

## Error Handling

### Codex Runner Errors
Runner `poll` returns `POLL:<status>:<elapsed>[:exit_code:details]`:
- `POLL:completed:...` → success, read `review.txt`.
- `POLL:failed:...:3:...` → turn failed. Retry once. If still fails, report error.
- `POLL:timeout:...:2:...` → timeout. Use partial results if `review.txt` exists.
- `POLL:stalled:...:4:...` → stalled. Use partial results.

Runner `start` exit codes:
- 1 → generic error. Report message.
- 5 → Codex CLI not found. Tell user to install.

### Claude Agent Errors
- Agent fails to return → log error, exclude from merge, note in report.
- Agent returns no findings → valid result (clean code for that category).
- All 3 agents fail → fall back to inline Claude review (single-reviewer mode).

### Fallback Mode
If Codex fails AND all agents fail: Claude performs inline review covering all 5 categories, produces FINDING-{N} blocks, presents results without debate.

Always run cleanup (step 7) regardless of error.

## Stalemate Handling

When stalemate detected (same unresolved points for 2 consecutive rounds):
1. List specific deadlocked points.
2. Show each side's final argument.
3. Recommend which side to favor based on evidence strength.
4. Ask user: accept current state or force one more round.
