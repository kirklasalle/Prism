// Dashboard Core — shared state and utilities

export const state = {
  activeTab: 'chat',
  sessions: [],
  selectedSessionId: null,
  messages: [],
  status: null,
  readiness: null,
  llmCatalog: (function () {
    try {
      var cached = localStorage.getItem('prism-llm-catalog');
      return cached ? JSON.parse(cached) : null;
    } catch (_) { return null; }
  })(),
  llmConfig: null,
  llmAuditEvents: [],
  actions: [],
  pending: [],
  actionHistory: [],
  selfReviewLatest: null,
  selfReviewHistory: [],
  retrievalAlerts: [],
  prioritizedAlerts: null,
  telemetrySummary: null,
  telemetryWindow: '1d',
  runtimeExcellence: null,
  releaseValidation: null,
  releaseDecision: null,
  traceData: null,
  selectedTraceId: null,
  events: [],
  busy: false,
  notice: null,
  providerSettingsCache: {},
  expandedProviderId: null,
  providerTestResults: {},
  providerApiKeyVisible: {},
  localLlmSelectionBySession: {},
  sessionPackages: [],
  sessionPackageHistory: [],
  addons: [],
  loadingAddons: false,
  expandedAddonId: null,
  packageReleaseSnapshot: null,
  expandedSessionPackages: {},
  matrixSortCol: 'tier',
  matrixSortAsc: false,
  matrixFilterProvider: '',
  matrixFilterTier: '',
  matrixFilterLocality: '',
  matrixFilterText: '',
  matrixDraftPattern: '',
  matrixDraftTier: '',
  matrixDraftLocality: 'local',
  matrixDraftStrengths: '',
  matrixEditingPattern: null,
  sessionProviderCollapsed: true,
  providerConfigCollapsed: true,
  modelMatrixCollapsed: true,
  modelRoutingCollapsed: true,
  routingStrategy: 'single',
  routingRoleOverrides: {},
  routingAgentOverrides: {},
  routingModalityOverrides: {},
  routingPreferredModality: null,
  routingSuggestions: null,
  routingModalitySuggestions: null,
  availableModalities: [],
  selectedModalityFilter: null,
  modalityFilterEnabled: false,
  sessionRoutingStrategy: 'direct',
  modelProfiles: null,
  // Spectrum Refraction (Prism SR) state
  srConfig: null,
  srCandidates: null,
  srValidation: null,
  srPanelExpanded: false,
  srActivating: false,
  srIsolationLevel: null,
  srIsolationAdvisory: null,
  settingsPanelCollapsed: true,
  llmAuditCollapsed: true,
  addonsPanelCollapsed: false,
  toolsPanelCollapsed: true,
  pluginsPanelCollapsed: true,
  utilitiesPanelCollapsed: true,
  skillsPanelCollapsed: true,
  networkToolsCollapsed: true,
  networkSettingsCollapsed: true,
  networkTelemetryCollapsed: true,
  networkConsoleCollapsed: true,
  networkCommandHistory: [],
  networkTelemetryData: { totalCommands: 0, tier1Count: 0, tier2Count: 0, tier3Count: 0, lastCommand: null, errorCount: 0 },
  vrgcAvailable: false,
  agentMgmtCollapsed: true,
  subAgentCollapsed: true,
  swarmControlCollapsed: true,
  agentTelemetryCollapsed: true,
  localControlCollapsed: true,
  consoleViewCollapsed: true,
  computerConfigCollapsed: true,
  policyControlCollapsed: true,
  browserControlCollapsed: true,
  deviceManagerCollapsed: true,
  characterPanelCollapsed: true,
  workspaceLocationCollapsed: true,
  workspaceFilesCollapsed: true,
  importManagerCollapsed: true,
  workspaceSettingsCollapsed: true,
  agentControlCollapsed: true,
  guardianAgentCollapsed: true,
  cshHandoffCollapsed: true,
  aabLedgerCollapsed: true,
  autonomousGoalsCollapsed: true,
  hardwareSwarmCollapsed: true,
  browserAutopilotCollapsed: true,
  autonomousControlCollapsed: true,
  visionFramebufferCollapsed: true,
  releaseValidationCollapsed: true,
  ptacDemoCollapsed: true,
  supportDeskCollapsed: true,
  unifiedTelemetryCollapsed: true,
  logsLiveTimelineCollapsed: true,
  identitySessionsCollapsed: true,
  networkIntelligenceCollapsed: true,
  usageCostCollapsed: true,
  sloGaugesCollapsed: true,
  compliancePanelCollapsed: true,
  healthWidgetCollapsed: true,
  approvalQueueCollapsed: true,
  characterAssignments: [],
  availableCharacters: [],
  characterAuditEvents: [],
  selectedAssignmentId: null,
  characterFilterText: '',
  expandedToolId: null,
  expandedPluginId: null,
  expandedUtilityId: null,
  toolStates: {},
  toolCatalog: [],
  pluginStates: {},
  utilityStates: {},
  llmModalitySummary: null,
  modelMatrixEntries: [],
  toolReviews: {},
  pluginReviews: {},
  utilityReviews: {},
  toolsFilterText: '',
  toolsSubTab: 'tools',
  toolsSortBy: 'name',
  pluginsSortBy: 'name',
  utilitiesSortBy: 'name',
  runtimeSettings: null,
  settingsSaving: false,
  settingsSections: { runtime: false, llm: false, approval: false, selfReview: false, retrieval: false, timeouts: false, prefs: false, paths: false, readiness: false },
  agentData: null,
  guardianStatus: null,
  localGgufModels: null,
  customRecommendedModels: null,
  guardianTasks: null,
  browserSessions: [],
  computerSystemInfo: null,
  adapterStatus: null,
  computerConsoleHistory: [],
  computerEnvVars: null,
  computerDevices: null,
  ramHistory: [],
  vramHistory: [],
  computerPollInterval: null,
  importHistory: [],
  framebufferAutoRefresh: false,
  framebufferPollInterval: null,
  agenticStream: [],
  lastThinkingTrace: [],
  chatTelemetry: [],
  toolCallLog: [],
  logEntries: [],
  logFilter: { tab: '', severity: '' },
  logsAutoScroll: true,
  hardwareSwarm: [],
  diagnosticsPanelCollapsed: true,
  diagnosticsReport: null,
  diagnosticsRunning: false,
  diagnosticsProgress: [],
  diagnosticsLastRunAt: null,
  expandedDiagnosticSuiteId: null,
  agentDiagnosticsPanelCollapsed: true,
  agentDiagnosticsReport: null,
  agentDiagnosticsRunning: false,
  agentDiagnosticsProgress: [],
  agentDiagnosticsLastRunAt: null,
  expandedAgentDiagnosticSuiteId: null,
  computerDiagnosticsPanelCollapsed: true,
  computerDiagnosticsReport: null,
  computerDiagnosticsRunning: false,
  computerDiagnosticsProgress: [],
  computerDiagnosticsLastRunAt: null,
  expandedComputerDiagnosticSuiteId: null,
  knowledgeGraphDiagnosticsPanelCollapsed: true,
  knowledgeGraphDiagnosticsReport: null,
  knowledgeGraphDiagnosticsRunning: false,
  knowledgeGraphDiagnosticsProgress: [],
  knowledgeGraphDiagnosticsLastRunAt: null,
  expandedKnowledgeGraphDiagnosticSuiteId: null,
  workspaceDiagnosticsPanelCollapsed: true,
  workspaceDiagnosticsReport: null,
  workspaceDiagnosticsRunning: false,
  workspaceDiagnosticsProgress: [],
  workspaceDiagnosticsLastRunAt: null,
  expandedWorkspaceDiagnosticSuiteId: null,
  networkDiagnosticsPanelCollapsed: true,
  networkDiagnosticsReport: null,
  networkDiagnosticsRunning: false,
  networkDiagnosticsProgress: [],
  networkDiagnosticsLastRunAt: null,
  expandedNetworkDiagnosticSuiteId: null,
  logsDiagnosticsPanelCollapsed: true,
  logsDiagnosticsReport: null,
  logsDiagnosticsRunning: false,
  logsDiagnosticsProgress: [],
  logsDiagnosticsLastRunAt: null,
  expandedLogsDiagnosticSuiteId: null,
  telemetryDiagnosticsPanelCollapsed: true,
  telemetryDiagnosticsReport: null,
  telemetryDiagnosticsRunning: false,
  telemetryDiagnosticsProgress: [],
  telemetryDiagnosticsLastRunAt: null,
  expandedTelemetryDiagnosticSuiteId: null,
  schedulerDiagnosticsPanelCollapsed: true,
  schedulerDiagnosticsReport: null,
  schedulerDiagnosticsRunning: false,
  schedulerDiagnosticsProgress: [],
  schedulerDiagnosticsLastRunAt: null,
  expandedSchedulerDiagnosticSuiteId: null,
  demoDiagnosticsPanelCollapsed: true,
  demoDiagnosticsReport: null,
  demoDiagnosticsRunning: false,
  demoDiagnosticsProgress: [],
  demoDiagnosticsLastRunAt: null,
  expandedDemoDiagnosticSuiteId: null,
  roboticsMainCollapsed: false,
  roboticsEntities: [],
  roboticsStats: null,
  roboticsIntegrations: [],
};


export const tabs = [
  { id: 'chat', label: 'Chat Interface' },
  { id: 'settings', label: 'Provider & Settings' },
  { id: 'tools', label: 'Tools & Plugins' },
  { id: 'agentic', label: 'Agentic Control' },
  { id: 'computer', label: 'Computer Control' },
  { id: 'browser', label: 'Browser Control' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'network', label: 'Network' },
  { id: 'robotics', label: 'Robotics Entity' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'logs', label: 'Logs & Debug' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'channels', label: 'Channels' },
  { id: 'wiki', label: 'Prism Wiki' }
];

// ── Auth token (injected via <meta> tag from server) ──────────────────
function getAuthToken() {
  var meta = document.querySelector('meta[name="prism-auth-token"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

export function authHeaders(extra) {
  var token = getAuthToken();
  var headers = extra ? Object.assign({}, extra) : {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

export function wsUrl(path) {
  var token = getAuthToken();
  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var base = protocol + '//' + location.host + (path || '/ws');
  return token ? base + '?token=' + encodeURIComponent(token) : base;
}

// ── Authed asset URL helper ───────────────────────────────────────────
// For asset URLs consumed by <img>, <video>, window.open, etc. that
// cannot carry an Authorization header. Appends ?token=... so the
// AuthGate's query-string fallback authenticates the request.
export function assetUrl(url) {
  if (!url) return url;
  var token = getAuthToken();
  if (!token) return url;
  var sep = url.indexOf('?') < 0 ? '?' : '&';
  return url + sep + 'token=' + encodeURIComponent(token);
}

// ── Reconnection utility with exponential backoff ─────────────────────
export function createReconnector(connectFn, opts) {
  var baseDelay = (opts && opts.baseDelay) || 1000;
  var maxDelay = (opts && opts.maxDelay) || 30000;
  var maxRetries = (opts && opts.maxRetries) || 50;
  var label = (opts && opts.label) || 'reconnector';
  var attempt = 0;
  var active = false;
  var timer = null;

  function schedule() {
    if (active) return; // prevent duplicate reconnect loops
    attempt++;
    if (attempt > maxRetries) {
      console.warn('[' + label + '] max retries (' + maxRetries + ') reached — giving up');
      return;
    }
    var delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    // Add jitter: ±20%
    delay = delay * (0.8 + Math.random() * 0.4);
    console.log('[' + label + '] reconnecting in ' + Math.round(delay) + 'ms (attempt ' + attempt + '/' + maxRetries + ')');
    active = true;
    timer = setTimeout(function () {
      active = false;
      connectFn();
    }, delay);
  }

  function reset() {
    attempt = 0;
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function stop() {
    reset();
    attempt = maxRetries + 1; // prevent further reconnects
  }

  return { schedule: schedule, reset: reset, stop: stop };
}

export
  async function request(url, options) {
  var opts = options || {};
  opts.headers = authHeaders(opts.headers);
  var requestUrl = url;
  if (url.startsWith('/api/') && !url.startsWith('/api/v1/')) {
    requestUrl = '/api/v1' + url.substring(4);
  }
  // Apply a default timeout to prevent any single request from hanging
  // indefinitely and blocking Promise.all chains like refreshChrome().
  // Raised to 30s to accommodate slower local diagnostic queries.
  var timeoutMs = opts.timeoutMs || 30000;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  var fetchOpts = Object.assign({}, opts, { signal: controller.signal });
  delete fetchOpts.timeoutMs;
  var response;
  try {
    response = await fetch(requestUrl, fetchOpts);
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      console.warn('[request] timeout after ' + timeoutMs + 'ms for: ' + requestUrl);
      throw new Error('Request timed out after ' + timeoutMs + 'ms: ' + url);
    }
    throw err;
  }
  clearTimeout(timer);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (parseErr) {
      // Return raw text in the payload.error when JSON parse fails so
      // callers can inspect non-JSON responses without unhandled exceptions.
      payload = { error: 'Invalid JSON response', text: text };
    }
  }
  if (!response.ok) {
    if (response.status === 401) {
      document.title = 'PRISM — Session Expired';
      throw new Error('Unauthorized — reload with a valid token.');
    }
    throw new Error(payload.error || ('Request failed with status ' + response.status));
  }
  return payload;
}

export
  function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export
  function renderMarkdown(text) {
  if (!text) return '';
  var s = String(text);

  // Auto-link goals like goal-3a4 or goal-3a4-tasks
  s = s.replace(/\bgoal-[a-zA-Z0-9]{3,12}\b/gi, function (match, offset, fullText) {
    var before = fullText.substring(0, offset);
    if (/\[[^\]]*$|\([^)]*$|href="[^"]*$|data-prism-tab="[^"]*$|`[^`]*$/.test(before)) {
      return match;
    }
    return '[' + match + '](prism://tab/computer#' + match + ')';
  });

  // Auto-link explicit tab keywords to their corresponding tab IDs
  var tabKeywords = [
    { id: 'browser', patterns: [/@browser/gi, /\bBrowser Tab\b/gi, /\bBrowser Control\b/gi] },
    { id: 'computer', patterns: [/@computer/gi, /\bComputer Tab\b/gi, /\bComputer Control\b/gi] },
    { id: 'agentic', patterns: [/@agentic/gi, /\bAgentic Tab\b/gi, /\bAgentic Control\b/gi] },
    { id: 'workspace', patterns: [/@workspace/gi, /\bWorkspace Tab\b/gi] },
    { id: 'network', patterns: [/@network/gi, /\bNetwork Tab\b/gi] },
    { id: 'telemetry', patterns: [/@telemetry/gi, /\bTelemetry Tab\b/gi] },
    { id: 'logs', patterns: [/@logs/gi, /\bLogs Tab\b/gi, /\bLogs & Debug\b/gi] },
    { id: 'settings', patterns: [/@settings/gi, /\bSettings Tab\b/gi, /\bProvider & Settings\b/gi, /\bProvider settings\b/gi] },
    { id: 'chat', patterns: [/@chat/gi, /\bChat Tab\b/gi, /\bChat Interface\b/gi] },
    { id: 'wiki', patterns: [/@wiki/gi, /\bWiki Tab\b/gi, /\bPrism Wiki\b/gi] },
    { id: 'scheduler', patterns: [/@scheduler/gi, /\bScheduler Tab\b/gi] },
    { id: 'tools', patterns: [/@tools/gi, /\bTools Tab\b/gi, /\bTools & Plugins\b/gi] }
  ];

  tabKeywords.forEach(function (t) {
    t.patterns.forEach(function (pat) {
      s = s.replace(pat, function (match, offset, fullText) {
        var before = fullText.substring(0, offset);
        if (/\[[^\]]*$|\([^)]*$|href="[^"]*$|data-prism-tab="[^"]*$|`[^`]*$/.test(before)) {
          return match;
        }
        return '[' + match + '](prism://tab/' + t.id + ')';
      });
    });
  });
  // Auto-link absolute file paths (Windows and Unix)
  s = s.replace(/(^|\s|`|&gt;)((?:[A-Za-z]:\\[^\s<>"'`]+)|(?:\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+))/g, function (_, prefix, path) {
    return prefix + '<a href="#" class="local-path-link" onclick="window.openLocalPath(\'' + escapeHtml(path.replace(/\\/g, '\\\\')) + '\'); return false;" title="Open in File Explorer">' + escapeHtml(path) + '</a>';
  });
  // Fenced code blocks
  s = s.replace(/```(\w*?)\n([\s\S]*?)```/g, function (_, lang, code) {
    return '<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">' + escapeHtml(lang || 'text') + '</span><button class="code-block-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); this.innerText=\'Copied!\'; setTimeout(()=>this.innerText=\'Copy\',2000)">Copy</button></div><pre><code class="lang-' + escapeHtml(lang || 'text') + '">' + escapeHtml(code) + '</code></pre></div>';
  });
  // Inline code
  s = s.replace(/`([^`]+?)`/g, function (_, code) {
    return '<code>' + escapeHtml(code) + '</code>';
  });
  // Blockquotes
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Headers (process after escaping so # still works in source)
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold & italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
    var safeHref = escapeHtml(href);
    // PRISM in-app deep links: prism://tab/<tabId>[#<anchor>]
    var prismMatch = /^prism:\/\/tab\/([a-z0-9_-]+)(?:#([a-z0-9_-]+))?$/i.exec(href);
    if (prismMatch) {
      var tabId = escapeHtml(prismMatch[1]);
      var anchor = prismMatch[2] ? escapeHtml(prismMatch[2]) : '';
      return '<a href="#" class="prism-deep-link" data-prism-tab="' + tabId + '"'
        + (anchor ? ' data-prism-anchor="' + anchor + '"' : '')
        + '>' + escapeHtml(label) + '</a>';
    }
    // file:// links → open via the local-path handler (same as bare-path auto-links)
    if (/^file:\/\/\//i.test(href)) {
      var localPath = decodeURIComponent(href.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
      return '<a href="#" class="local-path-link" onclick="window.openLocalPath(\'' + escapeHtml(localPath.replace(/\\/g, '\\\\')) + '\'); return false;" title="Open file">' + escapeHtml(label) + '</a>';
    }
    if (!/^https?:\/\//i.test(href)) return escapeHtml(label);
    return '<a href="' + safeHref + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>';
  });
  // Unordered lists
  s = s.replace(/(^|\n)([-*] .+(?:\n[-*] .+)*)/g, function (_, pre, block) {
    var items = block.split('\n').map(function (line) {
      return '<li>' + line.replace(/^[-*] /, '') + '</li>';
    }).join('');
    return pre + '<ul>' + items + '</ul>';
  });
  // Ordered lists
  s = s.replace(/(^|\n)(\d+\. .+(?:\n\d+\. .+)*)/g, function (_, pre, block) {
    var items = block.split('\n').map(function (line) {
      return '<li>' + line.replace(/^\d+\.\s/, '') + '</li>';
    }).join('');
    return pre + '<ol>' + items + '</ol>';
  });
  // Paragraphs: double newlines
  s = s.replace(/\n\n+/g, '</p><p>');
  // Single newlines to <br>
  s = s.replace(/\n/g, '<br>');
  return '<p>' + s + '</p>';
}

export
  function formatRelativeTime(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export
  function safeIso(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

export
  function statusBadge(action) {
  const badgeClass = action.status === 'running'
    ? 'badge badge-running'
    : action.status === 'succeeded'
      ? 'badge badge-succeeded'
      : action.status === 'failed'
        ? 'badge badge-failed'
        : 'badge';
  return '<span class="' + badgeClass + '">' + escapeHtml(action.status) + '</span>';
}

export
  function metricRow(label, value) {
  return '<div class="metric"><span class="muted">' + escapeHtml(label) + '</span><span class="mono">' + escapeHtml(value) + '</span></div>';
}

export function healthDot(ok) {
  return '<span class="tp-status-dot ' + (ok ? 'green' : 'red') + '"></span>';
}

export function timeAgo(ts) {
  if (!ts) return 'never';
  var diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

export function renderStars(store, name, kind) {
  var r = getReview(store, name);
  var html = '<div class="tp-review-stars">';
  for (var s = 1; s <= 5; s++) {
    html += '<span class="tp-star' + (s <= r.rating ? ' active' : '') + '" onclick="setItemRating(\'' + kind + '\', \'' + escapeHtml(name) + '\', ' + s + ')">\u2605</span>';
  }
  html += '</div>';
  return html;
}

export function approvalBadge(status) {
  var cls = { approved: 'tp-approval-approved', review: 'tp-approval-review', flagged: 'tp-approval-flagged', blocked: 'tp-approval-blocked' };
  return '<span class="tp-approval-badge ' + (cls[status] || 'tp-approval-review') + '">' + escapeHtml(status) + '</span>';
}

export
  /* ═══ Brand Panel ═══ */
  function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  var d = Math.floor(seconds / 86400);
  var h = Math.floor((seconds % 86400) / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

export
  function togglePanelCollapse(panelKey) {
  var stateKey = panelKey + 'Collapsed';
  state[stateKey] = !state[stateKey];
  var chevron = document.getElementById('chevron-' + panelKey) || document.getElementById(panelKey + '-collapse-icon');
  var body = document.getElementById('body-' + panelKey) || document.getElementById(panelKey + '-collapsible');
  if (chevron) { chevron.textContent = state[stateKey] ? '\u25B6' : '\u25BC'; }
  if (body) {
    if (state[stateKey]) { body.classList.add('collapsed'); }
    else { body.classList.remove('collapsed'); }
  }
  var summary = document.getElementById(panelKey + '-summary');
  if (summary) {
    summary.style.display = state[stateKey] ? '' : 'none';
  }
  updateCollapseStateInfo(body, state[stateKey]);
  // Dispatch custom event so tab-tools can refresh summary badges
  try { document.dispatchEvent(new CustomEvent('panel-collapse-toggle', { detail: { panelKey: panelKey, collapsed: state[stateKey] } })); } catch (_) { }
}

export function applyPanelCollapseState(panelKey) {
  var stateKey = panelKey + 'Collapsed';
  if (!(stateKey in state)) return;
  var collapsed = !!state[stateKey];
  var chevron = document.getElementById('chevron-' + panelKey) || document.getElementById(panelKey + '-collapse-icon');
  var body = document.getElementById('body-' + panelKey) || document.getElementById(panelKey + '-collapsible');
  if (chevron) { chevron.textContent = collapsed ? '\u25B6' : '\u25BC'; }
  if (body) {
    if (collapsed) { body.classList.add('collapsed'); }
    else { body.classList.remove('collapsed'); }
  }
  var summary = document.getElementById(panelKey + '-summary');
  if (summary) {
    summary.style.display = collapsed ? '' : 'none';
  }
  updateCollapseStateInfo(body, collapsed);
}

export function applyAllPanelCollapseStates() {
  for (var stateKey in state) {
    if (!stateKey.endsWith('Collapsed')) continue;
    var panelKey = stateKey.slice(0, -9);
    applyPanelCollapseState(panelKey);
  }
  annotateCollapseStates();
}

function updateCollapseStateInfo(body, collapsed) {
  if (!body) return;
  var owner = body.closest('section, .panel') || body.parentElement;
  var header = owner ? owner.querySelector('.rail-header, .panel-header') : null;
  if (!header) return;
  header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  var label = header.querySelector('[data-collapse-state-info]');
  if (!label) {
    label = document.createElement('span');
    label.setAttribute('data-collapse-state-info', 'true');
    label.className = 'collapse-state-info muted';
    var icon = header.querySelector('.collapse-icon');
    if (icon) header.insertBefore(label, icon);
    else header.appendChild(label);
  }
  label.textContent = collapsed ? 'Collapsed' : 'Expanded';
}

function annotateCollapseStates() {
  document.querySelectorAll('.collapsible-body').forEach(function (body) {
    updateCollapseStateInfo(body, body.classList.contains('collapsed'));
  });
  document.querySelectorAll('main details').forEach(function (details) {
    var summary = details.querySelector(':scope > summary');
    if (!summary) return;
    details.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    var label = summary.querySelector('[data-collapse-state-info]');
    if (!label) {
      label = document.createElement('span');
      label.setAttribute('data-collapse-state-info', 'true');
      label.className = 'collapse-state-info muted';
      summary.appendChild(label);
    }
    label.textContent = details.open ? 'Expanded' : 'Collapsed';
  });
  if (!document.documentElement.dataset.collapseStateListener) {
    document.documentElement.dataset.collapseStateListener = 'true';
    document.addEventListener('toggle', function (event) {
      var details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      var summary = details.querySelector(':scope > summary');
      var label = summary ? summary.querySelector('[data-collapse-state-info]') : null;
      details.setAttribute('aria-expanded', details.open ? 'true' : 'false');
      if (label) label.textContent = details.open ? 'Expanded' : 'Collapsed';
    }, true);
  }
}

export
  function safeRenderStep(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error('[dashboard-render]', name, error);
  }
}

export
  function dashboardLog(source, operation, detail, severity) {
  var entry = {
    type: 'log_entry',
    timestamp: new Date().toISOString(),
    source: source,
    operation: operation,
    severity: severity || 'info',
    summary: detail || operation
  };
  state.logEntries.push(entry);
  if (state.logEntries.length > 2000) state.logEntries = state.logEntries.slice(-2000);
  if (state.activeTab === 'logs') safeRenderStep('logsPanel', renderLogsPanel);
}

export function showTransientNotice(message, severity = 'info', timeout = 4000) {
  try {
    state.notice = { type: severity, message };
    // Notify any host renderer to update UI immediately
    try { document.dispatchEvent(new CustomEvent('prism:state-changed', { detail: { notice: state.notice } })); } catch (_) { }
  } catch (_) {
    state.notice = { type: severity, message };
  }
  setTimeout(() => {
    try {
      if (state.notice && state.notice.message === message) {
        state.notice = null;
        try { document.dispatchEvent(new CustomEvent('prism:state-changed', { detail: { notice: null } })); } catch (_) { }
      }
    } catch (_) { state.notice = null; }
  }, timeout);
}

export function trimAgenticEvent(ev, maxLen = 800) {
  if (!ev || typeof ev !== 'object') return ev;
  const out = { type: ev.type, timestamp: ev.timestamp || new Date().toISOString() };
  if (ev.toolCall) {
    out.toolCall = { name: ev.toolCall.name, arguments: ev.toolCall.arguments || {} };
    if (ev.toolCall.name) out.toolName = ev.toolCall.name;
  }
  if (ev.iteration != null) out.iteration = ev.iteration;
  if (typeof ev.text === 'string') {
    out.text = ev.text.length > maxLen ? ev.text.slice(0, maxLen) + '…' : ev.text;
  }
  if (ev.toolResult) {
    out.toolResult = { name: ev.toolResult.name || null, ok: ev.toolResult.ok };
    if (typeof ev.toolResult.output === 'string') out.toolResult.output = ev.toolResult.output.length > maxLen ? ev.toolResult.output.slice(0, maxLen) + '…' : ev.toolResult.output;
    else out.toolResult.output = ev.toolResult.output ? '[object]' : null;
  }
  return out;
}

/**
 * Run an async function while providing button feedback and transient notices.
 * @param {Element|string} btnEl - Button element or selector
 * @param {Function} fn - Async function to execute
 * @param {Object} opts - { pending, success, error }
 */
export async function withButtonFeedback(btnEl, fn, opts = {}) {
  const pendingMsg = opts.pending || 'Processing…';
  const successMsg = opts.success || 'Done';
  const errorMsg = opts.error || 'Failed';
  let el = null;
  try {
    if (typeof btnEl === 'string') el = document.querySelector(btnEl);
    else el = btnEl;
  } catch (_) { el = null; }

  const origDisabled = el ? el.disabled : null;
  try {
    if (el) { el.disabled = true; el.setAttribute('aria-busy', 'true'); }
    showTransientNotice(pendingMsg, 'info', opts.timeout || 10000);
    if (el && typeof showAnchoredToast === 'function') {
      try { showAnchoredToast(pendingMsg, el, 'info', opts.timeout || 10000); } catch (_) { }
    }
    const res = await fn();
    showTransientNotice(successMsg, 'success', 3000);
    return res;
  } catch (err) {
    showTransientNotice(errorMsg + ': ' + (err && err.message ? err.message : String(err)), 'error', 6000);
    throw err;
  } finally {
    if (el) { el.disabled = !!origDisabled; el.removeAttribute('aria-busy'); }
  }
}

// Simple toast manager (non-blocking) — anchors to element if provided
export function showAnchoredToast(message, el, severity = 'info', timeout = 4000) {
  try {
    const toast = document.createElement('div');
    toast.className = 'prism-toast prism-toast-' + severity;
    toast.style.position = 'absolute';
    toast.style.zIndex = 99999;
    toast.style.padding = '8px 12px';
    toast.style.borderRadius = '8px';
    toast.style.background = severity === 'error' ? '#ff7a7a' : severity === 'success' ? '#7ef0b5' : '#a78bfa';
    toast.style.color = '#07203a';
    toast.style.boxShadow = '0 8px 20px rgba(2,6,23,0.6)';
    toast.textContent = message;
    document.body.appendChild(toast);
    // Position near element
    const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (rect) {
      const top = rect.top + window.scrollY - toast.offsetHeight - 8;
      const left = Math.min(window.innerWidth - 220, Math.max(8, rect.left + window.scrollX + (rect.width / 2) - 110));
      toast.style.top = (top > 8 ? top : rect.top + window.scrollY + rect.height + 8) + 'px';
      toast.style.left = left + 'px';
    } else {
      toast.style.bottom = '18px';
      toast.style.right = '18px';
    }
    setTimeout(() => { try { toast.remove(); } catch (_) { } }, timeout);
  } catch (_) { /* best-effort */ }
}

export
  function renderLogsPanel() {
  var body = document.getElementById('logs-panel-body');
  if (!body) return;
  var entries = state.logEntries;
  var tf = state.logFilter;
  if (tf.tab) entries = entries.filter(function (e) { return e.source === tf.tab; });
  if (tf.severity) entries = entries.filter(function (e) { return e.severity === tf.severity; });
  if (entries.length === 0) {
    body.innerHTML = '<div class="log-empty">No log entries' + (tf.tab || tf.severity ? ' matching filter' : '') + '.</div>';
    return;
  }
  var html = '';
  var shown = entries.slice(-500);
  for (var i = 0; i < shown.length; i++) {
    var e = shown[i];
    var ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
    var srcCls = 'log-src log-src-' + (e.source || 'system');
    var sevCls = 'log-sev log-sev-' + (e.severity || 'info');
    html += '<div class="log-line">';
    html += '<span class="log-ts">' + escapeHtml(ts) + '</span>';
    html += '<span class="' + srcCls + '">' + escapeHtml(e.source || 'system') + '</span>';
    html += '<span class="' + sevCls + '">' + escapeHtml(e.severity || 'info') + '</span>';
    html += '<span class="log-msg">' + escapeHtml(e.summary || e.operation || '') + '</span>';
    html += '</div>';
  }
  body.innerHTML = html;
  if (state.logsAutoScroll) {
    body.scrollTop = body.scrollHeight;
  }
}

export
  function filterLogs() {
  var tabSel = document.getElementById('logs-tab-filter');
  var sevSel = document.getElementById('logs-severity-filter');
  state.logFilter.tab = tabSel ? tabSel.value : '';
  state.logFilter.severity = sevSel ? sevSel.value : '';
  renderLogsPanel();
}

export
  function clearLogs() {
  state.logEntries = [];
  renderLogsPanel();
}

export
  /* ═══ Tools & Plugins — shared helpers ═══ */
  function getToolState(name) {
  if (!state.toolStates[name]) state.toolStates[name] = { enabled: true, invocations: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastInvoked: null, lastError: null };
  return state.toolStates[name];
}

export function getPluginState(name) {
  if (!state.pluginStates[name]) state.pluginStates[name] = { enabled: true, healthy: true, requests: 0, errors: 0, avgResponseMs: 0, uptime: 100, lastChecked: null };
  return state.pluginStates[name];
}

export function getUtilityState(name) {
  if (!state.utilityStates[name]) state.utilityStates[name] = { lastRun: null, lastDurationMs: 0, lastResult: null, runCount: 0 };
  return state.utilityStates[name];
}

export function getReview(store, name) {
  if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
  return store[name];
}

export
  function setItemRating(kind, name, rating) {
  var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
  if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
  store[name].rating = rating;
  store[name].lastReviewed = new Date().toISOString();
  render();
}

export function setItemApproval(kind, name, approval) {
  var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
  if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
  store[name].approval = approval;
  store[name].lastReviewed = new Date().toISOString();
  render();
}

export function saveItemNotes(kind, name) {
  var el = document.getElementById('review-notes-' + kind + '-' + name.replace(/[^a-zA-Z0-9]/g, '_'));
  if (!el) return;
  var store = kind === 'tool' ? state.toolReviews : kind === 'plugin' ? state.pluginReviews : state.utilityReviews;
  if (!store[name]) store[name] = { rating: 0, notes: '', approval: 'review', lastReviewed: null };
  store[name].notes = el.value;
  store[name].lastReviewed = new Date().toISOString();
}

export function toggleItemExpand(kind, name) {
  var field = kind === 'tool' ? 'expandedToolId' : kind === 'plugin' ? 'expandedPluginId' : kind === 'skill' ? 'expandedSkillId' : kind === 'addon' ? 'expandedAddonId' : 'expandedUtilityId';
  state[field] = state[field] === name ? null : name;
  render();
}

export function toggleItemEnabled(kind, name) {
  var stateStore = kind === 'tool' ? state.toolStates : kind === 'plugin' ? state.pluginStates : state.utilityStates;
  if (!stateStore[name]) {
    if (kind === 'tool') getToolState(name);
    else if (kind === 'plugin') getPluginState(name);
    else getUtilityState(name);
  }
  stateStore[name].enabled = !stateStore[name].enabled;
  var endpoint = kind === 'plugin'
    ? '/api/v1/plugins/' + encodeURIComponent(name) + '/toggle'
    : '/api/v1/tools/' + encodeURIComponent(name) + '/toggle';
  fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: stateStore[name].enabled }) }).catch(function () { });
  render();
}

export
  function toCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

window.openLocalPath = async function (path) {
  try {
    const result = await request('/api/workspace/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path })
    });
    if (result.error) {
      alert('Failed to open path: ' + result.error);
    }
  } catch (err) {
    alert('Error opening path: ' + String(err));
  }
};

export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prism-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8, 8, 16, 0.7);backdrop-filter:blur(8px);z-index:100000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease;padding:20px;box-sizing:border-box;';

    const container = document.createElement('div');
    container.className = 'prism-confirm-modal';
    container.style.cssText = 'background:rgba(22, 22, 34, 0.95);border:1px solid rgba(139, 92, 246, 0.35);border-radius:12px;box-shadow:0 8px 32px rgba(0, 0, 0, 0.5);width:100%;max-width:420px;padding:24px;color:#e2e8f0;font-family:system-ui, -apple-system, sans-serif;transform:scale(0.9);transition:transform 0.2s ease;box-sizing:border-box;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
    header.innerHTML = `
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(139, 92, 246, 0.15);display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:18px;font-weight:bold;flex-shrink:0;">❓</div>
      <div style="font-size:16px;font-weight:600;color:#ffffff;line-height:1.2;">PRISM Confirmation</div>
    `;
    container.appendChild(header);

    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:14px;color:#94a3b8;line-height:1.5;margin-bottom:24px;white-space:pre-wrap;word-break:break-word;';
    msgEl.textContent = message;
    container.appendChild(msgEl);

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;border-radius:6px;background:transparent;border:1px solid rgba(148, 163, 184, 0.3);color:#e2e8f0;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s ease;outline:none;';
    cancelBtn.onmouseenter = () => { cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)'; };
    cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'transparent'; };

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = 'padding:8px 16px;border-radius:6px;background:#6d28d9;border:1px solid #7c3aed;color:#ffffff;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.15s ease;outline:none;box-shadow:0 2px 4px rgba(109, 40, 217, 0.3);';
    confirmBtn.onmouseenter = () => { confirmBtn.style.background = '#7c3aed'; };
    confirmBtn.onmouseleave = () => { confirmBtn.style.background = '#6d28d9'; };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    container.appendChild(btnContainer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      container.style.transform = 'scale(1)';
    });

    const cleanup = (value) => {
      overlay.style.opacity = '0';
      container.style.transform = 'scale(0.9)';
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(value);
      }, 200);
    };

    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        document.removeEventListener('keydown', handleKeydown);
        cleanup(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        document.removeEventListener('keydown', handleKeydown);
        cleanup(true);
      }
    };
    document.addEventListener('keydown', handleKeydown);
  });
}

window.showConfirm = showConfirm;


/**
 * Premium text-input modal — a styled replacement for the native `prompt()`.
 * Resolves with the trimmed string, or null if the user cancels.
 *
 * @param {string} message   Prompt label/question.
 * @param {object} [opts]
 * @param {string} [opts.defaultValue]  Prefilled value.
 * @param {string} [opts.placeholder]   Input placeholder.
 * @param {string} [opts.confirmLabel]  Confirm button text (default "OK").
 * @param {string} [opts.icon]          Header icon (default "✏️").
 * @returns {Promise<string|null>}
 */
export function showPrompt(message, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prism-prompt-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8, 8, 16, 0.7);backdrop-filter:blur(8px);z-index:100000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease;padding:20px;box-sizing:border-box;';

    const container = document.createElement('div');
    container.className = 'prism-prompt-modal';
    container.style.cssText = 'background:rgba(22, 22, 34, 0.95);border:1px solid rgba(139, 92, 246, 0.35);border-radius:12px;box-shadow:0 8px 32px rgba(0, 0, 0, 0.5);width:100%;max-width:460px;padding:24px;color:#e2e8f0;font-family:system-ui, -apple-system, sans-serif;transform:scale(0.9);transition:transform 0.2s ease;box-sizing:border-box;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(139, 92, 246, 0.15);display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:18px;flex-shrink:0;';
    iconEl.textContent = opts.icon || '✏️';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:15px;font-weight:600;color:#ffffff;line-height:1.3;white-space:pre-wrap;';
    titleEl.textContent = message;
    header.appendChild(iconEl);
    header.appendChild(titleEl);
    container.appendChild(header);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = opts.defaultValue || '';
    input.placeholder = opts.placeholder || '';
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:6px;background:rgba(8, 8, 16, 0.6);border:1px solid rgba(148, 163, 184, 0.3);color:#e2e8f0;font-size:14px;margin-bottom:24px;outline:none;';
    input.onfocus = () => { input.style.borderColor = 'rgba(139, 92, 246, 0.6)'; };
    input.onblur = () => { input.style.borderColor = 'rgba(148, 163, 184, 0.3)'; };
    container.appendChild(input);

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;border-radius:6px;background:transparent;border:1px solid rgba(148, 163, 184, 0.3);color:#e2e8f0;font-size:13px;font-weight:500;cursor:pointer;outline:none;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = opts.confirmLabel || 'OK';
    confirmBtn.style.cssText = 'padding:8px 16px;border-radius:6px;background:#6d28d9;border:1px solid #7c3aed;color:#ffffff;font-size:13px;font-weight:500;cursor:pointer;outline:none;box-shadow:0 2px 4px rgba(109, 40, 217, 0.3);';
    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    container.appendChild(btnContainer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      container.style.transform = 'scale(1)';
      input.focus();
      input.select();
    });

    const cleanup = (value) => {
      overlay.style.opacity = '0';
      container.style.transform = 'scale(0.9)';
      document.removeEventListener('keydown', handleKeydown);
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }, 200);
    };

    confirmBtn.onclick = () => { const v = input.value.trim(); cleanup(v === '' ? null : v); };
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    const handleKeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      else if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); cleanup(v === '' ? null : v); }
    };
    document.addEventListener('keydown', handleKeydown);
  });
}

window.showPrompt = showPrompt;


/**
 * Premium single-choice selection modal — a styled replacement for numbered
 * `prompt()` menus. Resolves with the chosen option's `value`, or null on cancel.
 *
 * @param {string} message  Prompt label/question.
 * @param {Array<{value:string,label:string,description?:string}>} options
 * @param {object} [opts]
 * @param {string} [opts.icon]  Header icon (default "📋").
 * @returns {Promise<string|null>}
 */
export function showSelect(message, options, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prism-select-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8, 8, 16, 0.7);backdrop-filter:blur(8px);z-index:100000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease;padding:20px;box-sizing:border-box;';

    const container = document.createElement('div');
    container.className = 'prism-select-modal';
    container.style.cssText = 'background:rgba(22, 22, 34, 0.95);border:1px solid rgba(139, 92, 246, 0.35);border-radius:12px;box-shadow:0 8px 32px rgba(0, 0, 0, 0.5);width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;padding:24px;color:#e2e8f0;font-family:system-ui, -apple-system, sans-serif;transform:scale(0.9);transition:transform 0.2s ease;box-sizing:border-box;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-shrink:0;';
    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(139, 92, 246, 0.15);display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:18px;flex-shrink:0;';
    iconEl.textContent = opts.icon || '📋';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:15px;font-weight:600;color:#ffffff;line-height:1.3;';
    titleEl.textContent = message;
    header.appendChild(iconEl);
    header.appendChild(titleEl);
    container.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;overflow:auto;margin-bottom:20px;';
    (options || []).forEach((opt) => {
      const row = document.createElement('button');
      row.style.cssText = 'text-align:left;padding:10px 12px;border-radius:8px;background:rgba(8, 8, 16, 0.4);border:1px solid rgba(148, 163, 184, 0.2);color:#e2e8f0;cursor:pointer;transition:all 0.15s ease;outline:none;';
      row.onmouseenter = () => { row.style.background = 'rgba(139, 92, 246, 0.15)'; row.style.borderColor = 'rgba(139, 92, 246, 0.5)'; };
      row.onmouseleave = () => { row.style.background = 'rgba(8, 8, 16, 0.4)'; row.style.borderColor = 'rgba(148, 163, 184, 0.2)'; };
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:13px;font-weight:600;';
      labelEl.textContent = opt.label;
      row.appendChild(labelEl);
      if (opt.description) {
        const descEl = document.createElement('div');
        descEl.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:2px;';
        descEl.textContent = opt.description;
        row.appendChild(descEl);
      }
      row.onclick = () => cleanup(opt.value);
      list.appendChild(row);
    });
    container.appendChild(list);

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;justify-content:flex-end;flex-shrink:0;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;border-radius:6px;background:transparent;border:1px solid rgba(148, 163, 184, 0.3);color:#e2e8f0;font-size:13px;font-weight:500;cursor:pointer;outline:none;';
    btnContainer.appendChild(cancelBtn);
    container.appendChild(btnContainer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      container.style.transform = 'scale(1)';
    });

    const cleanup = (value) => {
      overlay.style.opacity = '0';
      container.style.transform = 'scale(0.9)';
      document.removeEventListener('keydown', handleKeydown);
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }, 200);
    };

    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    const handleKeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(null); } };
    document.addEventListener('keydown', handleKeydown);
  });
}

window.showSelect = showSelect;


/**
 * Premium multi-field form modal — replaces chains of `prompt()` calls.
 * Resolves with an object keyed by field `name`, or null on cancel.
 *
 * @param {string} title  Modal heading.
 * @param {Array<{name:string, label:string, type?:'text'|'textarea'|'email', placeholder?:string, defaultValue?:string, required?:boolean, description?:string}>} fields
 * @param {object} [opts]
 * @param {string} [opts.confirmLabel]  Confirm button text (default "Save").
 * @param {string} [opts.icon]          Header icon (default "📝").
 * @returns {Promise<Record<string,string>|null>}
 */
export function showForm(title, fields, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prism-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8, 8, 16, 0.7);backdrop-filter:blur(8px);z-index:100000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease;padding:20px;box-sizing:border-box;';

    const container = document.createElement('div');
    container.className = 'prism-form-modal';
    container.style.cssText = 'background:rgba(22, 22, 34, 0.97);border:1px solid rgba(139, 92, 246, 0.35);border-radius:12px;box-shadow:0 8px 40px rgba(0, 0, 0, 0.6);width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;color:#e2e8f0;font-family:system-ui, -apple-system, sans-serif;transform:scale(0.92);transition:transform 0.2s ease;box-sizing:border-box;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(139, 92, 246, 0.15);display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:18px;flex-shrink:0;';
    iconEl.textContent = opts.icon || '📝';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:16px;font-weight:700;color:#ffffff;';
    titleEl.textContent = title;
    header.appendChild(iconEl);
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'margin-left:auto;background:none;border:none;color:#94a3b8;font-size:16px;cursor:pointer;padding:4px 8px;border-radius:4px;flex-shrink:0;';
    closeBtn.onclick = () => cleanup(null);
    header.appendChild(closeBtn);
    container.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:20px 24px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;flex:1;';

    const inputRefs = {};
    (fields || []).forEach((field) => {
      const fieldWrapper = document.createElement('div');
      const labelEl = document.createElement('label');
      labelEl.style.cssText = 'display:block;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:5px;';
      labelEl.textContent = field.label + (field.required ? ' *' : '');
      fieldWrapper.appendChild(labelEl);
      if (field.description) {
        const descEl = document.createElement('div');
        descEl.style.cssText = 'font-size:11px;color:#64748b;margin-bottom:5px;';
        descEl.textContent = field.description;
        fieldWrapper.appendChild(descEl);
      }
      const inputStyle = 'width:100%;box-sizing:border-box;padding:9px 12px;border-radius:6px;background:rgba(8, 8, 16, 0.5);border:1px solid rgba(148, 163, 184, 0.25);color:#e2e8f0;font-size:13px;font-family:inherit;outline:none;resize:vertical;';
      let input;
      if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 3;
      } else {
        input = document.createElement('input');
        input.type = field.type || 'text';
      }
      input.value = field.defaultValue || '';
      input.placeholder = field.placeholder || '';
      input.style.cssText = inputStyle;
      input.onfocus = () => { input.style.borderColor = 'rgba(139, 92, 246, 0.6)'; };
      input.onblur = () => { input.style.borderColor = 'rgba(148, 163, 184, 0.25)'; };
      inputRefs[field.name] = input;
      fieldWrapper.appendChild(input);
      body.appendChild(fieldWrapper);
    });
    container.appendChild(body);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:9px 18px;border-radius:6px;background:transparent;border:1px solid rgba(148, 163, 184, 0.3);color:#e2e8f0;font-size:13px;font-weight:500;cursor:pointer;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = opts.confirmLabel || 'Save';
    confirmBtn.style.cssText = 'padding:9px 18px;border-radius:6px;background:#6d28d9;border:1px solid #7c3aed;color:#ffffff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(109, 40, 217, 0.3);';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    container.appendChild(footer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      container.style.transform = 'scale(1)';
      const first = Object.values(inputRefs)[0];
      if (first) first.focus();
    });

    const cleanup = (value) => {
      overlay.style.opacity = '0';
      container.style.transform = 'scale(0.92)';
      document.removeEventListener('keydown', handleKeydown);
      setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(value); }, 200);
    };

    const submit = () => {
      for (const field of (fields || [])) {
        if (field.required && !inputRefs[field.name].value.trim()) {
          inputRefs[field.name].style.borderColor = 'rgba(239, 68, 68, 0.7)';
          inputRefs[field.name].focus();
          return;
        }
      }
      const result = {};
      for (const field of (fields || [])) { result[field.name] = inputRefs[field.name].value.trim(); }
      cleanup(result);
    };

    confirmBtn.onclick = submit;
    cancelBtn.onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    const handleKeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };
    document.addEventListener('keydown', handleKeydown);
  });
}

window.showForm = showForm;

