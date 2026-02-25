#!/usr/bin/env bash
set -euo pipefail

# embed-runner.sh — Verifies that all SKILL.md files and hooks/hooks.json contain
# the correct CODEX_RUNNER_VERSION string from scripts/codex-runner.sh (version drift check).
#
# Usage:
#   ./embed-runner.sh          # Check only (exit 1 if drift detected)
#   ./embed-runner.sh --check  # Same as above
#
# This script does NOT auto-update embeddings — it only checks for drift.
# Update the embeddings manually in SKILL.md and hooks.json when changing codex-runner.sh.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_FILE="$PLUGIN_DIR/scripts/codex-runner.sh"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "ERROR: Source file not found: $SOURCE_FILE" >&2
  exit 1
fi

# Extract version from source
SOURCE_VERSION=$(grep -o 'CODEX_RUNNER_VERSION="[^"]*"' "$SOURCE_FILE" | head -1 || true)
if [[ -z "$SOURCE_VERSION" ]]; then
  echo "ERROR: Could not extract CODEX_RUNNER_VERSION from source file" >&2
  exit 1
fi

echo "Source: $SOURCE_FILE"
echo "Version: $SOURCE_VERSION"

ERRORS=0

# Check SKILL.md files contain the correct version string
for SKILL_FILE in \
  "$PLUGIN_DIR/skills/codex-plan-review/SKILL.md" \
  "$PLUGIN_DIR/skills/codex-impl-review/SKILL.md" \
  "$PLUGIN_DIR/skills/codex-think-about/SKILL.md"; do

  if [[ ! -f "$SKILL_FILE" ]]; then
    echo "WARNING: Skill file not found: $SKILL_FILE" >&2
    continue
  fi

  if ! grep -q "$SOURCE_VERSION" "$SKILL_FILE" 2>/dev/null; then
    echo "DRIFT: $SKILL_FILE does not contain $SOURCE_VERSION" >&2
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: $SKILL_FILE"
  fi
done

# Check hooks.json contains the correct version string
HOOKS_FILE="$PLUGIN_DIR/hooks/hooks.json"
if [[ -f "$HOOKS_FILE" ]]; then
  # hooks.json stores the script inside a JSON string — grep the raw file for common
  # escape variants, or decode and check the actual command content via python3.
  HOOKS_CHECK=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
version = sys.argv[2]
escaped = version.replace('\"', '\\\\\"')
# Iterate all hooks to find version string in any command
# hooks can be an object keyed by event name (new format) or an array (old format)
found = False
hooks_val = data.get('hooks', {})
if isinstance(hooks_val, dict):
    hook_groups = [g for groups in hooks_val.values() for g in groups]
else:
    hook_groups = hooks_val
for hook_group in hook_groups:
    for hook in hook_group.get('hooks', []):
        cmd = hook.get('command', '')
        if version in cmd or escaped in cmd:
            found = True
            break
    if found:
        break
print('OK' if found else 'DRIFT')
" "$HOOKS_FILE" "$SOURCE_VERSION" 2>/dev/null || echo "ERROR")
  if [[ "$HOOKS_CHECK" == "OK" ]]; then
    echo "OK: $HOOKS_FILE"
  else
    echo "DRIFT: $HOOKS_FILE does not contain $SOURCE_VERSION" >&2
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "WARNING: Hooks file not found: $HOOKS_FILE" >&2
fi

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "FAILED: $ERRORS file(s) have version drift. Update embedded content to match source." >&2
  exit 1
fi

echo ""
echo "All embeddings are in sync."
echo "Reminder: always bump CODEX_RUNNER_VERSION in codex-runner.sh when changing script content."
exit 0
