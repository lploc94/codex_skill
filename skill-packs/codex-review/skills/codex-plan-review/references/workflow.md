# Plan Review Workflow

## Smart Default Detection

**plan-path detection** (matches spec: `plan.md`, `PLAN.md`, `docs/*plan*.md` only):
```bash
# Check exact names at CWD root level (collect all matches, not just first)
PLAN_ROOT=$(ls plan.md PLAN.md 2>/dev/null)
# Check docs/ subdirectory for any *plan*.md file (depth 3 to reach docs/sub/sub/)
PLAN_DOCS=$(find ./docs -maxdepth 3 -name "*plan*.md" 2>/dev/null | head -5)

# Count total candidates
ALL="$([ -n "$PLAN_ROOT" ] && echo "$PLAN_ROOT")
$PLAN_DOCS"
COUNT=$(echo "$ALL" | grep -v '^$' | wc -l)

if [ "$COUNT" -eq 1 ]; then
  PLAN_PATH=$(echo "$ALL" | grep -v '^$')
elif [ "$COUNT" -gt 1 ]; then
  echo "Multiple plan files found: $ALL"
  # Ask user: "Which plan file should I use?"
  PLAN_PATH="<user-chosen>"  # ← set after user selects
else
  # Ask user for path
  PLAN_PATH=""
fi
```

> **Scope:** Only searches `plan.md`/`PLAN.md` at CWD root, and `docs/` up to 3 levels deep (e.g. `docs/superpowers/plans/*.md`). Restricts to `.md` files to avoid false positives. Does NOT do full recursive search.

**effort detection:** Default `high` for plan review.

Announce: `"Detected: plan=docs/superpowers/plans/2026-03-18-example.md, effort=high. Proceeding — reply to override."`

---

## 1) Gather Inputs
- Plan file path (absolute). Must be a Markdown file.
- User request text (or default: "Review this plan for quality and completeness").
- Session context: constraints, assumptions, tech stack.
- Acceptance criteria (user-provided or derived from plan).
- Debate effort level (`low|medium|high|xhigh`).

## 1.5) Pre-flight Checks

Before starting Round 1:
1. Read the plan file and verify it is Markdown: must have `.md` extension AND contain at least one markdown heading (`#`). Reading the file here ensures fail-fast if the path is unreadable.
2. If acceptance criteria not provided by user, derive from plan: scan for headings like "Goals", "Outcomes", "Success criteria", "Expected results" and extract content.

> **Write failures**: If saving the updated plan file fails in step 4/7, report the error and ask user for an alternative writable path. No pre-flight write check is needed — Claude Code's write tool provides a clear error at save time.

## 1.8) Prompt Assembly

1. Read the Round 1 template from `references/prompts.md`.
2. Replace `{PLAN_PATH}` with the absolute path to the plan file.
3. Replace `{USER_REQUEST}` with user's task description (or default).
4. Build `{SESSION_CONTEXT}` using the structured schema from `references/prompts.md` Placeholder Injection Guide.
5. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md` (the single block after "Use this exact shape").
6. Replace `{ACCEPTANCE_CRITERIA}` with user-provided criteria or derived criteria from step 1.5.

## 2) Start Round 1
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-plan-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}

START_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT")
```

**Validate init output:** Verify `INIT_OUTPUT` starts with `CODEX_SESSION:`. If not, report error.
**Validate start output:** Verify `START_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

## 2.5) Information Barrier — Claude Independent Plan Analysis

MUST complete before polling Codex output.
Codex is running in background — use this time productively.

Read the plan file at `$PLAN_PATH` directly.
Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

Form an independent FINDING-{N} list in working context (do NOT write to a file):
- Correctness issues (steps that are wrong or will fail)
- Architecture concerns (structural problems with the approach)
- Sequencing/dependency problems (steps out of order, missing prerequisites)
- Scope gaps or risks (missing requirements, underestimated complexity)

Use the same FINDING-{N} format as `output-format.md` ISSUE-{N} (same field names).

INFORMATION BARRIER ends after Round 1 poll completes.
From Round 2 onwards, the barrier no longer applies.

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

## 4) Cross-Analysis

After Round 1 poll completes and `$SESSION_DIR/review.md` is available:

### 4a) Parse Codex Output
Read all `ISSUE-{N}` blocks from `$SESSION_DIR/review.md`.

### 4b) Build FINDING↔ISSUE Mapping Table
Map Claude's FINDING-{N} (from Step 2.5) against Codex's ISSUE-{N}:

| Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
|--------------------|-----------------|----------------|
| ...                | ...             | ...            |

Classification options:
- **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same plan problem
- **Codex-only**: ISSUE-{M} has no matching Claude FINDING
- **Claude-only**: FINDING-{N} has no matching Codex ISSUE
- **Genuine Disagreement**: Conflicting assessments of the same plan section

### 4c) Determine Response for Each ISSUE
For each ISSUE-{N}:
- Genuine agreement or Codex-only → apply fix to the plan file
- Claude-only → include in final report as Claude finding
- Genuine disagreement → write rebuttal with concrete reasoning

### 4d) Apply Fixes
Apply accepted fixes to the plan file at `$PLAN_PATH`.
Save the updated plan file before resuming.
**Critical**: Codex Round 2+ re-reads the plan from `$PLAN_PATH` — unsaved changes are invisible to Codex.

### 4e) Record Round Summary
Append to `$SESSION_DIR/rounds.json`:
```json
{ "round": N, "elapsed_seconds": ..., "verdict": "...", "issues_found": ..., "issues_fixed": ..., "issues_disputed": ... }
```

Proceed to Step 5 (resume) or Step 7 (final output) based on VERDICT.

## 5) Resume (Round 2+)

Build the rebuttal prompt from `references/prompts.md` (Rebuttal Prompt template). Replace all placeholders including `{PLAN_PATH}` so Codex re-reads the updated plan.

```bash
START_OUTPUT=$(printf '%s' "$REBUTTAL_PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT")
```

Then **go back to step 3 (Poll).** After poll completes, repeat step 4 (Parse) and check stop conditions below. If not met, resume again (step 5). Continue this loop until a stop condition is reached.

## 6) Stop Conditions
- `VERDICT: CONSENSUS`.
- Stalemate detected (see below).
- User stops debate.
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

## 7) Final Report

### Review Summary
| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {CONSENSUS/CONTINUE/STALEMATE} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

Then present:
- Accepted issues and plan edits made.
- Disputed issues with reasoning from both sides.
- Residual risks and unresolved assumptions.
- Recommended next steps before implementation.
- Final plan path.

## 8) Cleanup
```bash
node "$RUNNER" stop "$SESSION_DIR"
```
Kill any remaining Codex/watchdog processes. Always run this step, even if the debate ended due to failure or timeout.

## Session Finalization

After the final round completes, write session metadata to the session directory (review.md is already present from poll):

```bash
cat > "$SESSION_DIR/meta.json" << METAEOF
{
  "skill": "codex-plan-review",
  "version": 15,
  "effort": "$EFFORT",
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
