#!/usr/bin/env node
/**
 * Audit Chain Verification CLI — IC-11
 *
 * Answers one question an operator cannot otherwise answer without writing SQL by hand:
 * *is the persisted audit trail still internally consistent, and if not, exactly where
 * does it break?*
 *
 * Reads `activity_events` directly via node:sqlite, re-derives every event digest from
 * stored content, and walks the `previous_hash` links in sequence order. PRISM does not
 * need to be running.
 *
 * Modelled on `python -m orrery.tools.attest` from the Orrery project, which exists on the
 * same reasoning: a control whose current state cannot be inspected on demand gets assumed
 * rather than verified.
 *
 * Usage:
 *   node scripts/verify-audit-chain.cjs [--db prism-activity.db] [--json]
 *
 * Exit codes:
 *   0  chain intact
 *   1  chain broken, or the database could not be read
 *   2  retained chain may be intact, but legacy/pruned evidence is indeterminate
 */

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const GENESIS_PREVIOUS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const CURRENT_AUDIT_HASH_VERSION = 2;

function parseArgs(argv) {
    const args = { db: "prism-activity.db", json: false };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--db" && argv[i + 1]) {
            args.db = argv[++i];
        } else if (argv[i] === "--json") {
            args.json = true;
        }
    }
    return args;
}

/**
 * Must stay byte-identical to computeChainedEventHash() in
 * src/core/activity/hash-chained-audit.ts — field set and order are load-bearing.
 */
function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function computeChainedEventHash(previousHash, event, hashVersion) {
    const legacyPayload = {
        id: event.id,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        layer: event.layer,
        operation: event.operation,
        status: event.status,
        details: event.details,
        characterId: event.characterId,
        operatorEmail: event.operatorEmail,
        assignmentId: event.assignmentId,
    };
    const completePayload = {
        id: event.id,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        layer: event.layer,
        operation: event.operation,
        status: event.status,
        confidence: event.confidence ?? null,
        durationMs: event.durationMs ?? null,
        details: event.details ?? {},
        authorityTier: event.authorityTier ?? null,
        policyDecision: event.policyDecision ?? null,
        sideEffects: event.sideEffects ?? [],
        characterId: event.characterId ?? null,
        prismUserId: event.prismUserId ?? null,
        prismUserEmail: event.prismUserEmail ?? null,
        operatorId: event.operatorId ?? null,
        operatorEmail: event.operatorEmail ?? null,
        clientId: event.clientId ?? null,
        executionProfileSegment: event.executionProfileSegment ?? null,
        assignmentId: event.assignmentId ?? null,
        accountabilityChain: event.accountabilityChain ?? null,
        rollbackPlan: event.rollbackPlan ?? null,
    };
    const payload = hashVersion === 1 ? JSON.stringify(legacyPayload) : canonicalJson(completePayload);
    const input = hashVersion === 1
        ? `${previousHash}:${payload}`
        : `${hashVersion}:${previousHash}:${payload}`;
    return crypto.createHash("sha256").update(input).digest("hex");
}

function rowToEvent(row) {
    return {
        id: String(row.id),
        sessionId: String(row.session_id),
        timestamp: String(row.timestamp),
        layer: String(row.layer),
        operation: String(row.operation),
        status: String(row.status),
        details: JSON.parse(String(row.details ?? "{}")),
        confidence: row.confidence != null ? Number(row.confidence) : undefined,
        durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
        authorityTier: row.authority_tier != null ? String(row.authority_tier) : undefined,
        policyDecision: row.policy_decision != null ? String(row.policy_decision) : undefined,
        sideEffects: JSON.parse(String(row.side_effects ?? "[]")),
        characterId: row.character_id != null ? String(row.character_id) : undefined,
        prismUserId: row.prism_user_id != null ? String(row.prism_user_id) : undefined,
        prismUserEmail: row.prism_user_email != null ? String(row.prism_user_email) : undefined,
        operatorId: row.operator_id != null ? String(row.operator_id) : undefined,
        operatorEmail: row.operator_email != null ? String(row.operator_email) : undefined,
        clientId: row.client_id != null ? String(row.client_id) : undefined,
        executionProfileSegment: row.execution_profile_segment != null ? String(row.execution_profile_segment) : undefined,
        assignmentId: row.assignment_id != null ? String(row.assignment_id) : undefined,
        accountabilityChain: row.accountability_chain != null ? JSON.parse(String(row.accountability_chain)) : undefined,
        rollbackPlan: row.rollback_plan != null ? String(row.rollback_plan) : undefined,
    };
}

function verify(dbPath) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const unchainedRows = Number(
            db.prepare("SELECT COUNT(*) AS c FROM activity_events WHERE sequence_number IS NULL").get().c,
        );
        const rows = db
            .prepare("SELECT * FROM activity_events WHERE sequence_number IS NOT NULL ORDER BY sequence_number ASC")
            .all();
        const chainState = db.prepare(
            "SELECT last_pruned_sequence, last_pruned_hash FROM audit_chain_state WHERE id = 1",
        ).get();

        if (rows.length === 0) {
            return {
                status: "indeterminate",
                valid: false,
                checked: 0,
                unchainedRows,
                firstSequence: null,
                rootedAfterPrune: false,
                brokenAtSequence: null,
                reason: unchainedRows > 0
                    ? `No chained events; ${unchainedRows} unprovable pre-migration row(s).`
                    : Number(chainState.last_pruned_sequence) > 0
                        ? `No retained events; history through sequence ${chainState.last_pruned_sequence} was pruned.`
                        : "Chain is empty; no event can be verified.",
            };
        }

        const firstSequence = Number(rows[0].sequence_number);
        const rootedAfterPrune = firstSequence !== 1;
        let expectedSequence = firstSequence;
        const prunedSequence = Number(chainState.last_pruned_sequence);
        let expectedPrevHash = rootedAfterPrune ? String(chainState.last_pruned_hash) : GENESIS_PREVIOUS_HASH;

        if (rootedAfterPrune && (firstSequence !== prunedSequence + 1 || prunedSequence === 0)) {
            return {
                status: "invalid", valid: false, checked: 0, unchainedRows, firstSequence,
                rootedAfterPrune, brokenAtSequence: firstSequence,
                reason: `Retained root is not authorized by prune state: first sequence ${firstSequence}, recorded pruned sequence ${prunedSequence}.`,
            };
        }

        for (const row of rows) {
            const sequence = Number(row.sequence_number);
            const base = {
                status: "invalid",
                valid: false,
                checked: sequence - firstSequence,
                unchainedRows,
                firstSequence,
                rootedAfterPrune,
                brokenAtSequence: sequence,
            };

            if (sequence !== expectedSequence) {
                return { ...base, reason: `Sequence gap: expected ${expectedSequence}, found ${sequence}.` };
            }

            const previousHash = String(row.previous_hash ?? "");
            if (previousHash !== expectedPrevHash) {
                return {
                    ...base,
                    reason: `Broken link at sequence ${sequence} (event ${row.id}): expected predecessor ${expectedPrevHash.slice(0, 12)}, stored ${previousHash.slice(0, 12)}`,
                };
            }

            const hashVersion = row.hash_version == null ? 1 : Number(row.hash_version);
            const recomputed = computeChainedEventHash(previousHash, rowToEvent(row), hashVersion);
            const storedHash = String(row.hash ?? "");
            if (recomputed !== storedHash) {
                return {
                    ...base,
                    reason: `Content mismatch at sequence ${sequence} (event ${row.id}): stored ${storedHash.slice(0, 12)}, recomputed ${recomputed.slice(0, 12)} — the row was altered after it was written.`,
                };
            }

            expectedPrevHash = storedHash;
            expectedSequence += 1;
        }

        const status = unchainedRows > 0 ? "indeterminate" : "valid";
        return {
            status,
            valid: status === "valid",
            checked: rows.length,
            unchainedRows,
            firstSequence,
            rootedAfterPrune,
            brokenAtSequence: null,
            reason: `${status === "valid" ? "Chain intact" : "Retained chain intact, but evidence is indeterminate"}: ${rows.length} event(s), sequence ${firstSequence}–${expectedSequence - 1}.`,
        };
    } finally {
        db.close();
    }
}

function main() {
    const args = parseArgs(process.argv);
    const dbPath = path.resolve(process.cwd(), args.db);

    if (!fs.existsSync(dbPath)) {
        console.error(`[verify-audit-chain] Database not found: ${dbPath}`);
        process.exit(1);
    }

    let result;
    try {
        result = verify(dbPath);
    } catch (err) {
        console.error(`[verify-audit-chain] FAILED to read chain: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    const outputDir = path.join(process.cwd(), "prism-output", "security");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
        path.join(outputDir, "audit-chain-verification.json"),
        JSON.stringify({ generatedAt: new Date().toISOString(), dbPath, ...result }, null, 2),
        "utf8",
    );

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(`[verify-audit-chain] database        : ${dbPath}`);
        console.log(`[verify-audit-chain] chained events  : ${result.checked}`);
        console.log(`[verify-audit-chain] unprovable rows : ${result.unchainedRows} (written before the IC-11 migration)`);
        if (result.rootedAfterPrune) {
            console.log(
                `[verify-audit-chain] NOTE            : chain is rooted at sequence ${result.firstSequence}; earlier events were pruned by retention and cannot be proven.`,
            );
        }
        console.log(`[verify-audit-chain] ${result.valid ? "PASSED" : "FAILED"}: ${result.reason}`);
    }

    process.exit(result.status === "valid" ? 0 : result.status === "indeterminate" ? 2 : 1);
}

main();
