/**
 * Secure Browser Control Tool - Enhanced version with operator session integration
 * 
 * This wrapper extends the base BrowserControlTool with secure operator session 
 * management, providing:
 * - Session-based authorization for browser control operations
 * - Comprehensive audit trails for all web interactions
 * - Security policy enforcement based on operator privileges
 * - Integration with PRISM's Character Accountability Chain
 */

import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import { BrowserControlTool } from "./browser-control-tool.js";
import type {
    SecureOperatorSessionManager,
    SecureOperatorSession,
    SecureOperatorActivity
} from "../../core/operator/secure-operator-session-manager.js";
import type { ActivityBus } from "../../core/activity/bus.js";
import { randomUUID } from "node:crypto";

export interface SecureBrowserControlOptions {
    /** Secure operator session manager for authorization */
    sessionManager: SecureOperatorSessionManager;
    /** Activity bus for audit logging */
    activityBus: ActivityBus;
    /** Base browser control tool to wrap */
    browserControlTool?: BrowserControlTool;
    /** Operations that require elevated privileges */
    elevatedOperations?: string[];
}

export interface SecureBrowserControlRequest extends ToolRequest { }

/**
 * Secure Browser Control Tool with operator session integration
 * 
 * Wraps the base BrowserControlTool with comprehensive security features
 * including session-based authorization, audit trails, and compliance logging.
 */
export class SecureBrowserControlTool implements Tool {
    readonly name = "secure_browser";
    readonly contract: ToolContract;

    private readonly sessionManager: SecureOperatorSessionManager;
    private readonly activityBus: ActivityBus;
    private readonly browserControlTool: BrowserControlTool;
    private readonly elevatedOperations: Set<string>;

    constructor(options: SecureBrowserControlOptions) {
        this.sessionManager = options.sessionManager;
        this.activityBus = options.activityBus;
        this.browserControlTool = options.browserControlTool || new BrowserControlTool(options.activityBus);
        this.elevatedOperations = new Set(options.elevatedOperations || [
            "evaluate", "click", "type", "select_option", "set_cookie", "clear_cookies", "create_profile", "delete_profile"
        ]);

        // Extend the base contract with operator session requirements
        this.contract = {
            ...this.browserControlTool.contract,
            args: {
                ...this.browserControlTool.contract.args,
                operatorSessionId: {
                    type: "string",
                    required: true
                }
            }
        };
    }

    setSSHPInterceptor(sshpInterceptor: any): void {
        this.browserControlTool.setSSHPInterceptor(sshpInterceptor);
    }

    setCSHManager(cshManager: any): void {
        this.browserControlTool.setCSHManager(cshManager);
    }

    getManager(): any {
        return this.browserControlTool.getManager();
    }

    getProfileManager(): any {
        return this.browserControlTool.getProfileManager();
    }

    async execute(request: SecureBrowserControlRequest): Promise<ToolResult> {
        const args = request.args as Record<string, unknown>;
        const operatorSessionId = typeof args.operatorSessionId === "string" ? args.operatorSessionId : "";
        const action = typeof args.action === "string" ? args.action : "";

        try {
            // Step 1: Validate operator session
            const session = await this.validateOperatorSession(operatorSessionId);
            if (!session) {
                return {
                    ok: false,
                    output: {
                        error: "Invalid or expired operator session",
                        code: "session_invalid"
                    }
                };
            }

            // Step 2: Check operation authorization
            const authorized = await this.checkOperationAuthorized(session, action);
            if (!authorized) {
                await this.recordUnauthorizedAttempt(session, action, args);
                return {
                    ok: false,
                    output: {
                        error: `Operation '${action}' not authorized for current session`,
                        code: "operation_unauthorized"
                    }
                };
            }

            // Step 3: Record pre-operation state
            const activityId = await this.recordOperationStart(session, action, args);

            // Step 4: Execute the browser operation
            const startTime = Date.now();
            const result = await this.browserControlTool.execute({
                ...request,
                args: this.sanitizeArgsForBaseTool(args)
            });
            const executionTime = Date.now() - startTime;

            // Step 5: Record operation completion
            await this.recordOperationComplete(
                session,
                activityId,
                action,
                result,
                executionTime
            );

            return result;

        } catch (error) {
            console.error("Secure browser operation failed:", error);

            // Log the error if we have a valid session (or try to)
            try {
                if (operatorSessionId) {
                    await this.activityBus.emit({
                        sessionId: operatorSessionId,
                        layer: "tool_execution",
                        operation: "secure_browser_operation_failed",
                        status: "failed",
                        details: {
                            operatorSessionId,
                            action,
                            error: error instanceof Error ? error.message : String(error)
                        }
                    });
                }
            } catch (e) {
                console.error("Failed to log secure browser error:", e);
            }

            return {
                ok: false,
                output: {
                    error: "Secure browser operation failed",
                    message: error instanceof Error ? error.message : String(error),
                    code: "operation_failed"
                }
            };
        }
    }

    /**
     * Validate the operator session is active and valid
     */
    private async validateOperatorSession(sessionId: string): Promise<SecureOperatorSession | null> {
        if (!sessionId) return null;

        const session = this.sessionManager.getSession(sessionId);
        if (!session) return null;

        // Ensure session is active
        if (session.status !== "active") return null;

        // Ensure session hasn't expired
        if (new Date(session.expiresAt) < new Date()) {
            await this.sessionManager.terminateSession(sessionId, "Session expired");
            return null;
        }

        // Ensure session has browser capabilities
        if (session.sessionType !== "browser_control" && session.sessionType !== "full_control") {
            return null;
        }

        return session;
    }

    /**
     * Check if the specific operation is authorized for this session
     */
    private async checkOperationAuthorized(session: SecureOperatorSession, action: string): Promise<boolean> {
        // Use the session manager's built-in authorization check
        if (!this.sessionManager.isOperationAllowed(session.sessionId, action)) {
            return false;
        }

        // Additional checks for elevated operations
        if (this.elevatedOperations.has(action)) {
            // Require administrator or emergency privileges for elevated operations
            if (session.securityConstraints.privilege !== "administrator" &&
                session.securityConstraints.privilege !== "emergency") {
                return false;
            }
        }

        return true;
    }

    /**
     * Record the start of a secure operation
     */
    private async recordOperationStart(
        session: SecureOperatorSession,
        action: string,
        args: Record<string, unknown>
    ): Promise<string> {
        const activityId = randomUUID();

        const activity: SecureOperatorActivity = {
            activityId,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "browser_control",
            operation: action,
            details: {
                status: "started",
                args: this.maskSensitiveArgs(args)
            },
            impactLevel: this.determineImpactLevel(action)
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);
        return activityId;
    }

    /**
     * Record the completion of a secure operation
     */
    private async recordOperationComplete(
        session: SecureOperatorSession,
        activityId: string,
        action: string,
        result: ToolResult,
        executionTimeMs: number
    ): Promise<void> {
        const activity: SecureOperatorActivity = {
            activityId: `${activityId}-complete`,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "browser_control",
            operation: action,
            details: {
                status: result.ok ? "success" : "failed",
                executionTimeMs,
                originalActivityId: activityId,
                // Don't log full output as it might contain sensitive data (DOM, screenshots, etc.)
                resultStatus: result.ok ? "success" : "failed",
                hasOutput: !!result.output,
                errorCode: result.ok ? undefined : (result.output as any)?.code
            },
            impactLevel: this.determineImpactLevel(action)
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);
    }

    /**
     * Record an unauthorized attempt
     */
    private async recordUnauthorizedAttempt(
        session: SecureOperatorSession,
        action: string,
        args: Record<string, unknown>
    ): Promise<void> {
        const activity: SecureOperatorActivity = {
            activityId: randomUUID(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "browser_control",
            operation: action,
            details: {
                status: "denied",
                reason: "unauthorized_operation",
                args: this.maskSensitiveArgs(args)
            },
            impactLevel: "high" // Unauthorized attempts are always high impact for auditing
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);
    }

    /**
     * Determine the security impact level of an operation
     */
    private determineImpactLevel(action: string): "low" | "medium" | "high" | "critical" {
        if (this.elevatedOperations.has(action)) {
            return "high";
        }

        const lowImpact = ["get_page_info", "screenshot", "get_console_logs", "get_network_log", "list_sessions"];
        if (lowImpact.includes(action)) {
            return "low";
        }

        return "medium";
    }

    /**
     * Remove the operatorSessionId from args before passing to base tool
     */
    private sanitizeArgsForBaseTool(args: Record<string, unknown>): Record<string, unknown> {
        const { operatorSessionId, ...baseArgs } = args;
        return baseArgs;
    }

    /**
     * Mask sensitive arguments for audit logging
     */
    private maskSensitiveArgs(args: Record<string, unknown>): Record<string, unknown> {
        const masked = { ...args };

        // Remove operator session ID from logs
        delete masked.operatorSessionId;

        // Mask specific sensitive fields
        const sensitiveFields = ["text", "cookie", "expression", "values"];

        for (const field of sensitiveFields) {
            if (field in masked && typeof masked[field] === "string") {
                masked[field] = "[MASKED FOR SECURITY]";
            }
        }

        return masked;
    }
}