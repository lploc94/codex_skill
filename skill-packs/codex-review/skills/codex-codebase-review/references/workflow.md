# Codebase Review Workflow

## 1) Collect Inputs

### Effort Level
Ask user: `low` | `medium` | `high` (default) | `xhigh`.

### Parallel Factor
Ask user: `1` (default, sequential) | `2` | `3`.
Sequential provides best context propagation. Parallel trades depth for speed.

### Focus Areas (optional)
User may specify: `security`, `performance`, `architecture`, `correctness`, `maintainability`.
Default: all categories.

### Scope
Full codebase only. For diff-based review → redirect to `/codex-impl-review`.

## 2) Discovery

### 2a) Detect Project Type

Check marker files in project root:

| Marker | Type | Source Roots |
|--------|------|-------------|
| `package.json` + `tsconfig.json` | TypeScript/Node | `src/`, `lib/`, `app/` |
| `package.json` (no tsconfig) | JavaScript/Node | `src/`, `lib/`, `app/` |
| `pyproject.toml` / `setup.py` | Python | `src/{pkg}/`, dirs with `__init__.py` |
| `go.mod` | Go | dirs containing `.go` files |
| `Cargo.toml` | Rust | `src/`, `crates/` |
| `pom.xml` / `build.gradle` | Java | `src/main/java/` |
| `*.csproj` | C# | `src/` |
| (none matched) | Generic | top-level dirs fallback |

### 2b) List Source Files

List all source files, excluding:
- `node_modules`, `.git`, `dist`, `build`, `vendor`, `__pycache__`, `target`, `.next`, `.nuxt`, `coverage`
- Binary files, images, fonts, lock files

```bash
find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" \
  -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cs" \
  -o -name "*.rb" -o -name "*.php" -o -name "*.vue" -o -name "*.svelte" \) \
  | grep -v node_modules | grep -v .git | grep -v dist | grep -v build \
  | grep -v vendor | grep -v __pycache__ | grep -v target \
  | grep -v .next | grep -v .nuxt | grep -v coverage
```

Or use project-specific patterns from config files.

### 2c) Identify Module Boundaries

Group files by top-level directory under source root. Stop at depth 2.

Example for TypeScript project with `src/`:
```
src/
├── auth/          → module "auth"
├── api/           → module "api"
├── models/        → module "models"
├── utils/         → module "utils"
├── config/        → module "config"
└── index.ts       → module "root"
```

### 2d) Count Lines Per Module

```bash
wc -l <files_in_module> | tail -1
```

### 2e) Present Module Table

Display for user confirmation (effort >= medium):

```
## Discovered Modules
| # | Module | Files | Lines | Est. Chunks |
|---|--------|-------|-------|-------------|
| 1 | config | 3 | 150 | (merge) |
| 2 | models | 8 | 620 | 1 |
| 3 | auth | 12 | 1800 | 1 |
| 4 | api | 15 | 2400 | 2 |
| 5 | utils | 6 | 450 | (merge) |
| 6 | tests | 10 | 1200 | 1 |
| **Total** | | **54** | **6620** | **5-6** |
```

For `low` effort: skip confirmation, auto-proceed.

## 3) Chunking

### Target Size
500-2000 lines per chunk.

### Rules
- Module < 300 lines → merge with related module (config+types, utils+helpers).
- Module > 2500 lines → split by sub-directory.
- Ordering: config/types first → core/utils → features → tests last.

### Merge Strategy
1. Sort modules by line count ascending.
2. Small modules (< 300 lines) attempt to merge with thematically related neighbor.
3. Merged chunks must stay under 2000 lines.
4. Standalone files in root → merge into nearest thematic chunk.

### Split Strategy
For modules > 2500 lines:
1. Group by immediate sub-directory.
2. If a sub-directory is still > 2500 lines, split alphabetically into ~1500-line groups.
3. Suffix chunk names: `api-routes`, `api-middleware`, `api-controllers`.

### Present Chunk Plan

Display for user confirmation (effort >= medium):

```
## Chunk Plan
| # | Chunk Name | Modules/Files | Lines | Order |
|---|-----------|---------------|-------|-------|
| 1 | config-types | config/, types/ | 380 | 1st |
| 2 | models | models/ | 620 | 2nd |
| 3 | utils | utils/, helpers/ | 450 | 3rd |
| 4 | auth | auth/ | 1800 | 4th |
| 5 | api-routes | api/routes/ | 1200 | 5th |
| 6 | api-controllers | api/controllers/ | 1200 | 6th |
| 7 | tests | tests/ | 1200 | 7th |
```

For `low` effort: skip confirmation, auto-proceed.

## 4) Review Loop

### Sequential Mode (parallel_factor=1)

For each chunk in order:

#### 4a) Build Prompt
Use `references/prompts.md` → Chunk Review Prompt template.
Include:
- Module name + file list (paths only — Codex reads files).
- Project type + focus areas.
- Context summary from prior chunks (high/critical findings only, ~2000 token cap).

#### 4b) Start Codex
```bash
STATE_OUTPUT=$(printf '%s' "$CHUNK_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

Track STATE_DIR in a list for cleanup.

#### 4c) Poll
```bash
POLL_OUTPUT=$(node "$RUNNER" poll "$STATE_DIR")
```

Adaptive intervals:
- Poll 1: wait 60s
- Poll 2: wait 60s
- Poll 3: wait 30s
- Poll 4+: wait 15s

Parse poll output for user reporting:
- `Codex thinking: "topic"` → Report: "Codex analyzing: {topic}"
- `Codex running: ...cat src/foo.ts...` → Report: "Codex reading `src/foo.ts`"

**Report template:** "Chunk {N}/{TOTAL} [{name}] — Codex [{elapsed}s]: {activity}"

Continue while `POLL:running`. Stop on `completed|failed|timeout|stalled`.

#### 4d) Parse Results
Parse `ISSUE-{N}` blocks from review output. See `references/output-format.md`.

#### 4e) Context Propagation
After each chunk completes, extract high/critical findings into context summary:
```
- [{chunk_name}] {title}: {summary} ({severity}) in {file}
```
Cap at ~2000 tokens. Newest findings replace oldest if over cap.

#### 4f) Report Progress
```
Chunk {N}/{TOTAL} [{name}]: {issue_count} issues ({C}C/{H}H/{M}M/{L}L)
```

#### 4g) Cleanup Chunk
```bash
node "$RUNNER" stop "$STATE_DIR"
```

### Parallel Mode (parallel_factor=2-3)

#### Batch Formation
Group chunks into batches of `parallel_factor` size.
Example with 7 chunks, factor 2: [1,2], [3,4], [5,6], [7].

#### Per Batch
1. Start ALL chunks in batch simultaneously (multiple `node "$RUNNER" start` calls).
2. Poll round-robin across all active STATE_DIRs.
3. Context propagation occurs BETWEEN batches only (not within a batch).
4. After all chunks in batch complete → extract context → proceed to next batch.

#### Polling Round-Robin
```
while any_chunk_running:
  for each active STATE_DIR:
    poll once
    if completed/failed → mark done, parse results
  sleep interval (same adaptive schedule)
```

## 5) Cross-cutting Analysis (Claude-only)

After ALL chunks reviewed, Claude synthesizes findings.

### Categories by Effort Level

| Category | low | medium | high | xhigh |
|----------|-----|--------|------|-------|
| Pattern inconsistencies across modules | Yes | Yes | Yes | Yes |
| DRY violations across modules | Yes | Yes | Yes | Yes |
| API contract violations between modules | No | Yes | Yes | Yes |
| Integration concerns (circular deps, error propagation, races) | No | No | Yes | Yes |
| Architecture assessment (coupling, cohesion, missing abstractions) | No | No | Yes | Yes |

### Process
1. Collect ALL ISSUE-{N} findings from ALL chunks.
2. Group by file, by category, by severity.
3. Look for patterns that span multiple modules.
4. Generate CROSS-{N} findings (see `references/output-format.md`).

### Examples of Cross-cutting Findings
- Same validation logic duplicated in `auth/` and `api/middleware/`.
- `models/user.ts` exports interface but `api/routes/user.ts` redefines it inline.
- Error handling: `auth/` throws custom errors, `api/` uses generic Error — inconsistent.
- Circular import: `utils/` imports from `models/`, `models/` imports from `utils/`.

## 6) Validation (Optional)

Only run when effort >= `high`.

### 6a) Build Validation Prompt
Use `references/prompts.md` → Validation Prompt template.
Include CROSS-{N} findings for Codex to verify.

### 6b) Start + Poll
Standard start-poll-stop cycle. Same as chunk review.

```bash
STATE_OUTPUT=$(printf '%s' "$VALIDATION_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT")
STATE_DIR=${STATE_OUTPUT#CODEX_STARTED:}
```

Track STATE_DIR for cleanup.

### 6c) Parse Responses
Codex returns `RESPONSE-{N}` blocks:
- `Action: accept` → keep CROSS-{N} finding as-is.
- `Action: reject` → remove or downgrade.
- `Action: revise` → update finding with Codex's revision.

### 6d) Rounds
- effort `high`: 1 validation round max.
- effort `xhigh`: up to 2 validation rounds.

## 7) Final Report

```markdown
## Codebase Review Report

### Overview
| Metric | Value |
|--------|-------|
| Project type | {type} |
| Total files | {N} |
| Total lines | {L} |
| Chunks reviewed | {C}/{TOTAL} |
| Total issues | {I} |
| Cross-cutting findings | {X} |

### Per-Module Findings
#### [{chunk_name}] ({files} files, {lines} lines)
{ISSUE-{N} blocks, grouped by severity}

### Cross-cutting Findings
{CROSS-{N} blocks, grouped by category}

### Architecture Assessment (effort >= high)
{coupling analysis, cohesion, missing abstractions}

### Action Items
| Priority | Item | Module(s) | Severity |
|----------|------|-----------|----------|
| P0 | {critical items} | {modules} | critical |
| P1 | {high items} | {modules} | high |
| P2 | {medium items} | {modules} | medium |

### Statistics
| Chunk | Files | Lines | Issues | C | H | M | L | Time |
|-------|-------|-------|--------|---|---|---|---|------|
{per-chunk stats}
| **Total** | **{N}** | **{L}** | **{I}** | {C} | {H} | {M} | {L} | {T} |
```

## 8) Cleanup

```bash
for STATE_DIR in "${ALL_STATE_DIRS[@]}"; do
  node "$RUNNER" stop "$STATE_DIR"
done
```

Stop ALL tracked STATE_DIRs. Always run regardless of outcome (success, failure, timeout, partial).

## 9) Error Handling

### Chunk Failure
- Runner returns `POLL:failed` → retry chunk 1 time.
- Still fails → skip chunk, note in report as "SKIPPED: {reason}".
- If partial `review.md` exists → use partial results.

### Threshold: >50% Chunks Failed
- Warn user: "More than half of chunks failed. Results may be incomplete."
- Ask user: continue with partial results or abort.

### All Chunks Failed
- Claude performs inline review of top 5 priority chunks (by module importance).
- Report as "Fallback: Claude-only review (Codex unavailable)".

### Validation Failure
- Skip validation, report cross-cutting findings as-is.
- Note: "Validation skipped due to Codex error".

### Runner Exit Codes
| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Continue |
| 2 | Timeout | Use partial results |
| 3 | Turn failed | Retry once |
| 4 | Stalled | Use partial results |
| 5 | Codex not found | Fail immediately, tell user to install |

### Poll Status Handling
Parse `POLL:<status>:<elapsed>[:exit_code:details]`:
- `POLL:completed:...` → success, read `review.md`.
- `POLL:failed:...:3:...` → turn failed. Retry once.
- `POLL:timeout:...:2:...` → timeout. Use partial results if available.
- `POLL:stalled:...:4:...` → stalled. Use partial results.

Fallback when poll exits non-zero or output is unparseable:
- Log error, report to user, suggest retry.

Always run cleanup (step 8) regardless of error.
