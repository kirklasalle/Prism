import { state, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, dashboardLog, safeRenderStep, renderStars, approvalBadge, metricRow, healthDot, timeAgo, formatUptime, authHeaders, createReconnector, trimAgenticEvent, showConfirm, showPrompt, showForm, showTransientNotice } from './dashboard-core.js';
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

  const formResult = await showForm('Create Session Package', [
    { name: 'title', label: 'Package title', defaultValue: suggestedTitle, required: true, placeholder: 'e.g. Q3 Research Sprint' },
    { name: 'areaOfInterest', label: 'Area of interest', placeholder: 'e.g. Competitor analysis, Code refactor…', description: 'Optional — topic or domain this package covers.' },
    { name: 'objective', label: 'Objective', type: 'textarea', placeholder: 'Describe the goal of this package…', description: 'Optional — what should be achieved.' },
    { name: 'successCriteria', label: 'Success criteria', type: 'textarea', placeholder: 'e.g. All tasks completed, report delivered…', description: 'Optional — measurable definition of done.' },
    { name: 'dependencies', label: 'Dependencies', placeholder: 'e.g. auth-module, data-pipeline (comma separated)', description: 'Optional — other packages or systems this depends on.' },
  ], { confirmLabel: 'Create Package', icon: '📦' });

  if (!formResult) return;

  const dependencies = (formResult.dependencies || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  await request('/api/session-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: formResult.title || suggestedTitle,
      areaOfInterest: formResult.areaOfInterest || null,
      objective: formResult.objective || null,
      successCriteria: formResult.successCriteria || null,
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

  const confirmed = await showConfirm('Unpackage "' + existing.title + '" and restore all chapters to top-level history?');
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
    // Prefer an Initialization Certificate session (provenance chain root)
    // over a generic "New Session" on first load.
    const initCertSession = state.sessions.find(s =>
      /Initialization Certificate/i.test(s.title || '')
    );
    state.selectedSessionId = initCertSession
      ? initCertSession.sessionId
      : state.sessions[0].sessionId;
  }
  if (state.selectedSessionId && !state.sessions.some(session => session.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0] ? state.sessions[0].sessionId : null;
  }

  // If the only session is the Initialization Certificate session, automatically start a new session.
  const hasOnlyInitCert = state.sessions.length === 1 && state.sessions.some(s =>
    /Initialization Certificate/i.test(s.title || '')
  );
  if (hasOnlyInitCert && !state.autoCreatingSession) {
    state.autoCreatingSession = true;
    try {
      await createSession();
    } catch (err) {
      console.error('Failed to automatically start a new session after wizard', err);
    } finally {
      state.autoCreatingSession = false;
    }
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
        const goWizard = await showConfirm('PRISM: No default character is bound to this workspace.\n\nOpen the setup wizard to pick one?');
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
      showTransientNotice('Session creation failed: ' + msg, 'error');
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
  const [status, readiness, llmCatalog, llmConfig, pending, updateInfo] = await Promise.all([
    request('/api/status').catch(() => null),
    request(readinessUrl).catch(() => null),
    request(llmUrl).catch(() => null),
    llmConfigUrl ? request(llmConfigUrl).catch(() => null) : Promise.resolve(null),
    request('/api/pending').catch(() => []),
    request('/api/update/check').catch(() => null)
  ]);

  if (status) state.status = status;
  if (readiness) state.readiness = readiness;
  if (updateInfo) state.updateInfo = updateInfo;
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
      request('/api/llm/modalities').catch(() => ({ modalities: [] })),
      request('/api/workspace/character-assignments').catch(() => ({ assignments: [] }))
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
    const characterAssignmentsPayload = results[22];
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
    state.characterAssignments = characterAssignmentsPayload ? (characterAssignmentsPayload.assignments || []) : [];
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

  const placeholderEmail = (e) => {
    if (!e) return true;
    const s = String(e).toLowerCase();
    return s.endsWith('@prism.local') || s.endsWith('@placeholder');
  };
  const hasActiveAssignment = state.characterAssignments && state.characterAssignments.some(a => a.state === 'active');

  const makeSessionCard = (session, isChapter) => {
    const card = document.createElement('div');
    card.className = 'session-card' + (state.selectedSessionId === session.sessionId ? ' active' : '') + (isChapter ? ' session-chapter' : '');
    card.dataset.sessionId = session.sessionId;
    const titleEl = document.createElement('div'); titleEl.className = 'session-title'; titleEl.textContent = session.title; card.appendChild(titleEl);
    const previewEl = document.createElement('div'); previewEl.className = 'session-preview'; previewEl.textContent = session.lastMessagePreview || 'Start a new conversation.'; card.appendChild(previewEl);
    const govRow = document.createElement('div'); govRow.className = 'session-governance'; govRow.style.marginTop = '4px';
    const charBadge = document.createElement('span'); charBadge.className = 'session-badge'; charBadge.style.cssText = 'display:inline-block;padding:1px 6px;margin-right:4px;border-radius:8px;font-size:10px;';
    if (session.characterId) { charBadge.title = 'Bound character'; charBadge.style.background = 'var(--surface-alt,rgba(255,255,255,0.08))'; charBadge.textContent = '🎭 ' + session.characterId; }
    else { charBadge.title = 'No character bound'; charBadge.style.cssText += 'background:rgba(220,53,69,0.25);color:#ffb8c0;'; charBadge.textContent = '⚠ unbound'; }
    govRow.appendChild(charBadge);
    if (!hasActiveAssignment && (placeholderEmail(session.operatorEmail) || placeholderEmail(session.assistantEmail))) {
      const cacBadge = document.createElement('span'); cacBadge.className = 'session-badge'; cacBadge.title = 'CAC uses placeholder email — fix via setup wizard'; cacBadge.style.cssText = 'display:inline-block;padding:1px 6px;border-radius:8px;background:rgba(255,193,7,0.25);color:#ffd86b;font-size:10px;'; cacBadge.textContent = '⚠ placeholder CAC'; govRow.appendChild(cacBadge);
    }
    card.appendChild(govRow);
    const meta = document.createElement('div'); meta.className = 'session-meta';
    const msgCount = document.createElement('span'); msgCount.textContent = String(session.messageCount) + ' msgs';
    const timeEl = document.createElement('span'); timeEl.textContent = formatRelativeTime(session.updatedAt);
    meta.appendChild(msgCount); meta.appendChild(timeEl); card.appendChild(meta);
    const actions = document.createElement('div'); actions.className = 'action-buttons';
    const delBtn = document.createElement('button'); delBtn.className = 'danger-button'; delBtn.textContent = 'Delete'; delBtn.onclick = (e) => { e.stopPropagation(); deleteSession(e, session.sessionId); };
    const renBtn = document.createElement('button'); renBtn.className = 'secondary-button'; renBtn.textContent = 'Rename'; renBtn.onclick = (e) => { e.stopPropagation(); renameSession(e, session.sessionId); };
    const copyBtn = document.createElement('button'); copyBtn.className = 'secondary-button'; copyBtn.textContent = 'Copy Session'; copyBtn.onclick = (e) => { e.stopPropagation(); copySession(e, session.sessionId); };
    actions.appendChild(delBtn); actions.appendChild(renBtn); actions.appendChild(copyBtn); card.appendChild(actions);
    card.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; if (isChapter) e.stopPropagation(); selectSession(session.sessionId); };
    return card;
  };

  const fragment = document.createDocumentFragment();
  const timeline = buildSessionTimeline();

  timeline.forEach(entry => {
    if (entry.type === 'session') { fragment.appendChild(makeSessionCard(entry.session, false)); return; }
    const pkg = entry.pkg;
    const pkgCard = document.createElement('div'); pkgCard.className = 'session-card session-package-card'; pkgCard.dataset.packageId = pkg.packageId;
    const expanded = Boolean(state.expandedSessionPackages[pkg.packageId]);
    const pkgStatus = pkg.status || 'planned'; const summary = pkg.summary || {};
    const canPause = pkgStatus === 'running'; const canResume = pkgStatus === 'planned' || pkgStatus === 'blocked';
    const head = document.createElement('div'); head.className = 'session-package-head';
    const pkgTitleEl = document.createElement('div'); pkgTitleEl.className = 'session-title'; pkgTitleEl.textContent = pkg.title;
    const headRight = document.createElement('div'); headRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const statusBadgeEl = document.createElement('button'); statusBadgeEl.className = 'pkg-status-badge ' + pkgStatus; statusBadgeEl.title = 'Click to advance status'; statusBadgeEl.textContent = pkgStatus.toUpperCase(); statusBadgeEl.onclick = (e) => cyclePackageStatus(e, pkg.packageId);
    const expandBadge = document.createElement('div'); expandBadge.className = 'session-package-badge'; expandBadge.textContent = expanded ? 'Collapse' : 'Expand';
    headRight.appendChild(statusBadgeEl); headRight.appendChild(expandBadge); head.appendChild(pkgTitleEl); head.appendChild(headRight); pkgCard.appendChild(head);
    const addPreview = (text) => { const el = document.createElement('div'); el.className = 'session-preview'; el.textContent = text; pkgCard.appendChild(el); };
    if (pkg.areaOfInterest) addPreview('Area: ' + pkg.areaOfInterest);
    if (pkg.objective) addPreview('Objective: ' + pkg.objective);
    if (pkg.successCriteria) addPreview('Success: ' + pkg.successCriteria);
    if ((pkg.dependencies || []).length) addPreview('Dependencies: ' + pkg.dependencies.join(', '));
    addPreview('Session chapters: ' + entry.sessions.length);
    if (summary.lastActiveSessionTitle) addPreview('Last active: ' + summary.lastActiveSessionTitle + ' · ' + formatRelativeTime(summary.lastActiveAt));
    addPreview('Progress: ' + (summary.completedChapterCount || 0) + '/' + (summary.chapterCount || entry.sessions.length) + ' chapters active (' + (summary.completionPct || 0) + '%)');
    addPreview('Policy: ' + (summary.latestPolicyDecision || 'none') + ' · Pending approvals: ' + (summary.pendingApprovalCount || 0));
    const pkgMeta = document.createElement('div'); pkgMeta.className = 'session-meta'; pkgMeta.innerHTML = '<span>Package</span><span>' + escapeHtml(formatRelativeTime(entry.timestamp)) + '</span>'; pkgCard.appendChild(pkgMeta);
    const pkgActions = document.createElement('div'); pkgActions.className = 'session-package-actions';
    const addPkgBtn = (label, onClick) => { const btn = document.createElement('button'); btn.className = 'secondary-button'; btn.textContent = label; btn.onclick = (e) => { e.stopPropagation(); onClick(e); }; pkgActions.appendChild(btn); };
    addPkgBtn('Run Package Workflow', (e) => runPackageWorkflow(e, pkg.packageId));
    if (canResume) addPkgBtn('Resume', (e) => setPackageStatus(e, pkg.packageId, 'running', 'Package resumed from controls.'));
    if (canPause) addPkgBtn('Pause', (e) => setPackageStatus(e, pkg.packageId, 'planned', 'Package paused from controls.'));
    addPkgBtn('Mark Blocked', (e) => setPackageStatus(e, pkg.packageId, 'blocked', 'Package marked blocked from controls.'));
    addPkgBtn('Complete', (e) => setPackageStatus(e, pkg.packageId, 'complete', 'Package marked complete from controls.'));
    addPkgBtn('Export Trace', (e) => exportPackageTrace(e, pkg.packageId));
    addPkgBtn('Unpackage', (e) => unpackageSessionPackage(e, pkg.packageId));
    pkgCard.appendChild(pkgActions);
    if (expanded) { const children = document.createElement('div'); children.className = 'session-package-children'; entry.sessions.forEach(session => children.appendChild(makeSessionCard(session, true))); pkgCard.appendChild(children); }
    pkgCard.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; toggleSessionPackage(pkg.packageId); };
    fragment.appendChild(pkgCard);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
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
  var events = (metadata.events || []).slice();
  var blocks = [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'text') {
      blocks.push(
        '<div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.15);border-radius:8px;padding:12px 16px;margin:8px 0;box-sizing:border-box;">'
        + '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#a78bfa;margin-bottom:6px;">'
        + '<span>🧠</span> <span>Neural Synthesis Feed</span>'
        + '</div>'
        + '<div style="font-size:13px;line-height:1.5;white-space:pre-wrap;color:#e2e8f0;">' + renderMarkdown(ev.text || '') + '</div>'
        + '</div>'
      );
    } else if (ev.type === 'tool_call') {
      var call = ev;
      var result = null;
      for (var j = i + 1; j < events.length; j++) {
        if (events[j].type === 'tool_result' && (events[j].tool === call.tool || events[j].toolName === call.tool)) {
          result = events[j];
          events.splice(j, 1);
          break;
        }
      }
      var name = call.tool || 'tool';
      var ok = result ? (result.ok !== false) : false;
      var statusClass = ok ? 'ok' : 'fail';
      var statusText = ok ? '\u2713' : '\u2717';

      var commandHtml = '';
      var input = call.arguments || {};
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

      if (result && result.output) {
        var preview = result.output.length > 1024 ? result.output.substring(0, 1024) + '\u2026' : result.output;
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
  }
  return blocks.join('');
}

export
  function renderMessages() {
  const container = document.getElementById('messages');
  if (!state.messages.length && !state.busy && !state.agenticStream.length) {
    container.innerHTML = '<div class="empty-state"><strong>How can I help you today?</strong>Ask for status, approvals, history, or trigger actions like <span class="mono">run workflow demo</span>.</div>';
    return;
  }

  // ── Preserve user scroll position — only auto-scroll when near bottom ──
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  // ── Build the desired list of keyed message elements ──
  const existingById = new Map();
  for (const el of container.querySelectorAll('[data-msg-id]')) {
    existingById.set(el.dataset.msgId, el);
  }

  const wantedKeys = [];
  const newElements = [];

  const rows = state.messages.map(message => {
    const key = message.messageId || ('opt-' + message.createdAt);
    wantedKeys.push(key);

    // Reuse existing DOM node for unchanged messages to preserve expanded states
    const existing = existingById.get(key);
    if (existing && !message._dirty) return { key, el: existing, reuse: true };

    const roleLabel = message.role === 'user' ? 'Operator' : message.role === 'assistant' ? 'PRISM' : 'System';
    let extraHtml = '';
    if (message.metadata && message.metadata.intent === 'llm_error') {
      extraHtml = '<div style="margin-top: 14px;"><button class="secondary-button" style="font-size:12px; padding:8px 12px; display:inline-flex; align-items:center; gap:6px;" onclick="setActiveTab(&quot;logs&quot;)">&#x1F50D; Open Logs</button></div>';
    }
    if (message.metadata && message.metadata.intent === 'llm_agentic') {
      extraHtml += renderToolBlocks(message.metadata);
      if (message.metadata.toolCallsExecuted) {
        extraHtml += '<div class="muted" style="font-size:11px;margin-top:6px;">\u{1F527} '
          + message.metadata.toolCallsExecuted + ' tool call(s) in '
          + (message.metadata.iterations || '?') + ' iteration(s)</div>';
      }
    }
    if (message.role === 'assistant' && message.metadata && message.metadata.events && message.metadata.events.length) {
      extraHtml += '<div style="margin-top:8px;">'
        + '<button class="secondary-button" style="font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;gap:6px;background:rgba(139,92,246,0.08);border-color:rgba(139,92,246,0.25);color:#a78bfa;cursor:pointer;" onclick="showThinkingTraceModal(\'' + (message.messageId || '') + '\')">'
        + '🧠 View Cognitive Trace (' + message.metadata.events.length + ' events)'
        + '</button>'
        + '</div>';
    }
    if (message.metadata && message.metadata.intent === 'llm_sr') {
      extraHtml += '<div style="margin-top:8px;padding:8px 12px;border-radius:6px;background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(59,130,246,0.08));border:1px solid rgba(139,92,246,0.25);">';
      extraHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">';
      extraHtml += '<span style="font-size:14px;">\u{1F308}</span>';
      extraHtml += '<span style="font-size:11px;font-weight:600;color:#a78bfa;">Spectrum Refraction</span>';
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

    // ── Message action buttons (items 9+10) ──
    const msgId = message.messageId || '';
    const isoTime = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
    const actionBtns = message.role !== 'system' ? (
      '<div class="msg-actions" style="display:flex;gap:4px;margin-top:6px;opacity:0;transition:opacity 0.15s;">'
      + '<button class="msg-action-btn" title="Copy message" onclick="copyMessageContent(event, this)" data-content="' + escapeHtml(message.content) + '" style="background:none;border:1px solid rgba(148,163,184,0.2);border-radius:4px;padding:2px 7px;font-size:10px;color:#94a3b8;cursor:pointer;">Copy</button>'
      + (message.role === 'assistant' && msgId ? '<button class="msg-action-btn" title="Regenerate this response" onclick="regenerateMessage(event, \'' + escapeHtml(msgId) + '\')" style="background:none;border:1px solid rgba(148,163,184,0.2);border-radius:4px;padding:2px 7px;font-size:10px;color:#94a3b8;cursor:pointer;">↺ Retry</button>' : '')
      + '</div>'
    ) : '';

    const el = document.createElement('div');
    el.className = 'message ' + escapeHtml(message.role);
    el.dataset.msgId = key;
    el.style.position = 'relative';
    el.onmouseenter = () => { const a = el.querySelector('.msg-actions'); if (a) a.style.opacity = '1'; };
    el.onmouseleave = () => { const a = el.querySelector('.msg-actions'); if (a) a.style.opacity = '0'; };
    el.innerHTML = '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
      + '<div>' + contentHtml + '</div>'
      + attachmentsHtml
      + extraHtml
      + actionBtns
      + '<div class="message-time" title="' + escapeHtml(isoTime) + '" style="cursor:default;">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>';

    return { key, el, reuse: false };
  });

  // ── Streaming block ──
  const streamBlock = (state.agenticStream && state.agenticStream.length) ? (() => {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.dataset.msgId = '__stream__';
    el.innerHTML = '<div class="message-label">PRISM</div>'
      + state.agenticStream.map(function (ev) {
        if (ev.type === 'text') return '<div>' + renderMarkdown(ev.text || '') + '</div>';
        if (ev.type === 'tool_call') {
          var tn = (ev.toolCall && ev.toolCall.name) || 'tool';
          var iter = ev.iteration != null ? ev.iteration : '';
          var isBrowser = tn === 'browser_control' || tn === 'browser_create';
          var btnText = isBrowser ? 'View in Browser Control' : 'View in Agentic';
          var btnClick = isBrowser
            ? "try{ if(typeof setActiveTab==='function'){ setActiveTab('browser'); } if(typeof setBrowserView==='function'){ setBrowserView('viewport'); } }catch(e){console.error(e);} return false;"
            : "try{ if(typeof setActiveTab==='function'){ setActiveTab('agentic'); } if(typeof refreshAutonomousGoals==='function'){ refreshAutonomousGoals(); } }catch(e){console.error(e);} return false;";
          return '<div class="tool-block" title="' + escapeHtml(tn) + (iter ? ' (iteration ' + iter + ')' : '') + '">'
            + '<div class="tool-block-header"><span class="tool-block-icon">\u{1F527}</span>'
            + '<span class="tool-block-name" style="margin-left:8px;font-weight:600;">' + escapeHtml(tn) + '</span>'
            + '<span class="muted" style="margin-left:8px;font-size:11px;">' + (iter ? 'iter ' + iter : '') + '</span>'
            + '<span class="streaming-dot" style="margin-left:8px"></span>'
            + '<button class="secondary-button" style="margin-left:10px;font-size:11px;padding:2px 8px;" onclick="' + btnClick + '">' + escapeHtml(btnText) + '</button>'
            + '</div></div>';
        }
        if (ev.type === 'tool_result') { var rn = (ev.toolResult && ev.toolResult.name) || 'tool'; return '<div class="muted" style="font-size:11px;">\u2713 ' + escapeHtml(rn) + ' done</div>'; }
        return '';
      }).join('');
    return el;
  })() : null;

  // ── Typing indicator ──
  const typingEl = ((state.busy && !state.agenticStream.length) || (state.lastThinkingTrace && state.lastThinkingTrace.length)) ? (() => {
    const el = document.createElement('div');
    el.className = 'message assistant thinking-indicator';
    el.dataset.msgId = '__typing__';
    el.style.cursor = 'pointer';
    el.title = 'Click to view live cognitive trace';
    el.onclick = () => showThinkingTraceModal();
    el.innerHTML = '<div class="message-label">PRISM <span class="thinking-badge" style="background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.3);padding:2px 6px;border-radius:4px;">thinking</span></div>'
      + '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    return el;
  })() : null;

  // ── Reconcile DOM: reuse unchanged nodes, replace changed ones ──
  const wantedSet = new Set(wantedKeys);
  const toRemove = [];
  for (const el of container.querySelectorAll('[data-msg-id]')) {
    const id = el.dataset.msgId;
    if (id === '__stream__' || id === '__typing__') { toRemove.push(el); continue; }
    if (!wantedSet.has(id)) toRemove.push(el);
  }
  toRemove.forEach(el => el.remove());

  // Insert/replace in order
  for (let i = 0; i < rows.length; i++) {
    const { key, el, reuse } = rows[i];
    const existing = container.querySelector('[data-msg-id="' + CSS.escape(key) + '"]');
    if (reuse && existing) continue;  // already in place, unchanged
    if (existing) {
      container.replaceChild(el, existing);
    } else {
      // Insert at correct position
      const allMsgEls = Array.from(container.querySelectorAll('[data-msg-id]')).filter(e => e.dataset.msgId !== '__stream__' && e.dataset.msgId !== '__typing__');
      if (i < allMsgEls.length) {
        container.insertBefore(el, allMsgEls[i]);
      } else {
        container.appendChild(el);
      }
    }
  }
  if (streamBlock) container.appendChild(streamBlock);
  if (typingEl) container.appendChild(typingEl);

  if (atBottom) container.scrollTop = container.scrollHeight;
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

  var html = '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 2px;">'
    + '<div class="eyebrow" style="margin-bottom: 0;">Frontier Operator Console</div>'
    + '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">'
    + '<button id="system-shutdown-btn" onclick="triggerSystemShutdown()" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.45); color: #f87171; border-radius: 6px; padding: 2px 6px; font-size: 9px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 3px; text-transform: uppercase; letter-spacing: 0.5px; height: 18px; line-height: 1;" onmouseover="this.style.background=\'rgba(239, 68, 68, 0.28)\'; this.style.boxShadow=\'0 0 8px rgba(239, 68, 68, 0.25)\'" onmouseout="this.style.background=\'rgba(239, 68, 68, 0.12)\'; this.style.boxShadow=\'none\'">'
    + '<span>🛑</span> Shutdown'
    + '</button>'
    + '<button id="system-logout-btn" onclick="triggerSystemLogout()" style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.45); color: #f59e0b; border-radius: 6px; padding: 2px 6px; font-size: 9px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 3px; text-transform: uppercase; letter-spacing: 0.5px; height: 18px; line-height: 1;" onmouseover="this.style.background=\'rgba(245, 158, 11, 0.28)\'; this.style.boxShadow=\'0 0 8px rgba(245, 158, 11, 0.25)\'" onmouseout="this.style.background=\'rgba(245, 158, 11, 0.12)\'; this.style.boxShadow=\'none\'">'
    + '<span>🚪</span> Logout'
    + '</button>'
    + '</div>'
    + '</div>'
    + '<h1>PRISM Chat</h1>'
    + '<div class="brand-profile-badge ' + badgeClass + '">' + badgeLabel + '</div>';

  if (state.principal && state.principal.email) {
    html += '<div class="brand-profile-email" style="font-size: 10px; color: var(--fg-muted); margin-top: 4px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(state.principal.email) + '</div>';
  }

  var upInfo = state.updateInfo || { currentVersion: s.version || '0.0.1', latestVersion: s.version || '0.0.1', updateAvailable: false, autoUpdate: false };
  var btnText = upInfo.updateAvailable ? '⚡ Update Available (' + upInfo.latestVersion + ')' : '🔄 Check for Updates';
  var btnStyle = upInfo.updateAvailable 
    ? 'background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); color: #fbbf24; box-shadow: 0 0 10px rgba(245, 158, 11, 0.2); animation: pulse-border 2s infinite;'
    : 'background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8;';

  html += '<div class="brand-info-grid">'
    + '<div class="brand-info-item"><span class="brand-info-label">Env</span><br><span class="brand-info-value"><span class="brand-env-dot ' + envDotClass + '"></span>' + escapeHtml(envProfile) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Mode</span><br><span class="brand-info-value">' + escapeHtml(s.mode || 'server') + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Uptime</span><br><span class="brand-info-value">' + formatUptime(s.uptimeSeconds) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Version</span><br><span class="brand-info-value">' + escapeHtml('v' + (s.serviceVersion || s.version || '—')) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Sessions</span><br><span class="brand-info-value">' + (s.chatSessionCount || 0) + '</span></div>'
    + '<div class="brand-info-item"><span class="brand-info-label">Events</span><br><span class="brand-info-value">' + (s.eventCount || 0) + '</span></div>'
    + '</div>'
    + '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">'
    + '<div class="muted">http://localhost:' + (location.port || '7070') + '</div>'
    + '<div style="display:flex; align-items:center; gap:4px;">'
    + '<input type="checkbox" id="prism-autoupdate-chk" onchange="toggleAutoUpdate(this.checked)" ' + (upInfo.autoUpdate ? 'checked' : '') + ' style="cursor: pointer; accent-color: #fbbf24; margin: 0; width: 12px; height: 12px;">'
    + '<label for="prism-autoupdate-chk" style="font-size: 9px; color: var(--fg-muted); cursor: pointer; user-select: none; margin-top: 1px;">Auto-update</label>'
    + '</div>'
    + '</div>'
    + '<div style="margin-top: 6px;">'
    + '<button id="prism-update-btn" onclick="triggerPrismUpdate()" style="width: 100%; ' + btnStyle + ' border-radius: 6px; padding: 4px 8px; font-size: 9px; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.5px; height: 22px; line-height: 1;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">'
    + btnText
    + '</button>'
    + '</div>'
    + '<style>@keyframes pulse-border { 0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); } 70% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); } 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); } }</style>'
    + '<!-- PRISM WebSocket Real-Time Tunnel Indicator -->'
    + '<div class="ws-connection-panel" style="display:flex;align-items:center;gap:10px;margin-top:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:8px 12px;font-size:11px;">'
    + '<span id="prism-ws-status" style="width:8px;height:8px;border-radius:50%;background:' + wsBg + ';box-shadow:0 0 6px rgba(34,197,94,0.5);transition:background 0.3s;display:inline-block;" data-tip-id="shell:ws-status" data-tip-kind="shell" tabindex="0" role="status" aria-label="WebSocket connection status"></span>'
    + '<div style="display:flex;flex-direction:column;gap:2px;">'
    + '<span style="font-weight:600;color:#ddd;letter-spacing:0.3px;font-size:10px;text-transform:uppercase;">Frontier WS Tunnel</span>'
    + '<span id="prism-ws-status-text" style="font-size:9px;color:' + wsColor + ';font-weight:700;letter-spacing:0.5px;">' + wsStatus + '</span>'
    + '</div>'
    + '</div>';

  // ── Preserve existing paradigm panel state from state (not DOM) ──
  var paradigm = state.paradigm || {};
  var badgeText = paradigm.badgeText || 'LOADING';
  var badgeBg = paradigm.badgeBg || '#3b82f6';
  var badgeColor = paradigm.badgeColor || '#fff';
  var badgeShadow = paradigm.badgeShadow || '';
  var descHtml = paradigm.descHtml || 'Querying active constraints...';
  var logHtml = paradigm.logHtml || '<div>[SYSTEM] Booting active paradigm...</div>';
  var baseBtnStyle = paradigm.baseBtnStyle || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };
  var perfBtnStyle = paradigm.perfBtnStyle || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };
  var autoBtnStyle = paradigm.autoBtnStyle || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', color: '#94a3b8' };

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
  const confirmed = await showConfirm('Delete session "' + existing.title + '"? This will remove all messages in this session.');
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
    showTransientNotice('Delete failed: ' + (error.message || String(error)), 'error');
  }

  render();
}

export
  async function renameSession(event, sessionId) {
  event.stopPropagation();
  var session = state.sessions.find(function (s) { return s.sessionId === sessionId; });
  if (!session) return;
  var newTitle = await showPrompt('Rename session:', { defaultValue: session.title, confirmLabel: 'Rename', icon: '✏️' });
  if (!newTitle || newTitle.trim() === session.title) return;
  try {
    await request('/api/chat/sessions/' + encodeURIComponent(sessionId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    await loadSessions();
    safeRenderStep('sessionList', renderSessionList);
    safeRenderStep('header', renderHeader);
    showTransientNotice('Session renamed.', 'success');
  } catch (err) {
    showTransientNotice('Rename failed: ' + String(err), 'error');
  }
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
        headers: authHeaders(),
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
    // Targeted refresh: reload messages and session list only — avoid the
    // 28-request refreshChrome() waterfall on every send.
    await Promise.all([loadSessions(), loadMessages()]);
    // Deferred: refresh provider/readiness data in the background without blocking render.
    refreshChrome().catch(() => { });
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
  async function copyMessageContent(event, btn) {
  event.stopPropagation();
  const content = btn.dataset.content || '';
  try {
    await navigator.clipboard.writeText(content);
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.style.color = '#34d399';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
  } catch (_) {
    showTransientNotice('Clipboard write failed — use Ctrl+C to copy.', 'error');
  }
}

export
  async function regenerateMessage(event, messageId) {
  event.stopPropagation();
  if (state.busy) return;
  const msgs = state.messages || [];
  const assistantIdx = msgs.findIndex(m => m.messageId === messageId);
  if (assistantIdx < 1) return;
  const precedingUser = msgs.slice(0, assistantIdx).reverse().find(m => m.role === 'user');
  if (!precedingUser) return;
  const confirmed = await showConfirm('Retry this response?\n\nThe last assistant reply will be removed and PRISM will answer again.');
  if (!confirmed) return;
  state.busy = true;
  state.agenticStream = [];
  render();
  try {
    await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages/' + encodeURIComponent(messageId), { method: 'DELETE' }).catch(() => null);
    await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: precedingUser.content, _regenerate: true })
    });
    await loadMessages();
  } catch (err) {
    showTransientNotice('Regenerate failed: ' + String(err), 'error');
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

export function showThinkingTraceModal(messageIdOrTrace) {
  if (document.getElementById('thinking-trace-overlay')) return;

  var historicalEvents = null;
  var isLive = true;

  if (messageIdOrTrace && typeof messageIdOrTrace === 'string') {
    var foundMsg = state.messages.find(function (m) { return m.messageId === messageIdOrTrace; });
    if (foundMsg && foundMsg.metadata && foundMsg.metadata.events) {
      historicalEvents = foundMsg.metadata.events;
      isLive = false;
    }
  }

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
      <span style="font-size:18px;">🧠</span>
      <span style="font-weight:600;font-size:16px;letter-spacing:0.5px;background:linear-gradient(90deg, #a78bfa, #38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${isLive ? 'PRISM Live Cognitive & Action Trace' : 'PRISM Archived Cognitive Trace'}</span>
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
    if (updateInterval) clearInterval(updateInterval);
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById('thinking-trace-close').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const renderContent = () => {
    let html = '';
    const trace = !isLive ? historicalEvents : ((state.lastThinkingTrace && state.lastThinkingTrace.length) ? state.lastThinkingTrace : (state.agenticStream || []));

    // Active Status Card
    var statusText = isLive ? '🧠 processing...' : '✅ completed';
    var statusStyle = isLive ? 'color:#fbbf24;animation:thinking-pulse 1.4s ease-in-out infinite;' : 'color:#34d399;font-weight:600;';
    html += `
      <div style="background:rgba(30,30,46,0.5);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px;font-size:13px;display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;box-sizing:border-box;flex-shrink:0;">
        <div><span style="color:#94a3b8;">Active Session:</span> <span style="font-family:monospace;color:#a78bfa;word-break:break-all;">${escapeHtml(state.selectedSessionId || 'none')}</span></div>
        <div><span style="color:#94a3b8;">Cognitive Mode:</span> <span style="color:#38bdf8;font-weight:600;">${state.settings?.srEnabled ? 'Spectrum Refraction' : 'Standard Pipeline'}</span></div>
        <div><span style="color:#94a3b8;">Event Count:</span> <span style="font-family:monospace;color:#34d399;font-weight:600;">${trace.length}</span></div>
        <div><span style="color:#94a3b8;">Status:</span> <span style="${statusStyle}">${statusText}</span></div>
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
          const args = ev.arguments || ev.toolCall?.arguments || {};
          let argsStr = '';
          try { argsStr = JSON.stringify(args, null, 2); } catch (_) { argsStr = String(args); }
          html += `
            <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.15);border-radius:8px;padding:12px 16px;box-sizing:border-box;">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#38bdf8;margin-bottom:6px;">
                <span>🔧</span> <span>Invoking System Tool:</span> <span style="font-family:monospace;background:rgba(56,189,248,0.15);padding:1px 6px;border-radius:4px;">${escapeHtml(ev.tool || ev.toolCall?.name || '')}</span>
              </div>
              <pre style="margin:6px 0 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-family:monospace;font-size:11px;overflow-x:auto;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);box-sizing:border-box;">${escapeHtml(argsStr)}</pre>
            </div>
          `;
        } else if (ev.type === 'tool_result') {
          const ok = ev.ok !== false && (!ev.toolResult || ev.toolResult.ok !== false);
          const statusColor = ok ? '#34d399' : '#f87171';
          const out = ev.output || ev.toolResult?.output || '';
          const preview = out.length > 500 ? out.substring(0, 500) + '...' : out;
          html += `
            <div style="background:rgba(52,211,153,0.04);border:1px solid ${statusColor}30;border-radius:8px;padding:12px 16px;box-sizing:border-box;">
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:${statusColor};margin-bottom:6px;">
                <span>${ok ? '✅' : '❌'}</span> <span>Tool Result:</span> <span style="font-family:monospace;background:${statusColor}15;padding:1px 6px;border-radius:4px;">${escapeHtml(ev.tool || ev.toolResult?.name || 'tool')}</span>
              </div>
              <pre style="margin:6px 0 0;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-family:monospace;font-size:11px;overflow-x:auto;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);box-sizing:border-box;">${escapeHtml(preview)}</pre>
            </div>
          `;
        }
      });
      html += `</div>`;
    }
    html += `</div>`;

    if (isLive) {
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
    }

    // Live refractor pulse footer
    var footerText = isLive ? 'Spectral Triad fanning out and synthesis engine in consensus...' : 'Historical cognitive trace loaded from archived chat metadata.';
    var footerDotStyle = isLive ? 'background:#a78bfa;box-shadow:0 0 10px #a78bfa;animation:thinking-pulse 1.4s infinite;' : 'background:#34d399;';
    html += `
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;color:#a78bfa;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;box-sizing:border-box;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;${footerDotStyle}"></span>
        <span style="font-weight:500;letter-spacing:0.3px;">${footerText}</span>
      </div>
    `;

    body.innerHTML = html;

    const logsEl = document.getElementById('thinking-trace-logs');
    if (logsEl) logsEl.scrollTop = logsEl.scrollHeight;
  };

  renderContent();

  var updateInterval = null;
  if (isLive) {
    updateInterval = setInterval(() => {
      if (document.getElementById('thinking-trace-overlay')) {
        renderContent();
      } else {
        clearInterval(updateInterval);
      }
    }, 500);
  }
}

if (typeof window !== 'undefined') {
  window.triggerPrismUpdate = async function() {
    if (!confirm("Are you sure you want to update PRISM? This will stop the server, apply updates from origin/main, execute supply-chain security verification gates, and restart the gateway.")) {
      return;
    }

    try {
      const overlay = document.createElement('div');
      overlay.id = 'prism-update-overlay';
      overlay.style = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(13, 15, 18, 0.95); backdrop-filter: blur(8px); z-index: 100000; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-family: sans-serif; text-align: center;';
      overlay.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); max-width: 450px;">
          <div style="font-size: 40px; animation: pulse-glow 2s infinite;">⚡</div>
          <div style="font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">PRISM SYSTEM UPDATE IN PROGRESS</div>
          <div id="update-status-msg" style="color: #cbd5e1; font-size: 13px; max-width: 350px; line-height: 1.5;">Initiating update orchestrator and shutting down active gateway session...</div>
          <div style="width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; position: relative;">
            <div id="update-progress-bar" style="position: absolute; top: 0; left: 0; height: 100%; width: 10%; background: #fbbf24; border-radius: 2px; transition: width 0.5s;"></div>
          </div>
          <div id="update-spinner" style="width: 24px; height: 24px; border: 3px solid rgba(250, 204, 21, 0.2); border-top-color: #facc15; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <div id="reconnect-countdown" style="display: none; font-size: 11px; color: #a1a1aa; font-family: monospace;">Attempting reconnection in <span id="countdown-secs">5</span>s...</div>
        </div>
        <style>
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          @keyframes pulse-glow { 0% { transform: scale(1); filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.5)); } 50% { transform: scale(1.1); filter: drop-shadow(0 0 20px rgba(245, 158, 11, 0.8)); } 100% { transform: scale(1); filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.5)); } }
        </style>
      `;
      document.body.appendChild(overlay);

      const response = await request('/api/update/run', { method: 'POST' });
      if (!response.success) {
        throw new Error(response.message || "Failed to trigger update");
      }

      let progress = 10;
      const statusMsg = document.getElementById('update-status-msg');
      const progressBar = document.getElementById('update-progress-bar');
      const reconnectCountdown = document.getElementById('reconnect-countdown');
      const countdownSecs = document.getElementById('countdown-secs');
      
      const interval = setInterval(async () => {
        progress = Math.min(95, progress + 2);
        if (progressBar) progressBar.style.width = progress + '%';
        if (statusMsg) statusMsg.textContent = "Gateway stopped. Rebuilding workspace files, applying migrations, running security checks...";
      }, 1000);

      // Reconnection check
      let attempt = 0;
      const checkOnline = async () => {
        try {
          const res = await fetch('/api/v1/status', { method: 'GET', cache: 'no-store' });
          if (res.ok) {
            clearInterval(interval);
            if (progressBar) progressBar.style.width = '100%';
            if (statusMsg) statusMsg.innerHTML = '<span style="color:#34d399">✓ Update Successful! Reconnection established. Reloading console...</span>';
            setTimeout(() => {
              window.location.reload();
            }, 1000);
            return;
          }
        } catch (_) {}

        attempt++;
        if (reconnectCountdown) reconnectCountdown.style.display = 'block';
        
        let countdown = 5;
        const tick = () => {
          if (countdownSecs) countdownSecs.textContent = countdown;
          if (countdown <= 0) {
            checkOnline();
          } else {
            countdown--;
            setTimeout(tick, 1000);
          }
        };
        tick();
      };

      setTimeout(checkOnline, 8000);

    } catch (e) {
      alert("Error initiating update: " + e.message);
      const ov = document.getElementById('prism-update-overlay');
      if (ov) ov.remove();
    }
  };

  window.toggleAutoUpdate = async function(enabled) {
    try {
      await request('/api/update/auto-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (state.updateInfo) {
        state.updateInfo.autoUpdate = enabled;
      }
      showTransientNotice('Auto-update ' + (enabled ? 'enabled' : 'disabled'), 'success');
    } catch (e) {
      showTransientNotice('Failed to update preference: ' + e.message, 'error');
    }
  };
}
