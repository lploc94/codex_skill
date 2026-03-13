# Prompt Templates

## Placeholder Injection Guide

| Placeholder | Source | Required | Default |
|-------------|--------|----------|---------|
| `{PLAN_PATH}` | Absolute path to plan file | Yes | — |
| `{USER_REQUEST}` | User's original task description | No | "Review this plan for quality and completeness" |
| `{SESSION_CONTEXT}` | Structured context block (see schema below) | No | Use structured fallback block below |
| `{OUTPUT_FORMAT}` | Copy the entire fenced code block from `references/output-format.md` (the single block after "Use this exact shape") | Yes | — |
| `{ACCEPTANCE_CRITERIA}` | User-provided success criteria or derived from plan | No | "Derived from plan goals and stated outcomes" |

### SESSION_CONTEXT Schema

```
Constraints: {technical or resource constraints, e.g. "must use existing DB schema"}
Assumptions: {key assumptions the plan relies on}
Tech stack: {languages, frameworks, infrastructure}
Acceptance criteria: {ACCEPTANCE_CRITERIA}
```

If user provides no context, inject:
```
Constraints: None specified
Assumptions: None specified
Tech stack: Not specified — infer from plan content
Acceptance criteria: Derived from plan goals and stated outcomes
```

---

## Plan Review Prompt (Round 1)

```
## Your Role
You are Codex acting as a strict implementation-plan reviewer.

## Plan Location
Read the plan file directly at: {PLAN_PATH}

## User's Original Request
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## Instructions
1. Read the plan file at the path above directly and thoroughly.
2. Check the plan against the acceptance criteria in Session Context.
3. Identify gaps, risks, missing edge cases, and sequencing flaws.
4. Do NOT propose code changes — review only the plan quality.
5. Output each finding as ISSUE-{N} using the EXACT format below.
6. End with a VERDICT block. Do not skip it.
7. Keep ISSUE-{N} IDs stable — do not renumber in later rounds.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt (Round 2+)

```
## Updated Plan
The plan has been edited based on your previous findings.
Read the updated plan file directly at: {PLAN_PATH}

## Session Context
{SESSION_CONTEXT}

## Issues Accepted & Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Instructions
1. Re-read the current plan file at the path above — do NOT rely on memory of the previous version.
2. Verify that fixed issues are actually resolved in the updated plan.
3. Do NOT re-open issues marked as fixed unless you find a regression in the updated plan.
4. Check the plan still meets the acceptance criteria in Session Context.
5. Focus on remaining open issues and any NEW findings from the updated plan.
6. Maintain the same ISSUE-{N} numbering. New findings use the next available number.
7. End with a VERDICT block.

## Required Output Format
{OUTPUT_FORMAT}
```
