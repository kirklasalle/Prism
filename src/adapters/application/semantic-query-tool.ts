import type { RetrievalMetricsCollector } from "../../core/memory/retrieval-metrics.js";
import type { EpisodicMemory } from "../../core/memory/episodic-memory.js";
import type { SemanticMemoryIndex } from "../../core/memory/semantic-memory.js";
import type { SessionMemoryStore } from "../../core/memory/session-memory.js";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import { randomUUID } from "node:crypto";

type MemoryQueryMode = "semantic" | "episodic_recent" | "session_summary" | "all";

export class MemoryQueryTool implements Tool {
    readonly name: string;
    readonly contract;

    constructor(
        private readonly semanticIndex: SemanticMemoryIndex,
        private readonly episodicMemory: EpisodicMemory,
        private readonly sessionMemory: SessionMemoryStore,
        operationName: string = "memory_query",
        private readonly metricsCollector?: RetrievalMetricsCollector,
    ) {
        this.name = operationName;
        this.contract = {
            version: "1.0.0",
            args: {
                mode: {
                    type: "string",
                    enum: ["semantic", "episodic_recent", "session_summary", "all"],
                },
                query: { type: "string" },
                limit: { type: "number" },
                sessionId: { type: "string" },
            },
        } as const;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const mode = memoryModeArg(request.args.mode, "all");
        const query = stringArg(request.args.query, "");
        const limit = numberArg(request.args.limit, 5);
        const sessionId = stringArg(request.args.sessionId, "");

        if ((mode === "semantic" || mode === "all") && !query.trim()) {
            return {
                ok: false,
                output: { error: "query is required for semantic mode" },
            };
        }

        const start = Date.now();
        const includeSemantic = mode === "semantic" || mode === "all";
        const includeEpisodic = mode === "episodic_recent" || mode === "all";
        const includeSession = mode === "session_summary" || mode === "all";

        const semanticMatches = includeSemantic ? this.semanticIndex.query(query, limit) : [];
        const episodic = includeEpisodic ? this.episodicMemory.snapshot(Math.max(1, limit)) : null;
        const sessionSummary = includeSession && sessionId ? this.sessionMemory.getSessionSummary(sessionId) : null;

        if (this.metricsCollector && includeSemantic && query.trim()) {
            const latencyMs = Date.now() - start;
            this.metricsCollector.recordRetrievalQuery(randomUUID(), query, semanticMatches, latencyMs);
        }

        return {
            ok: true,
            output: {
                mode,
                query,
                limit,
                semanticMatches,
                episodic,
                sessionSummary,
            },
            sideEffects: [
                {
                    type: "api",
                    description: "Read-only retrieval from memory subsystems.",
                },
            ],
        };
    }
}

// Compatibility alias for existing operation name.
export class SemanticQueryTool extends MemoryQueryTool {
    constructor(
        semanticIndex: SemanticMemoryIndex,
        episodicMemory: EpisodicMemory,
        sessionMemory: SessionMemoryStore,
        metricsCollector?: RetrievalMetricsCollector,
    ) {
        super(semanticIndex, episodicMemory, sessionMemory, "semantic_query", metricsCollector);
    }
}

function stringArg(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function numberArg(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.floor(value));
}

function memoryModeArg(value: unknown, fallback: MemoryQueryMode): MemoryQueryMode {
    if (
        value === "semantic" ||
        value === "episodic_recent" ||
        value === "session_summary" ||
        value === "all"
    ) {
        return value;
    }

    return fallback;
}
