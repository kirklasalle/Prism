# PRISM Documentation Index

## Core Documents

- ../README.md: strategy, architecture, current capabilities
- INDIVIDUAL_PROFESSIONAL_INDUSTRIAL_CAPABILITY_STRATEGY.md: implementation baseline for individual-native capabilities and gated professional/industrial packs
- PRISM_RESEARCH_DOCUMENTATION.md: full-context research basis and evidence-to-implementation mapping
- PRISM_PRD.md: product requirements and acceptance criteria
- DEVELOPER_GUIDE.md: engineering standards and implementation guidance
- USER_GUIDE.md: operator-facing usage and troubleshooting
- SETUP_WIZARD_GUIDE.md: comprehensive setup wizard guide (web, TUI, CLI) with configuration reference and troubleshooting
- ROADMAP.md: status and near-term priorities
- PRISM_GAP_ANALYSIS.md: technical gap baseline and parity implementation blueprint
- COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md: canonical browser/terminal/container computer-use architecture, security gate, and evidence model
- REQUIREMENTS_TRACEABILITY_MATRIX.md: requirement-to-test-to-artifact mapping for Phase D2 parity release gating
- PHASE_D2_RELEASE_PACKET_TEMPLATE.md: required artifact structure, file templates, and sign-off checklist for Phase D2 candidate releases
- INVESTOR_APPENDIX_PARITY.md: investor narrative for parity + governance moat
- LICENSING_BRAND_APPENDIX.md: licensing and brand framework for Individual vs Business profiles
- MARKET_REVIEW.md: competitive landscape analysis for Spectrum Refraction positioning (6 frameworks)
- COMPETITIVE_ANALYSIS_2026.md: full 2026 competitive analysis — AaaS market, top 10 frameworks, Docker Agent, scorecard, strategic positioning (11 competitors including Docker Agent's 20M+ install base)
- A2A_OCI_INTEGRATION_SPEC.md: A2A Protocol Server + OCI Character Packaging integration spec (Phase F/G, Docker Agent interoperability)
- TERMS_AND_GOVERNANCE_FRAMEWORK.md: 4-tier governance hierarchy, ToS/AoS, compliance alignment
- PAD_WHITEPAPER.md: Permanent Active Directives — purpose, philosophy, market impact, responsible AI
- TODO.md: actionable near-term, medium-term, and aspirational work items
- ../CHANGELOG.md: version history and release notes

## 2026 Q2 Audit and Readiness (NEW)

- PRISM_FULL_AUDIT_2026_Q2.md: comprehensive audit — what is implemented, what looks complete but isn't, canonical gap list G-1 through G-25, system critique, readiness scorecard
- PRISM_COMPETITIVE_AaaS_MAP_2026.md: AaaS market survey — top 10 frameworks, commercial cloud AaaS list, OSS toolkits, unique-niche positioning for PRISM
- PRISM_UPDATED_ROADMAP_2026_Q2.md: formal roadmap appending Phase R (Readiness) between E and F; extended F/G/H/I workstreams
- READINESS_RUNBOOK.md: operator checklist turning Phase R into executable tasks with IDs, target files, acceptance criteria, and effort bands
- PTAC_OPERATOR_DEMO_GUIDE.md: walkthrough + reference for the v0.20 self-drive demo button — three gates, suite selector, slideshow viewer, endpoint reference, security posture, FAQ

## User and Operator Guides (NEW)

- BUSINESS_VS_INDIVIDUAL_GUIDE.md: profile differences — tool-by-tool examples, CAC domain enforcement, character pairing
- DEPLOYMENT_GUIDE.md: local, Docker, Docker Compose, PM2, systemd, TLS, backup, post-deploy checklist
- ADMIN_SRE_GUIDE.md: day-2 operations — health, metrics, rotations, backup drills, incident response, capacity planning
- ERROR_RECOVERY.md: lost admin token, corrupted DB, lost JWT secret, expired TLS, plugin verification failures, PAD integrity violations
- CHARACTER_SELECTION_GUIDE.md: when to use Aria / Phoenix / Sentinel × Individual / Business variants

## Delivery and Release Support

- PHASE_EXECUTION_PLAN.md: phase definitions and gate criteria
- TEST_STRATEGY.md: test layers and release test gates
- PRODUCTION_RELEASE_RUNBOOK.md: staging-to-production release procedure

## Recommended Reading Order

1. ../README.md
2. PRISM_RESEARCH_DOCUMENTATION.md
3. PRISM_PRD.md
4. ROADMAP.md
5. DEVELOPER_GUIDE.md
6. USER_GUIDE.md
6A. SETUP_WIZARD_GUIDE.md
7. PRISM_GAP_ANALYSIS.md
8. COMPUTER_USE_COMPREHENSIVE_DEEP_DIVE.md
9. REQUIREMENTS_TRACEABILITY_MATRIX.md
10. PHASE_D2_RELEASE_PACKET_TEMPLATE.md
11. INVESTOR_APPENDIX_PARITY.md
12. LICENSING_BRAND_APPENDIX.md
13. PHASE_EXECUTION_PLAN.md
14. TEST_STRATEGY.md
15. PRODUCTION_RELEASE_RUNBOOK.md
16. MARKET_REVIEW.md
16A. COMPETITIVE_ANALYSIS_2026.md
16B. A2A_OCI_INTEGRATION_SPEC.md
17. TODO.md

## Phase D3 Agent Control & Swarm Intelligence

The following documents have been updated to reflect Phase D3 capabilities:

- PRISM_PRD.md §8.8: Agent Control & Swarm Orchestration requirements
- DEVELOPER_GUIDE.md §7A: Agent Lifecycle & Swarm Architecture
- USER_GUIDE.md §5.6: Agentic Control tab
- PRISM_RESEARCH_DOCUMENTATION.md §12.3–12.4: Swarm implementation status and competitive positioning
- ROADMAP.md: Phase D3 entry
- PRISM_GAP_ANALYSIS.md: Gap 5 + Milestone M5
- PHASE_EXECUTION_PLAN.md: Phase D3 scope and gate evidence
- TEST_STRATEGY.md: Phase D3 governance scenarios and release gates
- REQUIREMENTS_TRACEABILITY_MATRIX.md: D3-R1 through D3-R8
- INVESTOR_APPENDIX_PARITY.md: Moat component 5 + Milestone M5
- LICENSING_BRAND_APPENDIX.md: Agent Orchestration Package
- INDIVIDUAL_PROFESSIONAL_INDUSTRIAL_CAPABILITY_STRATEGY.md: Layer B agent orchestration

## Phase D4 Spectrum Refraction (SR) — Tri-Model Orchestration

The following documents have been updated to reflect Phase D4 SR capabilities:

- PRISM_PRD.md §8.9: Spectrum Refraction requirements (SR-R1 through SR-R7)
- DEVELOPER_GUIDE.md §7D: SR Architecture and implementation
- USER_GUIDE.md §5.3: SR Model Orchestration panel
- ROADMAP.md: Phase D4 entry
- PRISM_GAP_ANALYSIS.md: Gap 6 (closed) + Milestone M6
- TEST_STRATEGY.md: Phase D4 SR governance scenarios and release gates
- MARKET_REVIEW.md: Competitive positioning and feature comparison (6 frameworks)
- ../CHANGELOG.md: v0.4.0 release notes
- TODO.md: SR near-term and aspirational work items

## Phase S3 Setup Wizard Completeness

The following documents have been created or updated to reflect Phase S3 wizard planning:

- SETUP_WIZARD_GUIDE.md: Comprehensive standalone wizard guide (web basic, web advanced, TUI, CLI planned)
- USER_GUIDE.md §4A: Setup Wizard user walkthrough with variant comparison table
- DEVELOPER_GUIDE.md §7E: Setup Wizard architecture, API reference, source files, extension guide
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
