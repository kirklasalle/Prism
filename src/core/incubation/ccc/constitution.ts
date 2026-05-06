// Constitution loader + JSON schema validator for the CCC prototype.
// Constitutions live in JSON. We do shallow structural validation here — no AJV
// dependency, since a goal of the incubation track is no new external deps.

import { readFileSync } from "node:fs";
import type { Constitution, ConstitutionPrinciple, MemoryInvariant } from "./types.js";

export class ConstitutionValidationError extends Error {
    public readonly issues: string[];
    constructor(issues: string[]) {
        super(`Constitution validation failed: ${issues.join("; ")}`);
        this.issues = issues;
        this.name = "ConstitutionValidationError";
    }
}

export function validateConstitution(input: unknown): Constitution {
    const issues: string[] = [];
    if (!input || typeof input !== "object") {
        throw new ConstitutionValidationError(["root must be an object"]);
    }
    const obj = input as Record<string, unknown>;

    if (typeof obj.version !== "string" || !/^\d+\.\d+\.\d+/.test(obj.version)) {
        issues.push("`version` must be a semver string");
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
        issues.push("`id` must be a non-empty string");
    }
    if (!Array.isArray(obj.principles)) {
        issues.push("`principles` must be an array");
    } else {
        obj.principles.forEach((p, i) => {
            if (!p || typeof p !== "object") {
                issues.push(`principles[${i}] must be an object`);
                return;
            }
            const pp = p as Record<string, unknown>;
            if (typeof pp.id !== "string") issues.push(`principles[${i}].id required`);
            if (!pp.appliesTo || typeof pp.appliesTo !== "object") {
                issues.push(`principles[${i}].appliesTo required`);
            }
        });
    }
    if (obj.memoryInvariants !== undefined && !Array.isArray(obj.memoryInvariants)) {
        issues.push("`memoryInvariants` must be an array if present");
    }

    if (issues.length > 0) {
        throw new ConstitutionValidationError(issues);
    }

    return {
        version: obj.version as string,
        id: obj.id as string,
        description: typeof obj.description === "string" ? obj.description : undefined,
        principles: (obj.principles as ConstitutionPrinciple[]).map((p) => ({
            id: p.id,
            description: p.description,
            appliesTo: {
                operations: p.appliesTo?.operations,
                risk: p.appliesTo?.risk,
            },
            require: p.require ? { ...p.require } : undefined,
            forbidIfReasonCode: p.forbidIfReasonCode,
        })),
        memoryInvariants: Array.isArray(obj.memoryInvariants)
            ? (obj.memoryInvariants as MemoryInvariant[]).map((m) => ({ ...m }))
            : undefined,
    };
}

export function loadConstitution(path: string): Constitution {
    const raw = readFileSync(path, "utf8");
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new ConstitutionValidationError([
            `failed to parse JSON: ${(err as Error).message}`,
        ]);
    }
    return validateConstitution(parsed);
}
