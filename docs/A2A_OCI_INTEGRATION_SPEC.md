# A2A Protocol & OCI Agent Packaging Integration Specification

**Version**: 1.0  
**Author**: Kirk LaSalle  
**Date**: April 20, 2026  
**Phase**: F (A2A server) / G (OCI packaging)  
**Rationale**: Docker Agent competitive analysis revealed two high-leverage interoperability opportunities that extend PRISM's reach into the Docker Desktop ecosystem (20M+ users) without compromising the governance moat.

---

## Part 1 — A2A Protocol Server (Phase F)

### Background

The [Agent-to-Agent (A2A) protocol](https://google.github.io/A2A/) is a Google-originated open standard for inter-agent communication over HTTP. Docker Agent supports it natively (`docker agent serve a2a`). LangGraph has native A2A support. If PRISM exposes an A2A-compatible server endpoint, any Docker Agent workflow can call PRISM's character agents — bringing PRISM's governance layer to Docker's 20M+ user install base.

### What A2A Requires

An A2A server exposes:

1. **Agent Card** — `GET /.well-known/agent.json` — describes the agent's name, capabilities, authentication requirements, and supported content types.
2. **Task submission** — `POST /` (or configurable path) — accepts a `Task` payload, returns a streaming or synchronous `TaskResponse` with status and artifact output.
3. **Task status** — `GET /tasks/{taskId}` — returns current task state.
4. **Task cancellation** — `DELETE /tasks/{taskId}` — cancels in-progress task.

All messages are JSON over HTTP. Auth is optional (Bearer token or OAuth2).

### PRISM A2A Server Design

**Location**: New route group added to `src/server/dashboard-service.ts` (or a new `a2a-service.ts` adapter that the main HTTP server registers). Uses existing raw Node.js HTTP server — no new web framework needed.

#### Route Registrations

```
GET  /.well-known/agent.json          — Agent Card for PRISM's character set
POST /a2a/tasks/send                  — Submit a task to a named character agent
GET  /a2a/tasks/:taskId               — Poll task status
DELETE /a2a/tasks/:taskId             — Cancel task
GET  /a2a/tasks/:taskId/subscribe     — SSE stream for live task updates (A2A extension)
```

#### Agent Card Schema (per character)

```json
{
  "name": "PRISM / Aria",
  "description": "PRISM governed assistant agent — Individual profile",
  "url": "http://localhost:3000/a2a",
  "version": "0.2.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["Bearer"]
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"]
}
```

For multi-character support, expose one A2A server per character OR a single server with character routing via task metadata. Recommended: single server, `characterId` in task `metadata` field.

#### Task Flow

```
[Docker Agent / External Caller]
        │
        ▼
POST /a2a/tasks/send
  {
    "id": "<uuid>",
    "sessionId": "<optional>",
    "message": {
      "role": "user",
      "parts": [{ "text": "Analyze this dataset for anomalies..." }]
    },
    "metadata": { "characterId": "aria-business" }
  }
        │
        ▼
[PRISM A2A Handler]
  1. Validate Bearer token (if auth enabled)
  2. Route to character agent (Aria, Phoenix, Sentinel by metadata.characterId)
  3. Apply governance policy tier classification
  4. Dispatch through LLM provider pipeline (with SR if SR-mode requested)
  5. Persist task record in SQLite (task_id, status, character, input, output)
  6. Emit ActivityBus event (layer: "agent", operation: "a2a_task_received")
        │
        ▼
[Response]
  {
    "id": "<uuid>",
    "sessionId": "<same>",
    "status": { "state": "completed", "message": { "role": "agent", "parts": [{ "text": "..." }] } },
    "artifacts": [{ "name": "analysis", "mimeType": "text/plain", "parts": [{ "text": "..." }] }]
  }
```

#### Policy Gate for A2A

A2A requests from external agents (Docker Agent, LangGraph) are classified as Tier 2 (conditional) by default. Tier 3 operations (file writes, code execution) triggered by A2A task content must still route through PRISM's approval queue — this is PRISM's governance differentiator vs. Docker Agent's client-side permissions.

```typescript
// Pseudo-code for A2A task governance routing
const taskTier = classifyTaskTier(task.message);  // tier1 / tier2 / tier3
if (taskTier === "tier3" && executionProfile.tier3ApprovalRequired) {
    // Queue for human approval, return "submitted" status to caller
    return { status: { state: "submitted", message: "Awaiting governance approval" } };
}
```

#### ActivityBus Events

All A2A events use `layer: "agent"`:

- `a2a_task_received` — tier1_autonomous
- `a2a_task_completed` — tier1_autonomous  
- `a2a_task_rejected` — tier2_conditional (policy denial)
- `a2a_task_approval_required` — tier3_approval

#### SQLite Schema (new table)

```sql
CREATE TABLE IF NOT EXISTS a2a_tasks (
    task_id TEXT PRIMARY KEY,
    session_id TEXT,
    character_id TEXT NOT NULL,
    status TEXT NOT NULL,          -- submitted | working | completed | failed | cancelled
    input_text TEXT NOT NULL,
    output_text TEXT,
    policy_tier TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Usage from Docker Agent

Once deployed, a Docker Agent config can call PRISM as an A2A sub-agent:

```yaml
agents:
  root:
    model: openai/gpt-4o
    description: Orchestrator
    toolsets:
      - type: a2a
        url: http://localhost:3000/a2a
        agent_card: http://localhost:3000/.well-known/agent.json
        description: "PRISM governed agent — constitutional AI with SHA-256 audit trail"
```

This makes PRISM the governance backend for any Docker Agent workflow. Docker Agent handles orchestration; PRISM handles policy enforcement, approval queues, and immutable audit logging.

### Implementation Files

| File | Change |
|------|--------|
| `src/server/a2a-adapter.ts` | New file — A2A route handlers |
| `src/server/dashboard-service.ts` | Register `/a2a/*` and `/.well-known/agent.json` routes |
| `src/adapters/application/a2a-task-adapter.ts` | Task lifecycle, SQLite persistence, ActivityBus integration |
| `tests/a2a-adapter.test.ts` | Integration tests covering all 4 routes + governance gating |

### Estimated Effort

- Route handlers + agent card: 1 day
- Task persistence adapter: 0.5 day
- Governance policy integration: 0.5 day
- Tests: 1 day
- **Total: 3 days**

---

## Part 2 — OCI Agent Packaging (Phase G)

### Background

Docker Agent distributes agents as OCI artifacts on Docker Hub via `docker agent push myagent:latest`. PRISM's Character configurations (aria-business.json, phoenix-individual.json, etc.) are self-contained JSON files with instruction sets, model preferences, and governance metadata. These can be packaged as OCI artifacts and published to Docker Hub's `agentcatalog` namespace — putting PRISM characters alongside Docker Agent's catalog for discovery by 20M+ Docker Desktop users.

### OCI Artifact Structure

A PRISM Character OCI artifact bundles:

```
prism-agent:aria-business/
├── character.json          # Character definition (model, instructions, traits)
├── pad-hash.txt            # SHA-256 of PAD governance document
├── manifest.json           # OCI media-type: application/vnd.prism.character.v1+json
└── README.md               # Human-readable description
```

The OCI manifest labels the artifact with PRISM-specific fields:

```json
{
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "config": {
    "mediaType": "application/vnd.prism.character.v1+json"
  },
  "annotations": {
    "org.opencontainers.image.title": "PRISM Aria (Business)",
    "org.opencontainers.image.description": "Governance-native assistant agent for enterprise workflows",
    "org.prism.character.id": "aria-business",
    "org.prism.character.profile": "business",
    "org.prism.governance.pad-hash": "<sha256>",
    "org.prism.version": "0.2.0"
  }
}
```

### Packaging Script

New `scripts/package-character-oci.ts`:

```typescript
// Usage: npx ts-node scripts/package-character-oci.ts --character aria-business --tag latest
// Produces: prism/aria-business:latest on Docker Hub
```

Steps:

1. Read `characters/<id>.json`
2. Read PAD document, compute SHA-256
3. Bundle into OCI artifact using `oras` CLI or dockerode `buildImage`
4. Push to `docker.io/prism/<character-id>:<version>`

### Distribution Targets

| Registry | Path | Audience |
|----------|------|----------|
| Docker Hub | `docker.io/prism/aria-business:latest` | Docker Agent users |
| GitHub Container Registry | `ghcr.io/kirklasalle/prism/aria-business:latest` | GitHub Actions users |
| Self-hosted | Any OCI-compatible registry | Enterprise on-prem |

### Docker Agent Compatibility

A packaged PRISM character would be callable from Docker Agent as a sub-agent:

```yaml
agents:
  root:
    model: openai/gpt-4o
    sub_agents: [governed_analyst]
  governed_analyst:
    uses: prism/aria-business:latest   # Pulls from Docker Hub
    # PRISM character auto-configures governance, model selection, PAD hash verification
```

This is the "governed agentcatalog" strategy — PRISM characters appear alongside `agentcatalog/pirate` and other Docker Agent catalog entries, discovered organically by Docker Desktop developers.

### Implementation Files

| File | Change |
|------|--------|
| `scripts/package-character-oci.ts` | New — packaging script |
| `scripts/publish-characters.sh` | New — CI/CD publish workflow |
| `.github/workflows/publish-characters.yml` | New — GitHub Actions on release tag |
| `docs/OCI_PUBLISHING_GUIDE.md` | New — developer guide for publishing characters |

### Estimated Effort

- Packaging script: 1 day
- GitHub Actions workflow: 0.5 day
- Docker Hub org setup: 0.5 day
- Documentation: 0.5 day
- **Total: 2.5 days**

---

## Part 3 — "Governed Docker Agent" Integration Story

### The Partner Positioning

PRISM and Docker Agent are not competitors — they're complimentary. Docker Agent excels at **declarative agent definition and execution** (YAML-first, zero-code, large install base). PRISM excels at **constitutional governance and enterprise accountability** (cryptographic enforcement, approval queues, immutable audit trails). The integration story:

```
Developer writes YAML → Docker Agent executes → PRISM enforces governance
```

### Governance Sidecar Pattern

The most powerful integration pattern is the PRISM Governance Sidecar:

```yaml
# docker-agent.yaml with PRISM governance sidecar
agents:
  root:
    model: anthropic/claude-sonnet-4-5
    hooks:
      pre_tool_use:
        - type: http
          url: http://localhost:3000/governance/hooks/pre-tool-use
          # PRISM evaluates tool use against governance policy
          # Returns: {"permission_decision": "allow"/"deny"/"ask", "audit_id": "<uuid>"}
      post_tool_use:
        - type: http
          url: http://localhost:3000/governance/hooks/post-tool-use
          # PRISM records tool execution in immutable audit trail
```

This requires PRISM to expose two new HTTP endpoints:

- `POST /governance/hooks/pre-tool-use` — evaluates Docker Agent tool use request against PRISM's 3-tier policy engine, returns `permission_decision` (Docker Agent hook format)
- `POST /governance/hooks/post-tool-use` — records execution in PRISM's SHA-256 audit chain

### Implementation Plan for Governance Hook Endpoints

**New file**: `src/server/governance-hooks-adapter.ts`

```typescript
// POST /governance/hooks/pre-tool-use
// Input (Docker Agent hook format):
// { "tool_name": "shell", "tool_input": { "cmd": "rm -rf /tmp/data" }, "agent_name": "developer" }
// Output:
// { "permission_decision": "deny", "message": "Tier 3 operation requires approval", "prism_audit_id": "<uuid>" }

export async function handlePreToolUse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req);
    const tier = classifyTool(body.tool_name, body.tool_input);  // tier1/tier2/tier3
    const decision = await policyEngine.evaluate(tier, body.agent_name);
    const auditId = await auditTrail.record({ ...body, tier, decision });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ permission_decision: decision, prism_audit_id: auditId }));
}
```

### "PRISM_GOVERNANCE_URL" Proposal

A future Docker Agent version could natively support a `PRISM_GOVERNANCE_URL` environment variable:

```bash
PRISM_GOVERNANCE_URL=http://localhost:3000/governance docker agent run agent.yaml
```

When set, Docker Agent's internal permissions evaluation defers to PRISM for all `permission_decision: ask` cases — making PRISM the governance authority without modifying agent YAML files. This could be proposed to Docker Engineering as a pull request or feature request, establishing PRISM as the reference governance backend for Docker Agent.

---

## Implementation Priority Matrix

| Feature | Phase | Effort | Impact | Priority |
|---------|-------|--------|--------|----------|
| A2A server endpoint | F | 3 days | **HIGH** — Distribution multiplier via Docker Agent | P1 |
| Governance hook endpoints | F | 2 days | **HIGH** — PRISM as governance sidecar for Docker Agent | P1 |
| OCI character packaging script | G | 1 day | **MEDIUM** — Discovery in Docker Hub agentcatalog | P2 |
| GitHub Actions publish workflow | G | 0.5 day | **MEDIUM** — Automated on release | P2 |
| `PRISM_GOVERNANCE_URL` Docker PR | H | 1 day | **HIGH** (if accepted) — Native Docker governance integration | P3 |

---

## Dependencies

- A2A server requires: existing PRISM HTTP server infrastructure (no Express needed)
- OCI packaging requires: `oras` CLI or `docker` CLI available in build environment
- Governance hooks require: existing PolicyEngine, ActivityBus, SQLite adapters
- All are ADDITIVE — no existing functionality is modified

---

*See also: [COMPETITIVE_ANALYSIS_2026.md](COMPETITIVE_ANALYSIS_2026.md) Part I-B for Docker Agent competitive context*  
*See also: [PHASE_E_TASKS_MANIFEST.md](PHASE_E_TASKS_MANIFEST.md) for Phase E status*
