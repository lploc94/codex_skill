# Approach A — Skill Implementation Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 critical bugs + add information barriers + unify VERDICT vocabulary across 3 codex-review skills (plan-review, impl-review, security-review).

**Architecture:** All changes are pure Markdown edits to `references/` files inside `skill-packs/codex-review/skills/`. No code (runner, installer, SKILL.md) is touched. Each task is isolated to one skill directory and can be verified by inspecting the changed file against the spec.

**Tech Stack:** Markdown files only. No build system, no tests, no npm. Verification is visual inspection + grep for specific strings.

---

## File Map

| File | Task |
|------|------|
| `skill-packs/codex-review/skills/codex-security-review/references/workflow.md` | T1, T4, T5, T8, T9 |
| `skill-packs/codex-review/skills/codex-security-review/references/prompts.md` | T2, T9 |
| `skill-packs/codex-review/skills/codex-security-review/references/output-format.md` | T9 |
| `skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md` | T5 (NEW FILE) |
| `skill-packs/codex-review/skills/codex-pr-review/references/workflow.md` | T3 |
| `skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md` | T3 |
| `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md` | T6, T10 |
| `skill-packs/codex-review/skills/codex-plan-review/references/prompts.md` | T10 |
| `skill-packs/codex-review/skills/codex-plan-review/references/output-format.md` | T10 |
| `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md` | T7, T11 |
| `skill-packs/codex-review/skills/codex-impl-review/references/prompts.md` | T11 |
| `skill-packs/codex-review/skills/codex-impl-review/references/output-format.md` | T11 |

---

## Task 1: Delete phantom AskUserQuestion step (Bug 1)

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`

**Context:** The file has a "Smart Default Detection" block near the top that correctly announces `scope=$SCOPE, effort=$EFFORT`. Immediately after that block, Phase 1 Step 1 says `Use AskUserQuestion to collect these inputs in a single prompt.` — this tool does not exist in Claude Code. The fix is simply deleting Step 1. Do NOT add a second announce block.

- [ ] **Step 1: Read the current file and locate Phase 1 Step 1**

  Open `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`. Find the block that contains `AskUserQuestion`. Confirm the Smart Default Detection block above it already has the announce pattern (`Announce: "Detected: scope=..."`).

- [ ] **Step 2: Delete Phase 1 Step 1 entirely**

  Remove the entire Step 1 block (from `## Phase 1: ...Step 1` or equivalent heading down to where Step 2 begins). Do not touch the Smart Default Detection block above it.

- [ ] **Step 3: Verify**

  ```bash
  grep -n "AskUserQuestion" skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: no output (zero matches).

  ```bash
  grep -n "Announce" skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: exactly one match in the Smart Default Detection block.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git commit -m "fix(security-review): remove phantom AskUserQuestion from Phase 1 Step 1"
  ```

---

## Task 2: Fix nested triple-backtick in prompts.md — Part A (Bug 2)

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/prompts.md`

**Context:** The Round 1 prompt template is inside a triple-backtick fence. Inside that fence, there are sections (`## Output Format`, VERDICT Block) that also use triple-backtick fences. The inner fences prematurely close the outer fence, breaking the template. The fix: remove the `## Output Format` section and VERDICT Block from inside the fenced prompt, and replace them with the single line `{OUTPUT_FORMAT}` at the end of the prompt body (before the closing fence).

Compare with `codex-impl-review/references/prompts.md` — it uses `## Required Output Format\n{OUTPUT_FORMAT}` at the bottom of each prompt template. Use the same pattern.

- [ ] **Step 1: Read both files to understand the difference**

  Read `skill-packs/codex-review/skills/codex-security-review/references/prompts.md` and identify the inline `## Output Format` / VERDICT Block sections inside the outer fence.

  Read `skill-packs/codex-review/skills/codex-impl-review/references/prompts.md` lines 50-80 to see how `{OUTPUT_FORMAT}` placeholder is used correctly.

- [ ] **Step 2: Edit prompts.md**

  In the Round 1 prompt template (the outermost fenced block):
  - Remove the `## Output Format` section and its content (the nested fence with ISSUE-{N} format)
  - Remove the VERDICT Block section (the nested fence with VERDICT template)
  - At the end of the prompt body (just before the outer closing fence), add:

  ```
  ## Required Output Format
  {OUTPUT_FORMAT}
  ```

  Apply the same change to the Round 2+ / Rebuttal prompt template if it also has inline output format.

- [ ] **Step 3: Verify nested Output Format sections were removed and placeholder is present**

  ```bash
  # Verify the inline Output Format and VERDICT Block sections were removed from the templates
  grep -n "## Output Format\|## Verdict Block\|VERDICT: APPROVE | REVISE\|VERDICT: APPROVE \| REVISE" \
    skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  ```
  Expected: zero matches (these were inside the fenced template and are now gone).

  ```bash
  # Verify the {OUTPUT_FORMAT} placeholder is present in each template
  grep -n "OUTPUT_FORMAT" skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  ```
  Expected: at least 1 match per prompt template (Round 1 and Round 2+ / Rebuttal).

  ```bash
  # Verify no nested triple-backticks remain inside any template
  grep -n "Required Output Format" skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  ```
  Expected: at least 1 match showing the `## Required Output Format\n{OUTPUT_FORMAT}` pattern was added.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  git commit -m "fix(security-review): replace inline output format with {OUTPUT_FORMAT} placeholder"
  ```

---

## Task 3: Fix simple one-line bugs (Bug 3 + Bug 4)

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-pr-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md`

### Bug 3 — pr-review: `$SCOPE` undefined in meta.json

- [ ] **Step 1: Find the Session Finalization heredoc in pr-review workflow.md**

  ```bash
  grep -n 'SCOPE' skill-packs/codex-review/skills/codex-pr-review/references/workflow.md
  ```
  Find the line `"scope": "$SCOPE"` in the `meta.json` heredoc.

- [ ] **Step 2: Replace `$SCOPE` with `$BASE_BRANCH`**

  Change:
  ```
  "scope": "$SCOPE",
  ```
  To:
  ```
  "scope": "$BASE_BRANCH",
  ```

- [ ] **Step 3: Verify**

  ```bash
  grep -n '"scope"' skill-packs/codex-review/skills/codex-pr-review/references/workflow.md
  ```
  Expected: shows `"scope": "$BASE_BRANCH"` (not `$SCOPE`).

### Bug 4 — parallel-review: Invalid `subagent_type`

- [ ] **Step 4: Find all `subagent_type` occurrences**

  ```bash
  grep -n "subagent_type" skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md
  ```
  Expected: 5 matches — 4 in JSON blocks (Agent 1-4), 1 in a prose description paragraph.

- [ ] **Step 5: Remove `subagent_type` from all 4 JSON blocks**

  For each JSON agent spawn block, remove the line:
  ```json
  "subagent_type": "code-reviewer",
  ```
  Do not remove any other fields from the JSON.

- [ ] **Step 6: Update the prose description paragraph**

  Find the paragraph (line ~53) that reads something like `Each uses subagent_type: "code-reviewer"`. Remove the `subagent_type: "code-reviewer"` reference or replace with: `Each uses the default general-purpose agent behavior.`

- [ ] **Step 7: Verify**

  ```bash
  grep -n "subagent_type" skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md
  ```
  Expected: no output (zero matches).

- [ ] **Step 8: Commit both fixes**

  ```bash
  git add skill-packs/codex-review/skills/codex-pr-review/references/workflow.md
  git add skill-packs/codex-review/skills/codex-parallel-review/references/workflow.md
  git commit -m "fix(pr-review,parallel-review): fix \$SCOPE undefined and invalid subagent_type"
  ```

---

## Task 4: Fix archive step + code editing instruction (Bug 5)

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`

**Context:** Two problems in the same file:
1. Phase 5 Step 3 copies artifacts to `docs/security-reviews/` — violates v12 session model.
2. Phase 3 Option A says "Apply the suggested fix" — no review skill should edit user code.

After removing Option A, renumber: old Option B → new Option A, old Option C → new Option B. Remove the lettered "Option" framing and use a flat response list matching `codex-impl-review` workflow.md Step 4 style.

Also, as part of this task, update all `APPROVE`/`REVISE` strings in this file (enumerated exactly):
- Phase 3 stop condition: `VERDICT: APPROVE` → `VERDICT: CONSENSUS`
- Phase 4 Step 4 "Iterate Until Consensus": `VERDICT: APPROVE - All critical/high issues resolved` → `VERDICT: CONSENSUS - All critical/high issues resolved`
- Phase 5 Step 2 Final Verdict header: `{APPROVE | REVISE | STALEMATE}` → `{CONSENSUS | CONTINUE | STALEMATE}`
- CI/CD pre-commit hook example: `grep -q "VERDICT: REVISE"` → `grep -q "VERDICT: CONTINUE"`

(The workflow.md VERDICT updates for Section 3 are bundled here since they're all in the same file.)

- [ ] **Step 1: Read the current Phase 3 section**

  Read `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`. Find Phase 3 with its 3 options. Also find Phase 5 Step 3 (the archive block).

- [ ] **Step 2: Remove Phase 5 Step 3 archive block**

  Delete the entire Step 3 block in Phase 5 that runs `mkdir -p docs/security-reviews/` and copies artifacts.

- [ ] **Step 3: Remove Phase 3 Option A and renumber**

  - Delete the entire Option A block (the "Apply the suggested fix" / code editing block).
  - Rename `Option B` → `Option A` (or remove "Option" labels entirely and use a flat list like impl-review).
  - Rename `Option C` → `Option B` (or same).
  - Match the flat style from `codex-impl-review` workflow.md Step 4:
    - Response type 1: rebuttal (write concrete proof that finding is wrong)
    - Response type 2: acknowledge with severity dispute (finding is valid but severity is lower)

- [ ] **Step 4: Update all APPROVE/REVISE in this file**

  Make these **5** exact replacements (the 5th catches an additional occurrence in Phase 2 example):

  | Old text | New text |
  |----------|----------|
  | `VERDICT: APPROVE` (Phase 3 stop condition) | `VERDICT: CONSENSUS` |
  | `VERDICT: APPROVE - All critical/high issues resolved` | `VERDICT: CONSENSUS - All critical/high issues resolved` |
  | `{APPROVE \| REVISE \| STALEMATE}` (Final Verdict header) | `{CONSENSUS \| CONTINUE \| STALEMATE}` |
  | `grep -q "VERDICT: REVISE"` (CI/CD example) | `grep -q "VERDICT: CONTINUE"` |
  | `**Verdict**: REVISE` (Phase 2 example line) | `**Verdict**: CONTINUE` |

- [ ] **Step 5: Verify**

  ```bash
  # Check all old vocabulary forms are gone (including non-VERDICT:-prefixed forms)
  grep -n "AskUserQuestion\|docs/security-reviews\|Option A\|Apply the suggested fix\|VERDICT: APPROVE\|VERDICT: REVISE\|Verdict.*APPROVE\|Verdict.*REVISE" \
    skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: zero matches (all removed/replaced).

  ```bash
  grep -n "VERDICT: CONSENSUS\|VERDICT: CONTINUE\|VERDICT: STALEMATE\|Verdict.*CONTINUE" \
    skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: at least 5 matches (one per replacement location).

- [ ] **Step 6: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git commit -m "fix(security-review): remove archive step, code-edit instruction, unify VERDICT vocab in workflow"
  ```

---

## Task 5: Add prompt assembly step to security-review workflow (Bug 2 — Part B) + new claude-analysis-template.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`
- Create: `skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md`

### Part A — Prompt assembly step in workflow.md

**Context:** After Bug 2 Part A (Task 2), `prompts.md` now has `{OUTPUT_FORMAT}` placeholder. But security-review has no prompt assembly step, so `{OUTPUT_FORMAT}` would never be substituted. Add a Step 1.8 modeled exactly on `codex-impl-review/references/workflow.md` Step 1.8.

Read `codex-impl-review/references/workflow.md` to find the exact prompt assembly step. It reads `references/prompts.md` as template, replaces each placeholder in sequence using `printf '%s'` (never a single sed pipeline), stores as `$PROMPT`, and verifies no broken backtick fences.

- [ ] **Step 1: Read codex-impl-review Step 1.8 as the reference pattern**

  Read `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md` and find the prompt assembly step (Step 1.8). Note the exact shell pattern used.

- [ ] **Step 2: Add Step 1.8 to security-review workflow.md**

  After the existing Step 1 (input collection/detection) and before the `start` command, insert a new step:

  ```
  ## 1.8) Assemble Prompt

  Build `$PROMPT` using multi-step placeholder replacement.
  DO NOT use a single sed pipeline — `output-format.md` may contain `&`, `\`, `/` characters
  that corrupt sed replacements. Use `printf '%s'` piping.

  a) Read `references/prompts.md` as template base
  b) Replace `{WORKING_DIR}` with current working directory
  c) Replace `{SCOPE}` with detected `$SCOPE` value
  d) Replace `{EFFORT}` with detected `$EFFORT` value
  e) Replace `{SCOPE_SPECIFIC_INSTRUCTIONS}` with the scope-specific block from prompts.md
     matching the detected `$SCOPE` (working-tree / branch / full)
  f) Replace `{OUTPUT_FORMAT}` by reading `references/output-format.md` in full
     using: `printf '%s' "$(cat references/output-format.md)"`
  g) Replace any remaining placeholders (`{BASE_BRANCH}` etc.)

  Store result as `$PROMPT`.

  Verify: `$PROMPT` must contain no prematurely-closed triple-backtick fences.
  ```

- [ ] **Step 3: Verify prompt assembly step exists**

  ```bash
  grep -n "Assemble Prompt\|OUTPUT_FORMAT\|printf '%s'" \
    skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: matches showing the new assembly step with `OUTPUT_FORMAT` and `printf '%s'`.

### Part B — New claude-analysis-template.md

**Context:** The information barrier pattern requires Claude to analyze independently before polling. `codex-pr-review/references/claude-analysis-template.md` and `codex-commit-review/references/claude-analysis-template.md` are the gold standard. Security review needs its own version with OWASP/CWE fields instead of PR-specific fields.

- [ ] **Step 4: Read the gold standard template for reference**

  Read `skill-packs/codex-review/skills/codex-pr-review/references/claude-analysis-template.md`.

- [ ] **Step 5: Create security-review claude-analysis-template.md**

  Create `skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md` with this content:

  ```markdown
  # Claude Independent Security Analysis Template

  > Use this template for Step 2.5 (Information Barrier).
  > Record analysis in working context ONLY — do NOT write to a file.
  > Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

  ## FINDING-{N} Format

  Use this exact shape for each independent finding:

  ### FINDING-{N}: {Short title}
  - Category: injection | broken-auth | sensitive-data | broken-access | security-config | xss | insecure-deserialization | logging | ssrf | crypto-failure | insecure-design | vulnerable-components | integrity-failure | secrets
  - Severity: low | medium | high | critical
  - Confidence: low | medium | high
  - CWE: {CWE-NNN if known, otherwise omit}
  - OWASP: {A0N:2021 category if applicable, otherwise omit}
  - Location: {file path:line range}
  - Problem: {clear statement of the vulnerability or security weakness}
  - Evidence: {specific code pattern, snippet, or observation}
  - Attack Vector: {how an attacker could exploit this}
  - Why it matters: {impact — data exposure, privilege escalation, etc.}

  ## Overall Security Assessment

  - Attack surface: {high / medium / low — based on exposed endpoints, data handled}
  - Most critical area: {the single highest-risk component or pattern found}
  - Confidence in analysis: {high / medium / low — limited by static analysis}

  ## Strongest Positions

  List the 3-5 findings Claude is most confident about for cross-analysis debate:

  1. FINDING-{N}: {title} — {one-sentence rationale for high confidence}
  2. ...

  ## Cross-Analysis Matching Protocol

  After Round 1 poll completes, build a mapping table:

  | Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
  |--------------------|-----------------|----------------|
  | FINDING-1 | ISSUE-2 | Genuine Agreement |
  | FINDING-2 | — | Claude-only |
  | — | ISSUE-4 | Codex-only |
  | FINDING-3 | ISSUE-5 | Genuine Disagreement |

  Classification rules:
  - **Genuine Agreement**: Same vulnerability class + same file/line area
  - **Genuine Disagreement**: Same code area but conflicting assessment (one says vulnerable, other says safe)
  - **Same Direction / Different Severity**: Both flag the same issue but assign different severity
  - **Claude-only**: Claude's finding has no Codex counterpart
  - **Codex-only**: Codex's finding has no Claude counterpart

  Maintain this table across all rounds. Update Classification and Status columns as rounds progress.
  ```

- [ ] **Step 6: Verify the new file exists and contains FINDING-{N} format and Cross-Analysis table**

  ```bash
  grep -n "FINDING-\|Cross-Analysis\|Classification" \
    skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md
  ```
  Expected: matches showing `FINDING-{N}` format, `Cross-Analysis Matching Protocol`, and `Classification` column header.

- [ ] **Step 7: Commit both changes**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git add skill-packs/codex-review/skills/codex-security-review/references/claude-analysis-template.md
  git commit -m "feat(security-review): add prompt assembly step and claude-analysis-template.md"
  ```

---

## Task 6: Add information barrier to codex-plan-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`

**Context:** The current workflow goes: Step 2 (start Codex) → Step 3 (poll). We need to insert Step 2.5 between them and transform Step 4 "Parse Review" into a Cross-Analysis step.

Read `codex-pr-review/references/workflow.md` Steps 2.5 and 4 as the gold standard for the pattern.

- [ ] **Step 1: Read current plan-review workflow.md**

  Read `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`. Identify:
  - Where Step 2 (start command) ends
  - Where Step 3 (Poll) begins — this is where Step 2.5 goes
  - The content of Step 4 "Parse Review" / Apply fixes — this will be transformed

- [ ] **Step 2: Insert Step 2.5 after Step 2**

  After the `node "$RUNNER" start` command block in Step 2, add:

  ```markdown
  ## 2.5) Information Barrier — Claude Independent Plan Analysis

  MUST complete before polling Codex output.
  Codex is running in background — use this time productively.

  Read the plan file at `$PLAN_PATH` directly.
  Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

  Form an independent FINDING-{N} list in working context (do NOT write to a file):
  - Correctness issues (steps that are wrong or will fail)
  - Architecture concerns (structural problems with the approach)
  - Sequencing/dependency problems (steps out of order, missing prerequisites)
  - Scope gaps or risks (missing requirements, underestimated complexity)

  Use the same FINDING-{N} format as `output-format.md` ISSUE-{N} (same field names).

  INFORMATION BARRIER ends after Round 1 poll completes.
  From Round 2 onwards, the barrier no longer applies.
  ```

- [ ] **Step 3: Transform Step 4 into Cross-Analysis**

  Replace the current Step 4 "Parse Review" / fix application with:

  ```markdown
  ## 4) Cross-Analysis

  After Round 1 poll completes and `$SESSION_DIR/review.md` is available:

  ### 4a) Parse Codex Output
  Read all `ISSUE-{N}` blocks from `$SESSION_DIR/review.md`.

  ### 4b) Build FINDING↔ISSUE Mapping Table
  Map Claude's FINDING-{N} (from Step 2.5) against Codex's ISSUE-{N}:

  | Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
  |--------------------|-----------------|----------------|
  | ...                | ...             | ...            |

  Classification options:
  - **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same plan problem
  - **Codex-only**: ISSUE-{M} has no matching Claude FINDING
  - **Claude-only**: FINDING-{N} has no matching Codex ISSUE
  - **Genuine Disagreement**: Conflicting assessments of the same plan section

  ### 4c) Determine Response for Each ISSUE
  For each ISSUE-{N}:
  - Genuine agreement or Codex-only → apply fix to the plan file
  - Claude-only → include in final report as Claude finding
  - Genuine disagreement → write rebuttal with concrete reasoning

  ### 4d) Apply Fixes
  Apply accepted fixes to the plan file at `$PLAN_PATH`.
  Save the updated plan file before resuming.
  **Critical**: Codex Round 2+ re-reads the plan from `$PLAN_PATH` — unsaved changes are invisible to Codex.

  ### 4e) Record Round Summary
  Append to `$SESSION_DIR/rounds.json`:
  ```json
  { "round": N, "elapsed_seconds": ..., "verdict": "...", "issues_found": ..., "issues_fixed": ..., "issues_disputed": ... }
  ```

  Proceed to Step 5 (resume) or Step 7 (final output) based on VERDICT.
  ```

- [ ] **Step 4: Verify Step 2.5 and cross-analysis are present**

  ```bash
  grep -n "Information Barrier\|FINDING-{N}\|Cross-Analysis\|4b\|PLAN_PATH.*unsaved" \
    skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  ```
  Expected: matches for each of these patterns.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  git commit -m "feat(plan-review): add information barrier Step 2.5 and cross-analysis Step 4"
  ```

---

## Task 7: Add information barrier to codex-impl-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md`

**Context:** Same structure as plan-review. Insert Step 2.5 between Step 2 (start) and Step 3 (poll). Extend Step 4 "Apply/Rebut" with cross-analysis sub-steps. Code editing is PRESERVED — cross-analysis only enriches the apply/rebuttal decision, it does not remove code editing.

- [ ] **Step 1: Read current impl-review workflow.md**

  Read `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md`. Identify:
  - Where Step 2 (start command) ends — note this is mode-conditional (working-tree vs branch)
  - Where Step 3 (Poll) begins
  - The content of Step 4 "Apply/Rebut" — this will be extended, not replaced

- [ ] **Step 2: Insert Step 2.5 after Step 2**

  After the `node "$RUNNER" start` command block, add:

  ```markdown
  ## 2.5) Information Barrier — Claude Independent Code Analysis

  MUST complete before polling Codex output.
  Codex is running in background — use this time productively.

  **working-tree mode**: run `git diff` and `git diff --cached` yourself
     (or reuse the diff already collected in Step 1 — working tree hasn't changed)
  **branch mode**: run `git diff $BASE_BRANCH...HEAD` yourself
     (or reuse the diff already collected in Step 1)

  Form an independent FINDING-{N} list in working context (do NOT write to a file):
  - Bugs and edge cases
  - Security issues
  - Performance concerns
  - Maintainability problems

  Use the same FINDING-{N} format as `output-format.md` ISSUE-{N} (same field names).
  Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

  INFORMATION BARRIER ends after Round 1 poll completes.
  ```

- [ ] **Step 3: Extend Step 4 with cross-analysis sub-steps**

  Before the existing "For valid issues: edit code and record fix evidence" line in Step 4, add:

  ```markdown
  ### 4a) Parse Codex Output
  Read all `ISSUE-{N}` blocks from `$SESSION_DIR/review.md`.

  ### 4b) Build FINDING↔ISSUE Mapping Table
  Map Claude's FINDING-{N} (from Step 2.5) against Codex's ISSUE-{N}:

  | Claude FINDING-{N} | Codex ISSUE-{M} | Classification |
  |--------------------|-----------------|----------------|
  | ...                | ...             | ...            |

  Classification options:
  - **Genuine Agreement**: FINDING-{N} and ISSUE-{M} identify the same code problem
  - **Codex-only**: ISSUE-{M} has no matching Claude FINDING
  - **Claude-only**: FINDING-{N} has no matching Codex ISSUE
  - **Genuine Disagreement**: Conflicting assessments of the same code

  ### 4c) Apply/Rebut using cross-analysis context
  For each ISSUE-{N}:
  - If genuine agreement or Codex-only → apply fix to code
  - If Claude-only → include in final report as Claude finding
  - If genuine disagreement → write rebuttal with concrete proof (paths, tests, behavior)
  ```

  Keep all existing content below (the branch mode commit requirement, verification requirement, rounds.json update, etc.) — do NOT remove them.

- [ ] **Step 4: Verify Step 2.5 and cross-analysis are present, code editing is preserved**

  ```bash
  grep -n "Information Barrier\|FINDING-{N}\|Cross-Analysis\|4b\|edit code\|commit.*fixes\|branch mode only" \
    skill-packs/codex-review/skills/codex-impl-review/references/workflow.md
  ```
  Expected: matches for both the new cross-analysis content AND the existing "edit code" / "branch mode only" / commit lines.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-impl-review/references/workflow.md
  git commit -m "feat(impl-review): add information barrier Step 2.5 and cross-analysis in Step 4"
  ```

---

## Task 8: Add information barrier Step 2.5 to security-review workflow

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`

**Context:** Same information barrier pattern as plan-review and impl-review. Insert Step 2.5 after Phase 2 `start` command. Also update Phase 3 cross-analysis step to use FINDING↔ISSUE mapping (matching pr-review gold standard).

- [ ] **Step 1: Identify insertion point in security-review workflow.md**

  Read `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`. Find Phase 2 start command and Phase 2 polling step. Step 2.5 goes between them.

- [ ] **Step 2: Insert Step 2.5 in Phase 2**

  After the `node "$RUNNER" start` command in Phase 2, add:

  ```markdown
  ### Phase 2, Step 2.5: Information Barrier — Claude Independent Security Analysis

  MUST complete before polling Codex output.
  Codex is running in background (typically 90-180s) — use this time.

  Using `references/claude-analysis-template.md`:
  - Read all files in scope directly (do NOT read `$SESSION_DIR/review.md`)
  - Identify top attack surfaces
  - Form an independent FINDING-{N} list using OWASP categories
  - Note high-confidence vs uncertain findings

  Keep analysis in working context. Do NOT write a file.
  INFORMATION BARRIER ends after Round 1 poll completes.
  From Round 2 onwards, the barrier no longer applies.
  ```

- [ ] **Step 3: Update Phase 3 cross-analysis step**

  Find the Phase 3 step that processes Codex findings — specifically look for **Phase 3, Step 3** (or the step with a heading like "Parse Security Findings" or "Process Codex Output") that comes after Phase 2 polling completes. This is the step that reads `review.md` and processes each ISSUE block. Add FINDING↔ISSUE mapping to the beginning of that step, using the same classification table format as in Tasks 6 and 7 (Genuine Agreement / Genuine Disagreement / Claude-only / Codex-only / Same Direction Different Severity).

- [ ] **Step 4: Verify Step 2.5, cross-analysis, and classification markers are present**

  ```bash
  grep -n "Information Barrier\|claude-analysis-template\|FINDING.*ISSUE.*Classification\|Genuine Agreement\|Claude-only\|Codex-only\|working context" \
    skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  ```
  Expected: matches for Information Barrier step, template reference, FINDING↔ISSUE mapping table header, and all classification types.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git commit -m "feat(security-review): add information barrier Step 2.5 and FINDING/ISSUE cross-analysis"
  ```

---

## Task 9: Unify VERDICT vocabulary in security-review output-format.md and prompts.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/output-format.md`
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/prompts.md`

**Context:** The primary VERDICT block in `output-format.md` currently shows `Status: APPROVE | REVISE`. The `prompts.md` may have similar inline VERDICT values. Both need to use `CONSENSUS | CONTINUE | STALEMATE`. Note: the `Status` field (separate from `VERDICT`) with values like `{complete | stalemate | in-progress}` is kept as-is.

- [ ] **Step 1: Update output-format.md VERDICT block**

  Read `skill-packs/codex-review/skills/codex-security-review/references/output-format.md`. Find the primary VERDICT block (the one used in normal reviews, not the stalemate format). Change:

  ```
  - Status: APPROVE | REVISE
  ```
  To:
  ```
  - Status: CONSENSUS | CONTINUE | STALEMATE
  ```

  Add descriptions for each value:
  - `CONSENSUS`: All critical/high security issues resolved or agreed-upon — ready to proceed
  - `CONTINUE`: Security issues remain that require another review round
  - `STALEMATE`: Circular debate — same disputes for 2+ rounds with no progress

- [ ] **Step 2: Update prompts.md VERDICT references**

  In `skill-packs/codex-review/skills/codex-security-review/references/prompts.md`, find any instruction lines that reference VERDICT values (e.g., "End with a VERDICT block using APPROVE or REVISE"). Update to reference `CONSENSUS | CONTINUE | STALEMATE` and add: "Use STALEMATE if same arguments repeat for 2+ consecutive rounds with no new evidence."

  The inline VERDICT format sections were already removed in Task 2 (they are now handled by `{OUTPUT_FORMAT}` injection). Only update the instruction text lines.

- [ ] **Step 3: Verify**

  ```bash
  grep -n "APPROVE\|REVISE" \
    skill-packs/codex-review/skills/codex-security-review/references/output-format.md \
    skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  ```
  Expected: zero matches for these old vocabulary values in both files. (The stalemate format section already uses `STALEMATE` which is fine.)

  ```bash
  grep -n "CONSENSUS\|CONTINUE\|STALEMATE" \
    skill-packs/codex-review/skills/codex-security-review/references/output-format.md \
    skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  ```
  Expected: at least one match each in both files.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/references/output-format.md
  git add skill-packs/codex-review/skills/codex-security-review/references/prompts.md
  git commit -m "fix(security-review): unify VERDICT vocabulary to CONSENSUS/CONTINUE/STALEMATE"
  ```

---

## Task 10: Unify VERDICT vocabulary in codex-plan-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/output-format.md`
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/prompts.md`
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`

**Context:** plan-review currently uses `APPROVE | REVISE`. Three files need updates. In `prompts.md`, the VERDICT values are injected via `{OUTPUT_FORMAT}` placeholder (not inline), so only the instruction line "End with a VERDICT block" needs updating. In `workflow.md`, update stop conditions and the final report summary table's Verdict row value.

- [ ] **Step 1: Update output-format.md VERDICT block (all occurrences)**

  Read `skill-packs/codex-review/skills/codex-plan-review/references/output-format.md`. Make these exact replacements:

  **Primary Status line:**
  ```
  - Status: APPROVE | REVISE
  ```
  → Change to:
  ```
  - Status: CONSENSUS | CONTINUE | STALEMATE
  ```

  **Zero-issue rule text (line ~24):** Find the sentence:
  ```
  Status: APPROVE` and `Reason: Plan is complete, well-structured, and addresses all acceptance criteria.
  ```
  Replace `Status: APPROVE` in this sentence with `Status: CONSENSUS`.

  Add descriptions for the updated primary Status values:
  - `CONSENSUS`: No remaining plan issues — ready to implement
  - `CONTINUE`: Issues remain that require another review round
  - `STALEMATE`: Circular debate — same disputes for 2+ rounds with no progress

- [ ] **Step 2: Update prompts.md instruction line**

  In `skill-packs/codex-review/skills/codex-plan-review/references/prompts.md`, find the line "End with a VERDICT block" (or similar wording) in each prompt template. Add: "Use `STALEMATE` if the same arguments repeat for 2+ consecutive rounds with no new evidence."

  Do NOT change the `{OUTPUT_FORMAT}` placeholder — it already injects the updated values from `output-format.md`.

- [ ] **Step 3: Update workflow.md stop condition and final report table**

  In `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`:

  a) Find the stop condition text `VERDICT: APPROVE`. Change to `VERDICT: CONSENSUS`.

  b) Find the final report summary table row for Verdict. Change the value from `{APPROVE/REVISE/STALEMATE}` to `{CONSENSUS/CONTINUE/STALEMATE}`. (This is a value cell, not a table header.)

  c) Update the debate loop branching section:
  - `CONSENSUS` → trigger final report (same behavior as old `APPROVE`)
  - `CONTINUE` → trigger fix/rebuttal and resume (same behavior as old `REVISE`)
  - `STALEMATE` → trigger stalemate handling (check for `STALEMATE` verdict OR same open ISSUE set for 2 consecutive rounds)

- [ ] **Step 4: Verify**

  ```bash
  grep -n "APPROVE\|REVISE" \
    skill-packs/codex-review/skills/codex-plan-review/references/output-format.md \
    skill-packs/codex-review/skills/codex-plan-review/references/prompts.md \
    skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  ```
  Expected: zero matches for old vocabulary in all 3 files (including zero-issue rule text and all workflow occurrences).

  ```bash
  grep -n "CONSENSUS\|CONTINUE\|STALEMATE" \
    skill-packs/codex-review/skills/codex-plan-review/references/output-format.md \
    skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  ```
  Expected: at least 2 matches each.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-plan-review/references/output-format.md
  git add skill-packs/codex-review/skills/codex-plan-review/references/prompts.md
  git add skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  git commit -m "fix(plan-review): unify VERDICT vocabulary to CONSENSUS/CONTINUE/STALEMATE"
  ```

---

## Task 11: Unify VERDICT vocabulary in codex-impl-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/output-format.md`
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/prompts.md`
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md`

**Context:** Same as Task 10 but for impl-review. The `prompts.md` has 4 templates (Working Tree Round 1, Branch Round 1, Rebuttal Working-tree, Rebuttal Branch) — each has an instruction line referencing VERDICT that needs updating. VERDICT values are in `output-format.md` via `{OUTPUT_FORMAT}` placeholder.

- [ ] **Step 1: Update output-format.md VERDICT block (all occurrences)**

  Read `skill-packs/codex-review/skills/codex-impl-review/references/output-format.md`. Make these exact replacements:

  **Primary Status line:**
  ```
  - Status: APPROVE | REVISE
  ```
  → Change to:
  ```
  - Status: CONSENSUS | CONTINUE | STALEMATE
  ```

  **Zero-issue rule text (line ~24):** Find the sentence:
  ```
  Status: APPROVE` and `Reason: All changes are correct, well-tested, and safe to merge.
  ```
  Replace `Status: APPROVE` in this sentence with `Status: CONSENSUS`.

  Add descriptions for the updated primary Status values:
  - `CONSENSUS`: No remaining code issues — changes are correct and safe
  - `CONTINUE`: Issues remain that require fixes and another review round
  - `STALEMATE`: Circular debate — same disputes for 2+ rounds with no progress

- [ ] **Step 2: Update prompts.md — all 4 templates**

  In `skill-packs/codex-review/skills/codex-impl-review/references/prompts.md`, for each of the 4 prompt templates, find the line "End with a VERDICT block." Add to it: "Use `STALEMATE` if the same arguments repeat for 2+ consecutive rounds with no new evidence."

- [ ] **Step 3: Update workflow.md stop conditions and final report**

  Same changes as Task 10 Step 3 but in `codex-impl-review/references/workflow.md`:

  a) Change `VERDICT: APPROVE` stop condition → `VERDICT: CONSENSUS`

  b) Change Verdict row value in final report summary table: `{APPROVE/REVISE/STALEMATE}` → `{CONSENSUS/CONTINUE/STALEMATE}`

  c) Update debate loop branching for CONSENSUS / CONTINUE / STALEMATE (same logic as plan-review).

- [ ] **Step 4: Verify**

  ```bash
  grep -n "APPROVE\|REVISE" \
    skill-packs/codex-review/skills/codex-impl-review/references/output-format.md \
    skill-packs/codex-review/skills/codex-impl-review/references/prompts.md \
    skill-packs/codex-review/skills/codex-impl-review/references/workflow.md
  ```
  Expected: zero matches for old vocabulary in all 3 files.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-impl-review/references/output-format.md
  git add skill-packs/codex-review/skills/codex-impl-review/references/prompts.md
  git add skill-packs/codex-review/skills/codex-impl-review/references/workflow.md
  git commit -m "fix(impl-review): unify VERDICT vocabulary to CONSENSUS/CONTINUE/STALEMATE"
  ```

---

## Task 12: Final verification pass

**Files:** None modified.

- [ ] **Step 1: Verify all 5 bugs are fixed**

  ```bash
  # Bug 1: No AskUserQuestion in security-review
  grep -rn "AskUserQuestion" skill-packs/codex-review/skills/

  # Bug 2: No nested backtick fences + OUTPUT_FORMAT present in security prompts.md
  grep -n "OUTPUT_FORMAT" skill-packs/codex-review/skills/codex-security-review/references/prompts.md

  # Bug 3: pr-review has $BASE_BRANCH not $SCOPE
  grep -n '"scope"' skill-packs/codex-review/skills/codex-pr-review/references/workflow.md

  # Bug 4: No subagent_type in parallel-review
  grep -rn "subagent_type" skill-packs/codex-review/skills/codex-parallel-review/

  # Bug 5: No docs/security-reviews in security-review, no "Apply the suggested fix"
  grep -rn "docs/security-reviews\|Apply the suggested fix" skill-packs/codex-review/skills/codex-security-review/
  ```

  Expected: all searches return zero matches.

- [ ] **Step 2: Verify information barriers exist in 3 skills**

  ```bash
  grep -rn "Information Barrier" skill-packs/codex-review/skills/
  ```
  Expected: matches in `codex-security-review`, `codex-plan-review`, `codex-impl-review` — NOT in `codex-pr-review` (already had it), commit-review (already had it).

- [ ] **Step 3: Verify VERDICT vocabulary is unified**

  ```bash
  # Old vocabulary should NOT appear in the 3 updated skills
  grep -rn "VERDICT.*APPROVE\|VERDICT.*REVISE\|Status: APPROVE\|Status: REVISE" \
    skill-packs/codex-review/skills/codex-plan-review/ \
    skill-packs/codex-review/skills/codex-impl-review/ \
    skill-packs/codex-review/skills/codex-security-review/

  # New vocabulary SHOULD appear
  grep -rn "CONSENSUS\|CONTINUE\|STALEMATE" \
    skill-packs/codex-review/skills/codex-plan-review/ \
    skill-packs/codex-review/skills/codex-impl-review/ \
    skill-packs/codex-review/skills/codex-security-review/
  ```

  Expected: first grep has zero matches; second grep has multiple matches.

- [ ] **Step 4: Verify unmodified skills are untouched**

  ```bash
  # Verify commit-review still uses its original vocabulary (unchanged)
  grep -n "APPROVE\|REVISE\|CONSENSUS\|CONTINUE\|STALEMATE\|Information Barrier" \
    skill-packs/codex-review/skills/codex-commit-review/references/workflow.md | head -5

  # Verify think-about and codebase-review have no VERDICT/APPROVE vocabulary changes
  grep -rn "CONSENSUS\|STALEMATE" \
    skill-packs/codex-review/skills/codex-think-about/ \
    skill-packs/codex-review/skills/codex-codebase-review/
  ```
  Expected for think-about/codebase-review: zero matches for new vocabulary (confirming they were not modified).

- [ ] **Step 5: Verify clean working tree**

  ```bash
  git status --short
  ```
  Expected: empty output or only untracked/ignored files (all task changes committed).
