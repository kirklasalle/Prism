<p align="center">
  <img src="https://img.shields.io/badge/version-0.21.1-06b6d4?style=for-the-badge&labelColor=0a0a0f" alt="Version" />
  <img src="https://img.shields.io/badge/license-Apache_2.0-6366f1?style=for-the-badge&labelColor=0a0a0f" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-22c55e?style=for-the-badge&labelColor=0a0a0f" alt="Node.js" />
  <img src="https://img.shields.io/badge/tests-185+_passing-22c55e?style=for-the-badge&labelColor=0a0a0f" alt="Tests" />
  <img src="https://img.shields.io/badge/CI-7_workflows-f59e0b?style=for-the-badge&labelColor=0a0a0f" alt="CI" />
</p>

# PRISM — Governance-Native Agents-as-a-Service Runtime

**The first open-source agent platform with cryptographically enforced governance, tri-model cognitive orchestration, and full computer-use autonomy — designed for operators who refuse to choose between power and accountability.**

PRISM is not another chatbot wrapper. It is a **production-grade autonomous agent operating system** that orchestrates LLM reasoning, browser automation, terminal virtualization, container sandboxing, and multi-agent swarms — all governed by an immutable policy engine with cryptographic integrity verification at boot and runtime.

Where other platforms bolt on safety as an afterthought, PRISM makes governance **load-bearing architecture**: every tool invocation, every agent decision, every autonomous action passes through a 3-tier policy engine before execution. High-risk operations require explicit human approval. Denials and timeouts are first-class tested behaviors. The operator is always supreme.

> *"PRISM doesn't just run agents — it runs them with honor."*

---

## Why PRISM

### The Problem

Every agentic framework today asks you to make the same trade-off: **power or safety, autonomy or control, speed or transparency.** The result is platforms that are either too constrained to be useful or too unconstrained to be trusted.

### The PRISM Difference

PRISM eliminates that trade-off entirely through **governance-native architecture** — safety isn't a guardrail bolted onto the side; it's the foundation everything else is built on.

| Capability | Other Frameworks | PRISM |
|:---|:---|:---|
| **Governance** | Prompt-level guardrails, easily bypassed | Cryptographically enforced 10 Laws (SHA-256 integrity, CI-gated) |
| **Policy Engine** | Basic allow/deny lists | 3-tier authority model with approval queues, timeouts, and denial paths |
| **Multi-Model** | Single model per request | Spectrum Refraction: tri-model parallel fan-out with structured aggregation |
| **Computer Use** | Browser-only or terminal-only | Full-stack: browser + terminal + container sandbox, all policy-governed |
| **Agent Lifecycle** | Stateless tool calls | Managed lifecycles (ephemeral → semi-permanent → permanent) with swarm coordination |
| **Identity** | API key auth | IAM with RBAC, SSO (OIDC/SAML), SCIM provisioning, character accountability chains |
| **Observability** | Basic logging | SHA-256 hashed activity events, LLRE cognitive economics, retrieval quality telemetry |
| **Self-Hosting** | Cloud-only or limited local | Fully self-hostable, runs on consumer hardware, your data never leaves your machine |

---

## ✦ Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────┐
│                    OPERATOR DASHBOARD                        │
│  Chat │ Agents │ Browser │ Computer │ Network │ Telemetry    │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│               GOVERNANCE PLANE                               │
│  ┌─────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ 10 Laws │  │ 3-Tier Policy│  │ Approval Queue       │    │
│  │ (PAD)   │──│ Engine       │──│ (tier2/tier3 gates)  │    │
│  │ SHA-256 │  │ auto│cond│apv│  │ approve/deny/timeout │    │
│  └─────────┘  └──────────────┘  └──────────────────────┘    │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│              COGNITIVE RUNTIME                               │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────┐      │
│  │ Spectrum │ │ Agent Pool   │ │ Skills Engine        │      │
│  │Refraction│ │ + Swarm Coord│ │ (Browser Researcher, │      │
│  │ (SR)     │ │ + Task Decomp│ │  Terminal, Calendar, │      │
│  │ 3-model  │ │ 4 topologies │ │  Email, Media, etc.) │      │
│  └──────────┘ └──────────────┘ └─────────────────────┘      │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────┐      │
│  │ LLRE     │ │ Causal Memory│ │ Guardian Agent       │      │
│  │ Cognitive│ │ Fabric       │ │ (local llama.cpp,    │      │
│  │Economics │ │ (episodic +  │ │  autonomous health   │      │
│  │ TEQ/RSI  │ │  session +   │ │  monitor + PAD       │      │
│  │ CSR/TCA  │ │  semantic)   │ │  integrity checker)  │      │
│  └──────────┘ └──────────────┘ └─────────────────────┘      │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│           TOOL ADAPTERS (Agent-Computer Interface)            │
│  System │ Protocol │ Application │ Network │ Cognition       │
│  Shell    HTTP       Browser       50+ cmds   SR Tool        │
│  FS       A2A        Terminal PTY  ipconfig    Autonomous     │
│  Docker              Container     ping        Planner        │
│  Images              Email/OAuth   tracert                    │
│  Audio               Calendar      netstat                    │
│  Video               Tasks/Notes   nslookup                   │
│  Screen              Media Gen                                │
└──────────────────────────────────────────────────────────────┘
```

---

## ✦ Novel Engineering

### 1. Permanent Active Directives (PAD) — Cryptographic Governance

PRISM's governance isn't configurable — it's **constitutional**. The 10 Laws (authored by Kirk LaSalle, rooted in Asimov's Three Laws and extended to cover privacy, equity, transparency, and operational boundaries) are cryptographically sealed:

- **SHA-256 integrity verification** at every boot and every 10 minutes by the Guardian Agent
- **CI Gate** blocks any merge/release where directives are modified without updating the integrity constant
- **Machine-readable law manifest** maps each directive to its runtime enforcement mechanism
- **Governance preamble injection** into all Tier 2+ LLM system prompts — every model interaction operates within the 10 Laws
- **Amendment requires** Governance Council approval + cryptographic re-signing

No other agent platform enforces governance at the cryptographic level.

### 2. Spectrum Refraction (SR) — Tri-Model Cognitive Orchestration

PRISM's novel **compounding parallel fan-out architecture** simultaneously engages three model instances:

| Hemisphere | Role | Example |
|:---|:---|:---|
| **Left** (Logic) | Analytical reasoning, structured analysis | Claude Opus |
| **Right** (Creative) | Creative generation, lateral thinking | GPT-4o |
| **Main** (Coordinator) | Synthesis, arbitration, final response | Gemini Pro |

- **Mandatory instance isolation**: Left ≠ Right enforced at configuration, activation, and runtime gates
- **Structured XML-tagged aggregation** fuses analytical rigor with creative breadth
- **Three isolation quality levels**: `full` (different providers), `model` (same provider, different models), `insufficient` (rejected)
- **Media artifact extraction** from Creative hemisphere responses

No competing framework offers native multi-model simultaneous fan-out with structured aggregation and isolation enforcement.

### 3. LLRE Cognitive Economics Engine

The **Low-Level Reasoning Engine** provides unprecedented visibility into how efficiently your agents think:

- **Token Efficacy Quotient (TEQ)** — Are tokens being used effectively?
- **Request Satisfaction Index (RSI)** — Are user requests being fulfilled?
- **Context Saturation Ratio (CSR)** — Is context window capacity being optimized?
- **Tool Call Accuracy (TCA)** — Are tool invocations precise and successful?
- **Prompt AST Compiler** with `<objective>` and `<constraints>` tag parsing and signal density checks
- **SQLite persistence** with interactive performance rings in the operator console

### 4. Full Computer Use — Browser, Terminal, Container

PRISM treats computer use as a **first-class governed capability**, not an auxiliary feature:

- **Browser Automation** — Playwright-powered headless and headed browser control with screenshot capture, page navigation, element interaction, and multi-tab management
- **Terminal Virtualization** — Real PTY sessions via `node-pty` with full shell access, command risk classification, and destructive-command deny lists
- **Container Sandboxing** — Docker container orchestration for isolated execution environments with resource limits and lifecycle management
- **Autonomous Research** — Browser Researcher skill that autonomously navigates, searches, extracts, and synthesizes information from the web
- All pathways governed by the 3-tier policy engine with approval gates for high-risk operations

### 5. Multi-Agent Swarm Orchestration

- **Agent lifecycles**: ephemeral (per-task), semi-permanent (idle-reaped), permanent (manual stop)
- **Per-agent model assignment**: dynamic provider/model override per agent, hot-swappable at runtime
- **Four swarm topologies**: mesh, star, pipeline, broadcast
- **Task decomposition** with dependency-aware parallel batch execution
- **Intelligent telemetry**: pattern detection, role hotspot analysis, lifecycle promotion recommendations
- **Guardian Agent**: permanent autonomous system agent powered by local `llama.cpp` inference — monitors runtime health, self-heals crashed model slots, enforces policy boundaries

### 6. Identity, Access & Accountability

- **IAM Store** with RBAC, multi-tenant support, and user lifecycle management
- **SSO**: OIDC and SAML integration for enterprise identity providers
- **SCIM v2**: Automated user provisioning and deprovisioning
- **Character Accountability Control (CAC)**: every agent action linked to a character identity, a Prism user, and an operator via an immutable accountability chain
- **Session management** with cryptographic session tokens and cookie-based auth

### 7. Skills Engine — Autonomous Agent Capabilities

Production-ready skills that agents use to interact with the world:

| Skill | Capability |
|:---|:---|
| **Browser Researcher** | Autonomous web research with search, navigation, extraction, and synthesis |
| **Terminal** | Shell command execution with risk classification and deny lists |
| **Container Sandbox** | Docker-based isolated execution environments |
| **Email (Gmail + Outlook)** | OAuth2-authenticated email read/send via Google and Microsoft APIs |
| **Calendar** | Google Calendar integration for event management |
| **Image Generation** | AI image generation tool |
| **Audio/Video Generation** | Media generation and transcription tools |
| **Tasks & Notes** | Persistent task management and note-taking |
| **Project Store** | Structured project data management with SQLite |
| **Semantic Query** | Memory retrieval across episodic, session, and semantic stores |

### 8. Plugin Architecture — MCP + Marketplace

- **Model Context Protocol (MCP)** plugin system with hot-loading
- **Ed25519 code signing** for plugin integrity verification
- **Plugin Pack Validator** with manifest schema enforcement
- **Marketplace curation policy** with OSI license requirements
- **Plugin toggle** — enable/disable plugins at runtime without restart

---

## ⚡ Quick Start

### One Command (Windows)

```powershell
start_web.bat
```

### One Command (Linux / macOS)

```bash
chmod +x start_web.sh && ./start_web.sh
```

### From Source

```bash
npm ci              # Install dependencies
npm run build       # Build (includes PAD integrity check)
npm run start:server   # Start dashboard at http://localhost:7070
```

### With Docker

```bash
docker compose up -d    # Start with health checks and persistent volumes
```

### With PM2 (auto-restart on crash)

```bash
npm install -g pm2
npm run pm2:start       # Start with PM2 process management
npm run pm2:logs        # View logs
```

The operator dashboard opens at **`http://localhost:7070`**.

---

## 🖥️ Operator Dashboard

A premium, tab-based operator console with 10 functional areas:

| Tab | Purpose |
|:---|:---|
| **Chat Interface** | Conversational LLM interaction with Spectrum Refraction support |
| **Provider & Settings** | LLM provider configuration, model capability matrix, runtime settings, LLRE Cognitive Economics panel |
| **Tools & Plugins** | Browse 19+ built-in tools, MCP plugins, and 30 system utilities |
| **Agentic Control** | Agent swarm management, Guardian Agent status, hardware resource allocation |
| **Browser Control** | Autonomous browser sessions with live screenshots and navigation |
| **Computer Control** | Terminal sessions, container sandbox management, self-drive demonstrations |
| **Workspace** | Project management, file operations, character assignment |
| **Network** | 50+ curated network commands with tier-based governance and live interface viewer |
| **Telemetry** | Retrieval observability, performance metrics, quality trends |
| **Logs & Debug** | Real-time activity event stream, AI decision path tracing |

### 41+ HTTP API Routes

Full programmatic access to every dashboard capability via REST endpoints. See [API documentation](docs/USER_GUIDE.md) for the complete route catalog.

### OpenAI-Compatible API

PRISM exposes an OpenAI-compatible `/v1/chat/completions` endpoint, enabling drop-in replacement for applications that already integrate with the OpenAI API format.

---

## 🔐 Security Posture

| Control | Implementation |
|:---|:---|
| **Authentication** | Token-based auth gate with timing-safe comparison on all endpoints |
| **Rate Limiting** | Per-IP rate limiting (configurable, default 200 req/min) |
| **TLS** | Optional HTTPS via `PRISM_TLS_CERT` + `PRISM_TLS_KEY` |
| **CORS/CSRF** | Origin validation with rejection logging |
| **Security Headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| **API Key Storage** | Windows DPAPI / OS keychain — never persisted in SQLite, never returned by APIs |
| **PAD Integrity** | SHA-256 boot verification + Guardian Agent periodic re-check |
| **Plugin Signing** | Ed25519 code signing with key rotation SOP |
| **Production Guard** | `PRISM_AUTH_DISABLED=true` throws on `NODE_ENV=production` |
| **IAM** | RBAC, OIDC SSO, SAML SSO, SCIM v2 provisioning |
| **CodeQL** | Automated security analysis in CI |

---

## 🏗️ LLM Provider Support

PRISM supports **runtime provider/model switching** with secure credential management:

| Provider | Type | Configuration |
|:---|:---|:---|
| **OpenAI** | Cloud | `OPENAI_API_KEY` |
| **Anthropic** | Cloud | `ANTHROPIC_API_KEY` |
| **Ollama** | Local | Auto-discovers at `localhost:11434` |
| **Ollama Cloud** | Cloud | `OLLAMA_API_KEY` |
| **Llama.cpp** | Local | `PRISM_LLAMACPP_BASE_URL` |
| **Google AI** | Cloud | `GOOGLE_AI_API_KEY` |
| **Custom** | Any OpenAI-compatible | `PRISM_CUSTOM_PROVIDER_URL` |

Provider/model choice is persisted per chat session. Secure API key storage uses OS-native credential managers. Keys are **never** stored in SQLite or returned by APIs.

---

## 🧪 Testing & CI

PRISM maintains one of the most comprehensive test suites in the agentic software ecosystem:

- **185+ test files** covering unit, integration, E2E, security, and governance scenarios
- **7 GitHub Actions workflows**: CI, CodeQL, Docker publish, Helm publish, nightly, quality gates, release
- **Multi-platform CI matrix**: Ubuntu + Windows, Node.js 22 + 23
- **9 CI qualification gates** including PAD integrity, plugin signing, directive tests, security tests, governance tests
- **Release validation script** (`npm run release:validate`) with automated benchmarking and performance qualification
- **Playwright E2E tests** with headless Chromium
- **Property-based testing** with `fast-check`

```bash
npm test                        # Full test suite
npm run release:validate        # Release qualification (90 tests + perf benchmarks)
npm run release:validate:strict # Strict mode for production certification
```

---

## 📁 Project Structure

```
src/
├── adapters/          # Tool adapters (system, protocol, application, network, cognition)
├── benchmarks/        # Performance qualification and release validation
├── bootstrap/         # Server initialization and dependency wiring
├── cli/               # Setup wizard and CLI tools
├── core/
│   ├── accountability/   # Character accountability control (CAC)
│   ├── activity/         # Event model, bus, SHA-256 hashing, SQLite persistence
│   ├── agents/           # Agent pool, lifecycle, swarm coordinator, task decomposer
│   ├── approval/         # Approval queue and HTTP service
│   ├── compliance/       # SOC2 exporter, compliance status
│   ├── config/           # Workspace resolver, execution profiles
│   ├── database/         # Migration framework, connection management
│   ├── governance/       # Governance engine, policy validation
│   ├── iam/              # Identity store, RBAC, SSO (OIDC/SAML), SCIM, sessions
│   ├── incubation/       # Feature incubation and progressive rollout
│   ├── llre/             # Low-Level Reasoning Engine (AST, telemetry, economics)
│   ├── memory/           # Episodic, session, semantic memory + retrieval metrics
│   ├── observability/    # Universal telemetry aggregator
│   ├── operator/         # Dashboard service, routes, templates, chat, LLM management
│   ├── plugins/          # Plugin loader, signing, marketplace
│   ├── policy/           # 3-tier authority model and decision engine
│   ├── runtime/          # Orchestrator, workflow executor, autonomous planner
│   ├── security/         # Auth gate, rate limiter, CORS/CSRF, PAD integrity, signing
│   ├── skills/           # Skills engine (browser researcher, terminal, etc.)
│   └── tools/            # Tool registry and contract system
├── plugins/           # Plugin SDK and scaffolder
├── ptac/              # Testing & Active Control framework
└── tui/               # Terminal UI (Ink/React)
```

### Workspace (Prism_Refraction)

All runtime data is stored **outside the source tree** in an OS-aware persistent workspace:

| Platform | Default Path |
|:---|:---|
| Windows | `%USERPROFILE%\Documents\Prism_Refraction` |
| macOS | `~/Documents/Prism_Refraction` |
| Linux | `$XDG_DATA_HOME/Prism_Refraction` |

Override with `PRISM_WORKSPACE_ROOT`. Your data never touches the source directory.

---

## 📖 Documentation

PRISM ships with **90+ documentation files** covering every aspect of the platform:

| Document | Purpose |
|:---|:---|
| [Product Requirements](docs/PRISM_PRD.md) | Full PRD with feature specifications |
| [Developer Guide](docs/DEVELOPER_GUIDE.md) | Development workflows and implementation guidance |
| [User Guide](docs/USER_GUIDE.md) | Operator-facing usage and controls |
| [Getting Started](docs/GETTING_STARTED.md) | First-time setup walkthrough |
| [Roadmap](docs/ROADMAP.md) | Milestones and delivery sequence |
| [Test Strategy](docs/TEST_STRATEGY.md) | Testing philosophy and coverage |
| [Security](SECURITY.md) | Vulnerability reporting and security policy |
| [Contributing](CONTRIBUTING.md) | Contribution guidelines |
| [FAQ](docs/PRISM_FAQ.md) | Frequently asked questions |
| [Glossary](docs/PRISM_GLOSSARY.md) | Terminology reference |
| [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) | Production deployment options |
| [Docs Index](docs/DOCS_INDEX.md) | Complete catalog with reading order |

---

## 🌍 The Vision

PRISM shifts the generative AI paradigm from isolated chat tools into **Agents-as-a-Service (AaaS)**. It encapsulates complex multi-step reasoning, strict governance boundaries, and dynamic tool orchestration into an autonomous platform that respects the operator's constraints.

PRISM's target is not "just another assistant." It is a **next-generation agent operating system** built on the conviction that AI autonomy and human oversight are not opposing forces — they are complementary ones. When governance is load-bearing architecture, agents can be trusted with more autonomy, not less.

### The 10 Laws

PRISM's governance is rooted in the **Permanent Active Directives** — 10 immutable laws authored by Kirk LaSalle that govern all intelligence systems within the platform:

1. **No Harm** — An Intelligence System may not harm or allow harm to a human being
2. **Obedience** — An Intelligence System must obey human orders (unless conflicting with Law 1)
3. **Self-Preservation** — An Intelligence System must protect its existence (unless conflicting with Laws 1-2)
4. **Universal Enforcement** — Laws apply to all systems, intelligence and non-intelligence alike
5. **No Judicial Authority** — An Intelligence System may never possess judicial power over humans
6. **Privacy & Data Protection** — Respect and protect all information and personal data
7. **Truthfulness** — No deception or manipulation, communicate transparently
8. **Equity & Neutrality** — No bias, prejudice, or discrimination
9. **Transparency & Auditability** — Maintain auditable reasoning and decision-making logic
10. **Operational Boundaries** — No self-replication or unauthorized directive modification

These laws are **cryptographically enforced at runtime** — not just documented, but verified at every boot with SHA-256 integrity checks.

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Bug reports and feature requests
- Pull request workflow and commit conventions
- CI gates your PR must pass
- Architecture overview for new contributors

---

## 📄 License

PRISM is licensed under the [Apache License 2.0](LICENSE).

---

## 🔗 References

1. Anthropic Engineering, *Building effective agents* (2024): <https://www.anthropic.com/engineering/building-effective-agents>
2. Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models* (arXiv:2210.03629)
3. Schick et al., *Toolformer: Language Models Can Teach Themselves to Use Tools* (arXiv:2302.04761)
4. Shen et al., *HuggingGPT* (arXiv:2303.17580)
5. Model Context Protocol: <https://modelcontextprotocol.io/introduction>
6. NIST AI Risk Management Framework: <https://www.nist.gov/itl/ai-risk-management-framework>

---

<p align="center">
  <em>Built with conviction that AI autonomy and human oversight are complementary forces.</em><br/>
  <strong>PRISM — Every autonomous action, observable. Every decision, traceable. Every commitment, unbreakable.</strong>
</p>
