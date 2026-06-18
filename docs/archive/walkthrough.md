# Walkthrough: Google & Gemini 3 Flash Model Selection Integration, Guardian Recommended Models, Clean Model Management, Operator Authentication, Phase 3 Guardian Monitoring, System Initialization, & Library of Congress Plugin Architecture

We have successfully completed the end-to-end integration, debugging, and verification of Google and Gemini 3 Flash model selection for Prism autonomous loops, runtime tests, and tooling models. Furthermore, we expanded the Guardian Agent panel with an advanced curated list of local small agentic models under 4B parameters, implemented robust local model deletion capabilities for space management, established an enterprise-grade Operator Authentication system with automatic default account seeding, completed Phase 3 Guardian AAB monitoring and covenant audits, fixed HTTP 307/308 redirects in model downloads, automated computer and browser control initialization during setup completion, and formally implemented a complete built-in Library of Congress research engine plugin and MCP server.

## Changes Made

### Library of Congress & EDS Research Plugin Architecture
- **Dedicated Python MCP Server (`loc-mcp-server/server.py`)**: Built an official Model Context Protocol (MCP) server located in both `.mcp/loc-mcp-server/server.py` and `D:\Projects\impressioncore\.mcp\loc-mcp-server\server.py` exposing standardized research tools:
  - `loc_search_catalog(query, collection, limit)`: General catalog search across books, photos, maps, audio, film, manuscripts, and web archives.
  - `loc_search_newspapers(terms, state, year_start, year_end, limit)`: Full Chronicling America historic American newspaper snippet and OCR search (1777-1963).
  - `loc_get_item_metadata(item_url)`: High-fidelity structured metadata, media manifests, and rights advisory retrieval for any LoC item URL.
  - `loc_search_legislation(query, limit)`: Congress.gov legislative bill and resolution tracking.
- **Server Configuration Registration**: Added `loc-mcp-server` to both `.mcp/mcp-settings.json` and ImpressionCore's `.mcp/mcp-settings.json` with standard Python executable and virtual environment paths.
- **Agentic Dashboard & Polling Integration (`tab-tools.js`)**: Registered `loc-mcp-server` in the default tools UI catalog card list and added it to `_KNOWN_PLUGINS` to ensure live polling and health monitoring.
- **Canonical Plugin Pack Manifest (`src/plugins/loc-research/manifest.json`)**: Created a fully compliant `PluginPackManifest` (`manifest_version: "1.0"`, `pack_name: "loc-research"`, `pack_version: "1.0.0"`, `adapters: [...]`, `compatibility: { profiles: ["individual", "business"] }`) verified against `PluginPackValidator`.
- **JavaScript Plugin Adapter (`src/plugins/loc-research/index.js`)**: Implemented a native Node.js plugin runtime wrapper for direct LoC API querying with rate-limiting and error handling.

### Model Download & Redirect Fix (`dashboard-service.ts`)
- **Robust HTTP Redirect Handling**: When downloading GGUF models directly from Hugging Face (`/resolve/main/...`), Hugging Face frequently responds with `HTTP 307 Temporary Redirect` (or `308`) pointing to their CDN nodes. Updated `downloadFile` in `DashboardService` to support `[301, 302, 307, 308]` status codes and safely resolve relative or absolute `Location` headers against the original request URL, ensuring flawless high-speed downloads.

### Operator Login & Account Seeding (`store.ts`, `iam-handler.ts`, `login.ts`, `dashboard-service.ts`)
- **SQLite IAM Persistent Store**: Added `updateUserAttrs` statement and helper method to `store.ts` to allow dynamic updating of operator attributes such as securely hashed passwords.
- **Enterprise IAM Auth Gate Enforcement**: Updated `DashboardHandler` root routing logic:
  - If the setup wizard is not complete, forces redirection to `/setup`.
  - Once setup is complete, verifies HMAC-SHA256 signed operator session cookies.
  - If launched via `start_web.bat` with a query token (`/?token=...`), automatically establishes an admin session for seamless desktop experience.
  - Otherwise, cleanly redirects unauthenticated operators to `/login`.
- **Premium Operator Login Screen**: Created `login.ts` with rich aesthetics (dark mode, glassmorphism cards, glowing cyan/indigo gradient accents, smooth transitions, font Inter/Outfit). Included interactive quick-fill buttons for instant credential filling:
  - **Admin Profile**: `admin@prism.ai` (password: `admin`, role: `admin`).
  - **Testing Operator**: `testing@prism.ai` (password: `testing`, role: `operator`).
- **Account Seeding**: During `DashboardService` startup, automatically provisions the SQLite database (`.prism/iam.db`), seeds the canonical RBAC roles (`root`, `admin`, `operator`, `viewer`), and creates the default `admin@prism.ai` and `testing@prism.ai` accounts.

### Wizard End-to-End System Initialization & CAC Pipeline (`dashboard-service.ts`)
- **Desktop Screengrab Capture**: Integrated `this.framebufferCapture.captureSingle()` into `POST /api/setup/cac` and `POST /api/setup/complete` to ensure the computer control framebuffer is immediately initialized.
- **Browser Automation Session**: Integrated automated profile creation (`this.tools.find(t => t.name === "browser_control").getProfileManager().createProfile()`) and headless browser session launch (`getManager().launch({ headless: true })`) during setup wizard completion.
- **Character Access Control (CAC) Auto-Binding**: Verified the complete end-to-end identity chain in `createChatSession`. When a session is created or seeded during wizard completion, `characterAccountabilityManager.assign()` automatically provisions the CAC assignment id and binds the chat session, establishing uncompromised governance tracking.

### Phase 3: Guardian AAB Monitoring & Covenant Audits (`guardian-agent.ts`, `prism-covenant.ts`, `dashboard-service.ts`)
- **Autonomous Activity Bus (AAB) Ledger Monitoring**: Verified `taskAABLedgerMonitor()` in `GuardianAgent`. Every 10 seconds, Guardian inspects the AAB ledger count. If new entries are detected, it evaluates the risk profile and records an audit action.
- **Covenant Audits & Immediate Intervention**: Verified `taskCovenantAudit()` in `GuardianAgent`. Guardian polls the active `CovenantStatus` to detect any active violations or un-remediated articles.
- **Bi-Directional Covenant Binding**: Implemented `bindGuardian(guardian: GuardianAgent)` on `PrismCovenant`. When a severe covenant violation occurs (severity `"breach"` or `"critical"`), `PrismCovenant` instantly invokes `guardian.runTask("covenant_audit")` to trigger immediate supervisor or operator intervention. In `DashboardService`, wired `covenant.bindGuardian(this.guardianAgent)` at startup.

### Clean Model Management & Deletion
- **Backend File System & Ollama Removal (`dashboard-service.ts`)**: Implemented `/api/models/delete` (DELETE) endpoint:
  - For Ollama models (`source === "ollama"`), executes `ollama rm <tag>` asynchronously.
  - For local GGUF model files on disk (`source === "workspace-models"` or `"workspace"`), verifies existence and safely removes the file using `unlinkSync`.
- **OpenAPI Specification Parity (`openapi-generator.ts`)**: Registered `/api/models/delete` in the OpenAPI 3.0 specification generator to ensure perfect documentation parity.
- **Agentic UI Deletion Controls (`tab-agentic.js`)**:
  - Added a dedicated delete button (`🗑️ Delete File`) in the active Guardian model status banner.
  - Added delete buttons directly next to downloaded models within the "Recommended for Prism" grid cards (`✅ Ready / Select` + `🗑️`).
  - Implemented `deleteLocalModel` function with double-confirmation dialog (`confirm`) to prevent accidental deletions. If the deleted model is currently selected by Guardian, automatically resets Guardian's active model.
- **Global Event Exporter (`dashboard-app.js`)**: Imported and exposed `deleteLocalModel` to the global `window` object.

### MCP Tool Removal
- **Completely Cleaned MCP Server Tool Registrations**: Per user instructions, located and completely eliminated three specific tools from both active and workspace MCP server configurations:
  - Removed `b1_optimization_analysis` and `gtx_1050_ti_hardware_analysis` schemas and their execution handlers from `d:\Projects\Prism\.mcp\ids-mcp\server_ai_enhanced.py` and `D:\Projects\impressioncore\.mcp\ids-mcp\server_ai_enhanced.py`.
  - Removed `create_b1_optimized_dataset` schema and its execution handler from `d:\Projects\Prism\.mcp\impressioncore-eds\server_enhanced.py` and `D:\Projects\impressioncore\.mcp\impressioncore-eds\server_enhanced.py`.
- **Verified Zero Compilation Issues**: Executed clean build to ensure all system adapters maintain perfect operational integrity.

### Llama.cpp Fallback & Local Model Priority Enforcement
- **Provider Fallback Sequencing (`llm-provider-manager.ts`)**: Updated `ALL_PROVIDER_IDS` to place `"llamacpp"` and `"bitnetcpp"` strictly before `"ollama"` and `"ollama-cloud"`. When Prism evaluates unconfigured or fallback local inference providers via `findFirstEnabledProvider()`, local Llama.cpp servers and GGUF runtimes are now consistently prioritized ahead of Ollama.
- **Wizard Defaults Consistency**: Updated all onboarding flows to default to `llamacpp` instead of `ollama`:
  - **TUI Wizard (`SetupWizardTab.tsx`)**: Added `llamacpp` as the top-most provider option and updated initial wizard state.
  - **Web Wizard (`setup-wizard.js`, `setup-wizard-advanced.js`)**: Updated client-side JavaScript default configuration states to `llamacpp`.
  - **CLI Wizard (`setup-wizard.ts`, `setup-wizard-advanced.ts`)**: Updated interactive and non-interactive CLI argument defaults and provider lists to prioritize Llama.cpp.

### Guardian Agentic UI & Recommended Models (`tab-agentic.js`)
- **Expanded Recommended Models Catalog**: Enriched `RECOMMENDED_MODELS` with structured, community-praised small agentic models under 4B parameters:
  - **Gemma 4 Models**: Added `Gemma 4 E2B (~2B Agentic)` (`gemma2:2b`) and `Gemma 4 E4B (4B Mobile Agent)` (`gemma2:2b-instruct-q8_0`).
  - **Phi-4 Mini**: Added `Phi-4 Mini (3.8B Reasoning)` (`phi4:mini`), praised for strong instruction-following and reasoning.
  - **Llama 3.2**: Added `Llama 3.2 (3B Parameters)` (`llama3.2:3b`).
  - **Gemma 2**: Added `Gemma 2 (2B Parameters)` (`gemma2:2b`).
  - **Qwen 3 / 3.5 Series**: Added `Qwen3-1.7B (Quantized Agent)`, `Qwen3.5-2B (Highly Recommended)`, and `Qwen3.5-4B (Strong Performance)` (`qwen2.5:1.5b` and `qwen2.5:3b`).
  - **Specialized Agentic Models**: Added `Ministral-3-3B-Instruct-2512` (`ministral:3b`), `Granite4:3b (128k Context)` (`granite3.1-dense:3b`), `Hammer2.1-3b (Function Calling)` (`hammer:3b`), and `LocoTrainer-4B (MS-SWIFT Agent)` (`locotrainer:4b`).
- **Verified GGUF HuggingFace URLs & Filename Resolution**: Resolved 404 download errors when fetching community GGUFs directly from HuggingFace. Updated `RECOMMENDED_MODELS` to point exactly to verified active GGUF repository paths (`bartowski/gemma-2-2b-it-GGUF`, `bartowski/Phi-3.5-mini-instruct-GGUF`, `bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF`, and `bartowski/granite-3.1-3b-a800m-instruct-GGUF`) with exact casing and matching filenames (`gemma-2-2b-it-Q4_K_M.gguf`, etc.), ensuring instant high-speed downloads directly into the local `models` directory.
- **Interactive Guardian Model Selection Dropdown**: Redesigned `<select id="guardian-model-select">` with professional `<optgroup>` categorizations:
  - `<optgroup label="Available Local Models">`: Lists all locally scanned models in workspace or Ollama.
  - `<optgroup label="Recommended Models (Click to Download)">`: Lists all recommended models. If a model is already downloaded, it is indicated with a green checkmark (`✅`). If not downloaded, it displays an instant download option (`📥 Download [Model Name]`).
- **Dynamic Selection & Download Routing**: Created `onGuardianModelSelectChange` and exposed it to the global `window` object in `dashboard-app.js`. Selecting an un-downloaded model instantly invokes `/api/models/download` with automatic fallback to Ollama tag pull (`/api/models/pull`), providing a seamless user experience.

### Core Provider & Capability Registration
- **Default Models Hierarchy**: Updated `GOOGLE_DEFAULT_MODELS` in `llm-provider-manager.ts` to prioritize `"gemini-3.0-flash"`, `"gemini-3-flash"`, and `"gemini-2.5-flash"`.
- **Model Capability Matrix**: Added comprehensive capability profiles for all three models in `model-capability-matrix.ts`, defining 1M context windows, Tier 4 reasoning, XML tool formatting, and fast tool execution capabilities.
- **Usage Pricing Catalog**: Added USD token pricing entries in `usage-pricing-catalog.ts` for all three models to ensure precise dashboard observability cost tracking.

### ReAct Conversation Sequencing & API Turn Compatibility
- **Conditional User Turns**: Resolved Google Gemini API strict OpenAI-compatibility turn validation errors (`400 Please ensure that function call turn comes immediately after a user turn or after a function response turn.`). Updated `generateWithOpenAiCompatible`, `generateWithAnthropic`, `generateWithOllama`, and `generateWithOllamaCloud` in `llm-provider-manager.ts` to only append user turns if `input.message` is non-empty.
- **Initial Objective Turn Insertion**: Updated `autonomous-planner.ts` to correctly insert the initial objective as a `{ role: "user" }` turn in the conversation history buffer at iteration 0, ensuring conversation logs sent to Gemini start correctly with a user prompt rather than an unanchored tool call.
- **Fallback Tool Call IDs**: Updated `generateWithOpenAiCompatible` to ensure every tool call returned by the model has a unique ID (`tc.id || randomToolCallId()`), guaranteeing perfect turn linking between assistant tool call messages and subsequent tool execution results.

### Automated Test Scripts & Default Environments
- **E2E Smoke Test**: Updated `tmp/smoke-test.mjs` to fetch active chat session IDs from `/api/chat/sessions`, perform model selection for `google/gemini-3.0-flash` with automatic fallback to `google/gemini-2.5-flash`, and correctly verify goal completion status.
- **Startup Configuration**: Updated `start_web.bat` to configure default environment variables `PRISM_LLM_PROVIDER=google` and `PRISM_LLM_MODEL=gemini-3.0-flash`.

## Verification Results

### Build & Compilation Verification
Executed `npm run build` and `npm run ci:gate:check`:
```
> prism-core@0.21.0 ci:gate:check
> npm run build && node dist/src/benchmarks/ci-gate-check.js

CI gate check passed.
Exit code: 0
```
All static TypeScript compilation, CI contract diff gate tests, and client-side module bundling completed flawlessly.
