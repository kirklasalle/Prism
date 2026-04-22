import { state, request, escapeHtml, dashboardLog, safeRenderStep, formatUptime } from './dashboard-core.js';

var selectedFramebufferFile = null;
var framebufferGalleryItems = [];
var framebufferBurstVideoCache = {};
var framebufferBurstAnimationInterval = null;
var framebufferBurstCurrentItem = null;
var framebufferBurstPaused = false;
var framebufferBurstSpeedMultiplier = 1;

export function updateBurstMediaBar() {
  var ppBtn = document.getElementById('fb-mc-playpause');
  if (ppBtn) ppBtn.textContent = framebufferBurstPaused ? '\u25B6 Play' : '\u23F8 Pause';
  var speeds = [
    { id: 'fb-mc-speed-half', val: 0.5 },
    { id: 'fb-mc-speed-1x', val: 1 },
    { id: 'fb-mc-speed-2x', val: 2 },
  ];
  for (var i = 0; i < speeds.length; i++) {
    var btn = document.getElementById(speeds[i].id);
    if (btn) {
      if (speeds[i].val === framebufferBurstSpeedMultiplier) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }
}

export function stopBurstFrameAnimation() {
  if (framebufferBurstAnimationInterval) {
    clearInterval(framebufferBurstAnimationInterval);
    framebufferBurstAnimationInterval = null;
  }
  framebufferBurstCurrentItem = null;
  framebufferBurstPaused = false;
  var mediaBar = document.getElementById('framebuffer-media-bar');
  if (mediaBar) mediaBar.style.display = 'none';
}

export function startBurstFrameAnimation(item) {
  stopBurstFrameAnimation();
  if (!item || !item.sourceFiles || !item.sourceFiles.length) return;
  framebufferBurstCurrentItem = item;
  framebufferBurstPaused = false;
  var img = document.getElementById('framebuffer-preview');
  var video = document.getElementById('framebuffer-preview-video');
  var placeholder = document.getElementById('fb-placeholder');
  if (!img) return;
  if (video) video.style.display = 'none';
  var frameUrls = item.sourceFiles.map(function (fn) {
    return '/api/computer/screengrab/file/' + encodeURIComponent(fn);
  });
  var frameIndex = 0;
  img.src = frameUrls[0];
  img.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
  var mediaBar = document.getElementById('framebuffer-media-bar');
  if (mediaBar) { mediaBar.style.display = 'flex'; if (window.updateBurstMediaBar) window.updateBurstMediaBar(); }
  if (frameUrls.length <= 1) return;
  var fps = Math.max(1, item.playbackFps || 8);
  var delay = Math.round(1000 / fps / Math.max(0.1, framebufferBurstSpeedMultiplier));
  framebufferBurstAnimationInterval = setInterval(function () {
    if (!framebufferBurstPaused) {
      frameIndex = (frameIndex + 1) % frameUrls.length;
      img.src = frameUrls[frameIndex];
    }
  }, delay);
}

export function toggleBurstPlayPause() {
  framebufferBurstPaused = !framebufferBurstPaused;
  if (window.updateBurstMediaBar) window.updateBurstMediaBar();
}

export function stopBurstFromUI() {
  if (framebufferBurstCurrentItem && framebufferBurstCurrentItem.sourceFiles && framebufferBurstCurrentItem.sourceFiles.length) {
    var img = document.getElementById('framebuffer-preview');
    if (img) img.src = '/api/computer/screengrab/file/' + encodeURIComponent(framebufferBurstCurrentItem.sourceFiles[0]);
  }
  if (window.stopBurstFrameAnimation) window.stopBurstFrameAnimation();
}

export function setBurstSpeed(multiplier) {
  framebufferBurstSpeedMultiplier = multiplier;
  if (framebufferBurstCurrentItem) {
    var wasPaused = framebufferBurstPaused;
    if (window.startBurstFrameAnimation) window.startBurstFrameAnimation(framebufferBurstCurrentItem);
    framebufferBurstPaused = wasPaused;
    if (window.updateBurstMediaBar) window.updateBurstMediaBar();
  }
}

export
  // ── Computer Control Tab Renderers ──────────────────────────────────

  function renderLocalSystemInfo() {
  var container = document.getElementById('local-system-info');
  if (!container) return;
  var info = state.computerSystemInfo;
  if (!info) return;
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">';
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Operating System</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.os || '\u2014') + '</div></div>';
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Hostname</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.hostname || '\u2014') + '</div></div>';
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Platform</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.platform || '\u2014') + '</div></div>';
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Uptime</div><div style="font-size:14px;font-weight:600;">' + formatUptime(info.uptime) + '</div></div>';
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">CPUs</div><div style="font-size:14px;font-weight:600;">' + (info.cpus || '\u2014') + ' cores</div></div>';
  var totalMb = info.totalMemory ? Math.round(info.totalMemory / 1048576) : 0;
  var freeMb = info.freeMemory ? Math.round(info.freeMemory / 1048576) : 0;
  var usedPct = totalMb > 0 ? Math.round((totalMb - freeMb) / totalMb * 100) : 0;
  html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Memory</div><div style="font-size:14px;font-weight:600;">' + usedPct + '% used (' + Math.round(freeMb / 1024) + ' GB free / ' + Math.round(totalMb / 1024) + ' GB)</div></div>';
  if (info.gpu) {
    html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">GPU</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.name || '\u2014') + '</div></div>';
    html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">VRAM</div><div style="font-size:14px;font-weight:600;">' + (info.gpu.vramTotalMb ? (info.gpu.vramTotalMb >= 1024 ? (Math.round(info.gpu.vramTotalMb / 1024 * 10) / 10) + ' GB' : info.gpu.vramTotalMb + ' MB') : '\u2014') + '</div></div>';
    if (info.gpu.cudaVersion) {
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">CUDA</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.cudaVersion) + '<span class="gpu-badge">CUDA</span></div></div>';
    }
    if (info.gpu.driverVersion) {
      html += '<div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Driver</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(info.gpu.driverVersion) + '</div></div>';
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

export
  function renderUsageMetrics(data) {
  var container = document.getElementById('usage-metrics');
  if (!container) return;
  if (!data) { container.innerHTML = ''; return; }
  var ramTotal = data.ramTotal || 1;
  var ramUsed = ramTotal - (data.ramFree || 0);
  var ramPct = Math.round(ramUsed / ramTotal * 100);
  state.ramHistory.push(ramPct);
  if (state.ramHistory.length > 60) state.ramHistory.shift();
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
  html += '<div class="panel" style="padding:14px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span class="muted" style="font-size:11px;">RAM Usage</span><span style="font-size:12px;font-weight:600;">' + ramPct + '% (' + Math.round(ramUsed / 1073741824 * 10) / 10 + ' / ' + Math.round(ramTotal / 1073741824 * 10) / 10 + ' GB)</span></div>';
  html += '<div class="usage-bar"><div class="usage-bar-fill ram" style="width:' + ramPct + '%"></div><div class="usage-bar-label">' + ramPct + '%</div></div>';
  html += '<div style="margin-top:8px;"><canvas id="sparkline-ram" width="320" height="40" style="width:100%;height:40px;"></canvas></div>';
  html += '</div>';
  if (data.gpu) {
    var vramPct = data.gpu.vramTotalMb > 0 ? Math.round(data.gpu.vramUsedMb / data.gpu.vramTotalMb * 100) : 0;
    state.vramHistory.push(vramPct);
    if (state.vramHistory.length > 60) state.vramHistory.shift();
    html += '<div class="panel" style="padding:14px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><span class="muted" style="font-size:11px;">VRAM Usage</span><span style="font-size:12px;font-weight:600;">' + vramPct + '% (' + data.gpu.vramUsedMb + ' / ' + data.gpu.vramTotalMb + ' MB)';
    if (data.gpu.tempC) html += ' \u2022 ' + data.gpu.tempC + '\u00B0C';
    html += '</span></div>';
    html += '<div class="usage-bar"><div class="usage-bar-fill vram" style="width:' + vramPct + '%"></div><div class="usage-bar-label">' + vramPct + '%</div></div>';
    html += '<div style="margin-top:8px;"><canvas id="sparkline-vram" width="320" height="40" style="width:100%;height:40px;"></canvas></div>';
    html += '</div>';
  } else {
    html += '<div class="panel" style="padding:14px;"><div class="muted" style="font-size:11px;">VRAM Usage</div><div style="font-size:13px;color:var(--muted);margin-top:6px;">No GPU detected</div></div>';
  }
  html += '</div>';
  container.innerHTML = html;
  drawSparkline('sparkline-ram', state.ramHistory, '#69d2ff');
  if (data.gpu) drawSparkline('sparkline-vram', state.vramHistory, '#7cf1c8');
}

export
  function drawSparkline(canvasId, history, color) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  var max = 100;
  var step = w / 59;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (var i = 0; i < history.length; i++) {
    var x = (history.length - 1 === 0) ? 0 : (i / (history.length - 1)) * w;
    var y = h - (history[i] / max) * (h - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color.replace(')', ',0.08)').replace('rgb', 'rgba');
  ctx.fill();
}

export
  async function runLocalCommand() {
  var input = document.getElementById('computer-console-input');
  var output = document.getElementById('computer-console-output');
  if (!input || !output) return;
  var cmd = input.value.trim();
  if (!cmd) return;
  output.textContent = 'Running: ' + cmd + '\\n';
  state.computerConsoleHistory.push({ command: cmd, timestamp: new Date().toISOString() });
  try {
    var result = await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) });
    var out = '';
    if (result.stdout) out += result.stdout;
    if (result.stderr) out += (out ? '\\n' : '') + result.stderr;
    output.textContent = out || '(no output)';
  } catch (e) {
    output.textContent = 'Error: ' + e.message;
  }
  input.value = '';
}

export
  async function refreshEnvVars() {
  try {
    state.computerEnvVars = await request('/api/computer/env-vars');
    renderEnvVarsList();
  } catch (e) { console.error('[computer] env vars failed', e); }
}

export
  function renderEnvVarsList() {
  var container = document.getElementById('env-vars-list');
  if (!container || !state.computerEnvVars) return;
  var data = state.computerEnvVars;
  var html = '';
  if (data.prismVars && data.prismVars.length > 0) {
    html += '<div style="margin-bottom:8px;font-weight:700;color:var(--accent);font-size:12px;">PRISM Variables (' + data.prismVars.length + ')</div>';
    for (var i = 0; i < data.prismVars.length; i++) {
      html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);"><span style="color:var(--accent-2);font-weight:600;">' + escapeHtml(data.prismVars[i].key) + '</span>=<span>' + escapeHtml(data.prismVars[i].value) + '</span></div>';
    }
  }
  if (data.systemVars && data.systemVars.length > 0) {
    html += '<div style="margin:10px 0 6px;font-weight:700;color:var(--muted);font-size:12px;">System Variables (' + data.systemVars.length + ')</div>';
    for (var j = 0; j < Math.min(data.systemVars.length, 50); j++) {
      html += '<div style="padding:2px 0;border-bottom:1px solid rgba(148,163,184,0.06);"><span style="color:var(--fg);font-weight:600;">' + escapeHtml(data.systemVars[j].key) + '</span>=<span class="muted">' + escapeHtml(data.systemVars[j].value.substring(0, 120)) + '</span></div>';
    }
    if (data.systemVars.length > 50) {
      html += '<div class="muted" style="margin-top:6px;">... and ' + (data.systemVars.length - 50) + ' more</div>';
    }
  }
  container.innerHTML = html || '<div class="muted">No environment variables found.</div>';
}

export
  async function openPolicyEditor(tool) {
  try {
    await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: tool + '.msc' }) });
    var output = document.getElementById('policy-status-output');
    if (output) output.textContent = 'Launched ' + tool + '.msc at ' + new Date().toLocaleTimeString();
  } catch (e) {
    var output2 = document.getElementById('policy-status-output');
    if (output2) output2.textContent = 'Failed: ' + e.message;
  }
}

export
  async function refreshPolicyStatus() {
  var output = document.getElementById('policy-status-output');
  if (!output) return;
  output.textContent = 'Querying policy status...';
  try {
    var result = await request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'gpresult /Scope User /v' }) });
    output.textContent = result.stdout || result.stderr || 'No policy data returned.';
  } catch (e) {
    output.textContent = 'Policy query failed: ' + e.message;
  }
}

export
  async function refreshDeviceManager() {
  var container = document.getElementById('device-tree-container');
  var scanBtn = document.querySelector('[onclick="refreshDeviceManager()"]');
  if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = '\u{1F504} Scanning\u2026'; }
  if (container) container.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">\u{1F50D} Scanning hardware via WMI\u2026 This may take a few seconds.</div>';
  try {
    state.computerDevices = await request('/api/computer/devices');
    renderDeviceTree();
  } catch (e) {
    console.error('[computer] device scan failed', e);
    if (container) container.innerHTML = '<div class="muted" style="color:#ff8d8d;">Device scan failed: ' + escapeHtml(e.message || String(e)) + '</div>';
  } finally {
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '\u{1F504} Scan Devices'; }
  }
}

export
  function renderDeviceTree() {
  var container = document.getElementById('device-tree-container');
  if (!container || !state.computerDevices) return;
  var devs = state.computerDevices.devices || {};
  var filterInput = document.getElementById('dm-search-input');
  var query = filterInput ? filterInput.value.toLowerCase().trim() : '';

  var icons = {
    'Processors': '\u2699\uFE0F', 'Motherboard': '\u{1F4CB}', 'Memory': '\u{1F9E0}',
    'Display Adapters': '\u{1F4BB}', 'Disk Drives': '\u{1F4BE}', 'Network Adapters': '\u{1F4F6}',
    'Sound Devices': '\u{1F50A}', 'USB Controllers': '\u{1F50C}', 'USB Devices': '\u{1F4F1}',
    'BIOS': '\u{1F4DF}', 'Optical Drives': '\u{1F4BF}'
  };

  var totalDevices = 0;
  var totalIssues = 0;
  var html = '';

  var catOrder = ['Processors', 'Motherboard', 'BIOS', 'Memory', 'Display Adapters', 'Disk Drives',
    'Network Adapters', 'Sound Devices', 'USB Controllers', 'USB Devices', 'Optical Drives'];
  var allCats = catOrder.filter(function (c) { return devs[c]; });
  // Add any categories not in our order list
  for (var k in devs) { if (allCats.indexOf(k) === -1) allCats.push(k); }

  for (var ci = 0; ci < allCats.length; ci++) {
    var cat = allCats[ci];
    var items = devs[cat] || [];
    if (!Array.isArray(items)) items = [items];

    // Filter by search query
    var filtered = items;
    if (query) {
      filtered = items.filter(function (d) {
        return (d.name || '').toLowerCase().indexOf(query) !== -1 || cat.toLowerCase().indexOf(query) !== -1;
      });
      if (filtered.length === 0) continue;
    }

    var icon = icons[cat] || '\u{1F50C}';
    var okCount = 0, warnCount = 0, errCount = 0;
    for (var si = 0; si < filtered.length; si++) {
      var st = (filtered[si].status || 'OK').toLowerCase();
      if (st === 'ok') okCount++;
      else if (st === 'degraded' || st === 'pred fail') warnCount++;
      else errCount++;
    }
    totalDevices += filtered.length;
    totalIssues += warnCount + errCount;

    var statusSummary = '';
    if (warnCount > 0) statusSummary += '<span class="dm-cat-badge dm-badge-warn">' + warnCount + ' warning</span>';
    if (errCount > 0) statusSummary += '<span class="dm-cat-badge dm-badge-error">' + errCount + ' error</span>';

    html += '<details class="dm-category" ' + (errCount > 0 || warnCount > 0 ? 'open' : '') + '>';
    html += '<summary class="dm-category-header">' + icon + ' ' + escapeHtml(cat) + ' <span class="dm-cat-count">(' + filtered.length + ')</span> ' + statusSummary + '</summary>';

    if (filtered.length === 0) {
      html += '<div class="muted" style="padding:6px 0 0 18px;font-size:12px;">No devices detected.</div>';
    } else {
      for (var di = 0; di < filtered.length; di++) {
        var dev = filtered[di];
        var devStatus = (dev.status || 'OK').toLowerCase();
        var dotClass = devStatus === 'ok' ? 'dm-dot-ok' : (devStatus === 'degraded' || devStatus === 'pred fail') ? 'dm-dot-warn' : 'dm-dot-error';
        // Find the real index in the unfiltered array for property lookup
        var realIndex = items.indexOf(dev);
        html += '<div class="dm-device-row" data-cat="' + escapeHtml(cat) + '" data-idx="' + realIndex + '" onclick="toggleDeviceProperties(this)">';
        html += '<span class="dm-status-dot ' + dotClass + '"></span>';
        html += '<span class="dm-device-name">' + escapeHtml(dev.name || 'Unknown Device') + '</span>';
        html += '<span class="dm-device-status">' + escapeHtml(dev.status || 'OK') + '</span>';
        html += '</div>';
        html += '<div class="dm-props-panel" id="dm-props-' + escapeHtml(cat).replace(/\\s/g, '-') + '-' + realIndex + '" style="display:none;"></div>';
      }
    }
    html += '</details>';
  }

  // Update total badge
  var badge = document.getElementById('dm-total-badge');
  if (badge) {
    badge.textContent = totalDevices + ' device' + (totalDevices !== 1 ? 's' : '') + (totalIssues > 0 ? ' \u2022 ' + totalIssues + ' issue' + (totalIssues !== 1 ? 's' : '') : '');
    badge.className = 'dm-total-badge' + (totalIssues > 0 ? ' dm-total-issues' : '');
  }

  if (state.computerDevices.fallback) {
    html = '<div class="muted" style="font-size:11px;margin-bottom:8px;color:#ffd17a;">\u26A0 WMI scan unavailable \u2014 showing limited data from Node.js os module.</div>' + html;
  }

  container.innerHTML = html || '<div class="muted">No device data. Click Scan Devices.</div>';
}

export
  async function toggleDeviceProperties(el) {
  var cat = el.getAttribute('data-cat');
  var idx = el.getAttribute('data-idx');
  var panelId = 'dm-props-' + cat.replace(/\\s/g, '-') + '-' + idx;
  var panel = document.getElementById(panelId);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    el.classList.remove('dm-device-expanded');
    return;
  }

  el.classList.add('dm-device-expanded');
  panel.style.display = 'block';
  panel.innerHTML = '<div class="muted" style="padding:8px;font-size:11px;">Loading properties\u2026</div>';

  // First try cached props from the scan
  var devs = state.computerDevices ? state.computerDevices.devices || {} : {};
  var items = devs[cat] || [];
  var dev = items[parseInt(idx, 10)];
  if (dev && dev.props && Object.keys(dev.props).length > 2) {
    renderDevicePropsPanel(panel, dev.props);
    return;
  }

  // Fetch detailed properties from API
  try {
    var data = await request('/api/computer/devices/properties/' + encodeURIComponent(cat) + '/' + idx);
    renderDevicePropsPanel(panel, data.properties || {});
  } catch (e) {
    panel.innerHTML = '<div class="muted" style="padding:8px;font-size:11px;color:#ff8d8d;">Failed to load properties: ' + escapeHtml(e.message || String(e)) + '</div>';
  }
}

function renderDevicePropsPanel(panel, props) {
  var keys = Object.keys(props).sort();
  if (keys.length === 0) {
    panel.innerHTML = '<div class="muted" style="padding:8px;font-size:11px;">No properties available.</div>';
    return;
  }
  var html = '<table class="dm-props-table">';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = props[k];
    if (v === null || v === undefined || v === '') continue;
    html += '<tr><td class="dm-prop-key">' + escapeHtml(k) + '</td><td class="dm-prop-val">' + escapeHtml(String(v)) + '</td></tr>';
  }
  html += '</table>';
  panel.innerHTML = html;
}

export
  function filterDeviceTree() {
  renderDeviceTree();
}

export
  async function generateDeviceReport() {
  var devs = state.computerDevices ? state.computerDevices.devices || {} : {};
  var categories = Object.keys(devs);
  if (categories.length === 0) {
    alert('Scan devices first before generating a report.');
    return;
  }
  var btn = document.querySelector('[onclick="generateDeviceReport()"]');
  if (btn) { btn.disabled = true; btn.textContent = '\u{1F4CB} Generating\u2026'; }
  try {
    var data = await request('/api/computer/devices/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: categories })
    });
    var report = (data.report || 'No data').replace(/\\\\n/g, '\\n');
    var blob = new Blob([report], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'prism-device-report-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dashboardLog('computer', 'device.report', 'Device report generated with ' + categories.length + ' categories');
  } catch (e) {
    alert('Report generation failed: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u{1F4CB} Generate Report'; }
  }
}

export
  function openSystemDeviceManager() {
  request('/api/computer/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'devmgmt.msc' }) }).catch(function () { });
}

export
  // ── Vision Framebuffer JS ────────────────────────────────────────────

  async function captureScreengrab() {
  var meta = document.getElementById('fb-meta');
  var preserveSelection = !!selectedFramebufferFile;
  if (meta) meta.textContent = 'Capturing...';
  try {
    var result = await request('/api/computer/screengrab/capture', { method: 'POST' });
    if (meta) meta.textContent = result.filename + ' (' + Math.round(result.sizeBytes / 1024) + ' KB)';
    if (!preserveSelection) refreshFramebufferViewer();
    refreshFramebufferGallery();
  } catch (e) {
    if (meta) meta.textContent = 'Capture failed: ' + e.message;
    showCaptureDiagnostics('Capture failed: ' + e.message);
  }
}

export
  async function burstCapture() {
  var meta = document.getElementById('fb-meta');
  var preserveSelection = !!selectedFramebufferFile;
  if (meta) meta.textContent = 'Burst capturing (8 FPS, 2s)...';
  try {
    var result = await request('/api/computer/screengrab/burst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps: 8, duration: 2 }) });
    if (meta) meta.textContent = 'Burst complete: ' + result.frames + ' frames captured';
    if (!preserveSelection) refreshFramebufferViewer();
    refreshFramebufferGallery();
  } catch (e) {
    if (meta) meta.textContent = 'Burst failed: ' + e.message;
    showCaptureDiagnostics('Burst failed: ' + e.message);
  }
}

export
  async function showCaptureDiagnostics(errorMsg) {
  var panel = document.getElementById('fb-diagnostics');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<span class="muted">Running diagnostics...</span>';
  try {
    var diag = await request('/api/computer/screengrab/diagnostics');
    var html = '<strong style="color:#ff6b6b;">\u26A0 ' + escapeHtml(errorMsg) + '</strong><br/><br/>';
    html += '<strong>Diagnostics:</strong><br/>';
    for (var i = 0; i < diag.checks.length; i++) {
      var c = diag.checks[i];
      var icon = c.ok ? '<span style="color:#51cf66;">\u2713</span>' : '<span style="color:#ff6b6b;">\u2717</span>';
      html += icon + ' <strong>' + escapeHtml(c.name) + '</strong>: ' + escapeHtml(c.detail) + '<br/>';
    }
    panel.innerHTML = html;
  } catch (e2) {
    panel.innerHTML = '<strong style="color:#ff6b6b;">\u26A0 ' + escapeHtml(errorMsg) + '</strong><br/>Diagnostics also failed: ' + escapeHtml(e2.message);
  }
}

export
  async function runFramebufferDiagnostics() {
  var panel = document.getElementById('fb-diagnostics');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<span class="muted">Running diagnostics...</span>';
  try {
    var diag = await request('/api/computer/screengrab/diagnostics');
    var html = '<strong>' + (diag.ok ? '<span style="color:#51cf66;">\u2713 All checks passed</span>' : '<span style="color:#ff6b6b;">\u2717 Issues detected</span>') + '</strong><br/><br/>';
    for (var i = 0; i < diag.checks.length; i++) {
      var c = diag.checks[i];
      var icon = c.ok ? '<span style="color:#51cf66;">\u2713</span>' : '<span style="color:#ff6b6b;">\u2717</span>';
      html += icon + ' <strong>' + escapeHtml(c.name) + '</strong>: ' + escapeHtml(c.detail) + '<br/>';
    }
    html += '<br/><button class="secondary-button" style="font-size:11px;padding:4px 8px;" onclick="document.getElementById(\'fb-diagnostics\').style.display=\'none\'">Dismiss</button>';
    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = '<span style="color:#ff6b6b;">Diagnostics request failed: ' + escapeHtml(e.message) + '</span>';
  }
}

export
  function refreshFramebufferViewer() {
  selectedFramebufferFile = null;
  setFramebufferPreviewSource('/api/computer/screengrab/latest?t=' + Date.now());
}

export
  function clearFramebufferPreviewVideo() {
  stopBurstFrameAnimation();
  var video = document.getElementById('framebuffer-preview-video');
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.style.display = 'none';
}

export
  function setFramebufferPreviewSource(src) {
  var img = document.getElementById('framebuffer-preview');
  var video = document.getElementById('framebuffer-preview-video');
  var placeholder = document.getElementById('fb-placeholder');
  if (!img) return;
  clearFramebufferPreviewVideo();
  var testImg = new Image();
  testImg.onload = function () {
    img.src = src;
    img.style.display = 'block';
    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'none';
  };
  testImg.onerror = function () {
    img.style.display = 'none';
    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
  };
  testImg.src = src;
}

export
  function setFramebufferPreviewVideoSource(src, posterSrc) {
  var img = document.getElementById('framebuffer-preview');
  var video = document.getElementById('framebuffer-preview-video');
  var placeholder = document.getElementById('fb-placeholder');
  if (!video) {
    setFramebufferPreviewSource(posterSrc);
    return;
  }
  if (img) img.style.display = 'none';
  video.src = src;
  if (posterSrc) video.poster = posterSrc;
  video.style.display = 'block';
  video.currentTime = 0;
  if (placeholder) placeholder.style.display = 'none';
  video.play().catch(function () { });
}

export
  function detectBurstVideoMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  var candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (var i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
  }
  return '';
}

export
  function loadFramebufferImage(src) {
  return new Promise(function (resolve, reject) {
    var image = new Image();
    image.onload = function () { resolve(image); };
    image.onerror = reject;
    image.src = src;
  });
}

export
  async function buildBurstVideoPreview(item) {
  if (!item || item.kind !== 'burst' || !item.sourceFiles || !item.sourceFiles.length) {
    throw new Error('No burst frames available');
  }
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('Video preview is not supported in this environment');
  }
  var mimeType = detectBurstVideoMimeType();
  if (!mimeType) {
    throw new Error('WebM recording is not supported in this browser');
  }

  var frameUrls = item.sourceFiles.map(function (fileName) {
    return '/api/computer/screengrab/file/' + encodeURIComponent(fileName) + '?t=' + Date.now();
  });
  var images = await Promise.all(frameUrls.map(loadFramebufferImage));
  var first = images[0];
  var maxWidth = 1280;
  var scale = first.naturalWidth > maxWidth ? (maxWidth / first.naturalWidth) : 1;
  var width = Math.max(1, Math.round(first.naturalWidth * scale));
  var height = Math.max(1, Math.round(first.naturalHeight * scale));
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable');

  var fps = Math.max(1, item.playbackFps || 8);
  var frameDelay = Math.max(40, Math.round(1000 / fps));
  var stream = canvas.captureStream(fps);
  var recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 2500000 });
  var chunks = [];

  return await new Promise(function (resolve, reject) {
    var settled = false;
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = function (event) {
      if (settled) return;
      settled = true;
      reject(event.error || new Error('Burst video render failed'));
    };
    recorder.onstop = function () {
      if (settled) return;
      settled = true;
      resolve(new Blob(chunks, { type: mimeType }));
    };

    recorder.start();
    (async function () {
      try {
        for (var index = 0; index < images.length; index++) {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(images[index], 0, 0, width, height);
          await new Promise(function (r) { setTimeout(r, frameDelay); });
        }
        ctx.drawImage(images[images.length - 1], 0, 0, width, height);
        await new Promise(function (r) { setTimeout(r, Math.max(220, frameDelay * 2)); });
        recorder.stop();
      } catch (error) {
        if (recorder.state !== 'inactive') recorder.stop();
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    })();
  });
}

export
  function formatFramebufferTimestamp(isoString) {
  if (!isoString) return 'Unknown time';
  var date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export
  function formatBurstTimestamp(burstId, fallbackIso) {
  if (burstId && /^\d{8}-\d{6}$/.test(burstId)) {
    var year = Number.parseInt(burstId.slice(0, 4), 10);
    var month = Number.parseInt(burstId.slice(4, 6), 10) - 1;
    var day = Number.parseInt(burstId.slice(6, 8), 10);
    var hour = Number.parseInt(burstId.slice(9, 11), 10);
    var minute = Number.parseInt(burstId.slice(11, 13), 10);
    var second = Number.parseInt(burstId.slice(13, 15), 10);
    var date = new Date(year, month, day, hour, minute, second);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
  }
  return formatFramebufferTimestamp(fallbackIso);
}

export
  function summarizeFramebufferSelection(selectedItem) {
  if (!selectedItem) return 'Latest preview';
  if (selectedItem.kind === 'burst') {
    return 'Selected burst • ' + selectedItem.frameCount + ' frames';
  }
  return 'Selected single capture';
}

export
  async function previewSelectedFramebufferItem(selectedItem) {
  var selectionSummaryDiv = document.getElementById('framebuffer-selection-summary');
  if (!selectedItem) {
    if (window.stopBurstFrameAnimation) window.stopBurstFrameAnimation();
    setFramebufferPreviewSource('/api/computer/screengrab/latest?t=' + Date.now());
    return;
  }
  if (selectedItem.kind !== 'burst') {
    if (window.stopBurstFrameAnimation) window.stopBurstFrameAnimation();
    setFramebufferPreviewSource('/api/computer/screengrab/file/' + encodeURIComponent(selectedItem.previewName || selectedItem.name) + '?t=' + Date.now());
    return;
  }
  // Burst: animate frames directly on the <img> — no codec required
  if (window.startBurstFrameAnimation) window.startBurstFrameAnimation(selectedItem);
  if (selectionSummaryDiv) {
    selectionSummaryDiv.textContent = 'Burst animation \u2022 ' + selectedItem.frameCount + ' frames @ ' + (selectedItem.playbackFps || 8) + ' fps';
  }
  dashboardLog('computer', 'framebuffer.burst.animate', 'Animating burst ' + (selectedItem.burstId || selectedItem.name) + ' (' + selectedItem.frameCount + ' frames)');
}

export async function refreshFramebufferGallery() {
  var gallery = document.getElementById('framebuffer-gallery');
  var controls = document.getElementById('framebuffer-gallery-controls');
  var pathDiv = document.getElementById('framebuffer-path');
  var summaryDiv = document.getElementById('framebuffer-gallery-summary');
  var selectionSummaryDiv = document.getElementById('framebuffer-selection-summary');
  if (!gallery || !controls || !pathDiv) return;
  try {
    var data = await request('/api/computer/screengrab/list');
    var galleryItems = data.galleryItems || data.files || [];
    framebufferGalleryItems = galleryItems;
    var pathInfo = data.directory || 'Unavailable';
    pathDiv.textContent = pathInfo;
    var singles = 0;
    var bursts = 0;
    for (var countIndex = 0; countIndex < galleryItems.length; countIndex++) {
      if (galleryItems[countIndex].kind === 'burst') bursts += 1;
      else singles += 1;
    }
    if (summaryDiv) summaryDiv.innerHTML = '<strong>Singles ' + singles + '</strong> • <strong>Bursts ' + bursts + '</strong> • Showing ' + galleryItems.length;
    if (galleryItems.length > 0) {
      var hasSelection = false;
      for (var j = 0; j < galleryItems.length; j++) {
        if (galleryItems[j].name === selectedFramebufferFile) {
          hasSelection = true;
          break;
        }
      }
      if (!hasSelection) selectedFramebufferFile = galleryItems[0].name;
    } else {
      selectedFramebufferFile = null;
    }
    var selectedItem = null;
    for (var selectedIndex = 0; selectedIndex < galleryItems.length; selectedIndex++) {
      if (galleryItems[selectedIndex].name === selectedFramebufferFile) {
        selectedItem = galleryItems[selectedIndex];
        break;
      }
    }
    if (selectionSummaryDiv) selectionSummaryDiv.textContent = summarizeFramebufferSelection(selectedItem);
    var html = '';
    for (var i = 0; i < Math.min(galleryItems.length, 20); i++) {
      var item = galleryItems[i];
      var timestampLabel = item.kind === 'burst'
        ? formatBurstTimestamp(item.burstId, item.mtime)
        : formatFramebufferTimestamp(item.mtime);
      var title = item.kind === 'burst'
        ? 'Burst • ' + timestampLabel + ' • ' + item.frameCount + ' frames'
        : item.name + ' • ' + timestampLabel + ' • ' + Math.round(item.size / 1024) + ' KB';
      var label = item.kind === 'burst'
        ? 'Burst Session'
        : item.name.substring(0, 20);
      var badge = item.kind === 'burst'
        ? '<div class="framebuffer-item-badge burst">▶ ' + item.frameCount + ' frames</div>'
        : '<div class="framebuffer-item-badge">PNG</div>';
      html += '<div class="framebuffer-item' + (item.name === selectedFramebufferFile ? ' selected' : '') + '" data-filename="' + escapeHtml(item.name) + '" onclick="selectFramebufferFile(this)" title="' + escapeHtml(title) + '">' +
        '<div class="framebuffer-item-poster">' +
        '<img src="/api/computer/screengrab/file/' + encodeURIComponent(item.previewName || item.name) + '" alt="' + escapeHtml(item.name) + '" />' +
        badge +
        '</div>' +
        '<div class="framebuffer-item-body">' +
        '<div class="framebuffer-item-kind' + (item.kind === 'burst' ? ' burst' : '') + '">' + (item.kind === 'burst' ? 'Burst' : 'Single') + '</div>' +
        '<div class="framebuffer-item-title">' + escapeHtml(label) + '</div>' +
        '<div class="framebuffer-item-subtitle">' + escapeHtml(timestampLabel) + '</div>' +
        '</div>' +
        '</div>';
    }
    gallery.innerHTML = html || '<span class="muted" style="font-size:12px;">No screengrabs in gallery.</span>';
    if (selectedItem) {
      await previewSelectedFramebufferItem(selectedItem);
    } else if (!selectedItem && selectedFramebufferFile) {
      setFramebufferPreviewSource('/api/computer/screengrab/file/' + encodeURIComponent(selectedFramebufferFile) + '?t=' + Date.now());
    } else if (selectionSummaryDiv) {
      selectionSummaryDiv.textContent = 'Latest preview';
    }
    controls.innerHTML = '';
    if (galleryItems.length > 0) {
      controls.innerHTML = '<button onclick="openFramebufferFile()">📂 Open In Browser</button>' +
        '<button onclick="revealFramebufferFile()">📁 Reveal In Explorer</button>' +
        '<button onclick="refreshFramebufferGallery()">🔄 Refresh</button>';
    }
  } catch (e) {
    if (summaryDiv) summaryDiv.textContent = 'Gallery unavailable';
    if (selectionSummaryDiv) selectionSummaryDiv.textContent = 'Preview unavailable';
    gallery.innerHTML = '<span class="muted" style="font-size:12px;">Gallery load failed.</span>';
    controls.innerHTML = '';
  }
}

export function selectFramebufferFile(element) {
  if (!element) return;
  selectedFramebufferFile = element.getAttribute('data-filename');
  var items = document.querySelectorAll('.framebuffer-item');
  items.forEach(function (item) { item.classList.remove('selected'); });
  element.classList.add('selected');
  if (selectedFramebufferFile) {
    var selectedItem = null;
    for (var i = 0; i < framebufferGalleryItems.length; i++) {
      if (framebufferGalleryItems[i].name === selectedFramebufferFile) {
        selectedItem = framebufferGalleryItems[i];
        break;
      }
    }
    previewSelectedFramebufferItem(selectedItem);
  }
}

export
  async function openFramebufferFile() {
  if (!selectedFramebufferFile) { alert('Select a file first'); return; }
  window.open('/api/computer/screengrab/file/' + encodeURIComponent(selectedFramebufferFile), '_blank');
}

export
  async function revealFramebufferFile() {
  if (!selectedFramebufferFile) { alert('Select a file first'); return; }
  try {
    await request('/api/computer/reveal-file', { method: 'POST', body: JSON.stringify({ filename: selectedFramebufferFile }), headers: { 'Content-Type': 'application/json' } });
    dashboardLog('computer', 'framebuffer.reveal', 'Opened file in Explorer');
  } catch (e) {
    console.error('Reveal failed', e);
  }
}

export
  async function openFramebufferFolder() {
  try {
    var pathDiv = document.getElementById('framebuffer-path');
    var path = pathDiv ? pathDiv.textContent : '';
    if (!path) {
      var data = await request('/api/computer/screengrab/list');
      path = data.directory || '';
    }
    await request('/api/computer/exec', { method: 'POST', body: JSON.stringify({ command: 'explorer.exe "' + path + '"' }), headers: { 'Content-Type': 'application/json' } });
    dashboardLog('computer', 'framebuffer.open_folder', 'Opened framebuffer folder');
  } catch (e) {
    console.error('Folder open failed', e);
  }
}

export
  function toggleFramebufferAutoRefresh() {
  state.framebufferAutoRefresh = !state.framebufferAutoRefresh;
  var btn = document.getElementById('fb-auto-toggle');
  if (btn) {
    btn.textContent = 'Auto-Refresh: ' + (state.framebufferAutoRefresh ? 'ON' : 'OFF');
    if (state.framebufferAutoRefresh) btn.classList.add('fb-toggle-active');
    else btn.classList.remove('fb-toggle-active');
  }
  if (state.framebufferAutoRefresh) {
    if (state.framebufferPollInterval) clearInterval(state.framebufferPollInterval);
    state.framebufferPollInterval = setInterval(refreshFramebufferViewer, 2000);
  } else {
    if (state.framebufferPollInterval) { clearInterval(state.framebufferPollInterval); state.framebufferPollInterval = null; }
  }
}

export async function refreshAdapterStatus() {
  try {
    state.adapterStatus = await request('/api/system/adapters');
    renderAdapterStatus();
  } catch (e) { console.error('[computer] adapter status failed', e); }
}

export function renderAdapterStatus() {
  var container = document.getElementById('adapter-status-container');
  if (!container) return;
  var status = state.adapterStatus;
  if (!status) return;

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;">';

  // PTY Status
  var ptyColor = status.terminal.enabled ? 'var(--accent)' : 'var(--danger)';
  html += '<div class="panel" style="padding:12px;border-left:4px solid ' + ptyColor + ';">';
  html += '<div class="muted" style="font-size:11px;">PTY Execution (Terminal)</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">';
  html += '<span style="font-size:14px;font-weight:600;">' + (status.terminal.enabled ? 'HARDENED' : 'LEGACY') + '</span>';
  html += '<span class="stg-badge ' + (status.terminal.enabled ? 'stg-badge-blue' : 'stg-badge-amber') + '" style="font-size:9px;">' + escapeHtml(status.terminal.backend) + '</span>';
  html += '</div></div>';

  // Container Status
  var sandboxColor = status.container.enabled ? 'var(--accent-2)' : 'var(--danger)';
  html += '<div class="panel" style="padding:12px;border-left:4px solid ' + sandboxColor + ';">';
  html += '<div class="muted" style="font-size:11px;">Container Sandbox (Filesystem)</div>';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">';
  html += '<span style="font-size:14px;font-weight:600;">' + (status.container.enabled ? 'ISOLATED' : 'VIRTUAL') + '</span>';
  html += '<span class="stg-badge ' + (status.container.enabled ? 'stg-badge-green' : 'stg-badge-amber') + '" style="font-size:9px;">' + escapeHtml(status.container.backend) + '</span>';
  html += '</div></div>';

  html += '</div>';
  container.innerHTML = html;
}

export
  async function initComputerTab() {
  if (!state.computerSystemInfo) {
    try {
      state.computerSystemInfo = await request('/api/computer/system-info');
      renderLocalSystemInfo();
    } catch (e) { console.error('[computer] system info failed', e); }
  }
  refreshBrowserInfo();
  if (state.computerPollInterval) { clearInterval(state.computerPollInterval); state.computerPollInterval = null; }
  async function pollAll() {
    try {
      var data = await request('/api/computer/usage');
      renderUsageMetrics(data);
    } catch (e) { console.error('[computer] usage poll failed', e); }
    refreshAdapterStatus();
  }
  pollAll();
  state.computerPollInterval = setInterval(pollAll, 5000);
  await refreshFramebufferGallery();
  if (state.framebufferAutoRefresh && !state.framebufferPollInterval) {
    state.framebufferPollInterval = setInterval(refreshFramebufferViewer, 2000);
  }
  initFramebufferInteraction();
}

export function initFramebufferInteraction() {
  const img = document.getElementById('framebuffer-preview');
  if (!img) return;
  img.style.cursor = 'crosshair';
  img.onclick = null; // Remove the default window.open(this.src) click handler from template

  img.addEventListener('mousemove', function (e) {
    const rect = img.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    const meta = document.getElementById('fb-meta');
    if (meta && !meta.dataset.busy) {
      meta.textContent = 'Cursor: ' + Math.round(xPct * 100) + '%, ' + Math.round(yPct * 100) + '%';
    }
  });

  img.addEventListener('click', async function (e) {
    if (framebufferBurstAnimationInterval) return;
    const rect = img.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    const targetX = Math.round(xPct * img.naturalWidth);
    const targetY = Math.round(yPct * img.naturalHeight);
    const meta = document.getElementById('fb-meta');
    if (meta) {
      meta.textContent = 'Moving mouse to ' + targetX + ', ' + targetY + '...';
      meta.dataset.busy = "true";
    }
    try {
      await request('/api/agentic/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'computer',
          args: { action: 'mouse_move', coordinate: [targetX, targetY] }
        })
      });
      if (meta) meta.textContent = 'Moved to ' + targetX + ', ' + targetY;
      setTimeout(refreshFramebufferViewer, 500);
    } catch (err) {
      if (meta) meta.textContent = 'Move failed: ' + err.message;
    } finally {
      if (meta) delete meta.dataset.busy;
    }
  });
}

export async function pollUsage() {

  try {
    var data = await request('/api/computer/usage');
    renderUsageMetrics(data);
  } catch (e) { console.error('[computer] usage poll failed', e); }
}
