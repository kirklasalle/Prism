# PRISM License Model Recommendation

**Status:** Engineering recommendation (May 2026). Final decision is **legal + business-led**.
**Audience:** Founders, legal counsel, board.
**Companion docs:** [LICENSING_BRAND_APPENDIX.md](LICENSING_BRAND_APPENDIX.md), [MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md)

---

## TL;DR

**Recommended:** Dual license — **Apache-2.0 for the open core** + **PRISM Commercial License** for enterprise features and hosted services. Plugins SDK and SDK examples are Apache-2.0 unconditionally. Plugin authors retain their own license choice.

This recommendation is informed by the maturity of comparable AaaS platforms (LangChain, Dagster, Temporal, n8n) and the specific posture of PRISM as Agents-as-a-Service infrastructure with strong governance primitives.

## 1. Decision matrix

| Option | Open core | Commercial gates | Strength | Weakness |
|--------|-----------|------------------|----------|----------|
| **A. Pure Apache-2.0** | All | None | Maximum adoption; unambiguous; permissive | No revenue protection; cloud providers can fork |
| **B. AGPL-3.0** | All | None (copyleft) | Strong defense vs cloud forks | Enterprise legal teams reject AGPL by policy |
| **C. BSL → Apache-2.0** | Conversion after N years | Time-bound restrictions | HashiCorp / Cockroach pattern; preserves option value | Friction for early adopters; license confusion |
| **D. Dual: Apache-2.0 + Commercial** ⭐ | Core | Enterprise SSO, multi-tenancy mgmt, premium support, hosted SaaS | Standard SaaS pattern; clear upgrade story | Requires CLA + contributor agreement governance |
| **E. SSPL** | All | None | Block cloud-fork SaaS clones | OSI-rejected; many distros refuse to package |

**Recommendation: Option D**, modified with a clear core/commercial boundary documented in this repo.

## 2. Open core boundary

### Apache-2.0 (free, redistributable, modifiable)

- Core runtime ([`src/core/`](../src/core/) excluding enterprise-marked subdirs)
- All adapters in [`src/adapters/`](../src/adapters/)
- Plugin SDK + scaffolder ([`scripts/scaffold-plugin.cjs`](../scripts/scaffold-plugin.cjs))
- TUI + dashboard frontend
- Documentation
- Test suites
- Reference plugin packs in `examples/marketplace/`

### PRISM Commercial License (paid, per-seat or per-tenant)

- Multi-tenant management plane (advanced TenantContext orchestration beyond the included AsyncLocalStorage seam)
- Enterprise SSO (SAML, OIDC group mapping)
- Audit log retention beyond 90 days
- Premium support SLAs
- Hosted PRISM Cloud (managed control plane, billing, on-call)
- Pre-curated enterprise plugin bundles

The boundary is **enforced by code**, not just docs: enterprise modules live under a clearly-marked `enterprise/` subtree (currently absent from the open repo) and require a signed entitlement to activate.

## 3. Contributor License Agreement (CLA)

Required for the dual-license model to remain viable. Recommendation:

- **Lightweight CLA**: copyright remains with the contributor; PRISM gets a non-exclusive perpetual license to relicense under the commercial license.
- Use a standard Apache CLA template (Apache ICLA / Google CLA pattern).
- Bot-enforced on PR open via GitHub Actions.

## 4. Trademark policy

- **PRISM** and the word mark are reserved trademarks even when the codebase is Apache-2.0 licensed.
- Forks may use the code; they must rename. (Standard pattern; see Mattermost, Mautic.)
- Plugins may reference compatibility ("works with PRISM") but may not use the PRISM mark in product names without permission.

## 5. Plugin license expectations

- Plugins are independent works. Authors choose their own license.
- The marketplace curation policy ([MARKETPLACE_CURATION_POLICY.md](MARKETPLACE_CURATION_POLICY.md) §3.1) **requires OSI-approved licenses** for `approved` curation status.
- Plugin source must declare license in `plugin.manifest.json` and ship a `LICENSE` file.

## 6. Migration path if we choose differently

| If we pick | Migration cost | Reversibility |
|-----------|----------------|---------------|
| Pure Apache (Option A) | Low — already permissive | Hard to add commercial gates later (community pushback) |
| BSL (Option C) | Medium — author CLA, BSL conversion clock | Reversible at conversion date |
| AGPL (Option B) | High — every contributor must agree | Hard to revert; many enterprise users gone permanently |

Option D preserves optionality: we can always relax to pure Apache-2.0 later. We **cannot** easily go from pure Apache-2.0 to a more restrictive license without contributor consent.

## 7. Open questions for legal

1. Is the trademark application filed? (US + EU + JP recommended.)
2. Does the commercial license need to comply with EU Cyber Resilience Act (CRA) carve-outs for open-source maintainers?
3. CLA: bot-enforced on every PR or one-time signing per contributor?
4. Patent provisions: Apache-2.0 patent grant covers the core; commercial license needs explicit patent grant + reciprocity clause.
5. Export control: dual-use AI rules (US BIS, EU AI Act) — does the commercial license need an explicit prohibited-use rider?

## 8. Action items (engineering)

- [ ] Draft `LICENSE` file (Apache-2.0) at repo root
- [ ] Draft `LICENSE-COMMERCIAL.md` placeholder pending legal text
- [ ] Add `NOTICE` file with attribution boilerplate
- [ ] Add CLA bot configuration (`.github/workflows/cla.yml`)
- [ ] Mark `enterprise/` directory boundary in CODEOWNERS
- [ ] Add `SPDX-License-Identifier: Apache-2.0` headers to all `src/**` files in a follow-up batch

These are not blocking for private beta but are blockers for **public launch**.

## 9. References

- Apache 2.0 license text: <https://www.apache.org/licenses/LICENSE-2.0>
- Comparable models: HashiCorp BSL, Elastic Dual License v2, MongoDB SSPL
- AICPA SOC 2 trust criteria — see [SOC2_READINESS_CHECKLIST.md](SOC2_READINESS_CHECKLIST.md)
- Internal: [LICENSING_BRAND_APPENDIX.md](LICENSING_BRAND_APPENDIX.md)
