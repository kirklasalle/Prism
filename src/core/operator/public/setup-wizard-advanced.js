// Advanced Setup Wizard — 9-step deep configuration for PRISM

const TOTAL_STEPS = 9;
let currentStep = 1;

const PROVIDERS_NEEDING_KEY = ['custom', 'openai', 'anthropic', 'google', 'mistral', 'cohere', 'groq', 'together', 'deepseek', 'perplexity', 'fireworks', 'openrouter'];

const ROUTING_ROLES = [
  'chat', 'code-generation', 'reasoning', 'tool-selection',
  'summarization', 'classification', 'memory-indexing', 'vision',
];

let advState = {
  profile: 'individual',
  workspaceRoot: '',
  provider: 'llamacpp',
  model: '',
  apiKey: '',
  routingStrategy: 'single',
  roleOverrides: {},
  routingSuggestions: {},
  guardianModel: '',
  guardianTier: 'tier1_autonomous',
  guardianAutoStart: true,
  swarmTopology: 'mesh',
  cacCharacter: '',
  cacOperatorEmail: '',
  cacPrismEmail: '',
  cacOperatorId: '',
  cacWorkspaceHub: '',
  cacAssignmentId: null,
  browserUseCac: true,
  browserEmail: '',
  browserSegment: 'individual',
  browserProfileId: null,
  schedulerSelections: {},
  availableModels: [],
  availableCharacters: [],
  certificateResult: null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

window.toggleApiKeyVisibility = function toggleApiKeyVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon-hidden"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  } else {
    input.type = 'password';
    btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon-visible"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  }
};

function showToast(message, type = 'info') {
  let container = document.getElementById('wizard-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'wizard-toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `wizard-toast ${type}`;
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

function applyAdvancedWizardHoverTooltips() {
  document.querySelectorAll('.wizard-option').forEach((el) => {
    if (el.getAttribute('title')) return;
    const heading = el.querySelector('h3');
    const text = (heading?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) el.setAttribute('title', text);
  });

  document.querySelectorAll('button, input, select, textarea, .wizard-toggle').forEach((el) => {
    if (el.getAttribute('title')) return;
    if (el.id === 'adv-wizard-next') {
      el.setAttribute('title', currentStep === TOTAL_STEPS ? 'Create initialization certificate and launch PRISM' : 'Continue to the next setup step');
      return;
    }
    if (el.id === 'adv-wizard-back') {
      el.setAttribute('title', 'Return to the previous setup step');
      return;
    }
    if (el.id === 'adv-wizard-skip') {
      el.setAttribute('title', 'Return to the basic setup wizard');
      return;
    }
    const labelText = (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').replace(/\s+/g, ' ').trim();
    if (labelText) el.setAttribute('title', labelText);
  });
}

// ── Progress ─────────────────────────────────────────────────────────────────

function renderProgress() {
  const el = document.getElementById('wizard-progress');
  if (!el) return;
  let html = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const cls = i === currentStep ? 'active' : i < currentStep ? 'done' : '';
    html += `<div class="wizard-progress-dot ${cls}"></div>`;
  }
  el.innerHTML = html;
}

// ── Step visibility ──────────────────────────────────────────────────────────

function showStep(n) {
  currentStep = n;
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) el.classList.toggle('active', i === n);
  }
  const backBtn = document.getElementById('adv-wizard-back');
  const nextBtn = document.getElementById('adv-wizard-next');
  const skipBtn = document.getElementById('adv-wizard-skip');
  if (backBtn) backBtn.style.display = n > 1 ? '' : 'none';
  if (nextBtn) nextBtn.textContent = n === TOTAL_STEPS ? 'Create Certificate & Launch' : 'Continue';
  if (skipBtn) skipBtn.style.display = n === TOTAL_STEPS ? 'none' : '';
  renderProgress();

  // Step-specific initialization
  if (n === 2) initWorkspaceStep();
  if (n === 4) initRoutingStep();
  if (n === 5) initGuardianStep();
  if (n === 6) initCacStep();
  if (n === 7) initBrowserSchedulerStep();
  if (n === 8) initIntegrationsStep();
  if (n === 9) initSummaryStep();
  applyAdvancedWizardHoverTooltips();
}

// ── Step 1: Profile ──────────────────────────────────────────────────────────

window.advSelectProfile = function advSelectProfile(el, value) {
  advState.profile = value;
  document.querySelectorAll('#step-1 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  // Apply profile-aware defaults
  if (value === 'business') {
    advState.guardianTier = 'tier2_conditional';
    advState.swarmTopology = 'star';
    advState.browserSegment = 'business';
  } else {
    advState.guardianTier = 'tier1_autonomous';
    advState.swarmTopology = 'mesh';
    advState.browserSegment = 'individual';
  }
};

// ── Step 2: Workspace ────────────────────────────────────────────────────────

async function initWorkspaceStep() {
  const data = await api('GET', '/api/setup/status');
  const pathInput = document.getElementById('adv-workspace-path');
  if (pathInput && !pathInput.value) {
    pathInput.value = data.workspaceRoot || '';
    advState.workspaceRoot = data.workspaceRoot || '';
  }
  pathInput?.addEventListener('input', () => {
    advState.workspaceRoot = pathInput.value;
  });
  await validateWorkspace();
}

async function validateWorkspace() {
  const container = document.getElementById('adv-workspace-checks');
  if (!container) return;
  container.innerHTML = '<div class="wizard-check-item"><span class="check-icon pending">⋯</span> Checking...</div>';
  const data = await api('GET', '/api/setup/prerequisites');
  let html = '';
  for (const c of data.checks || []) {
    const icon = c.passed ? '✓' : '✗';
    const cls = c.passed ? 'pass' : 'fail';
    html += `<div class="wizard-check-item">
      <span class="check-icon ${cls}">${icon}</span>
      <div><div>${escHtml(c.label)}</div><div class="wizard-check-detail">${escHtml(c.detail)}</div></div>
    </div>`;
  }
  container.innerHTML = html;
}

// ── Step 3: Provider ─────────────────────────────────────────────────────────

window.advSelectProvider = function advSelectProvider(el, value) {
  advState.provider = value;
  document.querySelectorAll('#step-3 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  updateProviderKeyField();
};

function updateProviderKeyField() {
  const keyField = document.getElementById('adv-provider-key-field');
  const keyLabel = document.getElementById('adv-provider-key-label');
  const testResult = document.getElementById('adv-provider-test-result');
  if (!keyField) return;

  const needsKey = PROVIDERS_NEEDING_KEY.includes(advState.provider);
  keyField.style.display = needsKey ? '' : 'none';
  if (keyLabel) keyLabel.textContent = `${advState.provider.charAt(0).toUpperCase() + advState.provider.slice(1)} API Key`;
  if (testResult) testResult.innerHTML = '';

  const keyInput = document.getElementById('adv-provider-api-key');
  if (keyInput) {
    keyInput.value = advState.apiKey = '';
    keyInput.oninput = () => { advState.apiKey = keyInput.value; };
  }
}

window.advTestProviderConnection = async function advTestProviderConnection() {
  const testResult = document.getElementById('adv-provider-test-result');
  if (!testResult) return false;
  testResult.innerHTML = '<span style="color:var(--muted);">Testing connection...</span>';
  try {
    const data = await api('POST', '/api/llm/provider-test', {
      providerId: advState.provider,
      apiKey: advState.apiKey || undefined,
    });
    if (data.ok || data.reachable) {
      testResult.innerHTML = '<span style="color:var(--accent-2);">✓ Provider is reachable.</span>';
      if (data.models && data.models.length > 0 && !advState.model) {
        advState.model = data.models[0];
      }
      return true;
    }
    testResult.innerHTML = `<span style="color:var(--danger);">✗ ${escHtml(data.error || data.reason || 'Could not reach provider.')}</span>`;
    return false;
  } catch {
    testResult.innerHTML = '<span style="color:var(--danger);">✗ Connection test failed.</span>';
    return false;
  }
};

// ── Step 4: Model Routing ────────────────────────────────────────────────────

window.advSelectStrategy = function advSelectStrategy(el, value) {
  advState.routingStrategy = value;
  document.querySelectorAll('#step-4 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  const rolePanel = document.getElementById('adv-role-overrides');
  if (rolePanel) {
    rolePanel.style.display = (value === 'multi' || value === 'modality') ? '' : 'none';
  }

  if (value === 'multi' || value === 'modality') {
    renderRoleGrid();
  }
};

async function initRoutingStep() {
  // Fetch AI suggestions if available
  try {
    const data = await api('GET', '/api/llm/routing/suggest');
    if (data && data.suggestions) {
      advState.routingSuggestions = data.suggestions;
    }
  } catch { /* ignore */ }
}

function renderRoleGrid() {
  const grid = document.getElementById('adv-role-grid');
  if (!grid) return;

  let html = '';
  for (const role of ROUTING_ROLES) {
    const suggestion = advState.routingSuggestions[role] || '';
    const current = advState.roleOverrides[role] || suggestion || '';
    html += `<div class="wizard-role-item">
      <span>${escHtml(role)}</span>
      <select onchange="advSetRoleOverride('${role}', this.value)">
        <option value="">Default</option>
        ${suggestion ? `<option value="${escHtml(suggestion)}" ${current === suggestion ? 'selected' : ''}>${escHtml(suggestion)} (suggested)</option>` : ''}
      </select>
    </div>`;
  }
  grid.innerHTML = html;
  applyAdvancedWizardHoverTooltips();
}

window.advSetRoleOverride = function advSetRoleOverride(role, value) {
  if (value) {
    advState.roleOverrides[role] = value;
  } else {
    delete advState.roleOverrides[role];
  }
};

window.advAcceptSuggestions = function advAcceptSuggestions() {
  for (const [role, model] of Object.entries(advState.routingSuggestions)) {
    advState.roleOverrides[role] = model;
  }
  renderRoleGrid();
};

// ── Step 5: Guardian & Agents ────────────────────────────────────────────────

async function initGuardianStep() {
  // Load GGUF models for guardian
  try {
    const data = await api('GET', '/api/models/gguf');
    advState.availableModels = data.models || data || [];
  } catch { advState.availableModels = []; }

  const modelSelect = document.getElementById('adv-guardian-model');
  if (modelSelect) {
    let html = '<option value="">None (skip guardian)</option>';
    for (const m of advState.availableModels) {
      html += `<option value="${escHtml(m.path)}">${escHtml(m.name)}</option>`;
    }
    modelSelect.innerHTML = html;
    if (advState.guardianModel) modelSelect.value = advState.guardianModel;
    modelSelect.onchange = () => { advState.guardianModel = modelSelect.value; };
  }

  // Set profile-aware defaults
  const tierSelect = document.getElementById('adv-guardian-tier');
  if (tierSelect) {
    tierSelect.value = advState.guardianTier;
    tierSelect.onchange = () => { advState.guardianTier = tierSelect.value; };
  }

  const topoSelect = document.getElementById('adv-swarm-topology');
  if (topoSelect) {
    topoSelect.value = advState.swarmTopology;
    topoSelect.onchange = () => { advState.swarmTopology = topoSelect.value; };
  }

  // Auto-start toggle
  const autoToggle = document.getElementById('adv-guardian-autostart');
  if (autoToggle) {
    autoToggle.classList.toggle('on', advState.guardianAutoStart);
  }
}

// ── Step 6: CAC ──────────────────────────────────────────────────────────────

async function initCacStep() {
  // Load characters
  try {
    const data = await api('GET', '/api/workspace/characters');
    advState.availableCharacters = data.characters || data || [];
    console.log("Setup Wizard: Loaded characters:", advState.availableCharacters);
  } catch (err) {
    advState.availableCharacters = [];
    console.error("Failed to load characters for setup wizard:", err);
  }

  const charSelect = document.getElementById('adv-cac-character');
  if (charSelect) {
    const profile = String(advState.profile || 'individual').toLowerCase();
    let filtered = advState.availableCharacters.filter(c => {
      if (!c.executionProfile) return true;
      return String(c.executionProfile).toLowerCase() === profile;
    });

    console.log(`Setup Wizard: Filtering for profile '${profile}'. Matches: ${filtered.length}`);

    if (filtered.length === 0 && advState.availableCharacters.length > 0) {
      console.warn("Setup Wizard: No characters matched the selected profile. Showing all characters as fallback.");
      filtered = advState.availableCharacters;
    }

    let html = '<option value="">Select a character...</option>';
    for (const c of filtered) {
      const cid = c.id || c.characterId || '';
      const icon = cid.startsWith('aria') ? '🤖' :
        cid.startsWith('phoenix') ? '🦅' :
          cid.startsWith('sentinel') ? '🛡️' : '👤';
      html += `<option value="${escHtml(cid)}">${icon} ${escHtml(c.displayName || c.name || cid || 'Unknown')}</option>`;
    }
    charSelect.innerHTML = html;
    if (advState.cacCharacter) charSelect.value = advState.cacCharacter;
    charSelect.onchange = () => {
      advState.cacCharacter = charSelect.value;
      advUpdateCacFields();
    };
    advUpdateCacFields();
  }

  // Wire up input fields
  const fields = [
    ['adv-cac-operator-email', 'cacOperatorEmail'],
    ['adv-cac-prism-email', 'cacPrismEmail'],
    ['adv-cac-operator-id', 'cacOperatorId'],
    ['adv-cac-workspace-hub', 'cacWorkspaceHub'],
    ['adv-cac-custom-name', 'cacCustomName'],
  ];
  for (const [elId, stateKey] of fields) {
    const el = document.getElementById(elId);
    if (el) {
      if (advState[stateKey]) el.value = advState[stateKey];
      el.oninput = () => { advState[stateKey] = el.value; };
    }
  }

  // Update hub hint based on profile
  const hubHint = document.getElementById('adv-cac-hub-hint');
  if (hubHint) {
    hubHint.textContent = advState.profile === 'business'
      ? 'Required for business profiles.'
      : 'Optional for individual profiles.';
  }
}

function showAdvCacError(msg) {
  const resultEl = document.getElementById('adv-cac-assignment-result');
  if (resultEl) {
    resultEl.innerHTML = `<span style="color:var(--danger);">${escHtml(msg)}</span>`;
  }
}

window.advUpdateCacFields = function advUpdateCacFields() {
  const charSelect = document.getElementById('adv-cac-character');
  const customNameField = document.getElementById('adv-cac-custom-name-field');
  if (charSelect && customNameField) {
    const isCustom = charSelect.value === 'test-custom-agent' || charSelect.value === 'custom-agent';
    customNameField.style.display = isCustom ? 'block' : 'none';
  }
};

// ── Step 7: Browser Profile & Scheduler ──────────────────────────────────────

function initBrowserSchedulerStep() {
  advUpdateBrowserFields();
  renderSchedulerSuggestions();

  // Wire segment selector
  const segSelect = document.getElementById('adv-browser-segment');
  if (segSelect) {
    segSelect.value = advState.browserSegment;
    segSelect.onchange = () => { advState.browserSegment = segSelect.value; };
  }

  const emailEl = document.getElementById('adv-browser-email');
  if (emailEl) {
    emailEl.oninput = () => { advState.browserEmail = emailEl.value; };
  }
}

window.advUpdateBrowserFields = function advUpdateBrowserFields() {
  const useCac = document.getElementById('adv-browser-use-cac');
  advState.browserUseCac = useCac?.classList.contains('on') ?? true;

  const emailEl = document.getElementById('adv-browser-email');
  const segEl = document.getElementById('adv-browser-segment');
  if (advState.browserUseCac) {
    if (emailEl) {
      emailEl.value = advState.cacOperatorEmail || '';
      advState.browserEmail = advState.cacOperatorEmail || '';
      emailEl.readOnly = true;
      emailEl.style.opacity = '0.6';
    }
    if (segEl) {
      segEl.value = advState.profile;
      advState.browserSegment = advState.profile;
      segEl.disabled = true;
      segEl.style.opacity = '0.6';
    }
  } else {
    if (emailEl) { emailEl.readOnly = false; emailEl.style.opacity = '1'; }
    if (segEl) { segEl.disabled = false; segEl.style.opacity = '1'; }
  }
};

function getSchedulerSuggestions() {
  if (advState.profile === 'business') {
    return [
      { id: 'daily-review', label: 'Daily self-review', cron: '0 9 * * *', desc: 'Daily agent performance review at 9AM', default: true },
      { id: 'daily-backup', label: 'Daily workspace backup', cron: '0 2 * * *', desc: 'Nightly workspace backup at 2AM', default: true },
      { id: 'weekly-compliance', label: 'Weekly compliance audit', cron: '0 6 * * 1', desc: 'Monday 6AM compliance scan', default: true },
      { id: 'weekly-telemetry', label: 'Weekly telemetry sync', cron: '0 0 * * 1', desc: 'Monday midnight telemetry export', default: true },
      { id: 'monthly-cert', label: 'Monthly certificate renewal check', cron: '0 8 1 * *', desc: 'First of month cert check', default: false },
    ];
  }
  return [
    { id: 'daily-review', label: 'Daily self-review', cron: '0 9 * * *', desc: 'Daily agent performance review at 9AM', default: true },
    { id: 'weekly-telemetry', label: 'Weekly telemetry sync', cron: '0 0 * * 1', desc: 'Monday midnight telemetry export', default: false },
  ];
}

function renderSchedulerSuggestions() {
  const container = document.getElementById('adv-scheduler-suggestions');
  if (!container) return;
  const suggestions = getSchedulerSuggestions();

  for (const s of suggestions) {
    if (advState.schedulerSelections[s.id] === undefined) {
      advState.schedulerSelections[s.id] = s.default;
    }
  }

  let html = '';
  for (const s of suggestions) {
    const isOn = advState.schedulerSelections[s.id];
    html += `<div class="wizard-toggle-row">
      <div>
        <div>${escHtml(s.label)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${escHtml(s.desc)} &middot; <code style="font-size:10px;">${escHtml(s.cron)}</code></div>
      </div>
      <div class="wizard-toggle ${isOn ? 'on' : ''}" onclick="advToggleScheduler('${s.id}', this)"></div>
    </div>`;
  }
  container.innerHTML = html;
  applyAdvancedWizardHoverTooltips();
}

window.advToggleScheduler = function advToggleScheduler(id, el) {
  advState.schedulerSelections[id] = !advState.schedulerSelections[id];
  el.classList.toggle('on');
};

// ── Step 8: Integrations (OAuth) ─────────────────────────────────────────────

async function initIntegrationsStep() {
  const gStat = document.getElementById('adv-gmail-status');
  const gBtn = document.getElementById('adv-gmail-connect');
  try {
    const data = await api('GET', '/api/auth/gmail/status');
    if (data.connected) {
      if (gStat) gStat.innerHTML = `<span style="color:#22c55e;">✓ Connected as ${escHtml(data.email || 'Connected')}</span>`;
      if (gBtn) gBtn.style.display = 'none';
    } else if (!data.available) {
      if (gStat) gStat.innerHTML = 'Unavailable. PRISM_GMAIL_CLIENT_ID not set.';
      if (gBtn) gBtn.style.display = 'none';
    } else {
      if (gStat) gStat.innerHTML = 'Not connected.';
    }
  } catch { /* ignore */ }

  const oStat = document.getElementById('adv-outlook-status');
  const oBtn = document.getElementById('adv-outlook-connect');
  try {
    const data = await api('GET', '/api/auth/outlook/status');
    if (data.connected) {
      if (oStat) oStat.innerHTML = `<span style="color:#22c55e;">✓ Connected as ${escHtml(data.email || data.displayName || 'Connected')}</span>`;
      if (oBtn) oBtn.style.display = 'none';
    } else if (!data.available) {
      if (oStat) oStat.innerHTML = 'Unavailable. PRISM_OUTLOOK_CLIENT_ID not set.';
      if (oBtn) oBtn.style.display = 'none';
    } else {
      if (oStat) oStat.innerHTML = 'Not connected.';
    }
  } catch { /* ignore */ }

  if (!advState.oauthPoll) {
    advState.oauthPoll = setInterval(() => {
      if (currentStep === 8) initIntegrationsStep();
    }, 2000);
  }
}

window.advOAuthConnect = async function advOAuthConnect(provider) {
  try {
    const data = await api('GET', `/api/auth/${provider}/authorize`);
    if (data.authUrl) {
      window.open(data.authUrl, '_blank', 'width=520,height=640,noopener');
    }
  } catch (e) {
    console.error('OAuth connect failed', e);
  }
};

// ── Step 9: Summary & Initialization Certificate ─────────────────────────────

async function initSummaryStep() {
  const container = document.getElementById('adv-summary-checks');
  const status = document.getElementById('adv-summary-status');
  const certBox = document.getElementById('adv-cert-box');
  if (!container) return;

  container.innerHTML = '<div class="wizard-check-item"><span class="check-icon pending">⋯</span> Validating configuration...</div>';

  // Save profile
  await api('POST', '/api/setup/profile', { executionProfileSegment: advState.profile });

  // Save workspace
  if (advState.workspaceRoot) {
    await api('POST', '/api/setup/workspace', { workspaceRoot: advState.workspaceRoot });
  }

  // Save API key if provided
  if (advState.apiKey && PROVIDERS_NEEDING_KEY.includes(advState.provider)) {
    try {
      await api('POST', '/api/llm/provider-secret', { providerId: advState.provider, apiKey: advState.apiKey });
    } catch { /* best-effort */ }
  }

  // Save routing config
  if (advState.routingStrategy !== 'single') {
    try {
      await api('POST', '/api/llm/routing', {
        strategy: advState.routingStrategy,
        roleOverrides: advState.roleOverrides,
      });
    } catch { /* best-effort */ }
  }

  // Create scheduled jobs
  const suggestions = getSchedulerSuggestions();
  for (const s of suggestions) {
    if (advState.schedulerSelections[s.id]) {
      try {
        await api('POST', '/api/scheduler/cron', {
          label: s.label,
          cron: s.cron,
          action: s.id,
        });
      } catch { /* best-effort */ }
    }
  }

  // Run readiness check
  const readiness = await api('POST', '/api/readiness/recheck', { source: 'setup_wizard_advanced' });

  const browserEmail = advState.browserUseCac ? advState.cacOperatorEmail : advState.browserEmail;

  // Build summary checks
  const checks = [
    { label: 'Execution Profile', passed: true, detail: advState.profile === 'business' ? 'Business (strict governance)' : 'Individual (fast defaults)' },
    { label: 'Workspace Directory', passed: true, detail: advState.workspaceRoot || 'Default location' },
    { label: 'LLM Provider', passed: true, detail: advState.provider },
    { label: 'Routing Strategy', passed: true, detail: advState.routingStrategy === 'single' ? 'Single model' : advState.routingStrategy === 'multi' ? 'Multi-model (role-based)' : 'Modality-aware' },
    { label: 'Guardian Agent', passed: !!advState.guardianModel, detail: advState.guardianModel ? `${advState.guardianTier} — ${advState.guardianModel.split(/[/\\]/).pop()}` : 'Not configured' },
    { label: 'CAC Assignment', passed: !!advState.cacAssignmentId, detail: advState.cacAssignmentId ? `${advState.cacCharacter} → ${advState.cacOperatorEmail}` : (advState.cacCharacter ? 'Pending assignment' : 'Not configured') },
    { label: 'Browser Profile', passed: !!advState.browserProfileId, detail: advState.browserProfileId ? `${browserEmail} (${advState.browserSegment})` : (browserEmail ? 'Pending creation' : 'Not configured') },
    { label: 'Scheduler', passed: true, detail: `${Object.values(advState.schedulerSelections).filter(Boolean).length} task(s) enabled` },
    ...(readiness.requirements || []),
  ];

  let html = '';
  for (const c of checks) {
    const icon = c.passed ? '✓' : '✗';
    const cls = c.passed ? 'pass' : 'fail';
    html += `<div class="wizard-check-item">
      <span class="check-icon ${cls}">${icon}</span>
      <div><div>${escHtml(c.label)}</div><div class="wizard-check-detail">${escHtml(c.detail)}</div></div>
    </div>`;
  }
  container.innerHTML = html;

  const allPassed = checks.every(c => c.passed);
  if (status) {
    if (allPassed) {
      status.innerHTML = '<div class="wizard-summary-ready"><div class="big-check">✓</div><div style="font-weight:600;font-size:16px;">All systems ready</div></div>';
    } else {
      status.innerHTML = '<div style="color:var(--muted);font-size:12px;margin-top:8px;">Some items are not configured. You can still launch and configure them later.</div>';
    }
  }

  if (certBox) certBox.style.display = '';
}

// ── Generic toggle ───────────────────────────────────────────────────────────

window.advToggle = function advToggle(el) {
  el.classList.toggle('on');

  if (el.id === 'adv-guardian-autostart') {
    advState.guardianAutoStart = el.classList.contains('on');
  }
};

// ── Navigation ───────────────────────────────────────────────────────────────

window.advWizardNext = async function advWizardNext() {
  const nextBtn = document.getElementById('adv-wizard-next');
  if (currentStep < TOTAL_STEPS) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Validating...';

    try {
      if (currentStep === 1) {
        await api('POST', '/api/setup/profile', { executionProfileSegment: advState.profile });
      }
      if (currentStep === 2) {
        if (advState.workspaceRoot) {
          await api('POST', '/api/setup/workspace', { workspaceRoot: advState.workspaceRoot });
        }
        const data = await api('GET', '/api/setup/prerequisites');
        const allPassed = (data.checks || []).every(c => c.passed);
        if (!allPassed) {
          const errContainer = document.getElementById('adv-workspace-checks');
          if (errContainer) {
            const existingErr = errContainer.querySelector('.val-error');
            if (existingErr) existingErr.remove();
            errContainer.insertAdjacentHTML('beforeend', '<div class="val-error" style="color:var(--danger);font-size:12px;margin-top:8px;">Workspace prerequisites must be satisfied to continue.</div>');
          }
          return;
        }
      }
      if (currentStep === 3) {
        showToast("Testing provider connection...", "info");
        const reachable = await advTestProviderConnection();
        if (!reachable) {
          showToast("Connection test failed.", "error");
          return;
        }
        showToast("Connection verified successfully!", "success");
        await delay(500);

        const needsKey = PROVIDERS_NEEDING_KEY.includes(advState.provider);
        if (advState.apiKey && needsKey) {
          showToast("Saving API key to secrets...", "info");
          await api('POST', '/api/llm/provider-secret', {
            providerId: advState.provider,
            apiKey: advState.apiKey,
          });
          showToast("API key saved.", "success");
          await delay(500);
        }

        showToast("Saving provider settings...", "info");
        let testModels = [];
        try {
          const testRes = await api('POST', '/api/llm/provider-test', {
            providerId: advState.provider,
            apiKey: advState.apiKey || undefined,
          });
          if (testRes.models) {
            testModels = testRes.models;
          }
        } catch { /* ignore */ }

        const defaultModel = advState.model || testModels[0] || null;
        await api('POST', '/api/llm/provider-settings', {
          providerId: advState.provider,
          models: testModels,
          defaultModel: defaultModel,
        });

        showToast("Applying model to system...", "info");
        await api('POST', '/api/llm/select', {
          providerId: advState.provider,
          model: defaultModel,
        });
        showToast("Model applied to system as ready.", "success");
        await delay(500);
      }
      if (currentStep === 5) {
        const errEl = document.getElementById('adv-guardian-error');
        if (errEl) {
          errEl.style.display = 'none';
          errEl.textContent = '';
        }
        if (advState.guardianModel) {
          try {
            const res = await api('POST', '/api/guardian/configure', {
              modelPath: advState.guardianModel,
              authorityTier: advState.guardianTier,
              autoStart: advState.guardianAutoStart,
            });
            if (res.error) {
              if (errEl) {
                errEl.textContent = "Failed to configure guardian: " + res.error;
                errEl.style.display = 'block';
              }
              return;
            }
          } catch (e) {
            if (errEl) {
              errEl.textContent = "Failed to configure guardian: " + (e.message || e);
              errEl.style.display = 'block';
            }
            return;
          }
        }
      }
      if (currentStep === 6) {
        const charEl = document.getElementById('adv-cac-character');
        const opEl = document.getElementById('adv-cac-operator-email');
        const prismEl = document.getElementById('adv-cac-prism-email');
        const hubEl = document.getElementById('adv-cac-workspace-hub');
        const opIdEl = document.getElementById('adv-cac-operator-id');
        const customNameEl = document.getElementById('adv-cac-custom-name');
        const opPasswordEl = document.getElementById('adv-cac-operator-password');

        const charVal = charEl?.value || '';
        const opEmail = opEl?.value.trim() || '';
        const prismEmail = prismEl?.value.trim() || '';
        const hubVal = hubEl?.value.trim() || '';
        const opIdVal = opIdEl?.value.trim() || '';
        const customNameVal = customNameEl?.value.trim() || '';
        const opPassword = opPasswordEl ? opPasswordEl.value : '';

        const errContainer = document.getElementById('adv-cac-assignment-result');
        if (errContainer) errContainer.innerHTML = '';

        if (!charVal) {
          showAdvCacError("Please select a character.");
          return;
        }
        if ((charVal === 'test-custom-agent' || charVal === 'custom-agent') && !customNameVal) {
          showAdvCacError("Agent Name is required for Custom Agent.");
          return;
        }
        if (!opEmail || !/^\S+@\S+\.\S+$/.test(opEmail)) {
          showAdvCacError("Please enter a valid operator email address.");
          return;
        }
        if (!opPassword) {
          showAdvCacError("Please enter a password for the operator account.");
          return;
        }
        if (opPassword.length < 4) {
          showAdvCacError("Password must be at least 4 characters long.");
          return;
        }
        if (!prismEmail || !/^\S+@\S+\.\S+$/.test(prismEmail)) {
          showAdvCacError("Please enter a valid PRISM user email address.");
          return;
        }
        if (!opIdVal) {
          showAdvCacError("Operator ID (First, Last Name) is required.");
          return;
        }
        if (!hubVal) {
          showAdvCacError("Workspace Hub is required.");
          return;
        }

        if (advState.profile === 'business') {
          const isPlaceholderOp = /@(prism\.local|example\.(com|org|net))$/i.test(opEmail);
          const isPlaceholderPr = /@(prism\.local|example\.(com|org|net))$/i.test(prismEmail);
          if (isPlaceholderOp || isPlaceholderPr) {
            showAdvCacError("Placeholder emails are not allowed for Business profile. Real email addresses must be used.");
            return;
          }
        }

        try {
          const result = await api('POST', '/api/workspace/character-assign', {
            characterId: charVal,
            operatorEmail: opEmail,
            prismUserEmail: prismEmail || undefined,
            operatorId: opIdVal || undefined,
            executionProfile: advState.profile,
            workspaceHub: hubVal || undefined,
            customDisplayName: customNameVal || undefined,
            operatorPassword: opPassword,
          });

          if (result.error || !result.assignment?.assignmentId) {
            showAdvCacError(result.error || "Character assignment failed.");
            return;
          }

          advState.cacCharacter = charVal;
          advState.cacOperatorEmail = opEmail;
          advState.cacPrismEmail = prismEmail;
          advState.cacOperatorId = opIdVal;
          advState.cacWorkspaceHub = hubVal;
          advState.cacAssignmentId = result.assignment.assignmentId;
        } catch (err) {
          showAdvCacError(err.message || String(err));
          return;
        }
      }
      if (currentStep === 7) {
        const browserEmail = advState.browserUseCac ? advState.cacOperatorEmail : advState.browserEmail;
        const errEl = document.getElementById('adv-browser-error');
        if (errEl) {
          errEl.style.display = 'none';
          errEl.textContent = '';
        }
        if (browserEmail) {
          try {
            const result = await api('POST', '/api/browser/profiles', {
              email: browserEmail,
              segment: advState.browserSegment,
            });
            const pid = result.profile?.profileId || result.profileId || result.id;
            if (pid) {
              advState.browserProfileId = pid;
            } else if (result.error) {
              if (errEl) {
                errEl.textContent = "Failed to create browser profile: " + result.error;
                errEl.style.display = 'block';
              }
              return;
            }
          } catch (e) {
            if (errEl) {
              errEl.textContent = "Failed to create browser profile: " + (e.message || e);
              errEl.style.display = 'block';
            }
            return;
          }
        }
      }

      showStep(currentStep + 1);
    } catch (err) {
      console.error(err);
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Continue';
    }
  } else {
    // Final step — create initialization certificate and launch
    nextBtn.disabled = true;
    nextBtn.textContent = 'Creating Certificate...';

    try {
      const certificate = {
        profile: {
          segment: advState.profile,
          governance: advState.profile === 'business' ? 'strict' : 'minimal',
        },
        workspace: {
          path: advState.workspaceRoot || 'default',
        },
        provider: {
          primary: advState.provider,
          hasApiKey: !!advState.apiKey,
        },
        routing: {
          strategy: advState.routingStrategy,
          roleOverrides: Object.keys(advState.roleOverrides).length > 0 ? advState.roleOverrides : 'none',
        },
        guardian: {
          model: advState.guardianModel || 'not configured',
          authorityTier: advState.guardianTier,
          autoStart: advState.guardianAutoStart,
        },
        agents: {
          defaultSwarmTopology: advState.swarmTopology,
        },
        cac: {
          character: advState.cacCharacter || 'Not Assigned',
          operatorEmail: advState.cacOperatorEmail || 'not set',
          prismUserEmail: advState.cacPrismEmail || 'not set',
          assignmentId: advState.cacAssignmentId || 'pending',
          workspaceHub: advState.cacWorkspaceHub || 'not set',
        },
        browserProfile: {
          email: advState.browserUseCac ? advState.cacOperatorEmail : advState.browserEmail || 'not set',
          segment: advState.browserSegment,
          profileId: advState.browserProfileId || 'pending',
        },
        scheduler: {
          enabledTasks: Object.entries(advState.schedulerSelections)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(', ') || 'none',
        },
        readiness: {
          timestamp: new Date().toISOString(),
        },
      };

      const certResult = await api('POST', '/api/setup/initialization-session', { certificate });
      advState.certificateResult = certResult;

      const certDetail = document.getElementById('adv-cert-detail');
      if (certDetail && certResult.sessionId) {
        certDetail.innerHTML = `<div style="color:var(--accent-2);font-weight:600;margin-bottom:4px;">✓ Certificate Created</div>
          <div>Session: <code style="font-size:11px;">${escHtml(certResult.sessionId)}</code></div>
          <div>Package: <code style="font-size:11px;">${escHtml(certResult.packageId || 'N/A')}</code></div>
          <div style="margin-top:4px;font-size:11px;color:var(--muted);">This immutable provenance record has been archived.</div>`;
      }

      const completeResult = await api('POST', '/api/setup/complete');

      nextBtn.disabled = false;
      nextBtn.textContent = 'Launch Dashboard';
      nextBtn.onclick = () => {
        const url = completeResult.token ? `/dashboard?token=${completeResult.token}` : '/dashboard';
        window.location.href = url;
      };
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Retry';
      const certDetail = document.getElementById('adv-cert-detail');
      if (certDetail) {
        certDetail.innerHTML = `<div style="color:var(--danger);">Certificate creation failed: ${escHtml(String(err.message || err))}</div>
          <div style="margin-top:4px;font-size:11px;color:var(--muted);">You can retry or launch without a certificate.</div>`;
      }
    }
  }
};

window.advWizardBack = function advWizardBack() {
  if (currentStep > 1) showStep(currentStep - 1);
};

window.advSkipSetup = function advSkipSetup() {
  window.location.href = '/setup';
};

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  renderProgress();

  try {
    const data = await api('GET', '/api/setup/advanced/status');
    if (data.executionProfileSegment === 'business') {
      advState.profile = 'business';
      advState.guardianTier = 'tier2_conditional';
      advState.swarmTopology = 'star';
      advState.browserSegment = 'business';
      const opt = document.querySelector('#step-1 .wizard-option[data-profile="business"]');
      const indOpt = document.querySelector('#step-1 .wizard-option[data-profile="individual"]');
      if (opt) opt.classList.add('selected');
      if (indOpt) indOpt.classList.remove('selected');
    }
    if (data.workspaceRoot) advState.workspaceRoot = data.workspaceRoot;
    if (data.routingConfig) {
      advState.routingStrategy = data.routingConfig.strategy || 'single';
      advState.roleOverrides = data.routingConfig.roleOverrides || {};
    }
  } catch { /* ignore */ }
  applyAdvancedWizardHoverTooltips();
})();
