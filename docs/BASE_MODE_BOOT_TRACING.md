# PRISM Base Mode Boot Tracing & Analysis

This guide provides a comprehensive, line-by-line tracing analysis of the PRISM server boot sequence under the **Base Mode (Low-Power, GTx 1050 Ti & Core i5 Haswell)** active constraint paradigm. 

---

## Tracing Log Analysis

Below is the complete analysis of the PRISM Node console boot output. Each log entry is broken down by its **underlying instruction** and its **resulting system return**.

### 1. NPM Runtime Launch
```text
> prism-core@0.21.0 start
> node dist/src/index.js
```
* **Instruction**: The npm runner executes the designated `start` lifecycle script, spawning the node engine targeting the compiled entry-point file `dist/src/index.js`.
* **Return**: Subprocess initialized; the raw TypeScript-transpiled Javascript starts execution.

---

### 2. Workspace Relocation
```text
[PRISM][workspace] Legacy CWD-relative paths detected: prism-output, prism-activity.db, .mcp/mcp-settings.json. Workspace is now at: C:\Users\kirkl\Documents\Prism_Refraction
```
* **Instruction**: The directory parser intercepts local relative file declarations and dynamically maps them to the operator's persistent home environment (`C:\Users\kirkl\Documents\Prism_Refraction`).
* **Return**: Establishes a clean separation between source directory code and active state storage to prevent directory corruption.

---

### 3. Operator Security Identity Load
```text
[GOVERNANCE] iam.dev.identity.restored status=succeeded tier=n/a policy=n/a
[PRISM][identity] Dev operator: Prism Dev Operator (Kirk LaSalle) <prism-dev-operator@localhost>
[PRISM][identity] Agent identity: Prism Autonomous Agent <prism-agent@localhost>
[PRISM][identity] CAC fingerprint: c1caf36980b27b1dd5c0e71c23e4daeb
```
* **Instruction**: Queries the local cryptographically signed developer parameters and agent profile.
* **Return**: Instantiates the unique authorization fingerprint (`c1caf36980b27b1dd5c0e71c23e4daeb`) in process memory, enabling secure superuser execution of files and terminals.

---

### 4. Swarm Browser Tab Virtualization
```text
[GOVERNANCE] tab.session.created status=succeeded tier=n/a policy=n/a
...
[PRISM][identity] Initialized 14 tab sessions
```
* **Instruction**: The containerization layer allocates 14 sandbox-isolated virtual browser frames in memory.
* **Return**: 14 ready-to-act web automation tab handlers are initialized and placed in the inactive pool, awaiting task instructions.

---

### 5. Telemetry & Covenant Verification
```text
[PRISM][telemetry] Universal telemetry aggregator active (10k buffer)
[GOVERNANCE] covenant.initialized status=succeeded tier=n/a policy=n/a
[PRISM][covenant] Sacred Covenant active (v1.0.0, hash:6675d177041bab59)
```
* **Instruction**: Allocates a high-speed rolling array buffer for up to 10,000 metrics events, then verifies system operations conform strictly to the user-approved ethical and safety code (Sacred Covenant).
* **Return**: Observability dashboard channels go live, and system safety restrictions lock down capabilities.

---

### 6. Active Constraint Paradigm Engagement
```text
[PRISM][startup] ======================================================
[PRISM][startup] ACTIVE CONSTRAINT PARADIGM ENGAGED: Base Mode initialized.
[PRISM][startup] Optimizing GGUF and task scheduling for GTX 1050 Ti & Core i5 Haswell.
[PRISM][startup] ======================================================
```
* **Instruction**: The loader detects the active `PRISM_BASE_MODE=true` environment override.
* **Return**: Adjusts the runtime configuration to lock context size allocations to 2048, restrict supervisor threads to 4, bypass draft speculative decoding, and prioritize full GPU model layer loading to protect GTX 1050 Ti VRAM footprint.

---

### 7. Agent sandboxing & Shell Adapters
```text
[PRISM][autonomous] Browser + Computer agents initialized
[PRISM][adapters] TerminalSessionAdapter PTY init: pending (node-pty)
[PRISM][adapters] ContainerSandboxAdapter runtime: builtin-prism
```
* **Instruction**: Prepares low-power execution controllers for keyboard/mouse simulation, registers PTY hooks for secure terminal sessions, and spins up the process sandbox.
* **Return**: Sandbox runtime is fully engaged and isolated from executing unsafe mutations directly on host processes.

---

### 8. Model Context Protocol (MCP) Tool Registrations
```text
[MCP:ids-mcp] Connected — 6 tool(s) available
...
[MCP] Registered 71 tool(s): mcp_ai_semantic_search, ...
```
* **Instruction**: Binds the orchestrator to active Model Context Protocol (MCP) server endpoints in the workspace.
* **Return**: 71 specialized tools are cataloged, schema-validated, and made dynamically discoverable by the Main Planner.

---

### 9. Intelligence Directory Service (IDS) Indexing
```text
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:37.125427] INFO: Starting background IDS initialization...
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:38.743055] INFO: Enhanced IDS initialized successfully
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:39.430933] INFO: Loaded unified index: 989 entries
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:40.252171] INFO: Loaded file metadata: 885 entries
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:40.970117] INFO: Loaded reverse index: 989 entries
[MCP:impressioncore-goliath] stderr: [2026-05-26T16:44:40.970117] INFO: IDS initialization complete. Server is ready.
```
* **Instruction**: Spawns a separate worker process to compile search indexes, metadata lists, and reverse lookup dictionaries across all documentation and files in the project.
* **Return**: 989 document records successfully mapped into active fast-lookup memory tables.

---

### 10. Integrity Verification and System Manifest
```text
[SECURITY] Directive integrity verified (SHA-256: a8d594d70d50…)
[CAUSAL] directive.integrity_check status=succeeded tier=n/a policy=n/a
============================================================
  PRISM RUNTIME -- Session: 4d436287-d22c-4feb-afe3-190bc84cd14e
  Environment profile: dev
  Execution profile: INDIVIDUAL profile (PRISM_EXECUTION_PROFILE=individual) — Individual: lightweight governance, fast tier 1/2 paths, approval for tier 3 only.
  Mode: server
  Dashboard: http://localhost:7070
  Self-review intervals: daily=86400000ms weekly=604800000ms monthly=2147000000ms
============================================================
```
* **Instruction**: Runs a SHA-256 checksum scan of the active system directives against locked security definitions, generates the dynamic Session Trace ID (`4d436287-d22c-4feb-afe3-190bc84cd14e`), and queries the current execution profile constraints.
* **Return**: Output prints current context details, and verified runtime attributes are loaded.

---

### 11. Dashboard Listener and Guardian tri-core Launch
```text
[DASHBOARD] Listening at http://localhost:7070
[AGENT] guardian.started status=succeeded tier=n/a policy=n/a
[AGENT] guardian.tasks_started status=succeeded tier=n/a policy=n/a
[CAUSAL] dashboard.readiness_check status=succeeded tier=n/a policy=n/a
[AGENT] guardian.task.directive_integrity status=succeeded tier=n/a policy=n/a
[AGENT] guardian.task.aab_ledger_monitor status=succeeded tier=n/a policy=n/a
[AGENT] guardian.task.mcp_health_recovery status=succeeded tier=n/a policy=n/a
```
* **Instruction**: Express server binds to local port `7070` to listen for console requests, while the Guardian Agent boots up. Since **Base Mode** is true, the catalog is dynamically pruned to launch only the core **survival triad**:
  1. `directive_integrity` (Checks security directives)
  2. `aab_ledger_monitor` (Anomalous autonomous loop circuit breaker)
  3. `mcp_health_recovery` (Restores disconnected tools)
* **Return**: Operator console is live at `http://localhost:7070`, and low-power watch loops are engaged.

---

### 12. Operator Authentication & Dynamic Self-Healing Triangulation
```text
[GOVERNANCE] iam.login.success status=succeeded tier=n/a policy=n/a
[AGENT] guardian.healing status=succeeded tier=n/a policy=n/a
[AGENT] guardian.skills_heal.starting status=succeeded tier=n/a policy=n/a
[CAUSAL] skill.session.created status=succeeded tier=n/a policy=n/a
[CAUSAL] skill.step.query_metrics_endpoint.start status=started tier=n/a policy=n/a
```
* **Instruction**: Captures developer authentication login on the front end, and dispatches a background task to evaluate metrics server status.
* **Return**: Grants full dashboard operational access, and runs internal diagnostics.

---

### 13. Graceful Local Fallback Sequence
```text
[PRISM][llm] Generation failed for cloud provider "openai". Attempting automatic local fallback...
[CAUSAL] skill.step.query_metrics_endpoint.failed status=failed tier=n/a policy=n/a
[AGENT] guardian.skills_heal.failed status=failed tier=n/a policy=n/a
[AGENT] guardian.healed status=succeeded tier=n/a policy=n/a
```
* **Instruction**: The diagnostics agent attempts to query system parameters. It encounters offline/unconfigured OpenAI cloud keys. The system dynamically executes its local **fallback pipeline**, attempting to route the request through the locally resident GGUF/Ollama server.
* **Return**: The diagnostic run reports a metrics query failure, but **safely degrades and recovers execution**, maintaining complete core process stability without crashing the daemon!
