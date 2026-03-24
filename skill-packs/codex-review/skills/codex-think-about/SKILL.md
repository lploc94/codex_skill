---
name: codex-think-about
description: Peer debate between Claude Code and Codex on any technical question. Both sides think independently, challenge each other, and converge to consensus or explicit disagreement.
---

# Codex Think About

## Purpose
Use this skill for peer reasoning, not code review. Claude and Codex are equal analytical peers; Claude orchestrates the debate loop and final synthesis.

## When to Use
When you want to debate a technical decision or design question before implementing. Use this for architecture choices, technology comparisons, and reasoning through tradeoffs — not for code review.

## Prerequisites
- A question or decision topic from the user (may be vague — question-sharpening step will refine it).

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
Follow `references/question-sharpening.md`. If sharpening produces a substantive rewrite, confirm with user (Y/n); otherwise proceed with the original question. The confirmed question becomes `QUESTION` for all subsequent steps.

Gather: reasoning effort (`low`/`medium`/`high`/`xhigh`, default `high`), scope/constraints, relevant files, project context. Collect factual context only — no premature opinion. Set `EFFORT`.

### 2. Init Session
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-think-about --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`.

### 3. Render Round 1 + Start Codex
```bash
PROMPT=$(node "$RUNNER" render --skill codex-think-about --template round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"QUESTION":$(json_esc "$QUESTION"),"PROJECT_CONTEXT":$(json_esc "$PROJECT_CONTEXT"),"RELEVANT_FILES":$(json_esc "$RELEVANT_FILES"),"CONSTRAINTS":$(json_esc "$CONSTRAINTS")}
RENDER_EOF
)
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT" --sandbox danger-full-access
```
Validate JSON: `{"status":"started","round":1}`. Error with `CODEX_NOT_FOUND` → tell user to install codex. **Do NOT poll yet** — proceed to Step 4.

### 4. Claude Independent Analysis (BEFORE polling)

**INFORMATION BARRIER**: MUST NOT read Codex output before completing analysis. Codex is running in background.

```bash
CLAUDE_PROMPT=$(node "$RUNNER" render --skill codex-think-about --template claude-analysis --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"QUESTION":$(json_esc "$QUESTION"),"PROJECT_CONTEXT":$(json_esc "$PROJECT_CONTEXT"),"RELEVANT_FILES":$(json_esc "$RELEVANT_FILES"),"CONSTRAINTS":$(json_esc "$CONSTRAINTS")}
RENDER_EOF
)
```

Analyze using own knowledge. MAY use MCP tools (`web_search`, `context7`, `ask_internet`) for research — source parity with Codex's web access. Follow the rendered format. **CRITICAL**: Analysis must be COMPLETE and FINAL before proceeding to Step 5. Commit to specific positions. Store analysis internally for cross-analysis.

### 5. Poll
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Poll intervals**: Round 1: 90s, 60s, 30s, 15s+. Round 2+: 45s, 30s, 15s+.

Report **specific activities** from `activities` array (e.g. "Codex [90s]: researching WebSocket vs SSE tradeoffs"). NEVER report generic "Codex is running". **WARNING**: `file_changed` activity → Codex modified file, see Step 6.5; `wget` detected → may write files, monitor Step 6.5.

Continue while `status === "running"`. Stop on `completed|failed|timeout|stalled`.

**Note**: `status === "completed"` means Codex finished its turn — it does NOT mean the debate is over. After `completed`, check the Loop Decision table to determine whether to continue or exit.

### 6. Cross-Analysis

**Capture baseline BEFORE this step** — see Step 6.5.

Parse from poll JSON: `review.insights`, `review.considerations`, `review.recommendations`, `review.sources`, `review.open_questions`, `review.confidence`, `review.suggested_status`. Fallback: `review.raw_markdown`.

Classify each topic/insight:

| Classification | Meaning | Handle |
|---------------|---------|--------|
| **Genuine Agreement** | Both independently reached same conclusion | Strong consensus signal |
| **Genuine Disagreement** | Opposing positions from the start | Defend with evidence |
| **Claude-only Insight** | Claude found, Codex did not | Present as new perspective |
| **Codex-only Insight** | Codex found, Claude did not | Evaluate on merits |
| **Same Direction, Different Depth** | Both found issue, one went deeper | Synthesize deeper analysis |

Build response: **Agreements** (independently converged), **Disagreements** (state Claude's position + why Codex's doesn't change it, or does — be honest), **New Perspectives** (Claude-only + evaluate Codex-only), **Source Cross-validation** (compare sources, flag claims lacking citations). Set status: `CONTINUE`/`CONSENSUS`/`STALEMATE` — consider Codex's `review.suggested_status` but override if evidence warrants.

### 6.5. File Modification Guard

After each round, check if Codex modified project files. `danger-full-access` is for web research ONLY.

**In git repo** — before each round: `BASELINE=$(git status --porcelain --untracked-files=all --ignored 2>/dev/null)`. After round: `CURRENT=$(git status --porcelain --untracked-files=all --ignored 2>/dev/null)`. Compare: new lines in `CURRENT` not in `BASELINE` → Codex modified files.

**Outside git repo** — before each round: snapshot files with `find`+`stat` to baseline. After round: compare. Classify added/deleted/modified by path+mtime.

**If changes detected**: STOP workflow immediately. List every modified/created/deleted file. Warn user: "Codex violated file modification rules." Do NOT auto-revert. Run cleanup (Step 10).

### 7. Render Round 2+ + Resume
From Round 2 onward, the information barrier no longer applies — both sides have seen each other's positions.

```bash
PROMPT=$(node "$RUNNER" render --skill codex-think-about --template round2+ --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"AGREED_POINTS":$(json_esc "$AGREED_POINTS"),"DISAGREED_POINTS":$(json_esc "$DISAGREED_POINTS"),"NEW_PERSPECTIVES":$(json_esc "$NEW_PERSPECTIVES"),"CONTINUE_OR_CONSENSUS_OR_STALEMATE":$(json_esc "$STATUS")}
RENDER_EOF
)
printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON. Sandbox mode persists via thread — do NOT pass `--sandbox` on resume. **Go back to step 5 (Poll).**

### Loop Decision (after each poll returns `status === "completed"`)

`status === "completed"` means **Codex's turn is done** — NOT that the debate is over. Check IN ORDER (first match wins):

| # | Condition | Action |
|---|-----------|--------|
| 1 | Claude determines consensus (both sides converged, no significant disagreements) | **EXIT loop** → go to Completion step |
| 2 | `poll_json.convergence.stalemate === true` or same disagreement set for 2 consecutive rounds | **EXIT loop** → go to Completion step (stalemate branch) |
| 3 | Current round >= 5 | **EXIT loop** → go to Completion step (hard cap) |
| 4 | Significant disagreements remain or new perspectives emerged | **CONTINUE** → go back to Cross-Analysis step |

**CRITICAL**: Do NOT exit the loop unless condition 1, 2, or 3 is met. Codex `suggested_status` is advisory — override if evidence warrants continued debate.

### 8. Completion + Stalemate
- `review.suggested_status === "CONSENSUS"` → done.
- `review.suggested_status === "STALEMATE"` or same disagreement set for 2 consecutive rounds → list deadlocked points, both sides' arguments, recommend which to favor. Round < 5 → ask user: accept synthesis or force one more round. Round ≥ 5 → force final synthesis.
- **Hard cap: 5 rounds.** Force final synthesis with unresolved points as open questions.

### 9. Final Output

### Consensus Points
- {agreed points}

### Remaining Disagreements
| Point | Claude | Codex |
|-------|--------|-------|
| ... | ... | ... |

### Recommendations
- {actionable recommendations}

### Consolidated Sources
| # | URL | Description | Used By |
|---|-----|-------------|---------|
| 1 | https://... | ... | Codex |
| 2 | https://... | ... | Claude |
| 3 | https://... | ... | Both |

### Open Questions
- {unresolved questions}

### Confidence Level
- low | medium | high

### 10. Finalize + Cleanup
```bash
node "$RUNNER" finalize "$SESSION_DIR" <<'FINALIZE_EOF'
{"verdict":"CONSENSUS","scope":"think-about"}
FINALIZE_EOF
```
Optionally include `"insights":{"total_agreed":N,"total_disagreed":N,"total_open":N}`. Report `$SESSION_DIR` path.

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
- Keep roles as peers; no reviewer/implementer framing.
- **Codex must NOT modify, create, or delete ANY project files.** `danger-full-access` sandbox is used SOLELY for web search. Prompt contains strict guardrails.
- Codex MUST cite sources (URL) for factual claims from web.
- Separate researched facts (with sources) from opinions.
- Detect stalemate when arguments repeat with no new evidence.
- End with clear recommendations, source list, and open questions.
- **Information barrier**: Claude MUST complete its independent analysis (Step 4) before reading Codex output. This prevents anchoring bias.
- **Runner manages all session state** — do NOT manually read/write `rounds.json`, `meta.json`, or `prompt.txt` in the session directory.
