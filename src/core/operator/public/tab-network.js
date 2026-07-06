import { state, request, escapeHtml, dashboardLog, safeRenderStep, metricRow } from './dashboard-core.js';

// Load command history from localStorage on module load
try {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('prism_network_command_history');
    if (saved) {
      state.networkCommandHistory = JSON.parse(saved);
    }
  }
} catch (e) {
  console.warn('[network] Failed to load command history from localStorage', e);
}

// ── Network Tab Panel Renderers ──────────────────────────────────────

export
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
    if (p === 'win') return '<span class="network-badge network-badge-win">WIN</span>';
    if (p === 'linux') return '<span class="network-badge network-badge-linux">LINUX</span>';
    return '<span class="network-badge network-badge-cross">CROSS</span>';
  };

  var html = '<p class="muted" style="margin:0 0 12px 0;font-size:12px;">Curated network command allowlist with tier-based governance. Commands are validated against an allowlist before execution.</p>';

  commands.forEach(function(group) {
    html += '<div style="margin-bottom:16px;">'
      + '<h4 style="margin:0 0 8px 0;font-size:13px;display:flex;align-items:center;">'
      + '<span class="network-led-dot" style="--led-color:' + tierColors[group.tier] + ';--led-glow:' + tierColors[group.tier] + ';"></span>'
      + tierLabels[group.tier] + ' \u2014 ' + escapeHtml(group.category)
      + ' <span class="muted" style="margin-left:6px;">(' + group.items.length + ')</span></h4>'
      + '<table class="network-table"><tbody>';
    group.items.forEach(function(item) {
      html += '<tr>'
        + '<td style="padding:4px 8px 4px 0;white-space:nowrap;width:30%;"><code>' + escapeHtml(item.name) + '</code>' + platformBadge(item.platform) + '</td>'
        + '<td class="muted" style="padding:4px 0;">' + escapeHtml(item.desc) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  });

  container.innerHTML = html;
}

export
function renderNetworkSettingsPanel() {
  const container = document.getElementById('network-settings-panel');
  if (!container) return;

  container.innerHTML = '<p class="muted" style="font-size:12px;margin:0 0 10px 0;">Live interface data from the local host. Click Refresh to update.</p>'
    + '<button id="network-refresh-interfaces-btn" class="secondary-button" style="margin-bottom:12px;">\u{1F504} Refresh Interfaces</button>'
    + '<div id="network-interfaces-data" style="font-size:12px;"><span class="muted">Click Refresh to load interface data.</span></div>';

  const btn = document.getElementById('network-refresh-interfaces-btn');
  if (btn) {
    btn.addEventListener('click', refreshNetworkInterfaces);
  }
}

export
function renderNetworkTelemetryPanel() {
  const container = document.getElementById('network-telemetry-panel');
  if (!container) return;

  const t = state.networkTelemetryData;
  const total = t.totalCommands;
  const pct = function(n) { return total > 0 ? ((n / total) * 100).toFixed(1) : '0.0'; };

  container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:12px;">'
    + '<div class="panel" style="padding:10px;text-align:center;background:rgba(255,255,255,0.02);"><div style="font-size:22px;font-weight:bold;font-family:var(--font-mono);">' + total + '</div><div class="muted" style="font-size:11px;">Total Commands</div></div>'
    + '<div class="panel" style="padding:10px;text-align:center;background:rgba(46,204,113,0.05);border:1px solid rgba(46,204,113,0.15);"><div style="font-size:22px;font-weight:bold;color:#2ecc71;font-family:var(--font-mono);">' + t.tier1Count + '</div><div class="muted" style="font-size:11px;">Tier 1 (' + pct(t.tier1Count) + '%)</div></div>'
    + '<div class="panel" style="padding:10px;text-align:center;background:rgba(243,156,18,0.05);border:1px solid rgba(243,156,18,0.15);"><div style="font-size:22px;font-weight:bold;color:#f39c12;font-family:var(--font-mono);">' + t.tier2Count + '</div><div class="muted" style="font-size:11px;">Tier 2 (' + pct(t.tier2Count) + '%)</div></div>'
    + '<div class="panel" style="padding:10px;text-align:center;background:rgba(231,76,60,0.05);border:1px solid rgba(231,76,60,0.15);"><div style="font-size:22px;font-weight:bold;color:#e74c3c;font-family:var(--font-mono);">' + t.tier3Count + '</div><div class="muted" style="font-size:11px;">Tier 3 (' + pct(t.tier3Count) + '%)</div></div>'
    + '<div class="panel" style="padding:10px;text-align:center;background:rgba(231,76,60,0.05);border:1px solid rgba(231,76,60,0.15);"><div style="font-size:22px;font-weight:bold;color:#e74c3c;font-family:var(--font-mono);">' + t.errorCount + '</div><div class="muted" style="font-size:11px;">Errors</div></div>'
    + '</div>'
    + (t.lastCommand ? '<p class="muted" style="font-size:11px;margin:0;display:flex;align-items:center;gap:6px;">Last command: <code style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;">' + escapeHtml(t.lastCommand) + '</code></p>' : '');
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
  var html = '<div class="muted" style="font-size:11px;font-weight:600;margin-bottom:8px;">Recent Commands (' + cmds.length + ')</div>';
  html += '<div style="display:flex;flex-direction:column;gap:4px;">';
  var recent = cmds.slice(-10).reverse();
  for (var i = 0; i < recent.length; i++) {
    var c = recent[i];
    var color = c.ok ? '#7ecf7e' : '#ff8d8d';
    var ts = new Date(c.timestamp).toLocaleTimeString();
    html += '<div class="network-history-item" title="Click to copy to input">';
    html += '<span class="network-history-dot" style="color:' + color + ';">\u25CF</span>';
    html += '<span class="network-history-command" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-mono);font-size:12px;">' + escapeHtml(c.command) + '</span>';
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

  output.textContent = '\u23F3 Running: ' + command + '\n';

  try {
    const result = await request('/api/network/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command })
    });

    var text = '';
    if (result.tier) text += '[' + result.tier + '] ';
    text += '$ ' + command + '\n';
    if (result.stdout) text += result.stdout + '\n';
    if (result.stderr) text += '\nSTDERR:\n' + result.stderr + '\n';
    text += '\nExit code: ' + (result.exitCode != null ? result.exitCode : 'N/A');

    output.textContent = text;

    // Update telemetry counters
    state.networkTelemetryData.totalCommands++;
    if (result.tier === 'tier1') state.networkTelemetryData.tier1Count++;
    else if (result.tier === 'tier2') state.networkTelemetryData.tier2Count++;
    else if (result.tier === 'tier3') state.networkTelemetryData.tier3Count++;
    state.networkTelemetryData.lastCommand = command;

    state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: true });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('prism_network_command_history', JSON.stringify(state.networkCommandHistory));
      }
    } catch (e) {}
    await refreshNetworkTelemetry();
  } catch (error) {
    output.textContent = '\u274C Error: ' + String(error);
    state.networkTelemetryData.errorCount++;
    state.networkTelemetryData.totalCommands++;
    state.networkTelemetryData.lastCommand = command;
    state.networkCommandHistory.push({ command: command, timestamp: new Date().toISOString(), ok: false });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('prism_network_command_history', JSON.stringify(state.networkCommandHistory));
      }
    } catch (e) {}
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
        + '<td style="padding:4px 8px;font-weight:bold;white-space:nowrap;vertical-align:top;">' + escapeHtml(iface.name) + '</td>'
        + '<td style="padding:4px 8px;"><pre style="margin:0;white-space:pre-wrap;font-size:11px;font-family:var(--font-mono);">' + escapeHtml(iface.details) + '</pre></td>'
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

  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">'
    + '<span class="network-led-dot" style="--led-color:' + statusDot + ';--led-glow:' + statusDot + ';"></span>'
    + '<span class="muted" style="font-size:12px;">' + statusText + '</span>'
    + '<button data-vrgc-action="check" class="secondary-button" style="margin-left:auto;padding:2px 8px;font-size:11px;">\u{1F504} Check</button>'
    + '</div>';

  // Research widget
  html += '<div class="network-vrgc-widget">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F50D} Network Research</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 8px 0;">Query VRGC for network troubleshooting context, documentation, and known issues.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-research-input" type="text" placeholder="e.g. DNS timeout on port 53" class="channels-input" />'
    + '<button class="primary-button" data-vrgc-action="research"' + (vrgcStatus ? '' : ' disabled') + '>Research</button>'
    + '</div>'
    + '<div id="vrgc-research-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;white-space:pre-wrap;"></div>'
    + '</div>';

  // Security Scan widget
  html += '<div class="network-vrgc-widget">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F6E1}\uFE0F Security Scan</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 8px 0;">Run SSL/TLS certificate inspection and security header analysis via VRGC.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-security-input" type="text" placeholder="https://example.com" class="channels-input" />'
    + '<select id="vrgc-security-type" class="channels-input" style="width:140px;">'
    + '<option value="comprehensive">Comprehensive</option><option value="ssl">SSL Only</option><option value="headers">Headers Only</option><option value="basic">Basic</option></select>'
    + '<button class="primary-button" data-vrgc-action="scan"' + (vrgcStatus ? '' : ' disabled') + '>Scan</button>'
    + '</div>'
    + '<div id="vrgc-security-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  // Performance Test widget
  html += '<div class="network-vrgc-widget">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u26A1 Performance Test</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 8px 0;">Measure load time, TTFB, and network metrics for any URL via VRGC.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-perf-input" type="text" placeholder="https://example.com" class="channels-input" />'
    + '<select id="vrgc-perf-device" class="channels-input" style="width:100px;">'
    + '<option value="desktop">Desktop</option><option value="mobile">Mobile</option><option value="tablet">Tablet</option></select>'
    + '<button class="primary-button" data-vrgc-action="perf"' + (vrgcStatus ? '' : ' disabled') + '>Test</button>'
    + '</div>'
    + '<div id="vrgc-perf-results" class="muted" style="font-size:11px;margin-top:6px;max-height:200px;overflow-y:auto;"></div>'
    + '</div>';

  // FTP Browser widget
  html += '<div class="network-vrgc-widget">'
    + '<h4 style="margin:0 0 6px 0;font-size:13px;">\u{1F4C1} FTP Browser</h4>'
    + '<p class="muted" style="font-size:11px;margin:0 0 8px 0;">Browse FTP server directories via VRGC&#39;s secure FTP access tool.</p>'
    + '<div style="display:flex;gap:6px;">'
    + '<input id="vrgc-ftp-server" type="text" placeholder="ftp.example.com" class="channels-input" />'
    + '<input id="vrgc-ftp-path" type="text" placeholder="/" value="/" class="channels-input" style="width:80px;" />'
    + '<button class="primary-button" data-vrgc-action="ftp"' + (vrgcStatus ? '' : ' disabled') + '>Browse</button>'
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

export
function initNetworkTab() {
  // Bind console buttons and elements
  const runBtn = document.getElementById('network-console-run-btn');
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.dataset.bound = 'true';
    runBtn.addEventListener('click', runNetworkCommand);
  }

  const clearBtn = document.getElementById('network-console-clear-btn');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = 'true';
    clearBtn.addEventListener('click', () => {
      const output = document.getElementById('network-console-output');
      if (output) output.textContent = 'Ready — enter a network command above.';
    });
  }

  const input = document.getElementById('network-console-input');
  if (input && !input.dataset.bound) {
    input.dataset.bound = 'true';
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') runNetworkCommand();
    });
  }

  const historyList = document.getElementById('network-history-list');
  if (historyList && !historyList.dataset.bound) {
    historyList.dataset.bound = 'true';
    historyList.addEventListener('click', (ev) => {
      const item = ev.target.closest('.network-history-item');
      if (item) {
        const cmdSpan = item.querySelector('.network-history-command');
        if (cmdSpan) {
          const cmd = cmdSpan.textContent;
          if (input) {
            input.value = cmd;
            input.focus();
          }
        }
      }
    });
  }

  // Bind collapsible headers
  const headers = document.querySelectorAll('#tab-network [data-collapse-target]');
  headers.forEach(header => {
    if (!header.dataset.bound) {
      header.dataset.bound = 'true';
      header.addEventListener('click', () => {
        const target = header.getAttribute('data-collapse-target');
        if (typeof togglePanelCollapse === 'function') {
          togglePanelCollapse(target);
        }
      });
    }
  });

  // Event delegation on the network-intelligence-panel container
  const vrgcPanel = document.getElementById('network-intelligence-panel');
  if (vrgcPanel && !vrgcPanel.dataset.bound) {
    vrgcPanel.dataset.bound = 'true';
    vrgcPanel.addEventListener('click', (ev) => {
      const target = ev.target;
      if (target.matches('[data-vrgc-action="check"]')) {
        checkVrgcStatus();
      } else if (target.matches('[data-vrgc-action="research"]')) {
        runVrgcResearch();
      } else if (target.matches('[data-vrgc-action="scan"]')) {
        runVrgcSecurityScan();
      } else if (target.matches('[data-vrgc-action="perf"]')) {
        runVrgcPerformanceTest();
      } else if (target.matches('[data-vrgc-action="ftp"]')) {
        runVrgcFtpBrowse();
      }
    });

    vrgcPanel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const target = ev.target;
        if (target.id === 'vrgc-research-input') {
          runVrgcResearch();
        } else if (target.id === 'vrgc-security-input') {
          runVrgcSecurityScan();
        } else if (target.id === 'vrgc-perf-input') {
          runVrgcPerformanceTest();
        } else if (target.id === 'vrgc-ftp-server' || target.id === 'vrgc-ftp-path') {
          runVrgcFtpBrowse();
        }
      }
    });
  }

  // Ensure render loop binds refresh button as well
  const refreshIfaceBtn = document.getElementById('network-refresh-interfaces-btn');
  if (refreshIfaceBtn && !refreshIfaceBtn.dataset.bound) {
    refreshIfaceBtn.dataset.bound = 'true';
    refreshIfaceBtn.addEventListener('click', refreshNetworkInterfaces);
  }
}
