import fs from "node:fs";
import path from "node:path";
import { workspacePath } from "../core/config/workspace-resolver.js";

type CuBgStatus = "pass" | "fail" | "waived" | "in_progress";

interface CuBgRequirementStatus {
    id: "CU-BG-1" | "CU-BG-2" | "CU-BG-3" | "CU-BG-4" | "CU-BG-5";
    status: CuBgStatus;
    evidenceLink: string;
    reviewer: string;
    notes?: string;
}

interface CuBgStatusArtifact {
    schemaVersion: string;
    generatedAt: string;
    candidateId: string;
    strict: boolean;
    requirements: CuBgRequirementStatus[];
}

interface CuBgValidationSummary {
    generatedAt: string;
    strictMode: boolean;
    inputPath: string;
    schemaPath: string;
    passed: boolean;
    requirementChecks: Array<{
        id: string;
        status: CuBgStatus;
        valid: boolean;
        details?: string;
    }>;
    errors: string[];
}

const REQUIRED_IDS: CuBgRequirementStatus["id"][] = ["CU-BG-1", "CU-BG-2", "CU-BG-3", "CU-BG-4", "CU-BG-5"];
const VALID_STATUSES: CuBgStatus[] = ["pass", "fail", "waived", "in_progress"];

function hasTemplatePlaceholder(value: string): boolean {
    const normalized = value.trim();
    if (normalized.length === 0) {
        return true;
    }
    if (/<[^>]+>/.test(normalized)) {
        return true;
    }
    if (/^YYYYMMDD-candidate-id-d2$/i.test(normalized)) {
        return true;
    }
    if (/\b(TBD|TODO|PLACEHOLDER)\b/i.test(normalized)) {
        return true;
    }
    return false;
}

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function resolveInputPath(): string {
    return process.env.PRISM_CU_BG_STATUS_PATH
        ?? workspacePath("artifacts", "ci-gates", "computer-use-business-gate-status.json");
}

function resolveSchemaPath(): string {
    const custom = process.env.PRISM_CU_BG_SCHEMA_PATH;
    if (custom) {
        return custom;
    }
    return path.resolve(process.cwd(), "docs", "COMPUTER_USE_BUSINESS_GATE_STATUS_SCHEMA.json");
}

function resolveOutputPath(): string {
    return process.env.PRISM_CU_BG_VALIDATION_OUTPUT_PATH
        ?? workspacePath("artifacts", "ci-gates", "computer-use-business-gate-validation.json");
}

function ensureSchemaPresent(schemaPath: string, errors: string[]): void {
    if (!fs.existsSync(schemaPath)) {
        errors.push(`Schema file missing: ${schemaPath}`);
    }
}

function validateArtifactShape(
    artifact: Partial<CuBgStatusArtifact>,
    strictMode: boolean,
): { checks: CuBgValidationSummary["requirementChecks"]; errors: string[]; passed: boolean } {
    const errors: string[] = [];
    const checks: CuBgValidationSummary["requirementChecks"] = [];

    if (!artifact || typeof artifact !== "object") {
        errors.push("Input is not a valid JSON object.");
        return { checks, errors, passed: false };
    }

    if (!artifact.schemaVersion || typeof artifact.schemaVersion !== "string") {
        errors.push("Missing or invalid 'schemaVersion'.");
    }
    if (!artifact.generatedAt || typeof artifact.generatedAt !== "string") {
        errors.push("Missing or invalid 'generatedAt'.");
    }
    if (!artifact.candidateId || typeof artifact.candidateId !== "string") {
        errors.push("Missing or invalid 'candidateId'.");
    } else if (hasTemplatePlaceholder(artifact.candidateId)) {
        errors.push("'candidateId' contains template placeholder content.");
    }
    if (typeof artifact.strict !== "boolean") {
        errors.push("Missing or invalid 'strict'.");
    }
    if (!Array.isArray(artifact.requirements)) {
        errors.push("Missing or invalid 'requirements' array.");
        return { checks, errors, passed: false };
    }

    const byId = new Map<string, CuBgRequirementStatus>();
    for (const requirement of artifact.requirements) {
        if (!requirement || typeof requirement !== "object") {
            errors.push("Requirement entry must be an object.");
            continue;
        }
        const id = String(requirement.id ?? "");
        if (!REQUIRED_IDS.includes(id as CuBgRequirementStatus["id"])) {
            errors.push(`Unexpected requirement id: '${id}'.`);
            continue;
        }
        if (byId.has(id)) {
            errors.push(`Duplicate requirement id: '${id}'.`);
            continue;
        }
        byId.set(id, requirement as CuBgRequirementStatus);
    }

    for (const id of REQUIRED_IDS) {
        const requirement = byId.get(id);
        if (!requirement) {
            checks.push({
                id,
                status: "fail",
                valid: false,
                details: "Missing requirement entry.",
            });
            errors.push(`Missing required requirement entry: '${id}'.`);
            continue;
        }

        const status = requirement.status;
        const statusValid = VALID_STATUSES.includes(status);
        const evidenceValid = typeof requirement.evidenceLink === "string" && requirement.evidenceLink.trim().length > 0;
        const reviewerValid = typeof requirement.reviewer === "string" && requirement.reviewer.trim().length > 0;
        const evidenceNotPlaceholder = evidenceValid && !hasTemplatePlaceholder(requirement.evidenceLink);
        const reviewerNotPlaceholder = reviewerValid && !hasTemplatePlaceholder(requirement.reviewer);

        let valid = statusValid && evidenceValid && reviewerValid && evidenceNotPlaceholder && reviewerNotPlaceholder;
        const detailParts: string[] = [];

        if (!statusValid) {
            valid = false;
            detailParts.push("Invalid status value.");
        }
        if (!evidenceValid) {
            valid = false;
            detailParts.push("Missing evidenceLink.");
        }
        if (!reviewerValid) {
            valid = false;
            detailParts.push("Missing reviewer.");
        }
        if (!evidenceNotPlaceholder) {
            valid = false;
            detailParts.push("evidenceLink contains template placeholder content.");
        }
        if (!reviewerNotPlaceholder) {
            valid = false;
            detailParts.push("reviewer contains template placeholder content.");
        }
        if (strictMode && status !== "pass") {
            valid = false;
            detailParts.push("Strict mode requires status=pass.");
        }

        checks.push({
            id,
            status,
            valid,
            details: detailParts.length > 0 ? detailParts.join(" ") : undefined,
        });
    }

    const passed = errors.length === 0 && checks.every((check) => check.valid);
    return { checks, errors, passed };
}

function writeSummary(outputPath: string, summary: CuBgValidationSummary): void {
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf-8");
}

function run(): void {
    const strictMode = process.argv.includes("--strict") || process.env.PRISM_RELEASE_STRICT === "1";
    const inputPath = resolveInputPath();
    const schemaPath = resolveSchemaPath();
    const outputPath = resolveOutputPath();
    const errors: string[] = [];

    ensureSchemaPresent(schemaPath, errors);

    let artifact: Partial<CuBgStatusArtifact> = {};
    if (!fs.existsSync(inputPath)) {
        errors.push(`CU-BG status artifact missing: ${inputPath}`);
    } else {
        try {
            artifact = readJson<CuBgStatusArtifact>(inputPath);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
            errors.push(`Failed to parse CU-BG status artifact: ${message}`);
        }
    }

    const shape = validateArtifactShape(artifact, strictMode);
    const mergedErrors = [...errors, ...shape.errors];

    const summary: CuBgValidationSummary = {
        generatedAt: new Date().toISOString(),
        strictMode,
        inputPath,
        schemaPath,
        passed: mergedErrors.length === 0 && shape.passed,
        requirementChecks: shape.checks,
        errors: mergedErrors,
    };

    writeSummary(outputPath, summary);

    if (!summary.passed) {
        console.error("CU-BG gate validation failed.");
        for (const err of summary.errors) {
            console.error(`- ${err}`);
        }
        process.exit(1);
    }

    console.log("CU-BG gate validation passed.");
    console.log(`Summary written to ${outputPath}`);
}

run();