# PRISM

PRISM is a policy-governed, full-computer-use agent runtime designed to evolve into a world-class, state-of-the-art (SOTA), and novel agent platform for high-trust autonomous operations.

Research quick links:

- Full-context research documentation: `PRISM_RESEARCH_DOCUMENTATION.md`
- One-page executive summary: `PRISM_RESEARCH_DOCUMENTATION.md#0-executive-summary-one-page`
- Board/investor half-page brief: `PRISM_RESEARCH_DOCUMENTATION.md#01-boardinvestor-brief-half-page`
- Individual-native + domain-pack strategy: `INDIVIDUAL_PROFESSIONAL_INDUSTRIAL_CAPABILITY_STRATEGY.md`

This repository now contains:

- a working governed runtime,
- real tool adapters,
- live approval controls,
- memory subsystems,
- workflow orchestration with retries/timeouts/fallbacks,
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

5. **Trust-by-Design Telemetry**
   - Structured activity events are hashed and persisted.
   - Quality gates are measurable, not anecdotal.

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
- `src/adapters/system`: shell/filesystem tools
- `src/adapters/protocol`: HTTP tool
- `src/adapters/application`: Neo4j + memory query tools
- `tests`: unit and integration tests, including workflow governance scenarios

## Run

### Easiest (Windows one-click)

1. Double-click `start_web.bat`
2. PRISM starts in server mode and opens dashboard: `http://localhost:7070`
3. Use dashboard **Actions** to run demo operations directly from the browser
4. Use **Pending Approvals** to approve/deny Tier-3 requests

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

- The right rail now includes **LLM Audit Trail**.
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

- The right rail includes **Retrieval Observability**.
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

## Documentation Map

- Full-context research dossier: `PRISM_RESEARCH_DOCUMENTATION.md`
- Product requirements: `PRISM_PRD.md`
- Development execution details: `DEVELOPER_GUIDE.md`
- Operator usage and controls: `USER_GUIDE.md`
- Milestones and sequence: `ROADMAP.md`
- Full docs index and reading order: `DOCS_INDEX.md`

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

Supporting startup/release scripts referenced by docs:

- `start_web.bat` — primary Windows startup and preflight entrypoint
- `release_strict_ready.bat` — strict release validation helper

## References

1. Anthropic Engineering, *Building effective agents* (2024): <https://www.anthropic.com/engineering/building-effective-agents>
2. Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models* (arXiv:2210.03629): <https://arxiv.org/abs/2210.03629>
3. Schick et al., *Toolformer: Language Models Can Teach Themselves to Use Tools* (arXiv:2302.04761): <https://arxiv.org/abs/2302.04761>
4. Shen et al., *HuggingGPT* (arXiv:2303.17580): <https://arxiv.org/abs/2303.17580>
5. Model Context Protocol Introduction: <https://modelcontextprotocol.io/introduction>
6. NIST AI Risk Management Framework: <https://www.nist.gov/itl/ai-risk-management-framework>
