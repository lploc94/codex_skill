# Prompt Templates

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
3. Use required output format exactly.

## Required Output Format
{OUTPUT_FORMAT}
```

## Branch Review Prompt (Round 1)
```
## Your Role
You are Codex acting as a strict code reviewer.

## How to Inspect Changes
- Read the branch diff from the repository (git diff {BASE}...HEAD).
- Read the commit log (git log {BASE}..HEAD).
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
3. Use required output format exactly.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt (Round 2+)
```
## Issues Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Your Turn
Re-review the latest diff using same output format. Keep already-fixed issues closed.
```
