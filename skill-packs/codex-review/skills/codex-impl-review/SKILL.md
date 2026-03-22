---
name: codex-impl-review
description: Have Codex CLI review uncommitted code changes or branch diff against a base branch. Claude applies valid fixes, rebuts invalid points, and iterates until consensus or user-approved stalemate.
---

# Codex Implementation Review

## Purpose
Use this skill to run adversarial review on uncommitted changes before commit, or on branch changes before merge.

## When to Use
After writing code, before committing. Use for uncommitted working-tree changes or comparing a branch against base. For security-sensitive code, run `/codex-security-review` alongside this.

## Prerequisites
- **Working-tree mode** (default): working tree has staged or unstaged changes.
- **Branch mode**: current branch differs from base branch (has commits not in base).

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
Auto-detect context and announce defaults before asking anything.

**Scope detection (FIRST):**
```bash
HAS_WORKING_CHANGES=$(git status --short 2>/dev/null | grep -v '^??' | wc -l)
HAS_BRANCH_COMMITS=$(git rev-list @{u}..HEAD 2>/dev/null | wc -l)
if [ "$HAS_WORKING_CHANGES" -gt 0 ]; then SCOPE="working-tree"
elif [ "$HAS_BRANCH_COMMITS" -gt 0 ]; then SCOPE="branch"
else SCOPE=""  # ask user
fi
```

**Effort detection (adapts to scope):**
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
EFFORT=${EFFORT:-high}
```

Announce: `"Detected: scope=$SCOPE, effort=$EFFORT (N files changed). Proceeding — reply to override."` Only block if both detection methods return 0.

**Working-tree mode inputs**: working dir path, user request, uncommitted changes (`git status`, `git diff`, `git diff --cached`), optional plan file.

**Branch mode inputs**:
- Base branch: ask user, fallback `main` → `master` → remote HEAD. Validate: `git rev-parse --verify <base>`.
- Clean working tree required: `git diff --quiet && git diff --cached --quiet`. If dirty → commit/stash or switch to working-tree mode.
- Stale base warning: recommend `git fetch origin <base>` if base is local-only.
- Branch diff: `git diff <base>...HEAD`, commit log: `git log <base>..HEAD --oneline`.

### 2. Pre-flight Checks
- **Working-tree**: `git diff --quiet && git diff --cached --quiet` must FAIL (exit 1). If both succeed → no changes, stop.
- **Branch**: `git diff <base>...HEAD --quiet` must FAIL. If no diff → stop.

### 3. Init Session
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-impl-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`.

### 4. Render Prompt

**Working-tree mode** (template `working-tree-round1`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-impl-review --template working-tree-round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT")}
RENDER_EOF
)
```

**Branch mode** (template `branch-round1`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-impl-review --template branch-round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"BASE_BRANCH":$(json_esc "$BASE_BRANCH")}
RENDER_EOF
)
```

**Placeholder values**: `USER_REQUEST` = user's task description (default "Review uncommitted changes for correctness and quality"); `SESSION_CONTEXT` = structured context block; `BASE_BRANCH` = validated base branch (branch mode only).

### 5. Start Round 1
```bash
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON: `{"status":"started","round":1}`. Error with `CODEX_NOT_FOUND` → tell user to install codex.

### 5.5. Information Barrier — Claude Independent Code Analysis

**MUST complete before polling Codex output.** Codex is running in background — use this time productively.

**Working-tree mode**: run `git diff` and `git diff --cached` yourself (or reuse the diff already collected in Step 1 — working tree hasn't changed).

**Branch mode**: run `git diff $BASE_BRANCH...HEAD` yourself (or reuse the diff already collected in Step 1).

Form an independent FINDING-{N} list in working context (do NOT write to a file):
- Bugs and edge cases
- Security issues
- Performance concerns
- Maintainability problems

Use the same FINDING-{N} format as `references/output-format.md` ISSUE-{N} (same field names). Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

**INFORMATION BARRIER ends after Round 1 poll completes.** From Round 2 onwards, the barrier no longer applies.

### 6. Poll
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Poll intervals**: Round 1: 60s, 60s, 30s, 15s+. Round 2+: 30s, 15s+.

Report **specific activities** from `activities` array (e.g. "Codex [45s]: reading src/auth.js, analyzing auth flow"). NEVER report generic "Codex is running".

Continue while `status === "running"`. Stop on `completed|failed|timeout|stalled`.

### 7. Apply/Rebut

**After Round 1 poll completes and `$SESSION_DIR/review.md` is available:**

#### 7a. Parse Codex Output
Parse issues from `poll_json.review.blocks[]` — each has `id`, `title`, `severity`, `category`, `location`, `problem`, `evidence`, `suggested_fix`. Verdict in `review.verdict.status`. Fallback: `review.raw_markdown`.

#### 7b. Build FINDING↔ISSUE Mapping Table
Map Claude's FINDING-{N} (from Step 5.5) against Codex's ISSUE-{M}:

| Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
|--------------------|-----------------|----------------|
| ...                | ...             | ...            |

Classification options:
- **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same code problem
- **Codex-only**: ISSUE-{M} has no matching Claude FINDING
- **Claude-only**: FINDING-{N} has no matching Codex ISSUE
- **Genuine Disagreement**: Conflicting assessments of the same code

#### 7c. Apply/Rebut Using Cross-Analysis Context
For each ISSUE-{N}:
- Genuine agreement or Codex-only → apply fix to code
- Claude-only → include in final report as Claude finding
- Genuine disagreement → write rebuttal with concrete proof (paths, tests, behavior)

#### 7d. Apply Fixes
- **Valid issues**: edit code, record fix evidence.
- **Invalid issues**: rebut with concrete proof (paths, tests, behavior).
- **Branch mode only**: commit fixes (`git add` + `git commit`) before resuming — Codex reads `git diff <base>...HEAD` which only shows committed changes.
- **Verify fixes**: run relevant tests, typecheck, or document manual evidence. Never claim fixed without verification.

### 8. Render Rebuttal + Resume

**Working-tree** (template `rebuttal-working-tree`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-impl-review --template rebuttal-working-tree --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"FIXED_ITEMS":$(json_esc "$FIXED_ITEMS"),"DISPUTED_ITEMS":$(json_esc "$DISPUTED_ITEMS")}
RENDER_EOF
)
```

**Branch** (template `rebuttal-branch`):
```bash
PROMPT=$(node "$RUNNER" render --skill codex-impl-review --template rebuttal-branch --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"FIXED_ITEMS":$(json_esc "$FIXED_ITEMS"),"DISPUTED_ITEMS":$(json_esc "$DISPUTED_ITEMS"),"BASE_BRANCH":$(json_esc "$BASE_BRANCH")}
RENDER_EOF
)
```

Resume: `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"` → validate JSON. **Go back to step 6 (Poll).** Repeat 6→7→8 until APPROVE, stalemate, or 5 rounds.

### 9. Completion + Stalemate
- `review.verdict.status === "APPROVE"` → done.
- `poll_json.convergence.stalemate === true` → present deadlocked issues (from `convergence.unchanged_issue_ids`) with both sides' arguments. Round < 5 → ask user; round 5 → force final synthesis.
- **Hard cap: 5 rounds.** Force final synthesis with unresolved issues as residual risks.

### 10. Final Output

| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {CONSENSUS/CONTINUE/STALEMATE} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

Present: fixed defects by severity, disputed items with rationale, residual risks, recommended next steps.

### 11. Finalize + Cleanup
```bash
node "$RUNNER" finalize "$SESSION_DIR" <<'FINALIZE_EOF'
{"verdict":"...","scope":"..."}
FINALIZE_EOF
```
Optionally include `"issues":{"total_found":N,"total_fixed":N,"total_disputed":N}`. Report `$SESSION_DIR` path.

```bash
node "$RUNNER" stop "$SESSION_DIR"
```
**Always run cleanup**, even on failure/timeout.

**Errors**: Poll `failed` → retry once; `timeout`/`stalled` → report partial results from `review.raw_markdown`, suggest lower effort; `error` → report to user. Start/resume `error` with `CODEX_NOT_FOUND` → tell user to install codex. Always run cleanup.

## Rules
- If invoked during Claude Code plan mode, exit plan mode first — this skill requires code editing.
- Codex reviews only; it does not edit files.
- Preserve functional intent unless fix requires behavior change.
- Every accepted issue must map to a concrete code diff.
- If stalemate persists, present both sides and defer to user.
- **Runner manages all session state** — do NOT manually read/write `rounds.json`, `meta.json`, or `prompt.txt` in the session directory.
