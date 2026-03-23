import { randomUUID } from "node:crypto";
import type { TaskRole } from "../operator/model-capability-matrix.js";
import type {
    AgentInstance,
    AgentLifecycleTier,
    AgentModelOverride,
    SpawnAgentOptions,
    SubAgentDefinition,
} from "./agent-types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Built-in default agent definitions (permanent tier)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_AGENTS: SubAgentDefinition[] = [
    {
        agentId: "classifier",
        role: "classification",
        description: "Classifies, labels, and categorises inputs.",
    },
    {
        agentId: "chat",
        role: "chat",
        description: "General-purpose conversational agent.",
    },
    {
        agentId: "summarizer",
        role: "summarization",
        description: "Condenses documents, conversation histories, and activity logs.",
    },
    {
        agentId: "planner",
        role: "tool-selection",
        description: "Plans tool use, decomposes goals into concrete steps.",
        systemContext:
            "You are a planning agent. Break the goal into ordered, concrete steps. " +
            "For each step state the tool or specialist needed and the expected output.",
    },
    {
        agentId: "coder",
        role: "code-generation",
        description: "Generates, reviews, debugs, and explains code.",
        systemContext:
            "You are a code-generation agent. Produce clean, idiomatic code. " +
            "Include brief inline comments only where the logic is non-obvious.",
    },
    {
        agentId: "indexer",
        role: "memory-indexing",
        description: "Extracts and structures knowledge for memory indexing.",
    },
];

// ──────────────────────────────────────────────────────────────────────────────
// AgentLifecycleManager
// ──────────────────────────────────────────────────────────────────────────────

export interface AgentLifecycleEvents {
    onSpawn?: (instance: AgentInstance) => void;
    onStop?: (agentId: string) => void;
    onPromote?: (agentId: string, from: AgentLifecycleTier, to: AgentLifecycleTier) => void;
    onDemote?: (agentId: string, from: AgentLifecycleTier, to: AgentLifecycleTier) => void;
    onReap?: (agentId: string) => void;
}

const TIER_ORDER: AgentLifecycleTier[] = ["ephemeral", "semi-permanent", "permanent"];

/** Default idle timeout for ephemeral agents (5 minutes). */
const DEFAULT_REAP_TIMEOUT_MS = 5 * 60 * 1000;

export class AgentLifecycleManager {
    private readonly instances = new Map<string, AgentInstance>();
    private readonly events: AgentLifecycleEvents;
    private readonly reapTimeoutMs: number;
    private reapTimer: ReturnType<typeof setInterval> | null = null;

    constructor(events: AgentLifecycleEvents = {}, reapTimeoutMs = DEFAULT_REAP_TIMEOUT_MS) {
        this.events = events;
        this.reapTimeoutMs = reapTimeoutMs;
        // Register all built-in agents as permanent
        for (const def of DEFAULT_AGENTS) {
            const instance: AgentInstance = {
                ...def,
                lifecycle: "permanent",
                state: "idle",
                spawnedAt: Date.now(),
                lastActiveAt: Date.now(),
                dispatchCount: 0,
            };
            this.instances.set(def.agentId, instance);
        }
    }

    /** Start the periodic reaper for idle ephemeral agents. */
    startReaper(): void {
        if (this.reapTimer) return;
        this.reapTimer = setInterval(() => this.reapIdleEphemerals(), 30_000);
    }

    /** Stop the periodic reaper. */
    stopReaper(): void {
        if (this.reapTimer) {
            clearInterval(this.reapTimer);
            this.reapTimer = null;
        }
    }

    /** Spawn a new agent instance. */
    spawn(opts: SpawnAgentOptions): AgentInstance {
        const agentId = opts.agentId ?? `agent-${randomUUID().slice(0, 8)}`;
        const now = Date.now();
        const instance: AgentInstance = {
            agentId,
            role: opts.role,
            description: opts.description ?? `Dynamic ${opts.role} agent`,
            systemContext: opts.systemContext,
            lifecycle: opts.lifecycle ?? "ephemeral",
            state: "idle",
            modelOverride: opts.modelOverride,
            spawnedAt: now,
            lastActiveAt: now,
            dispatchCount: 0,
        };
        this.instances.set(agentId, instance);
        this.events.onSpawn?.(instance);
        return instance;
    }

    /** Stop and remove an agent. Built-in permanent agents can still be stopped. */
    stop(agentId: string): boolean {
        const instance = this.instances.get(agentId);
        if (!instance) return false;
        instance.state = "stopped";
        this.instances.delete(agentId);
        this.events.onStop?.(agentId);
        return true;
    }

    /** Promote an agent to the next lifecycle tier. */
    promote(agentId: string): AgentLifecycleTier | null {
        const instance = this.instances.get(agentId);
        if (!instance) return null;
        const idx = TIER_ORDER.indexOf(instance.lifecycle);
        if (idx >= TIER_ORDER.length - 1) return instance.lifecycle; // already at max
        const from = instance.lifecycle;
        instance.lifecycle = TIER_ORDER[idx + 1];
        this.events.onPromote?.(agentId, from, instance.lifecycle);
        return instance.lifecycle;
    }

    /** Demote an agent to the previous lifecycle tier. */
    demote(agentId: string): AgentLifecycleTier | null {
        const instance = this.instances.get(agentId);
        if (!instance) return null;
        const idx = TIER_ORDER.indexOf(instance.lifecycle);
        if (idx <= 0) return instance.lifecycle; // already at min
        const from = instance.lifecycle;
        instance.lifecycle = TIER_ORDER[idx - 1];
        this.events.onDemote?.(agentId, from, instance.lifecycle);
        return instance.lifecycle;
    }

    /** Set a model override for an agent. */
    setModelOverride(agentId: string, override: AgentModelOverride): boolean {
        const instance = this.instances.get(agentId);
        if (!instance) return false;
        instance.modelOverride = override;
        return true;
    }

    /** Clear a model override for an agent. */
    clearModelOverride(agentId: string): boolean {
        const instance = this.instances.get(agentId);
        if (!instance) return false;
        instance.modelOverride = undefined;
        return true;
    }

    /** Mark an agent as active (updates lastActiveAt and dispatchCount). */
    recordDispatch(agentId: string): void {
        const instance = this.instances.get(agentId);
        if (!instance) return;
        instance.dispatchCount++;
        instance.lastActiveAt = Date.now();
        instance.state = "busy";
    }

    /** Mark an agent as idle after dispatch completes. */
    recordDispatchComplete(agentId: string): void {
        const instance = this.instances.get(agentId);
        if (!instance) return;
        instance.state = "idle";
    }

    /** Get an agent instance by id. */
    get(agentId: string): AgentInstance | undefined {
        return this.instances.get(agentId);
    }

    /** Return all agent instances. */
    list(): AgentInstance[] {
        return [...this.instances.values()];
    }

    /** Return only agents matching a given role. */
    findByRole(role: TaskRole): AgentInstance | undefined {
        for (const inst of this.instances.values()) {
            if (inst.role === role && inst.state !== "stopped") return inst;
        }
        return undefined;
    }

    /** Reap idle ephemeral agents that have exceeded the idle timeout. */
    reapIdleEphemerals(): string[] {
        const now = Date.now();
        const reaped: string[] = [];
        for (const [id, inst] of this.instances) {
            if (
                inst.lifecycle === "ephemeral" &&
                inst.state === "idle" &&
                now - inst.lastActiveAt > this.reapTimeoutMs
            ) {
                this.instances.delete(id);
                this.events.onReap?.(id);
                reaped.push(id);
            }
        }
        return reaped;
    }

    /** Serialize persistent agents for workspace storage. */
    serializePersistent(): AgentInstance[] {
        return this.list().filter(
            (a) => a.lifecycle === "permanent" || a.lifecycle === "semi-permanent",
        );
    }

    /** Restore agents from persisted data. */
    restoreFromPersisted(persisted: AgentInstance[]): void {
        for (const data of persisted) {
            // Don't overwrite already-registered built-in agents
            if (this.instances.has(data.agentId)) {
                const existing = this.instances.get(data.agentId)!;
                // Restore model override and dispatch count from persisted
                existing.modelOverride = data.modelOverride;
                existing.dispatchCount = data.dispatchCount;
                continue;
            }
            const restored: AgentInstance = {
                ...data,
                state: "idle",
                lastActiveAt: Date.now(),
            };
            this.instances.set(restored.agentId, restored);
        }
    }

    /** Convert an AgentInstance to a SubAgentDefinition for AgentPool compatibility. */
    toDefinition(agentId: string): SubAgentDefinition | undefined {
        const inst = this.instances.get(agentId);
        if (!inst) return undefined;
        return {
            agentId: inst.agentId,
            role: inst.role,
            description: inst.description,
            systemContext: inst.systemContext,
        };
    }
}
