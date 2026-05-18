# PRISM Python SDK

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

Official Python client for the [PRISM](https://github.com/kirklasalle/Prism) governance-native Agents-as-a-Service runtime. Wraps the dashboard HTTP/SSE surface so Python applications, notebooks, and automation scripts can drive PRISM the same way the operator dashboard does.

> **Status:** v0.2.0 — adds the v0.21 autonomous-loop helpers (`chat_autonomous`, `watch_events`, `status`). Stable surface for `chat`, `chat_stream`, providers, Spectrum Refraction, approvals, events, and readiness. See the [PRISM full audit](../../docs/PRISM_FULL_AUDIT_2026_Q2.md) for the roadmap.

## Why a Python SDK

PRISM is a Node.js runtime, but ~70% of AI/ML developers work in Python. This SDK is a thin, **stdlib-only** wrapper over the dashboard API so you can:

- Drive PRISM from a Jupyter notebook or a FastAPI service.
- Stream chat responses via Server-Sent Events.
- Configure and activate Spectrum Refraction tri-/N-model fan-out from Python.
- Inspect pending approvals, activity events, and readiness from your own ops tooling.

No external dependencies (no `requests`, no `httpx`) — the SDK uses `urllib` so it is drop-in for restricted enterprise environments.

## Install

From the repo root:

```bash
cd sdk/python
pip install -e .
```

PyPI release will follow once the open-core license boundary is finalised (see [`docs/LICENSE_MODEL_RECOMMENDATION.md`](../../docs/LICENSE_MODEL_RECOMMENDATION.md)).

## Quick start

```python
from prism_client import PrismClient

prism = PrismClient(
    base_url="http://localhost:7070",
    token="<bearer-token-from-PRISM_TOKEN>",
)

# 1. Send a single chat turn.
reply = prism.chat("Summarize today's incidents.")
print(reply["response"])

# 2. Stream a chat reply (SSE).
for event in prism.chat_stream("Plan the migration in three steps."):
    if "delta" in event:
        print(event["delta"], end="", flush=True)

# 3. Inspect provider health.
print(prism.provider_health())

# 4. Configure Spectrum Refraction (two hemispheres on different providers).
prism.sr_configure({
    "hemispheres": [
        {"role": "logic",    "providerId": "openai",   "model": "gpt-4o"},
        {"role": "creative", "providerId": "anthropic", "model": "claude-sonnet-4-5"},
    ],
})
prism.sr_activate()

# 5. Watch the approval queue.
for pending in prism.pending_approvals():
    print(pending["operationId"], pending["riskTier"])
```

## Configuration

| Env var | Effect |
| --- | --- |
| `PRISM_BASE_URL` | Default base URL (overrides `http://localhost:7070`) |
| `PRISM_TOKEN` | Bearer token used when `token=` is not passed to the constructor |

The constructor always wins over env vars.

## Error model

| Exception | Raised on |
| --- | --- |
| `PrismConnectionError` | DNS / TCP / TLS / timeout |
| `PrismAuthError` | HTTP 401 or 403 |
| `PrismRateLimitError` | HTTP 429 (per-IP rate limiter) |
| `PrismApiError` | Any other non-2xx response |

All four inherit from `PrismError`.

## API surface (v0.1.0)

| Method | Endpoint |
| --- | --- |
| `chat()` | `POST /api/chat` |
| `chat_stream()` | `GET /api/chat/stream` (SSE) |
| `list_providers()` | `GET /api/llm/providers` |
| `provider_health()` | `GET /api/llm/provider-health` |
| `select_provider()` | `POST /api/llm/select` |
| `sr_status()` / `sr_configure()` / `sr_activate()` / `sr_deactivate()` | `/api/sr/*` |
| `pending_approvals()` | `GET /api/pending` |
| `events()` / `traces()` | `GET /api/events`, `GET /api/traces` |
| `readiness()` / `setup_status()` | `GET /api/readiness`, `GET /api/setup/status` |

See [`prism_client/client.py`](prism_client/client.py) for the full surface and [`docs/PRISM_PRD.md`](../../docs/PRISM_PRD.md) for the route contracts.

## Testing

```bash
cd sdk/python
pip install -e ".[test]"
pytest
```

Tests use an injected fake transport — no live PRISM server required.

## Versioning

Semantic versioning. The SDK targets PRISM `>=0.5.0`. Method-level breaking changes will only ship in major releases.

## License

Apache-2.0 — same as the recommended PRISM open-core boundary.
