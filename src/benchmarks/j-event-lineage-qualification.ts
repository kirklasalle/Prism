import fs from "fs";
import path from "path";
import { generateKeyPairSync, createSign } from "crypto";
import { ActivityBus } from "../core/activity/bus.js";
import { PolicyEngine } from "../core/policy/engine.js";
import { BUSINESS_PROFILE } from "../core/policy/execution-profiles.js";
import { BusinessTrustValidator } from "../core/plugins/business-trust-validator.js";
import type { PluginPackManifest } from "../core/plugins/plugin-pack-validator.js";

function createManifest(): PluginPackManifest {
    return {
        manifest_version: "1.0",
        pack_name: "lineage-pack",
        pack_version: "1.0.0",
        description: "Lineage qualification manifest",
        author: { name: "PRISM", email: "eng@prism.dev" },
        license: "MIT",
        repository: { type: "git", url: "https://github.com/prism/lineage-pack" },
        adapters: [
            {
                adapter_id: "lineage-adapter",
                adapter_type: "application",
                entry_file: "dist/src/index.js",
                capabilities: ["execute_command"],
                tier_routing: { default_tier: 2 },
                trust_level: "verified",
            },
        ],
        compatibility: { prism_min_version: "0.1.0", profiles: ["both"] },
        security: { review_status: "security-reviewed", signature_algorithm: "rsa-2048", known_issues: [] },
        metadata: { released: new Date().toISOString() },
    };
}

function run(): void {
    const activityBus = new ActivityBus();
    const policyEngine = new PolicyEngine();
    const trustValidator = new BusinessTrustValidator();

    const policyResult = policyEngine.evaluate({
        operation: "rm -rf /critical",
        risk: "high",
        mutatesState: true,
        executionProfile: BUSINESS_PROFILE,
    });

    const manifest = createManifest();
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signer = createSign("RSA-SHA256");
    signer.update(trustValidator.buildSignablePayload(manifest));
    signer.end();
    manifest.security!.signature = signer.sign(keyPair.privateKey).toString("base64");

    const trustResult = trustValidator.validate(manifest, {
        executionProfile: "business",
        publicKeyPem: keyPair.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
    });

    activityBus.emit({
        sessionId: "lineage-session-1",
        layer: "governance",
        operation: "policy_eval_high_risk",
        status: "succeeded",
        authorityTier: policyResult.tier,
        policyDecision: policyResult.decision,
        details: {
            reasonCodes: policyResult.reasonCodes ?? [],
            reasons: policyResult.reasons,
        },
    });

    activityBus.emit({
        sessionId: "lineage-session-1",
        layer: "governance",
        operation: "business_trust_validation",
        status: trustResult.allowed ? "succeeded" : "failed",
        authorityTier: "tier3_approval",
        policyDecision: trustResult.allowed ? "allow" : "deny",
        details: {
            reasonCodes: trustResult.reasonCodes,
            reasons: trustResult.reasons,
            evidence: trustResult.evidence,
        },
    });

    const events = activityBus.listEvents();

    const samples = {
        generatedAt: new Date().toISOString(),
        policy: {
            decision: policyResult.decision,
            tier: policyResult.tier,
            reasonCodes: policyResult.reasonCodes ?? [],
            reasons: policyResult.reasons,
        },
        trust: {
            decision: trustResult.decision,
            allowed: trustResult.allowed,
            reasonCodes: trustResult.reasonCodes,
            reasons: trustResult.reasons,
        },
    };

    const lineageBundle = {
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        events,
    };

    const outputDir = path.resolve("prism-output");
    fs.writeFileSync(
        path.join(outputDir, "reason-code-telemetry-samples.json"),
        JSON.stringify(samples, null, 2),
        "utf8"
    );

    fs.writeFileSync(
        path.join(outputDir, "event-lineage-bundle.json"),
        JSON.stringify(lineageBundle, null, 2),
        "utf8"
    );

    console.log("Event lineage qualification complete.");
    console.log("- Artifact: prism-output/reason-code-telemetry-samples.json");
    console.log("- Artifact: prism-output/event-lineage-bundle.json");
}

run();
