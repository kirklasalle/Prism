import { state, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, timeAgo, renderStars, approvalBadge, safeRenderStep, dashboardLog, togglePanelCollapse, formatUptime, toCsvValue } from './dashboard-core.js';

var PROVIDER_META = {
  openai: { icon: '\u{1F916}', desc: 'OpenAI \u2014 GPT-4o, GPT-4, GPT-3.5 and more.' },
  anthropic: { icon: '\u2728', desc: 'Anthropic \u2014 Claude models.' },
  ollama: { icon: '\u{1F5A5}', desc: 'Ollama \u2014 Run open-source models locally.' },
  custom: { icon: '\u{1F527}', desc: 'Custom \u2014 Any OpenAI-compatible endpoint.' },
  google: { icon: '\u{1F50D}', desc: 'Google AI \u2014 Gemini models.' },
  mistral: { icon: '\u{1F30A}', desc: 'Mistral AI \u2014 Mistral & Codestral models.' },
  cohere: { icon: '\u{1F9EC}', desc: 'Cohere \u2014 Command and Embed models.' },
  groq: { icon: '\u26A1', desc: 'Groq \u2014 Ultra-fast inference.' },
  together: { icon: '\u{1F91D}', desc: 'Together AI \u2014 Open models hosted in the cloud.' },
  deepseek: { icon: '\u{1F433}', desc: 'DeepSeek \u2014 DeepSeek reasoning models.' },
  perplexity: { icon: '\u{1F50E}', desc: 'Perplexity \u2014 Search-augmented models.' },
  fireworks: { icon: '\u{1F386}', desc: 'Fireworks AI \u2014 Fast open-model hosting.' },
  openrouter: { icon: '\u{1F310}', desc: 'OpenRouter \u2014 Access hundreds of models via one API.' },
  lmstudio: { icon: '\u{1F4BB}', desc: 'LM Studio \u2014 Run models locally via LM Studio.' }
};

var STRENGTH_COLORS = {
  'code': '#4dabf7',
  'coding': '#4dabf7',
  'chat': '#7cf1c8',
  'reasoning': '#ffd43b',
  'math': '#ffa94d',
  'instruction-following': '#a78bfa',
  'multilingual': '#f06595',
  'vision': '#a78bfa',
  'image': '#a78bfa',
  'long-context': '#63b3ed',
  'summarization': '#94d82d',
  'classification': '#ffd43b',
  'embedding': '#74c0fc',
  'tool-use': '#ff8787',
  'function-calling': '#ff8787',
  'search': '#66d9e8',
  'creative': '#f5cf6c',
  'analysis': '#69db7c'
};

export
  function renderRoutingStrategyControls(providers, currentModel) {
  var html = '';
  var strategy = state.sessionRoutingStrategy || 'direct';

  // ── Routing Strategy Section ──
  html += '<div style="margin-top:12px;padding:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(148,163,184,0.12);border-radius:8px;">';
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
  html += '<span style="font-size:13px;font-weight:600;color:var(--fg);">\u{1F9ED} Routing Strategy</span>';
  html += '</div>';

  // Strategy radio buttons
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
  var strategies = [
    { id: 'direct', label: '\u{1F3AF} Direct', desc: 'Use selected model' },
    { id: 'role', label: '\u{1F465} Role-Based', desc: 'Route by task role' },
    { id: 'modality', label: '\u{1F9E0} Modality-Based', desc: 'Route by content type' }
  ];
  strategies.forEach(function (s) {
    var selected = strategy === s.id;
    html += '<button onclick="setSessionRoutingStrategy(&#39;' + s.id + '&#39;)" style="'
      + 'padding:6px 12px;border-radius:8px;font-size:11px;cursor:pointer;border:1px solid '
      + (selected ? 'rgba(99,179,237,0.5)' : 'rgba(148,163,184,0.15)') + ';'
      + 'background:' + (selected ? 'rgba(99,179,237,0.12)' : 'rgba(255,255,255,0.03)') + ';'
      + 'color:' + (selected ? '#63b3ed' : 'var(--fg-muted)') + ';'
      + 'font-weight:' + (selected ? '600' : '400') + ';'
      + 'transition:all 0.15s ease;">'
      + s.label
      + '</button>';
  });
  html += '</div>';

  // Strategy description
  if (strategy === 'direct') {
    html += '<div class="muted" style="font-size:11px;padding:4px 0;">Requests go directly to the selected provider and model above.</div>';
  } else if (strategy === 'role') {
    html += '<div class="muted" style="font-size:11px;padding:4px 0;">Requests are routed by task role (chat, code, classification, etc.). Configure in the <strong>Model Routing</strong> panel below.</div>';
  } else if (strategy === 'modality') {
    // ── Modality Pills ──
    html += '<div class="muted" style="font-size:11px;padding:4px 0;margin-bottom:6px;">Select a content modality to auto-route to the best matching model.</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';

    var modalities = state.availableModalities || [];
    if (modalities.length === 0) {
      // Fallback if modality data hasn't loaded yet
      modalities = [
        { id: 'text', label: 'Text', icon: '\u{1F4DD}', modelCount: 0 },
        { id: 'code', label: 'Code & Programming', icon: '\u{1F4BB}', modelCount: 0 },
        { id: 'image-understanding', label: 'Image Understanding', icon: '\u{1F5BC}', modelCount: 0 },
        { id: 'image-generation', label: 'Image Generation', icon: '\u{1F3A8}', modelCount: 0 },
        { id: 'video-understanding', label: 'Video Understanding', icon: '\u{1F3AC}', modelCount: 0 },
        { id: 'video-generation', label: 'Video Generation', icon: '\u{1F3A5}', modelCount: 0 },
        { id: 'voice-input', label: 'Voice Input', icon: '\u{1F3A4}', modelCount: 0 },
        { id: 'voice-output', label: 'Voice Output', icon: '\u{1F50A}', modelCount: 0 },
        { id: 'tts', label: 'Text-to-Speech', icon: '\u{1F5E3}', modelCount: 0 },
        { id: 'stt', label: 'Speech-to-Text', icon: '\u{1F4AC}', modelCount: 0 },
        { id: 'realtime', label: 'Realtime', icon: '\u26A1', modelCount: 0 },
        { id: 'embedding', label: 'Embedding', icon: '\u{1F9E9}', modelCount: 0 },
        { id: 'multimodal-reasoning', label: 'Multimodal Reasoning', icon: '\u{1F9E0}', modelCount: 0 }
      ];
    }

    modalities.forEach(function (m) {
      var isSelected = state.selectedModalityFilter === m.id;
      var hasModels = m.modelCount > 0;
      html += '<button onclick="onModalitySelected(&#39;' + escapeHtml(m.id) + '&#39;)" '
        + 'title="' + escapeHtml(m.label + (m.description ? ': ' + m.description : '') + ' (' + m.modelCount + ' models)') + '" '
        + 'style="'
        + 'display:inline-flex;align-items:center;gap:4px;'
        + 'padding:4px 10px;border-radius:16px;font-size:10px;cursor:pointer;'
        + 'border:1px solid ' + (isSelected ? 'rgba(99,179,237,0.6)' : hasModels ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.08)') + ';'
        + 'background:' + (isSelected ? 'rgba(99,179,237,0.15)' : 'rgba(255,255,255,0.02)') + ';'
        + 'color:' + (isSelected ? '#63b3ed' : hasModels ? 'var(--fg-muted)' : 'rgba(148,163,184,0.4)') + ';'
        + 'font-weight:' + (isSelected ? '600' : '400') + ';'
        + 'transition:all 0.15s ease;">'
        + '<span style="font-size:13px;">' + m.icon + '</span>'
        + '<span>' + escapeHtml(m.label) + '</span>'
        + (m.modelCount > 0 ? '<span style="font-size:9px;opacity:0.6;">(' + m.modelCount + ')</span>' : '')
        + '</button>';
    });
    html += '</div>';

    // ── Selected modality details ──
    if (state.selectedModalityFilter) {
      var selectedMod = modalities.find(function (m) { return m.id === state.selectedModalityFilter; });
      var suggestion = (state.routingModalitySuggestions || {})[state.selectedModalityFilter];
      var override = (state.routingModalityOverrides || {})[state.selectedModalityFilter];

      html += '<div style="padding:8px;background:rgba(99,179,237,0.05);border:1px solid rgba(99,179,237,0.15);border-radius:8px;margin-bottom:8px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
      html += '<span style="font-size:15px;">' + (selectedMod ? selectedMod.icon : '') + '</span>';
      html += '<span style="font-size:12px;font-weight:600;color:#63b3ed;">' + escapeHtml(selectedMod ? selectedMod.label : state.selectedModalityFilter) + '</span>';
      html += '</div>';

      if (suggestion) {
        var tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };
        var sColor = tierColors[suggestion.tier] || '#aaa';
        html += '<div style="font-size:11px;margin-bottom:6px;">';
        html += '<span class="muted">AI Suggested: </span>';
        html += '<span class="mono" style="font-size:11px;">' + escapeHtml(suggestion.providerId + '/' + suggestion.model) + '</span>';
        html += ' <span style="color:' + sColor + ';font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:' + sColor + '18;">T' + suggestion.tier + '</span>';
        if (suggestion.degraded) html += ' <span style="color:#ffd43b;font-size:10px;">\u26A0 Partial</span>';
        html += '</div>';
      }

      // Modality override dropdown
      var _rscProviders = providers || (state.llmCatalog && state.llmCatalog.providers) || [];
      var filteredModels = getModelsForModalityFilter(state.selectedModalityFilter, _rscProviders) || [];
      if (filteredModels.length > 0) {
        var overrideVal = override ? (override.providerId + '/' + override.model) : 'auto';
        html += '<div style="display:flex;align-items:center;gap:6px;">';
        html += '<span class="muted" style="font-size:11px;">Override:</span>';
        html += '<select onchange="setModalityOverride(&#39;' + escapeHtml(state.selectedModalityFilter) + '&#39;, this.value)" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);flex:1;max-width:280px;">';
        html += '<option value="auto"' + (!override ? ' selected' : '') + '>Auto (AI Suggested)</option>';
        filteredModels.forEach(function (fm) {
          var val = fm.providerId + '/' + fm.model;
          html += '<option value="' + escapeHtml(val) + '"' + (overrideVal === val ? ' selected' : '') + '>' + escapeHtml(fm.label) + '</option>';
        });
        html += '</select>';
        html += '</div>';
      } else {
        html += '<div class="muted" style="font-size:11px;color:#ffa94d;">No models available for this modality.</div>';
      }

      html += '</div>';

      // Filter toggle
      html += '<div style="display:flex;align-items:center;gap:6px;">';
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--fg-muted);">';
      html += '<input type="checkbox" ' + (state.modalityFilterEnabled ? 'checked' : '') + ' onchange="onModalityFilterToggle()" />';
      html += 'Filter Model dropdown to ' + escapeHtml(selectedMod ? selectedMod.label : '') + ' models only';
      html += '</label>';
      html += '</div>';
    }
  }

  html += '</div>';
  return html;
}

export
  function renderLlm() {
  const container = document.getElementById('llm-provider');
  if (!state.llmCatalog) {
    container.innerHTML = '<div class="muted">Loading providers...</div>';
    return;
  }

  const providers = state.llmCatalog.providers || [];
  if (!providers.length) {
    container.innerHTML = '<div class="muted">No providers configured.</div>';
    return;
  }

  const activeProviderId = state.llmCatalog.activeProviderId || '';
  const activeProvider = providers.find(provider => provider.id === activeProviderId) || null;
  const activeModel = state.llmCatalog.activeModel || '';
  const draft = state.llmConfig ? state.llmConfig.draft : null;
  const draftProviderId = draft && draft.providerId ? draft.providerId : activeProviderId;
  const draftProvider = providers.find(provider => provider.id === draftProviderId) || activeProvider;
  const currentModel = (state.llmConfig && state.llmConfig.current ? state.llmConfig.current.model : activeModel) || '';
  const draftModel = draft && draft.model ? draft.model : currentModel;
  const localSelection = getLocalLlmSelection(state.selectedSessionId);
  const displayProviderId = localSelection && localSelection.providerId ? localSelection.providerId : draftProviderId;
  const displayProvider = providers.find(provider => provider.id === displayProviderId) || draftProvider;
  const displayModels = displayProvider ? (displayProvider.models || []) : [];
  let displayModel = localSelection && localSelection.model ? localSelection.model : draftModel;
  if ((!displayModel || !displayModels.includes(displayModel)) && displayModels.length > 0) {
    displayModel = (displayProvider && displayProvider.defaultModel && displayModels.includes(displayProvider.defaultModel))
      ? displayProvider.defaultModel
      : displayModels[0];
  }

  const hasUnsavedLocalSelection = Boolean(localSelection)
    && (localSelection.providerId !== draftProviderId || (localSelection.model || '') !== (draftModel || ''));

  const providerOptions = providers.map(provider =>
    '<option value="' + escapeHtml(provider.id) + '" ' + (provider.id === displayProviderId ? 'selected' : '') + '>'
    + escapeHtml(provider.label + (provider.enabled ? '' : ' (unavailable)'))
    + '</option>'
  ).join('');

  const modelOptions = displayModels.length > 0
    ? displayModels.map(model =>
      '<option value="' + escapeHtml(model) + '" ' + (model === displayModel ? 'selected' : '') + '>' + escapeHtml(model) + '</option>'
    ).join('')
    : '<option value="">No models available</option>';

  const reason = displayProvider && !displayProvider.enabled && displayProvider.reason
    ? '<div class="muted" style="margin-top:8px;color:#ffc1c1;">' + escapeHtml(displayProvider.reason) + '</div>'
    : '';

  const localSelectionBanner = hasUnsavedLocalSelection
    ? '<div class="action-card" style="margin-top:10px;">'
    + '<div class="muted">You changed provider/model locally. Click <strong>Save Draft</strong> then <strong>Apply Draft</strong> to persist for this session.</div>'
    + '<div class="mono" style="margin-top:6px;">Pending: '
    + escapeHtml((displayProviderId || '-') + ' / ' + (displayModel || '-'))
    + '</div>'
    + '</div>'
    : '';

  const diff = state.llmConfig && state.llmConfig.diff
    ? state.llmConfig.diff
    : null;
  const diffHtml = diff && diff.changedFields && diff.changedFields.length > 0
    ? '<div class="action-card" style="margin-top:10px;">'
    + '<div class="muted">Draft changes: ' + escapeHtml(diff.changedFields.join(', ')) + '</div>'
    + '<div class="mono" style="margin-top:6px;">Current: ' + escapeHtml((diff.before.providerId || '-') + ' / ' + (diff.before.model || '-')) + '</div>'
    + '<div class="mono">Draft: ' + escapeHtml((diff.after.providerId || '-') + ' / ' + (diff.after.model || '-')) + '</div>'
    + '</div>'
    : '<div class="muted" style="margin-top:8px;">No pending draft changes.</div>';

  const history = state.llmConfig && state.llmConfig.history ? state.llmConfig.history : [];
  const historyHtml = history.length > 0
    ? '<div class="muted" style="margin-top:10px;">Recent applied config</div>'
    + '<table class="events-table"><thead><tr><th>Time</th><th>Change</th><th>Source</th></tr></thead><tbody>'
    + history.slice(0, 5).map(entry => '<tr>'
      + '<td>' + escapeHtml(formatRelativeTime(entry.appliedAt)) + '</td>'
      + '<td><div class="mono">'
      + escapeHtml((entry.previousProviderId || '-') + ' / ' + (entry.previousModel || '-'))
      + ' → '
      + escapeHtml((entry.nextProviderId || '-') + ' / ' + (entry.nextModel || '-'))
      + '</div></td>'
      + '<td>' + escapeHtml(entry.source || '-') + '</td>'
      + '</tr>').join('')
    + '</tbody></table>'
    : '<div class="muted" style="margin-top:10px;">No config history yet.</div>';

  const isLocal = displayProvider && displayProvider.kind === 'local';
  const bindReq = state.readiness && state.readiness.requirements
    ? state.readiness.requirements.find(function (r) { return r.id === 'llm.provider-model-bound' || r.id === 'provider-model-selected'; })
    : null;
  const sessionNeedsBind = bindReq ? !bindReq.passed : false;
  const needsApply = hasUnsavedLocalSelection || (sessionNeedsBind && Boolean(displayProviderId));

  // When rendering dynamically from onLlmProviderChanged we shouldn't block 
  // rendering just because a select is focused, otherwise the model dropdown
  // won't update when you pick a new provider.

  container.innerHTML = ''
    + '<label class="muted" for="provider-select">Provider</label>'
    + '<select id="provider-select" class="control-select" onchange="onLlmProviderChanged()">' + providerOptions + '</select>'
    + '<label class="muted" for="model-select" style="margin-top:8px;display:block;">Model</label>'
    + '<select id="model-select" class="control-select" onchange="onLlmModelChanged()">' + modelOptions + '</select>'
    + '<div class="action-buttons" style="margin-top:10px;">'
    + '<button class="primary-button" ' + (!needsApply ? 'disabled' : '') + ' onclick="quickApplyLlm()">Apply</button>'
    + (isLocal ? '<button class="secondary-button" onclick="refreshOllamaModels()">Refresh Models</button>' : '')
    + '<button class="secondary-button" ' + (!history.length ? 'disabled' : '') + ' onclick="rollbackLlmConfig()">Rollback</button>'
    + '</div>'
    + (needsApply
      ? '<div class="action-card" style="margin-top:10px;"><div class="muted">Pending: <span class="mono">' + escapeHtml((displayProviderId || '-') + ' / ' + (displayModel || '-')) + '</span> — click <strong>Apply</strong> to save.</div></div>'
      : '<div class="muted" style="margin-top:8px;">Active: <span class="mono">' + escapeHtml((draftProviderId || '-') + ' / ' + (draftModel || '-')) + '</span></div>')
    + historyHtml
    + reason;
}

export
  async function onHeaderProviderChanged(providerId) {
  if (!providerId || !state.selectedSessionId || !state.llmCatalog) return;
  const provider = state.llmCatalog.providers.find(entry => entry.id === providerId);
  const model = provider?.defaultModel || provider?.models[0] || '';
  try {
    state.llmCatalog = await request('/api/llm/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: providerId, model })
    });
    clearLocalLlmSelection(state.selectedSessionId);
    safeRenderStep('header', renderHeader);
    safeRenderStep('llm', renderLlm);
    await fetchReadinessAndRefresh();
    state.notice = 'Provider switched to ' + providerId + ' / ' + (model || 'default') + '.';
    safeRenderStep('notice', renderNotice);
  } catch (err) {
    console.error(err);
    state.notice = { type: 'error', message: 'Failed to switch provider: ' + String(err) };
    safeRenderStep('notice', renderNotice);
  }
}

export
  async function onHeaderModelChanged(model) {
  if (!model || !state.selectedSessionId || !state.llmCatalog) return;
  try {
    state.llmCatalog = await request('/api/llm/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: state.llmCatalog.activeProviderId, model })
    });
    clearLocalLlmSelection(state.selectedSessionId);
    safeRenderStep('header', renderHeader);
    safeRenderStep('llm', renderLlm);
    await fetchReadinessAndRefresh();
    state.notice = 'Model switched to ' + model + '.';
    safeRenderStep('notice', renderNotice);
  } catch (err) {
    console.error(err);
    state.notice = { type: 'error', message: 'Failed to switch model: ' + String(err) };
    safeRenderStep('notice', renderNotice);
  }
}

export
  function renderHeader() {
  const activeSession = state.sessions.find(session => session.sessionId === state.selectedSessionId);
  document.getElementById('active-session-title').textContent = activeSession ? activeSession.title : 'PRISM Chat';
  document.getElementById('active-session-meta').textContent = activeSession
    ? 'Updated ' + formatRelativeTime(activeSession.updatedAt) + ' • ' + activeSession.messageCount + ' messages'
    : 'Persistent runtime session';

  const chips = [];
  if (state.status) {
    chips.push('<span class="chip">Mode: ' + escapeHtml(state.status.mode) + '</span>');
    chips.push('<span class="chip">Environment: ' + escapeHtml(state.status.environmentProfile) + '</span>');
    chips.push('<span class="chip">Pending approvals: ' + escapeHtml(String(state.status.pendingApprovals)) + '</span>');
    chips.push('<span class="chip">Sessions: ' + escapeHtml(String(state.status.chatSessionCount)) + '</span>');
  }
  if (state.llmCatalog && state.llmCatalog.activeProviderId) {
    let isError = false;
    let isReady = state.readiness && state.readiness.ready;
    const messagesArr = state.messages || [];
    const lastError = messagesArr.slice().reverse().find(m => m.metadata && m.metadata.intent === 'llm_error');
    if (lastError && (Date.now() - new Date(lastError.createdAt).getTime() < 300000)) {
      isError = true;
    }

    let hueStyle = '';
    if (isError) {
      hueStyle = 'color: #ff8d8d; border-color: rgba(255, 141, 141, 0.4); background: rgba(255, 141, 141, 0.1);';
    } else if (isReady) {
      hueStyle = 'color: #7cf1c8; border-color: rgba(124, 241, 200, 0.4); background: rgba(124, 241, 200, 0.1);';
    } else {
      hueStyle = 'color: #f5cf6c; border-color: rgba(245, 207, 108, 0.4); background: rgba(245, 207, 108, 0.1);';
    }

    const selectBaseStyle = 'appearance: none; -moz-appearance: none; -webkit-appearance: none; outline: none; border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer; transition: all 0.2s ease; border-style: solid; border-width: 1px;';
    const optionStyle = ' style="background: #1e293b; color: #edf3ff;"';

    const providers = state.llmCatalog.providers || [];
    if (providers.length > 0) {
      let pSelect = '<select style="' + selectBaseStyle + hueStyle + '" onchange="onHeaderProviderChanged(this.value)" title="Fast switch provider">';
      providers.forEach(p => {
        const sel = p.id === state.llmCatalog.activeProviderId ? ' selected' : '';
        pSelect += '<option value="' + escapeHtml(p.id) + '"' + sel + optionStyle + '>Provider: ' + escapeHtml(p.id) + '</option>';
      });
      pSelect += '</select>';
      chips.push(pSelect);

      const activeP = providers.find(p => p.id === state.llmCatalog.activeProviderId);
      if (activeP && activeP.models && activeP.models.length > 0) {
        let mSelect = '<select style="' + selectBaseStyle + hueStyle + '" onchange="onHeaderModelChanged(this.value)" title="Fast switch model">';
        activeP.models.forEach(m => {
          const sel = m === state.llmCatalog.activeModel ? ' selected' : '';
          mSelect += '<option value="' + escapeHtml(m) + '"' + sel + optionStyle + '>Model: ' + escapeHtml(m) + '</option>';
        });
        mSelect += '</select>';
        chips.push(mSelect);
      }
    } else {
      chips.push('<span class="chip" style="' + hueStyle + '">Provider: ' + escapeHtml(state.llmCatalog.activeProviderId) + '</span>');
      chips.push('<span class="chip" style="' + hueStyle + '">Model: ' + escapeHtml(state.llmCatalog.activeModel || '-') + '</span>');
    }
  }
  document.getElementById('header-chips').innerHTML = chips.join('');
}

export
  async function fetchReadinessAndRefresh() {
  try {
    const readiness = await request('/api/readiness/recheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId || '' })
    });
    state.readiness = readiness;
    safeRenderStep('onboarding', renderOnboarding);
    safeRenderStep('header', renderHeader);
  } catch (err) {
    state.notice = { type: 'error', message: String(err) };
    safeRenderStep('notice', renderNotice);
  }
}

export
  function toggleCapabilityMatrix() {
  state.capabilityMatrixExpanded = !state.capabilityMatrixExpanded;
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
}

export
  function setMatrixSort(col) {
  if (state.matrixSortCol === col) {
    state.matrixSortAsc = !state.matrixSortAsc;
  } else {
    state.matrixSortCol = col;
    state.matrixSortAsc = col === 'model' || col === 'provider';
  }
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
}

export
  function setMatrixFilter(field, value) {
  state['matrixFilter' + field.charAt(0).toUpperCase() + field.slice(1)] = value;
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
}

export
  function setMatrixDraftField(field, value) {
  state['matrixDraft' + field.charAt(0).toUpperCase() + field.slice(1)] = value;
}

export
  function clearMatrixDraft() {
  state.matrixDraftPattern = '';
  state.matrixDraftTier = '';
  state.matrixDraftLocality = 'local';
  state.matrixDraftStrengths = '';
  state.matrixEditingPattern = null;
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
}

export
  function startMatrixEdit(pattern) {
  var entries = Array.isArray(state.modelMatrixEntries) ? state.modelMatrixEntries : [];
  var found = null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].pattern === pattern) {
      found = entries[i];
      break;
    }
  }
  if (!found) return;
  state.matrixDraftPattern = found.pattern || '';
  state.matrixDraftTier = found.tier != null ? String(found.tier) : '';
  state.matrixDraftLocality = found.locality || 'local';
  state.matrixDraftStrengths = Array.isArray(found.strengths) ? found.strengths.join(', ') : '';
  state.matrixEditingPattern = found.pattern || null;
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
}

export
  async function saveMatrixEntry() {
  var pattern = String(state.matrixDraftPattern || '').trim();
  if (!pattern) {
    state.notice = { type: 'error', message: 'Model matrix pattern is required.' };
    render();
    return;
  }
  var tierValue = Number(state.matrixDraftTier);
  var locality = String(state.matrixDraftLocality || '').trim();
  var strengths = String(state.matrixDraftStrengths || '')
    .split(',')
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return !!part; });
  var payload = { pattern: pattern };
  if (!Number.isNaN(tierValue) && tierValue >= 1 && tierValue <= 5) {
    payload.tier = tierValue;
  }
  if (locality === 'local' || locality === 'remote') {
    payload.locality = locality;
  }
  if (strengths.length > 0) {
    payload.strengths = strengths;
  }
  try {
    await request('/api/models/matrix', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await refreshChrome();
    state.notice = 'Model matrix entry saved: ' + pattern;
    clearMatrixDraft();
    render();
  } catch (error) {
    state.notice = { type: 'error', message: 'Failed to save model matrix entry: ' + String(error) };
    render();
  }
}

export
  async function deleteMatrixEntry(pattern) {
  if (!pattern) return;
  if (!confirm('Delete model matrix entry "' + pattern + '"?')) return;
  try {
    await request('/api/models/matrix/' + encodeURIComponent(pattern), { method: 'DELETE' });
    await refreshChrome();
    if (state.matrixEditingPattern === pattern) {
      clearMatrixDraft();
    }
    state.notice = 'Model matrix entry deleted: ' + pattern;
    render();
  } catch (error) {
    state.notice = { type: 'error', message: 'Failed to delete model matrix entry: ' + String(error) };
    render();
  }
}

export
  function renderCapabilityMatrix() {
  const container = document.getElementById('capability-matrix');
  if (!container) return;
  if (!state.llmCatalog || !state.llmCatalog.providers) {
    container.innerHTML = '<div class="muted">Waiting for provider catalog...</div>';
    return;
  }

  if (state.capabilityMatrixExpanded === undefined) {
    state.capabilityMatrixExpanded = false;
  }

  const isExpanded = state.capabilityMatrixExpanded;

  const tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };
  const tierLabels = { 1: 'T1 Minimal', 2: 'T2 Basic', 3: 'T3 Standard', 4: 'T4 Advanced', 5: 'T5 Frontier' };
  const roleRequirements = {
    classification: { min: 1, ideal: 2 },
    chat: { min: 2, ideal: 3 },
    summarization: { min: 2, ideal: 3 },
    'tool-selection': { min: 3, ideal: 4 },
    'code-generation': { min: 3, ideal: 4 },
    'memory-indexing': { min: 1, ideal: 2 },
  };

  function guessTier(model, kind) {
    var m = model.match(/:?(\\d+(?:\\.\\d+)?)\\s*[bB]/);
    var b = m ? parseFloat(m[1]) : 0;
    if (kind === 'local') {
      if (b > 0 && b <= 2) return 1;
      if (b > 2 && b <= 5) return 2;
      if (b > 5 && b <= 15) return 3;
      return 2;
    }
    if (/mini|flash|small|instant|haiku/i.test(model)) return 3;
    if (/opus|5\\b|frontier/i.test(model)) return 5;
    return 4;
  }

  var allRows = [];
  var matrixEntries = Array.isArray(state.modelMatrixEntries) ? state.modelMatrixEntries : [];
  function resolveMatrixEntry(modelName) {
    var exact = null;
    var wildcard = null;
    for (var i = 0; i < matrixEntries.length; i++) {
      var e = matrixEntries[i] || {};
      var pattern = e.pattern || '';
      if (!pattern) continue;
      if (pattern === modelName) {
        exact = e;
        break;
      }
      if (pattern.endsWith('*')) {
        var prefix = pattern.slice(0, -1);
        if (prefix && modelName.indexOf(prefix) === 0) {
          if (!wildcard || prefix.length > String(wildcard.pattern || '').length) {
            wildcard = e;
          }
        }
      }
    }
    return exact || wildcard;
  }
  var providerSet = {};
  state.llmCatalog.providers.forEach(function (provider) {
    if (!provider.models || !provider.models.length) return;
    providerSet[provider.id] = provider.label;
    provider.models.forEach(function (model) {
      var matrixEntry = resolveMatrixEntry(model);
      var tier = matrixEntry && typeof matrixEntry.tier === 'number' ? matrixEntry.tier : guessTier(model, provider.kind);
      var locality = matrixEntry && matrixEntry.locality ? matrixEntry.locality : provider.kind;
      var strengths = matrixEntry && Array.isArray(matrixEntry.strengths) ? matrixEntry.strengths : null;
      allRows.push({ provider: provider.label, providerId: provider.id, model: model, tier: tier, kind: locality, enabled: provider.enabled, strengths: strengths });
    });
  });

  var rows = allRows.filter(function (row) {
    if (state.matrixFilterProvider && row.providerId !== state.matrixFilterProvider) return false;
    if (state.matrixFilterTier && row.tier !== Number(state.matrixFilterTier)) return false;
    if (state.matrixFilterLocality && row.kind !== state.matrixFilterLocality) return false;
    if (state.matrixFilterText) {
      var q = state.matrixFilterText.toLowerCase();
      if (row.model.toLowerCase().indexOf(q) === -1 && row.provider.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });

  var sortCol = state.matrixSortCol || 'tier';
  var sortAsc = state.matrixSortAsc;
  rows.sort(function (a, b) {
    var va, vb;
    if (sortCol === 'model') { va = a.model.toLowerCase(); vb = b.model.toLowerCase(); }
    else if (sortCol === 'provider') { va = a.provider.toLowerCase(); vb = b.provider.toLowerCase(); }
    else if (sortCol === 'tier') { va = a.tier; vb = b.tier; }
    else if (sortCol === 'locality') { va = a.kind; vb = b.kind; }
    else { va = a.tier; vb = b.tier; }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return 0;
  });

  function sortArrow(col) {
    if (state.matrixSortCol !== col) return '';
    return state.matrixSortAsc ? ' \u25B2' : ' \u25BC';
  }

  let html = '<div class="action-card" style="cursor:pointer;" onclick="toggleCapabilityMatrix()">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;">'
    + '<span class="muted" style="margin:0;">Model Capability Matrix</span>'
    + '<span class="muted" style="font-size:11px;">' + escapeHtml(rows.length + ' / ' + allRows.length + ' models') + '  ' + (isExpanded ? '&#x25B2;' : '&#x25BC;') + '</span>'
    + '</div></div>';

  if (!allRows.length) {
    container.innerHTML = html + '<div class="muted" style="margin-top:10px;">No models found. Configure and test a provider to populate the matrix.</div>';
    return;
  }

  html += '<div>';

  var filterStyle = 'padding:5px 8px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:11px;';
  var providerIds = Object.keys(providerSet);
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;">';
  html += '<input type="text" placeholder="Search models\u2026" value="' + escapeHtml(state.matrixFilterText || '') + '" oninput="setMatrixFilter(&#39;text&#39;, this.value)" style="' + filterStyle + 'flex:1;min-width:120px;" />';
  html += '<select onchange="setMatrixFilter(&#39;provider&#39;, this.value)" style="' + filterStyle + '">';
  html += '<option value="">All Providers</option>';
  providerIds.forEach(function (id) {
    var sel = state.matrixFilterProvider === id ? ' selected' : '';
    html += '<option value="' + escapeHtml(id) + '"' + sel + '>' + escapeHtml(providerSet[id]) + '</option>';
  });
  html += '</select>';
  html += '<select onchange="setMatrixFilter(&#39;tier&#39;, this.value)" style="' + filterStyle + '">';
  html += '<option value="">All Tiers</option>';
  for (var t = 5; t >= 1; t--) {
    var sel = state.matrixFilterTier === String(t) ? ' selected' : '';
    html += '<option value="' + t + '"' + sel + '>' + tierLabels[t] + '</option>';
  }
  html += '</select>';
  html += '<select onchange="setMatrixFilter(&#39;locality&#39;, this.value)" style="' + filterStyle + '">';
  html += '<option value=""' + (!state.matrixFilterLocality ? ' selected' : '') + '>All</option>';
  html += '<option value="local"' + (state.matrixFilterLocality === 'local' ? ' selected' : '') + '>Local</option>';
  html += '<option value="remote"' + (state.matrixFilterLocality === 'remote' ? ' selected' : '') + '>Cloud</option>';
  html += '</select>';
  html += '</div>';

  html += '<div class="panel" style="padding:10px;margin-top:8px;">';
  html += '<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px;">'
    + (state.matrixEditingPattern ? 'Edit Matrix Entry' : 'Create Matrix Entry')
    + '</div>';
  html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 2fr auto auto;gap:6px;align-items:center;">';
  html += '<input type="text" placeholder="pattern (example: gpt-4o* or llama3.1:8b)" value="' + escapeHtml(state.matrixDraftPattern || '') + '" oninput="setMatrixDraftField(&#39;pattern&#39;, this.value)" style="' + filterStyle + 'width:100%;" />';
  html += '<select onchange="setMatrixDraftField(&#39;tier&#39;, this.value)" style="' + filterStyle + '">';
  html += '<option value=""' + (!state.matrixDraftTier ? ' selected' : '') + '>Tier</option>';
  for (var mt = 1; mt <= 5; mt++) {
    html += '<option value="' + mt + '"' + (state.matrixDraftTier === String(mt) ? ' selected' : '') + '>T' + mt + '</option>';
  }
  html += '</select>';
  html += '<select onchange="setMatrixDraftField(&#39;locality&#39;, this.value)" style="' + filterStyle + '">';
  html += '<option value="local"' + (state.matrixDraftLocality === 'local' ? ' selected' : '') + '>Local</option>';
  html += '<option value="remote"' + (state.matrixDraftLocality === 'remote' ? ' selected' : '') + '>Cloud</option>';
  html += '</select>';
  html += '<input type="text" placeholder="strengths (comma-separated)" value="' + escapeHtml(state.matrixDraftStrengths || '') + '" oninput="setMatrixDraftField(&#39;strengths&#39;, this.value)" style="' + filterStyle + 'width:100%;" />';
  html += '<button class="secondary-button" style="padding:5px 10px;font-size:11px;" onclick="saveMatrixEntry()">Save</button>';
  html += '<button class="secondary-button" style="padding:5px 10px;font-size:11px;" onclick="clearMatrixDraft()">Clear</button>';
  html += '</div>';
  html += '</div>';

  var matrixRows = matrixEntries.slice().sort(function (a, b) {
    var pa = String((a && a.pattern) || '').toLowerCase();
    var pb = String((b && b.pattern) || '').toLowerCase();
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return 0;
  });

  html += '<div class="panel" style="padding:10px;margin-top:8px;">';
  html += '<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px;">Registered Matrix Entries (' + matrixRows.length + ')</div>';
  if (!matrixRows.length) {
    html += '<div class="muted" style="font-size:12px;">No registered model matrix entries.</div>';
  } else {
    html += '<table class="events-table"><thead><tr><th>Pattern</th><th>Tier</th><th>Locality</th><th>Strengths</th><th>Actions</th></tr></thead><tbody>';
    matrixRows.forEach(function (entry) {
      var pattern = entry.pattern || '';
      var strengthsText = Array.isArray(entry.strengths) ? entry.strengths.join(', ') : '';
      html += '<tr>'
        + '<td class="mono">' + escapeHtml(pattern) + '</td>'
        + '<td>' + escapeHtml(entry.tier != null ? 'T' + entry.tier : '-') + '</td>'
        + '<td>' + escapeHtml(entry.locality || '-') + '</td>'
        + '<td>' + escapeHtml(strengthsText || '-') + '</td>'
        + '<td style="white-space:nowrap;">'
        + '<button class="secondary-button" style="padding:3px 8px;font-size:11px;margin-right:6px;" data-pattern="' + escapeHtml(pattern) + '" onclick="startMatrixEdit(this.dataset.pattern)">Edit</button>'
        + '<button class="danger-button" style="padding:3px 8px;font-size:11px;" data-pattern="' + escapeHtml(pattern) + '" onclick="deleteMatrixEntry(this.dataset.pattern)">Delete</button>'
        + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';

  var thStyle = 'cursor:pointer;user-select:none;';
  html += '<table class="events-table" style="margin-top:8px;"><thead><tr>'
    + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;model&#39;)">Model' + sortArrow('model') + '</th>'
    + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;provider&#39;)">Provider' + sortArrow('provider') + '</th>'
    + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;tier&#39;)">Tier' + sortArrow('tier') + '</th>'
    + '<th style="' + thStyle + '" onclick="setMatrixSort(&#39;locality&#39;)">Locality' + sortArrow('locality') + '</th>'
    + '<th>Proficiencies</th>'
    + '</tr></thead><tbody>';

  var displayRows = isExpanded ? rows : rows.slice(0, 5);
  if (!displayRows.length) {
    html += '<tr><td colspan="5" class="muted" style="text-align:center;">No models match the current filters.</td></tr>';
  }
  displayRows.forEach(function (row) {
    var color = tierColors[row.tier] || '#aaa';
    var dimStyle = row.enabled ? '' : ' style="opacity:0.5;"';
    html += '<tr' + dimStyle + '>'
      + '<td class="mono">' + escapeHtml(row.model) + '</td>'
      + '<td>' + escapeHtml(row.provider) + (row.enabled ? '' : ' <span style="font-size:10px;color:var(--muted);">(unconfigured)</span>') + '</td>'
      + '<td><span style="color:' + color + ';font-weight:600;">' + escapeHtml(tierLabels[row.tier] || 'T?') + '</span></td>'
      + '<td>' + (row.kind === 'local' ? '🖥 Local' : '☁ Cloud') + '</td>'
      + '<td>' + getModelProficiencyBadges(row.model, row.strengths) + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';

  if (!isExpanded && rows.length > 5) {
    html += '<div class="muted" style="text-align:center;margin-top:8px;font-size:12px;cursor:pointer;" onclick="toggleCapabilityMatrix()">'
      + '... and ' + (rows.length - 5) + ' more models (Click to expand) ...</div>';
  }

  if (isExpanded) {
    html += '<div class="muted" style="margin-top:12px;">Role Coverage</div>';
    html += '<table class="events-table"><thead><tr><th>Task Role</th><th>Min Tier</th><th>Ideal</th><th>Status</th></tr></thead><tbody>';
    Object.keys(roleRequirements).forEach(function (role) {
      var req = roleRequirements[role];
      var bestTier = 0;
      rows.forEach(function (row) { if (row.enabled && row.tier > bestTier) bestTier = row.tier; });
      var met = bestTier >= req.ideal;
      var partial = !met && bestTier >= req.min;
      var statusHtml = met
        ? '<span style="color:#69db7c;">✓ Met</span>'
        : partial
          ? '<span style="color:#ffd43b;">⚠ Degraded</span>'
          : '<span style="color:#ff6b6b;">✗ Unmet</span>';
      html += '<tr><td>' + escapeHtml(role) + '</td><td>T' + req.min + '</td><td>T' + req.ideal + '</td><td>' + statusHtml + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  html += '</div>';

  container.innerHTML = html;
}

export
  function guessTier(model, kind) {
  var m = model.match(/:?(\\d+(?:\\.\\d+)?)\\s*[bB]/);
  var b = m ? parseFloat(m[1]) : 0;
  if (kind === 'local') {
    if (b > 0 && b <= 2) return 1;
    if (b > 2 && b <= 5) return 2;
    if (b > 5 && b <= 15) return 3;
    return 2;
  }
  if (/mini|flash|small|instant|haiku/i.test(model)) return 3;
  if (/opus|5\\b|frontier/i.test(model)) return 5;
  return 4;
}

export function resolveMatrixEntry(modelName) {
  var exact = null;
  var wildcard = null;
  for (var i = 0; i < matrixEntries.length; i++) {
    var e = matrixEntries[i] || {};
    var pattern = e.pattern || '';
    if (!pattern) continue;
    if (pattern === modelName) {
      exact = e;
      break;
    }
    if (pattern.endsWith('*')) {
      var prefix = pattern.slice(0, -1);
      if (prefix && modelName.indexOf(prefix) === 0) {
        if (!wildcard || prefix.length > String(wildcard.pattern || '').length) {
          wildcard = e;
        }
      }
    }
  }
  return exact || wildcard;
}

export
  function sortArrow(col) {
  if (state.matrixSortCol !== col) return '';
  return state.matrixSortAsc ? ' \u25B2' : ' \u25BC';
}

export
  function getModelProficiencyBadges(modelName, explicitStrengths) {
  var strengths = explicitStrengths;
  if (!strengths || !strengths.length) {
    var profiles = state.modelProfiles || {};
    var profile = profiles[modelName];
    strengths = profile && profile.strengths ? profile.strengths : [];
  }
  if (!strengths || !strengths.length) {
    return '<span class="muted" style="font-size:10px;">-</span>';
  }
  return strengths.map(function (s) {
    var c = STRENGTH_COLORS[s] || '#94a3b8';
    return '<span style="display:inline-block;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:600;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44;margin:1px 2px;">' + escapeHtml(s) + '</span>';
  }).join('');
}

export
  async function fetchModelProfiles() {
  try {
    var data = await request('/api/llm/model-profiles');
    state.modelProfiles = data.profiles || {};
    safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
  } catch (_) { }
}

export
  async function fetchRoutingState() {
  try {
    var data = await request('/api/llm/routing');
    state.routingStrategy = data.config.strategy || 'single';
    state.routingRoleOverrides = data.config.roleOverrides || {};
    state.routingAgentOverrides = data.config.agentOverrides || {};
    state.routingModalityOverrides = data.config.modalityOverrides || {};
    state.routingPreferredModality = data.config.preferredModality || null;
    state.routingSuggestions = data.suggestions || {};
    state.routingModalitySuggestions = data.modalitySuggestions || {};
    state.availableModalities = data.modalities || [];
    safeRenderStep('modelRouting', renderModelRouting);
  } catch (_) { }
}

export
  async function saveRoutingConfig() {
  try {
    await request('/api/llm/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy: state.routingStrategy,
        roleOverrides: state.routingRoleOverrides,
        agentOverrides: state.routingAgentOverrides,
        modalityOverrides: state.routingModalityOverrides,
        preferredModality: state.routingPreferredModality
      })
    });
    state.notice = 'Routing configuration saved.';
    render();
  } catch (err) {
    state.notice = { type: 'error', message: 'Failed to save routing: ' + String(err) };
    render();
  }
}

export
  async function suggestOptimalRouting() {
  try {
    var activeId = (state.llmCatalog && state.llmCatalog.activeProviderId) || '';
    var isSingle = state.routingStrategy !== 'multi';
    var suggestUrl = '/api/llm/routing/suggest' + (isSingle && activeId ? '?providerId=' + encodeURIComponent(activeId) : '');
    var data = await request(suggestUrl);
    state.routingSuggestions = data.suggestions || {};
    safeRenderStep('modelRouting', renderModelRouting);
  } catch (err) {
    state.notice = { type: 'error', message: 'Failed to get routing suggestions: ' + String(err) };
    render();
  }
}

export
  function setRoutingStrategy(strategy) {
  state.routingStrategy = strategy;
  safeRenderStep('modelRouting', renderModelRouting);
}

export
  function setSessionRoutingStrategy(strategy) {
  state.sessionRoutingStrategy = strategy;
  if (strategy !== 'modality') {
    state.selectedModalityFilter = null;
    state.modalityFilterEnabled = false;
  }
  safeRenderStep('llm', renderLlm);
  safeRenderStep('modelRouting', renderModelRouting);
}

export
  function onModalitySelected(modalityId) {
  if (state.selectedModalityFilter === modalityId) {
    state.selectedModalityFilter = null;
  } else {
    state.selectedModalityFilter = modalityId;
  }
  safeRenderStep('modelRouting', renderModelRouting);
}

export
  function onModalityFilterToggle() {
  state.modalityFilterEnabled = !state.modalityFilterEnabled;
  safeRenderStep('llm', renderLlm);
}

export
  function setModalityOverride(modalityId, value) {
  if (!value || value === 'auto') {
    delete state.routingModalityOverrides[modalityId];
  } else {
    var parts = value.split('/', 2);
    state.routingModalityOverrides[modalityId] = { providerId: parts[0], model: parts[1] || '' };
  }
  safeRenderStep('llm', renderLlm);
}

export
  function getModelsForModalityFilter(modalityId, providers) {
  if (!modalityId || !state.modelProfiles) return null;
  var filtered = [];
  providers.forEach(function (provider) {
    if (!provider.enabled) return;
    (provider.models || []).forEach(function (model) {
      var profile = state.modelProfiles[model];
      if (profile && profile.modalities && profile.modalities.indexOf(modalityId) >= 0) {
        filtered.push({ providerId: provider.id, model: model, label: provider.label + ' / ' + model });
      }
    });
  });
  return filtered;
}

export
  function setRoleOverride(role, value) {
  if (!value || value === 'auto') {
    delete state.routingRoleOverrides[role];
  } else {
    var parts = value.split('/', 2);
    state.routingRoleOverrides[role] = { providerId: parts[0], model: parts[1] || '' };
  }
  safeRenderStep('modelRouting', renderModelRouting);
}

export
  function renderModelRouting() {
  var container = document.getElementById('model-routing-container');
  if (!container) return;

  var roles = [
    'classification', 'chat', 'summarization', 'tool-selection', 'code-generation', 'memory-indexing',
    'document-writing', 'research',
    'speech-synthesis', 'speech-recognition', 'realtime-voice',
    'image-analysis', 'image-creation',
    'video-analysis', 'video-creation',
    'audio-production'
  ];
  var roleLabels = {
    'classification': '\u{1F3F7} Classification',
    'chat': '\u{1F4AC} Chat',
    'summarization': '\u{1F4DD} Summarization',
    'tool-selection': '\u{1F527} Tool Selection',
    'code-generation': '\u{1F4BB} Code Generation',
    'memory-indexing': '\u{1F4DA} Memory Indexing',
    'document-writing': '\u270F\uFE0F Document Writing',
    'research': '\u{1F52C} Research',
    'speech-synthesis': '\u{1F50A} Speech Synthesis (TTS)',
    'speech-recognition': '\u{1F3A4} Speech Recognition (STT)',
    'realtime-voice': '\u{1F399} Realtime Voice',
    'image-analysis': '\u{1F5BC} Image Analysis (VL)',
    'image-creation': '\u{1F3A8} Image Generation',
    'video-analysis': '\u{1F39E} Video Analysis',
    'video-creation': '\u{1F3AC} Video Generation',
    'audio-production': '\u{1F3B5} Audio / Music'
  };
  var roleRequirements = {
    'classification': { min: 1, ideal: 2 },
    'chat': { min: 2, ideal: 3 },
    'summarization': { min: 2, ideal: 3 },
    'tool-selection': { min: 3, ideal: 4 },
    'code-generation': { min: 3, ideal: 4 },
    'memory-indexing': { min: 1, ideal: 2 },
    'document-writing': { min: 2, ideal: 3 },
    'research': { min: 2, ideal: 3 },
    'speech-synthesis': { min: 2, ideal: 3 },
    'speech-recognition': { min: 2, ideal: 3 },
    'realtime-voice': { min: 3, ideal: 4 },
    'image-analysis': { min: 2, ideal: 3 },
    'image-creation': { min: 3, ideal: 4 },
    'video-analysis': { min: 3, ideal: 4 },
    'video-creation': { min: 3, ideal: 4 },
    'audio-production': { min: 3, ideal: 4 }
  };
  var tierColors = { 1: '#ff6b6b', 2: '#ffa94d', 3: '#ffd43b', 4: '#69db7c', 5: '#4dabf7' };

  var html = '';

  // Strategy toggle (Single / Multi-Provider) — shown first
  html += '<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">';
  html += '<span class="muted" style="font-size:12px;font-weight:600;">Strategy:</span>';
  html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">';
  html += '<input type="radio" name="routing-strategy" value="single"' + (state.routingStrategy !== 'multi' ? ' checked' : '') + ' onchange="setRoutingStrategy(&#39;single&#39;)" /> Single Provider</label>';
  html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;">';
  html += '<input type="radio" name="routing-strategy" value="multi"' + (state.routingStrategy === 'multi' ? ' checked' : '') + ' onchange="setRoutingStrategy(&#39;multi&#39;)" /> Multi-Provider</label>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="secondary-button" onclick="suggestOptimalRouting()" style="font-size:11px;padding:4px 10px;">\u{2728} Suggest Optimal</button>';
  html += '<button class="secondary-button" onclick="saveRoutingConfig()" style="font-size:11px;padding:4px 10px;">\u{1F4BE} Save</button>';
  html += '</div>';

  // ── Session Routing Strategy (Direct / Role-Based / Modality-Based) ──
  html += renderRoutingStrategyControls(null, null);

  if (state.routingStrategy !== 'multi') {
    html += '<div class="muted" style="padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:12px;">';
    html += 'All task roles use the <strong>active session provider</strong>';
    if (state.llmCatalog && state.llmCatalog.activeProviderId) {
      html += ' (' + escapeHtml(state.llmCatalog.activeProviderId);
      if (state.llmCatalog.activeModel) html += ' / ' + escapeHtml(state.llmCatalog.activeModel);
      html += ')';
    }
    html += '. Switch to <strong>Multi-Provider</strong> to assign models per task role and agent.</div>';
    container.innerHTML = html;
    return;
  }

  // Build available models list for dropdowns
  var availableModels = [];
  if (state.llmCatalog && state.llmCatalog.providers) {
    state.llmCatalog.providers.forEach(function (p) {
      if (!p.enabled) return;
      (p.models || []).forEach(function (m) {
        availableModels.push({ providerId: p.id, model: m, label: p.label + ' / ' + m });
      });
    });
  }

  // Role routing table
  html += '<table class="events-table" style="margin-top:4px;"><thead><tr>';
  html += '<th>Role</th><th>Tier Req</th><th>AI Suggested</th><th>Assignment</th><th>Status</th>';
  html += '</tr></thead><tbody>';

  roles.forEach(function (role) {
    var req = roleRequirements[role] || { min: 2, ideal: 3 };
    var suggestion = (state.routingSuggestions || {})[role];
    var override = state.routingRoleOverrides[role] || null;

    // Determine effective model
    var effectiveProviderId = override ? override.providerId : (suggestion ? suggestion.providerId : null);
    var effectiveModel = override ? override.model : (suggestion ? suggestion.model : null);
    var effectiveTier = 0;
    if (override && state.modelProfiles && state.modelProfiles[override.model]) {
      effectiveTier = state.modelProfiles[override.model].tier;
    } else if (suggestion) {
      effectiveTier = suggestion.tier || 0;
    }

    var met = effectiveTier >= req.ideal;
    var partial = !met && effectiveTier >= req.min;
    var statusHtml = effectiveTier === 0
      ? '<span class="muted">-</span>'
      : met
        ? '<span style="color:#69db7c;">\u2713 Met</span>'
        : partial
          ? '<span style="color:#ffd43b;">\u26A0 Degraded</span>'
          : '<span style="color:#ff6b6b;">\u2717 Unmet</span>';

    var suggestionHtml = '-';
    if (suggestion) {
      var sColor = tierColors[suggestion.tier] || '#aaa';
      suggestionHtml = '<span class="mono" style="font-size:11px;">' + escapeHtml(suggestion.providerId + '/' + suggestion.model) + '</span>';
      suggestionHtml += ' <span style="color:' + sColor + ';font-size:10px;font-weight:600;">T' + suggestion.tier + '</span>';
      if (suggestion.degraded) suggestionHtml += ' <span style="color:#ffd43b;font-size:10px;">\u26A0</span>';
    }

    // Build dropdown
    var selectVal = override ? (override.providerId + '/' + override.model) : 'auto';
    var dropdownHtml = '<select onchange="setRoleOverride(&#39;' + escapeHtml(role) + '&#39;, this.value)" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);max-width:200px;">';
    dropdownHtml += '<option value="auto"' + (!override ? ' selected' : '') + '>Auto (AI)</option>';
    availableModels.forEach(function (am) {
      var val = am.providerId + '/' + am.model;
      dropdownHtml += '<option value="' + escapeHtml(val) + '"' + (selectVal === val ? ' selected' : '') + '>' + escapeHtml(am.label) + '</option>';
    });
    dropdownHtml += '</select>';

    html += '<tr>';
    html += '<td style="white-space:nowrap;font-size:12px;">' + (roleLabels[role] || escapeHtml(role)) + '</td>';
    html += '<td style="font-size:11px;"><span style="color:' + (tierColors[req.min] || '#aaa') + ';">T' + req.min + '</span> / <span style="color:' + (tierColors[req.ideal] || '#aaa') + ';">T' + req.ideal + '</span></td>';
    html += '<td style="font-size:11px;">' + suggestionHtml + '</td>';
    html += '<td>' + dropdownHtml + '</td>';
    html += '<td>' + statusHtml + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';

  // Agents section
  var agents = [
    { id: 'classifier', role: 'classification', desc: 'Classifies inputs' },
    { id: 'chat', role: 'chat', desc: 'General conversation' },
    { id: 'summarizer', role: 'summarization', desc: 'Condenses content' },
    { id: 'planner', role: 'tool-selection', desc: 'Plans tool use' },
    { id: 'coder', role: 'code-generation', desc: 'Generates code' },
    { id: 'indexer', role: 'memory-indexing', desc: 'Extracts knowledge' },
    { id: 'writer', role: 'document-writing', desc: 'Writes long-form documents' },
    { id: 'researcher', role: 'research', desc: 'Conducts deep research' },
    { id: 'speaker', role: 'speech-synthesis', desc: 'Synthesizes speech (TTS)' },
    { id: 'transcriber', role: 'speech-recognition', desc: 'Transcribes audio to text (STT)' },
    { id: 'voice', role: 'realtime-voice', desc: 'Handles realtime voice dialog' },
    { id: 'vision', role: 'image-analysis', desc: 'Analyzes images via VL models' },
    { id: 'artist', role: 'image-creation', desc: 'Generates images' },
    { id: 'videoscribe', role: 'video-creation', desc: 'Generates video content' },
    { id: 'musician', role: 'audio-production', desc: 'Produces audio and music' }
  ];

  html += '<div class="muted" style="margin-top:12px;margin-bottom:4px;font-size:12px;font-weight:600;">Agent Overrides</div>';
  html += '<div class="muted" style="margin-bottom:8px;font-size:11px;">Override the model for specific agents. Defaults to the role assignment above.</div>';
  html += '<table class="events-table"><thead><tr><th>Agent</th><th>Default Role</th><th>Override</th></tr></thead><tbody>';

  agents.forEach(function (agent) {
    var agentOverride = (state.routingAgentOverrides || {})[agent.id] || null;
    var selectVal = agentOverride ? (agentOverride.providerId + '/' + agentOverride.model) : 'role-default';

    var dropdownHtml = '<select onchange="setAgentOverride(&#39;' + escapeHtml(agent.id) + '&#39;, this.value)" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);max-width:200px;">';
    dropdownHtml += '<option value="role-default"' + (!agentOverride ? ' selected' : '') + '>Use Role Default</option>';
    availableModels.forEach(function (am) {
      var val = am.providerId + '/' + am.model;
      dropdownHtml += '<option value="' + escapeHtml(val) + '"' + (selectVal === val ? ' selected' : '') + '>' + escapeHtml(am.label) + '</option>';
    });
    dropdownHtml += '</select>';

    html += '<tr>';
    html += '<td style="font-size:12px;"><strong>' + escapeHtml(agent.id) + '</strong> <span class="muted" style="font-size:10px;">' + escapeHtml(agent.desc) + '</span></td>';
    html += '<td style="font-size:11px;">' + escapeHtml(agent.role) + '</td>';
    html += '<td>' + dropdownHtml + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';

  container.innerHTML = html;
}

export
  function setAgentOverride(agentId, value) {
  if (!value || value === 'role-default') {
    delete state.routingAgentOverrides[agentId];
  } else {
    var parts = value.split('/', 2);
    state.routingAgentOverrides[agentId] = { providerId: parts[0], model: parts[1] || '' };
  }
  safeRenderStep('modelRouting', renderModelRouting);
}

export
  function onLlmProviderChanged() {
  const providerSelect = document.getElementById('provider-select');
  const providerId = providerSelect ? providerSelect.value : '';
  if (!providerId || !state.selectedSessionId || !state.llmCatalog || !state.llmCatalog.providers) {
    return;
  }

  const provider = state.llmCatalog.providers.find(entry => entry.id === providerId) || null;
  const providerModels = provider ? (provider.models || []) : [];
  const model = provider && provider.defaultModel && providerModels.includes(provider.defaultModel)
    ? provider.defaultModel
    : (providerModels[0] || '');

  setLocalLlmSelection(state.selectedSessionId, providerId, model);

  // Explicitly trigger a re-render of just the LLM panel so the newly selected 
  // provider's correct models populate into the second dropdown immediately.
  safeRenderStep('llm', renderLlm);
}

export
  function onLlmModelChanged() {
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const providerId = providerSelect ? providerSelect.value : '';
  const model = modelSelect ? modelSelect.value : '';
  if (!providerId || !state.selectedSessionId) {
    return;
  }

  setLocalLlmSelection(state.selectedSessionId, providerId, model);
  safeRenderStep('llm', renderLlm);
}

export
  function renderProviderCards() {
  const container = document.getElementById('provider-cards-container');
  if (!container) return;
  if (!state.llmCatalog || !state.llmCatalog.providers) {
    container.innerHTML = '<div class="muted">Loading providers...</div>';
    return;
  }

  const providers = state.llmCatalog.providers;
  let html = '';
  for (const provider of providers) {
    const meta = PROVIDER_META[provider.id] || { icon: '', desc: '' };
    const isExpanded = state.expandedProviderId === provider.id;
    const statusBadge = provider.enabled
      ? '<span class="ps-badge ps-badge-ok">enabled</span>'
      : '<span class="ps-badge ps-badge-off">disabled</span>';
    const kindBadge = provider.kind === 'local'
      ? '<span class="ps-badge ps-badge-local">local</span>'
      : '<span class="ps-badge ps-badge-remote">remote</span>';
    const keyBadge = provider.requiresApiKey
      ? (provider.hasApiKey
        ? '<span class="ps-badge ps-badge-ok">key set</span>'
        : '<span class="ps-badge ps-badge-warn">no key</span>')
      : '';

    html += '<div class="ps-card">';
    html += '<div class="ps-card-header" onclick="toggleProviderCard(\'' + escapeHtml(provider.id) + '\')">';
    html += '<span class="ps-card-title">' + meta.icon + ' ' + escapeHtml(provider.label) + '</span>';
    html += '<div class="ps-card-badges">' + statusBadge + kindBadge + keyBadge + '<span class="muted" style="font-size:16px;">' + (isExpanded ? '\u25B2' : '\u25BC') + '</span></div>';
    html += '</div>';

    if (isExpanded) {
      const testResult = state.providerTestResults[provider.id] || null;
      const isKeyVisible = state.providerApiKeyVisible[provider.id] || false;
      html += '<div class="ps-card-body">';
      html += '<div class="muted" style="margin-bottom:8px;">' + escapeHtml(meta.desc) + '</div>';

      if (provider.reason) {
        html += '<div class="muted" style="color:#ffc1c1;margin-bottom:8px;">' + escapeHtml(provider.reason) + '</div>';
      }

      html += '<div class="ps-field"><label>Base URL</label>';
      html += '<input type="text" id="ps-url-' + escapeHtml(provider.id) + '" value="' + escapeHtml(provider.baseUrl || '') + '" placeholder="https://..." /></div>';

      if (provider.requiresApiKey) {
        html += '<div class="ps-field"><label>API Key</label>';
        html += '<div class="ps-key-row">';
        html += '<input type="' + (isKeyVisible ? 'text' : 'password') + '" id="ps-key-' + escapeHtml(provider.id) + '" placeholder="' + (provider.hasApiKey ? 'Key is set (enter new to replace)' : 'Enter API key') + '" />';
        html += '<button class="secondary-button" onclick="toggleApiKeyVisibility(\'' + escapeHtml(provider.id) + '\')" style="white-space:nowrap;">' + (isKeyVisible ? 'Hide' : 'Show') + '</button>';
        html += '</div></div>';
      }

      html += '<div class="ps-field"><label>Models (comma-separated)</label>';
      html += '<textarea id="ps-models-' + escapeHtml(provider.id) + '" rows="2" placeholder="model-1, model-2">' + escapeHtml((provider.models || []).join(', ')) + '</textarea></div>';

      html += '<div class="ps-field"><label>Default Model</label>';
      html += '<input type="text" id="ps-default-' + escapeHtml(provider.id) + '" value="' + escapeHtml(provider.defaultModel || '') + '" placeholder="Default model name" /></div>';

      html += '<div class="action-buttons" style="flex-wrap:wrap;">';
      html += '<button class="secondary-button" onclick="saveProviderCardSettings(\'' + escapeHtml(provider.id) + '\')">Save Settings</button>';

      if (provider.requiresApiKey) {
        html += '<button class="secondary-button" onclick="saveProviderCardApiKey(\'' + escapeHtml(provider.id) + '\')">Save API Key</button>';
        if (provider.hasApiKey) {
          html += '<button class="danger-button" onclick="removeProviderCardApiKey(\'' + escapeHtml(provider.id) + '\')">Remove Key</button>';
        }
      }

      html += '<button class="secondary-button" onclick="testProviderConnection(\'' + escapeHtml(provider.id) + '\')">Test Connection</button>';
      html += '<button class="secondary-button" onclick="discoverModels(\'' + escapeHtml(provider.id) + '\')">\uD83D\uDD0D Discover Models</button>';
      html += '</div>';

      if (testResult) {
        const cls = testResult.ok ? 'ps-test-result ps-test-ok' : 'ps-test-result ps-test-fail';
        html += '<div class="' + cls + '">' + escapeHtml(testResult.message) + '</div>';
      }

      html += '<div class="muted" style="margin-top:8px;font-size:11px;">Source: ' + escapeHtml(provider.settingsSource || 'environment') + '</div>';
      html += '</div>';
    }

    html += '</div>';
  }

  // Preserve any unsaved form state for the currently expanded card before rebuilding
  if (state.expandedProviderId) {
    const eid = state.expandedProviderId;
    const urlEl = document.getElementById('ps-url-' + eid);
    const keyEl = document.getElementById('ps-key-' + eid);
    const modelsEl = document.getElementById('ps-models-' + eid);
    const defaultEl = document.getElementById('ps-default-' + eid);
    if (urlEl || keyEl || modelsEl || defaultEl) {
      state.providerSettingsCache[eid] = {
        url: urlEl ? urlEl.value : null,
        key: keyEl ? keyEl.value : null,
        models: modelsEl ? modelsEl.value : null,
        default: defaultEl ? defaultEl.value : null
      };
    }
  }

  // If the user is actively typing in any input inside this panel, skip the DOM
  // rebuild entirely — destroying and recreating elements always kills focus even
  // if values are restored afterwards.  We will pick up fresh server state on the
  // next poll cycle once they move focus away.
  const _activeEl = document.activeElement;
  if (_activeEl && container.contains(_activeEl) &&
    (_activeEl.tagName === 'INPUT' || _activeEl.tagName === 'TEXTAREA' || _activeEl.tagName === 'SELECT')) {
    return;
  }

  container.innerHTML = html;

  // Render collapsed summary — all providers as pills
  var summaryEl = document.getElementById('providerConfig-summary');
  if (summaryEl) {
    summaryEl.style.display = state.providerConfigCollapsed ? '' : 'none';
    var pillsHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 4px;">';
    for (var si = 0; si < providers.length; si++) {
      var sp = providers[si];
      var sm = PROVIDER_META[sp.id] || { icon: '', desc: '' };
      var dotColor = sp.enabled ? '#69db7c' : '#94a3b8';
      var pillBg = sp.enabled ? 'rgba(105,219,124,0.08)' : 'rgba(148,163,184,0.06)';
      var pillBorder = sp.enabled ? 'rgba(105,219,124,0.25)' : 'rgba(148,163,184,0.15)';
      var keyIndicator = sp.requiresApiKey
        ? (sp.hasApiKey
          ? ' <span style="color:#69db7c;font-size:9px;font-weight:600;letter-spacing:0.04em;">KEY\u2713</span>'
          : ' <span style="color:#ffa94d;font-size:9px;font-weight:600;letter-spacing:0.04em;">NO KEY</span>')
        : '';
      pillsHtml += '<span onclick="toggleProviderCard(\'' + escapeHtml(sp.id) + '\')" style="'
        + 'display:inline-flex;align-items:center;gap:5px;'
        + 'padding:4px 10px;border-radius:999px;font-size:11px;cursor:pointer;'
        + 'border:1px solid ' + pillBorder + ';'
        + 'background:' + pillBg + ';'
        + 'color:var(--fg-muted);'
        + 'transition:background 0.15s,border-color 0.15s;">';
      pillsHtml += '<span style="width:7px;height:7px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></span>';
      pillsHtml += '<span style="font-size:13px;line-height:1;">' + sm.icon + '</span>';
      pillsHtml += '<span>' + escapeHtml(sp.label) + '</span>';
      pillsHtml += keyIndicator;
      pillsHtml += '</span>';
    }
    pillsHtml += '</div>';
    summaryEl.innerHTML = pillsHtml;
  }

  // Restore preserved form state after innerHTML rebuild
  if (state.expandedProviderId && state.providerSettingsCache[state.expandedProviderId]) {
    const eid = state.expandedProviderId;
    const cached = state.providerSettingsCache[eid];
    const urlEl = document.getElementById('ps-url-' + eid);
    const keyEl = document.getElementById('ps-key-' + eid);
    const modelsEl = document.getElementById('ps-models-' + eid);
    const defaultEl = document.getElementById('ps-default-' + eid);
    if (urlEl && cached.url !== null) urlEl.value = cached.url;
    if (keyEl && cached.key !== null) keyEl.value = cached.key;
    if (modelsEl && cached.models !== null) modelsEl.value = cached.models;
    if (defaultEl && cached.default !== null) defaultEl.value = cached.default;
  }
}

export
  function toggleProviderCard(providerId) {
  state.expandedProviderId = state.expandedProviderId === providerId ? null : providerId;
  render();
}

export
  function toggleApiKeyVisibility(providerId) {
  state.providerApiKeyVisible[providerId] = !state.providerApiKeyVisible[providerId];
  render();
}

export
  async function saveProviderCardSettings(providerId) {
  const urlInput = document.getElementById('ps-url-' + providerId);
  const modelsInput = document.getElementById('ps-models-' + providerId);
  const defaultInput = document.getElementById('ps-default-' + providerId);
  const baseUrl = urlInput ? urlInput.value.trim() : '';
  const modelsRaw = modelsInput ? modelsInput.value : '';
  const models = modelsRaw.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
  const defaultModel = defaultInput ? defaultInput.value.trim() : '';

  state.notice = null;
  try {
    await request('/api/llm/provider-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerId, baseUrl: baseUrl, models: models, defaultModel: defaultModel })
    });
    delete state.providerSettingsCache[providerId];
    await refreshChrome();
    safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
    state.notice = 'Settings saved for ' + providerId + '.';
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function saveProviderCardApiKey(providerId) {
  const keyInput = document.getElementById('ps-key-' + providerId);
  const apiKey = keyInput ? keyInput.value.trim() : '';
  if (!apiKey) {
    state.notice = 'Enter an API key before saving.';
    render();
    return;
  }
  state.notice = null;
  try {
    await request('/api/llm/provider-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: providerId, apiKey: apiKey })
    });
    if (state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId].key = null;
    await refreshChrome();
    state.notice = 'API key saved for ' + providerId + '.';
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function removeProviderCardApiKey(providerId) {
  if (!confirm('Remove API key for ' + providerId + '?')) return;
  state.notice = null;
  try {
    await request('/api/llm/provider-secret?providerId=' + encodeURIComponent(providerId), { method: 'DELETE' });
    await refreshChrome();
    state.notice = 'API key removed for ' + providerId + '.';
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function testProviderConnection(providerId) {
  state.providerTestResults[providerId] = { ok: false, message: 'Testing...' };
  render();
  try {
    const keyInput = document.getElementById('ps-key-' + providerId);
    const apiKey = keyInput ? keyInput.value.trim() : '';
    const result = await request('/api/llm/provider-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiKey ? { providerId: providerId, apiKey: apiKey } : { providerId: providerId })
    });
    state.providerTestResults[providerId] = result;
    if (result.ok && result.models && result.models.length > 0) {
      // Update the models textarea in-place and persist in cache so it survives the next poll
      const modelsInput = document.getElementById('ps-models-' + providerId);
      const modelsText = result.models.join(', ');
      if (modelsInput) modelsInput.value = modelsText;
      if (!state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId] = {};
      state.providerSettingsCache[providerId].models = modelsText;
      // Clear the API key input from cache now that it has been saved server-side
      if (apiKey) {
        if (keyInput) keyInput.value = '';
        if (state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId].key = null;
      }
      await refreshChrome();
    }
  } catch (error) {
    state.providerTestResults[providerId] = { ok: false, message: String(error) };
  }
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
  render();
}

export
  async function discoverModels(providerId) {
  state.providerTestResults[providerId] = { ok: false, message: 'Discovering models...' };
  render();
  try {
    const result = await request('/api/models/discover/' + encodeURIComponent(providerId));
    if (result && result.models && result.models.length > 0) {
      const modelsInput = document.getElementById('ps-models-' + providerId);
      const modelsText = result.models.join(', ');
      if (modelsInput) modelsInput.value = modelsText;
      if (!state.providerSettingsCache[providerId]) state.providerSettingsCache[providerId] = {};
      state.providerSettingsCache[providerId].models = modelsText;
    }
    const count = (result && result.models) ? result.models.length : 0;
    state.providerTestResults[providerId] = {
      ok: true,
      message: 'Discovered ' + count + ' model' + (count === 1 ? '' : 's') + '.'
    };
  } catch (error) {
    state.providerTestResults[providerId] = { ok: false, message: 'Discovery failed: ' + String(error) };
  }
  render();
}

export
  function renderLlmAudit() {
  const container = document.getElementById('llm-audit');
  const events = state.llmAuditEvents || [];
  if (!events.length) {
    container.innerHTML = '<div class="muted">No provider switch events for this scope.</div>'
      + '<div class="action-buttons">'
      + '<button class="secondary-button" disabled>Export JSON</button>'
      + '<button class="secondary-button" disabled>Copy JSON</button>'
      + '<button class="secondary-button" disabled>Export CSV</button>'
      + '</div>';
    return;
  }

  const successCount = events.filter(event => event.status === 'succeeded').length;
  const failedCount = events.filter(event => event.status === 'failed').length;

  container.innerHTML = ''
    + '<div class="metric"><span class="muted">Succeeded</span><span class="mono">' + escapeHtml(String(successCount)) + '</span></div>'
    + '<div class="metric"><span class="muted">Failed</span><span class="mono">' + escapeHtml(String(failedCount)) + '</span></div>'
    + '<div class="action-buttons">'
    + '<button class="secondary-button" onclick="exportLlmAuditJson()">Export JSON</button>'
    + '<button class="secondary-button" onclick="copyLlmAuditJson()">Copy JSON</button>'
    + '<button class="secondary-button" onclick="exportLlmAuditCsv()">Export CSV</button>'
    + '</div>'
    + '<table class="events-table"><thead><tr><th>Time</th><th>Selection</th><th>Status</th></tr></thead><tbody>'
    + events.map(event => {
      const details = event.details || {};
      const requestedProviderId = details.requestedProviderId || '-';
      const requestedModel = details.requestedModel || '-';
      const selectedProviderId = details.selectedProviderId || '-';
      const selectedModel = details.selectedModel || '-';
      const reason = details.reason
        ? ('<div class="muted">Reason: ' + escapeHtml(String(details.reason)) + '</div>')
        : '';
      return '<tr>'
        + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
        + '<td><div class="mono">req ' + escapeHtml(String(requestedProviderId)) + ' / ' + escapeHtml(String(requestedModel)) + '</div>'
        + '<div class="mono">sel ' + escapeHtml(String(selectedProviderId)) + ' / ' + escapeHtml(String(selectedModel)) + '</div>'
        + reason + '</td>'
        + '<td>' + escapeHtml(event.status) + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

export
  function exportLlmAuditJson() {
  const payload = buildLlmAuditPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export
  async function copyLlmAuditJson() {
  const payload = buildLlmAuditPayload();
  const text = JSON.stringify(payload, null, 2);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      state.notice = 'LLM audit JSON copied to clipboard.';
      render();
      return;
    }
  } catch {
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const copied = document.execCommand('copy');
    state.notice = copied
      ? 'LLM audit JSON copied to clipboard.'
      : 'Clipboard permission denied. Use Export JSON instead.';
  } catch {
    state.notice = 'Clipboard copy failed. Use Export JSON instead.';
  } finally {
    document.body.removeChild(textarea);
    render();
  }
}

export
  function buildLlmAuditPayload() {
  const payload = {
    exportedAt: new Date().toISOString(),
    scope: {
      sessionId: state.selectedSessionId || null,
      operation: 'dashboard.llm_selection'
    },
    counts: {
      total: state.llmAuditEvents.length,
      succeeded: state.llmAuditEvents.filter(event => event.status === 'succeeded').length,
      failed: state.llmAuditEvents.filter(event => event.status === 'failed').length
    },
    events: state.llmAuditEvents
  };
  return payload;
}

export
  function exportLlmAuditCsv() {
  const rows = [];
  rows.push([
    'timestamp',
    'status',
    'chatSessionId',
    'source',
    'requestedProviderId',
    'requestedModel',
    'previousProviderId',
    'previousModel',
    'selectedProviderId',
    'selectedModel',
    'reason'
  ]);

  for (const event of state.llmAuditEvents) {
    const details = event.details || {};
    rows.push([
      event.timestamp || '',
      event.status || '',
      details.chatSessionId || '',
      details.source || '',
      details.requestedProviderId || '',
      details.requestedModel || '',
      details.previousProviderId || '',
      details.previousModel || '',
      details.selectedProviderId || '',
      details.selectedModel || '',
      details.reason || ''
    ]);
  }

  const csv = rows.map(cols => cols.map(toCsvValue).join(',')).join('\\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export
  function renderSettingsPanel() {
  var container = document.getElementById('settings-panel');
  if (!container) return;
  var s = state.status;
  var rs = state.runtimeSettings;
  var html = '';

  /* ── helper: section wrapper ── */
  function sec(id, title, contentFn) {
    var open = state.settingsSections[id] !== false;
    html += '<div class="stg-section">';
    html += '<div class="stg-section-header" onclick="toggleSettingsSection(\'' + id + '\')">';
    html += '<span>' + escapeHtml(title) + '</span>';
    html += '<span>' + (open ? '\u25BC' : '\u25B6') + '</span>';
    html += '</div>';
    html += '<div class="stg-section-body' + (open ? '' : ' stg-collapsed') + '">';
    contentFn();
    html += '</div></div>';
  }

  function readonlyRow(label, value, hint) {
    html += '<div class="stg-row">';
    html += '<span class="stg-label">' + escapeHtml(label);
    if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
    html += '</span>';
    html += '<span class="stg-value">' + escapeHtml(String(value || '\u2014')) + '</span>';
    html += '</div>';
  }

  function badgeRow(label, value, cls) {
    html += '<div class="stg-row">';
    html += '<span class="stg-label">' + escapeHtml(label) + '</span>';
    html += '<span class="stg-badge ' + cls + '">' + escapeHtml(String(value)) + '</span>';
    html += '</div>';
  }

  function numberRow(label, key, hint, suffix) {
    var val = rs ? (rs[key] != null ? rs[key] : '') : '';
    html += '<div class="stg-row">';
    html += '<span class="stg-label">' + escapeHtml(label);
    if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
    html += '</span>';
    html += '<span style="display:flex;align-items:center;gap:4px;">';
    html += '<input class="stg-input" type="number" id="stg-' + key + '" value="' + escapeHtml(String(val)) + '" onchange="markSettingDirty(\'' + key + '\')" />';
    if (suffix) html += '<span class="muted" style="font-size:11px;">' + escapeHtml(suffix) + '</span>';
    html += '</span>';
    html += '</div>';
  }

  function selectRow(label, key, options, hint) {
    var val = rs ? String(rs[key] || '') : '';
    html += '<div class="stg-row">';
    html += '<span class="stg-label">' + escapeHtml(label);
    if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
    html += '</span>';
    html += '<select class="stg-select" id="stg-' + key + '" onchange="markSettingDirty(\'' + key + '\')">';
    for (var oi = 0; oi < options.length; oi++) {
      var opt = options[oi];
      html += '<option value="' + escapeHtml(opt.value) + '"' + (opt.value === val ? ' selected' : '') + '>' + escapeHtml(opt.label) + '</option>';
    }
    html += '</select>';
    html += '</div>';
  }

  /* ── Section 1: Runtime & Identity ── */
  sec('runtime', 'Runtime & Identity', function () {
    if (s) {
      var segment = (s.executionProfileSegment || 'individual').toLowerCase();
      var isDemo = s.mode === 'demo';
      var segBadge = isDemo ? 'demo' : segment;
      var segLabel = isDemo ? 'DEMO' : segment.toUpperCase();
      var segClass = isDemo ? 'stg-badge-amber' : (segment === 'business' ? 'stg-badge-blue' : 'stg-badge-green');
      badgeRow('Execution Profile', segLabel, segClass);
      var envClass = s.environmentProfile === 'prod' ? 'stg-badge-green' : (s.environmentProfile === 'staging' ? 'stg-badge-amber' : 'stg-badge-blue');
      badgeRow('Environment', s.environmentProfile || 'dev', envClass);
      badgeRow('Mode', s.mode || 'server', s.mode === 'demo' ? 'stg-badge-amber' : 'stg-badge-green');
      readonlyRow('Dashboard Port', location.port || '7070');
      readonlyRow('Session ID', s.sessionId);
      readonlyRow('Uptime', formatUptime(s.uptimeSeconds));
      readonlyRow('Version', 'v0.2.0');
      readonlyRow('Node', (s.nodeVersion || '\u2014'));
      readonlyRow('Platform', (s.platform || '\u2014'));
    } else {
      html += '<div class="muted">Loading runtime information...</div>';
    }
  });

  /* ── Section 2: LLM Summary ── */
  sec('llm', 'LLM Configuration (Summary)', function () {
    var provider = state.llmCatalog ? (state.llmCatalog.activeProviderId || 'none') : 'unknown';
    var model = state.llmCatalog ? (state.llmCatalog.activeModel || 'none') : 'unknown';
    readonlyRow('Active Provider', provider);
    readonlyRow('Active Model', model);
    readonlyRow('Routing Strategy', state.routingStrategy || 'single');
    readonlyRow('Sessions', String((state.sessions || []).length));
    html += '<div style="margin-top:8px;"><span class="muted" style="font-size:11px;">Configure providers, models, and routing in the sections above. \u2191</span></div>';
  });

  /* ── Section 3: Approval & Orchestration ── */
  sec('approval', 'Approval & Orchestration', function () {
    numberRow('Approval Timeout', 'approvalTimeoutMs', 'PRISM_APPROVAL_TIMEOUT_MS', 'ms');
    if (s && s.pendingApprovals > 0) {
      html += '<div class="stg-row"><span class="stg-label">Pending Approvals</span>';
      html += '<span class="stg-badge stg-badge-amber">' + s.pendingApprovals + '</span></div>';
    }
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="stg-save-btn" onclick="saveSettings([\'' + 'approvalTimeoutMs' + '\'])">Save</button>';
    html += '</div>';
  });

  /* ── Section 4: Self-Review Intervals ── */
  sec('selfReview', 'Self-Review Intervals', function () {
    selectRow('Daily Cadence', 'selfReviewDailyMs', [
      { value: '43200000', label: '12 hours' },
      { value: '86400000', label: '24 hours' },
      { value: '172800000', label: '48 hours' }
    ], 'PRISM_SELF_REVIEW_DAILY_MS');
    selectRow('Weekly Cadence', 'selfReviewWeeklyMs', [
      { value: '302400000', label: '3.5 days' },
      { value: '604800000', label: '7 days' },
      { value: '1209600000', label: '14 days' }
    ], 'PRISM_SELF_REVIEW_WEEKLY_MS');
    selectRow('Monthly Cadence', 'selfReviewMonthlyMs', [
      { value: '1296000000', label: '15 days' },
      { value: '2592000000', label: '30 days' },
      { value: '5184000000', label: '60 days' }
    ], 'PRISM_SELF_REVIEW_MONTHLY_MS');
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="stg-save-btn" onclick="saveSettings([\'' + 'selfReviewDailyMs' + '\', \'' + 'selfReviewWeeklyMs' + '\', \'' + 'selfReviewMonthlyMs' + '\'])">Save</button>';
    html += '</div>';
  });

  /* ── Section 5: Retrieval & Memory ── */
  sec('retrieval', 'Retrieval & Memory', function () {
    numberRow('Max Episodic Events', 'maxEpisodicEvents', '', 'events');
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="stg-save-btn" onclick="saveSettings([\'' + 'maxEpisodicEvents' + '\'])">Save</button>';
    html += '</div>';
  });

  /* ── Section 6: Tool & Network Timeouts ── */
  sec('timeouts', 'Tool & Network Timeouts', function () {
    numberRow('Shell Command Timeout', 'shellTimeoutMs', '', 'ms');
    numberRow('HTTP Request Timeout', 'httpTimeoutMs', '', 'ms');
    numberRow('MCP Server Timeout', 'mcpTimeoutMs', '', 'ms');
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="stg-save-btn" onclick="saveSettings([\'' + 'shellTimeoutMs' + '\', \'' + 'httpTimeoutMs' + '\', \'' + 'mcpTimeoutMs' + '\'])">Save</button>';
    html += '</div>';
  });

  /* ── Section 7: Dashboard Preferences ── */
  sec('prefs', 'Dashboard Preferences', function () {
    selectRow('Telemetry Window', 'telemetryWindow', [
      { value: '1h', label: '1 Hour' },
      { value: '1d', label: '1 Day' },
      { value: '7d', label: '7 Days' }
    ]);
    numberRow('Action History Limit', 'actionHistoryLimit', '', 'entries');
    numberRow('Package History Limit', 'sessionPackageHistoryLimit', '', 'entries');
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="stg-save-btn" onclick="saveSettings([\'' + 'telemetryWindow' + '\', \'' + 'actionHistoryLimit' + '\', \'' + 'sessionPackageHistoryLimit' + '\'])">Save</button>';
    html += '</div>';
  });

  /* ── Section 8: Data & Paths ── */
  sec('paths', 'Data & Paths', function () {
    if (s) {
      readonlyRow('Workspace Root', s.workspaceRoot, 'PRISM_WORKSPACE_ROOT');
    }
    readonlyRow('Dashboard URL', 'http://localhost:' + (location.port || '7070'));
  });

  /* ── Section 9: Readiness Requirements ── */
  sec('readiness', 'System Readiness', function () {
    var rd = state.readiness;
    if (!rd) {
      html += '<div class="muted">No readiness data loaded yet.</div>';
      html += '<div style="margin-top:10px;">';
      html += '<button class="stg-recheck-btn" onclick="recheckReadiness()">Run Readiness Check</button>';
      html += '</div>';
      return;
    }

    /* Summary line */
    var totalChecks = rd.totalChecks || (rd.requirements ? rd.requirements.length : 0);
    var passedChecks = rd.passedChecks || (rd.requirements ? rd.requirements.filter(function (r) { return r.passed; }).length : 0);
    html += '<div class="stg-readiness-summary">';
    html += '<span class="' + (rd.ready ? 'stg-readiness-ready' : 'stg-readiness-notready') + '">' + (rd.ready ? '\u2713 System Ready' : '\u2717 Not Ready') + '</span>';
    html += '<span class="muted" style="font-weight:400;font-size:11px;">' + passedChecks + '/' + totalChecks + ' checks passed</span>';
    html += '</div>';

    /* Progress bar */
    if (state.readinessProgress) {
      var pct = state.readinessProgress.total > 0 ? Math.round((state.readinessProgress.completed / state.readinessProgress.total) * 100) : 0;
      html += '<div class="stg-progress-bar"><div class="stg-progress-fill" style="width:' + pct + '%"></div></div>';
    }

    /* Category-based collapsible sections */
    if (rd.categories && rd.categories.length > 0) {
      for (var ci = 0; ci < rd.categories.length; ci++) {
        var cat = rd.categories[ci];
        var catKey = 'readiness_cat_' + cat.category;
        var catOpen = state.readinessCatOpen && state.readinessCatOpen[cat.category];
        var catFailed = cat.checks.filter(function (c) { return !c.passed; });
        var catCritFail = cat.checks.filter(function (c) { return !c.passed && c.severity === 'critical'; });
        var badgeClass = catCritFail.length > 0 ? 'stg-cat-badge-fail' : (catFailed.length > 0 ? 'stg-cat-badge-warn' : 'stg-cat-badge-pass');
        var badgeText = catCritFail.length > 0 ? (catCritFail.length + ' critical') : (catFailed.length > 0 ? (catFailed.length + ' warning') : 'all pass');

        html += '<div class="stg-cat-header" onclick="toggleReadinessCat(&#39;' + cat.category + '&#39;)">';
        html += '<span class="stg-cat-name">' + escapeHtml(cat.category) + '</span>';
        html += '<span class="stg-cat-badges"><span class="stg-cat-badge ' + badgeClass + '">' + badgeText + '</span>';
        html += '<span class="muted" style="font-size:10px;">' + cat.checks.length + ' check' + (cat.checks.length !== 1 ? 's' : '') + '</span>';
        html += '<span style="font-size:10px;color:var(--muted);">' + (catOpen ? '\u25B2' : '\u25BC') + '</span></span>';
        html += '</div>';

        if (catOpen) {
          html += '<div class="stg-cat-body">';
          for (var cki = 0; cki < cat.checks.length; cki++) {
            var ck = cat.checks[cki];
            var sevClass = 'stg-sev-' + ck.severity;
            var ckId = escapeHtml(ck.id || (cat.category + '.' + cki));
            html += '<div class="stg-req-row stg-check-anim" onclick="toggleReadinessCheck(&#39;' + ckId + '&#39;)">';
            html += '<span class="' + (ck.passed ? 'stg-req-met' : 'stg-req-unmet') + '">' + (ck.passed ? '\u2713' : '\u2717') + '</span>';
            html += '<span class="' + sevClass + '" style="font-size:9px;text-transform:uppercase;font-weight:700;">' + ck.severity + '</span>';
            html += '<span>' + escapeHtml(ck.label) + '</span>';
            if (ck.durationMs !== undefined) {
              html += '<span class="stg-check-duration">' + ck.durationMs + 'ms</span>';
            }
            html += '<span class="stg-check-expand-hint">click for detail</span>';
            html += '</div>';
            var detailOpen = state.readinessCheckOpen && state.readinessCheckOpen[ckId];
            var detailClass = 'stg-check-detail' + (detailOpen ? ' stg-detail-open' : '');
            html += '<div class="' + detailClass + '" id="ck-detail-' + ckId + '">';
            if (ck.detail) {
              html += escapeHtml(ck.detail);
            } else {
              html += '<span class="muted">' + (ck.passed ? 'Check passed.' : 'No detail available.') + '</span>';
            }
            if (!ck.passed && ck.severity === 'critical') {
              html += '<div class="stg-check-fix" onclick="event.stopPropagation(); fixReadinessCheck(&#39;' + ckId + '&#39;)">\u{1F527} Click to fix</div>';
            } else if (!ck.passed && ck.severity === 'warning') {
              html += '<div class="stg-check-resolve" onclick="event.stopPropagation(); resolveReadinessCheck(&#39;' + ckId + '&#39;)">\u26A0 Resolve</div>';
            } else if (ck.passed && ck.severity === 'critical') {
              html += '<span class="stg-check-verified">\u2713 Verified</span>';
            } else if (ck.passed) {
              html += '<span class="stg-check-ok">\u2713 OK</span>';
            }
            html += '</div>';
          }
          html += '</div>';
        }
      }
    } else if (rd.requirements && rd.requirements.length > 0) {
      /* Fallback: flat requirements list (backward compat) */
      var reqs = rd.requirements;
      for (var ri = 0; ri < reqs.length; ri++) {
        var met = reqs[ri].passed;
        html += '<div class="stg-req-row">';
        html += '<span class="' + (met ? 'stg-req-met' : 'stg-req-unmet') + '">' + (met ? '\u2713' : '\u2717') + '</span>';
        html += '<span>' + escapeHtml(reqs[ri].label || reqs[ri].id) + '</span>';
        html += '</div>';
      }
    }

    html += '<div style="margin-top:10px;">';
    html += '<button class="stg-recheck-btn" id="stg-recheck-btn" onclick="recheckReadiness()">' + (state.readinessChecking ? 'Checking\u2026' : 'Re-check Readiness') + '</button>';
    html += '</div>';
  });

  container.innerHTML = html;
}

export
  /* ── helper: section wrapper ── */
  function sec(id, title, contentFn) {
  var open = state.settingsSections[id] !== false;
  html += '<div class="stg-section">';
  html += '<div class="stg-section-header" onclick="toggleSettingsSection(\'' + id + '\')">';
  html += '<span>' + escapeHtml(title) + '</span>';
  html += '<span>' + (open ? '\u25BC' : '\u25B6') + '</span>';
  html += '</div>';
  html += '<div class="stg-section-body' + (open ? '' : ' stg-collapsed') + '">';
  contentFn();
  html += '</div></div>';
}

export
  function readonlyRow(label, value, hint) {
  html += '<div class="stg-row">';
  html += '<span class="stg-label">' + escapeHtml(label);
  if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
  html += '</span>';
  html += '<span class="stg-value">' + escapeHtml(String(value || '\u2014')) + '</span>';
  html += '</div>';
}

export
  function badgeRow(label, value, cls) {
  html += '<div class="stg-row">';
  html += '<span class="stg-label">' + escapeHtml(label) + '</span>';
  html += '<span class="stg-badge ' + cls + '">' + escapeHtml(String(value)) + '</span>';
  html += '</div>';
}

export
  function numberRow(label, key, hint, suffix) {
  var val = rs ? (rs[key] != null ? rs[key] : '') : '';
  html += '<div class="stg-row">';
  html += '<span class="stg-label">' + escapeHtml(label);
  if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
  html += '</span>';
  html += '<span style="display:flex;align-items:center;gap:4px;">';
  html += '<input class="stg-input" type="number" id="stg-' + key + '" value="' + escapeHtml(String(val)) + '" onchange="markSettingDirty(\'' + key + '\')" />';
  if (suffix) html += '<span class="muted" style="font-size:11px;">' + escapeHtml(suffix) + '</span>';
  html += '</span>';
  html += '</div>';
}

export
  function selectRow(label, key, options, hint) {
  var val = rs ? String(rs[key] || '') : '';
  html += '<div class="stg-row">';
  html += '<span class="stg-label">' + escapeHtml(label);
  if (hint) html += ' <span class="stg-hint">' + escapeHtml(hint) + '</span>';
  html += '</span>';
  html += '<select class="stg-select" id="stg-' + key + '" onchange="markSettingDirty(\'' + key + '\')">';
  for (var oi = 0; oi < options.length; oi++) {
    var opt = options[oi];
    html += '<option value="' + escapeHtml(opt.value) + '"' + (opt.value === val ? ' selected' : '') + '>' + escapeHtml(opt.label) + '</option>';
  }
  html += '</select>';
  html += '</div>';
}

export
  function toggleSettingsSection(id) {
  state.settingsSections[id] = !state.settingsSections[id];
  render();
}

export
  function markSettingDirty(key) {
  /* visual feedback could go here; for now we just let the user click Save */
}

export
  async function saveSettings(keys) {
  dashboardLog('settings', 'settings.save', 'Saving: ' + keys.join(', '));
  var payload = {};
  for (var i = 0; i < keys.length; i++) {
    var el = document.getElementById('stg-' + keys[i]);
    if (el) {
      var val = el.tagName === 'SELECT' ? el.value : el.value;
      if (el.type === 'number') val = Number(val);
      payload[keys[i]] = val;
    }
  }
  state.settingsSaving = true;
  render();
  try {
    await request('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await refreshChrome();
  } catch (e) {
    console.error('[settings] save failed', e);
  }
  state.settingsSaving = false;
  render();
}

export
  async function recheckReadiness() {
  if (state.readinessChecking) return;
  dashboardLog('settings', 'readiness.recheck', 'Running readiness recheck');
  state.readinessChecking = true;
  state.readinessProgress = { completed: 0, total: 0 };
  if (!state.readinessCatOpen) state.readinessCatOpen = {};
  render();
  try {
    var sessionId = state.selectedSessionId || '';
    var response = await fetch('/api/readiness/recheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, source: 'dashboard_settings_panel', stream: true })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      /* Fallback: no streaming support — parse as single JSON */
      var text = await response.text();
      var lines = text.trim().split('\\n');
      for (var li = 0; li < lines.length; li++) {
        var obj = JSON.parse(lines[li]);
        if (obj.type === 'summary') {
          state.readiness = obj;
        }
      }
      state.readinessChecking = false;
      state.readinessProgress = null;
      render();
      return;
    }
    var decoder = new TextDecoder();
    var buffer = '';
    var tempCategories = {};
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      var nlIdx;
      while ((nlIdx = buffer.indexOf('\\n')) !== -1) {
        var line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        try {
          var msg = JSON.parse(line);
          if (msg.type === 'check') {
            /* Accumulate into categories for incremental display */
            if (!tempCategories[msg.category]) tempCategories[msg.category] = { category: msg.category, checks: [], allPassed: true, criticalPassed: true };
            tempCategories[msg.category].checks.push(msg);
            if (!msg.passed) tempCategories[msg.category].allPassed = false;
            if (!msg.passed && msg.severity === 'critical') tempCategories[msg.category].criticalPassed = false;
            /* Auto-expand categories with failures */
            if (!msg.passed) state.readinessCatOpen[msg.category] = true;
            /* Update progress */
            if (msg.progress) state.readinessProgress = msg.progress;
            /* Build interim readiness state */
            var cats = [];
            var allReqs = [];
            for (var ck in tempCategories) {
              cats.push(tempCategories[ck]);
              for (var tci = 0; tci < tempCategories[ck].checks.length; tci++) {
                allReqs.push(tempCategories[ck].checks[tci]);
              }
            }
            state.readiness = state.readiness || {};
            state.readiness.categories = cats;
            state.readiness.requirements = allReqs.map(function (r) { return { id: r.id, label: r.label, passed: r.passed, detail: r.detail }; });
            state.readiness.totalChecks = msg.progress ? msg.progress.total : allReqs.length;
            state.readiness.passedChecks = allReqs.filter(function (r) { return r.passed; }).length;
            state.readiness.ready = allReqs.filter(function (r) { return r.severity === 'critical'; }).every(function (r) { return r.passed; });
            render();
          } else if (msg.type === 'summary') {
            state.readiness = msg;
            state.readinessProgress = null;
            render();
          }
        } catch (_) { /* skip malformed lines */ }
      }
    }
  } catch (e) {
    console.error('[settings] readiness recheck failed', e);
  }
  state.readinessChecking = false;
  state.readinessProgress = null;
  render();
}

export
  function toggleReadinessCat(cat) {
  if (!state.readinessCatOpen) state.readinessCatOpen = {};
  state.readinessCatOpen[cat] = !state.readinessCatOpen[cat];
  render();
}

export
  function toggleReadinessCheck(ckId) {
  if (!state.readinessCheckOpen) state.readinessCheckOpen = {};
  state.readinessCheckOpen[ckId] = !state.readinessCheckOpen[ckId];
  var el = document.getElementById('ck-detail-' + ckId);
  if (el) {
    el.classList.toggle('stg-detail-open');
  }
}

export
  async function fixReadinessCheck(ckId) {
  dashboardLog('settings', 'readiness.fix', 'Attempting fix: ' + ckId);
  state.notice = 'Attempting fix for ' + ckId + '…';
  render();
  try {
    var result = await request('/api/readiness/fix/' + encodeURIComponent(ckId), { method: 'POST' });
    if (result.fixed) {
      state.notice = '\u2713 Fixed: ' + (result.detail || ckId);
    } else {
      state.notice = { type: 'error', message: result.detail || ('Could not auto-fix ' + ckId + '.') };
    }
  } catch (err) {
    state.notice = { type: 'error', message: 'Fix request failed: ' + String(err) };
  }
  await recheckReadiness();
}

export
  async function resolveReadinessCheck(ckId) {
  dashboardLog('settings', 'readiness.resolve', 'Resolving: ' + ckId);
  state.notice = 'Resolving ' + ckId + '…';
  render();
  try {
    var result = await request('/api/readiness/fix/' + encodeURIComponent(ckId), { method: 'POST' });
    if (result.fixed) {
      state.notice = '\u2713 Resolved: ' + (result.detail || ckId);
    } else {
      state.notice = result.detail || ('Manual resolution needed for ' + ckId + '.');
    }
  } catch (err) {
    state.notice = { type: 'error', message: 'Resolve request failed: ' + String(err) };
  }
  await recheckReadiness();
}

export
  function toggleOnboardingExpand() {
  var list = document.getElementById('onboarding-full-list');
  var btn = document.getElementById('onboarding-expand-btn');
  if (list && btn) {
    if (list.style.display === 'none') {
      list.style.display = '';
      btn.textContent = 'Hide full list';
    } else {
      list.style.display = 'none';
      btn.textContent = 'Show all checks';
    }
  }
}

var _settingsTabInitialized = false;
export function initSettingsTab() {
  if (_settingsTabInitialized) return;
  var divider = document.getElementById('provider-matrix-divider');
  var leftPanel = document.getElementById('provider-config-panel');
  var row = document.getElementById('provider-matrix-row');
  if (!divider || !leftPanel || !row) return;
  _settingsTabInitialized = true;

  // Restore saved split
  var savedPct = localStorage.getItem('prism-provider-matrix-split');
  if (savedPct) {
    leftPanel.style.flex = '0 0 ' + savedPct;
  }

  // Hover highlight on the inner bar
  var bar = divider.querySelector('div');
  divider.addEventListener('mouseenter', function () {
    if (bar) bar.style.background = 'rgba(148,163,184,0.45)';
  });
  divider.addEventListener('mouseleave', function () {
    if (!_dragging && bar) bar.style.background = 'rgba(148,163,184,0.15)';
  });

  var _dragging = false;

  divider.addEventListener('mousedown', function (e) {
    e.preventDefault();
    _dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    if (bar) bar.style.background = 'rgba(100,180,255,0.7)';
  });

  document.addEventListener('mousemove', function (e) {
    if (!_dragging) return;
    var rect = row.getBoundingClientRect();
    var rawPct = (e.clientX - rect.left) / (rect.width - 8) * 100;
    var pct = Math.min(80, Math.max(20, rawPct));
    leftPanel.style.flex = '0 0 ' + pct + '%';
    localStorage.setItem('prism-provider-matrix-split', pct + '%');
  });

  document.addEventListener('mouseup', function () {
    if (!_dragging) return;
    _dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (bar) bar.style.background = 'rgba(148,163,184,0.15)';
  });
}
