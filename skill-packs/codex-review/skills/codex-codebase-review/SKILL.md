---
name: codex-codebase-review
description: Review entire codebases (50-500+ files) by chunking into modules, reviewing each in separate Codex sessions, then synthesizing cross-cutting findings.
---

# Codex Codebase Review

## Purpose
Review large codebases exceeding single-session context limits. Chunks by module, reviews independently, synthesizes cross-cutting findings.

## When to Use
Full codebase audit (50-500+ files). For diff review use `/codex-impl-review`.

## Prerequisites
- Source files in working directory.

## Runner
RUNNER="{{RUNNER_PATH}}"
SKILLS_DIR="{{SKILLS_DIR}}"
json_esc() { printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(d)))'; }

## Critical Rules (DO NOT skip)
- Stdin: `printf '%s' "$PROMPT" | node "$RUNNER" ...` -- NEVER `echo`. JSON via heredoc.
- Validate: `init` output must start with `CODEX_SESSION:`. `start`/`resume` must return valid JSON. `CODEX_NOT_FOUND`->tell user install codex.
- `status === "completed"` means **Codex's turn is done** -- NOT that the review is over. Parse results and continue.
- Errors: `failed`->retry once, still fails->skip chunk. >50% failed->warn user. `timeout`->report partial. `stalled`+recoverable->`stop`->recovery `resume`->poll; not recoverable->report partial. Cleanup sequencing: `finalize`+`stop` ONLY after recovery resolves.
- Cleanup: ALWAYS `finalize` + `stop` ALL tracked sessions, even on failure/timeout.
- Runner manages all session state -- NEVER read/write session files manually.
- For detailed error flows -> `Read references/protocol.md`

## Workflow

### 1. Collect Inputs
Effort: <50 files=`medium`, 50-200=`high`, >200=`xhigh`. Ask parallel factor (default 1), focus areas (default all).
Effort levels: low=~10-20min/chunk, medium=~15-30min, high=~20-40min, xhigh=~30-60min.

### 2. Discovery
2a) Detect project type from markers (package.json, go.mod, Cargo.toml, etc.).
2b) List source files (extensions: js, ts, jsx, tsx, py, go, rs, java, cs, rb, php, vue, svelte). Exclude: node_modules, .git, dist, build, vendor, __pycache__, target, .next, .nuxt, coverage.
2c) Identify module boundaries: group by top-level dir under source root (depth 2).
2d) Count lines per module. 2e) Present module table for confirmation (effort >= medium).

### 3. Chunking
Target: 500-2000 lines/chunk. Module <300 lines -> merge with related. Module >2500 -> split by sub-dir.
Order: config/types first -> core/utils -> features -> tests last. Present chunk plan (effort >= medium).

### 4. Review Loop
Track: `ALL_SESSION_DIRS=()`. For each chunk (sequential or parallel batches):
4a) Init: `node "$RUNNER" init --skill-name codex-codebase-review --working-dir "$PWD"`. Track session.
4b) Render: template=`chunk-review`. Placeholders: `PROJECT_TYPE`, `CHUNK_NAME`, `FOCUS_AREAS`, `FILE_LIST`, `CONTEXT_SUMMARY`.
4c) Start + 4d) Poll. Report: "Chunk {N}/{TOTAL} [{name}]".
4e) Parse `review.blocks[]`. 4f) Context propagation: high/critical findings (~2000 tokens cap).
4g) Progress report. 4h) Finalize chunk.
Parallel mode: batch by parallel_factor, start all simultaneously, poll round-robin, propagate context between batches only.

### 5. Cross-cutting Analysis (Claude-only)
Collect all ISSUE-{N} from all chunks -> group by file/category/severity -> find cross-module patterns -> generate CROSS-{N}.
Categories by effort: pattern inconsistencies + DRY (all); API contracts (medium+); integration + architecture (high+).

### 6. Validation (effort >= high)
Init new session, render template=`validation` with `CROSS_FINDINGS`. Start + poll. Parse RESPONSE-{N} (accept/reject/revise).
Rounds: high=1 max, xhigh=up to 2. Finalize validation session.

### 7. Final Report
Project type, Total files/lines, Chunks reviewed, Total issues, Cross-cutting findings.
Per-module findings by severity, CROSS-{N} by category, architecture assessment (high+), action items (P0/P1/P2), per-chunk stats.

### 8. Session Finalization
Create master session, finalize with aggregated stats. Report master session path.

### 9. Cleanup
Stop ALL tracked sessions (chunk + validation + master). Always run.
Chunk failure: retry once, skip on second fail. All failed: Claude fallback review top 5 chunks.

## Flavor Text Triggers
SKILL_START, POLL_WAITING, CODEX_RETURNED, CHUNK_PROGRESS, CHUNK_CROSS, FINAL_SUMMARY

## Rules
- If in plan mode, exit first. No cross-contamination between chunk sessions.
- Context propagation: only high/critical, capped ~2000 tokens. Scope is full codebase only.
