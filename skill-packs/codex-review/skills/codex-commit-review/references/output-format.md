# Output Format Contract

Use this exact shape:

```markdown
### ISSUE-{N}: {Short title}
- Category: clarity | convention | scope | accuracy | structure
- Severity: low | medium | high | critical
- Problem: {clear statement}
- Evidence: {specific text or diff reference}
- Suggested fix: {concrete message edit}

### VERDICT
- Status: APPROVE | REVISE
- Reason: {short reason}
```

If no issues remain, return only `VERDICT` with `Status: APPROVE`.
