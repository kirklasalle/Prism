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
  { name: 'openssl s_client', desc: 'TLS/SSL certificate inspection and handshake diagnostics', platform: 'cross' },
  { name: 'curl -I', desc: 'Fetch HTTP response headers only (HEAD request)', platform: 'cross' },
  { name: 'dig +trace', desc: 'DNS recursive resolution trace from root', platform: 'linux' },
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
  { name: 'ftp / sftp', desc: 'FTP/SFTP file transfer protocol operations', platform: 'cross' },
  { name: 'wscat', desc: 'WebSocket protocol connection and message testing', platform: 'cross' },
  { name: 'ssh -V', desc: 'Display SSH client version', platform: 'cross' },
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

// ── Network Intelligence Panel (VRGC Integration) ────────────────────

export
function renderNetworkIntelligencePanel() {
  var container = document.getElementById('network-intelligence-panel');
  if (!container) return;

  var vrgcStatus = state.vrgcAvailable;
  var statusDot = vrgcStatus ? '#2ecc71' : '#e74c3c';
  var statusText = vrgcStatus ? 'VRGC Connected' : 'VRGC Unavailable';

  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
    + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusDot + ';"></span>'
    + '<span class="muted" style="font-size:12px;">' + statusText + '</span>'
    + '<button onclick="checkVrgcStatus()" style="margin-left:auto;padding:2px 8px;border:none;border-radius:3px;background:var(--accent);color:#fff;cursor:pointer;font-size:11px;">\u{1F504} Check</button>'
    + '</div>';

  // Research widget
  html += '<div class="panel" style="padding:10px;margin-bottom:8px;">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F50D} Network Research</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 6px 0;">Query VRGC for network troubleshooting context, documentation, and known issues.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-research-input" type="text" placeholder="e.g. DNS timeout on port 53" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:12px;" />'
    + '<button onclick="runVrgcResearch()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;"' + (vrgcStatus ? '' : ' disabled') + '>Research</button>'
    + '</div>'
    + '<div id="vrgc-research-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  // Security Scan widget
  html += '<div class="panel" style="padding:10px;margin-bottom:8px;">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F6E1}\uFE0F Security Scan</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 6px 0;">Run SSL/TLS certificate inspection and security header analysis via VRGC.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-security-input" type="text" placeholder="https://example.com" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:12px;" />'
    + '<select id="vrgc-security-type" style="padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:11px;">'
    + '<option value="comprehensive">Comprehensive</option><option value="ssl">SSL Only</option><option value="headers">Headers Only</option><option value="basic">Basic</option></select>'
    + '<button onclick="runVrgcSecurityScan()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;"' + (vrgcStatus ? '' : ' disabled') + '>Scan</button>'
    + '</div>'
    + '<div id="vrgc-security-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  // Performance Test widget
  html += '<div class="panel" style="padding:10px;margin-bottom:8px;">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u26A1 Performance Test</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 6px 0;">Measure load time, TTFB, and network metrics for any URL via VRGC.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-perf-input" type="text" placeholder="https://example.com" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:12px;" />'
    + '<select id="vrgc-perf-device" style="padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:11px;">'
    + '<option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option></select>'
    + '<button onclick="runVrgcPerformanceTest()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;"' + (vrgcStatus ? '' : ' disabled') + '>Test</button>'
    + '</div>'
    + '<div id="vrgc-perf-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  // FTP Browser widget
  html += '<div class="panel" style="padding:10px;">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F4C1} FTP Browser</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 6px 0;">Browse FTP server directories via VRGC&#39;s secure FTP access tool.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-ftp-server" type="text" placeholder="ftp.example.com" style="flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:12px;" />'
    + '<input id="vrgc-ftp-path" type="text" placeholder="/" value="/" style="width:80px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary);color:var(--text);font-size:12px;" />'
    + '<button onclick="runVrgcFtpBrowse()" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:12px;"' + (vrgcStatus ? '' : ' disabled') + '>Browse</button>'
    + '</div>'
    + '<div id="vrgc-ftp-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  container.innerHTML = html;
}

export
async function checkVrgcStatus() {
  try {
    var result = await request('/api/network/vrgc/status');
    state.vrgcAvailable = result.available === true;
  } catch {
    state.vrgcAvailable = false;
  }
  safeRenderStep('networkIntelligencePanel', renderNetworkIntelligencePanel);
}

export
async function runVrgcResearch() {
  var input = document.getElementById('vrgc-research-input');
  var results = document.getElementById('vrgc-research-results');
  if (!input || !results) return;

  var topic = input.value.trim();
  if (!topic) return;

  results.innerHTML = '<span>\u23F3 Researching...</span>';
  try {
    var data = await request('/api/network/vrgc/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic })
    });
    if (data.ok && data.data) {
      var html = '';
      if (data.data.summary) html += '<p style="margin:0 0 6px 0;">' + escapeHtml(data.data.summary) + '</p>';
      if (data.data.sources && data.data.sources.length > 0) {
        html += '<ul style="margin:0;padding-left:16px;">';
        data.data.sources.forEach(function(s) {
          html += '<li><strong>' + escapeHtml(s.title) + '</strong> — ' + escapeHtml(s.snippet || '') + '</li>';
        });
        html += '</ul>';
      }
      results.innerHTML = html || '<span class="muted">No results found.</span>';
    } else {
      results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(data.error || 'Research failed') + '</span>';
    }
  } catch (err) {
    results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
  }
}

export
async function runVrgcSecurityScan() {
  var input = document.getElementById('vrgc-security-input');
  var scanType = document.getElementById('vrgc-security-type');
  var results = document.getElementById('vrgc-security-results');
  if (!input || !results) return;

  var target = input.value.trim();
  if (!target) return;

  results.innerHTML = '<span>\u23F3 Scanning...</span>';
  try {
    var data = await request('/api/network/vrgc/security-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target, scanType: scanType ? scanType.value : 'comprehensive' })
    });
    if (data.ok && data.data) {
      var html = '<div>';
      if (data.data.score != null) html += '<p style="margin:0 0 4px 0;">Security Score: <strong>' + data.data.score + '</strong></p>';
      if (data.data.sslInfo) {
        html += '<p style="margin:0 0 4px 0;">'
          + (data.data.sslInfo.valid ? '\u2705' : '\u274C') + ' SSL: '
          + escapeHtml(data.data.sslInfo.issuer || 'Unknown issuer')
          + (data.data.sslInfo.expiresAt ? ' (expires ' + escapeHtml(data.data.sslInfo.expiresAt) + ')' : '')
          + '</p>';
      }
      if (data.data.vulnerabilities && data.data.vulnerabilities.length > 0) {
        html += '<p style="margin:4px 0 2px 0;color:#e74c3c;">Vulnerabilities:</p><ul style="margin:0;padding-left:16px;">';
        data.data.vulnerabilities.forEach(function(v) { html += '<li>' + escapeHtml(v) + '</li>'; });
        html += '</ul>';
      }
      html += '</div>';
      results.innerHTML = html;
    } else {
      results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(data.error || 'Scan failed') + '</span>';
    }
  } catch (err) {
    results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
  }
}

export
async function runVrgcPerformanceTest() {
  var input = document.getElementById('vrgc-perf-input');
  var device = document.getElementById('vrgc-perf-device');
  var results = document.getElementById('vrgc-perf-results');
  if (!input || !results) return;

  var url = input.value.trim();
  if (!url) return;

  results.innerHTML = '<span>\u23F3 Testing performance...</span>';
  try {
    var data = await request('/api/network/vrgc/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, device: device ? device.value : 'desktop' })
    });
    if (data.ok && data.data) {
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;">';
      if (data.data.loadTimeMs != null) html += '<div class="panel" style="padding:6px;text-align:center;"><div style="font-size:16px;font-weight:bold;">' + data.data.loadTimeMs + 'ms</div><div class="muted" style="font-size:10px;">Load Time</div></div>';
      if (data.data.ttfbMs != null) html += '<div class="panel" style="padding:6px;text-align:center;"><div style="font-size:16px;font-weight:bold;">' + data.data.ttfbMs + 'ms</div><div class="muted" style="font-size:10px;">TTFB</div></div>';
      html += '<div class="panel" style="padding:6px;text-align:center;"><div style="font-size:16px;font-weight:bold;">' + escapeHtml(data.data.deviceSimulation || 'desktop') + '</div><div class="muted" style="font-size:10px;">Device</div></div>';
      html += '</div>';
      results.innerHTML = html;
    } else {
      results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(data.error || 'Performance test failed') + '</span>';
    }
  } catch (err) {
    results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
  }
}

export
async function runVrgcFtpBrowse() {
  var serverInput = document.getElementById('vrgc-ftp-server');
  var pathInput = document.getElementById('vrgc-ftp-path');
  var results = document.getElementById('vrgc-ftp-results');
  if (!serverInput || !results) return;

  var server = serverInput.value.trim();
  if (!server) return;

  results.innerHTML = '<span>\u23F3 Browsing FTP...</span>';
  try {
    var data = await request('/api/network/vrgc/ftp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: server, path: pathInput ? pathInput.value : '/' })
    });
    if (data.ok && data.data && data.data.entries) {
      if (data.data.entries.length === 0) {
        results.innerHTML = '<span class="muted">Directory is empty.</span>';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:2px 6px;">Name</th><th style="text-align:left;padding:2px 6px;">Type</th><th style="text-align:right;padding:2px 6px;">Size</th></tr></thead><tbody>';
      data.data.entries.forEach(function(e) {
        html += '<tr style="border-bottom:1px solid rgba(148,163,184,0.08);"><td style="padding:2px 6px;">' + escapeHtml(e.name) + '</td><td style="padding:2px 6px;">' + escapeHtml(e.type) + '</td><td style="padding:2px 6px;text-align:right;">' + (e.size != null ? e.size : '-') + '</td></tr>';
      });
      html += '</tbody></table>';
      results.innerHTML = html;
    } else {
      results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(data.error || 'FTP browse failed') + '</span>';
    }
  } catch (err) {
    results.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
  }
}
