# PRISM Operator Walkthrough: Zero-Trust Dashboard UI Manual

This operational walkthrough guides human operators through the process of utilizing the **PRISM Web Dashboard** to run autonomous tasks, manage **Sovereign Sentinel Hyper-Proxy (SSHP)** security configurations, and orchestrate **Cognitive Session Handoff (CSH) "Baton Passes"** during active browser-use/computer-use automation loops.

---

## 1. Overview of Dashboard Tabs

When you load the PRISM dashboard (default: `http://localhost:7070`), the primary navigation bar exposes the following operational spaces:

* **💬 Chat Tab**: The central natural language interaction interface. Use this to chat with your configured agent characters, ask questions, or command them to run repository sweeps.
* **🖥️ Computer Tab**: Exposes local system specs, Group Policy viewers, WMI hardware scanner, terminal console inputs, live framebuffer viewers, and the **PTAC self-drive demo** controls.
* **🌐 Browser Tab**: Exposes the zero-trust embedded web browser. You can manually navigate pages, inspect elements, or watch agents operate under active proxy shielding.
* **🤖 Agentic Tab**: Displays active autonomous execution lanes. Tracks planned task DAGs, logs step-by-step thought processes, and lists pending human-in-the-loop handoffs.

---

## 2. Step-by-Step Operator Playbook

### Step 2.1: Initial Login and Boot-Time Verification
1. Launch the PRISM web server by running `.\start_web.bat` in your console.
2. Open your web browser and navigate to `http://localhost:7070`.
3. The server will perform an automated boot-time **Permanent Active Directive (PAD)** integrity scan to verify code signatures before displaying the dashboard dashboard.

### Step 2.2: Configuring Zero-Trust Privacy Shielding (SSHP)
Before running automated browser-use loops, verify that visual and text-level privacy redaction is active:
1. Navigate to the **Browser** or **Computer** tab.
2. Under **⚙️ Configuration & Settings**, locate the **Sovereign Sentinel (SSHP) Shielding** panel.
3. Verify that **PII Redaction Mode** is toggled to **ENABLED** (default). 
4. While enabled:
   - Any sensitive input fields (e.g. password boxes, credit card inputs, custom token keys) will automatically have their values replaced with `[REDACTED_PII]`.
   - raw DOM snapshots transmitted to external API providers will be scrubbed of email patterns, SSNs, and card numbers.
   - Bounding boxes of private text regions will be masked with solid black overlays on screenshots dynamically.

### Step 2.3: Launching an Autonomous Task
1. Navigate to the **Computer Tab** and find the **🤖 Autonomous Control** panel.
2. Enter your high-level objective in the **Goal Input** box. E.g.:
   > "Search Hacker News for prism-related articles, extract the top link, and write the summary to summary.txt."
3. Select your allowed capabilities via the checkboxes:
   - `[x] Browser Use` (allows agent to drive Chrome/Playwright)
   - `[x] Computer Use` (allows agent to move mouse and key inputs)
   - `[x] Shell Exec` (allows agent to run command-line actions)
4. Click **▶ Execute**.

### Step 2.4: Experiencing an Autonomous Session Suspension (CSH Handoff)
If the agent runs into a CAPTCHA check, an authorization wall, or triggers a Sacred Covenant safety boundary (e.g. attempting to run a script containing `localStorage.clear()`):
1. The agent loop automatically pauses execution and transitions to `handing_off`.
2. The agent captures active session cookies, local/session storage variables, and active history logs, writing them to a secure handoff state register.
3. An alert will flash on the **Agentic Tab** stating:
   > ⚠️ **Handoff Requested: Awaiting Operator Resolution [CAPTCHA_DETECTED]**
4. The Finite State Machine transitions to `suspended`.

### Step 2.5: Taking Manual Control (The "Baton Pass")
1. In the **Agentic Tab**, locate the active handoff item under **Pending Handoffs**.
2. Click **🤝 Take the Baton**.
3. The dashboard will automatically launch an interactive browser tab populated with your agent's current cookie jars, active web session, and layout coordinates.
4. As the human operator, you can now interact with the webpage to:
   - Solve the graphical CAPTCHA.
   - Enter credentials on a multi-factor authentication (MFA) page.
   - Navigate past restricted landing pages.

### Step 2.6: Handing Back and Resuming Handoffs
1. Once you have resolved the roadblock, click **◀ Hand Back Baton** in the control panel.
2. The CSH Manager serializes your updated session state (including newly created authentication cookies or completed session tokens) and passes it back to the agent core.
3. The FSM transitions from `suspended` back to `running`.
4. The AI agent takes over and successfully completes the remainder of your goal loop seamlessly.

---

## 3. Frequently Asked Questions (FAQ)

#### Q: How do I know if SSHP is active during an agent's run?
A: You can view live audit logs inside the **Telemetry Tab** or inspect the **Vision Framebuffer** inside the Computer Tab. Masked screenshots will appear with clear black overlays drawn over sensitive inputs.

#### Q: Can I turn off Visual Masking if it's blocking public UI elements?
A: Yes. You can toggle PII Redaction off inside the **Settings Tab** or by firing a POST call to `/api/preferences/sshp-redaction` with `{"enabled": false}`. However, this is not recommended for production environments.

#### Q: Where are CSH session snapshots stored?
A: Handoff packages are serialized in memory and temporarily cached in your app directory under `C:\Users\kirkl\.gemini\antigravity\brain\fb50b12c-006e-4f37-8f25-ed7aaddbab67\tmp\` for audit tracing.
