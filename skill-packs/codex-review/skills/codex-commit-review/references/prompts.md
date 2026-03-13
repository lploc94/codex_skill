# Prompt Templates

## Placeholder Injection Guide

| Placeholder | Source | Required | Default |
|-------------|--------|----------|---------|
| `{COMMIT_MESSAGES}` | Commit message text (draft: user text; last: git log output) | Yes | — |
| `{DIFF_CONTEXT}` | Diff command for Codex (draft: `git diff --cached`; last: `git diff HEAD~N..HEAD`) | Yes | — |
| `{USER_REQUEST}` | User's task/request description | No | "Review commit message(s) for quality and accuracy" |
| `{SESSION_CONTEXT}` | Structured context block (see schema below) | No | "Not specified" |
| `{PROJECT_CONVENTIONS}` | Discovered conventions from §1.6 | No | "None discovered — use Git general guidelines" |
| `{OUTPUT_FORMAT}` | Copy entire fenced code block from `references/output-format.md` | Yes | — |

### Last-mode additional placeholders

| Placeholder | Source | Required | Default |
|-------------|--------|----------|---------|
| `{COMMIT_LIST}` | Formatted list: `<SHA> <subject>` per commit | Yes (last mode) | — |

### Round 2+ additional placeholders

| Placeholder | Source | Required | Default |
|-------------|--------|----------|---------|
| `{FIXED_ITEMS}` | Accepted issues and how they were fixed | Yes | — |
| `{DISPUTED_ITEMS}` | Rebuttals for rejected issues | Yes | — |
| `{REVISED_MESSAGE}` | Proposed revised message text (per-commit for last N > 1) | Yes | — |

### SESSION_CONTEXT Schema

When user provides context or Claude can infer it, format as:

```
Constraints: {e.g. "team uses 72-char subject line limit"}
Assumptions: {e.g. "this is a squash commit covering multiple changes"}
Tech stack: {languages, frameworks}
Acceptance criteria: {what defines a good commit message for this project}
Review scope: {draft | last N commits}
Project conventions: {PROJECT_CONVENTIONS}
```

---

## Draft Review Prompt (Round 1)
```
## Your Role
You are Codex acting as a strict commit message reviewer.

## Task
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## Commit Message to Review
{COMMIT_MESSAGES}

## How to Inspect Changes
Run `{DIFF_CONTEXT}` to read the staged diff. Verify the message accurately describes the changes.

## Project Conventions
{PROJECT_CONVENTIONS}

## Instructions
1. Focus on message quality only — do NOT review code correctness.
2. Read the staged diff to verify message accuracy and scope.
3. Check: clarity, convention compliance, scope accuracy, structure.
4. Verify message claims match the actual diff.
5. Use EXACT output format below. Every issue must have a concrete suggested fix.

## Required Output Format
{OUTPUT_FORMAT}
```

## Last Review Prompt (Round 1)
```
## Your Role
You are Codex acting as a strict commit message reviewer.

## Task
{USER_REQUEST}

## Session Context
{SESSION_CONTEXT}

## Commits to Review
{COMMIT_LIST}

## Commit Messages
{COMMIT_MESSAGES}

## How to Inspect Changes
- For each commit, run `git show <SHA>` to see its individual diff.
- Also run `{DIFF_CONTEXT}` for aggregate diff context.
- Verify each message accurately describes its commit's changes.

## Project Conventions
{PROJECT_CONVENTIONS}

## Instructions
1. Focus on message quality only — do NOT review code correctness.
2. Inspect EACH commit's diff individually — do not rely on aggregate diff alone.
3. Check: clarity, convention compliance, scope accuracy, structure.
4. Verify each message's claims match its actual diff.
5. In Evidence field, always reference the specific commit SHA and subject.
6. Use EXACT output format below. Every issue must have a concrete suggested fix.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt — Draft mode (Round 2+)
```
## Session Context
{SESSION_CONTEXT}

## Project Conventions
{PROJECT_CONVENTIONS}

## Issues Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Revised Message
{REVISED_MESSAGE}

## Instructions
1. Re-read the staged diff: run `{DIFF_CONTEXT}`.
2. Re-review the revised message against the diff.
3. Verify fixed issues are actually resolved — do not re-open unless regression found.
4. Keep ISSUE-{N} numbering stable. New findings use the next available number.
5. Use EXACT output format. You MUST include a VERDICT block.

## Required Output Format
{OUTPUT_FORMAT}
```

## Rebuttal Prompt — Last mode (Round 2+)
```
## Session Context
{SESSION_CONTEXT}

## Project Conventions
{PROJECT_CONVENTIONS}

## Commits in Scope
{COMMIT_LIST}

## Issues Fixed
{FIXED_ITEMS}

## Issues Disputed
{DISPUTED_ITEMS}

## Revised Messages
{REVISED_MESSAGE}

## Instructions
1. Re-read each commit's diff: run `git show <SHA>` for each commit in the review.
2. Re-review revised messages against their respective diffs.
3. In Evidence, always reference specific commit SHA and subject.
4. Verify fixed issues are actually resolved — do not re-open unless regression found.
5. Keep ISSUE-{N} numbering stable. New findings use the next available number.
6. Use EXACT output format. You MUST include a VERDICT block.

## Required Output Format
{OUTPUT_FORMAT}
```
