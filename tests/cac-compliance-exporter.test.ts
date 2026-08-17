import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { CharacterAccountabilityStore } from "../src/core/accountability/character-accountability-store.js";
import { CacComplianceExporter } from "../src/core/accountability/cac-compliance-exporter.js";

describe("Character Accountability Control (CAC) Compliance Exporter", () => {
    let store: CharacterAccountabilityStore;
    let exporter: CacComplianceExporter;

    beforeEach(() => {
        store = new CharacterAccountabilityStore(":memory:");
        exporter = new CacComplianceExporter(store);
    });

    it("returns null when exporting non-existent operator", () => {
        const result = exporter.exportCertificate("nonexistent@example.com");
        assert.equal(result, null);
    });

    it("builds a cryptographically signed compliance bundle for an active operator", () => {
        const now = new Date().toISOString();
        store.save({
            assignmentId: "assign-12345",
            characterId: "aria-v1",
            prismUserId: "user-aria",
            prismUserEmail: "aria@nexus.local",
            operatorId: "kirk-lasalle",
            operatorEmail: "kirk@nexus.local",
            clientId: "client-desk-01",
            sessionId: "session-cert-01",
            executionProfileSegment: "business",
            workspaceHub: "Engineering HQ",
            state: "active",
            dispatchCount: 42,
            assignedAt: now,
            updatedAt: now,
            lastActiveAt: now,
            permissionScopes: [
                { scope: "skill.browser.inspect", expiresAt: null, maxTier: "tier1_autonomous" },
                { scope: "skill.terminal.exec", expiresAt: null, maxTier: "tier2_conditional" },
            ],
            emailVerifiedAt: now,
            emailVerifiedProvider: "gmail",
        });

        const bundle = exporter.exportCertificate("kirk@nexus.local");
        assert.ok(bundle);
        assert.equal(bundle.version, "1.0.0");
        assert.equal(bundle.identityTuple.operatorEmail, "kirk@nexus.local");
        assert.equal(bundle.identityTuple.characterId, "aria-v1");
        assert.equal(bundle.identityTuple.executionProfileSegment, "business");
        assert.equal(bundle.metrics.dispatchCount, 42);
        assert.equal(bundle.metrics.permissionScopesCount, 2);
        assert.ok(bundle.certificateId.startsWith("CAC-CERT-"));
        assert.ok(bundle.cryptographicVerification.digest.length === 64);
        assert.ok(bundle.cryptographicVerification.integrityProof.startsWith("PRISM-VERIFIED:"));

        // Format to Markdown
        const md = exporter.formatMarkdown(bundle);
        assert.ok(md.includes("PRISM CHARACTER ACCOUNTABILITY CONTROL (CAC) COMPLIANCE CERTIFICATE"));
        assert.ok(md.includes("kirk@nexus.local"));
        assert.ok(md.includes("aria-v1"));
        assert.ok(md.includes("PRISM-CAC-GOVERNANCE-2026"));
    });

    it("exports all certificates across multiple operators", () => {
        const now = new Date().toISOString();
        store.save({
            assignmentId: "assign-01",
            characterId: "aria",
            prismUserId: "aria-id",
            prismUserEmail: "aria@prism.local",
            operatorId: "op-1",
            operatorEmail: "op1@domain.com",
            clientId: "c1",
            sessionId: "s1",
            executionProfileSegment: "individual",
            workspaceHub: "Hub A",
            state: "active",
            dispatchCount: 10,
            assignedAt: now,
            updatedAt: now,
            lastActiveAt: now,
        });

        store.save({
            assignmentId: "assign-02",
            characterId: "sentinel",
            prismUserId: "sentinel-id",
            prismUserEmail: "sentinel@prism.local",
            operatorId: "op-2",
            operatorEmail: "op2@domain.com",
            clientId: "c2",
            sessionId: "s2",
            executionProfileSegment: "business",
            workspaceHub: "Hub B",
            state: "active",
            dispatchCount: 25,
            assignedAt: now,
            updatedAt: now,
            lastActiveAt: now,
        });

        const all = exporter.exportAll();
        assert.equal(all.length, 2);
        assert.equal(all[0].identityTuple.operatorEmail, "op1@domain.com");
        assert.equal(all[1].identityTuple.operatorEmail, "op2@domain.com");
    });
});
