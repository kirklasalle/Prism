import { state, request, escapeHtml, healthDot, timeAgo, renderStars, approvalBadge, getToolState, getPluginState, getUtilityState, getReview, setItemRating, setItemApproval, saveItemNotes, toggleItemExpand, toggleItemEnabled, dashboardLog, formatUptime } from './dashboard-core.js';

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

export 
/* ═══ Overview Bar ═══ */
function renderToolsOverviewBar() {
var bar = document.getElementById('tools-overview-bar');
if (!bar) return;
var totalTools = Math.max(19, Object.keys(state.toolStates || {}).length);
var totalPlugins = Math.max(7, Object.keys(state.pluginStates || {}).length);
var enabledTools = 0;
var healthyPlugins = 0;
var totalUtils = 30;
enabledTools = totalTools - Object.keys(state.toolStates || {}).filter(function(k) { return !state.toolStates[k].enabled; }).length;
healthyPlugins = totalPlugins - Object.keys(state.pluginStates || {}).filter(function(k) { return !state.pluginStates[k].healthy; }).length;

var html = '<div class="tp-overview-bar">';
html += '<span class="tp-status-dot green"></span>';
html += '<span class="tp-overview-stat">' + enabledTools + '/' + totalTools + ' tools <span class="muted">enabled</span></span>';
html += '<span style="color:var(--muted);">\u2502</span>';
html += '<span class="tp-overview-stat">' + healthyPlugins + '/' + totalPlugins + ' plugins <span class="muted">healthy</span></span>';
html += '<span style="color:var(--muted);">\u2502</span>';
html += '<span class="tp-overview-stat">' + totalUtils + ' <span class="muted">utilities</span></span>';
html += '<span style="flex:1;"></span>';
html += '<input class="tp-filter-input" type="text" placeholder="\uD83D\uDD0D Filter by name..." value="' + escapeHtml(state.toolsFilterText) + '" oninput="updateToolsFilter(this.value)">';
html += '</div>';
bar.innerHTML = html;
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
var observedToolNames = Object.keys(state.toolStates || {}).filter(function(name) {
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
var html = '<div class="muted" style="margin-bottom:8px;">'
+ tools.length + ' tools registered across ' + categories.length + ' categories.</div>';

for (var c = 0; c < categories.length; c++) {
var cat = categories[c];
var catTools = tools.filter(function(t) { return t.cat === cat && (!filter || t.name.toLowerCase().indexOf(filter) !== -1 || t.desc.toLowerCase().indexOf(filter) !== -1); });
if (!catTools.length) continue;
html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catTools.length + ')</span></div>';
for (var i = 0; i < catTools.length; i++) {
  var t = catTools[i];
  var ts = getToolState(t.name);
  var rv = getReview(state.toolReviews, t.name);
  var isExpanded = state.expandedToolId === t.name;
  var safeId = t.name.replace(/[^a-zA-Z0-9]/g, '_');

  html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

  /* ── collapsed header ── */
  html += '<div class="tp-card-head" onclick="toggleItemExpand(\'tool\', \'' + escapeHtml(t.name) + '\')" data-tooltip="Category: ' + escapeHtml(t.cat) + ' | Risk: ' + escapeHtml(t.risk) + ' | ' + (t.mut ? 'Mutating' : 'Read-only') + '\\n' + escapeHtml(t.desc) + '">';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span class="tp-card-name">' + escapeHtml(t.name) + '</span>';
  html += healthDot(ts.enabled);
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
}).then(function() {
var form = document.getElementById('register-tool-form');
if (form) form.remove();
}).catch(function(e) { alert('Registration failed: ' + e.message); });
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

var html = '<div class="muted" style="margin-bottom:8px;">'
+ plugins.length + ' MCP plugins registered across ' + groups.length + ' sources.</div>';

for (var g = 0; g < groups.length; g++) {
var grp = groups[g];
var grpPlugins = plugins.filter(function(p) { return p.group === grp && (!filter || p.name.toLowerCase().indexOf(filter) !== -1 || p.desc.toLowerCase().indexOf(filter) !== -1); });
if (!grpPlugins.length) continue;
html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (groupIcon[grp] || '') + ' ' + escapeHtml(grp) + ' <span class="muted">(' + grpPlugins.length + ')</span></div>';
for (var i = 0; i < grpPlugins.length; i++) {
  var p = grpPlugins[i];
  var ps = getPluginState(p.name);
  var rv = getReview(state.pluginReviews, p.name);
  var isExpanded = state.expandedPluginId === p.name;
  var safeId = p.name.replace(/[^a-zA-Z0-9]/g, '_');

  html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

  /* ── collapsed header ── */
  html += '<div class="tp-card-head" onclick="toggleItemExpand(\'plugin\', \'' + escapeHtml(p.name) + '\')" data-tooltip="Group: ' + escapeHtml(p.group) + ' | Type: ' + escapeHtml(p.type) + '\\nStatus: ' + escapeHtml(p.status) + ' | Trust: ' + escapeHtml(p.trust) + '\\nPort: ' + p.port + '">';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span class="tp-card-name">' + escapeHtml(p.name) + '</span>';
  html += healthDot(ps.healthy);
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
}).then(function() {
var form = document.getElementById('install-plugin-form');
if (form) form.remove();
}).catch(function(e) { alert('Installation failed: ' + e.message); });
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

var html = '<div class="muted" style="margin-bottom:8px;">'
+ utils.length + ' utilities registered across ' + categories.length + ' categories.</div>';

for (var c = 0; c < categories.length; c++) {
var cat = categories[c];
var catUtils = utils.filter(function(u) { return u.cat === cat && (!filter || u.name.toLowerCase().indexOf(filter) !== -1 || u.desc.toLowerCase().indexOf(filter) !== -1); });
if (!catUtils.length) continue;
html += '<div style="margin-top:12px;margin-bottom:6px;font-size:12px;font-weight:600;color:var(--fg);">' + (catIcon[cat] || '') + ' ' + escapeHtml(cat) + ' <span class="muted">(' + catUtils.length + ')</span></div>';
for (var i = 0; i < catUtils.length; i++) {
  var u = catUtils[i];
  var us = getUtilityState(u.name);
  var rv = getReview(state.utilityReviews, u.name);
  var isExpanded = state.expandedUtilityId === u.name;
  var safeId = u.name.replace(/[^a-zA-Z0-9]/g, '_');

  html += '<div class="tp-card' + (isExpanded ? ' tp-expanded' : '') + '">';

  /* ── collapsed header ── */
  html += '<div class="tp-card-head" onclick="toggleItemExpand(\'utility\', \'' + escapeHtml(u.name) + '\')" data-tooltip="Category: ' + escapeHtml(u.cat) + '\\n' + escapeHtml(u.desc) + (us.lastRun ? '\\nLast run: ' + timeAgo(us.lastRun) : '') + '">';
  html += '<div style="flex:1;min-width:0;">';
  html += '<span class="tp-card-name">' + escapeHtml(u.name) + '</span>';
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
