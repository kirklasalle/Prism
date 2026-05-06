// Causal lens — derives a per-event score from EpisodicMemory by walking the
// recent event stream and computing a consequence profile (succeeded/failed/denied).
// Trust = (succeeded - failed - 2*denied) / total, clamped to [-1, 1].

import type { EpisodicMemory } from "../../memory/episodic-memory.js";
import type { ActivityEvent } from "../../activity/types.js";
import type { ConsequenceProfile, LensScore } from "./types.js";

export class CausalLens {
    constructor(
        private readonly episodic: EpisodicMemory,
        private readonly windowSize: number = 200,
    ) { }

    /**
     * Score recent events against a free-text query. Score combines:
     *  - lexical overlap (operation/layer contains query terms)
     *  - consequence trust for the operation in the recent window
     */
    score(query: string, limit: number = 10): LensScore[] {
        const events = this.episodic.recent(this.windowSize);
        const terms = tokenize(query);
        const profilesByOp = buildConsequenceMap(events);

        const out: LensScore[] = [];
        for (const ev of events) {
            const overlap = lexicalOverlap(ev, terms);
            if (overlap === 0) continue;
            const profile = profilesByOp.get(ev.operation) ?? emptyProfile();
            // Combine: lexical overlap (0..1) * (1 + trust)/2 — trust shifts to [0,1].
            const trustGate = (1 + profile.trust) / 2;
            const raw = overlap * trustGate;
            out.push({
                id: ev.id,
                operation: ev.operation,
                layer: ev.layer,
                timestamp: ev.timestamp,
                score: raw,
                weight: 1,
            });
        }

        // Normalize within lens: divide by max so top score is 1
        const max = out.reduce((m, x) => Math.max(m, x.score), 0);
        if (max > 0) {
            for (const s of out) s.score = s.score / max;
        }

        return out
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, limit));
    }

    /** Public helper exposed for the arbiter / dashboard introspection. */
    consequenceFor(operation: string): ConsequenceProfile {
        const events = this.episodic.recent(this.windowSize);
        const map = buildConsequenceMap(events);
        return map.get(operation) ?? emptyProfile();
    }
}

function emptyProfile(): ConsequenceProfile {
    return { succeeded: 0, failed: 0, denied: 0, trust: 0 };
}

function buildConsequenceMap(events: ActivityEvent[]): Map<string, ConsequenceProfile> {
    const map = new Map<string, ConsequenceProfile>();
    for (const ev of events) {
        const cur = map.get(ev.operation) ?? emptyProfile();
        if (ev.policyDecision === "deny") cur.denied++;
        else if (ev.status === "succeeded") cur.succeeded++;
        else if (ev.status === "failed") cur.failed++;
        map.set(ev.operation, cur);
    }
    for (const profile of map.values()) {
        const total = profile.succeeded + profile.failed + profile.denied;
        if (total === 0) {
            profile.trust = 0;
        } else {
            const raw = (profile.succeeded - profile.failed - 2 * profile.denied) / total;
            profile.trust = Math.max(-1, Math.min(1, raw));
        }
    }
    return map;
}

function tokenize(input: string): string[] {
    return input
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length > 1);
}

function lexicalOverlap(ev: ActivityEvent, terms: string[]): number {
    if (terms.length === 0) return 0;
    const text = [ev.operation, ev.layer, JSON.stringify(ev.details ?? {})]
        .join(" ")
        .toLowerCase();
    let hits = 0;
    for (const t of terms) if (text.includes(t)) hits++;
    return hits / terms.length;
}
