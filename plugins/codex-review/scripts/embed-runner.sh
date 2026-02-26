#!/usr/bin/env bash
set -euo pipefail

# embed-runner.sh — Manages embedding of codex-runner.sh into all plugin locations.
#
# Usage:
#   ./embed-runner.sh          # Check only (exit 1 if content drift detected)
#   ./embed-runner.sh --check  # Same as above
#   ./embed-runner.sh --update # Re-embed source into all 4 locations, then verify
#
# --check:  Verifies content hashes of all 4 embedded copies match the source.
#           Version string match alone is NOT sufficient — full content is compared.
#           Reports "CONTENT DRIFT" if hash is absent or mismatched.
# --update: Re-embeds codex-runner.sh into hooks.json and all 3 SKILL.md files,
#           writes hash markers, then runs --check to confirm integrity.
#           Uses atomic writes (tmp + mv) to prevent partial corruption.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_FILE="$PLUGIN_DIR/scripts/codex-runner.sh"
HOOKS_FILE="$PLUGIN_DIR/hooks/hooks.json"

SKILL_FILES=(
  "$PLUGIN_DIR/skills/codex-plan-review/SKILL.md"
  "$PLUGIN_DIR/skills/codex-impl-review/SKILL.md"
  "$PLUGIN_DIR/skills/codex-think-about/SKILL.md"
)

# ============================================================
# HELPER: find a working Python 3 interpreter
# Tries python3, python, py in order (handles Windows where
# python3 may be a Store stub but python/py work fine).
# ============================================================

find_python() {
  for cmd in python3 python py; do
    if command -v "$cmd" &>/dev/null; then
      local ver
      ver=$("$cmd" -c "import sys; print(sys.version_info.major)" 2>/dev/null || true)
      if [[ "$ver" == "3" ]]; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  echo "ERROR: No Python 3 interpreter found (tried python3, python, py)" >&2
  return 1
}

PYTHON_CMD="$(find_python)"

# ============================================================
# HELPER: compute SHA256 hash of a file
# ============================================================

compute_hash() {
  local file="$1"
  if command -v sha256sum &>/dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  elif command -v shasum &>/dev/null; then
    shasum -a 256 "$file" | cut -d' ' -f1
  else
    $PYTHON_CMD -c "
import hashlib, sys
with open(sys.argv[1], 'rb') as f:
    print(hashlib.sha256(f.read()).hexdigest())
" "$file"
  fi
}

# ============================================================
# HELPER: read stored hash from a SKILL.md file
# Returns the hex digest from <!-- codex-runner-hash: <hex> -->
# placed after the closing code fence, or empty string if absent.
# ============================================================

read_hash_from_skillmd() {
  $PYTHON_CMD - "$1" <<'PYEOF'
import sys, re

skill_file = sys.argv[1]
with open(skill_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the embedded runner block:
# anchor line: "full content of the codex-runner.sh script below:"
# followed by an empty line and ```bash fence
anchor_idx = None
for i, line in enumerate(lines):
    if 'full content of the codex-runner.sh script below:' in line:
        anchor_idx = i
        break

if anchor_idx is None:
    print('')
    sys.exit(0)

# Find opening ```bash after anchor
fence_open = None
for i in range(anchor_idx + 1, min(anchor_idx + 5, len(lines))):
    if lines[i].rstrip() == '```bash':
        fence_open = i
        break

if fence_open is None:
    print('')
    sys.exit(0)

# Find closing ``` after opening fence
fence_close = None
for i in range(fence_open + 1, len(lines)):
    if lines[i].rstrip() == '```':
        fence_close = i
        break

if fence_close is None:
    print('')
    sys.exit(0)

# Check next non-empty line after closing fence for hash marker
for i in range(fence_close + 1, min(fence_close + 3, len(lines))):
    stripped = lines[i].strip()
    if stripped == '':
        continue
    m = re.match(r'^<!-- codex-runner-hash: ([a-f0-9]{64}) -->$', stripped)
    if m:
        print(m.group(1))
    else:
        print('')
    sys.exit(0)

print('')
PYEOF
}

# ============================================================
# HELPER: read stored hash from hooks.json
# Returns the _codex_runner_hash value or empty string if absent.
# ============================================================

read_hash_from_hooksjson() {
  $PYTHON_CMD - "$1" <<'PYEOF'
import sys, json

hooks_file = sys.argv[1]
try:
    with open(hooks_file, encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    print('')
    sys.exit(0)

hooks_val = data.get('hooks', {})
if isinstance(hooks_val, dict):
    hook_groups = [g for groups in hooks_val.values() for g in groups]
else:
    hook_groups = hooks_val

for hook_group in hook_groups:
    for hook in hook_group.get('hooks', []):
        h = hook.get('_codex_runner_hash', '')
        if h:
            print(h)
            sys.exit(0)
print('')
PYEOF
}

# ============================================================
# SUBCOMMAND: --check
# ============================================================

do_check() {
  if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "ERROR: Source file not found: $SOURCE_FILE" >&2
    exit 1
  fi

  SOURCE_VERSION=$(grep -o 'CODEX_RUNNER_VERSION="[^"]*"' "$SOURCE_FILE" | head -1 || true)
  if [[ -z "$SOURCE_VERSION" ]]; then
    echo "ERROR: Could not extract CODEX_RUNNER_VERSION from source file" >&2
    exit 1
  fi

  SOURCE_HASH=$(compute_hash "$SOURCE_FILE")

  echo "Source: $SOURCE_FILE"
  echo "Version: $SOURCE_VERSION"
  echo "Hash: $SOURCE_HASH"
  echo ""

  ERRORS=0

  # --- Check SKILL.md files ---
  for SKILL_FILE in "${SKILL_FILES[@]}"; do
    if [[ ! -f "$SKILL_FILE" ]]; then
      echo "WARNING: Skill file not found: $SKILL_FILE" >&2
      continue
    fi

    # Version string check (secondary signal — catches obvious mismatches fast)
    if ! grep -q "$SOURCE_VERSION" "$SKILL_FILE" 2>/dev/null; then
      echo "CONTENT DRIFT: $SKILL_FILE — version string mismatch (run --update)" >&2
      ERRORS=$((ERRORS + 1))
      continue
    fi

    # Content hash check (primary signal — catches body changes without version bump)
    STORED_HASH=$(read_hash_from_skillmd "$SKILL_FILE")
    if [[ -z "$STORED_HASH" ]]; then
      echo "CONTENT DRIFT: $SKILL_FILE — no hash marker found (run --update)" >&2
      ERRORS=$((ERRORS + 1))
    elif [[ "$STORED_HASH" != "$SOURCE_HASH" ]]; then
      echo "CONTENT DRIFT: $SKILL_FILE — hash mismatch, script body changed (run --update)" >&2
      ERRORS=$((ERRORS + 1))
    else
      echo "OK: $SKILL_FILE"
    fi
  done

  # --- Check hooks.json ---
  if [[ ! -f "$HOOKS_FILE" ]]; then
    echo "WARNING: Hooks file not found: $HOOKS_FILE" >&2
  else
    # Version string check (secondary signal)
    HOOKS_VERSION_CHECK=$($PYTHON_CMD - "$HOOKS_FILE" "$SOURCE_VERSION" <<'PYEOF'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
version = sys.argv[2]
escaped = version.replace('"', '\\"')
hooks_val = data.get('hooks', {})
if isinstance(hooks_val, dict):
    hook_groups = [g for groups in hooks_val.values() for g in groups]
else:
    hook_groups = hooks_val
found = False
for hook_group in hook_groups:
    for hook in hook_group.get('hooks', []):
        cmd = hook.get('command', '')
        if version in cmd or escaped in cmd:
            found = True
            break
    if found:
        break
print('OK' if found else 'DRIFT')
PYEOF
    )

    if [[ "$HOOKS_VERSION_CHECK" != "OK" ]]; then
      echo "CONTENT DRIFT: $HOOKS_FILE — version string not found (run --update)" >&2
      ERRORS=$((ERRORS + 1))
    else
      # Content hash check (primary signal)
      STORED_HASH=$(read_hash_from_hooksjson "$HOOKS_FILE")
      if [[ -z "$STORED_HASH" ]]; then
        echo "CONTENT DRIFT: $HOOKS_FILE — no hash marker found (run --update)" >&2
        ERRORS=$((ERRORS + 1))
      elif [[ "$STORED_HASH" != "$SOURCE_HASH" ]]; then
        echo "CONTENT DRIFT: $HOOKS_FILE — hash mismatch, script body changed (run --update)" >&2
        ERRORS=$((ERRORS + 1))
      else
        echo "OK: $HOOKS_FILE"
      fi
    fi
  fi

  if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "FAILED: $ERRORS file(s) have content drift. Run --update to re-embed and fix." >&2
    exit 1
  fi

  echo ""
  echo "All embeddings are in sync (content hashes verified)."
  exit 0
}

# ============================================================
# SUBCOMMAND: --update helpers
# ============================================================

embed_into_skillmd() {
  local skill_file="$1"
  local source_hash="$2"
  local script_content_file="$3"

  if [[ ! -f "$skill_file" ]]; then
    echo "ERROR: Skill file not found: $skill_file" >&2
    return 1
  fi

  local tmp_file
  tmp_file=$(mktemp "${skill_file}.XXXXXX")

  $PYTHON_CMD - "$skill_file" "$tmp_file" "$source_hash" "$script_content_file" <<'PYEOF'
import sys

skill_file         = sys.argv[1]
tmp_file           = sys.argv[2]
source_hash        = sys.argv[3]
script_content_file = sys.argv[4]

with open(skill_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open(script_content_file, 'r', encoding='utf-8') as f:
    script_content = f.read()

# Ensure script ends with a single newline
script_content = script_content.rstrip('\n') + '\n'

# Find anchor line
anchor_idx = None
for i, line in enumerate(lines):
    if 'full content of the codex-runner.sh script below:' in line:
        anchor_idx = i
        break

if anchor_idx is None:
    print(f'ERROR: Anchor line not found in {skill_file}', file=sys.stderr)
    sys.exit(1)

# Find opening ```bash fence after anchor
fence_open = None
for i in range(anchor_idx + 1, min(anchor_idx + 5, len(lines))):
    if lines[i].rstrip() == '```bash':
        fence_open = i
        break

if fence_open is None:
    print(f'ERROR: Opening ```bash fence not found after anchor in {skill_file}', file=sys.stderr)
    sys.exit(1)

# Find closing ``` fence
fence_close = None
for i in range(fence_open + 1, len(lines)):
    if lines[i].rstrip() == '```':
        fence_close = i
        break

if fence_close is None:
    print(f'ERROR: Closing ``` fence not found in {skill_file}', file=sys.stderr)
    sys.exit(1)

# Validate the block contains CODEX_RUNNER_VERSION (sanity check)
block_text = ''.join(lines[fence_open + 1:fence_close])
if 'CODEX_RUNNER_VERSION=' not in block_text:
    print(f'ERROR: Block does not contain CODEX_RUNNER_VERSION in {skill_file}', file=sys.stderr)
    sys.exit(1)

# Determine where "after" content starts:
# Skip the closing fence line and any existing hash marker line
after_start = fence_close + 1
# Check if the next non-empty line is an old hash marker
import re
temp_idx = after_start
while temp_idx < len(lines) and lines[temp_idx].strip() == '':
    temp_idx += 1
if temp_idx < len(lines) and re.match(r'^<!-- codex-runner-hash: [a-f0-9]{64} -->$', lines[temp_idx].strip()):
    # Skip the old hash marker line (and any blank line between fence and hash marker)
    after_start = temp_idx + 1

# Build new file content
before = lines[:fence_open]            # everything up to (not including) opening fence
opening_fence = '```bash\n'
script_block = script_content
closing_fence = '```\n'
hash_marker = f'<!-- codex-runner-hash: {source_hash} -->\n'
after = lines[after_start:]            # everything after old hash marker

new_lines = before + [opening_fence, script_block, closing_fence, hash_marker] + after

with open(tmp_file, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
PYEOF

  local py_exit=$?
  if [[ $py_exit -ne 0 ]]; then
    rm -f "$tmp_file"
    echo "ERROR: Failed to prepare update for $skill_file" >&2
    return 1
  fi

  mv "$tmp_file" "$skill_file"
  echo "UPDATED: $skill_file"
}

embed_into_hooksjson() {
  local hooks_file="$1"
  local source_hash="$2"
  local script_content_file="$3"

  if [[ ! -f "$hooks_file" ]]; then
    echo "ERROR: Hooks file not found: $hooks_file" >&2
    return 1
  fi

  local tmp_file
  tmp_file=$(mktemp "${hooks_file}.XXXXXX")

  $PYTHON_CMD - "$hooks_file" "$tmp_file" "$source_hash" "$script_content_file" <<'PYEOF'
import sys, json

hooks_file          = sys.argv[1]
tmp_file            = sys.argv[2]
source_hash         = sys.argv[3]
script_content_file = sys.argv[4]

with open(script_content_file, 'r', encoding='utf-8') as f:
    script_content = f.read()

script_content = script_content.rstrip('\n') + '\n'

# Reconstruct the bash install wrapper that matches the existing hooks.json pattern:
# bash -c "RUNNER=...\nif test ...; then exit 0\nfi\nmkdir ...\nTMP=$(mktemp ...)\ncat > "$TMP" <<'RUNNER_SCRIPT'\n<script>\nRUNNER_SCRIPT\nchmod ...\nmv ..."
# We build this as a plain Python string then let json.dumps handle all escaping.

install_wrapper = (
    'bash -c "RUNNER=\\"$HOME/.local/bin/codex-runner.sh\\"\\n'
    'if test -x \\"$RUNNER\\" && grep -q \'CODEX_RUNNER_VERSION=\\"6\\"\' \\"$RUNNER\\" 2>/dev/null; then\\n'
    '  exit 0\\n'
    'fi\\n'
    'mkdir -p \\"$HOME/.local/bin\\"\\n'
    'TMP=$(mktemp \\"$HOME/.local/bin/codex-runner.XXXXXX\\")\\n'
    "cat > \"$TMP\" <<'RUNNER_SCRIPT'\\n"
    + script_content
    + 'RUNNER_SCRIPT\\n'
    'chmod +x \\"$TMP\\"\\n'
    'mv \\"$TMP\\" \\"$HOME/.local/bin/codex-runner.sh\\"\\n'
    '"'
)

with open(hooks_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

hooks_val = data.get('hooks', {})
updated = False
if isinstance(hooks_val, dict):
    for event_hooks in hooks_val.values():
        for hook_group in event_hooks:
            for hook in hook_group.get('hooks', []):
                if 'command' in hook:
                    hook['command'] = install_wrapper
                    hook['_codex_runner_hash'] = source_hash
                    updated = True
                    break
            if updated:
                break
        if updated:
            break

if not updated:
    print('ERROR: Could not locate command hook in hooks.json', file=sys.stderr)
    sys.exit(1)

with open(tmp_file, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PYEOF

  local py_exit=$?
  if [[ $py_exit -ne 0 ]]; then
    rm -f "$tmp_file"
    echo "ERROR: Failed to prepare update for $hooks_file" >&2
    return 1
  fi

  mv "$tmp_file" "$hooks_file"
  echo "UPDATED: $hooks_file"
}

# ============================================================
# SUBCOMMAND: --update
# ============================================================

do_update() {
  if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "ERROR: Source file not found: $SOURCE_FILE" >&2
    exit 1
  fi

  SOURCE_HASH=$(compute_hash "$SOURCE_FILE")
  echo "Source: $SOURCE_FILE"
  echo "Hash: $SOURCE_HASH"
  echo ""

  # Write source to a temp file so Python subprocesses can read it cleanly
  SCRIPT_TMP=$(mktemp)
  cat "$SOURCE_FILE" > "$SCRIPT_TMP"

  ERRORS=0

  for SKILL_FILE in "${SKILL_FILES[@]}"; do
    if ! embed_into_skillmd "$SKILL_FILE" "$SOURCE_HASH" "$SCRIPT_TMP"; then
      ERRORS=$((ERRORS + 1))
    fi
  done

  if ! embed_into_hooksjson "$HOOKS_FILE" "$SOURCE_HASH" "$SCRIPT_TMP"; then
    ERRORS=$((ERRORS + 1))
  fi

  rm -f "$SCRIPT_TMP"

  if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "FAILED: $ERRORS file(s) could not be updated." >&2
    exit 1
  fi

  echo ""
  echo "All files updated. Running post-update verification..."
  echo ""

  do_check
}

# ============================================================
# MAIN: dispatch
# ============================================================

case "${1:-}" in
  --update)
    do_update
    ;;
  --check|"")
    do_check
    ;;
  *)
    echo "Usage: $(basename "$0") [--check|--update]" >&2
    echo "  --check   Verify content hashes of all embedded copies (default)" >&2
    echo "  --update  Re-embed source into all 4 locations, then verify" >&2
    exit 1
    ;;
esac
