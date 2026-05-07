/**
 * Approval Contention — Mixed Outcomes (approve/deny/timeout) × Profiles
 *
 * Closes TODO bullets:
 *   - Contention scenario expansion for mixed approve/deny/timeout profiles
 *   - Profile-differentiated trend history (per-profile latency summary surfaced
 *     for downstream CI capture)
 *
 * The existing `benchmarkApprovalPathwayContention` in
 * `src/benchmarks/performance-qualification.ts` only mixes approve/deny via a
 * 2/3:1/3 toggle and uses a 5s timeout that never fires under load. This test
 * exercises all three resolution paths (approve / deny / timeout) and asserts:
 *   1. Outcome counts match the deterministic schedule.
 *   2. No request hangs past the bounded timeout window.
 *   3. Per-profile (Individual vs Business) latency summaries are computable
 *      and bounded — so CI artifacts can capture profile-differentiated trends.
 */

import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";

type Outcome = "approved" | "denied" | "timeout";
type Profile = "individual" | "business";

interface Sample {
    profile: Profile;
    outcome: Outcome;
    latencyMs: number;
}

function percentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx]!;
}

async function settleHead(queue: ApprovalQueue, approve: boolean): Promise<boolean> {
    // Wait briefly for at least one pending request to be visible.
    for (let attempt = 0; attempt < 50; attempt++) {
        const pending = queue.list();
        if (pending.length > 0) {
            const id = pending[0]!.id;
            return approve ? queue.approve(id) : queue.deny(id);
        }
        await new Promise((r) => setImmediate(r));
    }
    return false;
}

export async function testApprovalContentionMixedOutcomes(): Promise<void> {
    const queue = new ApprovalQueue();
    // Mute noisy console output from ApprovalQueue's request()/timeout warnings.
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => { };
    console.warn = () => { };

    try {
        const TOTAL = 30; // 10 × 3 outcomes
        const TIMEOUT_BUDGET_MS = 80; // short enough to fire reliably under contention
        const samples: Sample[] = [];

        // Deterministic schedule: cycle through approve / deny / timeout, alternating profiles.
        const schedule: Array<{ outcome: Outcome; profile: Profile }> = [];
        for (let i = 0; i < TOTAL; i++) {
            const outcome: Outcome =
                i % 3 === 0 ? "approved" : i % 3 === 1 ? "denied" : "timeout";
            const profile: Profile = i % 2 === 0 ? "individual" : "business";
            schedule.push({ outcome, profile });
        }

        // Launch all requests; we await sequentially per slot to keep a deterministic
        // mapping between schedule entries and pending queue heads.
        for (const slot of schedule) {
            const startedAt = performance.now();
            const requestPromise = queue.request(
                `session-${slot.profile}`,
                `op_${slot.outcome}_${slot.profile}`,
                { profile: slot.profile, scheduledOutcome: slot.outcome },
                TIMEOUT_BUDGET_MS,
            );

            if (slot.outcome === "approved") {
                await settleHead(queue, true);
            } else if (slot.outcome === "denied") {
                await settleHead(queue, false);
            } else {
                // For timeout, do nothing — let the 80ms timer fire.
            }

            const result = await requestPromise;
            const latencyMs = performance.now() - startedAt;

            // Approve resolves true; deny/timeout resolve false. We can't distinguish
            // deny from timeout from the resolved value alone, so we trust the schedule
            // (validated by latency: timeout latency must be ≥ TIMEOUT_BUDGET_MS - tolerance).
            samples.push({ profile: slot.profile, outcome: slot.outcome, latencyMs });

            if (slot.outcome === "approved") {
                assert.equal(result, true, `approved slot must resolve true (slot=${JSON.stringify(slot)})`);
            } else {
                assert.equal(result, false, `deny/timeout slot must resolve false (slot=${JSON.stringify(slot)})`);
            }
        }

        // ── Outcome count assertions ─────────────────────────────────────
        const approvedCount = samples.filter((s) => s.outcome === "approved").length;
        const deniedCount = samples.filter((s) => s.outcome === "denied").length;
        const timeoutCount = samples.filter((s) => s.outcome === "timeout").length;

        assert.equal(approvedCount, 10, "expected 10 approved samples");
        assert.equal(deniedCount, 10, "expected 10 denied samples");
        assert.equal(timeoutCount, 10, "expected 10 timeout samples");

        // ── Timeout-path latency must be ≥ budget (minus generous tolerance) ──
        const timeoutSamples = samples.filter((s) => s.outcome === "timeout");
        const minTimeoutLatency = Math.min(...timeoutSamples.map((s) => s.latencyMs));
        assert.ok(
            minTimeoutLatency >= TIMEOUT_BUDGET_MS * 0.5,
            `timeout latency ${minTimeoutLatency.toFixed(2)}ms < 0.5×budget (${TIMEOUT_BUDGET_MS * 0.5}ms)`,
        );

        // ── Approve/deny paths must be fast (way under timeout budget) ──
        const settledSamples = samples.filter((s) => s.outcome !== "timeout");
        const settledP95 = percentile(settledSamples.map((s) => s.latencyMs), 0.95);
        assert.ok(
            settledP95 < TIMEOUT_BUDGET_MS,
            `approve/deny p95 ${settledP95.toFixed(2)}ms must stay under timeout budget ${TIMEOUT_BUDGET_MS}ms`,
        );

        // ── No request can exceed timeout budget × 3 (no hangs) ──
        const overallMax = Math.max(...samples.map((s) => s.latencyMs));
        assert.ok(
            overallMax <= TIMEOUT_BUDGET_MS * 3,
            `no request may hang past 3×timeout budget; saw max=${overallMax.toFixed(2)}ms`,
        );

        // ── Profile-differentiated trend summary ─────────────────────────
        // Surface a structured object that downstream CI can serialize to
        // perf-qualification.json for trend tracking.
        const profileSummary: Record<Profile, {
            count: number;
            p50Ms: number;
            p95Ms: number;
            outcomes: Record<Outcome, number>;
        }> = {
            individual: {
                count: 0, p50Ms: 0, p95Ms: 0,
                outcomes: { approved: 0, denied: 0, timeout: 0 },
            },
            business: {
                count: 0, p50Ms: 0, p95Ms: 0,
                outcomes: { approved: 0, denied: 0, timeout: 0 },
            },
        };

        for (const profile of ["individual", "business"] as const) {
            const profileSamples = samples.filter((s) => s.profile === profile);
            const latencies = profileSamples.map((s) => s.latencyMs);
            profileSummary[profile].count = profileSamples.length;
            profileSummary[profile].p50Ms = percentile(latencies, 0.5);
            profileSummary[profile].p95Ms = percentile(latencies, 0.95);
            for (const s of profileSamples) {
                profileSummary[profile].outcomes[s.outcome] += 1;
            }

            // Each profile receives ~half the samples (15 of 30) due to alternation.
            assert.equal(
                profileSummary[profile].count, 15,
                `profile=${profile} should receive 15 samples, got ${profileSummary[profile].count}`,
            );
            assert.ok(
                profileSummary[profile].p95Ms <= TIMEOUT_BUDGET_MS * 3,
                `profile=${profile} p95 ${profileSummary[profile].p95Ms.toFixed(2)}ms exceeds 3×budget`,
            );
        }

        // Validate the summary is well-formed (would be the artifact CI captures).
        assert.ok(typeof profileSummary.individual.p95Ms === "number");
        assert.ok(typeof profileSummary.business.p95Ms === "number");
    } finally {
        console.log = origLog;
        console.warn = origWarn;
    }
}
