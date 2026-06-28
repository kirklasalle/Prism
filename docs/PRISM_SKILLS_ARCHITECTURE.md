# Prism Skills — Architecture Plan (v2)

## Role-Clarified Design: CAC Character + Guardian Custodian

**Date:** 2026-06-18
**Design Principle:** The CAC Character (canonical PRISM agent) performs tab operations. The Guardian (PRISM's Custodian) ensures health, security, and supports the CAC. Skills are the shared execution units that both roles use — but each role has a distinct skill set with CAC-enforced separation.

---

## Core Roles

| Role | Identity | Purpose | Skill Domain |
|------|----------|---------|-------------|
| **CAC Character** | The canonical PRISM Agent (Aria, Phoenix, Sentinel) | Gets things done: chat, browse, use tools, manage workspace | `tab.*` — all 12 dashboard tab skills |
| **Guardian** | PRISM's Custodian | System health, security monitoring, directive integrity, CAC support | `skill.custodian.*` — maintenance, security, diagnostics, monitoring |

**Relationship:** The Guardian does NOT execute tab skills. The Guardian supports the CAC by keeping the system healthy so the CAC can operate safely. The Guardian's synthetic CAC identity has `skill.custodian.*` permissions only — it cannot access `tab.*` skills. This is enforced by the `SkillsEngine.checkPermission()` gate. Conversely, the CAC Character cannot execute custodian skills.

---

## Layer 1: CAC Character — Tab Skills (12)

The CAC Character (your PRISM agent identity, e.g. Aria) gets 12 tab skills — one per dashboard tab — granting full knowledge and operational control:

| Skill | Tab | Purpose |
|-------|-----|---------|
| `tab.chat` | Chat | Read/send messages, view history, manage attachments |
| `tab.settings` | Settings | Inspect/modify providers, models, routing, SR config |
| `tab.tools` | Tools | List plugins, toggle MCP servers |
| `tab.browser` | Browser | List sessions, navigate via existing browser_control tool |
| `tab.computer` | Computer | Screenshot, mouse/keyboard via existing computer tool |
| `tab.network` | Network | Inspect interfaces, run diagnostics |
| `tab.telemetry` | Telemetry | Query metrics, view SLO gauges |
| `tab.logs` | Logs | Read console output, filter by severity |
| `tab.scheduler` | Scheduler | View/manage cron jobs, review history |
| `tab.agentic` | Agentic | Manage agents, swarms, lifecycle |
| `tab.workspace` | Workspace | Manage files, characters, disk usage |
| `tab.demo` | Demo | View PTAC scenarios, Watch-Me status |

Each tab skill is a workflow: `inspect → evaluate → control` — the agent inspects the tab state, decides what to do, then performs the action via existing API handlers through `TabToolAdapter`.

---

## Layer 2: Guardian Custodian — System Skills (9+1)

The Guardian (PRISM's Custodian) does NOT have tab skills. Instead, it has **system-level custodian skills** that maintain the runtime and support the CAC:

| Skill | Category | Purpose |
|-------|----------|---------|
| `skill.custodian.disk-space` | Maintenance | Monitor disk, alert on thresholds, auto-clean |
| `skill.custodian.command-filter` | Security | Self-test command blocked patterns |
| `skill.custodian.secrets-scan` | Security | Scan env for leaked secrets |
| `skill.custodian.pad-integrity` | Security | Verify PAD SHA-256 integrity |
| `skill.custodian.mcp-health` | Monitoring | Health-check + restart stuck MCP servers |
| `skill.custodian.aab-ledger` | Monitoring | Check for anomalous autonomous behavior |
| `skill.custodian.covenant-audit` | Security | Audit Sacred Covenant integrity |
| `skill.custodian.agent-health` | Diagnostics | Check all agent lifecycles |
| `skill.custodian.system-snapshot` | Diagnostics | Capture system resource snapshot |
| `skill.custodian.skill-audit` | Security **(new)** | Audit all active skill sessions every 10 min |

The Guardian's CAC identity (`guardian@prism.local`) has permission scopes for `skill.custodian.*` only. CAC enforcement prevents the Guardian from executing tab skills, and prevents the CAC from executing custodian skills — clean separation enforced by `SkillsEngine.checkPermission()`.

---

## Layer 3: Architecture — Guardian ↔ Skills ↔ CAC

**New Guardian Task: `skill-audit`**

```
id: "skill_audit"
name: "Skill Execution Audit"
category: "security"
intervalMs: 600000 (10 min)
enabled: true
```

Responsibility: Every 10 minutes, the Guardian audits all active skill sessions — checking for stalled sessions, policy violations, or anomalous skill execution patterns. Reports to AAB ledger.

---

## Layer 2: CAC-Governed Skill Execution

Every skill session is bound to a **CAC `CharacterAssignment`**. This means:

- The character's permission scopes limit which tabs/skills it can access
- The operator's email domain (business) or open (individual) determines governance tier
- Every skill step is recorded with the full accountability chain

### Skill Permission Scopes

New property on `CharacterAssignment`:

```typescript
interface SkillPermissionScope {
  skillId: string;           // "tab-settings" | "skill.custodian.*"
  maxTier: PolicyTier;       // "tier1_autonomous" | "tier2_conditional" | "tier3_approval"
  expiresAt: string | null;  // null = never
  allowedActions: string[];  // ["inspect", "control"] — omit = all
}
```

Added to the existing `PermissionScope` model in `character-accountability-store.ts`.

### Skill Session Accountability Chain

Every `SkillSession` carries:

```typescript
interface SkillSession {
  sessionId: string;
  skillId: string;
  currentStep: string;
  // NEW:
  assignmentId: string | null;     // CAC assignment that authorized this
  accountabilityChain: {            // Full traceability
    characterId: string;
    operatorId: string;
    prismUserId: string;
    operatorEmail: string;
  } | null;
  guardianTriggered: boolean;      // true if Guardian started this
  // ...existing fields
}
```

---

## Layer 3: Architecture — Guardian ↔ Skills ↔ CAC

```
                    ┌─────────────────────────┐
                    │   Guardian Agent         │
                    │   (permanent, llama.cpp) │
                    └──────┬──────────────────┘
                           │ executes Skill Sessions
                           │ via SkillsEngine
                           ▼
              ┌────────────────────────────┐
              │     SkillsEngine            │
              │  - routeQuery()             │
              │  - createSession()          │
              │  - executeStep()            │
              │  - CAC gate per step        │
              └──────┬─────────────────────┘
                     │ each step checked against
                     ▼
          ┌──────────────────────┐
          │ CharacterAccount-    │
          │ abilityManager       │
          │ - hasPermission()    │
          │ - assertCanExecute() │
          └──────────────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │   ToolRegistry        │
          │   (TabToolAdapter)    │
          └──────────────────────┘
```

### Flow: Guardian Executes a Skill

```
1. Guardian ticks (every N min based on skill interval)
2. Guardian calls SkillsEngine.createSession(skillId, { guardianTriggered: true })
3. SkillsEngine checks Guardian has a valid "guardian" CAC assignment
4. SkillsEngine.executeStep() runs each step
5. Each tool call goes through CAC permission check:
   - CharacterAccountabilityManager.hasPermission(assignmentId, skillId)
   - If denied → step fails → AAB ledger entry → Guardian escalates
6. Session completes → result logged to ActivityBus
```

### Flow: Chat Agent Invokes a Tab Skill

```
1. User asks "check my LLM provider settings"
2. AutonomousAgentLoop calls SkillsEngine.routeQuery("check settings")
3. Returns tab-settings skill
4. SkillsEngine.createSession(skillId, { assignmentId: currentCacAssignment })
5. CAC permission check: does this character/operator have "tab-settings" scope?
6. If yes → execute steps via TabToolAdapter
7. If no → return structured denial: "Character 'aria' does not have 'tab-settings' permission"
8. Session completion reported to user + ActivityBus
```

---

## Layer 4: New Types & Interfaces

### `src/core/skills/types.ts` — Additions

```typescript
// ── CAC Integration ────────────────────────────────────────────────────────

export interface SkillAccountabilityChain {
  characterId: string;
  operatorId: string;
  prismUserId: string;
  operatorEmail: string;
  assignmentId: string;
}

// ── Guardian Integration ───────────────────────────────────────────────────

export type SkillExecutor = "guardian" | "agent_loop" | "human_chat";

export interface SkillSessionCreateOptions {
  skillId: string;
  parentChatSession?: string;
  executor?: SkillExecutor;
  accountabilityChain?: SkillAccountabilityChain;
}

// ── Permission System ──────────────────────────────────────────────────────

export type PolicyTier = "tier1_autonomous" | "tier2_conditional" | "tier3_approval";

export interface SkillPermissionCheck {
  allowed: boolean;
  tier: PolicyTier;
  reason?: string;
  remediation?: string;
}
```

### `src/core/skills/skills-engine.ts` — Additions

```typescript
export class SkillsEngine {
  // NEW
  private characterAccountability?: CharacterAccountabilityManager;

  // Existing — add CAC dependency
  constructor(
    providerManager: LlmProviderManager,
    activityBus: ActivityBus,
    workspaceRoot: string,
    characterAccountability?: CharacterAccountabilityManager,  // NEW
    chatStore?: any
  )

  // NEW method
  async checkPermission(
    skillId: string,
    assignmentId: string | null
  ): Promise<SkillPermissionCheck> {
    if (!this.characterAccountability || !assignmentId) {
      // No CAC configured — allow but warn (dev mode)
      return { allowed: true, tier: "tier1_autonomous" };
    }
    return this.characterAccountability.assertSkillPermission(assignmentId, skillId);
  }

  // ENHANCED createSession
  async createSession(
    opts: SkillSessionCreateOptions
  ): Promise<SkillSession> {
    const permission = await this.checkPermission(opts.skillId, opts.accountabilityChain?.assignmentId ?? null);
    if (!permission.allowed) {
      throw new Error(`Skill '${opts.skillId}': ${permission.reason}. ${permission.remediation ?? ''}`);
    }
    // ... create session with accountability chain attached
  }
}
```

### `src/core/agents/guardian-agent.ts` — Additions

```typescript
export interface GuardianConfig {
  // ...existing...
  // NEW
  skillIntervalOverrides?: Record<string, number>;  // Override default intervals per skill
  skillsEngine?: SkillsEngine;                       // Reference for executing skills
}

export class GuardianAgent {
  // NEW
  private skillsEngine: SkillsEngine | null = null;
  private guardianAssignmentId: string | null = null;  // CAC assignment for guardian

  // NEW method
  setSkillsEngine(engine: SkillsEngine): void;
  setGuardianAssignment(assignmentId: string): void;

  // ENHANCED task execution
  private async executeTask(task: GuardianTask): Promise<void> {
    // Check if this task maps to a skill
    const skillId = this.taskToSkillId(task.id);
    if (skillId && this.skillsEngine) {
      await this.executeSkill(skillId, task);
      return;
    }
    // fallback to existing implementation
  }

  private async executeSkill(skillId: string, task: GuardianTask): Promise<void> {
    const session = await this.skillsEngine!.createSession({
      skillId,
      executor: "guardian",
      accountabilityChain: {
        characterId: "guardian",
        operatorId: "guardian",
        prismUserId: "guardian",
        operatorEmail: "guardian@prism.local",
        assignmentId: this.guardianAssignmentId ?? "guardian-builtin",
      },
    });
    // execute until complete
  }
}
```

---

## Layer 5: Guardian Skill Definitions

Guardian skills live in `skills/guardian/` and follow the same SkillDefinition format:

```json
{
  "id": "skill.custodian.disk-space",
  "version": "1.0.0",
  "name": "Disk Space Health Check",
  "description": "Monitor disk usage, alert on thresholds, auto-clean temp files",
  "tags": ["guardian", "maintenance", "disk", "system"],
  "governance": {
    "min_policy_tier": "tier1_autonomous",
    "required_approvals": [],
    "covenant_rules": ["no_filesystem_destruction"]
  },
  "executor": "guardian",
  "interval_ms": 300000,
  "workflow": {
    "steps": [
      {
        "id": "check-disk",
        "name": "Check disk usage",
        "tools": ["tab_workspace_inspect"],
        "action": "Check workspace disk usage and available space",
        "transitions": { "success": "evaluate", "failed": "report-error" }
      },
      {
        "id": "evaluate",
        "name": "Evaluate thresholds",
        "tools": [],
        "action": "If usage > 90%, alert; if usage > 95%, auto-clean temp files",
        "transitions": { "success": "report", "failed": "report-error" }
      }
    ]
  }
}
```

---

## Layer 6: Wiring into Bootstrap

In `src/index.ts` (or the bootstrap modules), the wiring order becomes:

```
1. Workspace & DB initialization          (already done)
2. ActivityBus + Memory subsystems         (already done)
3. Dev Identity + Tab Sessions             (already done)
4. PolicyEngine + ToolRegistry             (already done)
5. CharacterAccountabilityManager          (already done)
6. SkillsEngine ← NEW: pass CAC manager   ← ADD
7. Guardian Agent ← NEW: pass SkillsEngine ← ADD
8. AutonomousAgentLoop                     (already done)
9. DashboardService                        (already done)
```

---

## Implementation Phases

| Phase | Effort | Deliverables |
|-------|--------|-------------|
| **P1** | 2 days | Update `types.ts` with CAC/Guardian types. Update `SkillsEngine` with CAC gate. Create `TabToolAdapter`. Wire into bootstrap. |
| **P2** | 2 days | Add CAC skill permissions to `CharacterAccountabilityStore`. Update `GuardianAgent` with skill execution. Create Guardian skill defs (8). |
| **P3** | 2 days | Create tab skill defs (12). Create KB docs (12). Wire skill routing into `AutonomousPlanner`. |
| **P4** | 1 day | Testing — 40+ cases: CAC-gated skill denial, Guardian skill execution, tab inspection, cross-tab governance. |

---

## Key Design Decisions

1. **Guardian gets its own CAC assignment** — A synthetic "guardian" identity is created at bootstrap with `skill.custodian.*` permissions and `tier1_autonomous` policy tier. This lets the policy engine govern the Guardian without hardcoding bypasses.

2. **Skills are not tools** — Skills are *workflows composed of tools*. A skill step maps to one or more tool calls. This keeps the tool registry clean (12 tools, not 100+) while enabling complex multi-step operations.

3. **CAC permission scopes are additive** — The default permission scope for any character is `[]` (no skills). The setup wizard or CAC panel grants scopes. Individual profiles get all `tab.*` skills. Business profiles require explicit scoping.

4. **Guardian tasks naturally decompose into skill steps** — The existing 18 Guardian tasks each become a skill definition, retaining their intervals but gaining the benefits of step-based execution, auditing, and governance.
