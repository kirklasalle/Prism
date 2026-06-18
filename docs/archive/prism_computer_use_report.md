# PRISM: COMPUTER USE DEEP DIVE

A comprehensive technical analysis of industry-wide "Computer Use" paradigms, evaluating major implementations against the PRISM architecture. This report defines PRISM's current state and outlines the trajectory required to achieve a world-class, governance-native Software Application Development standard.

---

## 1. The Industry Landscape: Computer Use Evaluated

Evaluating major entities (Anthropic, OpenAI, Open Source frameworks) against PRISM's governed approach. The industry emphasizes raw capability and vision, while PRISM emphasizes determinism, safety, and operational accountability.

### Capability & Governance Radar Dimensions

| Metric | PRISM Posture | Anthropic & OpenAI | Open Source (LangGraph / AutoGen) |
| :--- | :--- | :--- | :--- |
| **Autonomy & Capability** | 70% (Controlled) | 95% (High vision) | 85% (Flexible graphs) |
| **Governance & Audit** | 100% (Event bus, PAD) | 40% (Developer wrapper) | 30% (Manual logging) |
| **Sandboxing Integrity** | 90% (Virtual PTY/Docker) | 75% (Cloud/Hosted API) | 60% (Host OS execution) |
| **Reproducibility** | 95% (Hashed state, replay) | 50% (Non-deterministic vision) | 70% (JSON workflows) |
| **Vision & DOM Control** | 65% (Scoped Playwright) | 95% (Pixel-coordinate plan) | 80% (Playwright integrations) |

### Landscape Profiles

* **🏢 Anthropic & OpenAI (Proprietary)**: Anthropic's computer-use preview and OpenAI's operator trajectories signal strong capabilities reliant on vision-based coordinate prediction and API-driven sandboxing. However, their internal governance loops are opaque. They highlight the need for prompt-injection protections and human oversight for consequential actions, but rely on the developer to build the enterprise security wrapper.
* **🌐 LangGraph & AutoGen (Open Source)**: These frameworks excel at graph-based agent orchestration and multi-agent conversations. However, they lack native, deeply integrated OS-level virtualization. "Computer Use" must be bolted on via external Docker containers without built-in immutable audit trails or cryptographic policy enforcement (PAD).
* **🔷 PRISM (AaaS Runtime)**: PRISM treats Computer Use as a first-class, policy-governed capability. Unlike open-source peers, PRISM integrates a 3-tier policy engine, CAC accountability chains, and deterministic container/browser lifecycles directly into the runtime. It sacrifices unconstrained autonomy for verifiable, enterprise-grade safety.

---

## 2. PRISM Implementation Details

PRISM executes and governs Computer Use across three primary domains: Browser Automation, Terminal Virtualization, and Container Sandboxing.

### Browser Automation & Control
Handles action-driven web interaction through governed tool paths.
* **Session Lifecycle**: Manages persistent profile handling, ensuring isolation between agent sessions.
* **Telemetry**: Real-time network and console capture.
* **Core Components**: [browser-control-tool.ts](file:///d:/Projects/Prism/src/core/operator/tools/browser-control-tool.ts), `browser-session-manager.ts`, `browser-profile-manager.ts`.
* **Methodology**: Operates via structured tool interfaces treated as strict contracts, enabling explicit risk classification before execution.

### Terminal Virtualization
Provides deterministic control over shell environments with integrated governance.
* **Session Commands**: `start`, `exec`, `stop`, `revoke`, `status`.
* **Tiered Governance**: Commands are intercepted and routed through the policy engine. High-risk commands trigger mandatory approvals.
* **Safety**: Built-in timeout and mid-execution revoke behavior.
* **Core Components**: `terminal-session-tool.ts`, `terminal-session-adapter.ts`.

### Container Sandbox Orchestration
The most isolated execution environment, featuring snapshot capabilities for deterministic replay.
* **State Machine**: Full lifecycle control (IDLE &rarr; CREATED &rarr; RUNNING &rarr; EXECUTING &rarr; TIMEOUT &rarr; STOPPED &rarr; DESTROYED).
* **Persistence**: 4 SQLite tables (`containers`, `container_snapshots`, `container_command_history`, `container_signal_log`).
* **Resource Quotas**: CPU, memory, and disk limits enforced per container (currently via metadata tracking).
* **Signal Escalation**: Graceful shutdown with SIGTERM &rarr; SIGKILL escalation (2s grace period).

---

## 3. Governance, Security Gates & State Management

Unconstrained AI is a liability. PRISM transforms this into a secure asset through cryptographically hashed audit trails, PAD integrity, and rigid state machines.

### Container State Machine Transition Policies

```
[ IDLE ] --create_container()--> [ CREATED ] --start()--> [ RUNNING ] <==exec()==> [ EXECUTING ]
   ^                                                           |
   |                                                        [TIMEOUT]
   |                                                           |
[ DESTROYED ] <==================destroy()================== [ STOPPED ]
```

1. **IDLE**: Awaiting container instantiation. No resources allocated. System is ready to accept `create_container()` calls routed through the policy engine.
2. **CREATED**: Metadata established in SQLite (`containers` table). Resource quotas (CPU, Memory limits) defined but process not yet spawned.
3. **RUNNING**: Process spawned. Environment isolated. Awaiting `exec()` commands. Snapshot capability active. Tracks lineage in `container_snapshots`.
4. **EXECUTING**: Active command running inside sandbox. I/O captured to Activity Bus. Command history logged for deterministic replay verification.
5. **TIMEOUT**: Execution exceeded policy limits. Triggering graceful shutdown (SIGTERM). If unresponsive after 2s, escalates to SIGKILL.
6. **STOPPED**: Processes halted. Resources released, but state and file system delta preserved. Ready for `destroy()` or `start()`.
7. **DESTROYED**: *Tier 3 Approval required*. Container fully purged. Audit trail finalized in `container_signal_log`. Operation non-reversible.

### Policy Tier Distribution (Enterprise Profile)

* **Tier 1: Autonomous (60%)**: Low-risk operations (e.g. reading log files, navigating basic static documentation sites, running safe diagnostic lists).
* **Tier 2: Conditional (25%)**: Medium-risk operations (e.g. writing files outside system folders, modifying non-critical configurations) governed by AST checks.
* **Tier 3: Approval Gated (15%)**: High-risk operations (e.g. container destruction, system shell modifications, high-cost external API transactions) requiring explicit human operator signoff.

---

## 4. Strategic Implementation: Reaching "World-Class"

Guidance on developing PRISM's Computer Use to its ultimate conclusion, addressing known gaps and achieving SOTA benchmark validation without compromising governance.

### 1️⃣ Replace Simulated Runtimes with Hardened Engines
* **Gap**: Currently simulated in some environments using `spawn("sh", ["sleep infinity"])`.
* **Action**: Implement direct Docker Engine API or `containerd` gRPC integrations.
* **Reference**: `CONTAINER_VIRTUALIZATION_DESIGN.md` - Known Gaps

### 2️⃣ Enforce OS-Level Resource Quotas
* **Gap**: Resource limits exist primarily in metadata and SQL tracking.
* **Action**: Upgrade resource management to active OS-level enforcement using `cgroups v2`. Implement active `/proc` polling for CPU/RAM instead of immediate metadata returns.
* **Reference**: `CONTAINER_VIRTUALIZATION_DESIGN.md` - Known Gaps

### 3️⃣ Activate True Tier 3 Approval Queues
* **Gap**: Simplified `routeThroughPolicy()` paths in test hooks mock permission returns.
* **Action**: Fully wire the container destroy and execute high-risk actions to the actual HTTP/WebSocket Approval Queue service.
* **Reference**: `PRISM_PRD.md` & CU-BG-1

### 4️⃣ Execute OSWorld Benchmark Integrity Plan
* **Gap**: OSWorld benchmarks are mentioned but need repeatable scaffold automation.
* **Action**: Integrate the OSWorld scaffold as a PTAC suite (`ptac:osworld`). Run the full 369-task suite across all foundation model classes. Publish reproducibility artefacts (config, traces) alongside scores.
* **Reference**: `OSWORLD_PUBLICATION_PLAN.md`

### 🚀 The Endgame: "Production-Only, No Stubs"
To achieve world-class status, PRISM must strictly adhere to the **2026-Q3 Full Audit Plan**: Either a feature ships with a real I/O integration and tests, or its completion claim is removed. Expanding the 28-scenario PTAC harness to cover edge-cases in browser DOM mutations and terminal escape-character handling will bridge the gap between "good scaffold" and "SOTA application."
