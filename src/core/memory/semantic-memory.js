export class SemanticMemoryIndex {
    documents = new Map();
    onEvent(event) {
        this.documents.set(event.id, {
            id: event.id,
            operation: event.operation,
            layer: event.layer,
            timestamp: event.timestamp,
            text: [event.operation, event.layer, JSON.stringify(event.details ?? {})].join(" ").toLowerCase(),
        });
    }
    query(search, limit = 5) {
        const terms = tokenize(search);
        if (terms.length === 0) {
            return [];
        }
        const scored = [];
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
function tokenize(input) {
    return input
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((token) => token.length > 1);
}
function scoreMatch(text, terms) {
    let score = 0;
    for (const term of terms) {
        if (text.includes(term)) {
            score += 1;
        }
    }
    return score / terms.length;
}
//# sourceMappingURL=semantic-memory.js.map