// Dual-Lens Memory Arbitration (DLMA) — Phase H prototype.
// Types for semantic + causal lens scoring, fused matches, and consequence profiles.

export interface LensScore {
    id: string;
    operation: string;
    layer: string;
    timestamp: string;
    score: number;        // [0, 1] — normalized within the lens
    weight: number;       // raw source weight contribution before fusion
}

export interface ConsequenceProfile {
    succeeded: number;
    failed: number;
    denied: number;
    /** Net trust score in [-1, 1] derived from outcome history. */
    trust: number;
}

export interface FusedMatch {
    id: string;
    operation: string;
    layer: string;
    timestamp: string;
    semanticScore: number;
    causalScore: number;
    fusedScore: number;
    confidence: number;            // [0, 1] — agreement between lenses
    consequence: ConsequenceProfile;
    explanation: string;
}

export interface ArbitrationWeights {
    semantic: number;
    causal: number;
}

export interface ArbiterFeedback {
    queryId: string;
    observedUtility: number;       // [0, 1] — how useful the top-k turned out to be
    chosenLens: "semantic" | "causal" | "fused";
}

export interface ArbiterQueryResult {
    queryId: string;
    matches: FusedMatch[];
    weights: ArbitrationWeights;
    prototype: true;
}
