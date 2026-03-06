# Edge Case Review — revenue-bot
**Files:** `otp-reader.js`, `linescript.js` (error handling), `webhook-server.js` (process mgmt)
**Scope:** Edge case analysis — 10 specific scenarios

---

## WEBHOOK SERVER (`webhook-server.js`)

### 1. Unhandled Express Errors — Global Error Middleware / Uncaught Exception Crash
**Status: ❌ Unhandled**
**Severity: HIGH**

No `app.use((err, req, res, next) => {...})` error middleware exists. No `process.on('uncaughtException')` or `process.on('unhandledRejection')` handlers.

The `/webhook` route handler is `async` but Express 4 does not automatically catch async errors — any unexpected `throw` inside the loop at line 160 will cause an unhandled promise rejection and silently swallow the error without responding to LINE.

The `/trigger/revrt` route at line 247 calls `res.json(...)` then runs `runScript` asynchronously after the response is sent — an uncaught exception here would crash the process with no recovery.

**Fix:**
```js
// After all routes
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (!res.headersSent) res.status(500).send('Internal error');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
```

---

### 2. Concurrent Requests — Parallel Script Executions, No Lock
**Status: ❌ Unhandled**
**Severity: HIGH**

`runScript()` (line 97) has no concurrency guard. Two simultaneous LINE messages with `revmtd` will each call `runScript(CONFIG.scripts.linescript)` independently, spawning two `node linescript.js` processes at the same time.

Both processes will write to the same Google Drive destination, potentially corrupting output or triggering duplicate uploads. The cache write at line 204 is not atomic — both processes may both miss the cache check and both proceed to run.

**Fix:**
```js
let isRunning = false;

async function runScriptGuarded(scriptPath) {
  if (isRunning) throw new Error('Script already running');
  isRunning = true;
  try {
    return await runScript(scriptPath);
  } finally {
    isRunning = false;
  }
}
```

---

### 3. LINE Multicast Invalid Recipient
**Status: ⚠️ Partial**
**Severity: MEDIUM**
**File: webhook-server.js, lines 79–94**

`pushToLine()` catches axios errors and logs them (line 91–93), so the server won't crash. However:

- No retry on failure — if LINE push fails (e.g., invalid `userId`, bot blocked), the user gets no notification at all and no indication of failure.
- The error is only logged to console, not surfaced to any monitoring.
- `event.source.userId` can be `undefined` for group/room events where source type is not `user` (LINE spec). Pushing to `undefined` will return a LINE API error silently swallowed at line 91.

**Fix:** Check `userId` is defined before pushing:
```js
if (!userId) { console.error('No userId in event source'); continue; }
```

---

### 4. Response Caching — Race Condition in Cache
**Status: ❌ Unhandled**
**Severity: MEDIUM**
**File: webhook-server.js, lines 187–212**

The cache check-then-write is not atomic:

1. Request A: `getCachedRevMTD()` → null (no cache)
2. Request B: `getCachedRevMTD()` → null (no cache, same instant)
3. Both A and B proceed to `runScript(CONFIG.scripts.linescript)`
4. Both call `setCachedRevMTD()` at completion — last write wins

Two full script executions run in parallel (see issue #2 above). `fs.writeFileSync` at line 49 is synchronous but there is no mutex around the read-check-run-write sequence.

**Fix:** Use an in-memory promise-based lock:
```js
let runningPromise = null;

async function getOrRunScript(scriptPath) {
  const cached = getCachedRevMTD();
  if (cached) return { link: cached.link };
  if (runningPromise) return runningPromise;
  runningPromise = runScript(scriptPath).finally(() => { runningPromise = null; });
  return runningPromise;
}
```

---

### 5. Port Conflict — EADDRINUSE Handling
**Status: ❌ Unhandled**
**Severity: MEDIUM**
**File: webhook-server.js, line 259**

`app.listen(CONFIG.port, callback)` with no error handler. If port 39412 is already in use, the process crashes with an unhandled `EADDRINUSE` error and no meaningful log message.

**Fix:**
```js
const server = app.listen(CONFIG.port, () => { ... });
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${CONFIG.port} already in use. Exiting.`);
    process.exit(1);
  }
  throw err;
});
```

---

### 6. SIGTERM/SIGINT — Graceful Shutdown
**Status: ❌ Unhandled**
**Severity: MEDIUM**

No `process.on('SIGTERM')` or `process.on('SIGINT')` handlers. When the process is killed (e.g., by systemd, Docker stop, or Ctrl+C):

- Any in-flight `runScript()` child process is orphaned — the spawned `node linescript.js` continues running with no parent to receive its output.
- No `server.close()` call — existing connections are forcibly dropped.
- The cache file may be partially written if `fs.writeFileSync` is interrupted mid-write.

**Fix:**
```js
const server = app.listen(...);

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // Force exit after timeout if connections linger
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## SMART RUNNER (`smart-runner.js`)

### 7. Invalid AI Patch — Malformed CAUSE/FIND/REPLACE
**Status: ⚠️ Partial**
**Severity: HIGH**
**File: smart-runner.js, lines 122–131**

The regex parsing is fragile:

- `FIND` regex (line 124) uses a lookahead for `\nREPLACE:` — if AI response has Windows-style `\r\n`, the match fails and `find` is `undefined`.
- `REPLACE` regex (line 125) uses lookahead for `\nRETRY:` — same CRLF problem.
- If AI returns multi-line `FIND`/`REPLACE` blocks (valid for code fixes), the `.trim()` result is multi-line which may not match the actual script content.
- `find === undefined` falls through to `applyFix` which checks `!find` at line 136 — this is partially handled, no fix is applied. But it logs nothing to distinguish "AI returned no fix" from "parsing failed".

The `applyFix` guard at line 136 prevents a crash, so it won't corrupt the file. However, the runner silently falls through to retry with no patch applied — consuming retries without making progress.

**Partial handling:** `applyFix` null-checks `find`/`replace`.
**Unhandled:** No logging when parse fails; CRLF normalization absent; no validation that the parsed fix is syntactically coherent.

---

### 8. Patch Wrong Location — `replace()` Matches Multiple Locations
**Status: ❌ Unhandled**
**Severity: HIGH**
**File: smart-runner.js, lines 160–165**

`content.replace(find, replace)` at line 161 replaces only the **first** occurrence. If the `find` string appears multiple times in the script, only the first is patched — potentially the wrong one.

The regex fallback at line 164 uses `content.replace(regex, replace)` which also replaces only the first match.

No occurrence-count check is performed before applying. If the wrong instance is patched, the script gains a syntax error and will fail on every subsequent attempt, consuming all retries.

**Fix:**
```js
const occurrences = (content.match(new RegExp(escapedFind, 'g')) || []).length;
if (occurrences > 1) {
  log('⚠️', `FIND pattern matches ${occurrences} locations — skipping ambiguous patch`);
  return false;
}
if (occurrences === 0) {
  log('⚠️', 'Code pattern not found in script');
  return false;
}
```

---

### 9. Backup Overwrite — `.backup` Overwritten on Each Retry
**Status: ✅ Handled**
**Severity: LOW**
**File: smart-runner.js, lines 153–157**

The guard `if (!fs.existsSync(backupPath))` at line 154 correctly prevents overwriting an existing backup. The first-run backup is preserved across retries.

**Note:** The backup from a previous day's run (e.g., `linescript.js.backup-20260225` visible in the directory) is not managed by this code — that appears to be a separate manual backup. The `applyFix` backup path is `linescript.js.backup` (no date). If a previous session already created `linescript.js.backup`, all future sessions skip backup creation. This means the backup may reflect a previous day's broken state, not the current original.

---

### 10. Infinite Retry — Pattern Match + Failed Fix Loop Forever
**Status: ✅ Handled (bounded)**
**Severity: LOW**
**File: smart-runner.js, lines 248–286**

The loop is bounded by `CONFIG.maxRetries = 3` (line 13) and the `attempt < CONFIG.maxRetries` condition. It cannot loop forever.

**Minor concern:** A known-fix pattern (e.g., `protocolTimeout`) that matches on every run will be "applied" on attempt 1 (changes value), but on attempt 2 the pattern still matches (the regex `/protocolTimeout: \d+/g` will match the new value too) and the fix is "applied" again (no-op if already at 300000, but the file is still rewritten). This is wasteful but bounded.

---

### 11. Race Condition — Cron + Manual Trigger Simultaneously
**Status: ❌ Unhandled**
**Severity: MEDIUM**

`smart-runner.js` has no PID file, lock file, or any mechanism to detect if another instance is running. If a cron job triggers `smart-runner.js` while a manual trigger is already running:

- Two instances both run `linescript.js` concurrently.
- Both may call `applyFix` on the same `linescript.js` simultaneously — one reads the file, the other writes, resulting in a partial or corrupted file.
- Both check `!fs.existsSync(backupPath)` and one may overwrite the backup if the first instance's backup write is not yet flushed.

**Fix:**
```js
const lockFile = path.join(__dirname, 'smart-runner.lock');

if (fs.existsSync(lockFile)) {
  const pid = fs.readFileSync(lockFile, 'utf8').trim();
  try { process.kill(parseInt(pid), 0); console.log(`Already running (PID ${pid}), exiting`); process.exit(0); }
  catch (e) { /* stale lock */ }
}
fs.writeFileSync(lockFile, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch(_){} });
```

---

### 12. Gemini API Failure — Fallback or Retry
**Status: ⚠️ Partial**
**Severity: MEDIUM**
**File: smart-runner.js, lines 129–132**

`askAIForFix` catches all axios errors (line 129) and returns `{ cause: 'AI unavailable', find: null, replace: null, retry: true }`. This means:

- No patch is applied (correctly guarded).
- `retry: true` ensures the attempt loop continues.
- The runner will exhaust all retries retrying the script with no fix applied — effectively wasting `maxRetries` cycles on a network-down scenario.

No exponential backoff or timeout on the AI call beyond the `timeout: 30000` (line 116). If the AI endpoint is slow (returns after 30s), each retry adds 30s AI wait + 15s retry delay = 45s per attempt, for a total worst-case of ~2.25 minutes of blocked waiting.

**Partial:** Catch clause prevents crash. **Unhandled:** No distinction between "AI says no fix exists" and "AI unreachable" — both produce `retry: true` with no patch, burning retries identically.

---

## Summary Table

| # | Scenario | Status | Severity | File:Line |
|---|----------|--------|----------|-----------|
| 1 | Global Express error middleware / uncaught exceptions | ❌ Unhandled | HIGH | webhook-server.js:259 |
| 2 | Concurrent webhooks spawning parallel executions | ❌ Unhandled | HIGH | webhook-server.js:97 |
| 3 | LINE multicast invalid recipient (undefined userId) | ⚠️ Partial | MEDIUM | webhook-server.js:79,163 |
| 4 | Cache race condition (check-then-run not atomic) | ❌ Unhandled | MEDIUM | webhook-server.js:187–204 |
| 5 | Port conflict EADDRINUSE | ❌ Unhandled | MEDIUM | webhook-server.js:259 |
| 6 | SIGTERM/SIGINT graceful shutdown | ❌ Unhandled | MEDIUM | webhook-server.js:259 |
| 7 | AI patch malformed response / CRLF parse failure | ⚠️ Partial | HIGH | smart-runner.js:122–131 |
| 8 | Patch matches multiple locations (wrong site patched) | ❌ Unhandled | HIGH | smart-runner.js:160–165 |
| 9 | Backup overwritten on retry | ✅ Handled | LOW | smart-runner.js:153–157 |
| 10 | Infinite retry loop | ✅ Handled (bounded) | LOW | smart-runner.js:248 |
| 11 | Race condition: cron + manual trigger | ❌ Unhandled | MEDIUM | smart-runner.js:242 |
| 12 | Gemini API failure fallback | ⚠️ Partial | MEDIUM | smart-runner.js:129–132 |

**Critical gaps: 5 unhandled, 3 partial, 2 handled**

---

## Priority Fix Order

1. **[HIGH]** Issue #2 + #4 together: add a run-lock / promise deduplication to prevent parallel `linescript.js` executions — fixes both concurrency bugs at once.
2. **[HIGH]** Issue #8: add occurrence-count guard before applying AI patches to prevent corrupting the script on ambiguous matches.
3. **[HIGH]** Issue #1: add async error boundary in Express and `unhandledRejection` handler to prevent silent crashes.
4. **[MEDIUM]** Issue #11: add lock file in `smart-runner.js` to prevent cron + manual overlap.
5. **[MEDIUM]** Issues #5 + #6: add `server.on('error')` and SIGTERM/SIGINT handlers together (5-line fix).
6. **[MEDIUM]** Issue #3: guard `userId` before calling `pushToLine`.
7. **[MEDIUM]** Issues #7 + #12: normalize CRLF in AI response, log parse failures distinctly, distinguish API-down from no-fix-found.

---

## Critical Security Note

Both files contain hardcoded credentials in plaintext:

- `webhook-server.js` line 19: LINE channel access token
- `smart-runner.js` lines 16, 20: AI API key + LINE token

These are committed to source. If this repository is or was ever pushed to a git remote, these credentials should be rotated immediately and moved to environment variables.

---

## Unresolved Questions

1. Is `smart-runner.js` invoked via cron, or only manually / via webhook? This determines real exposure of issue #11.
2. Does `linescript.js` perform any cleanup on failure (e.g., close browser, release file locks)? If not, parallel executions of it may compound issues beyond what's visible in the runner.
3. The AI endpoint (`api.key4u.shop`) is a third-party proxy — is the `linescript.js` source code safe to send there (issue #7 sends `scriptContent.substring(0, 2500)`)? If the script contains credentials or business logic, this is a data-leak risk.
