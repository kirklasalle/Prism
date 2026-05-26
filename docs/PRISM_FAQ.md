# PRISM: Frequently Asked Questions (FAQ)

This central FAQ provides direct, technical, and operational answers regarding **PRISM**, its user-friendly interface dashboards, autonomous agent capabilities, developer frameworks, and zero-trust security postures.

---

## 1. General & Executive FAQ

### Q1.1: What is PRISM?
PRISM is a state-of-the-art **Web Automation and Computer-Use Environment** engineered for secure, sovereign, and scalable agentic execution. It allows autonomous language models (like llama.cpp, Ollama, or third-party APIs) to interact with containerized web browsers and operating systems, shielded by local zero-trust privacy filters and human-in-the-loop validation checkpoints.

### Q1.2: Who is PRISM for?
* **Operators & Business Users**: Seeking secure agent automation for repetitive daily browser workflows (e.g., retrieving statements, auditing data, running SaaS checkups) without risking credential leaks.
* **Software Developers & QA Engineers**: Testing complex visual layouts, browser state transitions, and validating agent pipelines locally in secure containers.
* **AI Research Engineers**: Running large-scale computer-use benchmarks like OSWorld to test visual grounding, planning DAGs, and multi-step tool-use agents.

### Q1.3: Where does PRISM run?
PRISM runs fully **locally or containerized**. It works directly on **Windows, macOS, and Linux**. The visual web automation engines and test suites operate inside an isolated Docker sandbox container using virtual framebuffers (Xvfb) to isolate files, credentials, and cookies completely from your host machine.

### Q1.4: When was PRISM developed and what is the current version?
PRISM was established in early 2026. The active version is **v0.21.0**, featuring advanced tri-model orchestration (Spectrum Refraction), Sovereign Sentinel Visual PII Masking (SSHP), and the Cognitive Session Handoff (CSH) "Baton Pass" Human-in-the-Loop workflow.

---

## 2. User & Operator FAQ (User Guide)

### Q2.1: How do I toggle Visual PII Masking (SSHP) on or off?
* You can toggle SSHP dynamically inside the **Settings Tab** on the dashboard. Locate the *Sovereign Sentinel Shielding* card, check/uncheck the checkbox, and click Save.
* Alternatively, look for the **🛡️ SSHP ACTIVE** badge in the Browser tab's header. This badge provides instant confirmation of the current masking status.

### Q2.2: What happens when an agent encounters a CAPTCHA or Login screen?
PRISM triggers a **Cognitive Session Handoff (CSH) "Baton Pass"**:
1. The agent loop pauses and enters a `suspended` state.
2. A **Baton Pass** card pops up in the **Agentic Tab** queue, showing the roadblock reason.
3. Click `🎮 Take Browser Control` to jump directly to the **Browser Tab**.
4. A warning banner at the top of the Viewport will direct you: *"Solve the CAPTCHA or blocker, then click Resume."*
5. Interact with the browser (type inputs, click puzzles) to solve the blocker.
6. Click `Resume Agent`. PRISM will take control and resume its autonomous loop.

### Q2.3: I launched a browser session but the Viewport is empty. Why?
* Ensure that the **Active Session** dropdown at the top of the Browser viewport has the correct Playwright session selected (e.g., `Current Session` or a specific session hash ID).
* If no session exists, click `🤖 Launch Headless` or `🚀 Launch Headed` under the browser options to spin up a fresh browser thread.

### Q2.4: Can I run multiple browser tasks at the same time?
* **Yes.** PRISM supports multi-session tracking. You can maintain multiple active sessions simultaneously. Use the dropdown inside the Browser tab to switch between active tabs and inspect their individual DOM structures, network logs, and console traces.

---

## 3. Developer & Engineering FAQ (Developer Guide)

### Q3.1: How do I run the OSWorld evaluation suite?
We have configured a high-performance entry script to invoke the benchmark suite inside the workspace:
```bash
npm run ptac:osworld
```
Ensure that the Playwright execution drivers are fully compiled (`npm run build`) before running the benchmarks.

### Q3.2: Can I use local models rather than expensive cloud APIs?
* **Yes.** PRISM is natively configured to support **llama.cpp** and local **Ollama** instances. Under the Settings and Agentic tabs, you can select configured GGUF model binaries or local port links, preventing outbound prompt data from leaving your system.

### Q3.3: How do I write a custom visual redaction rule?
The Sovereign Sentinel Hyper-Proxy (SSHP) identifies visual masking targets using flexible CSS selectors inside [sshp-interceptor.ts](file:///d:/Projects/Prism/src/core/operator/sshp-interceptor.ts). 
* To add custom targets, append your CSS selector target to the `PII_SELECTORS` array:
  ```typescript
  const PII_SELECTORS = [
    'input[type="password"]',
    '[autocomplete="cc-number"]',
    '.sensitive-data-mask', // Custom CSS target
  ];
  ```
The Sharp graphics composer will automatically identify the bounding box of elements matching your selector and composite a solid black block on Playwright's viewport frame buffers.

### Q3.4: How are session states serialized during a handoff?
The serialization is managed by the CSH manager (`src/core/operator/csh-manager.ts`). It extracts page details directly from the active Playwright page instance:
* **Cookies**: Fetched via `context.cookies()`.
* **In-Page Storage**: Serialized using a secure `page.evaluate()` runtime query returning `localStorage` and `sessionStorage` JSON dictionaries.
* **History Trace**: Tracked via in-memory URL history logging, letting the agent restore its exact position on resume.

---

## 4. Security, Trust & Governance FAQ

### Q4.1: What is the "Sacred Covenant" (Directive Manifest)?
The Sacred Covenant consists of **10 Permanent Active Directives (PAD)**. These directives represent cryptographic, non-negotiable rules for safe AI computer control. They are checked at boot-time and enforced continuously.
* **Directive Integrity check**: A SHA-256 hash is computed periodically over the manifest rules. If the hash is modified or tampered with, the Guardian Agent suspends all agent execution instantly to prevent hijacking.

### Q4.2: How does visual masking (SSHP) prevent PII leaks to LLMs?
SSHP intercepts browser frame buffers **in-memory** *before* the images are sent to visual language model APIs:
1. Playwright captures the page frame buffer as a binary PNG buffer.
2. SSHP uses CSS selectors and DOM bounding boxes to identify the pixel coordinates of sensitive fields.
3. The high-performance `sharp` library draws solid black SVG masking rectangles directly onto those pixel boundaries in-memory.
4. The sanitized PNG buffer is dispatched to the LLM API, ensuring the model never sees raw password strings, pin entries, or card numbers.

### Q4.3: Is my local system safe from agent actions?
* **Yes, when using the Sandbox Profile.** When executing scripts using `npm run ptac:sandbox`, all browser and terminal actions are isolated in a Docker container sandbox. The agent has no access to host environment variables, local documents, browser profiles, or root filesystems.

---

## 5. Related Documentation Directory

For further instructions, read these operational manuals:
* **Operator Guide**: [COMPUTER_AND_BROWSER_CONTROL_OPERATOR_GUIDE.md](file:///d:/Projects/Prism/docs/COMPUTER_AND_BROWSER_CONTROL_OPERATOR_GUIDE.md) — Visual dashboard control layout reference.
* **Natural Playbook Guide**: [OPERATOR_DASHBOARD_WALKTHROUGH.md](file:///d:/Projects/Prism/docs/OPERATOR_DASHBOARD_WALKTHROUGH.md) — Action manual for sandbox setups and CSH handoff resolution.
* **Sovereign Sentinel Wiki**: [SOTA_BROWSER_WIKI.md](file:///d:/Projects/Prism/docs/SOTA_BROWSER_WIKI.md) — SSHP & CSH API references and inline visual flowcharts.
* **Docs Master Index**: [DOCS_INDEX.md](file:///d:/Projects/Prism/docs/DOCS_INDEX.md) — Comprehensive list of all PRISM Q2 2026 documentation.
