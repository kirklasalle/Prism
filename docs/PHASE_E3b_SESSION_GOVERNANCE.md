# Phase E3b + R3 — Session Creation as Governance Gate

Every chat session in PRISM is bound to **(1) a character manifest** and **(2) a
CAC (Character Accountability Chain) identity assignment**. Session creation
is the governance gate — not policy evaluation at message-send time — because
a session without a bound character has no tier cap, allow/deny list, or
identity chain against which downstream tools can be judged.

## Contract

`POST /api/chat/sessions`

Request body (all fields optional; server fills gaps from workspace preferences):

```json
{
  "characterId": "aria-individual",      // falls back to prefs.defaultCharacterId
  "executionProfile": "individual",      // falls back to workspace profile
  "operatorEmail": "me@example.com",     // falls back to "operator@prism.local"
  "assistantEmail": "aria@example.com"   // falls back to "{characterId}@prism.local"
}
```

Responses:

- **201** — session created and bound. Body includes the full `ChatSessionSummary`
  with `characterId`, `cacAssignmentId`, `executionProfile`, `operatorEmail`,
  `assistantEmail`.
- **409** `{ "error": "no_default_character", "action": "run_wizard" }` — no
  character can be resolved. The web dashboard surfaces a prompt offering to
  open the setup wizard at step 4. The wizard will set
  `prefs.defaultCharacterId` and seed a CAC assignment.

`POST /api/v1/session/:id/character` — rebind an existing session to a
different character (reassigns CAC if needed).

## Runtime block (R3)

The policy engine hard-denies medium/high-risk tool calls when the Business
profile is active AND the active session's CAC assignment uses placeholder
identity (empty, `@prism.local`, or `@placeholder` email on either side).
Tier-1 low-risk reads remain permitted so the wizard itself can still load.

- Reason code: `CAC_PLACEHOLDER_IDENTITY_DENY`
- Remediation: `/setup?rerun=true&step=cac`

Individual profile sessions are never blocked on placeholder identity.

## Wizard (web, 6 steps)

1. Profile (individual / business)
2. Workspace path
3. Readiness (providers, models)
4. **Character** — bundled picker **or** import adapter textarea (supports
   PRISM-native, openclaw, crewai, autogen, openai-prompt shapes). Import is
   two-step: **Preview** returns the normalized manifest + warnings; **Commit**
   writes it to `<workspace>/characters/{name}.json`. Business profile auto-
   hardens: `shell_exec` + `terminal_session` added to deny, `maxRiskTier`
   clamped to 1, blast-radius tools stripped from allow.
5. **Identity** — operator + assistant email inputs with a live warning banner
   when either is a placeholder. Placeholders are accepted (so the wizard can
   complete) but trigger R3 runtime block until the operator edits them.
6. Summary — reviews the bootstrap certificate and persists the first CAC
   assignment via `POST /api/setup/cac`.

Wizard advancement POSTs:

- Leaving step 1 → `/api/setup/profile`
- Leaving step 2 → `/api/setup/workspace`
- Leaving step 4 → `/api/setup/character` (writes `defaultCharacterId` +
  `lastUsedCharacterId`)
- Leaving step 5 → `/api/setup/cac` (creates first bound session + writes
  `cacBootstrapAssignmentId`)
- Finish on step 6 → `/api/setup/complete`

## Dashboard surfacing

Session cards in `tab-chat.js` now render governance badges:

- `🎭 <character-id>` on bound sessions; `⚠ unbound` otherwise.
- `⚠ placeholder CAC` when either email is `@prism.local` / `@placeholder`.

On **New Session**, if the server returns 409 `no_default_character`, the
dashboard offers a redirect to the wizard.

## Import adapter shapes

`src/core/characters/character-import-adapter.ts`:

| detectShape         | Source                                         |
|---------------------|------------------------------------------------|
| `prism`             | PRISM-native (`name`, `executionProfile`, …)  |
| `openclaw`          | OpenClaw manifests                             |
| `crewai`            | CrewAI agent YAML/JSON                         |
| `autogen`           | Autogen agent config                           |
| `openai-prompt`     | Bare OpenAI system-prompt JSON                 |
| `unknown`           | Fallback — best-effort normalization           |

`_importSource.raw` preserves the original manifest for audit.

## Tests

- `tests/session-character-binding.test.ts` — 5 tests for the governance gate.
- `tests/policy-engine.test.ts` — CAC placeholder deny branch.
- `tests/character-import-adapter.test.ts` — 14 tests across shape detection,
  adaptation, Business auto-hardening, validation, end-to-end.
- `tests/wizard-parity.test.ts` — still 25 tests, all green.

Typecheck: `npx tsc --noEmit` — clean.
