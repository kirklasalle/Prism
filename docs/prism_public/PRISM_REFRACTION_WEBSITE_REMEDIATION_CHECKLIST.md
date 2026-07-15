# Prism Refraction Website Remediation Checklist

Date: 2026-07-14  
Audience: Deployment owner, front-end engineer, ops/security reviewer  
Source audit: [PRISM_REFRACTION_WEBSITE_WORLD_CLASS_AUDIT.md](PRISM_REFRACTION_WEBSITE_WORLD_CLASS_AUDIT.md)

## Objective

Convert the current public site from a strong technical showcase into a launch-ready, conversion-capable, trust-forward website for prismrefraction.com.

## Delivery Model

1. Phase 1 (P0): 7-day launch blockers.
2. Phase 2 (P1): 30-day upgrade sprint.
3. Phase 3 (P2): 60-90 day scale-up.

---

## Phase 1 (P0) — Launch Blockers (7 Days)

### A. Production Contact Flow

Owner: Back-end + ops  
Priority: Critical

Tasks:

- [ ] Replace inline alert/reset form behavior in [contact.html](contact.html) with real submission flow.
- [ ] Add `POST /contact` handling (HostGator PHP endpoint recommended).
- [ ] Validate server-side fields: name, email, subject, message.
- [ ] Add rate limiting and spam controls (honeypot + simple token check).
- [ ] Send successful submissions to operational email and archive copy.
- [ ] Return explicit JSON or HTML success/failure states to UI.

Acceptance criteria:

- [ ] Form submissions persist and are delivered.
- [ ] Invalid payloads are blocked with user-visible error messaging.
- [ ] Bot submissions are measurably reduced.

### B. Claim-Safety Pass (Legal + Trust)

Owner: Product + legal/comms  
Priority: Critical

Tasks:

- [ ] Rewrite absolute market-claim language in [index.html](index.html) and [features.html](features.html).
- [ ] Add evidence-oriented language and “current release” qualifiers.
- [ ] Add a "What is shipped now" block with concise proof bullets.
- [ ] Keep naming transition clear as Prism Refraction across all top pages.

Acceptance criteria:

- [ ] No absolute superiority claims remain without proof links.
- [ ] Every major security/governance claim has a traceable evidence pointer.

### C. Technical SEO Baseline

Owner: Front-end + SEO  
Priority: High

Tasks:

- [ ] Add canonical tags to all HTML pages.
- [ ] Add Open Graph and X metadata to all HTML pages.
- [ ] Create `robots.txt` in site root.
- [ ] Create `sitemap.xml` in site root.
- [ ] Add structured data JSON-LD (`SoftwareApplication`, `Organization`).

Acceptance criteria:

- [ ] Search console validates sitemap and indexing.
- [ ] Shared links render branded OG cards correctly.

### D. Security and Legal Surface

Owner: Ops + legal  
Priority: High

Tasks:

- [ ] Add `security.html` with disclosure contact and reporting rules.
- [ ] Add `privacy.html` and `terms.html`.
- [ ] Add footer links on all pages to legal/security docs.
- [ ] Add explicit data handling note for contact form submissions.

Acceptance criteria:

- [ ] Footer links visible and valid across pages.
- [ ] Legal/security docs are publicly accessible on production domain.

---

## Phase 2 (P1) — 30-Day Upgrade Sprint

### A. Front-End Maintainability Refactor

Owner: Front-end  
Priority: High

Tasks:

- [ ] Migrate repeated inline styles from [index.html](index.html), [features.html](features.html), [architecture.html](architecture.html), [wiki.html](wiki.html) into [css/styles.css](css/styles.css).
- [ ] Add utility class conventions for spacing, badges, and callouts.
- [ ] Move inline form submit handling from [contact.html](contact.html) into [js/main.js](js/main.js).
- [ ] Split page-specific JS concerns in [js/main.js](js/main.js) into modular sections.

Acceptance criteria:

- [ ] Inline style count reduced by at least 70 percent.
- [ ] Contact logic no longer relies on inline event attributes.

### B. Accessibility Hardening (WCAG-Oriented)

Owner: Front-end + QA  
Priority: High

Tasks:

- [ ] Add visible focus states across nav, buttons, and form controls.
- [ ] Add reduced-motion support for animations and visual effects.
- [ ] Validate heading order and landmark usage per page.
- [ ] Recheck contrast ratios on cyan/purple over dark backgrounds.

Acceptance criteria:

- [ ] Keyboard-only navigation works across all pages.
- [ ] Reduced-motion mode removes non-essential animation effects.

### C. Business Trust Funnel

Owner: Product + front-end  
Priority: High

Tasks:

- [ ] Add a dedicated business trust page (`business.html`) with control matrix.
- [ ] Add explicit deployment, governance, and auditability summary for business evaluators.
- [ ] Add Business CTA path from home, features, and architecture pages.

Acceptance criteria:

- [ ] Business visitor can reach trust and deployment details in 1 click.
- [ ] Business CTA events are trackable.

### D. Analytics and Conversion Instrumentation

Owner: Growth + front-end  
Priority: Medium

Tasks:

- [ ] Implement event tracking for CTA clicks and form lifecycle.
- [ ] Add UTM-safe link handling for campaign attribution.
- [ ] Create baseline conversion dashboard (weekly review).

Acceptance criteria:

- [ ] Funnel from landing to contact submit is measurable.
- [ ] Top pages and top CTAs are quantifiably ranked.

---

## Phase 3 (P2) — 60 to 90 Day Scale-Up

### A. Market Proof Packaging

Owner: Product marketing  
Priority: Medium

Tasks:

- [ ] Publish 2 to 3 case studies (individual and business tracks).
- [ ] Add benchmark/results notes with transparent methodology.
- [ ] Add release timeline and changelog highlights block to home page.

Acceptance criteria:

- [ ] At least one public proof artifact exists for each ICP.

### B. Documentation IA and Content Pathing

Owner: Docs + UX  
Priority: Medium

Tasks:

- [ ] Reduce wiki cognitive load with overview summaries and progressive drill-down.
- [ ] Add beginner, evaluator, and operator path cards in [wiki.html](wiki.html).
- [ ] Improve cross-linking between [features.html](features.html), [architecture.html](architecture.html), and [wiki.html](wiki.html).

Acceptance criteria:

- [ ] Users can self-select the right content path in under 30 seconds.

### C. Static Site Quality Gates

Owner: Engineering  
Priority: Medium

Tasks:

- [ ] Add pre-deploy checks for HTML validity, link checks, and basic accessibility checks.
- [ ] Add image optimization and cache policy review.
- [ ] Add deployment checklist for FTP publishing to HostGator.

Acceptance criteria:

- [ ] Every release passes automated static checks before upload.

---

## Page-by-Page Execution Checklist

### [index.html](index.html)

- [ ] Rewrite high-risk absolute claims.
- [ ] Add trust strip and clearer CTA hierarchy.
- [ ] Add metadata upgrades (canonical, OG, X).

### [features.html](features.html)

- [ ] Tighten claim language to evidence-backed phrasing.
- [ ] Add business outcomes callout with measurable benefits.
- [ ] Migrate inline style blocks to CSS classes.

### [architecture.html](architecture.html)

- [ ] Add concise plain-language summary for non-technical evaluators.
- [ ] Add trust artifact links for governance/security assertions.
- [ ] Optimize SVG and heavy visual sections for performance.

### [wiki.html](wiki.html)

- [ ] Add quick-start cards for three audiences (individual, business, security).
- [ ] Break long sections with short summaries and “read more” anchors.
- [ ] Validate directive/security claims against public evidence links.

### [contact.html](contact.html)

- [ ] Remove inline submit handler.
- [ ] Wire to real server endpoint.
- [ ] Add failure states, loading state, and success confirmation content.

### [css/styles.css](css/styles.css)

- [ ] Introduce utilities for repeated spacing/text/badge patterns.
- [ ] Add reduced-motion media query support.
- [ ] Audit overlay effects for readability and performance.

### [js/main.js](js/main.js)

- [ ] Add robust form submission module.
- [ ] Preserve simulator and wiki behavior while isolating page concerns.
- [ ] Add event-tracking hooks for key CTAs.

---

## Deployment Checklist (HostGator + FTP)

- [ ] Create a timestamped backup of current production HTML/CSS/JS.
- [ ] Upload Phase 1 changes to staging path or temporary subdirectory.
- [ ] Validate links, forms, and metadata in production-like environment.
- [ ] Cut over during low-traffic window.
- [ ] Verify SSL, page rendering, and form delivery post-deploy.
- [ ] Keep rollback package prepared for rapid restore.

---

## Definition of Done

Phase 1 is complete when all of the following are true:

- [ ] Contact form delivers validated submissions end-to-end.
- [ ] High-risk claim language is evidence-safe.
- [ ] SEO baseline files and metadata are deployed.
- [ ] Legal/security pages are live and linked site-wide.

Phase 2 and 3 are complete when conversion telemetry, maintainability refactor, business trust funnel, and market proof artifacts are live and measurable.
