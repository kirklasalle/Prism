import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';

export 
// ── Agentic Control Tab Renderers ──────────────────────────────────

function renderAgentList() {
var container = document.getElementById('agent-list-container');
if (!container) return;
var d = state.agentData;
if (!d || !d.agents || d.agents.length === 0) {
container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">No agents running. Launch an agent to get started.</div>';
return;
}
var html = '';
for (var i = 0; i < d.agents.length; i++) {
var a = d.agents[i];
var statusColor = a.status === 'running' ? '#7ecf7e' : (a.status === 'error' ? '#ff8d8d' : '#ffd17a');
html += '<div class="panel" style="padding:12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">';
html += '<div><span style="color:' + statusColor + ';font-weight:700;margin-right:8px;">\u25CF</span>';
html += '<strong>' + escapeHtml(a.name || a.id) + '</strong>';
html += ' <span class="muted" style="font-size:11px;">' + escapeHtml(a.role || 'general') + '</span></div>';
html += '<div style="display:flex;gap:6px;align-items:center;">';
html += '<span class="muted" style="font-size:11px;">' + (a.tasksCompleted || 0) + ' tasks</span>';
html += '<button class="primary-button" style="font-size:11px;padding:3px 10px;" onclick="stopAgent(\'' + escapeHtml(a.id) + '\')">\u23F9 Stop</button>';
html += '<button class="secondary-button" style="font-size:11px;padding:3px 10px;" onclick="promoteAgent(\'' + escapeHtml(a.id) + '\')">\u2B06 Promote</button>';
html += '<button class="secondary-button" style="font-size:11px;padding:3px 10px;" onclick="demoteAgent(\'' + escapeHtml(a.id) + '\')">\u2B07 Demote</button>';
html += '</div></div>';
}
container.innerHTML = html;
}

export 
function renderSubAgentTree() {
var container = document.getElementById('sub-agent-tree-container');
if (!container) return;
var d = state.agentData;
if (!d || !d.agents || d.agents.length === 0) {
container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">Agent hierarchy will appear here when agents are active.</div>';
return;
}
var html = '<div style="font-family:monospace;font-size:12px;line-height:1.8;">';
html += '<div style="font-weight:700;color:var(--accent);">\u{1F3E0} Orchestrator (root)</div>';
for (var i = 0; i < d.agents.length; i++) {
var a = d.agents[i];
var last = i === d.agents.length - 1;
html += '<div style="padding-left:20px;">' + (last ? '\u2514' : '\u251C') + '\u2500 ';
html += '<span style="color:var(--fg);">' + escapeHtml(a.name || a.id) + '</span>';
html += ' <span class="muted">(' + escapeHtml(a.role || 'general') + ')</span></div>';
}
html += '</div>';
container.innerHTML = html;
}

export 
function renderSwarmTopology() {
var container = document.getElementById('swarm-topology-container');
if (!container) return;
var d = state.agentData;
if (!d || !d.swarms || d.swarms.length === 0) {
container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">No swarms configured. Create a swarm to begin orchestration.</div>';
return;
}
var html = '';
for (var i = 0; i < d.swarms.length; i++) {
var sw = d.swarms[i];
html += '<div class="panel" style="padding:12px;margin-bottom:6px;">';
html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
html += '<strong>' + escapeHtml(sw.name || sw.id) + '</strong>';
html += '<span class="muted" style="font-size:11px;">' + escapeHtml(sw.topology || 'mesh') + ' \u00B7 ' + (sw.agentCount || 0) + ' agents</span>';
html += '</div>';
html += '<div class="muted" style="font-size:11px;margin-top:4px;">Status: ' + escapeHtml(sw.status || 'unknown') + '</div>';
html += '</div>';
}
container.innerHTML = html;
}

export 
function renderAgentTelemetry() {
var container = document.getElementById('agent-telemetry-container');
if (!container) return;
var d = state.agentData;
var t = d ? d.telemetry : null;
var active = t ? t.activeAgents : 0;
var completed = t ? t.tasksCompleted : 0;
var failed = t ? t.tasksFailed : 0;
var errorRate = (completed + failed) > 0 ? Math.round(failed / (completed + failed) * 100) : 0;
var avgResp = t && t.avgResponseMs > 0 ? t.avgResponseMs + 'ms' : '\u2014';
var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">';
html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Active Agents</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + active + '</div></div>';
html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Tasks Completed</div><div style="font-size:24px;font-weight:700;color:#7ecf7e;">' + completed + '</div></div>';
html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Error Rate</div><div style="font-size:24px;font-weight:700;color:' + (errorRate > 10 ? '#ff8d8d' : 'var(--accent)') + ';">' + errorRate + '%</div></div>';
html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Avg Response</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + escapeHtml(avgResp) + '</div></div>';
html += '<div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Total Dispatches</div><div style="font-size:24px;font-weight:700;color:var(--accent);">' + (t ? t.totalDispatches : 0) + '</div></div>';
html += '</div>';
container.innerHTML = html;
}

export 
async function refreshAgentList() {
try {
state.agentData = await request('/api/agents');
render();
} catch (e) { console.error('[agentic] refresh failed', e); }
}

export 
async function launchNewAgent() {
var name = prompt('Agent name (optional):');
var role = prompt('Agent role (e.g. general, researcher, coder):');
try {
await request('/api/agents/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || undefined, role: role || undefined }) });
await refreshAgentList();
} catch (e) { console.error('[agentic] launch failed', e); }
}

export 
async function stopAgent(agentId) {
try {
await request('/api/agents/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agentId }) });
await refreshAgentList();
} catch (e) { console.error('[agentic] stop failed', e); }
}

export 
async function promoteAgent(agentId) {
try {
const result = await request('/api/agents/' + encodeURIComponent(agentId) + '/promote', { method: 'POST' });
state.agentData = result || state.agentData;
await refreshAgentList();
} catch (e) { console.error('[agentic] promote failed', e); }
}

export 
async function demoteAgent(agentId) {
try {
const result = await request('/api/agents/' + encodeURIComponent(agentId) + '/demote', { method: 'POST' });
state.agentData = result || state.agentData;
await refreshAgentList();
} catch (e) { console.error('[agentic] demote failed', e); }
}

export 
async function createSwarm() {
var name = prompt('Swarm name (optional):');
var topology = prompt('Topology (mesh / star / pipeline):') || 'mesh';
var count = parseInt(prompt('Number of agents:') || '3', 10);
try {
await request('/api/swarms/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || undefined, topology: topology, agentCount: count }) });
await refreshAgentList();
} catch (e) { console.error('[agentic] swarm create failed', e); }
}

export 
async function refreshSwarmStatus() {
await refreshAgentList();
}

export 
async function initAgenticTab() {
if (!state.agentData) await refreshAgentList();
}
