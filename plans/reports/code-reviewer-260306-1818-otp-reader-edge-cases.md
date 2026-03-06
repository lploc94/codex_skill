# Edge Case Review - otp-reader.js + Process Management
Files: otp-reader.js, linescript.js (error handling), webhook-server.js (process mgmt)
Date: 2026-03-06

---

## OTP Reader (otp-reader.js)

### 1. LDPlayer Not Running
Status: HANDLED
ensureAdb() (line 77) calls isLDPlayerRunning() (line 42). If false, startLDPlayer() (line 54)
launches via ldconsole, waits 30s, reconnects ADB. Any exception is caught by ensureAdb catch at
line 90, returning false, which triggers throw new Error("ADB connection failed") at line 146.
Full path covered.
Severity: N/A

---

### 2. ADB Connection Failure
Status: PARTIAL - MEDIUM
File: otp-reader.js:84-89

ensureAdb() (lines 77-93) has a try/catch returning false on exception. getOTP() converts that
to a throw. Two gaps:

Gap 1 - Reconnect not verified: after the reconnect at line 86 (adb connect), the function always
returns true at line 89 with no verification. A silent reconnect failure would proceed to screenshot
and produce a misleading "OCR got only 0 digits" error rather than an ADB error.

Gap 2 - "unauthorized" state not checked: the adb devices check at line 83 tests for "offline" but
not "unauthorized". An unauthorized device passes the guard and fails silently downstream.

Fix - verify reconnect result before returning true:

    const verify = execSync(`"${ADB_PATH}" devices`, { encoding: "utf-8", timeout: 5000 });
    return verify.includes(ADB_DEVICE)
      && !verify.includes("offline")
      && !verify.includes("unauthorized");

Severity: MEDIUM

---

### 3. OCR Misread / OTP Digit Validation
Status: PARTIAL - MEDIUM
File: otp-reader.js:172-174, 190-193

Two-pass OCR with char whitelist and substitution table (O->0, I->1, S->5, B->8, Z->2) covers common
misreads. digits.length >= 6 guard prevents returning short strings.

Gap: if OCR returns 7+ digits (adjacent UI elements bleed into the crop region), substring(0,6)
silently returns potentially wrong digits with no log warning. No checksum or exact-length assertion.

Fix - add a warning log when truncating:

    if (digits.length > 6) {
      console.warn(`[OTP] OCR returned ${digits.length} digits, truncating to first 6`);
    }
    if (digits.length >= 6) { return digits.substring(0, 6); }

Severity: MEDIUM

---

### 4. Screenshot Timing - Wait for OTP to Appear
Status: PARTIAL - MEDIUM
File: otp-reader.js:154

Fixed 6s sleep after openApp() with no dynamic wait. On a cold-boot path (LDPlayer just launched by
startLDPlayer() with 30s boot wait), the app may still be loading the OTP screen, especially under
system load.

Critical point: both OCR passes (normal and inverted) read the same already-captured screenshot.
If the screenshot was taken before the OTP rendered, both passes fail identically - the retry only
changes image processing, not the capture timing.

Fix: retry the screenshot capture, not just image processing:

    for (let attempt = 0; attempt < 3; attempt++) {
      adb("shell screencap -p /sdcard/otp.png");
      adb(`pull /sdcard/otp.png "${screenshotPath}"`);
      // ... crop + OCR ...
      if (digits.length >= 6) return digits.substring(0, 6);
      if (attempt < 2) sleep(5000); // wait and retry capture
    }

Severity: MEDIUM (real failure vector on cold-boot path)

---

### 5. Cleanup - Temp Screenshot Files
Status: PARTIAL - LOW
File: otp-reader.js:142-143, 179

killApp() and stopLDPlayer() are in the finally block (lines 199-201) - app lifecycle is always
cleaned up correctly.

Temp PNG files (otp-screen.png, otp-cropped.png, otp-inverted.png) are never deleted. Files
overwrite themselves on each run so there is no unbounded accumulation, but stale files from a
previous failed run persist in ./temp/ across runs. The inverted file is only created on the retry
path, so a successful first-pass run leaves the prior run's otp-inverted.png on disk indefinitely.

Fix: add cleanup in the finally block after killApp/stopLDPlayer:

    [screenshotPath, croppedPath, invertedPath].forEach(p => {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    });

Severity: LOW

---

### 6. Module Integration - getOTP() Has No Callers
Status: NOTE
File: otp-reader.js:212

module.exports = { getOTP } at line 212. A repo-wide grep (excluding node_modules) finds zero
files that require("./otp-reader") or call getOTP(). The module is only invoked via CLI. The header
comment at lines 7-9 documents an import API that is not yet wired up. If revrt.js is intended to
call getOTP() in a future flow, the integration is currently missing.
Severity: N/A (documentation/integration gap, not a runtime bug)

---

## Process Management (All Scripts)

### 7. Uncaught Promise Rejections
Status: UNHANDLED - HIGH

webhook-server.js: No process.on("unhandledRejection") handler. The /trigger/revrt endpoint
(line 247) sends a response then runs runScript asynchronously after res.json() completes. Any
rejection from runScript or its downstream after res.json() surfaces as an unhandled promise
rejection. In Node.js >= 15 this crashes the process by default.

linescript.js: Top-level IIFE (async () => { ... })() at line 327. The inner try/catch covers the
main execution path and closes the browser on error (lines 459-464) - correct. However any rejection
that escapes the IIFE context after the catch has already run (e.g., from the waitForFile
setInterval if it fires post-catch) would be unhandled.

otp-reader.js CLI path (lines 207-209): has .catch(err => process.exit(1)) - safe.

Fix for webhook-server.js:

    process.on("unhandledRejection", (reason) => {
      console.error("[FATAL] Unhandled rejection:", reason);
      // Keep server alive for other requests - do not exit
    });

Severity: HIGH

---

### 8. Memory Leaks - Puppeteer Browser/Page Not Closed in All Error Paths
Status: PARTIAL - HIGH
File: linescript.js:459-463

The outer catch block closes browser if defined (line 463) - correct for the primary error path.

Real gap: browser.close() is not wrapped in any timeout guard. If Chrome hangs on close (a known
issue with --disable-gpu + headless on certain Windows versions), the process hangs indefinitely
since there is no Promise.race with a deadline. The script will appear to have stalled with no log
output and no exit code.

Fix:

    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("browser.close() timed out")), 10000))
    ]);

Note: page is not explicitly closed before browser.close() - Puppeteer closes all pages on
browser.close() automatically, so this is not a resource leak. Explicit page.close() before
browser.close() is more defensive but not required.
Severity: HIGH (hang risk on browser close)

---

### 9. Signal Handling - SIGTERM/SIGINT
Status: PARTIAL - MEDIUM

webhook-server.js (line 259): No SIGTERM/SIGINT handlers. On SIGTERM (Windows service stop,
taskkill /F), the process exits immediately. In-flight runScript() child processes are orphaned -
the spawned "node linescript.js" continues running headlessly with its Puppeteer browser alive.
No server.close() call - existing HTTP connections are dropped mid-flight.

linescript.js: Puppeteer default handleSIGINT=true / handleSIGTERM=true (confirmed in
@puppeteer/browsers/lib/cjs/launch.js lines 146-147, 181-185) kills the Chrome subprocess on
SIGINT/SIGTERM. This only covers the Chrome process - Google Drive uploads in-flight and partially
written XLSX files are not rolled back.

otp-reader.js: No signal handlers. If the process is killed externally mid-execution, LDPlayer
continues running and temp PNG files remain on disk. The finally block in getOTP() only runs on
a throw within the async function, not on an external kill signal.
Severity: MEDIUM

---

### 10. Concurrent Execution - No File Lock or PID File
Status: UNHANDLED - CRITICAL

None of the three scripts implement any mutex, PID file, or file lock.

Failure scenario in webhook-server.js: Two simultaneous LINE messages (revmtd from two users,
or two rapid sends from one user) both read null from the cache check and both call
runScript(CONFIG.scripts.linescript) independently (lines 200, 219). Two "node linescript.js"
processes start concurrently:

- Both delete all .xlsx files from downloads/ and reports/ at startup (linescript.js lines 337-339).
  Each process deletes the other process's in-progress downloaded files.
- Both upload to Google Drive - duplicate uploads with potentially partial/corrupted data.
- Both call setCachedRevMTD() (webhook-server.js line 204) - last write wins, may cache the wrong link.
- revrt + revmtd fired simultaneously share the same downloads/ directory and create the same race.

Fix: track the active child process reference and reject new requests if a script is running:

    let activeScript = null;

    function runScript(scriptPath) {
      if (activeScript) {
        return Promise.reject(new Error("Script already running, please wait and try again"));
      }
      return new Promise((resolve, reject) => {
        activeScript = spawn("node", [scriptPath], {
          cwd: __dirname,
          stdio: ["pipe", "pipe", "pipe"]
        });
        // ... existing stdout/stderr data handlers ...
        activeScript.on("close", (code) => {
          activeScript = null;
          code === 0 ? resolve({ ... }) : reject(new Error(...));
        });
        activeScript.on("error", (err) => { activeScript = null; reject(err); });
      });
    }

Severity: CRITICAL

---

## Summary Table

| # | Issue | File:Line | Status | Severity |
|---|-------|-----------|--------|----------|
| 1 | LDPlayer not running | otp-reader.js:77-93 | HANDLED | N/A |
| 2 | ADB reconnect not verified; unauthorized state missed | otp-reader.js:84-89 | PARTIAL | MEDIUM |
| 3 | OCR 7+ digit false positive, no truncation warning | otp-reader.js:172-174 | PARTIAL | MEDIUM |
| 4 | Fixed 6s timing, no adaptive capture retry on cold-boot | otp-reader.js:154 | PARTIAL | MEDIUM |
| 5 | Temp PNG files not deleted in finally block | otp-reader.js:142,179 | PARTIAL | LOW |
| 6 | getOTP() exported but no callers exist in repo | otp-reader.js:212 | NOTE | N/A |
| 7 | No unhandledRejection handler in webhook-server | webhook-server.js:259 | UNHANDLED | HIGH |
| 8 | browser.close() not timeout-guarded, process can hang | linescript.js:459-463 | PARTIAL | HIGH |
| 9 | No SIGTERM/SIGINT graceful shutdown in webhook-server | webhook-server.js:259 | PARTIAL | MEDIUM |
| 10 | No concurrency guard - concurrent runs corrupt downloads/ | webhook-server.js:97-134 | UNHANDLED | CRITICAL |

---

## Security Note (Out of Original Scope - Flagged)

webhook-server.js line 19 and linescript.js lines 22-23, 31 hardcode the LINE channel access token,
login username, and password as string literals in source files. If this repo has any git remote
(current or past), these credentials should be rotated immediately and moved to environment variables
with a .env file added to .gitignore.

---

## Unresolved Questions

1. Is getOTP() intended to be called from revrt.js in a planned future flow? The module export and
   header comment suggest so, but no caller exists - is this intentionally deferred or an oversight?

2. webhook-server.js appears to run as a Windows service (service-stderr-*.log filenames visible in
   the repo directory listing). On Windows, the SCM does not send POSIX signals to stop a service -
   it uses a different termination mechanism. SIGTERM handlers would not fire. What is the actual
   shutdown path for the service, and does it allow the server to drain in-flight requests?

3. OTP_CROP region (otp-reader.js line 29: left:60, top:380, width:960, height:160) is hardcoded
   for 1080x1920. Is LDPlayer always configured to exactly this resolution? A different resolution
   silently reads the wrong screen region and produces consistent OCR failures with no diagnostic.
