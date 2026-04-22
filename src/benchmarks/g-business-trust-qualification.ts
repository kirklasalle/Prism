/**
 * Business Trust Qualification — Task G Evidence Generator
 *
 * Produces `prism-output/business-trust-qualification.json` containing:
 *   - Signed manifest validation proof
 *   - Unsigned manifest rejection proof
 *   - Trust-level boundary conditions
 *   - Policy reason-code coverage evidence
 *
 * Run via:  npm run g:trust:qualify:evidence
 */

import fs from "fs";
import path from "path";
import { generateKeyPairSync, createSign } from "crypto";
import { ActivityBus } from "../core/activity/bus.js";
import { BusinessTrustValidator } from "../core/plugins/business-trust-validator.js";
import { loadPluginPack } from "../core/plugins/plugin-pack-loader.js";
import type { PluginPackManifest } from "../core/plugins/plugin-pack-validator.js";

function createBaseManifest(): PluginPackManifest {
    return {
        manifest_version: "1.0",
        pack_name: "trust-qual-pack",
        pack_version: "1.0.0",
        description: "Qualification manifest for business trust evidence",
        author: { name: "PRISM", email: "eng@prism.dev" },
        license: "MIT",
        repository: { type: "git", url: "https://github.com/prism/trust-qual" },
        adapters: [
            {
                adapter_id: "qual-adapter",
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

function signManifest(manifest: PluginPackManifest, trustValidator: BusinessTrustValidator, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]): void {
    const signer = createSign("RSA-SHA256");
    signer.update(trustValidator.buildSignablePayload(manifest));
    signer.end();
    manifest.security!.signature = signer.sign(privateKey).toString("base64");
}

function run(): void {
    const trustValidator = new BusinessTrustValidator();
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = keyPair.publicKey.export({ type: "pkcs1", format: "pem" }).toString();

    const scenarios: Array<{
        name: string;
        profile: "individual" | "business";
        signed: boolean;
        expectedAccepted: boolean;
        result?: ReturnType<typeof loadPluginPack>;
    }> = [
            { name: "signed_manifest_business", profile: "business", signed: true, expectedAccepted: true },
            { name: "unsigned_manifest_business", profile: "business", signed: false, expectedAccepted: false },
            { name: "signed_manifest_individual", profile: "individual", signed: true, expectedAccepted: true },
            { name: "unsigned_manifest_individual", profile: "individual", signed: false, expectedAccepted: true },
        ];

    const allEvents: any[] = [];
    let passCount = 0;
    let failCount = 0;

    for (const scenario of scenarios) {
        const bus = new ActivityBus();
        const manifest = createBaseManifest();

        if (scenario.signed) {
            signManifest(manifest, trustValidator, keyPair.privateKey);
        }

        scenario.result = loadPluginPack(manifest, ".", bus, {
            executionProfile: scenario.profile,
            publicKeyPem,
        });

        const matched = scenario.result.accepted === scenario.expectedAccepted;
        if (matched) passCount++;
        else failCount++;

        allEvents.push(...bus.listEvents().map(e => ({
            scenario: scenario.name,
            ...e,
        })));
    }

    // ── Direct trust validator boundary checks ────────────
    const boundaryChecks: any[] = [];

    // Check: unreviewed manifest
    {
        const manifest = createBaseManifest();
        manifest.security!.review_status = "unreviewed" as any;
        signManifest(manifest, trustValidator, keyPair.privateKey);
        const result = trustValidator.validate(manifest, { executionProfile: "business", publicKeyPem });
        boundaryChecks.push({
            name: "unreviewed_security_status",
            allowed: result.allowed,
            reasonCodes: result.reasonCodes,
            evidence: result.evidence,
        });
    }

    // Check: mismatched trust level
    {
        const manifest = createBaseManifest();
        manifest.adapters![0].trust_level = "untrusted";
        signManifest(manifest, trustValidator, keyPair.privateKey);
        const result = trustValidator.validate(manifest, { executionProfile: "business", publicKeyPem });
        boundaryChecks.push({
            name: "untrusted_adapter_level",
            allowed: result.allowed,
            reasonCodes: result.reasonCodes,
            evidence: result.evidence,
        });
    }

    // Check: individual profile is advisory-only (always passes)
    {
        const manifest = createBaseManifest();
        const result = trustValidator.validate(manifest, { executionProfile: "individual" });
        boundaryChecks.push({
            name: "individual_advisory_only",
            allowed: result.allowed,
            reasonCodes: result.reasonCodes,
            evidence: result.evidence,
        });
    }

    // ── Build qualification artifact ──────────────────────
    const artifact = {
        qualification: "business-trust-qualification",
        taskId: "G",
        generatedAt: new Date().toISOString(),
        summary: {
            scenariosPassed: passCount,
            scenariosFailed: failCount,
            totalScenarios: scenarios.length,
            boundaryChecks: boundaryChecks.length,
            eventsCaptured: allEvents.length,
            verdict: failCount === 0 ? "PASS" : "FAIL",
        },
        scenarios: scenarios.map(s => ({
            name: s.name,
            profile: s.profile,
            signed: s.signed,
            expectedAccepted: s.expectedAccepted,
            actualAccepted: s.result!.accepted,
            matched: s.result!.accepted === s.expectedAccepted,
            summary: s.result!.summary,
            trustValidation: s.result!.trustValidation ? {
                allowed: s.result!.trustValidation.allowed,
                reasonCodes: s.result!.trustValidation.reasonCodes,
                reasons: s.result!.trustValidation.reasons,
            } : null,
        })),
        boundaryChecks,
        activityEvents: allEvents,
    };

    const outputDir = path.resolve("prism-output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
        path.join(outputDir, "business-trust-qualification.json"),
        JSON.stringify(artifact, null, 2),
        "utf8",
    );

    console.log("Business trust qualification complete.");
    console.log(`- Verdict: ${artifact.summary.verdict}`);
    console.log(`- Scenarios: ${passCount}/${scenarios.length} passed`);
    console.log(`- Boundary checks: ${boundaryChecks.length}`);
    console.log(`- Activity events: ${allEvents.length}`);
    console.log("- Artifact: prism-output/business-trust-qualification.json");
}

run();
