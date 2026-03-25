import { state, request, escapeHtml, dashboardLog, safeRenderStep, metricRow } from './dashboard-core.js';

export 
// ── Network Tab Panel Renderers ──────────────────────────────────────

function renderNetworkToolsPanel() {
const container = document.getElementById('network-tools-panel');
if (!container) return;

const commands = [
{ tier: 'tier1', category: 'Diagnostics (Read-Only)', items: [
  { name: 'ipconfig / ifconfig', desc: 'Display network interface configuration', platform: 'cross' },
  { name: 'ping', desc: 'Test host reachability and measure round-trip time', platform: 'cross' },
  { name: 'nslookup / dig', desc: 'DNS resolution lookup', platform: 'cross' },
  { name: 'tracert / traceroute', desc: 'Trace route to destination host', platform: 'cross' },
  { name: 'netstat / ss', desc: 'Display active connections and listening ports', platform: 'cross' },
  { name: 'arp', desc: 'Display and manage the ARP cache', platform: 'cross' },
  { name: 'hostname', desc: 'Display system hostname', platform: 'cross' },
  { name: 'nbtstat', desc: 'NetBIOS over TCP/IP statistics', platform: 'win' },
  { name: 'pathping', desc: 'Combined ping and tracert analysis', platform: 'win' },
  { name: 'getmac', desc: 'Display MAC addresses for all interfaces', platform: 'win' },
  { name: 'net view', desc: 'List shared resources visible on the network', platform: 'win' },
  { name: 'net statistics', desc: 'Display network workstation/server statistics', platform: 'win' },
  { name: 'curl / wget', desc: 'HTTP data transfer / file download', platform: 'cross' },
  { name: 'ip addr / ip route', desc: 'IP address and routing (iproute2)', platform: 'linux' },
]},
{ tier: 'tier2', category: 'Config Inspection (Conditional)', items: [
  { name: 'route print', desc: 'Display the IP routing table', platform: 'win' },
  { name: 'netsh interface show', desc: 'Show network interface details', platform: 'win' },
  { name: 'netsh wlan show', desc: 'Show wireless network profiles and info', platform: 'win' },
  { name: 'netsh firewall show', desc: 'Show firewall configuration', platform: 'win' },
  { name: 'netsh advfirewall show', desc: 'Show advanced firewall configuration', platform: 'win' },
  { name: 'net use', desc: 'Map or manage network drives', platform: 'win' },
  { name: 'net share', desc: 'View or manage shared folders', platform: 'win' },
  { name: 'net session', desc: 'Display active network sessions', platform: 'win' },
  { name: 'net user', desc: 'View user accounts', platform: 'win' },
  { name: 'net localgroup', desc: 'View local group memberships', platform: 'win' },
  { name: 'net config', desc: 'Display workstation or server configuration', platform: 'win' },
]},
{ tier: 'tier3', category: 'Mutating Operations (Approval-Gated)', items: [
  { name: 'netsh interface set', desc: 'Modify network interface settings', platform: 'win' },
  { name: 'netsh interface ip set', desc: 'Set IP/DHCP/DNS configuration', platform: 'win' },
  { name: 'netsh firewall set', desc: 'Modify firewall rules', platform: 'win' },
  { name: 'netsh wlan connect/disconnect', desc: 'Wi-Fi connection management', platform: 'win' },
  { name: 'route add / delete / change', desc: 'Modify the routing table', platform: 'cross' },
  { name: 'net start / stop', desc: 'Start or stop network services', platform: 'win' },
  { name: 'ip addr add/del', desc: 'Add or remove IP addresses', platform: 'linux' },
  { name: 'ip route add/del', desc: 'Add or remove routes', platform: 'linux' },
  { name: 'iptables / ufw', desc: 'Linux firewall management', platform: 'linux' },
]}
];

const tierColors = { tier1: '#2ecc71', tier2: '#f39c12', tier3: '#e74c3c' };
const tierLabels = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3' };
const platformBadge = function(p) {
if (p === 'win') return '<span style="background:#0078d4;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">WIN</span>';
if (p === 'linux') return '<span style="background:#e95420;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">LINUX</span>';
return '<span style="background:#6c757d;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:6px;">CROSS</span>';
};

var html = '<p class="muted" style="margin:0 0 10px 0;font-size:12px;">Curated network command allowlist with tier-based governance. Commands are validated against an allowlist before execution.</p>';

commands.forEach(function(group) {
html += '<div style="margin-bottom:12px;">'
  + '<h4 style="margin:0 0 6px 0;font-size:13px;">'
  + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + tierColors[group.tier] + ';margin-right:6px;"></span>'
  + tierLabels[group.tier] + ' \u2014 ' + escapeHtml(group.category)
  + ' <span class="muted">(' + group.items.length + ')</span></h4>'
  + '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>';
group.items.forEach(function(item) {
  html += '<tr style="border-bottom:1px solid var(--border);">'
    + '<td style="padding:3px 8px 3px 0;white-space:nowrap;"><code>' + escapeHtml(item.name) + '</code>' + platformBadge(item.platform) + '</td>'
    + '<td class="muted" style="padding:3px 0;">' + escapeHtml(item.desc) + '</td></tr>';
});
html += '</tbody></table></div>';
});

container.innerHTML = html;
}

export 
function renderNetworkSettingsPanel() {
const container = document.getElementById('network-settings-panel');
if (!container) return;

container.innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 8px 0;">Live interface data from the local host. Click Refresh to update.</p>'
+ '<button onclick="refreshNetworkInterfaces()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;margin-bottom:8px;">\u{1F504} Refresh Interfaces</button>'
+ '<div id="network-interfaces-data" style="font-size:12px;"><span class="muted">Click Refresh to load interface data.</span></div>';
}

export 
function renderNetworkTelemetryPanel() {
const container = document.getElementById('network-telemetry-panel');
if (!container) return;

const t = state.networkTelemetryData;
const total = t.totalCommands;
const pct = function(n) { return total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'; };

container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px;">'
+ '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;">' + total + '</div><div class="muted" style="font-size:11px;">Total Commands</div></div>'
+ '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#2ecc71;">' + t.tier1Count + '</div><div class="muted" style="font-size:11px;">Tier 1 (' + pct(t.tier1Count) + '%)</div></div>'
+ '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#f39c12;">' + t.tier2Count + '</div><div class="muted" style="font-size:11px;">Tier 2 (' + pct(t.tier2Count) + '%)</div></div>'
+ '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#e74c3c;">' + t.tier3Count + '</div><div class="muted" style="font-size:11px;">Tier 3 (' + pct(t.tier3Count) + '%)</div></div>'
+ '<div class="panel" style="padding:8px;text-align:center;"><div style="font-size:20px;font-weight:bold;color:#e74c3c;">' + t.errorCount + '</div><div class="muted" style="font-size:11px;">Errors</div></div>'
+ '</div>'
+ (t.lastCommand ? '<p class="muted" style="font-size:11px;margin:0;">Last command: <code>' + escapeHtml(t.lastCommand) + '</code></p>' : '');
}

export 
function renderNetworkConsolePanel() {
const hist = document.getElementById('network-history-list');
if (!hist) return;
const cmds = state.networkCommandHistory;
if (cmds.length === 0) {
hist.innerHTML = '';
return;
}
var html = '<div class="muted" style="font-size:11px;font-weight:600;margin-bottom:4px;">Recent Commands (' + cmds.length + ')</div>';
html += '<div style="font-family:monospace;font-size:11px;">';
var recent = cmds.slice(-10).reverse();
for (var i = 0; i < recent.length; i++) {
var c = recent[i];
var color = c.ok ? '#7ecf7e' : '#ff8d8d';
var ts = new Date(c.timestamp).toLocaleTimeString();
html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.08);display:flex;gap:8px;align-items:baseline;">';
html += '<span style="color:' + color + ';font-size:9px;">\u25CF</span>';
html += '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(c.command) + '</span>';
html += '<span class="muted" style="font-size:10px;white-space:nowrap;">' + ts + '</span>';
html += '</div>';
}
html += '</div>';
hist.innerHTML = html;
}

export 
async function runNetworkCommand() {
const input = document.getElementById('network-console-input');
const output = document.getElementById('network-console-output');
if (!input || !output) return;

const command = input.value.trim();
if (!command) return;

output.textContent = '\u23F3 Running: ' + command + '\\n';

try {
const result = await request('/api/network/exec', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ command: command })
});

var text = '';
if (result.tier) text += '[' + result.tier + '] ';
text += '$ ' + command + '\\n';
if (result.stdout) text += result.stdout + '\\n';
if (result.stderr) text += '\\nSTDERR:\\n' + result.stderr + '\\n';
text += '\\nExit code: ' + (result.exitCode != null ? result.exitCode : 'N/A');

output.textContent = text;

// Update telemetry counters
state.networkTelemetryData.totalCommands++;
if (result.tier === 'tier1') state.networkTelemetryData.tier1Count++;
else if (result.tier === 'tier2') state.networkTelemetryData.tier2Count++;
else if (result.tier === 'tier3') state.networkTelemetryData.tier3Count++;
state.networkTelemetryData.lastCommand = command;

state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: true });
await refreshNetworkTelemetry();
} catch (error) {
output.textContent = '\u274C Error: ' + String(error);
state.networkTelemetryData.errorCount++;
state.networkTelemetryData.totalCommands++;
state.networkTelemetryData.lastCommand = command;
state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: false });
await refreshNetworkTelemetry();
}

renderNetworkTelemetryPanel();
input.value = '';
}

export 
async function refreshNetworkInterfaces() {
const container = document.getElementById('network-interfaces-data');
if (!container) return;
container.innerHTML = '<span class="muted">\u23F3 Loading interface data...</span>';
try {
const data = await request('/api/network/interfaces');
if (!data.interfaces || data.interfaces.length === 0) {
  container.innerHTML = '<span class="muted">No interface data available.</span>';
  return;
}
var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="border-bottom:2px solid var(--border);">'
  + '<th style="text-align:left;padding:4px 8px;">Interface</th>'
  + '<th style="text-align:left;padding:4px 8px;">Details</th>'
  + '</tr></thead><tbody>';
data.interfaces.forEach(function(iface) {
  html += '<tr style="border-bottom:1px solid var(--border);">'
    + '<td style="padding:4px 8px;font-weight:bold;white-space:nowrap;">' + escapeHtml(iface.name) + '</td>'
    + '<td style="padding:4px 8px;"><pre style="margin:0;white-space:pre-wrap;font-size:11px;">' + escapeHtml(iface.details) + '</pre></td>'
    + '</tr>';
});
html += '</tbody></table>';
container.innerHTML = html;
} catch (error) {
container.innerHTML = '<span style="color:#e74c3c;">\u274C Failed to load: ' + escapeHtml(String(error)) + '</span>';
}
}

export 
async function refreshNetworkTelemetry() {
try {
const telemetry = await request('/api/network/telemetry');
state.networkTelemetryData = {
  totalCommands: telemetry.totalCommands || 0,
  tier1Count: telemetry.tier1Count || 0,
  tier2Count: telemetry.tier2Count || 0,
  tier3Count: telemetry.tier3Count || 0,
  errorCount: telemetry.errorCount || 0,
  lastCommand: telemetry.lastCommand || null
};
safeRenderStep('networkTelemetryPanel', renderNetworkTelemetryPanel);
} catch (error) {
console.error('[network] telemetry refresh failed', error);
}
}
