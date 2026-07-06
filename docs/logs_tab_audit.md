# 🔬 PRISM Logs & Debug Tab — World-Class Hardcore Audit

**Date:** 2026-07-04  
**Auditor:** Claude Opus 4.6  
**Files Audited:**

- [tab-logs.html](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.html) (361 lines)
- [tab-logs.js](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js) (1139 lines)
- [tab-logs-ui.test.ts](file:///d:/Projects/Prism/tests/tab-logs-ui.test.ts) (511 lines)

---

## Executive Verdict

The Logs & Debug tab is the **most feature-dense tab in the dashboard** — it packs 11 distinct panels into a single view (Support Desk, Quick Actions, Pending Approvals, Action History, Chat Telemetry, Correlated Traces, Recent Events, Tool Call Log, Activity Log, Unified Telemetry Stream, Live Timeline, Operator Identity & Sessions, MCP Servers, and Live Console). Despite its breadth, it has **serious systemic issues** across security, UX consistency, architecture, and test coverage that need remediation.

Current Score: 5.5 / 10

---

## 🔴 Critical Issues (P0)

### Item 1: 15 raw `alert()` calls — the worst offender in the entire codebase

The Logs tab contains **15 `alert()` calls** — more than any other tab module. Every other tab has been progressively migrated to `showTransientNotice()`, but this tab was missed entirely.

| Line | Call                                                   |
| ---- | ------------------------------------------------------ |
| 736  | `alert('Reconnect failed: ...')`                       |
| 739  | `alert('Reconnect error: ...')`                        |
| 806  | `alert('Console logs copied to clipboard!')`           |
| 808  | `alert('Failed to copy logs: ...')`                    |
| 816  | `alert('Activity logs copied to clipboard!')`          |
| 818  | `alert('Failed to copy logs: ...')`                    |
| 826  | `alert('Unified telemetry logs copied to clipboard!')` |
| 828  | `alert('Failed to copy logs: ...')`                    |
| 851  | `alert('Please fill out both Title and Description.')` |
| 881  | `alert('Failed to create ticket: ...')`                |
| 983  | `alert('Failed to update ticket: ...')`                |
| 1015 | `alert('Self-healing failed: ...')`                    |
| 1024 | `alert('Resolution description is required...')`       |
| 1039 | `alert('Failed to resolve ticket: ...')`               |
| 1052 | `alert('Failed to delete ticket: ...')`                |

**Fix:** Replace every `alert()` with `showTransientNotice()` — success cases use `'success'` severity, errors use `'error'` severity.

---

### Item 2: `prompt()` used for ticket resolution — blocking, unstyled, no validation

[Line 1020](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L1020): `resolveSupportTicketPrompt()` uses `const log = prompt(...)` for resolution notes. This is the same class of issue fixed in the Agentic Tab audit (Item 1).

**Fix:** Replace with `showPrompt()` (already exported from `dashboard-core.js` and imported by other tabs).

---

### Item 3: Inline `onclick` with raw IDs — XSS injection vector

Multiple render functions interpolate raw IDs into `onclick` handler strings:

| Location                                                                        | Pattern                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [L34](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L34)       | `onclick="loadTrace(&quot;' + escapeHtml(trace.correlationId) + '&quot;)"`        |
| [L97](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L97)       | `onclick="runAction(this.dataset.action)"` — ✅ already uses data-attr            |
| [L115](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L115)     | `onclick="approve(this.dataset.approvalId)"` — ✅ uses data-attr                  |
| [L550](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L550)     | `onclick="toggleSupportItem(\\'' + escapeHtml(item.id) + '\\')"`                  |
| [L708](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L708)     | `onclick="window.reconnectMcpServer(' + escapeHtml(JSON.stringify(s.name)) + ')"` |
| [L936-952](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L936) | Investigate/Self-Heal/Resolve/Delete buttons with `ticketId` in onclick           |
| [L958](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L958)     | `onclick="window.toggleSupportItem(\\'' + t.ticketId + '\\')"`                    |

While `escapeHtml` mitigates the worst of it, the pattern is fragile and inconsistent with the delegated-handler approach established by the Agentic Tab audit.

**Fix:** Use `data-*` attributes and delegated event listeners for all dynamically-rendered interactive elements.

---

### Item 4: Duplicate `getAuthToken()` and `authedFetch()` — violates DRY, bypasses `request()`

[Lines 641-655](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L641): The tab defines its own `getAuthToken()` and `authedFetch()` functions, which are **exact copies** of functionality already exported by `dashboard-core.js` (`authHeaders()` and `request()`). The MCP and Console API calls use `authedFetch()` instead of the shared `request()`.

Problems:

- If `request()` gets a timeout enhancement (it already has one — 30s), these calls don't benefit.
- If auth token format changes, two places need updating.
- `authedFetch()` also re-implements the `/api/` → `/api/v1/` URL rewriting that `request()` already handles.

**Fix:** Delete `getAuthToken()` and `authedFetch()` entirely. Use `request()` for MCP/console API calls, or at minimum use the shared `authHeaders()` and `wsUrl()`.

---

## 🟡 Significant Issues (P1)

### Item 5: `captureIncidentBundle()` uses raw `fetch()` without auth headers

[Line 161](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L161): The incident bundle download calls `fetch('/api/incidents/bundle', { method: 'POST' })` — **no auth token** is attached. On any deployment with authentication enabled, this will return `401 Unauthorized`.

**Fix:** Use `request()` or at minimum attach `authHeaders()`.

---

### Item 6: `triggerSelfHealingSweep()` is theatrical, not functional

[Lines 585-630](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L585): The "self-healing sweep" does the following:

1. Pushes 4 hardcoded log messages with `setTimeout` delays (350ms apart)
2. After 1800ms, sets ALL catalog items to "Verified" / "100% Verified Secure"
3. Shows a success notice

This performs **zero actual diagnostics**. It does not call any backend diagnostic API, does not run health checks, and does not inspect real system state. The same is true for `selfHealSupportTicket()` at [L987](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L987) — it calls `triggerSelfHealingSweep()` then auto-resolves the ticket after 1800ms with a canned resolution string.

**Fix:** Wire to the real diagnostic API (`/api/diagnostics/run`), or at minimum make the UI transparent that this is a "check connectivity" quick-test rather than claiming "world-class AI diagnostic sweep" verified everything "100% correct".

---

### Item 7: `defaultSignatures` catalog is hardcoded and static

[Lines 471-516](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L471): The Support Desk's diagnostic signatures are 4 hardcoded objects with static descriptions like "Web Builder Specialized Skills Engine" and "OpenAI Migration Adaptability Shield." These are not derived from real system state and do not update when actual issues occur.

**Fix:** Fetch the diagnostic catalog from a backend API (e.g., `/api/support/catalog` or `/api/diagnostics/signatures`) so it reflects real system health. The hardcoded array can remain as a fallback.

---

### Item 8: No concurrency guard on `initLogsTab()`

The `_logsWired` flag at [L634](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L634) prevents re-initialization, but there's no guard against concurrent tab switching triggering multiple `refreshMcpServers()` or `loadSupportTickets()` calls during the first init. Also, the `_mcpInterval` (5-second MCP polling) is never cleaned up when switching away from the Logs tab — it runs forever.

**Fix:**

- Add a cleanup function that clears `_mcpInterval` when leaving the tab (similar to how `stopSloAutoRefresh()` works for the Telemetry tab).
- Guard with an `_initInProgress` flag to prevent concurrent initialization.

---

### Item 9: WebSocket attach fallback creates an unmanaged second connection

[Lines 1117-1135](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L1117): After 20 failed attempts (5 seconds) to find the global WebSocket, the code creates a brand-new `WebSocket` connection (`_consoleWs`). This second socket is **never closed** and has **no reconnection logic**. If the main WS reconnects, both sockets receive events, creating duplicate log entries.

**Fix:** Piggyback on the main WS connection exclusively. The `dashboard-app.js` already stores the WS reference at `window.dashboardWs`. Add a `'console'` message handler to the central WS message dispatcher instead of creating a side channel.

---

### Item 10: MCP Servers panel is outside the `tab-grid` container

[Line 305](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.html#L305): The MCP Servers `<section>` and Live Console `<section>` sit **outside** the closing `</div>` of `tab-grid` (which closes at line 297). This means:

- They don't participate in the CSS grid layout
- They have an inconsistent `margin-top:16px` instead of the grid gap
- They look orphaned when the tab has no other full-width panels visible

**Fix:** Move MCP Servers and Live Console sections inside the `tab-grid` div with `grid-column:1/-1`.

---

## 🟠 Moderate Issues (P2)

### Item 11: Three nearly identical "Copy Logs" functions

[Lines 803-830](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L803): `copyLiveConsole()`, `copyActivityLogs()`, and `copyUnifiedTelemetry()` each:

1. Format entries into text
2. Call `navigator.clipboard.writeText()`
3. Show `alert()` on success/failure

They should be a single helper like `copyToClipboard(text, label)`.

---

### Item 12: `renderUtEntries()` rebuilds all 200 entries on every single new message

[Lines 207-243](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L207): Every `pushUtEntry()` call triggers a full `innerHTML` replacement of up to 200 entries. At high event throughput (which is expected for a unified telemetry stream), this causes significant DOM thrashing.

**Fix:** Use `insertAdjacentHTML('beforeend', ...)` for new entries and trim old entries from the top, similar to `appendLogsLiveTimelineEvent()`.

---

### Item 13: `renderLiveConsole()` also does full innerHTML rebuild

Same pattern as Item 12 — [line 772](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L772) rebuilds the entire console view. The `renderLiveConsole` function creates the full visible HTML from scratch for every new line.

---

### Item 14: Inconsistent data flow — some panels use `request()`, some use `authedFetch()`, one uses raw `fetch()`

| Function                          | API call method              |
| --------------------------------- | ---------------------------- |
| `captureIncidentBundle()`         | Raw `fetch()` — no auth      |
| `refreshMcpServers()`             | `authedFetch()` — local copy |
| `reconnectMcpServer()`            | `authedFetch()` — local copy |
| `initLogsTab()` console hydration | `authedFetch()` — local copy |
| `hydrateUnifiedTelemetry()`       | `request()` — shared ✅      |
| `submitSupportTicket()`           | `request()` — shared ✅      |
| `loadSupportTickets()`            | `request()` — shared ✅      |

**Fix:** Standardize everything on `request()`.

---

### Item 15: Unified Telemetry filter event listeners bound via `setTimeout(100)`

[Lines 381-403](file:///d:/Projects/Prism/src/core/operator/public/tab-logs.js#L381): Filter listeners for the Unified Telemetry panel are bound with a `setTimeout(100)` at module load time. This is fragile — if the HTML fragment hasn't been lazily loaded when this fires, no listeners are attached, and the filters silently don't work.

**Fix:** Move filter wiring into `initLogsTab()` so it runs after the HTML is guaranteed present.

---

## 🔵 Test Coverage Gaps

### Item 16: No tests for the Support Desk subsystem

The test file covers 6 render functions (Events, Traces, Actions, Approvals, ActionHistory, ToolCallLog) but has **zero test cases** for:

- `renderSupportCatalog()`
- `renderSupportTickets()`
- `filterSupportCatalog()`
- `toggleSupportItem()`
- `initializeSupportDesk()`
- `triggerSelfHealingSweep()`
- Ticket lifecycle (submit, investigate, self-heal, resolve, delete)

### Item 17: No tests for Unified Telemetry rendering

- `renderUtEntries()` — no tests
- `pushUtEntry()` — no tests
- `clearUnifiedTelemetry()` — no tests
- `handleTelemetryWsMessage()` — no tests
- Filter logic (`utShouldShow()`) — no tests

### Item 18: No tests for Live Console or MCP Servers

- `renderLiveConsole()` — no tests
- `renderServers()` — no tests
- `pushConsoleEntry()` — no tests
- Console source filter — no tests
- `reconnectMcpServer()` — no tests

### Item 19: No tests for Operator Identity & Tab Sessions

- `refreshIdentityPanel()` — no tests
- `refreshTabSessions()` — no tests

---

## 📊 Summary

| Category                         | Items                       | Severity |
| -------------------------------- | --------------------------- | -------- |
| **`alert()` cleanup**            | 15 calls                    | 🔴 P0    |
| **`prompt()` replacement**       | 1 call                      | 🔴 P0    |
| **XSS / onclick injection**      | ~10 handlers                | 🔴 P0    |
| **DRY violation (auth helpers)** | 2 duplicate functions       | 🔴 P0    |
| **Auth bypass in bundle export** | 1 unauthenticated fetch     | 🟡 P1    |
| **Theatrical diagnostics**       | 2 fake sweep functions      | 🟡 P1    |
| **Hardcoded catalog**            | 1 static array              | 🟡 P1    |
| **No interval cleanup**          | 1 leaked timer              | 🟡 P1    |
| **Orphan WebSocket**             | 1 unmanaged connection      | 🟡 P1    |
| **Layout breakage**              | 2 panels outside grid       | 🟡 P1    |
| **Duplicate copy helpers**       | 3 near-identical functions  | 🟠 P2    |
| **DOM thrashing**                | 2 full-rebuild renders      | 🟠 P2    |
| **Inconsistent fetch**           | 3 different patterns        | 🟠 P2    |
| **Fragile filter wiring**        | 1 setTimeout race           | 🟠 P2    |
| **Test coverage**                | 4 major untested subsystems | 🔵 Test  |

Total Items: 19
