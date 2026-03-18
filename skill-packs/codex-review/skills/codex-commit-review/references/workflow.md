# Commit Review Workflow

## Smart Default Detection

**mode detection:**
```bash
git diff --cached --quiet
if [ $? -ne 0 ]; then MODE="draft"; else MODE="last"; fi
```

If `draft`, ask user for the commit message text to review. If `last`, use N=1 default.

Announce: `"Detected: mode=draft, effort=medium. Proceeding — reply to override."`

---

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
9. **Also assemble the Claude Independent Analysis Prompt** from `references/prompts.md` (Draft or Last variant). Replace the same placeholders as above, plus `{CLAUDE_ANALYSIS_FORMAT}` with the fenced code block from `references/claude-analysis-template.md`.

## 2) Start Round 1

Set `ROUND=1`.

```bash
STATE_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

**Do NOT poll yet. Proceed to Step 2.5.**

## 2.5) Claude Independent Analysis

**PURPOSE**: Claude evaluates commit message(s) BEFORE seeing Codex output. This prevents anchoring bias and ensures genuine peer debate.

**INFORMATION BARRIER**: MUST NOT read `$STATE_DIR/review.md` or any Codex output file.

**Instructions:**
1. Read the assembled Claude Independent Analysis Prompt (from Step 1.8).
2. Claude reads the diff and commit messages:
   - **Draft mode**: Run `git diff --cached` to read the staged diff.
   - **Last mode**: Run `git show <SHA>` for EACH commit individually + run `{DIFF_CONTEXT}` (the same diff command assembled in Step 1.8, which handles root-history via empty-tree) for aggregate context. Every FINDING's Evidence MUST reference a specific SHA and subject.
3. Claude writes FINDING-{N} findings following the format in `references/claude-analysis-template.md`.
4. Claude writes Overall Assessment (Quality, Convention compliance, Accuracy vs diff).
5. Claude writes Strongest Positions (positions to defend in debate).
6. **CRITICAL**: This step MUST be COMPLETED before proceeding to Step 3. Do not read Codex output until after independent analysis is finalized.

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

**Round 2+ (response rounds):**
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

## 4) Cross-Analysis

**Replaces the old "Apply/Rebut" step.** Claude and Codex are equal peers — no reviewer/implementer framing.

### 4a) Read Codex Output
- Parse `ISSUE-{N}` blocks and `Overall Assessment` from Codex output using `references/output-format.md`.

### 4b) Compare Findings (Side-by-Side)

Map Claude's FINDING-{N} to Codex's ISSUE-{N} using the Matching Protocol in `references/claude-analysis-template.md`.

| Classification | Meaning |
|---------------|---------|
| **Genuine Agreement** | Both independently found the same issue |
| **Genuine Disagreement** | Opposing assessment (e.g., Claude thinks message is clear, Codex thinks it's not) |
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

## 5) Resume Round 2+

Build Round 2+ prompt from `references/prompts.md` (appropriate Response template — Draft or Last):
- Replace `{SESSION_CONTEXT}` with the same structured context block from Round 1.
- Replace `{PROJECT_CONVENTIONS}` with the same discovered conventions from §1.6.
- Replace `{AGREED_POINTS}` with merged findings both sides agree on.
- Replace `{DISAGREED_POINTS}` with current disagreements and both positions.
- Replace `{NEW_FINDINGS}` with Claude-only and Codex-only findings not yet resolved.
- Replace `{CONTINUE_OR_CONSENSUS_OR_STALEMATE}` with current debate status and reasoning.
- Replace `{DIFF_CONTEXT}` with the same diff command used in Round 1 (draft: `git diff --cached`; last: `git diff HEAD~N..HEAD` or empty-tree variant).
- For last mode: replace `{COMMIT_LIST}` with the same formatted list of SHA + subject from Round 1.
- Replace `{OUTPUT_FORMAT}` by copying the entire fenced code block from `references/output-format.md`.

```bash
STATE_OUTPUT=$(printf '%s' "$RESPONSE_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" --thread-id "$THREAD_ID" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

**Important:** Update `STATE_DIR` after every `start --thread-id` — the runner creates a new state directory each round.

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
- User explicitly stops.

### Authority Rule
Claude orchestration is the authoritative source for stop/continue decisions. Codex VERDICT is advisory input — Claude considers it but may override if evidence warrants.

## 7) Final Output

Present a consensus report — **NEVER propose revised commit messages**.

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

### Commit Message(s) Reviewed
{original messages — verbatim, per-commit SHA for last mode}

### Consensus Points
- FINDING-1/ISSUE-2: {description} — Both agree: {assessment}
- ...

### FINDING↔ISSUE Mapping
| Claude FINDING | Codex ISSUE | Classification | Status |
|---------------|-------------|----------------|--------|
| FINDING-1     | ISSUE-2     | Agreement      | Agreed |
| FINDING-2     | —           | Claude-only    | Noted  |
| —             | ISSUE-1     | Codex-only     | Agreed |

### Remaining Disagreements
| Point | Claude | Codex |
|-------|--------|-------|
| Clarity of subject line | Good — concise and descriptive | Fair — missing scope prefix |
| ... | ... | ... |

### Overall Assessment
| Aspect | Claude | Codex | Consensus |
|--------|--------|-------|-----------|
| Quality | good | fair | — |
| Convention compliance | yes | partial | — |
| Accuracy vs diff | accurate | accurate | ✓ |
```

## 8) Cleanup
```bash
node "$RUNNER" stop "$STATE_DIR"
```
Remove the state directory and kill any remaining Codex/watchdog processes. Always run this step, even if the review ended due to failure or timeout. Use the latest `STATE_DIR` from the most recent round.

## Session Output

After the final round completes (or after Round 1 for single-round skills), create a persistent session directory:

```bash
SESSION_DIR=".codex-review/sessions/codex-commit-review-$(date +%s)-$$"
mkdir -p "$SESSION_DIR"
cp "$STATE_DIR/review.md" "$SESSION_DIR/review.md"
cat > "$SESSION_DIR/meta.json" << 'METAEOF'
{
  "skill": "codex-commit-review",
  "version": 14,
  "effort": "$EFFORT",
  "mode": "$MODE",
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

When stalemate detected (same disagreed FINDING↔ISSUE pairs for 2 consecutive rounds with no new evidence):
1. List specific deadlocked points.
2. Show each side's final argument for each point.
3. Present both sides' assessments and let user judge.
4. If `ROUND < 5`, ask user: accept current assessment or force one more round. If `ROUND >= 5` (hard cap), force final output — do NOT offer another round.
