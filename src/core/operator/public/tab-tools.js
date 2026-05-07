import { state, request, escapeHtml, healthDot, timeAgo, renderStars, approvalBadge, getToolState, getPluginState, getUtilityState, getReview, setItemRating, setItemApproval, saveItemNotes, toggleItemExpand, toggleItemEnabled, dashboardLog, formatUptime, safeRenderStep } from './dashboard-core.js';

export async function testTool(name) {
  var resultEl = document.getElementById('test-result-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
  if (resultEl) resultEl.innerHTML = '<span class="muted">Testing...</span>';
  try {
    var res = await request('/api/tools/' + encodeURIComponent(name) + '/test', { method: 'POST' });
    if (resultEl) resultEl.innerHTML = '<span style="color:#7ecf7e;">\u2713 ' + escapeHtml(res.message || 'OK') + '</span>';
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#ffc1c1;">\u2717 ' + escapeHtml(e.message) + '</span>';
  }
}

export async function checkPluginHealth(name) {
  var resultEl = document.getElementById('health-result-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
  if (resultEl) resultEl.innerHTML = '<span class="muted">Checking...</span>';
  try {
    var res = await request('/api/plugins/' + encodeURIComponent(name) + '/health', { method: 'POST' });
    var ps = getPluginState(name);
    ps.healthy = res.healthy !== false;
    ps.lastChecked = new Date().toISOString();
    if (resultEl) resultEl.innerHTML = '<span style="color:' + (ps.healthy ? '#7ecf7e' : '#ffc1c1') + ';">' + (ps.healthy ? '\u2713 Healthy' : '\u2717 Unhealthy') + '</span>';
    render();
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#ffc1c1;">\u2717 ' + escapeHtml(e.message) + '</span>';
  }
}

export function updateToolsFilter(val) {
  state.toolsFilterText = val.toLowerCase();
  render();
}

/* ═══ Panel Summary Computation ═══ */
var _toolsFallback = null; // cached later by renderToolsPanel
var _pluginsFallback = null;
var _utilitiesFallback = null;

export function computePanelSummary(kind) {
  var summary = { total: 0, enabled: 0, disabled: 0, idle: 0, healthy: 0, unhealthy: 0, warnings: 0, errors: 0, pass: 0, fail: 0, neverRun: 0, approved: 0, flagged: 0, blocked: 0, review: 0 };
  if (kind === 'tools') {
    var toolCount = _toolsFallback ? _toolsFallback.length : Math.max(19, Object.keys(state.toolStates || {}).length);
    var stateKeys = Object.keys(state.toolStates || {});
    summary.total = Math.max(toolCount, stateKeys.length);
    for (var i = 0; i < stateKeys.length; i++) {
      var ts = state.toolStates[stateKeys[i]];
      if (ts.enabled) { summary.enabled++; } else { summary.disabled++; }
      if (ts.enabled && ts.invocations === 0 && !ts.lastInvoked) { summary.idle++; }
      if (ts.failures > 0 || ts.lastError) { summary.warnings++; }
    }
    // Tools without state entries are considered enabled+idle
    var unstated = summary.total - stateKeys.length;
    summary.enabled += unstated;
    summary.idle += unstated;
    var reviews = state.toolReviews || {};
    var rKeys = Object.keys(reviews);
    for (var r = 0; r < rKeys.length; r++) {
      var rv = reviews[rKeys[r]];
      if (rv.approval === 'approved') summary.approved++;
      else if (rv.approval === 'flagged') summary.flagged++;
      else if (rv.approval === 'blocked') summary.blocked++;
      else summary.review++;
    }
  } else if (kind === 'plugins') {
    var pluginCount = _pluginsFallback ? _pluginsFallback.length : Math.max(7, Object.keys(state.pluginStates || {}).length);
    var pKeys = Object.keys(state.pluginStates || {});
    summary.total = Math.max(pluginCount, pKeys.length);
    for (var j = 0; j < pKeys.length; j++) {
      var ps = state.pluginStates[pKeys[j]];
      if (ps.enabled) { summary.enabled++; } else { summary.disabled++; }
      if (ps.healthy) { summary.healthy++; } else { summary.unhealthy++; }
      if (ps.enabled && ps.requests === 0) { summary.idle++; }
      if (ps.errors > 0) { summary.errors++; }
    }
    var pUnstated = summary.total - pKeys.length;
    summary.enabled += pUnstated;
    summary.healthy += pUnstated;
    summary.idle += pUnstated;
  } else if (kind === 'utilities') {
    var utilCount = _utilitiesFallback ? _utilitiesFallback.length : 30;
    var uKeys = Object.keys(state.utilityStates || {});
    summary.total = Math.max(utilCount, uKeys.length);
    for (var u = 0; u < uKeys.length; u++) {
      var us = state.utilityStates[uKeys[u]];
      if (us.lastResult === 'pass') { summary.pass++; }
      else if (us.lastResult === 'fail') { summary.fail++; }
      if (us.runCount === 0 || !us.lastRun) { summary.neverRun++; }
    }
    var uUnstated = summary.total - uKeys.length;
    summary.neverRun += uUnstated;
  }
  return summary;
}

export function renderPanelSummaries() {
  // Tools panel summary
  var toolsSummaryEl = document.getElementById('toolsPanel-summary');
  if (toolsSummaryEl) {
    if (state.toolsPanelCollapsed) {
      var ts = computePanelSummary('tools');
      var h = '';
      if (ts.enabled > 0) h += '<span class="tp-panel-badge badge-enabled">\u2705 ' + ts.enabled + ' enabled</span>';
      if (ts.disabled > 0) h += '<span class="tp-panel-badge badge-disabled">\u23F8 ' + ts.disabled + ' disabled</span>';
      if (ts.idle > 0) h += '<span class="tp-panel-badge badge-idle">\uD83D\uDCA4 ' + ts.idle + ' idle</span>';
      if (ts.warnings > 0) h += '<span class="tp-panel-badge badge-warning">\u26A0\uFE0F ' + ts.warnings + ' warning' + (ts.warnings > 1 ? 's' : '') + '</span>';
      if (ts.flagged > 0) h += '<span class="tp-panel-badge badge-error">\uD83D\uDEA9 ' + ts.flagged + ' flagged</span>';
      if (ts.blocked > 0) h += '<span class="tp-panel-badge badge-error">\u26D4 ' + ts.blocked + ' blocked</span>';
      toolsSummaryEl.innerHTML = h;
      toolsSummaryEl.style.display = '';
    } else {
      toolsSummaryEl.style.display = 'none';
    }
  }
  // Plugins panel summary
  var pluginsSummaryEl = document.getElementById('pluginsPanel-summary');
  if (pluginsSummaryEl) {
    if (state.pluginsPanelCollapsed) {
      var ps = computePanelSummary('plugins');
      var ph = '';
      if (ps.healthy > 0) ph += '<span class="tp-panel-badge badge-healthy">\u2705 ' + ps.healthy + ' healthy</span>';
      if (ps.unhealthy > 0) ph += '<span class="tp-panel-badge badge-unhealthy">\u274C ' + ps.unhealthy + ' unhealthy</span>';
      if (ps.idle > 0) ph += '<span class="tp-panel-badge badge-idle">\uD83D\uDCA4 ' + ps.idle + ' idle</span>';
      if (ps.disabled > 0) ph += '<span class="tp-panel-badge badge-disabled">\u23F8 ' + ps.disabled + ' disabled</span>';
      if (ps.errors > 0) ph += '<span class="tp-panel-badge badge-error">\u26A0\uFE0F ' + ps.errors + ' error' + (ps.errors > 1 ? 's' : '') + '</span>';
      pluginsSummaryEl.innerHTML = ph;
      pluginsSummaryEl.style.display = '';
    } else {
      pluginsSummaryEl.style.display = 'none';
    }
  }
  // Utilities panel summary
  var utilitiesSummaryEl = document.getElementById('utilitiesPanel-summary');
  if (utilitiesSummaryEl) {
    if (state.utilitiesPanelCollapsed) {
      var us = computePanelSummary('utilities');
      var uh = '';
      if (us.pass > 0) uh += '<span class="tp-panel-badge badge-pass">\u2705 ' + us.pass + ' pass</span>';
      if (us.fail > 0) uh += '<span class="tp-panel-badge badge-fail">\u274C ' + us.fail + ' fail</span>';
      if (us.neverRun > 0) uh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 ' + us.neverRun + ' never run</span>';
      utilitiesSummaryEl.innerHTML = uh;
      utilitiesSummaryEl.style.display = '';
    } else {
      utilitiesSummaryEl.style.display = 'none';
    }
  }
  // Diagnostics panel summary (aggregates all child diagnostics)
  var diagSummaryEl = document.getElementById('diagnosticsPanel-summary');
  if (diagSummaryEl) {
    if (state.diagnosticsPanelCollapsed) {
      var allDiag = [
        computeDiagnosticsSummary(),
        computeAgentDiagnosticsSummary(),
        computeComputerDiagnosticsSummary(),
        computeWorkspaceDiagnosticsSummary(),
        computeNetworkDiagnosticsSummary(),
        computeTelemetryDiagnosticsSummary(),
        computeLogsDiagnosticsSummary(),
        computeSchedulerDiagnosticsSummary()
      ];
      var totalPasses = 0, totalFailures = 0, anyRunning = false;
      for (var di = 0; di < allDiag.length; di++) {
        totalPasses += allDiag[di].passes || 0;
        totalFailures += allDiag[di].failures || 0;
        if (allDiag[di].running) anyRunning = true;
      }
      var dh = '';
      if (anyRunning) { dh += '<span class="tp-panel-badge badge-idle">\u23F3 Running\u2026</span>'; }
      else if (totalPasses > 0 || totalFailures > 0) {
        if (totalPasses > 0) dh += '<span class="tp-panel-badge badge-pass">\u2705 ' + totalPasses + ' passed</span>';
        if (totalFailures > 0) dh += '<span class="tp-panel-badge badge-fail">\u274C ' + totalFailures + ' failed</span>';
      } else {
        dh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 No results yet</span>';
      }
      diagSummaryEl.innerHTML = dh;
      diagSummaryEl.style.display = '';
    } else {
      diagSummaryEl.style.display = 'none';
    }
  }
  // Agent Diagnostics panel summary
  var agentDiagSummaryEl = document.getElementById('agentDiagnosticsPanel-summary');
  if (agentDiagSummaryEl) {
    if (state.agentDiagnosticsPanelCollapsed) {
      var ads = computeAgentDiagnosticsSummary();
      var adh = '';
      if (ads.running) { adh += '<span class="tp-panel-badge badge-idle">\u23F3 Running\u2026</span>'; }
      else if (ads.passes > 0 || ads.failures > 0) {
        if (ads.passes > 0) adh += '<span class="tp-panel-badge badge-pass">\u2705 ' + ads.passes + ' passed</span>';
        if (ads.failures > 0) adh += '<span class="tp-panel-badge badge-fail">\u274C ' + ads.failures + ' failed</span>';
      } else {
        adh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 No results yet</span>';
      }
      agentDiagSummaryEl.innerHTML = adh;
      agentDiagSummaryEl.style.display = '';
    } else {
      agentDiagSummaryEl.style.display = 'none';
    }
  }
  // Computer Diagnostics panel summary
  var computerDiagSummaryEl = document.getElementById('computerDiagnosticsPanel-summary');
  if (computerDiagSummaryEl) {
    if (state.computerDiagnosticsPanelCollapsed) {
      var cds = computeComputerDiagnosticsSummary();
      var cdh = '';
      if (cds.running) { cdh += '<span class="tp-panel-badge badge-idle">\u23F3 Running\u2026</span>'; }
      else if (cds.passes > 0 || cds.failures > 0) {
        if (cds.passes > 0) cdh += '<span class="tp-panel-badge badge-pass">\u2705 ' + cds.passes + ' passed</span>';
        if (cds.failures > 0) cdh += '<span class="tp-panel-badge badge-fail">\u274C ' + cds.failures + ' failed</span>';
      } else {
        cdh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 No results yet</span>';
      }
      computerDiagSummaryEl.innerHTML = cdh;
      computerDiagSummaryEl.style.display = '';
    } else {
      computerDiagSummaryEl.style.display = 'none';
    }
  }
  // Telemetry Diagnostics panel summary
  var telDiagSummaryEl = document.getElementById('telemetryDiagnosticsPanel-summary');
  if (telDiagSummaryEl) {
    if (state.telemetryDiagnosticsPanelCollapsed) {
      var tds = computeTelemetryDiagnosticsSummary();
      var tdh = '';
      if (tds.running) { tdh += '<span class="tp-panel-badge badge-idle">\u23F3 Running\u2026</span>'; }
      else if (tds.passes > 0 || tds.failures > 0) {
        if (tds.passes > 0) tdh += '<span class="tp-panel-badge badge-pass">\u2705 ' + tds.passes + ' passed</span>';
        if (tds.failures > 0) tdh += '<span class="tp-panel-badge badge-fail">\u274C ' + tds.failures + ' failed</span>';
      } else {
        tdh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 No results yet</span>';
      }
      telDiagSummaryEl.innerHTML = tdh;
      telDiagSummaryEl.style.display = '';
    } else {
      telDiagSummaryEl.style.display = 'none';
    }
  }
  // Scheduler Diagnostics panel summary
  var schedDiagSummaryEl = document.getElementById('schedulerDiagnosticsPanel-summary');
  if (schedDiagSummaryEl) {
    if (state.schedulerDiagnosticsPanelCollapsed) {
      var sds = computeSchedulerDiagnosticsSummary();
      var sdh = '';
      if (sds.running) { sdh += '<span class="tp-panel-badge badge-idle">\u23F3 Running\u2026</span>'; }
      else if (sds.passes > 0 || sds.failures > 0) {
        if (sds.passes > 0) sdh += '<span class="tp-panel-badge badge-pass">\u2705 ' + sds.passes + ' passed</span>';
        if (sds.failures > 0) sdh += '<span class="tp-panel-badge badge-fail">\u274C ' + sds.failures + ' failed</span>';
      } else {
        sdh += '<span class="tp-panel-badge badge-never">\uD83D\uDCA4 No results yet</span>';
      }
      schedDiagSummaryEl.innerHTML = sdh;
      schedDiagSummaryEl.style.display = '';
    } else {
      schedDiagSummaryEl.style.display = 'none';
    }
  }
}

/* ═══ Sub-Tab Navigation ═══ */
export function switchToolsSubTab(tab) {
  state.toolsSubTab = tab;
  var subTabs = document.querySelectorAll('.tp-sub-tab');
  for (var i = 0; i < subTabs.length; i++) {
    var btn = subTabs[i];
    var isActive = btn.getAttribute('data-subtab') === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
  var panels = document.querySelectorAll('.tp-sub-panel');
  for (var p = 0; p < panels.length; p++) {
    panels[p].style.display = panels[p].id === 'sub-panel-' + tab ? '' : 'none';
  }
  dashboardLog('tools', 'subtab.switch', 'Switched to ' + tab + ' sub-tab');
  render();
}

function renderSubTabCounts() {
  var ts = computePanelSummary('tools');
  var ps = computePanelSummary('plugins');
  var us = computePanelSummary('utilities');
  // Counts
  var countTools = document.getElementById('subtab-count-tools');
  var countPlugins = document.getElementById('subtab-count-plugins');
  var countUtils = document.getElementById('subtab-count-utilities');
  if (countTools) countTools.textContent = ts.total;
  if (countPlugins) countPlugins.textContent = ps.total;
  if (countUtils) countUtils.textContent = us.total;
  // Status dots
  var dotTools = document.getElementById('subtab-dot-tools');
  var dotPlugins = document.getElementById('subtab-dot-plugins');
  var dotUtils = document.getElementById('subtab-dot-utilities');
  if (dotTools) {
    dotTools.className = 'tp-sub-tab-dot' + (ts.warnings > 0 ? ' dot-amber' : (ts.disabled > 0 ? ' dot-amber' : ' dot-green'));
  }
  if (dotPlugins) {
    dotPlugins.className = 'tp-sub-tab-dot' + (ps.unhealthy > 0 ? ' dot-red' : (ps.errors > 0 ? ' dot-amber' : ' dot-green'));
  }
  if (dotUtils) {
    dotUtils.className = 'tp-sub-tab-dot' + (us.fail > 0 ? ' dot-red' : (us.neverRun > us.total * 0.5 ? ' dot-amber' : ' dot-green'));
  }
}

/* ═══ Sort Helpers ═══ */
export function setToolsSort(val) { state.toolsSortBy = val; render(); }
export function setPluginsSort(val) { state.pluginsSortBy = val; render(); }
export function setUtilitiesSort(val) { state.utilitiesSortBy = val; render(); }

function sortTools(tools) {
  var key = state.toolsSortBy || 'name';
  return tools.slice().sort(function (a, b) {
    if (key === 'status') {
      var sa = getToolState(a.name).enabled ? 1 : 0;
      var sb = getToolState(b.name).enabled ? 1 : 0;
      return sb - sa;
    }
    if (key === 'risk') {
      var riskOrder = { high: 0, medium: 1, low: 2 };
      return (riskOrder[a.risk] || 1) - (riskOrder[b.risk] || 1);
    }
    if (key === 'usage') {
      return (getToolState(b.name).invocations || 0) - (getToolState(a.name).invocations || 0);
    }
    if (key === 'lastUsed') {
      var la = getToolState(a.name).lastInvoked || '';
      var lb = getToolState(b.name).lastInvoked || '';
      return lb.localeCompare(la);
    }
    return a.name.localeCompare(b.name);
  });
}

function sortPlugins(plugins) {
  var key = state.pluginsSortBy || 'name';
  return plugins.slice().sort(function (a, b) {
    if (key === 'health') {
      var ha = getPluginState(a.name).healthy ? 1 : 0;
      var hb = getPluginState(b.name).healthy ? 1 : 0;
      return hb - ha;
    }
    if (key === 'requests') {
      return (getPluginState(b.name).requests || 0) - (getPluginState(a.name).requests || 0);
    }
    if (key === 'trust') {
      var trustOrder = { high: 0, medium: 1, low: 2 };
      return (trustOrder[a.trust] || 1) - (trustOrder[b.trust] || 1);
    }
    return a.name.localeCompare(b.name);
  });
}

function sortUtilities(utils) {
  var key = state.utilitiesSortBy || 'name';
  return utils.slice().sort(function (a, b) {
    if (key === 'result') {
      var ra = getUtilityState(a.name).lastResult || '';
      var rb = getUtilityState(b.name).lastResult || '';
      return rb.localeCompare(ra);
    }
    if (key === 'runs') {
      return (getUtilityState(b.name).runCount || 0) - (getUtilityState(a.name).runCount || 0);
    }
    if (key === 'lastRun') {
      var la = getUtilityState(a.name).lastRun || '';
      var lb = getUtilityState(b.name).lastRun || '';
      return lb.localeCompare(la);
    }
    return a.name.localeCompare(b.name);
  });
}

function toolCardStateClass(ts) {
  if (!ts.enabled) return '';
  if (ts.failures > 0 || ts.lastError) return ' tp-warning';
  if (ts.invocations === 0 && !ts.lastInvoked) return ' tp-idle';
  return '';
}

function toolCardStateBadge(ts) {
  if (!ts.enabled) return '';
  if (ts.failures > 0 || ts.lastError) return '<span class="tp-card-state-badge csb-warning">\u26A0 warn</span>';
  if (ts.invocations === 0 && !ts.lastInvoked) return '<span class="tp-card-state-badge csb-idle">\uD83D\uDCA4 idle</span>';
  return '';
}

function pluginCardStateClass(ps) {
  if (!ps.healthy) return ' tp-error';
  if (ps.errors > 0) return ' tp-warning';
  if (ps.enabled && ps.requests === 0) return ' tp-idle';
  return ' tp-healthy';
}

function pluginCardStateBadge(ps) {
  if (!ps.healthy) return '<span class="tp-card-state-badge csb-error">\u274C unhealthy</span>';
  if (ps.errors > 0) return '<span class="tp-card-state-badge csb-warning">\u26A0 errors</span>';
  if (ps.enabled && ps.requests === 0) return '<span class="tp-card-state-badge csb-idle">\uD83D\uDCA4 idle</span>';
  return '';
}

function utilityCardStateClass(us) {
  if (us.lastResult === 'fail') return ' tp-error';
  if (us.runCount === 0 || !us.lastRun) return ' tp-idle';
  return '';
}

function utilityCardStateBadge(us) {
  if (us.lastResult === 'fail') return '<span class="tp-card-state-badge csb-error">\u274C fail</span>';
  if (us.runCount === 0 || !us.lastRun) return '<span class="tp-card-state-badge csb-idle">\uD83D\uDCA4 never run</span>';
  return '';
}

/* ═══ Refresh All ═══ */
export async function refreshAllToolStatus() {
  var btn = document.getElementById('tp-refresh-all');
  if (btn) { btn.classList.add('refreshing'); btn.disabled = true; }
  try {
    var results = await Promise.all([
      request('/api/tools/status').catch(function () { return null; }),
      request('/api/plugins/status').catch(function () { return null; }),
      request('/api/utilities/status').catch(function () { return null; })
    ]);
    if (results[0]) {
      if (results[0].tools) state.toolStates = results[0].tools;
      if (results[0].catalog) state.toolCatalog = results[0].catalog;
    }
    if (results[1] && results[1].plugins) state.pluginStates = results[1].plugins;
    if (results[2] && results[2].utilities) state.utilityStates = results[2].utilities;
    var barEl = document.getElementById('tools-overview-bar');
    if (barEl) { var inner = barEl.querySelector('.tp-overview-bar'); if (inner) inner.classList.add('tp-pulse'); setTimeout(function () { if (inner) inner.classList.remove('tp-pulse'); }, 600); }
    dashboardLog('tools', 'refresh.all', 'Refreshed tool, plugin, and utility status');
  } catch (e) {
    dashboardLog('tools', 'refresh.error', 'Refresh failed: ' + e.message);
  }
  if (btn) { btn.classList.remove('refreshing'); btn.disabled = false; }
  render();
}

// Listen for collapse toggle events to refresh summaries
document.addEventListener('panel-collapse-toggle', function (e) {
  var detail = e.detail || {};
  if (detail.panelKey === 'toolsPanel' || detail.panelKey === 'pluginsPanel' || detail.panelKey === 'utilitiesPanel' || detail.panelKey === 'diagnosticsPanel' || detail.panelKey === 'agentDiagnosticsPanel') {
    renderPanelSummaries();
  }
});

export
  /* ═══ Overview Bar ═══ */
  function renderToolsOverviewBar() {
  var bar = document.getElementById('tools-overview-bar');
  if (!bar) return;
  var ts = computePanelSummary('tools');
  var ps = computePanelSummary('plugins');
  var us = computePanelSummary('utilities');

  var html = '<div class="tp-overview-bar">';
  html += '<span class="tp-status-dot green"></span>';
  html += '<span class="tp-overview-stat">' + ts.enabled + '/' + ts.total + ' tools <span class="muted">enabled</span></span>';
  html += '<span style="color:var(--muted);">\u2502</span>';
  html += '<span class="tp-overview-stat">' + ps.healthy + '/' + ps.total + ' plugins <span class="muted">healthy</span></span>';
  html += '<span style="color:var(--muted);">\u2502</span>';
  html += '<span class="tp-overview-stat">' + us.total + ' <span class="muted">utilities</span></span>';

  // Warning/error indicators
  var totalWarnings = ts.warnings + ps.errors;
  var totalErrors = ps.unhealthy + us.fail;
  if (totalWarnings > 0 || totalErrors > 0) {
    html += '<span style="color:var(--muted);">\u2502</span>';
    html += '<span class="tp-overview-warnings">';
    if (totalWarnings > 0) html += '<span class="tp-overview-warn-badge owb-warning">\u26A0\uFE0F ' + totalWarnings + ' warning' + (totalWarnings > 1 ? 's' : '') + '</span>';
    if (totalErrors > 0) html += '<span class="tp-overview-warn-badge owb-error">\u274C ' + totalErrors + ' error' + (totalErrors > 1 ? 's' : '') + '</span>';
    html += '</span>';
  }

  html += '<span style="flex:1;"></span>';
  html += '<button id="tp-refresh-all" class="tp-overview-refresh" onclick="refreshAllToolStatus()" title="Refresh all tool, plugin, and utility status">\uD83D\uDD04 Refresh</button>';
  html += '<input class="tp-filter-input" type="text" placeholder="\uD83D\uDD0D Filter by name..." value="' + escapeHtml(state.toolsFilterText) + '" oninput="updateToolsFilter(this.value)">';
  html += '</div>';
  bar.innerHTML = html;

  // Update panel summaries
  renderPanelSummaries();
}

export
  function renderToolsPanel() {
  var container = document.getElementById('tools-panel');
  if (!container) return;
  renderToolsOverviewBar();

  var fallbackTools = [
    { name: 'file_read', cat: 'System', desc: 'Read file contents with encoding support', risk: 'low', mut: false },
    { name: 'file_write', cat: 'System', desc: 'Write or append content to files', risk: 'medium', mut: true },
    { name: 'file_delete', cat: 'System', desc: 'Delete files and directories', risk: 'high', mut: true },
    { name: 'file_list', cat: 'System', desc: 'List directory contents with file type detection', risk: 'low', mut: false },
    { name: 'shell_exec', cat: 'System', desc: 'Execute shell commands with blocked-pattern protection', risk: 'high', mut: true },
    { name: 'terminal_session', cat: 'System', desc: 'Manage interactive terminal sessions with lifecycle control', risk: 'medium', mut: true },
    { name: 'container_sandbox', cat: 'System', desc: 'Create and manage containerized sandbox environments', risk: 'medium', mut: true },
    { name: 'http_request', cat: 'Integration', desc: 'Execute HTTP requests (GET/POST/PUT/PATCH/DELETE)', risk: 'medium', mut: true },
    { name: 'email_ops', cat: 'Application', desc: 'Email operations \u2014 summarize, reply, and send', risk: 'medium', mut: true },
    { name: 'calendar_plan', cat: 'Application', desc: 'Calendar management \u2014 availability and scheduling', risk: 'medium', mut: true },
    { name: 'notes_extract', cat: 'Application', desc: 'Notes management \u2014 capture, extract, and persist', risk: 'medium', mut: true },
    { name: 'tasks_timeline', cat: 'Application', desc: 'Task timeline planning and commitment', risk: 'medium', mut: true },
    { name: 'neo4j_query', cat: 'Knowledge', desc: 'Execute Cypher queries against Neo4j graph database', risk: 'medium', mut: false },
    { name: 'memory_query', cat: 'Knowledge', desc: 'Query episodic, semantic, or session memory stores', risk: 'low', mut: false },
    { name: 'semantic_query', cat: 'Knowledge', desc: 'Semantic memory index with multiple retrieval modes', risk: 'low', mut: false },
    { name: 'nexus_check_hotline', cat: 'Integration', desc: 'Read broadcast messages from Nexus hotline', risk: 'low', mut: false },
    { name: 'nexus_read_memory', cat: 'Integration', desc: 'Read Nexus primary memory store', risk: 'low', mut: false },
    { name: 'nexus_log_insight', cat: 'Integration', desc: 'Append insights to Nexus daily memory log', risk: 'medium', mut: true },
    { name: 'nexus_broadcast', cat: 'Integration', desc: 'Send STP messages to Nexus thread or hotline', risk: 'medium', mut: true }
  ];

  var tools = (Array.isArray(state.toolCatalog) && state.toolCatalog.length > 0)
    ? state.toolCatalog.slice()
    : fallbackTools.slice();

  var knownTools = {};
  for (var k = 0; k < tools.length; k++) {
    knownTools[tools[k].name] = true;
  }
  var observedToolNames = Object.keys(state.toolStates || {}).filter(function (name) {
    return !knownTools[name];
  }).sort();
  for (var oi = 0; oi < observedToolNames.length; oi++) {
    var observedName = observedToolNames[oi];
    tools.push({
      name: observedName,
      cat: 'Observed',
      desc: 'Observed from backend telemetry stream',
      risk: 'medium',
      mut: false
    });
  }

  var riskColor = { low: '#7ecf7e', medium: '#ffd17a', high: '#ffc1c1' };
  var riskBg = { low: 'rgba(126,207,126,0.15)', medium: 'rgba(255,200,80,0.12)', high: 'rgba(255,141,141,0.12)' };
  var catIcon = { System: '\uD83D\uDDA5\uFE0F', Application: '\uD83D\uDCCB', Knowledge: '\uD83E\uDDE0', Integration: '\uD83D\uDD17', Observed: '\uD83D\uDCE1' };
  var filter = state.toolsFilterText || '';

  var categories = ['System', 'Application', 'Knowledge', 'Integration'];
  var seenCategories = {};
  for (var ci = 0; ci < categories.length; ci++) seenCategories[categories[ci]] = true;
  for (var ti = 0; ti < tools.length; ti++) {
    var candidateCategory = tools[ti].cat || 'System';
    if (!seenCategories[candidateCategory]) {
      categories.push(candidateCategory);
      seenCategories[candidateCategory] = true;
    }
  }
  if (observedToolNames.length > 0 && !seenCategories.Observed) {
    categories.push('Observed');
  }
  _toolsFallback = tools; // cache for computePanelSummary

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
  html += '<span class="muted">' + tools.length + ' tools registered across ' + categories.length + ' categories.</span>';
  html += '<div class="tp-sort-controls"><label>Sort:</label><select class="tp-sort-select" onchange="setToolsSort(this.value)">';
  var sortOpts = [['name', 'Name'], ['status', 'Status'], ['risk', 'Risk'], ['usage', 'Usage'], ['lastUsed', 'Last Used']];
  for (var so = 0; so < sortOpts.length; so++) {
    html += '<option value="' + sortOpts[so][0] + '"' + (state.toolsSortBy === sortOpts[so][0] ? ' selected' : '') + '>' + sortOpts[so][1] + '</option>';
  }
  html += '</select></div></div>';

  // Apply sort
  var sortedTools = sortTools(tools);

  for (var c = 0; c < categories.length; c++) {
    var cat = categories[c];
    var catTools = sortedTools.filter(function (t) { return t.cat === cat && (!filter || t.name.toLowerCase().indexOf(filter) !== -1 || t.desc.toLowerCase().indexOf(filter) !== -1); });
    if (!catTools.length) continue;
    html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catTools.length + ')</span></div>';
    for (var i = 0; i < catTools.length; i++) {
      var t = catTools[i];
      var ts = getToolState(t.name);
      var rv = getReview(state.toolReviews, t.name);
      var isExpanded = state.expandedToolId === t.name;
      var safeId = t.name.replace(/[^a-zA-Z0-9]/g, '_');

      html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + toolCardStateClass(ts) + '">';

      /* ── collapsed header ── */
      html += '<div class="tp-card-head" onclick="toggleItemExpand(\'tool\', \'' + escapeHtml(t.name) + '\')" data-tooltip="Category: ' + escapeHtml(t.cat) + ' | Risk: ' + escapeHtml(t.risk) + ' | ' + (t.mut ? 'Mutating' : 'Read-only') + '\\n' + escapeHtml(t.desc) + '">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span class="tp-card-name">' + escapeHtml(t.name) + '</span>';
      html += healthDot(ts.enabled);
      html += toolCardStateBadge(ts);
      html += '</div>';
      html += '<div class="tp-card-desc">' + escapeHtml(t.desc) + '</div>';
      html += '<div class="tp-card-meta">';
      if (ts.invocations > 0) html += '<span class="tp-meta-tag">\uD83D\uDCCA ' + ts.invocations + ' calls</span>';
      if (ts.lastInvoked) html += '<span class="tp-meta-tag">\uD83D\uDD52 ' + timeAgo(ts.lastInvoked) + '</span>';
      html += '</div>';
      html += '</div>';
      html += '<div class="tp-card-badges">';
      html += '<span class="ps-badge" style="background:' + riskBg[t.risk] + ';color:' + riskColor[t.risk] + ';">' + escapeHtml(t.risk) + '</span>';
      html += '<span class="ps-badge" style="background:' + (t.mut ? 'rgba(255,200,80,0.12);color:#ffd17a' : 'rgba(126,207,126,0.15);color:#7ecf7e') + ';">' + (t.mut ? 'mutating' : 'read-only') + '</span>';
      html += approvalBadge(rv.approval);
      html += '</div></div>';

      /* ── expanded body ── */
      html += '<div class="tp-card-body">';

      /* Controls */
      html += '<div class="tp-section"><div class="tp-section-title">\u2699\uFE0F Controls</div>';
      html += '<div class="tp-controls">';
      html += '<label class="tp-toggle"><input type="checkbox" ' + (ts.enabled ? 'checked' : '') + ' onchange="toggleItemEnabled(\'tool\', \'' + escapeHtml(t.name) + '\')"><span class="tp-toggle-track"></span>' + (ts.enabled ? 'Enabled' : 'Disabled') + '</label>';
      html += '<button class="secondary-button" style="font-size:11px;padding:4px 12px;" onclick="testTool(\'' + escapeHtml(t.name) + '\')">\u{1F9EA} Test Tool</button>';
      html += '</div>';
      html += '<div id="test-result-' + safeId + '" style="margin-top:6px;font-size:12px;"></div>';
      html += '</div>';

      /* Telemetry */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
      html += '<div class="tp-stat-row">';
      html += '<div class="tp-stat"><span class="tp-stat-label">Invocations</span><span class="tp-stat-value">' + ts.invocations + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Success</span><span class="tp-stat-value" style="color:#7ecf7e;">' + ts.successes + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Failures</span><span class="tp-stat-value" style="color:#ffc1c1;">' + ts.failures + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Avg Latency</span><span class="tp-stat-value">' + (ts.avgLatencyMs ? ts.avgLatencyMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Last Used</span><span class="tp-stat-value">' + timeAgo(ts.lastInvoked) + '</span></div>';
      html += '</div>';
      if (ts.lastError) html += '<div style="margin-top:6px;font-size:11px;color:#ffc1c1;">Last error: ' + escapeHtml(ts.lastError) + '</div>';
      html += '</div>';

      /* Governance */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDEE1\uFE0F Governance</div>';
      html += '<div class="tp-stat-row">';
      html += '<div class="tp-stat"><span class="tp-stat-label">Risk Level</span><span class="tp-stat-value" style="color:' + riskColor[t.risk] + ';">' + t.risk.toUpperCase() + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Mutating</span><span class="tp-stat-value">' + (t.mut ? 'Yes' : 'No') + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Category</span><span class="tp-stat-value">' + escapeHtml(t.cat) + '</span></div>';
      html += '</div></div>';

      /* Review */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
      html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      html += renderStars(state.toolReviews, t.name, 'tool');
      html += approvalBadge(rv.approval);
      html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\'tool\', \'' + escapeHtml(t.name) + '\', this.value)">';
      var approvals = ['review', 'approved', 'flagged', 'blocked'];
      for (var a = 0; a < approvals.length; a++) {
        html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
      }
      html += '</select>';
      if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><textarea id="review-notes-tool-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\'tool\', \'' + escapeHtml(t.name) + '\')">' + escapeHtml(rv.notes) + '</textarea></div>';
      html += '</div>';

      html += '</div></div>';
    }
  }
  html += '<div style="margin-top:16px;text-align:center;">';
  html += '<button class="secondary-button" style="font-size:12px;padding:8px 20px;" onclick="showRegisterToolForm()">➕ Register Custom Tool</button>';
  html += '</div>';
  container.innerHTML = html;
}

export
  function showRegisterToolForm() {
  var existing = document.getElementById('register-tool-form');
  if (existing) { existing.remove(); return; }
  var container = document.getElementById('tools-panel');
  if (!container) return;
  var form = document.createElement('div');
  form.id = 'register-tool-form';
  form.style.cssText = 'margin-top:12px;padding:14px;border:1px solid var(--accent);border-radius:12px;background:rgba(0,0,0,0.2);';
  form.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;">➕ Register Custom Tool</div>'
    + '<div class="ps-field"><label>Name</label><input id="reg-tool-name" placeholder="my_custom_tool"></div>'
    + '<div class="ps-field"><label>Description</label><input id="reg-tool-desc" placeholder="What does this tool do?"></div>'
    + '<div class="ps-field"><label>Category</label><select id="reg-tool-cat" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>System</option><option>Application</option><option>Knowledge</option><option>Integration</option></select></div>'
    + '<div class="ps-field"><label>Risk Level</label><select id="reg-tool-risk" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>low</option><option>medium</option><option>high</option></select></div>'
    + '<div class="ps-field"><label>Endpoint / Command</label><input id="reg-tool-endpoint" placeholder="http://localhost:9000/tool or /usr/bin/mytool"></div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;">'
    + '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="submitRegisterTool()">Register</button>'
    + '<button class="secondary-button" style="font-size:12px;padding:6px 16px;" onclick="cancelRegisterTool()">Cancel</button>'
    + '</div>';
  container.appendChild(form);
}

export function cancelRegisterTool() {
  var form = document.getElementById('register-tool-form');
  if (form) form.remove();
}

export function submitRegisterTool() {
  var name = document.getElementById('reg-tool-name');
  var desc = document.getElementById('reg-tool-desc');
  var cat = document.getElementById('reg-tool-cat');
  var risk = document.getElementById('reg-tool-risk');
  var endpoint = document.getElementById('reg-tool-endpoint');
  if (!name || !name.value.trim()) { alert('Tool name is required'); return; }
  fetch('/api/tools/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.value.trim(), description: desc ? desc.value : '', category: cat ? cat.value : 'System', risk: risk ? risk.value : 'medium', endpoint: endpoint ? endpoint.value : '' })
  }).then(function () {
    var form = document.getElementById('register-tool-form');
    if (form) form.remove();
  }).catch(function (e) { alert('Registration failed: ' + e.message); });
}

export
  function renderPluginsPanel() {
  var container = document.getElementById('plugins-panel');
  if (!container) return;

  var plugins = [
    { name: 'ids-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'IDS identity services \u2014 authentication, token lifecycle, and credential management', status: 'Active', trust: 'high', port: 8100 },
    { name: 'impressioncore-eds', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Enterprise Data Services \u2014 structured data ingestion, transformation, and schema enforcement', status: 'Active', trust: 'high', port: 8200 },
    { name: 'impressioncore-ipa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Intelligent Process Automation \u2014 task queuing, workflow dispatch, and RPA bridge', status: 'Active', trust: 'high', port: 8201 },
    { name: 'impressioncore-goliath', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Large-scale data pipeline orchestration \u2014 batch ETL, partitioned processing, and backpressure control', status: 'Active', trust: 'high', port: 8202 },
    { name: 'impressioncore-vrgc', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Visual Rendering & Graphics Compute \u2014 image generation, chart rendering, and GPU-accelerated transforms', status: 'Active', trust: 'high', port: 8203 },
    { name: 'impressioncore-dpa', group: 'ImpressionCore Suite', type: 'Python MCP Server', desc: 'Document Processing & Analytics \u2014 PDF extraction, OCR, and document classification', status: 'Active', trust: 'high', port: 8204 },
    { name: 'web-search-mcp', group: 'In-Repo', type: 'Python MCP Server', desc: 'Web search provider \u2014 query routing, result aggregation, and safe content filtering', status: 'Active', trust: 'medium', port: 8300 }
  ];

  var groupIcon = { 'In-Repo': '\uD83D\uDCC1', 'ImpressionCore Suite': '\uD83E\uDDE9' };
  var groups = ['In-Repo', 'ImpressionCore Suite'];
  var trustColor = { high: '#7ecf7e', medium: '#ffd17a', low: '#ffc1c1' };
  var filter = state.toolsFilterText || '';
  _pluginsFallback = plugins; // cache for computePanelSummary

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
  html += '<span class="muted">' + plugins.length + ' MCP plugins registered across ' + groups.length + ' sources.</span>';
  html += '<div class="tp-sort-controls"><label>Sort:</label><select class="tp-sort-select" onchange="setPluginsSort(this.value)">';
  var pSortOpts = [['name', 'Name'], ['health', 'Health'], ['requests', 'Requests'], ['trust', 'Trust']];
  for (var pso = 0; pso < pSortOpts.length; pso++) {
    html += '<option value="' + pSortOpts[pso][0] + '"' + (state.pluginsSortBy === pSortOpts[pso][0] ? ' selected' : '') + '>' + pSortOpts[pso][1] + '</option>';
  }
  html += '</select></div></div>';

  var sortedPlugins = sortPlugins(plugins);

  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var grpPlugins = sortedPlugins.filter(function (p) { return p.group === grp && (!filter || p.name.toLowerCase().indexOf(filter) !== -1 || p.desc.toLowerCase().indexOf(filter) !== -1); });
    if (!grpPlugins.length) continue;
    html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (groupIcon[grp] || '') + ' ' + escapeHtml(grp) + ' <span class="muted">(' + grpPlugins.length + ')</span></div>';
    for (var i = 0; i < grpPlugins.length; i++) {
      var p = grpPlugins[i];
      var ps = getPluginState(p.name);
      var rv = getReview(state.pluginReviews, p.name);
      var isExpanded = state.expandedPluginId === p.name;
      var safeId = p.name.replace(/[^a-zA-Z0-9]/g, '_');

      html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + pluginCardStateClass(ps) + '">';

      /* ── collapsed header ── */
      html += '<div class="tp-card-head" onclick="toggleItemExpand(\'plugin\', \'' + escapeHtml(p.name) + '\')" data-tooltip="Group: ' + escapeHtml(p.group) + ' | Type: ' + escapeHtml(p.type) + '\\nStatus: ' + escapeHtml(p.status) + ' | Trust: ' + escapeHtml(p.trust) + '\\nPort: ' + p.port + '">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span class="tp-card-name">' + escapeHtml(p.name) + '</span>';
      html += healthDot(ps.healthy);
      html += pluginCardStateBadge(ps);
      html += '<span class="ps-badge" style="background:rgba(130,170,255,0.12);color:#82aaff;font-size:10px;">' + escapeHtml(p.type) + '</span>';
      html += '</div>';
      html += '<div class="tp-card-desc">' + escapeHtml(p.desc) + '</div>';
      html += '<div class="tp-card-meta">';
      if (ps.requests > 0) html += '<span class="tp-meta-tag">\uD83D\uDCCA ' + ps.requests + ' reqs</span>';
      if (ps.lastChecked) html += '<span class="tp-meta-tag">\u2713 checked ' + timeAgo(ps.lastChecked) + '</span>';
      html += '</div>';
      html += '</div>';
      html += '<div class="tp-card-badges">';
      html += '<span class="ps-badge" style="background:rgba(126,207,126,0.15);color:#7ecf7e;">' + escapeHtml(p.status) + '</span>';
      html += approvalBadge(rv.approval);
      html += '</div></div>';

      /* ── expanded body ── */
      html += '<div class="tp-card-body">';

      /* Connection Info */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDD17 Connection</div>';
      html += '<div class="tp-stat-row">';
      html += '<div class="tp-stat"><span class="tp-stat-label">Type</span><span class="tp-stat-value">' + escapeHtml(p.type) + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Port</span><span class="tp-stat-value">' + p.port + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Trust</span><span class="tp-stat-value" style="color:' + (trustColor[p.trust] || 'var(--fg)') + ';">' + escapeHtml(p.trust).toUpperCase() + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Group</span><span class="tp-stat-value">' + escapeHtml(p.group) + '</span></div>';
      html += '</div></div>';

      /* Controls */
      html += '<div class="tp-section"><div class="tp-section-title">\u2699\uFE0F Controls</div>';
      html += '<div class="tp-controls">';
      html += '<label class="tp-toggle"><input type="checkbox" ' + (ps.enabled ? 'checked' : '') + ' onchange="toggleItemEnabled(\'plugin\', \'' + escapeHtml(p.name) + '\')"><span class="tp-toggle-track"></span>' + (ps.enabled ? 'Enabled' : 'Disabled') + '</label>';
      html += '<button class="secondary-button" style="font-size:11px;padding:4px 12px;" onclick="checkPluginHealth(\'' + escapeHtml(p.name) + '\')">\uD83C\uDFE5 Check Health</button>';
      html += '</div>';
      html += '<div id="health-result-' + safeId + '" style="margin-top:6px;font-size:12px;"></div>';
      html += '</div>';

      /* Telemetry */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
      html += '<div class="tp-stat-row">';
      html += '<div class="tp-stat"><span class="tp-stat-label">Requests</span><span class="tp-stat-value">' + ps.requests + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Errors</span><span class="tp-stat-value" style="color:#ffc1c1;">' + ps.errors + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Avg Response</span><span class="tp-stat-value">' + (ps.avgResponseMs ? ps.avgResponseMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Uptime</span><span class="tp-stat-value">' + ps.uptime + '%</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Last Checked</span><span class="tp-stat-value">' + timeAgo(ps.lastChecked) + '</span></div>';
      html += '</div></div>';

      /* Review */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
      html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      html += renderStars(state.pluginReviews, p.name, 'plugin');
      html += approvalBadge(rv.approval);
      html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\'plugin\', \'' + escapeHtml(p.name) + '\', this.value)">';
      var approvals = ['review', 'approved', 'flagged', 'blocked'];
      for (var a = 0; a < approvals.length; a++) {
        html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
      }
      html += '</select>';
      if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><textarea id="review-notes-plugin-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\'plugin\', \'' + escapeHtml(p.name) + '\')">' + escapeHtml(rv.notes) + '</textarea></div>';
      html += '</div>';

      html += '</div></div>';
    }
  }
  html += '<div style="margin-top:16px;text-align:center;">';
  html += '<button class="secondary-button" style="font-size:12px;padding:8px 20px;" onclick="showInstallPluginForm()">➕ Install Plugin</button>';
  html += '</div>';
  container.innerHTML = html;
}

export
  function showInstallPluginForm() {
  var existing = document.getElementById('install-plugin-form');
  if (existing) { existing.remove(); return; }
  var container = document.getElementById('plugins-panel');
  if (!container) return;
  var form = document.createElement('div');
  form.id = 'install-plugin-form';
  form.style.cssText = 'margin-top:12px;padding:14px;border:1px solid var(--accent);border-radius:12px;background:rgba(0,0,0,0.2);';
  form.innerHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:10px;">➕ Install Plugin</div>'
    + '<div class="ps-field"><label>Plugin Name</label><input id="reg-plugin-name" placeholder="my-plugin-mcp"></div>'
    + '<div class="ps-field"><label>Type</label><select id="reg-plugin-type" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option>Python MCP Server</option><option>Node.js MCP Server</option><option>REST Adapter</option></select></div>'
    + '<div class="ps-field"><label>Server URL / Path</label><input id="reg-plugin-url" placeholder="http://localhost:8400 or ./plugins/my-plugin"></div>'
    + '<div class="ps-field"><label>Port</label><input id="reg-plugin-port" type="number" placeholder="8400"></div>'
    + '<div class="ps-field"><label>Description</label><textarea id="reg-plugin-desc" rows="2" placeholder="What does this plugin provide?" style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;"></textarea></div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;">'
    + '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="submitInstallPlugin()">Install</button>'
    + '<button class="secondary-button" style="font-size:12px;padding:6px 16px;" onclick="cancelInstallPlugin()">Cancel</button>'
    + '</div>';
  container.appendChild(form);
}

export function cancelInstallPlugin() {
  var form = document.getElementById('install-plugin-form');
  if (form) form.remove();
}

export function submitInstallPlugin() {
  var name = document.getElementById('reg-plugin-name');
  var type = document.getElementById('reg-plugin-type');
  var url = document.getElementById('reg-plugin-url');
  var port = document.getElementById('reg-plugin-port');
  var desc = document.getElementById('reg-plugin-desc');
  if (!name || !name.value.trim()) { alert('Plugin name is required'); return; }
  fetch('/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.value.trim(), type: type ? type.value : 'Python MCP Server', url: url ? url.value : '', port: port ? parseInt(port.value) || 0 : 0, description: desc ? desc.value : '' })
  }).then(function () {
    var form = document.getElementById('install-plugin-form');
    if (form) form.remove();
  }).catch(function (e) { alert('Installation failed: ' + e.message); });
}

export
  function renderUtilitiesPanel() {
  var container = document.getElementById('utilities-panel');
  if (!container) return;

  var utils = [
    { name: 'tool-contract-snapshot', cat: 'Benchmarks & Qualification', desc: 'Generate versioned tool contract snapshots for release evidence' },
    { name: 'release-validation', cat: 'Benchmarks & Qualification', desc: 'Run release gate checks \u2014 test/build/perf/contract/policy validation' },
    { name: 'ci-gate-check', cat: 'Benchmarks & Qualification', desc: 'CI quality gate \u2014 test pass, perf qualification, artifact upload' },
    { name: 'perf-qualification', cat: 'Benchmarks & Qualification', desc: 'Performance SLO harness \u2014 p50/p95/p99 latency gates with contention scenarios' },
    { name: 'e1-individual-qualification', cat: 'Benchmarks & Qualification', desc: 'Individual profile qualification \u2014 tool invocation, workflow, and terminal tests' },
    { name: 'e2-business-qualification', cat: 'Benchmarks & Qualification', desc: 'Business profile qualification \u2014 governance paths, approval flows, and audit checks' },
    { name: 'e3-policy-stress', cat: 'Benchmarks & Qualification', desc: 'Policy engine stress test \u2014 rapid tier routing under concurrency load' },
    { name: 'e4-profile-switch-qualification', cat: 'Benchmarks & Qualification', desc: 'Profile hot-switch qualification \u2014 runtime transition fidelity and state preservation' },
    { name: 'd1-workflow-template-qualification', cat: 'Benchmarks & Qualification', desc: 'Workflow template qualification \u2014 retry/timeout/fallback path completion' },
    { name: 'e-stage2-qualification-summary', cat: 'Benchmarks & Qualification', desc: 'Aggregate stage-2 qualification summary across all E-series suites' },
    { name: 'j-event-lineage-bundle', cat: 'Benchmarks & Qualification', desc: 'Event lineage bundle \u2014 full causal chain export for audit and replay' },

    { name: 'SelfReviewScheduler', cat: 'Operator Services', desc: 'Automated self-review scheduling \u2014 daily, weekly, and monthly audit cycles' },
    { name: 'SessionTraceExplorer', cat: 'Operator Services', desc: 'Session trace browser \u2014 search, filter, and inspect activity event chains' },
    { name: 'PolicyAuditExporter', cat: 'Operator Services', desc: 'Export policy audit logs \u2014 JSON/CSV/NDJSON with reason-code annotations' },
    { name: 'SessionPackageSqliteStore', cat: 'Operator Services', desc: 'SQLite-backed session package persistence and migration management' },
    { name: 'DashboardService', cat: 'Operator Services', desc: 'Dashboard HTTP server \u2014 38 API routes, WebSocket, and static UI serving' },

    { name: 'SemanticMemoryIndex', cat: 'Memory & Retrieval', desc: 'Semantic memory index with configurable embedding and multi-mode retrieval' },
    { name: 'EpisodicMemory', cat: 'Memory & Retrieval', desc: 'Episodic memory buffer with rolling window and recency-weighted recall' },
    { name: 'SessionMemoryStore', cat: 'Memory & Retrieval', desc: 'Per-session memory persistence with summary extraction and compaction' },
    { name: 'RetrievalMetricsCollector', cat: 'Memory & Retrieval', desc: 'Retrieval quality instrumentation \u2014 hit-rate, coverage, novelty, utility scoring' },
    { name: 'RetrievalDashboardStore', cat: 'Memory & Retrieval', desc: 'SQLite-backed retrieval cohort dashboard snapshots and trend persistence' },

    { name: 'ActivityBus', cat: 'Activity & Audit', desc: 'Central event bus with SHA-256 hash chain and typed subscriber dispatch' },
    { name: 'SqliteActivityStore', cat: 'Activity & Audit', desc: 'SQLite subscriber for durable activity event persistence and querying' },
    { name: 'ConsoleActivitySubscriber', cat: 'Activity & Audit', desc: 'Console subscriber for development-mode real-time event logging' },

    { name: 'normalizeReplayEvent', cat: 'Replay & Verification', desc: 'Normalize recorded events into deterministic replay format' },
    { name: 'buildReplaySignature', cat: 'Replay & Verification', desc: 'Generate cryptographic replay signatures for trace parity verification' },
    { name: 'compareReplayParity', cat: 'Replay & Verification', desc: 'Compare replay runs and report divergence with diff annotations' },

    { name: 'resolveExecutionProfileFromEnv', cat: 'Configuration', desc: 'Resolve execution profile from environment variables (fast/balanced/governed)' },
    { name: 'resolveEnvironmentProfile', cat: 'Configuration', desc: 'Resolve environment profile (dev/staging/prod) with SLO preset selection' },
    { name: 'getPerformanceSloProfile', cat: 'Configuration', desc: 'Return performance SLO thresholds for the active environment profile' }
  ];

  var catIcon = {
    'Benchmarks & Qualification': '\uD83C\uDFAF',
    'Operator Services': '\u2699\uFE0F',
    'Memory & Retrieval': '\uD83E\uDDE0',
    'Activity & Audit': '\uD83D\uDCCA',
    'Replay & Verification': '\uD83D\uDD01',
    'Configuration': '\uD83D\uDD27'
  };
  var categories = ['Benchmarks & Qualification', 'Operator Services', 'Memory & Retrieval', 'Activity & Audit', 'Replay & Verification', 'Configuration'];
  var filter = state.toolsFilterText || '';
  _utilitiesFallback = utils; // cache for computePanelSummary

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
  html += '<span class="muted">' + utils.length + ' utilities registered across ' + categories.length + ' categories.</span>';
  html += '<div class="tp-sort-controls"><label>Sort:</label><select class="tp-sort-select" onchange="setUtilitiesSort(this.value)">';
  var uSortOpts = [['name', 'Name'], ['result', 'Result'], ['runs', 'Runs'], ['lastRun', 'Last Run']];
  for (var uso = 0; uso < uSortOpts.length; uso++) {
    html += '<option value="' + uSortOpts[uso][0] + '"' + (state.utilitiesSortBy === uSortOpts[uso][0] ? ' selected' : '') + '>' + uSortOpts[uso][1] + '</option>';
  }
  html += '</select></div></div>';

  var sortedUtils = sortUtilities(utils);

  for (var c = 0; c < categories.length; c++) {
    var cat = categories[c];
    var catUtils = sortedUtils.filter(function (u) { return u.cat === cat && (!filter || u.name.toLowerCase().indexOf(filter) !== -1 || u.desc.toLowerCase().indexOf(filter) !== -1); });
    if (!catUtils.length) continue;
    html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catUtils.length + ')</span></div>';
    for (var i = 0; i < catUtils.length; i++) {
      var u = catUtils[i];
      var us = getUtilityState(u.name);
      var rv = getReview(state.utilityReviews, u.name);
      var isExpanded = state.expandedUtilityId === u.name;
      var safeId = u.name.replace(/[^a-zA-Z0-9]/g, '_');

      html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + utilityCardStateClass(us) + '">';

      /* ── collapsed header ── */
      html += '<div class="tp-card-head" onclick="toggleItemExpand(\'utility\', \'' + escapeHtml(u.name) + '\')" data-tooltip="Category: ' + escapeHtml(u.cat) + '\\n' + escapeHtml(u.desc) + (us.lastRun ? '\\nLast run: ' + timeAgo(us.lastRun) : '') + '">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span class="tp-card-name">' + escapeHtml(u.name) + '</span>';
      html += utilityCardStateBadge(us);
      html += '</div>';
      html += '<div class="tp-card-desc">' + escapeHtml(u.desc) + '</div>';
      html += '<div class="tp-card-meta">';
      if (us.runCount > 0) html += '<span class="tp-meta-tag">\uD83D\uDD01 ' + us.runCount + ' runs</span>';
      if (us.lastRun) html += '<span class="tp-meta-tag">\uD83D\uDD52 ' + timeAgo(us.lastRun) + '</span>';
      if (us.lastResult) html += '<span class="tp-meta-tag" style="color:' + (us.lastResult === 'pass' ? '#7ecf7e' : '#ffc1c1') + ';">' + (us.lastResult === 'pass' ? '\u2713' : '\u2717') + ' ' + us.lastResult + '</span>';
      html += '</div>';
      html += '</div>';
      html += '<div class="tp-card-badges">';
      html += approvalBadge(rv.approval);
      html += '</div></div>';

      /* ── expanded body ── */
      html += '<div class="tp-card-body">';

      /* Telemetry */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Telemetry</div>';
      html += '<div class="tp-stat-row">';
      html += '<div class="tp-stat"><span class="tp-stat-label">Run Count</span><span class="tp-stat-value">' + us.runCount + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Last Run</span><span class="tp-stat-value">' + timeAgo(us.lastRun) + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (us.lastDurationMs ? us.lastDurationMs.toFixed(0) + 'ms' : '\u2014') + '</span></div>';
      html += '<div class="tp-stat"><span class="tp-stat-label">Last Result</span><span class="tp-stat-value" style="color:' + (us.lastResult === 'pass' ? '#7ecf7e' : us.lastResult === 'fail' ? '#ffc1c1' : 'var(--fg)') + ';">' + (us.lastResult || '\u2014') + '</span></div>';
      html += '</div></div>';

      /* Review */
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCDD Review & Evaluation</div>';
      html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      html += renderStars(state.utilityReviews, u.name, 'utility');
      html += approvalBadge(rv.approval);
      html += '<select style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);" onchange="setItemApproval(\'utility\', \'' + escapeHtml(u.name) + '\', this.value)">';
      var approvals = ['review', 'approved', 'flagged', 'blocked'];
      for (var a = 0; a < approvals.length; a++) {
        html += '<option value="' + approvals[a] + '"' + (rv.approval === approvals[a] ? ' selected' : '') + '>' + approvals[a].charAt(0).toUpperCase() + approvals[a].slice(1) + '</option>';
      }
      html += '</select>';
      if (rv.lastReviewed) html += '<span class="muted" style="font-size:10px;">Reviewed: ' + timeAgo(rv.lastReviewed) + '</span>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><textarea id="review-notes-utility-' + safeId + '" rows="2" placeholder="Review notes..." style="width:100%;padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.18);background:rgba(0,0,0,0.25);color:var(--fg);font-size:11px;font-family:inherit;box-sizing:border-box;resize:vertical;" onblur="saveItemNotes(\'utility\', \'' + escapeHtml(u.name) + '\')">' + escapeHtml(rv.notes) + '</textarea></div>';
      html += '</div>';

      html += '</div></div>';
    }
  }
  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeDiagnosticsSummary() {
  var report = state.diagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.diagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.diagnosticsRunning,
  };
}

export async function loadDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/browser/report');
    if (data && data.summary) {
      state.diagnosticsReport = data;
    } else {
      state.diagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'diagnostics.load.error', 'Failed to load diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/browser/status');
    state.diagnosticsRunning = statusData.running || false;
    state.diagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runBrowserDiagnostics() {
  if (state.diagnosticsRunning) return;
  state.diagnosticsRunning = true;
  state.diagnosticsProgress = [];
  renderDiagnosticsPanel();
  try {
    await request('/api/diagnostics/browser/run', { method: 'POST' });
    dashboardLog('tools', 'diagnostics.started', 'Browser diagnostics test run started');
  } catch (e) {
    state.diagnosticsRunning = false;
    dashboardLog('tools', 'diagnostics.error', 'Failed to start browser diagnostics: ' + e.message);
    renderDiagnosticsPanel();
  }
}

export function handleDiagnosticsWsMessage(data) {
  if (data.type === 'diagnostics_progress') {
    state.diagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderDiagnosticsPanel();
  }
  if (data.type === 'diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'diagnostics_complete') {
    state.diagnosticsRunning = false;
    state.diagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('diagnostics', 'complete', completeIcon + ' Browser diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('diagnostics', 'complete', '\u2705 Browser diagnostics run finished');
    }
    loadDiagnosticsReport().then(function () {
      renderDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleDiagnosticSuite(suiteName) {
  if (state.expandedDiagnosticSuiteId === suiteName) {
    state.expandedDiagnosticSuiteId = null;
  } else {
    state.expandedDiagnosticSuiteId = suiteName;
  }
  renderDiagnosticsPanel();
}

export
  function renderDiagnosticsPanel() {
  var container = document.getElementById('diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.diagnosticsReport;
  var running = state.diagnosticsRunning;
  var progress = state.diagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runBrowserDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\u{1F9EA} Run Browser Diagnostics';
  html += '</button>';
  if (state.diagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.diagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No diagnostics results yet. Click <strong>Run Browser Diagnostics</strong> to execute the full browser test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83C\uDF10 Browser Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   AGENT DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeAgentDiagnosticsSummary() {
  var report = state.agentDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.agentDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.agentDiagnosticsRunning,
  };
}

export async function loadAgentDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/agent/report');
    if (data && data.summary) {
      state.agentDiagnosticsReport = data;
    } else {
      state.agentDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'agent-diagnostics.load.error', 'Failed to load agent diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/agent/status');
    state.agentDiagnosticsRunning = statusData.running || false;
    state.agentDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runAgentDiagnostics() {
  if (state.agentDiagnosticsRunning) return;
  state.agentDiagnosticsRunning = true;
  state.agentDiagnosticsProgress = [];
  renderAgentDiagnosticsPanel();
  try {
    await request('/api/diagnostics/agent/run', { method: 'POST' });
    dashboardLog('tools', 'agent-diagnostics.started', 'Agent diagnostics test run started');
  } catch (e) {
    state.agentDiagnosticsRunning = false;
    dashboardLog('tools', 'agent-diagnostics.error', 'Failed to start agent diagnostics: ' + e.message);
    renderAgentDiagnosticsPanel();
  }
}

export function handleAgentDiagnosticsWsMessage(data) {
  if (data.type === 'agent_diagnostics_progress') {
    state.agentDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('agent-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('agent-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderAgentDiagnosticsPanel();
  }
  if (data.type === 'agent_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('agent-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'agent_diagnostics_complete') {
    state.agentDiagnosticsRunning = false;
    state.agentDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('agent-diagnostics', 'complete', completeIcon + ' Agent diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('agent-diagnostics', 'complete', '\u2705 Agent diagnostics run finished');
    }
    loadAgentDiagnosticsReport().then(function () {
      renderAgentDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleAgentDiagnosticSuite(suiteName) {
  if (state.expandedAgentDiagnosticSuiteId === suiteName) {
    state.expandedAgentDiagnosticSuiteId = null;
  } else {
    state.expandedAgentDiagnosticSuiteId = suiteName;
  }
  renderAgentDiagnosticsPanel();
}

export function renderAgentDiagnosticsPanel() {
  var container = document.getElementById('agent-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.agentDiagnosticsReport;
  var running = state.agentDiagnosticsRunning;
  var progress = state.agentDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runAgentDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\u{1F916} Run Agent Diagnostics';
  html += '</button>';
  if (state.agentDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.agentDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'agent_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No agent diagnostics results yet. Click <strong>Run Agent Diagnostics</strong> to execute the agent test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\u{1F916} Agent Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedAgentDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleAgentDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPUTER DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeComputerDiagnosticsSummary() {
  var report = state.computerDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.computerDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.computerDiagnosticsRunning,
  };
}

export async function loadComputerDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/computer/report');
    if (data && data.summary) {
      state.computerDiagnosticsReport = data;
    } else {
      state.computerDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'computer-diagnostics.load.error', 'Failed to load computer diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/computer/status');
    state.computerDiagnosticsRunning = statusData.running || false;
    state.computerDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runComputerDiagnostics() {
  if (state.computerDiagnosticsRunning) return;
  state.computerDiagnosticsRunning = true;
  state.computerDiagnosticsProgress = [];
  renderComputerDiagnosticsPanel();
  try {
    await request('/api/diagnostics/computer/run', { method: 'POST' });
    dashboardLog('tools', 'computer-diagnostics.started', 'Computer diagnostics test run started');
  } catch (e) {
    state.computerDiagnosticsRunning = false;
    dashboardLog('tools', 'computer-diagnostics.error', 'Failed to start computer diagnostics: ' + e.message);
    renderComputerDiagnosticsPanel();
  }
}

export function handleComputerDiagnosticsWsMessage(data) {
  if (data.type === 'computer_diagnostics_progress') {
    state.computerDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('computer-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('computer-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderComputerDiagnosticsPanel();
  }
  if (data.type === 'computer_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('computer-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'computer_diagnostics_complete') {
    state.computerDiagnosticsRunning = false;
    state.computerDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('computer-diagnostics', 'complete', completeIcon + ' Computer diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('computer-diagnostics', 'complete', '\u2705 Computer diagnostics run finished');
    }
    loadComputerDiagnosticsReport().then(function () {
      renderComputerDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleComputerDiagnosticSuite(suiteName) {
  if (state.expandedComputerDiagnosticSuiteId === suiteName) {
    state.expandedComputerDiagnosticSuiteId = null;
  } else {
    state.expandedComputerDiagnosticSuiteId = suiteName;
  }
  renderComputerDiagnosticsPanel();
}

export function renderComputerDiagnosticsPanel() {
  var container = document.getElementById('computer-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.computerDiagnosticsReport;
  var running = state.computerDiagnosticsRunning;
  var progress = state.computerDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runComputerDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\u{1F5A5}\uFE0F Run Computer Diagnostics';
  html += '</button>';
  if (state.computerDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.computerDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'computer_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No computer diagnostics results yet. Click <strong>Run Computer Diagnostics</strong> to execute the computer control test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\u{1F5A5}\uFE0F Computer Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedComputerDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleComputerDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   KNOWLEDGE GRAPH DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeKnowledgeGraphDiagnosticsSummary() {
  var report = state.knowledgeGraphDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.knowledgeGraphDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.knowledgeGraphDiagnosticsRunning,
  };
}

export async function loadKnowledgeGraphDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/knowledge-graph/report');
    if (data && data.summary) {
      state.knowledgeGraphDiagnosticsReport = data;
    } else {
      state.knowledgeGraphDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'knowledge-graph-diagnostics.load.error', 'Failed to load knowledge graph diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/knowledge-graph/status');
    state.knowledgeGraphDiagnosticsRunning = statusData.running || false;
    state.knowledgeGraphDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runKnowledgeGraphDiagnostics() {
  if (state.knowledgeGraphDiagnosticsRunning) return;
  state.knowledgeGraphDiagnosticsRunning = true;
  state.knowledgeGraphDiagnosticsProgress = [];
  renderKnowledgeGraphDiagnosticsPanel();
  try {
    await request('/api/diagnostics/knowledge-graph/run', { method: 'POST' });
    dashboardLog('tools', 'knowledge-graph-diagnostics.started', 'Knowledge Graph diagnostics test run started');
  } catch (e) {
    state.knowledgeGraphDiagnosticsRunning = false;
    dashboardLog('tools', 'knowledge-graph-diagnostics.error', 'Failed to start knowledge graph diagnostics: ' + e.message);
    renderKnowledgeGraphDiagnosticsPanel();
  }
}

export function handleKnowledgeGraphDiagnosticsWsMessage(data) {
  if (data.type === 'knowledge_graph_diagnostics_progress') {
    state.knowledgeGraphDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('knowledge-graph-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('knowledge-graph-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderKnowledgeGraphDiagnosticsPanel();
  }
  if (data.type === 'knowledge_graph_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('knowledge-graph-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'knowledge_graph_diagnostics_complete') {
    state.knowledgeGraphDiagnosticsRunning = false;
    state.knowledgeGraphDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('knowledge-graph-diagnostics', 'complete', completeIcon + ' Knowledge Graph diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('knowledge-graph-diagnostics', 'complete', '\u2705 Knowledge Graph diagnostics run finished');
    }
    loadKnowledgeGraphDiagnosticsReport().then(function () {
      renderKnowledgeGraphDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleKnowledgeGraphDiagnosticSuite(suiteName) {
  if (state.expandedKnowledgeGraphDiagnosticSuiteId === suiteName) {
    state.expandedKnowledgeGraphDiagnosticSuiteId = null;
  } else {
    state.expandedKnowledgeGraphDiagnosticSuiteId = suiteName;
  }
  renderKnowledgeGraphDiagnosticsPanel();
}

export function renderKnowledgeGraphDiagnosticsPanel() {
  var container = document.getElementById('knowledge-graph-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.knowledgeGraphDiagnosticsReport;
  var running = state.knowledgeGraphDiagnosticsRunning;
  var progress = state.knowledgeGraphDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runKnowledgeGraphDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\uD83E\uDDE0 Run Knowledge Graph Diagnostics';
  html += '</button>';
  if (state.knowledgeGraphDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.knowledgeGraphDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'knowledge_graph_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No knowledge graph diagnostics results yet. Click <strong>Run Knowledge Graph Diagnostics</strong> to execute the UKS knowledge graph test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83E\uDDE0 Knowledge Graph Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedKnowledgeGraphDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleKnowledgeGraphDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   WORKSPACE DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeWorkspaceDiagnosticsSummary() {
  var report = state.workspaceDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.workspaceDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.workspaceDiagnosticsRunning,
  };
}

export async function loadWorkspaceDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/workspace/report');
    if (data && data.summary) {
      state.workspaceDiagnosticsReport = data;
    } else {
      state.workspaceDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'workspace-diagnostics.load.error', 'Failed to load workspace diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/workspace/status');
    state.workspaceDiagnosticsRunning = statusData.running || false;
    state.workspaceDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runWorkspaceDiagnostics() {
  if (state.workspaceDiagnosticsRunning) return;
  state.workspaceDiagnosticsRunning = true;
  state.workspaceDiagnosticsProgress = [];
  renderWorkspaceDiagnosticsPanel();
  try {
    await request('/api/diagnostics/workspace/run', { method: 'POST' });
    dashboardLog('tools', 'workspace-diagnostics.started', 'Workspace diagnostics test run started');
  } catch (e) {
    state.workspaceDiagnosticsRunning = false;
    dashboardLog('tools', 'workspace-diagnostics.error', 'Failed to start workspace diagnostics: ' + e.message);
    renderWorkspaceDiagnosticsPanel();
  }
}

export function handleWorkspaceDiagnosticsWsMessage(data) {
  if (data.type === 'workspace_diagnostics_progress') {
    state.workspaceDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('workspace-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('workspace-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderWorkspaceDiagnosticsPanel();
  }
  if (data.type === 'workspace_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('workspace-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'workspace_diagnostics_complete') {
    state.workspaceDiagnosticsRunning = false;
    state.workspaceDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('workspace-diagnostics', 'complete', completeIcon + ' Workspace diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('workspace-diagnostics', 'complete', '\u2705 Workspace diagnostics run finished');
    }
    loadWorkspaceDiagnosticsReport().then(function () {
      renderWorkspaceDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleWorkspaceDiagnosticSuite(suiteName) {
  if (state.expandedWorkspaceDiagnosticSuiteId === suiteName) {
    state.expandedWorkspaceDiagnosticSuiteId = null;
  } else {
    state.expandedWorkspaceDiagnosticSuiteId = suiteName;
  }
  renderWorkspaceDiagnosticsPanel();
}

export function renderWorkspaceDiagnosticsPanel() {
  var container = document.getElementById('workspace-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.workspaceDiagnosticsReport;
  var running = state.workspaceDiagnosticsRunning;
  var progress = state.workspaceDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runWorkspaceDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\uD83D\uDCC2 Run Workspace Diagnostics';
  html += '</button>';
  if (state.workspaceDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.workspaceDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run (workspace) ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'workspace_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No workspace diagnostics results yet. Click <strong>Run Workspace Diagnostics</strong> to execute the full workspace test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83D\uDCC2 Workspace Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedWorkspaceDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleWorkspaceDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* -----------------------------------------------------------------------
   --- Network Diagnostics Panel ---------------------------------------
   ----------------------------------------------------------------------- */

export function computeNetworkDiagnosticsSummary() {
  var report = state.networkDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.networkDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.networkDiagnosticsRunning,
  };
}

export async function loadNetworkDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/network/report');
    if (data && data.summary) {
      state.networkDiagnosticsReport = data;
    } else {
      state.networkDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'network-diagnostics.load.error', 'Failed to load network diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/network/status');
    state.networkDiagnosticsRunning = statusData.running || false;
    state.networkDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runNetworkDiagnostics() {
  if (state.networkDiagnosticsRunning) return;
  state.networkDiagnosticsRunning = true;
  state.networkDiagnosticsProgress = [];
  renderNetworkDiagnosticsPanel();
  try {
    await request('/api/diagnostics/network/run', { method: 'POST' });
    dashboardLog('tools', 'network-diagnostics.started', 'Network diagnostics test run started');
  } catch (e) {
    state.networkDiagnosticsRunning = false;
    dashboardLog('tools', 'network-diagnostics.error', 'Failed to start network diagnostics: ' + e.message);
    renderNetworkDiagnosticsPanel();
  }
}

export function handleNetworkDiagnosticsWsMessage(data) {
  if (data.type === 'network_diagnostics_progress') {
    state.networkDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('network-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('network-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderNetworkDiagnosticsPanel();
  }
  if (data.type === 'network_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('network-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'network_diagnostics_complete') {
    state.networkDiagnosticsRunning = false;
    state.networkDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('network-diagnostics', 'complete', completeIcon + ' Network diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('network-diagnostics', 'complete', '\u2705 Network diagnostics run finished');
    }
    loadNetworkDiagnosticsReport().then(function () {
      renderNetworkDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleNetworkDiagnosticSuite(suiteName) {
  if (state.expandedNetworkDiagnosticSuiteId === suiteName) {
    state.expandedNetworkDiagnosticSuiteId = null;
  } else {
    state.expandedNetworkDiagnosticSuiteId = suiteName;
  }
  renderNetworkDiagnosticsPanel();
}

export function renderNetworkDiagnosticsPanel() {
  var container = document.getElementById('network-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.networkDiagnosticsReport;
  var running = state.networkDiagnosticsRunning;
  var progress = state.networkDiagnosticsProgress || [];

  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runNetworkDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\uD83D\uDD0C Run Network Diagnostics';
  html += '</button>';
  if (state.networkDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.networkDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'network_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No network diagnostics results yet. Click <strong>Run Network Diagnostics</strong> to execute the full network test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83D\uDD0C Network Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedNetworkDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';
    html += '<div class="tp-card-head" onclick="toggleNetworkDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div></div></div>';

    html += '<div class="tp-card-body">';
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

// ── Telemetry Diagnostics ──────────────────────────────────────────────

export function computeTelemetryDiagnosticsSummary() {
  var report = state.telemetryDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.telemetryDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.telemetryDiagnosticsRunning,
  };
}

export async function loadTelemetryDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/telemetry/report');
    if (data && data.summary) {
      state.telemetryDiagnosticsReport = data;
    } else {
      state.telemetryDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'telemetry-diagnostics.load.error', 'Failed to load telemetry diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/telemetry/status');
    state.telemetryDiagnosticsRunning = statusData.running || false;
    state.telemetryDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runTelemetryDiagnostics() {
  if (state.telemetryDiagnosticsRunning) return;
  state.telemetryDiagnosticsRunning = true;
  state.telemetryDiagnosticsProgress = [];
  renderTelemetryDiagnosticsPanel();
  try {
    await request('/api/diagnostics/telemetry/run', { method: 'POST' });
    dashboardLog('tools', 'telemetry-diagnostics.started', 'Telemetry diagnostics test run started');
  } catch (e) {
    state.telemetryDiagnosticsRunning = false;
    dashboardLog('tools', 'telemetry-diagnostics.error', 'Failed to start telemetry diagnostics: ' + e.message);
    renderTelemetryDiagnosticsPanel();
  }
}

export function handleTelemetryDiagnosticsWsMessage(data) {
  if (data.type === 'telemetry_diagnostics_progress') {
    state.telemetryDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('telemetry-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('telemetry-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderTelemetryDiagnosticsPanel();
  }
  if (data.type === 'telemetry_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('telemetry-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'telemetry_diagnostics_complete') {
    state.telemetryDiagnosticsRunning = false;
    state.telemetryDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('telemetry-diagnostics', 'complete', completeIcon + ' Telemetry diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('telemetry-diagnostics', 'complete', '\u2705 Telemetry diagnostics run finished');
    }
    loadTelemetryDiagnosticsReport().then(function () {
      renderTelemetryDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleTelemetryDiagnosticSuite(suiteName) {
  if (state.expandedTelemetryDiagnosticSuiteId === suiteName) {
    state.expandedTelemetryDiagnosticSuiteId = null;
  } else {
    state.expandedTelemetryDiagnosticSuiteId = suiteName;
  }
  renderTelemetryDiagnosticsPanel();
}

export function renderTelemetryDiagnosticsPanel() {
  var container = document.getElementById('telemetry-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.telemetryDiagnosticsReport;
  var running = state.telemetryDiagnosticsRunning;
  var progress = state.telemetryDiagnosticsProgress || [];

  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runTelemetryDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\uD83D\uDCCA Run Telemetry Diagnostics';
  html += '</button>';
  if (state.telemetryDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.telemetryDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'telemetry_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No telemetry diagnostics results yet. Click <strong>Run Telemetry Diagnostics</strong> to execute the full telemetry test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83D\uDCCA Telemetry Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedTelemetryDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';
    html += '<div class="tp-card-head" onclick="toggleTelemetryDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div></div></div>';

    html += '<div class="tp-card-body">';
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

// ── Logs & Debug Diagnostics ──────────────────────────────────────────────

export function computeLogsDiagnosticsSummary() {
  var report = state.logsDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.logsDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.logsDiagnosticsRunning,
  };
}

export async function loadLogsDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/logs/report');
    if (data && data.summary) {
      state.logsDiagnosticsReport = data;
    } else {
      state.logsDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'logs-diagnostics.load.error', 'Failed to load logs diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/logs/status');
    state.logsDiagnosticsRunning = statusData.running || false;
    state.logsDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runLogsDiagnostics() {
  if (state.logsDiagnosticsRunning) return;
  state.logsDiagnosticsRunning = true;
  state.logsDiagnosticsProgress = [];
  renderLogsDiagnosticsPanel();
  try {
    await request('/api/diagnostics/logs/run', { method: 'POST' });
    dashboardLog('tools', 'logs-diagnostics.started', 'Logs diagnostics test run started');
  } catch (e) {
    state.logsDiagnosticsRunning = false;
    dashboardLog('tools', 'logs-diagnostics.error', 'Failed to start logs diagnostics: ' + e.message);
    renderLogsDiagnosticsPanel();
  }
}

export function handleLogsDiagnosticsWsMessage(data) {
  if (data.type === 'logs_diagnostics_progress') {
    state.logsDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('logs-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('logs-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderLogsDiagnosticsPanel();
  }
  if (data.type === 'logs_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('logs-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'logs_diagnostics_complete') {
    state.logsDiagnosticsRunning = false;
    state.logsDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('logs-diagnostics', 'complete', completeIcon + ' Logs diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('logs-diagnostics', 'complete', '\u2705 Logs diagnostics run finished');
    }
    loadLogsDiagnosticsReport().then(function () {
      renderLogsDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleLogsDiagnosticSuite(suiteName) {
  if (state.expandedLogsDiagnosticSuiteId === suiteName) {
    state.expandedLogsDiagnosticSuiteId = null;
  } else {
    state.expandedLogsDiagnosticSuiteId = suiteName;
  }
  renderLogsDiagnosticsPanel();
}

export function renderLogsDiagnosticsPanel() {
  var container = document.getElementById('logs-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.logsDiagnosticsReport;
  var running = state.logsDiagnosticsRunning;
  var progress = state.logsDiagnosticsProgress || [];

  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runLogsDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\uD83D\uDD0D Run Logs Diagnostics';
  html += '</button>';
  if (state.logsDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.logsDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'logs_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No logs diagnostics results yet. Click <strong>Run Logs Diagnostics</strong> to execute the full logs & debug test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\uD83D\uDD0D Logs & Debug Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedLogsDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';
    html += '<div class="tp-card-head" onclick="toggleLogsDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div></div></div>';

    html += '<div class="tp-card-body">';
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDD0D Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════
   SCHEDULER DIAGNOSTICS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

export function computeSchedulerDiagnosticsSummary() {
  var report = state.schedulerDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.schedulerDiagnosticsRunning };
  }
  return {
    passes: report.summary.grandTotal.passes,
    failures: report.summary.grandTotal.failures,
    running: state.schedulerDiagnosticsRunning,
  };
}

export async function loadSchedulerDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/scheduler/report');
    if (data && data.summary) {
      state.schedulerDiagnosticsReport = data;
    } else {
      state.schedulerDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'scheduler-diagnostics.load.error', 'Failed to load scheduler diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/scheduler/status');
    state.schedulerDiagnosticsRunning = statusData.running || false;
    state.schedulerDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runSchedulerDiagnostics() {
  if (state.schedulerDiagnosticsRunning) return;
  state.schedulerDiagnosticsRunning = true;
  state.schedulerDiagnosticsProgress = [];
  renderSchedulerDiagnosticsPanel();
  try {
    await request('/api/diagnostics/scheduler/run', { method: 'POST' });
    dashboardLog('tools', 'scheduler-diagnostics.started', 'Scheduler diagnostics test run started');
  } catch (e) {
    state.schedulerDiagnosticsRunning = false;
    dashboardLog('tools', 'scheduler-diagnostics.error', 'Failed to start scheduler diagnostics: ' + e.message);
    renderSchedulerDiagnosticsPanel();
  }
}

export function handleSchedulerDiagnosticsWsMessage(data) {
  if (data.type === 'scheduler_diagnostics_progress') {
    state.schedulerDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : 'error';
    var icon = isPassing ? '\u2705' : '\u274C';
    var detail = icon + ' ' + (data.suite || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    if (data.duration) detail += ' (' + (data.duration / 1000).toFixed(1) + 's)';
    dashboardLog('scheduler-diagnostics', 'suite.' + (data.suite || 'unknown'), detail, sev);
    if (data.failedTests && data.failedTests.length > 0) {
      for (var fi = 0; fi < data.failedTests.length; fi++) {
        dashboardLog('scheduler-diagnostics', 'suite.' + (data.suite || 'unknown') + '.failure', '  \u2192 ' + data.failedTests[fi], 'error');
      }
    }
    renderSchedulerDiagnosticsPanel();
  }
  if (data.type === 'scheduler_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('scheduler-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'scheduler_diagnostics_complete') {
    state.schedulerDiagnosticsRunning = false;
    state.schedulerDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary && summary.grandTotal) {
      var allPassed = summary.grandTotal.failures === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('scheduler-diagnostics', 'complete', completeIcon + ' Scheduler diagnostics complete: ' + summary.grandTotal.passes + ' passed, ' + summary.grandTotal.failures + ' failed', completeSev);
    } else {
      dashboardLog('scheduler-diagnostics', 'complete', '\u2705 Scheduler diagnostics run finished');
    }
    loadSchedulerDiagnosticsReport().then(function () {
      renderSchedulerDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleSchedulerDiagnosticSuite(suiteName) {
  if (state.expandedSchedulerDiagnosticSuiteId === suiteName) {
    state.expandedSchedulerDiagnosticSuiteId = null;
  } else {
    state.expandedSchedulerDiagnosticSuiteId = suiteName;
  }
  renderSchedulerDiagnosticsPanel();
}

export function renderSchedulerDiagnosticsPanel() {
  var container = document.getElementById('scheduler-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.schedulerDiagnosticsReport;
  var running = state.schedulerDiagnosticsRunning;
  var progress = state.schedulerDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runSchedulerDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\u{1F4C5} Run Scheduler Diagnostics';
  html += '</button>';
  if (state.schedulerDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.schedulerDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var gt = report.summary.grandTotal;
    html += '<span style="font-size:12px;font-weight:600;color:' + (gt.failures === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += gt.passes + ' passed' + (gt.failures > 0 ? ' / ' + gt.failures + ' failed' : '');
    html += '</span>';
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'scheduler_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'FAIL' ? '\u2717' : '\u26A0';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' ' + escapeHtml(pr.suite) + ' \u2014 ' + pr.passes + '/' + (pr.passes + pr.failures) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.suites) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No scheduler diagnostics results yet. Click <strong>Run Scheduler Diagnostics</strong> to execute the scheduler test suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Suite cards ── */
  var suites = report.suites || [];
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\u{1F4C5} Scheduler Test Suites <span class="muted">(' + suites.length + ')</span></div>';

  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var isExpanded = state.expandedSchedulerDiagnosticSuiteId === s.suite;
    var totalTests = s.tests || 0;
    var passed = s.passes || 0;
    var failed = s.failures || 0;
    var isPassing = failed === 0 && s.status !== 'ERROR';
    var statusColor = isPassing ? '#7ecf7e' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : '\u2717';
    var statusText = s.status || 'UNKNOWN';

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleSchedulerDiagnosticSuite(\'' + escapeHtml(s.suite) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">' + escapeHtml(s.suite) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    if (s.runner) {
      html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.runner) + '</span>';
    }
    html += '</div>';
    if (s.description) {
      html += '<div class="tp-card-desc">' + escapeHtml(s.description) + '</div>';
    }
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passed + '/' + totalTests + ' passed</span>';
    if (s.duration > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.duration / 1000).toFixed(1) + 's</span>';
    if (s.pending > 0) html += '<span class="tp-meta-tag">\u23F8 ' + s.pending + ' pending</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Stats row */
    html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCA Results</div>';
    html += '<div class="tp-stat-row">';
    html += '<div class="tp-stat"><span class="tp-stat-label">Total</span><span class="tp-stat-value">' + totalTests + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Passed</span><span class="tp-stat-value" style="color:#7ecf7e;">' + passed + '</span></div>';
    html += '<div class="tp-stat"><span class="tp-stat-label">Failed</span><span class="tp-stat-value" style="color:#ffc1c1;">' + failed + '</span></div>';
    if (s.duration > 0) html += '<div class="tp-stat"><span class="tp-stat-label">Duration</span><span class="tp-stat-value">' + (s.duration / 1000).toFixed(1) + 's</span></div>';
    html += '</div></div>';

    /* Failed test names */
    if (s.failedTests && s.failedTests.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u2717 Failed Tests</div>';
      for (var f = 0; f < s.failedTests.length; f++) {
        html += '<div style="font-size:11px;padding:2px 0;color:#ffc1c1;">\u2192 ' + escapeHtml(s.failedTests[f]) + '</div>';
      }
      html += '</div>';
    }

    /* Error info */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════
// Demo Scenarios Diagnostics
// ═══════════════════════════════════════════════════════════════════════

export function computeDemoDiagnosticsSummary() {
  var report = state.demoDiagnosticsReport;
  if (!report || !report.summary) {
    return { passes: 0, failures: 0, running: state.demoDiagnosticsRunning };
  }
  return {
    passes: report.summary.passed,
    failures: report.summary.failed,
    running: state.demoDiagnosticsRunning,
  };
}

export async function loadDemoDiagnosticsReport() {
  try {
    var data = await request('/api/diagnostics/demo/report');
    if (data && data.summary) {
      state.demoDiagnosticsReport = data;
    } else {
      state.demoDiagnosticsReport = null;
    }
  } catch (e) {
    dashboardLog('tools', 'demo-diagnostics.load.error', 'Failed to load demo diagnostics report: ' + e.message);
  }
  try {
    var statusData = await request('/api/diagnostics/demo/status');
    state.demoDiagnosticsRunning = statusData.running || false;
    state.demoDiagnosticsLastRunAt = statusData.lastRunAt || null;
  } catch { /* best-effort */ }
}

export async function runDemoDiagnostics() {
  if (state.demoDiagnosticsRunning) return;
  state.demoDiagnosticsRunning = true;
  state.demoDiagnosticsProgress = [];
  renderDemoDiagnosticsPanel();
  try {
    await request('/api/diagnostics/demo/run', { method: 'POST' });
    dashboardLog('tools', 'demo-diagnostics.started', 'Demo scenario diagnostics run started');
  } catch (e) {
    state.demoDiagnosticsRunning = false;
    dashboardLog('tools', 'demo-diagnostics.error', 'Failed to start demo diagnostics: ' + e.message);
    renderDemoDiagnosticsPanel();
  }
}

export function handleDemoDiagnosticsWsMessage(data) {
  if (data.type === 'demo_diagnostics_progress') {
    state.demoDiagnosticsProgress.push(data);
    var isPassing = data.status === 'PASS';
    var sev = isPassing ? 'info' : data.status === 'SKIP' ? 'warn' : 'error';
    var icon = isPassing ? '\u2705' : data.status === 'SKIP' ? '\u23E9' : '\u274C';
    var detail = icon + ' [' + (data.scenario || '?') + '] ' + (data.title || 'unknown') + ' \u2014 ' + (data.passes || 0) + ' passed, ' + (data.failures || 0) + ' failed';
    dashboardLog('demo-diagnostics', 'scenario.' + (data.scenario || 'unknown'), detail, sev);
    renderDemoDiagnosticsPanel();
  }
  if (data.type === 'demo_diagnostics_log') {
    var msg = (data.message || '').trim();
    if (!msg || /^\s*$/.test(msg)) return;
    if (/^(\s*at\s|generatedMessage|code:|actual:|expected:|operator:|diff:)/i.test(msg)) return;
    var logSev = /error|fail|crash|exception/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info';
    dashboardLog('demo-diagnostics', 'runner', msg, logSev);
  }
  if (data.type === 'demo_diagnostics_complete') {
    state.demoDiagnosticsRunning = false;
    state.demoDiagnosticsLastRunAt = data.timestamp || new Date().toISOString();
    var summary = data.summary;
    if (summary) {
      var allPassed = summary.failed === 0;
      var completeSev = allPassed ? 'info' : 'warn';
      var completeIcon = allPassed ? '\u2705' : '\u26A0\uFE0F';
      dashboardLog('demo-diagnostics', 'complete', completeIcon + ' Demo scenarios complete: ' + summary.passed + ' passed, ' + summary.failed + ' failed, ' + summary.skipped + ' skipped', completeSev);
    } else {
      dashboardLog('demo-diagnostics', 'complete', '\u2705 Demo scenarios run finished');
    }
    loadDemoDiagnosticsReport().then(function () {
      renderDemoDiagnosticsPanel();
      renderPanelSummaries();
    });
  }
}

export function toggleDemoDiagnosticSuite(scenarioId) {
  if (state.expandedDemoDiagnosticSuiteId === scenarioId) {
    state.expandedDemoDiagnosticSuiteId = null;
  } else {
    state.expandedDemoDiagnosticSuiteId = scenarioId;
  }
  renderDemoDiagnosticsPanel();
}

export function renderDemoDiagnosticsPanel() {
  var container = document.getElementById('demo-diagnostics-panel');
  if (!container) return;

  var html = '';
  var report = state.demoDiagnosticsReport;
  var running = state.demoDiagnosticsRunning;
  var progress = state.demoDiagnosticsProgress || [];

  /* ── Controls bar ── */
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
  html += '<button class="primary-button" style="font-size:12px;padding:6px 16px;" onclick="runDemoDiagnostics()"' + (running ? ' disabled' : '') + '>';
  html += running ? '\u23F3 Running\u2026' : '\u{1F3AC} Run Demo Scenarios';
  html += '</button>';
  if (state.demoDiagnosticsLastRunAt) {
    html += '<span class="muted" style="font-size:11px;">Last run: ' + timeAgo(state.demoDiagnosticsLastRunAt) + '</span>';
  }
  if (report && report.summary) {
    var sm = report.summary;
    html += '<span style="font-size:12px;font-weight:600;color:' + (sm.failed === 0 ? '#7ecf7e' : '#ffc1c1') + ';">';
    html += sm.passed + ' passed' + (sm.failed > 0 ? ' / ' + sm.failed + ' failed' : '') + (sm.skipped > 0 ? ' / ' + sm.skipped + ' skipped' : '');
    html += '</span>';
    if (sm.durationMs > 0) {
      html += '<span class="muted" style="font-size:11px;">' + (sm.durationMs / 1000).toFixed(2) + 's</span>';
    }
  }
  html += '</div>';

  /* ── Live progress during run ── */
  if (running && progress.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var p = 0; p < progress.length; p++) {
      var pr = progress[p];
      if (pr.type !== 'demo_diagnostics_progress') continue;
      var pIcon = pr.status === 'PASS' ? '\u2713' : pr.status === 'SKIP' ? '\u23E9' : '\u2717';
      var pColor = pr.status === 'PASS' ? '#7ecf7e' : pr.status === 'SKIP' ? '#f0e68c' : '#ffc1c1';
      html += '<div style="font-size:11px;padding:2px 0;color:' + pColor + ';">';
      html += pIcon + ' [' + escapeHtml(pr.scenario || '?') + '] ' + escapeHtml(pr.title || '') + ' \u2014 ' + (pr.passes || 0) + ' passed';
      html += '</div>';
    }
    html += '</div>';
  }

  /* ── No report yet ── */
  if (!report || !report.scenarios) {
    if (!running) {
      html += '<div class="muted" style="text-align:center;padding:24px;">No demo scenario results yet. Click <strong>Run Demo Scenarios</strong> to execute the full demo suite.</div>';
    }
    container.innerHTML = html;
    return;
  }

  /* ── Profile & category info ── */
  html += '<div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--fg);">\u{1F3AC} Demo Scenarios <span class="muted">(' + report.scenarios.length + ')</span>';
  if (report.profileSegment) html += ' <span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(report.profileSegment) + '</span>';
  html += '</div>';

  /* ── Scenario cards ── */
  var scenarios = report.scenarios || [];
  for (var i = 0; i < scenarios.length; i++) {
    var s = scenarios[i];
    var isExpanded = state.expandedDemoDiagnosticSuiteId === s.id;
    var totalSteps = s.steps ? s.steps.length : 0;
    var passedSteps = s.steps ? s.steps.filter(function (st) { return st.status === 'pass'; }).length : 0;
    var failedSteps = s.steps ? s.steps.filter(function (st) { return st.status === 'fail'; }).length : 0;
    var isPassing = s.status === 'pass';
    var isSkipped = s.status === 'skip';
    var statusColor = isPassing ? '#7ecf7e' : isSkipped ? '#f0e68c' : '#ffc1c1';
    var statusIcon = isPassing ? '\u2713' : isSkipped ? '\u23E9' : '\u2717';
    var statusText = (s.status || 'unknown').toUpperCase();

    html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + (isPassing ? ' tp-healthy' : isSkipped ? '' : ' tp-error') + '" style="margin-bottom:6px;">';

    /* Card header */
    html += '<div class="tp-card-head" onclick="toggleDemoDiagnosticSuite(\'' + escapeHtml(s.id) + '\')">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="tp-card-name">[' + escapeHtml(s.id) + '] ' + escapeHtml(s.title) + '</span>';
    html += '<span class="tp-status-dot ' + (isPassing ? 'green' : isSkipped ? 'yellow' : 'red') + '"></span>';
    html += '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusIcon + ' ' + statusText + '</span>';
    html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">T' + (s.tier || '?') + '</span>';
    html += '<span class="ps-badge" style="background:rgba(148,163,184,0.1);color:var(--muted);font-size:10px;">' + escapeHtml(s.profile || '') + '</span>';
    html += '</div>';
    html += '<div class="tp-card-meta">';
    html += '<span class="tp-meta-tag" style="color:' + statusColor + ';">' + passedSteps + '/' + totalSteps + ' steps passed</span>';
    if (s.durationMs > 0) html += '<span class="tp-meta-tag">\u23F1 ' + (s.durationMs / 1000).toFixed(2) + 's</span>';
    if (s.tags && s.tags.length > 0) html += '<span class="tp-meta-tag">' + s.tags.map(escapeHtml).join(', ') + '</span>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    /* Expanded body */
    html += '<div class="tp-card-body">';

    /* Steps */
    if (s.steps && s.steps.length > 0) {
      html += '<div class="tp-section"><div class="tp-section-title">\uD83D\uDCCB Steps</div>';
      for (var j = 0; j < s.steps.length; j++) {
        var st = s.steps[j];
        var stIcon = st.status === 'pass' ? '\u2713' : st.status === 'skip' ? '\u23E9' : '\u2717';
        var stColor = st.status === 'pass' ? '#7ecf7e' : st.status === 'skip' ? '#f0e68c' : '#ffc1c1';
        html += '<div style="font-size:11px;padding:2px 0;display:flex;gap:6px;">';
        html += '<span style="color:' + stColor + ';min-width:16px;">' + stIcon + '</span>';
        html += '<span style="color:var(--fg);">Step ' + st.step + ': ' + escapeHtml(st.description) + '</span>';
        if (st.durationMs > 0) html += '<span class="muted">(' + st.durationMs.toFixed(0) + 'ms)</span>';
        html += '</div>';
        if (st.error) {
          html += '<div style="font-size:10px;padding-left:22px;color:#ffc1c1;">\u21B3 ' + escapeHtml(st.error) + '</div>';
        }
      }
      html += '</div>';
    }

    /* Error */
    if (s.error) {
      html += '<div class="tp-section"><div class="tp-section-title" style="color:#ffc1c1;">\u26A0 Error</div>';
      html += '<pre style="font-size:10px;color:#ffc1c1;white-space:pre-wrap;max-height:120px;overflow:auto;">' + escapeHtml(s.error) + '</pre>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  /* ── Report metadata ── */
  if (report.generatedAt) {
    html += '<div class="muted" style="font-size:10px;text-align:right;margin-top:8px;">Report generated: ' + escapeHtml(report.generatedAt) + '</div>';
  }

  container.innerHTML = html;
}

// -- Live Plugin Health Polling (E3d) ------------------------------------------

var _pluginHealthPollTimer = null;

/** Plugin names to poll automatically � matches the static plugin list in renderPluginsPanel(). */
var _KNOWN_PLUGINS = ['ids-mcp', 'impressioncore-eds', 'impressioncore-ipa', 'impressioncore-goliath', 'impressioncore-vrgc', 'impressioncore-dpa', 'web-search-mcp'];

/** Poll health for all known plugins via POST /api/v1/plugins/{name}/health. */
export function pollPluginHealth() {
  var promises = _KNOWN_PLUGINS.map(function (name) {
    return request('/api/v1/plugins/' + encodeURIComponent(name) + '/health', { method: 'POST' })
      .then(function (res) {
        var ps = getPluginState(name);
        ps.healthy = res.healthy !== false;
        ps.lastChecked = new Date().toISOString();
      })
      .catch(function () {
        var ps = getPluginState(name);
        ps.healthy = false;
        ps.lastChecked = new Date().toISOString();
      });
  });
  return Promise.all(promises).then(function () {
    var container = document.getElementById('plugins-panel');
    if (container) { safeRenderStep('pluginsPanel', renderPluginsPanel); }
  });
}

/** Start 30-second auto-refresh polling for plugin health. No-op if already running. */
export function startPluginHealthPolling() {
  if (_pluginHealthPollTimer !== null) return;
  pollPluginHealth();
  _pluginHealthPollTimer = setInterval(function () { pollPluginHealth(); }, 30000);
}

/** Stop plugin health polling. */
export function stopPluginHealthPolling() {
  if (_pluginHealthPollTimer !== null) {
    clearInterval(_pluginHealthPollTimer);
    _pluginHealthPollTimer = null;
  }
}

