/**
 * Model Evaluation — the Matrix as a live model-usage evaluator.
 *
 * The demo/eval tasks are FIXED (they never change). The Model Matrix changes
 * day to day, week to week — new models, new pricing, new telemetry. Running a
 * fixed task against the current spectrum of models therefore yields a fresh
 * data point every time: real latency, real tokens, real cost, real success.
 *
 * Results are appended as timestamped JSONL so runs accumulate into a
 * time-series you can trend over time.
 *
 * LLM execution is injected (`GenerateFn`) so this module is pure, testable,
 * and does not hard-depend on the provider manager.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { workspaceStateDir } from "../config/workspace-resolver.js";
import { join as pathJoin } from "node:path";
import type { AvailableModel } from "./model-capability-matrix.js";
import { pickSpectrumRepresentatives } from "./model-spectrum.js";
import type { SpectrumRepresentative } from "./model-spectrum.js";

// ---------------------------------------------------------------------------
// Fixed evaluation tasks (the demo stays the same)
// ---------------------------------------------------------------------------

export interface EvalTask {
    id: string;
    label: string;
    /** The fixed prompt every model is graded on. */
    prompt: string;
    /** Optional cheap signals to score the response deterministically (no judge model). */
    expectContains?: string[];
    /** Typical output size for cost normalization. */
    maxOutputTokens?: number;
}

/**
 * Canonical fixed tasks, mirroring the Individual demo profiles. These never
 * change — they are the stable ruler against which the shifting Matrix is measured.
 */
export const EVAL_TASKS: readonly EvalTask[] = [
    {
        id: "jeans",
        label: "Shop for jeans",
        prompt:
            "A shopper wants Levi's straight-fit denim jeans, size 32x32, budget $40-$80. " +
            "In 4 bullet points, give a concise buying plan: where to look, how to filter, what to compare, and the single best next step.",
        expectContains: ["jeans", "$"],
        maxOutputTokens: 400,
    },
    {
        id: "car",
        label: "Find a car",
        prompt:
            "A buyer wants a used SUV, budget $20,000-$35,000, model years 2018-2025. " +
            "In 4 bullet points, give a concise buying plan: where to search, how to filter, total-cost-of-ownership factors, and the single best next step.",
        expectContains: ["SUV", "$"],
        maxOutputTokens: 400,
    },
    {
        id: "rental",
        label: "Rent a place",
        prompt:
            "A renter wants a 2-bedroom in Austin, TX for $1,200-$1,800/mo. " +
            "In 4 bullet points, give a concise search plan: where to look, how to filter, what to compare, and the single best next step.",
        expectContains: ["bedroom", "Austin"],
        maxOutputTokens: 400,
    },
] as const;

export function getEvalTask(id: string): EvalTask | null {
    return EVAL_TASKS.find((t) => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface EvalModelResult {
    budgetClass: SpectrumRepresentative["budgetClass"];
    providerId: string;
    model: string;
    tier: number;
    ok: boolean;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    /** Actual measured cost when the provider reports it, else estimated. */
    costUsd: number;
    costEstimated: boolean;
    /** 0-100 cheap deterministic quality signal (keyword coverage + length sanity). */
    score: number;
    /** Cost efficiency: score per cent (score / (costUsd*100 + ε)). */
    valuePerCent: number;
    error?: string;
    snippet?: string;
}

export interface EvaluationRun {
    id: string;
    taskId: string;
    taskLabel: string;
    startedAt: string;
    completedAt: string;
    totalMs: number;
    /** Snapshot of the matrix size at run time — proves the Matrix drifts run to run. */
    catalogModelCount: number;
    results: EvalModelResult[];
    /** Winners for quick trend reading. */
    bestValue: { model: string; valuePerCent: number } | null;
    bestQuality: { model: string; score: number } | null;
    cheapest: { model: string; costUsd: number } | null;
}

/** Minimal generation surface the evaluator needs (injected). */
export type GenerateFn = (
    prompt: string,
    selection: { providerId: string; model: string },
    maxOutputTokens: number,
) => Promise<{ content: string; tokensUsed?: { input: number; output: number; costUsd: number } } | null>;

// ---------------------------------------------------------------------------
// Scoring (deterministic, no judge model — keeps eval cheap & reproducible)
// ---------------------------------------------------------------------------

function scoreResponse(task: EvalTask, content: string): number {
    if (!content || content.trim().length === 0) return 0;
    let score = 0;
    // Keyword coverage (up to 50).
    const keys = task.expectContains ?? [];
    if (keys.length > 0) {
        const hit = keys.filter((k) => content.toLowerCase().includes(k.toLowerCase())).length;
        score += Math.round((hit / keys.length) * 50);
    } else {
        score += 50;
    }
    // Structure signal: bullet points present (up to 30).
    const bullets = (content.match(/^\s*[-*•\d]/gm) ?? []).length;
    score += Math.min(30, bullets * 8);
    // Length sanity: not empty, not runaway (up to 20).
    const len = content.trim().length;
    if (len >= 80 && len <= 4000) score += 20;
    else if (len > 40) score += 10;
    return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a fixed task against one representative per budget class, capturing real
 * telemetry. Costs come from the provider when reported, else fall back to the
 * spectrum estimate.
 */
export async function runSpectrumEvaluation(
    task: EvalTask,
    available: AvailableModel[],
    generate: GenerateFn,
    opts: { minTier?: number } = {},
): Promise<EvaluationRun> {
    const reps = pickSpectrumRepresentatives(available, { minTier: opts.minTier });
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const maxOut = task.maxOutputTokens ?? 400;

    const results: EvalModelResult[] = [];
    for (const rep of reps) {
        const rt0 = Date.now();
        let ok = false;
        let content = "";
        let inputTokens = 0;
        let outputTokens = 0;
        let costUsd = rep.estCostPerTurnUsd;
        let costEstimated = true;
        let error: string | undefined;
        try {
            const out = await generate(task.prompt, { providerId: rep.providerId, model: rep.model }, maxOut);
            if (out && out.content) {
                ok = true;
                content = out.content;
                if (out.tokensUsed) {
                    inputTokens = out.tokensUsed.input;
                    outputTokens = out.tokensUsed.output;
                    if (out.tokensUsed.costUsd > 0) {
                        costUsd = out.tokensUsed.costUsd;
                        costEstimated = false;
                    }
                }
            } else {
                error = "no output";
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
        const latencyMs = Date.now() - rt0;
        const score = ok ? scoreResponse(task, content) : 0;
        const valuePerCent = score > 0 ? +(score / (costUsd * 100 + 0.01)).toFixed(2) : 0;
        results.push({
            budgetClass: rep.budgetClass,
            providerId: rep.providerId,
            model: rep.model,
            tier: rep.tier,
            ok,
            latencyMs,
            inputTokens,
            outputTokens,
            costUsd: +costUsd.toFixed(6),
            costEstimated,
            score,
            valuePerCent,
            error,
            snippet: ok ? content.slice(0, 240) : undefined,
        });
    }

    const okResults = results.filter((r) => r.ok);
    const bestValue = okResults.length
        ? okResults.reduce((a, b) => (b.valuePerCent > a.valuePerCent ? b : a))
        : null;
    const bestQuality = okResults.length ? okResults.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    const cheapest = okResults.length ? okResults.reduce((a, b) => (b.costUsd < a.costUsd ? b : a)) : null;

    return {
        id: randomUUID(),
        taskId: task.id,
        taskLabel: task.label,
        startedAt,
        completedAt: new Date().toISOString(),
        totalMs: Date.now() - t0,
        catalogModelCount: available.length,
        results,
        bestValue: bestValue ? { model: bestValue.model, valuePerCent: bestValue.valuePerCent } : null,
        bestQuality: bestQuality ? { model: bestQuality.model, score: bestQuality.score } : null,
        cheapest: cheapest ? { model: cheapest.model, costUsd: cheapest.costUsd } : null,
    };
}

// ---------------------------------------------------------------------------
// Time-series persistence (always-new telemetry accumulates here)
// ---------------------------------------------------------------------------

export function evaluationLogPath(): string {
    return pathJoin(workspaceStateDir(), "model-evaluations.jsonl");
}

/** Append a run to the JSONL time-series. Best-effort; never throws. */
export function persistEvaluationRun(run: EvaluationRun): void {
    try {
        const file = evaluationLogPath();
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, JSON.stringify(run) + "\n", "utf8");
    } catch {
        /* non-critical */
    }
}

/** Load recent runs (most recent last), optionally filtered by task. */
export function loadEvaluationHistory(limit = 50, taskId?: string): EvaluationRun[] {
    try {
        const file = evaluationLogPath();
        if (!existsSync(file)) return [];
        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
        const runs: EvaluationRun[] = [];
        for (const line of lines) {
            try {
                const run = JSON.parse(line) as EvaluationRun;
                if (!taskId || run.taskId === taskId) runs.push(run);
            } catch {
                /* skip malformed line */
            }
        }
        return runs.slice(-limit);
    } catch {
        return [];
    }
}

/** Compute per-model deltas between the latest run and the previous run for a task. */
export function computeTrend(taskId: string): {
    latest: EvaluationRun | null;
    previous: EvaluationRun | null;
    deltas: Array<{ model: string; costDeltaUsd: number; scoreDelta: number; latencyDeltaMs: number }>;
} {
    const history = loadEvaluationHistory(2, taskId);
    const latest = history.length >= 1 ? history[history.length - 1]! : null;
    const previous = history.length >= 2 ? history[history.length - 2]! : null;
    const deltas: Array<{ model: string; costDeltaUsd: number; scoreDelta: number; latencyDeltaMs: number }> = [];
    if (latest && previous) {
        for (const cur of latest.results) {
            const prev = previous.results.find((r) => r.model === cur.model);
            if (!prev) continue;
            deltas.push({
                model: cur.model,
                costDeltaUsd: +(cur.costUsd - prev.costUsd).toFixed(6),
                scoreDelta: cur.score - prev.score,
                latencyDeltaMs: cur.latencyMs - prev.latencyMs,
            });
        }
    }
    return { latest, previous, deltas };
}
