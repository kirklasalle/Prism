/**
 * Cognitive Economics — Dynamic Budget Governor
 *
 * Implements departmental and user-level token budget enforcement with:
 * - Soft-cap throttling (75% - 99%): Downshifts LLM tier requests from Tier 3 to Tier 1/2
 * - Hard-cap gating (>= 100%): Suspends autonomous execution and routes to Approval Queue
 * - Real-time cost forecasting and departmental quota tracking
 */

export type BudgetStatus = "normal" | "throttled" | "capped";

export interface DepartmentBudgetConfig {
    departmentId: string;
    monthlyBudgetUsd: number;
    softCapPercent: number; // e.g. 80 (%)
    hardCapPercent: number; // e.g. 100 (%)
    autoDownshiftTierOnSoftCap: boolean;
}

export interface BudgetEvaluationResult {
    status: BudgetStatus;
    allocatedBudgetUsd: number;
    currentSpendUsd: number;
    remainingUsd: number;
    utilizationPercent: number;
    recommendedTierCap: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
    requiresApproval: boolean;
    reason: string;
}

export class BudgetGovernor {
    private readonly departments = new Map<string, DepartmentBudgetConfig>();
    private readonly departmentSpend = new Map<string, number>();

    constructor(defaultDepartmentConfig?: DepartmentBudgetConfig) {
        if (defaultDepartmentConfig) {
            this.setDepartmentBudget(defaultDepartmentConfig);
        }
    }

    setDepartmentBudget(config: DepartmentBudgetConfig): void {
        this.departments.set(config.departmentId, config);
        if (!this.departmentSpend.has(config.departmentId)) {
            this.departmentSpend.set(config.departmentId, 0);
        }
    }

    recordSpend(departmentId: string, amountUsd: number): void {
        const current = this.departmentSpend.get(departmentId) ?? 0;
        this.departmentSpend.set(departmentId, Math.max(0, current + amountUsd));
    }

    evaluate(departmentId: string, estimatedCostUsd = 0): BudgetEvaluationResult {
        const config = this.departments.get(departmentId) ?? {
            departmentId,
            monthlyBudgetUsd: 100.0, // default $100 budget
            softCapPercent: 80,
            hardCapPercent: 100,
            autoDownshiftTierOnSoftCap: true,
        };

        const currentSpend = this.departmentSpend.get(departmentId) ?? 0;
        const totalProjected = currentSpend + estimatedCostUsd;
        const utilization = config.monthlyBudgetUsd > 0 ? (totalProjected / config.monthlyBudgetUsd) * 100 : 0;
        const remaining = Math.max(0, config.monthlyBudgetUsd - totalProjected);

        if (utilization >= config.hardCapPercent) {
            return {
                status: "capped",
                allocatedBudgetUsd: config.monthlyBudgetUsd,
                currentSpendUsd: currentSpend,
                remainingUsd: 0,
                utilizationPercent: Math.round(utilization * 10) / 10,
                recommendedTierCap: "tier3_approval",
                requiresApproval: true,
                reason: `Budget Hard Cap reached (${utilization.toFixed(1)}%). Requires Operator Approval.`,
            };
        }

        if (utilization >= config.softCapPercent) {
            return {
                status: "throttled",
                allocatedBudgetUsd: config.monthlyBudgetUsd,
                currentSpendUsd: currentSpend,
                remainingUsd: Math.round(remaining * 100) / 100,
                utilizationPercent: Math.round(utilization * 10) / 10,
                recommendedTierCap: config.autoDownshiftTierOnSoftCap ? "tier1_autonomous" : "tier2_conditional",
                requiresApproval: false,
                reason: `Budget Soft Cap reached (${utilization.toFixed(1)}%). Throttling to Tier 1/2 models.`,
            };
        }

        return {
            status: "normal",
            allocatedBudgetUsd: config.monthlyBudgetUsd,
            currentSpendUsd: currentSpend,
            remainingUsd: Math.round(remaining * 100) / 100,
            utilizationPercent: Math.round(utilization * 10) / 10,
            recommendedTierCap: "tier1_autonomous",
            requiresApproval: false,
            reason: `Budget nominal (${utilization.toFixed(1)}% utilized).`,
        };
    }
}
