# Execution Profile Support Implementation Summary

## What Was Completed

I've successfully added execution profile support to the PRISM Orchestrator, enabling market-segment-specific governance enforcement. This allows the system to apply different approval tiers and governance rules based on deployment context (individual vs. business segments).

## Architecture Changes

### 1. **Orchestrator Enhancement** ([src/core/runtime/orchestrator.ts](src/core/runtime/orchestrator.ts))

- **Added `OrchestratorOptions.executionProfile`**: Optional parameter to specify an execution profile during orchestrator construction
- **Added `setExecutionProfile()` method**: Allows dynamic profile switching at runtime (e.g., when transitioning from dev to production)
- **Default Profile**: Falls back to `INDIVIDUAL_PROFILE` when no profile is specified
- **Policy Integration**: Passes the execution profile to the `PolicyEngine` during governance evaluation

### 2. **Policy Engine Integration** ([src/core/policy/engine.ts](src/core/policy/engine.ts))

The PolicyEngine already supported ExecutionProfile through its context parameter. The Orchestrator now properly passes the profile to enable:

- Tier 1 (Autonomous) enforcement: Based on profile's `tier1AutonomuousAllowed`
- Tier 2 (Conditional) enforcement: With rollback plan requirements per profile
- Tier 3 (Approval) enforcement: With whitelist bypass control per profile

### 3. **Exported Types and Profiles** ([src/core/runtime/orchestrator.ts](src/core/runtime/orchestrator.ts))

The orchestrator module now exports:

- `ExecutionProfile` type
- `INDIVIDUAL_PROFILE` constant
- `BUSINESS_PROFILE` constant
- `resolveExecutionProfile()` function

These enable downstream code to reference profiles consistently.

## Profile Specifications

### INDIVIDUAL_PROFILE

```typescript
{
  segment: "individual",
  tier1AutonomuousAllowed: true,        // Low-risk ops can run autonomously
  tier2ConditionalAllowed: true,        // Medium-risk with governance checks
  tier3ApprovalRequired: true,          // High-risk requires approval
  tier3WhitelistBypass: false,          // No whitelist bypass
  rollbackPlanRequired: false,          // Rollback plans encouraged, not required
  auditAllOperations: false,            // Only high-risk logged
}
```

### BUSINESS_PROFILE

```typescript
{
  segment: "business",
  tier1AutonomuousAllowed: true,        // But only for non-mutating ops
  tier2ConditionalAllowed: true,        // Medium-risk requires governance
  tier3ApprovalRequired: true,          // High-risk requires approval
  tier3WhitelistBypass: false,          // No whitelist bypass (strict)
  rollbackPlanRequired: true,           // All mutations need rollback plan
  auditAllOperations: true,             // Full audit trail
}
```

## Usage Examples

### Create orchestrator with BUSINESS profile

```typescript
const orchestrator = new Orchestrator(
  sessionId,
  activityBus,
  policyEngine,
  toolRegistry,
  { executionProfile: BUSINESS_PROFILE }
);
```

### Switch profiles at runtime

```typescript
if (isProductionDeployment) {
  orchestrator.setExecutionProfile(BUSINESS_PROFILE);
} else {
  orchestrator.setExecutionProfile(INDIVIDUAL_PROFILE);
}
```

### Resolve profile by segment name

```typescript
const profile = resolveExecutionProfile(process.env.DEPLOYMENT_SEGMENT);
orchestrator.setExecutionProfile(profile);
```

## Testing

### New Test Suite: [tests/orchestrator-execution-profile.test.ts](tests/orchestrator-execution-profile.test.ts)

Comprehensive tests verifying:

- Default INDIVIDUAL_PROFILE usage
- BUSINESS_PROFILE acceptance in constructor options
- Dynamic profile switching via `setExecutionProfile()`
- Profile-specific governance enforcement (rollback plan requirements)
- Segment-specific governance rule application

### Updated Test: [tests/policy-engine.test.ts](tests/policy-engine.test.ts)

Fixed existing PolicyEngine tests to use appropriate profiles for each governance scenario:

- BUSINESS_PROFILE for strict rollback plan enforcement tests
- Custom profile with `tier3WhitelistBypass: true` for whitelist bypass tests

**Test Results**: All 20 PRISM tests passing ✓

## Documentation

### [EXECUTION_PROFILES_GUIDE.md](EXECUTION_PROFILES_GUIDE.md)

Comprehensive guide covering:

- Available profiles and their use cases
- Usage patterns and implementation examples
- Governance enforcement mechanics
- Audit trail integration
- Common deployment patterns
- Testing recommendations

## Benefits

1. **Market-Segment Governance**: Enforce different approval rules for individual vs. business customers
2. **Flexible Deployment**: Switch governance rules at runtime based on deployment context
3. **Audit Trail**: Activities emitted include the execution segment for compliance tracking
4. **Enterprise Compliance**: Business profile enforces strict rollback plan requirements
5. **Performance**: Individual profile allows faster autonomous execution for personal agents
6. **Customization**: Support for custom profiles with domain-specific governance rules

## Integration Points

The execution profile integrates seamlessly with:

- **Policy Engine**: Controls approval tier availability
- **Activity Bus**: Includes segment info in audit events
- **Tool Governance**: Works with existing tool governance schemas
- **Approval Queue**: Profile determines if approval is required (tier 3)

## Next Steps

To fully leverage execution profiles across the system:

1. **Environment Profiles**: Add execution profile configuration to environment profiles
2. **CLI/API**: Expose execution profile selection in CLI commands and REST APIs
3. **Dashboard**: Display active execution segment in the dashboard
4. **Logging**: Include segment in structured logs for analytics
5. **Deployment Automation**: Automatically set business profile for production deployments

---

## Computer-Use Business Gate Alignment (2026-03-25)

Execution profile implementation is now explicitly coupled to the Business Security Alignment Gate for computer-use pathways.

Enterprise claim requirement:

- `BUSINESS_PROFILE` behavior must be evidenced through `CU-BG-1` through `CU-BG-5` checks before enterprise-ready computer-use messaging.

Related references:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- `REQUIREMENTS_TRACEABILITY_MATRIX.md`
- `PRODUCTION_RELEASE_RUNBOOK.md`

---

**Status**: ✓ Complete and tested  
**All tests passing**: 20/20 ✓
