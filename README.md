# codex-skill

Single-command installer for the **codex-review** skill pack for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Five skills powered by [OpenAI Codex CLI](https://github.com/openai/codex):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)

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
1. Installs 5 skills directly into `~/.claude/skills/` (one directory per skill)
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

## License

MIT
