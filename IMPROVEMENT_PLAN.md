# Codex Skill Pack - Improvement Plan

**Date**: March 7, 2026  
**Version**: 1.0  
**Status**: Draft for Review

---

## Executive Summary

This plan outlines improvements to the `codex-review` skill pack across two dimensions:
1. **New Skills**: 5 specialized review skills aligned with industry standards
2. **Existing Skill Improvements**: Output format standardization, workflow enhancements, and feature additions

**Key Findings**:
- Current 7 skills have **inconsistent output formats** (3 different structures)
- Industry standard **SARIF format** not supported
- Missing critical review types: **security, performance, accessibility, testing, documentation**
- Runner architecture is **extensible** without major changes for most improvements

---

## Part 1: New Skill Proposals

### 1.1 Security-Focused Review (`codex-security-review`)

**Priority**: 🔴 HIGH  
**Effort**: Medium (2-3 weeks)

**Use Case**:
- OWASP Top 10 vulnerability scanning
- Secrets/credentials detection in code
- Authentication/authorization pattern review
- Supply chain security analysis (dependency audit)

**Output Format**:
```
ISSUE-{N}: {vulnerability_title}
Category: injection | broken-auth | sensitive-data | xxe | broken-access | security-config | xss | insecure-deserialization | logging | ssrf
Severity: critical | high | medium | low
CWE: CWE-89 (SQL Injection)
OWASP: A03:2021 - Injection

Problem: [description]
Evidence: [code snippet with line numbers]
Attack Vector: [how this could be exploited]
Suggested Fix: [secure code example]
```

**Prerequisites**:
- Working directory with source code
- Optional: dependency manifest files (package.json, requirements.txt)

**Runner Changes**: None (uses existing `start/poll/stop` workflow)

**References Needed**:
- `references/prompts.md`: Security-focused prompt with OWASP checklist
- `references/output-format.md`: Security category definitions + CWE mapping
- `references/workflow.md`: Standard debate loop

---

### 1.2 Performance Review (`codex-performance-review`)

**Priority**: 🟡 MEDIUM  
**Effort**: Medium (2-3 weeks)

**Use Case**:
- Database query optimization (N+1 detection)
- Algorithm complexity analysis (Big-O)
- Memory leak detection
- Async/concurrency anti-patterns

**Output Format**:
```
ISSUE-{N}: {performance_issue_title}
Category: database | algorithm | memory | concurrency | caching | network
Severity: critical | high | medium | low
Impact: [estimated performance impact - e.g., "10x slower on large datasets"]

Problem: [description]
Evidence: [code snippet + profiling data if available]
Complexity: O(n²) → O(n log n)
Suggested Fix: [optimized code example]
```

**Prerequisites**:
- Working directory with source code
- Optional: profiling data, benchmark results

**Runner Changes**: None

**Unique Features**:
- Complexity analysis output (Big-O notation)
- Impact estimation (qualitative)
- Benchmark comparison suggestions

---

### 1.3 Accessibility Review (`codex-a11y-review`)

**Priority**: 🟡 MEDIUM  
**Effort**: Low-Medium (1-2 weeks)

**Use Case**:
- WCAG 2.1/2.2 compliance checking
- ARIA attribute validation
- Keyboard navigation review
- Screen reader compatibility

**Output Format**:
```
ISSUE-{N}: {accessibility_issue_title}
Category: aria | keyboard | contrast | semantic | focus | screen-reader
Severity: critical | high | medium | low
WCAG: 2.1 Level AA - 1.4.3 Contrast (Minimum)

Problem: [description]
Evidence: [HTML/JSX snippet]
User Impact: [how this affects users with disabilities]
Suggested Fix: [accessible code example]
```

**Prerequisites**:
- Frontend code (HTML, JSX, Vue, etc.)

**Runner Changes**: None

**Unique Features**:
- WCAG level mapping (A, AA, AAA)
- User impact descriptions
- Screen reader testing recommendations

---

### 1.4 Test Coverage Review (`codex-test-review`)

**Priority**: 🟢 LOW-MEDIUM  
**Effort**: Medium (2-3 weeks)

**Use Case**:
- Missing test detection
- Edge case coverage analysis
- Test quality assessment (brittle tests, over-mocking)
- Mutation testing suggestions

**Output Format**:
```
ISSUE-{N}: {test_gap_title}
Category: missing-test | edge-case | brittle-test | over-mocking | assertion-quality
Severity: high | medium | low

Problem: [description]
Evidence: [code snippet showing untested path]
Coverage Gap: [specific scenarios not covered]
Suggested Test: [test code example]
```

**Prerequisites**:
- Source code + test files
- Optional: coverage report (lcov, cobertura)

**Runner Changes**: None

**Unique Features**:
- Coverage gap identification
- Test code generation
- Mutation testing recommendations

---

### 1.5 Documentation Review (`codex-docs-review`)

**Priority**: 🟢 LOW  
**Effort**: Low (1 week)

**Use Case**:
- API documentation completeness
- README quality assessment
- Code comment quality
- Changelog validation

**Output Format**:
```
ISSUE-{N}: {documentation_gap_title}
Category: api-docs | readme | comments | changelog | architecture-docs
Severity: high | medium | low

Problem: [description]
Evidence: [missing/outdated documentation example]
User Impact: [how this affects developers using the code]
Suggested Documentation: [documentation example]
```

**Prerequisites**:
- Source code + documentation files

**Runner Changes**: None

**Unique Features**:
- Documentation generation suggestions
- API reference completeness check
- Changelog format validation

---

## Part 2: Existing Skill Improvements

### 2.1 Output Format Standardization (ALL SKILLS)

**Priority**: 🔴 HIGH  
**Effort**: High (3-4 weeks)

**Problem**:
- 3 different output formats across 7 skills:
  - **ISSUE-{N} + VERDICT** (5 skills)
  - **Structured Reasoning** (think-about only)
  - **ISSUE-{N} + CROSS-{N} + RESPONSE-{N}** (codebase-review only)
- Category enums vary per skill (makes parsing harder)
- No machine-readable format (SARIF, JSON)

**Solution**: Introduce **dual output format**

#### Phase 1: Add SARIF JSON Output (Optional Flag)

Add `--format` parameter to runner:
```bash
node "$RUNNER" start --working-dir "$PWD" --effort high --format sarif
```

**Runner Changes Required**:
- Add `--format` parameter (default: `markdown`, options: `markdown`, `sarif`, `json`, `both`)
- **CRITICAL ARCHITECTURE**: Implement canonical JSON schema first
  1. Codex outputs structured findings → Parse to canonical JSON
  2. Canonical JSON → Render to Markdown (human-readable)
  3. Canonical JSON → Render to SARIF (machine-readable)
- Write outputs to `$STATE_DIR/review.json`, `$STATE_DIR/review.md`, `$STATE_DIR/review.sarif.json`

**Why This Approach**:
- ❌ **DON'T**: Parse markdown with regex → brittle, breaks on format drift
- ✅ **DO**: Single source of truth (JSON) → Multiple renderers (stable, testable)

**SARIF Structure**:
```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "codex-review",
        "version": "8",
        "informationUri": "https://github.com/lploc94/codex_skill"
      }
    },
    "results": [{
      "ruleId": "IMPL-BUG-001",
      "level": "error",
      "message": { "text": "Null pointer dereference" },
      "locations": [{
        "physicalLocation": {
          "artifactLocation": { "uri": "src/auth.js" },
          "region": { "startLine": 42, "endLine": 45 }
        }
      }],
      "fixes": [{
        "description": { "text": "Add null check" },
        "artifactChanges": [...]
      }]
    }]
  }]
}
```

**Benefits**:
- IDE integration (VS Code SARIF viewer)
- CI/CD pipeline integration
- Standardized tooling support

#### Phase 2: Unify Category Taxonomy

**Current State**:
```
Plan:       correctness | architecture | sequencing | risk | scope
Impl:       bug | edge-case | security | performance | maintainability
Commit:     clarity | convention | scope | accuracy | structure
PR:         bug | edge-case | security | performance | maintainability | pr-description | commit-hygiene | scope
```

**Proposed Unified Taxonomy**:
```
Core Categories (all skills):
- correctness
- security
- performance
- maintainability
- edge-case

Skill-Specific Extensions:
- Plan: + architecture, sequencing, risk, scope
- Commit: + clarity, convention, accuracy, structure
- PR: + pr-description, commit-hygiene, scope
- Security: + injection, broken-auth, sensitive-data, etc.
- Performance: + database, algorithm, memory, concurrency
- A11y: + aria, keyboard, contrast, semantic
```

**Implementation**:
- Update all `references/output-format.md` files
- Add category mapping table in each skill
- Backward compatible (old categories still work)

---

### 2.2 Enhanced Metadata in Output (ALL SKILLS)

**Priority**: 🟡 MEDIUM  
**Effort**: Low (1 week)

**Add to all ISSUE-{N} blocks**:
```markdown
ISSUE-{N}: {title}
Category: {category}
Severity: {severity}
File: src/auth.js:42-45          ← NEW: Precise location
Confidence: high | medium | low   ← NEW: AI confidence level
Related: ISSUE-2, ISSUE-5         ← NEW: Cross-references
External: https://owasp.org/...   ← NEW: Reference links

Problem: [description]
Evidence: [code]
Suggested Fix: [fix]
```

**Runner Changes**: None (prompt-level change)

**Benefits**:
- Better traceability
- Confidence scoring for AI suggestions
- Cross-issue relationships
- External reference links

---

### 2.3 Interactive Fix Application (ALL REVIEW SKILLS)

**Priority**: 🟡 MEDIUM  
**Effort**: Medium (2-3 weeks)

**Feature**: One-click fix application (like GitHub Copilot)

**Workflow**:
1. Codex suggests fix in structured format
2. Claude Code presents: "Apply fix to src/auth.js:42-45? [y/n/edit]"
3. User confirms → Claude applies edit directly
4. Resume review with applied changes

**Runner Changes**: None (skill-level workflow)

**Implementation**:
- Parse `Suggested Fix` code blocks
- Use Edit tool to apply changes
- Track applied fixes in round summary
- Resume thread with "Applied fixes: ISSUE-1, ISSUE-3"

**Benefits**:
- Faster iteration
- Reduced manual copy-paste
- Audit trail of applied fixes

---

### 2.4 Improve `codex-think-about` Output Format

**Priority**: 🟢 LOW  
**Effort**: Low (1 week)

**Problem**: Completely different output format from other skills

**Current**:
```
Key Insights:
- Point 1
- Point 2

Considerations:
- Point 1

Recommendations:
- Point 1
```

**Proposed**: Map to ISSUE-like structure
```
PERSPECTIVE-{N}: {insight_title}
Type: insight | consideration | recommendation | open-question
Confidence: high | medium | low
Source: Claude | Codex | Consensus

Content: [detailed explanation]
Implications: [what this means for the project]
Next Steps: [actionable items]
```

**Benefits**:
- Consistent parsing across all skills
- Better traceability
- Severity/confidence scoring

---

### 2.5 Context Propagation Improvements (`codex-codebase-review`)

**Priority**: 🟢 LOW  
**Effort**: Low (1 week)

**Current**: 2000 token cap on context propagation between chunks

**Proposed**:
- Increase to 4000 tokens (Claude Sonnet 4 has 1M context)
- Add "Critical Findings Summary" section (top 5 issues)
- Track cross-chunk patterns (e.g., "Same pattern in 3 modules")

**Runner Changes**: None (prompt-level change)

---

### 2.6 ~~Parallel Execution~~ (REMOVED - Already Exists)

**Status**: ❌ REMOVED FROM PLAN

**Reason**: Codex review found that `codex-codebase-review` already implements parallel execution via `parallel_factor` parameter. This was incorrectly listed as new work.

**Evidence**: See `skill-packs/codex-review/skills/codex-codebase-review/SKILL.md:23` and `references/workflow.md:194`

**Alternative**: If parallel execution needs improvement, reframe as "Parallel Execution Hardening" focusing on:
- Rate limit handling
- Batching strategy optimization
- Merge quality improvements
- Error recovery in parallel mode

---

## Part 3: Implementation Priority Matrix

| Improvement | Impact | Effort | Priority | Timeline |
|-------------|--------|--------|----------|----------|
| **Output Format Standardization** | 🔴 High | High | 🔴 P0 | Weeks 1-4 |
| **New Skill: Security Review** | 🔴 High | Medium | 🔴 P0 | Weeks 5-7 |
| **Enhanced Metadata** | 🟡 Medium | Low | 🟡 P1 | Week 8 |
| **New Skill: Performance Review** | 🟡 Medium | Medium | 🟡 P1 | Weeks 9-11 |
| **Interactive Fix Application** | 🟡 Medium | Medium | 🟢 P2 | Weeks 12-14 |
| **New Skill: Accessibility Review** | 🟡 Medium | Low | 🟢 P2 | Weeks 15-16 |
| ~~**Parallel Codebase Review**~~ | ❌ Removed | - | - | Already exists |
| **New Skill: Test Coverage Review** | 🟢 Low | Medium | 🟢 P3 | Optional |
| **Improve think-about Format** | 🟢 Low | Low | 🟢 P3 | Optional |
| **New Skill: Documentation Review** | 🟢 Low | Low | 🟢 P3 | Optional |
| **Context Propagation Improvements** | 🟢 Low | Low | 🟢 P3 | Optional |

**Total Timeline**: ~4 months (16 weeks for critical + high-value items)

**Revised Priorities** (based on Codex review):
- **P0 (Weeks 1-7)**: Foundation - Output Format + Security Review
- **P1 (Weeks 8-11)**: High-value features - Metadata + Performance Review
- **P2 (Weeks 12-16)**: UX Polish - Interactive Fixes + Accessibility (if targeting right market)
- **P3 (Optional)**: Nice-to-have items - implement only if resources available

---

## Part 4: Technical Considerations

### 4.1 Runner Architecture Changes

**Required Changes**:
1. **SARIF Output Support** (Phase 1)
   - Add `--format` parameter
   - Implement markdown → SARIF converter
   - Write SARIF to separate file

2. **No Other Runner Changes Needed**
   - All new skills use existing `start/poll/stop` workflow
   - All improvements are prompt-level or skill-level

**Extension Points**:
- Runner is **highly extensible** via prompts
- State management is **generic** (works for any skill)
- Polling logic is **skill-agnostic**

### 4.2 Backward Compatibility

**Strategy**: Dual format support
- Default: Markdown (current format)
- Optional: SARIF JSON (`--format sarif`)
- Both formats coexist

**Migration Path**:
1. Phase 1: Add SARIF support (opt-in)
2. Phase 2: Update all skills to support both formats
3. Phase 3: Deprecate markdown-only mode (future)

### 4.3 Dependencies

**Current**: Zero dependencies (Node.js stdlib only)

**Proposed**: Stay dependency-free
- SARIF generation: Manual JSON construction (no library)
- Markdown parsing: Regex-based (no parser library)

**Rationale**: Maintain zero-dependency philosophy for easy distribution

### 4.4 Testing Strategy

**Current**: No test suite

**Proposed**: Add integration tests
1. **Runner tests**: Verify start/poll/stop/version commands
2. **Format tests**: Verify SARIF output structure
3. **Skill tests**: End-to-end tests for each skill

**Implementation**: Use Node.js built-in `node:test` (no external framework)

---

## Part 5: Success Metrics

### 5.1 Adoption Metrics
- Number of skills installed per user
- Most-used skills (track via telemetry opt-in)
- Skill invocation frequency

### 5.2 Quality Metrics
- Issue detection rate (true positives vs false positives)
- Fix acceptance rate (how many suggested fixes are applied)
- Stalemate rate (how often reviews reach stalemate)

### 5.3 Performance Metrics
- Average review time per skill
- Parallel speedup factor (codebase-review)
- Token usage per review

---

## Part 6: Next Steps

### Immediate Actions (Week 1)
1. ✅ Review this plan with stakeholders
2. ⬜ Prioritize P0 items (Output Format + Security Review)
3. ⬜ Create detailed design doc for SARIF support
4. ⬜ Set up test infrastructure

### Short-term (Weeks 2-8)
1. ⬜ Implement SARIF output support
2. ⬜ Standardize category taxonomy
3. ⬜ Build Security Review skill
4. ⬜ Add enhanced metadata to all skills

### Medium-term (Weeks 9-17)
1. ⬜ Interactive fix application
2. ⬜ Performance Review skill
3. ⬜ Accessibility Review skill
4. ⬜ Parallel codebase review

### Long-term (Weeks 18-23)
1. ⬜ Test Coverage Review skill
2. ⬜ Documentation Review skill
3. ⬜ Minor improvements (think-about format, context propagation)

---

## Appendix A: Industry Comparison

| Feature | codex-review (Current) | GitHub Copilot | Cursor | Qodo |
|---------|------------------------|----------------|--------|------|
| Plan Review | ✅ | ❌ | ❌ | ❌ |
| Code Review | ✅ | ✅ | ✅ | ✅ |
| Commit Review | ✅ | ❌ | ❌ | ❌ |
| PR Review | ✅ | ✅ | ✅ | ✅ |
| Parallel Review | ✅ | ❌ | ❌ | ❌ |
| Codebase Review | ✅ | ❌ | ❌ | ✅ |
| Security Focus | ❌ | ✅ | ❌ | ✅ |
| Performance Focus | ❌ | ✅ | ❌ | ❌ |
| Accessibility Focus | ❌ | ✅ | ❌ | ❌ |
| Test Coverage | ❌ | ❌ | ❌ | ✅ |
| SARIF Output | ❌ | ✅ | ❌ | ✅ |
| One-click Fixes | ❌ | ✅ | ✅ | ✅ |

**Competitive Advantages** (after improvements):
- ✅ Most comprehensive skill set (12 skills vs 3-5 competitors)
- ✅ Plan review (unique)
- ✅ Parallel multi-agent review (unique)
- ✅ Zero dependencies (easy install)
- ✅ Open source + self-hosted

---

## Appendix B: References

### Industry Standards
- [SARIF v2.1.0 Specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/)
- [OWASP Top 10 2025](https://owasp.org/www-project-top-ten/)
- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [GitHub PR Review API](https://docs.github.com/rest/pulls/reviews)

### Competitive Analysis
- [GitHub Copilot Code Review](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Cursor Automations](https://techcrunch.com/2026/03/05/cursor-is-rolling-out-a-new-system-for-agentic-coding/)
- [Qodo 2.0 Agentic Review](https://www.qodo.ai/blog/introducing-qodo-2-0-agentic-code-review/)
- [Sourcegraph Cody](https://aiforcode.io/tools/sourcegraph-cody)

---

**End of Improvement Plan**
