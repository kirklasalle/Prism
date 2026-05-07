# PRISM: Business vs Individual Profile Guide

**Audience:** PRISM operators and end users choosing a profile at setup time or via `PRISM_EXECUTION_PROFILE`.
**Companion:** [PROFILE_CAPABILITY_PARITY_MATRIX.md](PROFILE_CAPABILITY_PARITY_MATRIX.md) · [D2_PROFILE_AWARE_POLICY_ENGINE.md](D2_PROFILE_AWARE_POLICY_ENGINE.md)

---

## 1. The short version

| Aspect | **Individual** | **Business** |
|---|---|---|
| Intended operator | One person on one device | A team, department, or service desk |
| Max risk tier the policy engine will execute | **Tier 2** (includes mutations) | **Tier 1** (non-mutating only) |
| Default tools | shell, files, web, http, memory, semantic, email (mocked until E2) | memory, semantic, web, http, file-read only |
| Denied by profile | *(none)* | `shell_exec`, `terminal_session`, any destructive file op |
| Email domain enforcement | Permissive | **Strict domain match** between operator + character |
| Governance preamble in system prompt | Compact | **Full 10 Laws** |
| Character defaults | `aria-individual`, `phoenix-individual`, `sentinel-individual` | `aria-business`, `phoenix-business`, `sentinel-business` |

**Pick Individual** when you are the only user and you want the agent to actually *do* things on your computer.

**Pick Business** when agents act on behalf of a company, need an audit trail for compliance, and must be physically unable to execute destructive operations even if instructed.

---

## 2. What physical enforcement means

The profile is not a setting the agent can be talked into ignoring. PRISM's policy engine evaluates every tool invocation against the configured profile **before** it executes. See [src/core/policy/engine.ts](../src/core/policy/engine.ts).

The check is approximately:

```
if (operation.riskTier > executionProfile.maxRiskTier) {
  return { decision: "deny", reason: "tier_exceeds_profile_cap" }
}
```

A Business-profile session attempting `shell_exec` (tier 2) is denied before any shell is invoked. The denial is an activity event on the hash chain — it cannot be hidden.

---

## 3. Concrete examples

### 3.1 "Clean up my downloads folder"

- **Individual:** Allowed. Agent may invoke `file_ops` (list, move, delete) and `shell_exec` (if needed). You confirm destructive steps via approval queue when they are tier 3.
- **Business:** Denied at the first mutating call. Agent responds with "this operation requires an elevated profile; please escalate or run under Individual."

### 3.2 "Summarize my inbox"

- **Individual:** Allowed today via file-backed mock; allowed via Gmail/Outlook OAuth after Phase E2 ships. Result includes sender domains without filtering.
- **Business:** Allowed, but email tools enforce domain match — an `operator@acme.com` session cannot query `user@competitor.com` without explicit CAC escalation.

### 3.3 "Run this pytest suite"

- **Individual:** Allowed via `shell_exec` or the terminal session adapter.
- **Business:** Denied. The agent can read the repo, describe the test file, and propose a command — but cannot execute it. Execution requires a human or a session temporarily elevated through the approval queue.

### 3.4 "Research topic X on the web"

- **Individual:** Allowed. Web search + HTTP fetch are tier 1 in both profiles.
- **Business:** Allowed. Outbound HTTP is not tier-gated by profile; it is gated by domain allowlist per character.

### 3.5 "Deploy this to prod"

- **Individual:** Allowed with a tier-3 approval prompt surfaced in the dashboard.
- **Business:** Denied — deployment implies mutating remote systems. Routes through the approval queue only if a Business-tier-elevated character is explicitly configured.

---

## 4. Choosing at setup time

The setup wizard asks for a profile on step 1. You can also set the environment variable explicitly:

```bash
# Windows PowerShell
$env:PRISM_EXECUTION_PROFILE = "business"
.\start_web.bat

# Unix shell
export PRISM_EXECUTION_PROFILE=individual
./start_web.sh
```

Values: `individual`, `business`. Aliases `enterprise` and `corporate` resolve to `business` (see Phase C change log).

Profile can also be overridden per session by an operator with a Tier 3 identity, but every override produces an activity event.

---

## 5. Character pairing

Each bundled persona ships in both variants:

| Persona | Individual file | Business file |
|---|---|---|
| Aria (general-purpose assistant) | [characters/aria-individual.json](../characters/aria-individual.json) | [characters/aria-business.json](../characters/aria-business.json) |
| Phoenix (research / creative) | [characters/phoenix-individual.json](../characters/phoenix-individual.json) | [characters/phoenix-business.json](../characters/phoenix-business.json) |
| Sentinel (security / ops) | [characters/sentinel-individual.json](../characters/sentinel-individual.json) | [characters/sentinel-business.json](../characters/sentinel-business.json) |

See [CHARACTER_SELECTION_GUIDE.md](CHARACTER_SELECTION_GUIDE.md) for persona differences.

The pairing is not cosmetic: the `-business` variant has a denylist on `shell_exec` / `terminal_session` embedded in the character manifest. Loading a `-business` character into an Individual profile still respects the character's denylist — character settings are additive restrictions, never permissions.

---

## 6. Switching profiles later

Profile is persisted in the workspace manifest `prism-workspace.json`. To change:

1. Stop the server.
2. Edit the manifest's `profile` field, or export a new `PRISM_EXECUTION_PROFILE` and restart.
3. Run the wizard in repair mode to refresh character selection.

Switching from Business to Individual is audited. Switching from Individual to Business never relaxes restrictions; it only tightens them.

---

## 7. Common pitfalls

- **"My Business agent can't do anything."** Correct — that is the design. Use the approval queue to escalate specific operations, or run a controlled Individual session.
- **"I want Business governance but Individual tool access."** This is not a supported combination. If you need it, it means the risk-tier assignment on a specific tool is wrong — propose a re-tiering in [docs/PRISM_PRD.md](PRISM_PRD.md) §8.
- **"My character's denylist and profile conflict."** Denials always win. The most restrictive of (profile cap, character denylist, session cap) applies.

---

## 8. Where to look in the code

- Policy evaluation: [src/core/policy/engine.ts](../src/core/policy/engine.ts)
- Profile resolution: [src/core/config/execution-profile.ts](../src/core/config/execution-profile.ts)
- Character loading: [src/core/characters/](../src/core/characters/)
- CAC email domain enforcement: [src/core/accountability/manager.ts](../src/core/accountability/manager.ts)

When in doubt, the **activity event** on a denial will tell you exactly which rule fired. Check the Telemetry tab or query `SELECT * FROM activity_events WHERE decision='deny' ORDER BY ts DESC LIMIT 20;` against the activity SQLite store.
