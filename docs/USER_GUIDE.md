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
- bind character identities to operators with full accountability chains
- enforce profile-aware email domain validation (business vs individual)
- activate Spectrum Refraction (SR) for tri-model parallel generation with structured aggregation

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

## 4A. Setup Wizard

PRISM includes guided setup wizards to help you configure the system on first run. Three wizard surfaces are available — choose whichever matches your workflow.

### 4A.1 When to use each wizard

| Surface | Best for | Launch method |
| :--- | :--- | :--- |
| **Web Wizard** | Browser-based users, visual configuration | `start_wizard.bat` or navigate to `http://localhost:7070/setup` |
| **Web Advanced Wizard** | Power users who want routing, guardian, CAC, and scheduler config | Navigate to `http://localhost:7070/setup/advanced` |
| **TUI Wizard** | Terminal users with a rich terminal (colors, Unicode) | `start_tui.bat` → Setup Wizard tab |
| **CLI Wizard** | Headless, SSH, Docker, CI environments | `npm run setup` or `start_wizard.bat --cli` |

### 4A.2 Web Setup Wizard (4-step basic)

The web wizard guides you through four steps:

1. **Execution Profile** — Choose `Individual` (fast defaults, maximum capability) or `Business` (strict governance, approval pathways).
2. **Workspace Directory** — Validate or change the `Prism_Refraction` workspace location. The wizard runs prerequisite checks (Node.js version, disk access, workspace structure).
3. **LLM Provider** — Select your primary provider (Ollama, OpenAI, Anthropic, Google, Mistral, Groq, Together, DeepSeek, OpenRouter, etc.). Enter an API key if required. Use the "Test Connection" button to verify reachability.
4. **Summary** — Review your selections, see the readiness check results, and launch PRISM.

**To launch:** Run `start_wizard.bat` (Windows) or navigate to `http://localhost:7070/setup` in your browser while the server is running. To re-run later, click the "✨ Setup Wizard" button in the dashboard sidebar or go to Provider & Settings → Setup Wizard → "Re-run Setup Wizard".

### 4A.3 Web Advanced Wizard (8-step)

The advanced wizard extends the basic flow with four additional configuration steps:

1. **Model Routing** — Choose between Single Provider, Multi-Provider, or Modality-Based routing. Assign specific models to task roles (chat, code-generation, summarization, etc.) and accept AI-suggested optimal assignments.
2. **Guardian Agent** — Configure the Guardian Agent's model, governance tier, and auto-start behavior.
3. **Identity (CAC)** — Bind a character persona to an operator identity with email validation. Configure workspace hub for persistence.
4. **Browser & Scheduler** — Set up browser automation profiles and pre-configure scheduled jobs.

At completion, the advanced wizard generates an **Initialization Certificate** — a packaged session record documenting every configuration choice for audit and compliance.

### 4A.4 TUI Setup Wizard

The TUI wizard mirrors the 4-step basic web wizard in a terminal-native interface built with React/Ink:

- **Navigation:** Arrow keys to move, Space to select, Enter to confirm, Escape to go back.
- **API Key input:** Press `K` on the provider step to enter an API key (masked input).
- **Progress:** Visual progress bar at the top shows current step.

Launch via `start_tui.bat` and select the Setup Wizard tab.

### 4A.5 CLI Setup Wizard

A pure readline-based wizard for headless and minimal environments. Zero UI dependencies — works over SSH, in Docker containers, and CI pipelines.

**Launch:**

```bash
# Interactive 4-step wizard (auto-detects server)
npm run setup

# Via batch file (Windows)
start_wizard.bat --cli

# Via shell script (Linux/macOS)
./start_wizard.sh --cli

# Non-interactive mode (all options via flags)
npm run setup -- --non-interactive --profile individual --provider ollama

# Standalone mode (no server needed)
npm run setup -- --standalone --non-interactive --profile individual --workspace /data/Prism_Refraction --provider ollama
```

**Modes:**

- **Connected** (default): Auto-detects PRISM server and uses the same `/api/setup/*` endpoints as the web wizard. Provider connectivity test included.
- **Standalone** (`--standalone` or auto-detected if server unreachable): Writes `.prism-preferences.json` directly using workspace-resolver functions. No server required.
- **Non-interactive** (`--non-interactive`): No prompts — reads all config from CLI flags and environment variables. Exit code `0` = success, `1` = failure, `2` = cancelled/missing args.

**Features:**

- Arrow-key selection menus with visual feedback
- Masked API key input for cloud providers
- Inline provider connectivity test (connected mode)
- Prerequisites checks (Node.js version, workspace directory)
- Readiness summary at completion
- Identical `.prism-preferences.json` output as web and TUI wizards

#### CLI Advanced Wizard (8-Step)

For deep configuration, use the advanced CLI wizard which mirrors the 8-step web advanced wizard:

```bash
npm run setup:advanced
```

Additional steps beyond the basic 4-step flow:

- **Model Routing** — Choose single, multi-model, or modality-aware routing with per-role model overrides
- **Guardian & Agents** — Select a GGUF model for local guardian, set authority tier and swarm topology
- **CAC Identity** — Bind a character to an operator identity for accountability
- **Browser & Scheduler** — Pre-configure browser automation profile and scheduled tasks
- **Initialization Certificate** — Auto-generated provenance certificate at completion

Profile-aware defaults are applied (e.g., business profiles default to strict governance tiers and star topology).

### 4A.6 Re-running the wizard

You can re-run the setup wizard at any time to change your profile, workspace, or provider:

- **Web:** Click "✨ Setup Wizard" in the sidebar, or go to Provider & Settings → Setup Wizard section → "Re-run Setup Wizard"
- **Direct URL:** `http://localhost:7070/setup?rerun=true`
- **TUI:** Navigate to the Setup Wizard tab
- **CLI:** `npm run setup` or `start_wizard.bat --cli`

### 4A.7 Troubleshooting

| Problem | Solution |
| :--- | :--- |
| Wizard page is blank | Ensure the server is running (`start_web.bat`). Check browser console for errors. |
| "Node.js 22+ required" check fails | Install Node.js 22 or later. Verify with `node --version`. |
| Provider test fails | Check that the provider is running (Ollama: `ollama serve`). For cloud providers, verify your API key. |
| Workspace directory check fails | Ensure the path exists and is writable. PRISM will create subdirectories automatically. |
| TUI wizard doesn't render | Ensure your terminal supports ANSI colors and Unicode. Try a modern terminal (Windows Terminal, iTerm2, Kitty). |

## 5. Dashboard Navigation

The PRISM dashboard (`http://localhost:7070`) is the primary operator interface. It uses a tab-based layout with collapsible panels for organized access to all runtime features.

### 5.1 Tab system

The dashboard provides nine tabs across the top navigation bar:

| Tab | Description |
| --- | --- |
| **Chat Interface** | Conversational interface for interacting with the active LLM provider. Messages are scoped to the current chat session. |
| **Provider & Settings** | Configure LLM providers, review model capabilities, adjust runtime settings, and audit provider switch history. |
| **Tools & Plugins** | Browse all registered built-in tools, MCP plugins, and system utilities. |
| **Agentic Control** | Manage agents, assign per-agent models, orchestrate swarms, and view intelligent telemetry. |
| **Computer Control** | Local system info, shell execution, vision framebuffer, device management, and policy controls. |
| **Workspace** | Workspace location management, file browser, import manager, workspace settings, and git integration. |
| **Network** | Execute curated network commands, view interface data, and monitor network operations with tier-based governance. |
| **Telemetry** | View runtime performance metrics, retrieval quality cohorts, and alert status. |
| **Logs & Debug** | Inspect the live activity event stream, errors, and debug-level trace output. |
| **Browser Control** | Playwright-powered browser automation with session management, viewport capture, network/console monitoring, DOM inspection, and governance-gated operations. |
| **Scheduler** | Full-year calendar, project management, kanban board, and Gantt timeline for scheduling and tracking work. |

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

**Spectrum Refraction (SR) Model Orchestration** — PRISM's novel tri-model parallel fan-out system. This panel lets you configure and activate SR mode, which generates simultaneously from three distinct model instances and fuses their outputs.

SR panel controls:

- **Left (Logic) Model**: Select a model qualified for analytical reasoning. The dropdown filters to logic-strength models via `filterSRLogicModels()`.
- **Right (Creative) Model**: Select a model qualified for creative synthesis and multimedia. The dropdown filters to creative-modality models via `filterSRCreativeModels()`.
- **Main (Coordination) Model**: Select the model that will aggregate Left + Right outputs into a unified response.
- **Isolation Badge**: Displays the current isolation quality level:
  - 🔒 **Full** — Different providers (strongest isolation: separate API keys, infrastructure, rate limits)
  - 🔏 **Model** — Same provider, different models (separate capabilities, shared key)
  - ⛔ **Insufficient** — Same provider + same model (REJECTED — Activate button disabled)
- **Cost Advisory**: Estimates per-generation cost based on model pricing.
- **Activate / Deactivate**: Enable or disable SR mode. Activation re-validates isolation before enabling.

When SR is active, chat messages are generated through the parallel fan-out pipeline:

1. Left and Right hemispheres generate concurrently on your prompt
2. Outputs are tagged with `<logic_analysis>` and `<creative_synthesis>` XML sections
3. Main model receives both tagged sections and produces a unified compound response
4. The response appears in Chat with an SR badge showing the isolation level

SR API endpoints (for programmatic access):

- `GET /api/sr/status` — Returns current SR configuration, active state, and isolation level
- `POST /api/sr/configure` — Set Left/Right/Main model assignments (validates isolation)
- `POST /api/sr/activate` — Enable SR mode (re-validates isolation)
- `POST /api/sr/deactivate` — Disable SR mode

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

### 5.5 Network tab

The Network tab provides dedicated network management capabilities organized into four collapsible panels:

**Network Tools** — A curated catalog of ~50 network commands classified by security tier:

- **Tier 1 — Diagnostics (Read-Only):** `ipconfig`/`ifconfig`, `ping`, `nslookup`/`dig`, `tracert`/`traceroute`, `netstat`/`ss`, `arp`, `hostname`, `nbtstat`, `pathping`, `getmac`, `net view`, `net statistics`, `curl`/`wget`, `ip addr`/`ip route`
- **Tier 2 — Config Inspection (Conditional):** `route print`, `netsh interface show`, `netsh wlan show`, `netsh firewall show`, `net use`, `net share`, `net session`, `net user`, `net localgroup`, `net config`
- **Tier 3 — Mutating Operations (Approval-Gated):** `netsh interface set`, `netsh interface ip set`, `netsh firewall set`, `netsh wlan connect/disconnect`, `route add/delete/change`, `net start/stop`, `ip addr add/del`, `ip route add/del`, `iptables`/`ufw`

Each command shows its name, description, tier badge (green/amber/red), and platform badge (WIN/LINUX/CROSS).

**Network Settings** — Displays live network interface data from the local host. Click "Refresh Interfaces" to query the system and display all adapter details (IP addresses, MAC addresses, DHCP status, DNS servers, etc.).

**Network Telemetry** — Dashboard showing network operation metrics: total commands executed, per-tier counts (Tier 1/2/3), error count, and most recent command.

**Network Console** — An interactive command console for executing network commands in real time. Type a network command and press Enter or click Run. Output is displayed in a monospace pre-formatted area. Only commands from the curated allowlist are permitted; blocked patterns are rejected.

### 5.6 Agentic Control tab

The Agentic Control tab is the operator interface for managing the PRISM agent fleet.

**Agent Management** — View all registered agents (built-in and dynamically spawned). Each agent card shows:

- Agent ID, role, and current lifecycle state (ephemeral / semi-permanent / permanent)
- Assigned LLM provider and model (overridable per-agent)
- Dispatch count, average response time, and last active timestamp
- Controls: Stop, Promote (ephemeral → semi-permanent → permanent), Demote, Reassign Model

Use the **Launch Agent** button to spawn a new agent instance with a selected role and model assignment.

**Per-Agent Model Assignment** — Each agent can be assigned a different LLM provider and model. The assignment is applied at dispatch time and confirmed in telemetry. Models can be switched dynamically on the fly without restarting the agent. The system uses the model capability matrix to validate that the assigned model meets the minimum tier requirement for the agent's role.

**Sub-Agent Control** — Displays the current task decomposition tree when the planner agent is active. Shows parent → child relationships, dependency links, and per-step status (pending / running / completed / failed).

**Swarm Control** — Orchestrate multi-agent goal completion using four topologies:

- **Mesh**: all agents communicate peer-to-peer
- **Star**: one coordinator dispatches to N workers
- **Pipeline**: sequential handoff from agent to agent
- **Broadcast**: one message to all agents, aggregate results

Create a swarm by selecting a topology, assigning agents, and defining the goal. The swarm coordinator manages lifecycle, timeout, and result aggregation.

**Agent Telemetry** — Intelligent tracking dashboard that learns from agent dispatch patterns:

- Dispatch frequency analysis per agent and role
- Model performance comparison (latency, token usage, quality proxy)
- Promotion recommendations (ephemeral agents that consistently perform well)
- Efficiency patterns and bottleneck detection
- Historical trends with configurable time windows

### 5.7 Scheduler tab

The Scheduler tab provides integrated project management and scheduling capabilities with four sub-views:

**Calendar** — A Google-like full calendar with year, month, week, and day views. Events are color-coded by category (meeting, deadline, milestone, reminder, blocked, general). Click any date to drill down; dots on mini-calendar cells indicate days with events. Create events via the **+ Event** button with title, date/time, category, location, and all-day support.

**Projects** — Card-based project overview showing all projects with progress bars, task counts, milestone counts, and completion percentages. Click a project card to see its milestones and tasks in a detail modal. Create projects via the **+ Project** button.

**Board** — A Kanban board with five columns: Backlog, To Do, In Progress, Review, and Done. Tasks are shown as draggable cards with priority indicators (colored left border), labels, assignees, and progress bars. Drag cards between columns to update task status. Create tasks via the **+ Task** button.

**Timeline** — A Gantt chart showing all tasks with start/end dates plotted on a time axis. Bars are color-coded by status. A vertical line marks today. The timeline auto-ranges to cover the current quarter.

**Scheduling engine** — The backend `SchedulerEngine` supports both one-time and recurring schedules using standard cron expressions. Scheduled actions are audited through the ActivityBus. Schedules are managed via the `/api/scheduler/schedules` API endpoint.

**Data persistence** — Calendar events are stored in `{workspace}/calendar/`, projects in `{workspace}/projects/`, and tasks within their respective project files. All data is JSON-backed and survives restarts.

### 5.8 Browser Control tab

The Browser Control tab provides Playwright-powered browser automation with full governance integration. It contains five sub-views:

**Sessions** — Manage browser sessions. Launch new sessions (headless or headed), view active session states, and close sessions. Each session runs in an isolated Playwright BrowserContext for security.

**Viewport** — Live browser interaction. Enter a URL in the address bar and navigate. Take screenshots of the current page (rendered as inline images). Use the click and type inputs to interact with page elements via CSS selectors.

**Network** — Network waterfall log showing all HTTP requests/responses captured during the session, including URL, method, status code, content type, and response size.

**Console** — Browser console output captured from the page, showing log level (log, warn, error, info, debug) and message text.

**DOM** — Full DOM snapshot of the current page rendered as syntax-highlighted HTML source.

## Appendix: Computer Use Core — Business Operator Guardrails (2026-03-25)

For Business profile operations, computer use must be treated as governed automation, not unconstrained autonomy.

Operator requirements:

1. Use approvals and confirmation checkpoints for consequential actions.
2. Run computer-use operations in sandboxed/isolated environments.
3. Validate audit traces for high-risk browser/terminal/container actions.
4. Treat external benchmark claims as informational unless explicitly marked Prism-validated.

Related references:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- `PRODUCTION_RELEASE_RUNBOOK.md`
- `BUSINESS_TRUST_PROVENANCE_POLICY.md`

**Governance** — Browser actions are gated by governance tiers. Navigation, click, and type are medium-risk. JavaScript evaluation is high-risk with rollback required. Screenshots and read-only operations are low-risk. All actions emit ActivityBus events for audit.

**Session lifecycle** — Sessions progress through states: `idle → launching → active ⇄ navigating → terminated`. Sessions auto-close after 10 minutes of inactivity.

## 6. Workspace & Persistence

PRISM stores all runtime artifacts, databases, and configuration in a persistent workspace directory outside the source tree. This prevents data loss during project updates and keeps the repository clean.

### 6.1 Default workspace location

| Platform | Default Path                                                                      |
|----------|-----------------------------------------------------------------------------------|
| Windows  | `%USERPROFILE%\Documents\Prism_Refraction`                                       |
| macOS    | `~/Documents/Prism_Refraction`                                                    |
| Linux    | `$XDG_DATA_HOME/Prism_Refraction` (fallback: `~/.local/share/Prism_Refraction`) |

Override the location by setting the `PRISM_WORKSPACE_ROOT` environment variable before starting PRISM.

### 6.2 Workspace structure

```
Prism_Refraction/
  prism-workspace.json        # manifest (version, creation date, profile, platform)
  config/                     # MCP settings, runtime config
  artifacts/
    benchmarks/               # performance qualification results
    releases/                 # release candidate packages
    self-review/              # self-review scheduler output
    contracts/                # tool contract snapshots and diffs
    ci-gates/                 # CI gate summaries
    packages/                 # session export packages
  data/
    tasks/                    # tasks tool data
    notes/                    # notes tool data
    email/                    # email tool data
    calendar/                 # calendar tool data
  state/
    container-snapshots/      # container sandbox snapshots
  characters/                 # agent character briefs (JSON)
  logs/                       # runtime logs
  workspace/                  # general workspace storage
```

### 6.3 Dashboard visibility

The **Settings** panel on the Provider & Settings tab shows the active **Workspace Root** path so you can always confirm where data is being stored.

### 6.4 Legacy path migration

If PRISM detects data at old CWD-relative locations (`prism-output/`, `prism-data/`, `prism-activity.db`, `.mcp/`), a console notice will suggest moving them to the new workspace. Existing environment variable overrides (`PRISM_DATA_DIR`, `PRISM_PERF_OUTPUT_PATH`, etc.) continue to take precedence over workspace defaults.

## 7. Approval workflow (operator perspective)

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

## 8. Memory tools

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

## 9. Workflow behavior in plain language

A workflow is a sequence of steps. Each step can be retried and can have a timeout.

If a step fails or times out:

- PRISM checks whether a fallback route is defined.
- If yes, PRISM continues via fallback.
- If not, workflow ends as failed.

This is intentional and tested behavior.

## 10. Operational troubleshooting

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

## 11. Best practices for operators

1. Keep rollback plans explicit for mutating actions.
2. Use staged workflows for critical operations.
3. Require approval for any sensitive file/system changes.
4. Monitor retrieval quality and investigate drift.
5. Review traces after incidents and update policy/tool rules.

## 12. Character Accountability & Identity

PRISM enforces a Character Accountability Control (CAC) model that links every agent action to a verifiable identity chain.

### 12.1 Identity fields you provide

When assigning a character to an agent session, the following identity fields are required:

| Field | Description |
| --- | --- |
| `characterId` | The character brief (from `characters/*.json`) defining the agent's persona and constraints. |
| `prismUserEmail` | The email of the Prism platform user under which the agent operates. |
| `operatorEmail` | The email of the human operator responsible for this session. |
| `clientId` | An identifier for the client application (e.g., dashboard, CLI, API caller). |
| `sessionId` | The current session identifier. |
| `executionProfile` | The target profile: `individual`, `business`, `enterprise`, or `corporate`. |

### 12.2 Profile behavior differences

- **Individual profile**: any valid email is accepted for both Prism user and operator. No domain constraints.
- **Business profile**: the Prism user and operator email domains must match. If an `allowedDomains` list is configured, both emails must belong to a listed domain.
- **Enterprise / Corporate**: these are aliases that resolve to the `business` profile and follow its rules.

### 12.3 Lifecycle states

Each character assignment progresses through these states:

1. **Assigned** — character is bound to operator/session; ready for dispatch.
2. **Active** — at least one dispatch has occurred.
3. **Suspended** — temporarily paused by operator or policy (with a reason code). No further dispatches until resumed.
4. **Revoked** — permanently terminated. Cannot be resumed.

### 12.4 Inspecting accountability traces

All activity events emitted during a governed session carry the full accountability chain:

- `characterId`, `prismUserEmail`, `operatorEmail`, `clientId`, `assignmentId`, `executionProfileSegment`

These fields are included in the SHA-256 integrity hash, so any post-hoc modification is detectable. Use the **Logs & Debug** tab or the `/api/events` endpoint to query events filtered by operator email, character ID, or profile segment.

### 12.5 Troubleshooting

- **"Domain mismatch" error on assignment**: In business profile, the Prism user and operator emails must share the same domain (e.g., both `@acme.com`). Switch to individual profile or ensure matching domains.
- **"Invalid email" error**: The email format is validated at assignment time. Ensure a valid `user@domain.tld` format.
- **Cannot resume a revoked assignment**: Revocation is terminal by design. Create a new assignment to continue.

## 13. Security and trust expectations

PRISM is designed to increase trust through:

- deterministic governance decisions,
- explicit approval boundaries,
- auditable event streams,
- fail-safe timeout/denial handling.

### 13.1 Session lifecycle

PRISM cannot be used until an operator chat session is established. Every tool execution, agent dispatch, and governance decision is scoped to the active session.

- **Individual profile**: A default session is created automatically on first launch.
- **Business profile**: You must explicitly create a session before any operations can proceed.

To create a session, use the **Chat** tab and click **New Session**. To switch sessions, use the session dropdown. All actions within a session are recorded and visible in that session's context.

### 13.2 Local-only data storage

All PRISM data — chat history, activity logs, model configurations, and agent state — is stored locally on your machine in the workspace directory (see Section 3 for the default location). No data is sent to external servers except LLM API calls to your configured providers.

### 13.3 API key security

LLM provider API keys are stored locally in the workspace and transmitted only to the respective provider API during generation requests. Keys are never logged in activity events, debug output, or chat history.

### 13.4 Localhost binding

The PRISM dashboard binds to `localhost:7070` by default, meaning it is accessible only from your local machine. No external network exposure is configured. If you need remote access, place PRISM behind a TLS reverse proxy.

### 13.5 Action visibility

Every action PRISM takes on your behalf is visible in two places:

- **Chat tab**: Tool calls appear inline in the conversation with tool name, arguments, result, and duration.
- **Logs tab**: The activity log shows a complete, filterable record of all events with severity levels, governance decisions, and timestamps.

This dual-surface visibility ensures no action is hidden from the operator.

### 13.6 Approval safeguards

High-risk operations (tier 3) require explicit operator approval before execution. If you do not respond within 2 minutes, the action is automatically denied. Approval requests appear in the dashboard and are never auto-approved.

## 14. Where to learn more

- Architecture and strategy: `README.md`
- Product requirements and roadmap intent: `PRISM_PRD.md`
- Engineering implementation standards: `DEVELOPER_GUIDE.md`
- Milestone status: `ROADMAP.md`

## 15. External references

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
