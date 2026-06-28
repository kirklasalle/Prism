# PRISM Commercialization and Licensing Strategy Plan

**Created:** June 28, 2026  
**Audience:** Founders, Board, Legal Counsel  
**Status:** Active Strategy Document  

---

## 1. Executive Summary

With the successful public open-source launch of PRISM under the Apache License 2.0, the platform is positioned to drive maximum developer adoption, community contributions, and mindshare. 

To transition from an open-source project to a sustainable, high-revenue commercial business, PRISM will implement a **Dual-Licensing / Open Core model** (Option D from the Licensing Strategy). This model keeps the core agent execution runtime open-source while locking advanced enterprise governance, identity integration, compliance features, and hosted scale behind a commercial license tier.

---

## 2. The Open Core Model & Feature Boundaries

We establish a clear boundary between the **Open Core (Apache-2.0)** and **Commercial/Enterprise (PRISM Commercial License)** tiers. This boundary is enforced both in policy and inside the repository structure.

### 2.1 PRISM Open Core (Apache-2.0)
* **Target Audience:** Individual operators, developers, sandbox environments, and academic researchers.
* **Core Package:**
  * Core runtime orchestrator, agents pool, and 3-tier policy engine.
  * System tools (filesystem, shell execution with basic safeguards).
  * Local memory systems (episodic, session summaries, semantic index).
  * TUI and standard single-session Dashboard interface.
  * Model capability matrix, Spectrum Refraction (SR) configuration, and local provider switching.
  * Developer-focused skills: Browser Researcher, Terminal, local Container Sandbox.
* **Objective:** Serve as our primary top-of-funnel customer acquisition and developer advocacy tool.

### 2.2 PRISM Business / Enterprise (PRISM Commercial License)
* **Target Audience:** Mid-market and Fortune 500 enterprises deploying production-grade, multi-tenant agent swarms.
* **Enterprise Features (Paid Gates):**
  * **Enterprise SSO & IAM:** Full SAML 2.0 / OIDC user mapping and groups, plus SCIM v2 automated user provisioning.
  * **Multi-Tenancy Plane:** Strict tenant database isolation and AsyncLocalStorage tenant context enforcement.
  * **SOC2 & Regulatory Compliance:** Automated audit log export, compliance telemetry dashboard, and evidence bundle generation.
  * **Centralized Swarm Telemetry:** Multi-environment telemetry synchronization and unified logging pipelines.
  * **Certified Plugin Marketplace:** Signed enterprise plugins (e.g., Salesforce, ServiceNow, SAP) with Ed25519 signing checks.
  * **Hosted SaaS (PRISM Cloud):** Zero-ops hosting, managed scaling, on-call support SLAs, and automatic key management.
* **Objective:** Capture high-margin contract values from organizations requiring strict security, compliance, and convenience.

---

## 3. Commercialization Road Forward

To successfully move forward from the public launch, we are executing the following tactical steps:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. PROTECT THE BRAND                                        │
│    File trademarks for PRISM mark and logos.                │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 2. ESTABLISH CONTRIBUTOR LICENSE AGREEMENT (CLA)            │
│    Add CLA workflow to protect patent and commercial rights.│
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 3. RESERVE ENTERPRISE PATHS                                 │
│    Configure CODEOWNERS and folder boundaries.              │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 4. STAGE THE COMMERCIAL LICENSE                             │
│    Create LICENSE-COMMERCIAL.md and NOTICE templates.       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ 5. DEVELOP PRISM CLOUD / ENTERPRISE SKU                     │
│    Package enterprise features as a distinct install.        │
└─────────────────────────────────────────────────────────────┘
```

### Step 3.1: Trademark Filings (Immediate Legal Action)
Open-source licenses allow anyone to modify the code, but they do **not** grant the right to use the brand name.
* **Action:** File US/EU trademark applications for the name **PRISM** and any official graphics.
* **Rule:** Anyone can fork the codebase under Apache-2.0, but they must rename it (e.g., to "RefractionAgent") if they distribute it, preserving the official PRISM brand value exclusively for your business.

### Step 3.2: Contributor License Agreements (CLA) (Immediate Code Action)
To ensure we can legally package community-contributed code into our commercial enterprise offerings without patent or copyright disputes, we require a Contributor License Agreement.
* **Action:** Deploy `.github/workflows/cla.yml` to automatically verify that every pull request contributor agrees to our standard CLA terms.

### Step 3.3: Reserve Enterprise Folder Boundaries (Immediate Code Action)
* **Action:** Establish folder structures (`src/enterprise/` and `src/core/iam/sso/`) in code ownership configuration (`.github/CODEOWNERS`) to demarcate commercial modules.

### Step 3.4: Staging Licenses and boilerplates (Immediate Code Action)
* **Action:** Write `LICENSE-COMMERCIAL.md` placeholder and `NOTICE` file containing proper open-source attributions.

---

## 4. Packaging and Monetization Options

To capture maximum value, PRISM will be packaged in three offerings:

| Package | Model | Key Value Prop | Pricing Indicator |
|:---|:---|:---|:---|
| **PRISM Individual** | Open Core | Elite capability, fast local operator console, governed tool executions. | $0 (Free Forever) |
| **PRISM Business** | Self-Hosted Commercial | Verifiable governance, SSO/SCIM integration, auditable decision logs. | $150–$300 / user / month |
| **PRISM Cloud** | Managed SaaS | Zero-configuration setup, fully managed cloud compute, unified agent fleet management. | Usage-based (Token markup + platform fee) |

---

## 5. Summary of Immediate Technical Enactments

We are implementing the following immediate files in this commit to start the commercialization push:
1. **`docs/PRISM_COMMERCIALIZATION_PLAN.md`**: This strategy and plan.
2. **`LICENSE-COMMERCIAL.md`**: Template and guidelines outlining standard commercial restriction.
3. **`NOTICE`**: Standard Apache 2.0 attribution file.
4. **`.github/workflows/cla.yml`**: GitHub action configuration for the CLA Assistant bot.
5. **`.github/CODEOWNERS`**: Codeownership definitions protecting core and enterprise-marked scopes.
