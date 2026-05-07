# PRISM Runtime Configuration Guide

This document explains how to configure PRISM's execution profile at startup based on your deployment environment.

## Execution Profiles

PRISM supports two execution profiles that determine how policy governance tiers are enforced:

- **INDIVIDUAL_PROFILE** (segment: `individual`): Optimized for personal agents and developers
  - Tier 1 (Autonomous): Enabled for low-risk operations
  - Tier 2 (Conditional): Enabled for medium-risk operations
  - Tier 3 (Approval): Required for high-risk operations
  - Rollback plans: Encouraged but not required
  - Audit: Only high-risk operations logged

- **BUSINESS_PROFILE** (segment: `business`): Optimized for enterprise deployments
  - Tier 1 (Autonomous): Limited to non-mutating operations only
  - Tier 2 (Conditional): All medium-risk mutations require rollback plans
  - Tier 3 (Approval): Required for high-risk operations
  - Rollback plans: Enforced for all mutations
  - Audit: Full audit trail for all operations

## Auto-Detection (Default Behavior)

PRISM automatically selects the appropriate profile based on your deployment environment:

| Environment | Inferred Profile |
| --- | --- |
| `prod` / `production` | BUSINESS_PROFILE (strict governance) |
| `staging` | BUSINESS_PROFILE (strict governance) |
| `dev` / `development` / `local` | INDIVIDUAL_PROFILE (fast defaults) |

Set the environment via `PRISM_ENV_PROFILE`:

```bash
# Development with fast defaults
set PRISM_ENV_PROFILE=dev

# Production with strict governance (auto-selects BUSINESS_PROFILE)
set PRISM_ENV_PROFILE=prod

# Staging with strict governance
set PRISM_ENV_PROFILE=staging
```

## Explicit Profile Override

To override the auto-detected profile, use one of these environment variables (in priority order):

### Option 1: `PRISM_EXECUTION_PROFILE`

Explicitly specify the profile segment:

```bash
# Use BUSINESS_PROFILE
set PRISM_EXECUTION_PROFILE=business

# Use INDIVIDUAL_PROFILE
set PRISM_EXECUTION_PROFILE=individual

# Aliases also work
set PRISM_EXECUTION_PROFILE=enterprise   # → BUSINESS_PROFILE
set PRISM_EXECUTION_PROFILE=personal     # → INDIVIDUAL_PROFILE
```

### Option 2: `PRISM_EXECUTION_SEGMENT`

Alternatively, specify the segment:

```bash
set PRISM_EXECUTION_SEGMENT=business
set PRISM_EXECUTION_SEGMENT=individual
```

## Configuration Priority

When multiple settings are present, PRISM resolves the profile in this order:

1. **Explicit override** via `PRISM_EXECUTION_PROFILE` (highest priority)
2. **Explicit segment** via `PRISM_EXECUTION_SEGMENT`
3. **Inferred from environment** via `PRISM_ENV_PROFILE`
4. **Default** to INDIVIDUAL_PROFILE (lowest priority)

## Examples

### Production Deployment (Recommended)

```bash
# Auto-detection (BUSINESS_PROFILE automatically selected)
set PRISM_ENV_PROFILE=prod
start_web.bat

# Or explicit override
set PRISM_EXECUTION_PROFILE=business
set PRISM_ENV_PROFILE=prod
start_web.bat
```

### Development Deployment (Default)

```bash
# Auto-detection (INDIVIDUAL_PROFILE automatically selected)
set PRISM_ENV_PROFILE=dev
start_web.bat

# This is the default startup mode
start_web.bat
```

### Development with Business Profile Testing

```bash
# Test business governance rules in development environment
set PRISM_ENV_PROFILE=dev
set PRISM_EXECUTION_PROFILE=business
start_web.bat
```

### Staging with Individual Profile (Not Recommended)

```bash
# If needed for testing fast-path behavior before production
set PRISM_ENV_PROFILE=staging
set PRISM_EXECUTION_PROFILE=individual
start_web.bat
```

## Runtime Profile Selection via API/Code

If using PRISM programmatically, you can also set the profile at runtime:

```typescript
import { Orchestrator, BUSINESS_PROFILE } from "./core/runtime/orchestrator.js";

// Option 1: Set during construction
const orchestrator = new Orchestrator(
  sessionId,
  activityBus,
  policyEngine,
  toolRegistry,
  { executionProfile: BUSINESS_PROFILE }
);

// Option 2: Change at runtime
orchestrator.setExecutionProfile(BUSINESS_PROFILE);
```

## Verification

PRISM logs the resolved execution profile at startup. Look for this in the console output:

## Troubleshooting

### Profile Not Changing

1. Check that you set the environment variable **before** calling `start_web.bat`
2. Verify the value is one of: `individual`, `business`, `personal`, or `enterprise`
3. Clear any cached variables: close and reopen your terminal/command prompt
4. Check the startup log for the resolved profile

### Policy Checkers Failing with Business Profile

If you see "state mutation denied" or rollback errors in business profile:

- Ensure high-risk operations include explicit `rollbackPlan` arguments
- Check the policy decision logs in the activity bus
- Switch to INDIVIDUAL_PROFILE temporarily to verify the operation works, then add rollback plan

### Performance Issues with Business Profile

Business profile enforces stricter governance and generates more audit telemetry:

- This is expected and correct behavior
- If latency is excessive, consider:
  - Using execution mode settings (planned feature)
  - Optimizing your rollback plan declarations
  - Reviewing the policy evaluation logs for bottlenecks

## See Also

- [EXECUTION_PROFILES_GUIDE.md](EXECUTION_PROFILES_GUIDE.md) - Detailed profile behavior and examples
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - Development practices for profile-aware code
- [PRISM_PRD.md](PRISM_PRD.md) - Product requirements including profile definitions

## Computer-Use Business Gate Alignment Addendum (2026-03-25)

Environment-driven profile selection is part of the Business Security Alignment Gate for computer-use operations.

For enterprise-ready claims tied to browser/terminal/container capabilities:

1. `BUSINESS_PROFILE` must remain the default for `prod`/`staging` unless an explicit test override is documented.
2. Profile override behavior must be auditable in release evidence.
3. `CU-BG-1` through `CU-BG-5` status must be linked in the release packet before enterprise positioning.

Canonical references:

- `COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md`
- `REQUIREMENTS_TRACEABILITY_MATRIX.md`
- `PRODUCTION_RELEASE_RUNBOOK.md`
