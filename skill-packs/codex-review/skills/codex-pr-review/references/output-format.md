# Output Format Contract

Use this exact shape:

```markdown
### ISSUE-{N}: {Short title}
- Category: bug | edge-case | security | performance | maintainability | pr-description | commit-hygiene | scope
- Severity: low | medium | high | critical
- Problem: {clear statement}
- Evidence: {where/how observed}
- Suggested fix: {concrete fix path or recommendation}

### VERDICT
- Status: APPROVE | REVISE
- Reason: {short reason}
```

If no issues remain, return only `VERDICT` with `Status: APPROVE`.
