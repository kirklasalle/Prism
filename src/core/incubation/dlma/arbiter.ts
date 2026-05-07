// DualLensArbiter — coordinates SemanticMemoryIndex + CausalLens via a fused
// Bayesian arbitration. Maintains per-lens weights and updates them via an
// exponential moving average against observed utility feedback.

import { randomUUID } from "node:crypto";
import type { SemanticMemoryIndex } from "../../memory/semantic-memory.js";
import type { ActivityBus } from "../../activity/bus.js";
import { CausalLens } from "./causal-lens.js";
import { fuseLenses } from "./fusion.js";
import type { ArbitrationWeights, ArbiterFeedback, ArbiterQueryResult, LensScore } from "./types.js";

export interface DualLensArbiterOptions {
    initialWeights?: ArbitrationWeights;
    /** EMA smoothing factor in (0, 1]; higher = faster adaptation. */
    alpha?: number;
    sessionId?: string;
}

export class DualLensArbiter {
    private weights: ArbitrationWeights;
    private readonly alpha: number;
    private readonly sessionId: string;
    private readonly causalLens: CausalLens;
    private readonly pending = new Map<string, ArbiterQueryResult>();

    constructor(
        private readonly semantic: SemanticMemoryIndex,
        causalLens: CausalLens,
        private readonly bus: ActivityBus,
        opts: DualLensArbiterOptions = {},
    ) {
        this.weights = { ...(opts.initialWeights ?? { semantic: 0.5, causal: 0.5 }) };
        this.alpha = opts.alpha ?? 0.2;
        this.sessionId = opts.sessionId ?? "incubation";
        this.causalLens = causalLens;
    }

    query(text: string, k: number = 5): ArbiterQueryResult {
        const queryId = randomUUID();
        const semMatches = this.semantic.query(text, k * 2).map((m, i, arr): LensScore => {
            const max = arr[0]?.score ?? 1;
            return {
                id: m.id,
                operation: m.operation,
                layer: m.layer,
                timestamp: m.timestamp,
                score: max > 0 ? m.score / max : 0,
                weight: 1,
            };
        });
        const cauMatches = this.causalLens.score(text, k * 2);

        const fused = fuseLenses({
            semantic: semMatches,
            causal: cauMatches,
            weights: this.weights,
            consequenceLookup: (op) => this.causalLens.consequenceFor(op),
        }, k);

        const result: ArbiterQueryResult = {
            queryId,
            matches: fused,
            weights: { ...this.weights },
            prototype: true,
        };
        this.pending.set(queryId, result);

        this.bus.emit({
            sessionId: this.sessionId,
            layer: "retrieval",
            operation: "incubation.dlma.query",
            status: "succeeded",
            details: {
                queryId,
                k,
                semanticCount: semMatches.length,
                causalCount: cauMatches.length,
                fusedCount: fused.length,
                weights: this.weights,
            },
        });
        return result;
    }

    feedback(input: ArbiterFeedback): ArbitrationWeights {
        const prior = this.pending.get(input.queryId);
        if (!prior) {
            // Unknown query — emit but don't adjust weights.
            this.bus.emit({
                sessionId: this.sessionId,
                layer: "retrieval",
                operation: "incubation.dlma.feedback_unknown",
                status: "failed",
                details: { queryId: input.queryId },
            });
            return { ...this.weights };
        }

        // Reward the lens whose top score matched the chosen lens orientation.
        // observedUtility scales the update; chosenLens biases direction.
        const u = clampUnit(input.observedUtility);
        let target: ArbitrationWeights;
        if (input.chosenLens === "semantic") {
            target = { semantic: 1, causal: 0 };
        } else if (input.chosenLens === "causal") {
            target = { semantic: 0, causal: 1 };
        } else {
            target = { semantic: 0.5, causal: 0.5 };
        }
        const a = this.alpha * u;
        this.weights = {
            semantic: (1 - a) * this.weights.semantic + a * target.semantic,
            causal: (1 - a) * this.weights.causal + a * target.causal,
        };
        // Renormalize so the two weights sum to 1 (keeps fusion stable)
        const total = this.weights.semantic + this.weights.causal || 1;
        this.weights.semantic /= total;
        this.weights.causal /= total;

        this.bus.emit({
            sessionId: this.sessionId,
            layer: "retrieval",
            operation: "incubation.dlma.feedback",
            status: "succeeded",
            details: {
                queryId: input.queryId,
                observedUtility: u,
                chosenLens: input.chosenLens,
                weightsAfter: this.weights,
            },
        });

        // Drop the cached query — feedback is single-use.
        this.pending.delete(input.queryId);
        return { ...this.weights };
    }

    getWeights(): ArbitrationWeights {
        return { ...this.weights };
    }
}

function clampUnit(x: number): number {
    if (!isFinite(x) || x < 0) return 0;
    if (x > 1) return 1;
    return x;
}
