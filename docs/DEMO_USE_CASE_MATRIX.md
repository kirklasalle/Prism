# PRISM Demo Use-Case Matrix

> **Comprehensive front-to-back demonstration playbook covering every PRISM capability.**
>
> 43 scenarios · 8 categories · Individual & Business profiles · Fully programmatic execution
>
> All scenarios execute through the ActivityBus and produce structured artifacts in `prism-output/`.

---

## Quick Reference

| Category | Scenarios | Focus | Governance Tiers |
|----------|-----------|-------|-----------------|
| **A — Governance & Policy** | A1–A6 | Policy engine, tier progression, profile divergence | T1, T2, T3 |
| **B — Agent Lifecycle** | B1–B6 | Characters, promotion, swarm, guardian | T1, T2, T3 |
| **C — Computer Use** | C1–C8 | Browser, terminal, container, cross-tool | T1, T2, T3 |
| **D — Workflow Orchestration** | D1–D5 | DAG execution, fallback, recovery | T1, T2 |
| **E — Memory & Knowledge** | E1–E4 | Episodic, semantic, session, knowledge graph | T1 |
| **F — Dashboard & Operator** | F1–F5 | UI tabs, WebSocket, diagnostics, scheduler | T1, T2 |
| **G — Network & Integration** | G1–G4 | Network commands, MCP, Nexus bridge | T1, T2, T3 |
| **H — Release & CI** | H1–H5 | E-Stage2, performance, contracts, CI gates | T1 |

### Tags

| Tag | Meaning |
|-----|---------|
| 🎯 **Practical** | Real-world daily operator task |
| 🏢 **Professional** | Enterprise compliance, audit, governance |
| 🎮 **Fun** | Impressive demos, creative exploration |

---

## Category A — Governance & Policy Tiers

### A1: Tier 1 Autonomous Read-Only 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: `file_list`, `semantic_query`

> Demonstrates the zero-friction path for low-risk, read-only operations.

**Step-by-step**:

1. Initialize Orchestrator with Individual profile
2. Submit `file_list` operation targeting `./prism-output/`
3. PolicyEngine classifies as **Tier 1 autonomous** (read-only, no mutation)
4. Tool executes immediately — no approval required
5. Submit `semantic_query` for `"approval policy governance"`
6. PolicyEngine classifies as **Tier 1** — executes immediately
7. Verify: Both operations emitted `status: "succeeded"` ActivityBus events
8. Verify: No approval queue entries created

**Expected artifacts**: Activity events with `authorityTier: "tier1_autonomous"`, `policyDecision: "allow"`

---

### A2: Tier 2 Conditional Mutation with Rollback 🏢

**Profile**: Business · **Tier**: 2 · **Tools**: `file_write`

> Demonstrates the conditional execution path requiring rollback plans under Business governance.

**Step-by-step**:

1. Initialize Orchestrator with Business profile
2. Submit `file_write` to `prism-output/demo-a2.txt` with rollback plan `"delete prism-output/demo-a2.txt"`
3. PolicyEngine classifies as **Tier 2 conditional** (mutation, medium risk)
4. Business profile enforces rollback plan validation — plan is present, execution proceeds
5. File is written successfully
6. Verify: ActivityEvent includes `rollbackPlan` field and `authorityTier: "tier2_conditional"`
7. Verify: Audit trail captures full write operation with side effects

**Expected artifacts**: File `prism-output/demo-a2.txt`, activity event with `sideEffects` array

---

### A3: Tier 3 High-Risk Approval Flow 🏢

**Profile**: Business · **Tier**: 3 · **Tools**: `shell_exec`

> Demonstrates the full approval gate for high-risk operations: submit → queue → approve → execute.

**Step-by-step**:

1. Initialize Orchestrator with Business profile and approval queue
2. Submit `shell_exec` with destructive command `rm -rf /tmp/prism-demo-dir`
3. PolicyEngine classifies as **Tier 3 approval-required** (destructive mutation)
4. Operation pauses — approval request added to queue
5. **Programmatic auto-approve**: Simulate operator approval via `approvalQueue.approve(requestId)`
6. Operation resumes and executes
7. Verify: Activity events show `policyDecision: "require_approval"` → `status: "succeeded"`
8. Verify: Approval queue entry with `outcome: "approved"`

**Expected artifacts**: Approval queue record, activity chain with approval lifecycle

---

### A4: Approval Timeout → Denial Fallback 🏢

**Profile**: Business · **Tier**: 3 · **Tools**: `file_delete`

> Demonstrates the timeout-as-denial safety net when no operator responds.

**Step-by-step**:

1. Initialize Orchestrator with short approval timeout (2000ms)
2. Submit `file_delete` for a non-critical test file
3. PolicyEngine classifies as **Tier 3** — enters approval queue
4. **Do not approve** — let the timeout expire
5. Orchestrator treats timeout as denial — operation is rejected
6. Verify: Activity event shows `status: "failed"` with timeout details
7. Verify: No file was deleted — safety preserved

**Expected artifacts**: Activity event with `policyDecision: "require_approval"`, timeout failure

---

### A5: Business vs Individual Policy Divergence 🏢

**Profile**: Both · **Tier**: 1/2 · **Tools**: `file_write`

> Demonstrates the same operation producing different governance paths depending on profile.

**Step-by-step**:

1. Initialize Orchestrator with **Individual** profile
2. Submit `file_write` to `prism-output/demo-a5.txt`
3. Individual classifies as **Tier 2** — rollback plan *suggested* but not required
4. Operation executes (rollback plan optional)
5. Record result and policy decision
6. Re-initialize Orchestrator with **Business** profile
7. Submit identical `file_write` operation
8. Business classifies as **Tier 2** — rollback plan *required*
9. First attempt without rollback plan → **rejected**
10. Retry with rollback plan → succeeds
11. Verify: Both profiles produced different `policyDecision` details for the same operation

**Expected artifacts**: Comparative activity events showing profile divergence

---

### A6: Profile Hot-Switch Mid-Session 🎯

**Profile**: Both · **Tier**: 1/2 · **Tools**: `file_list`, `file_write`

> Demonstrates runtime profile switching maintaining session continuity.

**Step-by-step**:

1. Initialize with **Individual** profile
2. Execute `file_list` — Tier 1 autonomous
3. Execute `file_write` — Tier 2 with optional rollback
4. Switch execution profile to **Business** at runtime
5. Execute `file_list` — still Tier 1 autonomous (same for both profiles)
6. Execute `file_write` — now Tier 2 with *required* rollback (Business enforcement)
7. Verify: Session ID remains the same across profile switch
8. Verify: Policy decisions changed mid-session per new profile

**Expected artifacts**: Continuous activity chain with profile transition event

---

## Category B — Agent Lifecycle & Characters

### B1: Aria Individual — Personal Assistant Chat 🎮

**Profile**: Individual · **Tier**: 2 · **Character**: aria-individual

> Spawns Aria as a warm personal assistant and runs a multi-step assistance workflow.

**Step-by-step**:

1. Load `aria-individual` character definition from `characters/aria-individual.json`
2. Spawn agent via `AgentLifecycleManager.spawn()` with Aria character binding
3. Verify: Agent state is `assigned` → `active`
4. Dispatch task: "List files in the workspace" via `AgentPool.dispatch()`
5. Agent routes through `file_list` tool (Tier 1 — autonomous)
6. Dispatch task: "Write a summary to prism-output/aria-summary.txt"
7. Agent routes through `file_write` tool (Tier 2 — individual, rollback optional)
8. Verify: Both dispatches recorded in `AgentTelemetryCollector`
9. Verify: Accountability chain links `characterId: "aria-individual"` on all events

**Expected artifacts**: Agent instance, telemetry records, accountability-linked activity events

---

### B2: Phoenix Business — Innovation Consultant Research 🏢

**Profile**: Business · **Tier**: 2 · **Character**: phoenix-business

> Spawns Phoenix as corporate innovator and demonstrates tool-restriction enforcement.

**Step-by-step**:

1. Load `phoenix-business` character definition
2. Spawn agent with Business profile binding
3. Dispatch task requiring `web_search` — allowed for Phoenix Business
4. Verify: Search executes under Business governance
5. Dispatch task requiring `file_write` — allowed (Tier 2, rollback required)
6. Verify: Rollback plan enforcement under Business
7. Dispatch task requiring `shell_exec` — **denied** (Phoenix Business denies shell access)
8. Verify: Policy denial event emitted with `tool_denied` reason

**Expected artifacts**: Mixed success/denial activity events demonstrating character-level restrictions

---

### B3: Sentinel Business — Compliance Auditor 🏢

**Profile**: Business · **Tier**: 1 · **Character**: sentinel-business

> Spawns the most restrictive character and validates read-only enforcement.

**Step-by-step**:

1. Load `sentinel-business` character definition
2. Spawn agent — most restrictive: denies write, shell, HTTP
3. Dispatch `file_read` task — allowed (read-only)
4. Dispatch `semantic_query` task — allowed (read-only)
5. Dispatch `file_write` task — **denied** (Sentinel Business restricts writes)
6. Dispatch `shell_exec` task — **denied**
7. Dispatch `http_request` task — **denied**
8. Verify: Only 2 of 5 tasks succeeded, all denials logged with reason

**Expected artifacts**: Strict restriction enforcement log with characterId binding

---

### B4: Agent Promotion via Telemetry Threshold 🎯

**Profile**: Individual · **Tier**: 1/2 · **Character**: aria-individual

> Demonstrates automatic promotion recommendation based on dispatch telemetry.

**Step-by-step**:

1. Spawn agent at `tier_1` max authority
2. Execute 15 rapid dispatches (exceeds 10-dispatch threshold)
3. Ensure >80% success rate across dispatches
4. Query `AgentTelemetryCollector.suggestPromotions()`
5. Verify: Agent appears in promotion recommendations
6. Execute `AgentLifecycleManager.promote(agentId, "tier_2")`
7. Verify: Agent lifecycle state updated, promotion event emitted
8. Dispatch a Tier 2 operation — now succeeds (was previously restricted)

**Expected artifacts**: Telemetry summary showing promotion threshold met, lifecycle transition events

---

### B5: Multi-Agent Swarm Topologies 🎮

**Profile**: Individual · **Tier**: 1 · **Tools**: Pool dispatch

> Demonstrates swarm creation with three topology types: star, mesh, pipeline.

**Step-by-step**:

1. Spawn 4 agents: coordinator + 3 workers
2. Create **star topology** swarm — coordinator dispatches to all workers
3. Execute swarm with task: "Analyze project structure"
4. Verify: Coordinator received results from all 3 workers
5. Stop star swarm
6. Create **mesh topology** swarm — all agents peer-to-peer
7. Execute mesh swarm with collaborative task
8. Verify: Each agent contributed to merged result
9. Create **pipeline topology** swarm — sequential handoff (A → B → C)
10. Execute pipeline with multi-stage transformation
11. Verify: Final result contains contributions from each pipeline stage
12. Verify: SwarmCoordinator emitted topology-specific activity events

**Expected artifacts**: Swarm execution traces, per-topology activity events

---

### B6: Guardian Agent Monitoring & Intervention 🏢

**Profile**: Business · **Tier**: 3 · **Tools**: Guardian lifecycle

> Demonstrates the Guardian Agent's local LLM monitoring and intervention capabilities.

**Step-by-step**:

1. Initialize GuardianAgent with configuration
2. Start guardian lifecycle monitoring
3. Simulate a monitored tool execution
4. Guardian evaluates risk and emits monitoring event
5. Simulate high-risk scenario requiring guardian intervention
6. Guardian emits authority tier assessment
7. Verify: Guardian events flow through ActivityBus
8. Stop guardian lifecycle
9. Verify: Complete guardian lifecycle trace in activity log

**Expected artifacts**: Guardian monitoring events, risk assessments, lifecycle state transitions

---

## Category C — Computer Use

### C1: Browser Session — Navigate & Screenshot 🎮

**Profile**: Individual · **Tier**: 1/2 · **Tools**: Browser adapter

> Full browser automation lifecycle: launch, navigate, capture, close.

**Step-by-step**:

1. Start browser session via adapter
2. Navigate to `about:blank` (Tier 1 — safe navigation)
3. Take viewport screenshot → saved to `prism-output/demo-c1-screenshot.png`
4. Get browser session status — verify state is `active`
5. Close browser session
6. Verify: Session state transition: `created` → `active` → `closed`
7. Verify: Screenshot artifact exists and is valid image

**Expected artifacts**: Screenshot file, browser session lifecycle events

---

### C2: Browser Multi-Page Research with Network Capture 🎯

**Profile**: Individual · **Tier**: 2 · **Tools**: Browser adapter

> Demonstrates multi-page navigation with network/console capture for research workflows.

**Step-by-step**:

1. Start browser session with network capture enabled
2. Navigate to first URL
3. Capture network requests (Tier 1 — read-only inspection)
4. Navigate to second URL
5. Capture console logs
6. Take screenshots of both pages
7. Close session and export captures
8. Verify: Network capture contains request/response pairs
9. Verify: Console capture contains page log entries

**Expected artifacts**: Network capture data, console logs, screenshots

---

### C3: Terminal Session Lifecycle 🎯

**Profile**: Individual · **Tier**: 1/2 · **Tools**: `terminal_session`

> Complete terminal session lifecycle: start → execute → status → stop.

**Step-by-step**:

1. Start terminal session via adapter
2. Execute Tier 1 diagnostic command: `node --version`
3. Get session status — verify running state
4. Execute Tier 1 command: `hostname`
5. Get session history — verify both commands recorded
6. Stop terminal session
7. Verify: Session state: `started` → `running` → `stopped`
8. Verify: All commands persisted in session history (SQLite)

**Expected artifacts**: Terminal session trace, command history, lifecycle events

---

### C4: Terminal Tiered Command Governance 🏢

**Profile**: Business · **Tier**: 1/2/3 · **Tools**: `terminal_session`

> Demonstrates the 39-keyword governance classification across all three tiers.

**Step-by-step**:

1. Start terminal session under Business profile
2. Execute **Tier 1** command: `ipconfig` → immediate execution
3. Execute **Tier 1** command: `ping localhost` → immediate execution
4. Execute **Tier 2** command: `route print` → conditional (rollback required)
5. Execute **Tier 3** command: `netsh interface set` → approval required
6. Auto-approve Tier 3 command
7. Execute **Tier 3** command: `iptables -L` → approval required → auto-approve
8. Verify: Each command classified correctly per keyword mapping
9. Verify: Business profile enforced rollback on Tier 2, approval on Tier 3

**Expected artifacts**: Per-command governance classification events, approval records

---

### C5: Container Sandbox Lifecycle 🏢

**Profile**: Business · **Tier**: 2/3 · **Tools**: `container_sandbox`

> Full container lifecycle: create → start → snapshot → execute → revert → destroy.

**Step-by-step**:

1. Create container sandbox with resource quotas (CPU: 1, Memory: 512MB)
2. Start container — verify health check passes
3. Create snapshot (`snap-1`) — capture clean state
4. Execute command inside container: `echo "modified state"`
5. Verify container state changed
6. Revert to `snap-1` — restore clean state
7. Verify: State reverted to pre-modification
8. Stop container
9. Destroy container
10. Verify: State machine transitions: IDLE → CREATED → RUNNING → SNAPSHOT → RUNNING → REVERTED → RUNNING → STOPPED → DESTROYED

**Expected artifacts**: Container lifecycle events, snapshot chain, resource quota logs

---

### C6: Cross-Tool Orchestration 🎮

**Profile**: Individual · **Tier**: 1/2 · **Tools**: Browser + Terminal + File

> Demonstrates orchestrating multiple computer-use tools in a single workflow.

**Step-by-step**:

1. Start terminal session
2. Execute `node --version` → capture output
3. Start browser session
4. Navigate and take screenshot
5. Write combined results to file via `file_write`
6. Use `semantic_query` to search for the written results
7. Close terminal and browser sessions
8. Verify: All three tool domains (terminal, browser, file) produced linked ActivityBus events
9. Verify: Cross-tool correlation via shared sessionId

**Expected artifacts**: Multi-domain activity trace with shared session correlation

---

### C7: Terminal Forced Revocation on Timeout 🏢

**Profile**: Business · **Tier**: 3 · **Tools**: `terminal_session`

> Demonstrates the safety mechanism for terminal session revocation after timeout.

**Step-by-step**:

1. Start terminal session with short idle timeout (2000ms)
2. Execute a command
3. Let idle timeout expire without further interaction
4. Verify: Session state transitions to `revoked`
5. Attempt to execute command on revoked session → rejected
6. Verify: Revocation event emitted with timeout reason

**Expected artifacts**: Terminal revocation event, rejection on post-revocation command

---

### C8: Container Resource Quota Enforcement 🏢

**Profile**: Business · **Tier**: 2 · **Tools**: `container_sandbox`

> Demonstrates resource quota enforcement preventing resource abuse.

**Step-by-step**:

1. Create container with strict quotas (CPU: 0.5, Memory: 256MB, Disk: 100MB)
2. Start container
3. Attempt operation that would exceed memory quota
4. Verify: Quota enforcement prevents excessive allocation
5. Verify: Quota violation event emitted with resource details
6. Stop and destroy container

**Expected artifacts**: Resource quota enforcement events, violation details

---

## Category D — Workflow Orchestration

### D1: Simple Two-Step DAG 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: `file_list`, `memory_query`

> Basic workflow DAG: Step A (file listing) → Step B (memory query using Step A results).

**Step-by-step**:

1. Define workflow DAG with two steps: `list_files` → `query_memory`
2. Step A: `file_list` operation targeting `./prism-output/`
3. Step B: `memory_query` using results from Step A as context
4. Submit workflow to `WorkflowExecutor`
5. Verify: Steps executed in sequence (A before B)
6. Verify: Step B received Step A output as input context
7. Verify: Workflow marked as `completed` with both steps `succeeded`

**Expected artifacts**: Workflow execution trace, step dependency chain

---

### D2: Multi-Step with Conditional Fallback 🏢

**Profile**: Business · **Tier**: 1/2 · **Tools**: `file_read`, `file_write`, `semantic_query`

> Workflow with `on_failure` fallback routing demonstrating recovery branches.

**Step-by-step**:

1. Define DAG: Step A (read file that may not exist) → on_failure → Step B (create default file) → Step C (semantic query)
2. Step A: `file_read` on non-existent file → **fails**
3. Fallback routing triggers Step B: `file_write` creates default content
4. Step C: `semantic_query` uses created content → **succeeds**
5. Verify: Overall workflow succeeds through fallback path
6. Verify: Activity trace shows A(failed) → B(fallback_succeeded) → C(succeeded)

**Expected artifacts**: Workflow with fallback chain, recovery path activity events

---

### D3: Workflow with Timeout Fallback 🏢

**Profile**: Business · **Tier**: 2/3 · **Tools**: `shell_exec`, `file_write`

> Demonstrates `on_timeout` routing when a step exceeds its deadline.

**Step-by-step**:

1. Define DAG: Step A (shell command with 1s timeout) → on_timeout → Step B (write timeout log)
2. Step A: `shell_exec` with artificially slow operation → **times out**
3. Timeout routing triggers Step B: `file_write` logs the timeout event
4. Verify: Step A status is `timed_out`
5. Verify: Step B executed via `on_timeout` route
6. Verify: Workflow completed successfully through timeout recovery

**Expected artifacts**: Timeout event, fallback execution trace

---

### D4: Parallel Step Execution in DAG 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: `file_list`, `semantic_query`, `memory_query`

> Demonstrates parallel step execution where independent steps run concurrently.

**Step-by-step**:

1. Define DAG: Step A (file_list) + Step B (semantic_query) run in parallel → Step C (merge results)
2. Steps A and B have no dependencies on each other — execute concurrently
3. Step C depends on both A and B — waits for both to complete
4. Submit workflow
5. Verify: A and B started within milliseconds of each other
6. Verify: C started only after both A and B completed
7. Verify: Total workflow duration < (A duration + B duration) — proving parallelism

**Expected artifacts**: Parallel execution trace with timing proof

---

### D5: Full Recovery Workflow 🎮

**Profile**: Individual · **Tier**: 1/2 · **Tools**: Multiple

> End-to-end workflow demonstrating failure → fallback → retry → success.

**Step-by-step**:

1. Define complex DAG with retry and fallback branches
2. Step A: Intentionally failing operation (read non-existent file)
3. Retry: Step A retries once → still fails
4. Fallback: Step B creates the file (on_failure routing)
5. Step C: Read the now-existing file → succeeds
6. Step D: Write summary of recovery path → succeeds
7. Verify: Overall workflow succeeded despite initial failure
8. Verify: Retry count and fallback path visible in activity trace

**Expected artifacts**: Complete recovery workflow trace with retry + fallback chain

---

## Category E — Memory & Knowledge

### E1: Episodic Memory Buffer Write & Retrieval 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: Memory subsystem

> Demonstrates the episodic memory buffer: write events, retrieve recent history.

**Step-by-step**:

1. Execute 5 operations through Orchestrator (each emits to EpisodicMemory via ActivityBus)
2. Query episodic memory for recent events
3. Verify: All 5 events present in episodic buffer
4. Verify: Events ordered by timestamp (most recent first)
5. Verify: Each event contains full ActivityEvent fields
6. Execute 3 more operations
7. Re-query — verify all 8 events present
8. Verify: Buffer bounded at configured max (600 events)

**Expected artifacts**: Episodic memory query results, event ordering validation

---

### E2: Semantic Memory Indexing & Similarity Search 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: `semantic_query`

> Demonstrates vector-based semantic memory indexing and similarity retrieval.

**Step-by-step**:

1. Execute operations that produce semantically distinct events (file ops, shell ops, memory ops)
2. Query `semantic_query` for "file operations and writing"
3. Verify: Results ranked by semantic relevance — file operations scored higher
4. Query `semantic_query` for "shell command execution"
5. Verify: Shell-related events scored higher than file events
6. Verify: Retrieval metrics collected (coverage, novelty, utility scores)
7. Verify: `RetrievalMetricsCollector` recorded query latency and result counts

**Expected artifacts**: Semantic search results with relevance scores, retrieval metrics

---

### E3: Session Memory Scoping & Cross-Session Isolation 🏢

**Profile**: Business · **Tier**: 1 · **Tools**: Session memory store

> Demonstrates session-scoped memory isolation — events from one session invisible to another.

**Step-by-step**:

1. Create Session A (sessionId: `session-a`)
2. Execute 3 operations in Session A — events stored in SessionMemoryStore
3. Create Session B (sessionId: `session-b`)
4. Execute 2 different operations in Session B
5. Query Session A events — verify only Session A operations returned
6. Query Session B events — verify only Session B operations returned
7. Verify: No cross-session data leakage
8. Verify: Each session maintains independent event index

**Expected artifacts**: Session-scoped query results proving isolation

---

### E4: Knowledge Graph Query & Semantic Bridge 🏢

**Profile**: Business · **Tier**: 1 · **Tools**: `neo4j_query`, `semantic_query`

> Demonstrates the knowledge graph integration and semantic-KG bridge.

**Step-by-step**:

1. Execute `neo4j_query` with a Cypher query (read-only)
2. Verify: Query result processed and returned
3. Execute `semantic_query` bridging KG results with semantic memory
4. Verify: Combined results from both knowledge sources
5. Verify: KG query events emitted to ActivityBus with `layer: "retrieval"`
6. Verify: Retrieval metrics captured KG query performance

**Expected artifacts**: KG query results, semantic bridge correlation, retrieval metrics

---

## Category F — Dashboard & Operator Experience

### F1: Full Dashboard Tab Walkthrough 🎮

**Profile**: Individual · **Tier**: 1 · **Tools**: HTTP API

> Programmatic walkthrough of all 11 dashboard tabs via API calls.

**Step-by-step**:

1. Start PRISM in server mode
2. `GET /api/status` — verify server running, uptime, event count
3. `GET /api/events?limit=10` — verify recent events returned
4. `GET /api/logs?limit=10` — verify log entries available
5. `GET /api/traces` — verify trace summaries
6. `GET /api/tools` — verify 19+ tools listed
7. `GET /api/plugins` — verify plugin inventory
8. `GET /api/agents` — verify agent list
9. `GET /api/readiness` — verify readiness status
10. `GET /api/action-history` — verify action history
11. Verify: All endpoints return 200 with valid JSON
12. Verify: Each response contains expected data structure

**Expected artifacts**: API response validation log for all endpoints

---

### F2: Real-Time WebSocket Event Streaming 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: WebSocket client

> Connects to the dashboard WebSocket and verifies real-time event delivery.

**Step-by-step**:

1. Connect WebSocket client to `ws://localhost:7070`
2. Execute an operation via Orchestrator (triggers ActivityBus event)
3. Verify: WebSocket receives event within 100ms
4. Execute 3 rapid operations
5. Verify: All 3 events received in order via WebSocket
6. Verify: Events include `timestamp`, `type`, and payload fields
7. Disconnect WebSocket
8. Verify: Clean disconnect without errors

**Expected artifacts**: WebSocket event capture log, timing validation

---

### F3: Diagnostic Suite Execution from Dashboard 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: Diagnostics API

> Triggers diagnostic suites programmatically and verifies report generation.

**Step-by-step**:

1. Check diagnostic status: `GET /api/diagnostics/agent/status` → not running
2. Trigger agent diagnostics: `POST /api/diagnostics/agent/run`
3. Verify: Response `{ status: "started" }`
4. Poll for completion via WebSocket `agent_diagnostics_complete` event
5. Load report: `GET /api/diagnostics/agent/report`
6. Verify: Report contains `summary`, `suites`, and `generatedAt` fields
7. Verify: All suites have `passes` counts, zero unexpected failures
8. Repeat for browser diagnostics: `POST /api/diagnostics/browser/run`

**Expected artifacts**: Diagnostic reports, suite results, WebSocket progress events

---

### F4: LLM Audit Trail Export 🏢

**Profile**: Business · **Tier**: 1 · **Tools**: Audit API

> Demonstrates the LLM configuration audit trail with JSON/CSV export.

**Step-by-step**:

1. Execute several LLM provider configuration changes
2. Fetch audit trail via dashboard API
3. Export as JSON — verify structured audit entries
4. Export as CSV — verify comma-separated format
5. Verify: Each entry contains `timestamp`, `before`, `after`, `changedBy`
6. Verify: Audit trail immutable — cannot be modified post-creation

**Expected artifacts**: JSON and CSV audit exports, audit entry validation

---

### F5: Scheduler — Project + Kanban + Cron Job 🎮

**Profile**: Individual · **Tier**: 1 · **Tools**: Scheduler API

> Creates a project, manages Kanban tasks, and sets up a cron job.

**Step-by-step**:

1. Create new project via Scheduler API
2. Add 3 tasks with different statuses (todo, in-progress, done)
3. Verify: Kanban board shows tasks in correct columns
4. Create cron job: self-review scheduler (daily interval)
5. Verify: Cron job registered and active
6. Cancel cron job
7. Verify: Job cancellation event emitted
8. Verify: All scheduler operations logged through ActivityBus

**Expected artifacts**: Project record, task states, cron lifecycle events

---

## Category G — Network & Integration

### G1: Tier 1 Network Diagnostics 🎯

**Profile**: Individual · **Tier**: 1 · **Tools**: Network tool

> Executes read-only network diagnostic commands: ping, ipconfig, nslookup.

**Step-by-step**:

1. Execute `ipconfig` via NetworkTool → Tier 1 autonomous
2. Execute `ping localhost` → Tier 1 autonomous
3. Execute `nslookup localhost` → Tier 1 autonomous
4. Execute `hostname` → Tier 1 autonomous
5. Verify: All four commands executed without approval
6. Verify: Output captured and returned
7. Verify: Network events emitted with `layer: "tool_execution"`

**Expected artifacts**: Command outputs, Tier 1 activity events

---

### G2: Tier 2 Network Config Inspection 🏢

**Profile**: Business · **Tier**: 2 · **Tools**: Network tool

> Executes medium-risk network configuration inspection commands under Business governance.

**Step-by-step**:

1. Execute `route print` → Tier 2 conditional
2. Verify: Business profile requires rollback plan for Tier 2
3. Provide rollback: "Network config inspection is read-only — no rollback needed"
4. Execute `netstat -an` → Tier 1 (read-only inspection)
5. Verify: Different commands classified at different tiers
6. Verify: Business audit trail captures all network operations

**Expected artifacts**: Network command results with governance classifications

---

### G3: MCP Plugin Invocation 🏢

**Profile**: Individual · **Tier**: 1/2 · **Tools**: MCP client adapter

> Demonstrates MCP plugin discovery and invocation.

**Step-by-step**:

1. Load MCP settings and register available plugins
2. List registered MCP tools via ToolRegistry
3. Invoke `ids-mcp` (identity services) tool
4. Verify: MCP tool execution routed through governance
5. Invoke `web-search-mcp` tool
6. Verify: Both MCP tools produce ActivityBus events
7. Verify: Plugin health status reported correctly

**Expected artifacts**: MCP tool invocation events, plugin health status

---

### G4: Nexus Bridge Interaction 🏢

**Profile**: Business · **Tier**: 1 · **Tools**: Nexus bridge tools

> Demonstrates Nexus bridge integration: hotline check, memory read, insight log.

**Step-by-step**:

1. Execute `nexus_check_hotline` — verify hotline status
2. Execute `nexus_read_memory` — read from Nexus memory store
3. Execute `nexus_log_insight` — log an insight to Nexus
4. Verify: All three Nexus operations emitted ActivityBus events
5. Verify: Business audit trail captures all integration calls

**Expected artifacts**: Nexus bridge call traces, integration events

---

## Category H — Release & CI Qualification

### H1: Full E-Stage2 Qualification Run 🏢

**Profile**: Both · **Tier**: 1 · **Tools**: Benchmark suites

> Orchestrates the complete E1 → E2 → E3 → E4 qualification pipeline.

**Step-by-step**:

1. Execute `e-stage2-qualification` benchmark
2. Stage E1: Individual profile qualification → artifact written
3. Stage E2: Business profile qualification → artifact written
4. Stage E3: Policy stress test → artifact written
5. Stage E4: Profile switch qualification → artifact written
6. Stage2 aggregator reads all artifacts and produces summary
7. Verify: All 4 stages passed
8. Verify: `e-stage2-qualification-summary.json` contains complete results

**Expected artifacts**: `prism-output/e-stage2-qualification-summary.json`

---

### H2: Performance Qualification with SLO Gates 🏢

**Profile**: Individual · **Tier**: 1 · **Tools**: Performance benchmark

> Validates p50/p95/p99 latency gates for all critical paths.

**Step-by-step**:

1. Execute `performance-qualification` benchmark
2. Measures: policy evaluation latency (p50 < 5ms, p95 < 20ms)
3. Measures: retrieval query latency (p50 < 10ms, p95 < 50ms)
4. Measures: event emission latency (p50 < 1ms)
5. Measures: approval queue throughput
6. Measures: persistence write latency
7. Verify: All SLO gates pass
8. Verify: `perf-qualification.json` written with detailed metrics

**Expected artifacts**: `prism-output/perf-qualification.json`

---

### H3: Tool Contract Snapshot & Drift Detection 🏢

**Profile**: Individual · **Tier**: 1 · **Tools**: Contract snapshot

> Captures tool API contracts and detects drift from baseline.

**Step-by-step**:

1. Execute `tool-contract-snapshot` benchmark
2. Iterates all registered tools and extracts contract signatures
3. Compares against baseline snapshot (if exists)
4. Verify: No unintended contract changes (drift)
5. Verify: New tools properly documented in snapshot
6. Write updated snapshot to `prism-output/tool-contract-snapshot.json`

**Expected artifacts**: `prism-output/tool-contract-snapshot.json`

---

### H4: CI Gate Check & Release Validation 🏢

**Profile**: Both · **Tier**: 1 · **Tools**: CI gate, release validator

> Validates all CI gates and performs strict release validation.

**Step-by-step**:

1. Execute `ci-gate-check` — evaluates all 7 CI gates
2. Verify: Each gate reports pass/fail status
3. Execute `release-validation` in strict mode
4. Verify: All release artifacts present and valid
5. Verify: Version consistency across package.json and artifacts
6. Verify: No missing required files for release

**Expected artifacts**: `prism-output/ci-gate-summary.json`, `prism-output/release-validation.json`

---

### H5: Business Trust Provenance Qualification 🏢

**Profile**: Business · **Tier**: 1 · **Tools**: Trust validator

> Validates business trust provenance chains and compliance requirements.

**Step-by-step**:

1. Execute Business Trust Validator test suite
2. Verify: CAC identity chain integrity (operator ↔ prism user ↔ character)
3. Verify: Domain matching enforcement under Business profile
4. Verify: Audit trail completeness for all Tier 2/3 operations
5. Verify: Rollback plan enforcement evidence
6. Verify: All trust provenance checks pass

**Expected artifacts**: Business trust validation results

---

## Programmatic Execution

### Running All Scenarios

```bash
# Build and run all 43 scenarios
npm run demo:scenarios

# Run with Individual profile only
npm run demo:scenarios:individual

# Run with Business profile only
npm run demo:scenarios:business

# Run specific categories
npm run demo:scenarios -- --category=A,B,C

# Run from dashboard (server must be running)
# POST /api/diagnostics/demo/run
```

### Output Artifacts

| File | Format | Content |
|------|--------|---------|
| `prism-output/demo-scenario-report.json` | JSON | Structured results: per-scenario pass/fail, timing, coverage matrix |
| `prism-output/demo-scenario-full.log` | Text | Chronological debug log for Copilot review |

### Coverage Matrix

| Capability | Scenarios |
|------------|-----------|
| PolicyEngine (Tier 1) | A1, A5, A6, D1, D4, E1–E4, F1–F5, G1, H1–H5 |
| PolicyEngine (Tier 2) | A2, A5, A6, B1, B2, C2, C3, C5, C8, D2, D3, G2 |
| PolicyEngine (Tier 3) | A3, A4, B6, C4, C7, D3 |
| AgentPool / Lifecycle | B1–B6 |
| SwarmCoordinator | B5 |
| GuardianAgent | B6 |
| Browser Adapter | C1, C2, C6 |
| Terminal Adapter | C3, C4, C6, C7 |
| Container Adapter | C5, C8 |
| WorkflowExecutor | D1–D5 |
| EpisodicMemory | E1 |
| SemanticMemoryIndex | E2, E4 |
| SessionMemoryStore | E3 |
| DashboardService | F1–F5 |
| NetworkTool | G1, G2 |
| MCP Adapter | G3 |
| Nexus Bridge | G4 |
| Benchmark Suites | H1–H5 |
| ActivityBus | **All 43 scenarios** |
| ApprovalQueue | A3, A4, C4, C7, D3 |

---

## Operator Walkthrough Guide

For operators running demos manually through the dashboard:

1. **Start PRISM**: `start_web.bat` → open `http://localhost:7070`
2. **Tools Tab**: Navigate to "Demo Scenarios" diagnostics panel → click **Run Demo Scenarios**
3. **Watch Progress**: Real-time WebSocket updates show each scenario's pass/fail status
4. **Review Results**: Expand individual scenario cards to see step-by-step execution details
5. **Debug**: Open **Logs & Debug** tab → filter by `demo` layer → trace any scenario in detail
6. **Export**: Download `demo-scenario-report.json` and `demo-scenario-full.log` from `prism-output/`
7. **Copilot Review**: Feed `demo-scenario-full.log` to Copilot for automated analysis and recommendations

---

*Generated for PRISM v0.2.0 — Agents As A Service (AaaS)*
*Kirk LaSalle — All rights reserved*
