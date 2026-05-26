/**
 * PRISM Secure Operator Session Manager
 *
 * Orchestrates secure operator sessions integrating CAC authentication,
 * computer control sessions, and browser control sessions with comprehensive
 * audit trails and security boundaries.
 *
 * This manager provides:
 * - Centralized session lifecycle management
 * - Security policy enforcement
 * - Cross-session audit trail coordination
 * - Emergency session termination
 * - Session isolation and privilege management
 * - Integration with PRISM's Activity Bus for compliance logging
 */

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { BrowserSessionManager } from "./browser-session-manager.js";
import type { ComputerUseTool } from "../../adapters/system/computer-use-tool.js";
import type { CharacterAccountabilityManager } from "../accountability/character-accountability-manager.js";
import type {
    CacSession,
    CacSecurityLevel,
    CacOperatorPrivilege,
    CacProvider,
    CacAuthRequest,
    CacSecurityPolicy
} from "../iam/cac/types.js";

export type SecureOperatorSessionType = "cac_only" | "computer_control" | "browser_control" | "full_control";

export type SecureOperatorSessionStatus =
    | "initializing"
    | "authenticating"
    | "active"
    | "suspended"
    | "terminating"
    | "terminated"
    | "expired";

export interface SecureOperatorSession {
    /** Unique session identifier */
    sessionId: string;
    /** Session type defining capabilities */
    sessionType: SecureOperatorSessionType;
    /** Current session status */
    status: SecureOperatorSessionStatus;
    /** Associated CAC session */
    cacSession: CacSession;
    /** Computer control session ID if applicable */
    computerSessionId?: string;
    /** Browser session ID if applicable */
    browserSessionId?: string;
    /** Chat session ID for operator interactions */
    chatSessionId?: string;
    /** Session creation timestamp */
    createdAt: string;
    /** Last activity timestamp */
    lastActivityAt: string;
    /** Session expiration timestamp */
    expiresAt: string;
    /** Client information */
    clientInfo: {
        ip: string;
        userAgent?: string;
        platform?: string;
    };
    /** Security constraints */
    securityConstraints: {
        level: CacSecurityLevel;
        privilege: CacOperatorPrivilege;
        allowedOperations: string[];
        restrictedDomains?: string[];
        screenshotRequired: boolean;
    };
    /** Audit trail metadata */
    auditMetadata: Record<string, unknown>;
}

export interface SecureOperatorSessionOptions {
    /** Session type to create */
    sessionType: SecureOperatorSessionType;
    /** Security level required */
    securityLevel: CacSecurityLevel;
    /** Operator privilege level */
    operatorPrivilege: CacOperatorPrivilege;
    /** Session timeout in milliseconds */
    timeoutMs?: number;
    /** Idle timeout in milliseconds */
    idleTimeoutMs?: number;
    /** Character ID for accountability */
    characterId?: string;
    /** Additional session metadata */
    metadata?: Record<string, unknown>;
}

export interface SecureOperatorSessionManager {
    /** Create a new secure operator session with CAC authentication */
    createSession(
        authRequest: CacAuthRequest,
        options: SecureOperatorSessionOptions
    ): Promise<SecureOperatorSession>;

    /** Get active session by ID */
    getSession(sessionId: string): SecureOperatorSession | null;

    /** List all active sessions */
    listSessions(): SecureOperatorSession[];

    /** Suspend a session (temporarily disable) */
    suspendSession(sessionId: string, reason: string): Promise<void>;

    /** Resume a suspended session */
    resumeSession(sessionId: string): Promise<void>;

    /** Terminate a session permanently */
    terminateSession(sessionId: string, reason: string): Promise<void>;

    /** Emergency termination of all sessions */
    emergencyShutdown(reason: string): Promise<void>;

    /** Check if operation is allowed for session */
    isOperationAllowed(sessionId: string, operation: string): boolean;

    /** Record activity for audit trail */
    recordActivity(sessionId: string, activity: SecureOperatorActivity): Promise<void>;

    /** Get session audit trail */
    getAuditTrail(sessionId: string): SecureOperatorActivity[];
}

export interface SecureOperatorActivity {
    /** Activity unique identifier */
    activityId: string;
    /** Session ID */
    sessionId: string;
    /** Activity timestamp */
    timestamp: string;
    /** Activity type */
    activityType: "computer_control" | "browser_control" | "chat_interaction" | "system_operation";
    /** Operation performed */
    operation: string;
    /** Operation details */
    details: Record<string, unknown>;
    /** Security impact level */
    impactLevel: "low" | "medium" | "high" | "critical";
    /** Approval status if required */
    approvalStatus?: "pending" | "approved" | "denied";
    /** Screenshot reference if captured */
    screenshotRef?: string;
    /** Associated artifacts */
    artifacts?: string[];
}

export class DefaultSecureOperatorSessionManager extends EventEmitter implements SecureOperatorSessionManager {
    private readonly sessions = new Map<string, SecureOperatorSession>();
    private readonly auditTrails = new Map<string, SecureOperatorActivity[]>();
    private readonly sessionTimers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly cacProvider: CacProvider,
        private readonly activityBus: ActivityBus,
        private readonly browserSessionManager: BrowserSessionManager,
        private readonly computerUseTool: ComputerUseTool,
        private readonly accountabilityManager: CharacterAccountabilityManager,
        private readonly securityPolicy: CacSecurityPolicy
    ) {
        super();
        this.startSessionCleanup();
    }

    async createSession(
        authRequest: CacAuthRequest,
        options: SecureOperatorSessionOptions
    ): Promise<SecureOperatorSession> {
        const sessionId = this.generateSessionId();

        try {
            // Step 1: Authenticate with CAC
            await this.emitActivity("session_creation_started", {
                sessionId,
                sessionType: options.sessionType,
                securityLevel: authRequest.securityLevel,
                clientIp: authRequest.clientIp
            });

            const cacAuthResponse = await this.cacProvider.authenticate(authRequest);

            if (!cacAuthResponse.success || !cacAuthResponse.certificateInfo) {
                await this.emitActivity("session_creation_failed", {
                    sessionId,
                    error: cacAuthResponse.error,
                    errorCode: cacAuthResponse.errorCode
                });
                throw new Error(`CAC authentication failed: ${cacAuthResponse.error}`);
            }

            // Step 2: Create CAC session
            const cacSession: CacSession = {
                sessionId: cacAuthResponse.sessionId!,
                userId: this.extractUserId(cacAuthResponse.certificateInfo),
                tenantId: authRequest.tenantId,
                certificateInfo: cacAuthResponse.certificateInfo,
                status: "active",
                securityLevel: authRequest.securityLevel,
                privilegeLevel: authRequest.operatorPrivilege,
                createdAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                expiresAt: cacAuthResponse.expiresAt!,
                clientIp: authRequest.clientIp,
                characterId: options.characterId,
                metadata: options.metadata || {}
            };

            // Step 3: Create secure operator session
            const session: SecureOperatorSession = {
                sessionId,
                sessionType: options.sessionType,
                status: "initializing",
                cacSession,
                createdAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                expiresAt: cacSession.expiresAt,
                clientInfo: {
                    ip: authRequest.clientIp,
                    userAgent: authRequest.userAgent,
                    platform: process.platform
                },
                securityConstraints: {
                    level: authRequest.securityLevel,
                    privilege: authRequest.operatorPrivilege,
                    allowedOperations: this.getAllowedOperations(options.sessionType, authRequest.operatorPrivilege),
                    screenshotRequired: this.shouldRequireScreenshots(authRequest.securityLevel)
                },
                auditMetadata: {
                    createdBy: cacSession.certificateInfo.email,
                    cacId: cacSession.certificateInfo.cacId,
                    certificateThumbprint: cacSession.certificateInfo.thumbprint
                }
            };

            // Step 4: Initialize sub-sessions based on type
            await this.initializeSubSessions(session);

            // Step 5: Bind to character accountability if specified
            if (options.characterId) {
                await this.bindToCharacterAccountability(session, options.characterId);
            }

            // Step 6: Setup session monitoring
            this.setupSessionMonitoring(session);

            // Step 7: Store session and mark as active
            this.sessions.set(sessionId, session);
            this.auditTrails.set(sessionId, []);
            session.status = "active";

            await this.emitActivity("session_created", {
                sessionId,
                sessionType: options.sessionType,
                userId: cacSession.userId,
                email: cacSession.certificateInfo.email,
                securityLevel: session.securityConstraints.level,
                privilegeLevel: session.securityConstraints.privilege
            });

            this.emit("session_created", session);
            return session;

        } catch (error) {
            await this.emitActivity("session_creation_failed", {
                sessionId,
                error: error instanceof Error ? error.message : "Unknown error"
            });
            throw error;
        }
    }

    getSession(sessionId: string): SecureOperatorSession | null {
        return this.sessions.get(sessionId) || null;
    }

    listSessions(): SecureOperatorSession[] {
        return Array.from(this.sessions.values());
    }

    async suspendSession(sessionId: string, reason: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        session.status = "suspended";
        session.lastActivityAt = new Date().toISOString();

        await this.recordActivity(sessionId, {
            activityId: this.generateActivityId(),
            sessionId,
            timestamp: new Date().toISOString(),
            activityType: "system_operation",
            operation: "session_suspended",
            details: { reason },
            impactLevel: "medium"
        });

        await this.emitActivity("session_suspended", {
            sessionId,
            reason,
            suspendedBy: session.cacSession.certificateInfo.email
        });

        this.emit("session_suspended", session);
    }

    async resumeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        if (session.status !== "suspended") {
            throw new Error(`Cannot resume session in status: ${session.status}`);
        }

        session.status = "active";
        session.lastActivityAt = new Date().toISOString();

        await this.recordActivity(sessionId, {
            activityId: this.generateActivityId(),
            sessionId,
            timestamp: new Date().toISOString(),
            activityType: "system_operation",
            operation: "session_resumed",
            details: {},
            impactLevel: "medium"
        });

        await this.emitActivity("session_resumed", {
            sessionId,
            resumedBy: session.cacSession.certificateInfo.email
        });

        this.emit("session_resumed", session);
    }

    async terminateSession(sessionId: string, reason: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        session.status = "terminating";

        try {
            // Terminate sub-sessions
            await this.cleanupSubSessions(session);

            // Clear timers
            const timer = this.sessionTimers.get(sessionId);
            if (timer) {
                clearTimeout(timer);
                this.sessionTimers.delete(sessionId);
            }

            // Mark as terminated
            session.status = "terminated";
            session.lastActivityAt = new Date().toISOString();

            await this.recordActivity(sessionId, {
                activityId: this.generateActivityId(),
                sessionId,
                timestamp: new Date().toISOString(),
                activityType: "system_operation",
                operation: "session_terminated",
                details: { reason },
                impactLevel: "high"
            });

            await this.emitActivity("session_terminated", {
                sessionId,
                reason,
                terminatedBy: session.cacSession.certificateInfo.email,
                sessionDuration: Date.now() - new Date(session.createdAt).getTime()
            });

            this.emit("session_terminated", session);

        } catch (error) {
            session.status = "terminated";
            console.error(`Error terminating session ${sessionId}:`, error);
        }
    }

    async emergencyShutdown(reason: string): Promise<void> {
        const sessionIds = Array.from(this.sessions.keys());

        await this.emitActivity("emergency_shutdown_initiated", {
            reason,
            activeSessions: sessionIds.length,
            timestamp: new Date().toISOString()
        });

        const terminationPromises = sessionIds.map(sessionId =>
            this.terminateSession(sessionId, `Emergency shutdown: ${reason}`).catch(error => {
                console.error(`Failed to terminate session ${sessionId}:`, error);
            })
        );

        await Promise.all(terminationPromises);

        await this.emitActivity("emergency_shutdown_completed", {
            reason,
            terminatedSessions: sessionIds.length,
            timestamp: new Date().toISOString()
        });

        this.emit("emergency_shutdown", { reason, terminatedSessions: sessionIds });
    }

    isOperationAllowed(sessionId: string, operation: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== "active") {
            return false;
        }

        return session.securityConstraints.allowedOperations.includes(operation) ||
            session.securityConstraints.allowedOperations.includes("*");
    }

    async recordActivity(sessionId: string, activity: SecureOperatorActivity): Promise<void> {
        const auditTrail = this.auditTrails.get(sessionId);
        if (!auditTrail) {
            throw new Error(`No audit trail found for session: ${sessionId}`);
        }

        auditTrail.push(activity);

        // Update session last activity
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivityAt = activity.timestamp;
        }

        // Emit to activity bus for system-wide audit
        await this.emitActivity("operator_activity", {
            sessionId,
            activityId: activity.activityId,
            operation: activity.operation,
            activityType: activity.activityType,
            impactLevel: activity.impactLevel,
            details: activity.details
        });

        this.emit("activity_recorded", activity);
    }

    getAuditTrail(sessionId: string): SecureOperatorActivity[] {
        return this.auditTrails.get(sessionId) || [];
    }

    private async initializeSubSessions(session: SecureOperatorSession): Promise<void> {
        switch (session.sessionType) {
            case "computer_control":
            case "full_control":
                // Computer control sessions are managed by the tool itself
                session.computerSessionId = `computer_${session.sessionId}`;
                break;

            case "browser_control":
            case "full_control":
                // Create browser session with operator profile
                const browserSession = await this.browserSessionManager.launch({
                    sessionId: `browser_${session.sessionId}`,
                    profileId: `operator_${session.cacSession.userId}`,
                    assignmentId: session.cacSession.cacAssignmentId || `cac_${session.cacSession.certificateInfo.cacId}`,
                    prismUserEmail: session.cacSession.certificateInfo.email,
                    headless: false // Show browser for operator interaction
                });
                session.browserSessionId = browserSession.id;
                break;
        }
    }

    private async bindToCharacterAccountability(
        session: SecureOperatorSession,
        characterId: string
    ): Promise<void> {
        // Bind session to character accountability chain
        const assignment = this.accountabilityManager.assign({
            characterId,
            operatorId: session.cacSession.certificateInfo.cacId || "unknown_operator",
            operatorEmail: session.cacSession.certificateInfo.email,
            prismUserId: `cac_user_${session.cacSession.certificateInfo.cacId}`,
            prismUserEmail: session.cacSession.certificateInfo.email,
            executionProfile: characterId.includes("-business") ? "business" : "individual",
            sessionId: session.sessionId,
            clientId: session.clientInfo.ip,
            workspaceHub: session.clientInfo.platform,
        });

        session.cacSession.cacAssignmentId = assignment.assignmentId;
    }

    private async cleanupSubSessions(session: SecureOperatorSession): Promise<void> {
        if (session.browserSessionId) {
            try {
                await this.browserSessionManager.closeSession(session.browserSessionId);
            } catch (error) {
                console.error(`Failed to close browser session ${session.browserSessionId}:`, error);
            }
        }

        // Computer sessions are cleaned up automatically when the main session ends
    }

    private setupSessionMonitoring(session: SecureOperatorSession): void {
        const timeoutMs = new Date(session.expiresAt).getTime() - Date.now();

        const timer = setTimeout(async () => {
            try {
                await this.terminateSession(session.sessionId, "Session timeout");
            } catch (error) {
                console.error(`Error auto-terminating session ${session.sessionId}:`, error);
            }
        }, Math.max(timeoutMs, 1000)); // Minimum 1 second

        this.sessionTimers.set(session.sessionId, timer);
    }

    private startSessionCleanup(): void {
        // Clean up expired sessions every 5 minutes
        setInterval(async () => {
            const now = Date.now();
            const expiredSessions = Array.from(this.sessions.values())
                .filter(session => new Date(session.expiresAt).getTime() < now);

            for (const session of expiredSessions) {
                try {
                    await this.terminateSession(session.sessionId, "Session expired");
                } catch (error) {
                    console.error(`Error cleaning up expired session ${session.sessionId}:`, error);
                }
            }
        }, 5 * 60 * 1000);
    }

    private getAllowedOperations(
        sessionType: SecureOperatorSessionType,
        privilege: CacOperatorPrivilege
    ): string[] {
        const baseOperations = ["read", "audit"];
        const computerOperations = ["computer_screenshot", "computer_click", "computer_type", "computer_key"];
        const browserOperations = ["browser_navigate", "browser_click", "browser_type", "browser_screenshot"];
        const adminOperations = ["system_config", "user_management", "emergency_controls"];

        let operations = [...baseOperations];

        switch (sessionType) {
            case "computer_control":
                operations.push(...computerOperations);
                break;
            case "browser_control":
                operations.push(...browserOperations);
                break;
            case "full_control":
                operations.push(...computerOperations, ...browserOperations);
                break;
        }

        if (privilege === "administrator" || privilege === "emergency") {
            operations.push(...adminOperations);
        }

        return operations;
    }

    private shouldRequireScreenshots(securityLevel: CacSecurityLevel): boolean {
        return securityLevel === "confidential" || securityLevel === "secret" || securityLevel === "top_secret";
    }

    private extractUserId(certificateInfo: any): string {
        // Extract user ID from certificate info
        return `cac_user_${certificateInfo.cacId}`;
    }

    private async emitActivity(operation: string, details: Record<string, unknown>, sessionId?: string): Promise<void> {
        const eventSessionId = sessionId ??
            (typeof details.sessionId === "string" ? details.sessionId : "system");

        await this.activityBus.emit({
            sessionId: eventSessionId,
            layer: "governance",
            operation,
            status: "succeeded",
            details
        });
    }

    private generateSessionId(): string {
        return `secure_operator_${Date.now()}_${randomBytes(8).toString("hex")}`;
    }

    private generateActivityId(): string {
        return `activity_${Date.now()}_${randomBytes(4).toString("hex")}`;
    }
}