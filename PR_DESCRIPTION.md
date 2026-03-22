# Complete Approach A Skill Improvements

## Summary

Implements all 12 tasks from [Approach A implementation plan](docs/superpowers/plans/2026-03-22-approach-a-skill-improvements.md):
- Fixed 5 critical bugs across multiple review skills
- Added information barrier pattern to 3 review skills
- Unified VERDICT vocabulary across all review skills

**Total changes**: 13 files, +287/-168 lines, 18 commits

## Changes by Category

### 1. Bug Fixes (5 bugs resolved)

#### security-review
- **Bug 1**: Removed phantom `AskUserQuestion` from Phase 1 Step 1
- **Bug 2**: Replaced inline output format with `{OUTPUT_FORMAT}` placeholder to prevent nested fence corruption
- **Bug 3**: Removed archive step and code-edit instruction from workflow
- **Bug 4**: Fixed heading level for Step 1.8 (was H2, should be H3)

#### pr-review & parallel-review
- **Bug 5**: Fixed `$SCOPE` undefined error and invalid `subagent_type` parameter

### 2. Information Barrier Implementation (3 skills)

Added independent analysis phase (Step 2.5) before polling Codex output:

- **security-review**: Claude analyzes code independently using OWASP/CWE checklist, produces FINDING-{N} list, then cross-analyzes with Codex's ISSUE-{M} list
- **plan-review**: Claude reviews plan independently, produces FINDING-{N} list, then cross-analyzes with Codex's ISSUE-{M} list
- **impl-review**: Claude reviews code independently, produces FINDING-{N} list, then cross-analyzes with Codex's ISSUE-{M} list

Created `claude-analysis-template.md` with structured format for independent analysis and cross-analysis mapping.

### 3. VERDICT Vocabulary Unification (3 skills)

Changed from `APPROVE | REVISE` to `CONSENSUS | CONTINUE | STALEMATE`:

- **security-review**: Updated SKILL.md, workflow.md, prompts.md, output-format.md
- **plan-review**: Updated workflow.md, prompts.md, output-format.md
- **impl-review**: Updated workflow.md, prompts.md, output-format.md

## Additional Fixes (6 rounds of codex-impl-review)

After completing the 12 planned tasks, ran adversarial review which identified and fixed:

### Round 1-3: Nested Fence Corruption & Gate Bypass
- Removed outer fence wrappers from Round 1 and Round 2+ prompt templates
- Removed outer fences from example sections in prompts.md
- Updated pre-commit hook to check both CONTINUE and STALEMATE verdicts
- Added verdict counting (requires exactly 1 verdict AND it must be CONSENSUS)

### Round 4: Fail-Open Gate & Output Format Fences
- Fixed grep -c fail-open issue by switching to awk-based counting with explicit zero normalization
- Removed outer fences from output-format.md examples (Complete Security Finding, Secrets Detection, Response Format)

### Round 5: Prompt Assembly & Base Branch Discovery
- Clarified prompt assembly to extract only Round 1 section (exclude Round 2+ sections)
- Added base branch auto-discovery (Step 1) before validation (Step 2)
- Removed stray closing fence after Response Format (Round 2+)
- Fixed Status column reference in claude-analysis-template.md

### Round 6: Review-Only Behavior Alignment
- Fixed SKILL.md step 6 contradiction: changed from "Fix valid vulnerabilities in code" to "Validate findings, prepare rebuttals or severity adjustments, and provide evidence without editing code"
- Aligns with review-only contract throughout all documentation

## Final State

✅ All nested fence corruption eliminated
✅ Pre-commit gate is truly fail-closed with awk-based counting
✅ Category taxonomy aligned across all security-review files
✅ VERDICT vocabulary unified (CONSENSUS|CONTINUE|STALEMATE)
✅ Prompt assembly extracts only Round 1 section
✅ Base branch discovery happens before validation
✅ All skill files internally consistent
✅ Review-only behavior consistent throughout

## Files Changed

```
skill-packs/codex-review/skills/codex-impl-review/references/output-format.md
skill-packs/codex-review/skills/codex-impl-review/references/prompts.md
skill-packs/codex-review/skills/codex-impl-review/references/workflow.md
skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md
skill-packs/codex-review/skills/codex-plan-review/references/output-format.md
skill-packs/codex-review/skills/codex-plan-review/references/prompts.md
skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
skill-packs/codex-review/skills/codex-pr-review/references/workflow.md
skill-packs/codex-review/skills/codex-security-review/SKILL.md
skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md (new)
skill-packs/codex-review/skills/codex-security-review/references/output-format.md
skill-packs/codex-review/skills/codex-security-review/references/prompts.md
skill-packs/codex-review/skills/codex-security-review/references/workflow.md
```

## Testing

All changes verified through 6 rounds of adversarial review using `/codex-impl-review`. Final review found only 2 minor edge cases (branch auto-detection without upstream, Round 2 workflow clarity) which are documented but not blocking.

## Breaking Changes

None. All changes are internal improvements to skill implementation. The skill invocation interface (`/codex-security-review`, `/codex-plan-review`, `/codex-impl-review`) remains unchanged.
