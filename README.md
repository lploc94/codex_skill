# codex_skill

Claude Code plugin that uses OpenAI Codex CLI as an adversarial reviewer and peer thinker. Three skills orchestrate multi-round debates between Claude Code and Codex until consensus:

- **Plan review** — reviews your implementation plan before you write code
- **Impl review** — reviews your code changes before you commit
- **Think-about** — peer debate on any question (both AIs think independently, discuss, reach consensus or present disagreements)

## Skills

| Command | What it does |
| --- | --- |
| `/codex-plan-review` | Codex reviews your implementation plan. Claude Code and Codex debate until the plan is solid, then you implement. |
| `/codex-impl-review` | Codex reviews your uncommitted code changes. Claude Code fixes valid issues and pushes back on invalid ones. Repeats until consensus. |
| `/codex-think-about` | Both AIs think independently about a question, then discuss until they reach consensus or present their disagreements to you. |

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI)
- [OpenAI Codex CLI](https://github.com/openai/codex) installed and available in PATH
- An OpenAI API key configured for Codex

## Installation

### From Claude Code CLI

```bash
/plugin marketplace add lploc94/codex_skill
/plugin install codex-review@codex-review
```

### Verify installation

Start Claude Code and type `/codex-plan-review`, `/codex-impl-review`, or `/codex-think-about`. If the skills load, you're set.

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

### `/codex-think-about` — Peer debate on any question

1. Run `/codex-think-about`.
2. Describe the question or topic you want both AIs to think about.
3. Choose reasoning effort (low / medium / high / deep).
4. Both Claude Code and Codex think independently, then exchange perspectives.
5. They discuss until they reach consensus or detect a stalemate.
6. You get a summary of agreed points, disagreements, and key insights.

## How it works

```
┌─────────────┐     prompt (paths + context only)     ┌─────────────┐
│             │ ──────────────────────────────────────► │             │
│ Claude Code │                                        │  Codex CLI  │
│  (Claude)   │ ◄────────────────────────────────────── │  (GPT)      │
│             │     structured review (ISSUE-{N})      │             │
└─────────────┘     or thinking session (think-about)  └─────────────┘
       │                                                      ▲
       │  fixes code / updates plan (review skills)           │
       │  agrees / disagrees / adds perspective (think-about) │
       └──────────────────────────────────────────────────────┘
                        repeat until consensus
```

Key design decisions:
- **Codex reads files directly** — the prompt only contains file paths, user context, and session info. No bloated prompts with pasted diffs or plan content.
- **Structured output** — Review skills use `ISSUE-{N}` format with category, severity, description, reasoning, and suggested fix. Think-about uses a thinking-session format (key insights, considerations, recommendations).
- **Default model** — always uses Codex's configured default model. No model selection prompt.
- **Automatic debate loop** — Review skills: after each fix, Claude Code automatically sends updated code/plan back to Codex for re-review, looping until Codex returns APPROVE. Think-about: both AIs exchange perspectives until consensus or stalemate. No manual intervention needed between rounds.
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
│       ├── scripts/
│       │   ├── codex-runner.sh
│       │   └── embed-runner.sh
│       └── skills/
│           ├── codex-plan-review/
│           │   └── SKILL.md
│           ├── codex-impl-review/
│           │   └── SKILL.md
│           └── codex-think-about/
│               └── SKILL.md
├── CLAUDE.md
└── README.md
```

## License

MIT
