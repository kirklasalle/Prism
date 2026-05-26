import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { AccountabilityChain } from "../activity/types.js";
import {
    CharacterAccountabilityStore,
    type CharacterAssignment,
    type CharacterAssignmentFilter,
    type CharacterAssignmentState,
    type PermissionScope,
} from "./character-accountability-store.js";

export interface AssignCharacterInput {
    characterId: string;
    prismUserId: string;
    prismUserEmail: string;
    operatorId: string;
    operatorEmail: string;
    clientId: string;
    sessionId: string;
    executionProfile?: string;
    workspaceHub?: string;
}

export interface BusinessEmailValidationPolicy {
    requireMatchingDomains?: boolean;
    allowedDomains?: string[];
}

export interface CharacterAccountabilityManagerOptions {
    businessEmailValidation?: BusinessEmailValidationPolicy;
}

export class CharacterAccountabilityManager {
    private readonly options: CharacterAccountabilityManagerOptions;

    constructor(
        private readonly store: CharacterAccountabilityStore,
        private readonly activityBus: ActivityBus,
        options: CharacterAccountabilityManagerOptions = {},
    ) {
        this.options = options;
    }

    assign(input: AssignCharacterInput): CharacterAssignment {
        assertValidEmail(input.prismUserEmail, "prismUserEmail");
        assertValidEmail(input.operatorEmail, "operatorEmail");

        const executionProfileSegment = resolveExecutionProfileSegment(input.executionProfile);
        const prismUserEmail = normalizeEmail(input.prismUserEmail);
        const operatorEmail = normalizeEmail(input.operatorEmail);

        if (executionProfileSegment === "business") {
            assertNotPlaceholderEmail(prismUserEmail, "prismUserEmail");
            assertNotPlaceholderEmail(operatorEmail, "operatorEmail");
            this.assertBusinessEmailPolicy(prismUserEmail, operatorEmail);
        }

        const now = new Date().toISOString();
        const assignment: CharacterAssignment = {
            assignmentId: randomUUID(),
            characterId: input.characterId,
            prismUserId: input.prismUserId,
            prismUserEmail,
            operatorId: input.operatorId,
            operatorEmail,
            clientId: input.clientId,
            sessionId: input.sessionId,
            executionProfileSegment,
            workspaceHub: (input.workspaceHub ?? "").trim(),
            state: "active",
            dispatchCount: 0,
            assignedAt: now,
            updatedAt: now,
            lastActiveAt: now,
        };

        this.store.save(assignment);
        this.emitLifecycleEvent("character_accountability.assign", assignment, "succeeded", {
            state: assignment.state,
        });

        return assignment;
    }

    suspend(assignmentId: string, reason: string): CharacterAssignment | null {
        return this.transitionState(assignmentId, "suspended", reason);
    }

    resume(assignmentId: string): CharacterAssignment | null {
        const existing = this.store.get(assignmentId);
        if (!existing || existing.state === "revoked") {
            return null;
        }

        const updated = {
            ...existing,
            state: "active" as const,
            suspendReason: undefined,
            updatedAt: new Date().toISOString(),
        };
        this.store.save(updated);

        this.emitLifecycleEvent("character_accountability.resume", updated, "succeeded", {
            previousState: existing.state,
            state: updated.state,
        });

        return updated;
    }

    revoke(assignmentId: string, reason: string): CharacterAssignment | null {
        return this.transitionState(assignmentId, "revoked", reason);
    }

    recordDispatch(assignmentId: string): CharacterAssignment | null {
        const existing = this.store.get(assignmentId);
        if (!existing || existing.state !== "active") {
            return null;
        }

        const now = new Date().toISOString();
        const updated: CharacterAssignment = {
            ...existing,
            dispatchCount: existing.dispatchCount + 1,
            lastActiveAt: now,
            updatedAt: now,
        };

        this.store.save(updated);
        this.emitLifecycleEvent("character_accountability.dispatch", updated, "succeeded", {
            dispatchCount: updated.dispatchCount,
        });

        return updated;
    }

    get(assignmentId: string): CharacterAssignment | null {
        return this.store.get(assignmentId);
    }

    queryByCharacter(characterId: string): CharacterAssignment[] {
        return this.store.list({ characterId });
    }

    queryByOperator(operatorId: string): CharacterAssignment[] {
        return this.store.list({ operatorId });
    }

    queryByPrismUser(prismUserId: string): CharacterAssignment[] {
        return this.store.list({ prismUserId });
    }

    queryByPrismUserEmail(prismUserEmail: string): CharacterAssignment[] {
        return this.store.list({ prismUserEmail: normalizeEmail(prismUserEmail) });
    }

    queryByOperatorEmail(operatorEmail: string): CharacterAssignment[] {
        return this.store.list({ operatorEmail: normalizeEmail(operatorEmail) });
    }

    queryByExecutionProfile(segment: "individual" | "business"): CharacterAssignment[] {
        return this.store.list({ executionProfileSegment: segment });
    }

    queryByClient(clientId: string): CharacterAssignment[] {
        return this.store.list({ clientId });
    }

    queryBySession(sessionId: string): CharacterAssignment[] {
        return this.store.list({ sessionId });
    }
    list(filter: CharacterAssignmentFilter = {}): CharacterAssignment[] {
        return this.store.list(filter);
    }

    /**
     * Set (replace) the permission scopes for an assignment.
     * Scopes with a null expiresAt never expire.
     */
    setPermissionScopes(assignmentId: string, scopes: PermissionScope[]): CharacterAssignment | null {
        const existing = this.store.get(assignmentId);
        if (!existing || existing.state === "revoked") return null;

        const updated: CharacterAssignment = {
            ...existing,
            permissionScopes: scopes,
            updatedAt: new Date().toISOString(),
        };
        this.store.save(updated);

        this.emitLifecycleEvent("character_accountability.scopes_updated", updated, "succeeded", {
            scopes: scopes.map((s) => ({ scope: s.scope, expiresAt: s.expiresAt })),
        });

        return updated;
    }

    /**
     * Delete an assignment completely from the store.
     */
    deleteAssignment(assignmentId: string): boolean {
        const existing = this.store.get(assignmentId);
        if (!existing) return false;

        this.store.delete(assignmentId);

        this.emitLifecycleEvent(
            "character_accountability.deleted",
            existing,
            "succeeded",
            {}
        );

        return true;
    }

    /**
     * Scan all active assignments and revoke any that have at least one scope expired.
     * Returns the list of assignments that were revoked.
     */
    revokeExpiredScopes(): CharacterAssignment[] {
        const now = Date.now();
        const active = this.store.list({ state: "active" });
        const revoked: CharacterAssignment[] = [];

        for (const assignment of active) {
            const scopes = assignment.permissionScopes ?? [];
            const hasExpired = scopes.some(
                (s) => s.expiresAt !== null && new Date(s.expiresAt).getTime() < now
            );
            if (hasExpired) {
                const result = this.transitionState(
                    assignment.assignmentId,
                    "revoked",
                    "permission_scope_expired"
                );
                if (result) revoked.push(result);
            }
        }

        return revoked;
    }

    /**
     * Phase E3 / E5: Mark the operator's email as verified by an OAuth provider.
     */
    markEmailVerified(
        assignmentId: string,
        verifiedEmail: string,
        provider: "gmail" | "outlook",
    ): CharacterAssignment | null {
        const existing = this.store.get(assignmentId);
        if (!existing || existing.state === "revoked") return null;
        if (normalizeEmail(verifiedEmail) !== normalizeEmail(existing.operatorEmail)) {
            this.emitLifecycleEvent("character_accountability.email_verification_mismatch", existing, "failed", {
                provider,
                verifiedEmail: normalizeEmail(verifiedEmail),
                expectedEmail: existing.operatorEmail,
            });
            return null;
        }
        const updated: CharacterAssignment = {
            ...existing,
            emailVerifiedAt: new Date().toISOString(),
            emailVerifiedProvider: provider,
            updatedAt: new Date().toISOString(),
        };
        this.store.save(updated);
        this.emitLifecycleEvent("character_accountability.email_verified", updated, "succeeded", {
            provider,
            verifiedEmail: normalizeEmail(verifiedEmail),
        });
        return updated;
    }

    /**
     * Phase E5: True when the operator email has been verified within the
     * supplied freshness window (default 30 days).
     */
    isEmailVerificationFresh(assignmentId: string, maxAgeMs: number = 30 * 86_400_000): boolean {
        const existing = this.store.get(assignmentId);
        if (!existing || !existing.emailVerifiedAt) return false;
        const t = new Date(existing.emailVerifiedAt).getTime();
        if (isNaN(t)) return false;
        return (Date.now() - t) <= maxAgeMs;
    }

    /**
     * Phase E3: Materialize a CAC chain for visualization / export.
     */
    getAssignmentChain(assignmentId: string): {
        assignment: CharacterAssignment;
        chain: AccountabilityChain;
        scopes: { active: number; expired: number; total: number };
        emailVerification: { verified: boolean; freshDays: number | null; provider: string | null };
    } | null {
        const assignment = this.store.get(assignmentId);
        if (!assignment) return null;
        const now = Date.now();
        const scopes = assignment.permissionScopes ?? [];
        let active = 0; let expired = 0;
        for (const s of scopes) {
            if (s.expiresAt === null || new Date(s.expiresAt).getTime() > now) active += 1;
            else expired += 1;
        }
        const chain: AccountabilityChain = {
            assignmentId: assignment.assignmentId,
            characterId: assignment.characterId,
            prismUserId: assignment.prismUserId,
            prismUserEmail: assignment.prismUserEmail,
            operatorId: assignment.operatorId,
            operatorEmail: assignment.operatorEmail,
            clientId: assignment.clientId,
            executionProfileSegment: assignment.executionProfileSegment,
            workspaceHub: assignment.workspaceHub,
        };
        const verifiedAtMs = assignment.emailVerifiedAt ? new Date(assignment.emailVerifiedAt).getTime() : null;
        const freshDays = verifiedAtMs && !isNaN(verifiedAtMs)
            ? Math.floor((now - verifiedAtMs) / 86_400_000)
            : null;
        return {
            assignment,
            chain,
            scopes: { active, expired, total: scopes.length },
            emailVerification: {
                verified: !!assignment.emailVerifiedAt,
                freshDays,
                provider: assignment.emailVerifiedProvider ?? null,
            },
        };
    }

    /**
     * Phase E3: Export an audit-friendly snapshot of assignments. Suitable
     * input for either JSON download or CSV transformation.
     */
    exportAudit(filter: CharacterAssignmentFilter = {}): Array<{
        assignmentId: string;
        characterId: string;
        operatorId: string;
        operatorEmail: string;
        prismUserEmail: string;
        executionProfileSegment: "individual" | "business";
        state: CharacterAssignmentState;
        assignedAt: string;
        updatedAt: string;
        dispatchCount: number;
        scopesActive: number;
        scopesExpired: number;
        emailVerifiedAt: string | null;
        emailVerifiedProvider: string | null;
    }> {
        const rows = this.store.list(filter);
        const now = Date.now();
        return rows.map((a) => {
            const scopes = a.permissionScopes ?? [];
            let active = 0; let expired = 0;
            for (const s of scopes) {
                if (s.expiresAt === null || new Date(s.expiresAt).getTime() > now) active += 1;
                else expired += 1;
            }
            return {
                assignmentId: a.assignmentId,
                characterId: a.characterId,
                operatorId: a.operatorId,
                operatorEmail: a.operatorEmail,
                prismUserEmail: a.prismUserEmail,
                executionProfileSegment: a.executionProfileSegment,
                state: a.state,
                assignedAt: a.assignedAt,
                updatedAt: a.updatedAt,
                dispatchCount: a.dispatchCount,
                scopesActive: active,
                scopesExpired: expired,
                emailVerifiedAt: a.emailVerifiedAt ?? null,
                emailVerifiedProvider: a.emailVerifiedProvider ?? null,
            };
        });
    }

    private transitionState(
        assignmentId: string,
        nextState: CharacterAssignmentState,
        reason: string,
    ): CharacterAssignment | null {
        const existing = this.store.get(assignmentId);
        if (!existing || existing.state === "revoked") {
            return null;
        }

        const updated: CharacterAssignment = {
            ...existing,
            state: nextState,
            suspendReason: nextState === "suspended" ? reason : undefined,
            revocationReason: nextState === "revoked" ? reason : undefined,
            updatedAt: new Date().toISOString(),
        };

        this.store.save(updated);
        this.emitLifecycleEvent(
            `character_accountability.${nextState}`,
            updated,
            "succeeded",
            {
                previousState: existing.state,
                state: updated.state,
                reason,
            },
        );

        return updated;
    }

    private emitLifecycleEvent(
        operation: string,
        assignment: CharacterAssignment,
        status: "started" | "succeeded" | "failed",
        details: Record<string, unknown>,
    ): void {
        const accountabilityChain: AccountabilityChain = {
            assignmentId: assignment.assignmentId,
            characterId: assignment.characterId,
            prismUserId: assignment.prismUserId,
            prismUserEmail: assignment.prismUserEmail,
            operatorId: assignment.operatorId,
            operatorEmail: assignment.operatorEmail,
            clientId: assignment.clientId,
            executionProfileSegment: assignment.executionProfileSegment,
            workspaceHub: assignment.workspaceHub,
        };

        this.activityBus.emit({
            sessionId: assignment.sessionId,
            layer: "agent",
            operation,
            status,
            details,
            characterId: assignment.characterId,
            prismUserId: assignment.prismUserId,
            prismUserEmail: assignment.prismUserEmail,
            operatorId: assignment.operatorId,
            operatorEmail: assignment.operatorEmail,
            clientId: assignment.clientId,
            executionProfileSegment: assignment.executionProfileSegment,
            assignmentId: assignment.assignmentId,
            accountabilityChain,
        });
    }

    private assertBusinessEmailPolicy(prismUserEmail: string, operatorEmail: string): void {
        const policy = this.options.businessEmailValidation;
        const prismDomain = emailDomain(prismUserEmail);
        const operatorDomain = emailDomain(operatorEmail);

        if (policy?.allowedDomains && policy.allowedDomains.length > 0) {
            const allowed = new Set(policy.allowedDomains.map((entry) => entry.trim().toLowerCase()));
            if (!allowed.has(prismDomain) || !allowed.has(operatorDomain)) {
                throw new Error(
                    `Business profile requires both emails to use allowed domains. prismUserEmail=${prismUserEmail}, operatorEmail=${operatorEmail}`,
                );
            }
        }

        const requireMatchingDomains = policy?.requireMatchingDomains ?? true;
        if (requireMatchingDomains && prismDomain !== operatorDomain) {
            throw new Error(
                `Business profile requires matching email domains. prismUserEmail=${prismUserEmail}, operatorEmail=${operatorEmail}`,
            );
        }
    }
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

function assertValidEmail(value: string, field: string): void {
    const normalized = normalizeEmail(value);
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
        throw new Error(`Invalid ${field}: ${value}`);
    }
}

/**
 * Domains that are clearly placeholders / non-routable / scaffolding artifacts
 * and must never be accepted as the accountability anchor for a Business
 * profile assignment. Matches both the exact domain and any subdomain.
 *
 * This list is intentionally conservative — it blocks the common shapes that
 * appear when an operator types a dummy value to "see if the wizard works":
 *  - prism.local           (PRISM scaffolding placeholder)
 *  - example.com / .org / .net / .test  (RFC 2606 reserved)
 *  - localhost / .localhost            (loopback, not routable)
 *  - invalid               (RFC 6761 reserved)
 *  - test / .test          (RFC 6761 reserved)
 *
 * Operators running an actual business deployment can use any other domain
 * (their corporate domain, an SSO provider domain, etc.).
 */
const PLACEHOLDER_EMAIL_DOMAINS: readonly string[] = [
    "prism.local",
    "example.com",
    "example.org",
    "example.net",
    "example.test",
    "test",
    "test.test",
    "invalid",
    "localhost",
    "localdomain",
    "local",
    "lan",
    "home",
    "internal",
];

export function isPlaceholderEmailDomain(domain: string): boolean {
    const d = domain.trim().toLowerCase();
    if (!d) return true;
    for (const placeholder of PLACEHOLDER_EMAIL_DOMAINS) {
        if (d === placeholder || d.endsWith("." + placeholder)) {
            return true;
        }
    }
    return false;
}

function assertNotPlaceholderEmail(email: string, field: string): void {
    const domain = emailDomain(email);
    if (isPlaceholderEmailDomain(domain)) {
        throw new Error(
            `Business profile rejects placeholder ${field}: "${email}" uses a non-production domain (`
            + `"${domain}"). Use a real, routable domain (e.g. your corporate or SSO provider domain).`,
        );
    }
}

function resolveExecutionProfileSegment(input?: string): "individual" | "business" {
    const normalized = (input ?? "individual").trim().toLowerCase();
    if (normalized === "business" || normalized === "enterprise" || normalized === "corporate") {
        return "business";
    }
    return "individual";
}

function emailDomain(email: string): string {
    const index = email.lastIndexOf("@");
    return index >= 0 ? email.slice(index + 1).toLowerCase() : "";
}