---
name: codex-security-review
description: Security-focused code review using OWASP Top 10 and CWE patterns. Detects vulnerabilities, secrets, authentication issues, and security misconfigurations through static analysis.
---

# Codex Security Review

## Purpose
Use this skill to perform security-focused review of code changes, identifying vulnerabilities aligned with OWASP Top 10 2021 and common CWE patterns.

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
1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask review scope: `working-tree` (uncommitted changes), `branch` (branch diff), or `full` (entire codebase). Ask output format: `markdown` (default), `json`, `sarif`, or `both`. Set `EFFORT`, `SCOPE`, and `FORMAT`.
2. Build prompt from `references/prompts.md` (Security Review Prompt with OWASP checklist).
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT" --format "$FORMAT"`.
4. Poll with adaptive intervals (Round 1: 60s/60s/30s/15s..., Round 2+: 30s/15s...). After each poll, report **specific activities** from poll output (e.g. which files Codex is analyzing, what vulnerability patterns it's checking). See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running" — always extract concrete details.
5. Parse security findings with `references/output-format.md` (includes CWE/OWASP mappings).
6. Fix valid vulnerabilities in code; rebut false positives with evidence.
7. Resume debate via `--thread-id` until `APPROVE` or stalemate.
8. Return final security assessment with risk summary.

### Effort Level Guide
| Level    | Depth             | Best for                        |
|----------|-------------------|---------------------------------|
| `low`    | Common patterns   | Quick security sanity check     |
| `medium` | OWASP Top 10      | Standard security review        |
| `high`   | Deep analysis     | Pre-production security audit   |
| `xhigh`  | Exhaustive        | Critical/regulated systems      |

### Scope Guide
| Scope          | Coverage                           | Best for                    |
|----------------|------------------------------------|-----------------------------|
| `working-tree` | Uncommitted changes only           | Pre-commit security check   |
| `branch`       | Branch diff vs base                | Pre-merge security review   |
| `full`         | Entire codebase                    | Security audit              |

### Output Format Guide
| Format     | Output Files                          | Best for                        |
|------------|---------------------------------------|---------------------------------|
| `markdown` | `review.txt` (human-readable)         | Default, interactive review     |
| `json`     | `review.txt` + `review.json`          | CI/CD integration, automation   |
| `sarif`    | `review.txt` + `review.sarif.json`    | IDE integration (VS Code, etc.) |
| `both`     | All above + `review.md` (rendered)    | Complete documentation          |

**Note**: `review.txt` is always written for backward compatibility. SARIF format is ideal for security findings as it's supported by GitHub Security tab and most security tools.

## Security Categories Covered

### OWASP Top 10 2021
- **A01:2021** - Broken Access Control
- **A02:2021** - Cryptographic Failures
- **A03:2021** - Injection (SQL, Command, XSS, etc.)
- **A04:2021** - Insecure Design
- **A05:2021** - Security Misconfiguration
- **A06:2021** - Vulnerable and Outdated Components
- **A07:2021** - Identification and Authentication Failures
- **A08:2021** - Software and Data Integrity Failures
- **A09:2021** - Security Logging and Monitoring Failures
- **A10:2021** - Server-Side Request Forgery (SSRF)

### Additional Security Checks
- Secrets/credentials in code
- Hardcoded passwords and API keys
- Insecure random number generation
- Path traversal vulnerabilities
- XML External Entity (XXE) attacks
- Insecure deserialization
- Missing security headers
- CORS misconfigurations

## Output Format

Each security finding includes:
- **CWE ID**: Common Weakness Enumeration identifier
- **OWASP Category**: OWASP Top 10 2021 mapping
- **Severity**: `critical`, `high`, `medium`, `low`
- **Confidence**: `high`, `medium`, `low` (static analysis confidence)
- **Attack Vector**: How the vulnerability could be exploited
- **Suggested Fix**: Secure code example

See `references/output-format.md` for complete specification.

## Important Limitations

**This is static analysis only:**
- ✅ Can detect: Code patterns, hardcoded secrets, common vulnerabilities
- ❌ Cannot detect: Runtime behavior, memory leaks (need profiling), zero-days
- ⚠️ Heuristic: Findings are AI-generated suggestions, not guaranteed vulnerabilities

**Always:**
- Verify findings manually before treating as confirmed vulnerabilities
- Run dynamic security testing (DAST) for runtime issues
- Use dedicated tools for dependency scanning (Snyk, Dependabot)
- Consult security experts for critical systems

## Required References
- Detailed execution: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Codex reviews only; it does not edit files
- Mark all findings with confidence level (high/medium/low)
- Provide CWE and OWASP mappings for all vulnerabilities
- Include attack vector explanation for each finding
- If stalemate persists, present both sides and defer to user
- Never claim 100% security coverage - static analysis has limits
