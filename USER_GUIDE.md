# PRISM User Guide

Date: 2026-03-11

## 1. What PRISM is

PRISM is a governed autonomous agent runtime that acts as your infrastructure for Agents As A Service (AaaS). It can execute operations across your computer environment, bridging machine automation and human calendar/project management for a " Return of Growth and Integrity.

Research context reference:

- `PRISM_RESEARCH_DOCUMENTATION.md` (full-context rationale for governance, workflows, and safety model).

It is designed for high-trust operation:

- transparent decisions,
- explicit approvals for high-risk actions,
- recoverable workflows,
- complete activity traces.

## 2. What you can do with PRISM today

- run tiered autonomous operations
- enforce approval for high-risk actions
- execute multi-step workflows with retries, timeout, and fallback
- query memory of prior operations (`semantic_query`, `memory_query`)
- inspect persisted traces in SQLite

## 3. Safety model you should understand

### 3.1 Authority tiers

- `tier1_autonomous`: low-risk operations run automatically.
- `tier2_conditional`: medium-risk operations require additional governance constraints.
- `tier3_approval`: high-risk operations pause for explicit approval.

### 3.2 Approval outcomes

A high-risk action can:

- be approved,
- be denied,
- time out (treated as denied behavior).

Workflows may:

- fail (if no recovery path exists), or
- continue through fallback routes (if configured).

## 4. Quick Start

### 4.1 One-click dashboard startup (Windows)

1. Double-click `start_web.bat`
2. Wait for startup logs
3. Browser opens automatically to `http://localhost:7070`

From the dashboard you can:

- view runtime status,
- trigger built-in demo actions from the Actions panel,
- review pending approvals,
- approve/deny Tier-3 requests,
- inspect recent activity events.

### 4.2 CLI startup options

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Start runtime demo:
   - `npm start`
4. Start persistent server mode:
   - `npm run start:server`
5. Run tests:
   - `npm test`

## 5. Approval workflow (operator perspective)

When a Tier-3 action is triggered, PRISM emits:

- approval request event,
- pending approval ID,
- approve/deny endpoints,
- timeout window.

Operator options:

- approve action,
- deny action,
- do nothing (timeout).

Expected behavior:

- approved action executes,
- denied/timed-out action is blocked,
- workflow either fails or takes fallback route.

## 6. Memory tools

### 6.1 semantic_query

Purpose:

- retrieve semantically similar events to a query string.

### 6.2 memory_query

Modes:

- `semantic`
- `episodic_recent`
- `session_summary`
- `all`

Typical use:

- inspect what happened,
- recover context,
- inform next action selection.

## 7. Workflow behavior in plain language

A workflow is a sequence of steps. Each step can be retried and can have a timeout.

If a step fails or times out:

- PRISM checks whether a fallback route is defined.
- If yes, PRISM continues via fallback.
- If not, workflow ends as failed.

This is intentional and tested behavior.

## 8. Operational troubleshooting

### 8.1 High-risk step never executed

Possible causes:

- approval denied,
- approval timeout,
- policy denied operation before approval.

Check:

- governance events in activity trace,
- approval queue activity.

### 8.2 Workflow unexpectedly failed

Check:

- whether failure step had fallback rule,
- whether fallback condition matched actual outcome,
- whether retries were exhausted.

### 8.3 Memory query seems weak

Check:

- query wording specificity,
- session size,
- retrieval metrics and latency output.

## 9. Best practices for operators

1. Keep rollback plans explicit for mutating actions.
2. Use staged workflows for critical operations.
3. Require approval for any sensitive file/system changes.
4. Monitor retrieval quality and investigate drift.
5. Review traces after incidents and update policy/tool rules.

## 10. Security and trust expectations

PRISM is designed to increase trust through:

- deterministic governance decisions,
- explicit approval boundaries,
- auditable event streams,
- fail-safe timeout/denial handling.

## 11. Where to learn more

- Architecture and strategy: `README.md`
- Product requirements and roadmap intent: `PRISM_PRD.md`
- Engineering implementation standards: `DEVELOPER_GUIDE.md`
- Milestone status: `ROADMAP.md`

## 12. External references

1. <https://www.anthropic.com/engineering/building-effective-agents>
2. <https://arxiv.org/abs/2210.03629>
3. <https://arxiv.org/abs/2302.04761>
4. <https://arxiv.org/abs/2303.17580>
5. <https://modelcontextprotocol.io/introduction>
6. <https://www.nist.gov/itl/ai-risk-management-framework>
