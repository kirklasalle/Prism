import type { TaskRole } from "../operator/model-capability-matrix.js";
import type { SubAgentRequest, SubAgentResult, LlmDelegate } from "./agent-types.js";
import type { AgentPool } from "./agent-pool.js";

// ──────────────────────────────────────────────────────────────────────────────
// Intent classification result
// ──────────────────────────────────────────────────────────────────────────────

export interface IntentClassification {
    role: TaskRole;
    confidence: number;
    reasoning: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// AgentRouter — classifier-first chat routing
// ──────────────────────────────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are an intent classifier. Classify the user message into exactly one of these roles:
- "chat" — general conversation, questions, chitchat
- "code-generation" — writing, reviewing, debugging, or explaining code
- "summarization" — condensing text, summarizing documents or conversations
- "tool-selection" — planning tasks, selecting tools, decomposing goals
- "classification" — labeling, categorizing, or sorting items
- "memory-indexing" — extracting knowledge, structuring information for storage

Respond with ONLY valid JSON: {"role": "<role>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}`;

export class AgentRouter {
    private readonly pool: AgentPool;
    private readonly llm: LlmDelegate;
    /** Minimum confidence to route to a specialist; below this, route to chat. */
    private readonly confidenceThreshold: number;

    constructor(pool: AgentPool, llm: LlmDelegate, confidenceThreshold = 0.6) {
        this.pool = pool;
        this.llm = llm;
        this.confidenceThreshold = confidenceThreshold;
    }

    /**
     * Classify the user message via the classifier agent and dispatch to the
     * appropriate specialist agent. Falls back to the chat agent on error or
     * low confidence.
     */
    async routeAndDispatch(
        message: string,
        context?: string,
    ): Promise<{ classification: IntentClassification; result: SubAgentResult }> {
        const classification = await this.classify(message);

        const request: SubAgentRequest = {
            goal: message,
            role: classification.role,
            context,
        };

        const result = await this.pool.dispatch(request);
        return { classification, result };
    }

    /** Classify a message using the classifier agent. */
    async classify(message: string): Promise<IntentClassification> {
        try {
            const response = await this.llm.generateForRole(
                "classification",
                {
                    message: `Classify this message:\n\n${message}`,
                    conversation: [],
                    systemPrompt: CLASSIFY_PROMPT,
                },
                "classifier",
            );

            if (!response) {
                return fallbackClassification();
            }

            const parsed = parseClassification(response.content);
            if (!parsed || parsed.confidence < this.confidenceThreshold) {
                return fallbackClassification();
            }
            return parsed;
        } catch {
            return fallbackClassification();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fallbackClassification(): IntentClassification {
    return { role: "chat", confidence: 1.0, reasoning: "Fallback to general chat" };
}

const VALID_ROLES: Set<string> = new Set([
    "chat",
    "code-generation",
    "summarization",
    "tool-selection",
    "classification",
    "memory-indexing",
]);

function parseClassification(content: string): IntentClassification | null {
    try {
        // Extract JSON from potential markdown code fences
        const jsonMatch = content.match(/\{[^}]+\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        if (
            typeof parsed.role === "string" &&
            VALID_ROLES.has(parsed.role) &&
            typeof parsed.confidence === "number" &&
            parsed.confidence >= 0 &&
            parsed.confidence <= 1
        ) {
            return {
                role: parsed.role as TaskRole,
                confidence: parsed.confidence,
                reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
            };
        }
        return null;
    } catch {
        return null;
    }
}
