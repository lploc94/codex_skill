# Runner Protocol Reference

Shared protocol for all codex-review skills. Read on-demand when you need details on commands, polling, error handling, or conventions.

## Stdin Format Rules
- **JSON** -> `render`/`finalize`: heredoc. Literal-only -> `<<'RENDER_EOF'`. Dynamic vars -> escape with `json_esc`, use `<<RENDER_EOF` (unquoted).
- **json_esc output includes quotes** -> embed directly: `{"KEY":$(json_esc "$VAL")}`.
- **Plain text** -> `start`/`resume`: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`.
- **NEVER** `echo '{...}'` for JSON. Forbidden: NULL bytes (`\x00`).

## Session Init
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name <skill-name> --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`. Abort if not.

## Start Round
```bash
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON: `{"status":"started","round":1}`. If error contains `CODEX_NOT_FOUND` -> tell user to install codex (`npm install -g @openai/codex`).

## Render Prompt
```bash
PROMPT=$(node "$RUNNER" render --skill <skill-name> --template <template> --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"KEY1":$(json_esc "$VAL1"),"KEY2":$(json_esc "$VAL2")}
RENDER_EOF
)
```

## Resume
```bash
printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON. Sandbox mode persists via thread -- do NOT pass `--sandbox` on resume.

## Poll Protocol
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Intervals by effort** (Round 1):

| Effort | Round 1 schedule | Round 2+ |
|--------|-----------------|----------|
| low | 120s, 60s, 30s+ | 30s, 15s+ |
| medium | 120s, 60s, 60s, 30s+ | 30s, 15s+ |
| high | 120s, 60s, 60s, 60s, 30s+ | 30s, 15s+ |
| xhigh | 120s, 60s, 60s, 60s, 60s, 30s+ | 30s, 15s+ |

First poll at 120s gives Codex bootstrap time regardless of effort. Higher effort = more 60s intervals before dropping to 30s.

Report **specific activities** from `activities` array (e.g. "Codex [45s]: reading src/auth.js"). NEVER report generic "Codex is running".

Continue while `status === "running"`. Stop on `completed|failed|timeout|stalled`.

**CRITICAL**: `status === "completed"` means Codex finished its turn -- it does NOT mean the debate is over. After `completed`, check the skill's Loop Decision table.

## Debate Loop Protocol

After each `poll` returns `status === "completed"`, the debate loop determines what happens next. **`completed` means Codex finished its turn — NOT that the review is over.**

### Round Lifecycle

```
Poll (completed) → Check stalemate → Check verdict → [EXIT or CONTINUE?]
                                                        EXIT → Finalize
                                                        CONTINUE → Fix/Rebut → Render → Resume → Poll again
```

### Mandatory Rules

1. **Check stalemate FIRST** — after poll completes, check `convergence.stalemate` before anything else. Stalemate overrides all other conditions — EXIT immediately, do NOT render rebuttal or resume.
2. **If not stalemate, evaluate the variant-specific Loop Decision Table** below to determine EXIT or CONTINUE.
3. **If the table says CONTINUE → MUST render response/rebuttal + resume**, even if you fixed ALL issues. Codex needs to re-verify fixes and may find new issues.
4. **Response/rebuttal prompt is ALWAYS sent when the table says CONTINUE** — if all issues were fixed, set `DISPUTED_ITEMS` = `"None — all issues addressed"`. The prompt still gets rendered and sent.
5. **No round cap** — loop continues until the variant-specific table says EXIT, or stalemate.
6. **Never skip resume** — fixing code/plan without sending rebuttal+resume means Codex never re-verifies. The debate is incomplete.

### Variant: Apply/Rebut (impl-review, plan-review)

These skills use `APPROVE`/`REVISE` verdict taxonomy. Codex decides; Claude fixes and rebuts.

**Loop Decision Table:**

| # | Condition | Action |
|---|-----------|--------|
| 1 | `convergence.stalemate === true` | **EXIT** → Finalize (stalemate). Do NOT render rebuttal. |
| 2 | `review.verdict.status === "APPROVE"` | **EXIT** → Finalize |
| 3 | `review.verdict.status === "REVISE"` or open issues remain | **CONTINUE** → sub-steps below |

**If CONTINUE** — all 4 sub-steps are mandatory:
1. **Categorize** each `review.blocks[]` issue as ACCEPT (valid) or DISPUTE (invalid with proof)
2. **Fix** accepted issues — edit code or plan file. Record evidence of each fix
3. **ALWAYS render rebuttal prompt** — template uses `SESSION_CONTEXT`, `FIXED_ITEMS`, `DISPUTED_ITEMS` (and `BASE_BRANCH` for branch mode). `USER_REQUEST` is NOT a rebuttal placeholder. Even if all fixed, `DISPUTED_ITEMS` = `"None — all issues addressed"`
4. **ALWAYS resume** — `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"`. Then back to Poll

### Variant: Cross-Analysis (commit-review, pr-review)

These skills use `CONSENSUS`/`CONTINUE`/`STALEMATE` verdict taxonomy. Codex verdict is advisory; Claude orchestration is authoritative.

**Loop Decision Table:**

| # | Condition | Action |
|---|-----------|--------|
| 1 | `convergence.stalemate === true` | **EXIT** → Finalize (stalemate). Do NOT render response. |
| 2 | Full/Partial Consensus (no severity ≥ medium disagreements) | **EXIT** → Finalize |
| 3 | Disagreements severity ≥ medium remain | **CONTINUE** → sub-steps below |

**If CONTINUE** — all 4 sub-steps are mandatory:
1. **Compare** Claude FINDING-{N} vs Codex ISSUE-{N} — agreements, disagreements, unique findings
2. **Build response** with `AGREED_POINTS`, `DISAGREED_POINTS`, `NEW_FINDINGS`
3. **ALWAYS render round2+ prompt** with comparison results
4. **ALWAYS resume** — then back to Poll

## Finalize + Cleanup
```bash
node "$RUNNER" finalize "$SESSION_DIR" <<'FINALIZE_EOF'
{"verdict":"..."}
FINALIZE_EOF
node "$RUNNER" stop "$SESSION_DIR"
```
Optionally include `"scope":"..."` and `"issues":{...}` in finalize JSON. Report `$SESSION_DIR` path to user.

**ALWAYS run `finalize` + `stop`**, even on failure/timeout.

## Error Handling
| Status | Action |
|--------|--------|
| `failed` | Retry once -- re-poll after 15s. |
| `timeout` | Report partial results from `review.raw_markdown`, suggest lower effort. Run cleanup. |
| `stalled` + `recoverable === true` | `stop` -> prepend recovery note -> `resume --recovery` -> poll (30s, 15s+). |
| `stalled` + `recoverable === false` | Report partial results, suggest lower effort. Run cleanup. |
| `CODEX_NOT_FOUND` | Tell user to install codex. |

**Cleanup sequencing**: Run `finalize` + `stop` ONLY after recovery resolves (success or second failure). Do NOT finalize before recovery attempt.

## Flavor Text Convention
Load `references/flavor-text.md` at skill start. Pick 1 random message per trigger from matching pool -- never repeat within session. Display as `> {emoji} {message}` blockquote. Replace `{N}`, `{TOTAL}`, `{CHUNK}`, `{ROUND}` with actual values. User can disable with "no flavor" or "skip humor". Only trigger on first poll per round (avoid spam).
