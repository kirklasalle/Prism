# PRISM

PRISM is a policy-governed, full-computer-use agent runtime designed to evolve into a world-class, state-of-the-art (SOTA), and novel agent platform for high-trust autonomous operations.

Current named release: **Prism v0.4.2 — Phase D4c: SR Advanced Features + Production Hardening**.

PRISM positions itself as a **governance-native, self-hostable Agents-as-a-Service (AaaS) runtime** — the only open-source platform with cryptographically enforced directives (PAD), a profile-aware 3-tier policy engine, and Spectrum Refraction tri-model fan-out. See [docs/PRISM_COMPETITIVE_AaaS_MAP_2026.md](docs/PRISM_COMPETITIVE_AaaS_MAP_2026.md) for the market landscape.

> **April 2026 — Security Hardening Complete:** Token-based authentication, rate limiting, optional HTTPS/TLS, and security headers are now enforced on all dashboard endpoints.

> **April 2026 — User Testing Ready:** PM2 process management, WebSocket auto-reconnect with exponential backoff, Docker deployment support, and provider health endpoint added.

> **2026 Q2 — Full Audit & Updated Roadmap:** See [docs/PRISM_FULL_AUDIT_2026_Q2.md](docs/PRISM_FULL_AUDIT_2026_Q2.md), [docs/PRISM_UPDATED_ROADMAP_2026_Q2.md](docs/PRISM_UPDATED_ROADMAP_2026_Q2.md), and [docs/READINESS_RUNBOOK.md](docs/READINESS_RUNBOOK.md) for the 2026 Q2 audit findings, gap analysis, and Phase R (Readiness) execution plan. New user guides: [BUSINESS_VS_INDIVIDUAL_GUIDE.md](docs/BUSINESS_VS_INDIVIDUAL_GUIDE.md), [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md), [ADMIN_SRE_GUIDE.md](docs/ADMIN_SRE_GUIDE.md), [ERROR_RECOVERY.md](docs/ERROR_RECOVERY.md), [CHARACTER_SELECTION_GUIDE.md](docs/CHARACTER_SELECTION_GUIDE.md).

Research quick links:

- Full-context research documentation: `docs/PRISM_RESEARCH_DOCUMENTATION.md`
- One-page executive summary: `docs/PRISM_RESEARCH_DOCUMENTATION.md#0-executive-summary-one-page`
- Board/investor half-page brief: `docs/PRISM_RESEARCH_DOCUMENTATION.md#01-boardinvestor-brief-half-page`
- Full parity gap blueprint: `docs/PRISM_GAP_ANALYSIS.md`
- Investor parity appendix: `docs/INVESTOR_APPENDIX_PARITY.md`
- Licensing and brand appendix: `docs/LICENSING_BRAND_APPENDIX.md`
- Individual-native + domain-pack strategy: `docs/INDIVIDUAL_PROFESSIONAL_INDUSTRIAL_CAPABILITY_STRATEGY.md`
- SR competitive analysis: `docs/MARKET_REVIEW.md`

This repository now contains:

- a working governed runtime,
- real tool adapters,
- live approval controls,
- memory subsystems,
- workflow orchestration with retries/timeouts/fallbacks,
- Spectrum Refraction (SR) tri-model parallel fan-out orchestration with structured aggregation,
- and integration tests for approval success, denial, and timeout paths.

## Vision

PRISM shifts the generative AI paradigm from isolated chat tools into **"Agents As A Service" (AaaS)**. It encapsulates complex multi-step reasoning, strict governance boundaries, and dynamic tool orchestration into an autonomous platform designed to respect the operator's constraints—bridging machine automation and human project/time management for a "Return of Growth and Integrity".

PRISM’s target is not “just another assistant.”
It is a next-generation agent operating system focused on five differentiators:

1. **Constitutional Operations Plane**
   - Every action is policy-classified before execution.
   - High-risk actions require explicit human approval.
   - Denial and timeout paths are first-class tested behaviors.

2. **Causal Memory Fabric**
   - Episodic + session + semantic memory are unified under query tools.
   - Every operation remains traceable from request → decision → effect.

3. **Adaptive Workflow Runtime**
   - Multi-step workflows support retries, timeouts, and conditional fallback routing.
   - Recovery is explicit rather than implicit.

4. **Tooling as Agent-Computer Interface (ACI)**
   - Tool contracts are treated as precision interfaces, not helper wrappers.
   - Safety constraints and rollback semantics are model-visible.

5. **Intelligent Multi-Agent Orchestration**
   - Agents are first-class runtime entities with managed lifecycles (ephemeral, semi-permanent, permanent).
   - Per-agent model assignment enables right-sizing: fast local models for classification, frontier models for complex reasoning.
   - Swarm coordination enables parallel multi-agent goal completion under policy governance.
   - Intelligent telemetry learns operational patterns and recommends agent lifecycle promotions.

6. **Spectrum Refraction (SR) — Compounded Tri-Model Orchestration**
   - Novel parallel fan-out architecture: Left (Logic) + Right (Creative) + Main (Coordination) generate simultaneously.
   - Structured XML-tagged aggregation fuses analytical rigor with creative breadth into a unified compound response.
   - Mandatory instance isolation enforcement: Left ≠ Right validated at configuration, activation, and runtime gates.
   - Three isolation quality levels: `full` (different providers), `model` (same provider, different models), `insufficient` (rejected).
   - Model capability validation ensures each hemisphere meets role-specific requirements (logic strength, creative modality).
   - No competing framework offers native multi-model simultaneous fan-out with structured aggregation and isolation enforcement.

7. **Trust-by-Design Telemetry**
   - Structured activity events are hashed and persisted.
   - Quality gates are measurable, not anecdotal.

8. **Character Accountability Control (CAC)**
   - Every agent action is linked to a character identity, a Prism user, and an operator via an immutable accountability chain.
   - Profile-aware email validation enforces domain-matching constraints in business mode while remaining permissive in individual mode.
   - Full lifecycle tracking: assign → dispatch → suspend → resume → revoke, with audit events at every transition.

9. **Cryptographic Governance — Permanent Active Directives (PAD)**
   - The 10 Laws (rooted in Asimov's Three Laws, extended to cover privacy, equity, transparency, and operational boundaries) are the immutable root governance document.
   - SHA-256 integrity verification at boot and runtime (Guardian Agent periodic re-check every 10 minutes).
   - Amendment requires Governance Council approval + cryptographic re-signing — enforcing Law 10 at the code level.
   - Machine-readable law manifest maps each directive to its runtime enforcement mechanism.
   - CI Gate 9 blocks merge/release when directives are modified without updating the integrity constant.
   - Governance preamble injected into all Tier 2+ model system prompts, ensuring every LLM interaction operates within the 10 Laws.

## Current Capabilities

- Activity bus with SHA-256 event hashing
- Policy engine with three authority tiers:
  - `tier1_autonomous`
  - `tier2_conditional`
  - `tier3_approval`
- Live approval service and queue for gated operations
- Real adapters:
  - system: shell and filesystem operations
  - protocol: HTTP requests
  - application: Neo4j adapter (optional) and memory query adapters
- SQLite persistence for activity traces and session summaries
- **Character Accountability Control (CAC):**
  - Character-to-operator identity binding with accountability chain (characterId, prismUserEmail, operatorEmail, clientId, sessionId)
  - Lifecycle management: assign, dispatch, suspend, resume, revoke
  - Profile-aware email domain validation: business profile enforces matching domains; individual profile is permissive
  - Execution profile segment normalization: `enterprise` and `corporate` resolve to canonical `business` segment
  - Full accountability chain propagated into activity events and SHA-256 integrity hashes
- **Permanent Active Directives (PAD) Governance:**
  - 10 Laws as cryptographically immutable root governance document
  - SHA-256 integrity verification at boot + Guardian Agent periodic re-check (600s)
  - Machine-readable law manifest with enforcement mapping (`src/core/security/directive-manifest.ts`)
  - Governance preamble injection into Tier 2+ model system prompts
  - CI Gate 9 blocks unauthorized directive modification
  - Amendment process: Governance Council approval + hash constant update in same commit
- Memory subsystems:
  - episodic buffer
  - session summary store
  - semantic retrieval index
- Retrieval interfaces:
  - `semantic_query`
  - `memory_query`
- Workflow engine features:
  - retries
  - step timeout
  - `always`, `on_failure`, and `on_timeout` fallback routing
- **Spectrum Refraction (SR) Tri-Model Orchestration:**
  - Compounding parallel fan-out: Left (Logic) + Right (Creative) + Main (Coordination)
  - Structured XML-tagged aggregation with hemisphere attribution
  - Mandatory instance isolation enforcement at configure, activate, and runtime gates
  - Isolation quality classification: full / model / insufficient
  - Model capability validation per hemisphere role (logic vs creative)
  - Media artifact extraction from Creative hemisphere
  - 4 SR API endpoints: `/api/sr/status`, `/api/sr/configure`, `/api/sr/activate`, `/api/sr/deactivate`
  - SR panel in Provider & Settings tab with isolation badge and cost advisory
- **Agent Control & Intelligent Orchestration:**
  - Agent lifecycle management with three tiers: ephemeral (per-task), semi-permanent (idle-reaped), permanent (manual stop)
  - Per-agent model assignment: dynamic provider/model override per agent, hot-swappable at runtime
  - Intelligent agent telemetry: pattern detection, role hotspot analysis, lifecycle promotion recommendations
  - Chat-to-agent routing: classifier-first intent detection routes the majority of tasks through specialized agents (coder, summarizer, planner, indexer)
  - Swarm orchestration: multi-agent goal completion with four topologies (mesh, star, pipeline, broadcast)
  - Task decomposition with dependency-aware parallel batch execution
- **Operator Dashboard** (`http://localhost:7070`):
  - Tab-based navigation: Chat Interface, Provider & Settings, Tools & Plugins, Agentic Control, Computer Control, Workspace, Network, Telemetry, Logs & Debug
  - Collapsible panels with persistent expand/collapse state
  - Provider & Settings tab: Session Provider Assignment, Provider Configuration, Model Capability Matrix, Settings (runtime config), LLM Audit Trail (JSON/CSV export)
  - Tools & Plugins tab:
    - **Tools** — 19 built-in tools across System (7), Application (5), Knowledge (3), and Integration (4) categories with risk-level and mutation badges
    - **Plugins** — 7 MCP server plugins: ids-mcp, web-search-mcp, and ImpressionCore suite (eds, ipa, goliath, vrgc, dpa) with type and status badges
    - **Utilities** — 30 system utilities across Benchmarks & Qualification (11), Operator Services (5), Memory & Retrieval (5), Activity & Audit (3), Replay & Verification (3), Configuration (3)
  - Network tab: ~50 curated network commands (ipconfig, ping, tracert, netstat, netsh, arp, nslookup, route, net, etc.) with tier-based governance, live interface viewer, telemetry counters, and interactive console
  - 41+ HTTP API routes for programmatic access
  - WebSocket for real-time event streaming and UI log ingestion into Logs & Debug
  - **Prism Dashboard Control Tool**: LLM-native tool for agents to inspect active tabs, navigate the dashboard, emit telemetry, and publish logs directly to the operator's view.
  - **Guardian Agent (llama.cpp)**: Permanent autonomous system agent powered by local llama.cpp inference. Monitors runtime health, self-heals crashed model slots, enforces policy boundaries, and operates Prism independently alongside the operator. Configurable via environment variables with speculative decoding support for 2–6x faster inference.
- **Security Hardening:**
  - Token-based authentication gate on all HTTP and WebSocket endpoints (auto-generated 256-bit token, timing-safe comparison)
  - Per-IP rate limiting (200 req/min default, configurable via `PRISM_RATE_LIMIT`)
  - Optional HTTPS/TLS via `PRISM_TLS_CERT` + `PRISM_TLS_KEY` environment variables
  - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  - Auth bypass for dev: `PRISM_AUTH_DISABLED=true`
- **Deployment & Process Management:**
  - PM2 process management with auto-restart, memory limits, and log rotation (`ecosystem.config.js`)
  - Docker support: multi-stage `Dockerfile` and `docker-compose.yml` with health checks and persistent volumes
  - WebSocket auto-reconnect with exponential backoff (1s → 30s cap, max 50 retries) and connection status indicator
  - SSE (EventSource) reconnect with matching exponential backoff
  - Provider health endpoint: `GET /api/llm/provider-health` — tests all configured providers in parallel with latency measurement
- **Self-Drive Demonstration (PTAC Operator Demo, v0.20):**
  - One-click recorded run from the Computer Control tab. PRISM drives its own dashboard end-to-end (chat, approvals, computer-use, browser, real PTY, real Docker) and emits a portable, browser-playable HTML slideshow.
  - Triple-gated by `PRISM_PTAC_OPERATOR_DEMO=1` + `PRISM_PTAC_SAFE=1` + `PRISM_PTAC_RECORD_VIDEO=1`. Default deployments have zero gates set.
  - Full walkthrough: [docs/PTAC_OPERATOR_DEMO_GUIDE.md](docs/PTAC_OPERATOR_DEMO_GUIDE.md).

## Quick Start

### Standard (Node.js)

```bash
# Windows
start_web.bat

# Linux / macOS
chmod +x start_web.sh && ./start_web.sh
```

### With PM2 (auto-restart on crash)

```bash
npm install -g pm2
npm run pm2:start       # Start with PM2
npm run pm2:logs        # View logs
npm run pm2:monit       # Monitor dashboard
npm run pm2:stop        # Stop
```

### With Docker

```bash
npm run docker:build    # Build image
npm run docker:up       # Start container (detached)
npm run docker:down     # Stop container

# Or directly:
docker compose up -d
```

The dashboard will be available at `http://localhost:7070`.

## Why this architecture is aligned with modern agent research

PRISM’s design combines findings from production guidance and academic agent literature:

- **Use workflows where paths are known, agents where paths are not known in advance** (Anthropic guidance). PRISM supports both deterministic orchestration and dynamic tool execution.
- **Interleave reasoning with action and environmental feedback** (ReAct). PRISM enforces a loop where tool results and policy outcomes become the next decision context.
- **Tool use should be native and explicit** (Toolformer). PRISM makes tool operations first-class, typed, auditable actions.
- **Controller-worker decomposition enables cross-domain composition** (HuggingGPT). PRISM’s orchestrator plus specialized adapters mirrors this pattern.
- **Trust and safety should be operationalized** (NIST AI RMF). PRISM maps governance into measurable controls and failure behaviors.

## Agentic Landscape Summary (Concise)

### 1) Landscape categories

- **Single-call augmented models**: retrieval + tools, low latency, limited autonomy.
- **Structured workflows**: prompt chains, routers, parallel workers, evaluator loops.
- **Autonomous agents**: open-ended loop with tool-driven grounding and checkpoints.

### 2) What separates world-class systems

- Reliable tool invocation with strict contracts
- Explicit state models and recovery semantics
- Transparent policy and approval boundaries
- Continuous evals tied to deployment gates
- Deep observability across decisions and effects

### 3) Common failure modes in non-mature systems

- Hidden control flow and weak debuggability
- Tool schema ambiguity
- Missing rollback pathways
- Unmeasured autonomy (no bounded loop controls)
- Sparse safety instrumentation

PRISM is intentionally built to remove those failure modes from the start.

## Development Plan toward SOTA + Novelty

### Phase 1: Reliability hardening (near-term)

- Expand denial and timeout integration tests across all high-risk adapters.
- Add deterministic replay mode for workflow and tool execution paths.
- Add contract test suite for all adapters (input constraints, failure classes, rollback integrity).
- **Retrieval observability (✓ complete):**
  - Collect retrieval quality metrics (coverage, novelty, utility scores, latency distributions)
  - Dashboard endpoints: `/api/retrieval/cohorts`, `/api/retrieval/alerts`, `/api/retrieval/trends`
  - Web UI displays cohort quality metrics, threshold-based alerts, and baseline trend comparisons
  - Configurable alert policy thresholds for dev/staging/prod environments

### Phase 2: Intelligence quality system

- Expand retrieval quality proxy tuning (coverage, novelty, utility scoring baselines).
- Build evaluator-optimizer loops for workflow synthesis and tool argument refinement.
- Add benchmark harness:
  - task success,
  - policy correctness,
  - execution efficiency,
  - safety incidents per 1,000 operations.

### Phase 3: Novel capabilities (targeting “never-before-seen” class behavior)

- **Constitutional Causal Compiler (novel concept):** auto-compile policy + memory + workflow constraints into enforceable runtime plans before execution.
- **Dual-Lens Memory Retrieval (novel concept):** one lens optimized for semantic relevance, another for causal consequence/rollback relevance, then fused by confidence arbitration.
- **Self-Healing Workflow Synthesis (novel concept):** runtime transforms failed workflow segments into candidate alternatives under policy constraints, then stages them through evaluator gates.

### Phase 4: Production governance envelope

- Full operator cockpit (live approvals, intervention controls, replay, diffed outcome analysis)
- Signed policy bundles and environment attestation
- Incident and postmortem automation integrated with activity traces

## Project Structure

- `src/core/activity`: event model, bus, persistence subscribers
- `src/core/policy`: authority model and decision engine
- `src/core/runtime`: orchestrator and workflow executor
- `src/core/approval`: approval queue and HTTP service
- `src/core/memory`: episodic/session/semantic memory + retrieval metrics
- `src/core/accountability`: character accountability store and manager (CAC identity chain, lifecycle, profile-aware validation)
- `src/core/agents`: agent pool, lifecycle manager, telemetry collector, swarm coordinator, agent router, task decomposer
- `src/core/operator`: dashboard service, LLM provider manager, model capability matrix (incl. SR), chat session store (incl. SR config)
- `src/core/config`: workspace resolver, execution profiles, environment config
- `src/adapters/system`: shell/filesystem tools
- `src/adapters/protocol`: HTTP tool
- `src/adapters/application`: Neo4j + memory query tools
- `src/adapters/network`: curated network diagnostics and config tools
- `characters/`: example agent character briefs (JSON)
- `tests`: unit and integration tests, including workflow governance scenarios

### Workspace (Prism_Refraction)

All runtime data is stored outside the source tree in an OS-aware persistent workspace:

| Platform | Default Path                               |
| :------- | :----------------------------------------- |
| Windows  | `%USERPROFILE%\Documents\Prism_Refraction` |
| macOS    | `~/Documents/Prism_Refraction`             |
| Linux    | `$XDG_DATA_HOME/Prism_Refraction`          |

Override with `PRISM_WORKSPACE_ROOT` env var. Subdirectories include `config/`, `artifacts/`, `data/`, `state/`, `characters/`, and `logs/`. See the [User Guide](docs/USER_GUIDE.md#6-workspace--persistence) for full layout.

## Run

### Easiest (Windows one-click)

1. Double-click `start_web.bat`
2. PRISM starts in server mode and opens dashboard: `http://localhost:7070`
3. Use the **Chat Interface** tab for conversational LLM interaction
4. Use the **Provider & Settings** tab to configure LLM providers, review model capabilities, adjust runtime settings, and view the LLM Audit Trail
5. Use the **Tools & Plugins** tab to browse all 19 built-in tools, 7 MCP plugins, and 30 system utilities
6. Use the **Agentic Control** tab to monitor the **Guardian Agent** (local llama.cpp), manage agent swarms, and view local hardware resource allocation.
7. Use the **Computer & Browser Control** tabs for direct autonomous system and web interaction.
8. Use the **Network** tab to run curated network diagnostics, view live interface data, and monitor network operations
9. Use the **Telemetry** tab for retrieval observability and performance metrics
10. Use the **Logs & Debug** tab to inspect the activity event stream and trace AI decision paths.

Optional startup preflight modes:

- `start_web.bat build` (default): dependency + build checks
- `start_web.bat test`: full `npm test` before launch
- `start_web.bat release`: run `npm run release:validate` before launch
- `start_web.bat strict`: run `npm run release:validate:strict` before launch

Optional non-launch verification (useful for local validation):

- set `PRISM_SKIP_LAUNCH=1` before running `start_web.bat` to execute checks and exit without starting the server.

Strict production readiness helper:

- Run `release_strict_ready.bat` to set required production confirmation environment variables and execute `npm run release:validate:strict` in one step.

### CLI modes

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Run runtime demo (single-run demo mode):
   - `npm start`
4. Run persistent server mode (dashboard + approval APIs):
   - `npm run start:server`
5. Run tests:
   - `npm test`

## LLM Provider Configuration (Dynamic + Secure)

PRISM chat now supports runtime provider/model switching with:

- OpenAI
- Anthropic
- Ollama (local)
- Llama.cpp (local)
- Custom provider endpoints (OpenAI-compatible; includes Cutson/custom setups)

### Security model for API keys

- Keys can be supplied from environment variables or stored through the dashboard.
- Dashboard-stored API keys are persisted in a Windows-protected secret store for the current user.
- Keys are never persisted in SQLite.
- Keys are never returned by dashboard APIs.
- Dashboard shows only key presence state (`hasApiKey: true/false`).
- Provider/model switch operations are audit-emitted to the activity bus (`dashboard.llm_selection`) with session and before/after selection details.
- Non-secret provider settings such as base URL, model list, and default model are persisted in SQLite and restored automatically.

### Environment variables

Core selection:

- `PRISM_LLM_PROVIDER` = `openai` | `anthropic` | `ollama` | `custom`
- `PRISM_LLM_MODEL` = selected model name

OpenAI:

- `OPENAI_API_KEY`
- `PRISM_OPENAI_BASE_URL` (optional; default `https://api.openai.com/v1`)
- `PRISM_OPENAI_MODELS` (optional comma list)

Anthropic:

- `ANTHROPIC_API_KEY`
- `PRISM_ANTHROPIC_BASE_URL` (optional; default `https://api.anthropic.com/v1`)
- `PRISM_ANTHROPIC_MODELS` (optional comma list)

Ollama (local):

- `PRISM_OLLAMA_BASE_URL` (optional; default `http://127.0.0.1:11434`)
- `PRISM_OLLAMA_MODELS` (optional fallback comma list)

Ollama Cloud (remote):

- `OLLAMA_API_KEY` or `PRISM_OLLAMA_CLOUD_API_KEY` (required; API key from <https://ollama.com/settings/keys>)
- `PRISM_OLLAMA_CLOUD_BASE_URL` (optional; default `https://ollama.com`)
- `PRISM_OLLAMA_CLOUD_MODELS` (optional comma list; defaults to gpt-oss:120b, gpt-oss:20b, deepseek-v3.1:671b, kimi-k2:1t, qwen3-coder:480b, kimi-k2-thinking)

Llama.cpp (local):

- `PRISM_LLAMACPP_BASE_URL` (optional; default `http://127.0.0.1:8080/v1`)
- `PRISM_LLAMACPP_MODELS` (optional fallback comma list)
- `PRISM_LLAMACPP_BIN` (optional; path to `llama-server` binary, default `llama-server`)

Guardian Agent (llama.cpp autonomous agent):

- `PRISM_GUARDIAN_MODEL_ALIAS` (optional; default `guardian`)
- `PRISM_GUARDIAN_MODEL_PATH` (required for auto-start; path to GGUF model file)
- `PRISM_GUARDIAN_AUTHORITY` (optional; `tier1_autonomous` or `tier2_conditional`, default `tier2_conditional`)
- `PRISM_GUARDIAN_AUTOSTART` (optional; `true`/`false`, default `true`)
- `PRISM_GUARDIAN_CTX_SIZE` (optional; context size, default `4096`)
- `PRISM_GUARDIAN_DRAFT_MODEL` (optional; path to GGUF draft model for speculative decoding)
- `PRISM_GUARDIAN_GPU_LAYERS` (optional; number of GPU layers to offload)
- `PRISM_GUARDIAN_FLASH_ATTN` (optional; `true` to enable flash attention)

Custom/Cutson-compatible provider:

- `PRISM_CUSTOM_PROVIDER_NAME` (optional display label)
- `PRISM_CUSTOM_PROVIDER_URL` (required)
- `PRISM_CUSTOM_PROVIDER_API_KEY` (optional if provider requires auth)
- `PRISM_CUSTOM_PROVIDER_API_KEY_HEADER` (optional; default `Authorization`)
- `PRISM_CUSTOM_MODELS` (recommended comma list)

### Dynamic provider/model switching

From the dashboard:

1. Open the **LLM Provider** panel (right rail).
2. Configure provider-specific settings such as base URL, model list, default model, and secure API key storage as needed.
3. Save the provider settings and, for remote providers, store the API key securely.
4. Select provider and model for the currently selected chat session.
5. Click **Apply**.

Provider/model choice is persisted per chat session in SQLite and restored automatically.
Provider metadata is persisted globally per provider on the local machine.

Programmatic APIs:

- `GET /api/llm/providers?sessionId=<chat-session-id>` — returns available providers, model lists, and active selection for that session
- `GET /api/llm/provider-settings?providerId=<provider-id>` — returns the safe provider settings snapshot for one provider
- `POST /api/llm/provider-settings` — persists non-secret provider settings for one provider
- `POST /api/llm/provider-secret` — stores one provider API key in the Windows-protected secret store
- `DELETE /api/llm/provider-secret?providerId=<provider-id>` — clears one provider API key from the secure store
- `POST /api/llm/select` — sets provider/model for one session
  - body: `{ "sessionId": "<chat-session-id>", "providerId": "ollama", "model": "llama3.1:8b" }`
- `GET /api/events?operation=dashboard.llm_selection&chatSessionId=<chat-session-id>&limit=10` — returns provider switch audit events for one session

Dashboard audit view:

- The **Provider & Settings** tab includes the **LLM Audit Trail** panel.
- It shows provider switch success/failure counts and recent selection transitions (`requested -> selected`) scoped to the current chat session.
- Use **Export JSON** in the LLM Audit Trail panel to download the current session-scoped provider-switch audit payload for compliance handoff.
- Use **Copy JSON** to place the same scoped audit payload directly on clipboard for incident/ticket workflows.
- Use **Export CSV** for spreadsheet-friendly audit review and analyst ingestion.

### Retrieval observability and quality metrics

The dashboard exposes retrieval quality telemetry via HTTP APIs and a dedicated UI panel:

**Observability endpoints:**

- `GET /api/retrieval/cohorts` — returns current cohort dashboard with quality metrics (hit rate, coverage, novelty, utility, p95 latency) aggregated by query intent
- `GET /api/retrieval/alerts` — returns active alerts (utility drops, hit-rate drops, p95 latency spikes) based on configurable thresholds
- `GET /api/retrieval/trends` — returns trend report showing baseline-comparison deltas, ranked by magnitude of change across snapshot history

**Dashboard retrieval panel:**

- The **Telemetry** tab includes **Retrieval Observability**.
- It displays the top 5 active alerts with color highlighting for severity.
- Alerts are tuned per environment profile (`dev`, `staging`, `prod`) via centralized `RetrievalAlertPolicy`.

**Configuration:**

Set the environment profile to tune alert sensitivity:

```bash
export PRISM_ENV_PROFILE=prod  # strict thresholds (high-quality requirements)
npm run start:server
```

### Local Ollama quick start (Windows)

1. Start Ollama locally (`ollama serve`).
2. Pull a model (`ollama pull llama3.1:8b`).
3. Start PRISM server mode:
   - `set PRISM_LLM_PROVIDER=ollama`
   - `set PRISM_LLM_MODEL=llama3.1:8b`
   - `npm run start:server`

If no provider is configured or a provider call fails, PRISM returns a clear in-chat error with guidance to switch provider/model.

## Appendix: Spectrum Refraction (SR) Architecture (2026-04-12)

Spectrum Refraction is PRISM's novel tri-model orchestration system, introducing compounding parallel generation as a core runtime capability.

Canonical references:

- Implementation: `src/core/operator/model-capability-matrix.ts` (SR types, validation), `src/core/operator/llm-provider-manager.ts` (generation pipeline)
- API: `src/core/operator/dashboard-service.ts` (SR endpoints)
- UI: `src/dashboard/tab-settings.js` (SR panel), `src/dashboard/tab-chat.js` (SR response badge)
- Market review: `docs/MARKET_REVIEW.md` (competitive positioning and feature comparison)

Key design constraint: Left and Right hemispheres must always be distinct instances (different model and/or different provider). This is validated and enforced at every gate — no competitor enforces multi-model isolation.

## Documentation Map

- Full-context research dossier: `PRISM_RESEARCH_DOCUMENTATION.md`
- Product requirements: `PRISM_PRD.md`
- Development execution details: `DEVELOPER_GUIDE.md`
- Operator usage and controls: `USER_GUIDE.md`
- Milestones and sequence: `ROADMAP.md`
- Full docs index and reading order: `DOCS_INDEX.md`
- SR competitive analysis: `MARKET_REVIEW.md`
- Actionable work items: `TODO.md`
- Version history: `../CHANGELOG.md`

### Complete Documentation Catalog

Core product and strategy:

- `PRISM_PRD.md` — product requirements document
- `ROADMAP.md` — milestones and delivery sequence
- `PRISM_RESEARCH_DOCUMENTATION.md` — full research context and rationale

Execution and operations:

- `DEVELOPER_GUIDE.md` — development workflows and implementation guidance
- `USER_GUIDE.md` — operator-facing usage and controls
- `PHASE_EXECUTION_PLAN.md` — phased implementation and validation plan
- `TEST_STRATEGY.md` — testing philosophy and coverage strategy
- `PRODUCTION_RELEASE_RUNBOOK.md` — release and promotion checklist
- `PRISM_BATON_PASS_VERBATIM.md` — project handoff context and continuity notes

Navigation and indexing:

- `DOCS_INDEX.md` — canonical docs index and recommended reading order
- `MARKET_REVIEW.md` — competitive landscape analysis for Spectrum Refraction positioning
- `TODO.md` — actionable near-term, medium-term, and aspirational work items
- `../CHANGELOG.md` — version history and release notes

Supporting startup/release scripts referenced by docs:

- `start_web.bat` — primary Windows startup and preflight entrypoint
- `release_strict_ready.bat` — strict release validation helper

## Appendix: Computer Use Core + Business Security Alignment Gate (2026-03-25)

Computer use is a core PRISM capability, not an auxiliary feature. PRISM defines computer use as the governed combination of browser automation, terminal virtualization, and container sandbox orchestration under policy-tier control.

Canonical reference:

- `docs/COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`

Business enterprise non-drift requirements:

- Preserve mandatory governance tiers (`tier1_autonomous`, `tier2_conditional`, `tier3_approval`) for all computer-use pathways.
- Preserve CAC accountability chain requirements on governed operations and lifecycle transitions.
- Preserve sandboxed-execution, least-privilege, and sensitive-action confirmation controls for Business profile workflows.
- Do not present external benchmark numbers as Prism-validated unless reproduced in first-party qualification artifacts.

Implementation status labels for computer-use claims must use one of:

- `Implemented`
- `In Progress`
- `Planned`
- `Out of Scope`

## References

1. Anthropic Engineering, *Building effective agents* (2024): <https://www.anthropic.com/engineering/building-effective-agents>
2. Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models* (arXiv:2210.03629): <https://arxiv.org/abs/2210.03629>
3. Schick et al., *Toolformer: Language Models Can Teach Themselves to Use Tools* (arXiv:2302.04761): <https://arxiv.org/abs/2302.04761>
4. Shen et al., *HuggingGPT* (arXiv:2303.17580): <https://arxiv.org/abs/2303.17580>
5. Model Context Protocol Introduction: <https://modelcontextprotocol.io/introduction>
6. NIST AI Risk Management Framework: <https://www.nist.gov/itl/ai-risk-management-framework>
7. PRISM Spectrum Refraction Market Review: `docs/MARKET_REVIEW.md` (competitive analysis of 6 frameworks, April 2026)
