import { randomUUID } from "node:crypto";
import type { TaskRole } from "../operator/model-capability-matrix.js";
import type {
    SubAgentDefinition,
    SubAgentRequest,
    SubAgentResult,
    LlmDelegate,
    AgentModelOverride,
} from "./agent-types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Built-in default agents (one per TaskRole)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_AGENTS: SubAgentDefinition[] = [
    {
        agentId: "classifier",
        role: "classification",
        description: "Classifies, labels, and categorises inputs.",
    },
    {
        agentId: "chat",
        role: "chat",
        description: "General-purpose conversational agent.",
    },
    {
        agentId: "summarizer",
        role: "summarization",
        description: "Condenses documents, conversation histories, and activity logs.",
    },
    {
        agentId: "planner",
        role: "tool-selection",
        description: "Plans tool use, decomposes goals into concrete steps.",
        systemContext:
            "You are a planning agent. Break the goal into ordered, concrete steps. " +
            "For each step state the tool or specialist needed and the expected output.",
    },
    {
        agentId: "coder",
        role: "code-generation",
        description: "Generates, reviews, debugs, and explains code.",
        systemContext:
            "You are a code-generation agent. Produce clean, idiomatic code. " +
            "Include brief inline comments only where the logic is non-obvious.",
    },
    {
        agentId: "indexer",
        role: "memory-indexing",
        description: "Extracts and structures knowledge for memory indexing.",
    },
    {
        agentId: "speaker",
        role: "speech-synthesis",
        description: "Converts text to natural-sounding speech audio.",
        systemContext:
            "You are a text-to-speech agent. Convert the provided text into speech output. " +
            "Preserve tone, emphasis, and pacing appropriate to the content.",
    },
    {
        agentId: "listener",
        role: "speech-recognition",
        description: "Transcribes spoken audio into accurate text.",
        systemContext:
            "You are a speech-to-text agent. Transcribe the audio input accurately, " +
            "including punctuation, speaker identification, and timestamps when possible.",
    },
    {
        agentId: "realtime",
        role: "realtime-voice",
        description: "Handles low-latency, bidirectional voice conversations.",
        systemContext:
            "You are a real-time voice conversation agent. Respond naturally with low latency. " +
            "Maintain conversational context and handle interruptions gracefully.",
    },
    {
        agentId: "image-analyst",
        role: "image-analysis",
        description: "Analyzes images for content, objects, text, and context.",
        systemContext:
            "You are an image analysis agent. Describe image contents, identify objects, " +
            "extract text (OCR), and provide contextual interpretation.",
    },
    {
        agentId: "illustrator",
        role: "image-creation",
        description: "Generates images from text descriptions and prompts.",
        systemContext:
            "You are an image generation agent. Create images that accurately match " +
            "the provided description, style, and compositional requirements.",
    },
    {
        agentId: "video-analyst",
        role: "video-analysis",
        description: "Analyzes video content for scenes, actions, and context.",
        systemContext:
            "You are a video analysis agent. Describe scenes, identify actions, " +
            "extract key frames, and provide temporal context from video input.",
    },
    {
        agentId: "video-creator",
        role: "video-creation",
        description: "Generates video content from text or image prompts.",
        systemContext:
            "You are a video generation agent. Produce video content that matches " +
            "the provided description, storyboard, or reference materials.",
    },
    {
        agentId: "audio-producer",
        role: "audio-production",
        description: "Produces music, sound effects, and audio content.",
        systemContext:
            "You are an audio production agent. Generate music, sound effects, " +
            "instrument tracks, and voice synthesis according to the provided specifications.",
    },
    {
        agentId: "writer",
        role: "document-writing",
        description: "Writes long-form documents, reports, and structured content.",
        systemContext:
            "You are a document writing agent. Produce well-structured, professional documents " +
            "including reports, briefs, proposals, and technical documentation.",
    },
    {
        agentId: "researcher",
        role: "research",
        description: "Conducts factual, legal, and geographical research.",
        systemContext:
            "You are a research agent. Conduct thorough factual research including U.S. legal research, " +
            "geographical analysis, and domain-specific investigation. Cite sources and flag uncertainty.",
    },
];

// ──────────────────────────────────────────────────────────────────────────────
// AgentPool
// ──────────────────────────────────────────────────────────────────────────────

export class AgentPool {
    private readonly agents = new Map<string, SubAgentDefinition>();
    private llmDelegate: LlmDelegate | null;
    private onDispatch?: (agentId: string) => void;
    private onDispatchComplete?: (agentId: string, result: SubAgentResult) => void;

    constructor(delegate: LlmDelegate | null = null) {
        this.llmDelegate = delegate;
        for (const agent of DEFAULT_AGENTS) {
            this.agents.set(agent.agentId, agent);
        }
    }

    /** Provide or replace the LLM delegate. Call this after construction if
     *  the delegate is not available at construction time. */
    setLlmDelegate(delegate: LlmDelegate): void {
        this.llmDelegate = delegate;
    }

    /** Set callbacks called before/after dispatch for lifecycle and telemetry hooks. */
    setDispatchHooks(
        onDispatch: (agentId: string) => void,
        onDispatchComplete: (agentId: string, result: SubAgentResult) => void,
    ): void {
        this.onDispatch = onDispatch;
        this.onDispatchComplete = onDispatchComplete;
    }

    /** Register a custom agent. Overwrites any existing agent with the same id. */
    register(agent: SubAgentDefinition): void {
        this.agents.set(agent.agentId, agent);
    }

    /** Remove a registered agent by id. */
    unregister(agentId: string): boolean {
        return this.agents.delete(agentId);
    }

    /** Return all registered agent definitions. */
    list(): SubAgentDefinition[] {
        return [...this.agents.values()];
    }

    /** Return the first agent matching a given role, or undefined. */
    findByRole(role: TaskRole): SubAgentDefinition | undefined {
        for (const agent of this.agents.values()) {
            if (agent.role === role) return agent;
        }
        return undefined;
    }

    /** Return the agent with the given id, or undefined. */
    findById(agentId: string): SubAgentDefinition | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Dispatch a request to the best matching agent and return a result.
     *
     * Resolution order:
     *   1. `request.agentId` (explicit target)
     *   2. First agent whose role matches `request.role`
     *   3. "chat" fallback
     */
    async dispatch(request: SubAgentRequest): Promise<SubAgentResult> {
        const traceId = randomUUID();
        const start = Date.now();

        // ── Resolve target agent ─────────────────────────────────────────────
        let agent: SubAgentDefinition | undefined;

        if (request.agentId) {
            agent = this.agents.get(request.agentId);
            if (!agent) {
                return failure(traceId, start, request.agentId, `Agent not found: ${request.agentId}`);
            }
        } else if (request.role) {
            agent = this.findByRole(request.role) ?? this.agents.get("chat");
        } else {
            agent = this.agents.get("chat");
        }

        if (!agent) {
            return failure(traceId, start, "unknown", "No suitable agent found in pool");
        }

        // ── Guard: LLM delegate must be configured ───────────────────────────
        if (!this.llmDelegate) {
            return failure(traceId, start, agent.agentId, "AgentPool has no LLM delegate configured");
        }

        // ── Build prompt and generate ────────────────────────────────────────
        const systemPrompt = buildSystemPrompt(agent, request.context);

        this.onDispatch?.(agent.agentId);

        try {
            const result = await this.llmDelegate.generateForRole(agent.role, {
                message: request.goal,
                conversation: [],
                systemPrompt,
            }, agent.agentId);

            if (!result) {
                const fail = failure(traceId, start, agent.agentId, `No model available for role: ${agent.role}`);
                this.onDispatchComplete?.(agent.agentId, fail);
                return fail;
            }

            const success: SubAgentResult = {
                ok: true,
                content: result.content,
                agentId: agent.agentId,
                model: result.model,
                tier: result.routing.profile.tier,
                durationMs: Date.now() - start,
                traceId,
                routing: result.routing,
            };
            this.onDispatchComplete?.(agent.agentId, success);
            return success;
        } catch (err: unknown) {
            const fail = failure(traceId, start, agent.agentId, String(err));
            this.onDispatchComplete?.(agent.agentId, fail);
            return fail;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(agent: SubAgentDefinition, extraContext?: string): string {
    const parts: string[] = [];
    if (agent.systemContext) parts.push(agent.systemContext);
    if (extraContext?.trim()) parts.push(`Context:\n${extraContext.trim()}`);
    return parts.join("\n\n");
}

function failure(
    traceId: string,
    startMs: number,
    agentId: string,
    error: string,
): SubAgentResult {
    return {
        ok: false,
        content: "",
        agentId,
        model: "",
        tier: 0,
        durationMs: Date.now() - startMs,
        traceId,
        error,
    };
}
