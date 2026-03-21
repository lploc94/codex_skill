# Security Review Output Format

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

---

## Overview

Security review findings follow the standard ISSUE-{N} format with additional security-specific fields:
- **CWE ID**: Common Weakness Enumeration identifier
- **OWASP Category**: OWASP Top 10 2021 mapping
- **Attack Vector**: Exploitation scenario
- **Confidence**: Static analysis confidence level

---

## Finding Structure

```
ISSUE-{N}: {vulnerability_title}
Category: {security_category}
Severity: critical | high | medium | low
Confidence: high | medium | low
CWE: CWE-{ID} ({Name})
OWASP: A{NN}:2021 - {Category Name}

Problem: [Clear description of the vulnerability]

Evidence: [Code snippet showing the vulnerable pattern]

Attack Vector: [How an attacker could exploit this vulnerability]

Suggested Fix: [Secure code example with explanation]
```

---

## Security Categories

### Primary Categories (OWASP Top 10 2021)

| Category | Description | Example |
|----------|-------------|---------|
| `injection` | SQL, Command, XSS, LDAP injection | Unsanitized user input in queries |
| `broken-auth` | Authentication and session management flaws | Weak password policy, session fixation |
| `sensitive-data` | Exposure of sensitive information | Hardcoded credentials, unencrypted data |
| `xxe` | XML External Entity attacks | Unsafe XML parsing |
| `broken-access` | Authorization and access control issues | Missing permission checks, IDOR |
| `security-config` | Security misconfiguration | Default credentials, verbose errors |
| `xss` | Cross-Site Scripting | Unescaped user input in HTML |
| `insecure-deserialization` | Unsafe deserialization | Pickle, YAML, JSON deserialization |
| `logging` | Insufficient logging and monitoring | Missing security event logs |
| `ssrf` | Server-Side Request Forgery | Unvalidated URLs in HTTP requests |
| `crypto-failure` | Cryptographic failures | Weak algorithms, insecure key storage |
| `insecure-design` | Fundamental design flaws | Missing rate limiting, business logic flaws |
| `vulnerable-components` | Outdated or vulnerable dependencies | Known CVEs in dependencies |
| `integrity-failure` | Software and data integrity failures | Missing integrity checks, insecure updates |

---

## Severity Levels

### Critical
- **Impact**: System compromise, data breach, remote code execution
- **Examples**:
  - SQL injection with admin access
  - Authentication bypass
  - Remote code execution
  - Hardcoded admin credentials
  - Critical dependency vulnerabilities (CVSS 9.0+)

### High
- **Impact**: Privilege escalation, significant data exposure
- **Examples**:
  - XSS with session theft
  - CSRF on sensitive operations
  - Path traversal with file read
  - Insecure deserialization
  - Missing authorization checks

### Medium
- **Impact**: Information disclosure, limited privilege escalation
- **Examples**:
  - Weak cryptography (MD5, SHA1)
  - Missing security headers
  - CORS misconfiguration
  - Verbose error messages
  - Missing rate limiting

### Low
- **Impact**: Minor security improvements, defense in depth
- **Examples**:
  - Missing security headers (non-critical)
  - Weak password requirements
  - Insufficient logging
  - Outdated dependencies (no known exploits)

---

## Confidence Levels

### High (90%+ certainty)
- Clear vulnerability pattern
- Well-known exploit technique
- Direct evidence in code
- **Examples**:
  - String concatenation in SQL queries
  - Hardcoded credentials visible in code
  - `eval()` with user input
  - Missing authentication check on sensitive endpoint

### Medium (60-90% certainty)
- Suspicious pattern, context-dependent
- May have mitigating controls elsewhere
- Requires verification
- **Examples**:
  - Potential IDOR (need to verify authorization)
  - Possible XSS (need to check output encoding)
  - Weak crypto (may be acceptable for non-sensitive data)
  - Missing input validation (may be validated elsewhere)

### Low (<60% certainty)
- Ambiguous pattern
- Likely false positive
- Needs manual verification
- **Examples**:
  - Generic variable names that might contain secrets
  - Complex authorization logic (hard to analyze statically)
  - Framework-specific security (may be handled by framework)

---

## CWE Mappings

Common CWE IDs for security findings:

| CWE ID | Name | Category |
|--------|------|----------|
| CWE-89 | SQL Injection | injection |
| CWE-79 | Cross-Site Scripting (XSS) | xss |
| CWE-78 | OS Command Injection | injection |
| CWE-22 | Path Traversal | broken-access |
| CWE-352 | Cross-Site Request Forgery (CSRF) | broken-access |
| CWE-798 | Hard-coded Credentials | sensitive-data |
| CWE-327 | Weak Cryptography | crypto-failure |
| CWE-306 | Missing Authentication | broken-auth |
| CWE-862 | Missing Authorization | broken-access |
| CWE-502 | Deserialization of Untrusted Data | insecure-deserialization |
| CWE-918 | Server-Side Request Forgery (SSRF) | ssrf |
| CWE-611 | XML External Entity (XXE) | xxe |
| CWE-601 | Open Redirect | broken-access |
| CWE-732 | Incorrect Permission Assignment | security-config |
| CWE-209 | Information Exposure Through Error | sensitive-data |

Full CWE list: https://cwe.mitre.org/

---

## OWASP Top 10 2021 Mappings

**Note**: These mappings are heuristic. CWE-to-OWASP relationships are many-to-many and context-dependent.

| OWASP ID | Category | Common CWEs |
|----------|----------|-------------|
| A01:2021 | Broken Access Control | CWE-22, CWE-352, CWE-862 |
| A02:2021 | Cryptographic Failures | CWE-327, CWE-798, CWE-326 |
| A03:2021 | Injection | CWE-78, CWE-79, CWE-89 |
| A04:2021 | Insecure Design | CWE-656, CWE-807, CWE-1021 |
| A05:2021 | Security Misconfiguration | CWE-732, CWE-16, CWE-2 |
| A06:2021 | Vulnerable Components | CWE-1104, CWE-829 |
| A07:2021 | Authentication Failures | CWE-306, CWE-287, CWE-798 |
| A08:2021 | Integrity Failures | CWE-502, CWE-829, CWE-494 |
| A09:2021 | Logging Failures | CWE-778, CWE-117, CWE-223 |
| A10:2021 | SSRF | CWE-918 |

---

## Verdict Block

```
VERDICT: APPROVE | REVISE
Status: {complete | stalemate | in-progress}
Reason: {explanation}

Security Risk Summary:
- Critical: {count} issues
- High: {count} issues
- Medium: {count} issues
- Low: {count} issues

Risk Assessment: {CRITICAL | HIGH | MEDIUM | LOW}

Recommendations:
1. [Priority action items]
2. [Additional security measures]
3. [Follow-up actions]

Blocking Issues (must fix before merge):
- ISSUE-{N}: {title}
- ISSUE-{M}: {title}

Advisory Issues (should fix, not blocking):
- ISSUE-{X}: {title}
```

### Risk Assessment Guidelines

- **CRITICAL**: One or more critical severity issues found
- **HIGH**: Multiple high severity issues or one high + several medium
- **MEDIUM**: Multiple medium severity issues, no high/critical
- **LOW**: Only low severity issues or informational findings

---

## Example: Complete Security Finding

```
ISSUE-1: SQL Injection in user search endpoint
Category: injection
Severity: critical
Confidence: high
CWE: CWE-89 (SQL Injection)
OWASP: A03:2021 - Injection

Problem: User input from query parameter `name` is directly concatenated into SQL query without sanitization or parameterization. This allows arbitrary SQL execution.

Evidence:
```javascript
// src/api/users.js:23-25
app.get('/api/users/search', async (req, res) => {
  const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;
  const users = await db.query(query);
  res.json(users);
});
```

Attack Vector: An attacker can inject malicious SQL by providing crafted input:

1. **Data Exfiltration**:
   ```
   GET /api/users/search?name=' UNION SELECT password FROM users --
   ```
   Returns all user passwords.

2. **Authentication Bypass**:
   ```
   GET /api/users/search?name=' OR '1'='1' --
   ```
   Returns all users, bypassing the name filter.

3. **Database Modification**:
   ```
   GET /api/users/search?name='; DROP TABLE users; --
   ```
   Deletes the users table.

Suggested Fix: Use parameterized queries to prevent SQL injection:

```javascript
// Secure version
app.get('/api/users/search', async (req, res) => {
  const query = 'SELECT * FROM users WHERE name = $1';
  const users = await db.query(query, [req.query.name]);
  res.json(users);
});
```

**Why this works**: Parameterized queries treat user input as data, not executable SQL code. The database driver handles proper escaping and quoting.

**Additional recommendations**:
1. Add input validation (max length, allowed characters)
2. Implement rate limiting on search endpoint
3. Use prepared statements for all database queries
4. Enable SQL query logging for security monitoring
```

---

## Example: Secrets Detection

```
ISSUE-2: Hardcoded AWS credentials in configuration
Category: sensitive-data
Severity: critical
Confidence: high
CWE: CWE-798 (Use of Hard-coded Credentials)
OWASP: A02:2021 - Cryptographic Failures

Problem: AWS access key and secret key are hardcoded in the configuration file, exposing them to anyone with repository access.

Evidence:
```javascript
// config/aws.js:5-9
const AWS_CONFIG = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1'
};
```

Attack Vector:
1. **Repository Access**: If repository is public or attacker gains access, credentials are immediately compromised
2. **Version Control History**: Even if removed, credentials remain in git history
3. **AWS Resource Access**: Attacker can:
   - Access S3 buckets and exfiltrate data
   - Launch EC2 instances for cryptomining
   - Modify IAM policies
   - Incur significant AWS costs

Suggested Fix: Use environment variables and AWS IAM roles:

```javascript
// Secure version - config/aws.js
const AWS_CONFIG = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
};

// Validate required environment variables
if (!AWS_CONFIG.accessKeyId || !AWS_CONFIG.secretAccessKey) {
  throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
}
```

**Immediate actions required**:
1. ⚠️ **URGENT**: Rotate the exposed credentials in AWS IAM immediately
2. Add `config/*.js` to `.gitignore`
3. Remove credentials from git history: `git filter-branch` or BFG Repo-Cleaner
4. Audit AWS CloudTrail for unauthorized access using these credentials

**Long-term improvements**:
1. Use AWS IAM roles for EC2/Lambda (no credentials needed)
2. Use AWS Secrets Manager for production credentials
3. Implement pre-commit hooks to detect secrets (e.g., git-secrets, truffleHog)
4. Enable AWS GuardDuty for threat detection
```

---

## Response Format (Round 2+)

```
RESPONSE-{N}: Re: ISSUE-{N}
Action: accept | reject | revise
Reason: [Response to rebuttal]

[If reject]
Counter-evidence: [Why the rebuttal is incorrect]
Maintained assessment: [Original severity/confidence]

[If revise]
Updated assessment:
- Severity: {new_severity} (was {old_severity})
- Confidence: {new_confidence} (was {old_confidence})
- Reason: [Why the assessment changed]
```

---

## Stalemate Format

```
VERDICT: STALEMATE
Reason: Unable to reach consensus after {N} rounds of debate.

Unresolved Security Issues:
1. ISSUE-{N}: {title}
   - Codex assessment: {severity}, {confidence}
   - Claude rebuttal: [Summary]
   - Recommendation: Security expert review required

2. ISSUE-{M}: {title}
   - Codex assessment: {severity}, {confidence}
   - Claude rebuttal: [Summary]
   - Recommendation: Defer to user judgment

Confirmed Vulnerabilities: {count}
Disputed Findings: {count}
Overall Risk Level: {CRITICAL | HIGH | MEDIUM | LOW}

Recommendation: {BLOCK MERGE | PROCEED WITH CAUTION | SECURITY AUDIT REQUIRED}
```

---

**End of Output Format Specification**
