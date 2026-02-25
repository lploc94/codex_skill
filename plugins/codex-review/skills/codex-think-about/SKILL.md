---
name: codex-think-about
description: Peer debate between Claude Code and Codex CLI on any question. Both AIs think independently, then discuss and refine until reaching consensus or presenting their disagreements for the user to resolve.
---

# Codex Think About — Skill Guide

## Overview
This skill orchestrates a **peer debate** between Claude Code and OpenAI Codex CLI on any question or topic. Unlike the review skills where one side reviews and the other implements, here both AIs are **equal thinkers** — each forms independent perspectives, then they discuss, refine, and challenge each other's reasoning until reaching consensus or identifying irreducible disagreements.

**Codex and Claude Code are EQUAL PEERS.** Neither is the reviewer or the implementer. Both contribute ideas, evidence, and counterarguments.

**Flow:** User question → Claude Code gathers factual context → Codex thinks independently → Claude Code responds with own perspective → Codex responds → ... → Consensus or Stalemate → Present to user

## Prerequisites
- The Codex CLI (`codex`) must be installed and available in PATH.

## Codex Runner Script

This skill uses `codex-runner.sh` with `start`/`poll`/`stop` subcommands to run Codex CLI in the background and report progress incrementally.

- **`start`** — launches Codex as a detached background process, returns immediately with a state directory path
- **`poll`** — checks progress, outputs plain text status on stdout and progress events on stderr
- **`stop`** — kills processes and cleans up the state directory

### Bootstrap Logic (inline in every Bash call)

Every Bash call that invokes the runner must include this resolve block at the top:

```bash
RUNNER="${CODEX_RUNNER:-$HOME/.local/bin/codex-runner.sh}"
NEED_INSTALL=0
if [ -n "$CODEX_RUNNER" ] && test -x "$CODEX_RUNNER"; then
  if ! grep -q 'CODEX_RUNNER_VERSION="6"' "$CODEX_RUNNER" 2>/dev/null; then NEED_INSTALL=1; fi
elif ! test -x "$RUNNER"; then NEED_INSTALL=1
elif ! grep -q 'CODEX_RUNNER_VERSION="6"' "$RUNNER" 2>/dev/null; then NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  TMP=$(mktemp "$HOME/.local/bin/codex-runner.XXXXXX")
  cat > "$TMP" <<'RUNNER_SCRIPT'
<EMBEDDED_SCRIPT_CONTENT>
RUNNER_SCRIPT
  chmod +x "$TMP"
  mv "$TMP" "$HOME/.local/bin/codex-runner.sh"
  RUNNER="$HOME/.local/bin/codex-runner.sh"
fi
```

Where `<EMBEDDED_SCRIPT_CONTENT>` is the full content of the codex-runner.sh script below:

```bash
#!/usr/bin/env bash
set -euo pipefail

# IMPORTANT: Bump CODEX_RUNNER_VERSION when changing this script.
# embed-runner.sh checks this version string across all embed locations.
CODEX_RUNNER_VERSION="6"

# --- Exit codes ---
EXIT_SUCCESS=0
EXIT_ERROR=1
EXIT_TIMEOUT=2
EXIT_TURN_FAILED=3
EXIT_STALLED=4
EXIT_CODEX_NOT_FOUND=5

# --- Extract cross-platform process helper ---
# Helper lives alongside this script, auto-extracted if missing or version mismatch.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROC_HELPER="$SCRIPT_DIR/.codex-proc-helper.py"
if ! python3 "$PROC_HELPER" version 2>/dev/null | grep -q "^6$"; then
  cat > "$PROC_HELPER" <<'PROC_HELPER_PY'
"""Cross-platform process helper for codex-runner.sh (stdlib only)."""
import os, sys, signal, json, subprocess, time

HELPER_VERSION = 6
IS_WIN = sys.platform == 'win32'

def cmd_version():
    print(HELPER_VERSION)

def cmd_launch():
    state_dir = sys.argv[2]
    working_dir = sys.argv[3]
    timeout_s = int(sys.argv[4])
    thread_id = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else ''
    effort = sys.argv[6] if len(sys.argv) > 6 else 'high'

    prompt_file = os.path.join(state_dir, 'prompt.txt')
    jsonl_file = os.path.join(state_dir, 'output.jsonl')
    err_file = os.path.join(state_dir, 'error.log')

    if thread_id:
        cmd = ['codex', 'exec', '--skip-git-repo-check', '--json', 'resume', thread_id]
        cwd = working_dir
    else:
        cmd = ['codex', 'exec', '--skip-git-repo-check', '--json',
               '--sandbox', 'read-only',
               '--config', 'model_reasoning_effort=' + effort,
               '-C', working_dir]
        cwd = None

    creation_flags = 0
    if IS_WIN:
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        CREATE_NO_WINDOW = 0x08000000
        creation_flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW

    with open(prompt_file) as fin, open(jsonl_file, 'w') as fout, open(err_file, 'w') as ferr:
        kwargs = dict(stdin=fin, stdout=fout, stderr=ferr, cwd=cwd)
        if IS_WIN:
            kwargs['creationflags'] = creation_flags
        else:
            kwargs['start_new_session'] = True
        p = subprocess.Popen(cmd, **kwargs)

    print(json.dumps({'pid': p.pid, 'pgid': p.pid}))

def cmd_is_alive():
    pid = int(sys.argv[2])
    try:
        if IS_WIN:
            # os.kill(pid, 0) works on Windows for liveness check
            os.kill(pid, 0)
        else:
            os.kill(pid, 0)
        print('alive')
    except (OSError, ProcessLookupError):
        print('dead')

def cmd_kill_tree():
    pid = int(sys.argv[2])
    try:
        if IS_WIN:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.killpg(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass

def cmd_kill_single():
    pid = int(sys.argv[2])
    try:
        if IS_WIN:
            subprocess.run(['taskkill', '/F', '/PID', str(pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass

def _get_cmdline(pid):
    """Get process command line. Returns string or None."""
    try:
        if IS_WIN:
            # Try PowerShell first (works on all modern Windows)
            try:
                result = subprocess.run(
                    ['powershell', '-NoProfile', '-Command',
                     f'(Get-CimInstance Win32_Process -Filter "ProcessId={pid}").CommandLine'],
                    capture_output=True, text=True, timeout=10)
                cmdline = result.stdout.strip()
                if cmdline:
                    return cmdline
            except FileNotFoundError:
                pass
            # Fallback to wmic (older Windows)
            try:
                result = subprocess.run(
                    ['wmic', 'process', 'where', f'ProcessId={pid}', 'get', 'CommandLine', '/value'],
                    capture_output=True, text=True, timeout=5)
                for line in result.stdout.splitlines():
                    if line.startswith('CommandLine='):
                        return line[len('CommandLine='):]
            except FileNotFoundError:
                pass
            return None
        else:
            result = subprocess.run(['ps', '-p', str(pid), '-o', 'args='],
                                    capture_output=True, text=True, timeout=5)
            return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None

def cmd_verify_codex():
    pid = int(sys.argv[2])
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        print('dead')
        return
    cmdline = _get_cmdline(pid)
    if cmdline is None:
        print('unknown')
    elif 'codex exec' in cmdline or 'codex.exe exec' in cmdline:
        print('verified')
    else:
        print('mismatch')

def cmd_verify_watchdog():
    pid = int(sys.argv[2])
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        print('dead')
        return
    cmdline = _get_cmdline(pid)
    if cmdline is None:
        print('unknown')
    elif 'python' in cmdline.lower() and ('time.sleep' in cmdline or 'codex-proc-helper' in cmdline):
        print('verified')
    else:
        print('mismatch')

def cmd_watchdog():
    timeout_s = int(sys.argv[2])
    target_pid = int(sys.argv[3])
    if not IS_WIN:
        try:
            os.setsid()
        except OSError:
            pass
    time.sleep(timeout_s)
    # Kill the target process tree
    try:
        if IS_WIN:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(target_pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.killpg(target_pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass

if __name__ == '__main__':
    subcmd = sys.argv[1] if len(sys.argv) > 1 else ''
    dispatch = {
        'version': cmd_version,
        'launch': cmd_launch,
        'is-alive': cmd_is_alive,
        'kill-tree': cmd_kill_tree,
        'kill-single': cmd_kill_single,
        'verify-codex': cmd_verify_codex,
        'verify-watchdog': cmd_verify_watchdog,
        'watchdog': cmd_watchdog,
    }
    fn = dispatch.get(subcmd)
    if fn:
        fn()
    else:
        print(f'Unknown subcommand: {subcmd}', file=sys.stderr)
        sys.exit(1)
PROC_HELPER_PY
fi

# --- Subcommand dispatch ---
case "${1:-}" in
  start) shift; do_start=1 ;;
  poll)  shift; do_poll=1 ;;
  stop)  shift; do_stop=1 ;;
  *)     do_legacy=1 ;;
esac

# ============================================================
# SUBCOMMAND: start
# ============================================================
if [[ "${do_start:-}" == 1 ]]; then

  # --- Defaults ---
  WORKING_DIR=""
  EFFORT="high"
  THREAD_ID=""
  TIMEOUT=3600

  # --- Parse arguments ---
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --working-dir) WORKING_DIR="$2"; shift 2 ;;
      --effort) EFFORT="$2"; shift 2 ;;
      --thread-id) THREAD_ID="$2"; shift 2 ;;
      --timeout) TIMEOUT="$2"; shift 2 ;;
      --version) echo "codex-runner $CODEX_RUNNER_VERSION"; exit 0 ;;
      *) echo "Unknown option: $1" >&2; exit $EXIT_ERROR ;;
    esac
  done

  # --- Validate ---
  if [[ -z "$WORKING_DIR" ]]; then
    echo "Error: --working-dir is required" >&2
    exit $EXIT_ERROR
  fi
  if ! command -v codex &>/dev/null; then
    echo "Error: codex CLI not found in PATH" >&2
    exit $EXIT_CODEX_NOT_FOUND
  fi

  # --- Canonicalize WORKING_DIR ---
  WORKING_DIR_REAL=$(realpath "$WORKING_DIR")
  WORKING_DIR="$WORKING_DIR_REAL"

  # --- Read prompt from stdin ---
  PROMPT=$(cat)
  if [[ -z "$PROMPT" ]]; then
    echo "Error: no prompt provided on stdin" >&2
    exit $EXIT_ERROR
  fi

  # --- Create state directory ---
  RUN_ID="$(date +%s)-$$"
  STATE_DIR="${WORKING_DIR}/.codex-review/runs/${RUN_ID}"
  mkdir -p "$STATE_DIR"

  # Write prompt to file
  printf '%s' "$PROMPT" > "$STATE_DIR/prompt.txt"

  # --- Startup rollback trap ---
  # If anything fails before state.json is committed, clean up everything
  startup_cleanup() {
    local pgid="${CODEX_PGID:-}"
    if [[ -n "$pgid" ]]; then
      python3 "$PROC_HELPER" kill-tree "$pgid" 2>/dev/null || true
    fi
    local wpid="${WATCHDOG_PID:-}"
    if [[ -n "$wpid" ]]; then
      local wpid_status
      wpid_status=$(python3 "$PROC_HELPER" is-alive "$wpid" 2>/dev/null || echo "dead")
      if [[ "$wpid_status" == "alive" ]]; then
        python3 "$PROC_HELPER" kill-single "$wpid" 2>/dev/null || true
      fi
    fi
    rm -rf "$STATE_DIR"
  }
  trap startup_cleanup EXIT

  # --- Detach Codex process via cross-platform helper ---
  LAUNCH_RESULT=$(python3 "$PROC_HELPER" launch "$STATE_DIR" "$WORKING_DIR" "$TIMEOUT" "$THREAD_ID" "$EFFORT")

  CODEX_PID=$(echo "$LAUNCH_RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['pid'])")
  CODEX_PGID=$(echo "$LAUNCH_RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['pgid'])")

  # --- Watchdog timeout (detached) ---
  python3 "$PROC_HELPER" watchdog "$TIMEOUT" "$CODEX_PGID" &
  WATCHDOG_PID=$!
  disown $WATCHDOG_PID 2>/dev/null || true

  # --- Verify process is alive ---
  sleep 1
  ALIVE_CHECK=$(python3 "$PROC_HELPER" is-alive "$CODEX_PID" 2>/dev/null || echo "dead")
  if [[ "$ALIVE_CHECK" != "alive" ]]; then
    echo "Error: Codex process died immediately after launch" >&2
    # startup_cleanup trap will handle the rest
    exit $EXIT_ERROR
  fi

  # --- Write state.json (atomic: tmp -> mv) ---
  NOW=$(date +%s)
  STATE_TMP=$(mktemp "$STATE_DIR/state.json.XXXXXX")
  python3 -c "
import json, sys
data = {
    'pid': int(sys.argv[1]),
    'pgid': int(sys.argv[2]),
    'watchdog_pid': int(sys.argv[3]),
    'run_id': sys.argv[4],
    'state_dir': sys.argv[5],
    'working_dir': sys.argv[6],
    'effort': sys.argv[7],
    'timeout': int(sys.argv[8]),
    'started_at': int(sys.argv[9]),
    'thread_id': sys.argv[10],
    'last_line_count': 0,
    'stall_count': 0,
    'last_poll_at': 0
}
with open(sys.argv[11], 'w') as f:
    json.dump(data, f, indent=2)
" "$CODEX_PID" "$CODEX_PGID" "$WATCHDOG_PID" "$RUN_ID" "$STATE_DIR" "$WORKING_DIR" "$EFFORT" "$TIMEOUT" "$NOW" "$THREAD_ID" "$STATE_TMP"
  mv "$STATE_TMP" "$STATE_DIR/state.json"

  # --- State committed: remove startup trap ---
  trap - EXIT

  # --- Output result ---
  echo "CODEX_STARTED:${STATE_DIR}"
  exit $EXIT_SUCCESS
fi

# ============================================================
# SUBCOMMAND: poll
# ============================================================
if [[ "${do_poll:-}" == 1 ]]; then

  STATE_DIR="${1:-}"
  if [[ -z "$STATE_DIR" ]]; then
    echo "POLL:failed:0s:1:Invalid or missing state directory"
    exit $EXIT_ERROR
  fi

  # Validate STATE_DIR: realpath + directory exists + state.json + reconstruct from working_dir+run_id
  STATE_DIR_REAL=$(realpath "$STATE_DIR" 2>/dev/null || true)
  if [[ -z "$STATE_DIR_REAL" || ! -d "$STATE_DIR_REAL" ]]; then
    echo "POLL:failed:0s:1:Invalid or missing state directory"
    exit $EXIT_ERROR
  fi
  STATE_DIR="$STATE_DIR_REAL"

  # --- Read state ---
  if [[ ! -f "$STATE_DIR/state.json" ]]; then
    echo "POLL:failed:0s:1:state.json not found"
    exit $EXIT_ERROR
  fi

  # Reconstruct expected path from state.json and compare
  VALIDATE_RESULT=$(python3 -c "
import sys, json, os
with open(sys.argv[1]) as f:
    s = json.load(f)
wd = os.path.realpath(s.get('working_dir', ''))
rid = s.get('run_id', '')
expected = os.path.join(wd, '.codex-review', 'runs', rid)
actual = os.path.realpath(sys.argv[2])
print('OK' if expected == actual else 'MISMATCH')
" "$STATE_DIR/state.json" "$STATE_DIR" 2>/dev/null || echo "ERROR")

  if [[ "$VALIDATE_RESULT" == "MISMATCH" ]]; then
    # Fallback: check old /tmp format for migration
    if [[ "$STATE_DIR_REAL" =~ ^(/tmp|/private/tmp)/codex-runner-[0-9]+-[0-9]+$ ]]; then
      echo "[migration] Accepting legacy /tmp state directory" >&2
    else
      echo "POLL:failed:0s:1:state directory path mismatch"
      exit $EXIT_ERROR
    fi
  elif [[ "$VALIDATE_RESULT" != "OK" ]]; then
    echo "POLL:failed:0s:1:state.json validation error"
    exit $EXIT_ERROR
  fi

  # --- Check for cached final result (idempotent, after validation) ---
  if [[ -f "$STATE_DIR/final.txt" ]]; then
    cat "$STATE_DIR/final.txt"
    if [[ -f "$STATE_DIR/review.txt" ]]; then
      echo "[cached] Review available in $STATE_DIR/review.txt" >&2
    fi
    exit $EXIT_SUCCESS
  fi

  # Parse state.json with python3
  STATE_VALS=$(python3 -c "
import sys, json, time
with open(sys.argv[1]) as f:
    s = json.load(f)
print(s.get('pid', ''))
print(s.get('pgid', ''))
print(s.get('watchdog_pid', ''))
print(s.get('timeout', 3600))
print(s.get('started_at', int(time.time())))
print(s.get('last_line_count', 0))
print(s.get('stall_count', 0))
print(s.get('thread_id', ''))
" "$STATE_DIR/state.json")

  CODEX_PID=$(echo "$STATE_VALS" | sed -n '1p')
  CODEX_PGID=$(echo "$STATE_VALS" | sed -n '2p')
  WATCHDOG_PID=$(echo "$STATE_VALS" | sed -n '3p')
  TIMEOUT=$(echo "$STATE_VALS" | sed -n '4p')
  STARTED_AT=$(echo "$STATE_VALS" | sed -n '5p')
  LAST_LINE_COUNT=$(echo "$STATE_VALS" | sed -n '6p')
  STALL_COUNT=$(echo "$STATE_VALS" | sed -n '7p')
  THREAD_ID=$(echo "$STATE_VALS" | sed -n '8p')

  JSONL_FILE="$STATE_DIR/output.jsonl"
  ERR_FILE="$STATE_DIR/error.log"
  NOW=$(date +%s)
  ELAPSED=$((NOW - STARTED_AT))

  # --- Check if PID is alive (cross-platform) ---
  PROCESS_ALIVE=1
  ALIVE_CHECK=$(python3 "$PROC_HELPER" is-alive "$CODEX_PID" 2>/dev/null || echo "dead")
  if [[ "$ALIVE_CHECK" != "alive" ]]; then
    PROCESS_ALIVE=0
  fi

  # --- Count lines ---
  CURRENT_LINE_COUNT=0
  if [[ -f "$JSONL_FILE" ]]; then
    CURRENT_LINE_COUNT=$(wc -l < "$JSONL_FILE" 2>/dev/null || echo 0)
    CURRENT_LINE_COUNT=$(echo "$CURRENT_LINE_COUNT" | tr -d ' ')
  fi

  # --- Stall detection ---
  NEW_STALL_COUNT=$STALL_COUNT
  if [[ "$CURRENT_LINE_COUNT" -eq "$LAST_LINE_COUNT" ]]; then
    NEW_STALL_COUNT=$((STALL_COUNT + 1))
  else
    NEW_STALL_COUNT=0
  fi

  # --- Helper: verify PID belongs to codex before killing (cross-platform) ---
  verify_and_kill_codex() {
    local pid="$1" pgid="$2"
    local status
    status=$(python3 "$PROC_HELPER" verify-codex "$pid" 2>/dev/null || echo "dead")
    case "$status" in
      dead) return 0 ;;
      verified|unknown) python3 "$PROC_HELPER" kill-tree "$pgid" 2>/dev/null || true ;;
      mismatch) ;; # PID reused by different process — do not kill
    esac
  }
  verify_and_kill_watchdog() {
    local pid="$1"
    local status
    status=$(python3 "$PROC_HELPER" verify-watchdog "$pid" 2>/dev/null || echo "dead")
    case "$status" in
      dead) return 0 ;;
      verified|unknown) python3 "$PROC_HELPER" kill-single "$pid" 2>/dev/null || true ;;
      mismatch) ;;
    esac
  }

  # --- Helper: write final.txt and kill processes ---
  write_final_and_cleanup() {
    local final_content="$1"
    local final_tmp
    final_tmp=$(mktemp "$STATE_DIR/final.txt.XXXXXX")
    printf '%s' "$final_content" > "$final_tmp"
    mv "$final_tmp" "$STATE_DIR/final.txt"
    # Kill Codex process group if verified
    verify_and_kill_codex "$CODEX_PID" "$CODEX_PGID"
    # Kill watchdog if verified
    if [[ -n "$WATCHDOG_PID" ]]; then
      verify_and_kill_watchdog "$WATCHDOG_PID"
    fi
  }

  # --- Parse JSONL events (BEFORE timeout/stall checks) ---
  # Terminal events take priority: if Codex finished, we want the result
  # even if we're past the timeout window.
  # Python3 script outputs:
  #   stdout: POLL:<status>:<elapsed>s[:...] lines
  #   stderr: [Xs] progress messages
  #   Writes review.txt if completed
  POLL_OUTPUT=$(python3 -c "
import sys, json, os

state_dir = sys.argv[1]
last_line_count = int(sys.argv[2])
elapsed = int(sys.argv[3])
process_alive = int(sys.argv[4])
timeout_val = int(sys.argv[5]) if len(sys.argv) > 5 else 0

jsonl_file = os.path.join(state_dir, 'output.jsonl')
err_file = os.path.join(state_dir, 'error.log')

all_lines = []
turn_completed = False
turn_failed = False
turn_failed_msg = ''
extracted_thread_id = ''
review_text = ''

if os.path.isfile(jsonl_file):
    with open(jsonl_file) as f:
        all_lines = f.readlines()

# Parse ALL lines for terminal state + data extraction
for line in all_lines:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        continue
    t = d.get('type', '')

    # Thread ID from thread.started event
    if t == 'thread.started' and d.get('thread_id'):
        extracted_thread_id = d['thread_id']

    # Terminal states
    if t == 'turn.completed':
        turn_completed = True
    elif t == 'turn.failed':
        turn_failed = True
        turn_failed_msg = d.get('error', {}).get('message', 'unknown error')

    # Review text from agent_message (inside item.completed)
    if t == 'item.completed':
        item = d.get('item', {})
        if item.get('type') == 'agent_message':
            review_text = item.get('text', '')

# Parse NEW lines for progress events -> stderr
new_lines = all_lines[last_line_count:]
for line in new_lines:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        continue
    t = d.get('type', '')
    item = d.get('item', {})
    item_type = item.get('type', '')

    if t == 'turn.started':
        print(f'[{elapsed}s] Codex is thinking...', file=sys.stderr)
    elif t == 'item.completed' and item_type == 'reasoning':
        text = item.get('text', '')
        if len(text) > 150:
            text = text[:150] + '...'
        print(f'[{elapsed}s] Codex thinking: {text}', file=sys.stderr)
    elif t == 'item.started' and item_type == 'command_execution':
        cmd = item.get('command', '')
        print(f'[{elapsed}s] Codex running: {cmd}', file=sys.stderr)
    elif t == 'item.completed' and item_type == 'command_execution':
        cmd = item.get('command', '')
        print(f'[{elapsed}s] Codex completed: {cmd}', file=sys.stderr)
    elif t == 'item.completed' and item_type == 'file_change':
        changes = item.get('changes', [])
        for c in changes:
            path = c.get('path', '?')
            kind = c.get('kind', '?')
            print(f'[{elapsed}s] Codex changed: {path} ({kind})', file=sys.stderr)

# Helper: sanitize message to single line
def sanitize_msg(s):
    import re
    if s is None:
        return 'unknown error'
    return re.sub(r'\s+', ' ', str(s)).strip()

# Determine status and output to stdout
if turn_completed:
    if not extracted_thread_id or not review_text:
        error_detail = 'no thread_id' if not extracted_thread_id else 'no agent_message'
        print(f'POLL:failed:{elapsed}s:1:turn.completed but {error_detail}')
    else:
        # Write review to file
        review_path = os.path.join(state_dir, 'review.txt')
        with open(review_path, 'w') as f:
            f.write(review_text)
        print(f'POLL:completed:{elapsed}s')
        print(f'THREAD_ID:{extracted_thread_id}')
elif turn_failed:
    print(f'POLL:failed:{elapsed}s:3:Codex turn failed: {sanitize_msg(turn_failed_msg)}')
elif not process_alive:
    if timeout_val > 0 and elapsed >= timeout_val:
        print(f'POLL:timeout:{elapsed}s:2:Timeout after {timeout_val}s')
    else:
        err_content = ''
        if os.path.isfile(err_file):
            with open(err_file) as f:
                err_content = f.read().strip()
        error_msg = 'Codex process exited unexpectedly'
        if err_content:
            error_msg += ': ' + sanitize_msg(err_content[:200])
        print(f'POLL:failed:{elapsed}s:1:{error_msg}')
else:
    print(f'POLL:running:{elapsed}s')
" "$STATE_DIR" "$LAST_LINE_COUNT" "$ELAPSED" "$PROCESS_ALIVE" "$TIMEOUT")

  # Parse first line for status
  POLL_STATUS=$(echo "$POLL_OUTPUT" | head -1 | cut -d: -f2)

  if [[ "$POLL_STATUS" != "running" ]]; then
    # Terminal state — write final.txt and cleanup
    write_final_and_cleanup "$POLL_OUTPUT"
  else
    # --- Only check timeout/stall when still running (no terminal event yet) ---
    if [[ $ELAPSED -ge $TIMEOUT ]]; then
      POLL_OUTPUT="POLL:timeout:${ELAPSED}s:${EXIT_TIMEOUT}:Timeout after ${TIMEOUT}s"
      write_final_and_cleanup "$POLL_OUTPUT"
      POLL_STATUS="timeout"
    elif [[ $NEW_STALL_COUNT -ge 12 && $PROCESS_ALIVE -eq 1 ]]; then
      POLL_OUTPUT="POLL:stalled:${ELAPSED}s:${EXIT_STALLED}:No new output for ~3 minutes"
      write_final_and_cleanup "$POLL_OUTPUT"
      POLL_STATUS="stalled"
    fi
  fi

  # --- Update state.json (atomic) ---
  STATE_TMP=$(mktemp "$STATE_DIR/state.json.XXXXXX")
  python3 -c "
import sys, json
with open(sys.argv[1]) as f:
    s = json.load(f)
s['last_line_count'] = int(sys.argv[2])
s['stall_count'] = int(sys.argv[3])
s['last_poll_at'] = int(sys.argv[4])
with open(sys.argv[5], 'w') as f:
    json.dump(s, f, indent=2)
" "$STATE_DIR/state.json" "$CURRENT_LINE_COUNT" "$NEW_STALL_COUNT" "$NOW" "$STATE_TMP"
  mv "$STATE_TMP" "$STATE_DIR/state.json"

  # --- Output ---
  echo "$POLL_OUTPUT"
  exit $EXIT_SUCCESS
fi

# ============================================================
# SUBCOMMAND: stop
# ============================================================
if [[ "${do_stop:-}" == 1 ]]; then

  STATE_DIR="${1:-}"
  if [[ -z "$STATE_DIR" ]]; then
    echo "Error: state directory argument required" >&2
    exit $EXIT_ERROR
  fi

  # Validate STATE_DIR: realpath + state.json + reconstruct from working_dir+run_id
  STATE_DIR_REAL=$(realpath "$STATE_DIR" 2>/dev/null || true)
  if [[ -z "$STATE_DIR_REAL" || ! -d "$STATE_DIR_REAL" ]]; then
    echo "Error: state directory does not exist" >&2
    exit $EXIT_ERROR
  fi
  STATE_DIR="$STATE_DIR_REAL"
  if [[ ! -f "$STATE_DIR/state.json" ]]; then
    echo "Error: no state.json found in $STATE_DIR — not a valid runner state" >&2
    exit $EXIT_ERROR
  fi

  # Reconstruct expected path from state.json and compare
  VALIDATE_RESULT=$(python3 -c "
import sys, json, os
with open(sys.argv[1]) as f:
    s = json.load(f)
wd = os.path.realpath(s.get('working_dir', ''))
rid = s.get('run_id', '')
expected = os.path.join(wd, '.codex-review', 'runs', rid)
actual = os.path.realpath(sys.argv[2])
print('OK' if expected == actual else 'MISMATCH')
" "$STATE_DIR/state.json" "$STATE_DIR" 2>/dev/null || echo "ERROR")

  if [[ "$VALIDATE_RESULT" == "MISMATCH" ]]; then
    # Fallback: check old /tmp format for migration
    if [[ "$STATE_DIR_REAL" =~ ^(/tmp|/private/tmp)/codex-runner-[0-9]+-[0-9]+$ ]]; then
      echo "[migration] Accepting legacy /tmp state directory" >&2
    else
      echo "Error: state directory path mismatch" >&2
      exit $EXIT_ERROR
    fi
  elif [[ "$VALIDATE_RESULT" != "OK" ]]; then
    echo "Error: state.json validation error" >&2
    exit $EXIT_ERROR
  fi

  if [[ -f "$STATE_DIR/state.json" ]]; then
    # Parse PID/PGID/watchdog
    STOP_VALS=$(python3 -c "
import sys, json
with open(sys.argv[1]) as f:
    s = json.load(f)
print(s.get('pid', ''))
print(s.get('pgid', ''))
print(s.get('watchdog_pid', ''))
" "$STATE_DIR/state.json" 2>/dev/null || true)

    CODEX_PID=$(echo "$STOP_VALS" | sed -n '1p')
    CODEX_PGID=$(echo "$STOP_VALS" | sed -n '2p')
    WATCHDOG_PID=$(echo "$STOP_VALS" | sed -n '3p')

    # Kill Codex process group (verify identity via cross-platform helper)
    if [[ -n "$CODEX_PID" && -n "$CODEX_PGID" ]]; then
      VERIFY_STATUS=$(python3 "$PROC_HELPER" verify-codex "$CODEX_PID" 2>/dev/null || echo "dead")
      if [[ "$VERIFY_STATUS" == "verified" || "$VERIFY_STATUS" == "unknown" ]]; then
        python3 "$PROC_HELPER" kill-tree "$CODEX_PGID" 2>/dev/null || true
      fi
    fi

    # Kill watchdog (verify identity)
    if [[ -n "$WATCHDOG_PID" ]]; then
      VERIFY_WD=$(python3 "$PROC_HELPER" verify-watchdog "$WATCHDOG_PID" 2>/dev/null || echo "dead")
      if [[ "$VERIFY_WD" == "verified" || "$VERIFY_WD" == "unknown" ]]; then
        python3 "$PROC_HELPER" kill-single "$WATCHDOG_PID" 2>/dev/null || true
      fi
    fi
  fi

  # Remove state directory
  rm -rf "$STATE_DIR"
  exit $EXIT_SUCCESS
fi

# ============================================================
# LEGACY MODE (no subcommand — backwards compatible)
# ============================================================
if [[ "${do_legacy:-}" == 1 ]]; then

  # --- Defaults ---
  WORKING_DIR=""
  EFFORT="high"
  THREAD_ID=""
  TIMEOUT=3600
  POLL_INTERVAL=15

  # --- Parse arguments ---
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode) shift 2 ;;  # accepted but ignored for backwards compatibility
      --working-dir) WORKING_DIR="$2"; shift 2 ;;
      --effort) EFFORT="$2"; shift 2 ;;
      --thread-id) THREAD_ID="$2"; shift 2 ;;
      --timeout) TIMEOUT="$2"; shift 2 ;;
      --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
      --version) echo "codex-runner $CODEX_RUNNER_VERSION"; exit 0 ;;
      *) echo "Unknown option: $1" >&2; exit $EXIT_ERROR ;;
    esac
  done

  # --- Validate ---
  if [[ -z "$WORKING_DIR" ]]; then
    echo "Error: --working-dir is required" >&2
    exit $EXIT_ERROR
  fi
  if ! command -v codex &>/dev/null; then
    echo "Error: codex CLI not found in PATH" >&2
    exit $EXIT_CODEX_NOT_FOUND
  fi

  # --- Canonicalize WORKING_DIR ---
  WORKING_DIR_REAL=$(realpath "$WORKING_DIR")
  WORKING_DIR="$WORKING_DIR_REAL"

  # --- Read prompt from stdin ---
  PROMPT=$(cat)
  if [[ -z "$PROMPT" ]]; then
    echo "Error: no prompt provided on stdin" >&2
    exit $EXIT_ERROR
  fi

  # --- Temp files ---
  RUN_ID="$(date +%s)-$$"
  mkdir -p "${WORKING_DIR}/.codex-review/runs"
  JSONL_FILE="${WORKING_DIR}/.codex-review/runs/${RUN_ID}.jsonl"
  ERR_FILE="${WORKING_DIR}/.codex-review/runs/${RUN_ID}.err"

  cleanup() {
    local codex_pid_local="${CODEX_PID:-}"
    if [[ -n "$codex_pid_local" ]]; then
      local alive_status
      alive_status=$(python3 "$PROC_HELPER" is-alive "$codex_pid_local" 2>/dev/null || echo "dead")
      if [[ "$alive_status" == "alive" ]]; then
        python3 "$PROC_HELPER" kill-single "$codex_pid_local" 2>/dev/null || true
        wait "$codex_pid_local" 2>/dev/null || true
      fi
    fi
    rm -f "$JSONL_FILE" "$ERR_FILE"
  }
  trap cleanup EXIT

  # --- Build and launch Codex command ---
  CODEX_PID=""

  if [[ -n "$THREAD_ID" ]]; then
    cd "$WORKING_DIR"
    echo "$PROMPT" | codex exec --skip-git-repo-check --json resume "$THREAD_ID" \
      > "$JSONL_FILE" 2>"$ERR_FILE" &
    CODEX_PID=$!
  else
    echo "$PROMPT" | codex exec --skip-git-repo-check --json \
      --sandbox read-only \
      --config model_reasoning_effort="$EFFORT" \
      -C "$WORKING_DIR" \
      > "$JSONL_FILE" 2>"$ERR_FILE" &
    CODEX_PID=$!
  fi

  # --- Poll loop ---
  ELAPSED=0
  STALL_COUNT=0
  LAST_LINE_COUNT=0
  START_SECONDS=$SECONDS

  while true; do
    sleep "$POLL_INTERVAL"
    ELAPSED=$((SECONDS - START_SECONDS))

    if [[ $ELAPSED -ge $TIMEOUT ]]; then
      echo "[${ELAPSED}s] Error: timeout after ${TIMEOUT}s" >&2
      python3 "$PROC_HELPER" kill-single "$CODEX_PID" 2>/dev/null || true
      exit $EXIT_TIMEOUT
    fi

    ALIVE_CHECK=$(python3 "$PROC_HELPER" is-alive "$CODEX_PID" 2>/dev/null || echo "dead")
    if [[ "$ALIVE_CHECK" != "alive" ]]; then
      wait "$CODEX_PID" 2>/dev/null || true
      CODEX_PID=""
      break
    fi

    if [[ -f "$JSONL_FILE" ]]; then
      CURRENT_LINE_COUNT=$(wc -l < "$JSONL_FILE" 2>/dev/null || echo 0)
      CURRENT_LINE_COUNT=$(echo "$CURRENT_LINE_COUNT" | tr -d ' ')
    else
      CURRENT_LINE_COUNT=0
    fi

    if [[ "$CURRENT_LINE_COUNT" -eq "$LAST_LINE_COUNT" ]]; then
      STALL_COUNT=$((STALL_COUNT + 1))
    else
      STALL_COUNT=0
      LAST_LINE_COUNT=$CURRENT_LINE_COUNT
    fi

    if [[ $STALL_COUNT -ge 12 ]]; then
      echo "[${ELAPSED}s] Error: stalled — no new output for ~3 minutes" >&2
      python3 "$PROC_HELPER" kill-single "$CODEX_PID" 2>/dev/null || true
      exit $EXIT_STALLED
    fi

    if [[ -f "$JSONL_FILE" ]]; then
      LAST_EVENT=$(tail -1 "$JSONL_FILE" 2>/dev/null || true)
      if [[ -n "$LAST_EVENT" ]]; then
        EVENT_TYPE=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('type',''))" 2>/dev/null || true)

        case "$EVENT_TYPE" in
          turn.completed)
            wait "$CODEX_PID" 2>/dev/null || true
            CODEX_PID=""
            break
            ;;
          turn.failed)
            ERROR_MSG=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('error',{}).get('message','unknown error'))" 2>/dev/null || true)
            echo "[${ELAPSED}s] Error: Codex turn failed: $ERROR_MSG" >&2
            wait "$CODEX_PID" 2>/dev/null || true
            CODEX_PID=""
            exit $EXIT_TURN_FAILED
            ;;
          turn.started)
            echo "[${ELAPSED}s] Codex is thinking..." >&2
            ;;
          item.completed)
            ITEM_TYPE=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('item',{}).get('type',''))" 2>/dev/null || true)
            case "$ITEM_TYPE" in
              reasoning)
                REASONING_TEXT=$(echo "$LAST_EVENT" | python3 -c "import sys,json; t=json.loads(sys.stdin.read()).get('item',{}).get('text',''); print(t[:150]+'...' if len(t)>150 else t)" 2>/dev/null || true)
                echo "[${ELAPSED}s] Codex thinking: $REASONING_TEXT" >&2
                ;;
              command_execution)
                CMD=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('item',{}).get('command',''))" 2>/dev/null || true)
                echo "[${ELAPSED}s] Codex completed: $CMD" >&2
                ;;
              file_change)
                CHANGES_INFO=$(echo "$LAST_EVENT" | python3 -c "
import sys,json
item=json.loads(sys.stdin.read()).get('item',{})
for c in item.get('changes',[]):
    print(c.get('path','?')+' ('+c.get('kind','?')+')')
" 2>/dev/null || true)
                while IFS= read -r change_line; do
                  [[ -n "$change_line" ]] && echo "[${ELAPSED}s] Codex changed: $change_line" >&2
                done <<< "$CHANGES_INFO"
                ;;
            esac
            ;;
          item.started)
            ITEM_TYPE=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('item',{}).get('type',''))" 2>/dev/null || true)
            if [[ "$ITEM_TYPE" == "command_execution" ]]; then
              CMD=$(echo "$LAST_EVENT" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('item',{}).get('command',''))" 2>/dev/null || true)
              echo "[${ELAPSED}s] Codex running: $CMD" >&2
            fi
            ;;
        esac
      fi
    fi
  done

  # --- Process exited: check for turn.completed ---
  if [[ ! -f "$JSONL_FILE" ]]; then
    echo "[${ELAPSED}s] Error: no JSONL output file found" >&2
    if [[ -f "$ERR_FILE" ]]; then
      cat "$ERR_FILE" >&2
    fi
    exit $EXIT_ERROR
  fi

  if grep -q '"type":"turn.failed"' "$JSONL_FILE" 2>/dev/null; then
    ERROR_MSG=$(grep '"type":"turn.failed"' "$JSONL_FILE" | tail -1 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('error',{}).get('message','unknown error'))" 2>/dev/null || true)
    echo "[${ELAPSED}s] Error: Codex turn failed: $ERROR_MSG" >&2
    exit $EXIT_TURN_FAILED
  fi

  if ! grep -q '"type":"turn.completed"' "$JSONL_FILE" 2>/dev/null; then
    echo "[${ELAPSED}s] Error: Codex process exited without turn.completed" >&2
    if [[ -f "$ERR_FILE" ]] && [[ -s "$ERR_FILE" ]]; then
      echo "[${ELAPSED}s] Stderr:" >&2
      cat "$ERR_FILE" >&2
    fi
    exit $EXIT_ERROR
  fi

  # --- Extract results ---
  # thread_id comes from thread.started events
  EXTRACTED_THREAD_ID=$(grep '"type":"thread.started"' "$JSONL_FILE" 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('thread_id',''))" 2>/dev/null || true)
  # agent_message is nested inside item.completed events
  REVIEW_TEXT=$(grep '"agent_message"' "$JSONL_FILE" 2>/dev/null | tail -1 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); item=d.get('item',{}); print(item.get('text','') if item.get('type')=='agent_message' else '')" 2>/dev/null || true)

  if [[ -z "$REVIEW_TEXT" ]]; then
    echo "[${ELAPSED}s] Error: no agent_message found in output" >&2
    exit $EXIT_ERROR
  fi

  if [[ -z "$EXTRACTED_THREAD_ID" ]]; then
    echo "[${ELAPSED}s] Error: no thread_id found in output" >&2
    exit $EXIT_ERROR
  fi

  # --- Output structured result ---
  REVIEW_JSON=$(THREAD_ID_VAL="$EXTRACTED_THREAD_ID" python3 -c "
import sys, json, os
text = sys.stdin.read()
print(json.dumps({'thread_id': os.environ.get('THREAD_ID_VAL', ''), 'review': text, 'status': 'success'}))
" <<< "$REVIEW_TEXT")

  echo "CODEX_RESULT:${REVIEW_JSON}"
  exit $EXIT_SUCCESS
fi

```

### Runner Output Format

**Start mode** outputs a single line:
```
CODEX_STARTED:<STATE_DIR>
```

**Poll mode** outputs on stdout (machine-readable, one line per field):
- Running: `POLL:running:<elapsed>s`
- Completed: `POLL:completed:<elapsed>s` + `THREAD_ID:<id>` (review text in `<STATE_DIR>/review.txt`)
- Failed: `POLL:failed:<elapsed>s:<exit_code>:<error>`
- Timeout: `POLL:timeout:<elapsed>s:2:<error>`
- Stalled: `POLL:stalled:<elapsed>s:4:<error>`

Progress events are written to stderr in format `[Xs] message` — these are visible in Bash tool output.

### Exit Codes (legacy mode)
- `0` = success
- `1` = general error
- `2` = timeout (3600s default)
- `3` = codex turn failed
- `4` = codex stalled (~3 min no output)
- `5` = codex not found in PATH

### Poll Status Codes
- `running` — Codex still working; stderr shows progress events
- `completed` — Codex finished; `THREAD_ID:<id>` on stdout, review in `<STATE_DIR>/review.txt`
- `failed` — Codex turn failed or process exited unexpectedly
- `timeout` — Exceeded timeout (default 3600s)
- `stalled` — No new output for ~3 minutes

## Step 1: Parse Query & Gather Config

1. The query comes from the skill invocation: `/codex-think-about <query>`
2. If the query is empty, ask the user via `AskUserQuestion` what they want to think about.
3. Ask the user (via `AskUserQuestion`) **only one question**: effort level.

Effort level options:
- **low** — Quick initial thoughts (maps to Codex `model_reasoning_effort=low`)
- **medium** — Balanced analysis (maps to Codex `model_reasoning_effort=medium`)
- **high** — Deep thinking (maps to Codex `model_reasoning_effort=high`) (Recommended)
- **deep** — Maximum reasoning effort (maps to Codex `model_reasoning_effort=high`)

**Do NOT ask** which model to use — always use Codex's default model (no `-m` flag).

## Step 2: Gather Factual Context (NO opinion, NO analysis)

Claude Code gathers **facts only** so Codex has context without being biased by Claude Code's perspective. This keeps Codex's initial thinking independent.

Collect:
1. **Project info** — language, framework, key directories. Factual only.
2. **Conversation facts** — constraints the user mentioned, decisions already made, tech stack, file paths referenced. Only record facts, do NOT interpret or analyze.
3. **Relevant files** (if the query relates to code) — find 3-8 relevant file paths with a one-line factual description each. Do NOT paste code content, do NOT add commentary. If the query is purely conceptual, skip this.

**Principle**: Only send what Codex cannot access on its own. Keep Codex thinking **independently**.

## Step 3: Send to Codex — Round 1 (start/poll/stop)

### Step 3a — Start Codex

Run the codex-runner `start` subcommand with the bootstrap block:

```bash
RUNNER="${CODEX_RUNNER:-$HOME/.local/bin/codex-runner.sh}"
NEED_INSTALL=0
if [ -n "$CODEX_RUNNER" ] && test -x "$CODEX_RUNNER"; then
  if ! grep -q 'CODEX_RUNNER_VERSION="6"' "$CODEX_RUNNER" 2>/dev/null; then NEED_INSTALL=1; fi
elif ! test -x "$RUNNER"; then NEED_INSTALL=1
elif ! grep -q 'CODEX_RUNNER_VERSION="6"' "$RUNNER" 2>/dev/null; then NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  TMP=$(mktemp "$HOME/.local/bin/codex-runner.XXXXXX")
  cat > "$TMP" <<'RUNNER_SCRIPT'
<PASTE FULL SCRIPT FROM ABOVE>
RUNNER_SCRIPT
  chmod +x "$TMP"
  mv "$TMP" "$HOME/.local/bin/codex-runner.sh"
  RUNNER="$HOME/.local/bin/codex-runner.sh"
fi
"$RUNNER" start --working-dir <WORKING_DIR> --effort <EFFORT> --timeout 1800 <<'EOF'
<THINKING_PROMPT>
EOF
```

The output will be: `CODEX_STARTED:<WORKING_DIR>/.codex-review/runs/<RUN_ID>`

Save the state directory path — you need it for polling and cleanup.

### Step 3b — Poll Loop

Call `poll` repeatedly to check progress. Each poll outputs status on stdout and progress on stderr:

```bash
sleep 60 && "$RUNNER" poll <STATE_DIR>
```

After each poll:
- stdout starts with `POLL:running:` → Codex is still working. Call poll again — use `sleep 30` for the second poll, then `sleep 15` for all subsequent polls.
- stdout starts with `POLL:completed:` → Extract thread_id from the `THREAD_ID:` line. Read the analysis from `<STATE_DIR>/review.txt` using the Read tool. Proceed to Step 3c.
- stdout starts with `POLL:failed:` or `POLL:timeout:` or `POLL:stalled:` → Handle per Error Handling section.

**Progress reporting**: Summarize progress events from stderr for the user between polls.

### Step 3c — Cleanup

After extracting the completed result (or handling an error):

```bash
"$RUNNER" stop <STATE_DIR>
```

Save the `thread_id` — you will need it for subsequent rounds.

After cleanup, **summarize Codex's analysis for the user** (progress update).

### Codex Prompt Template (Round 1)

```
You are an independent technical thinker participating in a peer discussion with Claude Code (Claude Opus 4.6).

## Your Role
Think deeply and independently about the question below. You and Claude Code are EQUAL PEERS — neither is the authority. Your value comes from independent analysis. After this round, Claude Code will respond with its own perspective, and you will discuss until you reach agreement or identify where you fundamentally disagree.

## Question
<USER_QUERY>

## Project Context
<Language, framework, key components. "N/A" if not project-specific.>

## Relevant Files
<File paths with one-line descriptions, or "No specific files — general question.">

## Known Constraints
<Factual constraints from conversation — decisions already made, requirements, limitations. NO opinions from Claude Code.>

## Instructions
1. Read relevant files if listed.
2. Think independently. Consider: multiple approaches, trade-offs, edge cases, what the asker might not have considered.
3. Produce analysis in the format below.

## Required Output Format

### Key Insights
1. [Insight with evidence]
...

### Considerations
- **[Aspect]**: [Analysis]
...

### Recommendations
1. [Actionable recommendation]
...

### Open Questions
- [Question warranting further exploration]
...

### Confidence Level
[HIGH | MEDIUM | LOW] — [Explanation]

Rules:
- Be specific, not abstract. Reference actual files when relevant.
- Acknowledge uncertainty honestly.
- Focus on 3-5 most important dimensions.
- Take clear positions where you have evidence — do NOT hedge everything.
```

## Step 4: Claude Code Responds

After reading Codex's analysis from `<STATE_DIR>/review.txt`:

1. **Analyze each point** Codex raised.
2. **Agree** with points that are well-reasoned — state "Agree with Codex because..."
3. **Disagree** with points where you have counter-evidence — provide your own reasoning and evidence.
4. **Add** perspectives Codex missed — introduce new insights or dimensions.
5. **Synthesize**: Clearly identify what is consensus and what is disagreement.
6. **Summarize for the user** before sending to Codex.

**Disagreement tracking**: Maintain a registry across rounds:
- Each disagreement gets an ID (D-1, D-2, ...), a status (open/resolved), and the round it was last changed.
- "Progress" means at least one of: a disagreement resolved, new evidence added, or a new dimension raised.

## Step 5: Send Response to Codex — Round 2+ (resume thread)

### Step 5a — Start Codex (resume)

```bash
RUNNER="${CODEX_RUNNER:-$HOME/.local/bin/codex-runner.sh}"
NEED_INSTALL=0
if [ -n "$CODEX_RUNNER" ] && test -x "$CODEX_RUNNER"; then
  if ! grep -q 'CODEX_RUNNER_VERSION="6"' "$CODEX_RUNNER" 2>/dev/null; then NEED_INSTALL=1; fi
elif ! test -x "$RUNNER"; then NEED_INSTALL=1
elif ! grep -q 'CODEX_RUNNER_VERSION="6"' "$RUNNER" 2>/dev/null; then NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  TMP=$(mktemp "$HOME/.local/bin/codex-runner.XXXXXX")
  cat > "$TMP" <<'RUNNER_SCRIPT'
<PASTE FULL SCRIPT FROM ABOVE>
RUNNER_SCRIPT
  chmod +x "$TMP"
  mv "$TMP" "$HOME/.local/bin/codex-runner.sh"
  RUNNER="$HOME/.local/bin/codex-runner.sh"
fi
"$RUNNER" start --working-dir <WORKING_DIR> --effort <EFFORT> --timeout 1800 --thread-id <THREAD_ID> <<'EOF'
<RESPONSE_PROMPT>
EOF
```

### Step 5b — Poll Loop

Same as Step 3b — poll until completed, then proceed to Step 5c.

### Step 5c — Cleanup

```bash
"$RUNNER" stop <STATE_DIR>
```

Read Codex's response from `<STATE_DIR>/review.txt`, then return to Step 4.

If timeout/stall/fail occurs, retry once per Error Handling policy (timeout → double to 3600s; failed/stalled → same timeout).

### Response Prompt Template (Round 2+ — Claude Code → Codex)

```
This is Claude Code (Claude Opus 4.6) responding to your analysis. We are peer thinkers discussing the same question.

## Points I Agree With
<For each agreed point, reference which insight/recommendation and briefly explain why>

## Points I Disagree With
<For each disagreement, reference the specific point and provide counter-reasoning with evidence>

## Additional Perspectives
<New insights or dimensions Claude Code identified that Codex didn't cover>

## Current Status
- **Agreed**: [list of consensus points]
- **Disagreed**: [list of remaining disagreements]

## Your Turn
Consider my responses above. For points of disagreement:
- If my reasoning is convincing, feel free to update your position.
- If you still disagree, explain why with additional evidence.
- If we're going in circles on a point, say so explicitly.

For new perspectives I raised:
- Share your thoughts — agree, disagree, or expand.

Use the same output format as before (Key Insights, Considerations, Recommendations, Open Questions, Confidence Level).
Add a section at the end:

### Discussion Status
- **Consensus Points**: [points both sides now agree on]
- **Remaining Disagreements**: [points still contested]
- **New Points**: [any new dimensions raised in this round]
```

## Auto-loop & Termination

The debate loop runs **fully automatically** — do NOT ask the user between rounds. The user is only informed via progress summaries after each round.

### Consensus Detection

After each round, check:
- All disagreements resolved → **CONSENSUS** → Step 6
- Codex explicitly agrees / says "no further concerns" → **CONSENSUS** → Step 6

### Stalemate Detection

- Same disagreements remain open AND no progress (per definition above) for **2 consecutive rounds** → **STALEMATE** → Step 6

### Hard Cap

Maximum **6 Codex turns** (codex_turns) as a safety net:
- Turn 1: Codex initial thinking
- Turn 2: Codex responds to Claude Code
- Turn 3+: Subsequent rounds
- If turn 6 reached without consensus → end as **STALEMATE**

Each turn = one start+poll+stop cycle.

## Step 6: Present Result to User

Present a **Thinking Session Summary**:

```
## Thinking Session Summary

### Question: <original query>
### Rounds: X
### Result: CONSENSUS / STALEMATE / TECHNICAL_FAILURE

### Key Insights (from the discussion):
1. [Insight — who raised it, how the other side responded]
...

### Considerations
- **[Aspect]**: [Analysis — consensus or disagreement]
...

### Recommendations:
1. [Recommendation — consensus or majority position]
...

### Open Questions (worth exploring further):
- [Question]
...

### Confidence Level
[HIGH | MEDIUM | LOW] — [Explanation based on consensus level achieved]

### Consensus/Disagreement Status
- **Agreed Points**: [list]
- **Unresolved Disagreements** (if stalemate): [Claude Code's position vs Codex's position for each point]
```

Then ask via `AskUserQuestion`:
- **Follow-up question** — ask more (starts a new thinking round with both AIs)
- **Done** — end the session

If the user chooses follow-up → **always start a new thread** (new question needs Codex to think independently). Only resume the old thread if the user explicitly says "continue exactly where we left off". When starting a new thread, pass a structured facts summary from the previous session (not the full thread).

## Important Rules

1. **Factual context only** — Do NOT send Claude Code's opinions or analysis in the Round 1 prompt. Keep Codex independent for initial thinking.
2. **Peer debate, not hierarchical** — Claude Code does NOT direct Codex. Both are equals.
3. **Codex reads files itself** — only list paths, do NOT paste file content.
4. **Heredoc `<<'EOF'`** for all prompts.
5. **No `-m` flag** — always use Codex's default model.
6. **Resume by thread ID** for rounds 2+.
7. **Summarize after every round** — user sees progress without intervening.
8. **Auto-loop** — do NOT ask user between rounds. Loop automatically until consensus/stalemate.
9. **Stalemate = 2 rounds without progress** — same disagreements, no new evidence or dimensions.
10. **Always call `stop`** after extracting results from each round.
11. **Best-effort parsing** — if Codex output doesn't match format exactly, parse what you can. Content matters more than format for a thinking skill.
12. **Track disagreements** — maintain a disagreement registry (D-1, D-2, ...) with status across rounds to detect stalemate.

## Error Handling

All error handling is **fully automatic** — do not ask the user during the loop.

**Timeout policy**: base timeout = 1800s. Retry uses timeout x2 = 3600s.

- `POLL:timeout:` → auto-retry once with `--timeout 3600`. If still timeout → end with `TECHNICAL_FAILURE`, present to user at Step 6. Call `stop`.
- `POLL:failed:` → auto-retry once (same timeout). If still fails → end with `TECHNICAL_FAILURE`. Call `stop`.
- `POLL:stalled:` → auto-retry once (same timeout). If still stalls → end with `TECHNICAL_FAILURE`. Call `stop`.
- Exit code 5 → end immediately, tell user to install Codex CLI at Step 6.
- Malformed output → parse best-effort, extract key content. Do not request reformatting (content matters more than format for thinking).
