# PR Review Workflow

## Smart Default Detection

**base-branch detection:**
```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$BASE" ]; then
  # First-match semantics: remote refs preferred, then local
  if git show-ref --verify --quiet refs/remotes/origin/main; then BASE="main"
  elif git show-ref --verify --quiet refs/remotes/origin/master; then BASE="master"
  elif git show-ref --verify --quiet refs/heads/main; then BASE="main"
  elif git show-ref --verify --quiet refs/heads/master; then BASE="master"
  fi
fi
```

**effort detection** (after base is resolved):
```bash
FILES_CHANGED=$(git diff --name-only "$BASE"...HEAD 2>/dev/null | wc -l)
if [ "$FILES_CHANGED" -lt 10 ]; then EFFORT="medium"
elif [ "$FILES_CHANGED" -lt 50 ]; then EFFORT="high"
else EFFORT="xhigh"
fi
EFFORT=${EFFORT:-high}
```

Announce: `"Detected: base=main, effort=high (15 files changed). Proceeding — reply to override. PR title/description are optional."`

Block only if `$BASE` cannot be resolved (both auto-detection and fallback fail).

---

## 1) Collect Inputs
- **Base branch discovery:**
  1. Ask user for base branch, suggest default.
  2. Validate ref: `git rev-parse --verify <base>` — fail-fast if not found.
  3. Fallback order if user doesn't specify: remote HEAD (`git symbolic-ref refs/remotes/origin/HEAD`) → `origin/main` → `origin/master` → local `main` → local `master`.
  4. Confirm with user if using fallback.
- PR title and description (optional — user may not have written them yet).
- Branch diff: `git diff <base>...HEAD`.
- Commit log: `git log <base>..HEAD --oneline`.
- Commit list: `{COMMIT_LIST}` — formatted as `<SHA> <subject>` per commit.
- Commit count: `{COMMIT_COUNT}` — `git rev-list --count <base>..HEAD`.
- File stats: `git diff <base>...HEAD --stat`.
- Review effort level (`low|medium|high|xhigh`).

## 1.5) Pre-flight Checks
1. Verify inside a git repository: `git rev-parse --show-toplevel`. If not a git repo, abort.
2. Verify branch diff exists: `git diff <base>...HEAD --quiet` must FAIL (exit 1). If exit 0, there are no changes — abort with "no diff between current branch and base branch".
3. Verify commit history exists: `git rev-list --count <base>..HEAD` must be > 0. If 0, abort with "no commits ahead of base branch".

## 1.8) Prompt Assembly

1. Read the Round 1 template from `references/prompts.md` (PR Review Prompt).
2. Replace `{PR_TITLE}` with PR title (or "Not provided").
3. Replace `{PR_DESCRIPTION}` with PR description (or "Not provided").
4. Replace `{BASE_BRANCH}` with validated base branch.
5. Replace `{COMMIT_COUNT}` with number of commits.
6. Replace `{COMMIT_LIST}` with formatted list of SHA + subject for each commit.
7. Replace `{USER_REQUEST}` with user's task description (or default).
8. Replace `{SESSION_CONTEXT}` with structured context block (or "Not specified").
9. Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.
10. **Also assemble the Claude Independent Analysis Prompt** from `references/prompts.md`. Replace the same placeholders as above, plus `{CLAUDE_ANALYSIS_FORMAT}` with the fenced code block from `references/claude-analysis-template.md`.

## 2) Start Round 1

Set `ROUND=1`.

```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-pr-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}

START_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT")
```

**Validate init output:** Verify `INIT_OUTPUT` starts with `CODEX_SESSION:`. If not, report error.
**Validate start output:** Verify `START_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

**Do NOT poll yet. Proceed to Step 2.5.**

## 2.5) Claude Independent Analysis

**PURPOSE**: Claude evaluates the PR BEFORE seeing Codex output. This prevents anchoring bias and ensures genuine peer debate.

**INFORMATION BARRIER**: MUST NOT read `$SESSION_DIR/review.md` or any Codex output file.

**Instructions:**
1. Read the assembled Claude Independent Analysis Prompt (from Step 1.8).
2. Claude reads the diff, commits, and PR metadata:
   - Run `git diff <base>...HEAD` to read the branch diff.
   - Run `git log <base>..HEAD --oneline` to read commit history.
   - Run `git show <SHA>` for individual commits as needed.
   - Run `git diff <base>...HEAD --stat` for file stats.
   - Review PR title and description for accuracy.
3. Claude writes FINDING-{N} findings following the format in `references/claude-analysis-template.md`.
4. Claude writes Overall Assessment (Code quality, PR description accuracy, Commit hygiene, Scope appropriateness).
5. Claude writes Merge Readiness Pre-Assessment (Must-pass criteria status, Blocking issues, Initial recommendation).
6. Claude writes Strongest Positions (positions to defend in debate).
7. **CRITICAL**: This step MUST be COMPLETED before proceeding to Step 3. Do not read Codex output until after independent analysis is finalized.

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

**Round 2+ (response rounds):**
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

**On `POLL:completed`:**
1. Extract thread ID from poll output: look for `THREAD_ID:<id>` line.
2. Read Codex output: `cat "$SESSION_DIR/review.md"`.

## 4) Cross-Analysis

Claude and Codex are equal peers — no reviewer/implementer framing.

### 4a) Read Codex Output
- Parse `ISSUE-{N}` blocks, `Overall Assessment`, and `VERDICT` (`Status` + `Reason`) from Codex output using `references/output-format.md`.

### 4b) Compare Findings (Side-by-Side)

Map Claude's FINDING-{N} to Codex's ISSUE-{N} using the Matching Protocol in `references/claude-analysis-template.md`.

| Classification | Meaning |
|---------------|---------|
| **Genuine Agreement** | Both independently found the same issue |
| **Genuine Disagreement** | Opposing assessment (e.g., Claude thinks code is correct, Codex sees a bug) |
| **Claude-only Finding** | Claude found it, Codex did not |
| **Codex-only Finding** | Codex found it, Claude did not |
| **Same Direction, Different Severity** | Both found the issue but disagree on severity level |

### 4c) Build Response
1. **Agreements**: Merged findings with reference to the mapping table.
2. **Disagreements**: Claude's position + why Codex's position does or doesn't change Claude's assessment.
3. **New findings**: Claude-only findings + evaluation of Codex-only findings on their merits.
4. **Set status**: CONTINUE, CONSENSUS, or STALEMATE. **Claude orchestration is authoritative** — Codex VERDICT is advisory input. Claude considers Codex's suggested status but overrides if evidence warrants.

### 4d) Determine Next Action
- If CONSENSUS → proceed to Step 7 (Final Output).
- If STALEMATE → proceed to Step 7 (Final Output).
- If CONTINUE → proceed to Step 5 (Resume Round 2+).

After parsing each round's review, append round summary to `$SESSION_DIR/rounds.json`:
- Read existing rounds.json or start with empty array `[]`
- Append: `{ "round": N, "elapsed_seconds": ..., "verdict": "...", "issues_found": ..., "issues_fixed": ..., "issues_disputed": ... }`
- Write back to `$SESSION_DIR/rounds.json`

## 5) Resume Round 2+

Build Round 2+ prompt from `references/prompts.md` (Response Prompt):
- Replace `{SESSION_CONTEXT}` with the same structured context block from Round 1.
- Replace `{PR_TITLE}` with the same PR title from Round 1.
- Replace `{BASE_BRANCH}` with the same validated base branch from Round 1.
- Replace `{COMMIT_COUNT}` with the same commit count from Round 1.
- Replace `{COMMIT_LIST}` with the same formatted list of SHA + subject from Round 1.
- Replace `{AGREED_POINTS}` with merged findings both sides agree on.
- Replace `{DISAGREED_POINTS}` with current disagreements and both positions.
- Replace `{NEW_FINDINGS}` with Claude-only and Codex-only findings not yet resolved.
- Replace `{CONTINUE_OR_CONSENSUS_OR_STALEMATE}` with current debate status and reasoning.
- Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.

```bash
START_OUTPUT=$(printf '%s' "$RESPONSE_PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT")
```

**→ Go back to step 3 (Poll).** Increment `ROUND` counter. After poll completes, repeat step 4 (Cross-Analysis) and check stop conditions. If `ROUND >= 5`, force final output — do NOT resume. Otherwise, continue until a stop condition is reached.

## 6) Stop Conditions

### Consensus Definitions

Three levels of consensus (encoded via the `Reason` field — no additional status values):

- **Full Consensus**: No remaining disagreed findings — both agree on all findings AND Overall Assessment. Verdict = `CONSENSUS`, Reason = "Full consensus — no remaining disagreements".
- **Partial Consensus**: Overall Assessment matches but 1-2 minor disagreed findings remain (severity ≤ low). Verdict = `CONSENSUS`, Reason = "Partial — N minor disagreements remain (see Remaining Disagreements)". List remaining minor disagreements.
- **No Consensus**: Disagreed findings with severity ≥ medium remain. Must continue or declare stalemate.

### Stop Triggers
- Full or Partial Consensus reached.
- Stalemate detected: same disagreed FINDING↔ISSUE pairs for 2 consecutive rounds with no new evidence.
- Hard cap reached (5 rounds maximum). If hard cap is reached without consensus, verdict is forced to STALEMATE (Reason: "Hard cap reached — N disagreements remain").
- User explicitly stops. Map to STALEMATE with Reason: "Stopped by user at round N".

### Authority Rule
Claude orchestration is the authoritative source for stop/continue decisions. Codex VERDICT is advisory input — Claude considers it but may override if evidence warrants.

## 7) Final Output

Present a consensus report + merge readiness assessment — **NEVER edit code or create commits**.

### 7a) Review Summary
```markdown
### Review Summary
| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | CONSENSUS / STALEMATE |
| Claude Findings | {count} |
| Codex Issues | {count} |
| Agreed | {count} |
| Disagreed | {count} |
```

### 7b) FINDING↔ISSUE Mapping
```markdown
### FINDING↔ISSUE Mapping
| Claude FINDING | Codex ISSUE | Classification | Status |
|---------------|-------------|----------------|--------|
| FINDING-1     | ISSUE-2     | Agreement      | Agreed |
| FINDING-2     | —           | Claude-only    | Noted  |
| —             | ISSUE-1     | Codex-only     | Agreed |
```

### 7c) Consensus Points
```markdown
### Consensus Points
- FINDING-1/ISSUE-2: {description} — Both agree: {assessment}
- ...
```

### 7d) Remaining Disagreements
```markdown
### Remaining Disagreements
| Point | Claude | Codex |
|-------|--------|-------|
| {description} | {Claude's position} | {Codex's position} |
| ... | ... | ... |
```

### 7e) Overall Assessment
```markdown
### Overall Assessment
| Aspect | Claude | Codex | Consensus |
|--------|--------|-------|-----------|
| Code quality | good | fair | — |
| PR description accuracy | accurate | accurate | ✓ |
| Commit hygiene | clean | acceptable | — |
| Scope appropriateness | focused | focused | ✓ |
```

### 7f) Merge Readiness Scorecard

Derive scorecard from **agreed findings only**:

```markdown
### Merge Readiness Scorecard
| Criterion | Must-pass? | Claude | Codex | Consensus | Status |
|-----------|-----------|--------|-------|-----------|--------|
| Code correctness (bug) | ✅ Yes | pass | pass | pass | ✅ |
| Edge case handling | ⚠️ If high+ | pass | concern | pass | ✅ |
| Security | ✅ Yes | pass | pass | pass | ✅ |
| Performance | ❌ Unless critical | pass | pass | pass | ✅ |
| Maintainability | ❌ No | concern | pass | concern | ℹ️ |
| PR description | ❌ No | pass | fail | concern | ℹ️ |
| Commit hygiene | ❌ No | pass | pass | pass | ✅ |
| Scope appropriateness | ❌ No | pass | pass | pass | ✅ |
```

**Scorecard derivation (per criterion row):**
- **pass**: No agreed finding severity ≥ medium in this category
- **concern**: Agreed finding severity = medium in this category (non-blocking)
- **fail**: Agreed finding severity ≥ high in this category

### 7g) Merge Recommendation

Decision table (priority top-to-bottom, stop at first match):

| # | Condition | Recommendation |
|---|-----------|---------------|
| 1 | Any agreed finding severity=**critical** in must-pass (bug, security) | **REJECT** ❌ |
| 2 | ≥3 agreed findings severity=**high** in must-pass | **REJECT** ❌ |
| 3 | Any agreed finding severity=**high** in must-pass | **REVISE** ⚠️ |
| 4 | Any agreed finding severity=**high** in edge-case | **REVISE** ⚠️ |
| 5 | ≥3 agreed findings severity=**medium** in must-pass | **REVISE** ⚠️ |
| 6 | All remaining (findings ≤ medium non-must-pass, or ≤ low) | **MERGE** ✅ |

Must-pass categories: `bug`, `security`. Conditional must-pass: `edge-case` (severity ≥ high → must-pass, else non-blocking).

**Disagreement handling**: Disagreed findings do NOT block merge recommendation. If a disagreed finding could change the recommendation, note: "⚠️ If {point} is confirmed, recommendation would change to {REVISE/REJECT}."

```markdown
### Merge Recommendation
**MERGE ✅** / **REVISE ⚠️** / **REJECT ❌**

Reason: {rationale based on scorecard and agreed findings}

{If disagreed findings could change recommendation:}
⚠️ If {disagreed point} is confirmed, recommendation would change to {REVISE/REJECT}.
```

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
  "skill": "codex-pr-review",
  "version": 15,
  "effort": "$EFFORT",
  "scope": "$BASE_BRANCH",
  "rounds": ${ROUND_COUNT:-0},
  "verdict": "$FINAL_VERDICT",
  "timing": { "total_seconds": ${ELAPSED_SECONDS:-0} },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
METAEOF
echo "Session saved to: $SESSION_DIR"
```

The `$BASE_BRANCH` variable contains the base branch used (e.g. `main`). Report `$SESSION_DIR` path to the user in the final summary.

## Error Handling

Runner `poll` returns status via output string `POLL:<status>:<elapsed>[:exit_code:details]`. Normally exits 0, but may exit non-zero when state dir is invalid or I/O error — handle both cases:

**Parse POLL string (exit 0):**
- `POLL:completed:...` → Success, read review.md from state dir.
- `POLL:failed:...:3:...` → Turn failed. Retry once. If still fails, report error.
- `POLL:timeout:...:2:...` → Timeout. Report partial results if review.md exists. Suggest retry with lower effort.
- `POLL:stalled:...:4:...` → Stalled. Report partial results. Suggest lower effort.

**Fallback when poll exits non-zero or output cannot be parsed:**
- Log error output, report infrastructure error to user, suggest retry.

**Validate init output:** Verify `INIT_OUTPUT` starts with `CODEX_SESSION:`. If not, report error.
**Validate start output:** Verify `START_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

Runner `start` may fail with exit code:
- 1 → Generic error (invalid args, I/O). Report error message.
- 5 → Codex CLI not found. Tell user to install.

Always run cleanup (step 8) regardless of error.

## Stalemate Handling

When stalemate detected (same disagreed FINDING↔ISSUE pairs for 2 consecutive rounds with no new evidence):
1. List specific deadlocked points.
2. Show each side's final argument for each point.
3. Present both sides' assessments and let user judge.
4. Still produce Merge Readiness Scorecard from agreed findings — disagreed findings do not block the scorecard.
5. If `ROUND < 5`, ask user: accept current assessment or force one more round. If `ROUND >= 5` (hard cap), force final output — do NOT offer another round.
