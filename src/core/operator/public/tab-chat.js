import { state, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, dashboardLog, safeRenderStep, renderStars, approvalBadge, metricRow, healthDot, timeAgo, formatUptime, authHeaders, createReconnector, trimAgenticEvent } from './dashboard-core.js';
import { renderToolCallLog } from './tab-logs.js';

// Holds files staged for upload prior to server ACK. Ensure initialized.
let pendingAttachments = [];

export
  function reconcileExpandedSessionPackages() {
  const validPackageIds = new Set((state.sessionPackages || []).map(pkg => pkg.packageId));
  for (const packageId of Object.keys(state.expandedSessionPackages || {})) {
    if (!validPackageIds.has(packageId)) {
      delete state.expandedSessionPackages[packageId];
    }
  }
}

export
  async function loadSessionPackages() {
  const payload = await request('/api/session-packages');
  state.sessionPackages = Array.isArray(payload.packages) ? payload.packages : [];
  state.packageReleaseSnapshot = payload.releaseSnapshot || null;
  reconcileExpandedSessionPackages();
}

export
  async function loadSessionPackageHistory() {
  const payload = await request('/api/session-packages/history?limit=12').catch(() => ({ history: [] }));
  state.sessionPackageHistory = Array.isArray(payload.history) ? payload.history : [];
}

export
  async function mutateSessionPackage(packageId, patch, noticeText) {
  await request('/api/session-packages/' + encodeURIComponent(packageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {})
  });
  await Promise.all([loadSessionPackages(), loadSessionPackageHistory()]);
  if (noticeText) {
    state.notice = noticeText;
  }
}

export
  function getPackagedSessionIdSet() {
  const packaged = new Set();
  for (const pkg of state.sessionPackages || []) {
    for (const sessionId of pkg.sessionIds || []) {
      packaged.add(sessionId);
    }
  }
  return packaged;
}

export
  function buildSessionTimeline() {
  const bySessionId = new Map(state.sessions.map(session => [session.sessionId, session]));
  const packagedSessionIds = getPackagedSessionIdSet();
  const timeline = [];

  for (const session of state.sessions) {
    if (!packagedSessionIds.has(session.sessionId)) {
      timeline.push({ type: 'session', timestamp: safeIso(session.updatedAt), session });
    }
  }

  for (const pkg of state.sessionPackages || []) {
    const sessions = (pkg.sessionIds || [])
      .map(sessionId => bySessionId.get(sessionId))
      .filter(Boolean)
      .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));
    if (!sessions.length) {
      continue;
    }
    const latestTimestamp = sessions.reduce((latest, session) => {
      const updated = safeIso(session.updatedAt);
      return updated > latest ? updated : latest;
    }, safeIso(pkg.updatedAt || pkg.createdAt));
    timeline.push({
      type: 'package',
      timestamp: latestTimestamp,
      pkg,
      sessions,
    });
  }

  return timeline.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export
  async function exportSession() {
  if (!state.selectedSessionId) {
    state.notice = { type: 'error', message: 'No session selected to export.' };
    render();
    return;
  }
  try {
    var messages = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
    var session = state.sessions.find(function (s) { return s.sessionId === state.selectedSessionId; });
    var exportData = {
      format: 'prism-session-v1',
      exportedAt: new Date().toISOString(),
      session: {
        title: session ? session.title : 'Untitled',
        messageCount: messages.length,
        createdAt: session ? session.createdAt : null,
      },
      messages: messages
    };
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'prism-session-' + (session ? session.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) : 'export') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    state.notice = 'Session exported successfully.';
    render();
  } catch (err) {
    state.notice = { type: 'error', message: 'Export failed: ' + String(err) };
    render();
  }
}

export
  function importSession() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      if (!data.format || data.format !== 'prism-session-v1' || !Array.isArray(data.messages)) {
        state.notice = { type: 'error', message: 'Invalid session file. Expected prism-session-v1 format.' };
        render();
        return;
      }
      var title = (data.session && data.session.title) ? data.session.title + ' (imported)' : 'Imported Session';
      var result = await request('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title })
      });
      var newSessionId = result.session.sessionId;
      for (var i = 0; i < data.messages.length; i++) {
        var msg = data.messages[i];
        await request('/api/chat/sessions/' + encodeURIComponent(newSessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: msg.role, content: msg.content })
        });
      }
      await loadSessions();
      state.selectedSessionId = newSessionId;
      await loadMessages();
      state.notice = 'Imported ' + data.messages.length + ' messages into \"' + title + '\".';
      render();
    } catch (err) {
      state.notice = { type: 'error', message: 'Import failed: ' + String(err) };
      render();
    }
  };
  input.click();
}

export
  async function packageSessions() {
  const packagedSessionIds = getPackagedSessionIdSet();
  const candidates = state.sessions
    .filter(session => !packagedSessionIds.has(session.sessionId))
    .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));

  if (candidates.length === 0) {
    state.notice = 'No un-packaged sessions available.';
    render();
    return;
  }

  const packageId = 'pkg-' + Date.now();
  const createdAt = new Date().toISOString();
  const suggestedTitle = 'Session Package • ' + formatRelativeTime(createdAt);
  const packageTitleInput = prompt('Package title:', suggestedTitle);
  if (packageTitleInput === null) {
    return;
  }
  const areaOfInterestInput = prompt('Area of interest (optional):', '');
  if (areaOfInterestInput === null) {
    return;
  }
  const objectiveInput = prompt('Package objective (optional):', '');
  if (objectiveInput === null) {
    return;
  }
  const successCriteriaInput = prompt('Success criteria (optional):', '');
  if (successCriteriaInput === null) {
    return;
  }
  const dependenciesInput = prompt('Dependencies (comma separated, optional):', '');
  if (dependenciesInput === null) {
    return;
  }
  const dependencies = dependenciesInput
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  await request('/api/session-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: (packageTitleInput || '').trim() || suggestedTitle,
      areaOfInterest: (areaOfInterestInput || '').trim() || null,
      objective: (objectiveInput || '').trim() || null,
      successCriteria: (successCriteriaInput || '').trim() || null,
      dependencies,
      status: 'planned',
      sessionIds: candidates.map(session => session.sessionId)
    })
  });
  await Promise.all([loadSessionPackages(), loadSessionPackageHistory()]);
  if (state.sessionPackages[0]) {
    state.expandedSessionPackages[state.sessionPackages[0].packageId] = true;
  }
  state.notice = 'Packaged ' + candidates.length + ' sessions into a binder.';
  render();
}

export
  function toggleSessionPackage(packageId) {
  const current = Boolean(state.expandedSessionPackages[packageId]);
  state.expandedSessionPackages[packageId] = !current;
  render();
}

export
  function getSessionsForPackage(pkg) {
  const bySessionId = new Map(state.sessions.map(session => [session.sessionId, session]));
  return (pkg.sessionIds || [])
    .map(sessionId => bySessionId.get(sessionId))
    .filter(Boolean)
    .sort((a, b) => (safeIso(b.updatedAt) < safeIso(a.updatedAt) ? -1 : 1));
}

export
  async function runPackageWorkflow(event, packageId) {
  event.stopPropagation();
  const pkg = (state.sessionPackages || []).find(item => item.packageId === packageId);
  if (!pkg) {
    return;
  }

  const sessions = getSessionsForPackage(pkg);
  if (!sessions.length) {
    state.notice = 'Package has no active session chapters.';
    render();
    return;
  }

  const targetSession = sessions[0];
  state.selectedSessionId = targetSession.sessionId;

  if (!state.readiness || !state.readiness.ready) {
    state.notice = 'Complete provider readiness before running package workflow.';
    if (typeof window.setActiveTab === 'function') {
      window.setActiveTab('settings');
    } else {
      state.activeTab = 'settings';
      render();
    }
    return;
  }

  const orchestrationPrompt = [
    'Execute multi-session package workflow orchestration for this binder.',
    'Package title: ' + (pkg.title || 'Session Package'),
    'Area of interest: ' + (pkg.areaOfInterest || 'unspecified'),
    'Objective: ' + (pkg.objective || 'unspecified'),
    'Success criteria: ' + (pkg.successCriteria || 'unspecified'),
    'Dependencies: ' + ((pkg.dependencies || []).length ? pkg.dependencies.join(', ') : 'none'),
    'Session chapters in scope: ' + sessions.map(session => session.title).join(' | '),
    'Produce an execution plan with ordered phases, required approvals, and data orchestration checkpoints.'
  ].join('\\n');

  const previousStatus = pkg.status || 'planned';
  state.busy = true;
  state.notice = null;
  render();
  try {
    await mutateSessionPackage(packageId, {
      status: 'running',
      lastRunAt: new Date().toISOString(),
      historyAction: 'workflow_started',
      message: 'Workflow launched from package controls.',
      targetSessionId: targetSession.sessionId
    });
    await request('/api/chat/sessions/' + encodeURIComponent(targetSession.sessionId) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: orchestrationPrompt })
    });
    await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
    state.notice = 'Package workflow started in chapter session "' + targetSession.title + '".';
  } catch (error) {
    await mutateSessionPackage(packageId, {
      status: previousStatus,
      historyAction: 'status_changed',
      message: 'Workflow launch failed; restored previous status.',
      targetSessionId: targetSession.sessionId
    }).catch(() => null);
    state.notice = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

export
  async function setPackageStatus(event, packageId, nextStatus, actionLabel) {
  event.stopPropagation();
  const pkg = (state.sessionPackages || []).find(p => p.packageId === packageId);
  if (!pkg) {
    return;
  }
  const actionMap = {
    planned: 'workflow_paused',
    running: 'workflow_started',
    blocked: 'workflow_blocked',
    complete: 'workflow_completed'
  };
  await mutateSessionPackage(packageId, {
    status: nextStatus,
    historyAction: actionMap[nextStatus] || 'status_changed',
    message: actionLabel || ('Package status set to ' + nextStatus + '.')
  }, 'Package marked ' + nextStatus + '.');
  render();
}

export
  async function cyclePackageStatus(event, packageId) {
  event.stopPropagation();
  const pkg = (state.sessionPackages || []).find(p => p.packageId === packageId);
  if (!pkg) {
    return;
  }
  const cycle = ['planned', 'running', 'blocked', 'complete'];
  const idx = cycle.indexOf(pkg.status || 'planned');
  await setPackageStatus(event, packageId, cycle[(idx + 1) % cycle.length], 'Status advanced from package badge.');
}

export
  async function exportPackageTrace(event, packageId) {
  event.stopPropagation();
  state.busy = true;
  state.notice = null;
  render();
  try {
    const payload = await request('/api/session-packages/' + encodeURIComponent(packageId) + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = packageId + '-trace-export.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    await Promise.all([loadSessionPackages(), loadSessionPackageHistory(), refreshChrome()]);
    state.notice = 'Package trace export generated.';
  } catch (error) {
    state.notice = String(error);
  } finally {
    state.busy = false;
    render();
  }
}

export
  async function unpackageSessionPackage(event, packageId) {
  event.stopPropagation();
  const existing = (state.sessionPackages || []).find(pkg => pkg.packageId === packageId);
  if (!existing) {
    return;
  }

  const confirmed = confirm('Unpackage "' + existing.title + '" and restore all chapters to top-level history?');
  if (!confirmed) {
    return;
  }

  await request('/api/session-packages/' + encodeURIComponent(packageId), {
    method: 'DELETE'
  });
  state.sessionPackages = state.sessionPackages.filter(pkg => pkg.packageId !== packageId);
  if (state.expandedSessionPackages[packageId]) {
    delete state.expandedSessionPackages[packageId];
  }
  await loadSessionPackageHistory();
  state.notice = 'Unpackaged "' + existing.title + '".';
  render();
}

export
  function getLocalLlmSelection(sessionId) {
  if (!sessionId) {
    return null;
  }
  return state.localLlmSelectionBySession[sessionId] || null;
}

export
  function setLocalLlmSelection(sessionId, providerId, model) {
  if (!sessionId || !providerId) {
    return;
  }
  state.localLlmSelectionBySession[sessionId] = {
    providerId,
    model: model || ''
  };
}

export
  function clearLocalLlmSelection(sessionId) {
  if (!sessionId) {
    return;
  }
  if (state.localLlmSelectionBySession[sessionId]) {
    delete state.localLlmSelectionBySession[sessionId];
  }
}

export
  async function loadSessions() {
  const payload = await request('/api/chat/sessions');
  state.sessions = payload;
  const validSessionIds = new Set(state.sessions.map(session => session.sessionId));
  for (const sessionId of Object.keys(state.localLlmSelectionBySession)) {
    if (!validSessionIds.has(sessionId)) {
      delete state.localLlmSelectionBySession[sessionId];
    }
  }
  if (!state.selectedSessionId && state.sessions.length > 0) {
    state.selectedSessionId = state.sessions[0].sessionId;
  }
  if (state.selectedSessionId && !state.sessions.some(session => session.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0] ? state.sessions[0].sessionId : null;
  }
}

export
  async function createSession(options) {
  const opts = options && typeof options === 'object' ? options : {};
  // Strip the internal `silent` flag before sending to the server.
  const silent = Boolean(opts.silent);
  const body = Object.assign({}, opts);
  delete body.silent;
  try {
    const payload = await request('/api/chat/sessions', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    state.selectedSessionId = payload.session.sessionId;
    await loadSessions();
    await loadMessages();
    await Promise.all([loadSessionPackages(), loadSessionPackageHistory(), refreshChrome()]);
    render();
  } catch (err) {
    console.error('[createSession] failed:', err);
    try { dashboardLog('chat', 'createSession.error', err && err.message ? err.message : String(err)); } catch (_) { /* noop */ }
    // Phase E3b: 409 from the governance gate — offer the wizard unless silent.
    const msg = (err && err.message) ? err.message : String(err);
    if (/no_default_character/.test(msg)) {
      if (!silent) {
        const goWizard = confirm('PRISM: No default character is bound to this workspace.\n\nOpen the setup wizard to pick one?');
        if (goWizard) {
          window.location.href = '/setup?rerun=true&step=4';
          return;
        }
      }
      state.notice = 'Session creation blocked: no default character. Use the wizard to pick one.';
      try { render(); } catch (_) { /* noop */ }
      return;
    }
    state.notice = 'Failed to create session: ' + msg;
    try { render(); } catch (_) { /* noop */ }
    if (!silent) {
      alert('PRISM: ' + state.notice + '\n\nCheck DevTools → Network for the failing request and DevTools → Console for details.');
    }
    throw err;
  }
}

/**
 * Phase E3b: "New Session" button entrypoint. For now this delegates to
 * createSession() so the server-side default-character resolution handles the
 * common case; a future iteration will open a character picker modal inline.
 */
export
  async function openNewSessionModal() {
  return createSession();
}

export
  async function loadMessages() {
  if (!state.selectedSessionId) {
    state.messages = [];
    return;
  }
  const payload = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
  state.messages = payload.messages;
}

export
  async function refreshChrome(force) {
  // Always fetch a provider catalog: session-specific if a session is active,
  // otherwise the global session-independent catalog so settings panels populate.
  const llmUrl = (state.selectedSessionId
    ? '/api/llm/providers?sessionId=' + encodeURIComponent(state.selectedSessionId)
    : '/api/llm/catalog') + (force ? (state.selectedSessionId ? '&refresh=true' : '?refresh=true') : '');
  const llmConfigUrl = state.selectedSessionId
    ? '/api/llm/config?sessionId=' + encodeURIComponent(state.selectedSessionId)
    : null;
  const readinessUrl = '/api/readiness'
    + (state.selectedSessionId ? '?sessionId=' + encodeURIComponent(state.selectedSessionId) : '');
  const llmAuditUrl = '/api/events?limit=10&operation=dashboard.llm_selection'
    + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '');
  const tracesUrl = '/api/traces?limit=10'
    + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '')
    + (state.selectedTraceId ? '&correlationId=' + encodeURIComponent(state.selectedTraceId) : '');
  const chatTelemetryUrl = '/api/events?limit=25'
    + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '');

  // 1. Critical Initialization Phase: Fetch readiness and core settings
  const [status, readiness, llmCatalog, llmConfig, pending] = await Promise.all([
    request('/api/status').catch(() => null),
    request(readinessUrl).catch(() => null),
    request(llmUrl).catch(() => null),
    llmConfigUrl ? request(llmConfigUrl).catch(() => null) : Promise.resolve(null),
    request('/api/pending').catch(() => [])
  ]);

  if (status) state.status = status;
  if (readiness) state.readiness = readiness;
  if (llmCatalog) {
    state.llmCatalog = llmCatalog;
    try {
      localStorage.setItem('prism-llm-catalog', JSON.stringify(llmCatalog));
    } catch (_) { }
  }
  if (llmConfig) state.llmConfig = llmConfig;
  if (pending) state.pending = pending;

  // Render critical components immediately
  safeRenderStep('header', renderHeader);
  safeRenderStep('llm', renderLlm);
  safeRenderStep('onboarding', renderOnboarding);
  safeRenderStep('brandPanel', renderBrandPanel);

  // 2. Deferred & Non-Essential Data Fetching: Runs in the background
  (async () => {
    const promises = [
      request('/api/actions').catch(() => []),
      request('/api/action-history').catch(() => []),
      request(llmAuditUrl).catch(() => []),
      request(chatTelemetryUrl).catch(() => []),
      request(tracesUrl).catch(() => ({ traces: [], selectedTraceEvents: [] })),
      request('/api/events?limit=8').catch(() => []),
      request('/api/retrieval/alerts').catch(() => ({ alerts: [] })),
      request('/api/retrieval/prioritized-alerts').catch(() => null),
      request('/api/telemetry/summary?window=' + state.telemetryWindow).catch(() => null),
      request('/api/runtime/excellence?window=' + state.telemetryWindow).catch(() => null),
      request('/api/release/validation/latest').catch(() => ({ report: null })),
      request('/api/release/decision/latest').catch(() => ({ report: null })),
      request('/api/self-review/latest').catch(() => ({ report: null })),
      request('/api/self-review/history?limit=5').catch(() => ({ reports: [] })),
      request('/api/session-packages').catch(() => ({ packages: [], releaseSnapshot: null })),
      request('/api/session-packages/history?limit=12').catch(() => ({ history: [] })),
      request('/api/settings').catch(() => ({ settings: null })),
      request('/api/agents').catch(() => ({ agents: [], swarms: [], telemetry: null })),
      request('/api/computer/system-info').catch(() => null),
      request('/api/tools/status').catch(() => ({ tools: {} })),
      request('/api/plugins/status').catch(() => ({ plugins: {} })),
      request('/api/llm/modalities').catch(() => ({ modalities: [] }))
    ];

    // Defer the model matrix request completely unless settings tab is active
    let matrixPromiseIndex = -1;
    if (state.activeTab === 'settings') {
      matrixPromiseIndex = promises.length;
      promises.push(request('/api/models/matrix').catch(() => ({ models: [] })));
    }

    const results = await Promise.all(promises);

    const actions = results[0];
    const actionHistory = results[1];
    const llmAuditEvents = results[2];
    const chatTelemetryPayload = results[3];
    const traceData = results[4];
    const events = results[5];
    const retrievalData = results[6];
    const prioritizedAlertsData = results[7];
    const telemetrySummaryData = results[8];
    const runtimeExcellenceData = results[9];
    const releaseValidationData = results[10];
    const releaseDecisionData = results[11];
    const selfReviewLatest = results[12];
    const selfReviewHistory = results[13];
    const packagePayload = results[14];
    const packageHistoryPayload = results[15];
    const settingsPayload = results[16];
    const agentDataPayload = results[17];
    const computerSystemInfoPayload = results[18];
    const toolsStatusPayload = results[19];
    const pluginsStatusPayload = results[20];
    const llmModalitiesPayload = results[21];
    const modelMatrixPayload = matrixPromiseIndex !== -1 ? results[matrixPromiseIndex] : null;

    state.agentData = agentDataPayload || null;
    state.computerSystemInfo = computerSystemInfoPayload || null;
    var serverTools = (toolsStatusPayload && toolsStatusPayload.tools) || {};
    state.toolCatalog = Array.isArray(toolsStatusPayload && toolsStatusPayload.catalog)
      ? toolsStatusPayload.catalog
      : [];
    for (var tk in serverTools) {
      if (!state.toolStates[tk]) state.toolStates[tk] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
      var st = serverTools[tk];
      state.toolStates[tk].invocations = st.invocations || 0;
      state.toolStates[tk].successes = st.successes || 0;
      state.toolStates[tk].failures = st.failures || 0;
      state.toolStates[tk].avgLatencyMs = st.avgLatencyMs || 0;
      state.toolStates[tk].lastInvoked = st.lastInvoked || null;
      state.toolStates[tk].lastError = st.lastError || null;
      if (typeof st.enabled === 'boolean') state.toolStates[tk].enabled = st.enabled;
    }
    var serverPlugins = (pluginsStatusPayload && pluginsStatusPayload.plugins) || {};
    for (var pk in serverPlugins) {
      if (!state.pluginStates[pk]) state.pluginStates[pk] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, uptime: 100, lastChecked: null };
      var sp = serverPlugins[pk];
      state.pluginStates[pk].requests = sp.requests || 0;
      state.pluginStates[pk].errors = sp.errors || 0;
      state.pluginStates[pk].avgResponseMs = sp.avgResponseMs || 0;
      state.pluginStates[pk].lastChecked = sp.lastChecked || null;
      if (typeof sp.enabled === 'boolean') state.pluginStates[pk].enabled = sp.enabled;
      if (typeof sp.healthy === 'boolean') state.pluginStates[pk].healthy = sp.healthy;
    }
    var modalitySummary = llmModalitiesPayload || null;
    state.llmModalitySummary = modalitySummary;
    if (modalitySummary && Array.isArray(modalitySummary.modalities) && modalitySummary.modalities.length > 0) {
      state.availableModalities = modalitySummary.modalities;
    }
    if (modelMatrixPayload) {
      state.modelMatrixEntries = [
        ...(Array.isArray(modelMatrixPayload.runtime) ? modelMatrixPayload.runtime : []),
        ...(Array.isArray(modelMatrixPayload.known) ? modelMatrixPayload.known : []),
      ];
    }
    state.actions = actions;
    state.actionHistory = actionHistory;
    state.llmAuditEvents = llmAuditEvents;
    state.chatTelemetry = (Array.isArray(chatTelemetryPayload) ? chatTelemetryPayload : []).filter(function (e) { return e.operation && (e.operation.startsWith('chat.') || e.operation.startsWith('llm.')); });
    state.traceData = traceData;
    state.events = events;
    state.selfReviewLatest = selfReviewLatest ? (selfReviewLatest.report || null) : null;
    state.selfReviewHistory = selfReviewHistory ? (selfReviewHistory.reports || []) : [];
    state.retrievalAlerts = retrievalData ? (retrievalData.alerts || []) : [];
    state.prioritizedAlerts = prioritizedAlertsData || null;
    state.telemetrySummary = telemetrySummaryData || null;
    state.runtimeExcellence = runtimeExcellenceData || null;
    state.releaseValidation = releaseValidationData ? (releaseValidationData.report || null) : null;
    state.releaseDecision = releaseDecisionData ? (releaseDecisionData.report || null) : null;
    state.sessionPackages = packagePayload ? (Array.isArray(packagePayload.packages) ? packagePayload.packages : []) : [];
    state.packageReleaseSnapshot = packagePayload ? (packagePayload.releaseSnapshot || null) : null;
    state.sessionPackageHistory = packageHistoryPayload ? (Array.isArray(packageHistoryPayload.history) ? packageHistoryPayload.history : []) : [];
    state.runtimeSettings = settingsPayload ? (settingsPayload.settings || null) : null;
    reconcileExpandedSessionPackages();
    if (state.selectedTraceId && (!traceData || !traceData.traces || !traceData.traces.some(trace => trace.correlationId === state.selectedTraceId))) {
      state.selectedTraceId = null;
    }
    if (typeof window !== 'undefined' && typeof window.render === 'function') {
      window.render();
    }
  })().catch(err => console.error('[refreshChrome] deferred fetch error:', err));
}

export
  function renderSessions() {
  const container = document.getElementById('session-list');
  if (!state.sessions.length) {
    container.innerHTML = '<div class="empty-state">No saved sessions yet.</div>';
    return;
  }

  const renderSessionCard = function (session, extraClass) {
    const preview = session.lastMessagePreview || 'Start a new conversation.';
    const activeClass = state.selectedSessionId === session.sessionId ? ' active' : '';
    const className = (extraClass ? ' ' + extraClass : '');
    const onClick = extraClass === 'session-chapter'
      ? 'event.stopPropagation(); selectSession(this.dataset.sessionId)'
      : 'selectSession(this.dataset.sessionId)';
    // Phase E3b: governance badge — bound character + CAC placeholder warning.
    const charBadge = session.characterId
      ? '<span class="session-badge" title="Bound character" style="display:inline-block;padding:1px 6px;margin-right:4px;border-radius:8px;background:var(--surface-alt,rgba(255,255,255,0.08));font-size:10px;">🎭 ' + escapeHtml(session.characterId) + '</span>'
      : '<span class="session-badge" title="No character bound" style="display:inline-block;padding:1px 6px;margin-right:4px;border-radius:8px;background:rgba(220,53,69,0.25);color:#ffb8c0;font-size:10px;">⚠ unbound</span>';
    const placeholderEmail = (e) => {
      if (!e) return true;
      const s = String(e).toLowerCase();
      return s.endsWith('@prism.local') || s.endsWith('@placeholder');
    };
    const cacBadge = (placeholderEmail(session.operatorEmail) || placeholderEmail(session.assistantEmail))
      ? '<span class="session-badge" title="CAC uses placeholder email — fix via setup wizard" style="display:inline-block;padding:1px 6px;border-radius:8px;background:rgba(255,193,7,0.25);color:#ffd86b;font-size:10px;">⚠ placeholder CAC</span>'
      : '';
    const governanceRow = (charBadge || cacBadge)
      ? '<div class="session-governance" style="margin-top:4px;">' + charBadge + cacBadge + '</div>'
      : '';
    return '<div class="session-card' + activeClass + className + '" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="' + onClick + '">'
      + '<div class="session-title">' + escapeHtml(session.title) + '</div>'
      + '<div class="session-preview">' + escapeHtml(preview) + '</div>'
      + governanceRow
      + '<div class="session-meta"><span>' + escapeHtml(String(session.messageCount)) + ' msgs</span><span>' + escapeHtml(formatRelativeTime(session.updatedAt)) + '</span></div>'
      + '<div class="action-buttons">'
      + '<button class="danger-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="deleteSession(event, this.dataset.sessionId)">Delete</button>'
      + '<button class="secondary-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="renameSession(event, this.dataset.sessionId)">Rename</button>'
      + '<button class="secondary-button" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="copySession(event, this.dataset.sessionId)">Copy Session</button>'
      + '</div>'
      + '</div>';
  };

  const timeline = buildSessionTimeline();
  container.innerHTML = timeline.map(entry => {
    if (entry.type === 'session') {
      return renderSessionCard(entry.session);
    }

    const expanded = Boolean(state.expandedSessionPackages[entry.pkg.packageId]);
    const childHtml = expanded
      ? '<div class="session-package-children">'
      + entry.sessions.map(session => renderSessionCard(session, 'session-chapter')).join('')
      + '</div>'
      : '';

    const pkgStatus = entry.pkg.status || 'planned';
    const summary = entry.pkg.summary || {};
    const canPause = pkgStatus === 'running';
    const canResume = pkgStatus === 'planned' || pkgStatus === 'blocked';
    return '<div class="session-card session-package-card" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="toggleSessionPackage(this.dataset.packageId)">'
      + '<div class="session-package-head">'
      + '<div class="session-title">' + escapeHtml(entry.pkg.title) + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<button class="pkg-status-badge ' + escapeHtml(pkgStatus) + '" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="cyclePackageStatus(event, this.dataset.packageId)" title="Click to advance status">' + escapeHtml(pkgStatus.toUpperCase()) + '</button>'
      + '<div class="session-package-badge">' + (expanded ? 'Collapse' : 'Expand') + '</div>'
      + '</div>'
      + '</div>'
      + (entry.pkg.areaOfInterest
        ? '<div class="session-preview">Area: ' + escapeHtml(entry.pkg.areaOfInterest) + '</div>'
        : '')
      + (entry.pkg.objective
        ? '<div class="session-preview">Objective: ' + escapeHtml(entry.pkg.objective) + '</div>'
        : '')
      + (entry.pkg.successCriteria
        ? '<div class="session-preview">Success: ' + escapeHtml(entry.pkg.successCriteria) + '</div>'
        : '')
      + ((entry.pkg.dependencies || []).length
        ? '<div class="session-preview">Dependencies: ' + escapeHtml(entry.pkg.dependencies.join(', ')) + '</div>'
        : '')
      + '<div class="session-preview">Session chapters: ' + escapeHtml(String(entry.sessions.length)) + '</div>'
      + (summary.lastActiveSessionTitle
        ? '<div class="session-preview">Last active: ' + escapeHtml(summary.lastActiveSessionTitle) + ' · ' + escapeHtml(formatRelativeTime(summary.lastActiveAt)) + '</div>'
        : '')
      + '<div class="session-preview">Progress: ' + escapeHtml(String(summary.completedChapterCount || 0)) + '/' + escapeHtml(String(summary.chapterCount || entry.sessions.length)) + ' chapters active (' + escapeHtml(String(summary.completionPct || 0)) + '%)</div>'
      + '<div class="session-preview">Policy: ' + escapeHtml(summary.latestPolicyDecision || 'none') + ' · Pending approvals: ' + escapeHtml(String(summary.pendingApprovalCount || 0)) + '</div>'
      + '<div class="session-meta"><span>Package</span><span>' + escapeHtml(formatRelativeTime(entry.timestamp)) + '</span></div>'
      + '<div class="session-package-actions">'
      + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="runPackageWorkflow(event, this.dataset.packageId)">Run Package Workflow</button>'
      + (canResume
        ? '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;running&quot;, &quot;Package resumed from controls.&quot;)">Resume</button>'
        : '')
      + (canPause
        ? '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;planned&quot;, &quot;Package paused from controls.&quot;)">Pause</button>'
        : '')
      + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;blocked&quot;, &quot;Package marked blocked from controls.&quot;)">Mark Blocked</button>'
      + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="setPackageStatus(event, this.dataset.packageId, &quot;complete&quot;, &quot;Package marked complete from controls.&quot;)">Complete</button>'
      + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="exportPackageTrace(event, this.dataset.packageId)">Export Trace</button>'
      + '<button class="secondary-button" data-package-id="' + escapeHtml(entry.pkg.packageId) + '" onclick="unpackageSessionPackage(event, this.dataset.packageId)">Unpackage</button>'
      + '</div>'
      + childHtml
      + '</div>';
  }).join('');
}

export
  function renderOnboarding() {
  const container = document.getElementById('onboarding');
  if (!state.readiness) {
    container.innerHTML = '<div class="muted">Checking readiness...</div>';
    return;
  }

  const checklist = state.readiness.requirements || [];
  if (state.readiness.ready) {
    container.innerHTML = '<div class="onboarding-title">System ready</div>'
      + '<div class="muted">Provider and model are configured for this session.</div>';
    return;
  }

  const recommendations = (state.readiness.recommendations || []).map(item =>
    '<li>' + escapeHtml(String(item)) + '</li>'
  ).join('');

  var passCount = checklist.filter(function (i) { return i.passed; }).length;
  var failCount = checklist.length - passCount;
  var failedItems = checklist.filter(function (i) { return !i.passed; });
  var passedItems = checklist.filter(function (i) { return i.passed; });
  var infoItems = checklist.filter(function (i) { return i.severity === 'info'; });

  container.innerHTML = '<div class="onboarding-title">First-run checklist</div>'
    + '<div class="onboarding-summary">'
    + '<span class="count-pass">\u2713 ' + passCount + ' passed</span>'
    + '<span class="count-fail">\u2717 ' + failCount + ' remaining</span>'
    + '</div>'
    + (failedItems.length > 0
      ? '<div class="onboarding-list" style="margin-top:8px;">'
      + failedItems.map(function (item) {
        return '<div class="failed">\u2717 ' + escapeHtml(item.label) + ' \u2014 ' + escapeHtml(item.detail || '') + '</div>';
      }).join('')
      + '</div>'
      : '')
    + (infoItems.length > 0
      ? '<div class="onboarding-info-section" style="margin-top:8px;">'
      + '<div class="onboarding-info-header muted" style="font-size:11px;margin-bottom:4px;cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===&#39;none&#39;?&#39;&#39;:&#39;none&#39;">\u2139 ' + infoItems.length + ' info item' + (infoItems.length !== 1 ? 's' : '') + ' <span style="font-size:9px;">(click to expand)</span></div>'
      + '<div class="onboarding-list" style="display:none;">'
      + infoItems.map(function (item) {
        var ckId = escapeHtml(item.id || '');
        return '<div class="info" style="cursor:pointer;padding:3px 0;" onclick="this.querySelector(&#39;.onboard-detail&#39;).style.display=this.querySelector(&#39;.onboard-detail&#39;).style.display===&#39;none&#39;?&#39;&#39;:&#39;none&#39;">'
          + '\u2139 ' + escapeHtml(item.label)
          + '<div class="onboard-detail muted" style="display:none;font-size:11px;margin-left:16px;margin-top:2px;">' + escapeHtml(item.detail || 'No additional detail.') + '</div>'
          + '</div>';
      }).join('')
      + '</div>'
      + '</div>'
      : '')
    + '<button class="secondary-button" id="onboarding-expand-btn" onclick="toggleOnboardingExpand()">Show all ' + checklist.length + ' checks</button>'
    + '<div class="onboarding-list" id="onboarding-full-list" style="display:none;margin-top:8px;">'
    + checklist.map(function (item) {
      return '<div class="' + (item.passed ? 'passed' : 'failed') + '">'
        + (item.passed ? '\u2713 ' : '\u2717 ')
        + escapeHtml(item.label)
        + ' \u2014 ' + escapeHtml(item.detail || '')
        + '</div>';
    }).join('')
    + '</div>'
    + '<div class="action-buttons" style="margin-top:10px;">'
    + '<button class="secondary-button" onclick="setActiveTab(&quot;settings&quot;)">Open Provider & Settings</button>'
    + '</div>'
    + (recommendations ? '<ul class="muted" style="margin:10px 0 0 18px; padding:0;">' + recommendations + '</ul>' : '');
}

export
  function renderToolBlocks(metadata) {
  if (!metadata || !metadata.events || !metadata.events.length) return '';
  var toolEvents = metadata.events.filter(function (e) { return e.type === 'tool_call' || e.type === 'tool_result'; });
  if (!toolEvents.length) return '';
  var blocks = [];
  for (var i = 0; i < toolEvents.length; i += 2) {
    var call = toolEvents[i];
    var result = toolEvents[i + 1];
    var name = call ? (call.tool || call.name || 'tool') : 'tool';
    var ok = result && result.type === 'tool_result' && (result.ok !== false);
    var statusClass = ok ? 'ok' : 'fail';
    var statusText = ok ? '\u2713' : '\u2717';

    // Build command display from tool call input + result output
    var commandHtml = '';
    if (call) {
      var input = (call.toolCall && call.toolCall.arguments) || call.input || call.params || call.arguments || {};
      if (typeof input === 'string') {
        commandHtml = '<div style="white-space:pre-wrap;word-break:break-all;">' + escapeHtml(input) + '</div>';
      } else if (typeof input === 'object' && Object.keys(input).length > 0) {
        try {
          commandHtml = '<div class="mono" style="white-space:pre-wrap;word-break:break-all;">' + escapeHtml(JSON.stringify(input, null, 2)) + '</div>';
        } catch (e) {
          commandHtml = '<div class="muted">Unable to display arguments</div>';
        }
      } else {
        commandHtml = '<div class="muted">No arguments</div>';
      }
    }
    // Append result output if available
    var resultOutput = result && result.toolResult && result.toolResult.output;
    if (resultOutput && typeof resultOutput === 'string') {
      var preview = resultOutput.length > 1024 ? resultOutput.substring(0, 1024) + '\u2026' : resultOutput;
      commandHtml += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);">'
        + '<span class="muted" style="font-size:11px;">Result:</span>'
        + '<div class="mono" style="white-space:pre-wrap;word-break:break-all;margin-top:2px;">' + escapeHtml(preview) + '</div>'
        + '</div>';
    }

    var viewBtn = '';
    if (name === 'browser_control' || name === 'browser_create') {
      viewBtn = '<button class="secondary-button" style="margin-left:10px;font-size:11px;padding:2px 8px;" onclick="event.stopPropagation(); try{ if(typeof setActiveTab===\'function\'){ setActiveTab(\'browser\'); } if(typeof setBrowserView===\'function\'){ setBrowserView(\'viewport\'); } }catch(e){console.error(e);} return false;">View in Browser Control</button>';
    }

    blocks.push(
      '<div class="tool-block" onclick="this.classList.toggle(&quot;expanded&quot;)">'
      + '<div class="tool-block-header">'
      + '<span class="tool-block-icon">\u{1F527}</span>'
      + '<span class="tool-block-name">' + escapeHtml(name) + '</span>'
      + viewBtn
      + '<span class="tool-block-status ' + statusClass + '">' + statusText + '</span>'
      + '</div>'
      + '<div class="tool-block-body">'
      + commandHtml
      + '</div>'
      + '</div>'
    );
  }
  return blocks.join('');
}

export
  function renderMessages() {
  const container = document.getElementById('messages');
  if (!state.messages.length) {
    container.innerHTML = '<div class="empty-state"><strong>How can I help you today?</strong>Ask for status, approvals, history, or trigger actions like <span class="mono">run workflow demo</span>.</div>';
    return;
  }

  const rows = state.messages.map(message => {
    const roleLabel = message.role === 'user' ? 'Operator' : message.role === 'assistant' ? 'PRISM' : 'System';
    let extraHtml = '';
    if (message.metadata && message.metadata.intent === 'llm_error') {
      extraHtml = '<div style="margin-top: 14px;"><button class="secondary-button" style="font-size:12px; padding:8px 12px; display:inline-flex; align-items:center; gap:6px;" onclick="setActiveTab(&quot;logs&quot;)">&#x1F50D; Open Logs</button></div>';
    }
    // Tool execution blocks for agentic replies
    if (message.metadata && message.metadata.intent === 'llm_agentic') {
      extraHtml += renderToolBlocks(message.metadata);
      if (message.metadata.toolCallsExecuted) {
        extraHtml += '<div class="muted" style="font-size:11px;margin-top:6px;">\u{1F527} '
          + message.metadata.toolCallsExecuted + ' tool call(s) in '
          + (message.metadata.iterations || '?') + ' iteration(s)</div>';
      }
    }

    // Spectrum Refraction (SR) response badge and timing
    if (message.metadata && message.metadata.intent === 'llm_sr') {
      extraHtml += '<div style="margin-top:8px;padding:8px 12px;border-radius:6px;background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(59,130,246,0.08));border:1px solid rgba(139,92,246,0.25);">';
      extraHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      extraHtml += '<span style="font-size:14px;">\u{1F308}</span>';
      extraHtml += '<span style="font-size:11px;font-weight:600;color:#a78bfa;">Spectrum Refraction</span>';
      // Isolation level badge
      if (message.metadata.isolationLevel) {
        var isoLvl = message.metadata.isolationLevel;
        var isoC = isoLvl === 'full' ? '#7cf1c8' : isoLvl === 'model' ? '#4dabf7' : '#ff8787';
        var isoL = isoLvl === 'full' ? '\u{1F512} Full' : isoLvl === 'model' ? '\u{1F50F} Model' : '\u26D4 None';
        extraHtml += '<span style="font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;background:' + isoC + '20;color:' + isoC + ';border:1px solid ' + isoC + '40;">' + isoL + '</span>';
      }
      if (message.metadata.timing) {
        extraHtml += '<span class="muted" style="font-size:10px;">Fan-out: ' + message.metadata.timing.fanOutMs + 'ms | Aggregation: ' + message.metadata.timing.aggregationMs + 'ms | Total: ' + message.metadata.timing.totalMs + 'ms</span>';
      }
      extraHtml += '</div>';
      var hemi = message.metadata.hemispheres || {};
      if (hemi.left) extraHtml += '<span style="font-size:10px;color:#4dabf7;margin-right:8px;">\u{1F9E0} ' + escapeHtml(hemi.left.model || '') + '</span>';
      if (hemi.right) extraHtml += '<span style="font-size:10px;color:#f06595;margin-right:8px;">\u{1F3A8} ' + escapeHtml(hemi.right.model || '') + '</span>';
      if (hemi.main) extraHtml += '<span style="font-size:10px;color:#7cf1c8;">\u{1F4E1} ' + escapeHtml(hemi.main.model || '') + '</span>';
      if (message.metadata.mediaArtifactCount > 0) {
        extraHtml += '<div class="muted" style="font-size:10px;margin-top:4px;">\u{1F4CE} ' + message.metadata.mediaArtifactCount + ' media artifact(s) from Creative hemisphere</div>';
      }
      extraHtml += '</div>';
    }

    const contentHtml = message.role === 'assistant' ? renderMarkdown(message.content) : renderMarkdown(escapeHtml(message.content));

    // ── v0.20.3: render attachment chips on user message bubbles ──
    // Additive — only emits markup when attachments are present, so messages
    // without attachments render byte-identically to prior versions.
    let attachmentsHtml = '';
    if (message.attachments && message.attachments.length) {
      attachmentsHtml = '<div class="message-attachments" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">'
        + message.attachments.map(function (att) {
          var isImage = att.mimeType && att.mimeType.indexOf('image/') === 0;
          var href = '/api/attachments/' + encodeURIComponent(att.attachmentId);
          if (isImage) {
            return '<a href="' + href + '" target="_blank" class="attachment-chip" title="' + escapeHtml(att.fileName) + '">'
              + '<img src="' + href + '" alt="' + escapeHtml(att.fileName) + '" style="height:48px;border-radius:4px;object-fit:cover;" />'
              + '</a>';
          }
          return '<a href="' + href + '" target="_blank" class="attachment-chip" title="' + escapeHtml(att.fileName) + '">'
            + '\u{1F4C4} <span>' + escapeHtml(att.fileName) + '</span>'
            + '</a>';
        }).join('')
        + '</div>';
    } else if (message._optimisticAttachments && message._optimisticAttachments.length) {
      // Optimistic local user-message bubble — mirror pendingAttachments before server roundtrip.
      attachmentsHtml = '<div class="message-attachments" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">'
        + message._optimisticAttachments.map(function (att) {
          var isImage = att.type && att.type.indexOf('image/') === 0;
          if (isImage) {
            return '<span class="attachment-chip" title="' + escapeHtml(att.name) + '">'
              + '<img src="' + att.dataUrl + '" alt="' + escapeHtml(att.name) + '" style="height:48px;border-radius:4px;object-fit:cover;" />'
              + '</span>';
          }
          return '<span class="attachment-chip" title="' + escapeHtml(att.name) + '">'
            + '\u{1F4C4} <span>' + escapeHtml(att.name) + '</span>'
            + '</span>';
        }).join('')
        + '</div>';
    }

    return '<div class="message ' + escapeHtml(message.role) + '">'
      + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
      + '<div>' + contentHtml + '</div>'
      + attachmentsHtml
      + extraHtml
      + '<div class="message-time">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>'
      + '</div>';
  }).join('');

  const streamBlock = state.agenticStream && state.agenticStream.length
    ? '<div class="message assistant"><div class="message-label">PRISM</div>'
    + state.agenticStream.map(function (ev) {
      if (ev.type === 'text') return '<div>' + renderMarkdown(ev.text || '') + '</div>';
      if (ev.type === 'tool_call') {
        var tn = (ev.toolCall && ev.toolCall.name) || 'tool';
        var iter = ev.iteration != null ? ev.iteration : '';
        var isBrowser = tn === 'browser_control' || tn === 'browser_create';
        var btnText = isBrowser ? 'View in Browser Control' : 'View in Agentic';
        var btnClick = isBrowser
          ? "try{ if(typeof setActiveTab===\'function\'){ setActiveTab(\'browser\'); } if(typeof setBrowserView===\'function\'){ setBrowserView(\'viewport\'); } }catch(e){console.error(e);} return false;"
          : "try{ if(typeof setActiveTab===\'function\'){ setActiveTab(\'agentic\'); } if(typeof refreshAutonomousGoals===\'function\'){ refreshAutonomousGoals(); } }catch(e){console.error(e);} return false;";
        return '<div class="tool-block" title="' + escapeHtml(tn) + (iter ? ' (iteration ' + iter + ')' : '') + '">'
          + '<div class="tool-block-header"><span class="tool-block-icon">\u{1F527}</span>'
          + '<span class="tool-block-name" style="margin-left:8px;font-weight:600;">' + escapeHtml(tn) + '</span>'
          + '<span class="muted" style="margin-left:8px;font-size:11px;">' + (iter ? 'iter ' + iter : '') + '</span>'
          + '<span class="streaming-dot" style="margin-left:8px"></span>'
          + '<button class="secondary-button" style="margin-left:10px;font-size:11px;padding:2px 8px;" onclick="' + btnClick + '">' + btnText + '</button>'
          + '</div></div>';
      }
      if (ev.type === 'tool_result') { var rn = (ev.toolResult && ev.toolResult.name) || 'tool'; return '<div class="muted" style="font-size:11px;">\u2713 ' + escapeHtml(rn) + ' done</div>'; }
      return '';
    }).join('')
    + '</div>'
    : '';

  const typing = (state.busy && !state.agenticStream.length) || (state.lastThinkingTrace && state.lastThinkingTrace.length)
    ? '<div class="message assistant thinking-indicator" onclick="showThinkingTraceModal()" style="cursor:pointer;" title="Click to view live cognitive trace">'
    + '<div class="message-label">PRISM <span class="thinking-badge" style="background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.3);padding:2px 6px;border-radius:4px;">thinking</span></div>'
    + '<div class="thinking-dots"><span></span><span></span><span></span></div>'
    + '</div>'
    : '';
  container.innerHTML = rows + streamBlock + typing;
  container.scrollTop = container.scrollHeight;
}

export
  function renderOverview() {
  const container = document.getElementById('runtime-overview');
  if (!container) return;
  if (!state.status) {
    container.innerHTML = '<div class="muted">Loading runtime status...</div>';
    return;
  }
  const lastEvent = state.status.lastEvent;
  container.innerHTML = [
    metricRow('Session', state.status.sessionId),
    metricRow('Started', formatRelativeTime(state.status.startedAt)),
    metricRow('Uptime', String(state.status.uptimeSeconds) + 's'),
    metricRow('Events', String(state.status.eventCount)),
    metricRow('Last event', lastEvent ? lastEvent.operation + ' (' + lastEvent.status + ')' : 'none')
  ].join('');
}

export
  function renderBrandPanel() {
  var panel = document.getElementById('brand-panel');
  if (!panel) return;
  var s = state.status;
  if (!s) return;

  var segment = (s.executionProfileSegment || 'individual').toLowerCase();
  var isDemo = s.mode === 'demo';
  var badgeClass = isDemo ? 'demo' : segment;
  var badgeLabel = isDemo ? 'DEMO' : segment.toUpperCase();
  var envProfile = s.environmentProfile || 'dev';
  var envDotClass = envProfile === 'prod' ? 'prod' : (envProfile === 'staging' ? 'staging' : 'dev');

  // PRISM WebSocket Real-Time Tunnel Status Extraction
  var wsStatus = 'CONNECTED (LIVE)';
  var wsBg = '#22c55e';
  var wsColor = '#34d399';
  var existingDot = document.getElementById('prism-ws-status');
  if (existingDot) {
    wsBg = existingDot.style.background || '#22c55e';
    var existingTxt = document.getElementById('prism-ws-status-text');
    if (existingTxt) {
      wsStatus = existingTxt.textContent || 'CONNECTED (LIVE)';
      wsColor = existingTxt.style.color || '#34d399';
    }
  }

  var html = '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">'
    + '<div class="eyebrow" style="margin-bottom: 0;">Frontier Operator Console</div>'
    + '<button id="system-shutdown-btn" onclick="triggerSystemShutdown()" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.45); color: #f87171; border-radius: 6px; padding: 2px 6px; font-size: 9px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 3px; text-transform: uppercase; letter-spacing: 0.5px; height: 18px; line-height: 1;" onmouseover="this.style.background=\'rgba(239, 68, 68, 0.28)\'; this.style.boxShadow=\'0 0 8px rgba(239, 68, 68, 0.25)\'" onmouseout="this.style.background=\'rgba(239, 68, 68, 0.12)\'; this.style.boxShadow=\'none\'">'
    + '<span>🛑</span> Shutdown'
    + '</button>'
    + '</div>'
    + '<h1>PRISM Chat</h1>'
    + '<div class="brand-profile-badge ' + badgeClass + '">' + badgeLabel + '</div>'
    + '<div class="brand-info-grid">'
    + '<div class="brand-info-item"><span class="brand-info-label">Env</span><br><span class="brand-info-value"><span class="brand-env-dot ' + envDotClass + '"></span>' + escapeHtml(envProfile) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Mode</span><br><span class="brand-info-value">' + escapeHtml(s.mode || 'server') + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Uptime</span><br><span class="brand-info-value">' + formatUptime(s.uptimeSeconds) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Version</span><br><span class="brand-info-value">v0.2.0</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Sessions</span><br><span class="brand-info-value">' + (s.chatSessionCount || 0) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Events</span><br><span class="brand-info-value">' + (s.eventCount || 0) + '</span></div>'
    + '</div>'
    + '<div class="muted" style="margin-top:8px;">http://localhost:' + (location.port || '7070') + '</div>'
    + '<!-- PRISM WebSocket Real-Time Tunnel Indicator -->'
    + '<div class="ws-connection-panel" style="display:flex;align-items:center;gap:10px;margin-top:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:8px 12px;font-size:11px;">'
    + '<span id="prism-ws-status" style="width:8px;height:8px;border-radius:50%;background:' + wsBg + ';box-shadow:0 0 6px rgba(34,197,94,0.5);transition:background 0.3s;display:inline-block;" data-tip-id="shell:ws-status" data-tip-kind="shell" tabindex="0" role="status" aria-label="WebSocket connection status"></span>'
    + '<div style="display:flex;flex-direction:column;gap:2px;">'
    + '<span style="font-weight:600;color:#ddd;letter-spacing:0.3px;font-size:10px;text-transform:uppercase;">Frontier WS Tunnel</span>'
    + '<span id="prism-ws-status-text" style="font-size:9px;color:' + wsColor + ';font-weight:700;letter-spacing:0.5px;">' + wsStatus + '</span>'
    + '</div>'
    + '</div>';

  // ── Preserve existing paradigm panel state before re-render ──
  var existingBadge = document.getElementById('prism-paradigm-badge');
  var badgeText = existingBadge ? existingBadge.innerText : 'LOADING';
  var badgeBg = existingBadge ? (existingBadge.style.background || '#3b82f6') : '#3b82f6';
  var badgeColor = existingBadge ? (existingBadge.style.color || '#fff') : '#fff';
  var badgeShadow = existingBadge ? (existingBadge.style.boxShadow || '') : '';
  var existingDesc = document.getElementById('prism-paradigm-desc');
  var descHtml = existingDesc ? existingDesc.innerHTML : 'Querying active constraints...';
  var existingLog = document.getElementById('prism-paradigm-log');
  var logHtml = existingLog ? existingLog.innerHTML : '<div>[SYSTEM] Booting active paradigm...</div>';

  // Preserve button highlight states
  var btnStates = {};
  ['prism-btn-basemode', 'prism-btn-perfmode', 'prism-btn-automode'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) {
      btnStates[id] = { bg: btn.style.background, border: btn.style.borderColor, color: btn.style.color };
    }
  });
  var baseBtnStyle = btnStates['prism-btn-basemode'] || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };
  var perfBtnStyle = btnStates['prism-btn-perfmode'] || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };
  var autoBtnStyle = btnStates['prism-btn-automode'] || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };

  // ── PRISM Active Resource Paradigm / Mode Switcher (persisted across renders) ──
  html += '<div id="prism-paradigm-panel" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:10px 12px;font-size:11px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;">'
    + '<span style="font-weight:600;color:#ddd;letter-spacing:0.3px;font-size:10px;text-transform:uppercase;">Resource Mode</span>'
    + '<span id="prism-paradigm-badge" class="badge badge-running" style="font-size:8px;padding:1px 5px;letter-spacing:0.5px;font-weight:800;border-radius:4px;text-transform:uppercase;background:' + badgeBg + ';color:' + badgeColor + ';box-shadow:' + badgeShadow + ';">' + badgeText + '</span>'
    + '</div>'
    + '<div style="display:flex;gap:4px;">'
    + '<button id="prism-btn-basemode" onclick="setResourceParadigm(true)" style="flex:1;background:' + baseBtnStyle.bg + ';border:1px solid ' + baseBtnStyle.border + ';color:' + baseBtnStyle.color + ';border-radius:6px;padding:5px 0;font-size:8px;font-weight:700;cursor:pointer;transition:all 0.15s;text-transform:uppercase;letter-spacing:0.3px;">'
    + '\u26A1 Base'
    + '</button>'
    + '<button id="prism-btn-perfmode" onclick="setResourceParadigm(false)" style="flex:1;background:' + perfBtnStyle.bg + ';border:1px solid ' + perfBtnStyle.border + ';color:' + perfBtnStyle.color + ';border-radius:6px;padding:5px 0;font-size:8px;font-weight:700;cursor:pointer;transition:all 0.15s;text-transform:uppercase;letter-spacing:0.3px;">'
    + '\uD83D\uDE80 Frontier'
    + '</button>'
    + '<button id="prism-btn-automode" onclick="setResourceParadigm(\'auto\')" style="flex:1;background:' + autoBtnStyle.bg + ';border:1px solid ' + autoBtnStyle.border + ';color:' + autoBtnStyle.color + ';border-radius:6px;padding:5px 0;font-size:8px;font-weight:700;cursor:pointer;transition:all 0.15s;text-transform:uppercase;letter-spacing:0.3px;">'
    + '\uD83D\uDD0D Auto'
    + '</button>'
    + '</div>'
    + '<div id="prism-paradigm-desc" style="font-size:9px;color:var(--muted);line-height:1.3;margin-top:2px;">'
    + descHtml
    + '</div>'
    + '<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">'
    + '<span style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.3px;display:block;margin-bottom:3px;">Activity Log</span>'
    + '<div id="prism-paradigm-log" style="font-size:8px;color:#cbd5e1;font-family:monospace;line-height:1.4;max-height:60px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;">'
    + logHtml
    + '</div>'
    + '</div>'
    + '</div>';

  if (s.pendingApprovals && s.pendingApprovals > 0) {
    html += '<div class="brand-approvals-badge">' + s.pendingApprovals + ' pending approval' + (s.pendingApprovals > 1 ? 's' : '') + '</div>';
  }

  panel.innerHTML = html;
}

export
  async function selectSession(sessionId) {
  state.selectedSessionId = sessionId;
  await Promise.all([loadMessages(), refreshChrome()]);
  render();
}

export
  async function deleteSession(event, sessionId) {
  event.stopPropagation();
  const existing = state.sessions.find(session => session.sessionId === sessionId);
  if (!existing) {
    return;
  }
  const confirmed = confirm('Delete session "' + existing.title + '"? This will remove all messages in this session.');
  if (!confirmed) {
    return;
  }

  state.notice = null;
  try {
    await request('/api/chat/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
    await loadSessions();

    if (!state.selectedSessionId && state.sessions.length > 0) {
      state.selectedSessionId = state.sessions[0].sessionId;
    }

    if (state.selectedSessionId) {
      await Promise.all([loadMessages(), refreshChrome()]);
    } else {
      state.messages = [];
      await refreshChrome();
    }
  } catch (error) {
    state.notice = String(error);
  }

  render();
}

export
  async function renameSession(event, sessionId) {
  event.stopPropagation();
  var session = state.sessions.find(function (s) { return s.sessionId === sessionId; });
  if (!session) return;
  var newTitle = prompt('Rename session:', session.title);
  if (!newTitle || !newTitle.trim() || newTitle.trim() === session.title) return;
  try {
    await request('/api/chat/sessions/' + encodeURIComponent(sessionId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    await loadSessions();
    safeRenderStep('sessionList', renderSessionList);
    safeRenderStep('header', renderHeader);
    state.notice = 'Session renamed.';
  } catch (err) {
    state.notice = { type: 'error', message: String(err) };
  }
  render();
}

export
  async function copySession(event, sessionId) {
  event.stopPropagation();
  const existing = state.sessions.find(session => session.sessionId === sessionId);
  if (!existing) {
    return;
  }

  const button = event.currentTarget;
  const originalText = button.textContent;
  button.textContent = "Copying...";

  try {
    const payload = await request('/api/chat/sessions/' + encodeURIComponent(sessionId) + '/messages');
    const messages = payload.messages || [];

    let textToCopy = "Session: " + existing.title + "\\n";
    textToCopy += "Date: " + new Date().toLocaleString() + "\\n\\n";

    for (const msg of messages) {
      textToCopy += "[" + msg.role.toUpperCase() + "]\\n";
      textToCopy += msg.content + "\\n\\n";
    }

    await navigator.clipboard.writeText(textToCopy.trim());
    button.textContent = "Copied!";
    button.style.backgroundColor = "#10b981";
    button.style.color = "white";
    button.style.borderColor = "#10b981";
  } catch (err) {
    console.error('Copy failed:', err);
    button.textContent = "Failed";
  }

  setTimeout(() => {
    button.textContent = originalText;
    button.style.backgroundColor = "";
    button.style.color = "";
    button.style.borderColor = "";
  }, 2000);
}

export
  function handleFileSelect(input) {
  if (!input.files || !input.files.length) return;
  Array.from(input.files).forEach(function (file) {
    if (file.size > 10 * 1024 * 1024) {
      state.notice = 'File too large (max 10MB): ' + file.name;
      render();
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      pendingAttachments.push({ file: file, dataUrl: e.target.result, name: file.name, type: file.type, size: file.size });
      renderAttachmentPreview();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

export
  async function pasteFromClipboard() {
  try {
    var foundImage = false;
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        var items = await navigator.clipboard.read();
        for (var i = 0; i < items.length; i++) {
          var types = items[i].types;
          var imgType = types.find(function (t) { return t.startsWith('image/'); });
          if (imgType) {
            foundImage = true;
            var blob = await items[i].getType(imgType);
            var file = new File([blob], 'clipboard-' + Date.now() + '.' + imgType.split('/')[1], { type: imgType });
            var reader = new FileReader();
            reader.onload = function (e) {
              pendingAttachments.push({ file: file, dataUrl: e.target.result, name: file.name, type: file.type, size: file.size });
              renderAttachmentPreview();
            };
            reader.readAsDataURL(file);
          }
        }
      } catch (_innerErr) {
        // navigator.clipboard.read() may reject (permission, no image, Firefox)
        // — fall through to text fallback below.
      }
    }
    // ── v0.20.3: text-on-clipboard fallback ──
    // If no image was captured, try readText() and inject into the composer
    // at the caret position. This makes the paste button useful for prompts
    // copied from other apps, not just images.
    if (!foundImage) {
      var text = '';
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          text = await navigator.clipboard.readText();
        }
      } catch (_textErr) {
        text = '';
      }
      if (text && text.length) {
        var composer = document.getElementById('composer');
        if (composer) {
          var start = composer.selectionStart != null ? composer.selectionStart : composer.value.length;
          var end = composer.selectionEnd != null ? composer.selectionEnd : composer.value.length;
          var before = composer.value.slice(0, start);
          var after = composer.value.slice(end);
          composer.value = before + text + after;
          composer.focus();
          var caret = (before + text).length;
          composer.setSelectionRange(caret, caret);
          composer.style.height = 'auto';
          composer.style.height = Math.min(composer.scrollHeight, 240) + 'px';
        }
      } else {
        state.notice = 'Clipboard is empty or browser blocked access. Use Ctrl+V to paste directly.';
        render();
      }
    }
  } catch (err) {
    state.notice = 'Clipboard access denied or empty.';
    render();
  }
}

export
  function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderAttachmentPreview();
}

export
  function renderAttachmentPreview() {
  var container = document.getElementById('attachment-preview');
  if (!container) return;
  container.innerHTML = pendingAttachments.map(function (att, i) {
    var preview = att.type && att.type.startsWith('image/')
      ? '<img src="' + att.dataUrl + '" style="height:24px;border-radius:4px;" />'
      : '\u{1F4C4}';
    return '<span class="attachment-chip">'
      + preview
      + ' <span>' + escapeHtml(att.name) + '</span>'
      + ' <span class="remove-btn" onclick="removeAttachment(' + i + ')">\u2715</span>'
      + '</span>';
  }).join('');
}

export
  async function uploadAttachments(sessionId, messageId) {
  for (var i = 0; i < pendingAttachments.length; i++) {
    var att = pendingAttachments[i];
    try {
      var formData = new FormData();
      formData.append('file', att.file, att.name);
      await fetch('/api/chat/sessions/' + encodeURIComponent(sessionId) + '/messages/' + encodeURIComponent(messageId) + '/attachments', {
        method: 'POST',
        body: formData
      });
    } catch (err) {
      console.warn('Attachment upload failed:', att.name, err);
    }
  }
  pendingAttachments = [];
  renderAttachmentPreview();
}

export
  function showCapModal(capType, remainingUsd) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'cap-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const over = Math.abs(remainingUsd || 0).toFixed(4);
    const capLabel = ({ session: 'session', daily: 'daily', monthly: 'monthly' })[capType] || (capType || 'spending');
    overlay.innerHTML =
      '<div style="background:#1e1e2e;border:1px solid #f38ba8;border-radius:12px;padding:24px;max-width:420px;width:90%;color:#cdd6f4;font-family:inherit;">' +
      '<h3 style="margin:0 0 12px;color:#f38ba8;">&#x1F4B0; Spending Cap Reached</h3>' +
      '<p style="margin:0 0 16px;line-height:1.5;">Your <strong>' + capLabel + '</strong> spending cap has been reached. You are <strong>$' + over + '</strong> over budget.</p>' +
      '<p style="margin:0 0 20px;color:#a6adc8;font-size:0.9em;">Proceed anyway to continue, or cancel and adjust your caps in the Telemetry tab.</p>' +
      '<div style="display:flex;gap:12px;justify-content:flex-end;">' +
      '<button id="cap-modal-cancel" style="padding:8px 16px;border:1px solid #585b70;background:transparent;color:#cdd6f4;border-radius:6px;cursor:pointer;">Cancel</button>' +
      '<button id="cap-modal-proceed" style="padding:8px 16px;border:none;background:#f38ba8;color:#1e1e2e;border-radius:6px;cursor:pointer;font-weight:bold;">Proceed anyway</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('cap-modal-proceed').onclick = () => { overlay.remove(); resolve(true); };
    document.getElementById('cap-modal-cancel').onclick = () => { overlay.remove(); resolve(false); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
  });
}

export
  async function sendMessage() {
  const composer = document.getElementById('composer');
  const content = composer.value.trim();
  if (!content || state.busy) {
    return;
  }
  dashboardLog('chat', 'chat.send', 'Sending message (' + content.length + ' chars)');
  if (!state.selectedSessionId) {
    await createSession();
  }
  if (!state.readiness || !state.readiness.ready) {
    state.notice = 'Complete the first-run checklist in Provider & Settings before sending messages.';
    if (typeof window.setActiveTab === 'function') {
      window.setActiveTab('settings');
    } else {
      state.activeTab = 'settings';
      render();
    }
    return;
  }
  state.busy = true;
  state.notice = null;
  state.agenticStream = [];
  composer.value = '';
  composer.style.height = 'auto';
  // Inform operator that some requests (purchases, transfers, orders) may
  // require approval and will run automatically after approval.
  if (/\b(buy|purchase|order|pay|transfer|wire)\b/i.test(content)) {
    state.notice = 'Note: This request may require operator approval; it will run automatically when approved.';
    render();
  }
  // Add a small 'learn more' link to explain approval+auto-run lifecycle
  const helpLink = document.getElementById('approval-help-link');
  if (!helpLink) {
    const bar = document.getElementById('right-rail');
    if (bar) {
      const el = document.createElement('div');
      el.id = 'approval-help-link';
      el.style.cssText = 'margin-top:8px;color:#a6adc8;cursor:pointer;font-size:0.9em;';
      el.textContent = 'Why might this require approval?';
      el.onclick = async () => {
        const overlay = document.createElement('div');
        overlay.id = 'approval-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = '<div style="background:#1e1e2e;border:1px solid #f38ba8;border-radius:12px;padding:24px;max-width:640px;width:90%;color:#cdd6f4;font-family:inherit;">' +
          '<h3 style="margin:0 0 12px;color:#f38ba8;">Approval & Auto-Run</h3>' +
          '<p style="margin:0 0 12px;line-height:1.5;">Certain requests that may perform purchases, transfers, or other external actions are routed through an operator approval queue for safety. When an operator approves a request, PRISM can automatically continue and execute the task using the Agentic Executor. This preserves audit trails and requires explicit operator consent.</p>' +
          '<p style="margin:0 0 12px;color:#a6adc8;font-size:0.9em;">You can disable automatic continuation in the server runtime settings (runtime setting: <strong>autoRunApprovedTier2</strong>).</p>' +
          '<div style="display:flex;gap:12px;justify-content:flex-end;">' +
          '<button id="approval-modal-close" style="padding:8px 16px;border:1px solid #585b70;background:transparent;color:#cdd6f4;border-radius:6px;cursor:pointer;">Close</button>' +
          '</div>' +
          '</div>';
        document.body.appendChild(overlay);
        document.getElementById('approval-modal-close').onclick = () => { overlay.remove(); };
      };
      bar.appendChild(el);
    }
  }
  // ── Optimistic display: show the user's message immediately ──
  state.messages.push({
    role: 'user',
    content: content,
    createdAt: new Date().toISOString(),
    _optimistic: true,
    // v0.20.3: mirror pendingAttachments locally so the operator sees
    // their attached files in the bubble before the upload roundtrip completes.
    _optimisticAttachments: Array.isArray(pendingAttachments) ? pendingAttachments.slice() : []
  });
  safeRenderStep('messages', renderMessages);
  try {
    var response = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    // Soft-block: spending cap reached — show modal and optionally re-send with override
    if (response && response.softBlock === true) {
      composer.value = content;
      state.busy = false;
      render();
      const shouldProceed = await showCapModal(response.capType, response.remainingUsd);
      if (!shouldProceed) return;
      state.busy = true;
      state.agenticStream = [];
      composer.value = '';
      composer.style.height = 'auto';
      render();
      response = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, override: true })
      });
    }
    // Upload pending attachments to the user message if any
    if (Array.isArray(pendingAttachments) && pendingAttachments.length && response && response.userMessage && response.userMessage.messageId) {
      await uploadAttachments(state.selectedSessionId, response.userMessage.messageId);
    }
    state.agenticStream = [];
    await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
  } catch (error) {
    state.notice = String(error);
    // Reload messages even on error — partial tool results or error-as-assistant-message may be stored
    state.agenticStream = [];
    try { await loadMessages(); } catch (_e) { /* best effort */ }
  } finally {
    state.busy = false;
    render();
  }
}

export
  async function runAction(name) {
  state.notice = null;
  try {
    await request('/api/actions/' + name, { method: 'POST' });
    await refreshChrome();
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function quickApplyLlm() {
  const localSelection = getLocalLlmSelection(state.selectedSessionId);
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const providerId = localSelection && localSelection.providerId
    ? localSelection.providerId
    : (providerSelect ? providerSelect.value : '');
  const model = localSelection
    ? (localSelection.model || '')
    : (modelSelect ? modelSelect.value : '');
  if (!providerId || !state.selectedSessionId) {
    return;
  }
  state.notice = null;
  try {
    state.llmCatalog = await request('/api/llm/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId, providerId: providerId, model: model })
    });
    clearLocalLlmSelection(state.selectedSessionId);
    const readiness = await request('/api/readiness/recheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId, source: 'llm_quick_apply' })
    }).catch(function () { return null; });
    await refreshChrome();
    if (readiness) {
      state.readiness = readiness;
    }
    if (providerId === 'llamacpp' || providerId === 'bitnetcpp') {
      var guardianHint = '';
      var gs = state.guardianStatus;
      if (!gs || gs.modelPath !== 'active-chat-model') {
        guardianHint = ' \uD83D\uDD17 Tip: In the Agentic Control tab, select \"\uD83D\uDD17 Share Active Chat Model\" for Guardian to share this model with zero extra memory.';
      }
      state.notice = 'Provider applied and local GGUF model loaded successfully: ' + providerId + ' / ' + (model || 'default') + '.' + guardianHint;
    } else {
      state.notice = 'Provider applied: ' + providerId + ' / ' + (model || 'default') + '.';
    }
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function refreshOllamaModels() {
  state.notice = null;
  try {
    await refreshChrome();
    state.notice = 'Model list refreshed from local server.';
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function rollbackLlmConfig() {
  if (!state.selectedSessionId) {
    return;
  }
  state.notice = null;
  try {
    clearLocalLlmSelection(state.selectedSessionId);
    const payload = await request('/api/llm/config/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.selectedSessionId })
    });
    state.llmCatalog = payload.catalog;
    state.llmConfig = payload.config;
    await refreshChrome();
    state.notice = 'Rolled back to previous applied configuration.';
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  async function approve(id) {
  await request('/api/approve/' + id, { method: 'POST' });
  await refreshChrome();
  render();
}

export
  async function deny(id) {
  await request('/api/deny/' + id, { method: 'POST' });
  await refreshChrome();
  render();
}

export
  // --- SSE streaming connection for agentic progress ---
  var _sseReconnector = createReconnector(connectAgenticStream, { label: 'sse', baseDelay: 1000, maxDelay: 30000, maxRetries: 50 });

export
  function connectAgenticStream() {
  var evtSource;
  try {
    var tokenMeta = document.querySelector('meta[name="prism-auth-token"]');
    var sseToken = tokenMeta ? tokenMeta.getAttribute('content') || '' : '';
    var sseUrl = sseToken ? '/api/chat/stream?token=' + encodeURIComponent(sseToken) : '/api/chat/stream';
    evtSource = new EventSource(sseUrl);
  } catch (err) {
    console.warn('[stream] SSE unavailable:', err);
    return;
  }
  evtSource.onopen = function () {
    _sseReconnector.reset();
  };
  evtSource.onmessage = function (event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'agentic_event') {
        var ev = data.event || data;
        if (ev.type === 'done') {
          // Preserve the just-finished live trace for post-mortem inspection
          try {
            state.lastThinkingTrace = (state.agenticStream && state.agenticStream.length) ? state.agenticStream.slice(-500).map(function (x) { return typeof trimAgenticEvent === 'function' ? trimAgenticEvent(x) : x; }) : [];
            if (state.lastThinkingTrace && state.lastThinkingTrace.length > 500) state.lastThinkingTrace = state.lastThinkingTrace.slice(-500);
          } catch (_) { state.lastThinkingTrace = state.agenticStream ? state.agenticStream.slice() : []; }
          // Clear live stream for next run
          state.agenticStream = [];
          loadMessages().then(() => safeRenderStep('messages', renderMessages));
        } else if (ev.type === 'error') {
          // LLM provider or executor error — show notice so user knows the turn failed
          state.agenticStream.push(ev);
          state.notice = ev.error || 'An error occurred during the agentic turn.';
          safeRenderStep('notice', render);
        } else {
          state.agenticStream.push(ev);
          if (ev.type === 'tool_call' && ev.toolCall) {
            state.toolCallLog.unshift({ kind: 'call', name: ev.toolCall.name || '', arguments: ev.toolCall.arguments || {}, iteration: ev.iteration, timestamp: Date.now() });
            if (state.toolCallLog.length > 200) state.toolCallLog.pop();
            safeRenderStep('toolCallLog', renderToolCallLog);
          } else if (ev.type === 'tool_result' && ev.toolResult) {
            for (var tli = 0; tli < state.toolCallLog.length; tli++) {
              if (state.toolCallLog[tli].kind === 'call' && state.toolCallLog[tli].name === (ev.toolResult.name || ev.toolResult.toolName) && !state.toolCallLog[tli].output) {
                state.toolCallLog[tli].ok = ev.toolResult.ok;
                state.toolCallLog[tli].output = typeof ev.toolResult.output === 'string' ? ev.toolResult.output : JSON.stringify(ev.toolResult.output);
                break;
              }
            }
            safeRenderStep('toolCallLog', renderToolCallLog);
          }
        }
        safeRenderStep('messages', renderMessages);
      } else if (data.type === 'log_entry') {
        state.logEntries.push(data);
        if (state.logEntries.length > 2000) state.logEntries = state.logEntries.slice(-2000);
        safeRenderStep('logsPanel', renderLogsPanel);
      }
    } catch (e) { /* ignore parse errors */ }
  };
  evtSource.onerror = function () {
    console.warn('[stream] SSE connection lost, reconnecting with backoff...');
    evtSource.close();
    _sseReconnector.schedule();
  };
}

export function showThinkingTraceModal() {
  if (document.getElementById('thinking-trace-overlay')) return;

  if (!document.getElementById('thinking-trace-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'thinking-trace-styles';
    styleEl.textContent = `
      @keyframes thinking-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes thinking-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.1); }
      }
      @keyframes modalFadeIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  const overlay = document.createElement('div');
  overlay.id = 'thinking-trace-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8, 8, 16, 0.75);backdrop-filter:blur(12px);z-index:99999;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s ease;padding:20px;box-sizing:border-box;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:rgba(22, 22, 34, 0.95);border:1px solid rgba(139, 92, 246, 0.35);border-radius:16px;box-shadow:0 12px 40px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255,255,255,0.05);width:100%;max-width:850px;height:80vh;display:flex;flex-direction:column;color:#e2e8f0;font-family:system-ui, -apple-system, sans-serif;overflow:hidden;animation:modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);box-sizing:border-box;';

  // Modal header
  const header = document.createElement('div');
  header.style.cssText = 'padding:16px 24px;border-bottom:1px solid rgba(255, 255, 255, 0.08);display:flex;align-items:center;justify-content:space-between;background:rgba(30, 27, 46, 0.5);flex-shrink:0;';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">⚡</span>
      <span style="font-weight:600;font-size:16px;letter-spacing:0.5px;background:linear-gradient(90deg, #a78bfa, #38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">PRISM Live Cognitive & Action Trace</span>
    </div>
    <button id="thinking-trace-close" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all 0.2s;">✕</button>
  `;
  modal.appendChild(header);

  // Modal body (scrollable)
  const body = document.createElement('div');
  body.id = 'thinking-trace-body';
  body.style.cssText = 'flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;';
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => {
    clearInterval(updateInterval);
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById('thinking-trace-close').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const renderContent = () => {
    let html = '';
    const trace = (state.lastThinkingTrace && state.lastThinkingTrace.length) ? state.lastThinkingTrace : (state.agenticStream || []);

    // Active Status Card
    html += `
      <div style="background:rgba(30,30,46,0.5);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px;font-size:13px;display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;box-sizing:border-box;flex-shrink:0;">
        <div><span style="color:#94a3b8;">Active Session:</span> <span style="font-family:monospace;color:#a78bfa;word-break:break-all;">${escapeHtml(state.selectedSessionId || 'none')}</span></div>
        <div><span style="color:#94a3b8;">Cognitive Mode:</span> <span style="color:#38bdf8;font-weight:600;">${state.settings?.srEnabled ? 'Spectrum Refraction' : 'Standard Pipeline'}</span></div>
        <div><span style="color:#94a3b8;">Live Event Count:</span> <span style="font-family:monospace;color:#34d399;font-weight:600;">${trace.length}</span></div>
        <div><span style="color:#94a3b8;">Status:</span> <span style="color:#fbbf24;animation:thinking-pulse 1.4s ease-in-out infinite;">🧠 processing...</span></div>
      </div>
    `;

    // Cognitive steps section
    html += `<div><h4 style="margin:0 0 10px;color:#a78bfa;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">🧠 Cognitive Processing Pipeline</h4>`;
    if (!trace || trace.length === 0) {
      html += `
        <div style="padding:32px 24px;border:1px dashed rgba(255,255,255,0.1);border-radius:8px;text-align:center;color:#94a3b8;font-style:italic;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;box-sizing:border-box;">
          <div style="width:24px;height:24px;border:2px solid #a78bfa;border-top-color:transparent;border-radius:50%;animation:thinking-spin 1s linear infinite;"></div>
          Refracting request through Creative & Logical hemispheres...
        </div>
      `;
    } else {
      html += `<div style="display:flex;flex-direction:column;gap:10px;box-sizing:border-box;">`;
      trace.forEach((ev) => {
        if (ev.type === 'text') {
          html += `
            <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);border-radius:8px;padding:12px 16px;box-sizing:border-box;">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#a78bfa;margin-bottom:6px;">
                <span>🧠</span> <span>Neural Synthesis Feed</span>
              </div>
              <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;color:#e2e8f0;">${escapeHtml(ev.text || '')}</div>
            </div>
          `;
        } else if (ev.type === 'tool_call') {
          const args = ev.toolCall?.arguments || {};
          let argsStr = '';
          try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args); }
          html += `
            <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:8px;padding:12px 16px;box-sizing:border-box;">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#38bdf8;margin-bottom:6px;">
                <span>🔧</span> <span>Invoking System Tool:</span> <span style="font-family:monospace;background:rgba(56,189,248,0.15);padding:1px 6px;border-radius:4px;">${escapeHtml(ev.toolCall?.name || '')}</span>
              </div>
              <pre style="margin:6px 0 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-family:monospace;font-size:11px;overflow-x:auto;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);box-sizing:border-box;">${escapeHtml(argsStr)}</pre>
            </div>
          `;
        } else if (ev.type === 'tool_result') {
          const ok = ev.toolResult?.ok !== false;
          const statusColor = ok ? '#34d399' : '#f87171';
          const out = ev.toolResult?.output || '';
          const preview = out.length > 500 ? out.substring(0, 500) + '...' : out;
          html += `
            <div style="background:rgba(52,211,153,0.04);border:1px solid ${statusColor}30;border-radius:8px;padding:12px 16px;box-sizing:border-box;">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:${statusColor};margin-bottom:6px;">
                <span>${ok ? '✅' : '❌'}</span> <span>Tool Result:</span> <span style="font-family:monospace;background:${statusColor}15;padding:1px 6px;border-radius:4px;">${escapeHtml(ev.toolResult?.name || 'tool')}</span>
              </div>
              <pre style="margin:6px 0 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-family:monospace;font-size:11px;overflow-x:auto;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);box-sizing:border-box;">${escapeHtml(preview)}</pre>
            </div>
          `;
        }
      });
      html += `</div>`;
    }
    html += `</div>`;

    // Live Telemetry Logs section
    html += `
      <div>
        <h4 style="margin:0 0 10px;color:#f472b6;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">📡 Live Telemetry & Activity Logs</h4>
        <div style="background:rgba(10,10,16,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;font-family:monospace;font-size:11px;line-height:1.4;box-sizing:border-box;" id="thinking-trace-logs">
    `;

    const relevantLogs = state.logEntries.filter(e =>
      e.source === 'chat' || e.source === 'llm' || e.source === 'tools' || e.source === 'diagnostics' || e.source === 'agent-diagnostics' || e.source === 'logs-diagnostics'
    ).slice(-25);

    if (relevantLogs.length === 0) {
      html += `<div style="color:#64748b;font-style:italic;text-align:center;padding:12px;">Waiting for runtime logs...</div>`;
    } else {
      relevantLogs.forEach(e => {
        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
        let color = '#94a3b8';
        if (e.severity === 'error') color = '#f87171';
        else if (e.severity === 'warn') color = '#fbbf24';
        else if (e.source === 'llm') color = '#a78bfa';
        else if (e.source === 'tools') color = '#38bdf8';

        html += `
          <div style="display:flex;gap:12px;align-items:flex-start;box-sizing:border-box;">
            <span style="color:#64748b;flex-shrink:0;">[${time}]</span>
            <span style="color:${color};font-weight:600;flex-shrink:0;width:95px;">${escapeHtml(e.source || 'system')}</span>
            <span style="color:#cbd5e1;word-break:break-all;">${escapeHtml(e.summary || e.operation || '')}</span>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;

    // Live refractor pulse footer
    html += `
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;color:#a78bfa;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;box-sizing:border-box;">
        <span style="display:inline-block;width:10px;height:10px;background:#a78bfa;border-radius:50%;box-shadow:0 0 10px #a78bfa;animation:thinking-pulse 1.4s infinite;"></span>
        <span style="font-weight:500;letter-spacing:0.3px;">Spectral Triad fanning out and synthesis engine in consensus...</span>
      </div>
    `;

    body.innerHTML = html;

    const logsEl = document.getElementById('thinking-trace-logs');
    if (logsEl) logsEl.scrollTop = logsEl.scrollHeight;
  };

  renderContent();

  const updateInterval = setInterval(() => {
    if (document.getElementById('thinking-trace-overlay')) {
      renderContent();
    } else {
      clearInterval(updateInterval);
    }
  }, 500);
}
