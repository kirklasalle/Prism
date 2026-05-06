/**
 * PTAC scenario registry.
 *
 * Scenarios are registered by id at import time. The registry is intentionally
 * authoritative: the CLI surfaces only what is registered here. This prevents
 * the suite from "passing" because a scenario file silently failed to load.
 *
 * Production scenarios are added in subsequent commits per the
 * `docs/PRISM_FULL_AUDIT_2026_Q3_AND_PTAC_PLAN.md` Phase PTAC step list
 * (s01..s20). Each scenario landing must be accompanied by:
 *
 *   - a scenario file under `src/ptac/scenarios/`
 *   - a fixture / expected-result bundle under `tests/fixtures/ptac/<id>/`
 *   - a unit test asserting the scenario file parses, references valid
 *     reason codes, and has no host-only steps when not flagged `requiresHost`
 *
 * Until those land, calling `listScenarios()` returns an empty array, and the
 * CLI exits non-zero with a clear message instead of fabricating a green run.
 */

import type { PtacScenario, PtacSuite } from "./types.js";

const REGISTRY = new Map<string, PtacScenario>();

export function registerScenario(scenario: PtacScenario): void {
    if (REGISTRY.has(scenario.id)) {
        throw new Error(`PTAC scenario already registered: ${scenario.id}`);
    }
    REGISTRY.set(scenario.id, scenario);
}

export function getScenario(id: string): PtacScenario | undefined {
    return REGISTRY.get(id);
}

export function listScenarios(filter?: { suite?: PtacSuite; tag?: string }): readonly PtacScenario[] {
    const all = Array.from(REGISTRY.values());
    if (!filter) return all;
    return all.filter((s) => {
        if (filter.suite && !s.suites.includes(filter.suite)) return false;
        if (filter.tag && !(s.tags ?? []).includes(filter.tag)) return false;
        return true;
    });
}
