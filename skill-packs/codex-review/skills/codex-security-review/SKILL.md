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
- `codex` CLI is installed and authenticated
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`)

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **scope** (detected first): Run `git status --short | grep -v '^??'` — non-empty output → `working-tree`. Else run `git rev-list @{u}..HEAD` — non-empty → `branch`. If both conditions true, use `working-tree`. If neither, ask user.
   - **effort** (adapts to detected scope): If scope=`branch`, count `git diff --name-only @{u}..HEAD`; else count `git diff --name-only`. Result <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high` if undetectable.
   - Announce: "Detected: scope=`$SCOPE`, effort=`$EFFORT` (N files changed). Proceeding — reply to override scope, effort, or both."
   - Set `SCOPE` and `EFFORT`. Only block for inputs that remain undetectable.
2. Build prompt from `references/prompts.md` (Security Review Prompt with OWASP checklist).
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
4. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is analyzing, what vulnerability patterns it's checking). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
5. Parse security findings with `references/output-format.md` (includes CWE/OWASP mappings).
6. Fix valid vulnerabilities in code; rebut false positives with evidence.
7. Resume debate via `--thread-id` until `APPROVE` or stalemate.
8. Return final security assessment with risk summary.

### Effort Level Guide
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|--------------|
| `low`    | Common patterns   | Quick security sanity check     | ~3-5 min     |
| `medium` | OWASP Top 10      | Standard security review        | ~8-12 min    |
| `high`   | Deep analysis     | Pre-production security audit   | ~15-20 min   |
| `xhigh`  | Exhaustive        | Critical/regulated systems      | ~25-40 min   |

### Scope Guide
| Scope          | Coverage                           | Best for                    |
|----------------|------------------------------------|-----------------------------|
| `working-tree` | Uncommitted changes only           | Pre-commit security check   |
| `branch`       | Branch diff vs base                | Pre-merge security review   |
| `full`         | Entire codebase                    | Security audit              |

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract (incl. Security Categories, Output Format, OWASP coverage): `references/output-format.md`

## Rules
- Codex reviews only; it does not edit files
- Mark all findings with confidence level (high/medium/low)
- Provide CWE and OWASP mappings for all vulnerabilities
- Include attack vector explanation for each finding
- If stalemate persists, present both sides and defer to user
- Never claim 100% security coverage - static analysis has limits
