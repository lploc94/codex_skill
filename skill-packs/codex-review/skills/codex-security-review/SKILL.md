---
name: codex-security-review
description: Security-focused code review using OWASP Top 10 and CWE patterns. Detects vulnerabilities, secrets, authentication issues, and security misconfigurations through static analysis.
---

# Codex Security Review

## Purpose
Use this skill to perform security-focused review of code changes, identifying vulnerabilities aligned with OWASP Top 10 2021 and common CWE patterns.

## When to Use
When changes touch auth, crypto, SQL queries, user input processing, file uploads, or external API calls. Use for security-focused pre-commit or pre-merge review. Complements `/codex-impl-review` — run both for sensitive code.

## Prerequisites
- Working directory with source code
- Optional: dependency manifest files (package.json, requirements.txt, go.mod) for supply chain analysis

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
else SCOPE=""  # ask user — offer "full" as additional option
fi
```

**Effort detection (adapts to scope):**
```bash
if [ "$SCOPE" = "branch" ]; then
  FILES_CHANGED=$(git diff --name-only @{u}..HEAD 2>/dev/null | wc -l)
elif [ "$SCOPE" = "full" ]; then
  FILES_CHANGED=50
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

**Scope-specific inputs**:
- **Working-tree**: working dir path, uncommitted changes (`git status`, `git diff`, `git diff --cached`).
- **Branch**: base branch (ask user, fallback `main`→`master`→remote HEAD, validate with `git rev-parse --verify`), clean working tree required (`git diff --quiet && git diff --cached --quiet`), branch diff + commit log.
- **Full**: working dir path. Identify high-risk areas: auth, database, external APIs, file operations, crypto.

### Scope Guide
| Scope          | Coverage                           | Best for                    |
|----------------|------------------------------------|-----------------------------|
| `working-tree` | Uncommitted changes only           | Pre-commit security check   |
| `branch`       | Branch diff vs base                | Pre-merge security review   |
| `full`         | Entire codebase                    | Security audit              |

### 2. Pre-flight Checks
- **Working-tree**: `git diff --quiet && git diff --cached --quiet` must FAIL (exit 1). If both succeed → no changes, stop.
- **Branch**: `git diff <base>...HEAD --quiet` must FAIL. If no diff → stop.
- **Full**: no pre-flight checks needed.

### 3. Init Session
```bash
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
```
Validate: `INIT_OUTPUT` must start with `CODEX_SESSION:`.

### 4. Render Prompt (Nested Render)

**Step 1: Render scope-specific instructions:**
```bash
if [ "$SCOPE" = "branch" ]; then
  SCOPE_INSTRUCTIONS=$(node "$RUNNER" render --skill codex-security-review --template "$SCOPE" --skills-dir "$SKILLS_DIR" <<SCOPE_EOF
{"BASE_BRANCH":$(json_esc "$BASE_BRANCH")}
SCOPE_EOF
  )
else
  SCOPE_INSTRUCTIONS=$(node "$RUNNER" render --skill codex-security-review --template "$SCOPE" --skills-dir "$SKILLS_DIR" <<'SCOPE_EOF'
{}
SCOPE_EOF
  )
fi
```

**Step 2: JSON-escape scope output, then render round1:**
```bash
PROMPT=$(node "$RUNNER" render --skill codex-security-review --template round1 --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"WORKING_DIR":$(json_esc "$PWD"),"SCOPE":$(json_esc "$SCOPE"),"EFFORT":$(json_esc "$EFFORT"),"BASE_BRANCH":$(json_esc "$BASE_BRANCH"),"SCOPE_SPECIFIC_INSTRUCTIONS":$(json_esc "$SCOPE_INSTRUCTIONS")}
RENDER_EOF
)
```

### 5. Start Round 1
```bash
printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"
```
Validate JSON: `{"status":"started","round":1}`. Error with `CODEX_NOT_FOUND` → tell user to install codex.

### 6. Poll
```bash
POLL_JSON=$(node "$RUNNER" poll "$SESSION_DIR")
```
**Poll intervals**: Round 1: 60s, 60s, 30s, 15s+. Round 2+: 30s, 15s+.

Report **specific activities** from `activities` array (e.g. "Codex [45s]: scanning for SQL injection patterns in database queries"). NEVER report generic "Codex is running".

Continue while `status === "running"`. Stop on `completed|failed|timeout|stalled`.

**Note**: `status === "completed"` means Codex finished its turn — it does NOT mean the debate is over. After `completed`, check the Loop Decision table to determine whether to continue or exit.

### 7. Apply/Rebut
Parse issues from `poll_json.review.blocks[]` — each has `id`, `title`, `severity`, `category`, `confidence`, `cwe`, `owasp`, `problem`, `evidence`, `attack_vector`, `suggested_fix`. Verdict in `review.verdict.status`. Risk summary in `review.verdict.risk_summary` (`{ critical, high, medium, low }`). Fallback: `review.raw_markdown`.

Present findings grouped by severity (Critical → High → Medium → Low). Format: `ISSUE-{N}: {title} [{cwe}] [{owasp}] — confidence: {confidence}`. Critical/High = blocking; Medium/Low = advisory.

- **Valid issues**: fix vulnerabilities in code, record fix evidence.
- **False positives**: rebut with concrete proof (paths, tests, mitigating controls).
- **Severity disputes**: acknowledge issue, explain why severity should differ with context.
- **Branch mode only**: commit fixes (`git add` + `git commit`) before resuming — Codex reads `git diff <base>...HEAD` which only shows committed changes.
- **Verify fixes**: run relevant tests, typecheck, or document manual evidence. Never claim fixed without verification.

### 8. Render Rebuttal + Resume
```bash
PROMPT=$(node "$RUNNER" render --skill codex-security-review --template round2+ --skills-dir "$SKILLS_DIR" <<RENDER_EOF
{"FIXED_ITEMS":$(json_esc "$FIXED_ITEMS"),"DISPUTED_ITEMS":$(json_esc "$DISPUTED_ITEMS")}
RENDER_EOF
)
```

Resume: `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"` → validate JSON. **Go back to step 6 (Poll).**

### Loop Decision (after each poll returns `status === "completed"`)

`status === "completed"` means **Codex's turn is done** — NOT that the debate is over. You MUST check these conditions IN ORDER (first match wins):

| # | Condition | Action |
|---|-----------|--------|
| 1 | `review.verdict.status === "APPROVE"` | **EXIT loop** → go to Completion step |
| 2 | `poll_json.convergence.stalemate === true` | **EXIT loop** → go to Completion step (stalemate branch) |
| 3 | Current round >= 5 | **EXIT loop** → go to Completion step (hard cap) |
| 4 | `review.verdict.status === "REVISE"` or any open issues remain | **CONTINUE** → go back to Apply/Rebut step |

**CRITICAL**: Do NOT exit the loop unless condition 1, 2, or 3 is met. If Codex returns REVISE, you MUST apply/rebut and resume.

### 9. Completion + Stalemate
- `review.verdict.status === "APPROVE"` → done.
- `review.verdict.status === "STALEMATE"` or `poll_json.convergence.stalemate === true` → present deadlocked issues with both sides' arguments. Round < 5 → ask user; round 5 → force final synthesis.
- **Hard cap: 5 rounds.** Force final synthesis with unresolved issues as residual risks.

### 10. Final Output

| Metric | Value |
|--------|-------|
| Rounds | {N} |
| Verdict | {APPROVE/REVISE/STALEMATE} |
| Risk Level | {CRITICAL/HIGH/MEDIUM/LOW} |
| Issues Found | {total} |
| Issues Fixed | {fixed_count} |
| Issues Disputed | {disputed_count} |

**Risk Summary**: Critical: {count} ({fixed} fixed, {open} open) · High: {count} · Medium: {count} · Low: {count}

Present: fixed vulnerabilities by severity, disputed items with rationale, residual risks, blocking issues (must fix before merge), advisory issues (should fix, not blocking), recommended next steps (dynamic testing, penetration testing, etc.).

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

**Errors**:
- `failed` → retry once (re-poll after 15s).
- `timeout` → report partial results from `review.raw_markdown`, suggest lower effort. Run cleanup.
- `stalled` → if `recoverable === true`: `stop` → prepend recovery note → `resume --recovery` → poll (30s, 15s+). If `recoverable === false`: report partial results, suggest lower effort. Run cleanup.
- Start/resume `CODEX_NOT_FOUND` → tell user to install codex.
- **Cleanup sequencing**: run `finalize` + `stop` ONLY after recovery resolves (success or second failure). Do NOT finalize before recovery attempt.

## Rules
- If invoked during Claude Code plan mode, exit plan mode first — this skill requires code editing.
- Codex reviews only; it does not edit files.
- Mark all findings with confidence level (high/medium/low).
- Provide CWE and OWASP mappings for all vulnerabilities.
- Include attack vector explanation for each finding.
- Every accepted issue must map to a concrete code diff.
- If stalemate persists, present both sides and defer to user.
- Never claim 100% security coverage — static analysis has limits.
- **Runner manages all session state** — do NOT manually read/write `rounds.json`, `meta.json`, or `prompt.txt` in the session directory.
