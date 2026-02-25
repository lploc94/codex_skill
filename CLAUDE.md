# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code plugin (`codex-review`) that uses OpenAI Codex CLI as an adversarial reviewer and peer thinker. Three skills orchestrate multi-round debates between Claude Code and Codex until consensus:

- `/codex-plan-review` — reviews implementation plans before coding
- `/codex-impl-review` — reviews uncommitted code changes before committing
- `/codex-think-about` — peer debate on any question (both AIs think independently, discuss, reach consensus or present disagreements)

## Requirements

- Claude Code CLI
- OpenAI Codex CLI installed and in PATH (`codex` command)
- OpenAI API key configured for Codex

## Development Commands

**Check embedding consistency** (verifies codex-runner.sh version matches across all embedded locations):
```bash
./plugins/codex-review/scripts/embed-runner.sh --check
```

There is no build system, test suite, or linter. The project is pure Bash + Markdown + JSON.

## Architecture

### Plugin Layout

```
plugins/codex-review/
├── .claude-plugin/plugin.json    # Plugin metadata (name, version, author)
├── hooks/hooks.json              # SessionStart hook — installs codex-runner.sh to ~/.local/bin/
├── scripts/
│   ├── codex-runner.sh           # Source of truth for the runner script
│   └── embed-runner.sh           # Checks version consistency across embeddings
└── skills/
    ├── codex-plan-review/SKILL.md
    ├── codex-impl-review/SKILL.md
    └── codex-think-about/SKILL.md
```

### Core Execution Flow

1. **SessionStart hook** installs `codex-runner.sh` to `~/.local/bin/` (version-checked, skips if current)
2. **Skill invocation** (`/codex-plan-review`, `/codex-impl-review`, or `/codex-think-about`) follows SKILL.md step-by-step
3. **codex-runner.sh** spawns `codex exec --json --sandbox read-only` in background, polls JSONL output every 15s
4. **Review debate loop** (plan-review, impl-review): Claude Code parses Codex's `ISSUE-{N}` review → fixes/rebuts → resumes via `--thread-id` → repeats until `APPROVE` verdict or stalemate
5. **Peer debate loop** (think-about): Claude Code and Codex think independently → discuss → exchange perspectives → repeat until consensus or stalemate → present to user

### Key Design Decisions

- **Prompt minimalism**: Prompts contain only file paths and context; Codex reads files/diffs itself
- **Structured output**: Review skills (plan-review, impl-review) use `ISSUE-{N}` format with `VERDICT` block; think-about uses a thinking-session format (Key Insights / Considerations / Recommendations)
- **Thread persistence**: First call creates a thread; subsequent rounds use `codex exec resume <thread_id>`
- **Stalemate detection**: Stops if same points repeat for 2 consecutive rounds with no progress
- **Peer equality** (think-about): Both AIs are equal thinkers — neither is reviewer nor implementer; both contribute ideas and counterarguments

### Script Embedding Pattern

`codex-runner.sh` is embedded in four places:
- `hooks/hooks.json` (for SessionStart installation)
- `skills/codex-plan-review/SKILL.md`
- `skills/codex-impl-review/SKILL.md`
- `skills/codex-think-about/SKILL.md`

When updating the runner script, run `embed-runner.sh --check` to detect version drift. Drift must be fixed manually — the checker only reports, it does not auto-update.

### codex-runner.sh Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Timeout (default 3600s) |
| 3 | Turn failed |
| 4 | Stalled (no output for ~3 minutes) |
| 5 | Codex CLI not found in PATH |

## Verification

No automated tests. To verify changes:
1. Run `./plugins/codex-review/scripts/embed-runner.sh --check` to confirm no version drift
2. Start a Claude Code session and invoke `/codex-plan-review`, `/codex-impl-review`, or `/codex-think-about` to test end-to-end
