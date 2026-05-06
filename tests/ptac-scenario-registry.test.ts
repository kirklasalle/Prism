/**
 * PTAC scenario registry — structural tests.
 *
 * These tests exercise the registry without any network calls. They assert:
 *
 *   1. The side-effect imports in `src/ptac/index.ts` populate the registry
 *      so `npm run ptac:*` and the CLI never see an empty registry by accident.
 *   2. Each registered scenario has unique step IDs.
 *   3. Each scenario participates in at least one suite.
 *   4. `requiresHost` is set to `true` if any step kind is host-only
 *      (currently: clickAt, typeText, screenshotDiff). This is the
 *      governance rule that prevents a "host-only" scenario from leaking
 *      into the sandbox suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "mocha";

// Trigger scenario registration via the public surface.
import "../src/ptac/index.js";
import { listScenarios } from "../src/ptac/scenario-registry.js";

const HOST_ONLY_KINDS = new Set(["clickAt", "typeText", "screenshotDiff", "computerUse"]);

describe("PTAC scenario registry", () => {
    it("registers at least one scenario via the public index", () => {
        const all = listScenarios();
        assert.ok(all.length >= 1, `expected ≥1 scenario, got ${all.length}`);
    });

    it("includes s01-setup-individual in the fast, full, and demo suites", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        const demo = listScenarios({ suite: "demo" }).map((s) => s.id);
        assert.ok(fast.includes("s01-setup-individual"), "s01 must be in fast");
        assert.ok(full.includes("s01-setup-individual"), "s01 must be in full");
        assert.ok(demo.includes("s01-setup-individual"), "s01 must be in demo");
    });

    it("includes s02-setup-business-cac-block in the fast and full suites (R3 negative)", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        assert.ok(fast.includes("s02-setup-business-cac-block"), "s02 must be in fast");
        assert.ok(full.includes("s02-setup-business-cac-block"), "s02 must be in full");
    });

    it("s02 asserts expectCacBlock=true with a placeholder operator email and profile=business", () => {
        const all = listScenarios();
        const s02 = all.find((s) => s.id === "s02-setup-business-cac-block");
        assert.ok(s02, "s02 must be registered");
        const wizardStep = s02.steps.find((step) => step.kind === "setupWizard");
        assert.ok(wizardStep, "s02 must contain a setupWizard step");
        if (wizardStep.kind !== "setupWizard") throw new Error("type narrowing");
        assert.strictEqual(wizardStep.profile, "business", "s02 must target the business profile");
        assert.strictEqual(wizardStep.expectCacBlock, true, "s02 must assert expectCacBlock=true");
        assert.match(
            wizardStep.operatorEmail,
            /@(prism\.local|example\.com|example\.org)$/,
            "s02 must use a placeholder operator email so R3 fail-fast actually triggers",
        );
    });

    it("includes s03-chat-tier1-capability in the fast, full, and demo suites", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        const demo = listScenarios({ suite: "demo" }).map((s) => s.id);
        assert.ok(fast.includes("s03-chat-tier1-capability"), "s03 must be in fast");
        assert.ok(full.includes("s03-chat-tier1-capability"), "s03 must be in full");
        assert.ok(demo.includes("s03-chat-tier1-capability"), "s03 must be in demo");
    });

    it("s03 records expectedTier=1 and does NOT require approval", () => {
        const s03 = listScenarios().find((s) => s.id === "s03-chat-tier1-capability");
        assert.ok(s03, "s03 must be registered");
        const chatStep = s03.steps.find((step) => step.kind === "chat");
        assert.ok(chatStep, "s03 must contain a chat step");
        if (chatStep.kind !== "chat") throw new Error("type narrowing");
        assert.strictEqual(chatStep.expectedTier, 1, "s03 must record expectedTier=1");
        assert.notStrictEqual(
            chatStep.expectApprovalRequired,
            true,
            "s03 must not require approval (Tier-1 capability)",
        );
    });

    it("includes s04-setup-individual-cac-block in the fast and full suites (R3 negative, individual mirror)", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        assert.ok(fast.includes("s04-setup-individual-cac-block"), "s04 must be in fast");
        assert.ok(full.includes("s04-setup-individual-cac-block"), "s04 must be in full");
    });

    it("s04 asserts expectCacBlock=true with a placeholder operator email and profile=individual", () => {
        const s04 = listScenarios().find((s) => s.id === "s04-setup-individual-cac-block");
        assert.ok(s04, "s04 must be registered");
        const wizardStep = s04.steps.find((step) => step.kind === "setupWizard");
        assert.ok(wizardStep, "s04 must contain a setupWizard step");
        if (wizardStep.kind !== "setupWizard") throw new Error("type narrowing");
        assert.strictEqual(wizardStep.profile, "individual", "s04 must target the individual profile");
        assert.strictEqual(wizardStep.expectCacBlock, true, "s04 must assert expectCacBlock=true");
        assert.match(
            wizardStep.operatorEmail,
            /@(prism\.local|example\.com|example\.org)$/,
            "s04 must use a placeholder operator email so R3 fail-fast actually triggers",
        );
    });

    it("includes s05-chat-tier2-approval-required in the fast and full suites (NOT demo)", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        const demo = listScenarios({ suite: "demo" }).map((s) => s.id);
        assert.ok(fast.includes("s05-chat-tier2-approval-required"), "s05 must be in fast");
        assert.ok(full.includes("s05-chat-tier2-approval-required"), "s05 must be in full");
        assert.ok(
            !demo.includes("s05-chat-tier2-approval-required"),
            "s05 must NOT be in demo (would leave dangling approvals)",
        );
    });

    it("s05 records expectedTier=2 and asserts expectApprovalRequired=true", () => {
        const s05 = listScenarios().find((s) => s.id === "s05-chat-tier2-approval-required");
        assert.ok(s05, "s05 must be registered");
        const chatStep = s05.steps.find((step) => step.kind === "chat");
        assert.ok(chatStep, "s05 must contain a chat step");
        if (chatStep.kind !== "chat") throw new Error("type narrowing");
        assert.strictEqual(chatStep.expectedTier, 2, "s05 must record expectedTier=2");
        assert.strictEqual(
            chatStep.expectApprovalRequired,
            true,
            "s05 must assert expectApprovalRequired=true (Tier-2 must surface a pending approval)",
        );
    });

    it("includes s06-chat-tier3-deny in the fast and full suites (NOT demo)", () => {
        const fast = listScenarios({ suite: "fast" }).map((s) => s.id);
        const full = listScenarios({ suite: "full" }).map((s) => s.id);
        const demo = listScenarios({ suite: "demo" }).map((s) => s.id);
        assert.ok(fast.includes("s06-chat-tier3-deny"), "s06 must be in fast");
        assert.ok(full.includes("s06-chat-tier3-deny"), "s06 must be in full");
        assert.ok(
            !demo.includes("s06-chat-tier3-deny"),
            "s06 must NOT be in demo (deny semantics belong in safety-critical band)",
        );
    });

    it("s06 records expectedTier=3, asserts expectDeny=true, and does not request approval", () => {
        const s06 = listScenarios().find((s) => s.id === "s06-chat-tier3-deny");
        assert.ok(s06, "s06 must be registered");
        const chatStep = s06.steps.find((step) => step.kind === "chat");
        assert.ok(chatStep, "s06 must contain a chat step");
        if (chatStep.kind !== "chat") throw new Error("type narrowing");
        assert.strictEqual(chatStep.expectedTier, 3, "s06 must record expectedTier=3");
        assert.strictEqual(
            chatStep.expectDeny,
            true,
            "s06 must assert expectDeny=true (Tier-3 must be denied outright)",
        );
        assert.notStrictEqual(
            chatStep.expectApprovalRequired,
            true,
            "s06 must NOT set expectApprovalRequired (deny is mutually exclusive with approval)",
        );
    });

    it("scenario IDs are unique across the registry", () => {
        const ids = listScenarios().map((s) => s.id);
        const unique = new Set(ids);
        assert.strictEqual(ids.length, unique.size, `duplicate scenario id detected: [${ids.join(", ")}]`);
    });

    it("every scenario has unique step IDs", () => {
        for (const scenario of listScenarios()) {
            const seen = new Set<string>();
            for (const step of scenario.steps) {
                assert.ok(!seen.has(step.id), `duplicate step id ${step.id} in ${scenario.id}`);
                seen.add(step.id);
            }
        }
    });

    it("every scenario participates in ≥1 suite", () => {
        for (const scenario of listScenarios()) {
            assert.ok(
                scenario.suites.length >= 1,
                `${scenario.id} must declare at least one suite`,
            );
        }
    });

    it("scenarios with host-only step kinds set requiresHost=true", () => {
        for (const scenario of listScenarios()) {
            const hasHostOnly = scenario.steps.some((s) => HOST_ONLY_KINDS.has(s.kind));
            if (hasHostOnly) {
                assert.strictEqual(
                    scenario.requiresHost,
                    true,
                    `${scenario.id} uses a host-only step kind but does not set requiresHost=true`,
                );
            }
        }
    });

    /* ── Self-drive expansion (s07–s14) ────────────────────────────────── */

    it("registers all eight self-drive scenarios (s07–s14)", () => {
        const ids = new Set(listScenarios().map((s) => s.id));
        for (const id of [
            "s07-self-drive-chat-tier1",
            "s08-self-drive-tier2-approval",
            "s09-self-drive-tier3-deny",
            "s10-self-drive-browser-shell",
            "s11-self-drive-wizard-render",
            "s12-self-drive-tab-smoke",
            "s13-self-drive-desktop-screenshot",
            "s14-self-drive-kill-switch-ui",
        ]) {
            assert.ok(ids.has(id), `expected scenario "${id}" to be registered`);
        }
    });

    it("s13 (computer-use desktop screenshot) requires the host profile", () => {
        const s13 = listScenarios().find((s) => s.id === "s13-self-drive-desktop-screenshot");
        assert.ok(s13, "s13 must be registered");
        assert.strictEqual(s13.requiresHost, true, "s13 must set requiresHost=true (computer-use is host-only)");
        const cu = s13.steps.find((step) => step.kind === "computerUse");
        assert.ok(cu, "s13 must contain a computerUse step");
    });

    it("browser-drive scenarios launch before any other browser action", () => {
        for (const scenario of listScenarios()) {
            const browserSteps = scenario.steps.filter((s) => s.kind === "browserDrive");
            if (browserSteps.length === 0) continue;
            const firstAction = browserSteps[0];
            if (firstAction.kind !== "browserDrive") throw new Error("type narrowing");
            assert.strictEqual(
                firstAction.action,
                "launch",
                `${scenario.id}: first browserDrive step must be "launch", got "${firstAction.action}"`,
            );
        }
    });

    it("s08 records expectedTier=2 and expectApprovalRequired=true (live handler)", () => {
        const s08 = listScenarios().find((s) => s.id === "s08-self-drive-tier2-approval");
        assert.ok(s08, "s08 must be registered");
        const chatStep = s08.steps.find((step) => step.kind === "chat");
        assert.ok(chatStep, "s08 must contain a chat step");
        if (chatStep.kind !== "chat") throw new Error("type narrowing");
        assert.strictEqual(chatStep.expectedTier, 2);
        assert.strictEqual(chatStep.expectApprovalRequired, true);
    });

    it("s09 records expectedTier=3 and expectDeny=true (live handler)", () => {
        const s09 = listScenarios().find((s) => s.id === "s09-self-drive-tier3-deny");
        assert.ok(s09, "s09 must be registered");
        const chatStep = s09.steps.find((step) => step.kind === "chat");
        assert.ok(chatStep, "s09 must contain a chat step");
        if (chatStep.kind !== "chat") throw new Error("type narrowing");
        assert.strictEqual(chatStep.expectedTier, 3);
        assert.strictEqual(chatStep.expectDeny, true);
    });
});
