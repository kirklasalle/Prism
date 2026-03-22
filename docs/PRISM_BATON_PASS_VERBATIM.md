# PRISM Baton Pass (Verbatim)

Date: 2026-03-12  
Previous repo path: d:/Projects/OpenClaw  
New repo path after rename: d:/Projects/Prism

## Trigger Word

PRISM-BATON-RESTORE-0312

## Restore Instruction (paste first in next chat)

PRISM-BATON-RESTORE-0312  
Ingest this baton document as source-of-truth context and continue implementation without re-discovery.

## Ultra-Short Baton (5 lines)

PRISM-BATON-RESTORE-0312  
Repo moved: d:/Projects/OpenClaw -> d:/Projects/Prism  
Status: persistent chat + per-session LLM switching + LLM audit panel/exports complete  
Validation: npm run build ✅, npm test ✅ (15/15)  
Resume from PRISM_BATON_PASS_VERBATIM.md as canonical context

## Current State

- Core chat system is persistent (SQLite-backed sessions + messages).
- LLM provider/model selection is per chat session (not global).
- Providers supported: OpenAI, Anthropic, Ollama local, Custom OpenAI-compatible endpoint.
- LLM selection emits audit events and is visible in dashboard.
- Dashboard has LLM Audit Trail with Export JSON, Copy JSON, Export CSV.
- Build and test status are green.

## Validated Status

- npm run build: passing
- npm test: passing
- Test summary: 15 passed, 0 failed

## Key Implemented Files

- src/core/operator/chat-session-store.ts
- src/core/operator/llm-provider-manager.ts
- src/core/operator/dashboard-service.ts
- tests/dashboard-service.test.ts
- tests/llm-provider-manager.test.ts
- tests/index.ts
- src/index.ts
- README.md

## LLM/Chat APIs Implemented

- GET /api/chat/sessions
- POST /api/chat/sessions
- GET /api/chat/sessions/{id}/messages
- POST /api/chat/sessions/{id}/messages
- GET /api/llm/providers?sessionId={chatSessionId}
- POST /api/llm/select
- GET /api/events?operation=dashboard.llm_selection&chatSessionId={chatSessionId}&limit={n}
- GET /api/status
- GET /api/pending
- POST /api/approve/{id}
- POST /api/deny/{id}

## Important Behavior

- Session table stores llm_provider_id and llm_model.
- LLM selection API requires sessionId and providerId.
- LLM audit event operation is dashboard.llm_selection.
- Audit payload includes requested/previous/selected provider+model, status, reason, source, chatSessionId.
- Audit panel is session-scoped in the dashboard.
- Export functions in dashboard script:
  - exportLlmAuditJson
  - copyLlmAuditJson
  - exportLlmAuditCsv

## Runtime/Config Notes

- Start server: npm run start:server
- Dashboard default: <http://localhost:7070>
- Main DB file: prism-activity.db
- Primary env vars:
  - PRISM_MODE
  - PRISM_DASHBOARD_PORT
  - PRISM_ENV_PROFILE
  - PRISM_LLM_PROVIDER
  - PRISM_LLM_MODEL
  - OPENAI_API_KEY
  - ANTHROPIC_API_KEY
  - PRISM_OLLAMA_BASE_URL
  - PRISM_OLLAMA_MODELS
  - PRISM_CUSTOM_PROVIDER_URL
  - PRISM_CUSTOM_PROVIDER_NAME
  - PRISM_CUSTOM_PROVIDER_API_KEY
  - PRISM_CUSTOM_PROVIDER_API_KEY_HEADER
  - PRISM_CUSTOM_MODELS

## Immediate Next-Session Checklist

1. Confirm renamed folder opens correctly in VS Code.
2. Run npm run build.
3. Run npm test.
4. Run npm run start:server.
5. In dashboard, switch provider/model in one session and verify:
   - event appears in LLM Audit Trail
   - Export JSON works
   - Copy JSON works
   - Export CSV works
