# codex-skill

Single-command installer for the **codex-review** skill pack for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Six skills powered by [OpenAI Codex CLI](https://github.com/openai/codex):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)
- `/codex-parallel-review` — parallel independent review by both Claude and Codex, then debate

## Requirements

- Node.js >= 22
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) in PATH
- OpenAI API key configured for Codex

## Install

```bash
npx github:lploc94/codex_skill
```

### What it does
1. Installs 6 skills directly into `~/.claude/skills/` (one directory per skill)
2. Copies the shared `codex-runner.js` to `~/.claude/skills/codex-review/scripts/`
3. Injects the absolute runner path into each SKILL.md template
4. Validates templates and references before finalizing
5. Atomic swap per directory with rollback on failure

### Verify
```bash
node ~/.claude/skills/codex-review/scripts/codex-runner.js version
```

### Reinstall / Update
```bash
npx github:lploc94/codex_skill
```

## Usage

After install, start Claude Code and run:
- `/codex-plan-review` to debate implementation plans before coding.
- `/codex-impl-review` to review uncommitted or branch changes before commit/merge.
- `/codex-think-about` for peer reasoning with Codex.
- `/codex-commit-review` to review commit messages.
- `/codex-pr-review` to review PRs (branch diff + description).
- `/codex-parallel-review` for parallel dual-reviewer analysis + debate.

## Performance Optimizations

Recent improvements make reviews **50-92% faster** for most repositories:

### Adaptive Timeout
Automatically scales timeout based on repository size:
- **Small repos** (< 50 files): 5 minutes (91.7% faster)
- **Medium repos** (50-200 files): 15 minutes (75% faster)
- **Large repos** (200-500 files): 30 minutes (50% faster)
- **Very large repos** (> 500 files): 60 minutes (unchanged)

No configuration needed - the runner automatically counts source files and adjusts timeout accordingly.

### Smart File Filtering
Review prompts now guide Codex to focus on relevant files:
- **Plan reviews**: Skip test files by default, focus on implementation files mentioned in the plan
- **Implementation reviews**: Light review of test changes, concentrate on business logic
- Reduces file reads by 40-60%

### Effort Level Presets
Choose review depth based on your needs:
- `low`: 2-5 min (quick sanity check)
- `medium`: 5-10 min (balanced, recommended)
- `high`: 10-20 min (thorough analysis)
- `xhigh`: 20-40 min (exhaustive review)

### Enhanced Progress Reporting
Better visibility during reviews:
- File counter tracking
- Progress grouped by file type
- Cumulative progress display
- Remaining time estimation

## License

MIT
