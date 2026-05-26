#!/usr/bin/env node

/**
 * codex-runner.js — Cross-platform runner for Codex CLI (Node.js stdlib only).
 *
 * v13: Runner-centric architecture. JSON-only output (except version/init/render).
 * Subcommands: version, init, start, resume, poll, stop, finalize, status, render, _watchdog
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

// --- Constants ---
const CODEX_RUNNER_VERSION = 13;

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
    args = [
      ...prependArgs, "exec", "--skip-git-repo-check", "--json",
      "--config", `model_reasoning_effort=${effort}`,
      "resume", threadId, "-",
    ];
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

function getDescendantPids(rootPid) {
  if (IS_WIN) return [];
  const descendants = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const ppid = queue.shift();
    try {
      const result = spawnSync("pgrep", ["-P", String(ppid)], {
        encoding: "utf8", timeout: 5000,
      });
      if (result.status === 0 && result.stdout) {
        const children = result.stdout.trim().split("\n")
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n > 0);
        for (const child of children) {
          if (!descendants.includes(child)) {
            descendants.push(child);
            queue.push(child);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return descendants;
}

function syncSleep(ms) {
  const result = spawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`], {
    timeout: ms + 2000,
  });
  if (result.error) {
    try {
      const sab = new SharedArrayBuffer(4);
      const view = new Int32Array(sab);
      Atomics.wait(view, 0, 0, ms);
    } catch {
      // Last resort: no sleep
    }
  }
}

function killTree(pid) {
  if (!pid || pid <= 1) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
      return;
    }

    const descendants = getDescendantPids(pid);

    try { process.kill(-pid, "SIGTERM"); } catch {}
    for (const dpid of descendants) {
      try { process.kill(dpid, "SIGTERM"); } catch {}
    }

    syncSleep(2000);

    const rescanSeeds = [pid, ...descendants.filter(d => isAlive(d))];
    const rescanned = [];
    for (const seed of rescanSeeds) {
      for (const dp of getDescendantPids(seed)) {
        if (!rescanned.includes(dp)) rescanned.push(dp);
      }
    }
    const allPids = new Set([...descendants, ...rescanned]);

    try { process.kill(-pid, "SIGKILL"); } catch {}
    for (const dpid of allPids) {
      if (isAlive(dpid)) {
        try { process.kill(dpid, "SIGKILL"); } catch {}
      }
    }
  } catch {}
}

function killSingle(pid) {
  if (!pid || pid <= 1) return;
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
      return;
    }
    try { process.kill(pid, "SIGTERM"); } catch { return; }
    syncSleep(500);
    if (isAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  } catch {}
}

function getCmdline(pid) {
  try {
    if (IS_WIN) {
      try {
        const result = spawnSync(
          "powershell",
          ["-NoProfile", "-Command",
           `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          { encoding: "utf8", timeout: 10000 },
        );
        const cmdline = (result.stdout || "").trim();
        if (cmdline) return cmdline;
      } catch {}
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
      } catch {}
      return null;
    }

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
  if (cmdline.includes("codex exec") || cmdline.includes("codex.exe exec") || (cmdline.includes("codex.js") && cmdline.includes("exec"))) {
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

function readRounds(stateDir) {
  const roundsFile = path.join(stateDir, "rounds.json");
  try {
    return JSON.parse(fs.readFileSync(roundsFile, "utf8"));
  } catch {
    return [];
  }
}

function writeRounds(stateDir, rounds) {
  atomicWrite(path.join(stateDir, "rounds.json"), JSON.stringify(rounds, null, 2));
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
// JSON output helpers
// ============================================================

function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function jsonError(error, code = "UNKNOWN_ERROR") {
  jsonOut({ status: "error", error, code });
}

// ============================================================
// Output parsers — v13
// ============================================================

/**
 * Parse a markdown field value: from "- FieldName:" to next "- " or "### ".
 * Handles multi-line values including fenced code blocks.
 */
function extractFieldValue(content) {
  if (!content) return "";
  return content.replace(/^\s*/, "").replace(/\s+$/, "");
}

/**
 * Parse "- FieldName: value" lines from a block of text.
 * Returns a Map of lowercase field name → raw value string.
 * Handles multi-line values (evidence with code blocks, etc.).
 */
function parseFields(blockContent) {
  const fields = new Map();
  const lines = blockContent.split("\n");
  let currentField = null;
  let currentValue = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track fenced code blocks
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (currentField) {
        currentValue.push(line);
      }
      continue;
    }

    if (inCodeBlock) {
      if (currentField) {
        currentValue.push(line);
      }
      continue;
    }

    // Check for new field: "- FieldName: value" or "- FieldName (detail): value"
    const fieldMatch = line.match(/^- ([A-Za-z][A-Za-z_ ]*(?:\([^)]*\))?):\s*(.*)/);
    if (fieldMatch) {
      // Save previous field
      if (currentField) {
        fields.set(currentField, extractFieldValue(currentValue.join("\n")));
      }
      currentField = fieldMatch[1].trim().toLowerCase();
      currentValue = [fieldMatch[2]];
    } else if (currentField) {
      // Continuation line for current field
      currentValue.push(line);
    }
  }

  // Save last field
  if (currentField) {
    fields.set(currentField, extractFieldValue(currentValue.join("\n")));
  }

  return fields;
}

/**
 * Extract verdict block from markdown.
 */
function parseVerdict(md) {
  // Match ### VERDICT heading
  const verdictMatch = md.match(/^### VERDICT\s*$/m);
  if (!verdictMatch) return null;

  const startIdx = verdictMatch.index + verdictMatch[0].length;
  // Find next ### heading or end
  const nextHeading = md.slice(startIdx).search(/^### /m);
  const verdictContent = nextHeading >= 0
    ? md.slice(startIdx, startIdx + nextHeading)
    : md.slice(startIdx);

  const fields = parseFields(verdictContent);

  const result = {
    status: fields.get("status") || null,
    reason: fields.get("reason") || null,
    risk_summary: null,
  };

  // Parse Security Risk Summary if present
  const riskMatch = verdictContent.match(/Security Risk Summary:\s*\n([\s\S]*?)(?:\n\n|\nRecommendations:|\nBlocking|$)/);
  if (riskMatch) {
    const riskLines = riskMatch[1].trim().split("\n");
    const risk = {};
    for (const line of riskLines) {
      const m = line.match(/^-\s*(Critical|High|Medium|Low):\s*(\d+)/i);
      if (m) {
        risk[m[1].toLowerCase()] = parseInt(m[2], 10);
      }
    }
    if (Object.keys(risk).length > 0) {
      result.risk_summary = risk;
    }
  }

  return result;
}

/**
 * Extract Overall Assessment block from markdown.
 */
function parseOverallAssessment(md) {
  const oaMatch = md.match(/^### Overall Assessment\s*$/m);
  if (!oaMatch) return null;

  const startIdx = oaMatch.index + oaMatch[0].length;
  const nextHeading = md.slice(startIdx).search(/^### /m);
  const oaContent = nextHeading >= 0
    ? md.slice(startIdx, startIdx + nextHeading)
    : md.slice(startIdx);

  const fields = parseFields(oaContent);
  const result = {};

  for (const [key, value] of fields) {
    // Normalize field names: "code quality" → "code_quality"
    const normalized = key.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    result[normalized] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse think-about format output.
 */
function parseThinkAboutMarkdown(md) {
  const result = {
    format: "think-about",
    insights: [],
    considerations: [],
    recommendations: [],
    sources: [],
    open_questions: [],
    confidence: null,
    suggested_status: null,
    raw_markdown: md,
  };

  // Split by ### headings
  const sections = {};
  const sectionRegex = /^### (.+)$/gm;
  let match;
  const headings = [];

  while ((match = sectionRegex.exec(md)) !== null) {
    headings.push({ title: match[1].trim(), index: match.index + match[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index;
    const end = i + 1 < headings.length ? headings[i + 1].index - headings[i + 1].title.length - 5 : md.length;
    sections[headings[i].title.toLowerCase()] = md.slice(start, end).trim();
  }

  // Extract bullet items from a section
  function extractBullets(sectionName) {
    const content = sections[sectionName];
    if (!content) return [];
    const items = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^- (.+)/);
      if (m) items.push(m[1].trim());
    }
    return items;
  }

  result.insights = extractBullets("key insights");
  result.considerations = extractBullets("considerations");
  result.recommendations = extractBullets("recommendations");
  result.open_questions = extractBullets("open questions");

  // Parse Sources table
  const sourcesContent = sections["sources"];
  if (sourcesContent) {
    const tableRows = sourcesContent.split("\n").filter(line => line.includes("|") && !line.match(/^\|?\s*[-|]+\s*\|?$/));
    for (const row of tableRows) {
      const cells = row.split("|").map(c => c.trim()).filter(c => c);
      if (cells.length >= 3 && cells[0] !== "#") {
        result.sources.push({ url: cells[1], description: cells[2] });
      }
    }
  }

  // Confidence level
  const confContent = sections["confidence level"];
  if (confContent) {
    const m = confContent.match(/\b(low|medium|high)\b/i);
    if (m) result.confidence = m[1].toLowerCase();
  }

  // Suggested Status
  const statusContent = sections["suggested status (advisory)"] || sections["suggested status"];
  if (statusContent) {
    const m = statusContent.match(/\b(CONTINUE|CONSENSUS|STALEMATE)\b/i);
    if (m) result.suggested_status = m[1].toUpperCase();
  }

  return result;
}

/**
 * parseOutputMarkdown — unified entry point for parsing Codex output.
 *
 * Detects format variant and extracts structured data.
 */
function parseOutputMarkdown(md, skillHint) {
  if (!md || !md.trim()) {
    return { format: "unknown", raw_markdown: md || "", parse_error: "Empty output" };
  }

  // Step 1: Detect format variant
  const hasResponse = /^### RESPONSE-\d+:/m.test(md);
  const hasCross = /^### CROSS-\d+:/m.test(md);
  const hasIssue = /^### ISSUE-\d+:/m.test(md);
  const hasCWE = /\bCWE:/m.test(md) || /\bCWE-\d+/m.test(md);
  const hasOWASP = /\bOWASP:/m.test(md) || /\bA\d{2}:2021/m.test(md);
  const hasAttackVector = /\bAttack Vector:/m.test(md);
  const hasOverallAssessment = /^### Overall Assessment/m.test(md);
  const hasKeyInsights = /^### Key Insight/m.test(md);
  const hasConsiderations = /^### Considerations/m.test(md);

  let format;
  if (hasResponse && !hasIssue && !hasCross) {
    format = "codebase-validation";
  } else if (hasCross) {
    format = "codebase-cross";
  } else if (hasIssue && (hasCWE || hasOWASP || hasAttackVector)) {
    format = "security-review";
  } else if (hasIssue && hasOverallAssessment) {
    format = "commit-pr-review";
  } else if (hasIssue) {
    format = "review";
  } else if (hasKeyInsights || hasConsiderations) {
    return parseThinkAboutMarkdown(md);
  } else if (hasResponse) {
    // Standalone RESPONSE blocks (round 2+ security review)
    format = "codebase-validation";
  } else {
    return { format: "unknown", raw_markdown: md, parse_error: "No recognized format markers found" };
  }

  // Step 2: Extract blocks
  const blockRegex = /^### (ISSUE|CROSS|RESPONSE)-(\d+):\s*(.+)$/gm;
  const blockPositions = [];
  let m;

  while ((m = blockRegex.exec(md)) !== null) {
    blockPositions.push({
      prefix: m[1],
      id: parseInt(m[2], 10),
      title: m[3].trim(),
      startContent: m.index + m[0].length,
      headerEnd: m.index + m[0].length,
    });
  }

  // Find end of each block (next ### heading that is ISSUE/CROSS/RESPONSE or VERDICT or Overall Assessment)
  const blocks = [];
  for (let i = 0; i < blockPositions.length; i++) {
    const start = blockPositions[i].startContent;
    // Find next ### heading
    const remaining = md.slice(start);
    const nextHeadingMatch = remaining.search(/^### /m);
    const end = nextHeadingMatch >= 0 ? start + nextHeadingMatch : md.length;
    const blockContent = md.slice(start, end);

    const fields = parseFields(blockContent);
    const block = {
      id: blockPositions[i].id,
      prefix: blockPositions[i].prefix,
      title: blockPositions[i].title,
    };

    // Step 3: Extract fields per variant
    // Common fields for all block-based formats
    const fieldMapping = {
      "review": ["category", "severity", "location", "problem", "evidence", "why it matters", "suggested fix", "plan section", "file"],
      "security-review": ["category", "severity", "location", "problem", "evidence", "suggested fix", "cwe", "owasp", "attack vector", "confidence", "file"],
      "commit-pr-review": ["category", "severity", "problem", "evidence", "suggested fix", "commit", "why it matters", "file"],
      "codebase-cross": ["category", "severity", "problem", "evidence", "suggested fix", "modules affected"],
      "codebase-validation": ["action", "reason", "revised finding", "counter-evidence", "maintained assessment"],
    };

    const expectedFields = fieldMapping[format] || [];
    for (const [key, value] of fields) {
      // Normalize field name: "why it matters" → "why_it_matters"
      const normalized = key.replace(/\s+/g, "_").replace(/[^a-z0-9_()]/g, "");
      if (expectedFields.some(f => f.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") === normalized || key === f)) {
        block[normalized] = value;
      } else {
        // Unknown field → extra
        if (!block.extra) block.extra = {};
        block.extra[key] = value;
      }
    }

    if (!block.extra) block.extra = {};
    blocks.push(block);
  }

  const result = {
    format,
    blocks,
    verdict: parseVerdict(md),
    overall_assessment: hasOverallAssessment ? parseOverallAssessment(md) : null,
    raw_markdown: md,
  };

  return result;
}

// ============================================================
// JSONL parsing — v13 (structured JSON output)
// ============================================================

function parseJsonlV13(stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state) {
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

  // Parse NEW lines for activities (structured)
  const activities = [];
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
      activities.push({ time: elapsed, type: "thinking", detail: "started new turn" });
    } else if (t === "item.completed" && itemType === "reasoning") {
      let text = item.text || "";
      if (text.length > 150) text = text.slice(0, 150) + "...";
      activities.push({ time: elapsed, type: "thinking", detail: text });
    } else if (t === "item.started" && itemType === "command_execution") {
      activities.push({ time: elapsed, type: "command_started", detail: item.command || "" });
    } else if (t === "item.completed" && itemType === "command_execution") {
      activities.push({ time: elapsed, type: "command_completed", detail: item.command || "" });
    } else if (t === "item.completed" && itemType === "file_change") {
      for (const c of (item.changes || [])) {
        activities.push({ time: elapsed, type: "file_change", detail: `${c.path || "?"} (${c.kind || "?"})` });
      }
    }
  }

  function sanitizeMsg(s) {
    if (s == null) return "unknown error";
    return String(s).replace(/\s+/g, " ").trim();
  }

  // Determine status and build JSON result
  const currentRound = state.round || 1;

  if (turnCompleted) {
    if (!extractedThreadId || !reviewText) {
      const errorDetail = !extractedThreadId ? "no thread_id" : "no agent_message";
      return {
        json: { status: "failed", round: currentRound, elapsed_seconds: elapsed, exit_code: EXIT_TURN_FAILED, error: `turn.completed but ${errorDetail}`, review: null, activities },
        extractedThreadId,
        reviewText: "",
        terminal: true,
      };
    }

    // Write review.md
    atomicWrite(path.join(stateDir, "review.md"), reviewText);

    // Parse the review
    const skillName = state.skill_name || "";
    const review = parseOutputMarkdown(reviewText, skillName);

    return {
      json: { status: "completed", round: currentRound, elapsed_seconds: elapsed, thread_id: extractedThreadId, review, activities },
      extractedThreadId,
      reviewText,
      terminal: true,
    };
  } else if (turnFailed) {
    return {
      json: { status: "failed", round: currentRound, elapsed_seconds: elapsed, exit_code: EXIT_TURN_FAILED, error: `Codex turn failed: ${sanitizeMsg(turnFailedMsg)}`, review: null, activities },
      extractedThreadId,
      reviewText: "",
      terminal: true,
    };
  } else if (!processAlive) {
    if (timeoutVal > 0 && elapsed >= timeoutVal) {
      return {
        json: { status: "timeout", round: currentRound, elapsed_seconds: elapsed, exit_code: EXIT_TIMEOUT, error: `Timeout after ${timeoutVal}s`, review: null, activities },
        extractedThreadId,
        reviewText: "",
        terminal: true,
      };
    } else {
      let errContent = "";
      if (fs.existsSync(errFile)) {
        errContent = fs.readFileSync(errFile, "utf8").trim();
      }
      let errorMsg = "Codex process exited unexpectedly";
      if (errContent) {
        errorMsg += ": " + sanitizeMsg(errContent.slice(0, 200));
      }
      return {
        json: { status: "failed", round: currentRound, elapsed_seconds: elapsed, exit_code: EXIT_ERROR, error: errorMsg, review: null, activities },
        extractedThreadId,
        reviewText: "",
        terminal: true,
      };
    }
  } else {
    return {
      json: { status: "running", round: currentRound, elapsed_seconds: elapsed, activities },
      extractedThreadId,
      reviewText,
      terminal: false,
    };
  }
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
    const sid = s.session_id || "";
    if (!sid) {
      return { dir: null, err: "state.json missing session_id" };
    }
    const expected = path.join(wd, ".codex-review", "sessions", sid);
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
// Template engine — cmdRender
// ============================================================

/** Template name → heading mapping per skill */
const TEMPLATE_MAP = {
  "codex-plan-review": {
    "round1": "Plan Review Prompt (Round 1)",
    "rebuttal": "Rebuttal Prompt (Round 2+)",
  },
  "codex-impl-review": {
    "working-tree-round1": "Working Tree Review Prompt (Round 1)",
    "branch-round1": "Branch Review Prompt (Round 1)",
    "rebuttal-working-tree": "Rebuttal Prompt — Working-tree mode (Round 2+)",
    "rebuttal-branch": "Rebuttal Prompt — Branch mode (Round 2+)",
  },
  "codex-think-about": {
    "round1": "Round 1 Prompt",
    "claude-analysis": "Claude Independent Analysis Prompt",
    "round2+": "Round 2+ Response Prompt",
  },
  "codex-commit-review": {
    "staged-round1": "Staged Review Prompt (Round 1)",
    "last-round1": "Last Review Prompt (Round 1)",
    "claude-staged": "Claude Independent Analysis Prompt — Staged mode",
    "claude-last": "Claude Independent Analysis Prompt — Last mode",
    "staged-round2+": "Response Prompt — Staged mode (Round 2+)",
    "last-round2+": "Response Prompt — Last mode (Round 2+)",
  },
  "codex-pr-review": {
    "round1": "PR Review Prompt (Round 1)",
    "claude-analysis": "Claude Independent Analysis Prompt",
    "round2+": "Response Prompt (Round 2+)",
  },
  "codex-parallel-review": {
    "full-round1": "Full Codebase Review Prompt (Phase 1)",
    "working-tree-round1": "Working Tree Review Prompt (Phase 1)",
    "branch-round1": "Branch Review Prompt (Phase 1)",
    "debate": "Debate Prompt (Phase 3)",
  },
  "codex-codebase-review": {
    "chunk-review": "Chunk Review Prompt",
    "validation": "Validation Prompt",
  },
  "codex-security-review": {
    "round1": "Security Review Prompt (Round 1)",
    "working-tree": "Security Review Prompt - Working Tree Mode",
    "branch": "Security Review Prompt - Branch Mode",
    "full": "Security Review Prompt - Full Codebase Mode",
    "round2+": "Round 2+ Prompt (Resume)",
  },
};

/**
 * Extract a template section from prompts.md by heading.
 * Returns the content of the fenced code block within the section,
 * or the full section content if no fenced block found.
 */
function extractTemplateSection(promptsMd, targetHeading) {
  // Split by ## headings — but must be fence-aware to skip ## headings
  // that appear inside fenced code blocks (prompt templates often contain
  // ## headings as part of the prompt text).
  const lines = promptsMd.split("\n");
  let inTargetSection = false;
  let sectionLines = [];
  let found = false;
  let inFence = false;

  for (const line of lines) {
    // Track fenced code block boundaries
    if (line.trimEnd().match(/^```/)) {
      if (inTargetSection) {
        sectionLines.push(line);
        inFence = !inFence;
        continue;
      }
      inFence = !inFence;
    }

    // Only recognize ## headings when NOT inside a fenced block
    if (!inFence) {
      const headingMatch = line.match(/^## (.+)$/);
      if (headingMatch) {
        if (inTargetSection) {
          // We've left the target section
          break;
        }
        if (headingMatch[1].trim() === targetHeading) {
          inTargetSection = true;
          found = true;
          continue;
        }
      }
    }
    if (inTargetSection) {
      sectionLines.push(line);
    }
  }

  if (!found) return null;

  const sectionContent = sectionLines.join("\n");

  // Try to extract fenced code block
  const fenceRegex = /```[^\n]*\n([\s\S]*?)```/;
  const fenceMatch = sectionContent.match(fenceRegex);
  if (fenceMatch) {
    return fenceMatch[1];
  }

  // No fenced block found — use section content
  return sectionContent.trim();
}

/**
 * Parse the Placeholder Injection Guide table from prompts.md.
 * Returns Map of placeholder name (uppercase) → { required: boolean, default: string|null }
 */
function parsePlaceholderGuide(promptsMd) {
  const guide = new Map();

  // Find the Placeholder Injection Guide section
  const guideMatch = promptsMd.match(/## Placeholder Injection Guide\s*\n([\s\S]*?)(?=\n## |\n---|\n### [^P]|$)/);
  if (!guideMatch) return guide;

  // Parse table rows
  const tableContent = guideMatch[1];
  const rows = tableContent.split("\n").filter(line =>
    line.includes("|") && line.includes("`{") && !line.match(/^\|?\s*[-|]+\s*\|?$/)
  );

  for (const row of rows) {
    const cells = row.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length >= 4) {
      // cells[0] = `{PLACEHOLDER}`, cells[1] = Source, cells[2] = Required, cells[3] = Default
      const nameMatch = cells[0].match(/`\{([A-Z_]+)\}`/);
      if (nameMatch) {
        const name = nameMatch[1];
        const required = cells[2].toLowerCase().includes("yes");
        const defaultVal = cells[3] === "—" || cells[3] === "-" ? null : cells[3].replace(/^`|`$/g, "").trim() || null;
        guide.set(name, { required, default: defaultVal });
      }
    }
  }

  return guide;
}

function cmdRender(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      skill: { type: "string" },
      template: { type: "string" },
      "skills-dir": { type: "string" },
    },
    strict: true,
  });

  const skill = values.skill;
  const templateName = values.template;
  const skillsDir = values["skills-dir"];

  if (!skill || !templateName || !skillsDir) {
    process.stderr.write("Error: --skill, --template, and --skills-dir are required\n");
    return EXIT_ERROR;
  }

  // Validate skill has templates
  const skillTemplates = TEMPLATE_MAP[skill];
  if (!skillTemplates) {
    jsonError(`Unknown skill: ${skill}`, "UNKNOWN_SKILL");
    return EXIT_ERROR;
  }

  const targetHeading = skillTemplates[templateName];
  if (!targetHeading) {
    jsonError(`Template '${templateName}' not found for skill '${skill}'. Available: ${Object.keys(skillTemplates).join(", ")}`, "TEMPLATE_NOT_FOUND");
    return EXIT_ERROR;
  }

  // Read prompts.md
  const promptsPath = path.join(skillsDir, skill, "references", "prompts.md");
  let promptsMd;
  try {
    promptsMd = fs.readFileSync(promptsPath, "utf8");
  } catch (e) {
    jsonError(`Cannot read prompts.md: ${e.message}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Extract template
  const template = extractTemplateSection(promptsMd, targetHeading);
  if (template === null) {
    jsonError(`Template heading '${targetHeading}' not found in prompts.md`, "TEMPLATE_NOT_FOUND");
    return EXIT_ERROR;
  }

  // Read placeholders from stdin JSON
  let placeholders = {};
  const stdinContent = readStdinSync().trim();
  if (stdinContent) {
    try {
      placeholders = JSON.parse(stdinContent);
    } catch (e) {
      jsonError(`Invalid JSON on stdin: ${e.message}`, "INVALID_INPUT");
      return EXIT_ERROR;
    }
  }

  // Auto-inject {OUTPUT_FORMAT}
  const outputFormatPath = path.join(skillsDir, skill, "references", "output-format.md");
  if (fs.existsSync(outputFormatPath) && !placeholders.OUTPUT_FORMAT) {
    const outputFormatMd = fs.readFileSync(outputFormatPath, "utf8");
    // Extract the fenced code block after "Use this exact shape"
    const fenceMatch = outputFormatMd.match(/```(?:markdown)?\n([\s\S]*?)```/);
    placeholders.OUTPUT_FORMAT = fenceMatch ? fenceMatch[1].trim() : outputFormatMd.trim();
  }

  // Auto-inject {CLAUDE_ANALYSIS_FORMAT}
  const claudeAnalysisPath = path.join(skillsDir, skill, "references", "claude-analysis-template.md");
  if (fs.existsSync(claudeAnalysisPath) && !placeholders.CLAUDE_ANALYSIS_FORMAT) {
    const claudeAnalysisMd = fs.readFileSync(claudeAnalysisPath, "utf8");
    const fenceMatch = claudeAnalysisMd.match(/```(?:markdown)?\n([\s\S]*?)```/);
    placeholders.CLAUDE_ANALYSIS_FORMAT = fenceMatch ? fenceMatch[1].trim() : claudeAnalysisMd.trim();
  }

  // Parse placeholder guide for defaults and required fields
  const guide = parsePlaceholderGuide(promptsMd);

  // Replace all {PLACEHOLDER} patterns
  // Require min 2 chars to avoid matching {N} in "ISSUE-{N}" format strings.
  // All real placeholders have underscores (e.g. {USER_REQUEST}, {OUTPUT_FORMAT}).
  let rendered = template;
  const placeholderRegex = /\{([A-Z][A-Z_0-9]{1,})\}/g;
  const missingRequired = [];

  rendered = rendered.replace(placeholderRegex, (match, name) => {
    // Check stdin JSON first
    if (placeholders[name] !== undefined && placeholders[name] !== null) {
      return String(placeholders[name]);
    }

    // Check guide defaults
    const guideEntry = guide.get(name);
    if (guideEntry && guideEntry.default !== null) {
      return guideEntry.default;
    }

    // Check if required
    if (guideEntry && guideEntry.required) {
      missingRequired.push(name);
      return match; // Leave as-is for error reporting
    }

    // Not required, no default → empty string
    return "";
  });

  if (missingRequired.length > 0) {
    jsonError(`Missing required placeholder(s): ${missingRequired.map(n => `{${n}}`).join(", ")}`, "MISSING_PLACEHOLDER");
    return EXIT_ERROR;
  }

  // Validation: warn about remaining unresolved placeholders on stderr
  const remaining = rendered.match(/\{[A-Z][A-Z_0-9]{1,}\}/g);
  if (remaining) {
    process.stderr.write(`Warning: unresolved placeholders in rendered prompt: ${remaining.join(", ")}\n`);
  }

  // Output rendered prompt as plain text
  process.stdout.write(rendered);
  return EXIT_SUCCESS;
}

// ============================================================
// Subcommands — v13
// ============================================================

function cmdInit(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "skill-name": { type: "string" },
      "working-dir": { type: "string" },
    },
    strict: true,
  });

  const skillName = values["skill-name"];
  const workingDir = values["working-dir"];

  if (!skillName) {
    process.stderr.write("Error: --skill-name is required\n");
    return EXIT_ERROR;
  }
  if (!workingDir) {
    process.stderr.write("Error: --working-dir is required\n");
    return EXIT_ERROR;
  }

  let resolvedWorkingDir;
  try {
    resolvedWorkingDir = fs.realpathSync(workingDir);
  } catch {
    process.stderr.write(`Error: working directory does not exist: ${workingDir}\n`);
    return EXIT_ERROR;
  }

  // Generate session ID: {skill}-{yyyymmdd}-{NNN}
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${skillName}-${today}-`;
  const sessionsBase = path.join(resolvedWorkingDir, ".codex-review", "sessions");
  fs.mkdirSync(sessionsBase, { recursive: true });

  let maxN = 0;
  try {
    for (const d of fs.readdirSync(sessionsBase)) {
      if (d.startsWith(prefix)) {
        const n = parseInt(d.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
  } catch {}

  // Atomic session dir creation — retry on EEXIST (parallel init race)
  let sessionDir;
  let sessionId;
  let created = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    sessionId = `${prefix}${String(maxN + 1 + attempt).padStart(3, "0")}`;
    sessionDir = path.join(sessionsBase, sessionId);
    try {
      fs.mkdirSync(sessionDir);
      created = true;
      break;
    } catch (e) {
      if (e.code === "EEXIST") continue;
      throw e;
    }
  }

  if (!created) {
    process.stderr.write("Error: could not reserve session directory after 10 attempts\n");
    return EXIT_ERROR;
  }

  // Create subdirectories
  fs.mkdirSync(path.join(sessionDir, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, "outputs"), { recursive: true });

  // Write initial state.json
  const now = Math.floor(Date.now() / 1000);
  const initialState = {
    session_id: sessionId,
    runner_version: CODEX_RUNNER_VERSION,
    skill_name: skillName,
    state_dir: sessionDir,
    working_dir: resolvedWorkingDir,
    round: 0,
    created_at: now,
    pid: null,
    pgid: null,
    watchdog_pid: null,
    effort: null,
    sandbox: null,
    timeout: null,
    started_at: null,
    thread_id: null,
    last_line_count: 0,
    stall_count: 0,
    last_poll_at: null,
  };
  atomicWrite(path.join(sessionDir, "state.json"), JSON.stringify(initialState, null, 2));

  // Output plain text (unchanged from v12)
  process.stdout.write(`CODEX_SESSION:${sessionDir}\n`);
  return EXIT_SUCCESS;
}

function cmdStart(argv) {
  const sessionDir = argv[0];
  if (!sessionDir) {
    jsonError("Session directory argument required", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      effort: { type: "string", default: "high" },
      timeout: { type: "string", default: "3600" },
      sandbox: { type: "string", default: "read-only" },
      "stall-threshold": { type: "string", default: "" },
    },
    strict: true,
  });

  const effort = values.effort || "high";
  const timeout = parseInt(values.timeout || "3600", 10);
  const sandbox = values.sandbox || "read-only";
  const stallThreshold = parseInt(values["stall-threshold"] || "12", 10);

  if (isNaN(stallThreshold) || stallThreshold < 1) {
    jsonError("--stall-threshold must be a positive integer (>= 1)", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const VALID_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];
  if (!VALID_SANDBOXES.includes(sandbox)) {
    jsonError(`--sandbox must be one of: ${VALID_SANDBOXES.join(", ")}`, "INVALID_INPUT");
    return EXIT_ERROR;
  }

  // Validate session dir exists
  let resolvedSessionDir;
  try {
    resolvedSessionDir = fs.realpathSync(sessionDir);
  } catch {
    jsonError(`Session directory does not exist: ${sessionDir}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read state.json — must exist with round == 0
  let state;
  try {
    state = readState(resolvedSessionDir);
  } catch (e) {
    jsonError(`Cannot read state.json: ${e.message}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  if (state.round !== 0) {
    jsonError("Session already started (round != 0). Use resume for subsequent rounds.", "PRECONDITION_FAILED");
    return EXIT_ERROR;
  }

  const resolvedWorkingDir = state.working_dir || path.resolve(resolvedSessionDir, "..", "..", "..");
  const sessionId = state.session_id || path.basename(resolvedSessionDir);
  const skillName = state.skill_name || "";

  // Check codex in PATH
  const whichCmd = IS_WIN ? "where" : "which";
  const probe = spawnSync(whichCmd, ["codex"], { encoding: "utf8" });
  if (probe.status !== 0) {
    jsonError("codex CLI not found in PATH", "CODEX_NOT_FOUND");
    return EXIT_CODEX_NOT_FOUND;
  }

  // Read prompt from stdin, write to prompt.txt + prompts/round-001.txt
  const promptFile = path.join(resolvedSessionDir, "prompt.txt");
  let prompt;

  // v13: prefer stdin (piped from render), fallback to pre-written prompt.txt
  const stdinContent = readStdinSync();
  if (stdinContent.trim()) {
    prompt = stdinContent;
    fs.writeFileSync(promptFile, prompt, "utf8");
  } else if (fs.existsSync(promptFile)) {
    const fileContent = fs.readFileSync(promptFile, "utf8");
    if (fileContent.trim()) prompt = fileContent;
  }

  if (!prompt || !prompt.trim()) {
    jsonError("No prompt provided (pipe via stdin or pre-write prompt.txt)", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  // Archive prompt
  fs.writeFileSync(path.join(resolvedSessionDir, "prompts", "round-001.txt"), prompt, "utf8");

  // Track for rollback
  let codexPgid = null;
  let watchdogPid = null;

  function startupCleanup() {
    if (codexPgid !== null) killTree(codexPgid);
    if (watchdogPid !== null && isAlive(watchdogPid)) killSingle(watchdogPid);
  }

  try {
    const { pid: codexPid, pgid } = launchCodex(
      resolvedSessionDir, resolvedWorkingDir, timeout, "", effort, sandbox,
    );
    codexPgid = pgid;

    watchdogPid = launchWatchdog(timeout, codexPgid);

    // Update state.json
    const now = Math.floor(Date.now() / 1000);
    updateState(resolvedSessionDir, {
      round: 1,
      pid: codexPid,
      pgid: codexPgid,
      watchdog_pid: watchdogPid,
      effort,
      sandbox,
      timeout,
      started_at: now,
      thread_id: null,
      last_line_count: 0,
      stall_count: 0,
      last_poll_at: 0,
      stall_threshold: stallThreshold,
      stall_recovery_count: 0,
    });

    // Create rounds.json
    writeRounds(resolvedSessionDir, [{
      round: 1,
      started_at: now,
      completed_at: null,
      elapsed_seconds: null,
      status: "running",
      verdict: null,
      issues_found: null,
    }]);

  } catch (e) {
    startupCleanup();

    // Mark round as start_failed if rounds.json was created
    try {
      const rounds = readRounds(resolvedSessionDir);
      if (rounds.length > 0 && rounds[rounds.length - 1].status === "running") {
        rounds[rounds.length - 1].status = "start_failed";
        rounds[rounds.length - 1].completed_at = Math.floor(Date.now() / 1000);
        writeRounds(resolvedSessionDir, rounds);
      }
    } catch {}

    jsonError(e.message, "LAUNCH_FAILED");
    return EXIT_ERROR;
  }

  // Success — JSON output
  jsonOut({ status: "started", session_dir: resolvedSessionDir, round: 1 });
  return EXIT_SUCCESS;
}

function cmdResume(argv) {
  const sessionDir = argv[0];
  if (!sessionDir) {
    jsonError("Session directory argument required", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      effort: { type: "string", default: "high" },
      timeout: { type: "string", default: "3600" },
      "stall-threshold": { type: "string", default: "" },
      recovery: { type: "boolean", default: false },
    },
    strict: true,
  });

  const effort = values.effort || "high";
  const timeout = parseInt(values.timeout || "3600", 10);

  let resolvedSessionDir;
  try {
    resolvedSessionDir = fs.realpathSync(sessionDir);
  } catch {
    jsonError(`Session directory does not exist: ${sessionDir}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read state
  let prevState;
  try {
    prevState = readState(resolvedSessionDir);
  } catch (e) {
    jsonError(`Cannot read state.json: ${e.message}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  const explicitThreshold = values["stall-threshold"];
  const stallThreshold = explicitThreshold ? parseInt(explicitThreshold, 10) : (prevState.stall_threshold || 12);

  if (isNaN(stallThreshold) || stallThreshold < 1) {
    jsonError("--stall-threshold must be a positive integer (>= 1)", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const recoveryCount = prevState.stall_recovery_count || 0;
  const isRecovery = values.recovery;
  const newRecoveryCount = isRecovery ? recoveryCount + 1 : recoveryCount;
  const effectiveStallThreshold = isRecovery ? Math.min(stallThreshold, 8) : stallThreshold;

  const threadId = prevState.thread_id || "";
  const resolvedWorkingDir = prevState.working_dir || "";
  const sessionId = prevState.session_id || path.basename(resolvedSessionDir);
  const currentRound = prevState.round || 0;

  if (!threadId) {
    jsonError("No thread_id found in state.json — cannot resume (session may have failed on start)", "SESSION_BROKEN");
    return EXIT_ERROR;
  }

  if (!resolvedWorkingDir) {
    jsonError("No working_dir found in state.json", "IO_ERROR");
    return EXIT_ERROR;
  }

  // Check rounds.json — last round must NOT be "running"
  const rounds = readRounds(resolvedSessionDir);
  if (rounds.length > 0) {
    const lastRound = rounds[rounds.length - 1];
    if (lastRound.status === "running") {
      jsonError("Round still running — poll first before resuming", "ROUND_STILL_RUNNING");
      return EXIT_ERROR;
    }
    if (lastRound.status === "start_failed") {
      jsonError("Session broken — previous round failed to start (no thread_id)", "SESSION_BROKEN");
      return EXIT_ERROR;
    }
  }

  // Check codex in PATH
  const whichCmd = IS_WIN ? "where" : "which";
  const probe = spawnSync(whichCmd, ["codex"], { encoding: "utf8" });
  if (probe.status !== 0) {
    jsonError("codex CLI not found in PATH", "CODEX_NOT_FOUND");
    return EXIT_CODEX_NOT_FOUND;
  }

  // Read prompt from stdin
  const promptFile = path.join(resolvedSessionDir, "prompt.txt");
  let prompt;
  const stdinContent = readStdinSync();
  if (stdinContent.trim()) {
    prompt = stdinContent;
    fs.writeFileSync(promptFile, prompt, "utf8");
  } else if (fs.existsSync(promptFile)) {
    const fileContent = fs.readFileSync(promptFile, "utf8");
    if (fileContent.trim()) prompt = fileContent;
  }

  if (!prompt || !prompt.trim()) {
    jsonError("No prompt provided (pipe via stdin or pre-write prompt.txt)", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const newRound = currentRound + 1;

  // Archive prompt
  fs.writeFileSync(
    path.join(resolvedSessionDir, "prompts", `round-${String(newRound).padStart(3, "0")}.txt`),
    prompt, "utf8",
  );

  // Archive current output.jsonl → outputs/
  const jsonlFile = path.join(resolvedSessionDir, "output.jsonl");
  if (fs.existsSync(jsonlFile)) {
    const archivePath = path.join(
      resolvedSessionDir, "outputs",
      `output-round-${String(currentRound).padStart(3, "0")}.jsonl`,
    );
    try {
      fs.copyFileSync(jsonlFile, archivePath);
    } catch {}
  }

  // Clear stale artifacts
  try { fs.unlinkSync(path.join(resolvedSessionDir, "final.txt")); } catch {}
  try { fs.unlinkSync(path.join(resolvedSessionDir, "review.md")); } catch {}

  // Track for rollback
  let codexPgid = null;
  let watchdogPid = null;

  function startupCleanup() {
    if (codexPgid !== null) killTree(codexPgid);
    if (watchdogPid !== null && isAlive(watchdogPid)) killSingle(watchdogPid);
  }

  try {
    const { pid: codexPid, pgid } = launchCodex(
      resolvedSessionDir, resolvedWorkingDir, timeout, threadId, effort,
    );
    codexPgid = pgid;

    watchdogPid = launchWatchdog(timeout, codexPgid);

    // Update state.json
    const now = Math.floor(Date.now() / 1000);
    updateState(resolvedSessionDir, {
      round: newRound,
      pid: codexPid,
      pgid: codexPgid,
      watchdog_pid: watchdogPid,
      effort,
      timeout,
      started_at: now,
      thread_id: threadId,
      last_line_count: 0,
      stall_count: 0,
      last_poll_at: 0,
      last_output_at: now,
      stall_recovery_count: newRecoveryCount,
      stall_threshold: effectiveStallThreshold,
    });

    // Append new round to rounds.json
    rounds.push({
      round: newRound,
      started_at: now,
      completed_at: null,
      elapsed_seconds: null,
      status: "running",
      verdict: null,
      issues_found: null,
    });
    writeRounds(resolvedSessionDir, rounds);

  } catch (e) {
    startupCleanup();
    jsonError(e.message, "LAUNCH_FAILED");
    return EXIT_ERROR;
  }

  // Success
  jsonOut({ status: "started", session_dir: resolvedSessionDir, round: newRound, thread_id: threadId });
  return EXIT_SUCCESS;
}

function cmdPoll(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    jsonError("Invalid or missing state directory", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  // Parse --min-interval flag (default 120s)
  let minInterval = 120;
  const filteredArgv = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--min-interval" && i + 1 < argv.length) {
      minInterval = parseInt(argv[++i], 10);
      if (isNaN(minInterval) || minInterval < 0) minInterval = 120;
    } else {
      filteredArgv.push(argv[i]);
    }
  }

  const { dir: stateDir, err } = validateStateDir(filteredArgv[0] || stateDirArg);
  if (err) {
    jsonError(err, "INVALID_INPUT");
    return EXIT_ERROR;
  }

  // Check for cached final result
  const finalFile = path.join(stateDir, "final.txt");
  if (fs.existsSync(finalFile)) {
    const cached = fs.readFileSync(finalFile, "utf8");
    process.stdout.write(cached);
    if (!cached.endsWith("\n")) process.stdout.write("\n");
    return EXIT_SUCCESS;
  }

  // Throttle: wait until min-interval elapsed OR process completes
  if (minInterval > 0) {
    const stateFile = path.join(stateDir, "state.json");
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const lastPoll = s.last_poll_at || 0;
      const now = Math.floor(Date.now() / 1000);
      const remaining = minInterval - (now - lastPoll);
      if (remaining > 0 && lastPoll > 0) {
        // Sleep in 2s increments, check for completion each iteration
        let waited = 0;
        while (waited < remaining) {
          const chunk = Math.min(2000, (remaining - waited) * 1000);
          syncSleep(chunk);
          waited += chunk / 1000;
          // Early exit if process completed (final.txt appeared)
          if (fs.existsSync(finalFile)) {
            const cached = fs.readFileSync(finalFile, "utf8");
            process.stdout.write(cached);
            if (!cached.endsWith("\n")) process.stdout.write("\n");
            return EXIT_SUCCESS;
          }
        }
      }
    } catch {
      // state.json unreadable — proceed without throttle
    }
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
  const stallThresholdFromState = state.stall_threshold || 12;

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - startedAt;

  const processAlive = isAlive(codexPid);

  // Count lines for stall detection
  const jsonlFile = path.join(stateDir, "output.jsonl");
  let currentLineCount = 0;
  if (fs.existsSync(jsonlFile)) {
    const content = fs.readFileSync(jsonlFile, "utf8");
    currentLineCount = content.split("\n").filter((l) => l.trim()).length;
  }

  const newStallCount = currentLineCount === lastLineCount
    ? stallCount + 1
    : 0;

  // Track when output last changed for accurate stall duration
  const lastOutputAt = currentLineCount === lastLineCount
    ? (state.last_output_at || startedAt)
    : now;

  // Parse JSONL → structured JSON
  let result = parseJsonlV13(stateDir, lastLineCount, elapsed, processAlive, timeoutVal, state);

  // Override: stall/timeout detection for still-running process
  if (!result.terminal) {
    if (elapsed >= timeoutVal) {
      // Recover partial output if available
      let partialReview = null;
      if (result.reviewText) {
        const skillName = state.skill_name || "";
        partialReview = parseOutputMarkdown(result.reviewText, skillName);
        atomicWrite(path.join(stateDir, "review.md"), result.reviewText);
      }

      result = {
        json: { status: "timeout", round: state.round || 1, elapsed_seconds: elapsed, exit_code: EXIT_TIMEOUT, error: `Timeout after ${timeoutVal}s`, review: partialReview, activities: result.json.activities },
        extractedThreadId: result.extractedThreadId,
        reviewText: result.reviewText,
        terminal: true,
      };
    } else if (newStallCount >= stallThresholdFromState && processAlive) {
      // Recover partial output if available
      let partialReview = null;
      if (result.reviewText) {
        const skillName = state.skill_name || "";
        partialReview = parseOutputMarkdown(result.reviewText, skillName);
        atomicWrite(path.join(stateDir, "review.md"), result.reviewText);
      }

      result = {
        json: {
          status: "stalled",
          round: state.round || 1,
          elapsed_seconds: elapsed,
          exit_code: EXIT_STALLED,
          error: `No new output for ~${Math.round((now - lastOutputAt) / 60)} minutes`,
          review: partialReview,
          recoverable: !!result.extractedThreadId && (state.stall_recovery_count || 0) < 1,
          activities: result.json.activities,
        },
        extractedThreadId: result.extractedThreadId,
        reviewText: result.reviewText || "",
        terminal: true,
      };
    }
  }

  // Crash recovery: if round is running but process dead and no turn.completed
  if (!result.terminal && !processAlive) {
    const rounds = readRounds(stateDir);
    const currentRoundObj = rounds.length > 0 ? rounds[rounds.length - 1] : null;
    if (currentRoundObj && currentRoundObj.status === "running") {
      currentRoundObj.status = "failed";
      currentRoundObj.completed_at = state.last_poll_at || now;
      currentRoundObj.elapsed_seconds = (currentRoundObj.completed_at || now) - currentRoundObj.started_at;
      writeRounds(stateDir, rounds);
    }
  }

  if (result.terminal) {
    // Update rounds.json FIRST (before caching) so convergence can be computed
    const rounds = readRounds(stateDir);
    if (rounds.length > 0) {
      const currentRoundObj = rounds[rounds.length - 1];
      if (currentRoundObj.status === "running") {
        currentRoundObj.status = result.json.status; // completed/failed/timeout/stalled
        currentRoundObj.completed_at = now;
        currentRoundObj.elapsed_seconds = now - currentRoundObj.started_at;

        // Extract verdict, issues_found, and issue_ids from parsed review
        if (result.json.review) {
          const review = result.json.review;
          if (review.verdict && review.verdict.status) {
            currentRoundObj.verdict = review.verdict.status;
          }
          if (review.blocks) {
            currentRoundObj.issues_found = review.blocks.length;
            // Store issue IDs for convergence detection
            currentRoundObj.issue_ids = review.blocks
              .filter(b => b.prefix === "ISSUE")
              .map(b => b.id)
              .sort((a, b) => a - b);
          }
          if (review.suggested_status) {
            currentRoundObj.verdict = review.suggested_status;
          }
        }

        writeRounds(stateDir, rounds);

        // Convergence / stalemate detection
        if (result.json.status === "completed" && rounds.length >= 2) {
          const prevRound = rounds[rounds.length - 2];
          if (prevRound.issue_ids && currentRoundObj.issue_ids) {
            const prevIds = prevRound.issue_ids;
            const currIds = currentRoundObj.issue_ids;

            // Guard: skip stalemate detection when no ISSUE blocks tracked
            // (e.g. think-about format, RESPONSE-only rounds in round 2+)
            if (currIds.length === 0 && prevIds.length === 0) {
              result.json.convergence = {
                stalemate: false,
                reason: "no_issue_blocks_tracked",
              };
            } else {
              const prevSet = new Set(prevIds);
              const currSet = new Set(currIds);
              const newIssues = currIds.filter(id => !prevSet.has(id));
              const resolvedIssues = prevIds.filter(id => !currSet.has(id));
              const sameSet = prevIds.length === currIds.length
                && prevIds.every(id => currSet.has(id));

              if (sameSet && newIssues.length === 0) {
                result.json.convergence = {
                  stalemate: true,
                  reason: `Same ${currIds.length} open issue(s) for 2 consecutive rounds, no new issues`,
                  unchanged_issue_ids: currIds,
                };
              } else {
                result.json.convergence = {
                  stalemate: false,
                  new_issues: newIssues,
                  resolved_issues: resolvedIssues,
                };
              }
            }
          }
        }
      }
    }

    // Cache final JSON (after convergence is computed) and cleanup
    const jsonStr = JSON.stringify(result.json);
    atomicWrite(path.join(stateDir, "final.txt"), jsonStr);

    verifyAndKillCodex(codexPid, codexPgid);
    if (watchdogPid) verifyAndKillWatchdog(watchdogPid);
  }

  // Persist thread_id to state.json
  if (result.extractedThreadId) {
    updateState(stateDir, { thread_id: result.extractedThreadId });
  }

  // Update state.json
  updateState(stateDir, {
    last_line_count: currentLineCount,
    stall_count: newStallCount,
    last_output_at: lastOutputAt,
    last_poll_at: now,
  });

  jsonOut(result.json);
  return EXIT_SUCCESS;
}

function cmdStop(argv) {
  const stateDirArg = argv[0];
  if (!stateDirArg) {
    jsonError("State directory argument required", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  const { dir: stateDir, err } = validateStateDir(stateDirArg);
  if (err) {
    jsonError(err, "INVALID_INPUT");
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

    // Update running round to "stopped"
    const rounds = readRounds(stateDir);
    const now = Math.floor(Date.now() / 1000);
    let modified = false;
    for (const round of rounds) {
      if (round.status === "running") {
        round.status = "stopped";
        round.completed_at = now;
        round.elapsed_seconds = now - round.started_at;
        modified = true;
      }
    }
    if (modified) {
      writeRounds(stateDir, rounds);
    }
  } catch {
    // State may be corrupted, proceed to output
  }

  jsonOut({ status: "stopped", session_dir: stateDir });
  return EXIT_SUCCESS;
}

function cmdFinalize(argv) {
  const sessionDir = argv[0];
  if (!sessionDir) {
    jsonError("Session directory argument required", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  let resolvedSessionDir;
  try {
    resolvedSessionDir = fs.realpathSync(sessionDir);
  } catch {
    jsonError(`Session directory does not exist: ${sessionDir}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read state
  let state;
  try {
    state = readState(resolvedSessionDir);
  } catch (e) {
    jsonError(`Cannot read state.json: ${e.message}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read rounds
  const rounds = readRounds(resolvedSessionDir);

  // Check precondition: no running rounds
  for (const round of rounds) {
    if (round.status === "running") {
      jsonError("Cannot finalize: round " + round.round + " is still running", "PRECONDITION_FAILED");
      return EXIT_ERROR;
    }
  }

  // Read override from stdin
  let overrides = {};
  const stdinContent = readStdinSync().trim();
  if (stdinContent) {
    try {
      overrides = JSON.parse(stdinContent);
    } catch (e) {
      jsonError(`Invalid JSON on stdin: ${e.message}`, "INVALID_INPUT");
      return EXIT_ERROR;
    }
  }

  // Compute timing
  const perRound = rounds.map(r => r.elapsed_seconds || 0);
  const totalSeconds = perRound.reduce((a, b) => a + b, 0);

  // Determine verdict
  let verdict = overrides.verdict;
  if (!verdict) {
    // Use last round's verdict
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].verdict) {
        verdict = rounds[i].verdict;
        break;
      }
    }
  }

  if (!verdict) {
    jsonError("No verdict available — provide via stdin or ensure at least one round has a verdict", "PRECONDITION_FAILED");
    return EXIT_ERROR;
  }

  // Build meta.json
  const meta = {
    skill: state.skill_name || "",
    runner_version: CODEX_RUNNER_VERSION,
    effort: state.effort || "high",
    sandbox: state.sandbox || "read-only",
    scope: overrides.scope || null,
    base_branch: overrides.base_branch || null,
    rounds: rounds.length,
    verdict,
    timing: {
      total_seconds: totalSeconds,
      per_round: perRound,
    },
    timestamp: new Date().toISOString(),
    session_dir: resolvedSessionDir,
  };

  // Add optional override fields
  if (overrides.custom_notes) meta.custom_notes = overrides.custom_notes;
  if (overrides.issues) meta.issues = overrides.issues;

  // Write meta.json
  atomicWrite(path.join(resolvedSessionDir, "meta.json"), JSON.stringify(meta, null, 2));

  jsonOut({ status: "finalized", meta });
  return EXIT_SUCCESS;
}

function cmdStatus(argv) {
  const sessionDir = argv[0];
  if (!sessionDir) {
    jsonError("Session directory argument required", "INVALID_INPUT");
    return EXIT_ERROR;
  }

  let resolvedSessionDir;
  try {
    resolvedSessionDir = fs.realpathSync(sessionDir);
  } catch {
    jsonError(`Session directory does not exist: ${sessionDir}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read state
  let state;
  try {
    state = readState(resolvedSessionDir);
  } catch (e) {
    jsonError(`Cannot read state.json: ${e.message}`, "IO_ERROR");
    return EXIT_ERROR;
  }

  // Read rounds (may not exist yet)
  const rounds = readRounds(resolvedSessionDir);

  // Check for review.md and meta.json
  const hasReview = fs.existsSync(path.join(resolvedSessionDir, "review.md"));
  const hasMeta = fs.existsSync(path.join(resolvedSessionDir, "meta.json"));

  const result = {
    status: "ok",
    session_id: state.session_id,
    skill: state.skill_name,
    runner_version: state.runner_version || CODEX_RUNNER_VERSION,
    round: state.round,
    effort: state.effort,
    sandbox: state.sandbox,
    thread_id: state.thread_id,
    created_at: state.created_at,
    rounds: rounds.map(r => ({
      round: r.round,
      started_at: r.started_at,
      completed_at: r.completed_at || null,
      elapsed_seconds: r.elapsed_seconds || null,
      status: r.status,
      verdict: r.verdict || null,
      issues_found: r.issues_found != null ? r.issues_found : null,
    })),
    has_review: hasReview,
    has_meta: hasMeta,
  };

  jsonOut(result);
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

  setTimeout(() => {
    killTree(targetPid);
    process.exit(EXIT_SUCCESS);
  }, timeoutS * 1000);

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
    case "init":
      exitCode = cmdInit(rest);
      break;
    case "start":
      exitCode = cmdStart(rest);
      break;
    case "resume":
      exitCode = cmdResume(rest);
      break;
    case "poll":
      exitCode = cmdPoll(rest);
      break;
    case "stop":
      exitCode = cmdStop(rest);
      break;
    case "finalize":
      exitCode = cmdFinalize(rest);
      break;
    case "status":
      exitCode = cmdStatus(rest);
      break;
    case "render":
      exitCode = cmdRender(rest);
      break;
    case "_watchdog":
      exitCode = cmdWatchdog(rest);
      break;
    default:
      process.stderr.write(
        "codex-runner.js — Cross-platform runner for Codex CLI (v13)\n\n" +
        "Usage:\n" +
        "  node codex-runner.js version\n" +
        "  node codex-runner.js init --skill-name <name> --working-dir <dir>\n" +
        "  echo PROMPT | node codex-runner.js start <session_dir> [--effort <level>] [--timeout <s>] [--sandbox <mode>]\n" +
        "  echo PROMPT | node codex-runner.js resume <session_dir> [--effort <level>] [--timeout <s>]\n" +
        "  node codex-runner.js poll <session_dir> [--min-interval <s>]\n" +
        "  node codex-runner.js stop <session_dir>\n" +
        "  echo JSON | node codex-runner.js finalize <session_dir>\n" +
        "  node codex-runner.js status <session_dir>\n" +
        "  echo JSON | node codex-runner.js render --skill <name> --template <name> --skills-dir <path>\n",
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
