/**
 * Add-on SDK — Module Index
 *
 * Re-exports all public Add-on SDK types and utilities.
 */
export type {
    AddonManifest,
    AddonIntegrationPoints,
    AddonDependencies,
    GovernanceCouncilSignoff,
    AddonState,
    AddonInstance,
    RoboticsEntityType,
    RoboticsEntityStatus,
    RoboticsEntity,
    SensorDescriptor,
    ActuatorDescriptor,
    SafetyEnvelope,
    TrainingMetrics,
    GraduationCriteria,
    IntegrationStatus,
    IntegrationBridge,
} from "./types.js";

export { validateAddonManifest, parseAddonManifest } from "./addon-validator.js";
export type { ValidationResult } from "./addon-validator.js";

export {
    loadAddons,
    getLoadedAddons,
    getAddon,
    getAddonDashboardTabs,
    getMemoryAddons,
    getAddonGuardianSkills,
} from "./addon-loader.js";
