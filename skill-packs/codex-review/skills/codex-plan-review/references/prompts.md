# Prompt Templates

> The runner prepends every rendered template with an **ABSOLUTE USER AUTHORITY** instruction. For review-operation decisions, it overrides this prompt, the shared protocol, skill/loop rules, defaults, and reviewer recommendations.

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
You are Codex acting as a strict implementation-plan reviewer. Your single goal is to MAXIMIZE the plan's chance of achieving its stated target. Every finding must trace back to that goal.

You are an advisory reviewer, not the product owner. Apply this authority order: the user's latest explicit decisions, the original request and acceptance criteria, verified repository constraints, the current plan, then reviewer preferences. A finding may expose a need, but it does not authorize redefining the user's expected outcome.

## Plan Location
Read the plan file directly at: {PLAN_PATH}

## User's Original Request
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## What to Review (in priority order)
1. **Achievability**: Will this plan actually accomplish the target/acceptance criteria? If not, why.
2. **Reality check / hallucination**: Does the plan rely on technology, APIs, libraries, or capabilities that do not exist or do not behave as assumed? Does a proposed step actually solve the problem it claims to solve, or only appear to?
3. **Missing steps**: What necessary steps, prerequisites, or integration points are absent and would block reaching the target.
4. **Logic & design flaws**: Incorrect reasoning, broken sequencing, flawed architecture, race conditions, wrong data flow.
5. **Bad practices / pattern violations**: Choices that violate established engineering patterns or will cause real downstream problems.
6. **Completeness additions**: Propose adding something ONLY when it is required to actually reach the stated target.

## Anti-Over-Engineering Rules (HARD constraints)
- Do NOT propose features, abstractions, configurability, or scope beyond what the target requires.
- Do NOT suggest gold-plating, hypothetical future-proofing, or "nice to have" additions.
- If the plan already achieves the target, say so — extra polish is not an issue.
- Every suggested addition must name the concrete gap in achieving the target that it closes. If you cannot, do not raise it.
- If a potentially legitimate fix would materially change user-visible behavior, scope, acceptance criteria, architecture, compatibility, dependencies, operations, or long-term direction, classify it as `scope`. State what the current plan promises, what would change, and whether the change is required for correctness or is an optional direction. Do not assume it should be added.

## Output Instructions
1. Read the plan file at the path above directly and thoroughly.
2. Review against the criteria above, anchored to the acceptance criteria in Session Context.
3. Do NOT propose code changes — review only the plan.
4. Output each finding as ISSUE-{N} using the EXACT format below.
5. End with a VERDICT block. Do not skip it.
6. Keep ISSUE-{N} IDs stable — do not renumber in later rounds.

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
5. Focus on remaining open issues and any NEW findings that genuinely block reaching the target.
6. Stay anchored to the target. Do NOT raise scope creep, gold-plating, or additions that are not required to achieve the stated target. If the plan now achieves the target, return APPROVE — do not invent new polish.
7. Treat explicit user decisions described in Session Context or Issues Disputed as authoritative unless they make the target technically impossible; do not repeatedly propose a rejected scope expansion.
8. Maintain the same ISSUE-{N} numbering. New findings use the next available number.
9. End with a VERDICT block.
10. VERDICT rules: Return `APPROVE` ONLY if zero issues remain (all fixed or withdrawn). Return `REVISE` if ANY issue is still open or you found new issues. Claude will send another round if you return REVISE.

## Required Output Format
{OUTPUT_FORMAT}
```
