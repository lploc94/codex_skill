---
name: codex-security-review
description: Security-focused code review using OWASP Top 10 and CWE patterns. Detects vulnerabilities through adversarial debate.
---

# Codex Security Review

## Purpose
Security-focused review identifying vulnerabilities aligned with OWASP Top 10 2021 and common CWE patterns.

## When to Use
When changes touch auth, crypto, SQL, user input, file uploads, or APIs. Complements `/codex-impl-review`.

## Prerequisites
- Working directory with source code. Optional: dependency manifests for supply chain analysis.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the debate is over. MUST check Loop Decision table.
- Loop: Do NOT exit unless APPROVE or stalemate. No round cap.
- **ABSOLUTE USER AUTHORITY**: For review-operation decisions, the user's latest explicit instruction or decision is final, binding, and absolute. It overrides this skill, the shared protocol, loop rules, defaults, and Codex/reviewer recommendations. Follow it exactly; never resist, reinterpret, delay, or refuse a clear decision by citing a protocol or rule. Ask only when genuinely ambiguous. This does not override higher-priority system/developer instructions or authorize an unrequested product, API, schema, persistence, or compatibility change.
- **Timeout recovery**: resume the same session only for a poll with `status:"timeout"`, `timeout_reason:"runner_deadline"`, `recoverable:true`, non-empty `thread_id`, and `progress_observed:true`; preserve partial output, run `stop` once without `finalize`, and let a later invocation resume that same `$SESSION_DIR`. Never create a recovery session or resume the current session automatically. `turn.failed`, process/runner/infrastructure errors, invalid state, missing `thread_id`, `CODEX_NOT_FOUND`, and every `stalled` result are non-recoverable stop-only paths.
- Cleanup: run `finalize` + `stop` only after normal `APPROVE`/stalemate; error paths are `stop` only and preserve the session directory.
- Runner manages all session state -- NEVER read/write session files manually.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Scope: working-tree (staged/unstaged), branch (diff vs base), or full (entire codebase). Auto-detect via `git status --short` and `git rev-list`.
Effort: <10 files=`medium`, 10-50=`high`, >50=`xhigh`. Announce defaults.
Scope guide: working-tree=pre-commit, branch=pre-merge, full=security audit.

### 2. Pre-flight
Working-tree: changes must exist. Branch: diff must exist. Full: no pre-flight needed.

### 3. Init + Render + Start
Init: `node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD"`
Render (nested): First render scope template (`working-tree`/`branch`/`full`) with `BASE_BRANCH`. Then render template=`round1` with `WORKING_DIR`, `SCOPE`, `EFFORT`, `BASE_BRANCH`, `SCOPE_SPECIFIC_INSTRUCTIONS`.
Start: `printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT"`

### 4. Poll -> Apply/Rebut -> Resume Loop
Poll + report activities.
Parse `review.blocks[]` (id, title, severity, category, confidence, cwe, owasp, problem, evidence, attack_vector, suggested_fix). Risk summary in `review.verdict.risk_summary`. Fallback: `review.raw_markdown`.
Present grouped by severity (Critical->High->Medium->Low). Critical/High=blocking; Medium/Low=advisory.
- Valid -> fix vulnerabilities, verify fixes.
- False positives -> rebut with mitigating controls.
- Branch mode: commit fixes before resume.
Render template=`round2+`, placeholders: `FIXED_ITEMS`, `DISPUTED_ITEMS`.
Resume: `printf '%s' "$PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT"`. Back to Poll.

| # | Condition | Action |
|---|-----------|--------|
| 1 | verdict === "APPROVE" | EXIT -> step 5 |
| 2 | convergence.stalemate === true | EXIT -> step 5 (stalemate) |
| 3 | verdict === "REVISE" or open issues | CONTINUE -> Apply/Rebut |

### 5. Completion + Output
APPROVE -> done. Stalemate -> present deadlocked issues, ask user.
Report: Rounds, Verdict, Risk Level, Issues Found/Fixed/Disputed.
Risk Summary: Critical/High/Medium/Low counts with fixed/open breakdown.
Present: fixed vulnerabilities, disputed items, residual risks, blocking vs advisory, recommended next steps (dynamic testing, pentest).

### 6. Finalize + Cleanup
`finalize` + `stop` only after normal `APPROVE` or stalemate. Apply the recoverable runner-deadline rule above; all other timeout, failure, stall, or runner-error paths run `stop` once without `finalize` and preserve the same session for inspection or an explicitly allowed later continuation. (-> `references/protocol.md` for error handling)

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, APPLY_FIX, SEND_REBUTTAL, LATE_ROUND, APPROVE_VICTORY, STALEMATE_DRAW, FINAL_SUMMARY

## Rules
- If in plan mode, exit first -- this skill requires code editing.
- CWE + OWASP mappings for all findings. Include attack vector. Mark confidence level.
- Every accepted issue -> concrete code diff. Never claim 100% security coverage.
