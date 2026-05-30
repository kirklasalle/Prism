import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';

/* ── Local state ── */
let currentBrowserView = 'sessions';
let currentStorageSubView = 'cookies';
let browserDevToolsOpen = false;
const actionLog = [];

/* ── Helpers ── */

function getActiveSessionId() {
  var el = document.getElementById('browser-active-session');
  return el ? el.value : '';
}

function sessionSelectForPanel(panelName) {
  var map = {
    viewport: 'browser-active-session',
    network: 'browser-network-session',
    console: 'browser-console-session',
    dom: 'browser-dom-session',
    storage: 'browser-storage-session',
  };
  return map[panelName] || null;
}

export async function refreshSessionsList() {
  try {
    var data = await request('/api/browser/sessions');
    var sessions = data.sessions || [];
    state.browserSessions = sessions;
    renderBrowserSessions(sessions);
    populateBrowserSessionDropdowns();
    browserRefreshLaunchProfiles();
  } catch (e) {
    console.error('[browser] Failed to refresh sessions', e);
  }
}

/* ── Sub-view navigation ── */

export function setBrowserView(view) {
  currentBrowserView = view;
  var views = ['sessions', 'viewport', 'network', 'console', 'dom', 'storage', 'profiles'];
  for (var i = 0; i < views.length; i++) {
    var panel = document.getElementById('browser-' + views[i] + '-panel');
    if (panel) panel.style.display = views[i] === view ? '' : 'none';
    var btn = document.getElementById('bv-' + views[i]);
    if (btn) {
      btn.classList.toggle('active', views[i] === view);
    }
  }
  if (view === 'viewport') populateBrowserSessionDropdowns();
  if (view === 'network') { populateBrowserSessionDropdowns(); browserRefreshNetwork(); }
  if (view === 'console') { populateBrowserSessionDropdowns(); browserRefreshConsole(); }
  if (view === 'dom') { populateBrowserSessionDropdowns(); browserRefreshDom(); }
  if (view === 'storage') { populateBrowserSessionDropdowns(); browserRefreshStorage(); }
  if (view === 'profiles') browserRefreshProfiles();
}

export function toggleBrowserDevTools() {
  browserDevToolsOpen = !browserDevToolsOpen;
  var btn = document.getElementById('browser-f12-btn');
  if (btn) {
    btn.style.background = browserDevToolsOpen ? 'var(--accent)' : 'var(--surface)';
    btn.style.color = browserDevToolsOpen ? '#fff' : 'var(--accent)';
  }
  if (browserDevToolsOpen) {
    setBrowserView('console');
  } else {
    setBrowserView('sessions');
  }
}

/* ── Storage ── */

export async function browserRefreshStorage() {
  var selectId = sessionSelectForPanel('storage');
  var el = selectId ? document.getElementById(selectId) : null;
  var sessionId = el ? el.value : getActiveSessionId();
  if (!sessionId) {
    renderStorageContent(null, currentStorageSubView);
    return;
  }
  var container = document.getElementById('browser-storage-content');
  if (container) container.innerHTML = '<span class="muted">Loading storage...</span>';
  try {
    var cookieResult = await request('/api/browser/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, expression: 'document.cookie' })
    });
    var localResult = await request('/api/browser/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, expression: 'JSON.stringify(Object.keys(localStorage).reduce(function(o,k){o[k]=localStorage.getItem(k);return o;},{}))' })
    });
    var sessionResult = await request('/api/browser/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, expression: 'JSON.stringify(Object.keys(sessionStorage).reduce(function(o,k){o[k]=sessionStorage.getItem(k);return o;},{}))' })
    });
    state.browserStorage = {
      cookies: cookieResult.result || '',
      local: localResult.result || '{}',
      session: sessionResult.result || '{}'
    };
    renderStorageContent(state.browserStorage, currentStorageSubView);
  } catch (e) {
    if (container) container.innerHTML = '<span class="muted">Failed to load storage: ' + escapeHtml(e.message) + '</span>';
  }
}

export function setStorageSubView(subView) {
  currentStorageSubView = subView;
  var tabs = ['cookies', 'local', 'session'];
  for (var i = 0; i < tabs.length; i++) {
    var btn = document.getElementById('storage-tab-' + tabs[i]);
    if (btn) btn.classList.toggle('active', tabs[i] === subView);
  }
  renderStorageContent(state.browserStorage || null, subView);
}

export function renderStorageContent(data, subView) {
  var container = document.getElementById('browser-storage-content');
  if (!container) return;
  if (!data) {
    container.innerHTML = '<span class="muted">No storage data yet. Select a session and refresh.</span>';
    return;
  }
  var html = '';
  if (subView === 'cookies') {
    var cookieStr = typeof data.cookies === 'string' ? data.cookies : '';
    if (!cookieStr) {
      html = '<span class="muted">No cookies found.</span>';
    } else {
      var pairs = cookieStr.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
      html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px 8px;color:var(--text-muted);">Name</th><th style="text-align:left;padding:4px 8px;color:var(--text-muted);">Value</th></tr></thead><tbody>';
      for (var i = 0; i < pairs.length; i++) {
        var idx = pairs[i].indexOf('=');
        var name = idx > -1 ? pairs[i].substring(0, idx) : pairs[i];
        var val = idx > -1 ? pairs[i].substring(idx + 1) : '';
        html += '<tr style="border-bottom:1px solid rgba(148,163,184,0.06);"><td style="padding:4px 8px;">' + escapeHtml(name) + '</td><td style="padding:4px 8px;word-break:break-all;">' + escapeHtml(val) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
  } else {
    var raw = subView === 'local' ? data.local : data.session;
    var parsed = {};
    try { parsed = JSON.parse(raw); } catch (_) { }
    var keys = Object.keys(parsed);
    if (keys.length === 0) {
      html = '<span class="muted">No ' + (subView === 'local' ? 'localStorage' : 'sessionStorage') + ' entries found.</span>';
    } else {
      html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px 8px;color:var(--text-muted);">Key</th><th style="text-align:left;padding:4px 8px;color:var(--text-muted);">Value</th></tr></thead><tbody>';
      for (var ki = 0; ki < keys.length; ki++) {
        var v = String(parsed[keys[ki]]);
        if (v.length > 200) v = v.substring(0, 200) + '\u2026';
        html += '<tr style="border-bottom:1px solid rgba(148,163,184,0.06);"><td style="padding:4px 8px;">' + escapeHtml(keys[ki]) + '</td><td style="padding:4px 8px;word-break:break-all;">' + escapeHtml(v) + '</td></tr>';
      }
      html += '</tbody></table>';
    }
  }
  container.innerHTML = html;
}

/* ── Profiles ── */

export async function browserRefreshProfiles() {
  try {
    var data = await request('/api/browser/profiles');
    renderBrowserProfiles(data.profiles || []);
  } catch (e) {
    var el = document.getElementById('browser-profiles-list');
    if (el) el.innerHTML = '<span class="muted">Failed to load profiles: ' + escapeHtml(e.message) + '</span>';
  }
}

export function renderBrowserProfiles(profiles) {
  var container = document.getElementById('browser-profiles-list');
  if (!container) return;
  if (!profiles || profiles.length === 0) {
    container.innerHTML = '<span class="muted">No profiles created yet.</span>';
    return;
  }
  var html = '';
  for (var i = 0; i < profiles.length; i++) {
    var p = profiles[i];
    var pid = escapeHtml(p.id || p.profileId || '');
    html += '<div class="panel" style="padding:10px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">';
    html += '<div>';
    html += '<div style="font-weight:600;font-size:13px;">' + escapeHtml(p.displayName || p.prismUserEmail || p.id || 'Profile') + '</div>';
    html += '<div class="muted" style="font-size:11px;">' + escapeHtml(p.prismUserEmail || '') + ' \u2022 ' + escapeHtml(p.executionProfileSegment || 'individual') + '</div>';
    html += '</div>';
    html += '<button onclick="browserDeleteProfile(\'' + pid + '\')" style="padding:4px 10px;border:1px solid rgba(255,141,141,0.3);border-radius:4px;background:rgba(255,141,141,0.08);color:#ff8d8d;cursor:pointer;font-size:11px;">\u2715 Delete</button>';
    html += '</div>';
  }
  container.innerHTML = html;
}

export async function browserRefreshLaunchProfiles() {
  var select = document.getElementById('browser-launch-profile');
  if (!select) return;
  try {
    var data = await request('/api/browser/profiles');
    var profiles = data.profiles || [];
    var html = '<option value="">No profile (ephemeral)</option>';
    for (var i = 0; i < profiles.length; i++) {
      var p = profiles[i];
      var id = p.id || p.profileId || '';
      var label = p.displayName || p.prismUserEmail || id;
      html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(label) + '</option>';
    }
    select.innerHTML = html;
  } catch (_) {
    // keep existing options
  }
}

export async function browserCreateProfile() {
  var emailEl = document.getElementById('browser-profile-email');
  var segmentEl = document.getElementById('browser-profile-segment');
  var email = emailEl ? emailEl.value.trim() : '';
  var segment = segmentEl ? segmentEl.value : 'individual';
  if (!email) {
    browserLogAction('create-profile', 'Email required');
    return;
  }
  try {
    await request('/api/browser/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, segment: segment })
    });
    browserLogAction('create-profile', 'Created profile for ' + email);
    if (emailEl) emailEl.value = '';
    await browserRefreshProfiles();
    await browserRefreshLaunchProfiles();
  } catch (e) {
    browserLogAction('create-profile', 'Failed: ' + e.message);
  }
}

export async function browserDeleteProfile(profileId) {
  if (!profileId) return;
  try {
    await request('/api/browser/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' });
    browserLogAction('delete-profile', 'Deleted profile ' + profileId);
    await browserRefreshProfiles();
    await browserRefreshLaunchProfiles();
  } catch (e) {
    browserLogAction('delete-profile', 'Failed: ' + e.message);
  }
}

/* ── Sessions ── */

export async function browserLaunchSession(headless) {
  var profileSelect = document.getElementById('browser-launch-profile');
  var profileId = profileSelect ? profileSelect.value : '';
  browserLogAction('launch', (headless ? 'Headless' : 'Headed') + ' session' + (profileId ? ' [profile: ' + profileId + ']' : ''));
  try {
    var body = { headless: headless };
    if (profileId) body.profileId = profileId;
    var session = await request('/api/browser/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    browserLogAction('launch', 'Session started: ' + (session.sessionId || 'unknown'));
    await refreshSessionsList();
    setBrowserView('viewport');
  } catch (e) {
    browserLogAction('launch', 'Failed: ' + e.message);
  }
}

export async function browserCloseSession(sessionId) {
  if (!sessionId) return;
  browserLogAction('close', 'Closing session ' + sessionId);
  try {
    await request('/api/browser/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
    browserLogAction('close', 'Session closed: ' + sessionId);
    await refreshSessionsList();
  } catch (e) {
    browserLogAction('close', 'Failed: ' + e.message);
  }
}

export function renderBrowserSessions(sessions) {
  var container = document.getElementById('browser-sessions-list');
  if (!container) return;
  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<span class="muted">No active browser sessions. Click Launch to start one.</span>';
    return;
  }
  var html = '';
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var sid = escapeHtml(s.sessionId || s.id || '');
    var modeLabel = s.headless ? 'Headless' : 'Headed';
    var modeBadge = s.headless
      ? '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(105,210,255,0.12);color:#69d2ff;">' + modeLabel + '</span>'
      : '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(126,207,126,0.12);color:#7ecf7e;">' + modeLabel + '</span>';
    var urlDisplay = s.url ? escapeHtml(s.url) : '<span class="muted">No URL</span>';
    html += '<div class="panel" style="padding:10px;margin-bottom:6px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-weight:600;font-size:13px;font-family:monospace;">' + sid + '</span>';
    html += modeBadge;
    if (s.profileId) {
      html += '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;background:rgba(192,132,252,0.12);color:#c084fc;">Profile: ' + escapeHtml(s.profileId) + '</span>';
    }
    html += '</div>';
    html += '<button onclick="browserCloseSession(\'' + sid + '\')" style="padding:4px 10px;border:1px solid rgba(255,141,141,0.3);border-radius:4px;background:rgba(255,141,141,0.08);color:#ff8d8d;cursor:pointer;font-size:11px;">\u2715 Close</button>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted);">' + urlDisplay + '</div>';
    if (s.createdAt) {
      html += '<div style="font-size:10px;color:var(--muted);margin-top:4px;">Started: ' + escapeHtml(new Date(s.createdAt).toLocaleString()) + '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

/* ── Viewport actions ── */

export async function browserNavigate() {
  var sessionId = getActiveSessionId();
  var urlEl = document.getElementById('browser-url-input');
  var targetUrl = urlEl ? urlEl.value.trim() : '';
  if (!sessionId) {
    browserLogAction('navigate', 'No session selected');
    return;
  }
  if (!targetUrl) {
    browserLogAction('navigate', 'No URL entered');
    return;
  }
  browserLogAction('navigate', targetUrl);
  var pageInfo = document.getElementById('browser-page-info');
  if (pageInfo) pageInfo.textContent = 'Navigating to ' + targetUrl + '...';
  try {
    var result = await request('/api/browser/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, url: targetUrl })
    });
    if (pageInfo) pageInfo.textContent = 'Loaded: ' + (result.url || targetUrl);
    browserLogAction('navigate', 'OK \u2014 ' + targetUrl);
    await browserTakeScreenshot();
  } catch (e) {
    if (pageInfo) pageInfo.textContent = 'Navigation failed: ' + e.message;
    browserLogAction('navigate', 'Failed: ' + e.message);
  }
}

export async function browserTakeScreenshot() {
  var sessionId = getActiveSessionId();
  if (!sessionId) return;
  var container = document.getElementById('browser-viewport-container');
  if (container) container.innerHTML = '<span class="muted">Capturing screenshot...</span>';
  try {
    var response = await fetch('/api/browser/screenshot/' + encodeURIComponent(sessionId));
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    if (container) {
      container.innerHTML = '<img src="' + url + '" alt="Browser screenshot" style="max-width:100%;max-height:600px;object-fit:contain;cursor:pointer;" onclick="window.open(this.src,\'_blank\')" title="Click to open full size" />';
    }
    browserLogAction('screenshot', 'Captured for session ' + sessionId);
  } catch (e) {
    if (container) container.innerHTML = '<span class="muted">Screenshot failed: ' + escapeHtml(e.message) + '</span>';
    browserLogAction('screenshot', 'Failed: ' + e.message);
  }
}

export async function browserClickElement() {
  var sessionId = getActiveSessionId();
  var selectorEl = document.getElementById('browser-click-selector');
  var selector = selectorEl ? selectorEl.value.trim() : '';
  if (!sessionId || !selector) {
    browserLogAction('click', 'Session and selector required');
    return;
  }
  try {
    await request('/api/browser/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, selector: selector })
    });
    browserLogAction('click', 'Clicked: ' + selector);
    await browserTakeScreenshot();
  } catch (e) {
    browserLogAction('click', 'Failed: ' + e.message);
  }
}

export async function browserTypeText() {
  var sessionId = getActiveSessionId();
  var selectorEl = document.getElementById('browser-type-selector');
  var textEl = document.getElementById('browser-type-text');
  var selector = selectorEl ? selectorEl.value.trim() : '';
  var text = textEl ? textEl.value : '';
  if (!sessionId || !selector) {
    browserLogAction('type', 'Session and selector required');
    return;
  }
  try {
    await request('/api/browser/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, selector: selector, text: text })
    });
    browserLogAction('type', 'Typed into ' + selector);
    await browserTakeScreenshot();
  } catch (e) {
    browserLogAction('type', 'Failed: ' + e.message);
  }
}

export async function browserEvaluate() {
  var sessionId = getActiveSessionId();
  var inputEl = document.getElementById('browser-eval-input');
  var expression = inputEl ? inputEl.value.trim() : '';
  if (!sessionId || !expression) {
    browserLogAction('evaluate', 'Session and expression required');
    return;
  }
  var resultEl = document.getElementById('browser-eval-result');
  if (resultEl) {
    resultEl.style.display = 'block';
    resultEl.textContent = 'Evaluating...';
  }
  try {
    var data = await request('/api/browser/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, expression: expression })
    });
    var output = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
    if (resultEl) {
      resultEl.innerHTML = '<span style="color:#7ecf7e;">Result:</span> <pre style="margin:4px 0;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(output) + '</pre>';
    }
    browserLogAction('evaluate', 'Evaluated: ' + expression.substring(0, 80));
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#ff8d8d;">Error:</span> ' + escapeHtml(e.message);
    browserLogAction('evaluate', 'Failed: ' + e.message);
  }
}

/* ── Network / Console / DOM panels ── */

export async function browserRefreshNetwork() {
  var selectEl = document.getElementById('browser-network-session');
  var sessionId = selectEl ? selectEl.value : getActiveSessionId();
  var tbody = document.getElementById('browser-network-body');
  if (!tbody) return;
  if (!sessionId) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:10px;">Select a session first.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:10px;">Loading...</td></tr>';
  try {
    var data = await request('/api/browser/network-log/' + encodeURIComponent(sessionId));
    var entries = data.entries || [];
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:10px;">No network entries recorded.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var statusColor = (e.status >= 200 && e.status < 300) ? '#7ecf7e' : (e.status >= 400 ? '#ff8d8d' : 'var(--text)');
      html += '<tr style="border-bottom:1px solid rgba(148,163,184,0.06);">';
      html += '<td style="padding:4px 8px;font-weight:600;">' + escapeHtml(e.method || 'GET') + '</td>';
      html += '<td style="padding:4px 8px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(e.url || '') + '">' + escapeHtml(e.url || '') + '</td>';
      html += '<td style="padding:4px 8px;color:' + statusColor + ';">' + escapeHtml(String(e.status || '')) + '</td>';
      html += '<td style="padding:4px 8px;">' + escapeHtml(e.resourceType || e.type || '') + '</td>';
      html += '<td style="padding:4px 8px;">' + (e.timing ? escapeHtml(String(Math.round(e.timing)) + 'ms') : '\u2014') + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
    browserLogAction('network', entries.length + ' entries loaded');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:10px;">Failed: ' + escapeHtml(e.message) + '</td></tr>';
  }
}

export async function browserRefreshConsole() {
  var selectEl = document.getElementById('browser-console-session');
  var sessionId = selectEl ? selectEl.value : getActiveSessionId();
  var container = document.getElementById('browser-console-entries');
  if (!container) return;
  if (!sessionId) {
    container.innerHTML = '<span class="muted">Select a session first.</span>';
    return;
  }
  container.innerHTML = '<span class="muted">Loading...</span>';
  try {
    var data = await request('/api/browser/console-logs/' + encodeURIComponent(sessionId));
    var logs = data.logs || [];
    if (logs.length === 0) {
      container.innerHTML = '<span class="muted">No console output yet.</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      var levelColor = log.type === 'error' ? '#ff8d8d' : (log.type === 'warning' ? '#ffd17a' : '#69d2ff');
      var levelLabel = log.type || 'log';
      html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);display:flex;gap:8px;">';
      html += '<span style="color:' + levelColor + ';font-size:10px;font-weight:700;min-width:48px;text-transform:uppercase;">' + escapeHtml(levelLabel) + '</span>';
      html += '<span style="word-break:break-all;">' + escapeHtml(typeof log.text === 'string' ? log.text : JSON.stringify(log.text || log.message || '')) + '</span>';
      html += '</div>';
    }
    container.innerHTML = html;
    browserLogAction('console', logs.length + ' entries loaded');
  } catch (e) {
    container.innerHTML = '<span class="muted">Failed: ' + escapeHtml(e.message) + '</span>';
  }
}

export async function browserRefreshDom() {
  var selectEl = document.getElementById('browser-dom-session');
  var sessionId = selectEl ? selectEl.value : getActiveSessionId();
  var container = document.getElementById('browser-dom-content');
  if (!container) return;
  if (!sessionId) {
    container.textContent = 'Select a session first.';
    return;
  }
  container.textContent = 'Loading DOM snapshot...';
  try {
    var data = await request('/api/browser/dom-snapshot/' + encodeURIComponent(sessionId));
    container.textContent = data.html || 'Empty document.';
    browserLogAction('dom', 'Snapshot loaded (' + (data.length || 0) + ' chars)');
  } catch (e) {
    container.textContent = 'Failed: ' + e.message;
  }
}

/* ── Diagnostics ── */

export async function browserRunDiagnostics() {
  var container = document.getElementById('browser-diagnostics-result');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<span class="muted">Running diagnostics...</span>';
  try {
    var data = await request('/api/browser/diagnostics');
    var checks = data.checks || [];
    var html = '<strong>' + (data.ok ? '<span style="color:#7ecf7e;">\u2713 All checks passed</span>' : '<span style="color:#ff8d8d;">\u2717 Issues detected</span>') + '</strong><br/>';
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      var icon = c.ok ? '<span style="color:#7ecf7e;">\u2713</span>' : '<span style="color:#ff8d8d;">\u2717</span>';
      html += icon + ' <strong>' + escapeHtml(c.name) + '</strong>: ' + escapeHtml(c.detail) + '<br/>';
    }
    html += '<br/><button style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);cursor:pointer;" onclick="document.getElementById(\'browser-diagnostics-result\').style.display=\'none\'">Dismiss</button>';
    container.innerHTML = html;
    browserLogAction('diagnostics', data.ok ? 'All passed' : 'Issues found');
  } catch (e) {
    container.innerHTML = '<span style="color:#ff8d8d;">Diagnostics failed: ' + escapeHtml(e.message) + '</span>';
  }
}

/* ── Session management ── */

export function browserSessionChanged() {
  var sessionId = getActiveSessionId();
  if (sessionId) state.activeBrowserSessionId = sessionId;
  // Sync all other panel dropdowns to the same session
  var dropdownIds = ['browser-network-session', 'browser-console-session', 'browser-dom-session', 'browser-storage-session'];
  for (var di = 0; di < dropdownIds.length; di++) {
    var otherSel = document.getElementById(dropdownIds[di]);
    if (otherSel && sessionId) otherSel.value = sessionId;
  }
  var sessions = state.browserSessions || [];
  var pageInfo = document.getElementById('browser-page-info');
  if (pageInfo) {
    if (sessionId) {
      var found = sessions.find(function (s) { return (s.sessionId || s.id) === sessionId; });
      pageInfo.textContent = found && found.url ? 'Current: ' + found.url : 'Session active: ' + sessionId.substring(0, 16);
    } else {
      pageInfo.textContent = sessions.length === 0 ? 'No active sessions — launch one below' : '';
    }
  }

  // Check CSH Handoff Banner visibility for the current active session
  var banner = document.getElementById('browser-csh-handoff-banner');
  if (banner) {
    if (sessionId && state.activeCshSessionId === sessionId) {
      banner.style.display = 'flex';
      var reasonEl = document.getElementById('browser-csh-reason');
      if (reasonEl) {
        reasonEl.innerHTML = 'Roadblock Reason: <strong style="color:#ff8d8d;">' + escapeHtml(state.activeCshReason || 'MFA/CAPTCHA verification') + '</strong><br/>Active Objective: <em>' + escapeHtml(state.activeCshObjective || 'Goal') + '</em>';
      }
    } else {
      banner.style.display = 'none';
    }
  }

  if (sessionId && currentBrowserView === 'viewport') {
    browserTakeScreenshot().catch(function (e) { console.error('[browser] auto-screenshot failed', e); });
  }
}

export function populateBrowserSessionDropdowns() {
  var sessions = state.browserSessions || [];
  // Determine best session to auto-select: persisted state > first available
  var persistedId = state.activeBrowserSessionId || '';
  var persistedValid = persistedId && sessions.some(function (s) { return (s.sessionId || s.id) === persistedId; });
  var defaultId = persistedValid ? persistedId : (sessions.length > 0 ? (sessions[0].sessionId || sessions[0].id || '') : '');
  var isSingle = sessions.length === 1;

  var dropdownIds = ['browser-active-session', 'browser-network-session', 'browser-console-session', 'browser-dom-session', 'browser-storage-session'];
  var autoSelected = false;
  for (var di = 0; di < dropdownIds.length; di++) {
    var sel = document.getElementById(dropdownIds[di]);
    if (!sel) continue;
    var prev = sel.value;
    var prevValid = prev && sessions.some(function (s) { return (s.sessionId || s.id) === prev; });
    var html = sessions.length === 0
      ? '<option value="">No active sessions</option>'
      : '<option value="">Select session\u2026</option>';
    for (var si = 0; si < sessions.length; si++) {
      var s = sessions[si];
      var sid = s.sessionId || s.id || '';
      var urlPart = s.url ? ' \u2014 ' + s.url.substring(0, 40) : '';
      var label = (isSingle ? 'Current Session' : sid.substring(0, 12)) +
        (s.headless ? ' (headless)' : ' (headed)') + urlPart;
      html += '<option value="' + escapeHtml(sid) + '">' + escapeHtml(label) + '</option>';
    }
    sel.innerHTML = html;
    if (prevValid) {
      sel.value = prev;
    } else if (defaultId) {
      sel.value = defaultId;
      if (dropdownIds[di] === 'browser-active-session') autoSelected = true;
    }
  }
  // Persist and fire change callback so page-info reflects the auto-selected session
  if (autoSelected) {
    var activeEl = document.getElementById('browser-active-session');
    if (activeEl && activeEl.value) {
      state.activeBrowserSessionId = activeEl.value;
      browserSessionChanged();
    }
  }
}

/* ── Action logging ── */

export function browserLogAction(action, detail) {
  var entry = { action: action, detail: detail || '', time: new Date().toLocaleTimeString() };
  actionLog.unshift(entry);
  if (actionLog.length > 100) actionLog.length = 100;
  dashboardLog('browser', 'browser.' + action, detail || '');
  var container = document.getElementById('browser-action-history');
  if (!container) return;
  var html = '';
  var show = actionLog.slice(0, 30);
  for (var i = 0; i < show.length; i++) {
    var e = show[i];
    html += '<div style="padding:3px 0;border-bottom:1px solid rgba(148,163,184,0.04);display:flex;gap:8px;font-size:12px;">';
    html += '<span style="color:var(--muted);min-width:64px;font-size:10px;">' + escapeHtml(e.time) + '</span>';
    html += '<span style="font-weight:600;min-width:80px;color:var(--accent);">' + escapeHtml(e.action) + '</span>';
    html += '<span style="color:var(--text);">' + escapeHtml(e.detail) + '</span>';
    html += '</div>';
  }
  container.innerHTML = html || '<span class="muted">No actions yet.</span>';
}

/* ── Initialization ── */

export async function initBrowserTab() {
  dashboardLog('browser', 'browser.init', 'Initializing browser tab');
  await refreshSessionsList();
  await browserRefreshLaunchProfiles();
  await refreshBrowserInfo();
  updateSshpShieldIndicator();
}

/* ── Legacy functions (from old Computer tab browser section) ── */

export function launchBrowserPreview() {
  window.open(location.href, '_blank');
  var el = document.getElementById('browser-preview-mode');
  if (el) el.textContent = 'External';
  browserLogAction('preview', 'Opened in new window');
}

export function openBrowserDevTools() {
  var el = document.getElementById('browser-preview-mode');
  if (el) el.textContent = 'Press F12 in this browser window';
  browserLogAction('devtools', 'User prompted to use F12');
}

export async function refreshBrowserInfo() {
  var el = document.getElementById('browser-default');
  if (el) {
    var ua = navigator.userAgent;
    if (ua.indexOf('Edg') !== -1) el.textContent = 'Edge';
    else if (ua.indexOf('Chrome') !== -1) el.textContent = 'Chrome';
    else if (ua.indexOf('Firefox') !== -1) el.textContent = 'Firefox';
    else if (ua.indexOf('Safari') !== -1) el.textContent = 'Safari';
    else el.textContent = 'Unknown';
  }
}

/* ── Browser Auto-Pilot (Phase A2B) ── */

export async function submitBrowserAutopilot() {
  var objectiveEl = document.getElementById('browser-autopilot-objective');
  var sessionEl = document.getElementById('browser-autopilot-session');
  var maxEl = document.getElementById('browser-autopilot-max');
  var objective = objectiveEl ? objectiveEl.value.trim() : '';
  var sessionId = sessionEl ? sessionEl.value : '';
  var maxActions = maxEl ? parseInt(maxEl.value, 10) || 20 : 20;
  if (!objective) {
    browserLogAction('autopilot', 'Objective required');
    return;
  }
  var statusEl = document.getElementById('browser-autopilot-status');
  var actionsEl = document.getElementById('browser-autopilot-actions');
  if (statusEl) { statusEl.textContent = 'running'; statusEl.style.color = '#69d2ff'; statusEl.style.background = 'rgba(105,210,255,0.1)'; }
  if (actionsEl) actionsEl.innerHTML = '<span class="muted">Submitting objective…</span>';
  browserLogAction('autopilot', 'Submitting: ' + objective);
  try {
    var result = await request('/api/v1/autonomous/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: '[Browser Auto-Pilot] ' + objective,
        source: 'browser-autopilot',
        constraints: {
          allowBrowser: true,
          allowComputer: false,
          allowShell: false,
          maxActions: maxActions,
          browserSessionId: sessionId || undefined,
        },
      }),
    });
    if (objectiveEl) objectiveEl.value = '';
    browserLogAction('autopilot', 'Goal submitted: ' + (result.goalId || 'unknown'));
    if (actionsEl) actionsEl.innerHTML = '<span class="muted">Goal ' + escapeHtml(result.goalId || '') + ' submitted. Monitoring…</span>';
    // Start polling status
    pollBrowserAutopilot(result.goalId);
  } catch (e) {
    browserLogAction('autopilot', 'Failed: ' + e.message);
    if (statusEl) { statusEl.textContent = 'error'; statusEl.style.color = '#ff7a7a'; }
    if (actionsEl) actionsEl.innerHTML = '<span class="muted" style="color:#ff9a85;">Error: ' + escapeHtml(e.message) + '</span>';
  }
}

export async function stopBrowserAutopilot() {
  var statusEl = document.getElementById('browser-autopilot-status');
  try {
    await request('/api/v1/autonomous/terminate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    browserLogAction('autopilot', 'Stop requested');
    if (statusEl) { statusEl.textContent = 'idle'; statusEl.style.color = '#3ec46d'; statusEl.style.background = 'rgba(62,196,109,0.1)'; }
  } catch (e) {
    browserLogAction('autopilot', 'Stop failed: ' + e.message);
  }
}

function pollBrowserAutopilot(goalId) {
  if (!goalId) return;
  var interval = setInterval(async function () {
    try {
      var data = await request('/api/v1/autonomous/status');
      var statusEl = document.getElementById('browser-autopilot-status');
      var actionsEl = document.getElementById('browser-autopilot-actions');
      if (!data.active || data.active.goalId !== goalId) {
        clearInterval(interval);
        if (statusEl) { statusEl.textContent = 'idle'; statusEl.style.color = '#3ec46d'; statusEl.style.background = 'rgba(62,196,109,0.1)'; }
        if (actionsEl && data.active) {
          actionsEl.innerHTML = '<span class="muted">Goal completed.</span>';
        }
        return;
      }
      var goal = data.active;
      if (statusEl) statusEl.textContent = goal.status || 'running';
      if (actionsEl && goal.steps) {
        var html = '';
        for (var i = 0; i < goal.steps.length; i++) {
          var step = goal.steps[i];
          var icon = step.success ? '<span style="color:#3ec46d;">✓</span>' : '<span style="color:#ff7a7a;">✗</span>';
          html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);">'
            + icon + ' <span class="muted" style="font-size:10px;">' + escapeHtml((step.timestamp || '').slice(11, 19)) + '</span> '
            + escapeHtml(step.action || step.tool || '') + ' '
            + '<span class="muted">' + escapeHtml(step.summary || '') + '</span>'
            + '</div>';
        }
        actionsEl.innerHTML = html || '<span class="muted">Waiting for actions…</span>';
      }
    } catch { /* best-effort */ }
  }, 2000);
}

/* ── SSHP & CSH Integration helpers ── */

export function updateSshpShieldIndicator() {
  var indicator = document.getElementById('browser-sshp-status');
  if (!indicator) return;
  var enabled = state.runtimeSettings ? (state.runtimeSettings.sshpRedactionEnabled !== false) : true;
  if (enabled) {
    indicator.style.background = 'rgba(34,197,94,0.15)';
    indicator.style.color = '#4ade80';
    indicator.textContent = '🛡️ SSHP ACTIVE';
    indicator.title = 'Sovereign Sentinel Visual/DOM PII masking is fully armed.';
  } else {
    indicator.style.background = 'rgba(239,68,68,0.15)';
    indicator.style.color = '#f87171';
    indicator.textContent = '🛡️ SSHP OFF';
    indicator.title = 'Visual/DOM PII masking is disabled by operator command.';
  }
}

export async function resumeActiveCsh() {
  if (!state.activeCshHandoffId || !state.activeCshSessionId) {
    alert('No active Cognitive Session Handoff (CSH) baton pass to resume.');
    return;
  }
  dashboardLog('browser', 'csh.resume-active', 'Operator initiated baton return.');
  try {
    var res = await request('/api/v1/autonomous/session/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoffId: state.activeCshHandoffId, sessionId: state.activeCshSessionId })
    });
    if (res.ok) {
      state.notice = 'Control returned to Agent successfully.';
      var noticeToast = document.getElementById('global-notice-toast');
      if (noticeToast) {
        noticeToast.textContent = state.notice;
        noticeToast.style.opacity = '1';
        setTimeout(() => { noticeToast.style.opacity = '0'; }, 3000);
      }
      var banner = document.getElementById('browser-csh-handoff-banner');
      if (banner) banner.style.display = 'none';
      state.activeCshHandoffId = null;
      state.activeCshSessionId = null;
    }
  } catch (e) {
    console.error('[browser] resume active handoff failed', e);
    alert('Failed to resume agent: ' + e.message);
  }
}

