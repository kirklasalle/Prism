import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveWorkspaceRoot } from "../../config/workspace-resolver.js";
import type { EnvironmentSnapshot } from "./types.js";

export function captureEnvironmentSnapshot(monitoredFiles: string[] = []): EnvironmentSnapshot {
    const wsRoot = process.cwd();

    const files: Record<string, string> = {};
    const defaultMonitored = ["Permanent_Active_Directives.txt", "package.json", "tsconfig.json"];
    const allMonitored = Array.from(new Set([...defaultMonitored, ...monitoredFiles]));

    for (const f of allMonitored) {
        const fullPath = join(wsRoot, f);
        if (existsSync(fullPath)) {
            try {
                const content = readFileSync(fullPath);
                const hash = createHash("sha256").update(content).digest("hex");
                files[f] = hash;
            } catch {
                files[f] = "error";
            }
        } else {
            files[f] = "missing";
        }
    }

    const env: Record<string, string> = {
        NODE_ENV: process.env.NODE_ENV ?? "",
        PRISM_BASE_MODE: process.env.PRISM_BASE_MODE ?? "",
        PRISM_JWT_SECRET_LEN: String((process.env.PRISM_JWT_SECRET ?? "").length),
    };

    return {
        files,
        env,
        timestamp: new Date().toISOString(),
    };
}

export function detectSnapshotDrift(original: EnvironmentSnapshot, current: EnvironmentSnapshot): string | null {
    // Compare files
    for (const [file, originalHash] of Object.entries(original.files)) {
        const currentHash = current.files[file];
        if (!currentHash) {
            return `File ${file} was tracked but is not in current snapshot`;
        }
        if (currentHash !== originalHash) {
            return `File ${file} drifted: expected hash ${originalHash}, found ${currentHash}`;
        }
    }
    // Compare env variables
    for (const [key, val] of Object.entries(original.env)) {
        if (current.env[key] !== val) {
            return `Environment variable ${key} drifted: expected "${val}", found "${current.env[key]}"`;
        }
    }
    return null;
}
