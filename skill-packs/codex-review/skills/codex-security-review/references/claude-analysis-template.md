# Claude Independent Security Analysis Template

> Use this template for Step 2.5 (Information Barrier).
> Record analysis in working context ONLY — do NOT write to a file.
> Do NOT read `$SESSION_DIR/review.md` until this analysis is complete.

## FINDING-{N} Format

Use this exact shape for each independent finding:

### FINDING-{N}: {Short title}
- Category: injection | broken-auth | sensitive-data | xxe | broken-access | security-config | xss | insecure-deserialization | logging | ssrf | crypto-failure | insecure-design | vulnerable-components | integrity-failure
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
