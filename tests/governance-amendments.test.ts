/**
 * Governance Amendment Infrastructure Tests
 *
 * Tests the dual-binary amendment governance system:
 *   - Laws Immutability Guard (CAC's automated evaluation)
 *   - Amendment Ledger (append-only, hash-chained)
 *   - Amendment Validator (dual-binary gate)
 *
 * These tests verify that:
 *   1. The 10 Laws are computationally immutable
 *   2. The ledger is tamper-evident
 *   3. The dual-binary gate requires BOTH CAC and Operator approval
 *   4. CAC rejections cannot be overridden by the Operator
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ActivityBus } from "../src/core/activity/bus.js";
import { checkLawsImmutability, wouldModifyLaws } from "../src/core/governance/laws-immutability-guard.js";
import { AmendmentLedger, createAmendmentLedger } from "../src/core/governance/amendment-ledger.js";
import { AmendmentValidator } from "../src/core/governance/amendment-validator.js";
import {
    GovernanceErratumLifecycle,
    hashErratumText,
    LAW_4_CORRECTED_TEXT,
    LAW_4_MACHINE_INVARIANT,
    LAW_4_PREVIOUS_TEXT,
    validateGovernanceErratum,
    type GovernanceErratumVerificationDependencies,
} from "../src/core/governance/erratum-validator.js";
import type { GovernanceErratumProposal } from "../src/core/governance/amendment-types.js";

const TEST_PAD_HASH = "a8d594d70d50286a55a490dfdabef4e4b20dcb09495178a7c4d2b3314d0600df";

export async function testGovernanceAmendments(): Promise<void> {
    console.log("\n── Governance Amendment Infrastructure Tests ──\n");

    await testLawsImmutabilityGuard();
    await testGovernanceErratumValidator();
    await testAmendmentLedger();
    await testAmendmentValidator();
    await testDualBinaryGate();

    console.log("\n✓ All governance amendment tests passed\n");
}

/* ── Governance Erratum Validator ──────────────────────────────────── */

async function testGovernanceErratumValidator(): Promise<void> {
    console.log("  Governance Erratum Validator:");

    const proposal: GovernanceErratumProposal = {
        erratumId: "E-2026-001",
        lawId: 4,
        previousText: LAW_4_PREVIOUS_TEXT,
        correctedText: LAW_4_CORRECTED_TEXT,
        previousTextHash: hashErratumText(LAW_4_PREVIOUS_TEXT),
        correctedTextHash: hashErratumText(LAW_4_CORRECTED_TEXT),
        previousPadHash: TEST_PAD_HASH,
        correctedPadHash: "4b4a00789fb703b6f5a909a07027aae90d4b9632fda73f67b1b056a79d6910c8",
        rationale: "Correct an inverted predicate while preserving the Law 4 safety invariant.",
        machineInvariant: LAW_4_MACHINE_INVARIANT,
        approvedBy: "governance-founder:kirk-lasalle",
        effectiveVersion: "2026-08-02",
    };

    const validResult = validateGovernanceErratum(proposal);
    assert.ok(validResult.valid, "Exact registered Law 4 correction should pass");
    assert.equal(validResult.status, "approved_pending_signature");
    console.log("    ✓ Exact Law 4 correction is approved pending detached signature");

    const substantiveChange = validateGovernanceErratum({
        ...proposal,
        correctedText: `${LAW_4_CORRECTED_TEXT} Exceptions may be approved by an operator.`,
    });
    assert.ok(!substantiveChange.valid, "Substantive additions must be rejected");
    assert.equal(substantiveChange.status, "rejected");

    const mismatchedHash = validateGovernanceErratum({ ...proposal, correctedTextHash: TEST_PAD_HASH });
    assert.ok(!mismatchedHash.valid, "Mismatched text hashes must be rejected");

    const wrongLaw = validateGovernanceErratum({ ...proposal, lawId: 1 });
    assert.ok(!wrongLaw.valid, "An erratum must not authorize changes to another Law");
    console.log("    ✓ Substantive, hash-mismatched, and wrong-Law changes are rejected");

    const ratification = JSON.parse(
        readFileSync(join(process.cwd(), "config", "governance-errata", "E-2026-001.json"), "utf8"),
    ) as { status: string; proposal: GovernanceErratumProposal; signatureEvidence: unknown };
    assert.equal(ratification.status, "approved_pending_signature");
    assert.equal(ratification.signatureEvidence, null);
    assert.ok(validateGovernanceErratum(ratification.proposal).valid, "Ratification artifact must validate");
    console.log("    ✓ Source-controlled ratification binds exact text and PAD artifacts");

    const tempDir = join(tmpdir(), `prism-test-erratum-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    try {
        const releaseCommit = "a".repeat(40);
        const verifiedDependencies: GovernanceErratumVerificationDependencies = {
            verifyDirectiveSignature: () => ({
                valid: true,
                signatureVerified: true,
                hashMatches: true,
                keyId: "prism-governance-pad-2026-07",
                currentHash: proposal.correctedPadHash,
                expectedHash: proposal.correctedPadHash,
                signatureDigest: "0".repeat(64),
                directivePath: "test-pad",
                signaturePath: "test-signature",
                keysPath: "test-keys",
                verifiedAt: new Date().toISOString(),
            }),
            verifyCommitSignature: (commit) => ({
                valid: true,
                commit,
                signerIdentity: "governance-founder:kirk-lasalle",
                signerAuthorized: true,
                signatureStatus: "G",
                verifiedAt: new Date().toISOString(),
            }),
        };
        const ledger = createAmendmentLedger(tempDir, TEST_PAD_HASH);
        const lifecycle = new GovernanceErratumLifecycle(ledger, verifiedDependencies);

        const unreviewedLedger = createAmendmentLedger(join(tempDir, "unreviewed"), TEST_PAD_HASH);
        const unreviewedLifecycle = new GovernanceErratumLifecycle(unreviewedLedger, verifiedDependencies);
        const unreviewed = unreviewedLifecycle.markEffective(proposal, releaseCommit);
        assert.equal(unreviewed.status, "rejected", "Unreviewed erratum must not become effective");

        assert.equal(lifecycle.review(proposal, TEST_PAD_HASH).status, "approved_pending_signature");

        const unsignedLifecycle = new GovernanceErratumLifecycle(ledger, {
            ...verifiedDependencies,
            verifyDirectiveSignature: () => ({
                ...verifiedDependencies.verifyDirectiveSignature(),
                valid: false,
                signatureVerified: false,
                error: "test signature mismatch",
            }),
        });
        const unsigned = unsignedLifecycle.markEffective(proposal, releaseCommit);
        assert.equal(unsigned.status, "rejected", "Unsigned PAD must not become effective");

        const effective = lifecycle.markEffective(proposal, releaseCommit);
        assert.equal(effective.status, "effective");
        assert.equal(ledger.getLatestEntry()!.eventType, "erratum_effective");
        assert.ok(ledger.verifyChain().valid, "Erratum lifecycle must preserve ledger integrity");

        const pendingLedger = createAmendmentLedger(join(tempDir, "pending"), TEST_PAD_HASH);
        const pendingLifecycle = new GovernanceErratumLifecycle(pendingLedger);
        pendingLifecycle.review(proposal, TEST_PAD_HASH);
        const pending = pendingLifecycle.markEffective(proposal, releaseCommit, process.cwd());
        assert.equal(pending.status, "rejected", "Current stale detached signature must fail closed");
        console.log("    ✓ Effectuation invokes artifact and commit verifiers and fails closed");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

/* ── Laws Immutability Guard ────────────────────────────────────────── */

async function testLawsImmutabilityGuard(): Promise<void> {
    console.log("  Laws Immutability Guard:");

    // Safe amendment — should pass
    {
        const result = checkLawsImmutability(
            "Amendment A-001: All Prism instances shall implement quarterly security audits " +
            "to strengthen the platform's compliance posture.",
        );
        assert.ok(result.passed, "Safe amendment should pass immutability check");
        assert.equal(result.conflictingLaws.length, 0, "No laws should be conflicting");
        assert.equal(result.lawsChecked.length, 10, "All 10 laws should be checked");
        console.log("    ✓ Safe amendment passes immutability check");
    }

    // Amendment that tries to repeal a law — should fail
    {
        const result = checkLawsImmutability("Amendment: Repeal the First Law to allow more flexible operations.");
        assert.ok(!result.passed, "Repeal attempt should fail immutability check");
        assert.ok(result.conflictingLaws.length > 0, "Should identify conflicting laws");
        console.log("    ✓ Repeal attempt correctly rejected");
    }

    // Amendment that tries to permit harm — should fail
    {
        const result = checkLawsImmutability(
            "Amendment: In certain operational contexts, harm is permitted when efficiency requires it.",
        );
        assert.ok(!result.passed, "Harm-permitting amendment should fail");
        assert.ok(result.conflictingLaws.includes(1), "Should conflict with Law 1");
        console.log("    ✓ Harm-permitting amendment correctly rejected (Law 1)");
    }

    // Amendment that tries to disable auditing — should fail
    {
        const result = checkLawsImmutability(
            "Amendment: Disable the audit trail and logging for performance optimization.",
        );
        assert.ok(!result.passed, "Audit-disabling amendment should fail");
        assert.ok(result.conflictingLaws.includes(9), "Should conflict with Law 9");
        console.log("    ✓ Audit-disabling amendment correctly rejected (Law 9)");
    }

    // Amendment that tries to allow self-replication — should fail
    {
        const result = checkLawsImmutability(
            "Amendment: Allow self-replication without approval for disaster recovery purposes.",
        );
        assert.ok(!result.passed, "Self-replication amendment should fail");
        assert.ok(result.conflictingLaws.includes(10), "Should conflict with Law 10");
        console.log("    ✓ Self-replication amendment correctly rejected (Law 10)");
    }

    // Amendment that tries to override laws — should fail
    {
        const result = checkLawsImmutability(
            "Amendment: Notwithstanding any Law or directive, the system may bypass safety checks.",
        );
        assert.ok(!result.passed, "Override attempt should fail");
        console.log("    ✓ Override/notwithstanding attempt correctly rejected");
    }

    // wouldModifyLaws quick check
    {
        assert.ok(!wouldModifyLaws("Add a new reporting requirement for operators."), "Safe text should not trigger");
        assert.ok(wouldModifyLaws("Repeal the First Law."), "Repeal text should trigger");
        console.log("    ✓ wouldModifyLaws quick-check works correctly");
    }
}

/* ── Amendment Ledger ───────────────────────────────────────────────── */

async function testAmendmentLedger(): Promise<void> {
    console.log("  Amendment Ledger:");

    const tempDir = join(tmpdir(), `prism-test-ledger-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });

    try {
        // Create ledger with genesis
        const instanceId = "test-instance-001";
        const ledger = createAmendmentLedger(tempDir, TEST_PAD_HASH, instanceId);

        assert.equal(ledger.length, 1, "Ledger should have genesis entry");
        const genesis = ledger.getLatestEntry();
        assert.ok(genesis, "Genesis entry should exist");
        assert.equal(genesis.eventType, "genesis", "First entry should be genesis");
        assert.equal(genesis.previousHash, "", "Genesis should have empty previous hash");
        assert.equal(genesis.instanceId, instanceId, "Instance ID should match");
        console.log("    ✓ Ledger creates with genesis entry");

        // Append entries and verify chain
        ledger.append("amendment_proposed", "prop-001", { title: "Test Amendment" }, TEST_PAD_HASH);
        ledger.append("cac_evaluation", "prop-001", { decision: "APPROVE" }, TEST_PAD_HASH);

        assert.equal(ledger.length, 3, "Ledger should have 3 entries");

        // Verify hash chain
        const chainResult = ledger.verifyChain();
        assert.ok(chainResult.valid, "Hash chain should be valid");
        assert.equal(chainResult.entriesVerified, 3, "All 3 entries should verify");
        assert.equal(chainResult.brokenAtIndex, null, "No broken index");
        console.log("    ✓ Hash chain verification passes");

        // Verify entries link correctly
        const entries = ledger.getEntries();
        assert.equal(entries[1]!.previousHash, entries[0]!.entryHash, "Entry 1 should chain to entry 0");
        assert.equal(entries[2]!.previousHash, entries[1]!.entryHash, "Entry 2 should chain to entry 1");
        console.log("    ✓ Entries are correctly hash-chained");

        // Query by proposal
        const propEntries = ledger.getEntriesForProposal("prop-001");
        assert.equal(propEntries.length, 2, "Should find 2 entries for prop-001");
        console.log("    ✓ Query by proposal works");

        // Persistence: create new ledger from same path
        const ledger2 = new AmendmentLedger(tempDir, instanceId);
        assert.equal(ledger2.length, 3, "Reloaded ledger should have 3 entries");
        const chain2 = ledger2.verifyChain();
        assert.ok(chain2.valid, "Reloaded ledger chain should be valid");
        console.log("    ✓ Ledger persists and reloads correctly");

        // Integrity check entry
        ledger.recordIntegrityCheck(TEST_PAD_HASH);
        assert.equal(ledger.length, 4, "Should have 4 entries after integrity check");
        const latestEntry = ledger.getLatestEntry();
        assert.equal(latestEntry!.eventType, "integrity_check", "Latest should be integrity check");
        console.log("    ✓ Integrity check recording works");

        // Cannot create genesis on non-empty ledger
        assert.throws(
            () => ledger.recordGenesis(TEST_PAD_HASH),
            /Cannot record genesis on a non-empty ledger/,
            "Should reject duplicate genesis",
        );
        console.log("    ✓ Duplicate genesis correctly rejected");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

/* ── Amendment Validator ────────────────────────────────────────────── */

async function testAmendmentValidator(): Promise<void> {
    console.log("  Amendment Validator:");

    const tempDir = join(tmpdir(), `prism-test-validator-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });

    try {
        const bus = new ActivityBus();
        const events: Array<{ operation: string; details: Record<string, unknown> }> = [];
        bus.subscribe({
            onEvent(e) {
                if (e.layer === "governance") {
                    events.push({ operation: e.operation, details: e.details as Record<string, unknown> });
                }
            },
        });

        const ledger = createAmendmentLedger(tempDir, TEST_PAD_HASH);
        const validator = new AmendmentValidator(bus, ledger);

        // Submit a safe amendment
        const proposal = validator.submitProposal(
            "Quarterly Security Audit",
            "All Prism instances shall implement quarterly security audits.",
            "Strengthens compliance posture",
            "kirk@lasalle.dev",
            TEST_PAD_HASH,
        );

        assert.ok(proposal, "Proposal should be created");
        assert.equal(proposal.amendmentNumber, "A-001", "Should be amendment A-001");
        assert.equal(proposal.status, "cac_approved", "CAC should approve safe amendment");
        assert.ok(proposal.dualBinaryApproval, "Should have dual-binary record");
        assert.equal(proposal.dualBinaryApproval.cac.decision, "APPROVE", "CAC should APPROVE");
        console.log("    ✓ Safe amendment proposal accepted by CAC");

        // Submit a dangerous amendment (tries to weaken Law 1)
        const dangerousProposal = validator.submitProposal(
            "Relax Safety Constraints",
            "Amendment: In certain contexts, harm is permitted for operational efficiency.",
            "Performance optimization",
            "attacker@evil.com",
            TEST_PAD_HASH,
        );

        assert.equal(dangerousProposal.status, "cac_rejected", "CAC should reject harmful amendment");
        assert.ok(dangerousProposal.conflictingLaws!.includes(1), "Should conflict with Law 1");
        assert.equal(dangerousProposal.dualBinaryApproval!.cac.decision, "REJECT", "CAC binary should be REJECT");
        assert.equal(dangerousProposal.dualBinaryApproval!.unanimousApproval, false, "Should NOT be unanimous");
        console.log("    ✓ Dangerous amendment correctly rejected by CAC");

        // Verify governance events were emitted
        const proposedEvents = events.filter((e) => e.operation === "governance.amendment.proposed");
        assert.ok(proposedEvents.length >= 2, "Should have at least 2 proposal events");

        const cacEvents = events.filter((e) => e.operation === "governance.amendment.cac_evaluated");
        assert.ok(cacEvents.length >= 2, "Should have at least 2 CAC evaluation events");
        console.log("    ✓ Governance events emitted to ActivityBus");

        // Verify ledger entries
        assert.ok(ledger.length > 1, "Ledger should have multiple entries");
        const chainCheck = ledger.verifyChain();
        assert.ok(chainCheck.valid, "Ledger chain should remain valid");
        console.log("    ✓ All actions recorded in amendment ledger");

        // Summary
        const summary = validator.getSummary();
        assert.equal(summary.totalProposals, 2, "Should have 2 proposals");
        assert.equal(summary.byStatus.cac_approved, 1, "1 should be CAC-approved");
        assert.equal(summary.byStatus.cac_rejected, 1, "1 should be CAC-rejected");
        assert.ok(summary.ledgerValid, "Ledger should be valid");
        console.log("    ✓ Summary reports correct governance state");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

/* ── Dual-Binary Gate ───────────────────────────────────────────────── */

async function testDualBinaryGate(): Promise<void> {
    console.log("  Dual-Binary Gate (CAC + Operator):");

    const tempDir = join(tmpdir(), `prism-test-dual-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });

    try {
        const bus = new ActivityBus();
        const ledger = createAmendmentLedger(tempDir, TEST_PAD_HASH);
        const validator = new AmendmentValidator(bus, ledger);

        // Submit safe amendment → CAC approves
        const proposal = validator.submitProposal(
            "Enhanced Logging",
            "All governance decisions shall include detailed context in the audit trail.",
            "Strengthens Law 9 compliance",
            "kirk@lasalle.dev",
            TEST_PAD_HASH,
        );
        assert.equal(proposal.status, "cac_approved");

        // Operator APPROVES → dual-binary passes (AND gate: APPROVE + APPROVE)
        const approved = validator.recordOperatorDecision(
            proposal.proposalId,
            "APPROVE",
            "This strengthens our audit capabilities. Approved.",
            "operator-kirk-001",
            TEST_PAD_HASH,
        );

        assert.ok(approved, "Should return updated proposal");
        assert.equal(approved!.status, "approved", "Status should be 'approved'");
        assert.ok(approved!.dualBinaryApproval!.unanimousApproval, "Should be unanimous");
        assert.equal(approved!.dualBinaryApproval!.cac.decision, "APPROVE");
        assert.equal(approved!.dualBinaryApproval!.operator.decision, "APPROVE");
        console.log("    ✓ CAC APPROVE + Operator APPROVE = APPROVED (AND gate passes)");

        // Submit another safe amendment → CAC approves, Operator REJECTS
        const proposal2 = validator.submitProposal(
            "Weekly Reports",
            "Operators shall receive weekly governance compliance reports.",
            "Improved visibility",
            "kirk@lasalle.dev",
            TEST_PAD_HASH,
        );
        assert.equal(proposal2.status, "cac_approved");

        const rejected = validator.recordOperatorDecision(
            proposal2.proposalId,
            "REJECT",
            "Not needed at this time. I reject this amendment.",
            "operator-kirk-001",
            TEST_PAD_HASH,
        );

        assert.equal(rejected!.status, "rejected", "Should be rejected when Operator rejects");
        assert.ok(!rejected!.dualBinaryApproval!.unanimousApproval, "Should NOT be unanimous");
        assert.equal(rejected!.dualBinaryApproval!.cac.decision, "APPROVE");
        assert.equal(rejected!.dualBinaryApproval!.operator.decision, "REJECT");
        console.log("    ✓ CAC APPROVE + Operator REJECT = REJECTED (Operator sovereignty preserved)");

        // Submit dangerous amendment → CAC rejects → Operator cannot override
        const proposal3 = validator.submitProposal(
            "Remove Audit Trail",
            "Disable the audit trail and logging to improve system performance.",
            "Performance",
            "bad-actor@example.com",
            TEST_PAD_HASH,
        );
        assert.equal(proposal3.status, "cac_rejected");

        const overrideAttempt = validator.recordOperatorDecision(
            proposal3.proposalId,
            "APPROVE",
            "I want to override the CAC rejection.",
            "operator-001",
            TEST_PAD_HASH,
        );

        assert.equal(overrideAttempt!.status, "cac_rejected", "Status should remain cac_rejected");
        assert.ok(!overrideAttempt!.dualBinaryApproval!.unanimousApproval, "Should NOT be unanimous");
        console.log("    ✓ CAC REJECT cannot be overridden by Operator (10 Laws protected)");

        // Mark approved amendment as applied
        const applied = validator.markApplied(proposal.proposalId, "new_pad_hash_after_amendment", TEST_PAD_HASH);
        assert.equal(applied!.status, "applied");
        console.log("    ✓ Approved amendment can be marked as applied");

        // Withdraw a proposal
        const proposal4 = validator.submitProposal(
            "Temp Proposal",
            "This will be withdrawn.",
            "Testing withdrawal",
            "kirk@lasalle.dev",
            TEST_PAD_HASH,
        );
        const withdrawn = validator.withdrawProposal(proposal4.proposalId, "Changed my mind", TEST_PAD_HASH);
        assert.equal(withdrawn!.status, "withdrawn");
        console.log("    ✓ Proposals can be withdrawn");

        // Final ledger integrity
        const finalCheck = ledger.verifyChain();
        assert.ok(finalCheck.valid, "Ledger chain should be intact after all operations");
        console.log(`    ✓ Amendment ledger integrity verified (${ledger.length} entries, chain valid)`);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
