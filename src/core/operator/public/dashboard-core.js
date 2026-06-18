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
  sessionProviderCollapsed: false,
  providerConfigCollapsed: true,
  modelMatrixCollapsed: false,
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
  settingsPanelCollapsed: false,
  llmAuditCollapsed: false,
  toolsPanelCollapsed: true,
  pluginsPanelCollapsed: true,
  utilitiesPanelCollapsed: true,
  networkToolsCollapsed: false,
  networkSettingsCollapsed: false,
  networkTelemetryCollapsed: false,
  networkConsoleCollapsed: false,
  networkCommandHistory: [],
  networkTelemetryData: { totalCommands: 0, tier1Count: 0, tier2Count: 0, tier3Count: 0, lastCommand: null, errorCount: 0 },
  vrgcAvailable: false,
  agentMgmtCollapsed: false,
  subAgentCollapsed: false,
  swarmControlCollapsed: false,
  agentTelemetryCollapsed: false,
  localControlCollapsed: false,
  consoleViewCollapsed: false,
  computerConfigCollapsed: false,
  policyControlCollapsed: false,
  browserControlCollapsed: false,
  deviceManagerCollapsed: false,
  characterPanelCollapsed: false,
  workspaceLocationCollapsed: false,
  workspaceFilesCollapsed: false,
  importManagerCollapsed: false,
  workspaceSettingsCollapsed: false,
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
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'logs', label: 'Logs & Debug' },
  { id: 'scheduler', label: 'Scheduler' },
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
  // Dispatch custom event so tab-tools can refresh summary badges
  try { document.dispatchEvent(new CustomEvent('panel-collapse-toggle', { detail: { panelKey: panelKey, collapsed: state[stateKey] } })); } catch (_) { }
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
  var field = kind === 'tool' ? 'expandedToolId' : kind === 'plugin' ? 'expandedPluginId' : kind === 'skill' ? 'expandedSkillId' : 'expandedUtilityId';
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

