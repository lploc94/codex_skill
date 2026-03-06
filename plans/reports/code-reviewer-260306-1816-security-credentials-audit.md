# Security & Credentials Edge Case Review
**Project:** D:/revenue-bot
**Date:** 2026-03-06
**Files:** linescript.js, webhook-server.js, smart-runner.js, revrt.js

---

## 1. Hardcoded Erablue Login Credentials

**Severity: CRITICAL**

❌ Unhandled

Both `linescript.js` and `revrt.js` hardcode the login username and password directly in the CONFIG object.

```js
// linescript.js:21-24
credentials: {
    username: 'id.tuan2',
    password: '13002094aA'
}

// revrt.js:16
credentials: { username: 'id.tuan2', password: '13002094aA' },
```

The identical credentials appear in two separate files (linescript.js line 22-23 and revrt.js line 16). Anyone with read access to the repo or these files can extract the password immediately.

Fix: Move to environment variables.

```js
credentials: {
    username: process.env.ERABLUE_USERNAME,
    password: process.env.ERABLUE_PASSWORD
}
```

---

## 2. LINE Channel Token Exposed

**Severity: CRITICAL**

❌ Unhandled — hardcoded in THREE files

The same full LINE Messaging API channel access token is hardcoded as a literal string in all three files:

- `linescript.js:31` — `token: 'nnGeYOUujqrufHB0+kJh76Pr...'`
- `webhook-server.js:19` — same token
- `smart-runner.js:20` — same token

This token grants the ability to send messages on behalf of the LINE bot to any user ID. It should be treated as a secret equivalent to a password.

Fix:
```js
token: process.env.LINE_CHANNEL_TOKEN
```

---

## 3. AI API Key Hardcoded

**Severity: CRITICAL**

❌ Unhandled

`smart-runner.js:16`:
```js
apiKey: 'sk-qJpDB6Yfs0mhqlhiw0lJeRy5IGUsSkK9cIxfumzQGOuWb08F',
```

The key for `https://api.key4u.shop` is fully exposed. Any person with access to this file can use the key to make billable API calls.

Fix:
```js
apiKey: process.env.AI_API_KEY
```

---

## 4. No .gitignore — Credential Files Staged for Commit

**Severity: CRITICAL**

❌ Unhandled

`.gitignore` does **not exist** in `D:/revenue-bot/`. The repo has `git init` run but no commits yet. All three credential files are currently **staged** (shown in `git status` as `new file`):

- `google-credentials.json` — staged
- `oauth-credentials.json` — staged
- `token.json` — staged

If `git commit` is run now, all three credential files will be committed to history. Once pushed to a remote, rotating the credentials is the only remediation — removing from history requires full history rewrite.

Required `.gitignore`:
```
.env
*.env
google-credentials.json
oauth-credentials.json
token.json
node_modules/
downloads/*.xlsx
reports/*.xlsx
*.log
smart-runner.log
.revmtd-cache.json
```

Immediate action: unstage the files before any commit.
```bash
git rm --cached google-credentials.json oauth-credentials.json token.json
```

---

## 5. OAuth Token Refresh Race Condition

**Severity: MEDIUM**

⚠️ Partial

`linescript.js` `initGoogle()` (lines 78-112) and `revrt.js` `initGoogleDrive()` (lines 48-77):

- Both read `token.json` synchronously at startup via `fs.readFileSync`.
- Neither uses `auth.on('tokens', callback)` to persist refreshed tokens back to disk.
- The googleapis client does auto-refresh the access token in memory during a session, but the refreshed token is never written back to `token.json`.
- No mutex or lock file guards concurrent execution.

Concrete race: if `webhook-server.js` spawns `linescript.js` and `revrt.js` simultaneously (e.g., user sends `revmtd` while a scheduled `revrt` is running), both processes read the same `token.json`, both may attempt to refresh the expired access token with the same refresh token, and one will succeed while the other gets an `invalid_grant` error.

Fix — add token persistence:
```js
auth.on('tokens', (tokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...tokens }));
});
```

For true concurrent safety, use a file lock library (e.g., `proper-lockfile`) around the token read/write.

---

## 6. Webhook Signature Verification Missing

**Severity: HIGH**

❌ Unhandled

`webhook-server.js` `/webhook` endpoint (lines 151-244):

```js
app.post('/webhook', async (req, res) => {
    res.status(200).send('OK');
    const body = req.body;
    // No signature check — processes all incoming requests
```

LINE signs every webhook delivery with an HMAC-SHA256 signature in the `x-line-signature` header using the channel secret. This server ignores the header entirely.

Impact: any external party who knows the webhook URL can POST forged events. Since commands trigger `spawn('node', [scriptPath])` (line 101), an attacker can cause the server to execute `linescript.js` or `revrt.js` repeatedly (resource exhaustion / unintended Google Drive uploads / LINE API quota burn).

Fix using `@line/bot-sdk`:
```js
const { middleware, validateSignature } = require('@line/bot-sdk');

const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

app.post('/webhook', middleware(lineConfig), async (req, res) => { ... });
```

Or manual verification:
```js
const crypto = require('crypto');

function verifyLineSignature(body, signature, secret) {
    const hash = crypto.createHmac('SHA256', secret)
        .update(Buffer.from(JSON.stringify(body)))
        .digest('base64');
    return hash === signature;
}

app.post('/webhook', (req, res) => {
    const sig = req.headers['x-line-signature'];
    if (!verifyLineSignature(req.body, sig, process.env.LINE_CHANNEL_SECRET)) {
        return res.status(403).send('Forbidden');
    }
    // ...
});
```

Note: `express.json()` is used (line 13), so `req.body` is already parsed. LINE signature verification requires the raw body bytes. Middleware order matters — use `express.raw()` or capture raw body before JSON parsing.

---

## Additional Finding: /trigger/revrt Unauthenticated

**Severity: HIGH**

`webhook-server.js` lines 247-256:
```js
app.post('/trigger/revrt', async (req, res) => {
    res.json({ status: 'started', message: 'Running revrt.js...' });
    // Spawns script immediately, no auth
```

This HTTP endpoint requires zero authentication. Anyone who can reach the server port can trigger script execution. Minimum fix: require a shared secret header or restrict to localhost only.

---

## Summary Table

| # | Issue | File(s) | Line(s) | Severity | Status |
|---|-------|---------|---------|----------|--------|
| 1 | Hardcoded Erablue password | linescript.js, revrt.js | 22-23, 16 | CRITICAL | ❌ |
| 2 | LINE token hardcoded | linescript.js, webhook-server.js, smart-runner.js | 31, 19, 20 | CRITICAL | ❌ |
| 3 | AI API key hardcoded | smart-runner.js | 16 | CRITICAL | ❌ |
| 4 | No .gitignore, credentials staged | repo root | — | CRITICAL | ❌ |
| 5 | OAuth token refresh race | linescript.js, revrt.js | 83-105, 55-74 | MEDIUM | ⚠️ |
| 6 | No LINE signature verification | webhook-server.js | 151 | HIGH | ❌ |
| 7 | Unauthenticated trigger endpoint | webhook-server.js | 247 | HIGH | ❌ |

---

## Recommended Actions (Prioritized)

1. **Immediate — before any git commit:** Run `git rm --cached google-credentials.json oauth-credentials.json token.json` and create `.gitignore`.
2. **Immediate:** Rotate the LINE channel token, AI API key, and Erablue password — treat them as compromised since they exist in staged files.
3. Create a `.env` file and move all secrets: `ERABLUE_USERNAME`, `ERABLUE_PASSWORD`, `LINE_CHANNEL_TOKEN`, `LINE_CHANNEL_SECRET`, `AI_API_KEY`.
4. Add LINE signature verification to `/webhook` using raw body middleware.
5. Add auth (shared secret header or IP allowlist) to `/trigger/revrt`.
6. Add `auth.on('tokens')` listener and file locking for `token.json` refresh.

---

## Unresolved Questions

- Is `api.key4u.shop` a third-party proxy for Gemini? If so, the key at line 16 of smart-runner.js may be a proxy-issued key rather than a direct Google API key — but still needs rotation.
- Is the LINE channel secret available to add to `.env` for signature verification? It is distinct from the channel access token.
- Are `linescript.js` and `revrt.js` ever run concurrently in production, or always sequential? This affects the priority of the race condition fix.
