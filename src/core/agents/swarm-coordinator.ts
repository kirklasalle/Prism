import { randomUUID } from "node:crypto";
import type {
    SwarmDefinition,
    SwarmTopology,
    SwarmState,
    SubAgentResult,
    SubAgentRequest,
} from "./agent-types.js";
import type { AgentPool } from "./agent-pool.js";

// ──────────────────────────────────────────────────────────────────────────────
// SwarmCoordinator — multi-agent goal orchestration
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SWARM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface SwarmCreateOptions {
    topology: SwarmTopology;
    goal: string;
    agentIds: string[];
    timeoutMs?: number;
}

export class SwarmCoordinator {
    private readonly swarms = new Map<string, SwarmDefinition>();
    private readonly pool: AgentPool;
    private readonly onSwarmUpdate?: (swarm: SwarmDefinition) => void;

    constructor(
        pool: AgentPool,
        onSwarmUpdate?: (swarm: SwarmDefinition) => void,
    ) {
        this.pool = pool;
        this.onSwarmUpdate = onSwarmUpdate;
    }

    /** Create a new swarm (does not start execution). */
    create(opts: SwarmCreateOptions): SwarmDefinition {
        const swarmId = `swarm-${randomUUID().slice(0, 8)}`;
        const swarm: SwarmDefinition = {
            swarmId,
            topology: opts.topology,
            goal: opts.goal,
            agentIds: [...opts.agentIds],
            state: "pending",
            createdAt: Date.now(),
            timeoutMs: opts.timeoutMs ?? DEFAULT_SWARM_TIMEOUT_MS,
            results: [],
        };
        this.swarms.set(swarmId, swarm);
        return swarm;
    }

    /** Execute a swarm. Returns once all agents complete or timeout fires. */
    async execute(swarmId: string): Promise<SwarmDefinition> {
        const swarm = this.swarms.get(swarmId);
        if (!swarm) throw new Error(`Swarm not found: ${swarmId}`);
        if (swarm.state !== "pending") throw new Error(`Swarm ${swarmId} is already ${swarm.state}`);

        swarm.state = "running";
        this.onSwarmUpdate?.(swarm);

        const timeoutPromise = new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), swarm.timeoutMs),
        );

        try {
            const executionPromise = this.executeTopology(swarm);
            const raceResult = await Promise.race([executionPromise, timeoutPromise]);

            if (raceResult === "timeout") {
                swarm.state = "failed";
                swarm.completedAt = Date.now();
                this.onSwarmUpdate?.(swarm);
                return swarm;
            }

            swarm.state = "completed";
            swarm.completedAt = Date.now();
            this.onSwarmUpdate?.(swarm);
            return swarm;
        } catch {
            swarm.state = "failed";
            swarm.completedAt = Date.now();
            this.onSwarmUpdate?.(swarm);
            return swarm;
        }
    }

    /** Stop a running swarm. */
    stop(swarmId: string): boolean {
        const swarm = this.swarms.get(swarmId);
        if (!swarm || swarm.state !== "running") return false;
        swarm.state = "stopped";
        swarm.completedAt = Date.now();
        this.onSwarmUpdate?.(swarm);
        return true;
    }

    /** List all swarms. */
    list(): SwarmDefinition[] {
        return [...this.swarms.values()];
    }

    /** Get a swarm by id. */
    get(swarmId: string): SwarmDefinition | undefined {
        return this.swarms.get(swarmId);
    }

    // ── Topology implementations ──────────────────────────────────────────

    private async executeTopology(swarm: SwarmDefinition): Promise<void> {
        switch (swarm.topology) {
            case "mesh":
                return this.executeMesh(swarm);
            case "star":
                return this.executeStar(swarm);
            case "pipeline":
                return this.executePipeline(swarm);
            case "broadcast":
                return this.executeBroadcast(swarm);
        }
    }

    /**
     * Mesh: All agents receive the goal + all other agents' context.
     * Executed in parallel, results aggregated.
     */
    private async executeMesh(swarm: SwarmDefinition): Promise<void> {
        const promises = swarm.agentIds.map((agentId) =>
            this.dispatchSafe({
                goal: swarm.goal,
                agentId,
                context: `Collaborating with agents: ${swarm.agentIds.filter((id) => id !== agentId).join(", ")}`,
            }),
        );
        const results = await Promise.allSettled(promises);
        for (const r of results) {
            if (r.status === "fulfilled") swarm.results.push(r.value);
        }
    }

    /**
     * Star: First agent is coordinator, dispatches to workers, collects results.
     */
    private async executeStar(swarm: SwarmDefinition): Promise<void> {
        if (swarm.agentIds.length < 2) {
            // Only one agent — just dispatch directly
            const result = await this.dispatchSafe({ goal: swarm.goal, agentId: swarm.agentIds[0] });
            swarm.results.push(result);
            return;
        }

        const [coordinatorId, ...workerIds] = swarm.agentIds;

        // Coordinator plans the work
        const plan = await this.dispatchSafe({
            goal: `Plan how to accomplish this goal and divide it among ${workerIds.length} workers:\n\n${swarm.goal}`,
            agentId: coordinatorId,
        });
        swarm.results.push(plan);

        // Workers execute in parallel
        const workerPromises = workerIds.map((workerId) =>
            this.dispatchSafe({
                goal: swarm.goal,
                agentId: workerId,
                context: `Coordinator plan:\n${plan.content}`,
            }),
        );
        const workerResults = await Promise.allSettled(workerPromises);
        for (const r of workerResults) {
            if (r.status === "fulfilled") swarm.results.push(r.value);
        }
    }

    /**
     * Pipeline: Sequential handoff from agent to agent. Each agent receives
     * the previous agent's output as context.
     */
    private async executePipeline(swarm: SwarmDefinition): Promise<void> {
        let previousOutput = "";
        for (const agentId of swarm.agentIds) {
            if (swarm.state !== "running") break;
            const result = await this.dispatchSafe({
                goal: swarm.goal,
                agentId,
                context: previousOutput
                    ? `Previous stage output:\n${previousOutput}`
                    : undefined,
            });
            swarm.results.push(result);
            previousOutput = result.ok ? result.content : `[Error: ${result.error}]`;
        }
    }

    /**
     * Broadcast: One message to all agents, results aggregated.
     * Similar to mesh but without inter-agent context.
     */
    private async executeBroadcast(swarm: SwarmDefinition): Promise<void> {
        const promises = swarm.agentIds.map((agentId) =>
            this.dispatchSafe({ goal: swarm.goal, agentId }),
        );
        const results = await Promise.allSettled(promises);
        for (const r of results) {
            if (r.status === "fulfilled") swarm.results.push(r.value);
        }
    }

    /** Dispatch with error wrapping (never throws). */
    private async dispatchSafe(request: SubAgentRequest): Promise<SubAgentResult> {
        try {
            return await this.pool.dispatch(request);
        } catch (err: unknown) {
            return {
                ok: false,
                content: "",
                agentId: request.agentId ?? "unknown",
                model: "none",
                tier: 0,
                durationMs: 0,
                traceId: "",
                error: String(err),
            };
        }
    }
}
