import type { ExecutionProfile } from "../policy/execution-profiles.js";
import { INDIVIDUAL_PROFILE, BUSINESS_PROFILE, resolveExecutionProfile } from "../policy/execution-profiles.js";

/**
 * Execution mode selector strategies based on environment and explicit configuration.
 * Ties execution profiles to deployment context (dev, staging, prod).
 */

/**
 * Resolve execution profile from environment variables and deployment context.
 *
 * Priority order:
 * 1. Explicit PRISM_EXECUTION_PROFILE environment variable
 * 2. PRISM_EXECUTION_SEGMENT environment variable (individual | business)
 * 3. Inferred from environment profile:
 *    - prod/staging -> Business (strict governance)
 *    - dev/local -> Individual (fast defaults)
 * 4. Default to Individual
 */
export function resolveExecutionProfileFromEnv(environmentProfile?: string): ExecutionProfile {
    // Explicit profile takes top priority
    const explicitProfile = process.env.PRISM_EXECUTION_PROFILE?.trim().toLowerCase();
    if (explicitProfile === "business" || explicitProfile === "enterprise") {
        return BUSINESS_PROFILE;
    }
    if (explicitProfile === "individual" || explicitProfile === "personal") {
        return INDIVIDUAL_PROFILE;
    }

    // Explicit segment second
    const explicitSegment = process.env.PRISM_EXECUTION_SEGMENT?.trim().toLowerCase();
    if (explicitSegment) {
        return resolveExecutionProfile(explicitSegment);
    }

    // Infer from environment profile third
    if (environmentProfile) {
        const normalized = environmentProfile.trim().toLowerCase();
        // Production and staging environments should default to Business
        if (normalized === "prod" || normalized === "staging" || normalized === "production") {
            return BUSINESS_PROFILE;
        }
        // Dev and local should default to Individual
        if (normalized === "dev" || normalized === "development" || normalized === "local") {
            return INDIVIDUAL_PROFILE;
        }
    }

    // Final default: Individual
    return INDIVIDUAL_PROFILE;
}

/**
 * Describe the execution profile resolution for logging/diagnostics.
 */
export function describeExecutionProfileResolution(
    profile: ExecutionProfile,
    environmentProfile?: string,
): string {
    const sources: string[] = [];

    if (process.env.PRISM_EXECUTION_PROFILE) {
        sources.push(`PRISM_EXECUTION_PROFILE=${process.env.PRISM_EXECUTION_PROFILE}`);
    } else if (process.env.PRISM_EXECUTION_SEGMENT) {
        sources.push(`PRISM_EXECUTION_SEGMENT=${process.env.PRISM_EXECUTION_SEGMENT}`);
    } else if (environmentProfile) {
        sources.push(`inferred from environment=${environmentProfile}`);
    } else {
        sources.push("default");
    }

    return `${profile.segment.toUpperCase()} profile (${sources.join(" | ")}) — ${profile.description}`;
}
