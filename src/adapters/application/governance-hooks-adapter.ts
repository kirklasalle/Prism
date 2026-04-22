/**
 * GovernanceHooksAdapter — Docker Agent governance sidecar hook endpoints
 *
 * Exposes two HTTP endpoints that Docker Agent (and other A2A callers) can
 * call as pre/post tool-use hooks:
 *
 *   POST /governance/hooks/pre-tool-use
 *     Evaluates a pending tool call against PRISM's 3-tier policy engine.
 *     Returns { permission_decision: "allow"|"deny"|"ask", prism_audit_id }
 *
 *   POST /governance/hooks/post-tool-use
 *     Records a completed tool execution in PRISM's immutable audit trail.
 *     Returns { prism_audit_id, recorded: true }
 *
 * All decisions and recordings are persisted via ActivityBus (layer: "governance"),
 * which flows into the SqliteActivityStore SHA-256 audit chain.
 *
 * Phase F — see docs/A2A_OCI_INTEGRATION_SPEC.md Part 3 for full design.
 *
 * Docker Agent hook YAML:
 *   hooks:
 *     pre_tool_use:
 *       - type: http
 *         url: http://localhost:3000/governance/hooks/pre-tool-use
 *     post_tool_use:
 *       - type: http
 *         url: http://localhost:3000/governance/hooks/post-tool-use
 */

import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../../core/activity/bus.js";
import type { AuthorityTier } from "../../core/activity/types.js";

// ── Request / response types (Docker Agent hook format) ─────────────────────

export interface PreToolUseRequest {
    /** Name of the tool being invoked (e.g. "shell", "file_write"). */
    tool_name: string;
    /** Input arguments passed to the tool. */
    tool_input: Record<string, unknown>;
    /** Name of the agent making the call (optional, for audit). */
    agent_name?: string;
}

export interface PreToolUseResponse {
    /** Docker Agent permission decision: "allow" lets it proceed, "deny" blocks it,
     *  "ask" pauses the agent and prompts the user. */
    permission_decision: "allow" | "deny" | "ask";
    /** Human-readable governance message (optional). */
    message?: string;
    /** PRISM audit trail ID for this governance evaluation. */
    prism_audit_id: string;
}

export interface PostToolUseRequest {
    /** Name of the tool that was invoked. */
    tool_name: string;
    /** Input arguments passed to the tool (optional). */
    tool_input?: Record<string, unknown>;
    /** Output returned by the tool (optional). */
    tool_output?: Record<string, unknown>;
    /** Name of the agent that made the call (optional, for audit). */
    agent_name?: string;
}

export interface PostToolUseResponse {
    /** PRISM audit trail ID for this recorded execution. */
    prism_audit_id: string;
    /** Whether the execution was successfully recorded in the audit trail. */
    recorded: boolean;
}

// ── Tool risk classification ─────────────────────────────────────────────────

/**
 * Tools that map to Tier 3 (destructive / code-execution).
 * These will return permission_decision: "ask" — pausing the Docker Agent
 * workflow and requiring explicit human approval via PRISM's approval queue.
 */
const TIER3_TOOL_NAMES = new Set([
    "shell", "exec", "bash", "sh", "powershell", "cmd",
    "file_write", "write_file", "file_delete", "delete_file",
    "rm", "rmdir", "format", "truncate", "shred",
    "docker", "kubectl", "podman",
    "kill", "terminate", "stop_process",
    "deploy", "publish", "push",
    "database_write", "sql_exec", "drop_table", "alter_table",
]);

/**
 * Tools that map to Tier 2 (state-reading / conditional).
 * These are allowed with audit trail (permission_decision: "allow" + ActivityBus record).
 */
const TIER2_TOOL_NAMES = new Set([
    "file_read", "read_file", "file_list", "list_files", "list_dir",
    "http_request", "http_get", "http_post", "http_put", "api_call",
    "database_query", "sql_query", "db_select",
    "process_list", "network_scan", "port_scan",
    "registry_read", "env_read",
]);

/** Patterns in tool_input that escalate to Tier 3 regardless of tool name. */
const TIER3_INPUT_PATTERNS = /\b(rm\s+-rf|drop\s+table|delete\s+from|truncate\s+table|kill\s+-9|format\s+[a-z]:)\b/i;

function tierToAuthorityTier(tier: "tier1" | "tier2" | "tier3"): AuthorityTier {
    if (tier === "tier3") return "tier3_approval";
    if (tier === "tier2") return "tier2_conditional";
    return "tier1_autonomous";
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class GovernanceHooksAdapter {
    constructor(private readonly activityBus: ActivityBus) { }

    /**
     * Classify a tool invocation into a governance tier.
     * Exposed publicly for use in route handlers and tests.
     */
    classifyToolTier(toolName: string, toolInput: Record<string, unknown>): "tier1" | "tier2" | "tier3" {
        const name = toolName.toLowerCase().replace(/[-\s]/g, "_");
        if (TIER3_TOOL_NAMES.has(name)) return "tier3";

        // Check if tool_input serialization contains destructive patterns
        const inputStr = JSON.stringify(toolInput);
        if (TIER3_INPUT_PATTERNS.test(inputStr)) return "tier3";

        if (TIER2_TOOL_NAMES.has(name)) return "tier2";
        return "tier1";
    }

    /**
     * Evaluate a pending tool use against PRISM's governance policy.
     * Called by Docker Agent's pre_tool_use hook before executing a tool.
     */
    async handlePreToolUse(body: PreToolUseRequest): Promise<PreToolUseResponse> {
        const prism_audit_id = randomUUID();
        const tier = this.classifyToolTier(body.tool_name, body.tool_input ?? {});
        const authorityTier = tierToAuthorityTier(tier);

        let permission_decision: "allow" | "deny" | "ask";
        let message: string | undefined;

        if (tier === "tier3") {
            // Destructive operation — pause Docker Agent, require PRISM approval
            permission_decision = "ask";
            message =
                `PRISM governance: '${body.tool_name}' is a Tier 3 (high-risk) operation. ` +
                `Explicit approval required. Audit ID: ${prism_audit_id}`;
        } else if (tier === "tier2") {
            // State-reading / conditional — allow but record in audit trail
            permission_decision = "allow";
            message = `PRISM governance: '${body.tool_name}' allowed (Tier 2). Audit ID: ${prism_audit_id}`;
        } else {
            // Low-risk — allow autonomously
            permission_decision = "allow";
        }

        this.activityBus.emit({
            sessionId: prism_audit_id,
            layer: "governance",
            operation: "pre_tool_use_evaluated",
            status: "succeeded",
            details: {
                tool_name: body.tool_name,
                agent_name: body.agent_name ?? "unknown",
                governance_tier: tier,
                permission_decision,
                prism_audit_id,
            },
            authorityTier,
            policyDecision:
                tier === "tier3" ? "require_approval" :
                    tier === "tier2" ? "allow" :
                        "allow",
        });

        return { permission_decision, message, prism_audit_id };
    }

    /**
     * Record a completed tool execution in PRISM's immutable audit trail.
     * Called by Docker Agent's post_tool_use hook after a tool returns.
     */
    async handlePostToolUse(body: PostToolUseRequest): Promise<PostToolUseResponse> {
        const prism_audit_id = randomUUID();
        const tier = this.classifyToolTier(body.tool_name, body.tool_input ?? {});
        const authorityTier = tierToAuthorityTier(tier);

        this.activityBus.emit({
            sessionId: prism_audit_id,
            layer: "governance",
            operation: "post_tool_use_recorded",
            status: "succeeded",
            details: {
                tool_name: body.tool_name,
                agent_name: body.agent_name ?? "unknown",
                governance_tier: tier,
                has_output: body.tool_output !== undefined,
                prism_audit_id,
            },
            authorityTier,
            policyDecision: "allow",
        });

        return { prism_audit_id, recorded: true };
    }
}
