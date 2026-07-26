// Setup Wizard — step-based first-run configuration for PRISM
//
// Rearranged steps:
// Step 1: Profile Choice
// Step 2: Workspace Location
// Step 3: Choose First Assistant (character selection)
// Step 4: Identity & First Session (CAC email setup)
// Step 5: Provider & Model Setup + Guardian Setup (combined final step)

const TOTAL_STEPS = 5;
let currentStep = 1;
let wizardState = {
  profile: 'individual',
  workspaceRoot: '',
  provider: 'ollama',
  apiKey: '',
  providerConfigs: {},
  characterId: '',
  operatorEmail: '',
  assistantEmail: '',
  importCharacterPreview: null,
  guardianModel: '',
  guardianTier: '',
  guardianAutoStart: true,
  guardianAutoUpdate: true,
  availableModels: [],
  cacAssignmentId: null,
};
let providerCatalog = null;
const PROVIDERS_NEEDING_KEY = ['openai', 'anthropic', 'google', 'mistral', 'cohere', 'groq', 'together', 'deepseek', 'perplexity', 'fireworks', 'openrouter', 'custom'];

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

function getProviderConfig(providerId) {
  if (!wizardState.providerConfigs[providerId]) {
    wizardState.providerConfigs[providerId] = {
      apiKey: '',
      tested: false,
      reachable: false,
      models: [],
      defaultModel: null,
      touched: false,
      saved: false,
      savedAt: null,
      lastError: '',
    };
  }
  return wizardState.providerConfigs[providerId];
}

function formatProviderLabel(providerId) {
  const providerMeta = providerCatalog?.find((p) => p.id === providerId);
  return providerMeta?.label || providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function renderConfiguredProvidersSummary() {
  const summary = document.getElementById('provider-config-summary');
  if (!summary) return;

  const entries = Object.entries(wizardState.providerConfigs)
    .filter(([, cfg]) => cfg.saved)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    summary.innerHTML = '<div style="opacity:0.7;">No providers saved yet. Select a provider, test it, then Save.</div>';
    return;
  }

  summary.innerHTML = entries
    .map(([providerId, cfg]) => {
      const modelCount = Array.isArray(cfg.models) ? cfg.models.length : 0;
      const stateText = cfg.reachable ? 'reachable' : 'saved';
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08);">
        <span><strong>${escHtml(formatProviderLabel(providerId))}</strong>${providerId === wizardState.provider ? ' (primary)' : ''}</span>
        <span style="opacity:0.8;">${modelCount} models · ${stateText}</span>
      </div>`;
    })
    .join('');
}

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

function applyWizardHoverTooltips() {
  document.querySelectorAll('.wizard-option').forEach((el) => {
    if (el.getAttribute('title')) return;
    const heading = el.querySelector('h3');
    const text = (heading?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) el.setAttribute('title', text);
  });

  document.querySelectorAll('button, input, select, textarea, .wizard-toggle, input[type="checkbox"]').forEach((el) => {
    if (el.getAttribute('title')) return;
    if (el.id === 'wizard-next') {
      el.setAttribute('title', currentStep === TOTAL_STEPS ? 'Launch PRISM with this configuration' : 'Continue to the next setup step');
      return;
    }
    if (el.id === 'wizard-back') {
      el.setAttribute('title', 'Return to the previous setup step');
      return;
    }
    if (el.id === 'wizard-skip') {
      el.setAttribute('title', 'Skip setup and launch with defaults');
      return;
    }
    const labelText = (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').replace(/\s+/g, ' ').trim();
    if (labelText) el.setAttribute('title', labelText);
  });
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
  if (nextBtn) nextBtn.textContent = 'Continue';
  if (skipBtn) skipBtn.style.display = n === TOTAL_STEPS ? 'none' : '';
  renderProgress();

  if (n === 2) initWorkspaceStep();
  if (n === 3) initCharacterStep();
  if (n === 4) initIdentityStep();
  if (n === 5) initProviderGuardianStep();
  applyWizardHoverTooltips();
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

// ── Step 3: Character selection ──────────────────────────────────────────────

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
  window.wizardCharacterTab?.('bundled');
  applyWizardHoverTooltips();
}

window.wizardCharacterTab = function wizardCharacterTab(tab) {
  const bundled = document.getElementById('wizard-character-panel-bundled');
  const imp = document.getElementById('wizard-character-panel-import');
  if (bundled) bundled.style.display = tab === 'bundled' ? '' : 'none';
  if (imp) imp.style.display = tab === 'import' ? '' : 'none';
  applyWizardHoverTooltips();
};

window.wizardSelectCharacter = function wizardSelectCharacter(el, id) {
  wizardState.characterId = id;
  document.querySelectorAll('#wizard-character-list .wizard-option').forEach(o => o.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const selectedEl = document.getElementById('wizard-character-selected');
  if (selectedEl) selectedEl.textContent = `Selected: ${id}`;
  applyWizardHoverTooltips();
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
    out.innerHTML = `<div style="color:var(--success);">✓ Detected shape: ${escHtml(res.shape)}. Preview: <strong>${escHtml(res.character.name)}</strong></div>` +
      (warnings ? `<ul style="margin-top:4px;opacity:0.85;">${warnings}</ul>` : '');
    if (commitBtn) commitBtn.disabled = false;
  } else {
    const errs = (res?.errors || [res?.error || 'Import preview failed']).map(e => `<li>${escHtml(e)}</li>`).join('');
    out.innerHTML = `<div style="color:var(--danger);">✗ Import rejected:</div><ul>${errs}</ul>`;
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
    if (out) out.innerHTML = `<div style="color:var(--success);">✓ Imported ${escHtml(res.character.name)}.</div>`;
    const selectedEl = document.getElementById('wizard-character-selected');
    if (selectedEl) selectedEl.textContent = `Selected: ${res.character.name}`;
    await initCharacterStep();
  } else if (out) {
    out.innerHTML = `<div style="color:var(--danger);">✗ ${escHtml(res?.error || 'Commit failed')}</div>`;
  }
};

// ── Step 4 (E3b): CAC Identity ──────────────────────────────────────────────

function initIdentityStep() {
  const opEl = document.getElementById('wizard-operator-email');
  const asEl = document.getElementById('wizard-assistant-email');
  if (opEl) {
    if (!opEl.value) opEl.value = wizardState.operatorEmail || 'operator@yourcompany.com';
    opEl.oninput = () => { wizardState.operatorEmail = opEl.value; };
  }
  if (asEl) {
    const defaultAssistant = wizardState.characterId ? `${wizardState.characterId}@yourcompany.com` : 'assistant@yourcompany.com';
    if (!asEl.value) asEl.value = wizardState.assistantEmail || defaultAssistant;
    asEl.oninput = () => { wizardState.assistantEmail = asEl.value; };
  }
  wizardState.operatorEmail = opEl?.value || '';
  wizardState.assistantEmail = asEl?.value || '';
}

// ── Step 5: Provider & Model Setup + Guardian Setup ─────────────────────────

let guardianRecommendedCatalog = [];
let guardianActiveDownloadId = null;
let guardianDownloadPollTimer = null;

async function initProviderGuardianStep() {
  await loadProviderCatalog();
  getProviderConfig(wizardState.provider);
  updateProviderKeyField();
  renderConfiguredProvidersSummary();

  // Load GGUF models for guardian
  try {
    const data = await api('GET', '/api/models/gguf');
    wizardState.availableModels = data.models || data || [];
  } catch { wizardState.availableModels = []; }

  // Load recommended model catalog
  try {
    const catalogData = await api('GET', '/api/models/recommended/catalog');
    guardianRecommendedCatalog = catalogData.catalog || [];
  } catch { guardianRecommendedCatalog = []; }

  populateGuardianModelDropdown();

  // Set profile-aware defaults for tier
  const tierSelect = document.getElementById('wizard-guardian-tier');
  if (tierSelect) {
    if (!wizardState.guardianTier) {
      wizardState.guardianTier = wizardState.profile === 'business' ? 'tier2_conditional' : 'tier1_autonomous';
    }
    tierSelect.value = wizardState.guardianTier;
    tierSelect.onchange = () => { wizardState.guardianTier = tierSelect.value; };
  }

  // Auto-start checkbox
  const autoCheckbox = document.getElementById('wizard-guardian-autostart');
  if (autoCheckbox) {
    autoCheckbox.checked = wizardState.guardianAutoStart;
    autoCheckbox.onchange = () => { wizardState.guardianAutoStart = autoCheckbox.checked; };
  }

  const autoUpdateCheckbox = document.getElementById('wizard-guardian-autoupdate');
  if (autoUpdateCheckbox) {
    autoUpdateCheckbox.checked = wizardState.guardianAutoUpdate;
    autoUpdateCheckbox.onchange = () => { wizardState.guardianAutoUpdate = autoUpdateCheckbox.checked; };
  }

  // Hide validation error on init
  const valErr = document.getElementById('wizard-guardian-validation-error');
  if (valErr) valErr.style.display = 'none';
}

function populateGuardianModelDropdown() {
  const modelSelect = document.getElementById('wizard-guardian-model');
  const downloadBtn = document.getElementById('wizard-guardian-download-btn');
  if (!modelSelect) return;

  // Build a set of locally available model file names for dedup
  const localFileNames = new Set();
  for (const m of wizardState.availableModels) {
    const fname = (m.name || m.path || '').split(/[\\/]/).pop().toLowerCase();
    localFileNames.add(fname);
  }

  let html = '<option value="">— Select a Guardian model —</option>';

  // Group 1: Locally available models
  if (wizardState.availableModels.length > 0) {
    html += '<optgroup label="\u2705 Downloaded Models (Ready to Use)">';
    for (const m of wizardState.availableModels) {
      html += `<option value="${escHtml(m.path)}">${escHtml(m.name)}</option>`;
    }
    html += '</optgroup>';
  }

  // Group 2: Recommended models not yet downloaded
  const notDownloaded = guardianRecommendedCatalog.filter(rm => {
    const fname = (rm.fileName || '').toLowerCase();
    return !localFileNames.has(fname);
  });
  if (notDownloaded.length > 0) {
    html += '<optgroup label="\u{1F4E5} Recommended (Download Required)">';
    for (const rm of notDownloaded) {
      html += `<option value="recommend:${escHtml(rm.fileName)}" data-url="${escHtml(rm.url)}" data-mmproj-url="${escHtml(rm.mmprojUrl || '')}" data-mmproj-name="${escHtml(rm.mmprojName || '')}">[${escHtml(rm.size)}] ${escHtml(rm.name)}</option>`;
    }
    html += '</optgroup>';
  }

  modelSelect.innerHTML = html;
  if (wizardState.guardianModel) modelSelect.value = wizardState.guardianModel;

  modelSelect.onchange = () => {
    wizardState.guardianModel = modelSelect.value;
    updateGuardianDownloadButton();
    // Clear validation error when user selects
    const valErr = document.getElementById('wizard-guardian-validation-error');
    if (valErr) valErr.style.display = 'none';
  };

  updateGuardianDownloadButton();
}

function updateGuardianDownloadButton() {
  const downloadBtn = document.getElementById('wizard-guardian-download-btn');
  if (!downloadBtn) return;
  const isRecommended = wizardState.guardianModel && wizardState.guardianModel.startsWith('recommend:');
  downloadBtn.style.display = isRecommended ? '' : 'none';
}

window.downloadGuardianModel = async function downloadGuardianModel() {
  const modelSelect = document.getElementById('wizard-guardian-model');
  const downloadBtn = document.getElementById('wizard-guardian-download-btn');
  const progressEl = document.getElementById('wizard-guardian-download-progress');
  const statusEl = document.getElementById('wizard-guardian-download-status');
  if (!modelSelect || !downloadBtn) return;

  const selectedOption = modelSelect.options[modelSelect.selectedIndex];
  if (!selectedOption || !wizardState.guardianModel.startsWith('recommend:')) {
    showToast('Please select a recommended model to download.', 'error');
    return;
  }

  const fileName = wizardState.guardianModel.replace('recommend:', '');
  const dlUrl = selectedOption.getAttribute('data-url');
  const mmprojUrl = selectedOption.getAttribute('data-mmproj-url') || '';
  const mmprojName = selectedOption.getAttribute('data-mmproj-name') || '';

  if (!dlUrl) {
    showToast('No download URL available for this model.', 'error');
    return;
  }

  // Disable controls during download
  downloadBtn.disabled = true;
  downloadBtn.textContent = '\u23F3 Downloading...';
  modelSelect.disabled = true;
  if (progressEl) progressEl.style.display = '';
  if (statusEl) statusEl.textContent = 'Starting download...';

  try {
    const res = await api('POST', '/api/models/download', {
      url: dlUrl,
      name: fileName,
      mmprojUrl: mmprojUrl || undefined,
      mmprojName: mmprojName || undefined,
    });
    guardianActiveDownloadId = res.modelId;
    showToast(`Downloading ${fileName}...`, 'info');
    pollGuardianDownload(fileName);
  } catch (err) {
    downloadBtn.disabled = false;
    downloadBtn.textContent = '\u{1F4E5} Download';
    modelSelect.disabled = false;
    if (progressEl) progressEl.style.display = 'none';
    showToast(`Download failed: ${err.message || err}`, 'error');
  }
};

function pollGuardianDownload(fileName) {
  if (guardianDownloadPollTimer) clearInterval(guardianDownloadPollTimer);

  guardianDownloadPollTimer = setInterval(async () => {
    try {
      const data = await api('GET', '/api/models/download/status');
      const downloads = data.downloads || [];
      const dl = downloads.find(d => d.id === guardianActiveDownloadId);
      if (!dl) return;

      const progressBar = document.getElementById('wizard-guardian-progress-bar');
      const progressText = document.getElementById('wizard-guardian-progress-text');
      const statusEl = document.getElementById('wizard-guardian-download-status');
      const pct = Math.round(dl.progress || 0);

      if (progressBar) progressBar.style.width = pct + '%';
      if (progressText) progressText.textContent = pct + '%';

      if (dl.status === 'downloading') {
        const mb = ((dl.downloadedBytes || 0) / (1024 * 1024)).toFixed(1);
        const totalMb = dl.totalBytes ? ((dl.totalBytes / (1024 * 1024)).toFixed(1) + ' MB') : '?';
        if (statusEl) statusEl.textContent = `Downloading: ${mb} MB / ${totalMb}`;
      }

      if (dl.status === 'completed') {
        clearInterval(guardianDownloadPollTimer);
        guardianDownloadPollTimer = null;
        guardianActiveDownloadId = null;

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '100%';
        if (statusEl) statusEl.textContent = '\u2705 Download complete!';
        showToast(`${fileName} downloaded successfully!`, 'success');

        // Re-scan local models and refresh the dropdown
        try {
          const ggufData = await api('GET', '/api/models/gguf');
          wizardState.availableModels = ggufData.models || ggufData || [];
        } catch { /* keep existing */ }

        populateGuardianModelDropdown();

        // Auto-select the newly downloaded model
        const modelSelect = document.getElementById('wizard-guardian-model');
        if (modelSelect) {
          const matchOpt = Array.from(modelSelect.options).find(o =>
            !o.value.startsWith('recommend:') && o.value && o.textContent.toLowerCase().includes(fileName.toLowerCase().replace('.gguf', ''))
          );
          if (matchOpt) {
            modelSelect.value = matchOpt.value;
            wizardState.guardianModel = matchOpt.value;
          }
        }

        const downloadBtn = document.getElementById('wizard-guardian-download-btn');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = '\u{1F4E5} Download';
        }
        if (modelSelect) modelSelect.disabled = false;
        updateGuardianDownloadButton();

        // Hide progress after short delay
        setTimeout(() => {
          const progressEl = document.getElementById('wizard-guardian-download-progress');
          if (progressEl) progressEl.style.display = 'none';
        }, 3000);
      }

      if (dl.status === 'error') {
        clearInterval(guardianDownloadPollTimer);
        guardianDownloadPollTimer = null;
        guardianActiveDownloadId = null;

        if (statusEl) statusEl.textContent = `\u274c Error: ${dl.error || 'Download failed'}`;
        showToast(`Download failed: ${dl.error || 'Unknown error'}`, 'error');

        const downloadBtn = document.getElementById('wizard-guardian-download-btn');
        const modelSelect = document.getElementById('wizard-guardian-model');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = '\u{1F4E5} Download';
        }
        if (modelSelect) modelSelect.disabled = false;
      }
    } catch { /* network error during poll, continue */ }
  }, 1500);
}

async function applyGuardianTaskPreference(taskId, shouldEnable) {
  const tasksRes = await api('GET', '/api/guardian/tasks');
  const tasks = Array.isArray(tasksRes?.tasks) ? tasksRes.tasks : [];
  const task = tasks.find((t) => t && t.id === taskId);
  if (!task) {
    return;
  }
  if (Boolean(task.enabled) !== Boolean(shouldEnable)) {
    await api('POST', `/api/guardian/tasks/${taskId}/toggle`);
  }
}

async function applyGuardianLearningAndUpdatePreferences() {
  // Tie wizard auto-update preference to Guardian maintenance/learning loops.
  await applyGuardianTaskPreference('update_version_check', wizardState.guardianAutoUpdate);
  await applyGuardianTaskPreference('self_improve_check', wizardState.guardianAutoUpdate);
}

window.selectProvider = function selectProvider(el, value) {
  const currentProviderCfg = getProviderConfig(wizardState.provider);
  currentProviderCfg.apiKey = wizardState.apiKey || currentProviderCfg.apiKey || '';

  wizardState.provider = value;
  document.querySelectorAll('#step-5 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');

  const nextCfg = getProviderConfig(value);
  wizardState.apiKey = nextCfg.apiKey || '';
  updateProviderKeyField();
  renderConfiguredProvidersSummary();
};

async function loadProviderCatalog() {
  try {
    const data = await api('GET', '/api/llm/catalog');
    if (data && Array.isArray(data.providers)) {
      providerCatalog = data.providers;
    }
  } catch {
    providerCatalog = null;
  }
}

function updateProviderKeyField() {
  const keyField = document.getElementById('provider-key-field');
  const keyLabel = document.getElementById('provider-key-label');
  const testResult = document.getElementById('provider-test-result');
  if (!keyField) return;

  const providerMeta = providerCatalog?.find((p) => p.id === wizardState.provider);
  const needsKey = providerMeta?.requiresApiKey ?? PROVIDERS_NEEDING_KEY.includes(wizardState.provider);
  keyField.style.display = needsKey ? '' : 'none';
  if (keyLabel) keyLabel.textContent = `${providerMeta?.label || wizardState.provider.charAt(0).toUpperCase() + wizardState.provider.slice(1)} API Key`;
  if (testResult) testResult.innerHTML = '';

  const saveResult = document.getElementById('provider-save-result');
  if (saveResult) saveResult.innerHTML = '';

  const keyInput = document.getElementById('provider-api-key');
  const providerCfg = getProviderConfig(wizardState.provider);
  if (keyInput) {
    keyInput.value = providerCfg.apiKey || '';
    wizardState.apiKey = providerCfg.apiKey || '';
    keyInput.oninput = () => {
      const updated = getProviderConfig(wizardState.provider);
      updated.apiKey = keyInput.value;
      updated.touched = true;
      updated.saved = false;
      wizardState.apiKey = keyInput.value;
      renderConfiguredProvidersSummary();
    };
  }
}

window.testProviderConnection = async function testProviderConnection() {
  const testResult = document.getElementById('provider-test-result');
  if (!testResult) return false;
  testResult.innerHTML = '<span style="color:var(--muted);">Testing connection...</span>';
  try {
    const providerCfg = getProviderConfig(wizardState.provider);
    const data = await api('POST', '/api/llm/provider-test', {
      providerId: wizardState.provider,
      apiKey: wizardState.apiKey || undefined,
    });
    providerCfg.tested = true;
    providerCfg.reachable = Boolean(data.ok || data.reachable);
    providerCfg.lastError = '';
    providerCfg.models = Array.isArray(data.models) ? data.models : providerCfg.models;
    providerCfg.defaultModel = providerCfg.models[0] || providerCfg.defaultModel || null;
    providerCfg.touched = true;
    if (data.ok || data.reachable) {
      testResult.innerHTML = '<span style="color:var(--accent-2);">✓ Provider is reachable.</span>';
      renderConfiguredProvidersSummary();
      return true;
    }
    providerCfg.lastError = data.error || data.reason || 'Could not reach provider.';
    testResult.innerHTML = `<span style="color:var(--danger);">✗ ${escHtml(data.error || data.reason || 'Could not reach provider.')}</span>`;
    renderConfiguredProvidersSummary();
    return false;
  } catch {
    const providerCfg = getProviderConfig(wizardState.provider);
    providerCfg.tested = true;
    providerCfg.reachable = false;
    providerCfg.lastError = 'Connection test failed.';
    testResult.innerHTML = '<span style="color:var(--danger);">✗ Connection test failed.</span>';
    renderConfiguredProvidersSummary();
    return false;
  }
};

async function saveProviderConfiguration(providerId = wizardState.provider, opts = {}) {
  const { refreshModels = true, quiet = false } = opts;
  const providerCfg = getProviderConfig(providerId);
  const providerMeta = providerCatalog?.find((p) => p.id === providerId);
  const needsKey = providerMeta?.requiresApiKey ?? PROVIDERS_NEEDING_KEY.includes(providerId);
  const saveResult = document.getElementById('provider-save-result');

  if (!quiet && saveResult) {
    saveResult.innerHTML = '<span style="color:var(--muted);">Saving provider configuration...</span>';
  }

  let models = Array.isArray(providerCfg.models) ? providerCfg.models : [];

  if (refreshModels) {
    try {
      const testRes = await api('POST', '/api/llm/provider-test', {
        providerId,
        apiKey: providerCfg.apiKey || undefined,
      });
      providerCfg.tested = true;
      providerCfg.reachable = Boolean(testRes.ok || testRes.reachable);
      providerCfg.lastError = '';
      if (Array.isArray(testRes.models)) {
        models = testRes.models;
      }
    } catch {
      providerCfg.reachable = false;
      providerCfg.lastError = 'Provider test failed during save.';
    }
  }

  if (providerCfg.apiKey && needsKey) {
    await api('POST', '/api/llm/provider-secret', {
      providerId,
      apiKey: providerCfg.apiKey,
    });
  }

  const defaultModel = models[0] || null;
  await api('POST', '/api/llm/provider-settings', {
    providerId,
    models,
    defaultModel,
  });

  providerCfg.models = models;
  providerCfg.defaultModel = defaultModel;
  providerCfg.saved = true;
  providerCfg.savedAt = new Date().toISOString();
  providerCfg.touched = true;

  if (providerId === wizardState.provider) {
    wizardState.apiKey = providerCfg.apiKey || '';
  }

  renderConfiguredProvidersSummary();

  if (!quiet && saveResult) {
    saveResult.innerHTML = `<span style="color:var(--accent-2);">✓ ${escHtml(formatProviderLabel(providerId))} configuration saved.</span>`;
  }

  return providerCfg;
}

window.saveProviderConfiguration = async function saveProviderConfigurationHandler() {
  try {
    await saveProviderConfiguration(wizardState.provider, { refreshModels: true, quiet: false });
    showToast('Provider configuration saved.', 'success');
  } catch (error) {
    const saveResult = document.getElementById('provider-save-result');
    if (saveResult) {
      saveResult.innerHTML = `<span style="color:var(--danger);">✗ ${escHtml(String(error?.message || error || 'Save failed.'))}</span>`;
    }
    showToast('Provider configuration save failed.', 'error');
  }
};

async function saveAllConfiguredProviders() {
  const configured = Object.keys(wizardState.providerConfigs)
    .filter((providerId) => {
      const cfg = wizardState.providerConfigs[providerId];
      return cfg && (cfg.touched || cfg.saved || cfg.apiKey || providerId === wizardState.provider);
    });

  if (!configured.includes(wizardState.provider)) {
    configured.push(wizardState.provider);
  }

  for (const providerId of configured) {
    await saveProviderConfiguration(providerId, { refreshModels: true, quiet: true });
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

window.wizardNext = async function wizardNext() {
  const nextBtn = document.getElementById('wizard-next');
  if (currentStep < TOTAL_STEPS) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Validating...';

    try {
      // Step 1: Save profile
      if (currentStep === 1) {
        await api('POST', '/api/setup/profile', { executionProfileSegment: wizardState.profile });
      }

      // Step 2: Save and check workspace
      if (currentStep === 2) {
        const wsInput = document.getElementById('workspace-path');
        const workspaceRoot = wsInput ? wsInput.value.trim() : '';
        await api('POST', '/api/setup/workspace', { workspaceRoot });

        // Re-run prerequisites check and ensure they all passed
        const data = await api('GET', '/api/setup/prerequisites');
        const allPassed = (data.checks || []).every(c => c.passed);
        if (!allPassed) {
          const errContainer = document.getElementById('workspace-checks');
          if (errContainer) {
            const existingErr = errContainer.querySelector('.val-error');
            if (existingErr) existingErr.remove();
            errContainer.insertAdjacentHTML('beforeend', '<div class="val-error" style="color:var(--danger);font-size:12px;margin-top:8px;">Workspace prerequisites must be satisfied to continue.</div>');
          }
          return;
        }
      }

      // Step 3: Character Selection
      if (currentStep === 3) {
        if (!wizardState.characterId) {
          const sel = document.getElementById('wizard-character-selected');
          if (sel) sel.innerHTML = '<span style="color:var(--danger);">Select a character or import one before continuing.</span>';
          return;
        }
        const res = await api('POST', '/api/setup/character', { characterId: wizardState.characterId });
        if (res.error) {
          const sel = document.getElementById('wizard-character-selected');
          if (sel) sel.innerHTML = `<span style="color:var(--danger);">${escHtml(res.error)}</span>`;
          return;
        }
      }

      // Step 4: CAC Identity & First Session Setup
      if (currentStep === 4) {
        const opEl = document.getElementById('wizard-operator-email');
        const asEl = document.getElementById('wizard-assistant-email');
        const opPasswordEl = document.getElementById('wizard-operator-password');
        const opEmail = opEl ? opEl.value.trim() : '';
        const asEmail = asEl ? asEl.value.trim() : '';
        const opPassword = opPasswordEl ? opPasswordEl.value : '';

        const warnEl = document.getElementById('wizard-cac-warning');
        if (warnEl) warnEl.style.display = 'none';

        if (!opEmail || !/^\S+@\S+\.\S+$/.test(opEmail)) {
          showCacError("Please enter a valid operator email address.");
          return;
        }
        if (!opPassword) {
          showCacError("Please enter a password for the operator account.");
          return;
        }
        if (opPassword.length < 4) {
          showCacError("Password must be at least 4 characters long.");
          return;
        }
        if (!asEmail || !/^\S+@\S+\.\S+$/.test(asEmail)) {
          showCacError("Please enter a valid assistant email address.");
          return;
        }

        const isPlaceholder = /@(prism\.local|example\.(com|org|net))$/i.test(opEmail);
        if (isPlaceholder) {
          showCacError("Placeholder operator email is not allowed. Real addresses are required for certificate initialization.");
          return;
        }

        const res = await api('POST', '/api/setup/cac', {
          characterId: wizardState.characterId,
          operatorEmail: opEmail,
          assistantEmail: asEmail,
          operatorPassword: opPassword,
        });

        if (res.error || !res.cacAssignmentId) {
          showCacError(res.error || "Failed to initialize CAC assignment.");
          return;
        }

        wizardState.cacAssignmentId = res.cacAssignmentId;
        wizardState.operatorEmail = opEmail;
        wizardState.assistantEmail = asEmail;
      }

      showStep(currentStep + 1);
    } catch (err) {
      console.error(err);
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Continue';
    }
  } else {
    // Step 5: Final launch step — Guardian model is REQUIRED
    const valErr = document.getElementById('wizard-guardian-validation-error');

    if (!wizardState.guardianModel || wizardState.guardianModel.startsWith('recommend:')) {
      if (valErr) {
        valErr.style.display = '';
        valErr.textContent = wizardState.guardianModel && wizardState.guardianModel.startsWith('recommend:')
          ? 'The selected Guardian model has not been downloaded yet. Click the Download button first.'
          : 'A Guardian model is required to continue. Select or download a model above.';
      }
      showToast('Guardian model is required before completing setup.', 'error');
      return;
    }
    if (valErr) valErr.style.display = 'none';

    nextBtn.disabled = true;
    nextBtn.textContent = 'Launching...';

    const launchErr = document.getElementById('wizard-launch-error');
    if (launchErr) {
      launchErr.style.display = 'none';
      launchErr.textContent = '';
    }

    try {
      showToast("Saving provider configurations...", "info");
      await saveAllConfiguredProviders();
      showToast("Provider configurations saved.", "success");
      await delay(300);

      const primaryCfg = getProviderConfig(wizardState.provider);
      const defaultModel = primaryCfg.defaultModel || (primaryCfg.models?.[0] ?? null);

      showToast("Applying model to system...", "info");
      await api('POST', '/api/llm/select', {
        providerId: wizardState.provider,
        model: defaultModel,
      });
      showToast("Model applied to system as ready.", "success");
      await delay(500);

      // 3. Save Guardian config (always — Guardian is mandatory)
      showToast("Configuring Guardian Agent...", "info");
      await api('POST', '/api/guardian/configure', {
        modelPath: wizardState.guardianModel,
        authorityTier: wizardState.guardianTier,
        autoStart: wizardState.guardianAutoStart,
      });
      await applyGuardianLearningAndUpdatePreferences();
      showToast("Guardian Agent configured.", "success");
      await delay(500);

      // 4. Create certificate
      showToast("Creating initialization certificate...", "info");
      const certificate = {
        profile: {
          segment: wizardState.profile,
          governance: wizardState.profile === 'business' ? 'strict' : 'minimal',
        },
        workspace: {
          path: wizardState.workspaceRoot || 'default',
        },
        provider: {
          primary: wizardState.provider,
          hasApiKey: !!wizardState.apiKey,
        },
        routing: {
          strategy: 'single',
          roleOverrides: 'none',
        },
        guardian: {
          model: wizardState.guardianModel,
          authorityTier: wizardState.guardianTier || (wizardState.profile === 'business' ? 'tier2_conditional' : 'tier1_autonomous'),
          autoStart: !!wizardState.guardianAutoStart,
          autoUpdate: !!wizardState.guardianAutoUpdate,
        },
        agents: {
          defaultSwarmTopology: wizardState.profile === 'business' ? 'star' : 'mesh',
        },
        cac: {
          character: wizardState.characterId || 'not assigned',
          operatorEmail: wizardState.operatorEmail || 'not set',
          prismUserEmail: wizardState.assistantEmail || 'not set',
          assignmentId: wizardState.cacAssignmentId || 'pending',
          workspaceHub: 'default',
        },
        browserProfile: {
          email: wizardState.operatorEmail || 'not set',
          segment: wizardState.profile,
          profileId: 'pending',
        },
        scheduler: {
          enabledTasks: wizardState.profile === 'business' ? 'daily-review, daily-backup, weekly-compliance, weekly-telemetry' : 'daily-review',
        },
        readiness: {
          timestamp: new Date().toISOString(),
        },
      };

      const certResult = await api('POST', '/api/setup/initialization-session', { certificate });
      if (!certResult || !certResult.sessionId) {
        throw new Error("Failed to create system initialization certificate.");
      }
      showToast("Certificate generated.", "success");
      await delay(500);

      // 5. Complete setup
      showToast("Completing setup and launching PRISM...", "info");
      const completeResult = await api('POST', '/api/setup/complete');
      showToast("Setup complete! Redirecting...", "success");
      await delay(500);

      const url = completeResult.token ? `/dashboard?token=${completeResult.token}` : '/dashboard';
      window.location.href = url;
    } catch (err) {
      if (launchErr) {
        launchErr.textContent = `Launch failed: ${err.message || String(err)}`;
        launchErr.style.display = 'block';
      }
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Continue';
    }
  }
};

function showCacError(msg) {
  const warnEl = document.getElementById('wizard-cac-warning');
  if (warnEl) {
    warnEl.style.display = '';
    warnEl.style.background = 'rgba(255,80,80,0.15)';
    warnEl.style.color = '#ff8d8d';
    warnEl.textContent = msg;
  }
}

window.wizardBack = function wizardBack() {
  if (currentStep > 1) showStep(currentStep - 1);
};

window.skipSetup = async function skipSetup() {
  const completeResult = await api('POST', '/api/setup/complete');
  const url = completeResult.token ? `/dashboard?token=${completeResult.token}` : '/dashboard';
  window.location.href = url;
};

// ── Advanced Wizard ──────────────────────────────────────────────────────────

window.startAdvancedWizard = function startAdvancedWizard() {
  window.location.href = '/setup/advanced';
};

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  renderProgress();
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
  applyWizardHoverTooltips();
})();
