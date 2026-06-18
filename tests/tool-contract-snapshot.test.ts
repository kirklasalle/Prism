import assert from "node:assert";
import { HttpRequestTool } from "../src/adapters/protocol/http-tool.js";
import { ShellTool } from "../src/adapters/system/shell-tool.js";
import {
    buildToolContractSnapshot,
    compareToolContractSnapshots,
} from "../src/core/tools/contract-snapshot.js";
import type { Tool } from "../src/core/tools/types.js";

export async function testToolContractSnapshots(): Promise<void> {
    const baseline = buildToolContractSnapshot([
        new ShellTool(),
        new HttpRequestTool(),
    ]);

    assert.strictEqual(baseline.toolCount, 2);
    assert.ok(baseline.tools.every((tool) => tool.contractHash.length > 0));

    const versionChanged = buildToolContractSnapshot([
        makeTool("shell_exec", "2.0.0", {
            command: { type: "string", required: true },
            timeoutMs: { type: "number" },
            cwd: { type: "string" },
            shell: { type: "string" },
        }),
        new HttpRequestTool(),
    ]);
    const versionDiff = compareToolContractSnapshots(baseline, versionChanged);
    const shellVersionChange = versionDiff.changes.find((change) => change.name === "shell_exec");
    assert.ok(shellVersionChange);
    assert.strictEqual(shellVersionChange!.change, "version_changed");

    const schemaChangedWithoutVersion = buildToolContractSnapshot([
        makeTool("shell_exec", "1.1.0", {
            command: { type: "string", required: true },
            timeoutMs: { type: "number" },
        }),
        new HttpRequestTool(),
    ]);
    const schemaDiff = compareToolContractSnapshots(baseline, schemaChangedWithoutVersion);
    const shellSchemaChange = schemaDiff.breakingChanges.find((change) => change.name === "shell_exec");
    assert.ok(shellSchemaChange);
    assert.strictEqual(shellSchemaChange!.change, "schema_changed");

    console.log("✓ Tool contract snapshot tests passed");
}

function makeTool(name: string, version: string, args: NonNullable<Tool["contract"]>["args"]): Tool {
    return {
        name,
        contract: {
            version,
            args,
        },
        async execute() {
            return { ok: true, output: { ok: true } };
        },
    };
}