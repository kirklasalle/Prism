import { state, request, escapeHtml, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, safeRenderStep, dashboardLog } from './dashboard-core.js';

// ── Usage sort state ────────────────────────────────────────────────────────
let _usageSort = 'cost'; // 'cost' | 'power' | 'budget'

export
  async function refreshUsagePanel() {
  try {
    const win = state.telemetryWindow || '1d';
    const data = await request('/api/usage/summary?window=' + encodeURIComponent(win)).catch(() => null);
    if (data) state.usageSummary = data;
    renderUsagePanel();
  } catch {
    renderUsagePanel();
  }
}

export
  function renderUsagePanel() {
  const container = document.getElementById('usage-cost-panel');
  if (!container) return;

  const d = state.usageSummary;
  const caps = d ? d.caps : (state.usageCaps || { sessionCap: null, dailyCap: null, monthlyCap: null });
  const models = (d && Array.isArray(d.byModel)) ? d.byModel : [];

  // ── Snapshot card ────────────────────────────────────────────────────────
  const totalCost = d ? d.totalCostUsd : 0;
  const totalIn = d ? d.totalInputTokens : 0;
  const totalOut = d ? d.totalOutputTokens : 0;
  const totalReq = d ? d.totalRequests : 0;
  const sessSpend = d ? (d.sessionCostUsd || 0) : 0;
  const daySpend = d ? (d.dailyCostUsd || 0) : 0;
  const monSpend = d ? (d.monthlyCostUsd || 0) : 0;

  function fmtCost(n) {
    if (!n) return '$0.000000';
    if (n < 0.01) return '$' + n.toFixed(6);
    if (n < 1) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }

  function fmtTok(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  function progressBar(spent, cap) {
    if (!cap || cap <= 0) return '';
    const pct = Math.min(100, (spent / cap) * 100);
    const color = pct >= 95 ? '#ff5252' : pct >= 75 ? '#ffd17a' : '#7ecf7e';
    return '<div style="margin-top:4px;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">'
      + '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + color + ';border-radius:3px;transition:width .3s;"></div>'
      + '</div>'
      + '<div class="muted" style="font-size:10px;margin-top:2px;">'
      + fmtCost(spent) + ' / ' + fmtCost(cap) + ' (' + pct.toFixed(1) + '%)'
      + '</div>';
  }

  let html = '';

  // Snapshot
  html += '<div class="action-card" style="background:rgba(50,120,255,0.07);border-color:rgba(50,120,255,0.22);">'
    + '<div style="font-size:11px;font-weight:600;opacity:.7;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">Cost Snapshot — '
    + escapeHtml(state.telemetryWindow || '1d')
    + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px 16px;">'
    + '<div class="metric" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="muted" style="font-size:10px;">Requests</span><span class="mono" style="font-size:14px;font-weight:700;">' + escapeHtml(String(totalReq)) + '</span></div>'
    + '<div class="metric" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="muted" style="font-size:10px;">Input tokens</span><span class="mono" style="font-size:14px;font-weight:700;">' + escapeHtml(fmtTok(totalIn)) + '</span></div>'
    + '<div class="metric" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="muted" style="font-size:10px;">Output tokens</span><span class="mono" style="font-size:14px;font-weight:700;">' + escapeHtml(fmtTok(totalOut)) + '</span></div>'
    + '<div class="metric" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="muted" style="font-size:10px;">Total cost</span><span class="mono" style="font-size:14px;font-weight:700;color:#7ecf7e;">' + escapeHtml(fmtCost(totalCost)) + '</span></div>'
    + '</div>'
    + (caps.sessionCap ? '<div class="muted" style="font-size:11px;margin-top:8px;">Session' + progressBar(sessSpend, caps.sessionCap) + '</div>' : '')
    + (caps.dailyCap ? '<div class="muted" style="font-size:11px;margin-top:6px;">Daily' + progressBar(daySpend, caps.dailyCap) + '</div>' : '')
    + (caps.monthlyCap ? '<div class="muted" style="font-size:11px;margin-top:6px;">Monthly' + progressBar(monSpend, caps.monthlyCap) + '</div>' : '')
    + '</div>';

  // ── Model comparison table ────────────────────────────────────────────────
  const TIER_LABEL = { 5: 'T5 Frontier', 4: 'T4 Advanced', 3: 'T3 Capable', 2: 'T2 Efficient', 1: 'T1 Minimal', 0: 'Local/Free' };

  function sortRows(rows, sort) {
    const copy = rows.slice();
    if (sort === 'power') copy.sort((a, b) => (b.tier - a.tier) || (b.totalCostUsd - a.totalCostUsd));
    if (sort === 'cost') copy.sort((a, b) => a.totalCostUsd - b.totalCostUsd);
    if (sort === 'budget') {
      // Budget = cost-efficiency: total cost per 1K requests (lower is better)
      copy.sort((a, b) => {
        const ra = a.requests > 0 ? a.totalCostUsd / a.requests : Infinity;
        const rb = b.requests > 0 ? b.totalCostUsd / b.requests : Infinity;
        return ra - rb;
      });
    }
    return copy;
  }

  const sortedModels = sortRows(models, _usageSort);

  html += '<div class="action-card" style="margin-top:8px;">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">'
    + '<span class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Model Comparison</span>'
    + '<div style="flex:1;"></div>'
    + '<button class="tab-button' + (_usageSort === 'power' ? ' active' : '') + '" style="font-size:11px;" onclick="setUsageSort(\'power\')">\u26A1 Power</button>'
    + '<button class="tab-button' + (_usageSort === 'cost' ? ' active' : '') + '" style="font-size:11px;" onclick="setUsageSort(\'cost\')">\uD83D\uDCB8 Low Cost</button>'
    + '<button class="tab-button' + (_usageSort === 'budget' ? ' active' : '') + '" style="font-size:11px;" onclick="setUsageSort(\'budget\')">\uD83C\uDFAF Budget</button>'
    + '</div>';

  if (sortedModels.length === 0) {
    html += '<div class="muted">No LLM calls recorded yet. Send a message to populate cost data.</div>';
  } else {
    html += '<div style="overflow-x:auto;">'
      + '<table class="events-table" style="min-width:680px;">'
      + '<thead><tr>'
      + '<th>Model</th><th>Provider</th><th>Tier</th><th>Requests</th>'
      + '<th>In Tokens</th><th>Out Tokens</th>'
      + '<th>$/1M In</th><th>$/1M Out</th><th>Total Cost</th>'
      + '</tr></thead><tbody>'
      + sortedModels.map(function (r) {
        const tierLbl = TIER_LABEL[r.tier] || ('T' + r.tier);
        const tierColor = r.tier >= 5 ? '#c084fc' : r.tier >= 4 ? '#60a5fa' : r.tier >= 3 ? '#7ecf7e' : '#ffd17a';
        const costColor = r.totalCostUsd > 1 ? '#ff8d8d' : r.totalCostUsd > 0.1 ? '#ffd17a' : '#7ecf7e';
        return '<tr>'
          + '<td class="mono" style="font-size:11px;">' + escapeHtml(r.label || r.model) + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(r.provider) + '</td>'
          + '<td><span class="mono" style="font-size:10px;color:' + tierColor + ';">' + escapeHtml(tierLbl) + '</span></td>'
          + '<td class="mono">' + escapeHtml(String(r.requests)) + '</td>'
          + '<td class="mono">' + escapeHtml(fmtTok(r.inputTokens)) + '</td>'
          + '<td class="mono">' + escapeHtml(fmtTok(r.outputTokens)) + '</td>'
          + '<td class="mono" style="font-size:11px;">' + (r.inputPer1M > 0 ? '$' + r.inputPer1M.toFixed(2) : '<span class="muted">free</span>') + '</td>'
          + '<td class="mono" style="font-size:11px;">' + (r.outputPer1M > 0 ? '$' + r.outputPer1M.toFixed(2) : '<span class="muted">free</span>') + '</td>'
          + '<td class="mono" style="color:' + costColor + ';font-weight:600;">' + escapeHtml(fmtCost(r.totalCostUsd)) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }
  html += '</div>';

  // ── Cost cap controls ─────────────────────────────────────────────────────
  const sessVal = caps.sessionCap != null ? String(caps.sessionCap) : '';
  const dailyVal = caps.dailyCap != null ? String(caps.dailyCap) : '';
  const monVal = caps.monthlyCap != null ? String(caps.monthlyCap) : '';

  html += '<div class="action-card" style="margin-top:8px;">'
    + '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;">Cost Cap Controls</div>'
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">'
    + '<div>'
    + '<div class="muted" style="font-size:11px;margin-bottom:4px;">Session cap (USD)</div>'
    + '<input id="cap-session" type="number" min="0" step="0.01" placeholder="e.g. 1.00" value="' + escapeHtml(sessVal) + '" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />'
    + progressBar(sessSpend, caps.sessionCap)
    + '</div>'
    + '<div>'
    + '<div class="muted" style="font-size:11px;margin-bottom:4px;">Daily cap (USD)</div>'
    + '<input id="cap-daily" type="number" min="0" step="0.01" placeholder="e.g. 5.00" value="' + escapeHtml(dailyVal) + '" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />'
    + progressBar(daySpend, caps.dailyCap)
    + '</div>'
    + '<div>'
    + '<div class="muted" style="font-size:11px;margin-bottom:4px;">Monthly cap (USD)</div>'
    + '<input id="cap-monthly" type="number" min="0" step="0.01" placeholder="e.g. 20.00" value="' + escapeHtml(monVal) + '" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />'
    + progressBar(monSpend, caps.monthlyCap)
    + '</div>'
    + '</div>'
    + '<div style="margin-top:10px;display:flex;justify-content:flex-end;gap:6px;">'
    + '<button class="secondary-button" style="font-size:12px;" onclick="clearUsageCaps()">Clear all caps</button>'
    + '<button class="primary-button" style="font-size:12px;" onclick="saveUsageCaps()">\u{1F4BE} Save caps</button>'
    + '</div>'
    + '<div id="cap-save-msg" style="font-size:11px;margin-top:6px;display:none;"></div>'
    + '</div>';

  container.innerHTML = html;
}

export
  function setUsageSort(sort) {
  _usageSort = sort;
  renderUsagePanel();
}

export
  async function saveUsageCaps() {
  const sessEl = document.getElementById('cap-session');
  const dailyEl = document.getElementById('cap-daily');
  const monEl = document.getElementById('cap-monthly');
  const msgEl = document.getElementById('cap-save-msg');

  const toNum = (el) => {
    const v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) && v > 0 ? v : null;
  };

  const caps = {
    sessionCap: toNum(sessEl),
    dailyCap: toNum(dailyEl),
    monthlyCap: toNum(monEl),
  };

  try {
    const result = await request('/api/usage/caps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(caps) });
    if (result && result.saved) {
      if (state.usageSummary) state.usageSummary.caps = result.caps;
      if (msgEl) { msgEl.textContent = '\u2713 Caps saved.'; msgEl.style.color = '#7ecf7e'; msgEl.style.display = 'block'; setTimeout(() => { msgEl.style.display = 'none'; }, 2500); }
      renderUsagePanel();
    }
  } catch {
    if (msgEl) { msgEl.textContent = 'Failed to save caps.'; msgEl.style.color = '#ff8d8d'; msgEl.style.display = 'block'; }
  }
}

export
  async function clearUsageCaps() {
  const caps = { sessionCap: null, dailyCap: null, monthlyCap: null };
  try {
    const result = await request('/api/usage/caps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(caps) });
    if (result && result.saved) {
      if (state.usageSummary) state.usageSummary.caps = result.caps;
      renderUsagePanel();
    }
  } catch { /* silent */ }
}

export
  function renderSelfReview() {
  const container = document.getElementById('self-review');
  if (!container) return;
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
  if (!container) return;
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
  if (!container) return;
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
  if (!container) return;
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
    + items.map(function (ev) {
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

// ── SLO Gauge Panel (E3c) ─────────────────────────────────────────────────────

var _sloRefreshTimer = null;

/** Fetch SLO summary from the server and render gauges. */
export function refreshSloGauges() {
  return request('/api/v1/telemetry/slo-summary').then(function (data) {
    renderSloGauges(data);
  }).catch(function (err) {
    var el = document.getElementById('slo-gauge-panel');
    if (el) el.innerHTML = '<div class="muted" style="padding:12px;">Unable to load SLO data: ' + escapeHtml(String(err)) + '</div>';
  });
}

/** Start a 5-second auto-refresh interval for the SLO panel. Clears any prior timer. */
export function startSloAutoRefresh() {
  if (_sloRefreshTimer !== null) return; // already running
  refreshSloGauges();
  _sloRefreshTimer = setInterval(function () { refreshSloGauges(); }, 5000);
}

/** Stop the SLO auto-refresh interval. */
export function stopSloAutoRefresh() {
  if (_sloRefreshTimer !== null) {
    clearInterval(_sloRefreshTimer);
    _sloRefreshTimer = null;
  }
}

var _SLO_STATUS_COLOR = { green: '#4caf50', yellow: '#ff9800', red: '#f44336', no_data: '#888' };
var _SLO_STATUS_LABEL = { green: '✅ Meeting SLO', yellow: '⚠️ Near threshold', red: '🔴 Breaching SLO', no_data: '— No data' };

function _fmtMs(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v) + ' ms';
}

function _gaugeBar(valueMs, targetMs, status) {
  if (valueMs === null || valueMs === undefined) return '<div class="muted" style="font-size:11px;">no data</div>';
  var pct = Math.min(100, Math.round((valueMs / targetMs) * 100));
  var color = _SLO_STATUS_COLOR[status] || '#888';
  return '<div style="display:flex;align-items:center;gap:8px;">'
    + '<div style="flex:1;background:var(--surface-alt,#2a2a2a);border-radius:4px;height:10px;overflow:hidden;">'
    + '<div style="width:' + pct + '%;background:' + color + ';height:100%;border-radius:4px;transition:width 0.4s;"></div>'
    + '</div>'
    + '<span style="font-size:11px;min-width:52px;text-align:right;">' + escapeHtml(_fmtMs(valueMs)) + '</span>'
    + '</div>';
}

/**
 * Render the SLO gauges panel from a SloSummary payload.
 * @param {object} data  Shape: { generatedAt, metrics: [{name, label, p50Ms, p95Ms, p99Ms, targetP95Ms, targetP99Ms, status}] }
 */
export function renderSloGauges(data) {
  var el = document.getElementById('slo-gauge-panel');
  if (!el) return;
  if (!data || !Array.isArray(data.metrics) || data.metrics.length === 0) {
    el.innerHTML = '<div class="muted" style="padding:12px;">No SLO data available.</div>';
    return;
  }
  var ts = data.generatedAt ? '<div class="muted" style="font-size:10px;margin-bottom:8px;">Updated ' + escapeHtml(formatRelativeTime(data.generatedAt)) + '</div>' : '';
  var rows = data.metrics.map(function (m) {
    var color = _SLO_STATUS_COLOR[m.status] || '#888';
    var badge = '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;">'
      + escapeHtml(_SLO_STATUS_LABEL[m.status] || m.status) + '</span>';
    return '<div class="action-card" style="margin-bottom:8px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
      + '<span style="font-weight:600;font-size:13px;">' + escapeHtml(m.label) + '</span>'
      + badge
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:2px 6px;font-weight:normal;color:var(--text-muted);">Percentile</th>'
      + '<th style="text-align:left;padding:2px 6px;font-weight:normal;color:var(--text-muted);">Value</th>'
      + '<th style="text-align:left;padding:2px 6px;font-weight:normal;color:var(--text-muted);">vs Target</th>'
      + '<th style="width:40%;padding:2px 6px;font-weight:normal;color:var(--text-muted);">Bar</th>'
      + '</tr></thead><tbody>'
      + '<tr>'
      + '<td style="padding:3px 6px;">p50</td>'
      + '<td style="padding:3px 6px;">' + escapeHtml(_fmtMs(m.p50Ms)) + '</td>'
      + '<td style="padding:3px 6px;" class="muted">—</td>'
      + '<td style="padding:3px 6px;">' + _gaugeBar(m.p50Ms, m.targetP95Ms, 'green') + '</td>'
      + '</tr>'
      + '<tr>'
      + '<td style="padding:3px 6px;">p95</td>'
      + '<td style="padding:3px 6px;">' + escapeHtml(_fmtMs(m.p95Ms)) + '</td>'
      + '<td style="padding:3px 6px;color:var(--text-muted);">target: ' + escapeHtml(_fmtMs(m.targetP95Ms)) + '</td>'
      + '<td style="padding:3px 6px;">' + _gaugeBar(m.p95Ms, m.targetP95Ms, m.status) + '</td>'
      + '</tr>'
      + '<tr>'
      + '<td style="padding:3px 6px;">p99</td>'
      + '<td style="padding:3px 6px;">' + escapeHtml(_fmtMs(m.p99Ms)) + '</td>'
      + '<td style="padding:3px 6px;color:var(--text-muted);">target: ' + escapeHtml(_fmtMs(m.targetP99Ms)) + '</td>'
      + '<td style="padding:3px 6px;">' + _gaugeBar(m.p99Ms, m.targetP99Ms, m.status) + '</td>'
      + '</tr>'
      + '</tbody></table>'
      + '</div>';
  }).join('');
  el.innerHTML = ts + rows;
}
