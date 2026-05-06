#!/usr/bin/env node
/**
 * prism-soc2-export.cjs — backfill SOC 2 evidence from the SQLite activity log.
 *
 * Usage:
 *   node scripts/prism-soc2-export.cjs \
 *     --db prism-activity.db \
 *     --since 2026-01-01 \
 *     --until 2026-12-31 \
 *     --out prism-output/soc2/backfill.jsonl
 *
 * Notes:
 *   - Reads directly from the activity_events table via node:sqlite, so the
 *     PRISM dashboard does NOT need to be running.
 *   - Reuses the same classifyEventForSoc2 + mapEventToSoc2 logic that the
 *     live exporter uses (imported from dist/).
 *   - Writes one JSON record per line. Safe to re-run; output file is
 *     truncated on each invocation.
 *
 * Run `npm run build` first so dist/src/core/compliance/soc2-exporter.js exists.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--db") out.db = argv[++i];
        else if (a === "--since") out.since = argv[++i];
        else if (a === "--until") out.until = argv[++i];
        else if (a === "--out") out.out = argv[++i];
        else if (a === "--help" || a === "-h") out.help = true;
    }
    return out;
}

function usage() {
    console.error(
        "Usage: node scripts/prism-soc2-export.cjs --db <path> [--since YYYY-MM-DD] [--until YYYY-MM-DD] --out <path>",
    );
}

function loadExporter() {
    const distPath = path.resolve(__dirname, "..", "dist", "src", "core", "compliance", "soc2-exporter.js");
    if (!fs.existsSync(distPath)) {
        console.error(
            `[prism-soc2-export] missing build artifact at ${distPath}.\n` +
            "Run `npm run build` first.",
        );
        process.exit(2);
    }
    return require(distPath);
}

function rowToEvent(row) {
    return {
        id: String(row.id),
        timestamp: String(row.timestamp),
        sessionId: String(row.session_id),
        layer: String(row.layer),
        operation: String(row.operation),
        status: String(row.status),
        confidence: row.confidence != null ? Number(row.confidence) : undefined,
        durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
        details: JSON.parse(String(row.details ?? "{}")),
        authorityTier: row.authority_tier != null ? String(row.authority_tier) : undefined,
        policyDecision: row.policy_decision != null ? String(row.policy_decision) : undefined,
        sideEffects: JSON.parse(String(row.side_effects ?? "[]")),
        characterId: row.character_id != null ? String(row.character_id) : undefined,
        prismUserId: row.prism_user_id != null ? String(row.prism_user_id) : undefined,
        prismUserEmail: row.prism_user_email != null ? String(row.prism_user_email) : undefined,
        operatorId: row.operator_id != null ? String(row.operator_id) : undefined,
        operatorEmail: row.operator_email != null ? String(row.operator_email) : undefined,
        clientId: row.client_id != null ? String(row.client_id) : undefined,
        assignmentId: row.assignment_id != null ? String(row.assignment_id) : undefined,
        accountabilityChain: row.accountability_chain != null
            ? JSON.parse(String(row.accountability_chain))
            : undefined,
        rollbackPlan: row.rollback_plan != null ? String(row.rollback_plan) : undefined,
        hash: row.hash != null ? String(row.hash) : undefined,
    };
}

function main() {
    const args = parseArgs(process.argv);
    if (args.help) { usage(); return; }
    if (!args.db || !args.out) {
        usage();
        process.exit(2);
    }
    if (!fs.existsSync(args.db)) {
        console.error(`[prism-soc2-export] db not found: ${args.db}`);
        process.exit(2);
    }

    const { backfillFromEvents } = loadExporter();

    const db = new DatabaseSync(args.db);
    let rows;
    try {
        rows = db.prepare("SELECT * FROM activity_events ORDER BY timestamp ASC").all();
    } finally {
        db.close();
    }

    const events = rows.map(rowToEvent);
    const opts = {};
    if (args.since) opts.since = new Date(args.since);
    if (args.until) opts.until = new Date(args.until);
    const records = backfillFromEvents(events, opts);

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    const stream = fs.createWriteStream(args.out, { flags: "w" });
    for (const r of records) stream.write(JSON.stringify(r) + "\n");
    stream.end();
    stream.on("close", () => {
        console.log(
            `[prism-soc2-export] wrote ${records.length} records (of ${events.length} source events) → ${args.out}`,
        );
    });
}

main();
