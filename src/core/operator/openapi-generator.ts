/**
 * OpenAPI 3.0 Specification Generator
 * 
 * Reflectively builds an OpenAPI spec from the known API surface
 * of the Prism DashboardService and route handlers.
 * 
 * @module core/operator/openapi-generator
 */

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, any>; securitySchemes: Record<string, any> };
  security: Array<Record<string, string[]>>;
}

interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  responses: Record<string, { description: string; content?: Record<string, { schema: any }> }>;
  requestBody?: { required: boolean; content: Record<string, { schema: any }> };
  parameters?: Array<{ name: string; in: string; required: boolean; schema: any; description?: string }>;
}

/** Known endpoint definition used to build the spec */
interface EndpointDef {
  path: string;
  method: string;
  operationId: string;
  summary: string;
  tags: string[];
  responseSchema?: any;
  requestSchema?: any;
  queryParams?: Array<{ name: string; required: boolean; schema: any; description?: string }>;
}

/**
 * Generate the full OpenAPI 3.0 specification for the Prism API surface.
 */
export function generateOpenApiSpec(port: number = 7070): OpenApiSpec {
  const endpoints = getKnownEndpoints();
  const paths: OpenApiSpec["paths"] = {};

  for (const ep of endpoints) {
    // Strip the leading `/api` segment so paths are bare (e.g. `/telemetry/slo-summary`).
    // The `/api/v1` prefix is carried in the `servers[].url` entry below, which is the
    // OpenAPI 3.0 convention and what api-versioning.test.ts asserts.
    const barePath = ep.path.startsWith("/api") ? ep.path.substring(4) : ep.path;
    if (!paths[barePath]) paths[barePath] = {};

    const operation: OpenApiOperation = {
      operationId: ep.operationId,
      summary: ep.summary,
      tags: ep.tags,
      responses: {
        "200": {
          description: "Successful response",
          ...(ep.responseSchema ? { content: { "application/json": { schema: ep.responseSchema } } } : {}),
        },
        "401": { description: "Unauthorized — missing or invalid bearer token" },
        "429": { description: "Rate limited — too many requests" },
      },
    };

    if (ep.requestSchema) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: ep.requestSchema } },
      };
    }

    if (ep.queryParams?.length) {
      operation.parameters = ep.queryParams.map(p => ({
        name: p.name, in: "query", required: p.required, schema: p.schema, description: p.description,
      }));
    }

    paths[barePath][ep.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Prism Operator API",
      version: "0.2.0",
      description: "The Prism Frontier Operator Console API provides endpoints for managing chat sessions, LLM providers, tools, agents, telemetry, and system governance.",
    },
    servers: [{ url: `http://127.0.0.1:${port}/api/v1`, description: "Local development server" }],
    paths,
    components: {
      schemas: getComponentSchemas(),
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "UUID token" },
      },
    },
    security: [{ BearerAuth: [] }],
  };
}

function getKnownEndpoints(): EndpointDef[] {
  return [
    // ── Health & Status ──
    { path: "/api/health", method: "GET", operationId: "getHealth", summary: "Health check with dependency status", tags: ["System"],
      responseSchema: { $ref: "#/components/schemas/HealthResponse" } },
    { path: "/api/status", method: "GET", operationId: "getStatus", summary: "Runtime status snapshot", tags: ["System"],
      responseSchema: { $ref: "#/components/schemas/StatusResponse" } },
    { path: "/api/system/adapters", method: "GET", operationId: "getAdapters", summary: "Terminal and container adapter status", tags: ["System"],
      responseSchema: { $ref: "#/components/schemas/AdaptersResponse" } },

    // ── Chat Sessions ──
    { path: "/api/sessions", method: "GET", operationId: "listSessions", summary: "List all chat sessions", tags: ["Chat"],
      responseSchema: { type: "array", items: { $ref: "#/components/schemas/ChatSessionSummary" } } },
    { path: "/api/sessions", method: "POST", operationId: "createSession", summary: "Create a new chat session", tags: ["Chat"],
      requestSchema: { type: "object", properties: { title: { type: "string" } } },
      responseSchema: { $ref: "#/components/schemas/ChatSessionSummary" } },
    { path: "/api/sessions/{sessionId}", method: "DELETE", operationId: "deleteSession", summary: "Delete a chat session", tags: ["Chat"] },
    { path: "/api/sessions/{sessionId}/messages", method: "GET", operationId: "getMessages", summary: "Get messages for a session", tags: ["Chat"],
      responseSchema: { type: "array", items: { $ref: "#/components/schemas/ChatMessage" } } },
    { path: "/api/chat", method: "POST", operationId: "sendMessage", summary: "Send a message in a chat session", tags: ["Chat"],
      requestSchema: { type: "object", properties: { sessionId: { type: "string" }, message: { type: "string" } }, required: ["sessionId", "message"] } },

    // ── Approvals ──
    { path: "/api/approval/pending", method: "GET", operationId: "listPending", summary: "List pending approval requests", tags: ["Governance"] },
    { path: "/api/approve/{id}", method: "POST", operationId: "approveRequest", summary: "Approve a pending request", tags: ["Governance"] },
    { path: "/api/deny/{id}", method: "POST", operationId: "denyRequest", summary: "Deny a pending request", tags: ["Governance"] },

    // ── Provider & LLM ──
    { path: "/api/chrome", method: "GET", operationId: "getChrome", summary: "LLM provider catalog and active selection", tags: ["Providers"] },
    { path: "/api/providers", method: "GET", operationId: "listProviders", summary: "List all configured LLM providers", tags: ["Providers"] },
    { path: "/api/providers/{providerId}/settings", method: "PUT", operationId: "updateProviderSettings", summary: "Update provider configuration", tags: ["Providers"] },
    { path: "/api/providers/{providerId}/apikey", method: "PUT", operationId: "setProviderApiKey", summary: "Store provider API key", tags: ["Providers"] },
    { path: "/api/providers/{providerId}/test", method: "POST", operationId: "testProvider", summary: "Test provider connectivity", tags: ["Providers"] },
    { path: "/api/providers/{providerId}/discover", method: "POST", operationId: "discoverModels", summary: "Discover available models from provider", tags: ["Providers"] },

    // ── Tools & Plugins ──
    { path: "/api/tools", method: "GET", operationId: "listTools", summary: "List registered tools with state", tags: ["Tools"] },
    { path: "/api/tools/{toolName}/toggle", method: "POST", operationId: "toggleTool", summary: "Enable or disable a tool", tags: ["Tools"] },
    { path: "/api/plugins/{name}/toggle", method: "POST", operationId: "togglePlugin", summary: "Enable or disable a plugin", tags: ["Tools"] },
    { path: "/api/plugins/{name}/health", method: "GET", operationId: "getPluginHealth", summary: "Per-plugin health status", tags: ["Tools"] },
    { path: "/api/tools/{toolName}/test", method: "POST", operationId: "testTool", summary: "Test a tool with sample input", tags: ["Tools"] },

    // ── Telemetry ──
    { path: "/api/telemetry", method: "GET", operationId: "getTelemetry", summary: "Telemetry summary for the selected window", tags: ["Telemetry"],
      queryParams: [{ name: "window", required: false, schema: { type: "string", enum: ["1h", "1d", "7d"] }, description: "Telemetry window" }] },
    { path: "/api/traces", method: "GET", operationId: "getTraces", summary: "Correlated trace summaries", tags: ["Telemetry"],
      queryParams: [
        { name: "limit", required: false, schema: { type: "integer" }, description: "Max traces to return" },
        { name: "correlationId", required: false, schema: { type: "string" }, description: "Filter by correlation ID" },
      ] },
    { path: "/api/slo", method: "GET", operationId: "getSlo", summary: "SLO gauge metrics", tags: ["Telemetry"] },
    { path: "/api/telemetry/slo-summary", method: "GET", operationId: "getSloSummary", summary: "SLO summary across the configured window", tags: ["Telemetry"] },

    // ── Actions ──
    { path: "/api/actions", method: "GET", operationId: "listActions", summary: "List dashboard actions and their states", tags: ["Actions"] },
    { path: "/api/actions/{name}/run", method: "POST", operationId: "runAction", summary: "Trigger a dashboard action", tags: ["Actions"] },
    { path: "/api/actions/history", method: "GET", operationId: "getActionHistory", summary: "Action execution history", tags: ["Actions"] },

    // ── Agents ──
    { path: "/api/agents", method: "GET", operationId: "listAgents", summary: "List active agents", tags: ["Agentic"] },
    { path: "/api/agents/launch", method: "POST", operationId: "launchAgent", summary: "Launch a new agent", tags: ["Agentic"] },
    { path: "/api/agents/{agentId}/stop", method: "POST", operationId: "stopAgent", summary: "Stop an agent", tags: ["Agentic"] },
    { path: "/api/guardian/status", method: "GET", operationId: "getGuardianStatus", summary: "Guardian agent status", tags: ["Agentic"] },

    // ── Scheduler ──
    { path: "/api/scheduler/events", method: "GET", operationId: "listSchedulerEvents", summary: "List scheduler events", tags: ["Scheduler"] },
    { path: "/api/scheduler/events", method: "POST", operationId: "createSchedulerEvent", summary: "Create a scheduler event", tags: ["Scheduler"] },

    // ── Incidents ──
    { path: "/api/incidents/bundle", method: "POST", operationId: "captureIncidentBundle", summary: "Capture an incident triage bundle", tags: ["Incidents"] },

    // ── Session Packages ──
    { path: "/api/session-packages", method: "GET", operationId: "listSessionPackages", summary: "List session packages", tags: ["Packages"] },
    { path: "/api/session-packages", method: "POST", operationId: "createSessionPackage", summary: "Create a new session package", tags: ["Packages"] },

    // ── OAuth ──
    { path: "/api/oauth/status", method: "GET", operationId: "getOAuthStatus", summary: "Gmail and Outlook OAuth connection status", tags: ["OAuth"] },

    // ── Readiness ──
    { path: "/api/readiness", method: "GET", operationId: "getReadiness", summary: "System readiness check", tags: ["System"] },

    // ── Settings ──
    { path: "/api/settings", method: "GET", operationId: "getSettings", summary: "Get runtime settings", tags: ["Settings"] },
    { path: "/api/settings", method: "PUT", operationId: "updateSettings", summary: "Update runtime settings", tags: ["Settings"] },

    // ── Models ──
    { path: "/api/models/gguf", method: "GET", operationId: "listGgufModels", summary: "List available GGUF models", tags: ["Models"] },
    { path: "/api/models/download", method: "POST", operationId: "downloadModel", summary: "Initiate model download", tags: ["Models"] },
    { path: "/api/models/download/status", method: "GET", operationId: "getDownloadStatus", summary: "Download progress status", tags: ["Models"] },
    { path: "/api/models/delete", method: "DELETE", operationId: "deleteModel", summary: "Delete a downloaded model or Ollama tag", tags: ["Models"] },
  ];
}

function getComponentSchemas(): Record<string, any> {
  return {
    HealthResponse: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "degraded"] },
        version: { type: "string" },
        uptime: { type: "integer", description: "Uptime in seconds" },
        sessionId: { type: "string" },
        mode: { type: "string" },
        dependencies: {
          type: "object",
          properties: {
            db: { type: "string" },
            providers: { type: "integer" },
            pending_approvals: { type: "integer" },
          },
        },
      },
    },
    StatusResponse: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        mode: { type: "string" },
        startedAt: { type: "string", format: "date-time" },
        uptimeSeconds: { type: "integer" },
        pendingApprovals: { type: "integer" },
        chatSessionCount: { type: "integer" },
        eventCount: { type: "integer" },
        workspaceRoot: { type: "string" },
      },
    },
    AdaptersResponse: {
      type: "object",
      properties: {
        terminal: { type: "object", properties: { enabled: { type: "boolean" }, backend: { type: "string" } } },
        container: { type: "object", properties: { enabled: { type: "boolean" }, backend: { type: "string" } } },
      },
    },
    ChatSessionSummary: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        title: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        llmProviderId: { type: "string", nullable: true },
        llmModel: { type: "string", nullable: true },
        messageCount: { type: "integer" },
        lastMessagePreview: { type: "string", nullable: true },
      },
    },
    ChatMessage: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        sessionId: { type: "string" },
        role: { type: "string", enum: ["user", "assistant", "system"] },
        content: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
        metadata: { type: "object" },
      },
    },
  };
}
