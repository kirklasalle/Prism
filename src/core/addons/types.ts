/**
 * PRISM Add-on SDK — Type Definitions (v1)
 *
 * Add-ons sit between Plugins (sandboxed, scoped) and Core (immutable).
 * They can extend the dashboard, memory subsystem, character system,
 * policy engine, and Guardian with domain-specific capabilities.
 *
 * Governed by the 10 Laws. Always cycles back to the basics.
 *
 * @module addons/types
 */

/* ── Manifest Schema ────────────────────────────────────────────────── */

export interface AddonManifest {
    /** Must be 1 for this schema version. */
    addonFormatVersion: 1;
    /** Reverse-DNS identifier. `prism.addon.*` reserved for core add-ons. */
    id: string;
    /** Human-readable display name. */
    name: string;
    /** Semver version string. */
    version: string;
    /** Author metadata. */
    author: { name: string; url?: string; publicKeyId?: string };
    /** Short description of the add-on's purpose. */
    description: string;
    /** OSI-approved license identifier. */
    license: string;
    /** Minimum PRISM version required. */
    minPrismVersion: string;

    /** Declares what PRISM subsystems this add-on extends. */
    integrationPoints: AddonIntegrationPoints;
    /** External dependencies. */
    dependencies: AddonDependencies;
    /** Trust tier — add-ons require "certified" (Council-approved). */
    trust: "certified";
    /** Governance Council sign-off record. */
    governanceCouncilSignoff?: GovernanceCouncilSignoff;
}

export interface AddonIntegrationPoints {
    /** Whether this add-on extends the memory query subsystem. */
    memorySubsystem: boolean;
    /** Whether this add-on gets its own top-level dashboard tab. */
    dashboardTab: boolean;
    /** Tab identifier for dashboard routing (e.g., "robotics"). */
    dashboardTabId?: string;
    /** Sub-panel identifiers within the tab. */
    dashboardSubPanels: string[];
    /** Whether this add-on can define new character archetypes. */
    characterExtensions: boolean;
    /** Guardian custodian skill IDs this add-on registers. */
    guardianSkills: string[];
    /** Policy extension rule IDs this add-on registers. */
    policyExtensions: string[];
    /** Domain-specific skill definition IDs. */
    skillDefinitions: string[];
    /** External system adapter bridge identifiers. */
    adapterBridges: string[];
}

export interface AddonDependencies {
    /** Other add-on IDs required. */
    addons: string[];
    /** Plugin pack IDs required. */
    plugins: string[];
    /** System capabilities required (e.g., "neo4j", "docker", "gpu"). */
    systemCapabilities: string[];
}

export interface GovernanceCouncilSignoff {
    councilMember: string;
    signedAt: string;
    signatureId: string;
}

/* ── Runtime Types ──────────────────────────────────────────────────── */

/** Lifecycle state of a loaded add-on. */
export type AddonState = "registered" | "booting" | "active" | "suspended" | "error" | "retired";

/** Runtime descriptor for a loaded add-on. */
export interface AddonInstance {
    manifest: AddonManifest;
    state: AddonState;
    loadedAt: string;
    error?: string;
    /** Absolute path to the add-on root directory. */
    rootPath: string;
}

/* ── Robotics Entity Types ──────────────────────────────────────────── */

/** Type of robotic entity managed by the Robotics Add-on. */
export type RoboticsEntityType = "physical" | "virtual" | "simulation";

/** Lifecycle state of a robotic entity — maps to PRISM Character lifecycle. */
export type RoboticsEntityStatus = "registered" | "provisioned" | "training" | "operational" | "suspended" | "retired";

/** A robotic entity managed by the VRGC Robotics Add-on. */
export interface RoboticsEntity {
    /** Unique entity identifier (e.g., "vrgc-arm-01", "brainsim-sallie"). */
    entityId: string;
    /** Human-readable display name. */
    name: string;
    /** Entity type classification. */
    type: RoboticsEntityType;
    /** Current lifecycle status. */
    status: RoboticsEntityStatus;
    /** Bound PRISM Character ID (e.g., "sentinel-individual"). */
    characterId: string | null;
    /** CAC assignment ID for governance chain. */
    cacAssignmentId: string | null;

    /** MCP endpoint for communication. */
    mcpEndpoint?: string;
    /** Protocol version. */
    protocolVersion?: string;
    /** Cognitive backend: "llm" (standard), "brainsim" (SNN), or "hybrid". */
    cognitiveBackend: "llm" | "brainsim" | "hybrid";

    /** Sensor array descriptors (for physical/simulation entities). */
    sensors: SensorDescriptor[];
    /** Actuator map descriptors (for physical/simulation entities). */
    actuators: ActuatorDescriptor[];
    /** Safety envelope constraints. */
    safetyEnvelope: SafetyEnvelope;

    /** Training metrics (populated during training lifecycle stage). */
    trainingMetrics?: TrainingMetrics;
    /** Graduation criteria — must be met before promotion to operational. */
    graduationCriteria?: GraduationCriteria;

    /** Last heartbeat timestamp (ISO 8601). */
    lastHeartbeat: string | null;
    /** Error rate (0.0 – 1.0) over the last observation window. */
    errorRate: number;
    /** Creation timestamp. */
    createdAt: string;
    /** Last status change timestamp. */
    updatedAt: string;
}

export interface SensorDescriptor {
    id: string;
    type: "camera" | "lidar" | "microphone" | "imu" | "gpio" | "serial" | "custom";
    label: string;
    status: "online" | "offline" | "calibrating";
}

export interface ActuatorDescriptor {
    id: string;
    type: "motor" | "servo" | "gripper" | "speaker" | "display" | "gpio" | "custom";
    label: string;
    status: "ready" | "active" | "locked" | "fault";
}

export interface SafetyEnvelope {
    /** Maximum force (Newtons) for physical actuators. Null for virtual. */
    maxForceN: number | null;
    /** Maximum velocity (m/s) for mobile entities. Null for stationary. */
    maxVelocityMs: number | null;
    /** Operating temperature range (°C). Null for virtual. */
    tempRangeC: [number, number] | null;
    /** Geofence boundary (lat/lng polygon). Null if unconstrained. */
    geofence: [number, number][] | null;
    /** Emergency stop enabled. Always true for physical; configurable for virtual. */
    emergencyStop: boolean;
    /** Policy tier override for this entity's actions. */
    policyTierCap: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
}

export interface TrainingMetrics {
    /** Total training epochs completed. */
    epochsCompleted: number;
    /** Current loss value (lower is better). */
    currentLoss: number;
    /** Skills acquired (concept IDs from UKS, or skill names). */
    skillsAcquired: string[];
    /** Training start timestamp. */
    startedAt: string;
    /** Estimated time to graduation (ISO duration). */
    estimatedTimeToGraduation: string | null;
}

export interface GraduationCriteria {
    /** Minimum number of skills required. */
    minSkillCount: number;
    /** Maximum acceptable loss value. */
    maxLoss: number;
    /** Minimum training duration (ms). */
    minTrainingDurationMs: number;
    /** Required safety audit pass. */
    requireSafetyAudit: boolean;
    /** Required operator sign-off. */
    requireOperatorSignoff: boolean;
}

/* ── Integration Bridge Types ───────────────────────────────────────── */

export type IntegrationStatus = "active" | "planned" | "roadmap" | "error" | "disabled";

export interface IntegrationBridge {
    id: string;
    name: string;
    type: "builtin" | "addon" | "future";
    protocol: string;
    status: IntegrationStatus;
    endpoint?: string;
    latencyMs?: number;
    lastChecked?: string;
    governanceTier: "tier1_autonomous" | "tier2_conditional" | "tier3_approval";
}
