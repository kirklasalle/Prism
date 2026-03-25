import { state, request, escapeHtml, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, safeRenderStep, dashboardLog } from './dashboard-core.js';

export 
function renderSelfReview() {
const container = document.getElementById('self-review');
if (!state.selfReviewLatest) {
container.innerHTML = '<div class="muted">No self-review report generated yet.</div>';
return;
}

const report = state.selfReviewLatest;
const history = state.selfReviewHistory || [];
let html = ''
+ '<div class="metric"><span class="muted">Cadence</span><span class="mono">' + escapeHtml(report.cadence || '-') + '</span></div>'
+ '<div class="metric"><span class="muted">Generated</span><span class="mono">' + escapeHtml(formatRelativeTime(report.generatedAt)) + '</span></div>'
+ '<div class="metric"><span class="muted">Events</span><span class="mono">' + escapeHtml(String((report.metrics && report.metrics.eventsTotal) || 0)) + '</span></div>'
+ '<div class="metric"><span class="muted">Failures</span><span class="mono">' + escapeHtml(String((report.metrics && report.metrics.failures) || 0)) + '</span></div>';

if (report.recommendations && report.recommendations.length) {
html += '<div class="muted" style="margin-top:8px;">Top recommendation</div>'
  + '<div class="action-card" style="margin-top:6px;">' + escapeHtml(String(report.recommendations[0])) + '</div>';
}

if (history.length > 0) {
html += '<div class="muted" style="margin-top:10px;">Recent review runs</div>'
  + '<table class="events-table"><thead><tr><th>When</th><th>Cadence</th><th>Failures</th></tr></thead><tbody>'
  + history.map(item => '<tr>'
    + '<td>' + escapeHtml(formatRelativeTime(item.generatedAt)) + '</td>'
    + '<td>' + escapeHtml(item.cadence || '-') + '</td>'
    + '<td>' + escapeHtml(String((item.metrics && item.metrics.failures) || 0)) + '</td>'
    + '</tr>').join('')
  + '</tbody></table>';
}

container.innerHTML = html;
}

export 
function renderRetrievalObservability() {
const container = document.getElementById('retrieval-alerts');
const data = state.prioritizedAlerts;
if (!data || !data.alerts || !data.alerts.length) {
const hasLegacy = state.retrievalAlerts && state.retrievalAlerts.length > 0;
if (!hasLegacy) {
  container.innerHTML = '<div class="muted">No alerts.</div>';
  return;
}
let html = '<div class="stack">';
for (const alert of state.retrievalAlerts.slice(0, 5)) {
  html += '<div class="action-card" style="background:rgba(255,141,141,0.06);border-color:rgba(255,141,141,0.18)">'
    + '<div style="font-size:12px;color:var(--muted)">' + escapeHtml(alert) + '</div>'
    + '</div>';
}
if (state.retrievalAlerts.length > 5) {
  html += '<div class="muted">+ ' + (state.retrievalAlerts.length - 5) + ' more alerts</div>';
}
html += '</div>';
container.innerHTML = html;
return;
}

const severityStyle = { critical: 'rgba(255,80,80,0.12)', warning: 'rgba(255,200,80,0.10)', info: 'rgba(80,160,255,0.08)' };
const severityBorderStyle = { critical: 'rgba(255,80,80,0.35)', warning: 'rgba(255,200,80,0.30)', info: 'rgba(80,160,255,0.20)' };
const severityLabel = { critical: '🔴 Critical', warning: '🟡 Warning', info: '🔵 Info' };

let html = '';
if (data.criticalCount > 0 || data.warningCount > 0) {
html += '<div class="metric" style="margin-bottom:8px;">'
  + '<span class="muted">Summary</span>'
  + '<span class="mono">'
  + (data.criticalCount > 0 ? data.criticalCount + ' critical  ' : '')
  + (data.warningCount > 0 ? data.warningCount + ' warning  ' : '')
  + data.infoCount + ' info'
  + '</span></div>';
}

html += '<div class="stack">';
for (const alert of data.alerts.slice(0, 8)) {
const bg = severityStyle[alert.severity] || severityStyle.info;
const border = severityBorderStyle[alert.severity] || severityBorderStyle.info;
const badge = severityLabel[alert.severity] || alert.severity;
html += '<div class="action-card" style="background:' + bg + ';border-color:' + border + ';">'
  + '<div style="font-size:11px;font-weight:600;margin-bottom:4px;opacity:0.85;">' + escapeHtml(badge) + '</div>'
  + '<div style="font-size:12px;color:var(--muted)">' + escapeHtml(alert.message) + '</div>'
  + '</div>';
}
if (data.alerts.length > 8) {
html += '<div class="muted">+ ' + (data.alerts.length - 8) + ' more alerts</div>';
}
html += '</div>';
container.innerHTML = html;
}

export 
async function setTelemetryWindow(window) {
state.telemetryWindow = window;
try {
const [summary, runtimeExcellence] = await Promise.all([
  request('/api/telemetry/summary?window=' + encodeURIComponent(window)).catch(() => null),
  request('/api/runtime/excellence?window=' + encodeURIComponent(window)).catch(() => null)
]);
state.telemetrySummary = summary;
state.runtimeExcellence = runtimeExcellence;
} catch {
state.telemetrySummary = null;
state.runtimeExcellence = null;
}
render();
}

export 
function renderRuntimeExcellence() {
const container = document.getElementById('runtime-excellence');
const data = state.runtimeExcellence;
if (!data) {
container.innerHTML = '<div class="muted">Runtime excellence snapshot unavailable.</div>';
return;
}

const priorityTone = data.planner && data.planner.priority === 'high'
? 'color:#ff8d8d;'
: data.planner && data.planner.priority === 'medium'
  ? 'color:#ffd17a;'
  : 'color:#7ecf7e;';

let html = ''
+ '<div class="metric"><span class="muted">Runtime health</span><span class="mono">' + escapeHtml(String(data.scores.runtimeHealth)) + '/100</span></div>'
+ '<div class="metric"><span class="muted">Memory confidence</span><span class="mono">' + escapeHtml(String(data.scores.memoryConfidence)) + '/100</span></div>'
+ '<div class="metric"><span class="muted">Planner priority</span><span class="mono" style="' + priorityTone + '">' + escapeHtml(data.planner.priority) + '</span></div>'
+ '<div class="action-card" style="margin-top:8px;">'
+ '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Next action</div>'
+ '<div style="margin-top:6px;">' + escapeHtml(data.planner.nextAction || '-') + '</div>'
+ '<div class="muted" style="margin-top:6px;">' + escapeHtml(data.planner.rationale || '-') + '</div>'
+ '</div>';

if (data.selfHealingSuggestions && data.selfHealingSuggestions.length > 0) {
html += '<div class="muted" style="margin-top:10px;">Self-healing candidates</div>';
for (const item of data.selfHealingSuggestions.slice(0, 3)) {
  html += '<div class="action-card" style="margin-top:6px;">'
    + '<div><strong>' + escapeHtml(item.title || '-') + '</strong></div>'
    + '<div class="muted" style="margin-top:4px;">Trigger: ' + escapeHtml(item.trigger || '-') + '</div>'
    + '<div style="margin-top:4px;">' + escapeHtml(item.action || '-') + '</div>'
    + '</div>';
}
}

container.innerHTML = html;
}

export 
function renderReleaseReadiness() {
const container = document.getElementById('release-readiness');
const report = state.releaseValidation;
const decision = state.releaseDecision;
const packageSnapshot = state.packageReleaseSnapshot;
if (!report) {
let html = '<div class="muted">No release validation artifact found yet.</div>'
  + '<div class="muted" style="margin-top:8px;">Run <span class="mono">npm run release:validate</span> to generate one.</div>';
if (packageSnapshot && packageSnapshot.totalPackages > 0) {
  html += '<div class="action-card" style="margin-top:10px;">'
    + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Package Evidence</div>'
    + '<div class="metric"><span class="muted">Packages</span><span class="mono">' + escapeHtml(String(packageSnapshot.totalPackages)) + '</span></div>'
    + '<div class="metric"><span class="muted">Exports</span><span class="mono">' + escapeHtml(String(packageSnapshot.exportedCount || 0)) + '</span></div>'
    + '<div class="metric"><span class="muted">Complete without export</span><span class="mono">' + escapeHtml(String(packageSnapshot.completeWithoutExportCount || 0)) + '</span></div>'
    + (packageSnapshot.latestExportArtifactPath
      ? '<div class="muted" style="margin-top:8px;word-break:break-all;">Latest export: ' + escapeHtml(packageSnapshot.latestExportArtifactPath) + '</div>'
      : '')
    + '</div>';
}
container.innerHTML = html;
return;
}

const gates = Array.isArray(report.gates) ? report.gates : [];
const passed = gates.filter(g => g.status === 'passed').length;
const failed = gates.filter(g => g.status === 'failed').length;
const manual = gates.filter(g => g.status === 'manual_required').length;
const overallTone = report.passed ? 'color:#7ecf7e;' : 'color:#ff8d8d;';

let html = ''
+ '<div class="metric"><span class="muted">Generated</span><span class="mono">' + escapeHtml(formatRelativeTime(report.generatedAt || null)) + '</span></div>'
+ '<div class="metric"><span class="muted">Overall</span><span class="mono" style="' + overallTone + '">' + escapeHtml(report.passed ? 'ready' : 'not ready') + '</span></div>'
+ '<div class="metric"><span class="muted">Strict mode</span><span class="mono">' + escapeHtml(report.strictMode ? 'on' : 'off') + '</span></div>'
+ '<div class="metric"><span class="muted">Gate counts</span><span class="mono">' + escapeHtml(String(passed)) + ' pass / '
+ '<span style="color:#ff8d8d;">' + escapeHtml(String(failed)) + ' fail</span> / '
+ '<span style="color:#ffd17a;">' + escapeHtml(String(manual)) + ' manual</span></span></div>';

if (decision) {
const recommendationTone = decision.recommendation === 'GO' ? 'color:#7ecf7e;' : 'color:#ff8d8d;';
html += '<div class="action-card" style="margin-top:10px;">'
  + '<div class="metric"><span class="muted">Recommendation</span><span class="mono" style="' + recommendationTone + '">' + escapeHtml(decision.recommendation || '-') + '</span></div>'
  + '<div class="metric"><span class="muted">Risk level</span><span class="mono">' + escapeHtml(decision.riskLevel || '-') + '</span></div>'
  + '</div>';
}

if (packageSnapshot && packageSnapshot.totalPackages > 0) {
html += '<div class="action-card" style="margin-top:10px;">'
  + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Package Evidence</div>'
  + '<div class="metric"><span class="muted">By status</span><span class="mono">planned ' + escapeHtml(String(packageSnapshot.byStatus.planned || 0)) + ' / running ' + escapeHtml(String(packageSnapshot.byStatus.running || 0)) + ' / blocked ' + escapeHtml(String(packageSnapshot.byStatus.blocked || 0)) + ' / complete ' + escapeHtml(String(packageSnapshot.byStatus.complete || 0)) + '</span></div>'
  + '<div class="metric"><span class="muted">Exports</span><span class="mono">' + escapeHtml(String(packageSnapshot.exportedCount || 0)) + '</span></div>'
  + '<div class="metric"><span class="muted">Complete without export</span><span class="mono">' + escapeHtml(String(packageSnapshot.completeWithoutExportCount || 0)) + '</span></div>'
  + (packageSnapshot.latestExportArtifactPath
    ? '<div class="muted" style="margin-top:8px;word-break:break-all;">Latest export: ' + escapeHtml(packageSnapshot.latestExportArtifactPath) + '</div>'
    : '')
  + '</div>';
}

if (gates.length > 0) {
html += '<table class="events-table" style="margin-top:10px;"><thead><tr><th>Gate</th><th>Status</th></tr></thead><tbody>'
  + gates.slice(0, 8).map(gate => {
    const statusText = gate.status || '-';
    const tone = statusText === 'passed'
      ? 'color:#7ecf7e;'
      : statusText === 'failed'
        ? 'color:#ff8d8d;'
        : 'color:#ffd17a;';
    return '<tr>'
      + '<td>' + escapeHtml(gate.label || gate.id || '-') + '</td>'
      + '<td><span class="mono" style="' + tone + '">' + escapeHtml(statusText) + '</span></td>'
      + '</tr>';
  }).join('')
  + '</tbody></table>';
}

container.innerHTML = html;
}

export 
function renderWhatChanged() {
const container = document.getElementById('telemetry-what-changed');
if (!container) return;

const windows = ['1h', '1d', '7d'];
const btns = windows.map(w =>
'<button class="tab-button' + (state.telemetryWindow === w ? ' active' : '') + '" id="tw-' + w + '" onclick="setTelemetryWindow(&quot;' + w + '&quot;)">' + (w === '1h' ? '1 hour' : w === '1d' ? '1 day' : '7 days') + '</button>'
).join(' ');

const summary = state.telemetrySummary;
if (!summary) {
container.innerHTML = '<div class="muted">No telemetry data available for this window.</div>';
return;
}

const win = summary.window;
const delta = summary.delta;

function deltaLabel(val, higherIsBad) {
if (val === 0) return '<span class="muted">±0</span>';
const positive = val > 0;
const bad = higherIsBad ? positive : !positive;
const color = bad ? '#ff8d8d' : '#7ecf7e';
return '<span style="color:' + color + ';">' + (positive ? '+' : '') + val + '</span>';
}

function pct(val) {
return (val * 100).toFixed(1) + '%';
}

let html = '<div class="stack">';

// Window summary card
html += '<div class="action-card" style="background:rgba(80,120,255,0.06);border-color:rgba(80,120,255,0.18);">'
+ '<div style="font-size:11px;font-weight:600;opacity:0.7;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Last ' + escapeHtml(win.windowLabel === '1h' ? '1 hour' : win.windowLabel === '1d' ? '24 hours' : '7 days') + '</div>'
+ '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;">'
+ '<div class="metric"><span class="muted">Events</span><span class="mono">' + escapeHtml(String(win.eventsTotal)) + ' ' + deltaLabel(delta.eventsTotal, false) + '</span></div>'
+ '<div class="metric"><span class="muted">Failures</span><span class="mono">' + escapeHtml(String(win.failures)) + ' ' + deltaLabel(delta.failures, true) + '</span></div>'
+ '<div class="metric"><span class="muted">Approvals</span><span class="mono">' + escapeHtml(String(win.approvals)) + ' ' + deltaLabel(delta.approvals, false) + '</span></div>'
+ '<div class="metric"><span class="muted">Fail rate</span><span class="mono">' + escapeHtml(pct(win.failureRate)) + ' ' + deltaLabel(parseFloat((delta.failureRate * 100).toFixed(1)), true) + '</span></div>'
+ '</div>'
+ (summary.newSinceLastWindow ? '<div style="margin-top:8px;font-size:11px;color:#7ecf7e;font-weight:600;">✓ New activity since last window</div>' : '')
+ '</div>';

// Top operations
if (summary.topOperations && summary.topOperations.length > 0) {
html += '<div class="action-card" style="margin-top:6px;">'
  + '<div class="muted" style="font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Top Operations</div>'
  + '<table class="events-table"><thead><tr><th>Operation</th><th>Count</th><th>Failures</th></tr></thead><tbody>'
  + summary.topOperations.map(op => '<tr>'
    + '<td class="mono" style="font-size:11px;">' + escapeHtml(op.operation) + '</td>'
    + '<td>' + escapeHtml(String(op.count)) + '</td>'
    + '<td>' + (op.failures > 0 ? '<span style="color:#ff8d8d;">' + escapeHtml(String(op.failures)) + '</span>' : '0') + '</td>'
    + '</tr>').join('')
  + '</tbody></table>'
  + '</div>';
}

html += '</div>';
container.innerHTML = html;
}

export 
function deltaLabel(val, higherIsBad) {
if (val === 0) return '<span class="muted">±0</span>';
const positive = val > 0;
const bad = higherIsBad ? positive : !positive;
const color = bad ? '#ff8d8d' : '#7ecf7e';
return '<span style="color:' + color + ';">' + (positive ? '+' : '') + val + '</span>';
}

export 
function pct(val) {
return (val * 100).toFixed(1) + '%';
}

export 
function renderPackageHistory() {
const container = document.getElementById('package-history');
const history = state.sessionPackageHistory || [];
if (!container) {
return;
}
if (!history.length) {
container.innerHTML = '<div class="muted">No package history yet.</div>';
return;
}
container.innerHTML = '<table class="events-table"><thead><tr><th>Time</th><th>Package</th><th>Action</th><th>Status</th></tr></thead><tbody>'
+ history.map(entry => '<tr>'
  + '<td>' + escapeHtml(formatRelativeTime(entry.timestamp)) + '</td>'
  + '<td><div>' + escapeHtml(entry.title || entry.packageId) + '</div>'
  + (entry.message ? '<div class="muted" style="margin-top:4px;">' + escapeHtml(entry.message) + '</div>' : '') + '</td>'
  + '<td>' + escapeHtml(entry.action) + '</td>'
  + '<td>' + escapeHtml(entry.status || '-') + '</td>'
  + '</tr>').join('')
+ '</tbody></table>';
}

export 
function renderChatTelemetry() {
var container = document.getElementById('chat-telemetry');
if (!container) return;
var items = state.chatTelemetry || [];
if (!items.length) {
container.innerHTML = '<div class="muted">No chat telemetry events yet. Send a message to generate telemetry.</div>';
return;
}
var html = '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th><th>Details</th></tr></thead><tbody>'
+ items.map(function(ev) {
  var detail = '';
  var d = ev.details || {};
  if (d.model) detail += escapeHtml(d.model);
  if (d.provider) detail += (detail ? ' / ' : '') + escapeHtml(d.provider);
  if (d.toolName) detail += (detail ? ' \u2014 ' : '') + escapeHtml(d.toolName);
  if (d.intent) detail += (detail ? ' \u2014 ' : '') + escapeHtml(d.intent);
  if (d.error) detail += '<div class="muted" style="font-size:10px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(String(d.error)) + '">' + escapeHtml(String(d.error).substring(0, 80)) + '</div>';
  if (d.correlationId) detail += '<div class="mono muted" style="font-size:9px;">' + escapeHtml(String(d.correlationId).substring(0, 24)) + '&hellip;</div>';
  return '<tr>'
    + '<td>' + escapeHtml(formatRelativeTime(ev.timestamp)) + '</td>'
    + '<td class="mono" style="font-size:11px;">' + escapeHtml(ev.operation) + '</td>'
    + '<td>' + escapeHtml(ev.status) + '</td>'
    + '<td>' + (detail || '-') + '</td>'
    + '</tr>';
}).join('')
+ '</tbody></table>';
container.innerHTML = html;
}
