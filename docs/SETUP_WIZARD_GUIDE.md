# PRISM Setup Wizard — Comprehensive Guide

**Date:** April 2026
**Audience:** End users, operators, and developers

## Table of Contents

1. [Overview](#1-overview)
2. [Wizard Variants](#2-wizard-variants)
3. [Web Setup Wizard (4-Step Basic)](#3-web-setup-wizard-4-step-basic)
4. [Web Advanced Wizard (8-Step)](#4-web-advanced-wizard-8-step)
5. [TUI Setup Wizard](#5-tui-setup-wizard)
6. [CLI Setup Wizard](#6-cli-setup-wizard)
7. [Non-Interactive / Headless Setup](#7-non-interactive--headless-setup)
8. [Re-Running the Wizard](#8-re-running-the-wizard)
9. [Configuration Reference](#9-configuration-reference)
10. [Troubleshooting](#10-troubleshooting)
11. [Developer Reference](#11-developer-reference)

---

## 1. Overview

The PRISM Setup Wizard provides a guided first-run experience that configures:

- **Execution Profile** — `Individual` (fast defaults, maximum capability) or `Business` (strict governance, approval pathways)
- **Workspace Directory** — The `Prism_Refraction` persistent workspace for data, state, and artifacts
- **LLM Provider** — Primary language model provider and optional API key
- *(Advanced)* **Model Routing** — Per-role model assignments across multiple providers
- *(Advanced)* **Guardian Agent** — Autonomous governance agent configuration
- *(Advanced)* **Identity (CAC)** — Character-to-operator accountability binding
- *(Advanced)* **Browser & Scheduler** — Automation profiles and scheduled jobs

All wizard surfaces produce identical configuration output (`.prism-preferences.json`) and emit the same activity events for auditability.

## 2. Wizard Variants

| Variant | Steps | Interface | Best For |
| :--- | :---: | :--- | :--- |
| Web Basic | 4 | Browser | First-time users, visual setup |
| Web Advanced | 8 | Browser | Power users, full system config |
| TUI | 4 | Terminal (Ink) | Terminal-native users |
| CLI *(planned)* | 4/8 | Terminal (readline) | Headless, Docker, SSH, CI |

## 3. Web Setup Wizard (4-Step Basic)

### How to Launch

**Option A — Fresh install:** Run `start_wizard.bat` (Windows). The script:

1. Validates Node.js 22+ is installed
2. Installs dependencies if `node_modules/` is missing
3. Builds the project if `dist/` is missing
4. Starts the PRISM server
5. Opens `http://localhost:7070/setup` in your default browser

**Option B — Server already running:** Navigate to `http://localhost:7070/setup?rerun=true`

**Option C — From dashboard:** Click "✨ Setup Wizard" in the sidebar

### Step 1: Execution Profile

Choose how PRISM operates:

- **Individual** — Optimized for personal productivity. Fast defaults, minimal approval gates, maximum tool access. Best for solo developers, researchers, and power users.
- **Business / Enterprise** — Strict governance. All high-risk operations require explicit approval. Audit trails enforced. Email domain validation enabled. Best for teams, enterprises, and regulated environments.

Click a profile card to select it, then click "Continue".

### Step 2: Workspace Directory

The workspace is where PRISM stores all persistent data:

```
Prism_Refraction/
├── config/       # Runtime configuration
├── artifacts/    # Generated outputs
├── data/         # Application data (SQLite DBs)
├── state/        # Routing config, preferences
├── characters/   # Agent persona definitions
└── logs/         # Structured log files
```

The wizard displays prerequisite checks:

- ✓ Node.js version (22+)
- ✓ Workspace directory exists and is writable
- ✓ Required subdirectories present

If checks fail, fix the issues and the wizard will re-validate automatically.

### Step 3: LLM Provider

Select your primary language model provider:

| Provider | Type | API Key Required |
| :--- | :--- | :---: |
| Ollama | Local | No |
| OpenAI | Cloud | Yes |
| Anthropic | Cloud | Yes |
| Google AI | Cloud | Yes |
| Mistral | Cloud | Yes |
| Groq | Cloud | Yes |
| Together AI | Cloud | Yes |
| DeepSeek | Cloud | Yes |
| OpenRouter | Cloud | Yes |
| Perplexity | Cloud | Yes |
| Fireworks | Cloud | Yes |
| Cohere | Cloud | Yes |

For cloud providers, enter your API key in the field that appears. Click "Test Connection" to verify the provider is reachable before continuing.

**Tip:** For local development, Ollama is recommended. Install it from [ollama.com](https://ollama.com) and run `ollama pull gemma3:1b` for a lightweight starter model.

### Step 4: Summary

The wizard displays:

- Your profile, workspace, and provider selections
- System readiness checks from `POST /api/readiness/recheck`
- Any warnings or recommendations

Click "Launch PRISM" to complete setup. The wizard:

1. Saves all configuration to `.prism-preferences.json`
2. Runs a full readiness check
3. Emits `prism.setup_wizard.complete` activity event
4. Redirects you to the main dashboard

## 4. Web Advanced Wizard (8-Step)

Navigate to `http://localhost:7070/setup/advanced` to access the 8-step wizard.

### Steps 1–3: Same as Basic

Profile, Workspace, and Provider selection are identical to the basic wizard.

### Step 4: Model Routing

Configure how PRISM assigns models to different task roles:

- **Single Provider** — All roles use the active session provider. Simplest option.
- **Multi-Provider** — Assign specific provider/model pairs to each role (chat, code-generation, summarization, tool-selection, memory-indexing, etc.).
- **Modality-Based** — Route by input modality (text, vision, audio, etc.).

Click "✨ Suggest Optimal" to get AI-recommended model assignments based on your configured providers and their model capabilities.

### Step 5: Guardian Agent

The Guardian Agent is a permanent autonomous agent that monitors system integrity:

- **Model:** Select which local model powers the Guardian (requires a GGUF model file)
- **Governance Tier:** `Tier 1 Autonomous` (Individual default) or `Tier 2 Conditional` (Business default)
- **Auto-Start:** Whether the Guardian launches automatically on server boot

### Step 6: Identity (CAC)

Character Accountability Control binds agent actions to real identities:

- **Character:** Select an agent persona from `characters/` directory
- **Operator Email:** The human operator's email address
- **PRISM User Email:** The platform user's email (Business profile enforces domain matching)
- **Workspace Hub:** Persistent workspace identifier for cross-session tracking

### Step 7: Browser & Scheduler

- **Browser Profile:** Configure browser automation identity binding
- **Scheduler:** Pre-configure scheduled jobs, cron tasks, and board items

### Step 8: Certificate & Launch

The advanced wizard generates an **Initialization Certificate** — a comprehensive record of every configuration choice, packaged as an immutable session record. This certificate:

- Documents all 8 configuration steps
- Is stored as a session package for audit
- Emits `prism.initialization_certificate.created` activity event
- Can be exported for compliance documentation

## 5. TUI Setup Wizard

### How to Launch

Run `start_tui.bat` (Windows) or `npm run tui`, then navigate to the Setup Wizard tab.

### Navigation

| Key | Action |
| :--- | :--- |
| ↑ / ↓ | Move selection |
| Space | Select option |
| Enter | Confirm and continue |
| Escape | Go back |
| K | Enter API key (Step 3, when provider needs key) |

### Steps

The TUI wizard follows the same 4-step flow as the web basic wizard:

1. **Profile** — Use arrow keys to highlight Individual or Business, Space to select, Enter to continue.
2. **Workspace** — Text input for workspace path. Pre-populated with detected default. Enter to continue.
3. **Provider** — Arrow keys to browse 9 providers. Space to select. Press K to enter API key (masked input). Enter to continue.
4. **Summary** — Shows completion status. Enter to finalize.

### Requirements

- Terminal with ANSI color support
- Unicode-capable font (for progress bar and symbols)
- Recommended terminals: Windows Terminal, iTerm2, Kitty, Alacritty

## 6. CLI Setup Wizard

The CLI wizard provides a pure readline-based interactive setup for environments where browsers and rich TUI rendering are unavailable. Zero external dependencies — uses only Node.js built-in `readline` and ANSI escape codes.

### How to Launch

```bash
# Interactive 4-step wizard (auto-detects PRISM server)
npm run setup

# Via batch file with --cli flag (Windows)
start_wizard.bat --cli

# Via shell script with --cli flag (Linux/macOS)
./start_wizard.sh --cli

# Direct invocation
npx tsx src/cli/setup-wizard.ts
```

### Operating Modes

| Mode | Flag | Description |
| :--- | :--- | :--- |
| Connected | *(default)* | Auto-detects PRISM server, uses `/api/setup/*` endpoints. Provider testing, readiness checks, and activity events work. |
| Standalone | `--standalone` | No server needed. Writes `.prism-preferences.json` directly. Auto-detected if server unreachable. |
| Non-interactive | `--non-interactive` | No prompts. All config from CLI flags and environment variables. |

### Step-by-Step Flow

1. **Execution Profile** — Arrow-key selection between Individual and Business, with short descriptions of each.
2. **Workspace Directory** — Text input for path (pre-filled from existing preferences or OS default). Prerequisites checks displayed inline.
3. **LLM Provider** — Arrow-key selection from 12 providers. Conditional masked input for API key. Optional inline connectivity test (connected mode).
4. **Summary** — Configuration summary with ✓/✗ check marks. Readiness snapshot (connected mode). Finalization and `.prism-preferences.json` write.

### Non-Interactive / Headless Usage

```bash
# Minimal (uses defaults for workspace)
npm run setup -- --non-interactive --profile individual --provider ollama

# Full specification
npm run setup -- --non-interactive \
  --profile business \
  --workspace /data/Prism_Refraction \
  --provider openai \
  --api-key "$OPENAI_API_KEY"

# Standalone (no server needed)
npm run setup -- --standalone --non-interactive \
  --profile individual \
  --workspace /data/Prism_Refraction \
  --provider ollama
```

### CLI Flags Reference

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--profile <individual\|business>` | Execution profile | `individual` |
| `--workspace <path>` | Workspace root directory | OS-specific default |
| `--provider <id>` | LLM provider | `ollama` |
| `--api-key <key>` | API key for cloud providers | *(none)* |
| `--port <number>` | Server port for connected mode | `7070` |
| `--non-interactive` | Skip prompts; use flags/env vars | *(off)* |
| `--standalone` | Run without PRISM server | *(auto-detect)* |
| `--advanced` | 8-step advanced wizard (routing, guardian, CAC, scheduler) | *(off)* |
| `--help` | Show usage information | — |

### Environment Variables

CLI flags take precedence over environment variables:

| Variable | Maps to |
| :--- | :--- |
| `PRISM_ENV_PROFILE` | `--profile` |
| `PRISM_WORKSPACE_ROOT` | `--workspace` |
| `PRISM_LLM_PROVIDER` | `--provider` |
| `PRISM_DASHBOARD_PORT` | `--port` |

### Exit Codes

| Code | Meaning |
| :---: | :--- |
| `0` | Setup completed successfully |
| `1` | Setup failed (error during configuration) |
| `2` | Cancelled by user or missing required arguments |

### CLI Advanced Wizard (8-Step)

The `--advanced` flag launches an extended 8-step wizard matching the web advanced wizard at `/setup/advanced`.

```bash
# Interactive 8-step advanced wizard
npm run setup:advanced

# Or via flag
npm run setup -- --advanced

# Direct invocation
npx tsx src/cli/setup-wizard.ts --advanced
```

**Steps:**

| Step | Name | Description |
| :---: | :--- | :--- |
| 1 | Execution Profile | Individual vs Business, sets profile-aware defaults for guardian tier and swarm topology |
| 2 | Workspace Directory | Path input with prerequisite validation |
| 3 | LLM Provider | Provider selection + optional masked API key + connectivity test |
| 4 | Model Routing | Single / Multi-model / Modality-aware strategy with per-role model overrides (8 roles) |
| 5 | Guardian & Agents | Guardian GGUF model selection, authority tier, auto-start toggle, swarm topology |
| 6 | CAC Identity | Character selection, operator email, PRISM email, operator ID, workspace hub |
| 7 | Browser & Scheduler | Browser profile (email + segment), scheduled task toggles with cron expressions |
| 8 | Summary & Certificate | Validates all config, creates initialization certificate, marks setup complete |

**Profile-aware defaults:**

- **Business** profile: Guardian tier defaults to `tier2_conditional`, swarm topology to `star`, browser segment to `business`, extra scheduler tasks (compliance audit, backup).
- **Individual** profile: Guardian tier defaults to `tier1_autonomous`, swarm topology to `mesh`, browser segment to `individual`.

**Non-interactive advanced mode:**

```bash
npm run setup:advanced -- --non-interactive \
  --profile business \
  --workspace /data/Prism_Refraction \
  --provider openai \
  --api-key "$OPENAI_API_KEY"
```

**Source:** `src/cli/setup-wizard-advanced.ts`

## 7. Non-Interactive / Headless Setup

For Docker containers and CI pipelines, PRISM can be configured without any wizard via environment variables:

```bash
# Set via environment (no wizard needed)
export PRISM_ENV_PROFILE=individual        # or: business
export PRISM_WORKSPACE_ROOT=/data/Prism_Refraction
export PRISM_LLM_PROVIDER=ollama
export PRISM_LLM_MODEL=gemma3:1b

# Optional cloud provider keys
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# Start directly
npm start
```

When the CLI wizard is used in non-interactive mode:

```bash
npm run setup -- --non-interactive \
  --profile business \
  --workspace /data/Prism_Refraction \
  --provider openai \
  --api-key "$OPENAI_API_KEY"
```

### Docker Example

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build

ENV PRISM_MODE=server
ENV PRISM_ENV_PROFILE=individual
ENV PRISM_WORKSPACE_ROOT=/data/Prism_Refraction
ENV PRISM_LLM_PROVIDER=ollama

CMD ["node", "dist/src/index.js"]
```

## 8. Re-Running the Wizard

The wizard can be re-run at any time to change configuration:

| Surface | Method |
| :--- | :--- |
| Web | Click "✨ Setup Wizard" in sidebar, or Settings → Setup Wizard → "Re-run Setup Wizard" |
| Web (URL) | `http://localhost:7070/setup?rerun=true` |
| Web Advanced | `http://localhost:7070/setup/advanced` |
| TUI | Navigate to Setup Wizard tab |
| CLI *(planned)* | `npm run setup` |

Re-running the wizard preserves your existing configuration as defaults — you only need to change what's different.

## 9. Configuration Reference

### `.prism-preferences.json`

Written by all wizard surfaces to the project root or home directory:

```json
{
  "setupComplete": true,
  "executionProfileSegment": "individual",
  "workspaceRoot": "C:\\Users\\user\\Prism_Refraction"
}
```

### Environment Variable Overrides

Environment variables take precedence over `.prism-preferences.json`:

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `PRISM_ENV_PROFILE` | Execution profile | `individual` |
| `PRISM_WORKSPACE_ROOT` | Workspace directory | OS-specific default |
| `PRISM_LLM_PROVIDER` | Default LLM provider | `ollama` |
| `PRISM_LLM_MODEL` | Default model | `gemma3:1b` |
| `PRISM_DASHBOARD_PORT` | HTTP server port | `7070` |

### Workspace Structure

Created by `ensureWorkspaceStructure()` during wizard Step 2:

```
Prism_Refraction/
├── config/           # Runtime configuration files
├── artifacts/        # Generated outputs and exports
├── data/             # SQLite databases
├── state/            # Routing config, session state
├── characters/       # Agent persona JSON definitions
├── logs/             # Structured log files
├── benchmarks/       # Performance qualification results
├── mcp/              # MCP server configurations
├── screengrab/       # Browser screenshots
└── prism-workspace.json  # Workspace manifest
```

## 10. Troubleshooting

### Common Issues

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| Wizard page is blank | Server not running | Run `start_web.bat` first, then navigate to `/setup` |
| "Node.js 22+ required" | Outdated Node.js | Install Node.js 22+ from [nodejs.org](https://nodejs.org) |
| Provider test fails (Ollama) | Ollama not running | Run `ollama serve` in a separate terminal |
| Provider test fails (cloud) | Invalid API key | Verify key at provider's dashboard. Re-enter in Step 3. |
| Workspace check fails | Permission denied | Ensure the directory is writable. On Linux: `chmod 755 /path` |
| TUI doesn't render correctly | Terminal doesn't support ANSI | Use a modern terminal (Windows Terminal, iTerm2) |
| Setup completes but readiness fails | Missing model | Pull a model: `ollama pull gemma3:1b` |
| "Server already running" on wizard launch | Port 7070 in use | The wizard will connect to the existing server instead |

### Resetting Configuration

To start fresh, delete the preferences file and re-run the wizard:

```bash
# Windows
del .prism-preferences.json
start_wizard.bat

# Linux/macOS
rm .prism-preferences.json
./start_wizard.sh   # or: npm run setup (planned)
```

### Checking Setup Status

Query the setup API to verify configuration:

```bash
curl http://localhost:7070/api/setup/status
# Returns: { "setupComplete": true, "executionProfileSegment": "individual", "workspaceRoot": "..." }

curl http://localhost:7070/api/setup/prerequisites
# Returns: { "checks": [{ "id": "node-version", "passed": true, ... }, ...] }
```

## 11. Developer Reference

For implementation details, API endpoint specifications, and guidance on adding new wizard steps, see:

- **Developer Guide §7E:** `docs/DEVELOPER_GUIDE.md` — Setup Wizard Architecture
- **API Spec:** `/memories/repo/setup-wizard-api-spec.md` — Full endpoint reference with request/response schemas
- **Source files:**
  - `src/core/operator/public/setup-wizard.js` — Web basic wizard
  - `src/core/operator/public/setup-wizard-advanced.js` — Web advanced wizard
  - `src/tui/tabs/SetupWizardTab.tsx` — TUI wizard
  - `src/core/operator/dashboard-service.ts` — Backend API routes
  - `src/core/config/workspace-resolver.ts` — State persistence
