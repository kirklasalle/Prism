# PRISM Character Selection Guide

**Audience:** Users choosing which bundled character to load for their session.
**Companion:** [BUSINESS_VS_INDIVIDUAL_GUIDE.md](BUSINESS_VS_INDIVIDUAL_GUIDE.md) · [characters/README.md](../characters/README.md)

PRISM ships three reference personas, each in Individual and Business variants. Characters are JSON manifests under [characters/](../characters/). You can also create custom characters; this guide covers the stock set.

---

## 1. Quick matrix

| Persona | Archetype | Pick when you want… |
|---|---|---|
| **Aria** | Warm generalist, conversational partner | A default, friendly assistant for day-to-day work |
| **Phoenix** | Researcher / creative | Deep analysis, creative writing, SR-heavy workflows |
| **Sentinel** | Security-minded operator | Audit, compliance review, conservative tool use |

Each has `-individual` and `-business` variants.

---

## 2. Aria

### Aria, Individual — [characters/aria-individual.json](../characters/aria-individual.json)

- Tone: warm, approachable, conversational.
- Default tools: shell, files, web, HTTP, memory, semantic query, email (mocked until E2).
- Risk appetite: moderate. Will propose tier-2 operations (mutations) but routes tier-3 through approval queue.
- Good for: personal productivity, inbox triage, file-system cleanup, day-to-day coding help.
- Not good for: compliance-sensitive work (use Sentinel) or long research (use Phoenix).

### Aria, Business — [characters/aria-business.json](../characters/aria-business.json)

- Same tone, significantly tighter denylist.
- `shell_exec`, `terminal_session` explicitly denied at character level (redundant with Business profile cap; belt-and-braces).
- Email domain enforcement active.
- Good for: customer-support desks, internal assistants, team coordinators.

---

## 3. Phoenix

### Phoenix, Individual — [characters/phoenix-individual.json](../characters/phoenix-individual.json)

- Tone: exploratory, thorough, enjoys nuance.
- Default tools: web search, browser control, semantic query, memory, SR recommended.
- Risk appetite: moderate on outbound HTTP, conservative on mutations.
- Good for: research, long-form writing, competitive analysis, SR tri-model generation for complex reasoning.
- Not good for: simple Q&A (overkill) or production-mutation work.

### Phoenix, Business — [characters/phoenix-business.json](../characters/phoenix-business.json)

- Same tone; outbound HTTP restricted to character-configured domain allowlist.
- Good for: market research desks, legal discovery review (read-only), analyst workstreams.

---

## 4. Sentinel

### Sentinel, Individual — [characters/sentinel-individual.json](../characters/sentinel-individual.json)

- Tone: precise, security-first, conservative.
- Default tools: read-only file ops, memory, semantic query, network diagnostics (tier 1 only).
- Risk appetite: minimum. Every mutation goes through approval queue; no shell by default.
- Good for: audit reviews, compliance walkthroughs, security checks on your own machine.

### Sentinel, Business — [characters/sentinel-business.json](../characters/sentinel-business.json)

- Stronger denylist; strict email domain enforcement.
- Good for: SOC / infosec work, risk reviews, SOC 2 evidence collection when Phase H lands.

---

## 5. Example persona example

See [characters/example-analyst.json](../characters/example-analyst.json) — a reference template for building your own character. Follow the pattern for new characters and validate with the character-loader test suite.

---

## 6. Choosing the right pairing

Decision tree:

1. **Am I acting on my own behalf on my own machine?** → Individual variant.
   **Am I acting on behalf of a company / customers / others?** → Business variant.
2. **Do I need to run code or change things?** → Aria Individual or Phoenix Individual.
3. **Am I doing analysis, not execution?** → Phoenix (either variant) or Aria.
4. **Is my primary goal to review / audit / stay conservative?** → Sentinel (either variant).
5. **Do I need to combine analytical rigor with creative breadth?** → Use SR with Phoenix.

---

## 7. Switching characters mid-session

Characters are assigned per session. Switching is an accountability event — the CAC chain records the reassignment with before/after identities and an activity event.

From the dashboard:

1. Open the Chat tab.
2. Session sidebar → "Change Character."
3. Select from bundled characters or an imported custom.

From the API:

```
POST /api/v1/session/:id/character
{ "characterId": "phoenix-business" }
```

The server validates:

- Character manifest exists and passes schema.
- CAC email domain match under Business profile.
- Character denylist does not include tools the session has already invoked in this turn (prevents bypass).

---

## 8. Creating custom characters

1. Copy a bundled manifest as a starting point.
2. Update name, description, tool allowlist, tool denylist, system prompt fragments.
3. Choose the right `profile`: `individual`, `business`, or `both`.
4. Place in `$PRISM_DATA_DIR/characters/` (workspace-scoped) or `characters/` in the repo (distributed).
5. Validate: the server refuses to load a character whose denylist allows itself more capability than its profile permits.

See [characters/README.md](../characters/README.md) for the schema reference.

---

## 9. Character + profile + session-tier precedence

When evaluating a tool call, PRISM applies the **most restrictive** of:

1. **Profile cap** (Individual ≤ tier 2, Business ≤ tier 1).
2. **Character denylist / allowlist.**
3. **Session-level override** (temporary tier elevation via approval queue).
4. **PAD 10 Laws** (immovable, overrides everything above when conflict).

You cannot use a permissive character to bypass a strict profile; you cannot use a permissive profile to bypass a strict character. Stacking is safe.

---

## 10. Summary

- Aria = default assistant.
- Phoenix = thinker / researcher.
- Sentinel = auditor / guardian.
- Individual = you on your machine.
- Business = you on behalf of a company.
- SR works best with Phoenix.
- Custom characters always welcome; validate against the schema and profile caps.
