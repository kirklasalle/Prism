import type { ActivityEvent, ActivitySubscriber } from "../activity/types.js";

interface IndexedEvent {
    id: string;
    operation: string;
    layer: string;
    text: string;
    timestamp: string;
}

export interface SemanticMatch {
    id: string;
    operation: string;
    layer: string;
    timestamp: string;
    score: number;
}

export class SemanticMemoryIndex implements ActivitySubscriber {
    private readonly documents = new Map<string, IndexedEvent>();

    onEvent(event: ActivityEvent): void {
        this.documents.set(event.id, {
            id: event.id,
            operation: event.operation,
            layer: event.layer,
            timestamp: event.timestamp,
            text: [event.operation, event.layer, JSON.stringify(event.details ?? {})].join(" ").toLowerCase(),
        });
    }

    query(search: string, limit: number = 5): SemanticMatch[] {
        const terms = tokenize(search);
        if (terms.length === 0) {
            return [];
        }

        const scored: SemanticMatch[] = [];
        for (const doc of this.documents.values()) {
            const score = scoreMatch(doc.text, terms);
            if (score <= 0) {
                continue;
            }

            scored.push({
                id: doc.id,
                operation: doc.operation,
                layer: doc.layer,
                timestamp: doc.timestamp,
                score,
            });
        }

        return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
    }
}

function tokenize(input: string): string[] {
    return input
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((token) => token.length > 1);
}

function scoreMatch(text: string, terms: string[]): number {
    let score = 0;
    for (const term of terms) {
        if (text.includes(term)) {
            score += 1;
        }
    }
    return score / terms.length;
}
