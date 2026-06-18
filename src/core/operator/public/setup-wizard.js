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
  characterId: '',
  operatorEmail: '',
  assistantEmail: '',
  importCharacterPreview: null,
  guardianModel: '',
  guardianTier: '',
  guardianAutoStart: true,
  availableModels: [],
  cacAssignmentId: null,
};
let providerCatalog = null;

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
  if (nextBtn) nextBtn.textContent = n === TOTAL_STEPS ? 'Launch PRISM' : 'Continue';
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

const PROVIDERS_NEEDING_KEY = ['custom', 'openai', 'anthropic', 'google', 'mistral', 'cohere', 'groq', 'together', 'deepseek', 'perplexity', 'fireworks', 'openrouter'];

async function initProviderGuardianStep() {
  await loadProviderCatalog();
  updateProviderKeyField();

  // Load GGUF models for guardian
  try {
    const data = await api('GET', '/api/models/gguf');
    wizardState.availableModels = data.models || data || [];
  } catch { wizardState.availableModels = []; }

  const modelSelect = document.getElementById('wizard-guardian-model');
  if (modelSelect) {
    let html = '<option value="">None (skip guardian)</option>';
    for (const m of wizardState.availableModels) {
      html += `<option value="${escHtml(m.path)}">${escHtml(m.name)}</option>`;
    }
    modelSelect.innerHTML = html;
    if (wizardState.guardianModel) modelSelect.value = wizardState.guardianModel;
    modelSelect.onchange = () => { wizardState.guardianModel = modelSelect.value; };
  }

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
}

window.selectProvider = function selectProvider(el, value) {
  wizardState.provider = value;
  document.querySelectorAll('#step-5 .wizard-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  updateProviderKeyField();
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

  const keyInput = document.getElementById('provider-api-key');
  if (keyInput) {
    keyInput.value = wizardState.apiKey = '';
    keyInput.oninput = () => { wizardState.apiKey = keyInput.value; };
  }
}

window.testProviderConnection = async function testProviderConnection() {
  const testResult = document.getElementById('provider-test-result');
  if (!testResult) return false;
  testResult.innerHTML = '<span style="color:var(--muted);">Testing connection...</span>';
  try {
    const data = await api('POST', '/api/llm/provider-test', {
      providerId: wizardState.provider,
      apiKey: wizardState.apiKey || undefined,
    });
    if (data.ok || data.reachable) {
      testResult.innerHTML = '<span style="color:var(--accent-2);">✓ Provider is reachable.</span>';
      return true;
    }
    testResult.innerHTML = `<span style="color:var(--danger);">✗ ${escHtml(data.error || data.reason || 'Could not reach provider.')}</span>`;
    return false;
  } catch {
    testResult.innerHTML = '<span style="color:var(--danger);">✗ Connection test failed.</span>';
    return false;
  }
};

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
      nextBtn.textContent = currentStep === TOTAL_STEPS ? 'Launch PRISM' : 'Continue';
    }
  } else {
    // Step 5: Final launch step
    nextBtn.disabled = true;
    nextBtn.textContent = 'Launching...';

    const launchErr = document.getElementById('wizard-launch-error');
    if (launchErr) {
      launchErr.style.display = 'none';
      launchErr.textContent = '';
    }

    try {
      showToast("Testing provider connection...", "info");
      // 1. Run provider connection test and block if it fails
      const reachable = await testProviderConnection();
      if (!reachable) {
        showToast("LLM provider connection test failed.", "error");
        if (launchErr) {
          launchErr.textContent = 'LLM provider connection test failed. Please verify provider reachability and key before launching.';
          launchErr.style.display = 'block';
        }
        return;
      }
      showToast("Connection verified successfully!", "success");
      await delay(500);

      // 2. Save LLM secrets
      const providerMeta = providerCatalog?.find((p) => p.id === wizardState.provider);
      const needsKey = providerMeta?.requiresApiKey ?? PROVIDERS_NEEDING_KEY.includes(wizardState.provider);
      if (wizardState.apiKey && needsKey) {
        showToast("Saving API key to secrets...", "info");
        await api('POST', '/api/llm/provider-secret', {
          providerId: wizardState.provider,
          apiKey: wizardState.apiKey,
        });
        showToast("API key saved.", "success");
        await delay(500);
      }

      showToast("Saving provider settings...", "info");
      let testModels = [];
      try {
        const testRes = await api('POST', '/api/llm/provider-test', {
          providerId: wizardState.provider,
          apiKey: wizardState.apiKey || undefined,
        });
        if (testRes.models) {
          testModels = testRes.models;
        }
      } catch { /* ignore */ }

      const defaultModel = testModels[0] || null;
      await api('POST', '/api/llm/provider-settings', {
        providerId: wizardState.provider,
        models: testModels,
        defaultModel: defaultModel,
      });

      showToast("Applying model to system...", "info");
      await api('POST', '/api/llm/select', {
        providerId: wizardState.provider,
        model: defaultModel,
      });
      showToast("Model applied to system as ready.", "success");
      await delay(500);

      // 3. Save Guardian config
      if (wizardState.guardianModel) {
        showToast("Configuring Guardian Agent...", "info");
        await api('POST', '/api/guardian/configure', {
          modelPath: wizardState.guardianModel,
          authorityTier: wizardState.guardianTier,
          autoStart: wizardState.guardianAutoStart,
        });
        showToast("Guardian Agent configured.", "success");
        await delay(500);
      }

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
          model: wizardState.guardianModel || 'not configured',
          authorityTier: wizardState.guardianTier || (wizardState.profile === 'business' ? 'tier2_conditional' : 'tier1_autonomous'),
          autoStart: !!wizardState.guardianAutoStart,
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
      nextBtn.textContent = 'Launch PRISM';
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
