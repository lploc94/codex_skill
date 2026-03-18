# Security Review Workflow

## Overview

This document describes the execution workflow for security-focused code review using the `codex-security-review` skill.

---

## Phase 1: Setup and Initialization

### Step 1: Gather User Input

Ask the user for:
1. **Effort level**: `low`, `medium`, `high`, or `xhigh` (default: `high`)
2. **Review scope**: `working-tree`, `branch`, or `full` (default: `working-tree`)
3. **Base branch** (if scope is `branch`): Discover and validate base branch

Use `AskUserQuestion` to collect these inputs in a single prompt.

### Step 2: Validate Prerequisites

```bash
# Check codex CLI is available
which codex || where codex

# Verify working directory has code
ls -la

# If branch mode, verify base branch exists
git rev-parse --verify <base-branch>
```

### Step 3: Build Security Review Prompt

Select appropriate prompt template from `references/prompts.md`:
- **Working-tree mode**: Focus on uncommitted changes
- **Branch mode**: Focus on branch diff vs base
- **Full mode**: Analyze entire codebase

Include:
- OWASP Top 10 2021 checklist
- CWE pattern detection
- Secrets scanning instructions
- Effort-appropriate depth

---

## Phase 2: Round 1 - Initial Security Analysis

### Step 1: Start Codex Review

```bash
# Build security review prompt (see references/prompts.md)
PROMPT="$(cat <<'EOF'
You are a security expert conducting a thorough security review...
[Full prompt from references/prompts.md]
EOF
)"

# Start review with prompt on stdin
echo "$PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" \
  --effort "$EFFORT" \
  2>&1 | tee codex-start.log
```

**Expected output**:
```
CODEX_STARTED:/path/to/.codex-review/runs/1234567890-12345
```

Extract `STATE_DIR` from output.

### Step 2: Poll for Progress

Use adaptive polling intervals:
- **Round 1**: 60s, 60s, 30s, 15s, 15s, 15s...
- **Round 2+**: 30s, 15s, 15s, 15s...

```bash
node "$RUNNER" poll "$STATE_DIR"
```

**Parse poll output** and report specific activities:
- ✅ "Codex is analyzing authentication logic in src/auth.js"
- ✅ "Checking for SQL injection patterns in database queries"
- ✅ "Scanning for hardcoded credentials in config files"
- ❌ "Codex is running" (too generic)

### Step 3: Parse Security Findings

When poll returns `POLL:complete`:

1. Read review output from `$STATE_DIR/review.md`
2. Parse ISSUE-{N} blocks using regex:
   ```regex
   ISSUE-(\d+): (.+?)\n
   Category: (.+?)\n
   Severity: (.+?)\n
   Confidence: (.+?)\n
   CWE: (.+?)\n
   OWASP: (.+?)\n
   ```
3. Extract VERDICT block
4. Build structured findings list

### Step 4: Present Findings to User

Group findings by severity:

```markdown
# Security Review Results - Round 1

**Verdict**: REVISE
**Risk Level**: HIGH

## 🔴 Critical Issues (2)
- ISSUE-1: SQL injection in user search
- ISSUE-2: Hardcoded AWS credentials

## 🟠 High Issues (3)
- ISSUE-3: Missing authentication on admin endpoint
- ISSUE-4: XSS in comment rendering
- ISSUE-5: Insecure deserialization

## 🟡 Medium Issues (5)
...

## 🟢 Low Issues (2)
...
```

---

## Phase 3: Issue Resolution

### For Each Finding:

#### Option A: Accept and Fix

1. **Verify the finding** is a real vulnerability
2. **Apply the suggested fix** or implement alternative secure solution
3. **Document the fix** for round 2 summary

Example:
```javascript
// ISSUE-1: SQL injection fixed
// Before: const query = `SELECT * FROM users WHERE name = '${name}'`;
// After: const query = 'SELECT * FROM users WHERE name = $1';
const users = await db.query(query, [name]);
```

#### Option B: Rebut as False Positive

If the finding is incorrect:

1. **Gather evidence** showing why it's not a vulnerability
2. **Explain mitigating controls** (e.g., input validation elsewhere)
3. **Prepare rebuttal** for round 2

Example rebuttal:
```
ISSUE-3 is a false positive. The admin endpoint at /api/admin/users 
is protected by the authenticateAdmin middleware (line 15) which 
verifies JWT tokens and checks for admin role. The middleware is 
applied to all /api/admin/* routes in routes/index.js:42.
```

#### Option C: Dispute Severity/Confidence

If the finding is valid but severity is wrong:

1. **Acknowledge the issue** exists
2. **Explain why severity should be lower** (or higher)
3. **Provide context** (internal tool, rate limiting, etc.)

Example:
```
ISSUE-5: Agree this is a concern, but severity should be MEDIUM not HIGH.
This endpoint is internal-only (not exposed to internet) and requires 
VPN access. Additionally, we have rate limiting (10 req/min) which 
mitigates brute force attacks.
```

---

## Phase 4: Round 2+ - Debate and Refinement

### Step 1: Build Round 2 Prompt

Include:
- **Fixed items**: List of accepted issues with applied fixes
- **Disputed items**: List of rebuttals with evidence
- **Request**: Ask Codex to review fixes and respond to rebuttals

Format:
```
## Fixed Issues
- ISSUE-1: Applied parameterized query fix
- ISSUE-2: Moved credentials to environment variables

## Disputed Issues
- ISSUE-3: False positive - authentication middleware present
  Evidence: [code snippet showing middleware]
  
- ISSUE-5: Severity should be MEDIUM not HIGH
  Reason: Internal-only endpoint with rate limiting

## Your Task
1. Verify the fixes for ISSUE-1 and ISSUE-2
2. Respond to rebuttals for ISSUE-3 and ISSUE-5
3. Check for new security issues introduced by fixes
```

### Step 2: Resume Thread

```bash
echo "$ROUND2_PROMPT" | node "$RUNNER" start \
  --working-dir "$PWD" \
  --effort "$EFFORT" \
  --thread-id "$THREAD_ID"
```

### Step 3: Parse Round 2 Response

Look for:
- **RESPONSE-{N}** blocks (responses to rebuttals)
- **New ISSUE-{N}** blocks (issues in fixes)
- **Updated VERDICT**

### Step 4: Iterate Until Consensus

Continue rounds until:
- ✅ **VERDICT: APPROVE** - All critical/high issues resolved
- ⚠️ **Stalemate** - Same disputes for 2+ rounds, no progress
- 🛑 **User stops** - Manual intervention needed

---

## Phase 5: Completion and Cleanup

### Step 1: Stop Codex Process

```bash
node "$RUNNER" stop "$STATE_DIR"
```

### Step 2: Generate Final Security Report

```markdown
# Security Review Summary

**Project**: {project_name}
**Scope**: {scope}
**Effort**: {effort}
**Rounds**: {round_count}
**Duration**: {duration}

## Final Verdict: {APPROVE | REVISE | STALEMATE}

## Security Risk Assessment: {CRITICAL | HIGH | MEDIUM | LOW}

### Issues Found: {total_count}
- Critical: {critical_count} ({fixed_count} fixed, {open_count} open)
- High: {high_count} ({fixed_count} fixed, {open_count} open)
- Medium: {medium_count} ({fixed_count} fixed, {open_count} open)
- Low: {low_count} ({fixed_count} fixed, {open_count} open)

### Resolved Issues
1. ISSUE-1: SQL injection - FIXED
2. ISSUE-2: Hardcoded credentials - FIXED

### Remaining Issues
1. ISSUE-5: Weak password policy - OPEN (severity disputed)

### Recommendations
1. Rotate AWS credentials immediately (ISSUE-2)
2. Run dynamic security testing (DAST) for runtime issues
3. Schedule penetration testing for production deployment
4. Implement pre-commit hooks for secrets detection

### Next Steps
- [ ] Apply remaining fixes
- [ ] Security expert review for disputed findings
- [ ] Update security documentation
- [ ] Schedule follow-up security audit
```

### Step 3: Archive Review Artifacts

```bash
# Copy review artifacts to project docs
mkdir -p docs/security-reviews
cp "$STATE_DIR/review.md" "docs/security-reviews/review-$(date +%Y%m%d).md"
cp "$STATE_DIR/output.jsonl" "docs/security-reviews/review-$(date +%Y%m%d).jsonl"
```

---

## Polling Output Parsing

### Poll Output Format

```
POLL:running:45s:3:Codex is analyzing src/auth.js for authentication vulnerabilities
```

Format: `POLL:{status}:{elapsed}:{line_count}:{activity}`

### Activity Extraction

Parse the activity field and report specific details:

**Good examples**:
- "Analyzing authentication logic in src/auth.js"
- "Checking SQL queries in src/db/users.js for injection vulnerabilities"
- "Scanning config/ directory for hardcoded secrets"
- "Reviewing session management in src/middleware/session.js"

**Bad examples** (too generic):
- "Codex is running"
- "Processing files"
- "Analyzing code"

### Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| `running` | In progress | Continue polling |
| `completed` | Finished | Parse results |
| `failed` | Error occurred | Check error.log |
| `timeout` | Exceeded timeout | Stop and report |
| `stalled` | No output for 3min | Stop and report |

---

## Session Output

After the final round completes (or after Round 1 for single-round skills), create a persistent session directory:

```bash
SESSION_DIR=".codex-review/sessions/codex-security-review-$(date +%s)-$$"
mkdir -p "$SESSION_DIR"
cp "$STATE_DIR/review.md" "$SESSION_DIR/review.md"
cat > "$SESSION_DIR/meta.json" << 'METAEOF'
{
  "skill": "codex-security-review",
  "version": 14,
  "effort": "$EFFORT",
  "scope": "$SCOPE",
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

### Common Errors

#### 1. Codex CLI Not Found
```
Error: codex CLI not found in PATH
```
**Solution**: Install Codex CLI or add to PATH

#### 2. Working Directory Invalid
```
Error: working directory does not exist: /path/to/project
```
**Solution**: Verify path and permissions

#### 3. Base Branch Not Found (Branch Mode)
```
Error: base branch 'main' does not exist
```
**Solution**: Verify branch name, try `git branch -a`

#### 4. No Changes to Review (Working-tree Mode)
```
Warning: No uncommitted changes found
```
**Solution**: Switch to `branch` or `full` mode

#### 5. Timeout Exceeded
```
POLL:timeout:3600s:150:Review exceeded timeout
```
**Solution**: Increase timeout or reduce scope

### Recovery Strategies

1. **Timeout**: Increase `--timeout` parameter
2. **Stalled**: Check network, restart Codex
3. **Parse Error**: Fallback to manual review of output.jsonl
4. **False Positives**: Lower confidence threshold, focus on high-confidence findings

---

## Effort Level Impact

### Low Effort
- **Depth**: Surface-level patterns only
- **Coverage**: Common vulnerabilities (OWASP Top 5)
- **Time**: ~5-10 minutes
- **Best for**: Quick pre-commit check

### Medium Effort
- **Depth**: Standard security review
- **Coverage**: OWASP Top 10 + secrets
- **Time**: ~15-30 minutes
- **Best for**: Pre-merge review

### High Effort
- **Depth**: Deep analysis with context
- **Coverage**: OWASP Top 10 + CWE patterns + supply chain
- **Time**: ~30-60 minutes
- **Best for**: Pre-production security audit

### XHigh Effort
- **Depth**: Exhaustive analysis
- **Coverage**: All security patterns + edge cases
- **Time**: ~60-120 minutes
- **Best for**: Critical systems, regulated industries

---

## Scope-Specific Workflows

### Working-Tree Mode

```bash
# 1. Check for uncommitted changes
git status --short

# 2. Get diff
git diff HEAD

# 3. Start review (prompt should be piped via stdin)
echo "$SECURITY_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort high

# 4. Focus on changed lines and surrounding context
```

### Branch Mode

```bash
# 1. Discover base branch
git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'

# 2. Validate base branch exists
git rev-parse --verify origin/main

# 3. Get branch diff
git diff origin/main...HEAD

# 4. Start review (prompt should be piped via stdin)
echo "$SECURITY_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort high

# 5. Review all commits in branch
git log origin/main..HEAD --oneline
```

### Full Codebase Mode

```bash
# 1. Identify critical files
find . -name "*.js" -o -name "*.py" -o -name "*.java" | grep -E "(auth|login|password|token|api|admin)"

# 2. Start review (may take longer, prompt should be piped via stdin)
echo "$SECURITY_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort high

# 3. Prioritize high-risk areas:
#    - Authentication/authorization
#    - Database queries
#    - External API calls
#    - File operations
#    - Cryptographic operations
```

---

## Best Practices

### Before Review
1. ✅ Commit or stash unrelated changes
2. ✅ Update dependencies to latest versions
3. ✅ Run existing security tests
4. ✅ Review recent security advisories for dependencies

### During Review
1. ✅ Focus on high/critical findings first
2. ✅ Verify findings manually before applying fixes
3. ✅ Test fixes in development environment
4. ✅ Document security decisions

### After Review
1. ✅ Run tests after applying fixes
2. ✅ Update security documentation
3. ✅ Schedule follow-up reviews
4. ✅ Share findings with team

### Security Review Checklist
- [ ] All critical issues resolved
- [ ] High severity issues addressed or documented
- [ ] Secrets rotated if exposed
- [ ] Security tests added for fixed vulnerabilities
- [ ] Team notified of security changes
- [ ] Security documentation updated

---

## Integration with CI/CD

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running security review on staged changes..."
node "$RUNNER" start --working-dir "$PWD" --effort low

if grep -q "VERDICT: REVISE" "$SESSION_DIR/review.md"; then
  echo "❌ Security issues found. Commit blocked."
  echo "Run 'codex-security-review' for details."
  exit 1
fi

echo "✅ Security check passed"
exit 0
```

### GitHub Actions

```yaml
name: Security Review
on: [pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Codex CLI
        run: npm install -g @openai/codex
      - name: Run Security Review
        run: |
          node codex-runner.js start --working-dir . --effort high
          cat "$SESSION_DIR/review.md" >> $GITHUB_STEP_SUMMARY
```

---

**End of Workflow Documentation**
