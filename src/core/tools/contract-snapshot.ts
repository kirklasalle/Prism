import { createHash } from "node:crypto";
import type { ToolContract } from "./contracts.js";
import type { Tool } from "./types.js";

export interface ToolContractSnapshotEntry {
    name: string;
    version: string;
    contractHash: string;
    args: ToolContract["args"];
}

export interface ToolContractSnapshot {
    generatedAt: string;
    toolCount: number;
    tools: ToolContractSnapshotEntry[];
}

export interface ToolContractDiffEntry {
    name: string;
    change: "added" | "removed" | "version_changed" | "schema_changed" | "unchanged";
    previousVersion?: string;
    currentVersion?: string;
}

export interface ToolContractDiffReport {
    previousToolCount: number;
    currentToolCount: number;
    changes: ToolContractDiffEntry[];
    breakingChanges: ToolContractDiffEntry[];
}

export function buildToolContractSnapshot(tools: Tool[]): ToolContractSnapshot {
    const snapshotTools = tools
        .filter((tool) => tool.contract)
        .map((tool) => {
            const normalizedArgs = normalizeValue(tool.contract!.args) as ToolContract["args"];
            return {
                name: tool.name,
                version: tool.contract!.version,
                contractHash: hashContract(tool.contract!),
                args: normalizedArgs,
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

    return {
        generatedAt: new Date().toISOString(),
        toolCount: snapshotTools.length,
        tools: snapshotTools,
    };
}

export function compareToolContractSnapshots(
    previous: ToolContractSnapshot,
    current: ToolContractSnapshot,
): ToolContractDiffReport {
    const previousMap = new Map(previous.tools.map((tool) => [tool.name, tool]));
    const currentMap = new Map(current.tools.map((tool) => [tool.name, tool]));
    const names = new Set([...previousMap.keys(), ...currentMap.keys()]);
    const changes: ToolContractDiffEntry[] = [];

    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
        const before = previousMap.get(name);
        const after = currentMap.get(name);

        if (!before && after) {
            changes.push({ name, change: "added", currentVersion: after.version });
            continue;
        }

        if (before && !after) {
            changes.push({ name, change: "removed", previousVersion: before.version });
            continue;
        }

        if (!before || !after) {
            continue;
        }

        if (before.version !== after.version) {
            changes.push({
                name,
                change: "version_changed",
                previousVersion: before.version,
                currentVersion: after.version,
            });
            continue;
        }

        if (before.contractHash !== after.contractHash) {
            changes.push({
                name,
                change: "schema_changed",
                previousVersion: before.version,
                currentVersion: after.version,
            });
            continue;
        }

        changes.push({
            name,
            change: "unchanged",
            previousVersion: before.version,
            currentVersion: after.version,
        });
    }

    return {
        previousToolCount: previous.toolCount,
        currentToolCount: current.toolCount,
        breakingChanges: changes.filter((change) => change.change === "removed" || change.change === "schema_changed"),
        changes,
    };
}

function hashContract(contract: ToolContract): string {
    const normalized = JSON.stringify(normalizeValue(contract));
    return createHash("sha256").update(normalized).digest("hex");
}

function normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeValue(item));
    }

    if (value && typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.entries(objectValue)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, normalizeValue(nested)]),
        );
    }

    return value;
}