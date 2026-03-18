# Design: UX Consistency Improvements for codex-review Skills

**Date:** 2026-03-18
**Branch:** feature/codex-auto-review
**Status:** Approved

---

## Problem Statement

The codex-review skill pack has 9 skills with inconsistent UX across three dimensions:

1. **SKILL.md structure varies** — sections appear in different orders, some skills have extra sections others don't (e.g., `codex-security-review` has inline "Output Format" and "Security Categories" sections; others delegate to references)
2. **Setup questions differ per skill** — each skill asks inputs in different ways, with no consistent vocabulary or ordering
3. **Effort table incomplete** — `codex-pr-review` and `codex-security-review` missing "Typical time" column that other skills have; `codex-codebase-review` uses a custom table structure
4. **Output location inconsistent** — only `codex-auto-review` writes structured output to disk; the other 5 single-round review skills (impl, pr, plan, commit, security) produce no persistent output
5. **"When to Use" section missing** — present in only 1 of 9 SKILL.md files

---

## Goals

- User invoking any skill experiences the same interaction pattern
- New skills added in future have a clear blueprint to follow
- Review outputs from any skill are findable in a predictable location
- Reduce friction: minimize required user responses before execution starts

---

## Non-Goals

- Changing the review/debate logic inside any skill
- Modifying `codex-runner.js` execution engine
- Adding new skills

---

## Design

### A: SKILL.md Standard Template

All SKILL.md files will follow this section order exactly. **Documented exceptions:** `Scope Guide` subsection is optional (only included for skills with a scope parameter); `codex-codebase-review` uses a custom Effort table (see below). All other sections are required in all skills.

```
---
name: codex-<skill-name>
description: <1-line description>
---

# Codex <Skill Name>

## Purpose
## When to Use
## Prerequisites
## Runner
## Workflow
  ### Effort Level Guide  (4-column table including Typical time)
  ### Scope Guide         (only for skills with scope parameter)
## Required References
## Rules
```

**Specific fixes:**

| File | Change |
|------|--------|
| `codex-pr-review/SKILL.md` | Add "Typical time" column to Effort table |
| `codex-security-review/SKILL.md` | Add "Typical time" column; move inline "Output Format" and "Security Categories" sections into existing `references/output-format.md` (update, not create) |
| `codex-codebase-review/SKILL.md` | Keep custom Effort table structure (Level/Discovery/Cross-cutting/Validation columns serve different purpose); add "Typical time" column only |
| All SKILL.md | Standardize Workflow step 1 to: `**Collect inputs**: <list>` |
| All SKILL.md | Add "When to Use" section (8 of 9 currently missing — content per skill below; `codex-plan-review` already has this section and is not changed) |

**"When to Use" content for the 8 skills missing this section:**

| Skill | When to Use (1-2 sentences) |
|-------|----------------------------|
| `codex-impl-review` | After writing code, before committing. Use for uncommitted working-tree changes or comparing a branch against base. |
| `codex-pr-review` | Before opening or merging a pull request. Reviews branch diff, commit history, and PR description together. |
| `codex-commit-review` | After staging changes (draft mode) or after committing (last mode). Use to verify commit message quality before push. |
| `codex-security-review` | When changes touch auth, crypto, SQL, user input, or file uploads. Use for security-focused pre-commit or pre-merge review. |
| `codex-parallel-review` | When you want independent dual-reviewer analysis. Produces higher-confidence findings than single-reviewer skills. |
| `codex-codebase-review` | For full codebase audit (50–500+ files). Not for incremental review — use for periodic architecture/quality sweeps. |
| `codex-think-about` | When you want to debate a technical decision or design question before implementing. Not a code review skill. |
| `codex-auto-review` | When you want zero-friction comprehensive review without deciding which skills to run. Auto-detects relevant skills. |

**Effort table standard (4 columns):**

| Level  | Depth           | Best for                    | Typical time |
|--------|-----------------|-----------------------------|--------------|
| low    | Surface check   | Quick sanity check          | ~X-Y min     |
| medium | Standard        | Most day-to-day work        | ~X-Y min     |
| high   | Deep analysis   | Important features          | ~X-Y min     |
| xhigh  | Exhaustive      | Critical/security-sensitive | ~X-Y min     |

---

### B: Unified Output Location

All single-round review skills write persistent output to a standard location. `codex-parallel-review` and `codex-codebase-review` are explicitly excluded (they have their own multi-output workflows). `codex-think-about` produces no review output and is excluded.

**Directory structure:**

```
.codex-review/
├── cache/                              ← unchanged (detect cache)
├── runs/                               ← unchanged (codex process state)
└── sessions/
    └── <skill-name>-<timestamp>-<pid>/
        ├── review.md                   ← primary output (always present)
        └── meta.json                   ← session metadata
```

**meta.json schema — individual review skills (impl, pr, plan, commit, security):**

```json
{
  "skill": "codex-impl-review",
  "version": 14,
  "effort": "high",
  "scope": "working-tree",
  "rounds": 2,
  "verdict": "APPROVE",
  "timing": { "total_seconds": 143 },
  "timestamp": "2026-03-18T07:00:00Z"
}
```

**meta.json schema — codex-auto-review (existing schema, path only changes; `"skill"` and `"version"` fields added for consistency):**

```json
{
  "skill": "codex-auto-review",
  "version": 14,
  "skills_run": ["codex-impl-review", "codex-security-review"],
  "detection_scores": { "...": "..." },
  "execution_mode": "parallel",
  "timing": { "total_seconds": 120, "per_skill": { "...": "..." } },
  "verdicts": { "codex-impl-review": "REVISE", "codex-security-review": "APPROVE" },
  "overall_verdict": "REVISE",
  "timestamp": "2026-03-18T07:00:00Z"
}
```

**Migration for `codex-auto-review`:**
- Current: `.codex-review/auto-runs/<ts>-<pid>/`
- New: `.codex-review/sessions/codex-auto-review-<ts>-<pid>/`
- Schema: add `"skill"` and `"version"` fields for consistency with individual skill meta.json; all other fields unchanged

**Fix stale `review.json` reference:** The existing `codex-auto-review/references/workflow.md` Step 5 references `review.json` in the merge input format. Per v11 breaking changes, `review.json` is no longer generated. Update the merge input example to use `review.md` (LLM-parsed findings) instead.

**Compatibility audit (Phase 2 prerequisite):** Before applying the path migration, search the entire repo for all references to `.codex-review/auto-runs` and `review.json`:
- Run `grep -r "auto-runs" skill-packs/ .claude/` to find all stale path references
- Run `grep -r "review\.json" skill-packs/` to find all stale format references
- Update every reference found. If any reference is in `codex-runner.js`, escalate — `codex-runner.js` is out of scope for this plan.

**Skills affected:**

| Skill | Change |
|-------|--------|
| `codex-impl-review` | Add session dir creation + write review.md + meta.json |
| `codex-pr-review` | Add session dir creation + write review.md + meta.json |
| `codex-plan-review` | Add session dir creation + write review.md + meta.json |
| `codex-commit-review` | Add session dir creation + write review.md + meta.json |
| `codex-security-review` | Add session dir creation + write review.md + meta.json |
| `codex-auto-review` | Update path from `auto-runs/` to `sessions/`; fix stale review.json reference |
| `codex-parallel-review` | **Excluded** — has its own multi-output workflow |
| `codex-codebase-review` | **Excluded** — chunked workflow produces output per chunk |
| `codex-think-about` | **Excluded** — not a review skill, no structured output |

---

### C: Smart Defaults for Setup Questions

Skills auto-detect context and proceed with defaults. User only responds to override.

**Detection logic per input:**

| Input | Detection method | Fallback if undetectable |
|-------|-----------------|--------------------------|
| `scope` | `git status --short` → has changes = `working-tree`; `git rev-list @{u}..HEAD` → has commits = `branch`; **if both true, prefer `working-tree`** (uncommitted changes take precedence) | Ask user |
| `effort` | Count files in diff: <10 = `medium`, 10–50 = `high`, >50 = `xhigh` | Default `high` |
| `base-branch` | Check `git remote show origin` default branch; fallback check for `main`/`master` refs | Ask user |
| `mode` (commit-review) | `git diff --cached --quiet` fails = staged changes = `draft`; else `last` | Default `last` |
| `plan-path` (plan-review) | Scan CWD for `plan.md`, `PLAN.md`, `docs/*plan*` — if single match, use it; if multiple, ask user | Ask user |

**Interaction pattern:**

```
# Before (current)
Skill: "Choose effort level: low/medium/high/xhigh (default: high)"
[user waits, types reply]
Skill: "Choose scope: working-tree/branch (default: working-tree)"
[user waits, types reply]

# After (new)
Skill: "Detected: scope=working-tree, effort=high (23 files changed)
        Proceeding — reply to override scope, effort, or both."
[user can reply or stay silent → execution starts]
```

**Rules:**
- Always display detected defaults before starting — never silently assume
- Only block on inputs that cannot be auto-detected (e.g., PR title/description, ambiguous plan file path)
- Never ask about optional inputs (e.g., PR description is optional — skip if user doesn't provide)

**Skills and applicable smart defaults:**

| Skill | Auto-detectable inputs |
|-------|----------------------|
| `codex-impl-review` | scope, effort |
| `codex-pr-review` | base-branch, effort |
| `codex-security-review` | scope, effort |
| `codex-commit-review` | mode (draft vs last) |
| `codex-plan-review` | plan file path, effort |
| `codex-parallel-review` | effort |
| `codex-think-about` | (no setup inputs) |
| `codex-codebase-review` | effort |
| `codex-auto-review` | Uses `detect` command for auto-selection — no user-facing defaults banner needed; detection output already acts as the "defaults display" |

---

## Implementation Order

1. **Phase 1: SKILL.md standardization** (Section A)
   - Update all 9 SKILL.md files to follow standard template
   - Add "When to Use" section to 8 missing SKILL.md files
   - Fix Effort tables for `codex-pr-review`, `codex-security-review`, `codex-codebase-review`
   - Update existing `codex-security-review/references/output-format.md` to absorb inline sections from SKILL.md

2. **Phase 2: Unified output location** (Section B)
   - Update `references/workflow.md` for 5 review skills to add session dir creation
   - Update `codex-auto-review/references/workflow.md`: new path + fix stale `review.json` reference

3. **Phase 3: Smart defaults** (Section C)
   - Update Workflow step 1 in each applicable SKILL.md
   - Document detection logic in each skill's `references/workflow.md`

---

## Files Changed

```
skill-packs/codex-review/skills/
├── codex-plan-review/
│   ├── SKILL.md                          ← template alignment, When to Use, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-impl-review/
│   ├── SKILL.md                          ← template alignment, When to Use, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-commit-review/
│   ├── SKILL.md                          ← template alignment, When to Use, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-pr-review/
│   ├── SKILL.md                          ← template alignment, When to Use, Typical time, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-security-review/
│   ├── SKILL.md                          ← template alignment, When to Use, Typical time, remove inline sections
│   └── references/
│       ├── output-format.md              ← UPDATE existing file: absorb inline Output Format + Security Categories
│       └── workflow.md                   ← session dir output, detection logic
├── codex-parallel-review/
│   ├── SKILL.md                          ← template alignment, When to Use
│   └── references/workflow.md            ← no session dir change (excluded from B)
├── codex-codebase-review/
│   └── SKILL.md                          ← template alignment, When to Use, Typical time column only
├── codex-think-about/
│   └── SKILL.md                          ← template alignment, When to Use
└── codex-auto-review/
    ├── SKILL.md                          ← template alignment
    └── references/workflow.md            ← update session dir path, fix stale review.json reference
```

---

## Success Criteria

- [ ] All 9 SKILL.md files have identical section order (with documented exceptions: optional `Scope Guide` subsection; custom Effort table for `codex-codebase-review`)
- [ ] All 9 SKILL.md files have a "When to Use" section
- [ ] All Effort tables have "Typical time" column (standard 4-col for 8 skills; custom format for codebase-review with Typical time column added)
- [ ] 5 review skills (impl, pr, plan, commit, security) write `review.md` + `meta.json` to `.codex-review/sessions/<skill-name>-<timestamp>-<pid>/`
- [ ] `codex-auto-review` writes to `.codex-review/sessions/codex-auto-review-<timestamp>-<pid>/` (updated from `auto-runs/`)
- [ ] Compatibility audit complete: no remaining references to `.codex-review/auto-runs` or `review.json` in skill files
- [ ] Stale `review.json` reference removed from `codex-auto-review/references/workflow.md`
- [ ] All review skills display detected defaults before asking any question (`codex-auto-review` exempt — uses `detect` output as its defaults display)
- [ ] A user invoking any two skills sees consistent interaction pattern
