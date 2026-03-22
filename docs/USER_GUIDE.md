# PRISM User Guide

Date: 2026-03-11

## 1. What PRISM is

PRISM is a governed autonomous agent runtime that acts as your infrastructure for Agents As A Service (AaaS). It can execute operations across your computer environment, bridging machine automation and human calendar/project management for a " Return of Growth and Integrity.

Research context reference:

- `PRISM_RESEARCH_DOCUMENTATION.md` (full-context rationale for governance, workflows, and safety model).

It is designed for high-trust operation:

- transparent decisions,
- explicit approvals for high-risk actions,
- recoverable workflows,
- complete activity traces.

## 2. What you can do with PRISM today

- run tiered autonomous operations
- enforce approval for high-risk actions
- execute multi-step workflows with retries, timeout, and fallback
- query memory of prior operations (`semantic_query`, `memory_query`)
- inspect persisted traces in SQLite

## 3. Safety model you should understand

### 3.1 Authority tiers

- `tier1_autonomous`: low-risk operations run automatically.
- `tier2_conditional`: medium-risk operations require additional governance constraints.
- `tier3_approval`: high-risk operations pause for explicit approval.

### 3.2 Approval outcomes

A high-risk action can:

- be approved,
- be denied,
- time out (treated as denied behavior).

Workflows may:

- fail (if no recovery path exists), or
- continue through fallback routes (if configured).

## 4. Quick Start

### 4.1 One-click dashboard startup (Windows)

1. Double-click `start_web.bat`
2. Wait for startup logs
3. Browser opens automatically to `http://localhost:7070`

From the dashboard you can:

- view runtime status,
- trigger built-in demo actions from the Actions panel,
- review pending approvals,
- approve/deny Tier-3 requests,
- inspect recent activity events.

### 4.2 CLI startup options

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Start runtime demo:
   - `npm start`
4. Start persistent server mode:
   - `npm run start:server`
5. Run tests:
   - `npm test`

## 5. Dashboard Navigation

The PRISM dashboard (`http://localhost:7070`) is the primary operator interface. It uses a tab-based layout with collapsible panels for organized access to all runtime features.

### 5.1 Tab system

The dashboard provides five tabs across the top navigation bar:

| Tab | Description |
| --- | --- |
| **Chat Interface** | Conversational interface for interacting with the active LLM provider. Messages are scoped to the current chat session. |
| **Provider & Settings** | Configure LLM providers, review model capabilities, adjust runtime settings, and audit provider switch history. |
| **Tools & Plugins** | Browse all registered built-in tools, MCP plugins, and system utilities. |
| **Telemetry** | View runtime performance metrics, retrieval quality cohorts, and alert status. |
| **Logs & Debug** | Inspect the live activity event stream, errors, and debug-level trace output. |

Click any tab label to switch views. The active tab is visually highlighted and persists across data refreshes within your session.

### 5.2 Collapsible panels

Every panel within each tab has a collapsible header. Click the panel header (or the chevron indicator `▼`/`▶`) to toggle the panel body between expanded and collapsed states. This lets you focus on the panels most relevant to your current task without scrolling through unneeded information.

### 5.3 Provider & Settings tab

This tab contains five panels arranged top-to-bottom:

**Session Provider Assignment** — Shows the LLM provider and model currently bound to your active chat session. Use the dropdown selectors to choose a different provider/model, then click **Apply** to persist the change for that session.

**Provider Configuration** — Displays per-provider configuration for all supported LLM providers (OpenAI, Anthropic, Ollama, Custom). For each provider you can review or edit:

- Base URL
- Comma-separated model list
- Default model
- API key presence (shown as `hasApiKey: true/false`; keys are never displayed)

Use the **Save** button to persist non-secret settings. Use the **Store API Key** and **Clear API Key** buttons for secure credential management.

**Model Capability Matrix** — A comparison grid showing per-model capabilities including context window size, vision support, function calling, and streaming. Toggle visibility with the panel header.

**Settings** — Displays runtime system configuration:

- Server uptime and event count
- Server running status
- PRISM version and Node.js platform
- Runtime readiness state
- Currently active LLM provider and model

**LLM Audit Trail** — Session-scoped audit of provider/model switch events. Shows:

- Success and failure counts for provider switches
- Recent transition history (`requested → selected`)
- **Export JSON** — Download the full audit payload as a `.json` file
- **Copy JSON** — Place the audit payload on your clipboard
- **Export CSV** — Download as a `.csv` file for spreadsheet analysis

### 5.4 Tools & Plugins tab

This tab contains three panels that inventory all PRISM capabilities:

**Tools** — Lists all 19 built-in tools organized into four categories:

- **System** (7 tools): `file_read`, `file_write`, `file_delete`, `file_list`, `shell_exec`, `terminal_session`, `container_sandbox`
- **Application** (5 tools): `email_ops`, `calendar_plan`, `notes_extract`, `tasks_timeline`, and `neo4j_query`-adjacent capabilities
- **Knowledge** (3 tools): `neo4j_query`, `memory_query`, `semantic_query`
- **Integration** (4 tools): `http_request`, `nexus_check_hotline`, `nexus_read_memory`, `nexus_log_insight`, `nexus_broadcast`

Each tool entry shows:

- Tool name and one-line description
- Risk level badge (green = low, amber = medium, red = high)
- Mutation badge (green = read-only, amber = mutating)

**Plugins** — Lists all 7 registered MCP server plugins organized by source:

- **In-Repo** (2 plugins): `ids-mcp` (identity services), `web-search-mcp` (web search)
- **ImpressionCore Suite** (5 plugins): `impressioncore-eds` (data services), `impressioncore-ipa` (process automation), `impressioncore-goliath` (data pipelines), `impressioncore-vrgc` (visual rendering), `impressioncore-dpa` (document processing)

Each plugin entry shows:

- Plugin name and server type (Python MCP Server)
- One-line description of capabilities
- Active/Inactive status badge

**Utilities** — Lists all 30 system utilities organized into six categories:

- **Benchmarks & Qualification** (11): performance harnesses, qualification suites (e1–e4), release validation, CI gates, event lineage bundles
- **Operator Services** (5): SelfReviewScheduler, SessionTraceExplorer, PolicyAuditExporter, SessionPackageSqliteStore, DashboardService
- **Memory & Retrieval** (5): SemanticMemoryIndex, EpisodicMemory, SessionMemoryStore, RetrievalMetricsCollector, RetrievalDashboardStore
- **Activity & Audit** (3): ActivityBus, SqliteActivityStore, ConsoleActivitySubscriber
- **Replay & Verification** (3): normalizeReplayEvent, buildReplaySignature, compareReplayParity
- **Configuration** (3): resolveExecutionProfileFromEnv, resolveEnvironmentProfile, getPerformanceSloProfile

Each utility entry shows its name and a brief description of its function.

## 6. Approval workflow (operator perspective)

When a Tier-3 action is triggered, PRISM emits:

- approval request event,
- pending approval ID,
- approve/deny endpoints,
- timeout window.

Operator options:

- approve action,
- deny action,
- do nothing (timeout).

Expected behavior:

- approved action executes,
- denied/timed-out action is blocked,
- workflow either fails or takes fallback route.

## 7. Memory tools

### 7.1 semantic_query

Purpose:

- retrieve semantically similar events to a query string.

### 7.2 memory_query

Modes:

- `semantic`
- `episodic_recent`
- `session_summary`
- `all`

Typical use:

- inspect what happened,
- recover context,
- inform next action selection.

## 8. Workflow behavior in plain language

A workflow is a sequence of steps. Each step can be retried and can have a timeout.

If a step fails or times out:

- PRISM checks whether a fallback route is defined.
- If yes, PRISM continues via fallback.
- If not, workflow ends as failed.

This is intentional and tested behavior.

## 9. Operational troubleshooting

### 9.1 High-risk step never executed

Possible causes:

- approval denied,
- approval timeout,
- policy denied operation before approval.

Check:

- governance events in activity trace,
- approval queue activity.

### 9.2 Workflow unexpectedly failed

Check:

- whether failure step had fallback rule,
- whether fallback condition matched actual outcome,
- whether retries were exhausted.

### 9.3 Memory query seems weak

Check:

- query wording specificity,
- session size,
- retrieval metrics and latency output.

## 10. Best practices for operators

1. Keep rollback plans explicit for mutating actions.
2. Use staged workflows for critical operations.
3. Require approval for any sensitive file/system changes.
4. Monitor retrieval quality and investigate drift.
5. Review traces after incidents and update policy/tool rules.

## 11. Security and trust expectations

PRISM is designed to increase trust through:

- deterministic governance decisions,
- explicit approval boundaries,
- auditable event streams,
- fail-safe timeout/denial handling.

## 12. Where to learn more

- Architecture and strategy: `README.md`
- Product requirements and roadmap intent: `PRISM_PRD.md`
- Engineering implementation standards: `DEVELOPER_GUIDE.md`
- Milestone status: `ROADMAP.md`

## 13. External references

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
