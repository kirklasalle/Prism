import { randomUUID } from "node:crypto";
import type { ActivityBus } from "../activity/bus.js";
import type { AccountabilityChain } from "../activity/types.js";
import {
    CharacterAccountabilityStore,
    type CharacterAssignment,
    type CharacterAssignmentFilter,
    type CharacterAssignmentState,
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