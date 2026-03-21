---
name: codex-think-about
description: Peer debate between Claude Code and Codex on any technical question. Both sides think independently, challenge each other, and converge to consensus or explicit disagreement.
---

# Codex Think About

## Purpose
Use this skill for peer reasoning, not code review. Claude and Codex are equal analytical peers; Claude orchestrates the debate loop and final synthesis.

## Prerequisites
- A clear question or decision topic from the user.
- `codex` CLI installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Sharpen question** — follow `references/question-sharpening.md`.
   Confirm sharpened question with user (Y/n). The confirmed question
   becomes `{QUESTION}` for all subsequent steps (including Claude's own
   independent analysis and all Codex prompt rounds).
2. **Ask user** to choose reasoning effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Gather factual context only (no premature opinion). Set `EFFORT`.
3. Build round-1 prompt from `references/prompts.md`.
4. **Start Codex + Claude Independent Analysis (parallel)**:
   a. Start Codex thread: `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT" --sandbox danger-full-access`.
   b. **Claude Independent Analysis (IMMEDIATELY, before polling)**: Analyze the question independently using own knowledge and optionally MCP tools. Follow the structured format in `references/claude-analysis-template.md`. Complete this BEFORE reading any Codex output. See `references/workflow.md` Step 2.5 for detailed instructions.
   c. **INFORMATION BARRIER**: Do NOT read `$STATE_DIR/review.md` or interpret Codex's conclusions until Step 5. Poll activity telemetry (file reads, URLs, topics) is allowed for progress reporting.
5. Poll Codex with adaptive intervals (Round 1: 90s/60s/30s/15s..., Round 2+: 45s/30s/15s...). After each poll, report **specific activities** from poll output. See `references/workflow.md` for parsing guide. NEVER report generic "Codex is running".
6. **Cross-Analysis**: After Codex completes, compare Claude's independent analysis with Codex output. Identify genuine agreements, genuine disagreements, and unique perspectives from each side. See `references/workflow.md` Step 4.
7. Resume via `--thread-id` and loop until consensus, stalemate, or hard cap (5 rounds).
8. Present user-facing synthesis with agreements, disagreements, cited sources, and confidence.

### Effort Level Guide
| Level    | Depth             | Best for                        |
|----------|-------------------|---------------------------------|
| `low`    | Surface check     | Quick sanity check              |
| `medium` | Standard review   | Most day-to-day work            |
| `high`   | Deep analysis     | Important features              |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     |

## Required References
- Question sharpening: `references/question-sharpening.md`
- Execution loop: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`
- Claude analysis format: `references/claude-analysis-template.md`

## Rules
- Keep roles as peers; no reviewer/implementer framing.
- **Codex must NOT modify, create, or delete ANY project files.** `danger-full-access` sandbox is used SOLELY for web search. Prompt contains strict guardrails.
- Codex MUST cite sources (URL) for factual claims from web.
- Separate researched facts (with sources) from opinions.
- Detect stalemate when arguments repeat with no new evidence.
- End with clear recommendations, source list, and open questions.
- **Information barrier**: Claude MUST complete its independent analysis (Step 3b) before reading Codex output. This prevents anchoring bias.
