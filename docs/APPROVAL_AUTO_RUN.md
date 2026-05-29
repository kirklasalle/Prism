Approval Auto-Run Behavior

Overview

When a chat prompt is classified as Tier-2 (approval required), PRISM will enqueue a pending approval and return the existing 202 response with `approval_pending_ids`.

If the operator approves the pending request, PRISM will (optionally) automatically continue and execute the original prompt using the `AgenticChatExecutor`. This preserves the approval gating while reducing manual follow-through steps for the operator.

Runtime flag

- `autoRunApprovedTier2` (boolean, default `true`) — when `true`, approved Tier-2 chat prompts will automatically continue after operator approval. When `false`, the approval completes but no automatic execution is performed; operators must trigger the work manually.

Audit and observability

- Approval resolutions emit `approval.resolved` events on the ActivityBus with `layer=governance`.
- Agentic execution of approved requests emits `agentic_event` messages to the dashboard WebSocket/SSE clients for UI and audit.

Safety

This feature does not relax approval requirements. A Tier-2 prompt still requires explicit operator approval before any external-effect actions are taken.
