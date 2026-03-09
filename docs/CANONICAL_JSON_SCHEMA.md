# Canonical JSON Schema for Review Findings

**Version**: 1.0.0  
**Purpose**: Single source of truth for all review outputs, rendered to Markdown and SARIF

---

## Design Principles

1. **Single Source of Truth**: All review data stored in JSON, rendered to multiple formats
2. **Extensible**: Support current 7 skills + future skills (security, performance, etc.)
3. **SARIF-Compatible**: Maps cleanly to SARIF 2.1.0 specification
4. **Backward Compatible**: Preserves all information from current markdown output
5. **Enhanced Metadata**: Supports file locations, confidence scores, cross-references

---

## Schema Structure

### Root Object

```json
{
  "schema_version": "1.0.0",
  "tool": {
    "name": "codex-review",
    "version": "9",
    "skill": "codex-impl-review",
    "invocation": {
      "working_dir": "/path/to/project",
      "effort": "high",
      "mode": "working-tree",
      "timestamp": "2026-03-07T12:00:00Z",
      "thread_id": "thread_abc123"
    }
  },
  "review": {
    "verdict": "APPROVE | REVISE | COMMENT",
    "status": "complete | stalemate | in-progress",
    "round": 3,
    "summary": {
      "files_reviewed": 12,
      "issues_found": 5,
      "issues_fixed": 2,
      "issues_disputed": 1
    }
  },
  "findings": [
    // Array of Finding objects (see below)
  ],
  "metadata": {
    "duration_seconds": 180,
    "tokens_used": 15000,
    "model": "gpt-5.3-codex"
  }
}
```

---

## Finding Object (ISSUE-{N})

Supports all current skill types: plan-review, impl-review, commit-review, PR-review, codebase-review

```json
{
  "id": "ISSUE-1",
  "type": "issue",
  "title": "Null pointer dereference in authentication handler",
  "category": "bug",
  "severity": "error",
  "confidence": "high",
  
  "location": {
    "file": "src/auth.js",
    "start_line": 42,
    "end_line": 45,
    "start_column": 5,
    "end_column": 20
  },
  
  "problem": "The `user` object is accessed without null check after database query.",
  
  "evidence": {
    "code_snippet": "const user = await db.query(...);\nreturn user.id;",
    "context": "This occurs in the login handler after failed authentication attempts."
  },
  
  "suggested_fix": {
    "description": "Add null check before accessing user properties",
    "code": "const user = await db.query(...);\nif (!user) throw new AuthError('User not found');\nreturn user.id;",
    "diff": "@@ -42,1 +42,2 @@\n const user = await db.query(...);\n+if (!user) throw new AuthError('User not found');\n return user.id;"
  },
  
  "related": ["ISSUE-3", "ISSUE-5"],
  "external_refs": [
    {
      "type": "cwe",
      "id": "CWE-476",
      "url": "https://cwe.mitre.org/data/definitions/476.html"
    },
    {
      "type": "owasp",
      "id": "A01:2021",
      "url": "https://owasp.org/Top10/A01_2021-Broken_Access_Control/"
    }
  ],
  
  "status": "open | fixed | disputed | accepted",
  "resolution": {
    "action": "fixed | rebutted | deferred",
    "comment": "Applied suggested fix in round 2",
    "round": 2
  }
}
```

---

## Finding Object (PERSPECTIVE-{N})

For `codex-think-about` skill only

```json
{
  "id": "PERSPECTIVE-1",
  "type": "perspective",
  "title": "Microservices vs Monolith trade-offs",
  "perspective_type": "insight | consideration | recommendation | open-question",
  "confidence": "high",
  "source": "Claude | Codex | Consensus",
  
  "content": "Detailed explanation of the insight or consideration...",
  
  "implications": "What this means for the project architecture and team...",
  
  "next_steps": [
    "Evaluate current team size and expertise",
    "Assess deployment infrastructure maturity",
    "Consider gradual migration path"
  ],
  
  "related": ["PERSPECTIVE-2"],
  "status": "open | agreed | disagreed"
}
```

---

## Finding Object (CROSS-{N})

For `codex-codebase-review` cross-cutting findings only

```json
{
  "id": "CROSS-1",
  "type": "cross-cutting",
  "title": "Inconsistent error handling across modules",
  "category": "inconsistency | api-contract | dry-violation | integration | architecture",
  "severity": "medium",
  "confidence": "high",
  
  "pattern": "Three modules use different error handling strategies",
  
  "affected_modules": [
    {
      "module": "auth",
      "files": ["src/auth/login.js", "src/auth/register.js"],
      "pattern": "throw Error"
    },
    {
      "module": "api",
      "files": ["src/api/routes.js"],
      "pattern": "return { error: ... }"
    },
    {
      "module": "db",
      "files": ["src/db/query.js"],
      "pattern": "callback(err, null)"
    }
  ],
  
  "problem": "Inconsistent error handling makes it hard to implement global error middleware",
  
  "suggested_fix": {
    "description": "Standardize on throw Error pattern across all modules",
    "rationale": "Enables centralized error handling and logging"
  },
  
  "validation": {
    "verified_by": "codex",
    "action": "accept | reject | revise",
    "comment": "Confirmed - this is a real inconsistency"
  }
}
```

---

## Finding Object (RESPONSE-{N})

For `codex-parallel-review` debate phase only

```json
{
  "id": "RESPONSE-1",
  "type": "response",
  "title": "Re: SQL injection vulnerability in user search",
  "target": "SQL injection vulnerability in user search",
  "action": "accept | reject | revise",
  "reason": "Valid security concern. The parameterized query fix is correct and necessary.",
  "confidence": "high",
  
  "revised_finding": {
    "description": "Optional: if action=revise, provide modified position",
    "suggested_fix": {
      "description": "Alternative approach...",
      "code": "// revised code..."
    }
  },
  
  "counter_evidence": "Optional: if action=reject, provide evidence against the original finding",
  
  "status": "open | resolved"
}
```

**Field Descriptions:**
- `target`: Extracted from title format "Re: {original finding title}"
- `action`: Codex's decision on the disputed finding
  - `accept`: Agrees with Claude's finding/rebuttal
  - `reject`: Disagrees, provides counter-evidence
  - `revise`: Offers modified position
- `reason`: Evidence-based reasoning for the action
- `revised_finding`: Only present if action=revise
- `counter_evidence`: Only present if action=reject

**Usage:**
RESPONSE findings appear during parallel-review debate rounds when Codex responds to disputed findings. They are parsed but excluded from SARIF output (debate metadata, not actionable issues).

---

## Verdict Object

```json
{
  "verdict": "APPROVE | REVISE | COMMENT",
  "reason": "All critical issues have been addressed. Two minor suggestions remain.",
  "conditions": [
    "ISSUE-1 must be fixed before merge",
    "ISSUE-3 should be addressed in follow-up PR"
  ],
  "next_steps": [
    "Apply suggested fixes for ISSUE-1 and ISSUE-2",
    "Re-run tests after changes",
    "Resume review for final approval"
  ]
}
```

---

## Category Taxonomy

### Core Categories (All Skills)

```json
{
  "core_categories": [
    "correctness",
    "security",
    "performance",
    "maintainability",
    "edge-case"
  ]
}
```

### Skill-Specific Extensions

```json
{
  "plan-review": ["architecture", "sequencing", "risk", "scope"],
  "impl-review": ["bug", "edge-case", "security", "performance", "maintainability"],
  "commit-review": ["clarity", "convention", "scope", "accuracy", "structure"],
  "pr-review": ["bug", "edge-case", "security", "performance", "maintainability", "pr-description", "commit-hygiene", "scope"],
  "security-review": ["injection", "broken-auth", "sensitive-data", "xxe", "broken-access", "security-config", "xss", "insecure-deserialization", "logging", "ssrf"],
  "performance-review": ["database", "algorithm", "memory", "concurrency", "caching", "network"],
  "a11y-review": ["aria", "keyboard", "contrast", "semantic", "focus", "screen-reader"],
  "test-review": ["missing-test", "edge-case", "brittle-test", "over-mocking", "assertion-quality"],
  "docs-review": ["api-docs", "readme", "comments", "changelog", "architecture-docs"],
  "codebase-review": ["bug", "edge-case", "security", "performance", "maintainability", "inconsistency", "api-contract", "dry-violation", "integration", "architecture"]
}
```

---

## Severity Levels

```json
{
  "severity_levels": {
    "critical": "System-breaking issues, security vulnerabilities, data loss",
    "error": "Bugs that cause incorrect behavior, must fix before merge",
    "warning": "Code smells, maintainability issues, should fix",
    "note": "Suggestions, style improvements, optional",
    "info": "Informational findings, no action required"
  }
}
```

Maps to SARIF levels:
- `critical` → `error`
- `error` → `error`
- `warning` → `warning`
- `note` → `note`
- `info` → `none`

---

## Confidence Levels

```json
{
  "confidence_levels": {
    "high": "AI is very confident (>90% certainty)",
    "medium": "AI is moderately confident (60-90% certainty)",
    "low": "AI is uncertain (<60% certainty), human review recommended"
  }
}
```

---

## Complete Example: impl-review Output

```json
{
  "schema_version": "1.0.0",
  "tool": {
    "name": "codex-review",
    "version": "9",
    "skill": "codex-impl-review",
    "invocation": {
      "working_dir": "/home/user/project",
      "effort": "high",
      "mode": "working-tree",
      "timestamp": "2026-03-07T12:30:00Z",
      "thread_id": "thread_xyz789"
    }
  },
  "review": {
    "verdict": "REVISE",
    "status": "complete",
    "round": 2,
    "summary": {
      "files_reviewed": 5,
      "issues_found": 3,
      "issues_fixed": 1,
      "issues_disputed": 0
    }
  },
  "findings": [
    {
      "id": "ISSUE-1",
      "type": "issue",
      "title": "SQL injection vulnerability in user search",
      "category": "security",
      "severity": "critical",
      "confidence": "high",
      "location": {
        "file": "src/api/users.js",
        "start_line": 23,
        "end_line": 25
      },
      "problem": "User input is directly interpolated into SQL query without sanitization.",
      "evidence": {
        "code_snippet": "const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;",
        "context": "This endpoint is publicly accessible and accepts arbitrary user input."
      },
      "suggested_fix": {
        "description": "Use parameterized queries to prevent SQL injection",
        "code": "const query = 'SELECT * FROM users WHERE name = $1';\nconst result = await db.query(query, [req.query.name]);",
        "diff": "@@ -23,1 +23,2 @@\n-const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;\n+const query = 'SELECT * FROM users WHERE name = $1';\n+const result = await db.query(query, [req.query.name]);"
      },
      "related": [],
      "external_refs": [
        {
          "type": "cwe",
          "id": "CWE-89",
          "url": "https://cwe.mitre.org/data/definitions/89.html"
        },
        {
          "type": "owasp",
          "id": "A03:2021",
          "url": "https://owasp.org/Top10/A03_2021-Injection/"
        }
      ],
      "status": "open",
      "resolution": null
    },
    {
      "id": "ISSUE-2",
      "type": "issue",
      "title": "Missing error handling in async function",
      "category": "bug",
      "severity": "error",
      "confidence": "high",
      "location": {
        "file": "src/api/users.js",
        "start_line": 45,
        "end_line": 48
      },
      "problem": "Async function does not handle promise rejection, causing unhandled rejection warnings.",
      "evidence": {
        "code_snippet": "async function getUser(id) {\n  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);\n  return user;\n}",
        "context": "Called from Express route handler without try-catch."
      },
      "suggested_fix": {
        "description": "Add try-catch block to handle database errors",
        "code": "async function getUser(id) {\n  try {\n    const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);\n    return user;\n  } catch (err) {\n    throw new DatabaseError('Failed to fetch user', { cause: err });\n  }\n}"
      },
      "related": [],
      "external_refs": [],
      "status": "fixed",
      "resolution": {
        "action": "fixed",
        "comment": "Applied suggested fix with custom error class",
        "round": 2
      }
    },
    {
      "id": "ISSUE-3",
      "type": "issue",
      "title": "Inefficient N+1 query pattern",
      "category": "performance",
      "severity": "warning",
      "confidence": "medium",
      "location": {
        "file": "src/api/posts.js",
        "start_line": 67,
        "end_line": 72
      },
      "problem": "Loop executes separate database query for each post to fetch author details.",
      "evidence": {
        "code_snippet": "for (const post of posts) {\n  post.author = await db.query('SELECT * FROM users WHERE id = $1', [post.author_id]);\n}",
        "context": "This runs N queries for N posts, causing performance issues with large datasets."
      },
      "suggested_fix": {
        "description": "Use JOIN or batch query to fetch all authors in single query",
        "code": "const authorIds = posts.map(p => p.author_id);\nconst authors = await db.query('SELECT * FROM users WHERE id = ANY($1)', [authorIds]);\nconst authorMap = Object.fromEntries(authors.map(a => [a.id, a]));\nposts.forEach(post => post.author = authorMap[post.author_id]);"
      },
      "related": [],
      "external_refs": [
        {
          "type": "article",
          "title": "N+1 Query Problem",
          "url": "https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem"
        }
      ],
      "status": "open",
      "resolution": null
    }
  ],
  "verdict": {
    "verdict": "REVISE",
    "reason": "One critical security issue (ISSUE-1) must be fixed before merge. ISSUE-3 is a performance concern but not blocking.",
    "conditions": [
      "ISSUE-1 (SQL injection) must be fixed",
      "ISSUE-3 (N+1 query) should be addressed but can be deferred to follow-up PR"
    ],
    "next_steps": [
      "Apply parameterized query fix for ISSUE-1",
      "Run security tests to verify fix",
      "Resume review for final approval"
    ]
  },
  "metadata": {
    "duration_seconds": 145,
    "tokens_used": 12500,
    "model": "gpt-5.3-codex"
  }
}
```

---

## Rendering Guidelines

### JSON → Markdown

```markdown
# Code Review Results

**Verdict**: REVISE  
**Status**: Complete (Round 2)  
**Files Reviewed**: 5  
**Issues Found**: 3 (1 fixed, 2 open)

---

## 🔴 Critical Issues (1)

### ISSUE-1: SQL injection vulnerability in user search
- **Category**: security
- **Severity**: critical
- **File**: `src/api/users.js:23-25`
- **Confidence**: high

**Problem**: User input is directly interpolated into SQL query without sanitization.

**Evidence**:
```javascript
const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;
```

**Suggested Fix**:
```javascript
const query = 'SELECT * FROM users WHERE name = $1';
const result = await db.query(query, [req.query.name]);
```

**References**:
- [CWE-89: SQL Injection](https://cwe.mitre.org/data/definitions/89.html)
- [OWASP A03:2021 - Injection](https://owasp.org/Top10/A03_2021-Injection/)

---

## ✅ Fixed Issues (1)

### ISSUE-2: Missing error handling in async function
- **Status**: ✅ Fixed in round 2
...
```

### JSON → SARIF

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "codex-review",
        "version": "9",
        "informationUri": "https://github.com/lploc94/codex_skill",
        "rules": [
          {
            "id": "security/sql-injection",
            "shortDescription": { "text": "SQL Injection" },
            "fullDescription": { "text": "User input directly interpolated into SQL query" },
            "helpUri": "https://cwe.mitre.org/data/definitions/89.html"
          }
        ]
      }
    },
    "results": [
      {
        "ruleId": "security/sql-injection",
        "ruleIndex": 0,
        "level": "error",
        "message": { "text": "SQL injection vulnerability in user search" },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": { "uri": "src/api/users.js" },
            "region": { "startLine": 23, "endLine": 25 }
          }
        }],
        "fixes": [{
          "description": { "text": "Use parameterized queries" },
          "artifactChanges": [{
            "artifactLocation": { "uri": "src/api/users.js" },
            "replacements": [{
              "deletedRegion": { "startLine": 23, "endLine": 23 },
              "insertedContent": { "text": "const query = 'SELECT * FROM users WHERE name = $1';\nconst result = await db.query(query, [req.query.name]);" }
            }]
          }]
        }],
        "properties": {
          "confidence": "high",
          "category": "security",
          "external_refs": [
            { "type": "cwe", "id": "CWE-89" },
            { "type": "owasp", "id": "A03:2021" }
          ]
        }
      }
    ]
  }]
}
```

---

## Migration Path

### Phase 1: Implement Schema (Week 1-2)
1. Create JSON schema validation
2. Update codex-runner.js to output JSON
3. Implement JSON → Markdown renderer
4. Implement JSON → SARIF renderer

### Phase 2: Update Skills (Week 3)
1. Update all SKILL.md to document `--format` parameter
2. Update prompts to request structured output
3. Test with existing skills

### Phase 3: Rollout (Week 4)
1. Default to markdown (backward compatible)
2. Opt-in SARIF via `--format sarif`
3. Document migration guide

---

## Validation

JSON schema validation using Node.js built-in validation (no external dependencies):

```javascript
function validateFinding(finding) {
  // Common required fields for all types
  const commonRequired = ['id', 'type', 'title', 'confidence'];
  for (const field of commonRequired) {
    if (!finding[field]) throw new Error(`Missing required field: ${field}`);
  }
  
  // Validate type
  if (!['issue', 'perspective', 'cross-cutting', 'response'].includes(finding.type)) {
    throw new Error(`Invalid type: ${finding.type}`);
  }
  
  // Type-specific validation
  if (finding.type === 'issue' || finding.type === 'cross-cutting') {
// ISSUE-{N} and CROSS-{N} require category and severity
if (finding.type === 'issue' || finding.type === 'cross-cutting') {
  assert(finding.category, 'category required for ISSUE/CROSS');
  assert(finding.severity, 'severity required for ISSUE/CROSS');
}

// PERSPECTIVE-{N} requires perspective_type instead of category
if (finding.type === 'perspective') {
  assert(finding.perspective_type, 'perspective_type required for PERSPECTIVE');
}

// RESPONSE-{N} requires action and reason
if (finding.type === 'response') {
  assert(finding.action, 'action required for RESPONSE');
  assert(['accept', 'reject', 'revise'].includes(finding.action), 'action must be accept/reject/revise');
  assert(finding.reason, 'reason required for RESPONSE');
}
  }
  
  if (finding.type === 'perspective') {
    // PERSPECTIVE-{N} requires perspective_type instead of category
    if (!finding.perspective_type) throw new Error('Missing required field: perspective_type');
    
    if (!['insight', 'consideration', 'recommendation', 'open-question'].includes(finding.perspective_type)) {
      throw new Error(`Invalid perspective_type: ${finding.perspective_type}`);
    }
  }
  
  // Validate confidence (all types)
  if (!['high', 'medium', 'low'].includes(finding.confidence)) {
    throw new Error(`Invalid confidence: ${finding.confidence}`);
  }
  
  return true;
}
```

---

**End of Schema Documentation**
