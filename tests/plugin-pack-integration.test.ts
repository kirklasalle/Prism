import { describe, it } from "mocha";
import * as assert from "assert";
import { ActivityBus } from "../src/core/activity/bus.js";
import { loadPluginPack, type PluginLoadResult } from "../src/core/plugins/plugin-pack-loader.js";
import type { PluginPackManifest } from "../src/core/plugins/plugin-pack-validator.js";

function validManifest(): PluginPackManifest {
    return {
        manifest_version: "1.0",
        pack_name: "test-plugin-pack",
        pack_version: "1.0.0",
        description: "A test plugin pack for integration testing",
        author: { name: "PRISM Test", email: "test@prism.dev" },
        license: "MIT",
        repository: { type: "git", url: "https://github.com/prism/test-pack" },
        adapters: [
            {
                adapter_id: "test-adapter",
                adapter_type: "application",
                entry_file: "dist/src/index.js",
                capabilities: ["execute_command"],
                tier_routing: { default_tier: 2 },
                trust_level: "verified",
            },
        ],
        compatibility: { prism_min_version: "0.1.0", profiles: ["both"] },
        security: {
            review_status: "security-reviewed",
            signature_algorithm: "rsa-2048",
            known_issues: [],
        },
        metadata: { released: new Date().toISOString() },
    };
}

function invalidManifest(): PluginPackManifest {
    return {
        manifest_version: "2.0", // invalid version
        pack_name: "",            // empty name
        pack_version: "not-semver",
        description: "",          // too short
        author: { name: "" },     // missing name
        license: "INVALID",
        adapters: [],             // empty adapters
        compatibility: { prism_min_version: "", profiles: [] },
    };
}

/* ──────────────────────────────────────────────────────
 *  Plugin Pack Loader — Load-Time Validation Integration
 * ────────────────────────────────────────────────────── */
describe("Plugin Pack Loader — Load-Time Validation Integration", () => {

    it("accepts a valid manifest in individual profile", () => {
        const bus = new ActivityBus();
        const result = loadPluginPack(validManifest(), ".", bus, { executionProfile: "individual" });
        assert.strictEqual(result.accepted, true);
        assert.strictEqual(result.manifestValidation.valid, true);
        assert.ok(result.summary.includes("accepted"));
    });

    it("emits prism.plugin.validation_passed event on success", () => {
        const bus = new ActivityBus();
        loadPluginPack(validManifest(), ".", bus, { executionProfile: "individual" });
        const events = bus.listEvents();
        const passEvent = events.find(e => e.operation === "prism.plugin.validation_passed");
        assert.ok(passEvent, "Expected a prism.plugin.validation_passed event");
        assert.strictEqual(passEvent!.status, "succeeded");
        assert.strictEqual(passEvent!.policyDecision, "allow");
        assert.ok((passEvent!.details as any).reasonCodes.includes("PLUGIN_VALIDATION_PASSED"));
    });

    it("rejects an invalid manifest and emits failure event", () => {
        const bus = new ActivityBus();
        const result = loadPluginPack(invalidManifest(), ".", bus, { executionProfile: "individual" });
        assert.strictEqual(result.accepted, false);
        assert.strictEqual(result.manifestValidation.valid, false);
        assert.ok(result.manifestValidation.errors.length > 0);
        assert.ok(result.summary.includes("rejected"));

        const events = bus.listEvents();
        const failEvent = events.find(e => e.operation === "prism.plugin.validation_failed");
        assert.ok(failEvent, "Expected a prism.plugin.validation_failed event");
        assert.strictEqual(failEvent!.status, "failed");
        assert.strictEqual(failEvent!.policyDecision, "deny");
        assert.ok((failEvent!.details as any).reasonCodes.includes("PLUGIN_VALIDATION_FAILED"));
    });

    it("rejects in business profile when trust policy fails (no signature)", () => {
        const bus = new ActivityBus();
        const manifest = validManifest();
        // Remove signature so business trust policy fails
        delete manifest.security!.signature;

        const result = loadPluginPack(manifest, ".", bus, { executionProfile: "business" });
        assert.strictEqual(result.accepted, false);
        assert.ok(result.trustValidation);
        assert.strictEqual(result.trustValidation!.allowed, false);

        const events = bus.listEvents();
        const trustFail = events.find(e => e.operation === "prism.plugin.trust_validation_failed");
        assert.ok(trustFail, "Expected a prism.plugin.trust_validation_failed event");
        assert.strictEqual(trustFail!.policyDecision, "deny");
    });

    it("includes adapter count and profile in success event details", () => {
        const bus = new ActivityBus();
        loadPluginPack(validManifest(), ".", bus, { executionProfile: "individual" });
        const events = bus.listEvents();
        const passEvent = events.find(e => e.operation === "prism.plugin.validation_passed");
        assert.ok(passEvent);
        assert.strictEqual((passEvent!.details as any).adapterCount, 1);
        assert.strictEqual((passEvent!.details as any).profile, "individual");
    });

    it("includes error details in failure event", () => {
        const bus = new ActivityBus();
        loadPluginPack(invalidManifest(), ".", bus, { executionProfile: "individual" });
        const events = bus.listEvents();
        const failEvent = events.find(e => e.operation === "prism.plugin.validation_failed");
        assert.ok(failEvent);
        const details = failEvent!.details as any;
        assert.ok(details.errorCount > 0);
        assert.ok(Array.isArray(details.errors));
        assert.ok(details.errors[0].field);
        assert.ok(details.errors[0].message);
    });

    it("manifest validation happens before trust validation (fails fast)", () => {
        const bus = new ActivityBus();
        // Invalid manifest should never reach trust validation
        const result = loadPluginPack(invalidManifest(), ".", bus, { executionProfile: "business" });
        assert.strictEqual(result.accepted, false);
        assert.strictEqual(result.trustValidation, null, "Trust validation should not run when manifest is invalid");
    });

    it("does not emit trust failure for individual profile", () => {
        const bus = new ActivityBus();
        const manifest = validManifest();
        delete manifest.security!.signature; // would fail business trust
        const result = loadPluginPack(manifest, ".", bus, { executionProfile: "individual" });
        assert.strictEqual(result.accepted, true); // individual is permissive
        const events = bus.listEvents();
        assert.ok(!events.find(e => e.operation === "prism.plugin.trust_validation_failed"));
    });
});
