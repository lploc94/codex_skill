<h1 align="center"><b>Codex Review Skill</b></h1>

<p align="center">
  <img src="https://i.postimg.cc/vZY5Y5gC/Codex-skill.png" alt="Codex Skill" />
</p>

Single-command installer for the **codex-review** skill pack for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Five core skills (installed by default):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)

Three additional skills (installed with `-full`):
- `/codex-parallel-review` — parallel independent review by both Claude and Codex, then debate
- `/codex-codebase-review` — chunked full-codebase review for large projects (50-500+ files)
- `/codex-security-review` — security-focused review using OWASP Top 10 and CWE patterns

## Requirements

- Node.js >= 22
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) in PATH
- OpenAI API key configured for Codex

## Install

```bash
npx github:lploc94/codex_skill        # 5 core skills
npx github:lploc94/codex_skill -full   # all 8 skills
```

### What it does
1. Installs skills directly into `~/.claude/skills/` (one directory per skill)
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
npx github:lploc94/codex_skill        # or with -full
```

### Auto-review guidance (optional)
```bash
npx github:lploc94/codex_skill --auto
```
Injects review guidance into `~/.claude/CLAUDE.md` so Claude Code proactively suggests the right review skill based on context (e.g., `/codex-impl-review` before commits, `/codex-security-review` for auth code). Idempotent — safe to re-run. Can combine with `-full`.

## Usage

After install, start Claude Code and run:

**Core skills** (always installed):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)

**Full skills** (requires `-full` flag):
- `/codex-parallel-review` — parallel dual-reviewer analysis + debate
- `/codex-codebase-review` — chunked full-codebase review (50-500+ files)
- `/codex-security-review` — security-focused review (OWASP Top 10 + CWE patterns)

## License

MIT
