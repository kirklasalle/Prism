/**
 * Cognition Cycles PRISM Plugin — Main Entry Point (`prism-plugin-cognition-cycles`)
 *
 * Integrates the multi-level Cognition Cycles framework (`micro`, `meso`, `macro`, `meta`) as a
 * first-class PRISM Plugin and Agentic Cognitive Engine middleware.
 *
 * All cognitive execution steps are bound to PRISM's certified `ExecutionAuthorityContext`
 * and logged directly into the blockchain-style `ActivityBus` audit ledger (**IC-11**).
 *
 * @module plugins/cognition-cycles
 */

import type { ActivityBus } from "../../core/activity/bus.js";
import { CognitionCyclesBridge, type CognitionCycleRequest, type CognitionCycleResult } from "./bridge.js";
import { createCognitionTools, type ToolDefinition } from "./tools.js";
import { type ExecutionAuthorityContext, enforceAuthorityContext } from "../../core/security/execution-authority-context.js";

export interface PluginMetadata {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
}

export class CognitionCyclesPlugin {
    readonly metadata: PluginMetadata = {
        id: "prism-plugin-cognition-cycles",
        name: "PRISM Cognition Cycles Plugin",
        version: "1.0.0",
        description: "Multi-level agentic cognitive reasoning engine (micro, meso, macro, meta cycles)",
    };

    private readonly bridge: CognitionCyclesBridge;
    private readonly bus?: ActivityBus;
    private readonly tools: ToolDefinition[];

    constructor(bus?: ActivityBus, bridge = new CognitionCyclesBridge()) {
        this.bus = bus;
        this.bridge = bridge;
        this.tools = createCognitionTools(this.bridge);
    }

    /**
     * Get registered PRISM tool definitions for this plugin.
     */
    getTools(): ToolDefinition[] {
        return this.tools;
    }

    /**
     * Run a cognitive reasoning cycle under a verified server `ExecutionAuthorityContext`.
     */
    async runCognitionCycle(req: CognitionCycleRequest, authorityContext?: ExecutionAuthorityContext): Promise<CognitionCycleResult> {
        // Enforce hard execution authority context if provided
        if (authorityContext) {
            enforceAuthorityContext(authorityContext);
        }

        const result = await this.bridge.executeCycle(req);

        // Log cognitive cycle execution to ActivityBus hash chain
        if (this.bus) {
            this.bus.emit(
                {
                    sessionId: (req.context?.sessionId as string) || "cognition-session",
                    layer: "agent",
                    operation: `cognition.${req.level}_cycle`,
                    status: "succeeded",
                    details: {
                        level: result.level,
                        inputPrompt: result.inputPrompt,
                        stepsCount: result.steps.length,
                        finalSynthesis: result.finalSynthesis,
                        durationMs: result.durationMs,
                    },
                },
                authorityContext,
            );
        }

        return result;
    }
}
