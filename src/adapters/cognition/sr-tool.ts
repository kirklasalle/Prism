/**
 * SR-as-a-Tool (Phase D)
 *
 * Exposes `cognition.spectrum_refraction` as a registry tool so agents can
 * invoke SR fan-out as part of an agentic plan. The tool is thin: it requires
 * an injected `LlmProviderManager` instance (passed at construction). If the
 * estimated cost exceeds the configured gate, the tool returns a structured
 * `cost_gate_exceeded` outcome rather than executing — caller may approve and
 * retry with `force=true`.
 *
 * Governance: tier2_conditional. Default cost gate: $0.10. Override via env
 * `PRISM_SR_TOOL_COST_GATE_USD`.
 */

import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { LlmProviderManager } from "../../core/operator/llm-provider-manager.js";
import type {
    SpectrumRefractionConfig,
    HemisphereSpec,
} from "../../core/operator/model-capability-matrix.js";

const DEFAULT_COST_GATE_USD = 0.10;

function readCostGate(): number {
    const raw = process.env.PRISM_SR_TOOL_COST_GATE_USD;
    if (!raw) return DEFAULT_COST_GATE_USD;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COST_GATE_USD;
}

export interface SrToolOptions {
    providerManager: LlmProviderManager;
    /** Default SR config to use when caller doesn't supply one. */
    defaultConfig?: SpectrumRefractionConfig;
}

export class SpectrumRefractionTool implements Tool {
    readonly name = "cognition.spectrum_refraction";
    readonly contract = {
        version: "1.0.0",
        args: {
            message: { type: "string", required: true },
            role: { type: "string" },
            hemispheres: { type: "array" },
            force: { type: "boolean" },
            avgInputTokens: { type: "number" },
            avgOutputTokens: { type: "number" },
        },
    } as const;

    private readonly providerManager: LlmProviderManager;
    private readonly defaultConfig?: SpectrumRefractionConfig;

    constructor(opts: SrToolOptions) {
        this.providerManager = opts.providerManager;
        this.defaultConfig = opts.defaultConfig;
    }

    async execute(request: ToolRequest): Promise<ToolResult> {
        const message = String(request.args.message ?? "").trim();
        if (!message) {
            return { ok: false, output: { error: "message is required" } };
        }

        const force = request.args.force === true;
        const role = request.args.role ? String(request.args.role) : undefined;
        const hemispheresArg = request.args.hemispheres as HemisphereSpec[] | undefined;

        // Build effective config.
        const cfg: SpectrumRefractionConfig | undefined = hemispheresArg && Array.isArray(hemispheresArg)
            ? { enabled: true, leftModel: null, rightModel: null, hemispheres: hemispheresArg }
            : this.defaultConfig;

        if (!cfg || !cfg.enabled) {
            return {
                ok: false,
                output: { error: "no_active_sr_config", advisory: "Provide hemispheres[] in args or configure a default SR config." },
            };
        }

        // Cost gate.
        const avgIn = Number(request.args.avgInputTokens ?? 2_000);
        const avgOut = Number(request.args.avgOutputTokens ?? 1_000);
        const estimate = this.providerManager.estimateSRCost(cfg, avgIn, avgOut);
        const gate = readCostGate();
        if (!force && estimate.totalEstimatedCostUsd > gate) {
            return {
                ok: false,
                output: {
                    error: "cost_gate_exceeded",
                    estimatedCostUsd: estimate.totalEstimatedCostUsd,
                    gateUsd: gate,
                    advisory: `Estimated SR cost $${estimate.totalEstimatedCostUsd.toFixed(4)} exceeds gate $${gate.toFixed(4)}. Re-invoke with force=true after operator approval.`,
                },
            };
        }

        const result = await this.providerManager.generateSR({ message, conversation: [], systemPrompt: "" }, cfg);
        if (!result) {
            return { ok: false, output: { error: "sr_generation_failed", advisory: "SR pre-flight rejected the configuration or all hemispheres failed." } };
        }

        return {
            ok: true,
            output: {
                content: result.content,
                isolationLevel: result.isolationLevel,
                timing: result.timing,
                role: role ?? null,
                estimatedCostUsd: estimate.totalEstimatedCostUsd,
            },
            sideEffects: [{ type: "api", description: "SR fan-out + aggregation" }],
        };
    }
}

/** Optional helper for AgentRouter Phase D heuristic. */
export function shouldRouteToSR(taskText: string, confidence: number): boolean {
    if (process.env.PRISM_SR_AGENT_ROUTING !== "on") return false;
    return confidence < 0.5 && taskText.length > 500;
}
