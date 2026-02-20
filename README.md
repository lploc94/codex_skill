# codex-review

Claude Code plugin that uses OpenAI Codex CLI as an adversarial reviewer. Two skills: one reviews your implementation plan before you write code, the other reviews your code changes before you commit.

Both skills run multiple debate rounds — Codex finds issues, Claude Code fixes or rebuts, Codex re-reviews — until they reach consensus.

## Skills

| Command | What it does |
| --- | --- |
| `/codex-plan-review` | Codex reviews your implementation plan. Claude Code and Codex debate until the plan is solid, then you implement. |
| `/codex-impl-review` | Codex reviews your uncommitted code changes. Claude Code fixes valid issues and pushes back on invalid ones. Repeats until consensus. |

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI)
- [OpenAI Codex CLI](https://github.com/openai/codex) installed and available in PATH
- An OpenAI API key configured for Codex

## Installation

### From Claude Code CLI

```bash
claude mcp add-plugin codex-review --source https://github.com/lploc94/codex-review
```

### Manual installation

1. Clone this repo into your Claude Code plugins directory:

```bash
cd ~/.claude/plugins
git clone https://github.com/lploc94/codex-review.git
```

2. Or clone anywhere and add the plugin manually:

```bash
git clone https://github.com/lploc94/codex-review.git ~/projects/codex-review
```

Then add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "plugins": [
    {
      "name": "codex-review",
      "source": "/absolute/path/to/codex-review/plugins/codex-review"
    }
  ]
}
```

### Verify installation

Start Claude Code and type `/codex-plan-review` or `/codex-impl-review`. If the skills load, you're set.

## Usage

### `/codex-plan-review` — Review a plan

1. Create your implementation plan first (e.g., via Claude Code plan mode).
2. Run `/codex-plan-review`.
3. Choose reasoning effort (low / medium / high / xhigh).
4. Codex reads the plan file, reviews it, and reports issues.
5. Claude Code rebuts or accepts each point, updates the plan.
6. Debate continues until consensus (default max: 3 rounds, auto-extends if needed).
7. You approve the final plan and proceed to implementation.

### `/codex-impl-review` — Review code changes

1. Make your code changes (don't commit yet).
2. Run `/codex-impl-review`.
3. Choose reasoning effort (low / medium / high / xhigh).
4. Codex reads the diff (and plan file if available), reviews it, and reports issues.
5. Claude Code fixes valid issues and pushes back on invalid ones.
6. Debate continues until consensus.
7. You accept and commit, or request more rounds.

## How it works

```
┌─────────────┐     prompt (paths + context only)     ┌─────────────┐
│             │ ──────────────────────────────────────► │             │
│ Claude Code │                                        │  Codex CLI  │
│  (Claude)   │ ◄────────────────────────────────────── │  (GPT)      │
│             │     structured review (ISSUE-{N})      │             │
└─────────────┘                                        └─────────────┘
       │                                                      ▲
       │  fixes code / updates plan                           │
       │  rebuts invalid points                               │
       └──────────────────────────────────────────────────────┘
                        repeat until consensus
```

Key design decisions:
- **Codex reads files directly** — the prompt only contains file paths, user context, and session info. No bloated prompts with pasted diffs or plan content.
- **Structured output** — Codex must respond in `ISSUE-{N}` format with category, severity, description, reasoning, and suggested fix.
- **Default model** — always uses Codex's configured default model. No model selection prompt.
- **Automatic debate loop** — after each fix, Claude Code automatically sends updated code/plan back to Codex for re-review. The loop runs until Codex returns APPROVE. No manual intervention needed between rounds. Stalemate detection stops infinite loops.
- **Background + progress polling** — Codex runs in background with `--json` output. Claude Code polls the JSONL stream every ~60 seconds and reports progress to the user (what Codex is thinking, which commands it's running). No hardcoded timeouts.

## Project structure

```
.
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── codex-review/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── hooks/
│       │   └── hooks.json
│       └── skills/
│           ├── codex-plan-review/
│           │   └── SKILL.md
│           └── codex-impl-review/
│               └── SKILL.md
└── README.md
```

## License

MIT
