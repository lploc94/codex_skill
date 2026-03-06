# Edge Case Verification Report — Revenue Bot
**Files:** `linescript.js`, `revrt.js`
**Date:** 2026-03-06

---

## Browser Automation

### 1. Selector Brittleness
**Severity: HIGH**

- **linescript.js:40-52** — All selectors are long nth-child CSS paths (e.g., `body > main > div > div:nth-child(5) > div:nth-child(1) > div.ng-scope > div > span > span > input`). Any UI change to the Angular page will silently break these.
- **revrt.js:24-33** — Same pattern, same risk.
- treeNode fallback (`#j1_1_anchor`) exists only in `linescript.js:195-205` — tries `.jstree-checkbox` or `[role="treeitem"]` as alternative.
- `revrt.js:252-259` wraps tree selection in try/catch and continues, but this can silently pass with no store selected, producing wrong export data.

**Verdict: PARTIAL**
- linescript.js has one fallback for tree node click.
- No fallback for date/export/download selectors in either file.
- revrt.js tree failure is swallowed silently — potential silent data error.

---

### 2. Download Poll Loop — Total Timeout
**Severity: HIGH**

- **linescript.js:220** — Loop runs 80 iterations × 8s reload delay = **~10.7 minutes max**, then falls through without throwing.
  - After the loop exits (whether completed or exhausted), line 243 blindly clicks the download link regardless of whether export actually completed.
  - If export never completes, it clicks whatever link is in row 1 (possibly a stale/wrong file).

- **revrt.js:139** — Loop runs 60 iterations × (2s + 1s reload) = **~3 minutes max**.
  - Line 156 correctly throws `Error('Timeout chờ trạng thái Completed')` if loop exhausts without completion.

**Verdict:**
- linescript.js: **UNHANDLED** — no break/throw on timeout; download proceeds regardless. `linescript.js:239-243`
- revrt.js: **HANDLED** — throws on timeout; wrapped in 3-retry outer loop. `revrt.js:156`

---

### 3. Browser Cleanup — Zombie Processes
**Severity: HIGH**

- **linescript.js:432-433** — `browser.close()` is called in the **try block**, not a finally block. If any error occurs before line 432 (e.g., in `waitAndDownload`, `uploadToDrive`, or the pivot step), execution jumps to the catch block.
- **linescript.js:463** — Catch block does call `if (browser) await browser.close()`, so coverage exists for top-level errors.
- However: the catch block `browser.close()` is NOT in a finally block. If the catch block itself throws (e.g., `browser.close()` rejects), process exits without cleanup guarantee.

- **revrt.js:275-277** — `browser.close()` IS in a `finally` block. Correct pattern.

**Verdict:**
- linescript.js: **PARTIAL** — covered in catch but not finally; double-close risk absent, but an error inside the catch would leave browser open. `linescript.js:459-465`
- revrt.js: **HANDLED** — proper finally block. `revrt.js:275`

---

### 4. Empty / Corrupt XLSX
**Severity: MEDIUM**

- **revrt.js:124-129** — `tryReadRowsFromXlsx()` explicitly checks `if (!rows || !rows.length) throw new Error('EmptyRows')`. Wrapped in retry loop `downloadAndValidate()` (3 retries). Corrupt file that fails `XLSX.readFile` will also throw and retry. **HANDLED.**

- **linescript.js:411** — `XLSX.readFile(file.path)` is called inline with no try/catch or row-count check:
  ```js
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(file.path).Sheets[XLSX.readFile(file.path).SheetNames[0]]);
  ```
  Also calls `XLSX.readFile` **twice** on the same path unnecessarily. If file is corrupt or 0 rows, `createPivot` receives empty array and writes an empty pivot XLSX to Drive silently. `linescript.js:411-428`

**Verdict:**
- revrt.js: **HANDLED**
- linescript.js: **UNHANDLED** — no row-count guard, no try/catch around XLSX read, double file-read waste.

---

### 5. Session Timeout During Long Scrapes
**Severity: MEDIUM**

- Neither file checks for redirect to the login page mid-scrape. If the Erablue session expires during the 80-iteration poll loop (~10 min window in linescript.js), the page reloads will silently return the login page HTML.
- `page.evaluate()` on the login page would return empty string for the status selector, causing the loop to exhaust and then click the download link on the login page — which either throws or downloads nothing.
- No session-check (e.g., detect URL redirect to `/Account/Login`) exists in either file.

**Verdict: UNHANDLED** — both files. `linescript.js:222-238`, `revrt.js:142-153`

---

## Data Pipeline

### 6. Pivot — Null/Undefined Store Name
**Severity: MEDIUM**

- **linescript.js:292** — `createPivot()` filters rows missing `Date` or `Store Name`:
  ```js
  if (!r.Date || !r['Store Name']) return;
  ```
  Rows with null/undefined store are skipped. **HANDLED.**

- Rows with empty-string store name (`''`) would pass the guard (falsy check catches `''` too — JS `!''` is true). **HANDLED.**

---

### 7. Date Range Edge — First-of-Month / MTD Off-by-One
**Severity: LOW**

- **linescript.js:139-170** — Logic is:
  - `isFirst` branch: `prevEnd = new Date(year, month, 0)` — this is the last day of the previous month. Correct.
  - `normal` branch: `endCur = today - 1 day` — yesterday as MTD end. Correct for "up to yesterday" semantics.
  - `sameDayPrev` clamped with `Math.min(endCur.getDate(), lastDay(...))` — handles Feb edge case where current day > days in prev month. **Handled.**
  - Running on the 1st: `endCur` would be the last day of previous month (month-1, day 0). This branch is only hit when `isFirst === false`, so it never runs on the 1st. **No off-by-one.**

**Verdict: HANDLED** — date math is correct and guarded for short months.

---

### 8. Drive Upload Failure
**Severity: HIGH**

- **linescript.js:418,428** — `uploadToDrive()` has no try/catch internally; if it throws, the error propagates to the outer try/catch at line 459, which closes browser and exits with code 1. Pipeline halts — no partial upload state cleanup, but no silent partial state either.
- `logToSheet` (line 436) is never reached if upload fails — so no Sheet entry for a failed run. Acceptable behavior.

- **revrt.js:269** — `uploadFileToDrive()` throws if file not found (line 80). Error propagates to top-level catch. Same pattern.

**Verdict: PARTIAL** — upload errors are fatal and stop the pipeline, which is correct. But there is no cleanup of already-uploaded files from Drive on subsequent retries (smart-runner would re-upload creating duplicates on retry). No severity escalation — just a known limitation.

---

### 9. Sheets Append Failure
**Severity: LOW**

- **linescript.js:124-136** — `logToSheet()` has its own try/catch and logs a warning on failure (`Sheet log skipped`). It does **not** rethrow. Partial state is not possible since it's a single append call.
- Pipeline continues (proceeds to LINE notify) even if Sheet logging fails.

**Verdict: HANDLED** — intentionally non-fatal. Acceptable.

---

### 10. Google API Rate Limiting (429)
**Severity: LOW**

- Neither `uploadToDrive` (linescript.js:114) nor `logToSheet` (linescript.js:124) nor `uploadFileToDrive` (revrt.js:79) implement retry logic for 429 responses.
- The googleapis Node client does not auto-retry 429s by default.
- Given the low call volume (2-3 Drive uploads + 1 Sheets append per run), rate limiting is unlikely in practice, but possible if smart-runner triggers multiple rapid retries.

**Verdict: UNHANDLED** — `linescript.js:114-122`, `revrt.js:79-89`. Low practical risk given call frequency.

---

### 11. Download Directory Missing
**Severity: LOW**

- **linescript.js:334** — `fs.mkdirSync(d, { recursive: true })` is called for both `downloads` and `reports` at startup (inside the try block, before browser launch). **HANDLED.**
- Redundant check at line 343-346 (`if (!fs.existsSync(...)) mkdirSync`) is dead code since line 334 already creates it.

- **revrt.js:91-93** — `ensureDirectories()` calls `fs.mkdirSync(CONFIG.downloadPath, { recursive: true })` at line 211. **HANDLED.**

**Verdict: HANDLED** — both files create directories at startup.

---

## Summary Table

| # | Edge Case | linescript.js | revrt.js | Severity |
|---|-----------|--------------|----------|----------|
| 1 | Selector brittleness | PARTIAL | PARTIAL | HIGH |
| 2 | Download poll timeout | UNHANDLED | HANDLED | HIGH |
| 3 | Browser cleanup / zombie | PARTIAL | HANDLED | HIGH |
| 4 | Empty / corrupt XLSX | UNHANDLED | HANDLED | MEDIUM |
| 5 | Session timeout mid-scrape | UNHANDLED | UNHANDLED | MEDIUM |
| 6 | Null store name in pivot | HANDLED | N/A | MEDIUM |
| 7 | Date range off-by-one | HANDLED | N/A | LOW |
| 8 | Drive upload failure | PARTIAL | PARTIAL | HIGH |
| 9 | Sheets append failure | HANDLED | N/A | LOW |
| 10 | Google API 429 rate limit | UNHANDLED | UNHANDLED | LOW |
| 11 | Download dir missing | HANDLED | HANDLED | LOW |

---

## Top Fixes Recommended

1. **linescript.js:239** — After poll loop exhausts without `completed`, throw instead of silently clicking download. Add `if (!completed) throw new Error('Export timeout after 80 polls')`.

2. **linescript.js:459-463** — Move `browser.close()` into a `finally` block (mirrors revrt.js pattern).

3. **linescript.js:411** — Wrap `XLSX.readFile` in try/catch, check `rows.length > 0`, call `readFile` only once (store result in variable).

4. **Both files** — After each `page.reload()` in the poll loop, check `page.url()` for redirect to `/Account/Login`. If detected, re-authenticate or throw a descriptive session error.

5. **Both files** — Add a selector health-check at startup: verify at least one expected selector resolves before proceeding, log a warning with the selector string if not found.

---

## Unresolved Questions

- Does `smart-runner.js` deduplicate Drive uploads on retry, or do failed linescript.js runs create orphaned Drive files?
- Is there a maximum session lifetime for Erablue that could be correlated with observed run durations in the service logs?
- The `revrt.js` `Page.setDownloadBehavior` CDP call (line 233) uses the deprecated page-level API while `linescript.js` correctly uses `Browser.setDownloadBehavior` — is this causing any download failures in revrt.js on newer Chromium?
