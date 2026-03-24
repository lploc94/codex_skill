---
name: codex-parallel-review
description: Parallel independent review by both Claude (4 agents) and Codex, followed by merge, debate on disagreements, and consensus report. No external plugins required.
---

# Codex Parallel Review

## Purpose
5 reviewers analyze the same codebase simultaneously: 4 Claude Code agents (via native Agent tool) + 1 Codex subprocess. Findings are merged, disagreements debated, consensus reported.

## When to Use
When you want independent dual-reviewer analysis. Produces higher-confidence findings than single-reviewer skills because findings are cross-validated between Claude agents and Codex before being reported.

## Prerequisites
- **Full-codebase mode** (default): repository has source files to review.
- **Working-tree mode**: working tree has staged or unstaged changes.
- **Branch mode**: current branch differs from base branch.
- **No external plugins required** — Agent tool is built into Claude Code.

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }
```

## Stdin Format Rules
- **JSON** → `render`/`finalize`: heredoc. Literal-only → `<<'RENDER_EOF'`. Dynamic vars → escape with `json_esc`, use `<<RENDER_EOF` (unquoted).
- **json_esc output includes quotes** → embed directly: `{"KEY":$(json_esc "$VAL")}`.
- **Plain text** → `start`/`resume`: `printf '%s' "$PROMPT" | node "$RUNNER" ...` — NEVER `echo`.
- **NEVER** `echo '{...}'` for JSON. Forbidden: NULL bytes (`\x00`).

## Workflow

### 1. Collect Inputs
Auto-detect mode and effort, announce defaults before asking anything.

**Mode**: `full-codebase` (default), `working-tree`, or `branch`. Ask user for max debate rounds (default `MAX_ROUNDS=3`).

**Effort detection per mode:**
- `full-codebase`: count source files (`find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o ... \) | grep -v node_modules | wc -l`) — <50 → `medium`, 50–200 → `high`, >200 → `xhigh`.
- `working-tree`/`branch`: `git diff --name-only | wc -l` — <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high`.

Announce: `"Detected: mode=$MODE, effort=$EFFORT (N files). Proceeding — reply to override."` Set `EFFORT`, `MAX_ROUNDS`.

**Prepare context per mode:**
- **Full-codebase**: `FILES=$(find . ...)` — list all source files. No DIFF needed.
- **Working-tree**: `DIFF=$(git diff && git diff --cached)`, `FILES=$(git diff --name-only)`.
- **Branch**: base branch discovery (ask user, fallback `main`→`master`→remote HEAD, validate with `git rev-parse --verify`). Bind: `BASE=<validated value>`. Clean working tree required. `DIFF=$(git diff $BASE...HEAD)`, `FILES=$(git diff --name-only $BASE...HEAD)`.

### 2. Launch All 5 Reviewers (ONE message — true parallelism)

**CRITICAL**: Steps 2a and 2b MUST execute in the SAME message.

**2a) Init + Start Codex:**
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-parallel-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`.

Render prompt — select template by mode:

**Full-codebase** (template `full-round1`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-parallel-review --template full-round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT")}
RENDER_EOF
)
```

**Working-tree** (template `working-tree-round1`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-parallel-review --template working-tree-round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT")}
RENDER_EOF
)
```

**Branch** (template `branch-round1`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-parallel-review --template branch-round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"BASE_BRANCH":$(json_esc "$BASE")}
RENDER_EOF
)
```

```bash
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON: `{"status":"started","round":1}`. Error with `CODEX_NOT_FOUND` → tell user to install codex.

**2b) Spawn 4 Claude Reviewer Agents** (all in same message as 2a):

**Agent 1 — Correctness & Edge Cases:**
```json
{
  "subagent_type": "code-reviewer",
  "description": "Review correctness and edge cases",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately — you will NOT see their findings. Be thorough.\n\nWorking directory: {WORKING_DIR}\nMode: {MODE}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on:\n1. Correctness: logic errors, wrong return values, missing null checks, incorrect conditions, type mismatches, off-by-one\n2. Edge cases: boundary conditions, empty inputs, overflow, concurrent access, race conditions\n\nFor each issue: ### FINDING-{N}: {title} with Category, Severity, File, Location, Problem, Suggested fix.\n{DIFF_OR_EMPTY}"
}
```

**Agent 2 — Security (DEEP):**
```json
{
  "subagent_type": "code-reviewer",
  "description": "Deep security review (OWASP Top 10)",
  "run_in_background": true,
  "prompt": "You are an independent SECURITY-FOCUSED code reviewer. Another AI (Codex) is reviewing the same code separately.\n\nWorking directory: {WORKING_DIR}\nMode: {MODE}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on Security — ALL of: OWASP Top 10 2021 (A01–A10), Secrets & Credentials, Configuration Security, Cryptography, Input & File Handling, Dependency Security, Rate Limiting & DoS, Auth Flow & Session.\n\nFor each finding: ### FINDING-{N}: {title} with Category: security, Subcategory, Severity, Confidence, CWE, OWASP, File, Location, Problem, Attack Vector, Suggested fix.\n{DIFF_OR_EMPTY}"
}
```

**Agent 3 — Performance:**
```json
{
  "subagent_type": "code-reviewer",
  "description": "Review performance issues",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately.\n\nWorking directory: {WORKING_DIR}\nMode: {MODE}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on Performance: algorithmic (O(n²)+), memory (leaks, unnecessary allocs), I/O (blocking, missing pooling), database (N+1, missing indexes), caching, bundle/load.\n\nFor each issue: ### FINDING-{N}: {title} with Category: performance, Subcategory, Severity, File, Location, Problem, Impact, Suggested fix.\n{DIFF_OR_EMPTY}"
}
```

**Agent 4 — Maintainability & Architecture:**
```json
{
  "subagent_type": "code-reviewer",
  "description": "Review maintainability and architecture",
  "run_in_background": true,
  "prompt": "You are an independent code reviewer. Another AI (Codex) is reviewing the same code separately.\n\nWorking directory: {WORKING_DIR}\nMode: {MODE}\nFiles to review: {FILE_LIST}\n\nFocus ONLY on: Maintainability (naming, DRY, error handling, complexity, dead code) and Architecture (separation of concerns, module boundaries, API consistency, coupling).\n\nFor each issue: ### FINDING-{N}: {title} with Category, Severity, File, Location, Problem, Suggested fix.\n{DIFF_OR_EMPTY}"
}
```

**Execution**: T=0s all 5 start simultaneously. Agents may finish before or after Codex. All complete → proceed to Merge.

### 3. Poll Codex + Collect Agent Results
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Poll intervals**: Round 1: 60s, 60s, 30s, 15s+. Round 2+: 30s, 15s+.

Report **specific activities** from `activities` array. NEVER report generic "Codex is running". Continue while `status === "running"`. Stop on `completed|failed|timeout|stalled`.

**Note**: `status === "completed"` means Codex finished its turn — it does NOT mean the debate is over. After `completed`, check the Loop Decision table to determine whether to continue or exit.

Collect results from all 4 background agents as they finish. **If an agent fails**: log error, continue with remaining agents' findings. Partial coverage is better than no coverage.

### 4. Merge Findings

**4a) Deduplicate Claude findings** across 4 agents — same file + overlapping line range → keep higher severity. Renumber: FINDING-1, FINDING-2, ...

**4b) Cross-match Claude vs Codex** — parse `review.blocks[]` for `ISSUE-{N}` blocks (fallback: `review.raw_markdown`). Heuristic: same file + overlapping location + same category → `agreed`; same file + same category + different location → check root cause; no match → `claude-only`/`codex-only`; same file + same location + contradictory → `contradiction`. Prefer false-negatives over false-positives.

**4c) Present Merge Summary:**
| Source | Findings |
|--------|----------|
| Claude (4 agents, deduplicated) | {N} |
| Codex | {M} |
| **Agreed** | {A} |
| **Claude-only** | {C} |
| **Codex-only** | {X} |
| **Contradictions** | {D} |

### 5. Apply Agreed + Debate

Apply agreed issues immediately. Record fix evidence. **Branch mode**: commit fixes before debate (`git add` + `git commit`).

**Debate loop** (max `MAX_ROUNDS` rounds):

Render debate prompt:
```bash
PROMPT=$(node "$RUNNER" render --skill codex-parallel-review --template debate --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"CODEX_ONLY_WITH_REBUTTALS":$(json_esc "$CODEX_ONLY_WITH_REBUTTALS"),"CLAUDE_ONLY_FINDINGS":$(json_esc "$CLAUDE_ONLY_FINDINGS"),"CONTRADICTIONS":$(json_esc "$CONTRADICTIONS")}
RENDER_EOF
)
printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON. **Go back to step 3 (Poll).** Parse `RESPONSE-{N}` blocks: `accept` → resolved, apply fix; `reject` with new evidence → reconsider; `revise` → evaluate modified position. Track per-finding resolution. Remove resolved items from next round. **Branch mode**: commit fixes before each resume.

### Loop Decision (after each poll returns `status === "completed"`)

`status === "completed"` means **Codex's turn is done** — NOT that the debate is over. Check IN ORDER:

| # | Condition | Action |
|---|-----------|--------|
| 1 | All disputed/claude-only/codex-only findings resolved | **EXIT loop** → Final Report |
| 2 | `poll_json.convergence.stalemate === true` | **EXIT loop** → Final Report (stalemate branch) |
| 3 | Current round >= `MAX_ROUNDS` | **EXIT loop** → Final Report (round cap) |
| 4 | Unresolved findings remain | **CONTINUE** → render debate prompt + resume |

**CRITICAL**: Do NOT exit the loop unless condition 1, 2, or 3 is met.

Exit: all resolved, round limit (`MAX_ROUNDS`), or `convergence.stalemate === true`.

### 6. Final Report

| Metric | Value |
|--------|-------|
| Reviewers | 5 (4 Claude agents + Codex) |
| Claude findings (deduplicated) | {N} |
| Codex findings | {M} |
| Agreed | {A} |
| Resolved via debate | {R} |
| Unresolved | {U} |
| Debate rounds | {D}/{MAX_ROUNDS} |
| Verdict | CONSENSUS / PARTIAL / STALEMATE |

Present: Consensus Issues (grouped by severity with fixes), Resolved Disagreements (who conceded, why), Unresolved Disagreements table (both sides + recommendation), Risk Assessment (residual risk from unresolved items).

### 7. Finalize + Cleanup
```bash
node "$RUNNER" finalize "$SESSION_DIR" <<'FINALIZE_EOF'
{"verdict":"...","scope":"..."}
FINALIZE_EOF
```
Scope per mode: `full-codebase`, `working-tree`, or `branch`. Optionally include `"issues":{"total_found":N,"total_fixed":N,"total_disputed":N}`. Report `$SESSION_DIR` path.

```bash
node "$RUNNER" stop "$SESSION_DIR"
```
**Always run cleanup**, even on failure/timeout.

**Errors**:
- `failed` → retry once (re-poll after 15s).
- `timeout` → report partial results from `review.raw_markdown`, suggest lower effort. Run cleanup.
- `stalled` → if `recoverable === true`: `stop` → prepend recovery note → `resume --recovery` → poll (30s, 15s+). If `recoverable === false`: report partial results, suggest lower effort. Run cleanup.
- Start/resume `CODEX_NOT_FOUND` → tell user to install codex.
- **Cleanup sequencing**: run `finalize` + `stop` ONLY after recovery resolves (success or second failure). Do NOT finalize before recovery attempt.

## Rules
- All 4 Claude agents and Codex review independently — no cross-contamination before merge.
- Codex reviews only; it does not edit files.
- Claude applies fixes for agreed and accepted issues.
- Max debate rounds enforced (default 3); user can override.
- On stalemate, present both sides and defer to user.
- If agents or Codex fail, degrade gracefully (partial coverage).
- **Runner manages all session state** — do NOT manually read/write `rounds.json`, `meta.json`, or `prompt.txt` in the session directory.
