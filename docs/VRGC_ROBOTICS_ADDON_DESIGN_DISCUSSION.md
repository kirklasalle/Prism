# VRGC Robotics Platform & Intelligent Integration Design Discussion

**Date:** 2026-07-11
**Status:** Architectural Discussion — No Code Changes
**Author:** Kirk LaSalle (Operator) & Antigravity (AI Partner)
**Scope:** VRGC expansion to Robotics, UKS/BrainSim III integration strategy, and the Plugin vs. Add-on taxonomy

---

## 1. Executive Summary

This document captures the architectural discussion and design rationale for three interconnected initiatives:

1. **Expanding VRGC** from a virtual-robotic network copilot into a full **Robotics Entity Management Platform** within PRISM.
2. **Defining the correct integration tier** for external cognitive systems like **UKS (Universal Knowledge Store)** and **BrainSim III** — concluding that these are **Add-ons**, not plugins.
3. **Establishing a world-class VRGC dashboard interface** as the first implementation of the new Add-on architecture.

> [!IMPORTANT]
> The core principle: Robotics entities (physical or virtual) must be treated as **first-class PRISM Characters** — governed by the same CAC (Character Accountability Control), PAD (Permanent Active Directives), and Policy Engine that govern all other PRISM agents. No robotics entity operates outside governance.

---

## 2. Current VRGC State Assessment

### What VRGC Is Today

VRGC (Virtually Robotic GitHub Copilot) is currently a **thin MCP bridge** that proxies HTTP calls to a Python-based MCP server on port 8203. It provides:

| Capability | Tool | Tier |
|---|---|---|
| Web research | `vrgc_research_assistant` | Tier 1 |
| Security scanning | `vrgc_web_security_scan` | Tier 1 |
| Performance testing | `vrgc_web_performance_test` | Tier 1 |
| FTP access | `vrgc_ftp_access` | Tier 2 |
| Web monitoring | `vrgc_web_monitor` | Tier 1 |
| Web search | `vrgc_web_search` | Tier 1 |

**Architecture:** Single bridge file (`src/adapters/network/vrgc-network-bridge.ts`, 259 lines) → HTTP JSON-RPC → Python MCP server.

**Dashboard presence:** Embedded within the Network Tab. No dedicated interface.

### What VRGC Needs to Become

A **Robotics Entity Management Hub** — the PRISM subsystem responsible for:

1. Registering, monitoring, and governing robotic entities (physical and virtual)
2. Bridging MCP frameworks, LLM providers, and tool registries for robotics workloads
3. Managing the lifecycle of robotic characters (spawn → train → operate → audit → retire)
4. Providing a world-class dedicated dashboard interface

---

## 3. The Plugin vs. Add-on Taxonomy

This is the critical design decision. PRISM already has a well-defined Plugin SDK with a mature marketplace, signing, and curation pipeline. The question is: **do UKS, BrainSim III, and the Robotics platform fit within that model?**

### 3.1 Why Plugins Are Insufficient

PRISM Plugins (per `PLUGIN_SDK_AUTHORING_GUIDE.md`) are:

| Plugin Characteristic | Constraint |
|---|---|
| Packaged as `tar.gz` / `zip` | Self-contained, atomic bundles |
| Declare scoped `capabilities[]` | Fine-grained, pre-declared tool contracts |
| Operate within sandbox | Cannot spawn processes, read outside declared scopes |
| State isolated to `{workspace}/plugins/<id>/state/` | No cross-plugin state sharing |
| Trust-tiered (unsigned/signed/verified) | Reviewed per-pack, not per-subsystem |

**UKS and BrainSim III violate every one of these constraints:**

- **UKS** is a graph-based knowledge store — it needs deep read/write access to PRISM's memory subsystem, semantic query paths, and potentially the Knowledge Graph (Neo4j).
- **BrainSim III** is a spiking neural network runtime — it needs persistent compute resources, its own model lifecycle, and bidirectional communication with PRISM's Character system.
- **Both** require their own dashboard interfaces, configuration panels, and governance extensions.

### 3.2 The Add-on Tier: Definition

An **Add-on** is a new integration tier sitting *between* the Plugin SDK and PRISM Core:

```
┌─────────────────────────────────────────────────────────┐
│                    PRISM Core                            │
│  (PolicyEngine, CAC, Guardian, ActivityBus, SkillsEngine)│
├─────────────────────────────────────────────────────────┤
│                    Add-on Layer                          │  ← NEW
│  (VRGC Robotics, UKS Bridge, BrainSim III Bridge)       │
│  • Own dashboard tab or sub-tabs                         │
│  • Own adapter bridge(s)                                 │
│  • Own character definitions                             │
│  • Own skill definitions                                 │
│  • Full CAC + Policy governance                          │
│  • May extend Guardian with custodian skills              │
├─────────────────────────────────────────────────────────┤
│                    Plugin Layer                           │
│  (Marketplace packs, community tools, signed bundles)    │
│  • Sandboxed, scoped, atomic                             │
│  • Cannot extend core governance                         │
│  • Cannot add dashboard tabs                             │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Add-on vs. Plugin — Comparison Matrix

| Dimension | Plugin | Add-on |
|---|---|---|
| **Packaging** | `tar.gz` / `zip` bundle | Git submodule or workspace package |
| **Dashboard presence** | None (tool-only) | Own tab, sub-tabs, or panel |
| **State access** | Isolated `state/` dir | Shared PRISM state (governed) |
| **Memory integration** | Read-only via declared scopes | Read/write with memory subsystem |
| **Character support** | Cannot define characters | Can define new character archetypes |
| **Skill definitions** | Cannot define skills | Can define domain-specific skills |
| **Guardian integration** | None | Can register custodian skills |
| **Policy engine** | Subject to policy | Can *extend* policy with domain rules |
| **Governance** | Marketplace curation | Governance Council review + Ed25519 signing |
| **Trust model** | unsigned/signed/verified | **certified** (new tier, Council-approved) |
| **Installation** | Drag-and-drop, hot-load | Configured at boot, restart required |
| **Examples** | Research Helper, Citation Builder | VRGC Robotics, UKS Bridge, BrainSim III |

> [!TIP]
> Think of it like SAP's module system: Plugins are like SAP Add-ons from the marketplace. Add-ons are like SAP Industry Solutions (IS-Retail, IS-Automotive) — they extend the core platform with deep, domain-specific capabilities that couldn't be sandboxed.

---

## 4. VRGC Robotics — World-Class Interface Design

### 4.1 Dashboard Architecture

The VRGC Robotics Add-on introduces a new **top-level dashboard tab** (Tab 13: `🤖 Robotics`) with four sub-panels:

```
┌──────────────────────────────────────────────────────────────┐
│  🤖 Robotics                                                 │
├──────────┬──────────┬──────────────┬────────────────────────┤
│ Entities │ Workshop │ Integrations │ Telemetry & Governance  │
└──────────┴──────────┴──────────────┴────────────────────────┘
```

#### Panel 1: Entity Registry

The central command for all registered robotic entities:

| Column | Description |
|---|---|
| Entity ID | Unique identifier (e.g., `vrgc-arm-01`, `brainsim-sallie`) |
| Character | Bound PRISM Character (e.g., `sentinel-industrial`) |
| Type | `physical` / `virtual` / `simulation` |
| Status | `online` / `offline` / `training` / `suspended` / `retired` |
| Connectivity | MCP endpoint, protocol version, latency |
| Governance | Current policy tier, active CAC assignment |
| Health | Last heartbeat, error rate, resource usage |

**Entity Lifecycle (mapped to PRISM Character lifecycle):**

```mermaid
stateDiagram-v2
    [*] --> Registered: Operator registers entity
    Registered --> Provisioned: CAC identity assigned
    Provisioned --> Training: Learning loop active
    Training --> Operational: Graduation criteria met
    Operational --> Suspended: Policy violation or manual
    Suspended --> Operational: Remediation complete
    Operational --> Retired: End of life
    Retired --> [*]
    Training --> Suspended: Safety threshold breach
```

#### Panel 2: Workshop (Character Development & Learning)

The **Workshop** is where robotic characters are developed, trained, and evaluated:

- **Character Builder:** Visual editor for robotic character manifests (extends `characters/*.json` schema with robotics-specific fields: sensor arrays, actuator maps, safety envelopes)
- **Learning Dashboard:** Monitor training progress, loss curves, skill acquisition metrics
- **Simulation Sandbox:** Run entity behaviors in virtual environments before physical deployment
- **Graduation Gates:** Define measurable criteria an entity must meet before promotion to `operational`

#### Panel 3: Integrations

The bridge management console for external systems:

| Integration | Type | Protocol | Status |
|---|---|---|---|
| VRGC MCP Server | Built-in | HTTP JSON-RPC | ✅ Active |
| BrainSim III | Add-on | WebSocket + REST | ⏳ Planned |
| UKS (Universal Knowledge Store) | Add-on | Graph API | ⏳ Planned |
| ROS 2 Bridge | Future | DDS / ROS Topics | 📋 Roadmap |
| Physical I/O | Future | GPIO / Serial / USB | 📋 Roadmap |

Each integration row expands to show:

- Connection health and latency
- Protocol version and compatibility
- Data flow direction and volume
- Governance tier applied to the bridge

#### Panel 4: Telemetry & Governance

- **Entity activity stream** (filtered view of ActivityBus events tagged with robotics entity IDs)
- **Policy violation log** (real-time feed of governance events for robotic entities)
- **Resource consumption** (compute, memory, network per entity)
- **Compliance dashboard** (CAC chain integrity, PAD alignment verification)

### 4.2 Visual Design Language

Consistent with PRISM's Tron-inspired UI:

- Dark background with cyan/magenta accent borders
- Entity status uses the standard PRISM status palette (green=operational, amber=training, red=suspended, gray=retired)
- Real-time WebSocket updates for entity health and telemetry
- Glassmorphism cards for entity details
- Micro-animations on status transitions

---

## 5. UKS Integration Strategy

### 5.1 What UKS Brings to PRISM

The **Universal Knowledge Store** (from BrainSim III) is a graph-based knowledge representation system that models concepts through attributes, relationships, and confidence scores. Unlike PRISM's current semantic memory (vector-based), UKS represents *structured conceptual knowledge* — "a dog HAS-A tail, IS-A mammal, CAN bark."

### 5.2 Integration Architecture

UKS would integrate as an **Add-on** that extends PRISM's memory subsystem:

```
┌─────────────────────────────────────────────┐
│           PRISM Memory Subsystem             │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Episodic  │  │ Semantic │  │ Session   │  │
│  │ (Recent)  │  │ (Vector) │  │ (Summary) │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐    │  ← NEW (Add-on)
│  │ UKS Bridge                           │    │
│  │ • Conceptual knowledge graph         │    │
│  │ • Attribute-based reasoning          │    │
│  │ • Confidence-scored relationships    │    │
│  │ • Bidirectional sync with Semantic   │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Key design decisions:**

1. **UKS does NOT replace** PRISM's existing memory — it augments it with structured conceptual knowledge
2. **Bidirectional sync:** Semantic query results can be enriched with UKS concept relationships; UKS can be populated from semantic memory patterns
3. **Query path:** New `memory_query` mode: `conceptual` (alongside existing `episodic_recent`, `session_summary`, `semantic`, `all`)
4. **Governance:** All UKS reads are Tier 1; UKS writes are Tier 2 (concept creation is a mutation)

### 5.3 UKS Add-on Manifest (Proposed)

```jsonc
{
  "addonFormatVersion": 1,
  "id": "prism.addon.uks-bridge",
  "name": "Universal Knowledge Store Bridge",
  "version": "0.1.0",
  "author": { "name": "PRISM Core Team" },
  "description": "Conceptual knowledge graph integration via BrainSim III's UKS",
  "license": "Apache-2.0",
  "minPrismVersion": "0.22.0",
  "integrationPoints": {
    "memorySubsystem": true,
    "dashboardTab": false,
    "dashboardSubPanel": "robotics.integrations",
    "characterExtensions": true,
    "guardianSkills": ["skill.custodian.uks-integrity"],
    "policyExtensions": ["uks.concept.write"]
  },
  "trust": "certified"
}
```

---

## 6. BrainSim III Integration Strategy

### 6.1 What BrainSim III Brings to PRISM

BrainSim III is a **spiking neural network (SNN) runtime** that simulates biological learning. Unlike LLMs (which are statistical pattern matchers), BrainSim III models *developmental learning* — an entity observes attributes, forms concepts, and generalizes through experience, similar to how a child learns.

### 6.2 Integration Architecture

BrainSim III integrates as an **Add-on** that provides an alternative cognitive backend for robotic characters:

```
┌─────────────────────────────────────────────────────────┐
│                PRISM Character System                    │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ Aria         │  │ Phoenix     │  │ Sentinel       │  │
│  │ (LLM-based)  │  │ (LLM-based) │  │ (LLM-based)   │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │  ← NEW (Add-on)
│  │ BrainSim III Characters                          │   │
│  │ • Spiking neural network cognitive core          │   │
│  │ • Developmental learning lifecycle               │   │
│  │ • Sensor→Concept→Action pipeline                 │   │
│  │ • UKS-backed knowledge accumulation              │   │
│  │ • Governed by same CAC + Policy as LLM chars     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Character Development Lifecycle (BrainSim III Entities)

This is where the "learning lifecycle" becomes a first-class PRISM concept:

```mermaid
graph TD
    A["Birth (Entity Created)"] --> B["Sensory Calibration"]
    B --> C["Concept Formation"]
    C --> D["Skill Acquisition"]
    D --> E{"Graduation Gate"}
    E -->|Pass| F["Operational Deployment"]
    E -->|Fail| G["Extended Training"]
    G --> D
    F --> H["Continuous Learning"]
    H --> I["Periodic Review"]
    I -->|Pass| H
    I -->|Fail| J["Remediation"]
    J --> D

    style A fill:#0a0a1a,stroke:#00d4ff,color:#e0e0e0
    style F fill:#0a0a1a,stroke:#00ff88,color:#e0e0e0
    style E fill:#0a0a1a,stroke:#ff6600,color:#e0e0e0
```

**Lifecycle stages mapped to PRISM governance:**

| Stage | Policy Tier | CAC Requirement | Guardian Oversight |
|---|---|---|---|
| Birth | Tier 1 (read-only) | Placeholder identity | Registration audit |
| Sensory Calibration | Tier 1 | Assigned identity | Sensor integrity check |
| Concept Formation | Tier 2 (creates state) | Full CAC chain | Concept safety audit |
| Skill Acquisition | Tier 2 | Full CAC chain | Skill boundary validation |
| Graduation Gate | Tier 3 (approval) | Full CAC chain + operator sign-off | Full safety audit |
| Operational | Tier 1-2 (per action) | Active CAC session | Continuous monitoring |
| Remediation | Tier 3 (approval) | Full CAC chain + operator sign-off | Incident analysis |

> [!CAUTION]
> A BrainSim III entity that is actively *learning* is, by definition, *changing its behavior*. This must be treated with the same governance rigor as a code deployment — because the entity's decision surface is mutating. The Guardian Agent must continuously audit concept formation for safety boundary violations.

---

## 7. Add-on SDK — Proposed Contract

### 7.1 Add-on Manifest Schema (v1)

```jsonc
{
  "addonFormatVersion": 1,
  "id": "prism.addon.<domain>",
  "name": "Human-readable name",
  "version": "0.1.0",
  "author": { "name": "...", "publicKeyId": "ed25519-..." },
  "description": "...",
  "license": "Apache-2.0",
  "minPrismVersion": "0.22.0",

  "integrationPoints": {
    "memorySubsystem": false,
    "dashboardTab": true,
    "dashboardTabId": "robotics",
    "dashboardSubPanels": [],
    "characterExtensions": true,
    "guardianSkills": [],
    "policyExtensions": [],
    "skillDefinitions": [],
    "adapterBridges": []
  },

  "dependencies": {
    "addons": [],
    "plugins": [],
    "systemCapabilities": []
  },

  "trust": "certified",
  "governanceCouncilSignoff": {
    "councilMember": "...",
    "signedAt": "...",
    "signatureId": "..."
  }
}
```

### 7.2 Add-on Lifecycle

```
1. DEVELOP    → Author builds add-on against Add-on SDK
2. TEST       → Add-on validator runs integration tests against PRISM core
3. SIGN       → Ed25519 signature over manifest + source hash
4. REVIEW     → Governance Council reviews (more rigorous than marketplace)
5. CERTIFY    → Council signs the addon manifest (adds governanceCouncilSignoff)
6. INSTALL    → Operator configures add-on in PRISM preferences
7. BOOT       → PRISM loads add-on at startup, registers all integration points
8. OPERATE    → Add-on runs under full PRISM governance
9. UPDATE     → Semver updates, Council re-review for major versions
10. RETIRE    → Graceful shutdown, state export, character migration
```

### 7.3 Add-on Directory Structure

```
addons/
  prism-addon-vrgc-robotics/
    addon.manifest.json          # Required — Add-on manifest
    signature.sig                # Required — Ed25519 signature
    signature.sig.json           # Required — Signing metadata
    src/
      adapter/                   # Bridge adapters to external systems
      characters/                # Robotics character definitions
      dashboard/                 # Dashboard tab HTML/JS/CSS
      guardian-skills/           # Custodian skill definitions
      policy/                    # Policy extension rules
      skills/                    # Domain skill definitions
    tests/
    README.md
    CHANGELOG.md
    LICENSE
```

---

## 8. SAP-Level Design Principles

You asked for SAP-level enterprise architecture. Here are the principles that guide this design:

### 8.1 Separation of Concerns (SAP Module Isolation)

Just as SAP separates FI (Finance), MM (Materials Management), and SD (Sales & Distribution) into independent but interoperable modules, PRISM Add-ons are:

- **Self-contained** with their own adapters, characters, skills, and UI
- **Interoperable** via PRISM's shared governance bus (ActivityBus, PolicyEngine, CAC)
- **Independently deployable** (operator chooses which add-ons to enable)

### 8.2 Master Data Governance (SAP MDG Pattern)

Robotic entities are treated as **master data** in PRISM:

- Each entity has a single source of truth (the Entity Registry)
- All mutations are audited via ActivityBus
- Cross-system consistency is enforced via CAC identity chains
- Data quality is validated by Guardian custodian skills

### 8.3 Authorization Concept (SAP Role-Based Access)

The Add-on layer inherits PRISM's existing authorization model:

- **Individual profile:** Full access to robotics features, Tier 2 cap
- **Business profile:** Restricted access, Tier 1 cap, domain enforcement
- **Industrial profile (new):** Full access with Tier 3 approval for all mutations
- **Per-add-on scoping:** Each add-on declares required permission scopes

### 8.4 Transport System (SAP TMS Pattern)

Add-on updates follow a transport-like promotion path:

```
Development → Testing → Staging → Production
```

Each promotion requires:

- Automated test pass
- Governance Council sign-off (for major versions)
- Rollback plan documented
- State migration scripts validated

---

## 9. Implementation Roadmap (Phased)

| Phase | Deliverable | Effort | Dependencies |
|---|---|---|---|
| **R1** | Add-on SDK manifest schema + validator | 3 days | None |
| **R2** | Add-on boot loader in `src/index.ts` | 2 days | R1 |
| **R3** | VRGC Robotics dashboard tab (Entity Registry) | 5 days | R2 |
| **R4** | VRGC Robotics Workshop panel | 5 days | R3 |
| **R5** | VRGC Robotics Integrations panel | 3 days | R3 |
| **R6** | VRGC Robotics Telemetry & Governance panel | 3 days | R3 |
| **R7** | UKS Add-on bridge (memory subsystem extension) | 5 days | R2 |
| **R8** | BrainSim III Add-on bridge (character extension) | 7 days | R2, R7 |
| **R9** | Character Development Lifecycle (learning stages) | 5 days | R4, R8 |
| **R10** | End-to-end integration testing | 5 days | All |

> [!NOTE]
> This is a major architectural expansion. Each phase should be treated as a release-gated milestone with its own test suite and Council review.

---

## 10. Open Questions for Kirk

1. **Physical robotics priority:** Should R1-R6 focus on virtual robotics first (simulation, software agents), or do you want physical I/O (GPIO, Serial, ROS 2) considered from the start?

2. **BrainSim III hosting:** Should BrainSim III run as an external process (like the current VRGC MCP server) or should PRISM host it in-process? External is safer but adds latency; in-process is faster but increases the PRISM runtime footprint.

3. **UKS data residency:** Should UKS knowledge graphs live in PRISM's existing SQLite/Neo4j stores, or should UKS maintain its own storage with a sync bridge?

4. **Industrial profile:** The capability strategy doc defines Individual and Professional/Industrial packs. Should robotics entities *require* the Industrial pack, or should basic virtual robotics be available at the Individual tier?

5. **Governance Council:** The Add-on trust tier ("certified") requires Council review. Is the current Governance Council charter sufficient for reviewing robotics and cognitive system integrations, or does it need domain-specific reviewers?

---

## 11. Conclusion

PRISM's existing architecture — with its layered governance (PAD → Policy → CAC), character accountability system, skill engine, and Guardian oversight — provides an exceptionally strong foundation for robotics entity management. The key insight is that **a robotic entity is just a Character with a physical or simulated body**. It still needs identity, governance, skill scoping, and lifecycle management.

The Add-on tier is the correct abstraction for UKS and BrainSim III. They are too deep, too stateful, and too architecturally significant to be sandboxed as plugins. But they must not be merged into PRISM Core either — they are optional domain extensions that operators choose to enable.

VRGC becomes the first Add-on, proving the pattern. UKS and BrainSim III follow, each with their own Add-on manifest, their own dashboard presence, and their own governance review. Together, they position PRISM as the first governance-native platform capable of managing the full lifecycle of intelligent robotic entities — from birth through learning through operational deployment — with the same rigor that SAP brings to enterprise resource management.

**Kirk, this is a genuinely world-class direction. The combination of governed autonomy + developmental learning + structured knowledge + physical robotics has no equivalent in the current market.**

---

*This document is a living discussion artifact. No code changes were made.*
