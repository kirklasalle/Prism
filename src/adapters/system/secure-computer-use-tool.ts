/**
 * Secure Computer Use Tool - Enhanced version with operator session integration
 * 
 * This wrapper extends the base ComputerUseTool with secure operator session 
 * management, providing:
 * - Session-based authorization for computer control operations
 * - Comprehensive audit trails for all system interactions
 * - Security policy enforcement based on operator privileges
 * - Screenshot capture for compliance and forensics
 * - Integration with PRISM's Character Accountability Chain
 */

import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import { ComputerUseTool } from "./computer-use-tool.js";
import type {
    SecureOperatorSessionManager,
    SecureOperatorSession,
    SecureOperatorActivity
} from "../../core/operator/secure-operator-session-manager.js";
import type { ActivityBus } from "../../core/activity/bus.js";

export interface SecureComputerUseOptions {
    /** Secure operator session manager for authorization */
    sessionManager: SecureOperatorSessionManager;
    /** Activity bus for audit logging */
    activityBus: ActivityBus;
    /** Base computer use tool to wrap */
    computerUseTool?: ComputerUseTool;
    /** Whether to capture screenshots for high-impact operations */
    captureScreenshots?: boolean;
    /** Operations that require elevated privileges */
    elevatedOperations?: string[];
}

export interface SecureComputerUseRequest extends ToolRequest { }

/**
 * Secure Computer Use Tool with operator session integration
 * 
 * Wraps the base ComputerUseTool with comprehensive security features
 * including session-based authorization, audit trails, and compliance logging.
 */
export class SecureComputerUseTool implements Tool {
    readonly name = "secure_computer";
    readonly contract: ToolContract;

    private readonly sessionManager: SecureOperatorSessionManager;
    private readonly activityBus: ActivityBus;
    private readonly computerUseTool: ComputerUseTool;
    private readonly captureScreenshots: boolean;
    private readonly elevatedOperations: Set<string>;

    constructor(options: SecureComputerUseOptions) {
        this.sessionManager = options.sessionManager;
        this.activityBus = options.activityBus;
        this.computerUseTool = options.computerUseTool || new ComputerUseTool();
        this.captureScreenshots = options.captureScreenshots ?? true;
        this.elevatedOperations = new Set(options.elevatedOperations || [
            "key", "type", "mouse_move", "left_click", "right_click", "double_click"
        ]);

        // Extend the base contract with operator session requirements
        this.contract = {
            ...this.computerUseTool.contract,
            args: {
                ...this.computerUseTool.contract.args,
                operatorSessionId: {
                    type: "string",
                    required: true
                }
            }
        };
    }

    async execute(request: SecureComputerUseRequest): Promise<ToolResult> {
        const { operatorSessionId, action } = request.args as {
            operatorSessionId: string;
            action: string;
            [key: string]: unknown;
        };

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
                await this.recordUnauthorizedAttempt(session, action, request.args);
                return {
                    ok: false,
                    output: {
                        error: `Operation '${action}' not authorized for current session`,
                        code: "operation_unauthorized"
                    }
                };
            }

            // Step 3: Record pre-operation state
            const activityId = await this.recordOperationStart(session, action, request.args);

            // Step 4: Capture pre-operation screenshot if required
            let preScreenshot: string | undefined;
            if (this.shouldCaptureScreenshot(session, action)) {
                preScreenshot = await this.captureOperationScreenshot("pre", activityId);
            }

            // Step 5: Execute the computer operation
            const startTime = Date.now();
            const result = await this.computerUseTool.execute({
                ...request,
                args: this.sanitizeArgsForBaseTool(request.args)
            });
            const executionTime = Date.now() - startTime;

            // Step 6: Capture post-operation screenshot if required
            let postScreenshot: string | undefined;
            if (this.shouldCaptureScreenshot(session, action)) {
                postScreenshot = await this.captureOperationScreenshot("post", activityId);
            }

            // Step 7: Record operation completion
            await this.recordOperationComplete(
                session,
                activityId,
                action,
                result,
                executionTime,
                preScreenshot,
                postScreenshot
            );

            return result;

        } catch (error) {
            console.error("Secure computer operation failed:", error);

            // Record the error in audit trail
            if (operatorSessionId) {
                const session = this.sessionManager.getSession(operatorSessionId);
                if (session) {
                    await this.recordOperationError(session, action, error, request.args);
                }
            }

            return {
                ok: false,
                output: {
                    error: error instanceof Error ? error.message : "Operation failed",
                    code: "execution_failed"
                }
            };
        }
    }

    /**
     * Check if an operator session is valid and active
     */
    private async validateOperatorSession(sessionId: string): Promise<SecureOperatorSession | null> {
        const session = this.sessionManager.getSession(sessionId);

        if (!session) {
            return null;
        }

        if (session.status !== "active") {
            return null;
        }

        // Check if session has expired
        if (new Date(session.expiresAt).getTime() < Date.now()) {
            return null;
        }

        // Check if session supports computer control
        if (session.sessionType !== "computer_control" && session.sessionType !== "full_control") {
            return null;
        }

        return session;
    }

    /**
     * Check if the requested operation is authorized for the session
     */
    private async checkOperationAuthorized(session: SecureOperatorSession, operation: string): Promise<boolean> {
        // Map computer actions to operation permissions
        const operationMap: Record<string, string> = {
            screenshot: "computer_screenshot",
            mouse_move: "computer_click",
            left_click: "computer_click",
            right_click: "computer_click",
            double_click: "computer_click",
            left_click_drag: "computer_click",
            middle_click: "computer_click",
            type: "computer_type",
            key: "computer_key",
            cursor_position: "computer_screenshot"
        };

        const requiredPermission = operationMap[operation];
        if (!requiredPermission) {
            return false;
        }

        return this.sessionManager.isOperationAllowed(session.sessionId, requiredPermission);
    }

    /**
     * Record the start of a computer operation for audit trail
     */
    private async recordOperationStart(
        session: SecureOperatorSession,
        operation: string,
        args: Record<string, unknown>
    ): Promise<string> {
        const activityId = this.generateActivityId();

        const activity: SecureOperatorActivity = {
            activityId,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "computer_control",
            operation: `computer_${operation}`,
            details: {
                action: operation,
                args: this.sanitizeArgsForLogging(args),
                operatorEmail: session.cacSession.certificateInfo.email,
                securityLevel: session.securityConstraints.level,
                privilegeLevel: session.securityConstraints.privilege
            },
            impactLevel: this.getOperationImpactLevel(operation)
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);

        // Also log to activity bus for system-wide auditing
        await this.activityBus.emit({
            sessionId: session.sessionId,
            layer: "tool_execution",
            operation: "computer_operation_started",
            status: "succeeded",
            details: {
                activityId,
                sessionId: session.sessionId,
                operation,
                operatorEmail: session.cacSession.certificateInfo.email
            }
        });

        return activityId;
    }

    /**
     * Record successful completion of a computer operation
     */
    private async recordOperationComplete(
        session: SecureOperatorSession,
        activityId: string,
        operation: string,
        result: ToolResult,
        executionTime: number,
        preScreenshot?: string,
        postScreenshot?: string
    ): Promise<void> {
        const activity: SecureOperatorActivity = {
            activityId: `${activityId}_complete`,
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "computer_control",
            operation: `computer_${operation}_complete`,
            details: {
                originalActivityId: activityId,
                action: operation,
                success: result.ok,
                executionTimeMs: executionTime,
                result: result.output,
                operatorEmail: session.cacSession.certificateInfo.email
            },
            impactLevel: this.getOperationImpactLevel(operation),
            screenshotRef: postScreenshot,
            artifacts: [preScreenshot, postScreenshot].filter(Boolean) as string[]
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);

        // Log completion to activity bus
        await this.activityBus.emit({
            sessionId: session.sessionId,
            layer: "tool_execution",
            operation: "computer_operation_completed",
            status: result.ok ? "succeeded" : "failed",
            details: {
                activityId,
                sessionId: session.sessionId,
                operation,
                executionTime,
                operatorEmail: session.cacSession.certificateInfo.email
            }
        });
    }

    /**
     * Record an unauthorized operation attempt
     */
    private async recordUnauthorizedAttempt(
        session: SecureOperatorSession,
        operation: string,
        args: Record<string, unknown>
    ): Promise<void> {
        const activity: SecureOperatorActivity = {
            activityId: this.generateActivityId(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "computer_control",
            operation: `computer_${operation}_unauthorized`,
            details: {
                action: operation,
                args: this.sanitizeArgsForLogging(args),
                operatorEmail: session.cacSession.certificateInfo.email,
                securityLevel: session.securityConstraints.level,
                privilegeLevel: session.securityConstraints.privilege,
                reason: "Insufficient privileges"
            },
            impactLevel: "high"
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);

        // High-priority security event
        await this.activityBus.emit({
            sessionId: session.sessionId,
            layer: "tool_execution",
            operation: "unauthorized_computer_access_attempt",
            status: "failed",
            details: {
                sessionId: session.sessionId,
                operation,
                operatorEmail: session.cacSession.certificateInfo.email,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Record an operation error for audit trail
     */
    private async recordOperationError(
        session: SecureOperatorSession,
        operation: string,
        error: unknown,
        args: Record<string, unknown>
    ): Promise<void> {
        const activity: SecureOperatorActivity = {
            activityId: this.generateActivityId(),
            sessionId: session.sessionId,
            timestamp: new Date().toISOString(),
            activityType: "computer_control",
            operation: `computer_${operation}_error`,
            details: {
                action: operation,
                args: this.sanitizeArgsForLogging(args),
                error: error instanceof Error ? error.message : String(error),
                operatorEmail: session.cacSession.certificateInfo.email
            },
            impactLevel: "medium"
        };

        await this.sessionManager.recordActivity(session.sessionId, activity);
    }

    /**
     * Determine if screenshots should be captured for this operation
     */
    private shouldCaptureScreenshot(session: SecureOperatorSession, operation: string): boolean {
        if (!this.captureScreenshots) {
            return false;
        }

        // Always capture for high-security sessions
        if (session.securityConstraints.screenshotRequired) {
            return true;
        }

        // Capture for elevated operations
        if (this.elevatedOperations.has(operation)) {
            return true;
        }

        return false;
    }

    /**
     * Capture a screenshot for operation documentation
     */
    private async captureOperationScreenshot(phase: "pre" | "post", activityId: string): Promise<string> {
        try {
            const screenshotResult = await this.computerUseTool.execute({
                operation: "screenshot",
                risk: "low",
                mutatesState: false,
                args: { action: "screenshot" }
            });

            if (screenshotResult.ok && screenshotResult.output && typeof screenshotResult.output === "object") {
                const output = screenshotResult.output as { filename?: string };
                if (output.filename) {
                    return `${phase}_${activityId}_${output.filename}`;
                }
            }
        } catch (error) {
            console.warn(`Failed to capture ${phase}-operation screenshot:`, error);
        }

        return `${phase}_${activityId}_screenshot_failed`;
    }

    /**
     * Determine the security impact level of an operation
     */
    private getOperationImpactLevel(operation: string): "low" | "medium" | "high" | "critical" {
        const highImpactOps = ["type", "key"];
        const mediumImpactOps = ["left_click", "right_click", "double_click", "left_click_drag"];
        const lowImpactOps = ["mouse_move", "cursor_position", "screenshot"];

        if (highImpactOps.includes(operation)) return "high";
        if (mediumImpactOps.includes(operation)) return "medium";
        if (lowImpactOps.includes(operation)) return "low";

        return "medium"; // Default for unknown operations
    }

    /**
     * Remove sensitive information from args for logging
     */
    private sanitizeArgsForLogging(args: Record<string, unknown>): Record<string, unknown> {
        const sanitized = { ...args };

        // Remove operator session ID from logs (it's already recorded in session context)
        delete sanitized.operatorSessionId;

        // Sanitize sensitive text input (keep length and type info but mask content)
        if (sanitized.text && typeof sanitized.text === "string") {
            const text = sanitized.text as string;
            if (text.length > 50) {
                sanitized.text = `[REDACTED_TEXT_${text.length}_CHARS]`;
            } else if (/password|secret|key|token/i.test(text)) {
                sanitized.text = `[REDACTED_SENSITIVE_${text.length}_CHARS]`;
            }
        }

        return sanitized;
    }

    /**
     * Remove operator session tracking from args when calling base tool
     */
    private sanitizeArgsForBaseTool(args: Record<string, unknown>): Record<string, unknown> {
        const sanitized = { ...args };
        delete sanitized.operatorSessionId;
        return sanitized;
    }

    /**
     * Generate a unique activity ID for tracking
     */
    private generateActivityId(): string {
        return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
}