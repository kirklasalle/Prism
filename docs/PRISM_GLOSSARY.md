# PRISM System Glossary & Acronym Guide

This glossary compiles, defines, and contextualizes every core acronym, technical term, and governance abbreviation utilized across the **PRISM** agent platform. 

---

## 🔠 PRISM Core Acronyms

### PRISM
* **Abbreviation for**: **Process-level Resilient Intelligence and Security Monitor**
* **Definition**: The complete, policy-governed, full-computer-use autonomous agent runtime. PRISM serves as a self-hostable Agents-as-a-Service (AaaS) platform, integrating constitutional policy routing, causal memory, multi-agent swarms, and human-in-the-loop security gates.

---

### PAD
* **Abbreviation for**: **Permanent Active Directives**
* **Definition**: The cryptographically locked, immutable constitutional document comprising the **10 Laws of PRISM** (governing security, user privacy, action transparency, and tool boundaries). 
* **Mechanics**: Verified at boot time via SHA-256 integrity constant scans. During runtime, the **Guardian Agent** re-checks the PAD hash every 10 minutes (600s). CI Gate 9 blocks releases if the PAD text is modified without Governance Council cryptographic approval.

---

### CAC
* **Abbreviation for**: **Character Accountability Control**
* **Definition**: The identity-binding structure that establishes an unbroken audit trail for every autonomous action. 
* **Mechanics**: Binds every tool execution, shell command, or conversational response to a cryptographic chain containing: `characterId` ➔ `prismUserEmail` ➔ `operatorEmail` ➔ `clientId` ➔ `sessionId`. Dynamically enforces profile-specific constraints (e.g., domain-matching constraints in Business profile mode).

---

### SR
* **Abbreviation for**: **Spectrum Refraction**
* **Definition**: PRISM's novel parallel fan-out tri-model orchestration system. 
* **Mechanics**: Dispatches a single operator query simultaneously across three separate computational zones: **Left Hemisphere** (analytical/logic-strength engine), **Right Hemisphere** (creative/modality-rich engine), and **Main Coordinator** (structural aggregator). Strictly enforces model and provider isolation (`Left != Right`) at configure, activation, and execution gates to compound intelligence breadth.

---

### PTAC
* **Abbreviation for**: **PRISM Test & Acceptance Conductor**
* **Definition**: The in-tree self-drive automation and validation harness located under `src/ptac/`.
* **Mechanics**: Declares sequential workflow steps to stress-test UI components, system shell tools, Docker sandboxes, and approval queues. Triple-gated by secure environment variables (`PRISM_PTAC_OPERATOR_DEMO=1`, `PRISM_PTAC_SAFE=1`, `PRISM_PTAC_RECORD_VIDEO=1`), it compiles runtime evidence into portable, browser-playable HTML slideshows and reports.

---

### MCP
* **Abbreviation for**: **Model Context Protocol**
* **Definition**: The open-standard secure integration protocol (originally defined by Anthropic) used to connect Large Language Models to peripheral tools, workspace directories, and APIs.
* **Mechanics**: PRISM integrates 7 specialized MCP plugins, exposing 71 highly structured tools to the planning loop across system, knowledge, and application namespaces.

---

### SSHP (SSHR)
* **Abbreviation for**: **Sovereign Sentinel Hyper-Proxy**
* **Definition**: PRISM’s localized security proxy tier responsible for auditing out-of-boundary requests.
* **Mechanics**: Implements real-time visual PII masking, token sanitization, malicious payload scrubbing, and manages automated handoff signals to prevent prompt-injection attacks.

---

### CSH
* **Abbreviation for**: **Causal Support Handoff**
* **Definition**: The interactive mechanism that halts fully autonomous processing and initiates a safe state transfer to human supervision.
* **Mechanics**: Triggered automatically when an agent encounters ambiguous instructions, high-risk mutation thresholds, or repeated recovery failures. The system pauses the autonomous thread, enqueues an item in the operator's **Approval Queue**, and awaits manual intervention.

---

### AAB
* **Abbreviation for**: **Autonomous Activity Bus**
* **Definition**: The unified, real-time communication pipeline and ledger that processes, hashes, and audits all agent telemetry.
* **Mechanics**: Every single tool call, decision point, and system event is broadcast across the AAB. The **Guardian Agent** continually audits the AAB ledger to detect anomalies, infinite tool loops, or rate-limit violations, acting as a programmable circuit breaker.

---

### SSSR
* **Abbreviation for**: **Single-Slot Sequential Runner**
* **Definition**: The dynamic model-scheduling and memory-management controller designed for extremely resource-constrained deployments (such as running PRISM in **Base Mode** on a 3GB GTX 1050 Ti VRAM footprint).
* **Mechanics**: Intercepts competing LLM generation commands. Since multiple models cannot reside concurrently in constrained memory, the SSSR sequentializes calls, dynamically releasing and flashing model weights to the GPU one slot at a time without causing system out-of-memory crashes.

---

### IDS
* **Abbreviation for**: **Intelligence Directory Service**
* **Definition**: The background indexing and tag registry agent that runs concurrently alongside the primary dashboard services.
* **Mechanics**: Lexically indexes every document, markdown file, source code, and index tag inside the active workspace. Exposes deep trace lineage and conversational document search tools to the agent via custom MCP server commands.

---

### AaaS
* **Abbreviation for**: **Agents-as-a-Service**
* **Definition**: The architectural shift away from simple stateless chat clients toward robust, state-managed, policy-governed background AI daemons. PRISM runs as a persistent service on the host, handling continuous scheduling, self-healing, and swarm coordination in the background.

---

## 💾 Hardware & Standard Technical Terms

### VRAM
* **Abbreviation for**: **Video Random Access Memory**
* **Definition**: Ultra-fast graphical memory dedicated to storing model weights, activation layers, and Key-Value (KV) attention caches. Clamped to a max target of 2.5GB to 3.0GB in PRISM Base Mode.

### GGUF
* **Abbreviation for**: **GPT-Generated Unified Format**
* **Definition**: The standard single-file binary format optimized for rapid loading and execution of localized LLMs via llama.cpp. Supports mixed quantized weights and CPU/GPU hybrid offloading.

### PTY
* **Abbreviation for**: **Pseudoterminal**
* **Definition**: Virtual terminal interface layer used by PRISM's `TerminalSessionAdapter` to spin up interactive host shells under strict policy restrictions.

### OCI
* **Abbreviation for**: **Open Container Initiative**
* **Definition**: The open governance standard for container runtimes and formats. PRISM leverages OCI compliance parameters to package, deploy, and execute agent characters inside secure, isolated sandbox environments.
