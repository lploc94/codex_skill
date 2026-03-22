# Output Format Contract

> **ISSUE-{N} IDs must remain stable across rounds.** Do not renumber issues. New findings in later rounds use the next available number.

> **Note**: Categories below are code-specific (bug, edge-case, security, performance, maintainability). For plan review categories (correctness, architecture, sequencing, risk, scope), see codex-plan-review.

Use this exact shape (copy the entire block below as `{OUTPUT_FORMAT}`):

```markdown
### ISSUE-{N}: {Short title}
- Category: bug | edge-case | security | performance | maintainability
- Severity: low | medium | high | critical
- Location: {file path:line range, e.g. `src/api/users.js:23-25`}
- Problem: {clear statement}
- Evidence: {code snippet or diff excerpt showing the issue}
- Why it matters: {impact on correctness, security, performance, etc.}
- Suggested fix: {concrete code change}

### VERDICT
- Status: CONSENSUS | CONTINUE | STALEMATE
  - CONSENSUS: No remaining code issues — changes are correct and safe
  - CONTINUE: Issues remain that require fixes and another review round
  - STALEMATE: Circular debate — same disputes for 2+ rounds with no progress
- Reason: {short reason}
```

**Zero-issue rule**: If no issues remain, omit all ISSUE blocks and return only the VERDICT block with `Status: CONSENSUS` and `Reason: All changes are correct, well-tested, and safe to merge.`
