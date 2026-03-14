export class PolicyEngine {
    evaluate(context) {
        const reasons = [];
        if (context.risk === "high") {
            if (context.isWhitelisted) {
                reasons.push("High-risk operation allowed by whitelist policy.");
                return { tier: "tier3_approval", decision: "allow", reasons };
            }
            reasons.push("High-risk operation requires explicit approval.");
            return { tier: "tier3_approval", decision: "require_approval", reasons };
        }
        if (context.risk === "medium") {
            if (context.mutatesState && !context.rollbackPlan) {
                reasons.push("State mutation denied because rollback plan is missing.");
                return { tier: "tier2_conditional", decision: "deny", reasons };
            }
            reasons.push("Conditional operation allowed with governance checks.");
            return { tier: "tier2_conditional", decision: "allow", reasons };
        }
        reasons.push("Low-risk operation allowed as autonomous execution.");
        return { tier: "tier1_autonomous", decision: "allow", reasons };
    }
}
//# sourceMappingURL=engine.js.map