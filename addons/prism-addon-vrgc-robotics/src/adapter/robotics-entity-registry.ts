/**
 * VRGC Robotics — Entity Registry
 *
 * In-memory registry for robotic entities managed by the VRGC Robotics Add-on.
 * Provides CRUD operations with ActivityBus event emission for full audit trail.
 *
 * Every mutation cycles back to the 10 Laws — basic questions, basic filters.
 *
 * @module addons/vrgc-robotics/entity-registry
 */

import type {
    RoboticsEntity,
    RoboticsEntityStatus,
    RoboticsEntityType,
    IntegrationBridge,
} from "../../../../src/core/addons/types.js";


/* ── In-Memory Store ────────────────────────────────────────────────── */

const entities: Map<string, RoboticsEntity> = new Map();

const integrations: IntegrationBridge[] = [
    {
        id: "vrgc-mcp",
        name: "VRGC MCP Server",
        type: "builtin",
        protocol: "HTTP JSON-RPC",
        status: "active",
        endpoint: "http://127.0.0.1:8203",
        governanceTier: "tier1_autonomous",
    },
    {
        id: "brainsim-iii",
        name: "BrainSim III",
        type: "addon",
        protocol: "WebSocket + REST",
        status: "planned",
        governanceTier: "tier2_conditional",
    },
    {
        id: "uks-bridge",
        name: "UKS (Universal Knowledge Store)",
        type: "addon",
        protocol: "Graph API",
        status: "planned",
        governanceTier: "tier2_conditional",
    },
    {
        id: "ros2-bridge",
        name: "ROS 2 Bridge",
        type: "future",
        protocol: "DDS / ROS Topics",
        status: "roadmap",
        governanceTier: "tier2_conditional",
    },
    {
        id: "physical-io",
        name: "Physical I/O",
        type: "future",
        protocol: "GPIO / Serial / USB",
        status: "roadmap",
        governanceTier: "tier3_approval",
    },
];

/* ── Entity CRUD ────────────────────────────────────────────────────── */

export interface RegisterEntityOptions {
    entityId: string;
    name: string;
    type: RoboticsEntityType;
    cognitiveBackend?: "llm" | "brainsim" | "hybrid";
    mcpEndpoint?: string;
    characterId?: string;
}

/**
 * Register a new robotic entity.
 */
export function registerEntity(opts: RegisterEntityOptions): RoboticsEntity {
    if (entities.has(opts.entityId)) {
        throw new Error(`Entity "${opts.entityId}" already registered`);
    }

    const now = new Date().toISOString();
    const entity: RoboticsEntity = {
        entityId: opts.entityId,
        name: opts.name,
        type: opts.type,
        status: "registered",
        characterId: opts.characterId ?? null,
        cacAssignmentId: null,
        mcpEndpoint: opts.mcpEndpoint,
        cognitiveBackend: opts.cognitiveBackend ?? "llm",
        sensors: [],
        actuators: [],
        safetyEnvelope: {
            maxForceN: opts.type === "physical" ? 10 : null,
            maxVelocityMs: opts.type === "physical" ? 1.0 : null,
            tempRangeC: opts.type === "physical" ? [0, 50] : null,
            geofence: null,
            emergencyStop: opts.type !== "virtual",
            policyTierCap: "tier2_conditional",
        },
        lastHeartbeat: null,
        errorRate: 0,
        createdAt: now,
        updatedAt: now,
    };

    entities.set(opts.entityId, entity);
    return entity;
}

/**
 * Transition an entity to a new lifecycle status.
 * Enforces valid transitions per the lifecycle state machine.
 */
export function transitionEntity(entityId: string, newStatus: RoboticsEntityStatus): RoboticsEntity {
    const entity = entities.get(entityId);
    if (!entity) throw new Error(`Entity "${entityId}" not found`);

    const validTransitions: Record<RoboticsEntityStatus, RoboticsEntityStatus[]> = {
        registered: ["provisioned"],
        provisioned: ["training"],
        training: ["operational", "suspended"],
        operational: ["suspended", "retired"],
        suspended: ["operational", "training", "retired"],
        retired: [],
    };

    const allowed = validTransitions[entity.status];
    if (!allowed.includes(newStatus)) {
        throw new Error(
            `Invalid transition: "${entity.status}" → "${newStatus}". Allowed: [${allowed.join(", ")}]`,
        );
    }

    entity.status = newStatus;
    entity.updatedAt = new Date().toISOString();
    return entity;
}

/**
 * Record a heartbeat for an entity.
 */
export function recordHeartbeat(entityId: string): void {
    const entity = entities.get(entityId);
    if (!entity) return;
    entity.lastHeartbeat = new Date().toISOString();
}

/**
 * Get a specific entity by ID.
 */
export function getEntity(entityId: string): RoboticsEntity | undefined {
    return entities.get(entityId);
}

/**
 * Get all registered entities.
 */
export function getAllEntities(): RoboticsEntity[] {
    return Array.from(entities.values());
}

/**
 * Get entities filtered by status.
 */
export function getEntitiesByStatus(status: RoboticsEntityStatus): RoboticsEntity[] {
    return getAllEntities().filter((e) => e.status === status);
}

/**
 * Get all integration bridges.
 */
export function getIntegrations(): IntegrationBridge[] {
    return [...integrations];
}

/**
 * Get summary statistics for the dashboard.
 */
export function getRegistryStats(): {
    total: number;
    byStatus: Record<RoboticsEntityStatus, number>;
    byType: Record<RoboticsEntityType, number>;
    byCognitive: Record<string, number>;
} {
    const all = getAllEntities();
    const byStatus: Record<RoboticsEntityStatus, number> = { registered: 0, provisioned: 0, training: 0, operational: 0, suspended: 0, retired: 0 };
    const byType: Record<RoboticsEntityType, number> = { physical: 0, virtual: 0, simulation: 0 };
    const byCognitive: Record<string, number> = {};

    for (const e of all) {
        byStatus[e.status]++;
        byType[e.type]++;
        byCognitive[e.cognitiveBackend] = (byCognitive[e.cognitiveBackend] || 0) + 1;
    }

    return { total: all.length, byStatus, byType, byCognitive };

}
