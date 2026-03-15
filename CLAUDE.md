# CLAUDE.md

This repository provides a single-command installer (`npx github:lploc94/codex_skill`) that installs the `codex-review` skill pack into `~/.claude/skills/codex-review/`.

## Project Overview

`codex-review` provides eight skills powered by OpenAI Codex CLI:
- `/codex-plan-review` — debate plans before implementation
- `/codex-impl-review` — review uncommitted or branch changes before commit/merge
- `/codex-think-about` — peer reasoning/debate on technical topics
- `/codex-commit-review` — review commit messages for clarity and conventions
- `/codex-pr-review` — review PRs (branch diff, commit hygiene, description)
- `/codex-parallel-review` — parallel independent review by both Claude and Codex, then debate
- `/codex-codebase-review` — chunked full-codebase review for large projects (50-500+ files)
- `/codex-security-review` — security-focused review using OWASP Top 10 and CWE patterns

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
node ./bin/codex-skill.js --auto                                   # install + inject guidance into ~/.claude/CLAUDE.md
node skill-packs/codex-review/scripts/codex-runner.js version      # runner version
```

There is no build system, test suite, or linter. The project is JavaScript + Markdown + JSON.

## Architecture

### Installer

`bin/codex-skill.js` — single file, Node.js stdlib only, no dependencies:
1. Parse CLI arguments (`-full`, `--auto`)
2. Runtime guard: Node.js >= 22
3. Build staging directory alongside install target
4. Copy `codex-runner.js` from `skill-packs/`
5. Read SKILL.md templates (contain `{{RUNNER_PATH}}`), inject absolute path, write to staging
6. Copy `references/` directories as-is
7. Verify runner by spawning `node codex-runner.js version`
8. Atomic swap: backup old install → rename staging → cleanup
9. If `--auto`: inject review guidance into `~/.claude/CLAUDE.md` (idempotent, append-only)

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
    ├── codex-codebase-review/
    │   ├── SKILL.md
    │   └── references/
    └── codex-security-review/
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

1. **Skill invocation** (`/codex-plan-review`, `/codex-impl-review`, `/codex-think-about`, `/codex-commit-review`, `/codex-pr-review`, `/codex-parallel-review`, `/codex-codebase-review`, or `/codex-security-review`) follows SKILL.md step-by-step
2. **Runner path**: SKILL.md contains hardcoded absolute path to `codex-runner.js`
3. **codex-runner.js** spawns `codex exec --json --sandbox read-only` as a detached process, polls JSONL output
4. **Review debate loop** (plan-review, impl-review, commit-review, pr-review): Claude Code parses Codex's `ISSUE-{N}` review → fixes/rebuts → resumes via `--thread-id` → repeats until `APPROVE` verdict or stalemate
5. **Peer debate loop** (think-about): Claude Code and Codex think independently → discuss → exchange perspectives → repeat until consensus or stalemate → present to user
6. **Parallel review loop** (parallel-review): Claude and Codex review independently in parallel → merge findings → debate disagreements → produce consensus report
7. **Chunked codebase review** (codebase-review): split codebase into module chunks → review each chunk in independent Codex session → Claude synthesizes cross-cutting findings
8. **Security review** (security-review): OWASP Top 10 + CWE pattern detection → Codex analyzes security-sensitive code → Claude validates findings and produces security report

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

## Breaking Changes

### v10: review.txt → review.md
- **Output file renamed**: `review.txt` is no longer created. All markdown review output is now written to `review.md`.
- **format="both" simplified**: Previously wrote `review.txt` + `review.json` + `review.sarif.json` + `review.md` (re-rendered from JSON). Now writes `review.md` (original markdown) + `review.json` + `review.sarif.json`. The re-rendered markdown is removed since `review.md` is the primary output.
- **CI/CD impact**: Any scripts referencing `review.txt` must be updated to use `review.md`.
- **Existing state directories**: Old runs in `.codex-review/runs/*/` may still contain `review.txt` from v9. These are not retroactively renamed.
- **Historical docs**: SESSION_SUMMARY.md, PROGRESS_REPORT.md, FINAL_REPORT.md reference v9 behavior and are not updated.
- See v11 — format options fully removed.

### v11: Remove JSON/SARIF output formats
- **`--format` flag removed**: Runner only produces markdown. `review.md` is the sole output.
- **Files no longer generated**: `review.json`, `review.sarif.json`
- **Test files deleted**: `test-converters.js`, `test-converters-comprehensive.js`, `test-integration.js`
- **Schema doc deleted**: `docs/CANONICAL_JSON_SCHEMA.md`

## Verification

1. `node bin/codex-skill.js` — installer chạy thành công
2. `node skill-packs/codex-review/scripts/codex-runner.js version` — in version `11`
3. `ls ~/.claude/skills/codex-review/` — chứa `scripts/`
4. SKILL.md chứa absolute path, không search loop
5. Invoke `/codex-plan-review`, `/codex-impl-review`, `/codex-think-about`, `/codex-commit-review`, `/codex-pr-review`, `/codex-parallel-review`, `/codex-codebase-review`, `/codex-security-review` trong Claude Code
