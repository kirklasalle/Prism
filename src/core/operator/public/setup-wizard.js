// Setup Wizard — step-based first-run configuration for PRISM
//
// Phase E3b: steps 4 (character) + 5 (CAC identity) were inserted. The legacy
// "Summary + Launch" step is now step-6. No existing wiring was removed.

const TOTAL_STEPS = 6;
let currentStep = 1;
let wizardState = {
  profile: 'individual',
  workspaceRoot: '',
  provider: 'ollama',
  apiKey: '',
  // Phase E3b additions:
  characterId: '',
  operatorEmail: '',
  assistantEmail: '',
  importCharacterPreview: null,
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

// ── Progress dots ────────────────────────────────────────────────────────────

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
  const backBtn = document.getElementById('wizard-back');
  const nextBtn = document.getElementById('wizard-next');
  const skipBtn = document.getElementById('wizard-skip');
  if (backBtn) backBtn.style.display = n > 1 ? '' : 'none';
  if (nextBtn) nextBtn.textContent = n === TOTAL_STEPS ? 'Launch PRISM' : 'Continue';
  if (skipBtn) skipBtn.style.display = n === TOTAL_STEPS ? 'none' : '';
  renderProgress();

  if (n === 2) initWorkspaceStep();
  if (n === 3) initProviderStep();
  if (n === 4) initCharacterStep();
  if (n === 5) initIdentityStep();
  if (n === 6) initSummaryStep();
}

// ── Step 1: Profile selection ────────────────────────────────────────────────

window.selectProfile = function selectProfile(el, value) {
  wizardState.profile = value;
  document.querySelectorAll('#step-1 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
};

// ── Step 2: Workspace ────────────────────────────────────────────────────────

async function initWorkspaceStep() {
  const data = await api('GET', '/api/setup/status');
  const pathInput = document.getElementById('workspace-path');
  if (pathInput && !pathInput.value) {
    pathInput.value = data.workspaceRoot || '';
    wizardState.workspaceRoot = data.workspaceRoot || '';
  }
  pathInput?.addEventListener('input', () => {
    wizardState.workspaceRoot = pathInput.value;
  });
  await validateWorkspace();
}

async function validateWorkspace() {
  const container = document.getElementById('workspace-checks');
  if (!container) return;
  container.innerHTML = '<div class="wizard-check-item"><span class="check-icon pending">\u22EF</span> Checking...</div>';
  const data = await api('GET', '/api/setup/prerequisites');
  let html = '';
  for (const c of data.checks || []) {
    const icon = c.passed ? '\u2713' : '\u2717';
    const cls = c.passed ? 'pass' : 'fail';
    html += `<div class="wizard-check-item">
      <span class="check-icon ${cls}">${icon}</span>
      <div><div>${escHtml(c.label)}</div><div class="wizard-check-detail">${escHtml(c.detail)}</div></div>
    </div>`;
  }
  container.innerHTML = html;
}

// ── Step 3: Provider ─────────────────────────────────────────────────────────

const PROVIDERS_NEEDING_KEY = ['openai', 'anthropic', 'google', 'mistral', 'cohere', 'groq', 'together', 'deepseek', 'perplexity', 'fireworks', 'openrouter'];

function initProviderStep() {
  updateProviderKeyField();
}

window.selectProvider = function selectProvider(el, value) {
  wizardState.provider = value;
  document.querySelectorAll('#step-3 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  updateProviderKeyField();
};

function updateProviderKeyField() {
  const keyField = document.getElementById('provider-key-field');
  const keyLabel = document.getElementById('provider-key-label');
  const testResult = document.getElementById('provider-test-result');
  if (!keyField) return;

  const needsKey = PROVIDERS_NEEDING_KEY.includes(wizardState.provider);
  keyField.style.display = needsKey ? '' : 'none';
  if (keyLabel) keyLabel.textContent = `${wizardState.provider.charAt(0).toUpperCase() + wizardState.provider.slice(1)} API Key`;
  if (testResult) testResult.innerHTML = '';

  const keyInput = document.getElementById('provider-api-key');
  if (keyInput) {
    keyInput.value = wizardState.apiKey = '';
    keyInput.oninput = () => { wizardState.apiKey = keyInput.value; };
  }
}

async function testProviderConnection() {
  const testResult = document.getElementById('provider-test-result');
  if (!testResult) return false;
  testResult.innerHTML = '<span style="color:var(--muted);">Testing connection...</span>';
  try {
    const data = await api('POST', '/api/provider/test', {
      providerId: wizardState.provider,
      endpoint: undefined,
    });
    if (data.ok || data.reachable) {
      testResult.innerHTML = '<span style="color:var(--accent-2);">\u2713 Provider is reachable.</span>';
      return true;
    }
    testResult.innerHTML = `<span style="color:var(--danger);">\u2717 ${escHtml(data.error || data.reason || 'Could not reach provider.')}</span>`;
    return false;
  } catch {
    testResult.innerHTML = '<span style="color:var(--danger);">\u2717 Connection test failed.</span>';
    return false;
  }
}

// ── Step 4 (E3b): Character selection ───────────────────────────────────────

async function initCharacterStep() {
  try {
    const res = await api('GET', '/api/workspace/characters');
    const chars = Array.isArray(res?.characters) ? res.characters : [];
    const profile = wizardState.profile;
    const filtered = chars.filter(c => !c.executionProfile || c.executionProfile === profile);
    const list = document.getElementById('wizard-character-list');
    if (list) {
      list.innerHTML = filtered.map(c => `
        <div class="wizard-option" data-character-id="${escHtml(c.id)}" onclick="wizardSelectCharacter(this, '${escHtml(c.id)}')">
          <div style="font-weight:600;">${escHtml(c.displayName || c.name)}</div>
          <div style="font-size:12px;opacity:0.75;margin-top:4px;">${escHtml(c.persona || '')}</div>
          <div style="font-size:11px;opacity:0.6;margin-top:4px;">Tier cap: ${c.maxRiskTier ?? '—'}</div>
        </div>
      `).join('') || '<div style="opacity:0.7;font-size:13px;">No bundled characters for this profile. Use the Import tab.</div>';
    }
  } catch {
    const list = document.getElementById('wizard-character-list');
    if (list) list.innerHTML = '<div style="color:var(--danger);">Failed to load characters.</div>';
  }
  // Default tab = bundled
  wizardCharacterTab('bundled');
}

window.wizardCharacterTab = function wizardCharacterTab(tab) {
  const bundled = document.getElementById('wizard-character-panel-bundled');
  const imp = document.getElementById('wizard-character-panel-import');
  if (bundled) bundled.style.display = tab === 'bundled' ? '' : 'none';
  if (imp) imp.style.display = tab === 'import' ? '' : 'none';
};

window.wizardSelectCharacter = function wizardSelectCharacter(el, id) {
  wizardState.characterId = id;
  document.querySelectorAll('#wizard-character-list .wizard-option').forEach(o => o.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const selectedEl = document.getElementById('wizard-character-selected');
  if (selectedEl) selectedEl.textContent = `Selected: ${id}`;
};

window.wizardCharacterPreviewImport = async function wizardCharacterPreviewImport() {
  const ta = document.getElementById('wizard-character-import-json');
  const out = document.getElementById('wizard-character-import-result');
  const commitBtn = document.getElementById('wiz-char-commit-import');
  if (!ta || !out) return;
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { out.innerHTML = `<span style="color:var(--danger);">Invalid JSON: ${escHtml(String(e))}</span>`; return; }
  const res = await api('POST', '/api/workspace/character-import', {
    manifest: parsed,
    targetProfile: wizardState.profile,
    commit: false,
  });
  if (res && res.ok) {
    wizardState.importCharacterPreview = res.character;
    const warnings = (res.warnings || []).map(w => `<li>${escHtml(w)}</li>`).join('');
    out.innerHTML = `<div style="color:var(--success);">\u2713 Detected shape: ${escHtml(res.shape)}. Preview: <strong>${escHtml(res.character.name)}</strong></div>` +
      (warnings ? `<ul style="margin-top:4px;opacity:0.85;">${warnings}</ul>` : '');
    if (commitBtn) commitBtn.disabled = false;
  } else {
    const errs = (res?.errors || [res?.error || 'Import preview failed']).map(e => `<li>${escHtml(e)}</li>`).join('');
    out.innerHTML = `<div style="color:var(--danger);">\u2717 Import rejected:</div><ul>${errs}</ul>`;
    if (commitBtn) commitBtn.disabled = true;
  }
};

window.wizardCharacterCommitImport = async function wizardCharacterCommitImport() {
  const ta = document.getElementById('wizard-character-import-json');
  const out = document.getElementById('wizard-character-import-result');
  if (!ta) return;
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { if (out) out.innerHTML = `<span style="color:var(--danger);">Invalid JSON: ${escHtml(String(e))}</span>`; return; }
  const res = await api('POST', '/api/workspace/character-import', {
    manifest: parsed,
    targetProfile: wizardState.profile,
    commit: true,
  });
  if (res && res.ok) {
    wizardState.characterId = res.character.name;
    if (out) out.innerHTML = `<div style="color:var(--success);">\u2713 Imported ${escHtml(res.character.name)}.</div>`;
    const selectedEl = document.getElementById('wizard-character-selected');
    if (selectedEl) selectedEl.textContent = `Selected: ${res.character.name}`;
    // Refresh the bundled panel so the new character shows up.
    await initCharacterStep();
  } else if (out) {
    out.innerHTML = `<div style="color:var(--danger);">\u2717 ${escHtml(res?.error || 'Commit failed')}</div>`;
  }
};

// ── Step 5 (E3b): CAC Identity ──────────────────────────────────────────────

function initIdentityStep() {
  const opEl = document.getElementById('wizard-operator-email');
  const asEl = document.getElementById('wizard-assistant-email');
  const warnEl = document.getElementById('wizard-cac-warning');
  if (opEl) {
    if (!opEl.value) opEl.value = wizardState.operatorEmail || 'operator@prism.local';
    opEl.oninput = () => { wizardState.operatorEmail = opEl.value; updateCacWarning(); };
  }
  if (asEl) {
    const defaultAssistant = wizardState.characterId ? `${wizardState.characterId}@prism.local` : 'assistant@prism.local';
    if (!asEl.value) asEl.value = wizardState.assistantEmail || defaultAssistant;
    asEl.oninput = () => { wizardState.assistantEmail = asEl.value; updateCacWarning(); };
  }
  wizardState.operatorEmail = opEl?.value || '';
  wizardState.assistantEmail = asEl?.value || '';
  updateCacWarning();

  function updateCacWarning() {
    if (!warnEl) return;
    const op = (wizardState.operatorEmail || '').toLowerCase();
    const as = (wizardState.assistantEmail || '').toLowerCase();
    const isPlaceholder = (e) => !e || e.endsWith('@prism.local') || e.endsWith('@placeholder');
    warnEl.style.display = (isPlaceholder(op) || isPlaceholder(as)) ? '' : 'none';
  }
}

// ── Step 6: Summary ──────────────────────────────────────────────────────────

async function initSummaryStep() {
  const container = document.getElementById('summary-checks');
  const status = document.getElementById('summary-status');
  if (!container) return;

  container.innerHTML = '<div class="wizard-check-item"><span class="check-icon pending">\u22EF</span> Validating configuration...</div>';

  // Save profile choice before summary
  await api('POST', '/api/setup/profile', { executionProfileSegment: wizardState.profile });

  // Save workspace if changed
  const wsInput = document.getElementById('workspace-path');
  if (wsInput && wsInput.value) {
    await api('POST', '/api/setup/workspace', { workspaceRoot: wsInput.value });
  }

  // Save API key if provided
  if (wizardState.apiKey && PROVIDERS_NEEDING_KEY.includes(wizardState.provider)) {
    try {
      await api('POST', `/api/provider/${encodeURIComponent(wizardState.provider)}/key`, {
        apiKey: wizardState.apiKey,
      });
    } catch { /* key save is best-effort */ }
  }

  // Run readiness check
  const readiness = await api('POST', '/api/readiness/recheck', { source: 'setup_wizard' });

  const checks = [
    { label: 'Execution Profile', passed: true, detail: wizardState.profile === 'business' ? 'Business (strict governance)' : 'Individual (fast defaults)' },
    { label: 'Workspace Directory', passed: true, detail: wizardState.workspaceRoot || 'Default location' },
    { label: 'LLM Provider', passed: true, detail: wizardState.provider },
    ...(readiness.requirements || []),
  ];

  let html = '';
  for (const c of checks) {
    const icon = c.passed ? '\u2713' : '\u2717';
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
      status.innerHTML = '<div class="wizard-summary-ready"><div class="big-check">\u2713</div><div style="font-weight:600;font-size:16px;">All systems ready</div><div style="color:var(--muted);font-size:12px;margin-top:4px;">Click Launch PRISM to open the Frontier Console.</div></div>';
    } else {
      status.innerHTML = '<div style="color:var(--muted);font-size:12px;margin-top:8px;">Some checks did not pass. You can still launch and configure further in Settings.</div>';
    }
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

window.wizardNext = async function wizardNext() {
  if (currentStep < TOTAL_STEPS) {
    // Before advancing from step 1: save profile
    if (currentStep === 1) {
      await api('POST', '/api/setup/profile', { executionProfileSegment: wizardState.profile });
    }
    // Before advancing from step 2: save workspace
    if (currentStep === 2) {
      const wsInput = document.getElementById('workspace-path');
      if (wsInput && wsInput.value) {
        await api('POST', '/api/setup/workspace', { workspaceRoot: wsInput.value });
      }
    }
    // Phase E3b — step 4: persist defaultCharacterId before advancing.
    if (currentStep === 4) {
      if (!wizardState.characterId) {
        const sel = document.getElementById('wizard-character-selected');
        if (sel) sel.innerHTML = '<span style="color:var(--danger);">Select a character or import one before continuing.</span>';
        return;
      }
      try {
        await api('POST', '/api/setup/character', { characterId: wizardState.characterId });
      } catch { /* surfaced by summary readiness */ }
    }
    // Phase E3b — step 5: seed CAC + first session before advancing to summary.
    if (currentStep === 5) {
      try {
        await api('POST', '/api/setup/cac', {
          characterId: wizardState.characterId,
          operatorEmail: wizardState.operatorEmail,
          assistantEmail: wizardState.assistantEmail,
        });
      } catch { /* non-fatal; summary will show readiness */ }
    }
    showStep(currentStep + 1);
  } else {
    // Final step — complete setup and redirect to dashboard
    const nextBtn = document.getElementById('wizard-next');
    if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Launching...'; }
    await api('POST', '/api/setup/complete');
    window.location.href = '/dashboard';
  }
};

window.wizardBack = function wizardBack() {
  if (currentStep > 1) showStep(currentStep - 1);
};

window.skipSetup = async function skipSetup() {
  await api('POST', '/api/setup/complete');
  window.location.href = '/dashboard';
};

// ── Advanced Wizard ──────────────────────────────────────────────────────────

window.startAdvancedWizard = function startAdvancedWizard() {
  window.location.href = '/setup/advanced';
};

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  renderProgress();
  // Load initial status to pre-fill state
  try {
    const data = await api('GET', '/api/setup/status');
    if (data.executionProfileSegment === 'business') {
      wizardState.profile = 'business';
      const opt = document.querySelector('#step-1 .wizard-option[data-profile="business"]');
      const indOpt = document.querySelector('#step-1 .wizard-option[data-profile="individual"]');
      if (opt) opt.classList.add('selected');
      if (indOpt) indOpt.classList.remove('selected');
    }
  } catch { /* ignore */ }
})();
