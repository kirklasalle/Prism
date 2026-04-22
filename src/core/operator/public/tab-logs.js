import { state, request, escapeHtml, formatRelativeTime, safeIso, dashboardLog, statusBadge } from './dashboard-core.js';

export
  function renderEvents() {
  const container = document.getElementById('events');
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
