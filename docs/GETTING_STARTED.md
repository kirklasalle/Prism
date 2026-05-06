# PRISM Getting Started — 5-Minute Path to Your First Agent

**Audience:** New users who just cloned the repo and want a working agent fast.
**Time budget:** ~5 minutes from `git clone` to a productive chat.
**Companion docs:** [SETUP_WIZARD_GUIDE.md](SETUP_WIZARD_GUIDE.md), [USER_GUIDE.md](USER_GUIDE.md)

---

## 1. Prerequisites (60 seconds)

| Requirement | Verify |
|-------------|--------|
| Node.js ≥ 22.0 | `node --version` |
| Python 3.10 (`.venv` only) | `python --version` |
| Windows / macOS / Linux | any |

If you're on Windows: `start_wizard.bat` handles Python venv setup and Node install for you.

## 2. Run the wizard (90 seconds)

```powershell
.\start_wizard.bat
```

The wizard will:

1. Create the `.venv` Python environment (if absent)
2. `npm install` PRISM core
3. Walk you through 4 steps:
   - **Profile**: pick `individual` (default) or `business`
   - **Workspace**: where PRISM stores state (default: `prism-output/`)
   - **Provider**: OpenAI / Anthropic / Ollama (local) / OpenRouter
   - **API key**: paste your key (skip for Ollama — it's local)

Linux/macOS users:

```bash
./start_wizard.sh
```

## 3. Pick a character (45 seconds)

After the wizard completes, the dashboard opens at `http://localhost:7070`. **Simple Mode** loads first.

- **Aria** — friendly generalist, conversational
- **Phoenix** — research and writing
- **Sentinel** — security-aware, governed (recommended for Business profile)

Click a card. The chat panel becomes active.

## 4. Your first message (60 seconds)

Type anything. Try:

> Summarize the latest 3 commits in this repo and tell me the riskiest change.

The agent will:

1. Use the **filesystem read** tool to access the repo
2. Optionally invoke the **Spectrum Refraction** tool for harder reasoning (`PRISM_SR_AGENT_ROUTING=on` to opt in)
3. Stream the response back

## 5. Where to go next (45 seconds)

| Goal | Doc |
|------|-----|
| Add OAuth (email/calendar) | [SETUP_WIZARD_GUIDE.md](SETUP_WIZARD_GUIDE.md) §Advanced Wizard |
| Author your own plugin | [PLUGIN_SDK_AUTHORING_GUIDE.md](PLUGIN_SDK_AUTHORING_GUIDE.md) |
| Switch to Business profile | [BUSINESS_VS_INDIVIDUAL_GUIDE.md](BUSINESS_VS_INDIVIDUAL_GUIDE.md) |
| See the Spectrum Refraction demo | `npm run demo:sr-showcase` (see [examples/sr-showcase/README.md](../examples/sr-showcase/README.md)) |
| Run on a server / production | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) |
| Troubleshoot connectivity / providers | [ERROR_RECOVERY.md](ERROR_RECOVERY.md) |

## Common pitfalls

**"Provider auth failed"** — re-run the wizard with `--provider` and `--api-key` flags, or set the `PRISM_<PROVIDER>_API_KEY` env var directly.

**"Workspace locked"** — another PRISM process is running. Stop it with `pm2 stop prism` (if PM2-managed) or kill the Node process.

**"Simple Mode doesn't load"** — clear browser cache and reload. The PWA service worker may have cached an older build.

---

That's it. You should be chatting with an agent now. If you got stuck before message #1, file an issue or check [INCIDENT_TRIAGE_RUNBOOK.md](INCIDENT_TRIAGE_RUNBOOK.md).
