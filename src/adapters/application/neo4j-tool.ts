/**
 * Neo4j adapter — execute Cypher queries against a Neo4j instance.
 *
 * Configure via environment variables:
 *   NEO4J_URI      e.g. bolt://localhost:7687
 *   NEO4J_USER     e.g. neo4j
 *   NEO4J_PASSWORD e.g. secret
 *
 * The adapter uses the official `neo4j-driver` package when installed.
 * Until then it returns a clear "not connected" error so the rest of
 * the pipeline continues normally.
 */
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

type Neo4jDriver = {
    session(): {
        run(cypher: string, params: Record<string, unknown>): Promise<{
            records: Array<{ toObject(): Record<string, unknown> }>;
        }>;
        close(): Promise<void>;
    };
    close(): Promise<void>;
};

function tryLoadDriver(): Neo4jDriver | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const neo4j = require("neo4j-driver");
        const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
        const user = process.env.NEO4J_USER ?? "neo4j";
        const password = process.env.NEO4J_PASSWORD ?? "";
        return neo4j.driver(uri, neo4j.auth.basic(user, password)) as Neo4jDriver;
    } catch {
        return null;
    }
}

export class Neo4jQueryTool implements Tool {
    readonly name = "neo4j_query";
    readonly contract = {
        version: "1.0.0",
        args: {
            cypher: { type: "string", required: true },
            params: { type: "object" },
        },
    } as const;

    private driver: Neo4jDriver | null = tryLoadDriver();

    async execute(request: ToolRequest): Promise<ToolResult> {
        if (!this.driver) {
            return {
                ok: false,
                output: {
                    error:
                        "neo4j-driver not installed. Run: npm install neo4j-driver, then set NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD.",
                },
            };
        }

        const cypher = String(request.args.cypher ?? "");
        const params = (request.args.params ?? {}) as Record<string, unknown>;

        if (!cypher) {
            return { ok: false, output: { error: "No Cypher query supplied." } };
        }

        const session = this.driver.session();
        try {
            const result = await session.run(cypher, params);
            const records = result.records.map((r) => r.toObject());
            return {
                ok: true,
                output: { records, count: records.length },
                sideEffects: [
                    { type: "database", description: `neo4j_query: ${cypher.slice(0, 80)}` },
                ],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err), cypher } };
        } finally {
            await session.close();
        }
    }
}
