# codex-skill

CLI that installs the **codex-review** skill pack for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

The pack provides three skills powered by [OpenAI Codex CLI](https://github.com/openai/codex):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted changes before commit
- `/codex-think-about` — peer reasoning/debate on technical topics

## Requirements

- Node.js >= 20
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) in PATH
- OpenAI API key configured for Codex

## Install

### From GitHub (recommended)

```bash
npm install -g github:lploc94/codex_skill
```

Or if you want to clone and develop:

```bash
git clone https://github.com/lploc94/codex_skill.git
cd codex_skill
npm link
```

### Global scope

```bash
codex-skill init -g
```

Installs skills to `~/.claude/skills/codex-review/`.

### Project scope

```bash
codex-skill init
```

Installs skills to `<project>/.claude/skills/codex-review/`.

## Verify

```bash
codex-skill doctor
```

## Usage

After install, start Claude Code and run:
- `/codex-plan-review` to debate implementation plans before coding.
- `/codex-impl-review` to review uncommitted changes before commit.
- `/codex-think-about` for peer reasoning with Codex.

## CLI Reference

```bash
codex-skill [init] [options]
codex-skill doctor [options]
```

Options:
- `-g, --global`: global scope (`~/.claude/skills`)
- `--cwd <path>`: project root for local scope
- `--force`: replace existing install
- `--dry-run`: print actions without writing
- `-h, --help`: help
- `-v, --version`: version

## Project Structure

```text
.
├── bin/
│   └── codex-skill.js
├── src/
│   ├── cli/
│   ├── commands/
│   └── lib/
├── skill-packs/
│   └── codex-review/
│       ├── manifest.json
│       ├── scripts/
│       │   └── codex-runner.js      ← shared Node.js runner
│       └── skills/
│           ├── codex-plan-review/
│           │   ├── SKILL.md
│           │   └── references/
│           ├── codex-impl-review/
│           │   ├── SKILL.md
│           │   └── references/
│           └── codex-think-about/
│               ├── SKILL.md
│               └── references/
├── CLAUDE.md
└── package.json
```

## License

MIT
