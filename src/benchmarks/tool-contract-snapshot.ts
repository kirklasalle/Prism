import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspacePath } from "../core/config/workspace-resolver.js";
import { MemoryQueryTool, SemanticQueryTool } from "../adapters/application/semantic-query-tool.js";
import { EpisodicMemory } from "../core/memory/episodic-memory.js";
import { SemanticMemoryIndex } from "../core/memory/semantic-memory.js";
import { SessionMemoryStore } from "../core/memory/session-memory.js";
import { builtinTools } from "../core/tools/builtin-tools.js";
import {
    buildToolContractSnapshot,
    compareToolContractSnapshots,
    type ToolContractSnapshot,
} from "../core/tools/contract-snapshot.js";
import type { Tool } from "../core/tools/types.js";

const SNAPSHOT_OUTPUT_PATH = process.env.PRISM_CONTRACT_SNAPSHOT_OUTPUT_PATH ?? workspacePath("artifacts", "contracts", "tool-contract-snapshot.json");
const DIFF_OUTPUT_PATH = process.env.PRISM_CONTRACT_DIFF_OUTPUT_PATH ?? workspacePath("artifacts", "contracts", "tool-contract-diff.json");
const BASELINE_PATH = process.env.PRISM_CONTRACT_BASELINE_PATH;

async function main(): Promise<void> {
    const tempDbPath = join(tmpdir(), `prism-contract-snapshot-${Date.now()}.db`);
    const sessionMemory = new SessionMemoryStore(tempDbPath);

    try {
        const tools = createRuntimeTools(sessionMemory);
        const snapshot = buildToolContractSnapshot(tools);
        await writeJson(SNAPSHOT_OUTPUT_PATH, snapshot);
        console.log(`Generated tool contract snapshot: ${SNAPSHOT_OUTPUT_PATH}`);

        if (BASELINE_PATH) {
            const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf-8")) as ToolContractSnapshot;
            const diff = compareToolContractSnapshots(baseline, snapshot);
            await writeJson(DIFF_OUTPUT_PATH, diff);
            console.log(`Generated tool contract diff: ${DIFF_OUTPUT_PATH}`);

            if (diff.breakingChanges.length > 0) {
                console.log(`Breaking contract changes detected: ${diff.breakingChanges.length}`);
                process.exitCode = 1;
            }
        }
    } finally {
        sessionMemory.close();
        if (existsSync(tempDbPath)) {
            rmSync(tempDbPath, { force: true });
        }
    }
}

function createRuntimeTools(sessionMemory: SessionMemoryStore): Tool[] {
    const semanticIndex = new SemanticMemoryIndex();
    const episodicMemory = new EpisodicMemory(16);
    return [
        ...builtinTools(),
        new SemanticQueryTool(semanticIndex, episodicMemory, sessionMemory),
        new MemoryQueryTool(semanticIndex, episodicMemory, sessionMemory),
    ];
}

async function writeJson(pathValue: string, payload: unknown): Promise<void> {
    const normalized = pathValue.replaceAll("\\", "/");
    const lastSlash = normalized.lastIndexOf("/");
    const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : ".";
    await mkdir(dir, { recursive: true });
    await writeFile(normalized, JSON.stringify(payload, null, 2), "utf-8");
}

void main();