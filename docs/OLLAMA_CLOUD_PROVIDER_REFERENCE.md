# Ollama Cloud Provider — Technical Reference

> **Author**: Kirk LaSalle  
> **Last Updated**: April 12, 2026  
> **Provider ID**: `ollama-cloud`  
> **Status**: Implemented (PRISM `feat/agentic-ux-polish`)

---

## 1. Executive Summary

PRISM now supports **Ollama Cloud** as a first-class LLM provider alongside the existing Ollama (Local) provider. Ollama Cloud enables access to large-scale models (120B–1T parameters) that cannot run on consumer hardware, via Ollama's hosted API at `https://ollama.com`. The implementation is **fully additive** — the existing Ollama local provider is completely unchanged.

### Key Differentiators

| Aspect | Ollama (Local) | Ollama Cloud |
|--------|---------------|--------------|
| Provider ID | `ollama` | `ollama-cloud` |
| Host | `http://127.0.0.1:11434` | `https://ollama.com` |
| Authentication | None | `Authorization: Bearer <OLLAMA_API_KEY>` |
| API Schema | `/api/chat`, `/api/tags` | **Identical** (same Ollama REST API) |
| Model Scale | Consumer GPU (1B–70B) | Cloud-offloaded (20B–1T) |
| Kind | `local` | `remote` |
| Privacy | Fully on-device | Processed but not stored/logged; never trained on |

---

## 2. Architecture Overview

### 2.1 How Ollama Cloud Works

Ollama Cloud is a cloud inference service operated by Ollama Inc. It exposes the **same REST API** as a local Ollama server — the only differences are:

1. **Host**: `https://ollama.com` instead of `localhost:11434`
2. **Authentication**: Requires a `Bearer` token in the `Authorization` header
3. **Model names**: Cloud models omit the `-cloud` suffix when accessed via the Cloud API (e.g., `gpt-oss:120b` not `gpt-oss:120b-cloud`)

This design means the same API client code works for both local and cloud, with only host + auth header changes.

### 2.2 Two Cloud Access Modes (Context)

Ollama offers **two** ways to run cloud models:

| Mode | How It Works | PRISM Provider |
|------|-------------|----------------|
| **Cloud-Local Hybrid** | `ollama signin` locally → pull `-cloud` models → local Ollama proxies to cloud | `ollama` (existing, no changes needed) |
| **Direct Cloud API** | Point client directly at `https://ollama.com` with API key | `ollama-cloud` (**new provider**) |

PRISM's `ollama-cloud` provider implements the **Direct Cloud API** mode. Users who prefer the Cloud-Local Hybrid mode can continue using the existing `ollama` provider after running `ollama signin` on their local machine.

### 2.3 Supported Cloud Models

As documented in the [Ollama Cloud model library](https://ollama.com/search?c=cloud):

| Model | Parameters | Tier | Strengths |
|-------|-----------|------|-----------|
| `gpt-oss:120b` | 120B | T5 Frontier | Instruction-following, reasoning, code, agentic |
| `gpt-oss:20b` | 20B | T4 Large | Instruction-following, reasoning, code, fast |
| `deepseek-v3.1:671b` | 671B | T5 Frontier | Reasoning, code, agentic, long-context |
| `kimi-k2:1t` | 1T | T5 Frontier | Reasoning, code, agentic, long-context |
| `qwen3-coder:480b` | 480B | T5 Frontier | Code, reasoning, agentic |
| `kimi-k2-thinking` | 1T | T5 Frontier | Reasoning, code, agentic (extended thinking) |

---

## 3. Configuration

### 3.1 Environment Variables

| Variable | Required | Default | Description |
|---------|----------|---------|-------------|
| `OLLAMA_API_KEY` | Yes (or dashboard) | — | API key from [ollama.com/settings/keys](https://ollama.com/settings/keys) |
| `PRISM_OLLAMA_CLOUD_API_KEY` | Alt. to above | — | Alternative env var name for API key |
| `PRISM_OLLAMA_CLOUD_BASE_URL` | No | `https://ollama.com` | Cloud API base URL override |
| `PRISM_OLLAMA_CLOUD_MODELS` | No | See §2.3 | Comma-separated model override list |
| `PRISM_LLM_PROVIDER` | No | — | Set to `ollama-cloud` to make it default |
| `PRISM_LLM_MODEL` | No | `gpt-oss:120b` | Default model when `ollama-cloud` is active |

### 3.2 Dashboard Configuration

1. Open the PRISM Dashboard → **Provider & Settings** tab
2. Expand the **☁️ Ollama Cloud** provider card
3. Enter your API key (obtain from the **🔑 Get API Key →** link)
4. Click **Save API Key**
5. Click **Test Connection** to verify
6. Click **🔍 Discover Models** to auto-populate available cloud models
7. Select your preferred **Default Model**
8. Click **Save Settings**

### 3.3 Obtaining an API Key

1. Visit [ollama.com/settings/keys](https://ollama.com/settings/keys)
2. Sign in or create an account
3. Generate a new API key
4. Copy the key and paste it into the PRISM dashboard (or set as `OLLAMA_API_KEY` env var)

---

## 4. API Reference

### 4.1 Cloud API Endpoints

All endpoints use the base URL `https://ollama.com` (or `PRISM_OLLAMA_CLOUD_BASE_URL`).

#### List Models

```
GET /api/tags
Headers: Authorization: Bearer <OLLAMA_API_KEY>

Response: { "models": [{ "name": "gpt-oss:120b", ... }, ...] }
```

#### Chat Completion

```
POST /api/chat
Headers:
  Content-Type: application/json
  Authorization: Bearer <OLLAMA_API_KEY>

Body: {
  "model": "gpt-oss:120b",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": false,
  "options": {
    "temperature": 0.3,
    "num_ctx": 4096,
    "num_predict": 512
  }
}

Response: {
  "message": {
    "content": "...",
    "tool_calls": [...]
  },
  "prompt_eval_count": 42,
  "eval_count": 128
}
```

#### Tool Calling

Cloud models support function calling with the same schema as local Ollama:

```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    }
  }]
}
```

### 4.2 Python SDK Usage

```python
import os
from ollama import Client

# Direct Cloud API access
client = Client(
    host="https://ollama.com",
    headers={"Authorization": "Bearer " + os.environ.get("OLLAMA_API_KEY")}
)

# Chat completion
for part in client.chat("gpt-oss:120b", messages=[
    {"role": "user", "content": "Explain quantum computing"}
], stream=True):
    print(part.message.content, end="", flush=True)

# Async client
from ollama import AsyncClient

async_client = AsyncClient(
    host="https://ollama.com",
    headers={"Authorization": "Bearer " + os.environ.get("OLLAMA_API_KEY")}
)
```

---

## 5. PRISM Implementation Details

### 5.1 Files Modified

| File | Changes |
|------|---------|
| `src/core/operator/llm-provider-manager.ts` | Added `ollama-cloud` to `PrismLlmProviderId` type, `ALL_PROVIDER_IDS`, constructor defaults, `fetchOllamaCloudModels()`, `generateWithOllamaCloud()`, `testProvider()` cloud handling, generation routing |
| `src/core/operator/model-capability-matrix.ts` | Added 6 cloud model profiles (T4–T5) |
| `src/core/operator/usage-pricing-catalog.ts` | Added 6 cloud model pricing entries (placeholder $0 — pricing TBD) |
| `src/core/operator/public/tab-settings.js` | Added `ollama-cloud` to `PROVIDER_META` with ☁️ icon and description, added "Get API Key" link rendering for providers with `apiKeyUrl` |
| `README.md` | Documented `OLLAMA_API_KEY`, `PRISM_OLLAMA_CLOUD_BASE_URL`, `PRISM_OLLAMA_CLOUD_MODELS` env vars |

### 5.2 Provider Registration

```typescript
"ollama-cloud": {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    kind: "remote",
    baseUrl: "https://ollama.com",           // Default
    apiKey: env.OLLAMA_API_KEY,              // From environment
    apiKeyHeader: "Authorization",           // Bearer token
    defaultModels: OLLAMA_CLOUD_DEFAULT_MODELS,
    requiresApiKey: true,
    settingsSource: "environment",
}
```

### 5.3 Authentication Flow

1. User provides raw API key (via dashboard or `OLLAMA_API_KEY` env var)
2. Backend stores key in `ProviderSecretStore` (encrypted at rest on Windows)
3. On fetch/generation, backend composes the header: `Authorization: Bearer <key>`
4. User never needs to type the `Bearer` prefix — it is added automatically

### 5.4 Generation Routing

The `generate()` dispatcher routes `ollama-cloud` to `generateWithOllamaCloud()`:

```
generate() → activeProviderId === "ollama-cloud"
           → generateWithOllamaCloud(settings, model, input, adaptiveParams)
           → POST https://ollama.com/api/chat + Authorization header
```

This is intentionally a separate method from `generateWithOllama()` to maintain clean separation between local and cloud code paths, even though the API schema is identical.

### 5.5 Model Discovery

The **Discover Models** button in the dashboard triggers:

```
POST /api/models/discover/ollama-cloud
  → testProvider("ollama-cloud")
    → GET https://ollama.com/api/tags + Authorization header
    → returns model list
  → discoverProviderModels() classifies known vs unknown models
  → auto-registers profiles in capability matrix
```

---

## 6. Privacy & Data Handling

Per [Ollama's official documentation](https://docs.ollama.com/faq):

- **Local models**: Fully on-device. Ollama sees nothing.
- **Cloud models**: Prompts and responses are processed to provide the service but are **not stored, logged, or used for training**.
- **Metadata**: Basic account info and limited usage metadata is collected (no prompt/response content).
- **Data sales**: Ollama does not sell user data.
- **Account deletion**: Users can delete their account at any time.

### Local-Only Mode

Users who want to disable all cloud features can set:

```bash
# Environment variable
OLLAMA_NO_CLOUD=1

# Or in ~/.ollama/server.json
{ "disable_ollama_cloud": true }
```

This affects the local Ollama server only. The `ollama-cloud` PRISM provider (which connects directly to `ollama.com`) is a separate, opt-in configuration.

---

## 7. Capabilities & Limitations

### Supported

- Chat completions (same schema as local Ollama)
- Function/tool calling
- Adaptive prompt parameters (temperature, num_ctx, num_predict)
- Model discovery via `/api/tags`
- Connection testing
- Per-provider API key storage (encrypted)

### Not Yet Supported (Future Enhancements)

- **Streaming**: Cloud API supports streaming (`stream: true`), but current PRISM implementation uses `stream: false`. Streaming support would be a follow-up enhancement.
- **Thinking traces**: Models like `kimi-k2-thinking` emit a `thinking` field alongside content. PRISM does not yet surface thinking traces in the UI.
- **Rate limiting/retry**: Cloud API may impose rate limits; retry with exponential backoff is not yet implemented.
- **Usage-based pricing**: Ollama Cloud pricing model is not yet publicly documented. Pricing catalog entries use placeholder $0 values.
- **Image generation**: Ollama's Python SDK now supports image generation; this modality is not yet integrated.

---

## 8. Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|------------|
| "API key is missing" badge | No API key configured | Set `OLLAMA_API_KEY` env var or enter key in dashboard |
| "Ollama Cloud returned 401" | Invalid API key | Regenerate key at [ollama.com/settings/keys](https://ollama.com/settings/keys) |
| "Ollama Cloud returned 403" | Account issue | Check account status at ollama.com |
| Provider card shows "disabled" | Missing API key or base URL | Enter API key and verify base URL is `https://ollama.com` |
| No models discovered | API key invalid or network issue | Test connection first, check firewall/proxy settings |
| Empty response error | Model not available | Try a different model, verify model availability with Discover Models |

---

## 9. References & Citations

1. **Ollama Cloud Documentation**: <https://docs.ollama.com/cloud> — Official cloud model documentation including authentication, API access, and supported models.
2. **Ollama Python Library**: <https://github.com/ollama/ollama-python> — Python SDK with cloud model examples and `Client(host="https://ollama.com")` pattern.
3. **Ollama REST API Reference**: <https://docs.ollama.com/api/chat> — Chat completion endpoint specification.
4. **Ollama Integrations**: <https://docs.ollama.com/integrations> — Ecosystem integrations (VS Code, Cline, JetBrains).
5. **Ollama FAQ**: <https://docs.ollama.com/faq> — Privacy policy, local-only mode, server configuration.
6. **Ollama Cloud Model Library**: <https://ollama.com/search?c=cloud> — Available cloud models catalog.
7. **Ollama Streaming Capabilities**: <https://docs.ollama.com/capabilities/streaming> — Streaming, thinking traces, tool call accumulation.
