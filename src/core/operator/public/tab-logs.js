import { state, request, escapeHtml, formatRelativeTime, safeIso, dashboardLog, statusBadge } from './dashboard-core.js';

export
  function renderEvents() {
  const container = document.getElementById('events');
  if (!container) return;
  if (!state.events.length) {
    container.innerHTML = '<div class="muted">No recent events.</div>';
    return;
  }
  container.innerHTML = '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th></tr></thead><tbody>'
    + state.events.map(event => '<tr>'
      + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
      + '<td>' + escapeHtml(event.operation) + '</td>'
      + '<td>' + escapeHtml(event.status) + '</td>'
      + '</tr>').join('')
    + '</tbody></table>';
}

export
  function renderTraceView() {
  const container = document.getElementById('trace-view');
  if (!container) return;
  const traceData = state.traceData;
  if (!traceData || !traceData.traces || !traceData.traces.length) {
    container.innerHTML = '<div class="muted">No correlated traces yet.</div>';
    return;
  }

  const traces = traceData.traces;
  let html = '<table class="events-table"><thead><tr><th>Trace</th><th>Events</th><th>Status</th><th>Last Seen</th></tr></thead><tbody>'
    + traces.map(trace => '<tr>'
      + '<td>'
      + '<button class="secondary-button" style="padding:4px 8px;" onclick="loadTrace(&quot;' + escapeHtml(trace.correlationId) + '&quot;)">'
      + (state.selectedTraceId === trace.correlationId ? 'Viewing' : 'View')
      + '</button>'
      + '<div class="mono" style="margin-top:6px;font-size:10px;word-break:break-all;">' + escapeHtml(trace.correlationId) + '</div>'
      + '</td>'
      + '<td>' + escapeHtml(String(trace.eventCount)) + '</td>'
      + '<td>' + escapeHtml(trace.status) + (trace.failures > 0 ? ' (' + escapeHtml(String(trace.failures)) + ' failed)' : '') + '</td>'
      + '<td>' + escapeHtml(formatRelativeTime(trace.lastAt)) + '</td>'
      + '</tr>').join('')
    + '</tbody></table>';

  const selected = traceData.selectedTraceEvents || [];
  if (state.selectedTraceId) {
    html += '<div class="muted" style="margin-top:10px;">Trace timeline</div>';
    if (!selected.length) {
      html += '<div class="muted">No events found for selected correlation ID.</div>';
    } else {
      html += '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th></tr></thead><tbody>'
        + selected.map(event => '<tr>'
          + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
          + '<td class="mono" style="font-size:11px;">' + escapeHtml(event.operation) + '</td>'
          + '<td>' + escapeHtml(event.status) + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }
  }

  container.innerHTML = html;
}

export
  async function loadTrace(correlationId) {
  state.selectedTraceId = correlationId;
  try {
    const url = '/api/traces?limit=10'
      + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '')
      + '&correlationId=' + encodeURIComponent(correlationId);
    state.traceData = await request(url);
  } catch (error) {
    state.notice = String(error);
  }
  render();
}

export
  function renderActions() {
  const container = document.getElementById('actions');
  if (!container) return;
  let html = '';
  if (state.notice) {
    html += '<div class="notice">' + escapeHtml(state.notice) + '</div>';
  }
  if (!state.actions.length) {
    container.innerHTML = html + '<div class="muted">No dashboard actions available.</div>';
    return;
  }

  html += state.actions.map(action =>
    '<div class="action-card">'
    + '<div class="action-card-head"><strong>' + escapeHtml(action.label) + '</strong>' + statusBadge(action) + '</div>'
    + '<div class="muted">' + escapeHtml(action.description) + '</div>'
    + (action.lastMessage ? '<div class="muted" style="margin-top:8px;">Last result: ' + escapeHtml(action.lastMessage) + '</div>' : '')
    + (action.lastError ? '<div style="margin-top:8px;color:#ffc1c1;">Last error: ' + escapeHtml(action.lastError) + '</div>' : '')
    + '<div class="action-buttons"><button class="secondary-button" ' + (action.status === 'running' ? 'disabled' : '') + ' data-action="' + escapeHtml(action.name) + '" onclick="runAction(this.dataset.action)">Run</button></div>'
    + '</div>'
  ).join('');
  container.innerHTML = html;
}

export
  function renderApprovals() {
  const container = document.getElementById('pending');
  if (!container) return;
  if (!state.pending.length) {
    container.innerHTML = '<div class="muted">No pending approvals.</div>';
    return;
  }
  container.innerHTML = state.pending.map(item =>
    '<div class="approval-card">'
    + '<div><strong>' + escapeHtml(item.operation) + '</strong></div>'
    + '<div class="muted mono" style="margin-top:6px;">' + escapeHtml(item.id) + '</div>'
    + '<div class="action-buttons"><button class="secondary-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="approve(this.dataset.approvalId)">Approve</button><button class="danger-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="deny(this.dataset.approvalId)">Deny</button></div>'
    + '</div>'
  ).join('');
}

export
  function renderActionHistory() {
  const container = document.getElementById('action-history');
  if (!container) return;
  if (!state.actionHistory.length) {
    container.innerHTML = '<div class="muted">No action runs recorded yet.</div>';
    return;
  }
  container.innerHTML = '<table class="history-table"><thead><tr><th>Action</th><th>Status</th><th>Outcome</th></tr></thead><tbody>'
    + state.actionHistory.slice(0, 8).map(entry => '<tr>'
      + '<td>' + escapeHtml(entry.label) + '<div class="muted">' + escapeHtml(formatRelativeTime(entry.startedAt)) + '</div></td>'
      + '<td>' + escapeHtml(entry.status) + '</td>'
      + '<td>' + escapeHtml(entry.message || entry.error || '-') + '</td>'
      + '</tr>').join('')
    + '</tbody></table>';
}

export
  function renderToolCallLog() {
  var container = document.getElementById('tool-call-log');
  if (!container) return;
  var log = state.toolCallLog || [];
  if (!log.length) { container.innerHTML = '<div class="muted" style="font-size:12px;">No tool calls recorded yet.</div>'; return; }
  var html = '<table class="events-table"><thead><tr><th>Time</th><th>Tool</th><th>Iter</th><th>Arguments</th><th>Result</th><th>Status</th></tr></thead><tbody>';
  log.forEach(function (entry) {
    var ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '-';
    var argsStr = '';
    if (entry.arguments && typeof entry.arguments === 'object' && Object.keys(entry.arguments).length > 0) { try { argsStr = JSON.stringify(entry.arguments, null, 2); } catch (_) { argsStr = String(entry.arguments); } }
    var outputStr = (entry.output && typeof entry.output === 'string') ? entry.output : '';
    var outputPreview = outputStr.length > 300 ? outputStr.substring(0, 300) + '\u2026' : outputStr;
    var statusHtml = entry.ok === undefined ? '<span class="muted" style="font-size:11px;">pending\u2026</span>' : entry.ok ? '<span style="color:#69db7c;">\u2713 ok</span>' : '<span style="color:#ff6b6b;">\u2717 fail</span>';
    html += '<tr><td style="white-space:nowrap;font-size:11px;">' + escapeHtml(ts) + '</td><td class="mono" style="font-size:12px;font-weight:600;">' + escapeHtml(entry.name) + '</td><td style="font-size:11px;text-align:center;">' + (entry.iteration !== undefined ? escapeHtml(String(entry.iteration)) : '-') + '</td><td style="font-size:11px;max-width:260px;">' + (argsStr ? '<pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;max-height:80px;overflow:auto;">' + escapeHtml(argsStr) + '</pre>' : '<span class="muted">-</span>') + '</td><td style="font-size:11px;max-width:260px;">' + (outputPreview ? '<pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:10px;max-height:80px;overflow:auto;">' + escapeHtml(outputPreview) + '</pre>' : '<span class="muted">-</span>') + '</td><td>' + statusHtml + '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Incident Triage Bundle (Phase E2) ─────────────────────────────────────────

export async function captureIncidentBundle() {
  try {
    var resp = await fetch('/api/incidents/bundle', { method: 'POST' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.blob();
    var url = URL.createObjectURL(data);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'prism-incident-bundle-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dashboardLog('logs', 'incident.bundle.captured', 'Evidence bundle downloaded');
  } catch (e) {
    dashboardLog('logs', 'incident.bundle.error', 'Bundle capture failed: ' + e.message);
  }
}

// ── Unified Telemetry Stream (Phase A3B) ──────────────────────────────────────

var utBuffer = [];
var utPaused = false;
var UT_CAP = 2000;

var SEVERITY_COLORS = {
  trace: '#6b7280',
  debug: '#94a3b8',
  info: '#69d2ff',
  warning: '#ffd17a',
  error: '#ff7a7a',
  critical: '#ff4d4d',
};

function utShouldShow(entry) {
  var sevFilter = document.getElementById('ut-severity-filter');
  var srcFilter = document.getElementById('ut-source-filter');
  var searchEl = document.getElementById('ut-search');
  if (sevFilter && sevFilter.value && entry.severity !== sevFilter.value) return false;
  if (srcFilter && srcFilter.value && entry.source !== srcFilter.value) return false;
  if (searchEl && searchEl.value) {
    var q = searchEl.value.toLowerCase();
    var haystack = (entry.operation + ' ' + entry.summary + ' ' + (entry.source || '')).toLowerCase();
    if (haystack.indexOf(q) === -1) return false;
  }
  return true;
}

function renderUtEntries() {
  if (utPaused) return;
  var body = document.getElementById('unified-telemetry-body');
  if (!body) return;
  var visible = utBuffer.filter(utShouldShow);
  var showAi = document.getElementById('ut-ai-context');
  var showContext = showAi ? showAi.checked : false;
  if (visible.length === 0) {
    body.innerHTML = '<div class="muted" style="font-size:12px;">(no entries match filters)</div>';
    return;
  }
  // Show last 200 for performance
  var slice = visible.slice(-200);
  body.innerHTML = slice.map(function (e) {
    var color = SEVERITY_COLORS[e.severity] || '#94a3b8';
    var ts = (e.timestamp || '').slice(11, 23);
    var sevBadge = '<span style="color:' + color + ';font-weight:600;">' + escapeHtml(e.severity || 'info') + '</span>';
    var src = '<span class="muted">[' + escapeHtml(e.source || '?') + ']</span>';
    var op = escapeHtml(e.operation || '');
    var summary = escapeHtml(e.summary || '');
    var aiLine = '';
    if (showContext && e.aiContext && e.aiContext.actionable) {
      aiLine = '<div style="margin-left:16px;color:#a78bfa;font-size:10px;">⚡ ' + escapeHtml(e.aiContext.suggestedAction || 'actionable') + '</div>';
    }
    return '<div style="border-bottom:1px solid rgba(148,163,184,0.06);padding:1px 0;">'
      + '<span class="muted" style="font-size:10px;">' + escapeHtml(ts) + '</span> '
      + sevBadge + ' ' + src + ' '
      + '<span style="font-weight:500;">' + op + '</span> '
      + '<span class="muted">' + summary + '</span>'
      + aiLine
      + '</div>';
  }).join('');
  var autoScroll = document.getElementById('ut-autoscroll');
  if (autoScroll && autoScroll.checked) {
    body.scrollTop = body.scrollHeight;
  }
}

function pushUtEntry(entry) {
  utBuffer.push(entry);
  if (utBuffer.length > UT_CAP) utBuffer.splice(0, utBuffer.length - UT_CAP);
  renderUtEntries();
}

export function clearUnifiedTelemetry() {
  utBuffer.length = 0;
  renderUtEntries();
}

function renderUtStats(stats) {
  var container = document.getElementById('unified-telemetry-stats');
  if (!container || !stats) return;
  var items = [
    { label: 'Total', value: stats.totalIngested || 0, color: '#69d2ff' },
    { label: 'Errors', value: stats.bySeverity?.error || 0, color: '#ff7a7a' },
    { label: 'Warnings', value: stats.bySeverity?.warning || 0, color: '#ffd17a' },
    { label: 'Buffer', value: stats.bufferSize + '/' + stats.bufferCapacity, color: '#94a3b8' },
  ];
  container.innerHTML = items.map(function (i) {
    return '<span style="padding:3px 8px;border-radius:4px;background:rgba(255,255,255,0.04);">'
      + '<span class="muted">' + i.label + ':</span> '
      + '<span style="color:' + i.color + ';font-weight:600;">' + i.value + '</span></span>';
  }).join('');
}

export async function hydrateUnifiedTelemetry() {
  try {
    var data = await request('/api/v1/telemetry/unified?limit=200');
    if (data.entries && Array.isArray(data.entries)) {
      for (var i = 0; i < data.entries.length; i++) {
        utBuffer.push(data.entries[i]);
      }
    }
    if (data.stats) renderUtStats(data.stats);
    renderUtEntries();
  } catch (e) {
    var body = document.getElementById('unified-telemetry-body');
    if (body) body.innerHTML = '<div class="muted" style="font-size:12px;color:#ff9a85;">Error loading telemetry: ' + escapeHtml(String(e)) + '</div>';
  }
}

export function handleTelemetryWsMessage(data) {
  if (data.type === 'telemetry' && data.entry) {
    pushUtEntry(data.entry);
  }
}

// Wire filters
if (typeof document !== 'undefined') {
  setTimeout(function () {
    var sevFilter = document.getElementById('ut-severity-filter');
    var srcFilter = document.getElementById('ut-source-filter');
    var searchEl = document.getElementById('ut-search');
    var pauseBtn = document.getElementById('ut-pause');
    if (sevFilter) sevFilter.addEventListener('change', renderUtEntries);
    if (srcFilter) srcFilter.addEventListener('change', renderUtEntries);
    if (searchEl) searchEl.addEventListener('input', renderUtEntries);
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        utPaused = !utPaused;
        pauseBtn.textContent = utPaused ? 'Resume' : 'Pause';
        var statusEl = document.getElementById('unified-telemetry-status');
        if (statusEl) {
          statusEl.textContent = utPaused ? 'paused' : 'live';
          statusEl.style.color = utPaused ? '#ffd17a' : '#69d2ff';
        }
        if (!utPaused) renderUtEntries();
      });
    }
  }, 100);
}

// ── Operator Identity & Tab Sessions (Phase A1) ───────────────────────────────

export async function refreshIdentityPanel() {
  try {
    var data = await request('/api/v1/identity');
    var panel = document.getElementById('identity-panel');
    if (!panel) return;
    var op = data.operator;
    var ag = data.agent;
    if (!op && !ag) {
      panel.innerHTML = '<div class="muted">No identity configured.</div>';
      return;
    }
    var html = '';
    if (op) {
      html += '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Operator</div>';
      html += '<div style="font-size:13px;font-weight:600;">' + escapeHtml(op.displayName || op.operatorId || '—') + '</div>';
      html += '<div class="muted" style="font-size:11px;">' + escapeHtml(op.email || '') + '</div>';
      html += '<div class="muted" style="font-size:10px;margin-top:4px;">CAC: ' + escapeHtml(op.cacMode || 'unknown') + '</div>';
      html += '</div>';
    }
    if (ag) {
      html += '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Agent</div>';
      html += '<div style="font-size:13px;font-weight:600;">' + escapeHtml(ag.agentId || '—') + '</div>';
      html += '<div class="muted" style="font-size:11px;">' + escapeHtml(ag.role || '') + '</div>';
      html += '</div>';
    }
    panel.innerHTML = html;
  } catch (e) {
    var panel2 = document.getElementById('identity-panel');
    if (panel2) panel2.innerHTML = '<div class="muted">Identity load failed.</div>';
  }
}

export async function refreshTabSessions() {
  try {
    var data = await request('/api/v1/sessions/tabs');
    var panel = document.getElementById('tab-sessions-panel');
    if (!panel) return;
    var sessions = data.sessions || [];
    if (sessions.length === 0) {
      panel.innerHTML = '<div class="muted">No tab sessions active.</div>';
      return;
    }
    var html = '<table class="events-table"><thead><tr><th>Tab</th><th>Session</th><th>Events</th><th>Status</th><th>Last Activity</th></tr></thead><tbody>';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var statusColor = s.status === 'active' ? '#3ec46d' : s.status === 'idle' ? '#ffd17a' : '#ff7a7a';
      html += '<tr>';
      html += '<td>' + escapeHtml(s.tabId) + '</td>';
      html += '<td class="mono" style="font-size:10px;">' + escapeHtml((s.sessionId || '').slice(0, 12)) + '</td>';
      html += '<td>' + (s.eventCount || 0) + '</td>';
      html += '<td><span style="color:' + statusColor + ';">' + escapeHtml(s.status || 'unknown') + '</span></td>';
      html += '<td class="muted" style="font-size:11px;">' + escapeHtml(formatRelativeTime(s.lastActivity)) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    panel.innerHTML = html;
  } catch (e) {
    var panel2 = document.getElementById('tab-sessions-panel');
    if (panel2) panel2.innerHTML = '<div class="muted">Tab sessions unavailable.</div>';
  }
}
