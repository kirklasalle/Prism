/**
 * RiskOverrideStore — operator-managed risk-tier overrides for tools.
 *
 * Lookups consult overrides first, falling back to the static classifier
 * (e.g. GovernanceHooksAdapter.classifyToolTier). Each override carries an
 * audit trail (who set it, when, why) and an optional expiry.
 *
 * Persistence: a single JSON file under prism-output/ for now. Multi-tenant
 * deployments should promote this to ChatSessionStore-style SQLite (Phase F).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityBus } from "../activity/bus.js";

export type RiskTier = "tier1" | "tier2" | "tier3";

export interface RiskOverride {
    toolId: string;
    overrideTier: RiskTier;
    reason: string;
    setBy: string;
    setAt: string;
    expiresAt: string | null;
}

interface PersistedFile {
    version: 1;
    overrides: RiskOverride[];
}

export class RiskOverrideStore {
    private overrides = new Map<string, RiskOverride>();

    constructor(
        private readonly filePath: string,
        private readonly activityBus?: ActivityBus,
    ) {
        this.load();
    }

    private load(): void {
        if (!existsSync(this.filePath)) return;
        try {
            const raw = readFileSync(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as PersistedFile;
            for (const override of parsed.overrides ?? []) {
                this.overrides.set(override.toolId, override);
            }
        } catch {
            // corrupted file — treat as empty
            this.overrides.clear();
        }
    }

    private persist(): void {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const payload: PersistedFile = {
            version: 1,
            overrides: Array.from(this.overrides.values()),
        };
        writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
    }

    /**
     * Sweep expired overrides. Called opportunistically at the start of read
     * paths so we don't need a background timer.
     */
    private sweepExpired(): RiskOverride[] {
        const now = Date.now();
        const expired: RiskOverride[] = [];
        for (const [toolId, override] of this.overrides) {
            if (override.expiresAt !== null && new Date(override.expiresAt).getTime() <= now) {
                expired.push(override);
                this.overrides.delete(toolId);
            }
        }
        if (expired.length > 0) {
            this.persist();
            for (const override of expired) {
                this.activityBus?.emit({
                    sessionId: "risk-override-store",
                    layer: "governance",
                    operation: "risk.override.expired",
                    status: "succeeded",
                    details: {
                        toolId: override.toolId,
                        overrideTier: override.overrideTier,
                        setBy: override.setBy,
                    },
                });
            }
        }
        return expired;
    }

    get(toolId: string): RiskOverride | null {
        this.sweepExpired();
        return this.overrides.get(toolId) ?? null;
    }

    list(): RiskOverride[] {
        this.sweepExpired();
        return Array.from(this.overrides.values());
    }

    set(input: Omit<RiskOverride, "setAt">): RiskOverride {
        if (!input.toolId) throw new Error("toolId required");
        if (!input.reason || input.reason.trim().length === 0) {
            throw new Error("reason required");
        }
        if (input.overrideTier !== "tier1" && input.overrideTier !== "tier2" && input.overrideTier !== "tier3") {
            throw new Error(`invalid overrideTier: ${input.overrideTier}`);
        }
        if (input.expiresAt !== null) {
            const t = new Date(input.expiresAt).getTime();
            if (isNaN(t)) throw new Error(`invalid expiresAt: ${input.expiresAt}`);
            if (t <= Date.now()) throw new Error("expiresAt must be in the future");
        }
        const override: RiskOverride = {
            toolId: input.toolId,
            overrideTier: input.overrideTier,
            reason: input.reason.trim(),
            setBy: input.setBy,
            setAt: new Date().toISOString(),
            expiresAt: input.expiresAt,
        };
        this.overrides.set(override.toolId, override);
        this.persist();
        this.activityBus?.emit({
            sessionId: "risk-override-store",
            layer: "governance",
            operation: "risk.override.set",
            status: "succeeded",
            details: {
                toolId: override.toolId,
                overrideTier: override.overrideTier,
                setBy: override.setBy,
                reason: override.reason,
                expiresAt: override.expiresAt,
            },
        });
        return override;
    }

    clear(toolId: string, clearedBy: string): RiskOverride | null {
        const existing = this.overrides.get(toolId);
        if (!existing) return null;
        this.overrides.delete(toolId);
        this.persist();
        this.activityBus?.emit({
            sessionId: "risk-override-store",
            layer: "governance",
            operation: "risk.override.cleared",
            status: "succeeded",
            details: {
                toolId,
                previousTier: existing.overrideTier,
                clearedBy,
            },
        });
        return existing;
    }

    /**
     * Resolve the effective tier for a tool, consulting overrides first
     * before falling back to the supplied classifier.
     */
    resolveTier(toolId: string, classifierTier: RiskTier): { effectiveTier: RiskTier; override: RiskOverride | null } {
        const override = this.get(toolId);
        return {
            effectiveTier: override ? override.overrideTier : classifierTier,
            override,
        };
    }
}
