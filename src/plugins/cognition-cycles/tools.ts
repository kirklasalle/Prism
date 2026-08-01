/**
 * Cognition Cycles Tool Suite — Phase 4 Plugin
 *
 * Registers PRISM tools that allow CAC Main Agent, Guardian, and Character Swarms to execute
 * cognitive reasoning loops (`micro`, `meso`, `macro`, `meta`) via `CognitionCyclesBridge`.
 *
 * @module plugins/cognition-cycles/tools
 */

import { CognitionCyclesBridge, type CognitionCycleLevel } from "./bridge.js";

export interface ToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly execute: (args: Record<string, any>) => Promise<Record<string, any>>;
}

export function createCognitionTools(bridge = new CognitionCyclesBridge()): ToolDefinition[] {
    return [
        {
            name: "cognition_cycle_run",
            description: "Run a cognitive reasoning cycle (micro, meso, macro, or meta) to decompose and plan complex tasks.",
            parameters: {
                type: "object",
                properties: {
                    level: { type: "string", enum: ["micro", "meso", "macro", "meta"], description: "Cognitive reasoning level" },
                    inputPrompt: { type: "string", description: "Prompt or goal to evaluate" },
                    maxSteps: { type: "number", description: "Maximum reasoning steps (default 3)" },
                },
                required: ["level", "inputPrompt"],
            },
            execute: async (args: Record<string, any>) => {
                const level = (args.level as CognitionCycleLevel) || "micro";
                const inputPrompt = (args.inputPrompt as string) || "";
                const maxSteps = args.maxSteps ? Number(args.maxSteps) : 3;

                const result = await bridge.executeCycle({
                    level,
                    inputPrompt,
                    maxSteps,
                });

                return {
                    ok: true,
                    level: result.level,
                    finalSynthesis: result.finalSynthesis,
                    stepsCount: result.steps.length,
                    metaReflection: result.metaReflection,
                    durationMs: result.durationMs,
                };
            },
        },
        {
            name: "cognition_cycle_reflect",
            description: "Perform meta-cognitive reflection over an action, decision, or execution result.",
            parameters: {
                type: "object",
                properties: {
                    actionSummary: { type: "string", description: "Summary of action to reflect upon" },
                    outcome: { type: "string", description: "Outcome or result achieved" },
                },
                required: ["actionSummary", "outcome"],
            },
            execute: async (args: Record<string, any>) => {
                const actionSummary = (args.actionSummary as string) || "";
                const outcome = (args.outcome as string) || "";

                const result = await bridge.executeCycle({
                    level: "meta",
                    inputPrompt: `Reflect on Action: "${actionSummary}" with Outcome: "${outcome}"`,
                    maxSteps: 2,
                });

                return {
                    ok: true,
                    metaReflection: result.metaReflection || result.finalSynthesis,
                    durationMs: result.durationMs,
                };
            },
        },
        {
            name: "cognition_cycle_meta_eval",
            description: "Perform system-level macro evaluation of multi-agent swarm strategy and policy alignment.",
            parameters: {
                type: "object",
                properties: {
                    macroGoal: { type: "string", description: "System macro goal to evaluate" },
                },
                required: ["macroGoal"],
            },
            execute: async (args: Record<string, any>) => {
                const macroGoal = (args.macroGoal as string) || "";

                const result = await bridge.executeCycle({
                    level: "macro",
                    inputPrompt: `Evaluate Macro Alignment: "${macroGoal}"`,
                    maxSteps: 3,
                });

                return {
                    ok: true,
                    macroSynthesis: result.finalSynthesis,
                    aligned: true,
                    durationMs: result.durationMs,
                };
            },
        },
    ];
}
