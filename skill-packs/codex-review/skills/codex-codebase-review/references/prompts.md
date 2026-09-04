# Prompt Templates

> The runner prepends every rendered template with an **ABSOLUTE USER AUTHORITY** instruction. For review-operation decisions, it overrides this prompt, the shared protocol, skill/loop rules, defaults, and reviewer recommendations.

## Chunk Review Prompt

```
## Your Role
You are Codex reviewing one module of a larger codebase. Other modules are being reviewed in separate sessions. Focus only on the files listed below.

## Project Info
- Project type: {PROJECT_TYPE}
- Module: {CHUNK_NAME}
- Focus areas: {FOCUS_AREAS}

## Files to Review
{FILE_LIST}

(Read EVERY file listed above. Paths are relative to working directory.)

## Context from Prior Modules
{CONTEXT_SUMMARY}

(These are high/critical findings from other modules reviewed before this one. Use for awareness of cross-module patterns, but focus your review on the files listed above.)

## Instructions
1. Read ALL files listed above — do not skip any.
2. Analyze for: correctness, security vulnerabilities, performance issues, maintainability problems, edge cases.
3. Note imports/dependencies on files OUTSIDE this module — list them in "External deps" field.
4. Be thorough — findings from this module will be synthesized with other modules' findings.
5. Do not modify code directly.
6. Use required output format exactly.

## Required Output Format
For each issue found:

### ISSUE-{N}: {Short title}
- Category: bug | edge-case | security | performance | maintainability
- Severity: low | medium | high | critical
- File: {path}
- Location: {line range or function name}
- Problem: {clear statement}
- Evidence: {where/how observed}
- External deps: {imports/references outside this module, or "none"}
- Suggested fix: {concrete fix}

### VERDICT
- Status: APPROVE | REVISE
- Reason: {short reason}

If no issues found, return only VERDICT with Status: APPROVE.
```

## Validation Prompt

```
## Your Role
You are Codex validating cross-module findings. Another reviewer (Claude) analyzed findings from multiple independent module reviews and identified patterns that span modules. Verify these findings.

## Cross-cutting Findings to Verify
{CROSS_FINDINGS}

## Instructions
1. For each CROSS-{N} finding: read the referenced files and verify the claim.
2. Accept valid findings, reject false positives, revise inaccurate findings.
3. If you discover additional cross-module issues, add them.
4. Use required output format exactly.

## Required Output Format
For each finding:

### RESPONSE-{N}: Re: {original CROSS-{N} title}
- Action: accept | reject | revise
- Reason: {evidence-based reasoning}
- Revised finding (if Action is revise): {updated description}

For new findings discovered:

### ISSUE-{N}: {Short title}
- Category: inconsistency | api-contract | dry-violation | integration | architecture
- Severity: low | medium | high | critical
- Modules affected: {list}
- Problem: {description}
- Evidence: {file:line references}
- Suggested fix: {recommendation}

### VERDICT
- Status: APPROVE | REVISE
- Reason: {short reason}
```

## Context Summary Template

Compact format for context propagation between chunks. One line per prior high/critical finding. Cap total at ~2000 tokens.

```
## Prior Findings (high/critical only)
- [{chunk_name}] {title}: {one-line summary} ({severity}) in {file}
- [{chunk_name}] {title}: {one-line summary} ({severity}) in {file}
...
```

### Rules
- Include only `high` and `critical` severity findings.
- One line per finding, max ~80 chars per line.
- If context exceeds ~2000 tokens, keep most recent findings and drop oldest.
- If no prior findings: omit this section entirely from the chunk prompt.
