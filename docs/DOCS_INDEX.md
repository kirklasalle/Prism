# PRISM Documentation Index

**Last updated:** 2026-06-18 — Post-audit curation
**Active docs:** 91 files | **Archived:** 66 files → `archive/`

## Quick Links — Start Here

- **[STATUS.md](STATUS.md)** — Authoritative status: what's shipped, pending, gated
- **[../audit.md](../audit.md)** — World-Class Complete Codebase Audit (2026-06-17)
- **[AUDIT_TASK_LIST.md](AUDIT_TASK_LIST.md)** — Prioritized remediation task list
- **[ROADMAP.md](ROADMAP.md)** — Updated with Phase R (Readiness) + Phase S (Skills)
- **[PRISM_SKILLS_ARCHITECTURE.md](PRISM_SKILLS_ARCHITECTURE.md)** — Guardian + CAC-native Skills architecture
- **[../README.md](../README.md)** — Strategy, architecture, current capabilities
- **[../CHANGELOG.md](../CHANGELOG.md)** — Version history

## Core Documents

- PRISM_RESEARCH_DOCUMENTATION.md: full-context research basis and evidence-to-implementation mapping
- PRISM_PRD.md: product requirements and acceptance criteria
- PRISM_GAP_ANALYSIS.md: technical gap baseline and parity implementation blueprint
- DEVELOPER_GUIDE.md: engineering standards and implementation guidance
- USER_GUIDE.md: operator-facing usage and troubleshooting
- SETUP_WIZARD_GUIDE.md: comprehensive setup wizard guide (web, TUI, CLI)
- GETTING_STARTED.md: quick-start guide
- PRISM_GLOSSARY.md: full system glossary and abbreviation guide
- PRISM_FAQ.md: frequently asked questions
- TODO.md: actionable near-term, medium-term, and aspirational work items

## Governance & Security

- PAD_WHITEPAPER.md: Permanent Active Directives — purpose, philosophy, market impact
- TERMS_AND_GOVERNANCE_FRAMEWORK.md: 4-tier governance hierarchy, ToS/AoS
- BUSINESS_TRUST_PROVENANCE_POLICY.md: trust provenance policy
- CI_GATING_POLICY.md: CI gating policy
- D2_PROFILE_AWARE_POLICY_ENGINE.md: profile-aware policy engine
- OWASP_TOP_10_CHECKLIST.md: OWASP Top 10 compliance
- SECURITY_KEY_MANAGEMENT.md: key management
- SOC2_READINESS_CHECKLIST.md: SOC2 readiness

## Operator Guides

- BUSINESS_VS_INDIVIDUAL_GUIDE.md: profile differences — tool-by-tool examples
- DEPLOYMENT_GUIDE.md: local, Docker, Docker Compose, PM2, systemd, TLS
- ADMIN_SRE_GUIDE.md: day-2 operations — health, metrics, rotations, backup
- ERROR_RECOVERY.md: lost admin token, corrupted DB, lost JWT secret
- CHARACTER_SELECTION_GUIDE.md: when to use Aria / Phoenix / Sentinel
- OPERATOR_DASHBOARD_WALKTHROUGH.md: operator dashboard playbook
- COMPUTER_AND_BROWSER_CONTROL_OPERATOR_GUIDE.md: computer/browser control
- INCIDENT_TRIAGE_RUNBOOK.md: incident triage procedure
- PRODUCTION_RELEASE_RUNBOOK.md: staging-to-production release procedure

## Architecture & Design

- COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md: canonical computer-use architecture
- COMPUTER_USE_BUSINESS_GATE_STATUS_SCHEMA.json: business gate schema
- COMPUTER_USE_BUSINESS_GATE_STATUS_TEMPLATE.json: business gate template
- CONTAINER_VIRTUALIZATION_DESIGN.md: container virtualization design
- TERMINAL_VIRTUALIZATION_DESIGN.md: terminal virtualization design
- SOTA_AUTONOMOUS_BROWSER_CONTROL_WHITEPAPER.md: browser control whitepaper
- SOTA_BROWSER_WIKI.md: SSHP, PII masking, Sacred Covenant audits
- sota_browser_control_integration.md: browser control integration
- sota_browser_roadmap.md: browser roadmap

## Market & Strategy

- COMPETITIVE_ANALYSIS_2026.md: full 2026 competitive analysis
- PRISM_COMPETITIVE_AaaS_MAP_2026.md: AaaS market survey
- MARKET_REVIEW.md: competitive landscape for Spectrum Refraction
- INDIVIDUAL_PROFESSIONAL_INDUSTRIAL_CAPABILITY_STRATEGY.md: capability strategy
- INVESTOR_APPENDIX_PARITY.md: investor narrative
- LICENSING_BRAND_APPENDIX.md: licensing and brand framework
- LICENSE_MODEL_RECOMMENDATION.md: licensing model recommendation
- OSWORLD_PUBLICATION_PLAN.md: OSWorld benchmark publication policy

## Delivery & QA

- PHASE_EXECUTION_PLAN.md: phase definitions and gate criteria
- PHASE_C_TASKS_MANIFEST.md: Phase C task manifest
- PHASE_D1_TASKS_MANIFEST.md: Phase D1 task manifest
- PHASE_D2_TASKS_MANIFEST.md: Phase D2 task manifest
- PHASE_D3_TASKS_MANIFEST.md: Phase D3 task manifest
- PHASE_D4_TASKS_MANIFEST.md: Phase D4 task manifest
- PHASE_E_TASKS_MANIFEST.md: Phase E task manifest
- TEST_STRATEGY.md: test layers and release test gates
- REQUIREMENTS_TRACEABILITY_MATRIX.md: requirement-to-test mapping
- D4_COVERAGE_VALIDATION.md: Phase D4 coverage validation
- PHASE_D2_RELEASE_PACKET_TEMPLATE.md: release packet template
- PHASE_E3b_SESSION_GOVERNANCE.md: session governance

## Integration & Tooling

- A2A_OCI_INTEGRATION_SPEC.md: A2A Protocol Server + OCI integration
- TOOL_CONTRACT_EXTRACTION_SPEC.md: tool contract extraction
- PLUGIN_SDK_AUTHORING_GUIDE.md: plugin SDK guide
- MARKETPLACE_CURATION_POLICY.md: marketplace curation policy
- VRGC_NETWORK_PROTOCOLS.md: VRGC network protocols

## Reference

- EXECUTION_PROFILES_GUIDE.md: execution profiles guide
- EXECUTION_PROFILE_ENVIRONMENT_CONFIG.md: environment config
- EXECUTION_PROFILE_IMPLEMENTATION.md: profile implementation
- PROFILE_CAPABILITY_PARITY_MATRIX.md: profile capability parity
- LLM_MODEL_MATRIX.md: LLM model matrix
- OLLAMA_CLOUD_PROVIDER_REFERENCE.md: Ollama cloud provider reference
- LINUX_MACOS_PARITY_REPORT.md: Linux/macOS parity report
- skills_matrix.md: skills matrix
- skills_integration_walkthrough.md: skills integration
- DEMO_USE_CASE_MATRIX.md: demo use case matrix
- APPROVAL_AUTO_RUN.md: approval auto-run
- PUBLIC_SELF_TEST_GUIDE.md: public self-test guide
- PTAC_OPERATOR_DEMO_GUIDE.md: PTAC operator demo
- BASE_MODE_BOOT_TRACING.md: base mode boot tracing
- READINESS_RUNBOOK.md: operator readiness runbook
- PRISM_UPDATED_ROADMAP_2026_Q2.md: Q2 roadmap update
- RELEASE_NOTES_APPROVAL_AUTO_RUN.md: approval auto-run release notes

## Interactive Docs

- OPERATOR_DASHBOARD_WALKTHROUGH.html: styled dashboard walkthrough
- PRISM_PUBLIC_LAUNCH_ROADMAP_AND_CHECKLIST_2026.html: interactive launch checklist

## Archive

- **66 documents** have been archived to `archive/` as of 2026-06-18.
- These include superseded audits, stale implementation plans, walkthrough logs, and scratchpads.
- See `archive/README.md` for details.

## Recommended Reading Order

1. STATUS.md — what is PRISM right now?
2. ../README.md — strategy and architecture
3. ../audit.md — comprehensive codebase audit
4. PRISM_RESEARCH_DOCUMENTATION.md — full research basis
5. ROADMAP.md — near-term priorities
6. GETTING_STARTED.md — start using PRISM
7. DEVELOPER_GUIDE.md — engineering standards

- ROADMAP.md: Phase S3 milestones (S3-M1 through S3-M4)
- PRISM_GAP_ANALYSIS.md: Gap 7 (CLI wizard parity) + Milestone M7
- TODO.md: Phase S3 near-term items

## Permanent Active Directives (PAD) — Cryptographic Governance Infrastructure

The following documents comprise the PAD governance layer:

- ../Permanent_Active_Directives.txt: The root governance artifact — the 10 Laws (SHA-256 integrity-verified)
- TERMS_AND_GOVERNANCE_FRAMEWORK.md: 4-tier governance hierarchy, ToS/AoS framework, compliance mapping
- PAD_WHITEPAPER.md: Standalone paper — purpose, philosophy, market impact, responsible AI contribution
- CI_GATING_POLICY.md: Gate 9 (Directive Integrity) — blocks merge/release on PAD hash mismatch
- BUSINESS_TRUST_PROVENANCE_POLICY.md: Trust and provenance requirements subordinate to PAD governance

### Runtime Enforcement (code)

- `src/core/security/directive-integrity.ts`: SHA-256 verification module
- `src/core/security/directive-manifest.ts`: Machine-readable 10 Laws with enforcement mapping
- `src/core/agents/guardian-agent.ts`: Periodic directive integrity task (600s interval)
- `src/core/operator/dashboard-service.ts`: Boot-time PAD verification
- `src/core/operator/model-capability-matrix.ts`: Governance preamble injection into system prompts
- `src/core/policy/reason-codes.ts`: Directive-specific reason codes
