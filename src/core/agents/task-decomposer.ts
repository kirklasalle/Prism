/**
 * Task Decomposer — breaks a complex goal into an ordered list of sub-agent
 * requests using the "planner" agent (tool-selection role, T3+ model).
 *
 * The decomposer asks the planner to output a structured JSON plan and then
 * parses it into a `DecomposedPlan` that the Orchestrator (P3) can execute
 * sequentially or in parallel groups.
 */
import type { AgentPool } from "./agent-pool.js";
import type { SubAgentRequest } from "./agent-types.js";
import type { TaskRole } from "../operator/model-capability-matrix.js";
import type { OperationRisk } from "../policy/types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

/** A single step in a decomposed plan. */
export interface PlanStep {
    /** Stable identifier within this plan (e.g. "step-1"). */
    id: string;
    /** Natural-language description of what this step does. */
    description: string;
    /** Which sub-agent role is best for this step. */
    role: TaskRole;
    /** The goal/prompt to send to the agent. */
    goal: string;
    /** IDs of steps that must complete before this one can start. */
    dependsOn: string[];
    /** Risk level for governance. */
    risk: OperationRisk;
    /** Optional human-readable note about expected output. */
    expectedOutput?: string;
}

/** A fully parsed decomposition of a complex goal. */
export interface DecomposedPlan {
    /** Original goal that was decomposed. */
    goal: string;
    /** Ordered steps (topological order is maintained). */
    steps: PlanStep[];
    /** Raw planner output (for debugging / audit trail). */
    rawPlannerOutput: string;
    /** Whether the decomposition succeeded. */
    ok: boolean;
    error?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// TaskDecomposer
// ──────────────────────────────────────────────────────────────────────────────

const DECOMPOSER_SYSTEM_CONTEXT = `You are a task decomposition engine.
Given a goal, break it into concrete, ordered sub-tasks that specialist agents can execute.

Respond with a JSON object matching this schema exactly — no prose, no markdown fences:
{
  "steps": [
    {
      "id": "step-1",
      "description": "Short description",
      "role": "<one of: classification|chat|summarization|tool-selection|code-generation|memory-indexing>",
      "goal": "The exact prompt to send to the agent",
      "dependsOn": [],
      "risk": "<low|medium|high>",
      "expectedOutput": "What good output looks like (optional)"
    }
  ]
}

Rules:
- Use 1-6 steps. Prefer fewer.
- Only use roles from the allowed list above.
- dependsOn lists the ids of steps that must finish before this step starts.
- Independent steps that can run in parallel should have the same dependsOn array.
- Output valid JSON with no trailing commas.`;

export class TaskDecomposer {
    constructor(private readonly agentPool: AgentPool) {}

    /**
     * Decompose a complex goal into a list of ordered sub-agent steps.
     * Uses the planner agent (tool-selection role).
     */
    async decompose(goal: string, context?: string): Promise<DecomposedPlan> {
        const plannerResult = await this.agentPool.dispatch({
            goal,
            agentId: "planner",
            context: [context, DECOMPOSER_SYSTEM_CONTEXT].filter(Boolean).join("\n\n"),
        });

        if (!plannerResult.ok || !plannerResult.content) {
            return {
                goal,
                steps: [],
                rawPlannerOutput: plannerResult.content,
                ok: false,
                error: plannerResult.error ?? "Planner returned no content",
            };
        }

        const parsed = parsePlannerOutput(plannerResult.content);
        if (!parsed.ok) {
            return {
                goal,
                steps: [],
                rawPlannerOutput: plannerResult.content,
                ok: false,
                error: parsed.error,
            };
        }

        return {
            goal,
            steps: parsed.steps,
            rawPlannerOutput: plannerResult.content,
            ok: true,
        };
    }

    /**
     * Convert a DecomposedPlan into a flat list of SubAgentRequests in
     * topological execution order (same-depth steps are adjacent).
     * This is used by the sequential executor in P3.
     */
    static toSubAgentRequests(plan: DecomposedPlan): SubAgentRequest[] {
        return plan.steps.map((step) => ({
            goal: step.goal,
            role: step.role,
            risk: step.risk,
        }));
    }

    /**
     * Group plan steps into parallel batches by dependency analysis.
     * Steps with no unresolved dependencies form a batch and can run together.
     */
    static toParallelBatches(plan: DecomposedPlan): SubAgentRequest[][] {
        const remaining = [...plan.steps];
        const completed = new Set<string>();
        const batches: SubAgentRequest[][] = [];

        while (remaining.length > 0) {
            const ready = remaining.filter((s) =>
                s.dependsOn.every((dep) => completed.has(dep)),
            );

            if (ready.length === 0) {
                // Circular or unresolvable dependency — add rest as single batch
                batches.push(
                    remaining.map((s) => ({ goal: s.goal, role: s.role, risk: s.risk })),
                );
                break;
            }

            batches.push(ready.map((s) => ({ goal: s.goal, role: s.role, risk: s.risk })));
            for (const step of ready) {
                completed.add(step.id);
                remaining.splice(remaining.indexOf(step), 1);
            }
        }

        return batches;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers — parse the planner's JSON output robustly
// ──────────────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES: Set<string> = new Set([
    "classification",
    "chat",
    "summarization",
    "tool-selection",
    "code-generation",
    "memory-indexing",
]);

const ALLOWED_RISKS: Set<string> = new Set(["low", "medium", "high"]);

interface ParseResult {
    ok: boolean;
    steps: PlanStep[];
    error?: string;
}

function parsePlannerOutput(raw: string): ParseResult {
    // Extract JSON from the response — strip markdown code fences if present
    const jsonMatch = extractJson(raw);
    if (!jsonMatch) {
        return { ok: false, steps: [], error: "No JSON found in planner output" };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonMatch);
    } catch (err: unknown) {
        return { ok: false, steps: [], error: `JSON parse error: ${String(err)}` };
    }

    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray((parsed as Record<string, unknown>)["steps"])
    ) {
        return { ok: false, steps: [], error: "Planner output missing 'steps' array" };
    }

    const rawSteps = (parsed as { steps: unknown[] }).steps;
    const steps: PlanStep[] = [];

    for (let i = 0; i < rawSteps.length; i++) {
        const s = rawSteps[i];
        if (typeof s !== "object" || s === null) continue;

        const step = s as Record<string, unknown>;
        const id = String(step["id"] ?? `step-${i + 1}`);
        const description = String(step["description"] ?? "");
        const goal = String(step["goal"] ?? "");
        const role = ALLOWED_ROLES.has(String(step["role"]))
            ? (String(step["role"]) as TaskRole)
            : "chat";
        const risk = ALLOWED_RISKS.has(String(step["risk"]))
            ? (String(step["risk"]) as OperationRisk)
            : "low";
        const dependsOn = Array.isArray(step["dependsOn"])
            ? step["dependsOn"].map(String)
            : [];
        const expectedOutput =
            typeof step["expectedOutput"] === "string" ? step["expectedOutput"] : undefined;

        steps.push({ id, description, goal, role, risk, dependsOn, expectedOutput });
    }

    if (steps.length === 0) {
        return { ok: false, steps: [], error: "Planner returned empty steps array" };
    }

    return { ok: true, steps };
}

/** Extract the first {...} JSON object from a string, handling markdown fences. */
function extractJson(text: string): string | null {
    // Remove markdown fences
    const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
    const start = stripped.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
        if (stripped[i] === "{") depth++;
        else if (stripped[i] === "}") {
            depth--;
            if (depth === 0) return stripped.slice(start, i + 1);
        }
    }
    return null;
}
