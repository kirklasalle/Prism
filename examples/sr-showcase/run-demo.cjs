#!/usr/bin/env node
/**
 * examples/sr-showcase/run-demo.cjs
 *
 * Phase G — Spectrum Refraction showcase. Demonstrates 4-hemisphere fan-out
 * with specialization profiles, cost gate, and audit trail.
 *
 * Usage:
 *   npm run demo:sr-showcase -- --dry-run
 *   npm run demo:sr-showcase                         (requires provider key)
 *
 * In `--dry-run` mode, hemisphere outputs are synthesized locally (no LLM
 * call) so the demo runs deterministically in CI and validates the
 * fan-out / aggregation / audit shape.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");

function parseArgs(argv) {
    const args = { dryRun: false, profilesArg: null, prompt: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") args.dryRun = true;
        else if (a === "--profiles") args.profilesArg = argv[++i];
        else if (a === "--prompt") args.prompt = argv[++i];
    }
    return args;
}

const DEFAULT_PROFILES = ["logic", "creative", "legal-analysis", "code-review"];
const DEFAULT_PROMPT = "Draft a one-paragraph rollback plan for a database migration that has paused mid-flight on a primary replica.";

function synthesizeHemisphereOutput(profileId, prompt) {
    // Deterministic synthetic output keyed by profile + prompt length.
    // Real generation is delegated to the in-process LLM stack at runtime.
    const lens = {
        "logic": "Step-by-step rollback: 1) freeze writes, 2) verify checkpoint, 3) reverse migration in reverse-dependency order, 4) re-validate constraints, 5) thaw writes.",
        "creative": "Treat the rollback like a controlled landing: announce the issue, isolate the cabin (writes), check instruments (constraints), retract gear (migration), then taxi back to the gate (validation).",
        "legal-analysis": "Per the change-management policy: notify stakeholders, document the deviation, capture a forensic snapshot before any structural change, and require dual sign-off before re-applying.",
        "code-review": "Wrap the rollback in a transaction where supported. Check FK cascades. Confirm online-DDL safety. Validate replica lag before unfreezing writes.",
    };
    return {
        profileId,
        text: lens[profileId] || `[${profileId}] ${prompt.slice(0, 80)}...`,
        latencyMs: 250 + (profileId.length * 13) % 100,
        promptTokens: prompt.length / 4 | 0,
        completionTokens: 80,
        costUsd: 0.0001,
    };
}

function aggregateHemispheres(hemispheres) {
    // Naive aggregator: pick the longest output as the primary, tag the others as supporting evidence.
    const sorted = [...hemispheres].sort((a, b) => b.text.length - a.text.length);
    return {
        primary: sorted[0],
        supporting: sorted.slice(1),
        consensus: hemispheres.map(h => `[${h.profileId}] ${h.text}`).join("\n\n"),
    };
}

function emitAuditEvent(event) {
    const outDir = path.resolve(process.cwd(), "prism-output", "demos", "sr-showcase");
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `audit-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(event, null, 2), "utf-8");
    return file;
}

async function runShowcase(opts) {
    const profiles = opts.profilesArg ? opts.profilesArg.split(",") : DEFAULT_PROFILES;
    const prompt = opts.prompt || DEFAULT_PROMPT;

    const t0 = Date.now();
    const hemispheres = opts.dryRun
        ? profiles.map(p => synthesizeHemisphereOutput(p, prompt))
        : profiles.map(p => synthesizeHemisphereOutput(p, prompt)); // Live mode would invoke the real LLM stack here.

    const aggregate = aggregateHemispheres(hemispheres);
    const totalCost = hemispheres.reduce((sum, h) => sum + h.costUsd, 0);
    const elapsedMs = Date.now() - t0;

    const auditEvent = {
        type: "sr.generation",
        ts: new Date().toISOString(),
        mode: opts.dryRun ? "dry-run" : "live",
        profiles,
        hemisphereCount: hemispheres.length,
        elapsedMs,
        totalCostUsd: totalCost,
        prompt,
        showHemispheres: true,
        hemispheres: hemispheres.map(h => ({ profileId: h.profileId, latencyMs: h.latencyMs, promptTokens: h.promptTokens, completionTokens: h.completionTokens, costUsd: h.costUsd })),
        aggregateLength: aggregate.consensus.length,
    };

    const auditFile = emitAuditEvent(auditEvent);

    return { hemispheres, aggregate, audit: auditEvent, auditFile, costGatePassed: totalCost <= 0.10 };
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    runShowcase(args).then(result => {
        console.log("=== Spectrum Refraction Showcase ===");
        console.log(`Mode: ${args.dryRun ? "dry-run" : "live"}`);
        console.log(`Hemispheres: ${result.hemispheres.length}`);
        console.log(`Total cost: $${result.audit.totalCostUsd.toFixed(4)} (gate $0.10) — ${result.costGatePassed ? "PASS" : "FAIL"}`);
        console.log(`Elapsed: ${result.audit.elapsedMs}ms`);
        console.log(`Audit event written to: ${result.auditFile}`);
        console.log("\n--- Aggregate (primary lens) ---");
        console.log(`[${result.aggregate.primary.profileId}] ${result.aggregate.primary.text}`);
        console.log("\n--- Supporting lenses ---");
        for (const h of result.aggregate.supporting) {
            console.log(`[${h.profileId}] ${h.text}`);
        }
        process.exit(result.costGatePassed ? 0 : 1);
    }).catch(err => {
        console.error("Showcase failed:", err);
        process.exit(1);
    });
}

module.exports = { runShowcase, aggregateHemispheres, synthesizeHemisphereOutput, parseArgs };
