/**
 * Model Spectrum — the cost/value axis of the Model Matrix.
 *
 * "A full spectrum from cheapest to money-no-object" is just numbers, dates,
 * percentages and easy math. This module is that math: it enriches capability
 * profiles with real pricing, derives a budget class + quality index + value
 * score, and builds an Economy→Frontier spectrum of picks for any role or SR
 * hemisphere. The Matrix "Update" button drives enrichment across the catalog.
 *
 * Purely additive: no existing behavior changes. Every function is a pure
 * transform over profiles the caller already has.
 */

import {
    resolveProfile,
    getRoleRequirements,
    filterSRLogicModels,
    filterSRCreativeModels,
    getKinshipScore,
    tierLabel,
} from "./model-capability-matrix.js";
import type {
    BudgetClass,
    ModelCapabilityProfile,
    AvailableModel,
    TaskRole,
    ModelRouterSelection,
} from "./model-capability-matrix.js";
import { lookupPricing, hasPricing, PRICING_VERIFIED_AT } from "./usage-pricing-catalog.js";

/** Re-exported for consumers that want the spend classification from one module. */
export type { BudgetClass } from "./model-capability-matrix.js";

// ---------------------------------------------------------------------------
// Spend bands (config, not hard-coded into the router)
// ---------------------------------------------------------------------------

export interface SpendBand {
    class: BudgetClass;
    label: string;
    icon: string;
    /** Inclusive upper bound of blended USD / 1M tokens (Infinity for frontier). */
    maxBlendedPer1M: number;
    /** How this class ranks candidates. */
    rankBy: "value" | "quality";
}

/** The Refraction Spectrum, cheapest → money-no-object. Bands age gracefully via config. */
export const SPEND_BANDS: readonly SpendBand[] = [
    { class: "economy", label: "Economy", icon: "\u{1F7E2}", maxBlendedPer1M: 0.2, rankBy: "value" },
    { class: "value", label: "Value", icon: "\u{1F535}", maxBlendedPer1M: 1.0, rankBy: "value" },
    { class: "balanced", label: "Balanced", icon: "\u26AA", maxBlendedPer1M: 5.0, rankBy: "value" },
    { class: "premium", label: "Premium", icon: "\u{1F7E3}", maxBlendedPer1M: 20.0, rankBy: "quality" },
    { class: "frontier", label: "Frontier", icon: "\u{1F534}", maxBlendedPer1M: Infinity, rankBy: "quality" },
] as const;

/** Ordered classes, cheapest → most expensive. */
export const BUDGET_CLASS_ORDER: readonly BudgetClass[] = SPEND_BANDS.map((b) => b.class);

export function getSpendBand(cls: BudgetClass): SpendBand {
    return SPEND_BANDS.find((b) => b.class === cls) ?? SPEND_BANDS[2]!; // default Balanced
}

/** Default blend weights — output-heavy, since most agent turns generate more than they read. */
const BLEND_W_IN = 0.3;
const BLEND_W_OUT = 0.7;

/** Default per-turn token assumptions for cost previews. */
export const DEFAULT_TURN_INPUT_TOKENS = 2_000;
export const DEFAULT_TURN_OUTPUT_TOKENS = 1_000;

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

/** Blended cost in USD / 1M tokens for a fully-enriched profile. */
export function getBlendedCost(profile: ModelCapabilityProfile): number {
    const cin = profile.costInputPer1M ?? 0;
    const cout = profile.costOutputPer1M ?? 0;
    return cin * BLEND_W_IN + cout * BLEND_W_OUT;
}

/** Derive the budget class from a blended cost. Free/near-free ⇒ economy. */
export function deriveBudgetClass(blendedPer1M: number): BudgetClass {
    for (const band of SPEND_BANDS) {
        if (blendedPer1M <= band.maxBlendedPer1M) return band.class;
    }
    return "frontier";
}

/** 0-100 price-independent capability score. Tier is the spine; strengths + context refine it. */
export function computeQualityIndex(profile: ModelCapabilityProfile): number {
    const base = profile.tier * 18; // T1=18 … T5=90
    const keyStrengths = ["reasoning", "agentic", "code", "tool-use", "long-context"];
    const strengthBonus = Math.min(8, (profile.strengths ?? []).filter((s) => keyStrengths.includes(s)).length * 2);
    const ctx = profile.contextWindow ?? 0;
    const ctxBonus = ctx >= 128_000 ? 4 : ctx >= 32_000 ? 2 : 0;
    return Math.max(0, Math.min(100, Math.round(base + strengthBonus + ctxBonus)));
}

/**
 * 0-100 quality-per-dollar. The knee of the price/quality curve.
 * priceFactor → 1 as cost → 0, so free capable models score highest.
 * α tunes price sensitivity (higher = punishes cost more).
 */
export function computeValueScore(profile: ModelCapabilityProfile, alpha = 0.6): number {
    const quality = profile.qualityIndex ?? computeQualityIndex(profile);
    const blended = getBlendedCost(profile);
    const priceFactor = 1 / (1 + blended);
    return Math.max(0, Math.min(100, Math.round(quality * Math.pow(priceFactor, alpha))));
}

/** Estimate the USD cost of a single turn for a profile. */
export function estimateTurnCostUsd(
    profile: ModelCapabilityProfile,
    inputTokens = DEFAULT_TURN_INPUT_TOKENS,
    outputTokens = DEFAULT_TURN_OUTPUT_TOKENS,
): number {
    const cin = profile.costInputPer1M ?? 0;
    const cout = profile.costOutputPer1M ?? 0;
    return (inputTokens / 1_000_000) * cin + (outputTokens / 1_000_000) * cout;
}

// ---------------------------------------------------------------------------
// Enrichment — fills the cost/value axis from the pricing catalog
// ---------------------------------------------------------------------------

/**
 * Return a copy of `profile` with cost, budgetClass, qualityIndex and valueScore
 * populated from the pricing catalog. Distinguishes unknown pricing from free.
 */
export function enrichProfile(providerId: string, profile: ModelCapabilityProfile): ModelCapabilityProfile {
    const pricing = lookupPricing(providerId, profile.pattern);
    const known = hasPricing(providerId, profile.pattern);
    const isLocal = profile.locality === "local";

    const costInputPer1M = pricing?.inputPer1M ?? 0;
    const costOutputPer1M = pricing?.outputPer1M ?? 0;

    const billingModel: NonNullable<ModelCapabilityProfile["billingModel"]> = isLocal
        ? "local-free"
        : known
            ? costInputPer1M === 0 && costOutputPer1M === 0
                ? "subscription"
                : "per-token"
            : "unknown";

    const enriched: ModelCapabilityProfile = {
        ...profile,
        costInputPer1M,
        costOutputPer1M,
        costKnown: isLocal ? true : known,
        billingModel,
        pricingVerifiedAt: pricing?.verifiedAt ?? PRICING_VERIFIED_AT,
    };
    enriched.qualityIndex = computeQualityIndex(enriched);
    enriched.budgetClass = deriveBudgetClass(getBlendedCost(enriched));
    enriched.valueScore = computeValueScore(enriched);
    return enriched;
}

/** Enrich a bare (providerId, model) pair into a full spectrum-aware profile. */
export function enrichModel(providerId: string, model: string): ModelCapabilityProfile {
    return enrichProfile(providerId, resolveProfile(model));
}

// ---------------------------------------------------------------------------
// Spectrum builder — Economy → Frontier picks for a role
// ---------------------------------------------------------------------------

export interface SpectrumPick {
    providerId: string;
    model: string;
    tier: number;
    budgetClass: BudgetClass;
    qualityIndex: number;
    valueScore: number;
    estCostPerTurnUsd: number;
    costKnown: boolean;
    reason: string;
}

export interface RoleSpectrum {
    role: TaskRole;
    minimumTier: number;
    picks: Partial<Record<BudgetClass, SpectrumPick>>;
    /** The smart-money default class (highest value among available picks). */
    recommended: BudgetClass | null;
}

interface EnrichedAvailable extends AvailableModel {
    profile: ModelCapabilityProfile;
}

function enrichAvailable(available: AvailableModel[]): EnrichedAvailable[] {
    return available.map((a) => ({ ...a, profile: enrichProfile(a.providerId, resolveProfile(a.model)) }));
}

function toPick(e: EnrichedAvailable, reason: string): SpectrumPick {
    return {
        providerId: e.providerId,
        model: e.model,
        tier: e.profile.tier,
        budgetClass: e.profile.budgetClass ?? "balanced",
        qualityIndex: e.profile.qualityIndex ?? 0,
        valueScore: e.profile.valueScore ?? 0,
        estCostPerTurnUsd: estimateTurnCostUsd(e.profile),
        costKnown: e.profile.costKnown ?? false,
        reason,
    };
}

/**
 * Build the Economy→Frontier spectrum for a role.
 * Each class picks the best candidate at-or-below its cost ceiling and
 * at-or-above the role's minimum capability floor. Ranking follows the band.
 */
export function buildRoleSpectrum(role: TaskRole, available: AvailableModel[]): RoleSpectrum {
    const req = getRoleRequirements(role);
    const enriched = enrichAvailable(available).filter((e) => e.profile.tier >= req.minimumTier);

    const picks: Partial<Record<BudgetClass, SpectrumPick>> = {};

    for (const band of SPEND_BANDS) {
        const inBand = enriched.filter((e) => getBlendedCost(e.profile) <= band.maxBlendedPer1M);
        if (inBand.length === 0) continue;
        inBand.sort((a, b) =>
            band.rankBy === "quality"
                ? (b.profile.qualityIndex ?? 0) - (a.profile.qualityIndex ?? 0)
                : (b.profile.valueScore ?? 0) - (a.profile.valueScore ?? 0),
        );
        const best = inBand[0]!;
        picks[band.class] = toPick(
            best,
            `${band.label}: best ${band.rankBy} at/under $${band.maxBlendedPer1M}/1M (T${best.profile.tier} ${tierLabel(
                best.profile.tier,
            )})`,
        );
    }

    // Recommended = highest value among the picks (the "smart money" knee).
    let recommended: BudgetClass | null = null;
    let bestValue = -1;
    for (const cls of BUDGET_CLASS_ORDER) {
        const p = picks[cls];
        if (p && p.valueScore > bestValue) {
            bestValue = p.valueScore;
            recommended = cls;
        }
    }

    return { role, minimumTier: req.minimumTier, picks, recommended };
}

/** Neighboring picks one class below / above the chosen class, with a delta hint. */
export interface NeighborPick extends SpectrumPick {
    deltaVsChosen: string;
}

export interface ModelRouterSelectionSpectrum {
    chosen: SpectrumPick;
    cheaper?: NeighborPick;
    premium?: NeighborPick;
    spendProfile: BudgetClass;
    budgetRelaxed: boolean;
    reason: string;
}

function pct(from: number, to: number): number {
    if (from === 0) return to === 0 ? 0 : 100;
    return Math.round(((to - from) / from) * 100);
}

function neighbor(base: SpectrumPick, other: SpectrumPick): NeighborPick {
    const qd = pct(base.qualityIndex, other.qualityIndex);
    const cd = pct(base.estCostPerTurnUsd, other.estCostPerTurnUsd);
    const q = `${qd >= 0 ? "+" : ""}${qd}% quality`;
    const c = `${cd >= 0 ? "+" : ""}${cd}% cost`;
    return { ...other, deltaVsChosen: `${q}, ${c}` };
}

/**
 * Cost-aware role selection. Returns the pick for `spendProfile` plus the
 * cheaper/premium neighbors so the operator always sees "spend less / spend more".
 * Relaxes the ceiling by one class when a band is empty.
 */
export function selectModelForRoleWithBudget(
    role: TaskRole,
    available: AvailableModel[],
    opts: { spendProfile: BudgetClass; maxCostPer1M?: number },
): ModelRouterSelectionSpectrum | null {
    const spectrum = buildRoleSpectrum(role, available);
    const order = BUDGET_CLASS_ORDER;
    const idx = order.indexOf(opts.spendProfile);
    if (idx < 0) return null;

    // Find chosen: requested class, else relax outward.
    let chosen = spectrum.picks[opts.spendProfile];
    let budgetRelaxed = false;
    let reason = `Selected ${opts.spendProfile} pick for ${role}.`;
    if (!chosen) {
        budgetRelaxed = true;
        for (let d = 1; d < order.length; d++) {
            chosen = spectrum.picks[order[Math.min(order.length - 1, idx + d)]!] ?? spectrum.picks[order[Math.max(0, idx - d)]!];
            if (chosen) {
                reason = `No model in ${opts.spendProfile} band for ${role}; relaxed to ${chosen.budgetClass}.`;
                break;
            }
        }
    }
    if (!chosen) return null;

    if (opts.maxCostPer1M !== undefined) {
        const blended = (chosen.estCostPerTurnUsd / (DEFAULT_TURN_INPUT_TOKENS + DEFAULT_TURN_OUTPUT_TOKENS)) * 1_000_000;
        if (blended > opts.maxCostPer1M) {
            reason += ` Warning: exceeds hard ceiling $${opts.maxCostPer1M}/1M.`;
            budgetRelaxed = true;
        }
    }

    const chosenIdx = order.indexOf(chosen.budgetClass);
    let cheaper: NeighborPick | undefined;
    let premium: NeighborPick | undefined;
    for (let i = chosenIdx - 1; i >= 0; i--) {
        const p = spectrum.picks[order[i]!];
        if (p) {
            cheaper = neighbor(chosen, p);
            break;
        }
    }
    for (let i = chosenIdx + 1; i < order.length; i++) {
        const p = spectrum.picks[order[i]!];
        if (p) {
            premium = neighbor(chosen, p);
            break;
        }
    }

    return { chosen, cheaper, premium, spendProfile: opts.spendProfile, budgetRelaxed, reason };
}

/** Back-compat bridge: convert a SpectrumPick to the legacy ModelRouterSelection shape. */
export function pickToSelection(pick: SpectrumPick): ModelRouterSelection {
    return {
        providerId: pick.providerId,
        model: pick.model,
        profile: enrichModel(pick.providerId, pick.model),
        degraded: false,
        reason: pick.reason,
    };
}

// ---------------------------------------------------------------------------
// SR — budget-aware, isolation-preserving triad
// ---------------------------------------------------------------------------

export interface BudgetTriad {
    left: SpectrumPick | null;
    right: SpectrumPick | null;
    main: SpectrumPick | null;
    isolationLevel: "full" | "model" | "insufficient";
    estCostPerTurnUsd: number;
    reason: string;
}

/**
 * Suggest an SR triad within a spend band that preserves instance isolation
 * (Left ≠ Right, low kinship) while minimizing cost. Main defaults to a cheap
 * capable coordinator. Cost accounts for 3 fan-out passes + 1 aggregation.
 */
export function buildBudgetTriad(available: AvailableModel[], spend: BudgetClass): BudgetTriad {
    const band = getSpendBand(spend);
    const inBand = (p: ModelCapabilityProfile) => getBlendedCost(p) <= band.maxBlendedPer1M;

    const logic = filterSRLogicModels(available)
        .map((c) => ({ ...c, profile: enrichProfile(c.providerId, c.profile) }))
        .filter((c) => inBand(c.profile));
    const creative = filterSRCreativeModels(available)
        .map((c) => ({ ...c, profile: enrichProfile(c.providerId, c.profile) }))
        .filter((c) => inBand(c.profile));

    const rank = (a: { profile: ModelCapabilityProfile }, b: { profile: ModelCapabilityProfile }) =>
        band.rankBy === "quality"
            ? (b.profile.qualityIndex ?? 0) - (a.profile.qualityIndex ?? 0)
            : (b.profile.valueScore ?? 0) - (a.profile.valueScore ?? 0);

    logic.sort(rank);
    creative.sort(rank);

    const left = logic[0] ?? null;

    // Right: best creative that is isolated from left (different instance, low kinship).
    let right = null as (typeof creative)[number] | null;
    for (const cand of creative) {
        if (!left) {
            right = cand;
            break;
        }
        const sameInstance = cand.providerId === left.providerId && cand.model === left.model;
        const kin = getKinshipScore(left.model, cand.model);
        if (!sameInstance && kin <= 0.8) {
            right = cand;
            break;
        }
    }
    if (!right && creative.length > 0) right = creative.find((c) => !(left && c.model === left.model)) ?? null;

    // Main coordinator: cheapest capable logic model (value-first regardless of band).
    const main = [...logic].sort(
        (a, b) => (b.profile.valueScore ?? 0) - (a.profile.valueScore ?? 0),
    )[0] ?? left;

    const leftPick = left ? toPick(left, "Logic hemisphere") : null;
    const rightPick = right ? toPick(right, "Creative hemisphere") : null;
    const mainPick = main ? toPick(main, "Coordinator") : null;

    let isolationLevel: BudgetTriad["isolationLevel"] = "insufficient";
    if (left && right) {
        if (left.providerId !== right.providerId) isolationLevel = "full";
        else if (left.model !== right.model) isolationLevel = "model";
    }

    // Cost: left + right + main fan-out + aggregation (aggregation input ≈ 3× output).
    const aggInput = DEFAULT_TURN_INPUT_TOKENS + DEFAULT_TURN_OUTPUT_TOKENS * 3;
    const est =
        (leftPick?.estCostPerTurnUsd ?? 0) +
        (rightPick?.estCostPerTurnUsd ?? 0) +
        (mainPick?.estCostPerTurnUsd ?? 0) +
        (main ? estimateTurnCostUsd(main.profile, aggInput, DEFAULT_TURN_OUTPUT_TOKENS) : 0);

    const reason =
        !leftPick || !rightPick
            ? `Insufficient qualified models in ${band.label} band for a full triad.`
            : `${band.label} refraction · isolation: ${isolationLevel} · ~$${est.toFixed(4)}/turn`;

    return { left: leftPick, right: rightPick, main: mainPick, isolationLevel, estCostPerTurnUsd: est, reason };
}

// ---------------------------------------------------------------------------
// Update-button statistics (dates, percentages, coverage)
// ---------------------------------------------------------------------------

export interface SpectrumStats {
    total: number;
    pricingKnown: number;
    pricingUnknown: number;
    pricingCoveragePct: number;
    byBudgetClass: Record<BudgetClass, number>;
    verifiedAt: string;
    computedAt: string;
}

/** Summarize spectrum coverage across a set of (providerId, model) pairs. */
export function computeSpectrumStats(models: AvailableModel[]): SpectrumStats {
    const byBudgetClass: Record<BudgetClass, number> = {
        economy: 0,
        value: 0,
        balanced: 0,
        premium: 0,
        frontier: 0,
    };
    let known = 0;
    for (const m of models) {
        const p = enrichProfile(m.providerId, resolveProfile(m.model));
        if (p.costKnown) known++;
        byBudgetClass[p.budgetClass ?? "balanced"]++;
    }
    const total = models.length;
    return {
        total,
        pricingKnown: known,
        pricingUnknown: total - known,
        pricingCoveragePct: total === 0 ? 0 : Math.round((known / total) * 100),
        byBudgetClass,
        verifiedAt: PRICING_VERIFIED_AT,
        computedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Spectrum representatives (one model per band — the evaluation lineup)
// ---------------------------------------------------------------------------

export interface SpectrumRepresentative {
    budgetClass: BudgetClass;
    providerId: string;
    model: string;
    tier: number;
    qualityIndex: number;
    valueScore: number;
    estCostPerTurnUsd: number;
    costKnown: boolean;
}

/**
 * Pick one representative model per budget class from the *current* catalog.
 * This is the lineup an evaluation runs a fixed task against — as the Matrix
 * changes day to day (new models, new pricing), the representatives change,
 * which is exactly what makes the telemetry fresh over time.
 */
export function pickSpectrumRepresentatives(
    available: AvailableModel[],
    opts: { minTier?: number } = {},
): SpectrumRepresentative[] {
    const minTier = opts.minTier ?? 1;
    const enriched = available
        .map((a) => ({ ...a, profile: enrichProfile(a.providerId, resolveProfile(a.model)) }))
        .filter((e) => e.profile.tier >= minTier);

    const reps: SpectrumRepresentative[] = [];
    for (const band of SPEND_BANDS) {
        const inBand = enriched.filter(
            (e) =>
                getBlendedCost(e.profile) <= band.maxBlendedPer1M &&
                // Prefer a DISTINCT model per band for a diverse evaluation lineup.
                !reps.some((r) => r.providerId === e.providerId && r.model === e.model),
        );
        if (inBand.length === 0) continue;
        inBand.sort((a, b) =>
            band.rankBy === "quality"
                ? (b.profile.qualityIndex ?? 0) - (a.profile.qualityIndex ?? 0)
                : (b.profile.valueScore ?? 0) - (a.profile.valueScore ?? 0),
        );
        const best = inBand[0]!;
        reps.push({
            budgetClass: band.class,
            providerId: best.providerId,
            model: best.model,
            tier: best.profile.tier,
            qualityIndex: best.profile.qualityIndex ?? 0,
            valueScore: best.profile.valueScore ?? 0,
            estCostPerTurnUsd: estimateTurnCostUsd(best.profile),
            costKnown: best.profile.costKnown ?? false,
        });
    }
    return reps;
}

