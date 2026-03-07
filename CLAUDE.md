# CLAUDE.md

This repository provides a single-command installer (`npx github:lploc94/codex_skill`) that installs the `codex-review` skill pack into `~/.claude/skills/codex-review/`.

## Project Overview

`codex-review` provides seven skills powered by OpenAI Codex CLI:
- `/codex-plan-review` — debate plans before implementation
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)
- `/codex-parallel-review` — parallel independent review by both Claude and Codex, then debate
- `/codex-codebase-review` — chunked full-codebase review for large projects (50-500+ files)

## Codebase Understanding Guidelines

**CRITICAL FOR OPENCODE/SISYPHUS**: When working on ANY project (including this one), ALWAYS use **Auggie codebase retrieval** (`auggie_codebase-retrieval` tool) as your PRIMARY tool for:
- Understanding codebase structure and architecture
- Finding implementations, classes, functions, or patterns
- Locating relevant files when you don't know exact paths
- Gathering high-level information about features or modules
- Any semantic code search or exploration task

**Auggie FIRST, then other tools:**
- ✅ Use Auggie BEFORE grep, file reads, or bash commands for code understanding
- ✅ Auggie uses advanced semantic search specifically designed for code
- ✅ Auggie maintains real-time index and understands code context
- ❌ DO NOT use bash/grep for semantic code understanding
- ❌ Only use grep/bash for exact string matching of non-code content (error messages, config values, logs)

**When in doubt between Auggie and other search tools → ALWAYS choose Auggie.**

## Distribution Model

- Single command install: `npx github:lploc94/codex_skill`
- Installs to: `~/.claude/skills/codex-review/`
- No global npm install, no CLI left behind, no node_modules on user machine

## Requirements

- Node.js >= 22
- Claude Code CLI
- OpenAI Codex CLI in PATH (`codex`)
- OpenAI API key configured for Codex

## Development Commands

```bash
node ./bin/codex-skill.js                                          # run installer locally
node skill-packs/codex-review/scripts/codex-runner.js version      # runner version
```

There is no build system, test suite, or linter. The project is JavaScript + Markdown + JSON.

## Architecture

### Installer

`bin/codex-skill.js` — single file, Node.js stdlib only, no dependencies:
1. Runtime guard: Node.js >= 22
2. Build staging directory alongside install target
3. Copy `codex-runner.js` from `skill-packs/`
4. Read SKILL.md templates (contain `{{RUNNER_PATH}}`), inject absolute path, write to staging
5. Copy `references/` directories as-is
6. Verify runner by spawning `node codex-runner.js version`
7. Atomic swap: backup old install → rename staging → cleanup

### Skill Pack Layout (templates + runner)

```text
skill-packs/codex-review/
├── manifest.json
├── scripts/
│   └── codex-runner.js          ← single shared Node.js runner
└── skills/
    ├── codex-plan-review/
    │   ├── SKILL.md             ← template with {{RUNNER_PATH}}
    │   └── references/
    ├── codex-impl-review/
    │   ├── SKILL.md
    │   └── references/
    ├── codex-think-about/
    │   ├── SKILL.md
    │   └── references/
    ├── codex-commit-review/
    │   ├── SKILL.md
    │   └── references/
    ├── codex-pr-review/
    │   ├── SKILL.md
    │   └── references/
    ├── codex-parallel-review/
    │   ├── SKILL.md
    │   └── references/
    └── codex-codebase-review/
        ├── SKILL.md
        └── references/
```

### Installed Output (on user machine)

```text
~/.claude/skills/
├── codex-review/
│   └── scripts/
│       └── codex-runner.js              ← shared runner
├── codex-plan-review/
│   ├── SKILL.md                         ← RUNNER="/abs/path/codex-runner.js" hardcoded
│   └── references/
├── codex-impl-review/
│   ├── SKILL.md
│   └── references/
├── codex-think-about/
│   ├── SKILL.md
│   └── references/
├── codex-commit-review/
│   ├── SKILL.md
│   └── references/
├── codex-pr-review/
│   ├── SKILL.md
│   └── references/
├── codex-parallel-review/
│   ├── SKILL.md
│   └── references/
└── codex-codebase-review/
    ├── SKILL.md
    └── references/
```

### Core Execution Flow

1. **Skill invocation** (`/codex-plan-review`, `/codex-impl-review`, `/codex-think-about`, `/codex-commit-review`, `/codex-pr-review`, `/codex-parallel-review`, or `/codex-codebase-review`) follows SKILL.md step-by-step
2. **Runner path**: SKILL.md contains hardcoded absolute path to `codex-runner.js`
3. **codex-runner.js** spawns `codex exec --json --sandbox read-only` as a detached process, polls JSONL output
4. **Review debate loop** (plan-review, impl-review, commit-review, pr-review): Claude Code parses Codex's `ISSUE-{N}` review → fixes/rebuts → resumes via `--thread-id` → repeats until `APPROVE` verdict or stalemate
5. **Peer debate loop** (think-about): Claude Code and Codex think independently → discuss → exchange perspectives → repeat until consensus or stalemate → present to user
6. **Parallel review loop** (parallel-review): Claude and Codex review independently in parallel → merge findings → debate disagreements → produce consensus report
7. **Chunked codebase review** (codebase-review): split codebase into module chunks → review each chunk in independent Codex session → Claude synthesizes cross-cutting findings

### Key Design Decisions

- **Node.js runner**: `codex-runner.js` uses Node.js stdlib only — no Python/bash dependency
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Prompt minimalism**: Prompts contain only file paths and context; Codex reads files/diffs itself
- **Structured output**: Review skills use `ISSUE-{N}` format with `VERDICT` block; think-about uses Key Insights / Considerations / Recommendations
- **Thread persistence**: First call creates a thread; subsequent rounds use `codex exec resume <thread_id>`
- **Stalemate detection**: Stops if same points repeat for 2 consecutive rounds with no progress
- **PID-reuse protection**: `verifyCodex()` and `verifyWatchdog()` check process cmdline before killing — prevents killing wrong process if OS reuses the PID
- **Atomic install**: Uses staging dir + rename for safe install/update with rollback on failure

### codex-runner.js Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Timeout (default 3600s) |
| 3 | Turn failed |
| 4 | Stalled (no output for ~3 minutes) |
| 5 | Codex CLI not found in PATH |

## Design Principles

- Progressive disclosure: keep `SKILL.md` lean (~40–70 lines).
- Move long prompts/protocol details into `references/`.
- Single shared runner at skill-pack level, not duplicated per skill.
- `skill-packs/` is the single source of truth for templates and runner.

## Verification

1. `node bin/codex-skill.js` — installer chạy thành công
2. `node skill-packs/codex-review/scripts/codex-runner.js version` — in version `8`
3. `ls ~/.claude/skills/codex-review/` — chứa `scripts/`
4. SKILL.md chứa absolute path, không search loop
5. Invoke `/codex-plan-review`, `/codex-impl-review`, `/codex-think-about`, `/codex-commit-review`, `/codex-pr-review`, `/codex-parallel-review`, `/codex-codebase-review` trong Claude Code
