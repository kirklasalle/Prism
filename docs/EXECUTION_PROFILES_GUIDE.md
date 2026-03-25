# Execution Profiles Guide

## Overview

Execution profiles are market-segment-driven governance configurations that determine how Tier 1/2/3 approval policies are applied to tool execution. They enable PRISM to enforce different governance rules for individual vs. business deployments.

## Available Profiles

### INDIVIDUAL_PROFILE

Optimized for personal agents and lightweight workflows:

- **Tier 1 (Autonomous)**: Allowed for low-risk operations
- **Tier 2 (Conditional)**: Allowed for medium-risk operations with minimal governance
- **Tier 3 (Approval)**: Required for high-risk operations
- **Rollback Plans**: Encouraged but not required for medium-risk mutations
- **Audit**: Only high-risk operations logged

**Use Case**: Personal productivity agents, local deployments, development environments

**CAC Identity Constraints**: No email domain restrictions. Any valid email address is accepted for both Prism user and operator identities during character assignment.

### BUSINESS_PROFILE

Optimized for enterprise governance and compliance:

- **Tier 1 (Autonomous)**: Allowed only for read-only (non-mutating) operations
- **Tier 2 (Conditional)**: Required to provide explicit rollback plans
- **Tier 3 (Approval)**: Required for all mutations; whitelist bypass disabled
- **Rollback Plans**: Enforced for all medium/high mutations
- **Audit**: Full audit trail for all operations

**Use Case**: Enterprise deployments, compliance-sensitive workflows, production systems

**CAC Identity Constraints**: Prism user and operator email domains must match by default (`requireMatchingDomains: true`). An optional `allowedDomains` list can further restrict acceptable domains. Mismatched domains are rejected at character assignment time with a structured error.

## Segment Alias Normalization

PRISM uses a canonical two-segment model (`individual` | `business`). Alternative segment names are resolved as follows:

| Input | Canonical Segment |
| --- | --- |
| `individual` | `individual` |
| `business` | `business` |
| `enterprise` | `business` |
| `corporate` | `business` |

This normalization is applied by `resolveExecutionProfileSegment()` in the CAC manager and by `resolveExecutionProfile()` in the policy module. All downstream code operates on the canonical segment only.

## Usage

### During Orchestrator Construction

```typescript
import {
  Orchestrator,
  BUSINESS_PROFILE,
  INDIVIDUAL_PROFILE,
  type ExecutionProfile,
} from "./core/runtime/orchestrator.js";

// Use BUSINESS profile (strict governance)
const orchestrator = new Orchestrator(
  sessionId,
  activityBus,
  policyEngine,
  toolRegistry,
  { executionProfile: BUSINESS_PROFILE }
);

// Default to INDIVIDUAL profile (lenient governance)
const orchestrator = new Orchestrator(
  sessionId,
  activityBus,
  policyEngine,
  toolRegistry
);
```

### Dynamically Switch Profiles

```typescript
// Start with individual profile
const orchestrator = new Orchestrator(sessionId, activityBus, policyEngine, toolRegistry);

// Switch to business profile at runtime (e.g., when entering production mode)
orchestrator.setExecutionProfile(BUSINESS_PROFILE);
```

### Custom Profiles

For Phase D2 (current release), PRISM supports two standard market segments:

- `individual`: Personal agents and developers
- `business`: Enterprise deployments

To create custom governance rules beyond these two profiles, extend the profile construction at runtime:

```typescript
import type { ExecutionProfile } from "./core/policy/execution-profiles.js";
import { BUSINESS_PROFILE } from "./core/policy/execution-profiles.js";

// Extend Business profile with custom settings
const customProfile: ExecutionProfile = {
  segment: "business",  // Must use one of: "individual" | "business"
  tier1AutonomuousAllowed: BUSINESS_PROFILE.tier1AutonomuousAllowed,
  tier2ConditionalAllowed: BUSINESS_PROFILE.tier2ConditionalAllowed,
  tier3ApprovalRequired: BUSINESS_PROFILE.tier3ApprovalRequired,
  tier3WhitelistBypass: BUSINESS_PROFILE.tier3WhitelistBypass,
  rollbackPlanRequired: BUSINESS_PROFILE.rollbackPlanRequired,
  auditAllOperations: true,  // Enable extra audit logging
  description: "Custom: Business profile with enhanced audit",
};

orchestrator.setExecutionProfile(customProfile);
```

**Note:** Domain-specific profiles (e.g., "finance", "healthcare") are planned as future roadmap items and would require extending the MarketSegment type. Currently, use the base Individual or Business profile and customize at runtime as needed.

### Resolve Profile by Segment Name

```typescript
import { resolveExecutionProfile } from "./core/policy/execution-profiles.js";

const deploymentSegment = process.env.DEPLOYMENT_SEGMENT || "individual";
const profile = resolveExecutionProfile(deploymentSegment);
orchestrator.setExecutionProfile(profile);
```

## Governance Enforcement

When a tool is executed via `orchestrator.run()`:

1. **Tool Lookup & Governance Normalization**: The tool's governance schema is checked
2. **Policy Evaluation**: The PolicyEngine evaluates the request based on:
   - Operation risk level (low/medium/high)
   - Whether it mutates state
   - The execution profile's segment-specific rules
3. **Approval/Denial**: The policy engine decides:
   - `"allow"`: Execute immediately
   - `"require_approval"`: Route to ApprovalQueue
   - `"deny"`: Reject with detailed reasons

## Audit Trail

Activities emitted during policy evaluation include profile information:

```typescript
{
  operation: "tool-name.policy_check",
  authorityTier: "tier2_conditional",
  policyDecision: "allow",
  details: {
    reasons: ["..."],
    executionSegment: "business", // Profile segment
  }
}
```

## Common Patterns

### Enterprise SaaS Deployment

```typescript
// Detect deployment environment
const isProduction = process.env.NODE_ENV === "production";
const profile = isProduction ? BUSINESS_PROFILE : INDIVIDUAL_PROFILE;

const orchestrator = new Orchestrator(
  sessionId,
  activityBus,
  policyEngine,
  toolRegistry,
  { executionProfile: profile }
);
```

### Market-Specific Governance

```typescript
// Map market to profile
const marketProfiles: Record<string, ExecutionProfile> = {
  enterprise: BUSINESS_PROFILE,
  smb: INDIVIDUAL_PROFILE,
  startup: INDIVIDUAL_PROFILE,
  finance: financeProfile,
  healthcare: healthcareProfile,
};

const customerMarket = await getCustomerMarket(customerId);
const profile = marketProfiles[customerMarket] || INDIVIDUAL_PROFILE;

orchestrator.setExecutionProfile(profile);
```

## Testing

Unit tests should verify profile enforcement:

```typescript
it("BUSINESS_PROFILE should enforce rollback plan for mutations", () => {
  const engine = new PolicyEngine();

  const result = engine.evaluate({
    operation: "update-data",
    risk: "medium",
    mutatesState: true,
    rollbackPlan: undefined,
    executionProfile: BUSINESS_PROFILE,
  });

  expect(result.decision).toBe("deny");
  expect(result.reasons.some((r) => r.includes("rollback plan"))).toBe(true);
});
```

See `tests/orchestrator-execution-profile.test.ts` for comprehensive test examples.
