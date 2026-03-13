#!/usr/bin/env node

/**
 * codex-runner.js — Cross-platform runner for Codex CLI (Node.js stdlib only).
 *
 * Replaces codex-runner.sh + codex-runner.py in a single file.
 * Subcommands: version, start, poll, stop, _watchdog
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

// --- Constants ---
const CODEX_RUNNER_VERSION = 11;

const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_TIMEOUT = 2;
const EXIT_TURN_FAILED = 3;
const EXIT_STALLED = 4;
const EXIT_CODEX_NOT_FOUND = 5;

const IS_WIN = process.platform === "win32";

// ============================================================
// Process management
// ============================================================

/**
 * Resolve the codex CLI command for spawning.
 *
 * On Windows, npm-installed CLIs are .cmd wrappers (e.g. codex.cmd).
 * Node.js spawn() cannot resolve .cmd files without shell: true,
 * but shell: true + detached: true drops stdio on Windows.
 * Instead, resolve the underlying codex.js entry point and invoke
 * it directly via node.exe — no shell needed.
 */
function resolveCodexCommand() {
  if (!IS_WIN) {
    return { cmd: "codex", prependArgs: [] };
  }

  // Try to find codex.js via npm global prefix
  const r = spawnSync("npm", ["config", "get", "prefix"], {
    encoding: "utf8",
    shell: true,
    timeout: 10000,
  });
  if (r.status === 0 && r.stdout) {
    const prefix = r.stdout.trim();
    const codexJs = path.join(
      prefix, "node_modules", "@openai", "codex", "bin", "codex.js",
    );
    if (fs.existsSync(codexJs)) {
      return { cmd: process.execPath, prependArgs: [codexJs] };
    }
  }

  // Fallback: try common npm global path on Windows
  const appData = process.env.APPDATA;
  if (appData) {
    const codexJs = path.join(
      appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js",
    );
    if (fs.existsSync(codexJs)) {
      return { cmd: process.execPath, prependArgs: [codexJs] };
    }
  }

  // Last resort: assume "codex" is directly executable (non-npm install)
  return { cmd: "codex", prependArgs: [] };
}

function launchCodex(stateDir, workingDir, timeoutS, threadId, effort, sandbox = "read-only") {
  const promptFile = path.join(stateDir, "prompt.txt");
  const jsonlFile = path.join(stateDir, "output.jsonl");
  const errFile = path.join(stateDir, "error.log");

  const { cmd: resolvedCmd, prependArgs } = resolveCodexCommand();
  let cmd = resolvedCmd;
  let args;
  let cwd;

  if (threadId) {
    args = [...prependArgs, "exec", "--skip-git-repo-check", "--json", "resume", threadId];
    cwd = workingDir;
  } else {
    args = [
      ...prependArgs,
      "exec", "--skip-git-repo-check", "--json",
      "--sandbox", sandbox,
      "--config", `model_reasoning_effort=${effort}`,
      "-C", workingDir,
    ];
    cwd = undefined;
  }

  const fin = fs.openSync(promptFile, "r");
  const fout = fs.openSync(jsonlFile, "w");
  const ferr = fs.openSync(errFile, "w");

  const spawnOpts = {
    stdio: [fin, fout, ferr],
    detached: true,
    cwd,
  };

  if (IS_WIN) {
    spawnOpts.windowsHide = true;
  }

  const child = spawn(cmd, args, spawnOpts);
  child.unref();

  const pid = child.pid;

  if (pid === undefined) {
    throw new Error(`Failed to spawn "${cmd}" — process did not start (ENOENT). Is codex installed globally?`);
  }

  // Close file descriptors in parent
  fs.closeSync(fin);
  fs.closeSync(fout);
  fs.closeSync(ferr);

  return { pid, pgid: pid };
}

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // Process already dead
  }
}

function killSingle(pid) {
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/F", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Process already dead
  }
}

function getCmdline(pid) {
  try {
    if (IS_WIN) {
      // Try PowerShell first
      try {
        const result = spawnSync(
          "powershell",
          ["-NoProfile", "-Command",
           `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          { encoding: "utf8", timeout: 10000 },
        );
        const cmdline = (result.stdout || "").trim();
        if (cmdline) return cmdline;
      } catch {
        // PowerShell not available
      }
      // Fallback to wmic
      try {
        const result = spawnSync(
          "wmic",
          ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/value"],
          { encoding: "utf8", timeout: 5000 },
        );
        for (const line of (result.stdout || "").split("\n")) {
          if (line.startsWith("CommandLine=")) {
            return line.slice("CommandLine=".length).trim();
          }
        }
      } catch {
        // wmic not available
      }
      return null;
    }

    // Unix
    const result = spawnSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0 ? (result.stdout || "").trim() : null;
  } catch {
    return null;
  }
}

function verifyCodex(pid) {
  if (!isAlive(pid)) return "dead";
  const cmdline = getCmdline(pid);
  if (cmdline === null) return "unknown";
  if (cmdline.includes("codex exec") || cmdline.includes("codex.exe exec") || cmdline.includes("codex.js") && cmdline.includes("exec")) {
    return "verified";
  }
  return "mismatch";
}

function verifyWatchdog(pid) {
  if (!isAlive(pid)) return "dead";
  const cmdline = getCmdline(pid);
  if (cmdline === null) return "unknown";
  if (cmdline.includes("node") && cmdline.includes("_watchdog")) {
    return "verified";
  }
  return "mismatch";
}

function launchWatchdog(timeoutS, targetPid) {
  const script = path.resolve(__filename);
  const nodeExe = process.execPath;
  const args = [script, "_watchdog", String(timeoutS), String(targetPid)];

  const spawnOpts = {
    stdio: "ignore",
    detached: true,
  };
  if (IS_WIN) {
    spawnOpts.windowsHide = true;
  }

  const child = spawn(nodeExe, args, spawnOpts);
  child.unref();
  return child.pid;
}

// ============================================================
// File I/O
// ============================================================

function atomicWrite(filepath, content) {
  const dirpath = path.dirname(filepath);
  const tmpPath = path.join(dirpath, `.${path.basename(filepath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

function readState(stateDir) {
  const stateFile = path.join(stateDir, "state.json");
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function updateState(stateDir, updates) {
  const state = readState(stateDir);
  Object.assign(state, updates);
  atomicWrite(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
  return state;
}

// ============================================================
// JSONL parsing
// ============================================================

function parseJsonl(stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state) {
  const jsonlFile = path.join(stateDir, "output.jsonl");
  const errFile = path.join(stateDir, "error.log");

  let allLines = [];
  if (fs.existsSync(jsonlFile)) {
    const content = fs.readFileSync(jsonlFile, "utf8");
    allLines = content.split("\n").filter(l => l.trim());
  }

  let turnCompleted = false;
  let turnFailed = false;
  let turnFailedMsg = "";
  let extractedThreadId = "";
  let reviewText = "";

  // Parse ALL lines for terminal state + data extraction
  for (const rawLine of allLines) {
    const line = rawLine.trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const t = d.type || "";

    if (t === "thread.started" && d.thread_id) {
      extractedThreadId = d.thread_id;
    }

    if (t === "turn.completed") {
      turnCompleted = true;
    } else if (t === "turn.failed") {
      turnFailed = true;
      turnFailedMsg = (d.error && d.error.message) || "unknown error";
    }

    if (t === "item.completed") {
      const item = d.item || {};
      if (item.type === "agent_message") {
        reviewText = item.text || "";
      }
    }
  }

  // Parse NEW lines for progress events
  const stderrLines = [];
  const newLines = allLines.slice(lastLineCount);
  for (const rawLine of newLines) {
    const line = rawLine.trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const t = d.type || "";
    const item = d.item || {};
    const itemType = item.type || "";

    if (t === "turn.started") {
      stderrLines.push(`[${elapsed}s] Codex is thinking...`);
    } else if (t === "item.completed" && itemType === "reasoning") {
      let text = item.text || "";
      if (text.length > 150) text = text.slice(0, 150) + "...";
      stderrLines.push(`[${elapsed}s] Codex thinking: ${text}`);
    } else if (t === "item.started" && itemType === "command_execution") {
      stderrLines.push(`[${elapsed}s] Codex running: ${item.command || ""}`);
    } else if (t === "item.completed" && itemType === "command_execution") {
      stderrLines.push(`[${elapsed}s] Codex completed: ${item.command || ""}`);
    } else if (t === "item.completed" && itemType === "file_change") {
      for (const c of (item.changes || [])) {
        stderrLines.push(`[${elapsed}s] Codex changed: ${c.path || "?"} (${c.kind || "?"})`);
      }
    }
  }

  function sanitizeMsg(s) {
    if (s == null) return "unknown error";
    return String(s).replace(/\s+/g, " ").trim();
  }

  // Determine status
  const stdoutParts = [];
  if (turnCompleted) {
    if (!extractedThreadId || !reviewText) {
      const errorDetail = !extractedThreadId ? "no thread_id" : "no agent_message";
      stdoutParts.push(`POLL:failed:${elapsed}s:1:turn.completed but ${errorDetail}`);
    } else {
      atomicWrite(path.join(stateDir, "review.md"), reviewText);
      
      stdoutParts.push(`POLL:completed:${elapsed}s`);
      stdoutParts.push(`THREAD_ID:${extractedThreadId}`);
    }
  } else if (turnFailed) {
    stdoutParts.push(`POLL:failed:${elapsed}s:3:Codex turn failed: ${sanitizeMsg(turnFailedMsg)}`);
  } else if (!processAlive) {
    if (timeoutVal > 0 && elapsed >= timeoutVal) {
      stdoutParts.push(`POLL:timeout:${elapsed}s:2:Timeout after ${timeoutVal}s`);
    } else {
      let errContent = "";
      if (fs.existsSync(errFile)) {
        errContent = fs.readFileSync(errFile, "utf8").trim();
      }
      let errorMsg = "Codex process exited unexpectedly";
      if (errContent) {
        errorMsg += ": " + sanitizeMsg(errContent.slice(0, 200));
      }
      stdoutParts.push(`POLL:failed:${elapsed}s:1:${errorMsg}`);
    }
  } else {
    stdoutParts.push(`POLL:running:${elapsed}s`);
  }

  return { stdoutOutput: stdoutParts.join("\n"), stderrLines };
}

// ============================================================
// Validation helpers
// ============================================================

function validateStateDir(stateDir) {
  let resolved;
  try {
    resolved = fs.realpathSync(stateDir);
  } catch {
    return { dir: null, err: "Invalid or missing state directory" };
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { dir: null, err: "Invalid or missing state directory" };
  }

  const stateFile = path.join(resolved, "state.json");
  if (!fs.existsSync(stateFile)) {
    return { dir: null, err: "state.json not found" };
  }

  // Reconstruct expected path from state.json and compare
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const wd = fs.realpathSync(s.working_dir || "");
    const rid = s.run_id || "";
    const expected = path.join(wd, ".codex-review", "runs", rid);
    const actual = fs.realpathSync(resolved);
    if (expected !== actual) {
      return { dir: null, err: "state directory path mismatch" };
    }
  } catch {
    return { dir: null, err: "state.json validation error" };
  }

  return { dir: resolved, err: null };
}

function verifyAndKillCodex(pid, pgid) {
  if (!pid || pid <= 1 || !pgid || pgid <= 1) return;
  const status = verifyCodex(pid);
  if (status === "verified" || status === "unknown") {
    killTree(pgid);
  }
}

function verifyAndKillWatchdog(pid) {
  if (!pid || pid <= 1) return;
  const status = verifyWatchdog(pid);
  if (status === "verified" || status === "unknown") {
    killSingle(pid);
  }
}

// ============================================================
// Stdin reading
// ============================================================

function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  let bytesRead;
  try {
    while (true) {
      bytesRead = fs.readSync(0, buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.slice(0, bytesRead)));
    }
  } catch {
    // EOF or pipe closed
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ============================================================
// Subcommands
// ============================================================

function cmdStart(argv) {
  // Parse arguments
  const { values } = parseArgs({
    args: argv,
    options: {
      "working-dir": { type: "string" },
      effort: { type: "string", default: "high" },
      "thread-id": { type: "string", default: "" },
      timeout: { type: "string", default: "3600" },
      sandbox: { type: "string", default: "read-only" },
    },
    strict: true,
  });

  const workingDir = values["working-dir"];
  const effort = values.effort || "high";
  const threadId = values["thread-id"] || "";
  const timeout = parseInt(values.timeout || "3600", 10);
  const sandbox = values.sandbox || "read-only";

  const VALID_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];
  if (!VALID_SANDBOXES.includes(sandbox)) {
    process.stderr.write(`Error: --sandbox must be one of: ${VALID_SANDBOXES.join(", ")}\n`);
    return EXIT_ERROR;
  }

  if (!workingDir) {
    process.stderr.write("Error: --working-dir is required\n");
    return EXIT_ERROR;
  }

  // Check codex in PATH
  const whichCmd = IS_WIN ? "where" : "which";
  const probe = spawnSync(whichCmd, ["codex"], { encoding: "utf8" });
  if (probe.status !== 0) {
    process.stderr.write("Error: codex CLI not found in PATH\n");
    return EXIT_CODEX_NOT_FOUND;
  }

  let resolvedWorkingDir;
  try {
    resolvedWorkingDir = fs.realpathSync(workingDir);
  } catch {
    process.stderr.write(`Error: working directory does not exist: ${workingDir}\n`);
    return EXIT_ERROR;
  }

  // Read prompt from stdin
  const prompt = readStdinSync();
  if (!prompt.trim()) {
    process.stderr.write("Error: no prompt provided on stdin\n");
    return EXIT_ERROR;
  }

  // Create state directory
  const runId = `${Math.floor(Date.now() / 1000)}-${process.pid}`;
  const stateDir = path.join(resolvedWorkingDir, ".codex-review", "runs", runId);
  fs.mkdirSync(stateDir, { recursive: true });

  // Write prompt
  fs.writeFileSync(path.join(stateDir, "prompt.txt"), prompt, "utf8");

  // Track for rollback
  let codexPgid = null;
  let watchdogPid = null;

  function startupCleanup() {
    if (codexPgid !== null) {
      killTree(codexPgid);
    }
    if (watchdogPid !== null && isAlive(watchdogPid)) {
      killSingle(watchdogPid);
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  try {
    // Launch Codex
    const { pid: codexPid, pgid } = launchCodex(
      stateDir, resolvedWorkingDir, timeout, threadId, effort, sandbox,
    );
    codexPgid = pgid;

    // Launch watchdog
    watchdogPid = launchWatchdog(timeout, codexPgid);

    // Write state.json atomically
    const now = Math.floor(Date.now() / 1000);
    const state = {
      pid: codexPid,
      pgid: codexPgid,
      watchdog_pid: watchdogPid,
      run_id: runId,
      state_dir: stateDir,
      working_dir: resolvedWorkingDir,
      effort,
      sandbox,
      timeout,
      started_at: now,
      thread_id: threadId,
      last_line_count: 0,
      stall_count: 0,
      last_poll_at: 0,
    };
    atomicWrite(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    startupCleanup();
    return EXIT_ERROR;
  }

  // Success
  process.stdout.write(`CODEX_STARTED:${stateDir}\n`);
  return EXIT_SUCCESS;
}

function cmdPoll(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    process.stdout.write("POLL:failed:0s:1:Invalid or missing state directory\n");
    return EXIT_ERROR;
  }

  const { dir: stateDir, err } = validateStateDir(stateDirArg);
  if (err) {
    process.stdout.write(`POLL:failed:0s:1:${err}\n`);
    return EXIT_ERROR;
  }

  // Check for cached final result
  const finalFile = path.join(stateDir, "final.txt");
  if (fs.existsSync(finalFile)) {
    const cached = fs.readFileSync(finalFile, "utf8");
    process.stdout.write(cached);
    if (!cached.endsWith("\n")) process.stdout.write("\n");
    const reviewFile = path.join(stateDir, "review.md");
    const legacyReviewFile = path.join(stateDir, "review.txt");
    if (fs.existsSync(reviewFile)) {
      process.stderr.write(`[cached] Review available in ${stateDir}/review.md\n`);
    } else if (fs.existsSync(legacyReviewFile)) {
      // Migrate legacy v9 review.txt → review.md for automation compatibility
      try {
        const legacyContent = fs.readFileSync(legacyReviewFile, "utf8");
        atomicWrite(reviewFile, legacyContent);
        process.stderr.write(`[cached] Migrated legacy review.txt → review.md in ${stateDir}\n`);
      } catch {
        process.stderr.write(`[cached] Review available in ${stateDir}/review.txt (legacy v9 state)\n`);
      }
    }
    return EXIT_SUCCESS;
  }

  // Read state
  const state = readState(stateDir);
  const codexPid = state.pid || 0;
  const codexPgid = state.pgid || 0;
  const watchdogPid = state.watchdog_pid || 0;
  const timeoutVal = state.timeout || 3600;
  const startedAt = state.started_at || Math.floor(Date.now() / 1000);
  const lastLineCount = state.last_line_count || 0;
  const stallCount = state.stall_count || 0;

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - startedAt;

  // Check if process is alive
  const processAlive = isAlive(codexPid);

  // Count lines
  const jsonlFile = path.join(stateDir, "output.jsonl");
  let currentLineCount = 0;
  if (fs.existsSync(jsonlFile)) {
    const content = fs.readFileSync(jsonlFile, "utf8");
    currentLineCount = content.split("\n").filter((l) => l.trim()).length;
  }

  // Stall detection
  const newStallCount = currentLineCount === lastLineCount
    ? stallCount + 1
    : 0;

  // Parse JSONL
  let { stdoutOutput: pollOutput, stderrLines } = parseJsonl(
    stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state
  );

  // Print progress to stderr
  for (const line of stderrLines) {
    process.stderr.write(line + "\n");
  }

  // Determine poll status from first line
  const firstLine = pollOutput.split("\n")[0] || "";
  const parts = firstLine.split(":");
  let pollStatus = parts.length >= 2 ? parts[1] : "";

  function writeFinalAndCleanup(content) {
    atomicWrite(path.join(stateDir, "final.txt"), content);
    verifyAndKillCodex(codexPid, codexPgid);
    if (watchdogPid) {
      verifyAndKillWatchdog(watchdogPid);
    }
  }

  if (pollStatus !== "running") {
    writeFinalAndCleanup(pollOutput);
  } else {
    // Check timeout/stall only when still running
    if (elapsed >= timeoutVal) {
      pollOutput = `POLL:timeout:${elapsed}s:${EXIT_TIMEOUT}:Timeout after ${timeoutVal}s`;
      writeFinalAndCleanup(pollOutput);
    } else if (newStallCount >= 12 && processAlive) {
      pollOutput = `POLL:stalled:${elapsed}s:${EXIT_STALLED}:No new output for ~3 minutes`;
      writeFinalAndCleanup(pollOutput);
    }
  }

  // Update state.json
  updateState(stateDir, {
    last_line_count: currentLineCount,
    stall_count: newStallCount,
    last_poll_at: now,
  });

  process.stdout.write(pollOutput + "\n");
  return EXIT_SUCCESS;
}

function cmdStop(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    process.stderr.write("Error: state directory argument required\n");
    return EXIT_ERROR;
  }

  const { dir: stateDir, err } = validateStateDir(stateDirArg);
  if (err) {
    process.stderr.write(`Error: ${err}\n`);
    return EXIT_ERROR;
  }

  // Read state and kill processes
  try {
    const state = readState(stateDir);
    const codexPid = state.pid || 0;
    const codexPgid = state.pgid || 0;
    const watchdogPid = state.watchdog_pid || 0;

    if (codexPid && codexPgid) {
      verifyAndKillCodex(codexPid, codexPgid);
    }
    if (watchdogPid) {
      verifyAndKillWatchdog(watchdogPid);
    }
  } catch {
    // State may be corrupted, proceed to cleanup
  }

  // Remove state directory
  fs.rmSync(stateDir, { recursive: true, force: true });
  return EXIT_SUCCESS;
}

function cmdWatchdog(argv) {
  const timeoutS = parseInt(argv[0], 10);
  const targetPid = parseInt(argv[1], 10);

  if (isNaN(timeoutS) || isNaN(targetPid)) {
    process.stderr.write("Error: _watchdog requires <timeout> <pid>\n");
    return EXIT_ERROR;
  }

  // Detach from parent session on Unix
  if (!IS_WIN) {
    try {
      process.setsid && process.setsid();
    } catch {
      // setsid may not be available in all Node.js builds
    }
  }

  // Use setTimeout to wait, then kill target
  setTimeout(() => {
    killTree(targetPid);
    process.exit(EXIT_SUCCESS);
  }, timeoutS * 1000);

  // Keep the process alive
  return -1; // Signal: don't exit immediately
}

// ============================================================
// CLI
// ============================================================

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "";
  const rest = argv.slice(1);

  let exitCode;

  switch (command) {
    case "version":
      process.stdout.write(`${CODEX_RUNNER_VERSION}\n`);
      exitCode = EXIT_SUCCESS;
      break;
    case "start":
      exitCode = cmdStart(rest);
      break;
    case "poll":
      exitCode = cmdPoll(rest);
      break;
    case "stop":
      exitCode = cmdStop(rest);
      break;
    case "_watchdog":
      exitCode = cmdWatchdog(rest);
      break;
    default:
      process.stderr.write(
        "codex-runner.js — Cross-platform runner for Codex CLI\n\n" +
        "Usage:\n" +
        "  node codex-runner.js version\n" +
        "  node codex-runner.js start --working-dir <dir> [--effort <level>] [--thread-id <id>] [--timeout <s>] [--sandbox <mode>]\n" +
        "  node codex-runner.js poll <state_dir>\n" +
        "  node codex-runner.js stop <state_dir>\n",
      );
      exitCode = command ? EXIT_ERROR : EXIT_SUCCESS;
      break;
  }

  // _watchdog returns -1 to keep process alive
  if (exitCode >= 0) {
    process.exit(exitCode);
  }
}

main();
