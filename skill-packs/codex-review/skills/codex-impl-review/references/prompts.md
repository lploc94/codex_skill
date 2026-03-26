# Prompt Templates

## Placeholder Injection Guide

| Placeholder | Source | Required | Default |
|-------------|--------|----------|---------|
| `{USER_REQUEST}` | User's original task/PR description | No | "Review uncommitted changes for correctness and quality" |
| `{SESSION_CONTEXT}` | Structured context block (see schema below) | No | Use structured fallback block below |
| `{OUTPUT_FORMAT}` | Copy the entire fenced code block from `references/output-format.md` (the single block after "Use this exact shape") | Yes | — |
| `{BASE_BRANCH}` | Base branch name (branch mode only) | Conditional | — |
| `{REVIEW_SCOPE}` | Scope value for SESSION_CONTEXT fallback | No | `working-tree` or `branch diff against {BASE_BRANCH}` |
| `{FIXED_ITEMS}` | Lines listing accepted+fixed issues (`ISSUE-N: title — fixed in file:line`) | No | "No issues fixed this round" |
| `{DISPUTED_ITEMS}` | Lines listing disputed issues (`ISSUE-N: title — reason`) or "None — all issues addressed" | No | "None — all issues addressed" |

### SESSION_CONTEXT Schema

```
Constraints: {e.g. "must not change public API"}
Assumptions: {e.g. "test suite covers all changed paths"}
Tech stack: {languages, frameworks, test tools}
Acceptance criteria: {what defines a good review outcome}
Review scope: {working-tree | branch diff against {BASE_BRANCH}}
```

If user provides no context, inject (replace `{REVIEW_SCOPE}` with the actual scope value only):
- Working-tree mode: `working-tree`
- Branch mode: `branch diff against {BASE_BRANCH}`

```
Constraints: None specified
Assumptions: None specified
Tech stack: Not specified — infer from codebase
Acceptance criteria: No regressions, no new bugs, maintainable code
Review scope: {REVIEW_SCOPE}
```

---

## Working Tree Review Prompt (Round 1)
```
## Your Role
You are Codex acting as a strict code reviewer.

## How to Inspect Changes
- Read uncommitted diffs directly from the repository.
- Use plan context if available.

## User's Original Request
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## Instructions
1. Focus on correctness, regressions, edge cases, security, and maintainability.
2. Do not modify code directly.
3. Output each finding as ISSUE-{N} using the EXACT format below.
4. Keep ISSUE-{N} IDs stable — do not renumber in later rounds.
5. End with a VERDICT block. Do not skip it.
6. Use required output format exactly.

## Required Output Format
{OUTPUT_FORMAT}
```

## Branch Review Prompt (Round 1)
```
## Your Role
You are Codex acting as a strict code reviewer.

## How to Inspect Changes
- Read the branch diff from the repository (git diff {BASE_BRANCH}...HEAD).
- Read the commit log (git log {BASE_BRANCH}..HEAD).
- Use plan context if available.

## Base Branch
{BASE_BRANCH}

## User's Original Request
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## Instructions
1. Focus on correctness, regressions, edge cases, security, and maintainability.
2. Do not modify code directly.
3. Output each finding as ISSUE-{N} using the EXACT format below.
4. Keep ISSUE-{N} IDs stable — do not renumber in later rounds.
5. End with a VERDICT block. Do not skip it.
6. Use required output format exactly.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt — Working-tree mode (Round 2+)

```
## Session Context
{SESSION_CONTEXT}

## Issues Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Instructions
1. Re-read the current diff — do NOT rely on memory of previous state.
2. Verify that fixed issues are actually resolved in the updated code.
3. Do NOT re-open issues marked as fixed unless you find a regression.
4. Check acceptance criteria from Session Context still hold.
5. Focus on remaining open issues and any NEW findings from the updated code.
6. Maintain the same ISSUE-{N} numbering. New findings use the next available number.
7. Keep already-fixed issues closed.
8. End with a VERDICT block.
9. VERDICT rules: Return `APPROVE` ONLY if zero issues remain (all fixed or withdrawn). Return `REVISE` if ANY issue is still open or you found new issues. Claude will send another round if you return REVISE.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt — Branch mode (Round 2+)

```
## How to Inspect Changes
- Re-read the branch diff: git diff {BASE_BRANCH}...HEAD
- Re-read the commit log: git log {BASE_BRANCH}..HEAD
- Fixes have been committed to the branch since last round.

## Session Context
{SESSION_CONTEXT}

## Issues Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Instructions
1. Re-read the branch diff against {BASE_BRANCH} — do NOT rely on memory of previous state.
2. Verify that fixed issues are actually resolved in the committed code.
3. Do NOT re-open issues marked as fixed unless you find a regression.
4. Check acceptance criteria from Session Context still hold.
5. Focus on remaining open issues and any NEW findings from the updated branch.
6. Maintain the same ISSUE-{N} numbering. New findings use the next available number.
7. Keep already-fixed issues closed.
8. End with a VERDICT block.
9. VERDICT rules: Return `APPROVE` ONLY if zero issues remain (all fixed or withdrawn). Return `REVISE` if ANY issue is still open or you found new issues. Claude will send another round if you return REVISE.

## Required Output Format
{OUTPUT_FORMAT}
```
