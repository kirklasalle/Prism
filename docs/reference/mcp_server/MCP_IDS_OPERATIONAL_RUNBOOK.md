# MCP IDS Operational Runbook

Status: Active
Updated: 2026-07-20
Audience: Operators, SRE, On-call, Release Managers

## Purpose

Provide operational procedures for running IDS as a high-confidence runtime awareness service in PRISM.

## Guardian-First Operating Mode

IDS MCP is designed to be run efficiently by Guardian diagnostics loops.
Operational preference is Sentinel-orchestrated execution over ad-hoc manual
invocations, except during incident response.

Efficiency guidance:

1. Keep routine cycles lightweight.
2. Trigger mutating IDS tools only when thresholds are breached.
3. Reuse prior successful status snapshots when transient errors occur.
4. Escalate after repeated degraded cycles rather than single-cycle noise.

## Daily Checks

1. Verify IDS service status with ids_get_system_status.
2. Verify validator health with ids_run_system_validator scope full.
3. Verify index freshness is within threshold (<24h).
4. Verify Sentinel cycle completed without critical findings.

## Weekly Checks

1. Run ids_get_documentation_stats and compare trend deltas.
2. Run targeted ids_get_file_info checks for high-risk files:

- docs/STATUS.md
- docs/ROADMAP.md
- docs/REQUIREMENTS_TRACEABILITY_MATRIX.md
- docs/PRISM_CRITICAL_AUDIT_2026.md

1. Confirm awareness score trend remains >= 85.

## Incident Response

## Scenario A: IDS unavailable

1. Trigger Guardian MCP self-heal workflow.
2. Recheck ids_get_system_status.
3. If still unhealthy, fail safe:

- hold release validation decisions
- mark awareness status degraded
- create incident ticket

## Scenario B: Validator critical failure

1. Capture findings from ids_run_system_validator.
2. Classify by severity and ownership.
3. Block release if covenant or requirement trace integrity is broken.
4. Re-run validator after remediation.

## Scenario C: Stale index

1. Run ids_run_documentation_indexer.
2. Verify refreshed timestamp and counts.
3. Recompute awareness score.

## Scenario D: Header drift spikes

1. Run ids_run_header_updater in dry_run mode.
2. Review proposed changes.
3. Run approval process for mutating updates.
4. Re-run validator and status checks.

## Approval Gates

Business profile enforcement:

- ids_run_header_updater (dry_run false) requires explicit approval.
- ids_run_documentation_indexer (force rebuild) requires explicit approval.

Release gate guidance:

- no critical validator failures
- awareness score >= 85
- unresolved mismatch count = 0 for regulated release candidates

## Telemetry and Logging

Required runtime logs:

- IDS status checks
- validator outcome summaries
- indexer executions
- header updater executions
- awareness score snapshots

## Escalation

Escalate to governance and release owners when:

- awareness score < 70
- IDS health remains degraded for 2 cycles
- validator returns critical covenant findings

## Related

- MCP_IDS_API_REFERENCE.md
- MCP_IDS_SAP_ALIGNMENT.md
- ../../MCP_IDS_RUNTIME_AWARENESS_FRAMEWORK.md
- ../../slm_documentation_alignment_sentinel.md
