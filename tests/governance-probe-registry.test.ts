import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ActivityBus } from "../src/core/activity/bus.js";
import { SqliteActivityStore } from "../src/core/activity/sqlite-store.js";
import { ChatSessionStore } from "../src/core/operator/chat-session-store.js";
import { validateEvidenceManifest } from "../src/core/governance/evidence-manifest.js";
import { GOVERNANCE_CONTROLS } from "../src/core/governance/control-registry.js";
import {
    findEvidenceProbe,
    runEvidenceProbes,
    validateProbeRegistry,
} from "../src/core/governance/probe-registry.js";

const temporaryDirectories: string[] = [];
const evaluatedAt = "2026-08-08T12:00:00.000Z";

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("Governance evidence probe registry", () => {
    it("registers the versioned durable audit-chain probe", () => {
        assert.deepEqual(validateProbeRegistry(), []);
        assert.notEqual(findEvidenceProbe("security.audit-chain", 2), null);
        assert.notEqual(findEvidenceProbe("security.certificate-envelope", 1), null);
        assert.notEqual(findEvidenceProbe("security.certificate-immutability", 1), null);
        assert.notEqual(findEvidenceProbe("security.production-migration-parity", 1), null);
        assert.notEqual(findEvidenceProbe("security.fail-closed-login", 1), null);
        assert.notEqual(findEvidenceProbe("security.audit-external-anchor", 1), null);
        assert.notEqual(findEvidenceProbe("security.adversarial", 1), null);
        assert.equal(findEvidenceProbe("security.audit-chain", 1), null);
    });

    it("registers a producer for every control evidence requirement", () => {
        for (const control of GOVERNANCE_CONTROLS) {
            for (const requirement of control.evidenceRequirements) {
                assert.notEqual(
                    findEvidenceProbe(requirement.probeId, requirement.probeVersion),
                    null,
                    `${control.controlId} has no registered producer for ${requirement.probeId}@${requirement.probeVersion}`,
                );
            }
        }
    });

    it("executes bypass attacks into a passing adversarial capability ledger", async () => {
        const manifest = await runEvidenceProbes([{ probeId: "security.adversarial", probeVersion: 1 }], {
            commit: "commit-abc",
            buildId: "build-123",
            evaluatedAt,
            inputs: {},
        });

        assert.equal(manifest.records[0]?.result, "passed");
    });

    it("executes the fail-closed login and one-time enrollment probe", async () => {
        const manifest = await runEvidenceProbes([{ probeId: "security.fail-closed-login", probeVersion: 1 }], {
            commit: "commit-abc",
            buildId: "build-123",
            evaluatedAt,
            inputs: {},
        });

        assert.equal(manifest.records[0]?.result, "passed");
    });

    it("executes certificate envelope and isolated immutability probes", async () => {
        const manifest = await runEvidenceProbes(
            [
                { probeId: "security.certificate-envelope", probeVersion: 1 },
                { probeId: "security.certificate-immutability", probeVersion: 1 },
            ],
            {
                commit: "commit-abc",
                buildId: "build-123",
                evaluatedAt,
                inputs: {},
            },
        );

        assert.equal(manifest.records.length, 2);
        assert.ok(manifest.records.every((record) => record.result === "passed"));
        assert.deepEqual(
            validateEvidenceManifest(manifest, {
                commit: "commit-abc",
                buildId: "build-123",
                now: new Date(evaluatedAt),
            }),
            [],
        );
    });

    it("verifies production migration parity without modifying the supplied database", async () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-probe-parity-"));
        temporaryDirectories.push(directory);
        const databasePath = join(directory, "chat.db");
        const store = new ChatSessionStore(databasePath);
        store.close();

        const manifest = await runEvidenceProbes(
            [{ probeId: "security.production-migration-parity", probeVersion: 1 }],
            {
                commit: "commit-abc",
                buildId: "build-123",
                evaluatedAt,
                inputs: { chatDatabasePath: databasePath },
            },
        );

        assert.equal(manifest.records[0]?.result, "passed");
        assert.equal(manifest.records[0]?.artifactPath, databasePath);
    });

    it("does not create or pass an audit database when explicit input is absent", async () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-probe-missing-"));
        temporaryDirectories.push(directory);
        const databasePath = join(directory, "missing.db");
        const manifest = await runEvidenceProbes([{ probeId: "security.audit-chain", probeVersion: 2 }], {
            commit: "commit-abc",
            buildId: "build-123",
            evaluatedAt,
            inputs: { auditDatabasePath: databasePath },
        });

        assert.equal(manifest.records[0]?.result, "not_evaluated");
        assert.equal(existsSync(databasePath), false);
    });

    it("emits valid passing evidence for an intact persisted chain", async () => {
        const directory = mkdtempSync(join(tmpdir(), "prism-probe-chain-"));
        temporaryDirectories.push(directory);
        const databasePath = join(directory, "activity.db");
        const store = new SqliteActivityStore(databasePath);
        const bus = new ActivityBus();
        bus.subscribe(store);
        bus.emit({
            sessionId: "probe-session",
            layer: "governance",
            operation: "probe-event",
            status: "succeeded",
            details: { source: "governance-probe-test" },
        });
        store.close();

        const manifest = await runEvidenceProbes([{ probeId: "security.audit-chain", probeVersion: 2 }], {
            commit: "commit-abc",
            buildId: "build-123",
            evaluatedAt,
            inputs: { auditDatabasePath: databasePath },
        });

        assert.equal(manifest.records.length, 1);
        assert.equal(manifest.records[0]?.result, "passed");
        assert.deepEqual(
            validateEvidenceManifest(manifest, {
                commit: "commit-abc",
                buildId: "build-123",
                now: new Date(evaluatedAt),
            }),
            [],
        );
    });
});
