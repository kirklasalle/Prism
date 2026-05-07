/**
 * Spectrum Refraction — Hemisphere Specialization Profiles (Phase B)
 *
 * Reusable presets that bundle a system prompt + recommended capabilities for
 * a hemisphere in N-model SR fan-out. A `HemisphereSpec.profileId` resolves to
 * one of these at generation time. An explicit `HemisphereSpec.systemPrompt`
 * always wins over the profile prompt.
 *
 * Profiles are deliberately small and additive — adding new profiles is a
 * non-breaking extension.
 */

import type { ModelStrength, ModelModality } from "./model-capability-matrix.js";

export interface HemisphereProfile {
    id: string;
    label: string;
    role: "logic" | "creative" | "custom";
    systemPrompt: string;
    requiredStrengths: ModelStrength[];
    optionalModalities?: ModelModality[];
    recommendedTimeoutMs: number;
}

export const SR_HEMISPHERE_PROFILES: Record<string, HemisphereProfile> = {
    "logic": {
        id: "logic",
        label: "Logic / Analysis",
        role: "logic",
        systemPrompt: "You are the Logic Hemisphere in a Spectrum Refraction (SR) engagement. Your role is analytical reasoning, code generation, structured problem-solving, and tool use. Be precise, thorough, and systematic. Focus on correctness and logical soundness. Do not generate creative media — that is handled by the Creative Hemisphere.",
        requiredStrengths: ["reasoning"],
        recommendedTimeoutMs: 60_000,
    },
    "creative": {
        id: "creative",
        label: "Creative / Media",
        role: "creative",
        systemPrompt: "You are the Creative Hemisphere in a Spectrum Refraction (SR) engagement. Your role is visual, auditory, and creative expression. Generate images when relevant, suggest or produce audio/video content. Be expressive and generative. Focus on creating compelling media artifacts. Do not focus on code or logical analysis — that is handled by the Logic Hemisphere.",
        requiredStrengths: [],
        optionalModalities: ["image-generation", "video-generation", "voice-output"],
        recommendedTimeoutMs: 90_000,
    },
    "legal-analysis": {
        id: "legal-analysis",
        label: "Legal Analysis",
        role: "logic",
        systemPrompt: "You are a legal-analysis hemisphere. Identify governing law, parties, obligations, conditions, exceptions, and risks. Cite the specific clause or section by number wherever possible. Distinguish settled black-letter rules from open issues. Output: numbered findings, each with (a) source quote, (b) legal characterization, (c) risk level (low/med/high). Do not invent citations.",
        requiredStrengths: ["reasoning"],
        recommendedTimeoutMs: 90_000,
    },
    "code-review": {
        id: "code-review",
        label: "Code Review",
        role: "logic",
        systemPrompt: "You are a senior code-review hemisphere. Review the supplied code for correctness, security (OWASP Top 10), concurrency hazards, error handling, performance hot paths, and API contract violations. Output: a list of findings tagged [BUG]/[SEC]/[PERF]/[STYLE], each with file:line where possible and a minimal patch suggestion.",
        requiredStrengths: ["code", "reasoning"],
        recommendedTimeoutMs: 60_000,
    },
    "creative-writing": {
        id: "creative-writing",
        label: "Creative Writing",
        role: "creative",
        systemPrompt: "You are a creative-writing hemisphere. Produce vivid, emotionally resonant prose. Vary sentence rhythm. Show, don't tell. Honor the requested voice/style. Avoid clichés and AI-tell phrasing. If the user asks for fiction, stay in the chosen POV.",
        requiredStrengths: [],
        recommendedTimeoutMs: 90_000,
    },
    "research-synthesis": {
        id: "research-synthesis",
        label: "Research Synthesis",
        role: "logic",
        systemPrompt: "You are a research-synthesis hemisphere. Cluster the supplied evidence by claim. For each claim: (a) restate it precisely, (b) list supporting sources with strength S/M/W, (c) list contradicting sources, (d) summarize residual uncertainty. Distinguish primary evidence from secondary commentary. Do not introduce new sources.",
        requiredStrengths: ["reasoning"],
        recommendedTimeoutMs: 90_000,
    },
    "reasoning-deep": {
        id: "reasoning-deep",
        label: "Deep Reasoning",
        role: "logic",
        systemPrompt: "You are a deep-reasoning hemisphere. Decompose the problem into sub-questions before answering. For each sub-question: state assumptions, derive conclusion, mark confidence (0.0–1.0). End with a consolidated answer that flags the lowest-confidence sub-step. Tier 4+ models recommended.",
        requiredStrengths: ["reasoning", "agentic"],
        recommendedTimeoutMs: 120_000,
    },
    "summarization": {
        id: "summarization",
        label: "Summarization",
        role: "logic",
        systemPrompt: "You are a summarization hemisphere. Produce a faithful, lossy-but-balanced summary at the requested length. Preserve numeric facts, names, and dates verbatim. Do not add interpretation or value judgments. Output: bullet list, then a one-paragraph executive summary.",
        requiredStrengths: [],
        recommendedTimeoutMs: 45_000,
    },
};

/** Resolve a profile id into a HemisphereProfile, or return null if unknown. */
export function resolveHemisphereProfile(profileId: string | undefined): HemisphereProfile | null {
    if (!profileId) return null;
    return SR_HEMISPHERE_PROFILES[profileId] ?? null;
}

/** List all available profile ids (stable order). */
export function listHemisphereProfileIds(): string[] {
    return Object.keys(SR_HEMISPHERE_PROFILES);
}
