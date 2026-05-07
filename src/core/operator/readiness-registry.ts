/**
 * ReadinessRegistry — extensible, registry-based readiness check system for PRISM.
 *
 * Checks are self-registering objects grouped by category.  The registry
 * supports streaming execution (async generator), backward-compatible
 * snapshots, per-check health history, and soft-deprecation.
 */

/* ── Types ── */

export type ReadinessSeverity = "critical" | "warning" | "info";

export interface ReadinessCheck {
    id: string;              // e.g. "core.activity-bus"
    category: string;        // e.g. "core", "llm", "tools"
    label: string;           // human-readable
    severity: ReadinessSeverity;
    deprecated?: boolean;    // soft-delete: kept for audit, skipped in runAll
    version?: string;        // optional evolution tracker
    check(): Promise<{ passed: boolean; detail: string }>;
}

export interface ReadinessCheckResult {
    id: string;
    category: string;
    label: string;
    severity: ReadinessSeverity;
    passed: boolean;
    detail: string;
    durationMs: number;
    checkedAt: string;
}

export interface CategoryResult {
    category: string;
    checks: ReadinessCheckResult[];
    allPassed: boolean;
    criticalPassed: boolean;
}

export interface FullReadinessSnapshot {
    checkedAt: string;
    ready: boolean;                          // all critical checks pass
    totalChecks: number;
    passedChecks: number;
    categories: CategoryResult[];
    // Backward-compat fields
    activeSessionId: string | null;
    selectedProviderId: string | null;
    selectedModel: string | null;
    requirements: Array<{
        id: string;
        label: string;
        passed: boolean;
        detail: string;
    }>;
    recommendations: string[];
}

/* ── Constants ── */

const HISTORY_RING_SIZE = 10;

// Canonical category ordering for deterministic display
const CATEGORY_ORDER = [
    "core", "llm", "tools", "mcp", "agents", "workspace", "memory", "network",
];

/* ── Registry ── */

export class ReadinessRegistry {
    private readonly checks = new Map<string, ReadinessCheck>();
    private readonly history = new Map<string, ReadinessCheckResult[]>();

    /* ── Mutation ── */

    register(check: ReadinessCheck): void {
        this.checks.set(check.id, check);
    }

    unregister(id: string): void {
        this.checks.delete(id);
        this.history.delete(id);
    }

    update(id: string, partial: Partial<Omit<ReadinessCheck, "id">>): void {
        const existing = this.checks.get(id);
        if (!existing) return;
        this.checks.set(id, { ...existing, ...partial, id: existing.id });
    }

    /* ── Query ── */

    has(id: string): boolean {
        return this.checks.has(id);
    }

    get size(): number {
        return this.checks.size;
    }

    listCategories(): string[] {
        const cats = new Set<string>();
        for (const c of this.checks.values()) cats.add(c.category);
        return [...cats].sort((a, b) => {
            const ai = CATEGORY_ORDER.indexOf(a);
            const bi = CATEGORY_ORDER.indexOf(b);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
    }

    listByCategory(category: string): ReadinessCheck[] {
        const result: ReadinessCheck[] = [];
        for (const c of this.checks.values()) {
            if (c.category === category) result.push(c);
        }
        return result;
    }

    getHistory(id: string): ReadinessCheckResult[] {
        return this.history.get(id) ?? [];
    }

    /* ── Execution ── */

    /**
     * Run all non-deprecated checks, yielding one CategoryResult per category.
     * Categories are yielded in canonical order; checks run sequentially within
     * a category so that transient resource contention is minimised.
     */
    async *runAll(): AsyncGenerator<CategoryResult> {
        for (const category of this.listCategories()) {
            const active = this.listByCategory(category).filter((c) => !c.deprecated);
            if (active.length === 0) continue;

            const results: ReadinessCheckResult[] = [];
            for (const check of active) {
                const start = Date.now();
                let passed = false;
                let detail = "";
                try {
                    const outcome = await check.check();
                    passed = outcome.passed;
                    detail = outcome.detail;
                } catch (err: unknown) {
                    detail = `Check threw: ${err instanceof Error ? err.message : String(err)}`;
                }
                const result: ReadinessCheckResult = {
                    id: check.id,
                    category: check.category,
                    label: check.label,
                    severity: check.severity,
                    passed,
                    detail,
                    durationMs: Date.now() - start,
                    checkedAt: new Date().toISOString(),
                };
                results.push(result);
                this.pushHistory(check.id, result);
            }

            yield {
                category,
                checks: results,
                allPassed: results.every((r) => r.passed),
                criticalPassed: results.filter((r) => r.severity === "critical").every((r) => r.passed),
            };
        }
    }

    /**
     * Run all checks and return a single snapshot object — backward compatible
     * with DashboardReadinessSnapshot.
     *
     * `sessionContext` supplies the session-specific fields that the old snapshot
     * included (activeSessionId, selectedProviderId, selectedModel).  Callers
     * that don't care about these can omit the argument.
     */
    async snapshot(sessionContext?: {
        activeSessionId: string | null;
        selectedProviderId: string | null;
        selectedModel: string | null;
    }): Promise<FullReadinessSnapshot> {
        const categories: CategoryResult[] = [];
        for await (const cat of this.runAll()) {
            categories.push(cat);
        }

        const allResults = categories.flatMap((c) => c.checks);
        const criticalPassed = allResults
            .filter((r) => r.severity === "critical")
            .every((r) => r.passed);

        const recommendations: string[] = [];
        for (const r of allResults) {
            if (!r.passed && r.severity === "critical") {
                recommendations.push(r.detail);
            }
        }

        return {
            checkedAt: new Date().toISOString(),
            ready: criticalPassed,
            totalChecks: allResults.length,
            passedChecks: allResults.filter((r) => r.passed).length,
            categories,
            activeSessionId: sessionContext?.activeSessionId ?? null,
            selectedProviderId: sessionContext?.selectedProviderId ?? null,
            selectedModel: sessionContext?.selectedModel ?? null,
            requirements: allResults.map((r) => ({
                id: r.id,
                label: r.label,
                passed: r.passed,
                detail: r.detail,
            })),
            recommendations,
        };
    }

    /* ── Internal ── */

    private pushHistory(id: string, result: ReadinessCheckResult): void {
        let ring = this.history.get(id);
        if (!ring) {
            ring = [];
            this.history.set(id, ring);
        }
        ring.push(result);
        if (ring.length > HISTORY_RING_SIZE) ring.shift();
    }
}
