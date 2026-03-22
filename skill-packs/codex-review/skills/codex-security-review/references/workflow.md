# Security Review Workflow

## Smart Default Detection

> **Context:** These detection commands run inside Claude Code where `git` is available. They assume a git repository. All `git` commands are wrapped in `2>/dev/null` to fail silently for non-git directories or edge cases (detached HEAD, no upstream tracking branch set). Detection is best-effort — if a command fails, the fallback default is used.

Before asking the user anything, auto-detect and announce:

**scope detection (FIRST):**
```bash
HAS_WORKING_CHANGES=$(git status --short 2>/dev/null | grep -v '^??' | wc -l)
HAS_BRANCH_COMMITS=$(git rev-list @{u}..HEAD 2>/dev/null | wc -l)
if [ "$HAS_WORKING_CHANGES" -gt 0 ]; then SCOPE="working-tree"
elif [ "$HAS_BRANCH_COMMITS" -gt 0 ]; then SCOPE="branch"
else SCOPE=""  # ask user
fi
```

**effort detection (AFTER scope — adapts to detected scope):**
```bash
if [ "$SCOPE" = "branch" ]; then
  FILES_CHANGED=$(git diff --name-only @{u}..HEAD 2>/dev/null | wc -l)
else
  FILES_CHANGED=$(git diff --name-only 2>/dev/null | wc -l)
fi
if [ "$FILES_CHANGED" -lt 10 ]; then EFFORT="medium"
elif [ "$FILES_CHANGED" -lt 50 ]; then EFFORT="high"
else EFFORT="xhigh"
fi
# Fallback: default high
EFFORT=${EFFORT:-high}
```

Announce: `"Detected: scope=working-tree, effort=high (23 files changed). Proceeding — reply to override."`

Only block execution for `$SCOPE` when both detection methods return 0 (no changes anywhere).

---

## Overview

This document describes the execution workflow for security-focused code review using the `codex-security-review` skill.

---

## Phase 1: Setup and Initialization

### Step 1: Detect Scope and Base Branch

**Auto-detect scope**:
- Run `git status --short` — non-empty output → `working-tree`
- Else run `git rev-list @{u}..HEAD` — non-empty → `branch`
- If both conditions true, use `working-tree`
- If neither, ask user or default to `full`

**For branch mode, determine base branch**:
- Check if upstream is set: `git rev-parse --abbrev-ref @{u}` → use upstream's branch
- Else try `main`: `git rev-parse --verify main`
- Else try `master`: `git rev-parse --verify master`
- Else use remote HEAD: `git symbolic-ref refs/remotes/origin/HEAD`
- If all fail, ask user for base branch name

Store as `$BASE_BRANCH` for branch mode.

### Step 2: Validate Prerequisites

- Verify inside a git repository: `git rev-parse --show-toplevel`. If not a git repo, abort (unless scope=full on non-git project).
- **Working-tree mode**: verify changes exist: `git diff --quiet && git diff --cached --quiet` must FAIL.
- **Branch mode**: verify base branch exists: `git rev-parse --verify $BASE_BRANCH`. Verify diff exists: `git diff $BASE_BRANCH...HEAD --quiet` must FAIL.
- **Full mode**: no additional git checks needed (scans entire codebase).

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

### Step 1.8: Assemble Prompt

Build `$PROMPT` using multi-step placeholder replacement.
DO NOT use a single sed pipeline — `output-format.md` may contain `&`, `\`, `/` characters
that corrupt sed replacements. Use `printf '%s'` piping.

a) Extract only the Round 1 prompt section from `references/prompts.md`:
   - Start from `## Security Review Prompt (Round 1)`
   - End before `## Security Review Prompt - Working Tree Mode`
   - Do NOT include Round 2+ prompt sections
b) Replace `{WORKING_DIR}` with current working directory
c) Replace `{SCOPE}` with detected `$SCOPE` value
d) Replace `{EFFORT}` with detected `$EFFORT` value
e) Replace `{SCOPE_SPECIFIC_INSTRUCTIONS}` with the scope-specific block from prompts.md
   matching the detected `$SCOPE` (working-tree / branch / full)
f) Replace `{OUTPUT_FORMAT}` by reading `references/output-format.md` in full
   using: `printf '%s' "$(cat references/output-format.md)"`
g) Replace `{BASE_BRANCH}` with `$BASE_BRANCH` (branch mode only)
h) Replace any remaining placeholders

Store result as `$PROMPT`.

Verify: `$PROMPT` must contain no prematurely-closed triple-backtick fences.

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

# Initialize session and start review
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}

START_OUTPUT=$(printf '%s' "$PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort "$EFFORT")
```

**Validate init output:** Verify `INIT_OUTPUT` starts with `CODEX_SESSION:`. If not, report error.
**Validate start output:** Verify `START_OUTPUT` starts with `CODEX_STARTED:`. If not, report error.

### Phase 2, Step 2.5: Information Barrier — Claude Independent Security Analysis

MUST complete before polling Codex output.
Codex is running in background (typically 90-180s) — use this time.

Using `references/claude-analysis-template.md`:
- Read all files in scope directly (do NOT read `$SESSION_DIR/review.md`)
- Identify top attack surfaces
- Form an independent FINDING-{N} list using OWASP categories
- Note high-confidence vs uncertain findings

Keep analysis in working context. Do NOT write a file.
INFORMATION BARRIER ends after Round 1 poll completes.
From Round 2 onwards, the barrier no longer applies.

### Step 2: Poll for Progress

Use adaptive polling intervals:
- **Round 1**: 60s, 60s, 30s, 15s, 15s, 15s...
- **Round 2+**: 30s, 15s, 15s, 15s...

```bash
node "$RUNNER" poll "$SESSION_DIR"
```

**Parse poll output** and report specific activities:
- ✅ "Codex is analyzing authentication logic in src/auth.js"
- ✅ "Checking for SQL injection patterns in database queries"
- ✅ "Scanning for hardcoded credentials in config files"
- ❌ "Codex is running" (too generic)

### Step 3: Parse Security Findings

When poll returns `POLL:completed`:

### Cross-Analysis: Build FINDING↔ISSUE Mapping Table

Map Claude's FINDING-{N} (from Step 2.5) against Codex's ISSUE-{N}:

| Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
|--------------------|-----------------|----------------|
| ...                | ...             | ...            |

Classification options:
- **Genuine Agreement**: Same vulnerability class + same file/line area
- **Genuine Disagreement**: Same code area but conflicting assessment
- **Same Direction / Different Severity**: Both flag same issue but different severity
- **Claude-only**: Claude's finding has no Codex counterpart
- **Codex-only**: Codex's finding has no Claude counterpart

After mapping, proceed with existing finding processing below.

1. Read review output from `$SESSION_DIR/review.md`
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

After parsing each round's review, append round summary to `$SESSION_DIR/rounds.json`:
- Read existing rounds.json or start with empty array `[]`
- Append: `{ "round": N, "elapsed_seconds": ..., "verdict": "...", "issues_found": ..., "issues_fixed": ..., "issues_disputed": ... }`
- Write back to `$SESSION_DIR/rounds.json`

### Step 4: Present Findings to User

Group findings by severity:

```markdown
# Security Review Results - Round 1

**Verdict**: CONTINUE
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

#### Response 1: Rebuttal

Write concrete proof that the finding is wrong:

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

#### Response 2: Acknowledge with Severity Dispute

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
START_OUTPUT=$(printf '%s' "$ROUND2_PROMPT" | node "$RUNNER" resume "$SESSION_DIR" --effort "$EFFORT")
```

### Step 3: Parse Round 2 Response

Look for:
- **RESPONSE-{N}** blocks (responses to rebuttals)
- **New ISSUE-{N}** blocks (issues in fixes)
- **Updated VERDICT**

### Step 4: Iterate Until Consensus

Continue rounds until:
- ✅ **VERDICT: CONSENSUS** - All critical/high issues resolved
- ⚠️ **Stalemate** - Same disputes for 2+ rounds, no progress
- 🛑 **User stops** - Manual intervention needed

---

## Phase 5: Completion and Cleanup

### Step 1: Stop Codex Process

```bash
node "$RUNNER" stop "$SESSION_DIR"
```

### Step 2: Generate Final Security Report

```markdown
# Security Review Summary

**Project**: {project_name}
**Scope**: {scope}
**Effort**: {effort}
**Rounds**: {round_count}
**Duration**: {duration}

## Final Verdict: {CONSENSUS | CONTINUE | STALEMATE}

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

---

## Polling Output Parsing

After each poll, report **specific activities** to the user using the `SUMMARY:` line from poll stdout. NEVER say generic messages like "Codex is running" or "still waiting" — these provide no information.

**Poll stdout format:**
- Line 1: `POLL:{status}:{elapsed}[:{exit_code}:{details}]`
- Line 2 (if completed): `THREAD_ID:{id}`
- Line 2 (if running): `SUMMARY:{activity description}`

**Report template:** `"Codex [{elapsed}s]: {summary}"` — read the SUMMARY line and report it directly to the user.

### Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| `running` | In progress | Continue polling |
| `completed` | Finished | Parse results |
| `failed` | Error occurred | Check error.log |
| `timeout` | Exceeded timeout | Stop and report |
| `stalled` | No output for 3min | Stop and report |

---

## Session Finalization

After the final round completes, write session metadata to the session directory (review.md is already present from poll):

```bash
cat > "$SESSION_DIR/meta.json" << METAEOF
{
  "skill": "codex-security-review",
  "version": 15,
  "effort": "$EFFORT",
  "scope": "$SCOPE",
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

# 3. Initialize session and start review (prompt should be piped via stdin)
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
START_OUTPUT=$(printf '%s' "$SECURITY_PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort high)

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

# 4. Initialize session and start review (prompt should be piped via stdin)
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
START_OUTPUT=$(printf '%s' "$SECURITY_PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort high)

# 5. Review all commits in branch
git log origin/main..HEAD --oneline
```

### Full Codebase Mode

```bash
# 1. Identify critical files
find . -name "*.js" -o -name "*.py" -o -name "*.java" | grep -E "(auth|login|password|token|api|admin)"

# 2. Initialize session and start review (may take longer, prompt should be piped via stdin)
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
START_OUTPUT=$(printf '%s' "$SECURITY_PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort high)

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
INIT_OUTPUT=$(node "$RUNNER" init --skill-name codex-security-review --working-dir "$PWD")
SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
START_OUTPUT=$(printf '%s' "$SECURITY_PROMPT" | node "$RUNNER" start "$SESSION_DIR" --effort low)

# Poll until complete
while true; do
  POLL=$(node "$RUNNER" poll "$SESSION_DIR")
  case "$POLL" in POLL:running:*) sleep 15;; *) break;; esac
done

VERDICT_COUNT=$(awk '/^VERDICT: (CONSENSUS|CONTINUE|STALEMATE)$/ {count++} END {print count+0}' "$SESSION_DIR/review.md" 2>/dev/null)
CONSENSUS_COUNT=$(awk '/^VERDICT: CONSENSUS$/ {count++} END {print count+0}' "$SESSION_DIR/review.md" 2>/dev/null)
[ -n "$VERDICT_COUNT" ] || VERDICT_COUNT=0
[ -n "$CONSENSUS_COUNT" ] || CONSENSUS_COUNT=0

if [ "$VERDICT_COUNT" -ne 1 ] || [ "$CONSENSUS_COUNT" -ne 1 ]; then
  echo "❌ Security issues found or review incomplete. Commit blocked."
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
          INIT_OUTPUT=$(node codex-runner.js init --skill-name codex-security-review --working-dir .)
          SESSION_DIR=${INIT_OUTPUT#CODEX_SESSION:}
          printf '%s' "$SECURITY_PROMPT" | node codex-runner.js start "$SESSION_DIR" --effort high
          while true; do
            POLL=$(node codex-runner.js poll "$SESSION_DIR")
            case "$POLL" in POLL:running:*) sleep 15;; *) break;; esac
          done
          cat "$SESSION_DIR/review.md" >> $GITHUB_STEP_SUMMARY
```

---

**End of Workflow Documentation**
