# Code Review: Webhook Server & Smart Runner Edge Cases

**Date:** 2026-03-06
**Files:** `D:/revenue-bot/webhook-server.js`, `D:/revenue-bot/smart-runner.js`
**Scope:** Edge case verification — 13 specific scenarios

---

## Webhook Server (`webhook-server.js`)

---

### 1. Unhandled Express Errors — CRITICAL

**❌ Unhandled**

No global error middleware exists. Any synchronous throw inside a route handler (e.g., if `req.body` parsing throws, or middleware crashes) will propagate as an unhandled rejection or crash the process.

- No `app.use((err, req, res, next) => { ... })` anywhere in the file
- No `process.on('uncaughtException', ...)` handler
- No `process.on('unhandledRejection', ...)` handler

The `/webhook` handler wraps the async work in try/catch internally, but the outer `async (req, res)` function is not guarded by Express error forwarding. If `res.status(200).send('OK')` throws (e.g., socket already destroyed), the exception bubbles up unhandled.

**File:** `webhook-server.js` — no error middleware present anywhere (lines 136–277)

**Fix:**
```js
// After all routes, before app.listen:
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
process.on('uncaughtException', (e) => console.error('Uncaught:', e));
process.on('unhandledRejection', (e) => console.error('Rejection:', e));
```

---

### 2. Concurrent Requests — HIGH

**❌ Unhandled**

No locking or queuing mechanism. Multiple simultaneous webhook POSTs (e.g., two users send "revrt" within seconds) will each independently call `runScript()`, spawning parallel `node revrt.js` child processes. If `revrt.js` writes to the same Google Drive folder or holds exclusive file handles, this causes data corruption or duplicate uploads.

**File:** `webhook-server.js:175` — `runScript(CONFIG.scripts.revrt)` called without any guard

**Fix:** Implement a simple boolean lock per script:
```js
const running = { revrt: false, linescript: false };

if (running.revrt) {
    await pushToLine(userId, 'Already running, please wait.');
    return;
}
running.revrt = true;
try { ... } finally { running.revrt = false; }
```

---

### 3. LINE Multicast Invalid Recipient — MEDIUM

**⚠️ Partial**

`pushToLine()` at line 79 does catch HTTP errors from LINE and logs them (`e.response?.data || e.message`), so the server will not crash. However:

- The error is silently swallowed — the user never gets a fallback notification
- The `userId` comes directly from `event.source.userId` which LINE provides; if the user blocks the bot, LINE returns a `400` with `Invalid reply token` or a `403`, and the push silently fails
- No dead-letter queue, no retry, no admin alert for persistent delivery failures

**File:** `webhook-server.js:79–94`

---

### 4. Request Validation / Signature Verification — CRITICAL

**❌ Unhandled**

No LINE webhook signature verification. LINE signs each webhook POST with `X-Line-Signature` (HMAC-SHA256 of body using the channel secret). The server does not validate this header at all.

- Anyone who discovers the public webhook URL can POST arbitrary payloads
- An attacker can forge events: trigger `revrt` or `revmtd` as often as they like, spawning unlimited child processes and consuming server resources
- Attacker can also enumerate the `myid` command to confirm user IDs

**File:** `webhook-server.js:151` — no signature check before processing events

**Fix:**
```js
const crypto = require('crypto');
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(req) {
    const sig = req.headers['x-line-signature'];
    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
    return sig === hash;
}

app.post('/webhook', async (req, res) => {
    if (!verifySignature(req)) return res.status(401).send('Unauthorized');
    // ...
});
```

Note: `express.json()` parses before the raw body is available. Use `express.raw({ type: 'application/json' })` and parse manually, or use `@line/bot-sdk` middleware.

---

### 5. Cache Race Condition — MEDIUM

**⚠️ Partial**

`getCachedRevMTD()` and `setCachedRevMTD()` use synchronous `fs.readFileSync` / `fs.writeFileSync`, which avoid async race conditions at the Node.js event-loop level. However:

- Two concurrent "revmtd" requests that both pass the `if (cached)` check (both see no cache at the same moment) will each independently run `linescript.js` and both call `setCachedRevMTD()`. The second write wins, but two full script executions ran.
- This is a TOCTOU (time-of-check/time-of-use) race: the cache check is not atomic with the script launch.

**File:** `webhook-server.js:189–212` — no mutex around cache-check + script-launch

---

### 6. Port Conflict Handling (EADDRINUSE) — LOW

**❌ Unhandled**

`app.listen()` at line 259 does not attach an error handler. If port `39412` is already in use, Node throws `EADDRINUSE` as an `error` event on the server instance. Without a listener, this becomes an unhandled `events.EventEmitter` error and crashes the process with no user-friendly message.

**File:** `webhook-server.js:259`

**Fix:**
```js
const server = app.listen(CONFIG.port, () => { ... });
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`Port ${CONFIG.port} already in use. Exiting.`);
        process.exit(1);
    }
});
```

---

### 7. SIGTERM / SIGINT Graceful Shutdown — MEDIUM

**❌ Unhandled**

No `SIGTERM` or `SIGINT` handlers. When the process manager (PM2, systemd, Windows service host) sends SIGTERM to restart the server:

- In-flight `runScript()` calls (which can run 2–10 minutes) are killed immediately
- The child `node revrt.js` / `node linescript.js` process becomes orphaned (its parent dies, but the child keeps running without supervision)
- The user's LINE push message is never sent, leaving them waiting indefinitely

**File:** `webhook-server.js` — no signal handlers anywhere

**Fix:**
```js
let activeScripts = [];
// Track child processes in runScript(), then on SIGTERM:
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    activeScripts.forEach(p => p.kill());
    process.exit(0);
});
```

---

## Smart Runner (`smart-runner.js`)

---

### 8. Invalid AI Patch (Malformed CAUSE/FIND/REPLACE) — HIGH

**⚠️ Partial**

Parsing is done with regex at lines 123–126. If Gemini returns freeform text that doesn't match the expected format:

- `find` and `replace` will be `undefined` or `null`
- `applyFix()` at line 136 guards for `!find || find === 'none'` and returns `false` — so no crash
- However, the runner then silently proceeds to retry with the unfixed script, consuming all retry attempts without ever applying a patch

There is no alert to admin when AI returns malformed output — the failure mode is invisible. The AI model name `gemini-3-flash-preview` (line 18) is non-standard; if the endpoint returns an unexpected response schema, `response.data.choices[0].message.content` at line 119 will throw a TypeError and fall into the catch block, returning `retry: true` with no fix — triggering all retries.

**File:** `smart-runner.js:119,123–126,136`

---

### 9. Patch Matching Multiple Locations — HIGH

**❌ Unhandled**

`applyFix()` at line 161 uses `content.replace(find, replace)`. JavaScript `String.replace()` with a string argument replaces only the **first** occurrence. If the AI-provided FIND string appears multiple times in `linescript.js`, only the first is patched — possibly the wrong one. If the regex path is taken (line 164), `content.replace(regex, replace)` also replaces only the first match by default (no `g` flag).

No occurrence-count check exists before applying. If the match count is 0 (wrong file state after prior patches), the file is silently unchanged but `applyFix()` returns `true` (bug: normalization check at line 147 passes but exact match at 160 may not).

**File:** `smart-runner.js:147–165`

---

### 10. Backup Overwrite on Each Retry — LOW

**✅ Handled**

Line 154: `if (!fs.existsSync(backupPath))` — backup is only created if none exists. Subsequent retries do not overwrite it. This correctly preserves the original pre-fix version.

However: if `linescript.js.backup` already exists from a previous session (days ago), the old backup is kept and the current session's original is never backed up. This means after multiple sessions with incremental AI patches, the backup is stale.

**File:** `smart-runner.js:153–157`

---

### 11. Infinite Retry Loop — HIGH

**⚠️ Partial**

`maxRetries: 3` (line 12) bounds the loop at line 248. The loop cannot run more than 3 times. However:

- If the same KNOWN_FIX pattern matches on every attempt (e.g., `protocolTimeout` error recurs even after the fix), `knownFixApplied = true` each time, the AI is never consulted, and all 3 retries exhaust with the same failing script state
- The `modified: false` return (line 43) for the tree-selector fix means that known error re-applies nothing but still returns `true`, blocking AI escalation on every attempt
- Effectively: a persistent known-pattern error will exhaust all retries without ever applying a real fix or escalating to AI

**File:** `smart-runner.js:262–279`

The fix is to track whether a known fix was already attempted and allow AI fallback if it didn't resolve the issue.

---

### 12. Race Condition: Cron + Manual Trigger — HIGH

**❌ Unhandled**

No file lock or PID file mechanism. If the cron job triggers `smart-runner.js` and a user simultaneously triggers `revmtd` via the webhook (which calls `runScript(CONFIG.scripts.linescript)` directly — not via smart-runner), two parallel Node processes modify `linescript.js` simultaneously:

- `smart-runner.js` may write a patch to `linescript.js` while the webhook's `linescript.js` child process is mid-execution reading the same file
- `smart-runner.js`'s `applyFix()` uses synchronous `fs.writeFileSync`, overwriting the file while another process runs it
- No PID file check, no advisory lock, no coordination

**File:** `smart-runner.js:168` + `webhook-server.js:200`

**Fix:** Use a lockfile (e.g., `linescript.js.lock`) checked by both entry points before launching the script.

---

### 13. Gemini API Failure — MEDIUM

**⚠️ Partial**

The `askAIForFix()` catch block at line 129 returns `{ cause: 'AI unavailable', find: null, replace: null, retry: true }`. This is handled:

- `find` is null, so `applyFix()` is skipped (line 269 guard)
- `retry: true` means the script retries without a fix

However:
- No exponential backoff or retry for the AI call itself — a transient 429 or 503 from the AI API is treated the same as a permanent failure
- The `timeout: 30000` on the axios call (line 116) is correct, preventing indefinite hang
- API key is hardcoded in plain text (line 16) — exposed in source control and logs

**File:** `smart-runner.js:84–132`

---

## Critical Security Finding (Both Files)

**❌ CRITICAL — Hardcoded Secrets**

Both files hardcode the LINE Bot channel token in plaintext:

- `webhook-server.js:19` — `CONFIG.line.token = 'nnGeYOUu...'`
- `smart-runner.js:20` — same token repeated
- `smart-runner.js:16` — AI API key `sk-qJpDB6Yf...` hardcoded

These are committed to the codebase. Anyone with repo access has full LINE Bot API access and AI API billing access. Rotate both keys immediately, move to environment variables.

---

## Summary Table

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | No global Express error middleware | CRITICAL | ❌ Unhandled |
| 4 | No LINE webhook signature verification | CRITICAL | ❌ Unhandled |
| — | Hardcoded secrets (LINE token, AI key) | CRITICAL | ❌ Unhandled |
| 2 | Concurrent requests spawn parallel scripts | HIGH | ❌ Unhandled |
| 8 | Malformed AI patch silently skipped | HIGH | ⚠️ Partial |
| 9 | Multi-location find/replace not checked | HIGH | ❌ Unhandled |
| 11 | Known-fix loop exhausts retries without AI | HIGH | ⚠️ Partial |
| 12 | Cron + manual trigger race on linescript.js | HIGH | ❌ Unhandled |
| 7 | No SIGTERM/SIGINT graceful shutdown | MEDIUM | ❌ Unhandled |
| 3 | Invalid LINE recipient silently swallowed | MEDIUM | ⚠️ Partial |
| 5 | Cache TOCTOU — double script execution | MEDIUM | ⚠️ Partial |
| 13 | No AI API retry / backoff | MEDIUM | ⚠️ Partial |
| 6 | EADDRINUSE not handled on listen() | LOW | ❌ Unhandled |
| 10 | Stale backup from prior sessions | LOW | ⚠️ Partial |

---

## Recommended Priority Actions

1. **Rotate secrets immediately** — LINE token and AI key are exposed in source; move to `.env` via `dotenv`
2. **Add LINE signature verification** — prevents unauthenticated script execution (DoS vector)
3. **Add global Express error handler + uncaughtException handler**
4. **Add per-script execution lock** — prevents parallel child process spawning from concurrent webhooks and cron overlap
5. **Add SIGTERM handler** — kill tracked child processes on shutdown
6. **Add EADDRINUSE handler** on `app.listen()`
7. **Track attempted known-fixes per attempt** — allow AI escalation if known fix didn't resolve
8. **Add occurrence-count guard in `applyFix()`** — warn if FIND matches 0 or 2+ locations

---

## Unresolved Questions

- Does the cron schedule for `smart-runner.js` overlap with webhook-triggered `linescript.js` runs in practice? Knowing the cron interval would confirm severity of issue #12.
- Is `linescript.js.backup` from a prior session present on disk? If so, issue #10 silently loses the pre-current-session original.
- What process manager (PM2 / Windows service) runs these? Determines whether SIGTERM (#7) is actually sent, or if the process is killed with SIGKILL (in which case graceful shutdown is impossible regardless).
