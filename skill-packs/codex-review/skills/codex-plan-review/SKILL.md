---
name: codex-plan-review
description: Review/debate plans before implementation between Claude Code and Codex CLI.
---

# Codex Plan Review

## Purpose
Use this skill to adversarially review a plan before implementation starts.

## When to Use
After creating a plan but before implementing code. Reviews plan quality — not a substitute for `/codex-impl-review` code review. Typical flow: plan → `/codex-plan-review` → refine → implement.

## Prerequisites
- A Markdown plan file exists (e.g. `plan.md`) with headings for sections, steps, or phases.

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

**Plan-path detection:**
```bash
PLAN_ROOT=$(ls plan.md PLAN.md 2>/dev/null)
PLAN_DOCS=$(find ./docs -maxdepth 3 -name "*plan*.md" 2>/dev/null | head -5)
ALL="$([ -n "$PLAN_ROOT" ] && echo "$PLAN_ROOT")
$PLAN_DOCS"
COUNT=$(echo "$ALL" | grep -v '^$' | wc -l)
if [ "$COUNT" -eq 1 ]; then PLAN_PATH=$(echo "$ALL" | grep -v '^$')
elif [ "$COUNT" -gt 1 ]; then echo "Multiple plan files found: $ALL"  # ask user
else PLAN_PATH=""  # ask user for path
fi
```

**Effort**: Default `high` for plan review.

Announce: `"Detected: plan=$PLAN_PATH, effort=high. Proceeding — reply to override."` Block only if plan file cannot be found.

**Inputs**: plan file path (absolute, `.md`), user request (default "Review this plan for quality and completeness"), session context (constraints, assumptions, tech stack), acceptance criteria (user-provided or derived from plan), effort level.

### 2. Pre-flight Checks
1. Read plan file and verify it is Markdown: must have `.md` extension AND contain at least one heading (`#`). Fail-fast if unreadable.
2. If acceptance criteria not provided, derive from plan: scan for headings like "Goals", "Outcomes", "Success criteria" and extract content.

### 3. Init Session
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-plan-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`.

### 4. Render Prompt
```bash
PROMPT=$(node "$RUNNER" render --skill codex-plan-review --template round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"PLAN_PATH":$(json_esc "$PLAN_PATH"),"USER_REQUEST":$(json_esc "$USER_REQUEST"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"ACCEPTANCE_CRITERIA":$(json_esc "$ACCEPTANCE_CRITERIA")}
RENDER_EOF
)
```

**Placeholder values**: `PLAN_PATH` = absolute path to plan file; `USER_REQUEST` = user's task description; `SESSION_CONTEXT` = structured context block; `ACCEPTANCE_CRITERIA` = derived or user-provided criteria.

### 5. Start Round 1
```bash
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON: `{"status":"started","round":1}`. Error with `CODEX_NOT_FOUND` → tell user to install codex.

### 5.5. Information Barrier — Claude Independent Plan Analysis

**MUST complete before polling Codex output.** Codex is running in background — use this time productively.

Read the plan file at `$PLAN_PATH` directly. Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

Form an independent FINDING-{N} list in working context (do NOT write to a file):
- Correctness issues (steps that are wrong or will fail)
- Architecture concerns (structural problems with the approach)
- Sequencing/dependency problems (steps out of order, missing prerequisites)
- Scope gaps or risks (missing requirements, underestimated complexity)

Use the same FINDING-{N} format as `references/output-format.md` ISSUE-{N} (same field names).

**INFORMATION BARRIER ends after Round 1 poll completes.** From Round 2 onwards, the barrier no longer applies.

### 6. Poll
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Poll intervals**: Round 1: 60s, 60s, 30s, 15s+. Round 2+: 30s, 15s+.

Report **specific activities** from `activities` array (e.g. "Codex [45s]: reading plan.md, analyzing section 3 structure"). NEVER report generic "Codex is running".

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
- **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same plan problem
- **Codex-only**: ISSUE-{M} has no matching Claude FINDING
- **Claude-only**: FINDING-{N} has no matching Codex ISSUE
- **Genuine Disagreement**: Conflicting assessments of the same plan section

#### 7c. Determine Response for Each ISSUE
For each ISSUE-{N}:
- Genuine agreement or Codex-only → apply fix to the plan file
- Claude-only → include in final report as Claude finding
- Genuine disagreement → write rebuttal with concrete reasoning

#### 7d. Apply Fixes
- **Valid issues**: apply fixes directly to the plan file, **save the plan file** before resuming — Codex re-reads from the plan path.
- **Invalid issues**: rebut with concrete proof (reasoning, references, behavior).

### 8. Render Rebuttal + Resume
```bash
PROMPT=$(node "$RUNNER" render --skill codex-plan-review --template rebuttal --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"PLAN_PATH":$(json_esc "$PLAN_PATH"),"SESSION_CONTEXT":$(json_esc "$SESSION_CONTEXT"),"FIXED_ITEMS":$(json_esc "$FIXED_ITEMS"),"DISPUTED_ITEMS":$(json_esc "$DISPUTED_ITEMS")}
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

Present: accepted issues and plan edits made, disputed issues with reasoning from both sides, residual risks and unresolved assumptions, recommended next steps before implementation, final plan path.

### 11. Finalize + Cleanup
```bash
node "$RUNNER" finalize "$SESSION_DIR" <<'FINALIZE_EOF'
{"verdict":"..."}
FINALIZE_EOF
```
Optionally include `"issues":{"total_found":N,"total_fixed":N,"total_disputed":N}`. Report `$SESSION_DIR` path.

```bash
node "$RUNNER" stop "$SESSION_DIR"
```
**Always run cleanup**, even on failure/timeout.

**Errors**: Poll `failed` → retry once; `timeout`/`stalled` → report partial results from `review.raw_markdown`, suggest lower effort; `error` → report to user. Start/resume `error` with `CODEX_NOT_FOUND` → tell user to install codex. Always run cleanup.

## Rules
- If Claude Code plan mode is active, stay in plan mode during the debate. Otherwise, operate normally.
- Do not implement code in this skill.
- Do not claim consensus without explicit `VERDICT: APPROVE` or user-accepted stalemate.
- Preserve traceability: each accepted issue maps to a concrete plan edit.
- **Runner manages all session state** — do NOT manually read/write `rounds.json`, `meta.json`, or `prompt.txt` in the session directory.
