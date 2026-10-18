# FocusLock Guardian Chrome Extension

FocusLock Guardian is a Manifest V3 development extension. It signs in with the project's existing Supabase email/password authentication, reads the authenticated extension status endpoint, and redirects configured enabled domains to `blocked.html` unless the backend confirms an active unexpired entertainment session. Authenticated users can spend earned reward minutes to start a timed session or end it early.

## Local development

1. Start the FocusLock web app with `npm run dev`.
2. Build the local Supabase SDK module from the repository root:

   ```sh
   npm run build:extension
   ```

   This bundles the installed official `@supabase/supabase-js` package into `chrome-extension/supabase.js`. No remotely hosted JavaScript is loaded.
3. Open Chrome 111 or later, visit `chrome://extensions`, and enable **Developer mode**.
4. Select **Load unpacked** and choose the `chrome-extension` directory.
5. Open the toolbar popup. Configure the FocusLock backend URL and Supabase public project settings, then grant those exact hosts when Chrome prompts.
6. Sign in using the same email and password used on the FocusLock web app. If the account requires email confirmation, confirm it through the existing web app flow first.
7. Select **Enable website blocking** and approve the individual configured site hosts when Chrome prompts. Blocking is not active for a host until that host permission is granted.

The local defaults are `http://localhost:3000` for FocusLock. For Supabase, use the project's public URL and publishable key from `.env.local` or `.env.example`; do not copy any service-role, `sb_secret_`, Gemma, or other secret key into the extension.

## Authentication design

- The popup uses the existing `signInWithPassword` flow through the official Supabase JavaScript client. No new backend login endpoint or token format is introduced.
- The service worker alone obtains the Supabase access token and sends it to `GET /api/extension/status` in the `Authorization: Bearer <access-token>` header expected by the existing backend. Tokens are not sent to the popup, logged, or placed in URLs.
- Supabase's session is stored through a custom adapter backed by `chrome.storage.session`, not `chrome.storage.local`. It is restricted to the extension session and is cleared when Chrome ends the browser session. The popup also offers sign-out.
- The SDK's automatic timer-based refresh is disabled because MV3 service workers can be suspended. When status is requested, the service worker refreshes credentials that are close to expiry, and retries once after an API 401. Refresh requests are serialized. A failed refresh clears the local session if credentials are invalid; transient refresh/network failures are reported as network unavailable.
- The popup distinguishes setup required, connecting, signed out, authenticated, authentication expired, forbidden (403), and network/unavailable responses. Account values are only displayed after validating the actual backend response.
- The project URL and publishable/legacy anon key are public configuration, not credentials. The extension validates that a service-role/secret key is not supplied and stores the accepted public settings in `chrome.storage.local`.

## Host access and configuration

Permissions:

- `storage` stores public project configuration and previously verified blocked-site settings; auth sessions use `chrome.storage.session`.
- `alarms` schedules status rechecks without a continuously running timer.
- `declarativeNetRequestWithHostAccess` installs redirect and session allow rules only for hosts granted by the user.
- `*://*/*` is declared as an **optional** host pattern only so the extension can request a variable list of configured domains. It is never requested as a whole. Configuration prompts ask only for the backend and Supabase hosts; **Enable website blocking** asks only for enabled domain patterns (`*://*.domain/*`). Chrome host permissions are not port-scoped, so a grant applies to that hostname on any port. HTTPS is required for non-local origins.
- `blocked.html` is a web-accessible extension resource so a DNR redirect can show the block page. No arbitrary site access is granted by this declaration.

Chrome 111 or later is required because the extension uses session-scoped DNR rules for temporary session allowances. The extension reads blocked-site settings from the authenticated status response; it does not make a second request to `/api/extension/blocked-sites`.

For deployment, configure the deployed FocusLock HTTPS origin and the project's HTTPS Supabase URL. Check those origins carefully in Chrome's permission prompt. Reload the extension after building if its bundled Supabase SDK changes.

## Website blocking

- Blocking uses Manifest V3 `declarativeNetRequest` rules for top-level HTTP(S) navigation. The URL filters use Chrome's `||domain^` boundary syntax and cover the configured domain and its subdomains. Disabled entries are ignored.
- The current status response is the source for blocked-site settings and the session. A matching active session must have a valid backend-supplied expiration time more than 60 seconds in the future before allow rules are installed. Otherwise only blocking rules are installed.
- Persistent dynamic DNR rules block configured permitted hosts, and session-scoped DNR allow rules permit them only after the authenticated status API confirms an active session. Session-scoped rules are cleared when Chrome shuts down. A Chrome alarm rechecks authenticated status every 30 seconds and is scheduled no later than 60 seconds before session expiry. Each check first removes allow rules, restores redirects, and replaces already-open blocked-site tabs with the blocked page. If authentication, network, or response validation fails, only blocking rules remain.
- Previously validated block settings are retained in local extension storage for offline fail-closed behavior. Before a successful first status response, the extension uses the same eight default domains as the current backend.
- FocusLock backend and Supabase hostnames are excluded from blocking. The blocked page is exposed as a web-accessible extension resource only so DNR redirects can display it; it contains no credentials.
- Chrome alarm delivery and browser scheduling are not real-time guarantees. Also, a session explicitly ended elsewhere may remain authorized until the next status alarm (up to about 30 seconds during normal operation). Users can revoke host permissions, which necessarily disables blocking for those hosts. This is a prototype deterrent, not security enforcement.

## Reward-backed sessions

- The popup obtains the available balance and any active session only from `GET /api/extension/status`. It offers 5, 10, 15, 30, and 60-minute sessions, remembers the preferred duration, and disables choices above the displayed earned balance. To start a session it sends `requestedMinutes` to `POST /api/extension/session/start`; the server and `spend_reward_minutes` RPC enforce the supported duration and current ledger balance, then create the session and matching spend entry atomically. The extension never submits a balance, score, expiration, or reward amount as authority.
- The start response contains the server-created session and updated `availableMinutes`. The extension then fetches status again and only treats the session as confirmed when the backend reports the same session ID with valid timestamps. Session allow rules are still generated only from that verified status.
- `POST /api/extension/session/end` sends the active `sessionId`. The backend verifies ownership and ends the session; ending early does not refund spent minutes. A fresh status response must confirm the session is no longer active before the popup reports success.
- Quiz evaluation awards 10 minutes for a server-calculated score of at least 80%. The quiz answer key is recovered from the server-issued quiz token, and the database persistence path rejects replayed quiz attempts. The extension does not evaluate quizzes or calculate rewards.
- For fail-closed navigation, a session is considered usable only while its verified expiration is more than 60 seconds away. The popup therefore does not offer a one-minute session as an unlock choice, and configured access stops with a one-minute safety margin. This means a portion of the purchased session duration is intentionally not usable by the extension.
- Apply `supabase/migrations/20261017000001_limit_reward_session_duration.sql` through the project's normal deployment process before enabling reward sessions in a deployed environment. It adds the 180-minute cap inside the callable database RPC as defense in depth; this repository change does not apply the migration to any database.
- These flows depend on the web app backend and the relevant database migrations/RPCs being deployed. The repository tests do not prove the complete extension/backend/database flow; test it manually with a non-production account before relying on it.

## Tests

Run the extension authentication tests with the rest of the repository suite:

```sh
npm test
```

## Temporary session diagnostics

To inspect one session lifecycle, open `chrome://extensions`, locate FocusLock Guardian, click **service worker / Inspect**, and run this single command in the service worker console:

```js
chrome.runtime.sendMessage({ type: "GET_DNR_DIAGNOSTICS" }, console.log)
```

The response includes the current YouTube dynamic/session DNR rules, current server session authorization and expiry, current expiry alarm, and the last 40 sanitized lifecycle events from extension-local storage. Start and expiry checkpoints include rule snapshots before/after reconciliation, HTTP status, and whether the server response confirmed session creation. It does not record credentials, tokens, headers, or response bodies. The timeline is bounded and can be removed after diagnosis by deleting `focusLockSessionDiagnostics` from `chrome.storage.local`; to remove the temporary instrumentation from code, remove `GET_DNR_DIAGNOSTICS`, `DIAGNOSTIC_KEY`, `recordSessionDiagnostic`, `getYouTubeRuleSnapshot`, and the `recordSessionDiagnostic` calls. Keep the HTTP status/server-created metadata plumbing in `auth-core.js` if it remains useful to the product.

## Known limitations

- Extension sign-up, password reset, and OAuth are not implemented. Account creation and email confirmation use the existing FocusLock web app.
- The auth session is intentionally temporary and does not survive a complete Chrome restart.
- MV3 service workers can be suspended; Chrome alarms and browser startup trigger status reconciliation without relying on a continuously running timer. Active session allow rules are session-scoped and are removed on browser shutdown.
- Blocking applies to top-level HTTP(S) navigations only. It does not block embedded media, in-page navigation, alternate browsers, or sites when the extension is disabled.
- Browser-level behavior for session creation, early termination, worker restart, alarm timing, and DNR reconciliation has not been manually verified in Chrome.
- This is a development integration, not a production-ready extension.
