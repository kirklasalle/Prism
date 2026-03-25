import { state, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, dashboardLog, safeRenderStep, renderStars, approvalBadge, metricRow, healthDot, timeAgo, formatUptime } from './dashboard-core.js';
import { renderToolCallLog } from './tab-logs.js';

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
    state.activeTab = 'settings';
    render();
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
  async function createSession() {
  const payload = await request('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  state.selectedSessionId = payload.session.sessionId;
  await loadSessions();
  await loadMessages();
  await Promise.all([loadSessionPackages(), loadSessionPackageHistory(), refreshChrome()]);
  render();
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
  async function refreshChrome() {
  const llmUrl = state.selectedSessionId
    ? '/api/llm/providers?sessionId=' + encodeURIComponent(state.selectedSessionId)
    : null;
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
  const [status, readiness, llmCatalog, llmConfig, llmAuditEvents, chatTelemetryPayload, pending, actions, actionHistory, traceData, events, retrievalData, prioritizedAlertsData, telemetrySummaryData, runtimeExcellenceData, releaseValidationData, releaseDecisionData, selfReviewLatest, selfReviewHistory, packagePayload, packageHistoryPayload, settingsPayload, agentDataPayload, computerSystemInfoPayload, toolsStatusPayload, pluginsStatusPayload, llmModalitiesPayload, modelMatrixPayload] = await Promise.all([
    request('/api/status'),
    request(readinessUrl).catch(() => null),
    llmUrl ? request(llmUrl) : Promise.resolve(null),
    llmConfigUrl ? request(llmConfigUrl).catch(() => null) : Promise.resolve(null),
    request(llmAuditUrl),
    request(chatTelemetryUrl).catch(function () { return []; }),
    request('/api/pending'),
    request('/api/actions'),
    request('/api/action-history'),
    request(tracesUrl).catch(() => ({ traces: [], selectedTraceEvents: [] })),
    request('/api/events?limit=8'),
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
    request('/api/tools/status').catch(function () { return { tools: {} }; }),
    request('/api/plugins/status').catch(function () { return { plugins: {} }; }),
    request('/api/llm/modalities').catch(function () { return { modalities: [] }; }),
    request('/api/models/matrix').catch(function () { return { models: [] }; })
  ]);
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
  state.modelMatrixEntries = Array.isArray(modelMatrixPayload && modelMatrixPayload.models)
    ? modelMatrixPayload.models
    : [];
  state.status = status;
  state.readiness = readiness;
  state.llmCatalog = llmCatalog;
  state.llmConfig = llmConfig;
  state.llmAuditEvents = llmAuditEvents;
  state.chatTelemetry = (Array.isArray(chatTelemetryPayload) ? chatTelemetryPayload : []).filter(function (e) { return e.operation && (e.operation.startsWith('chat.') || e.operation.startsWith('llm.')); });
  state.pending = pending;
  state.actions = actions;
  state.actionHistory = actionHistory;
  state.traceData = traceData;
  state.events = events;
  state.selfReviewLatest = selfReviewLatest.report || null;
  state.selfReviewHistory = selfReviewHistory.reports || [];
  state.retrievalAlerts = retrievalData.alerts || [];
  state.prioritizedAlerts = prioritizedAlertsData || null;
  state.telemetrySummary = telemetrySummaryData || null;
  state.runtimeExcellence = runtimeExcellenceData || null;
  state.releaseValidation = releaseValidationData ? (releaseValidationData.report || null) : null;
  state.releaseDecision = releaseDecisionData ? (releaseDecisionData.report || null) : null;
  state.sessionPackages = Array.isArray(packagePayload.packages) ? packagePayload.packages : [];
  state.packageReleaseSnapshot = packagePayload.releaseSnapshot || null;
  state.sessionPackageHistory = Array.isArray(packageHistoryPayload.history) ? packageHistoryPayload.history : [];
  state.runtimeSettings = settingsPayload.settings || null;
  reconcileExpandedSessionPackages();
  if (state.selectedTraceId && (!traceData || !traceData.traces || !traceData.traces.some(trace => trace.correlationId === state.selectedTraceId))) {
    state.selectedTraceId = null;
  }
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
    return '<div class="session-card' + activeClass + className + '" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="' + onClick + '">'
      + '<div class="session-title">' + escapeHtml(session.title) + '</div>'
      + '<div class="session-preview">' + escapeHtml(preview) + '</div>'
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
    + '<button class="onboarding-toggle" id="onboarding-expand-btn" onclick="toggleOnboardingExpand()">Show all ' + checklist.length + ' checks</button>'
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

    blocks.push(
      '<div class="tool-block" onclick="this.classList.toggle(&quot;expanded&quot;)">'
      + '<div class="tool-block-header">'
      + '<span class="tool-block-icon">\u{1F527}</span>'
      + '<span class="tool-block-name">' + escapeHtml(name) + '</span>'
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
    container.innerHTML = '<div class="empty-state"><strong>Persistent operator chat is ready.</strong><br><br>Ask for status, approvals, history, or trigger actions like <span class="mono">run workflow demo</span>.</div>';
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

    const contentHtml = message.role === 'assistant' ? renderMarkdown(message.content) : escapeHtml(message.content);

    return '<div class="message ' + escapeHtml(message.role) + '">'
      + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
      + '<div>' + contentHtml + '</div>'
      + extraHtml
      + '<div class="message-time">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>'
      + '</div>';
  }).join('');

  const streamBlock = state.agenticStream && state.agenticStream.length
    ? '<div class="message assistant"><div class="message-label">PRISM</div>'
    + state.agenticStream.map(function (ev) {
      if (ev.type === 'text') return '<div>' + renderMarkdown(ev.text || '') + '</div>';
      if (ev.type === 'tool_call') { var tn = (ev.toolCall && ev.toolCall.name) || ''; return '<div class="tool-block"><div class="tool-block-header"><span class="tool-block-icon">\u{1F527}</span><span class="tool-block-name">' + escapeHtml(tn) + '</span><span class="streaming-dot"></span></div></div>'; }
      if (ev.type === 'tool_result') { var rn = (ev.toolResult && ev.toolResult.name) || 'tool'; return '<div class="muted" style="font-size:11px;">\u2713 ' + escapeHtml(rn) + ' done</div>'; }
      return '';
    }).join('')
    + '</div>'
    : '';

  const typing = state.busy && !state.agenticStream.length ? '<div class="message assistant"><div class="message-label">PRISM</div><div>Working...<span class="streaming-dot"></span></div></div>' : '';
  container.innerHTML = rows + streamBlock + typing;
  container.scrollTop = container.scrollHeight;
}

export
  function renderOverview() {
  const container = document.getElementById('runtime-overview');
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

  var html = '<div class="eyebrow">Frontier Operator Console</div>'
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
    + '<div class="muted" style="margin-top:8px;">http://localhost:' + (location.port || '7070') + '</div>';

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
    var items = await navigator.clipboard.read();
    for (var i = 0; i < items.length; i++) {
      var types = items[i].types;
      var imgType = types.find(function (t) { return t.startsWith('image/'); });
      if (imgType) {
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
    state.activeTab = 'settings';
    render();
    return;
  }
  state.busy = true;
  state.notice = null;
  state.agenticStream = [];
  composer.value = '';
  render();
  try {
    var response = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    // Upload pending attachments to the user message if any
    if (pendingAttachments.length && response && response.userMessage && response.userMessage.messageId) {
      await uploadAttachments(state.selectedSessionId, response.userMessage.messageId);
    }
    state.agenticStream = [];
    await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
  } catch (error) {
    state.notice = String(error);
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
    state.notice = 'Provider applied: ' + providerId + ' / ' + (model || 'default') + '.';
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
  function connectAgenticStream() {
  var evtSource;
  try {
    evtSource = new EventSource('/api/chat/stream');
  } catch (err) {
    console.warn('[stream] SSE unavailable:', err);
    return;
  }
  evtSource.onmessage = function (event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'agentic_event') {
        var ev = data.event || data;
        if (ev.type === 'done') {
          state.agenticStream = [];
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
    evtSource.close();
    setTimeout(connectAgenticStream, 5000);
  };
}
