# PRISM Wiki: Sovereign Sentinel & Cognitive Handoff (SSHP & CSH)

Welcome to the **PRISM Wiki**. This central reference wiki provides an in-depth architectural breakdown, developer API index, security posture scorecard, and operator runbook for **Computer Control**, **Browser Use**, **OS World**, and our zero-trust human-in-the-loop protection protocols: the **Sovereign Sentinel Hyper-Proxy (SSHP)** and the **Cognitive Session Handoff (CSH) "Baton Pass"**.

---

## 1. System Architecture Diagrams

### 1.1 Sovereign Sentinel (SSHP) Privacy Shielding Pipeline
This SVG diagram illustrates how raw page elements, text streams, and frame buffers are intercepted, sanitized, and audited inside the isolation container before hitting any network endpoints.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 350" width="100%" style="background:#0b1728; border-radius:8px; border:1px solid #1e293b; padding:15px; font-family:'Outfit',system-ui,-apple-system,sans-serif;">
  <!-- Definitions for gradients -->
  <defs>
    <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#6d28d9" />
    </linearGradient>
    <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#047857" />
    </linearGradient>
    <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ef4444" />
      <stop offset="100%" stop-color="#b91c1c" />
    </linearGradient>
  </defs>

  <!-- Flow lines -->
  <path d="M 150 175 L 240 175" stroke="#475569" stroke-width="2" marker-end="url(#arrow)" />
  <path d="M 370 175 L 430 175" stroke="#475569" stroke-width="2" />
  <path d="M 550 175 L 640 175" stroke="#475569" stroke-width="2" />
  
  <path d="M 490 120 L 490 85 L 685 85 L 685 120" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="4,4" fill="none" />

  <!-- Node 1: Raw Sandbox Input -->
  <rect x="20" y="120" width="130" height="110" rx="6" fill="url(#blueGrad)" />
  <text x="85" y="150" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">Playwright Sandbox</text>
  <text x="85" y="175" fill="#93c5fd" font-size="11" text-anchor="middle">• Password Elements</text>
  <text x="85" y="195" fill="#93c5fd" font-size="11" text-anchor="middle">• Raw HTML DOM</text>
  <text x="85" y="215" fill="#93c5fd" font-size="11" text-anchor="middle">• Live Screenshots</text>

  <!-- Node 2: SSHP Interceptor Core -->
  <rect x="240" y="100" width="130" height="150" rx="8" fill="url(#purpleGrad)" stroke="#c084fc" stroke-width="1.5" />
  <text x="305" y="130" fill="#ffffff" font-size="14" font-weight="700" text-anchor="middle">SSHP Engine</text>
  <text x="305" y="160" fill="#e9d5ff" font-size="11" text-anchor="middle">Visual PII Redactor</text>
  <text x="305" y="180" fill="#e9d5ff" font-size="11" text-anchor="middle">DOM Regex Scrubber</text>
  <text x="305" y="200" fill="#e9d5ff" font-size="11" text-anchor="middle">Sharp SVG Overlay</text>
  <text x="305" y="220" fill="#e9d5ff" font-size="11" text-anchor="middle">Dynamic Config Gate</text>

  <!-- Node 3: Sacred Covenant Auditor -->
  <polygon points="490,100 550,175 490,250 430,175" fill="url(#redGrad)" stroke="#fca5a5" stroke-width="1.5" />
  <text x="490" y="165" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">Sacred</text>
  <text x="490" y="180" fill="#ffffff" font-size="12" font-weight="700" text-anchor="middle">Covenant</text>
  <text x="490" y="195" fill="#fca5a5" font-size="10" text-anchor="middle">Action Audit</text>

  <!-- Node 4: Sanitized API Output -->
  <rect x="640" y="120" width="140" height="110" rx="6" fill="url(#greenGrad)" />
  <text x="710" y="150" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">AI API Endpoint</text>
  <text x="710" y="175" fill="#a7f3d0" font-size="11" text-anchor="middle">🛡️ Masked PNGs</text>
  <text x="710" y="195" fill="#a7f3d0" font-size="11" text-anchor="middle">🛡️ Scrubbed DOM</text>
  <text x="710" y="215" fill="#a7f3d0" font-size="11" text-anchor="middle">🛡️ Compliant Traces</text>

  <!-- Loop back annotation -->
  <rect x="540" y="55" width="100" height="20" rx="4" fill="#1e293b" />
  <text x="590" y="69" fill="#c084fc" font-size="10" font-weight="600" text-anchor="middle">SSHP Preference</text>

  <!-- Arrow marker template -->
  <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
  </marker>
</svg>

---

### 1.2 Cognitive Session Handoff (CSH) "Baton Pass" State Machine
This diagram shows the FSM state loops of autonomous models pausing, compiling state packages, triggering human operator prompts, and cleanly resuming operation.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 350" width="100%" style="background:#0b1728; border-radius:8px; border:1px solid #1e293b; padding:15px; font-family:'Outfit',system-ui,-apple-system,sans-serif;">
  <!-- Flow paths -->
  <path d="M 140 175 L 210 175" stroke="#475569" stroke-width="2" marker-end="url(#arrow)" />
  <path d="M 330 175 L 400 175" stroke="#ef4444" stroke-dasharray="3,3" stroke-width="2" marker-end="url(#arrow)" />
  <path d="M 520 175 L 590 175" stroke="#10b981" stroke-width="2" marker-end="url(#arrow)" />
  
  <!-- Curved loopback for resume -->
  <path d="M 660 120 C 660 40, 270 40, 270 120" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="5,5" marker-end="url(#arrow)" />

  <!-- Node 1: Running state -->
  <rect x="20" y="130" width="120" height="90" rx="6" fill="#1e3a8a" stroke="#3b82f6" stroke-width="1.5" />
  <text x="80" y="170" fill="#ffffff" font-size="14" font-weight="700" text-anchor="middle">FSM: running</text>
  <text x="80" y="195" fill="#93c5fd" font-size="10" text-anchor="middle">Autonomous Planner</text>

  <!-- Node 2: Encounter Roadblock -->
  <rect x="210" y="125" width="120" height="100" rx="8" fill="#581c87" stroke="#8b5cf6" stroke-width="1.5" />
  <text x="270" y="155" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">Roadblock Event</text>
  <text x="270" y="180" fill="#d8b4fe" font-size="10" text-anchor="middle">CAPTCHA / MFA /</text>
  <text x="270" y="195" fill="#d8b4fe" font-size="10" text-anchor="middle">Safety Intercept</text>

  <!-- Node 3: Suspended State -->
  <rect x="400" y="125" width="120" height="100" rx="8" fill="#7f1d1d" stroke="#ef4444" stroke-width="1.5" />
  <text x="460" y="155" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">FSM: suspended</text>
  <text x="460" y="180" fill="#fca5a5" font-size="10" text-anchor="middle">Handoff Serialized</text>
  <text x="460" y="200" fill="#fca5a5" font-size="10" text-anchor="middle">Baton Pass Card Active</text>

  <!-- Node 4: Human Intervention -->
  <rect x="590" y="120" width="140" height="110" rx="8" fill="#065f46" stroke="#10b981" stroke-width="1.5" />
  <text x="660" y="150" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">Operator Control</text>
  <text x="660" y="175" fill="#a7f3d0" font-size="10" text-anchor="middle">Solve Roadblock</text>
  <text x="660" y="190" fill="#a7f3d0" font-size="10" text-anchor="middle">&amp; Click "Resume"</text>
  <text x="660" y="210" fill="#34d399" font-size="10" font-weight="600" text-anchor="middle">Restore State DB</text>

  <!-- Loopback Text -->
  <rect x="420" y="20" width="130" height="22" rx="4" fill="#0f172a" />
  <text x="485" y="35" fill="#60a5fa" font-size="10" font-weight="700" text-anchor="middle">Deserialize &amp; Resume Loop</text>
</svg>

---

## 2. Quick Start Command Reference

Operators and developers can run automated browser or OS-level agent scenarios using pre-configured npm scripts inside the repository:

### 2.1 Computer Control Profiles
PRISM supports two primary execution profiles depending on security and virtualization tolerances:
* **Sandbox Profile (Recommended & Zero-Risk)**: Spins up a containerized browser instance isolated inside a Fluxbox window manager, Playwright, and an Xvfb virtual framebuffer. It is fully sandboxed and has zero access to your host machine's sensitive filesystem.
  ```bash
  npm run ptac:sandbox
  ```
* **Host Profile (Direct Input takeover)**: Drives native OS mouse actions and keyboard entries directly on the operator's physical host machine. Requires confirming safety acknowledgement flags before execution:
  ```bash
  npm run ptac:host -- --i-understand-host-control
  ```

### 2.2 OS World Benchmark Suite
To run the SOTA OSWorld evaluation suite to verify GUI visual grounding, visual parsing, and multi-app tasks:
```bash
npm run ptac:osworld
```

### 2.3 Running Self-Driving Demos
* **Standard Sandbox Demo**: Executes self-driving browser demo scenarios in the isolated sandbox:
  ```bash
  npm run ptac:demo
  ```
* **Recorded Demo (Slideshow/Video manifest)**: Compiles visual screenshots of the run into a browser-playable slideshow asset. Make sure you set the dual-safety environment variables first:
  ```bash
  # Windows Powershell
  $env:PRISM_PTAC_SAFE="1"
  $env:PRISM_PTAC_RECORD_VIDEO="1"
  npm run ptac:demo-recording
  ```

---

## 3. Sovereign Sentinel Hyper-Proxy (SSHP)

The **Sovereign Sentinel Hyper-Proxy (SSHP)** acts as a local zero-trust privacy gate embedded directly inside the sandboxed environment. It intercepts play scripts, DOM trees, and screenshots *before* sending payload structures to third-party language model API endpoints.

### 3.1 Key Protective Elements
1. **Visual Overlay Redactor**: Detects password inputs (`input[type="password"]`), credit card numeric groups, and SSNs. Layering solid black bounding rects on top of binary Playwright viewport PNG frames using the high-performance `sharp` library.
2. **DOM PII Scrubber**: Employs Regex patterns to automatically scrub raw credit card numbers, emails, and SSN formats from live HTML page snapshots before they are shared.
3. **Sacred Covenant Audit**: Hooked into browser operations inside the dynamic server framework. Blocks dangerous local requests (such as navigating to `file:///etc/passwd`) or execution payloads (such as running `localStorage.clear()` to wipe auth indexes) instantly.

### 3.2 Dynamic Preference API & Settings Integration
SSHP is fully operator-controlled. It is enabled by default to secure the workspace but can be toggled on/off interactively.
* **Settings Tab Control**: Toggled directly via the *Sovereign Sentinel Shielding* card.
* **Live Status Indicator**: A live dynamic badge (`🛡️ SSHP ACTIVE` / `🛡️ SSHP OFF`) is rendered in the Browser Control header to give operators immediate feedback.
* **Direct REST API Endpoints**:
  * **Path**: `POST /api/preferences/sshp-redaction`
  * **Payload**:
    ```json
    { "enabled": false }
    ```

---

## 4. Cognitive Session Handoff (CSH) "Baton Pass"

The **Cognitive Session Handoff (CSH)** protocol defines a structured state transition when autonomous planners hit natural barriers (e.g., CAPTCHAs, MFA prompts, identity verification checks, or safety violations).

```
[Agent Loops] ➔ (Roadblock) ➔ [State Serialized] ➔ [FSM Paused] ➔ [Operator Notified] ➔ (Operator Solves) ➔ [State Restored] ➔ [Agent Resumes]
```

### 4.1 State Serialization Mechanics
When a handoff is triggered, PRISM compiles a serializable JSON state package including:
* **Cookies**: Session tokens, cross-site auth tickets.
* **Storage**: Complete dumps of local storage (`localStorage`) and session storage (`sessionStorage`).
* **Telemetry**: Navigation history trace arrays, planning DAG states, and internal system logs.

This allows the agent's task to be suspended safely, letting the operator resolve the blocker manually in a headed viewport.

### 4.2 Dashboard CSH Integrations (Phase E)
* **CSH Baton Pass Panel**: Renders pending handoffs directly inside the **Agentic Tab**, showing the roadblock reason, target agent, and active objective.
* **Take Browser Control**: Operators click this button to automatically load the specific session ID and switch to the **Browser Tab**.
* **road block Banner Alert**: Displays a headed roadblock warning banner at the top of the Viewport in the Browser Tab.
* **Resume Agent**: Deserializes the saved cookies and storage back into the active agent loop instantly, returning control to the autonomous planner.

### 4.3 Developer REST API reference

#### 4.3.1 Trigger CSH Baton Pass Handoff
Saves cookies, `localStorage`, `sessionStorage`, and reason traces to state DB.
* **Path**: `POST /api/v1/autonomous/session/handoff`
* **Body**:
  ```json
  {
    "sessionId": "sess-123",
    "sourceAgentId": "aria-individual-v1",
    "targetAgentId": "human-operator",
    "reason": "captcha_detected",
    "objective": "Verify quarterly expenses in the corporate portal"
  }
  ```

#### 4.3.2 Resume Active CSH Goal
Restores serialized credentials back into Playwright and signals the FSM agent loop to wake up and resume.
* **Path**: `POST /api/v1/autonomous/session/resume`
* **Body**:
  ```json
  {
    "handoffId": "handoff-abc",
    "sessionId": "sess-123"
  }
  ```

#### 4.3.3 Fetch Pending Handoff Requests
* **Path**: `GET /api/v1/autonomous/session/pending`
* **Response**:
  ```json
  {
    "handoffs": [
      {
        "handoffId": "handoff-abc",
        "sessionId": "sess-123",
        "status": "pending",
        "reason": "captcha_detected",
        "objective": "Verify quarterly expenses in the corporate portal",
        "sourceAgentId": "aria-individual-v1",
        "timestamp": 1779831600000
      }
    ]
  }
  ```

---

## 5. Document Bibliography & Links

For deep dives into operational deployment and code architectures, check out these related core documents:
* **Operator Walkthrough Guide**: [OPERATOR_DASHBOARD_WALKTHROUGH.md](file:///d:/Projects/Prism/docs/OPERATOR_DASHBOARD_WALKTHROUGH.md) — Detailed runbook on visual settings, CSH handoffs, and agent loops.
* **Direct Control Reference Guide**: [COMPUTER_AND_BROWSER_CONTROL_OPERATOR_GUIDE.md](file:///d:/Projects/Prism/docs/COMPUTER_AND_BROWSER_CONTROL_OPERATOR_GUIDE.md) — The visual UI control manual.
* **Developer Guidelines**: [DEVELOPER_GUIDE.md](file:///d:/Projects/Prism/docs/DEVELOPER_GUIDE.md) — Backend routing, TypeScript patterns, and testing frameworks.
* **Learning Curve Journal**: [learning_curve_journal.md](file:///d:/Projects/Prism/docs/learning_curve_journal.md) — Architectural post-mortems, telemetry refactoring details, self-healing support dictionary, and world-class audit reflections.
* **Complete Product Index**: [DOCS_INDEX.md](file:///d:/Projects/Prism/docs/DOCS_INDEX.md) — Full listing of all Q2 2026 PRISM artifacts.

---

## 6. Canonical Learning Curve Journal & Reflection Post-Mortem

To maintain operational integrity, prevent historical regressions, and document SOTA engineering reflections, the **PRISM Learning Curve Journal** ([learning_curve_journal.md](file:///d:/Projects/Prism/docs/learning_curve_journal.md)) serves as our central support-desk database and developer feedback log:

### 6.1 Core Sections
1. **Telemetry Refactoring Post-Mortem**: Analysis and remediation of early browser reference errors, duplicates, and window listener bindings to stabilize dashboard load states.
2. **Thinking-Trace Feature Analysis**: Explains the design philosophy of the clickable Frosted Obsidian Glass portal modal to display live agent reasoning.
3. **Web Builder Capability Critique**: Details cognitive-overhead challenges in raw HTML generation tools and recommends vision-driven audits and AST-based injection engines.
4. **Support Desk & Self-Healing Guidelines**: Operational reference dictionary mapping error signatures to root causes and concrete remediation steps (useful for automated repair).
5. **World-Class Project Audit (May 2026)**: In-depth due-diligence audit details mapping PRISM's technical posture, core architectural moats (GaaS, SR, PAD), monolithic debt, and product roadmap against SOTA systems in 2026. Useful companion to the interactive [PRISM_WORLD_CLASS_AUDIT_PRESENTATION_2026.html](file:///d:/Projects/Prism/docs/PRISM_WORLD_CLASS_AUDIT_PRESENTATION_2026.html) slideshow.
