# Design: Approach A — Skill Implementation Improvements

**Date**: 2026-03-22
**Scope**: codex-review skill pack (`skill-packs/codex-review/skills/`)
**Status**: Approved for implementation (v2 — post spec review)

---

## Overview

Approach A addresses three categories of issues found during comprehensive analysis of the 8 codex-review skills:

1. **Critical bug fixes** — 5 runtime-breaking issues that cause incorrect behavior when skills are invoked
2. **Information barrier adoption** — apply the independent-analysis-before-polling pattern to 3 skills that lack it
3. **VERDICT vocabulary unification** — migrate 3 skills from final-state `APPROVE|REVISE` to debate-state `CONSENSUS|CONTINUE|STALEMATE`

**Total files changed**: 15 existing files
**New files**: 1 (`codex-security-review/references/claude-analysis-template.md`)

---

## Section 1: Critical Bug Fixes

### Bug 1 — `codex-security-review`: Phantom `AskUserQuestion` tool

**File**: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md` (Phase 1, Step 1)

**Problem**: Workflow Phase 1 Step 1 instructs Claude to use `AskUserQuestion` which does not exist in Claude Code. The Smart Default Detection block at the top of the file already contains a correct announce line.

**Fix**: Delete Phase 1 Step 1 entirely. The Smart Default Detection block at the top of the file already handles scope/effort detection and announces the result with the correct pattern:
```
Announce: "Detected: scope=$SCOPE, effort=$EFFORT. Proceeding — reply to override."
```
Do not add a second announce. Simply remove the Step 1 block that references `AskUserQuestion`.

---

### Bug 2 — `codex-security-review`: Nested triple-backtick in prompts.md

**Files**: `skill-packs/codex-review/skills/codex-security-review/references/prompts.md` AND `workflow.md`

**Problem**: The `## Output Format` section and VERDICT block are embedded inline inside an outer triple-backtick fence, causing the inner fences to prematurely close the outer fence. This corrupts the prompt sent to Codex. Unlike other skills, security-review has no prompt assembly step and no `{OUTPUT_FORMAT}` placeholder mechanism.

**Fix — two-part**:

**Part A** (`prompts.md`): Remove the inline `## Output Format` and VERDICT Block sections from inside the fenced prompt block. Replace with `{OUTPUT_FORMAT}` placeholder at the end of the prompt body (before the closing fence).

**Part B** (`workflow.md`): Add a prompt assembly step (before the `start` command) instructing Claude to build `$PROMPT` using multi-step placeholder replacement, matching the exact pattern used in `codex-impl-review` workflow.md Step 1.8. The pattern is:

```
1.8) Assemble prompt (multi-step replacement — DO NOT use a single sed pipeline):
     a) Read references/prompts.md as the template base
     b) Replace {SCOPE} with the detected scope value
     c) Replace {EFFORT} with the detected effort value
     d) Replace {WORKING_DIR} with the current working directory
     e) Replace {SCOPE_SPECIFIC_INSTRUCTIONS} with the appropriate scope-specific block
     f) Replace {OUTPUT_FORMAT} by reading references/output-format.md in full
        (Use printf '%s' pattern to avoid sed special-character corruption)
     g) Replace any remaining placeholders ({BASE_BRANCH} etc.)
     Store as $PROMPT.
     Verify $PROMPT contains no prematurely-closed triple-backtick fences before sending to start.
```

Note: Do NOT use a single `sed` subshell to inject `output-format.md` — the file content may contain `&`, `\`, or `/` characters that corrupt sed replacements. Use `printf '%s'` piping or equivalent safe substitution matching the impl-review Step 1.8 pattern.

---

### Bug 3 — `codex-pr-review`: `$SCOPE` undefined in meta.json

**File**: `skill-packs/codex-review/skills/codex-pr-review/references/workflow.md` (Session Finalization section)

**Problem**: The heredoc writes `"scope": "$SCOPE"` but `$SCOPE` is never defined in the pr-review workflow. The correct variable is `$BASE_BRANCH`.

**Fix**: Change `"scope": "$SCOPE"` → `"scope": "$BASE_BRANCH"`.

---

### Bug 4 — `codex-parallel-review`: Invalid `subagent_type`

**File**: `skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md`

**Problem**: Agent spawn JSON uses `"subagent_type": "code-reviewer"` which is not a valid parameter in the Claude Code Agent tool, causing agent dispatch to fail.

**Fix**:
1. Remove the `subagent_type` field from all 4 agent spawn JSON blocks (lines ~60, 70, 82, 93).
2. Update the prose description paragraph (line ~53) that references `subagent_type: "code-reviewer"` — remove the reference or replace with correct description of default agent behavior.

---

### Bug 5 — `codex-security-review`: Archive step + code editing instruction

**File**: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md` (Phase 3 Options + Phase 5 Step 3)

**Problems**:
- Phase 5 Step 3 writes artifacts to `docs/security-reviews/` — violates v12 session model (all output stays in `.codex-review/sessions/`)
- Phase 3 Option A instructs Claude to "Apply the suggested fix" — the only skill that tells Claude to edit code during review, violating the review-only model shared by all other skills

**Fix**:
- Remove Phase 5 Step 3 (archive step) entirely. Session dir is the sole output location.
- Remove Phase 3 Option A. Renumber: old Option B → new Option A (rebuttal), old Option C → new Option B (acknowledge with severity dispute). Remove the lettered "Option" framing and use flat list matching `codex-impl-review` pattern.
- Enumerate all `APPROVE`/`REVISE` occurrences in `workflow.md` that must be updated as part of Section 3 VERDICT migration (all in same file — fix together):
  - Phase 3 stop condition: `VERDICT: APPROVE` → `VERDICT: CONSENSUS`
  - Phase 4 Step 4 "Iterate Until Consensus" line: `VERDICT: APPROVE - All critical/high issues resolved` → `VERDICT: CONSENSUS - All critical/high issues resolved`
  - Phase 5 Step 2 Final Verdict header: `{APPROVE | REVISE | STALEMATE}` → `{CONSENSUS | CONTINUE | STALEMATE}`
  - CI/CD integration section pre-commit hook example: `grep -q "VERDICT: REVISE"` → `grep -q "VERDICT: CONTINUE"`

---

## Section 2: Information Barrier Adoption

**Pattern source**: `codex-pr-review` and `codex-commit-review` (gold standard)

**Rationale**: Without an information barrier, Claude reads Codex's findings before forming its own analysis. This causes anchoring bias — Claude's "independent" analysis is actually influenced by Codex's framing, reducing genuine independent coverage.

**Core pattern**:
1. After `start` Codex, Claude does NOT poll immediately
2. Claude independently analyzes the artifact in working memory and records `FINDING-{N}` findings
3. Only after independent analysis is complete does Claude poll Codex
4. Cross-analysis maps FINDING-{N} (Claude) against ISSUE-{N} (Codex)
5. The analysis is kept in Claude's working context (NOT written to a separate file)

### `codex-security-review`: Add Step 2.5 + new `claude-analysis-template.md`

**workflow.md change** — add after Phase 2 `start` command (new Phase 2, Step 2.5):
```
2.5) INFORMATION BARRIER — Claude Independent Security Analysis
     MUST complete before polling Codex output.
     Codex is running in background (typically 90-180s) — use this time.

     Using references/claude-analysis-template.md:
     - Read all files in scope directly (do NOT read $SESSION_DIR/review.md)
     - Identify top attack surfaces
     - Form independent FINDING-{N} list using OWASP categories
     - Note high-confidence vs uncertain findings

     Keep analysis in working context. Do NOT write a file.
     INFORMATION BARRIER ends after Round 1 poll completes.
     From Round 2 onwards, the barrier no longer applies.
```

**workflow.md change** — update Phase 3 cross-analysis step to map FINDING-{N} (Claude) ↔ ISSUE-{N} (Codex) using the same classification table as pr-review (Genuine Agreement / Genuine Disagreement / Claude-only / Codex-only / Same Direction Different Severity).

**New file**: `references/claude-analysis-template.md`
- FINDING-{N} format mirroring `output-format.md` with OWASP/CWE fields
- `Strongest Positions` section
- Cross-analysis Matching Protocol (maps FINDING-{N} ↔ ISSUE-{N})

### `codex-plan-review`: Add Step 2.5 + transform Step 4

**workflow.md change** — add after Step 2 (`start`) as new Step 2.5:
```
2.5) INFORMATION BARRIER — Claude Independent Plan Analysis
     MUST complete before polling Codex output.
     Codex is running in background — use this time.

     Read plan file at $PLAN_PATH directly.
     Do NOT read $SESSION_DIR/review.md.
     Form independent FINDING-{N} list in working context:
     - Correctness issues
     - Architecture concerns
     - Sequencing/dependency problems
     - Scope gaps or risks

     INFORMATION BARRIER ends after Round 1 poll completes.
     From Round 2 onwards, the barrier no longer applies.
```

**workflow.md change** — transform Step 4 "Parse Review" into a Cross-Analysis step. Step 4 currently parses Codex output and applies fixes directly. Add a cross-analysis sub-step before applying fixes:

```
4) Cross-Analysis (after first poll completes):
   a) Parse all ISSUE-{N} blocks from review.md
   b) Build mapping table: FINDING-{N} (Claude) ↔ ISSUE-{N} (Codex)
      - Genuine Agreement: FINDING-{N} and ISSUE-{M} identify same problem
      - Codex-only: ISSUE-{M} has no matching FINDING
      - Claude-only: FINDING-{N} has no matching ISSUE
      - Genuine Disagreement: conflicting assessments of same area
   c) For each ISSUE-{N}: determine response (fix, rebuttal, or acknowledge)
   d) Apply fixes to the plan file. Save the updated plan file before resuming.
      (Codex Round 2+ re-reads the plan from $PLAN_PATH — unsaved changes are invisible.)
   e) Proceed to resume loop
```

No new file needed.

### `codex-impl-review`: Add Step 2.5 + extend Step 4

**workflow.md change** — add after Step 2 (`start`) as new Step 2.5 (mode-conditional):
```
2.5) INFORMATION BARRIER — Claude Independent Code Analysis
     MUST complete before polling Codex output.
     Codex is running in background — use this time.

     working-tree mode: run `git diff` and `git diff --cached` yourself
        (or reuse the diff already collected in Step 1 — working tree hasn't changed)
     branch mode: run `git diff $BASE_BRANCH...HEAD` yourself
        (or reuse the diff already collected in Step 1)

     Form independent FINDING-{N} list in working context:
     - Bugs and edge cases
     - Security issues
     - Performance concerns
     - Maintainability problems

     Do NOT read $SESSION_DIR/review.md until analysis complete.
     INFORMATION BARRIER ends after Round 1 poll completes.
```

**workflow.md change** — extend Step 4 "Apply/Rebut" to add cross-analysis sub-step before applying fixes. impl-review retains code-editing behavior — the cross-analysis adds FINDING/ISSUE mapping context to the existing apply/rebuttal decision, but does NOT remove code editing:

```
4) Cross-Analysis + Apply/Rebut:
   a) Parse all ISSUE-{N} blocks from review.md
   b) Build mapping table: FINDING-{N} (Claude) ↔ ISSUE-{N} (Codex)
      (same classification as plan-review Step 4a-b above)
   c) For each ISSUE-{N}:
      - If genuine agreement or Codex-only: apply fix to code
      - If Claude-only: include in final report as Claude finding
      - If genuine disagreement: rebuttal response
   d) Commit fixes (branch mode only — required before resume)
   e) Proceed to resume loop
```

Code editing is preserved. FINDING-{N} from Step 2.5 enriches the cross-analysis but does not change the apply/rebuttal outcome model.

---

## Section 3: VERDICT Vocabulary Unification

**Problem**: Three skills (`plan-review`, `impl-review`, `security-review`) use `APPROVE | REVISE` — a final-state verdict that cannot drive a multi-round debate loop. The correct vocabulary for debate-loop skills is `CONSENSUS | CONTINUE | STALEMATE`.

**Note on pre-existing state**: `security-review/references/output-format.md` and `prompts.md` already contain partial `STALEMATE` vocabulary in secondary sections (stalemate format section). The migration unifies these existing fragments into the primary VERDICT block.

**Target vocabulary** (from pr-review/commit-review gold standard):

| Value | Meaning | Workflow action |
|-------|---------|----------------|
| `CONSENSUS` | No remaining issues / all resolved | End debate, generate final report |
| `CONTINUE` | Issues remain, requires another round | Claude fixes/rebuts, then `resume` |
| `STALEMATE` | Circular debate detected by Codex | End debate, produce partial report |

**Migration mapping**:
- `APPROVE` → `CONSENSUS`
- `REVISE` → `CONTINUE`
- *(pre-existing in stalemate sections)* `STALEMATE` → promote to primary VERDICT block

### Changes per skill

**For each of `plan-review`, `impl-review`, `security-review`:**

**`references/output-format.md`** (clear VERDICT change):
- Update VERDICT block primary values from `APPROVE | REVISE` to `CONSENSUS | CONTINUE | STALEMATE`
- Add STALEMATE description in VERDICT block

**`references/prompts.md`** (scope clarification):
- For plan-review and impl-review: `{OUTPUT_FORMAT}` placeholder indirection means VERDICT values live in `output-format.md` only; in `prompts.md` update only the instruction line "End with a VERDICT block" to add: "Use STALEMATE if same arguments repeat for 2+ consecutive rounds with no new evidence."
- For security-review: remove inline VERDICT values from nested backtick sections (covered by Bug 2 fix); the `{OUTPUT_FORMAT}` injection handles the values after Bug 2 is fixed.

**`references/workflow.md`** (all occurrences):
- Update stop condition text: replace `VERDICT: APPROVE` → `VERDICT: CONSENSUS`
- Update debate loop branching: `CONTINUE` triggers resume (same as `REVISE`), `CONSENSUS` triggers final report (same as `APPROVE`), `STALEMATE` triggers stalemate handling
- Update stalemate detection: check for `STALEMATE` verdict OR same open ISSUE set for 2 consecutive rounds (the latter is the existing heuristic)
- Update the Verdict row value in the final report summary table from `{APPROVE/REVISE/STALEMATE}` to `{CONSENSUS/CONTINUE/STALEMATE}` (this is a value cell, not a table header)
- For security-review specifically: update inline Final Security Report template in Phase 5 Step 2 — the `## Final Verdict: {APPROVE | REVISE | STALEMATE}` header → `## Final Verdict: {CONSENSUS | CONTINUE | STALEMATE}`. All APPROVE/REVISE occurrences are enumerated in Bug 5 fix above.

**`references/output-format.md`** — security-review note: the `Status` field in the Verdict Block (`Status: {complete | stalemate | in-progress}`) is a separate field from `VERDICT` and is retained as-is. `Status: stalemate` maps to `VERDICT: STALEMATE`; `Status: in-progress` maps to `VERDICT: CONTINUE`. No change needed to the `Status` field.

---

## File Change Summary

| File | Change type | Section |
|------|-------------|---------|
| `codex-security-review/references/workflow.md` | Delete Step 1, add prompt assembly step, add Step 2.5, extend cross-analysis, remove archive step, remove Option A, renumber options, update VERDICT logic + final report template | 1 (bugs 1, 2, 5), 2, 3 |
| `codex-security-review/references/prompts.md` | Remove inline output format (replace with `{OUTPUT_FORMAT}`), update STALEMATE instruction | 1 (bug 2), 3 |
| `codex-security-review/references/output-format.md` | Update VERDICT block to `CONSENSUS\|CONTINUE\|STALEMATE` | 3 |
| `codex-security-review/references/claude-analysis-template.md` | **NEW FILE** | 2 |
| `codex-pr-review/references/workflow.md` | Fix `$SCOPE` → `$BASE_BRANCH` | 1 (bug 3) |
| `codex-parallel-review/references/workflow.md` | Remove `subagent_type` from JSON blocks + prose | 1 (bug 4) |
| `codex-plan-review/references/workflow.md` | Add Step 2.5, transform Step 4 to cross-analysis, update VERDICT logic + stop conditions + final report table | 2, 3 |
| `codex-plan-review/references/prompts.md` | Update STALEMATE instruction line only | 3 |
| `codex-plan-review/references/output-format.md` | Update VERDICT block values | 3 |
| `codex-impl-review/references/workflow.md` | Add Step 2.5, extend Step 4 with cross-analysis sub-steps, update VERDICT logic + stop conditions + final report table | 2, 3 |
| `codex-impl-review/references/prompts.md` | Update STALEMATE instruction line in 4 templates | 3 |
| `codex-impl-review/references/output-format.md` | Update VERDICT block values | 3 |

*(Note: `codex-security-review/references/output-format.md` appears once — duplicate removed from v1.)*

---

## Constraints

- **Never edit user's code or create commits during review** — review-only model preserved (security-review Phase 3 Option A removal enforces this)
- **impl-review retains code editing** — cross-analysis enriches the apply/rebuttal decision but does not change the code-editing model
- **No new skills added** — only existing skills improved
- **SKILL.md files** — not changed (these are user-facing; workflow changes are in references/)
- **codex-runner.js** — not changed (runner is separate from skill instructions)
- **`bin/codex-skill.js`** — not changed

---

## Success Criteria

1. All 5 critical bugs fixed:
   - Bug 1: security-review workflow invoked without `AskUserQuestion` error
   - Bug 2: prompt sent to Codex contains no prematurely-closed triple-backtick fences (verify by inspecting assembled `$PROMPT` variable)
   - Bug 3: pr-review meta.json contains `"scope": "<branch-name>"` not `"scope": "$SCOPE"`
   - Bug 4: parallel-review agent spawn JSON contains no `subagent_type` field
   - Bug 5: security-review workflow does not write to `docs/` and does not instruct Claude to edit code
2. Information barrier active in security/plan/impl-review — Claude FINDING-{N} analysis recorded in working context before first poll result is read
3. VERDICT parsing unified — `CONSENSUS|CONTINUE|STALEMATE` parsed correctly in all 3 updated skills' workflow debate loops and stop conditions
4. No regressions in the 5 unmodified skills (pr-review, commit-review, think-about, parallel-review, codebase-review)
