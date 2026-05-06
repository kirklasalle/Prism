export function setupWizardHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PRISM \u2014 Setup Wizard</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/dashboard.css">
  <style>
    .wizard-backdrop {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: radial-gradient(circle at top left, rgba(105, 210, 255, 0.08), transparent 40%),
                  radial-gradient(circle at bottom right, rgba(124, 241, 200, 0.05), transparent 40%),
                  #07111f;
    }
    .wizard-card {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-width: 520px;
      width: 100%;
      padding: 40px 36px 32px;
      position: relative;
      overflow: hidden;
    }
    .wizard-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .wizard-subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 28px;
    }
    .wizard-progress {
      display: flex;
      gap: 4px;
      margin-bottom: 28px;
    }
    .wizard-progress-dot {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.18);
      transition: background 0.3s;
    }
    .wizard-progress-dot.active {
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-progress-dot.done {
      background: var(--accent-2);
    }
    .wizard-step { display: none; }
    .wizard-step.active { display: block; }
    .wizard-step h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .wizard-step p {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .wizard-option {
      display: flex;
      gap: 14px;
      padding: 14px;
      border: 2px solid var(--border);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 8px;
      align-items: flex-start;
    }
    .wizard-option:hover {
      border-color: rgba(105, 210, 255, 0.3);
      background: rgba(105, 210, 255, 0.04);
    }
    .wizard-option.selected {
      border-color: var(--accent);
      background: rgba(105, 210, 255, 0.08);
    }
    .wizard-option-radio {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.3);
      flex-shrink: 0;
      margin-top: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s;
    }
    .wizard-option.selected .wizard-option-radio {
      border-color: var(--accent);
    }
    .wizard-option.selected .wizard-option-radio::after {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
    }
    .wizard-option-body h3 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 600;
    }
    .wizard-option-body .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
    }
    .wizard-nav .skip-link {
      color: var(--muted);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-family: inherit;
    }
    .wizard-nav .skip-link:hover { color: var(--accent); }
    .wizard-field {
      margin-bottom: 14px;
    }
    .wizard-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .wizard-field input[type="text"],
    .wizard-field input[type="email"],
    .wizard-field select {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .wizard-field input:focus,
    .wizard-field select:focus {
      border-color: var(--accent);
    }
    .wizard-check-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .wizard-check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 13px;
    }
    .wizard-check-item .check-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .wizard-check-item .check-icon.pass {
      background: rgba(124, 241, 200, 0.15);
      color: var(--accent-2);
    }
    .wizard-check-item .check-icon.fail {
      background: rgba(255, 141, 141, 0.15);
      color: var(--danger);
    }
    .wizard-check-item .check-icon.pending {
      background: rgba(148, 163, 184, 0.1);
      color: var(--muted);
    }
    .wizard-check-detail {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="wizard-backdrop">
    <div class="wizard-card">
      <div class="wizard-logo">PRISM</div>
      <div class="wizard-subtitle">Frontier Operator Console \u2014 Setup Wizard</div>

      <div class="wizard-progress" id="wizard-progress">
        <div class="wizard-progress-dot active"></div>
        <div class="wizard-progress-dot"></div>
        <div class="wizard-progress-dot"></div>
        <div class="wizard-progress-dot"></div>
      </div>

      <!-- Step 1: Profile Choice -->
      <div class="wizard-step active" id="step-1">
        <h2>Choose Your Profile</h2>
        <p>This determines default governance and compliance settings.</p>
        <div class="wizard-option selected" data-profile="individual" onclick="selectProfile(this, 'individual')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F680} Individual</h3>
            <p class="desc">Personal productivity. Minimal friction, fast defaults. For exploration and single-user workflows.</p>
          </div>
        </div>
        <div class="wizard-option" data-profile="business" onclick="selectProfile(this, 'business')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F3E2} Business</h3>
            <p class="desc">Enterprise-grade governance. Full audit trails, mandatory rollback plans, strict approval workflows. For production and compliance.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Workspace Location -->
      <div class="wizard-step" id="step-2">
        <h2>Workspace Location</h2>
        <p>PRISM stores configuration, agent state, and artifacts in a workspace directory.</p>
        <div class="wizard-field">
          <label>Workspace Path</label>
          <input type="text" id="workspace-path" />
        </div>
        <div class="wizard-check-list" id="workspace-checks"></div>
      </div>

      <!-- Step 3: Provider Configuration -->
      <div class="wizard-step" id="step-3">
        <h2>LLM Provider</h2>
        <p>Select which LLM provider to start with. You can add more later in the Provider &amp; Settings tab.</p>
        <div class="wizard-option selected" data-provider="ollama" onclick="selectProvider(this, 'ollama')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F5A5} Ollama (Local)</h3>
            <p class="desc">Run open-source models locally. No API key needed. Requires Ollama installed and running.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="openai" onclick="selectProvider(this, 'openai')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F916} OpenAI</h3>
            <p class="desc">GPT-4o, GPT-4o-mini, and other OpenAI models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="anthropic" onclick="selectProvider(this, 'anthropic')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u2728 Anthropic</h3>
            <p class="desc">Claude models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="google" onclick="selectProvider(this, 'google')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F50D} Google AI</h3>
            <p class="desc">Gemini models. Requires API key.</p>
          </div>
        </div>
        <div id="provider-key-field" class="wizard-field" style="display:none;margin-top:16px;">
          <label id="provider-key-label">API Key</label>
          <input type="text" id="provider-api-key" placeholder="sk-..." autocomplete="off" />
        </div>
        <div id="provider-test-result" style="margin-top:8px;font-size:12px;"></div>
      </div>

      <!-- Step 4 (E3b): Choose First Assistant -->
      <div class="wizard-step" id="step-4">
        <h2>Choose Your First Assistant</h2>
        <p>Every session in PRISM runs under a character \u2014 a persona with its own tool permissions, risk tier cap, and accountability chain. Pick one to make your default.</p>
        <div id="wizard-character-tabs" style="display:flex;gap:8px;margin:12px 0;">
          <button type="button" class="secondary-button" id="wiz-char-tab-bundled" onclick="wizardCharacterTab('bundled')">Bundled</button>
          <button type="button" class="secondary-button" id="wiz-char-tab-import" onclick="wizardCharacterTab('import')">Import</button>
        </div>
        <div id="wizard-character-panel-bundled">
          <div id="wizard-character-list" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"></div>
        </div>
        <div id="wizard-character-panel-import" style="display:none;">
          <p style="font-size:13px;opacity:0.8;">Paste a character manifest from another system (Openclaw, CrewAI, AutoGen, or a plain OpenAI prompt JSON). PRISM will normalize it into canonical shape.</p>
          <textarea id="wizard-character-import-json" rows="8" style="width:100%;font-family:monospace;font-size:12px;" placeholder='{"persona": "...", "instructions": "..."}'></textarea>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button type="button" class="secondary-button" onclick="wizardCharacterPreviewImport()">Preview</button>
            <button type="button" class="primary-button" id="wiz-char-commit-import" onclick="wizardCharacterCommitImport()" disabled>Import &amp; use</button>
          </div>
          <div id="wizard-character-import-result" style="margin-top:8px;font-size:12px;"></div>
        </div>
        <div id="wizard-character-selected" style="margin-top:12px;font-size:13px;opacity:0.85;"></div>
      </div>

      <!-- Step 5 (E3b): Identity & First Session -->
      <div class="wizard-step" id="step-5">
        <h2>Identity &amp; First Session</h2>
        <p>Your Character Accountability Chain (CAC) binds every action back to a real identity. You can accept placeholder emails now and boot the workspace; tier-2+ tool calls on the Business profile stay blocked until real addresses land.</p>
        <label style="display:block;margin-top:12px;">Operator email (the human accountable for decisions):
          <input type="email" id="wizard-operator-email" style="width:100%;margin-top:4px;" placeholder="operator@prism.local" />
        </label>
        <label style="display:block;margin-top:12px;">Assistant email (character identity):
          <input type="email" id="wizard-assistant-email" style="width:100%;margin-top:4px;" placeholder="aria@prism.local" />
        </label>
        <div id="wizard-cac-warning" style="margin-top:12px;padding:8px;border-radius:6px;background:rgba(255,176,0,0.12);color:#ffb000;font-size:12px;display:none;">
          Placeholder emails accepted. Business-profile tier-2+ tool calls will be denied at runtime until you replace them in the CAC identity panel.
        </div>
      </div>

      <!-- Step 6 (renumbered from step-4): Summary + Launch -->
      <div class="wizard-step" id="step-6">
        <h2>Ready to Launch</h2>
        <p>Here\u2019s a summary of your configuration. PRISM will validate everything before launching.</p>
        <div class="wizard-check-list" id="summary-checks"></div>
        <div id="summary-status" style="margin-top:16px;text-align:center;"></div>
      </div>

      <!-- Navigation -->
      <div class="wizard-nav">
        <button class="skip-link" id="wizard-skip" onclick="skipSetup()">Skip setup</button>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="secondary-button" style="font-size:12px;opacity:0.8;" onclick="startAdvancedWizard()">Advanced Setup \u2192</button>
          <button class="secondary-button" id="wizard-back" onclick="wizardBack()" style="display:none;">Back</button>
          <button class="primary-button" id="wizard-next" onclick="wizardNext()">Continue</button>
        </div>
      </div>
    </div>
  </div>

  <script type="module" src="/public/setup-wizard.js"></script>
</body>
</html>`;
}

export function setupWizardAdvancedHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PRISM \u2014 Advanced Setup Wizard</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/dashboard.css">
  <style>
    .wizard-backdrop {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .wizard-card {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-width: 720px;
      width: 100%;
      padding: 40px 36px 32px;
      position: relative;
      overflow: hidden;
    }
    .wizard-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .wizard-subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 28px;
    }
    .wizard-phase-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--accent);
      margin-bottom: 8px;
    }
    .wizard-progress {
      display: flex;
      gap: 4px;
      margin-bottom: 28px;
    }
    .wizard-progress-dot {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.18);
      transition: background 0.3s;
    }
    .wizard-progress-dot.active {
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .wizard-progress-dot.done {
      background: var(--accent-2);
    }
    .wizard-step { display: none; }
    .wizard-step.active { display: block; }
    .wizard-step h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    .wizard-step p {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 20px;
      line-height: 1.5;
    }
    .wizard-option {
      display: flex;
      gap: 14px;
      padding: 14px;
      border: 2px solid var(--border);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 8px;
      align-items: flex-start;
    }
    .wizard-option:hover {
      border-color: rgba(105, 210, 255, 0.3);
      background: rgba(105, 210, 255, 0.04);
    }
    .wizard-option.selected {
      border-color: var(--accent);
      background: rgba(105, 210, 255, 0.08);
    }
    .wizard-option-radio {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(148, 163, 184, 0.3);
      flex-shrink: 0;
      margin-top: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.2s;
    }
    .wizard-option.selected .wizard-option-radio {
      border-color: var(--accent);
    }
    .wizard-option.selected .wizard-option-radio::after {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
    }
    .wizard-option-body h3 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 600;
    }
    .wizard-option-body .desc {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
      gap: 10px;
    }
    .wizard-nav .skip-link {
      color: var(--muted);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      font-family: inherit;
    }
    .wizard-nav .skip-link:hover { color: var(--accent); }
    .wizard-field {
      margin-bottom: 14px;
    }
    .wizard-field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .wizard-field input[type="text"],
    .wizard-field input[type="email"],
    .wizard-field select {
      width: 100%;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .wizard-field input:focus,
    .wizard-field select:focus {
      border-color: var(--accent);
    }
    .wizard-check-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .wizard-check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 13px;
    }
    .wizard-check-item .check-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .wizard-check-item .check-icon.pass {
      background: rgba(124, 241, 200, 0.15);
      color: var(--accent-2);
    }
    .wizard-check-item .check-icon.fail {
      background: rgba(255, 141, 141, 0.15);
      color: var(--danger);
    }
    .wizard-check-item .check-icon.pending {
      background: rgba(148, 163, 184, 0.1);
      color: var(--muted);
    }
    .wizard-check-detail {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .wizard-summary-ready {
      text-align: center;
      padding: 20px 0;
    }
    .wizard-summary-ready .big-check {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(124, 241, 200, 0.12);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 12px;
    }
    .wizard-section {
      margin-bottom: 16px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.015);
    }
    .wizard-section h4 {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .wizard-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
      font-size: 13px;
    }
    .wizard-toggle-row:last-child { border-bottom: none; }
    .wizard-toggle {
      position: relative;
      width: 36px;
      height: 20px;
      background: rgba(148, 163, 184, 0.25);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    .wizard-toggle.on {
      background: var(--accent);
    }
    .wizard-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
    }
    .wizard-toggle.on::after {
      transform: translateX(16px);
    }
    .wizard-role-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 8px;
    }
    .wizard-role-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      font-size: 12px;
    }
    .wizard-role-item select {
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 11px;
      font-family: inherit;
      max-width: 140px;
    }
    .wizard-cert-box {
      margin-top: 16px;
      padding: 16px;
      border: 2px solid var(--accent);
      border-radius: 14px;
      background: rgba(105, 210, 255, 0.04);
      text-align: center;
    }
    .wizard-cert-icon {
      font-size: 40px;
      margin-bottom: 8px;
    }
    .wizard-cert-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .wizard-cert-detail {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .wizard-inline-row {
      display: flex;
      gap: 12px;
    }
    .wizard-inline-row .wizard-field {
      flex: 1;
    }
    .wizard-hint {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-top: 3px;
      font-weight: 400;
    }
  </style>
</head>
<body>
  <div class="wizard-backdrop">
    <div class="wizard-card">
      <div class="wizard-logo">PRISM</div>
      <div class="wizard-subtitle">Frontier Operator Console \u2014 Advanced Setup</div>

      <div class="wizard-progress" id="wizard-progress"></div>

      <!-- Step 1: Profile & Governance -->
      <div class="wizard-step active" id="step-1">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>Choose Your Profile</h2>
        <p>This determines governance level, default agent behaviour, and compliance requirements.</p>
        <div class="wizard-option selected" data-profile="individual" onclick="advSelectProfile(this, 'individual')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F680} Individual</h3>
            <p class="desc">Personal productivity. Minimal governance, fast defaults. Tier-1 autonomous guardian, mesh swarms.</p>
          </div>
        </div>
        <div class="wizard-option" data-profile="business" onclick="advSelectProfile(this, 'business')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F3E2} Business</h3>
            <p class="desc">Enterprise governance. Full audit trails, star-topology swarms, tier-2 conditional guardian, mandatory compliance cron.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Workspace & Prerequisites -->
      <div class="wizard-step" id="step-2">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>Workspace Location</h2>
        <p>PRISM stores configuration, agent state, and artifacts in a workspace directory.</p>
        <div class="wizard-field">
          <label>Workspace Path</label>
          <input type="text" id="adv-workspace-path" />
        </div>
        <div class="wizard-check-list" id="adv-workspace-checks"></div>
      </div>

      <!-- Step 3: Primary LLM Provider -->
      <div class="wizard-step" id="step-3">
        <div class="wizard-phase-label">Phase A \u2014 Foundation</div>
        <h2>LLM Provider</h2>
        <p>Select which LLM provider to start with. More can be added later in Settings.</p>
        <div class="wizard-option selected" data-provider="ollama" onclick="advSelectProvider(this, 'ollama')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F5A5} Ollama (Local)</h3>
            <p class="desc">Run open-source models locally. No API key needed.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="openai" onclick="advSelectProvider(this, 'openai')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F916} OpenAI</h3>
            <p class="desc">GPT-4o, GPT-4o-mini, and more. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="anthropic" onclick="advSelectProvider(this, 'anthropic')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u2728 Anthropic</h3>
            <p class="desc">Claude models. Requires API key.</p>
          </div>
        </div>
        <div class="wizard-option" data-provider="google" onclick="advSelectProvider(this, 'google')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>\u{1F50D} Google AI</h3>
            <p class="desc">Gemini models. Requires API key.</p>
          </div>
        </div>
        <div id="adv-provider-key-field" class="wizard-field" style="display:none;margin-top:14px;">
          <label id="adv-provider-key-label">API Key</label>
          <input type="text" id="adv-provider-api-key" placeholder="sk-..." autocomplete="off" />
        </div>
        <div id="adv-provider-test-result" style="margin-top:8px;font-size:12px;"></div>
      </div>

      <!-- Step 4: Model Routing Strategy -->
      <div class="wizard-step" id="step-4">
        <div class="wizard-phase-label">Phase B \u2014 Intelligence Layer</div>
        <h2>Model Routing Strategy</h2>
        <p>Define how PRISM routes requests to different models based on task role or modality.</p>

        <div class="wizard-option selected" data-strategy="single" onclick="advSelectStrategy(this, 'single')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Single Model</h3>
            <p class="desc">Route all tasks to one model. Simplest setup.</p>
          </div>
        </div>
        <div class="wizard-option" data-strategy="multi" onclick="advSelectStrategy(this, 'multi')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Multi-Model (Role-Based)</h3>
            <p class="desc">Assign different models to each task role (chat, code generation, reasoning, etc.).</p>
          </div>
        </div>
        <div class="wizard-option" data-strategy="modality" onclick="advSelectStrategy(this, 'modality')">
          <div class="wizard-option-radio"></div>
          <div class="wizard-option-body">
            <h3>Modality-Aware</h3>
            <p class="desc">Route by input type: text, vision, code. Requires multiple providers.</p>
          </div>
        </div>

        <div id="adv-role-overrides" style="display:none;margin-top:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <label style="font-size:12px;font-weight:600;color:var(--muted);">Role Overrides</label>
            <button class="secondary-button" style="font-size:11px;padding:4px 10px;" onclick="advAcceptSuggestions()">Accept AI Suggestions</button>
          </div>
          <div class="wizard-role-grid" id="adv-role-grid"></div>
        </div>
      </div>

      <!-- Step 5: Agentic Control & Guardian -->
      <div class="wizard-step" id="step-5">
        <div class="wizard-phase-label">Phase B \u2014 Intelligence Layer</div>
        <h2>Agentic Control &amp; Guardian</h2>
        <p>Configure the Guardian agent and set defaults for the agent pool.</p>

        <div class="wizard-section">
          <h4>\u{1F6E1} Guardian Agent</h4>
          <div class="wizard-field">
            <label>Guardian Model</label>
            <select id="adv-guardian-model"><option value="">Loading models...</option></select>
            <span class="wizard-hint">Select a local GGUF model for the guardian to use.</span>
          </div>

          <div class="wizard-field">
            <label>Authority Tier</label>
            <select id="adv-guardian-tier">
              <option value="tier1_autonomous">Tier 1 \u2014 Autonomous (Individual default)</option>
              <option value="tier2_conditional">Tier 2 \u2014 Conditional (Business default)</option>
            </select>
          </div>

          <div class="wizard-toggle-row">
            <span>Auto-start Guardian on launch</span>
            <div class="wizard-toggle on" id="adv-guardian-autostart" onclick="advToggle(this)"></div>
          </div>
        </div>

        <div class="wizard-section" style="margin-top:12px;">
          <h4>\u{1F916} Default Swarm Topology</h4>
          <div class="wizard-field">
            <select id="adv-swarm-topology">
              <option value="mesh">Mesh \u2014 Peer-to-peer (Individual default)</option>
              <option value="star">Star \u2014 Central coordinator (Business default)</option>
              <option value="pipeline">Pipeline \u2014 Sequential</option>
              <option value="broadcast">Broadcast \u2014 Fan-out</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Step 6: Character Accountability (CAC) -->
      <div class="wizard-step" id="step-6">
        <div class="wizard-phase-label">Phase C \u2014 Identity &amp; Operations</div>
        <h2>Character Accountability</h2>
        <p>Assign your primary operator character. This establishes your identity chain for audit and compliance.</p>

        <div class="wizard-field">
          <label>Primary Character</label>
          <select id="adv-cac-character"><option value="">Loading characters...</option></select>
        </div>

        <div class="wizard-inline-row">
          <div class="wizard-field">
            <label>Operator Email</label>
            <input type="email" id="adv-cac-operator-email" placeholder="you@company.com" />
          </div>
          <div class="wizard-field">
            <label>PRISM User Email</label>
            <input type="email" id="adv-cac-prism-email" placeholder="assistant@prism.local" />
          </div>
        </div>

        <div class="wizard-inline-row">
          <div class="wizard-field">
            <label>Operator ID</label>
            <input type="text" id="adv-cac-operator-id" placeholder="Optional identifier" />
          </div>
          <div class="wizard-field">
            <label>Workspace Hub</label>
            <input type="text" id="adv-cac-workspace-hub" placeholder="e.g. main / department-name" />
            <span class="wizard-hint" id="adv-cac-hub-hint">Suggested for individual, required for business profiles.</span>
          </div>
        </div>

        <div id="adv-cac-assignment-result" style="margin-top:12px;font-size:12px;"></div>
      </div>

      <!-- Step 7: Browser Profile & Scheduler -->
      <div class="wizard-step" id="step-7">
        <div class="wizard-phase-label">Phase C \u2014 Identity &amp; Operations</div>
        <h2>Browser Profile &amp; Scheduler</h2>
        <p>Set up your browser automation profile and initial scheduled tasks.</p>

        <div class="wizard-section">
          <h4>\u{1F310} Browser Profile</h4>
          <div class="wizard-toggle-row">
            <span>Use CAC identity for browser profile</span>
            <div class="wizard-toggle on" id="adv-browser-use-cac" onclick="advToggle(this); advUpdateBrowserFields();"></div>
          </div>
          <div class="wizard-inline-row" style="margin-top:10px;">
            <div class="wizard-field">
              <label>Browser Profile Email</label>
              <input type="email" id="adv-browser-email" placeholder="you@company.com" />
            </div>
            <div class="wizard-field">
              <label>Segment</label>
              <select id="adv-browser-segment">
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </div>
          </div>
        </div>

        <div class="wizard-section" style="margin-top:12px;">
          <h4>\u{1F4C5} Scheduled Tasks</h4>
          <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Toggle suggested tasks for your profile. You can customise in the Scheduler tab later.</p>
          <div id="adv-scheduler-suggestions"></div>
        </div>
      </div>

      <!-- Step 8: Email & Calendar Integrations -->
      <div class="wizard-step" id="step-8">
        <div class="wizard-phase-label">Phase D \u2014 Integrations</div>
        <h2>Email &amp; Calendar OAuth</h2>
        <p>Connect your business accounts to enable secure, real-time access to your inbox and calendar. OAuth tokens remain local and encrypted.</p>

        <div class="wizard-section">
          <h4>Gmail</h4>
          <div id="adv-gmail-status" style="margin-top:8px;font-size:12px;color:var(--muted);">Checking status...</div>
          <button class="secondary-button" id="adv-gmail-connect" style="margin-top:8px;" onclick="advOAuthConnect('gmail')">Connect Gmail</button>
        </div>

        <div class="wizard-section" style="margin-top:16px;">
          <h4>Outlook / Microsoft 365</h4>
          <div id="adv-outlook-status" style="margin-top:8px;font-size:12px;color:var(--muted);">Checking status...</div>
          <button class="secondary-button" id="adv-outlook-connect" style="margin-top:8px;" onclick="advOAuthConnect('outlook')">Connect Outlook</button>
        </div>
      </div>

      <!-- Step 9: Summary & Initialization Certificate -->
      <div class="wizard-step" id="step-9">
        <div class="wizard-phase-label">Launch</div>
        <h2>Summary &amp; Initialization Certificate</h2>
        <p>Review your configuration. PRISM will create an immutable Initialization Certificate as your system\u2019s provenance record.</p>

        <div class="wizard-check-list" id="adv-summary-checks"></div>
        <div id="adv-summary-status" style="margin-top:12px;text-align:center;"></div>

        <div class="wizard-cert-box" id="adv-cert-box" style="display:none;">
          <div class="wizard-cert-icon">\u{1F4DC}</div>
          <div class="wizard-cert-title">Initialization Certificate</div>
          <div class="wizard-cert-detail" id="adv-cert-detail">
            A dedicated session will be created documenting your full system configuration, then packaged as an immutable provenance record.
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="wizard-nav">
        <button class="skip-link" id="adv-wizard-skip" onclick="advSkipSetup()">Use Basic Setup</button>
        <div style="display:flex;gap:8px;">
          <button class="secondary-button" id="adv-wizard-back" onclick="advWizardBack()" style="display:none;">Back</button>
          <button class="primary-button" id="adv-wizard-next" onclick="advWizardNext()">Continue</button>
        </div>
      </div>
    </div>
  </div>

  <script type="module" src="/public/setup-wizard-advanced.js"></script>
</body>
</html>`;
}
