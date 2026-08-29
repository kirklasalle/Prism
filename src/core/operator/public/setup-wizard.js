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
const PROVIDERS_NEEDING_KEY = ['openai', 'anthropic', 'xai', 'google', 'mistral', 'cohere', 'groq', 'together', 'deepseek', 'perplexity', 'fireworks', 'openrouter', 'custom'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function upsertAuthRecoveryBanner(payload = {}) {
  const reason = payload?.reason || payload?.error || 'Authentication is required to continue setup.';
  const requestId = payload?.requestId || '';
  const tokenFromMeta = document.querySelector('meta[name="prism-auth-token"]')?.getAttribute('content') || '';
  const tokenFromQuery = new URL(window.location.href).searchParams.get('token') || '';
  const token = tokenFromMeta || tokenFromQuery;
  const retryUrl = token
    ? `/setup?rerun=true&token=${encodeURIComponent(token)}`
    : '/setup?rerun=true';

  let banner = document.getElementById('wizard-auth-recovery');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'wizard-auth-recovery';
    banner.style.cssText = [
      'margin:10px 0 14px 0',
      'padding:12px 14px',
      'border:1px solid rgba(239,68,68,0.45)',
      'background:rgba(239,68,68,0.12)',
      'border-radius:10px',
      'font-size:12px',
      'line-height:1.45'
    ].join(';');
    const target = document.querySelector('.wizard-card') || document.body;
    target.insertBefore(banner, target.firstChild);
  }

  banner.innerHTML =
    `<div style="font-weight:700;color:#fecaca;">Authentication session expired or missing.</div>` +
    `<div style="margin-top:4px;color:#fee2e2;">${escHtml(String(reason))}</div>` +
    (requestId
      ? `<div style="margin-top:4px;color:#fecaca;opacity:0.9;">requestId: <span style="font-family:monospace;">${escHtml(String(requestId))}</span></div>`
      : '') +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">` +
    `<button type="button" class="secondary-button" onclick="window.location.href='/login'">Go to Login</button>` +
    `<button type="button" class="primary-button" onclick="window.location.href='${retryUrl}'">Retry Wizard</button>` +
    `</div>`;
}

function clearAuthRecoveryBanner() {
  const banner = document.getElementById('wizard-auth-recovery');
  if (banner) banner.remove();
}

async function api(method, path, body) {
  const tokenFromMeta = document.querySelector('meta[name="prism-auth-token"]')?.getAttribute('content') || '';
  const tokenFromQuery = new URL(window.location.href).searchParams.get('token') || '';
  const token = tokenFromMeta || tokenFromQuery;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => '');
    payload = text ? { error: text } : null;
  }

  if (!res.ok) {
    if (res.status === 401) {
      upsertAuthRecoveryBanner(payload || { reason: 'Unauthorized' });
    }
    const reason = payload?.reason || payload?.error || payload?.message || `Request failed (${res.status})`;
    const reqId = payload?.requestId ? ` [requestId: ${payload.requestId}]` : '';
    throw new Error(String(reason) + reqId);
  }

  clearAuthRecoveryBanner();
  return payload || {};
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

function buildInitializationCertificatePayload() {
  const primaryCfg = getProviderConfig(wizardState.provider);
  return {
    profile: {
      segment: wizardState.profile,
      governance: wizardState.profile === 'business' ? 'strict' : 'minimal',
    },
    workspace: {
      path: wizardState.workspaceRoot || 'default',
    },
    provider: {
      primary: wizardState.provider,
      model: primaryCfg.defaultModel || (primaryCfg.models?.[0] ?? 'not selected'),
      hasApiKey: !!wizardState.apiKey,
    },
    routing: {
      strategy: 'single',
      roleOverrides: 'none',
    },
    guardian: {
      model: wizardState.guardianModel || 'not configured',
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
}

function renderCertificatePreviewSummary(mode = 'preview', certResult = null) {
  const certPreview = document.getElementById('wizard-cert-preview');
  const certDetail = document.getElementById('wizard-cert-detail');
  if (!certPreview || !certDetail) return;

  const cert = buildInitializationCertificatePayload();
  const primaryLabel = formatProviderLabel(cert.provider.primary || 'unknown');
  const rows = [
    ['Execution Profile', `${cert.profile.segment} (${cert.profile.governance})`],
    ['Workspace', cert.workspace.path],
    ['Primary Provider', `${primaryLabel} · ${cert.provider.model}`],
    ['Guardian', `${cert.guardian.authorityTier} · ${cert.guardian.model}`],
    ['CAC', `${cert.cac.character} · ${cert.cac.operatorEmail}`],
    ['Browser Profile', `${cert.browserProfile.email} (${cert.browserProfile.segment})`],
    ['Scheduler', cert.scheduler.enabledTasks],
  ];

  certPreview.innerHTML = rows.map(([label, value]) =>
    `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,0.08);">` +
    `<span style="color:var(--muted);font-size:11px;">${escHtml(label)}</span>` +
    `<span style="font-size:11px;text-align:right;max-width:70%;word-break:break-word;">${escHtml(String(value ?? 'n/a'))}</span>` +
    `</div>`
  ).join('');

  if (mode === 'created' && certResult) {
    certDetail.innerHTML = `<div style="color:var(--accent-2);font-weight:600;">✓ Certificate Created and Sealed</div>` +
      `<div style="margin-top:3px;">Session: <span style="font-family:monospace;font-size:11px;">${escHtml(certResult.sessionId || 'n/a')}</span></div>` +
      `<div>Package: <span style="font-family:monospace;font-size:11px;">${escHtml(certResult.packageId || 'n/a')}</span></div>` +
      `<div style="margin-top:3px;font-size:11px;color:var(--muted);">Use Operator Login to continue with this provenance chain.</div>`;
  } else if (mode === 'creating') {
    certDetail.innerHTML = `<div style="color:var(--accent-2);font-weight:600;">Creating Initialization Certificate...</div>` +
      `<div style="margin-top:3px;">The session package is being signed and archived.</div>`;
  } else if (mode === 'error') {
    certDetail.innerHTML = `<div style="color:#fca5a5;font-weight:600;">Certificate creation encountered an issue.</div>` +
      `<div style="margin-top:3px;">Review the error below and retry launch.</div>`;
  } else {
    certDetail.innerHTML = 'Review this immutable provenance snapshot before launch. It will be sealed as a dedicated session.';
  }
}

let expandedSummaryProviders = new Set();

window.toggleProviderModelInspector = function toggleProviderModelInspector(providerId) {
  if (expandedSummaryProviders.has(providerId)) {
    expandedSummaryProviders.delete(providerId);
  } else {
    expandedSummaryProviders.add(providerId);
  }
  renderConfiguredProvidersSummary();
};

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
      const models = Array.isArray(cfg.models) ? cfg.models : [];
      const modelCount = models.length;
      const stateText = cfg.reachable ? 'reachable' : 'saved';
      const isExpanded = expandedSummaryProviders.has(providerId);
      const isPrimary = providerId === wizardState.provider;

      let modelListHtml = '';
      if (isExpanded) {
        if (modelCount === 0) {
          modelListHtml = '<div style="margin-top:6px;padding:6px 10px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:11px;opacity:0.7;">No models discovered for this provider.</div>';
        } else {
          // Default model selector dropdown with search
          const currentDefault = cfg.defaultModel || '';
          const selectId = `provider-default-model-${escHtml(providerId)}`;
          const filterId = `provider-model-filter-${escHtml(providerId)}`;

          let defaultSelectHtml = `
            <div style="margin-top:8px;padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:8px;">
              <label style="font-size:10px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px;">Default Model for ${escHtml(formatProviderLabel(providerId))}</label>
              <input type="text" id="${filterId}" placeholder="Search ${modelCount} models..." 
                style="width:100%;padding:6px 10px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;font-family:monospace;margin-bottom:4px;outline:none;"
                oninput="wizardFilterProviderModels('${escHtml(providerId)}')" />
              <select id="${selectId}" size="8"
                style="width:100%;background:rgba(0,0,0,0.35);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;font-family:monospace;scrollbar-width:thin;padding:2px;"
                onchange="wizardSelectProviderDefaultModel('${escHtml(providerId)}', this.value)">`;

          for (const m of models) {
            const mId = typeof m === 'string' ? m : m.id || m.name || JSON.stringify(m);
            const isSelected = mId === currentDefault;
            const mLower = mId.toLowerCase();
            const isAuto = mLower === 'openrouter/auto' || mLower === 'auto';
            const isFree = mLower.includes(':free');
            const badge = isAuto ? ' ⚡ [AUTO]' : isFree ? ' 🎁 [FREE]' : '';
            defaultSelectHtml += `<option value="${escHtml(mId)}"${isSelected ? ' selected' : ''} title="${escHtml(mId)}">${escHtml(mId)}${badge}</option>`;
          }

          defaultSelectHtml += `</select>
              <div style="margin-top:4px;font-size:10px;opacity:0.6;">
                ${currentDefault ? `✓ Default: <strong>${escHtml(currentDefault)}</strong>` : 'Select a model to set as default'}
              </div>
            </div>`;

          modelListHtml = defaultSelectHtml;
        }
      }

      return `<div style="padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <span><strong>${escHtml(formatProviderLabel(providerId))}</strong>${isPrimary ? ' <span style="font-size:10px;background:rgba(105,210,255,0.2);color:var(--accent);padding:2px 6px;border-radius:4px;">primary</span>' : ''}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="secondary-button" style="font-size:10px;padding:2px 8px;border-radius:6px;opacity:0.9;" onclick="toggleProviderModelInspector('${escHtml(providerId)}')" title="Click to select a default model for ${escHtml(providerId)}">
              ${modelCount} models ${isExpanded ? '▴' : '▾'}
            </button>
            <span style="opacity:0.8;font-size:11px;">· ${stateText}</span>
          </div>
        </div>
        ${modelListHtml}
      </div>`;
    })
    .join('');
  applyWizardHoverTooltips();
}

window.wizardSelectProviderDefaultModel = function wizardSelectProviderDefaultModel(providerId, modelId) {
  const cfg = getProviderConfig(providerId);
  cfg.defaultModel = modelId;
  cfg.touched = true;
  console.debug(`[wizard][trace] Default model set for ${providerId}: ${modelId}`);
  renderConfiguredProvidersSummary();
  renderCertificatePreviewSummary('preview');
};

window.wizardFilterProviderModels = function wizardFilterProviderModels(providerId) {
  const filterId = `provider-model-filter-${providerId}`;
  const selectId = `provider-default-model-${providerId}`;
  const filterInput = document.getElementById(filterId);
  const selectEl = document.getElementById(selectId);
  if (!filterInput || !selectEl) return;
  const query = filterInput.value.toLowerCase();
  for (const opt of selectEl.options) {
    opt.style.display = opt.value.toLowerCase().includes(query) ? '' : 'none';
  }
};

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
  if (n === 5) renderCertificatePreviewSummary('preview');
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

const DEFAULT_RECOMMENDED_MODELS = [
  { name: "Qwen2.5 3B Q4 (Highly Recommended)", fileName: "qwen-2.5-3b-instruct-q4_k_m.gguf", size: "1.9 GB", url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf" },
  { name: "Qwen2.5-VL 3B Q8 (Vision, High Quality)", fileName: "Qwen2.5-VL-3B-Instruct-Q8_0.gguf", size: "3.3 GB", url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q8_0.gguf", mmprojUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf", mmprojName: "mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf" },
  { name: "Qwen2.5-VL 3B Q4 (Vision, Efficient)", fileName: "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf", size: "1.9 GB", url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf", mmprojUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf", mmprojName: "mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf" },
  { name: "Gemma 3 1B (Low VRAM ≤4 GB)", fileName: "google_gemma-3-1b-it-Q4_K_M.gguf", size: "0.8 GB", url: "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf" },
  { name: "Gemma 3 4B (Balanced)", fileName: "google_gemma-3-4b-it-Q4_K_M.gguf", size: "2.8 GB", url: "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf" },
  { name: "Gemma 2 2B Q4 (Agentic, 6 GB VRAM)", fileName: "gemma-2-2b-it-Q4_K_M.gguf", size: "1.6 GB", url: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf" },
  { name: "Gemma 2 2B Q8 (Agentic, High Quality)", fileName: "gemma-2-2b-it-Q8_0.gguf", size: "2.9 GB", url: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf" },
  { name: "Phi-3.5 Mini 3.8B Q4 (Reasoning)", fileName: "Phi-3.5-mini-instruct-Q4_K_M.gguf", size: "2.4 GB", url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf" },
  { name: "Llama 3.2 3B Q4 (General)", fileName: "llama-3.2-3b-instruct-q4_k_m.gguf", size: "2.2 GB", url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf" },
  { name: "Qwen2.5 1.5B Q4 (Compact Agent)", fileName: "qwen-2.5-1.5b-instruct-q4_k_m.gguf", size: "1.1 GB", url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" },
  { name: "Ministral 3B Q4 (128k Context)", fileName: "mistralai_Ministral-3-3B-Instruct-2512-Q4_K_M.gguf", size: "2.1 GB", url: "https://huggingface.co/bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF/resolve/main/mistralai_Ministral-3-3B-Instruct-2512-Q4_K_M.gguf" }
];

let guardianRecommendedCatalog = [...DEFAULT_RECOMMENDED_MODELS];
let guardianActiveDownloadId = null;
let guardianDownloadPollTimer = null;

window.testProviderConnection = async function testProviderConnection() {
  const btn = document.getElementById('wiz-test-provider-btn');
  const resultEl = document.getElementById('provider-test-result');
  const keyInput = document.getElementById('provider-api-key');
  const providerId = wizardState.provider;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⌛ Testing...';
  }
  if (resultEl) {
    resultEl.innerHTML = '<span style="opacity:0.7;">Testing connection to ' + escHtml(formatProviderLabel(providerId)) + '...</span>';
  }

  const apiKey = keyInput ? keyInput.value.trim() : '';

  console.debug(`[wizard][trace] Testing provider connection: ${providerId}`);
  try {
    const res = await api('POST', '/api/llm/provider-test', {
      providerId: providerId,
      apiKey: apiKey
    });

    const cfg = getProviderConfig(providerId);
    cfg.apiKey = apiKey;
    cfg.tested = true;
    cfg.reachable = Boolean(res && (res.ok || res.reachable));

    if (res && (res.ok || res.reachable)) {
      cfg.models = Array.isArray(res.models) ? res.models : [];
      cfg.saved = true;
      expandedSummaryProviders.add(providerId);
      if (!cfg.defaultModel && cfg.models.length > 0) {
        cfg.defaultModel = cfg.models[0];
      }
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:var(--success);">✓ ${escHtml(res.message || 'Connection successful!')} (${cfg.models.length} models found, ${res.latencyMs || 0}ms)</span>`;
      }
      showToast(`Connected to ${formatProviderLabel(providerId)} (${cfg.models.length} models)`, 'success');
    } else {
      cfg.lastError = res?.message || res?.error || 'Connection failed';
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:var(--danger);">✗ ${escHtml(res?.message || res?.error || 'Connection test failed.')}</span>`;
      }
      showToast(`Provider test failed: ${res?.message || res?.error || 'Connection error'}`, 'error');
    }
    renderConfiguredProvidersSummary();
    renderCertificatePreviewSummary('preview');
  } catch (err) {
    console.error('[wizard] testProviderConnection FAILED:', err);
    if (resultEl) {
      resultEl.innerHTML = `<span style="color:var(--danger);">✗ Network error: ${escHtml(String(err))}</span>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Test Connection';
    }
  }
};

window.saveProviderConfiguration = async function saveProviderConfiguration() {
  const btn = document.getElementById('wiz-save-provider-btn');
  const resultEl = document.getElementById('provider-save-result');
  const keyInput = document.getElementById('provider-api-key');
  const providerId = wizardState.provider;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⌛ Saving...';
  }
  if (resultEl) {
    resultEl.innerHTML = '<span style="opacity:0.7;">Saving provider configuration...</span>';
  }

  const apiKey = keyInput ? keyInput.value.trim() : (wizardState.providerConfigs[providerId]?.apiKey || '');
  const cfg = getProviderConfig(providerId);

  try {
    if (apiKey) {
      await api('POST', '/api/llm/provider-secret', {
        providerId: providerId,
        apiKey: apiKey
      });
      cfg.apiKey = apiKey;
    }

    await api('POST', '/api/llm/provider-settings', {
      providerId: providerId,
      models: cfg.models || [],
      defaultModel: cfg.defaultModel || (cfg.models && cfg.models[0]) || null
    });

    cfg.saved = true;
    cfg.savedAt = new Date().toISOString();
    wizardState.apiKey = apiKey;

    if (resultEl) {
      resultEl.innerHTML = `<span style="color:var(--success);">✓ ${escHtml(formatProviderLabel(providerId))} configuration saved!</span>`;
    }
    showToast(`Saved ${formatProviderLabel(providerId)} configuration`, 'success');
    renderConfiguredProvidersSummary();
    renderCertificatePreviewSummary('preview');
  } catch (err) {
    console.error('[wizard] saveProviderConfiguration FAILED:', err);
    if (resultEl) {
      resultEl.innerHTML = `<span style="color:var(--danger);">✗ Save failed: ${escHtml(String(err))}</span>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Save Provider';
    }
  }
};

async function saveAllConfiguredProviders() {
  for (const [pId, cfg] of Object.entries(wizardState.providerConfigs)) {
    if (cfg.saved || cfg.tested) {
      try {
        if (cfg.apiKey) {
          await api('POST', '/api/llm/provider-secret', { providerId: pId, apiKey: cfg.apiKey });
        }
        await api('POST', '/api/llm/provider-settings', {
          providerId: pId,
          models: cfg.models || [],
          defaultModel: cfg.defaultModel || (cfg.models && cfg.models[0]) || null
        });
      } catch (err) {
        console.warn(`[wizard] Failed to persist provider config for ${pId}:`, err);
      }
    }
  }
}
async function initProviderGuardianStep() {
  console.debug('[wizard][trace] initProviderGuardianStep — begin');
  await loadProviderCatalog();
  getProviderConfig(wizardState.provider);
  updateProviderKeyField();
  renderConfiguredProvidersSummary();

  // Load GGUF models for guardian
  console.debug('[wizard][trace] Fetching GGUF models from /api/models/gguf');
  try {
    const data = await api('GET', '/api/models/gguf');
    wizardState.availableModels = data.models || data || [];
    console.debug(`[wizard][trace] GGUF models loaded: ${wizardState.availableModels.length} models`, wizardState.availableModels);
  } catch (err) {
    console.error('[wizard][trace] GGUF model fetch FAILED:', err);
    wizardState.availableModels = [];
  }

  // Load recommended model catalog
  console.debug('[wizard][trace] Fetching recommended catalog from /api/models/recommended/catalog');
  try {
    const catalogData = await api('GET', '/api/models/recommended/catalog');
    if (Array.isArray(catalogData.catalog) && catalogData.catalog.length > 0) {
      guardianRecommendedCatalog = catalogData.catalog;
    }
    console.debug(`[wizard][trace] Recommended catalog loaded: ${guardianRecommendedCatalog.length} entries`, guardianRecommendedCatalog);
  } catch (err) {
    console.error('[wizard][trace] Recommended catalog fetch FAILED:', err);
  }

  populateGuardianModelDropdown();

  // Set profile-aware defaults for tier
  const tierSelect = document.getElementById('wizard-guardian-tier');
  if (tierSelect) {
    if (!wizardState.guardianTier) {
      wizardState.guardianTier = wizardState.profile === 'business' ? 'tier2_conditional' : 'tier1_autonomous';
    }
    tierSelect.value = wizardState.guardianTier;
    tierSelect.onchange = () => {
      wizardState.guardianTier = tierSelect.value;
      renderCertificatePreviewSummary('preview');
    };
  }

  // Auto-start checkbox
  const autoCheckbox = document.getElementById('wizard-guardian-autostart');
  if (autoCheckbox) {
    autoCheckbox.checked = wizardState.guardianAutoStart;
    autoCheckbox.onchange = () => {
      wizardState.guardianAutoStart = autoCheckbox.checked;
      renderCertificatePreviewSummary('preview');
    };
  }

  const autoUpdateCheckbox = document.getElementById('wizard-guardian-autoupdate');
  if (autoUpdateCheckbox) {
    autoUpdateCheckbox.checked = wizardState.guardianAutoUpdate;
    autoUpdateCheckbox.onchange = () => {
      wizardState.guardianAutoUpdate = autoUpdateCheckbox.checked;
      renderCertificatePreviewSummary('preview');
    };
  }

  // Hide validation error on init
  const valErr = document.getElementById('wizard-guardian-validation-error');
  if (valErr) valErr.style.display = 'none';

  // Custom model path toggle
  const customInput = document.getElementById('wizard-guardian-custom-path');
  if (customInput) {
    customInput.oninput = () => {
      if (customInput.value.trim()) {
        wizardState.guardianModel = customInput.value.trim();
        const modelSelect = document.getElementById('wizard-guardian-model');
        if (modelSelect) modelSelect.value = '';
        const valErr2 = document.getElementById('wizard-guardian-validation-error');
        if (valErr2) valErr2.style.display = 'none';
        renderCertificatePreviewSummary('preview');
      }
    };
  }

  console.debug('[wizard][trace] initProviderGuardianStep — complete');
}

renderCertificatePreviewSummary('preview');
/**
 * Classifies a model's VRAM fit for the current hardware.
 * Returns { label, class } for display in the dropdown.
 *
 * Hardware profile: GeForce GTX 1050 Ti — 4 GB VRAM, 16 GB system RAM, SSD.
 * Categories:
 *   - "Ideal"    ≤ 2.0 GB  — runs fully in VRAM, room for OS overhead
 *   - "Good"     ≤ 3.0 GB  — fits with some VRAM pressure
 *   - "Tight"    ≤ 4.0 GB  — barely fits, may use system RAM fallback
 *   - "Too Large" > 4.0 GB — does not fit in VRAM
 */
function classifyVramFit(sizeStr) {
  const match = (sizeStr || '').match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return { label: '', cls: '' };
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const gb = unit === 'MB' ? val / 1024 : val;

  if (gb <= 2.0) return { label: '✅ Ideal for 4GB VRAM', cls: 'vram-ideal' };
  if (gb <= 3.0) return { label: '✅ Good fit', cls: 'vram-good' };
  if (gb <= 4.0) return { label: '⚠️ Tight fit', cls: 'vram-tight' };
  return { label: '❌ Too large for 4GB VRAM', cls: 'vram-over' };
}

function populateGuardianModelDropdown() {
  const modelSelect = document.getElementById('wizard-guardian-model');
  const downloadBtn = document.getElementById('wizard-guardian-download-btn');
  if (!modelSelect) return;

  console.debug('[wizard][trace] populateGuardianModelDropdown — begin');
  console.debug(`[wizard][trace]   availableModels count: ${wizardState.availableModels.length}`);
  console.debug(`[wizard][trace]   recommendedCatalog count: ${guardianRecommendedCatalog.length}`);

  // Build a set of locally available model file names for dedup
  const localFileNames = new Set();
  for (const m of wizardState.availableModels) {
    const fname = (m.name || m.path || '').split(/[\\/]/).pop().toLowerCase();
    localFileNames.add(fname);
    console.debug(`[wizard][trace]   local model: ${fname}`);
  }

  let html = '<option value="">— Select a Guardian model —</option>';

  // Group 1: Locally available models
  if (wizardState.availableModels.length > 0) {
    html += '<optgroup label="\u2705 Downloaded Models (Ready to Use)">';
    for (const m of wizardState.availableModels) {
      html += `<option value="${escHtml(m.path)}">${escHtml(m.name)}</option>`;
    }
    html += '</optgroup>';
    if (!wizardState.guardianModel) {
      wizardState.guardianModel = wizardState.availableModels[0].path;
    }
    console.debug(`[wizard][trace]   Group 1 (Downloaded): ${wizardState.availableModels.length} models`);
  }

  // Group 2: Recommended models not yet downloaded — sorted by VRAM suitability
  const notDownloaded = guardianRecommendedCatalog.filter(rm => {
    const fname = (rm.fileName || '').toLowerCase();
    return !localFileNames.has(fname);
  });

  // Sort: ideal VRAM fit first, then good, then tight, then too large
  const vramOrder = { 'vram-ideal': 0, 'vram-good': 1, 'vram-tight': 2, 'vram-over': 3 };
  notDownloaded.sort((a, b) => {
    const fitA = classifyVramFit(a.size);
    const fitB = classifyVramFit(b.size);
    return (vramOrder[fitA.cls] ?? 9) - (vramOrder[fitB.cls] ?? 9);
  });

  if (notDownloaded.length > 0) {
    html += '<optgroup label="\u{1F4E5} Recommended (Download Required) — Sorted by 4GB VRAM fit">';
    for (const rm of notDownloaded) {
      const fit = classifyVramFit(rm.size);
      const fitTag = fit.label ? ` [${fit.label}]` : '';
      html += `<option value="recommend:${escHtml(rm.fileName)}" data-url="${escHtml(rm.url)}" data-mmproj-url="${escHtml(rm.mmprojUrl || '')}" data-mmproj-name="${escHtml(rm.mmprojName || '')}">[${escHtml(rm.size)}] ${escHtml(rm.name)}${fitTag}</option>`;
    }
    html += '</optgroup>';
    console.debug(`[wizard][trace]   Group 2 (Recommended download): ${notDownloaded.length} models`);
  }

  // Group 3: Custom model path (user-supplied local GGUF)
  html += '<optgroup label="\u{1F527} Custom">';
  html += '<option value="custom">Enter custom model path...</option>';
  html += '</optgroup>';
  console.debug('[wizard][trace]   Group 3 (Custom) added');

  modelSelect.innerHTML = html;
  if (wizardState.guardianModel && wizardState.guardianModel !== 'custom') {
    modelSelect.value = wizardState.guardianModel;
  }

  modelSelect.onchange = () => {
    const val = modelSelect.value;
    console.debug(`[wizard][trace] Guardian model selected: ${val}`);

    const customPathContainer = document.getElementById('wizard-guardian-custom-container');
    if (val === 'custom') {
      // Show custom path input
      if (customPathContainer) customPathContainer.style.display = '';
      const customInput = document.getElementById('wizard-guardian-custom-path');
      if (customInput && customInput.value.trim()) {
        wizardState.guardianModel = customInput.value.trim();
      } else {
        wizardState.guardianModel = '';
      }
    } else {
      if (customPathContainer) customPathContainer.style.display = 'none';
      wizardState.guardianModel = val;
    }

    updateGuardianDownloadButton();
    renderCertificatePreviewSummary('preview');
    // Clear validation error when user selects
    const valErr = document.getElementById('wizard-guardian-validation-error');
    if (valErr) valErr.style.display = 'none';
  };

  updateGuardianDownloadButton();
  renderCertificatePreviewSummary('preview');
  console.debug('[wizard][trace] populateGuardianModelDropdown — complete');
}

function updateGuardianDownloadButton() {
  const downloadBtn = document.getElementById('wizard-guardian-download-btn');
  if (!downloadBtn) return;
  const isRecommended = wizardState.guardianModel && wizardState.guardianModel.startsWith('recommend:');
  downloadBtn.style.display = isRecommended ? '' : 'none';
}

function formatDownloadDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDownloadRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 'calculating…';
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function buildGuardianTransferSummary(dl) {
  const downloaded = Number(dl.downloadedBytes || 0);
  const total = Number(dl.totalBytes || 0);
  const mb = (downloaded / (1024 * 1024)).toFixed(1);
  const totalMb = total > 0 ? `${(total / (1024 * 1024)).toFixed(1)} MB` : '?';

  const startedAt = Date.parse(dl.startTime || '');
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(1, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const bytesPerSecond = elapsedSeconds > 0 ? downloaded / elapsedSeconds : 0;

  const etaSeconds = total > downloaded && bytesPerSecond > 0
    ? Math.max(0, Math.floor((total - downloaded) / bytesPerSecond))
    : 0;
  const etaText = total > downloaded && bytesPerSecond > 0 ? formatDownloadDuration(etaSeconds) : '--:--';
  const elapsedText = elapsedSeconds > 0 ? formatDownloadDuration(elapsedSeconds) : '--:--';

  return `Downloading: ${mb} MB / ${totalMb} • ${formatDownloadRate(bytesPerSecond)} • ETA ${etaText} • Elapsed ${elapsedText}`;
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
        if (statusEl) statusEl.textContent = buildGuardianTransferSummary(dl);
      }

      if (dl.status === 'pending') {
        if (statusEl) {
          const startedAt = Date.parse(dl.startTime || '');
          const elapsedSeconds = Number.isFinite(startedAt)
            ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
            : 0;
          const elapsedText = elapsedSeconds > 0 ? formatDownloadDuration(elapsedSeconds) : '--:--';
          statusEl.textContent = `Reconnecting… ${dl.error || 'Waiting for next transfer attempt'} • Elapsed ${elapsedText}`;
        }
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
  renderCertificatePreviewSummary('preview');
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
      renderCertificatePreviewSummary('preview');
    };
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
    let launchReady = false;
    if (launchErr) {
      launchErr.style.display = 'none';
      launchErr.textContent = '';
      launchErr.style.background = '';
      launchErr.style.border = '';
      launchErr.style.padding = '';
      launchErr.style.borderRadius = '';
      launchErr.style.color = '';
    }

    try {
      let setupToken = '';
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
      renderCertificatePreviewSummary('creating');
      const certificate = buildInitializationCertificatePayload();

      const certResult = await api('POST', '/api/setup/initialization-session', { certificate });
      if (!certResult || !certResult.sessionId) {
        throw new Error("Failed to create system initialization certificate.");
      }
      wizardState.certificateResult = certResult;
      setupToken = certResult.setupToken || '';
      showToast("Certificate generated.", "success");
      renderCertificatePreviewSummary('created', certResult);
      await delay(500);

      // 5. Complete setup
      showToast("Completing setup and launching PRISM...", "info");
      const completeResult = await api('POST', '/api/setup/complete');
      showToast("Setup complete! Continue to Operator Login.", "success");
      await delay(500);

      const params = new URLSearchParams();
      if (completeResult.token) params.set('token', completeResult.token);
      if (setupToken) params.set('setupToken', setupToken);
      const url = params.toString() ? `/dashboard?${params.toString()}` : '/dashboard';

      nextBtn.textContent = 'Operator Login';
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        window.location.href = url;
      };
      launchReady = true;
      return;
    } catch (err) {
      renderCertificatePreviewSummary('error');
      if (launchErr) {
        launchErr.textContent = `Launch failed: ${err.message || String(err)}`;
        launchErr.style.display = 'block';
      }
    } finally {
      if (!launchReady) {
        nextBtn.disabled = false;
        nextBtn.textContent = 'Continue';
      }
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
