import { describe, it } from "mocha";
import * as assert from "assert";
import {
    REASON_CODE_TAXONOMY,
    TAXONOMY_CODES,
    lookupReasonCode,
    codesByDomain,
    codesAtOrAboveSeverity,
    validateCodes,
    taxonomySize,
    type ReasonCodeDomain,
    type ReasonCodeSeverity,
} from "../src/core/policy/reason-code-taxonomy.js";
import { POLICY_REASON_CODES } from "../src/core/policy/reason-codes.js";

/* ──────────────────────────────────────────────────────
 *  Taxonomy Structural Integrity
 * ────────────────────────────────────────────────────── */
describe("Reason-Code Taxonomy — Structural Integrity", () => {
    it("has no duplicate codes in the taxonomy", () => {
        const codes = REASON_CODE_TAXONOMY.map(e => e.code);
        const unique = new Set(codes);
        assert.strictEqual(codes.length, unique.size, `Duplicate codes found: ${codes.filter((c, i) => codes.indexOf(c) !== i).join(", ")}`);
    });

    it("every entry has a non-empty code, domain, severity, and description", () => {
        for (const entry of REASON_CODE_TAXONOMY) {
            assert.ok(entry.code.length > 0, `Entry has empty code`);
            assert.ok(entry.domain.length > 0, `${entry.code} has empty domain`);
            assert.ok(entry.severity.length > 0, `${entry.code} has empty severity`);
            assert.ok(entry.description.length > 10, `${entry.code} has too-short description`);
        }
    });

    it("all POLICY_REASON_CODES are present in the taxonomy", () => {
        for (const code of Object.values(POLICY_REASON_CODES)) {
            const entry = lookupReasonCode(code);
            assert.ok(entry, `POLICY_REASON_CODE '${code}' missing from taxonomy`);
        }
    });

    it("all TAXONOMY_CODES are present in the taxonomy", () => {
        for (const code of Object.values(TAXONOMY_CODES)) {
            const entry = lookupReasonCode(code);
            assert.ok(entry, `TAXONOMY_CODE '${code}' missing from taxonomy`);
        }
    });

    it("taxonomy size equals POLICY_REASON_CODES + TAXONOMY_CODES", () => {
        const policyCount = Object.keys(POLICY_REASON_CODES).length;
        const taxonomyExtCount = Object.keys(TAXONOMY_CODES).length;
        assert.strictEqual(taxonomySize(), policyCount + taxonomyExtCount);
    });

    it("severity values are restricted to known enum", () => {
        const validSeverities: ReasonCodeSeverity[] = ["info", "warn", "deny", "critical"];
        for (const entry of REASON_CODE_TAXONOMY) {
            assert.ok(validSeverities.includes(entry.severity), `${entry.code} has invalid severity '${entry.severity}'`);
        }
    });

    it("domain values are restricted to known enum", () => {
        const validDomains: ReasonCodeDomain[] = [
            "governance", "directive", "trust", "identity",
            "spectrum_refraction", "agent", "computer_use", "workflow",
        ];
        for (const entry of REASON_CODE_TAXONOMY) {
            assert.ok(validDomains.includes(entry.domain), `${entry.code} has invalid domain '${entry.domain}'`);
        }
    });
});

/* ──────────────────────────────────────────────────────
 *  Domain Coverage
 * ────────────────────────────────────────────────────── */
describe("Reason-Code Taxonomy — Domain Coverage", () => {
    const expectedDomains: ReasonCodeDomain[] = [
        "governance", "directive", "trust", "identity",
        "spectrum_refraction", "agent", "computer_use", "workflow",
    ];

    for (const domain of expectedDomains) {
        it(`has at least one code in the '${domain}' domain`, () => {
            const codes = codesByDomain(domain);
            assert.ok(codes.length > 0, `No codes found for domain '${domain}'`);
        });
    }

    it("governance domain includes all risk-level policy codes", () => {
        const govCodes = codesByDomain("governance").map(e => e.code);
        assert.ok(govCodes.includes(POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED));
        assert.ok(govCodes.includes(POLICY_REASON_CODES.MEDIUM_RISK_DENY_MISSING_ROLLBACK));
        assert.ok(govCodes.includes(POLICY_REASON_CODES.LOW_RISK_ALLOW_AUTONOMOUS));
    });

    it("trust domain includes plugin validation codes", () => {
        const trustCodes = codesByDomain("trust").map(e => e.code);
        assert.ok(trustCodes.includes(TAXONOMY_CODES.TRUST_LEVEL_BELOW_MIN));
        assert.ok(trustCodes.includes(TAXONOMY_CODES.PLUGIN_VALIDATION_PASSED));
        assert.ok(trustCodes.includes(TAXONOMY_CODES.PLUGIN_VALIDATION_FAILED));
    });

    it("spectrum_refraction domain includes isolation level codes", () => {
        const srCodes = codesByDomain("spectrum_refraction").map(e => e.code);
        assert.ok(srCodes.includes(TAXONOMY_CODES.SR_ISOLATION_FULL));
        assert.ok(srCodes.includes(TAXONOMY_CODES.SR_ISOLATION_MODEL));
        assert.ok(srCodes.includes(TAXONOMY_CODES.SR_ISOLATION_INSUFFICIENT));
    });

    it("agent domain includes all swarm topology codes", () => {
        const agentCodes = codesByDomain("agent").map(e => e.code);
        assert.ok(agentCodes.includes(TAXONOMY_CODES.SWARM_TOPOLOGY_MESH));
        assert.ok(agentCodes.includes(TAXONOMY_CODES.SWARM_TOPOLOGY_STAR));
        assert.ok(agentCodes.includes(TAXONOMY_CODES.SWARM_TOPOLOGY_PIPELINE));
        assert.ok(agentCodes.includes(TAXONOMY_CODES.SWARM_TOPOLOGY_BROADCAST));
    });

    it("computer_use domain includes terminal and container codes", () => {
        const cuCodes = codesByDomain("computer_use").map(e => e.code);
        assert.ok(cuCodes.includes(TAXONOMY_CODES.TERMINAL_SESSION_CREATED));
        assert.ok(cuCodes.includes(TAXONOMY_CODES.CONTAINER_CREATED));
        assert.ok(cuCodes.includes(TAXONOMY_CODES.CONTAINER_DESTROYED));
    });
});

/* ──────────────────────────────────────────────────────
 *  Lookup & Utility Functions
 * ────────────────────────────────────────────────────── */
describe("Reason-Code Taxonomy — Lookup Utilities", () => {
    it("lookupReasonCode returns correct entry for known code", () => {
        const entry = lookupReasonCode(POLICY_REASON_CODES.HIGH_RISK_APPROVAL_REQUIRED);
        assert.ok(entry);
        assert.strictEqual(entry!.code, "HIGH_RISK_APPROVAL_REQUIRED");
        assert.strictEqual(entry!.domain, "governance");
        assert.strictEqual(entry!.severity, "deny");
    });

    it("lookupReasonCode returns undefined for unknown code", () => {
        const entry = lookupReasonCode("TOTALLY_UNKNOWN_CODE_XYZ");
        assert.strictEqual(entry, undefined);
    });

    it("codesAtOrAboveSeverity('critical') returns only critical entries", () => {
        const critical = codesAtOrAboveSeverity("critical");
        assert.ok(critical.length > 0);
        for (const entry of critical) {
            assert.strictEqual(entry.severity, "critical");
        }
    });

    it("codesAtOrAboveSeverity('deny') returns deny + critical entries", () => {
        const denyCritical = codesAtOrAboveSeverity("deny");
        const allCritical = codesAtOrAboveSeverity("critical");
        assert.ok(denyCritical.length >= allCritical.length);
        for (const entry of denyCritical) {
            assert.ok(entry.severity === "deny" || entry.severity === "critical");
        }
    });

    it("codesAtOrAboveSeverity('info') returns all entries", () => {
        const all = codesAtOrAboveSeverity("info");
        assert.strictEqual(all.length, taxonomySize());
    });

    it("validateCodes returns empty array for all known codes", () => {
        const allCodes = REASON_CODE_TAXONOMY.map(e => e.code);
        const unknown = validateCodes(allCodes);
        assert.strictEqual(unknown.length, 0);
    });

    it("validateCodes returns unknown codes correctly", () => {
        const unknown = validateCodes(["HIGH_RISK_APPROVAL_REQUIRED", "FAKE_CODE_1", "FAKE_CODE_2"]);
        assert.strictEqual(unknown.length, 2);
        assert.ok(unknown.includes("FAKE_CODE_1"));
        assert.ok(unknown.includes("FAKE_CODE_2"));
    });
});
