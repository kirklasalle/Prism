import { state, request, escapeHtml, dashboardLog, formatUptime } from './dashboard-core.js';

// ── Guardian Agent Panel ────────────────────────────────────────────

export
  function renderGuardianPanel() {
  var c = document.getElementById('guardian-panel-container');
  if (!c) return;
  var g = state.guardianStatus;
  if (!g) {
    c.innerHTML = '<div class="muted" style="text-align:center;padding:24px;">Guardian status unavailable. <button class="secondary-button" style="font-size:11px;padding:3px 10px;" onclick="refreshGuardianStatus()">Refresh</button></div>';
    return;
  }
  var stateColor = g.state === 'running' ? '#7ecf7e' : g.state === 'healing' ? '#ffd17a' : g.state === 'error' ? '#ff8d8d' : '#888';
  var uptimeStr = g.uptime > 0 ? formatUptime(g.uptime / 1000) : '\u2014';

  var html = '';
  // Status banner
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">State</div><div style="font-size:18px;font-weight:700;color:' + stateColor + ';">' + escapeHtml(g.state) + '</div></div>';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">Model</div><div style="font-size:14px;font-weight:600;color:var(--accent);">' + escapeHtml(g.modelAlias || 'none') + '</div></div>';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">Uptime</div><div style="font-size:14px;font-weight:600;">' + escapeHtml(uptimeStr) + '</div></div>';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">Health Checks</div><div style="font-size:18px;font-weight:700;color:var(--accent);">' + g.healthChecks + '</div></div>';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">Issues Found</div><div style="font-size:18px;font-weight:700;color:' + (g.issuesDetected > 0 ? '#ff8d8d' : 'var(--accent)') + ';">' + g.issuesDetected + '</div></div>';
  html += '<div class="panel" style="text-align:center;padding:12px;"><div class="muted" style="font-size:10px;">Issues Fixed</div><div style="font-size:18px;font-weight:700;color:#7ecf7e;">' + g.issuesResolved + '</div></div>';
  html += '</div>';

  // Start / Stop control bar
  html += '<div style="display:flex;gap:8px;margin-bottom:12px;">';
  if (g.state === 'running' || g.state === 'starting' || g.state === 'healing') {
    html += '<button class="secondary-button" style="padding:8px 20px;font-size:13px;font-weight:700;background:rgba(255,80,80,0.15);border:1px solid #ff8d8d;color:#ff8d8d;" onclick="stopGuardian()">\u23F9 Stop Guardian</button>';
  } else {
    html += '<button class="primary-button" style="padding:8px 20px;font-size:13px;font-weight:700;" onclick="startGuardian()" ' + (g.modelPath ? '' : 'disabled title="Select a model first"') + '>\u25B6 Start Guardian</button>';
  }
  html += '</div>';

  // Model Selection Dropdown
  html += '<div class="panel" style="padding:12px;margin-bottom:12px;border:1px solid rgba(126,207,126,0.2);">';
  html += '<div style="font-weight:600;font-size:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">';
  html += '<span>\u{1F50D} Local Model Selection (GGUF)</span>';
  html += '<div style="display:flex;gap:6px;">';
  html += '<button id="add-to-recommended-btn" class="secondary-button" style="font-size:10px;padding:2px 8px;" onclick="addToRecommended()" ' + (g.modelPath ? '' : 'disabled title="Select a model first"') + '>\u2795 Add to Recommended</button>';
  html += '<button id="download-recommended-btn" class="primary-button" style="font-size:10px;padding:2px 8px;" onclick="downloadRecommendedModels()">\u{1F4E5} Download Recommended</button>';
  html += '<button id="scan-models-btn" class="secondary-button" style="font-size:10px;padding:2px 8px;" onclick="refreshLocalModels()">\u{1F504} Scan for Models</button>';
  html += '</div>';
  html += '</div>';

  html += '<div style="display:flex;gap:8px;">';
  html += '<select id="guardian-model-select" style="flex:1;padding:6px;border-radius:4px;background:rgba(0,0,0,0.2);color:var(--text);border:1px solid var(--border);font-size:12px;" onchange="updateGuardianModel(this.value)">';
  html += '<option value="">-- Select a local GGUF model --</option>';

  var models = state.localGgufModels || [];
  for (var m of models) {
    var selected = g.modelPath === m.path ? ' selected' : '';
    html += '<option value="' + escapeHtml(m.path) + '"' + selected + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.source) + ')</option>';
  }
  html += '</select>';
  html += '</div>';

  if (g.modelPath) {
    var modelSource = g.modelSource || '';
    var matchedModel = models.find(function (m) { return m.path === g.modelPath; });
    if (!modelSource && matchedModel) modelSource = matchedModel.source;
    var sourceLabel = modelSource === 'ollama' ? 'Ollama' : modelSource === 'workspace-models' ? 'Local (workspace/models)' : modelSource === 'workspace' ? 'Local (workspace)' : modelSource || 'unknown';
    var providerLabel = modelSource === 'ollama' ? 'Ollama' : 'llama.cpp';
    html += '<div style="font-size:11px;margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
    html += '<span style="background:rgba(126,207,126,0.15);color:#7ecf7e;padding:1px 6px;border-radius:3px;font-size:10px;">\u{1F4CD} ' + escapeHtml(sourceLabel) + '</span>';
    html += '<span style="background:rgba(100,180,255,0.15);color:#7eb8ff;padding:1px 6px;border-radius:3px;font-size:10px;">\u2699 ' + escapeHtml(providerLabel) + '</span>';
    html += '</div>';
    html += '<div style="font-size:10px;color:var(--muted);margin-top:4px;word-break:break-all;"><strong>Path:</strong> ' + escapeHtml(g.modelPath) + '</div>';
  } else {
    html += '<div style="font-size:11px;color:#ff8d8d;margin-top:6px;">\u26A0 No model selected. Please select a model before starting.</div>';
  }
  html += '</div>';

  // Recommended Models & Downloads
  html += '<div class="panel" style="padding:12px;margin-bottom:12px;background:rgba(126,207,126,0.05);">';
  html += '<div style="font-weight:600;font-size:11px;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;color:var(--accent);">Recommended for Prism</div>';

  // Active Downloads
  if (activeDownloads.length > 0) {
    html += '<div style="margin-bottom:12px;">';
    for (var dl of activeDownloads) {
      var pct = Math.round(dl.progress || 0);
      var statusColor = dl.status === 'error' ? '#ff8d8d' : dl.status === 'completed' ? '#7ecf7e' : 'var(--accent)';
      html += '<div style="margin-bottom:6px;font-size:11px;">';
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">';
      html += '<span>\u2913 ' + escapeHtml(dl.fileName) + '</span>';
      html += '<span style="color:' + statusColor + ';">' + (dl.status === 'downloading' ? pct + '%' : escapeHtml(dl.status)) + '</span>';
      html += '</div>';
      html += '<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">';
      html += '<div style="height:100%;width:' + pct + '%;background:' + statusColor + ';transition:width 0.3s ease;"></div>';
      html += '</div>';
      if (dl.error) html += '<div style="font-size:9px;color:#ff8d8d;margin-top:2px;">' + escapeHtml(dl.error) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  var allRecommended = getAllRecommended();

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
  for (var i = 0; i < allRecommended.length; i++) {
    var rm = allRecommended[i];
    var isDownloaded = models.some(m => m.name === rm.fileName && (m.source === 'workspace-models' || m.source === 'workspace'));
    html += '<div class="panel" style="padding:8px;background:rgba(0,0,0,0.2);display:flex;flex-direction:column;justify-content:space-between;">';
    html += '<div>';
    html += '<div style="font-weight:700;font-size:11px;margin-bottom:2px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<span>' + escapeHtml(rm.name) + '</span>';
    if (rm.custom) {
      html += '<button style="background:none;border:none;color:#ff8d8d;cursor:pointer;font-size:12px;padding:0 2px;" onclick="removeFromRecommended(\'' + escapeHtml(rm.fileName) + '\')" title="Remove from recommended">\u2715</button>';
    }
    html += '</div>';
    html += '<div class="muted" style="font-size:10px;">Size: ' + rm.size + (rm.custom ? ' \u00B7 <span style="color:var(--accent);">Custom</span>' : '') + '</div>';
    html += '</div>';
    if (isDownloaded) {
      html += '<button class="secondary-button" style="width:100%;margin-top:8px;font-size:10px;padding:4px;opacity:0.6;" disabled>\u2705 Ready</button>';
    } else if (rm.url) {
      var isDownloading = activeDownloads.some(d => d.fileName === rm.fileName && d.status !== 'error' && d.status !== 'completed');
      html += '<button class="primary-button" style="width:100%;margin-top:8px;font-size:10px;padding:4px;" ' + (isDownloading ? 'disabled' : '') + ' onclick="startModelDownload(' + i + ')">' + (isDownloading ? '\u{1F4E5} Downloading...' : '\u{1F4E5} Download to Prism') + '</button>';
    } else {
      html += '<button class="secondary-button" style="width:100%;margin-top:8px;font-size:10px;padding:4px;opacity:0.6;" disabled>\u2705 Available Locally</button>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';

  // Model slot info
  if (g.slotInfo) {
    var s = g.slotInfo;
    html += '<div class="panel" style="padding:10px;margin-bottom:10px;">';
    html += '<div class="muted" style="font-size:10px;margin-bottom:4px;">llama-server Slot #' + s.id + ' \u00B7 Port ' + s.port + '</div>';
    html += '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;">';
    html += '<span>Context: <strong>' + s.contextSize + '</strong></span>';
    html += '<span>GPU Layers: <strong>' + (s.gpuLayers !== null ? s.gpuLayers : 'auto') + '</strong></span>';
    html += '<span>Flash Attn: <strong>' + (s.flashAttn ? 'ON' : 'OFF') + '</strong></span>';
    if (s.draftModelPath) {
      html += '<span style="color:var(--accent);">\u26A1 Speculative: <strong>ON</strong> (draft-max=' + s.draftMax + ')</span>';
    }
    html += '</div></div>';
  }

  // Authority & config
  html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:12px;">';
  html += '<span class="muted">Authority:</span> <strong>' + escapeHtml(g.authorityTier) + '</strong>';
  html += '<span class="muted" style="margin-left:12px;">Last Check:</span> <span>' + (g.lastHealthCheck ? new Date(g.lastHealthCheck).toLocaleTimeString() : '\u2014') + '</span>';
  html += '</div>';

  // Recent actions feed
  var actions = g.recentActions || [];
  if (actions.length > 0) {
    html += '<div class="muted" style="font-size:10px;margin-bottom:4px;">Recent Guardian Actions</div>';
    html += '<div style="max-height:180px;overflow-y:auto;font-size:11px;">';
    for (var i = actions.length - 1; i >= Math.max(0, actions.length - 8); i--) {
      var a = actions[i];
      var rColor = a.result === 'success' ? '#7ecf7e' : a.result === 'escalated' ? '#ffd17a' : '#ff8d8d';
      html += '<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
      html += '<span class="muted" style="min-width:70px;">' + new Date(a.timestamp).toLocaleTimeString() + '</span>';
      html += '<span style="color:' + rColor + ';min-width:60px;">' + escapeHtml(a.result) + '</span>';
      html += '<span>' + escapeHtml(a.detail) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // ── Guardian Tasks Panel ──────────────────────────────────────────
  var tasks = state.guardianTasks || [];
  html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  html += '<span style="font-weight:600;font-size:13px;">🛡️ Guardian Tasks</span>';
  html += '<button class="primary-button" onclick="runAllGuardianTasks()" style="font-size:11px;padding:3px 10px;" ' + (g.state !== 'running' ? 'disabled' : '') + '>▶ Run All</button>';
  html += '</div>';
  if (tasks.length === 0) {
    html += '<div class="muted" style="font-size:11px;padding:8px;">No tasks loaded. Start Guardian to activate task runners.</div>';
  } else {
    var categories = ['monitoring', 'maintenance', 'security', 'diagnostics'];
    var catLabels = { monitoring: '📊 Monitoring', maintenance: '🔧 Maintenance', security: '🔒 Security', diagnostics: '🔍 Diagnostics' };
    var catColors = { monitoring: '#7ec8e3', maintenance: '#b8d4a3', security: '#ffb347', diagnostics: '#c4a3d4' };
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var catTasks = tasks.filter(function (t) { return t.category === cat; });
      if (catTasks.length === 0) continue;
      html += '<div style="margin-bottom:10px;">';
      html += '<div style="font-size:11px;font-weight:600;color:' + catColors[cat] + ';margin-bottom:4px;">' + catLabels[cat] + '</div>';
      for (var ti = 0; ti < catTasks.length; ti++) {
        var task = catTasks[ti];
        var statusIcon = !task.lastResult ? '⏳' : task.lastResult === 'success' ? '✅' : task.lastResult === 'warning' ? '⚠️' : '❌';
        var statusColor = !task.lastResult ? '#888' : task.lastResult === 'success' ? '#7ecf7e' : task.lastResult === 'warning' ? '#ffd17a' : '#ff8d8d';
        var lastRun = task.lastRunAt ? new Date(task.lastRunAt).toLocaleTimeString() : 'never';
        html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;margin-bottom:2px;background:rgba(255,255,255,0.02);border-radius:4px;font-size:11px;">';
        html += '<label style="cursor:pointer;display:flex;align-items:center;gap:4px;min-width:16px;">';
        html += '<input type="checkbox" ' + (task.enabled ? 'checked' : '') + ' onchange="toggleGuardianTask(\'' + task.id + '\')" style="cursor:pointer;" ' + (g.state !== 'running' ? 'disabled' : '') + '>';
        html += '</label>';
        html += '<span style="flex:1;">' + escapeHtml(task.name) + '</span>';
        html += '<span style="color:' + statusColor + ';min-width:20px;text-align:center;" title="' + escapeHtml(task.lastDetail || 'No result yet') + '">' + statusIcon + '</span>';
        html += '<span class="muted" style="min-width:60px;font-size:10px;text-align:right;" title="Last run">' + lastRun + '</span>';
        html += '<button onclick="runGuardianTask(\'' + task.id + '\')" style="font-size:10px;padding:1px 6px;cursor:pointer;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:3px;color:#ccc;" ' + (g.state !== 'running' ? 'disabled' : '') + '>Run</button>';
        html += '</div>';
        if (task.lastDetail) {
          html += '<div class="muted" style="font-size:10px;padding:0 8px 2px 28px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(task.lastDetail) + '">' + escapeHtml(task.lastDetail) + '</div>';
        }
      }
      html += '</div>';
    }
  }
  html += '</div>';

  c.innerHTML = html;
}


export
  async function refreshGuardianStatus() {
  try {
    state.guardianStatus = await request('/api/guardian/status');
    renderGuardianPanel();
  } catch (e) { console.error('[guardian] refresh failed', e); }
}

export
  async function startGuardian() {
  try {
    state.guardianStatus = await request('/api/guardian/start', { method: 'POST' });
    renderGuardianPanel();
    dashboardLog('agentic', 'guardian.start', 'Guardian agent started');
  } catch (e) { console.error('[guardian] start failed', e); }
}

// v0.20.5 — Auto-start the Guardian Agent on client load when a local model is
// configured. Operators expect Guardian to be running by default (per user
// preference: start_web.bat is the single reliable entrypoint). Idempotent and
// guarded by `state.guardianAutoStartAttempted` so it runs at most once per
// page session. Operators can opt out by setting
// `localStorage['prism.guardian.autostart'] = 'false'` in DevTools.
export
  async function autoStartGuardianIfConfigured() {
  if (state.guardianAutoStartAttempted) return;
  state.guardianAutoStartAttempted = true;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('prism.guardian.autostart') === 'false') {
      dashboardLog('agentic', 'guardian.autostart.skipped', 'Auto-start disabled via localStorage');
      return;
    }
  } catch (_) { /* localStorage may be unavailable in some sandboxes */ }
  try {
    if (!state.guardianStatus) {
      try { state.guardianStatus = await request('/api/guardian/status'); }
      catch (_) { /* leave status null — panel handles unavailable case */ }
    }
    var g = state.guardianStatus;
    if (!g) return;
    // Only autostart if a model is configured and Guardian is not already up.
    if (!g.modelPath) {
      dashboardLog('agentic', 'guardian.autostart.deferred', 'No local model selected; skipping auto-start');
      return;
    }
    if (g.state === 'running' || g.state === 'starting' || g.state === 'healing') {
      return;
    }
    dashboardLog('agentic', 'guardian.autostart', 'Auto-starting Guardian agent');
    await startGuardian();
  } catch (e) {
    console.error('[guardian] autostart failed', e);
    dashboardLog('agentic', 'guardian.autostart.error', 'Auto-start failed: ' + (e && e.message ? e.message : e));
  }
}

export
  async function stopGuardian() {
  try {
    state.guardianStatus = await request('/api/guardian/stop', { method: 'POST' });
    renderGuardianPanel();
    dashboardLog('agentic', 'guardian.stop', 'Guardian agent stopped');
  } catch (e) { console.error('[guardian] stop failed', e); }
}

export
  async function refreshLocalModels() {
  var btn = document.getElementById('scan-models-btn');
  if (btn) { btn.disabled = true; btn.textContent = '\u{1F504} Scanning\u2026'; }
  try {
    const data = await request('/api/models/gguf');
    state.localGgufModels = data.models || [];
    renderGuardianPanel();
    dashboardLog('agentic', 'models.scan', 'Scanned ' + state.localGgufModels.length + ' local GGUF and Ollama models');
  } catch (e) {
    console.error('[guardian] scan failed', e);
    if (btn) { btn.disabled = false; btn.textContent = '\u{1F504} Scan for Models'; }
    dashboardLog('agentic', 'models.scan.error', 'Model scan failed: ' + (e.message || e));
  }
}

const RECOMMENDED_MODELS = [
  {
    name: "Qwen3-VL:4b (High Quality)",
    fileName: "Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
    size: "3.3 GB",
    url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
    mmprojUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf",
    mmprojName: "mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf",
    ollamaTag: "qwen2.5-vl:3b-q8_0"
  },
  {
    name: "Qwen3-VL:2b-thinking (Efficient)",
    fileName: "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
    size: "1.9 GB",
    url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
    mmprojUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf",
    mmprojName: "mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf",
    ollamaTag: "qwen2.5-vl:3b-q4_K_M"
  }
];

let activeDownloads = [];

function getAllRecommended() {
  var all = RECOMMENDED_MODELS.slice();
  var customModels = state.customRecommendedModels || [];
  for (var ci = 0; ci < customModels.length; ci++) {
    var cm = customModels[ci];
    if (!all.some(function (r) { return r.fileName === cm.fileName; })) {
      all.push({ name: cm.name, fileName: cm.fileName, size: cm.size, url: '', mmprojUrl: '', mmprojName: '', ollamaTag: '', custom: true, path: cm.path, source: cm.source });
    }
  }
  return all;
}

export async function downloadRecommendedModels() {
  var models = state.localGgufModels || [];
  var toDownload = getAllRecommended().filter(function (rm) {
    if (!rm.url) return false;
    var alreadyHave = models.some(function (m) { return m.name === rm.fileName && (m.source === 'workspace-models' || m.source === 'workspace'); });
    var alreadyDownloading = activeDownloads.some(function (d) { return d.fileName === rm.fileName && d.status !== 'error' && d.status !== 'completed'; });
    return !alreadyHave && !alreadyDownloading;
  });
  if (toDownload.length === 0) {
    var btn = document.getElementById('download-recommended-btn');
    if (btn) { btn.textContent = '\u2705 All Ready'; setTimeout(function () { btn.textContent = '\uD83D\uDCE5 Download Recommended'; }, 2000); }
    dashboardLog('agentic', 'download.skip', 'All recommended models are already downloaded or in progress');
    return;
  }
  var btn = document.getElementById('download-recommended-btn');
  if (btn) { btn.disabled = true; btn.textContent = '\u{1F4E5} Downloading\u2026'; }
  for (var i = 0; i < toDownload.length; i++) {
    var rm = toDownload[i];
    try {
      await request('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rm.url, name: rm.fileName, mmprojUrl: rm.mmprojUrl, mmprojName: rm.mmprojName })
      });
      dashboardLog('agentic', 'download.start', 'Download initiated for ' + rm.name);
    } catch (err) {
      dashboardLog('agentic', 'download.hf-failed', 'HuggingFace download failed for ' + rm.name + ': ' + err.message + '. Trying Ollama fallback...');
      if (rm.ollamaTag) {
        try {
          await request('/api/models/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: rm.ollamaTag }) });
          dashboardLog('agentic', 'download.ollama-fallback', 'Ollama pull initiated for ' + rm.ollamaTag);
        } catch (ollamaErr) {
          dashboardLog('agentic', 'download.failed', 'Both HuggingFace and Ollama pull failed for ' + rm.name);
        }
      }
    }
  }
  pollDownloadStatus();
}

export async function startModelDownload(index) {
  var model = getAllRecommended()[index];
  if (!model || !model.url) return;
  try {
    await request('/api/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: model.url,
        name: model.fileName,
        mmprojUrl: model.mmprojUrl,
        mmprojName: model.mmprojName
      })
    });
    dashboardLog('agentic', 'download.start', `Download initiated for ${model.name}`);
    pollDownloadStatus();
  } catch (err) {
    dashboardLog('agentic', 'download.hf-failed', `HuggingFace download failed for ${model.name}: ${err.message}. Trying Ollama pull fallback...`);
    if (model.ollamaTag) {
      try {
        await request('/api/models/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: model.ollamaTag })
        });
        dashboardLog('agentic', 'download.ollama-fallback', `Ollama pull initiated for ${model.ollamaTag}`);
        pollDownloadStatus();
      } catch (ollamaErr) {
        dashboardLog('agentic', 'download.failed', `Both HuggingFace and Ollama pull failed for ${model.name}`);
        alert(`Download failed. HuggingFace: ${err.message}. Ollama fallback: ${ollamaErr.message}`);
      }
    } else {
      alert(`Download failed: ${err.message}`);
    }
  }
}

async function pollDownloadStatus() {
  try {
    const data = await request('/api/models/download/status');
    activeDownloads = data.downloads || [];
    renderGuardianPanel();
    if (activeDownloads.some(d => d.status === 'downloading' || d.status === 'pending')) {
      setTimeout(pollDownloadStatus, 2000);
    } else if (activeDownloads.some(d => d.status === 'completed')) {
      refreshLocalModels();
    }
  } catch (err) {
    console.error("Failed to poll download status", err);
  }
}

export
  async function updateGuardianModel(path) {
  if (!path) return;
  var models = state.localGgufModels || [];
  var model = models.find(m => m.path === path);
  if (!model) return;

  await configureGuardian({
    modelPath: model.path,
    modelAlias: model.name.replace(/\.gguf$/i, ''),
    modelSource: model.source
  });
}

export
  async function configureGuardian(update) {
  try {
    state.guardianStatus = await request('/api/guardian/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update)
    });
    renderGuardianPanel();
    dashboardLog('agentic', 'guardian.configure', 'Guardian reconfigured');
  } catch (e) { console.error('[guardian] configure failed', e); }
}

export
  async function addToRecommended() {
  var sel = document.getElementById('guardian-model-select');
  if (!sel || !sel.value) return;
  var models = state.localGgufModels || [];
  var model = models.find(function (m) { return m.path === sel.value; });
  if (!model) return;
  try {
    var data = await request('/api/models/recommended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model.name.replace(/\.gguf$/i, ''), fileName: model.name, path: model.path, source: model.source })
    });
    state.customRecommendedModels = data.custom || [];
    renderGuardianPanel();
    dashboardLog('agentic', 'models.recommend', 'Added ' + model.name + ' to recommended models');
  } catch (e) {
    dashboardLog('agentic', 'models.recommend.error', 'Failed to add to recommended: ' + (e.message || e), 'warning');
  }
}

export
  async function removeFromRecommended(fileName) {
  try {
    var data = await request('/api/models/recommended', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: fileName })
    });
    state.customRecommendedModels = data.custom || [];
    renderGuardianPanel();
    dashboardLog('agentic', 'models.unrecommend', 'Removed ' + fileName + ' from recommended models');
  } catch (e) {
    dashboardLog('agentic', 'models.unrecommend.error', 'Failed to remove from recommended: ' + (e.message || e), 'warning');
  }
}

export
  async function loadCustomRecommendedModels() {
  try {
    var data = await request('/api/models/recommended');
    state.customRecommendedModels = data.custom || [];
  } catch (e) { /* best-effort */ }
}

export
  async function refreshGuardianTasks() {
  try {
    var data = await request('/api/guardian/tasks');
    state.guardianTasks = data.tasks || [];
    renderGuardianPanel();
  } catch (e) { /* best-effort */ }
}

export
  async function runGuardianTask(taskId) {
  try {
    await request('/api/guardian/tasks/' + encodeURIComponent(taskId) + '/run', { method: 'POST' });
    await refreshGuardianTasks();
  } catch (e) { console.error('runGuardianTask failed:', e); }
}

export
  async function toggleGuardianTask(taskId) {
  try {
    await request('/api/guardian/tasks/' + encodeURIComponent(taskId) + '/toggle', { method: 'POST' });
    await refreshGuardianTasks();
  } catch (e) { console.error('toggleGuardianTask failed:', e); }
}

export
  async function runAllGuardianTasks() {
  try {
    await request('/api/guardian/tasks/run-all', { method: 'POST' });
    await refreshGuardianTasks();
  } catch (e) { console.error('runAllGuardianTasks failed:', e); }
}

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
  if (!state.guardianStatus) await refreshGuardianStatus();
  if (!state.localGgufModels) await refreshLocalModels();
  if (!state.customRecommendedModels) await loadCustomRecommendedModels();
  if (!state.guardianTasks) await refreshGuardianTasks();
  // Initialize new autonomous panels
  refreshAABLedger();
  refreshAutonomousGoals();
  // Best-effort auto-start once status + models are known. No-op if already
  // attempted, already running, or no model configured.
  autoStartGuardianIfConfigured();
}

/* ── AAB Ledger Panel ──────────────────────────────────────────────── */

export async function refreshAABLedger() {
  try {
    var data = await request('/api/autonomous/aab-ledger');
    var entries = data.entries || [];
    var badge = document.getElementById('aab-ledger-badge');
    if (badge) badge.textContent = entries.length + ' entries';
    var tbody = document.getElementById('aab-ledger-body');
    if (!tbody) return;
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">No AAB entries yet. The ledger populates when autonomous goals are executed.</td></tr>';
      return;
    }
    var html = '';
    // Show newest first
    for (var i = entries.length - 1; i >= Math.max(0, entries.length - 50); i--) {
      var e = entries[i];
      var interventionColor = e.intervention === 'terminate' ? '#ff8d8d' : e.intervention === 'pause' ? '#ffd17a' : e.intervention === 'rate_limit' ? '#7ec8e3' : '#888';
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
      html += '<td style="padding:4px 8px;white-space:nowrap;">' + new Date(e.timestamp).toLocaleTimeString() + '</td>';
      html += '<td style="padding:4px 8px;font-family:monospace;font-size:11px;">' + escapeHtml((e.goalId || '').substring(0, 8)) + '</td>';
      html += '<td style="padding:4px 8px;">' + escapeHtml(e.anomalyType || '') + '</td>';
      html += '<td style="padding:4px 8px;color:' + interventionColor + ';font-weight:600;">' + escapeHtml(e.intervention || '') + '</td>';
      html += '<td style="padding:4px 8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(e.description || '') + '">' + escapeHtml(e.description || '') + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  } catch (e) {
    console.warn('[agentic] AAB ledger refresh failed:', e);
  }
}

/* ── Autonomous Goals Panel ────────────────────────────────────────── */

export async function submitAutonomousGoal() {
  var objectiveEl = document.getElementById('autonomous-goal-objective');
  if (!objectiveEl || !objectiveEl.value.trim()) {
    dashboardLog('agentic', 'goal.error', 'Objective is required');
    return;
  }
  var objective = objectiveEl.value.trim();
  var maxActions = parseInt(document.getElementById('auto-goal-max-actions')?.value || '50', 10);
  var allowBrowser = document.getElementById('auto-goal-allow-browser')?.checked || false;
  var allowComputer = document.getElementById('auto-goal-allow-computer')?.checked || false;

  var badge = document.getElementById('autonomous-goals-badge');
  if (badge) badge.textContent = 'Submitting...';
  objectiveEl.value = '';

  try {
    var result = await request('/api/autonomous/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: objective,
        source: 'dashboard',
        maxActions: maxActions,
        allowBrowserUse: allowBrowser,
        allowComputerUse: allowComputer,
      })
    });
    dashboardLog('agentic', 'goal.submitted', 'Goal submitted: ' + (result.goalId || 'unknown'));
    if (badge) badge.textContent = 'Active: ' + (result.goalId || '').substring(0, 8);
    refreshAutonomousGoals();
  } catch (e) {
    dashboardLog('agentic', 'goal.error', 'Failed to submit goal: ' + (e.message || e));
    if (badge) badge.textContent = 'Error';
  }
}

export async function refreshAutonomousGoals() {
  try {
    var data = await request('/api/autonomous/goals');
    var goals = data.goals || [];
    var badge = document.getElementById('autonomous-goals-badge');

    // Check for active goal
    var active = goals.find(function (g) { return g.status === 'executing' || g.status === 'planning'; });
    if (badge) {
      badge.textContent = active
        ? '🟢 Active: ' + (active.objective || '').substring(0, 30)
        : goals.length > 0 ? goals.length + ' goals' : 'No active goal';
    }

    var container = document.getElementById('autonomous-goals-list');
    if (!container) return;
    if (goals.length === 0) {
      container.innerHTML = '<div class="muted" style="text-align:center;padding:16px;">No goals submitted yet.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < Math.min(goals.length, 20); i++) {
      var g = goals[i];
      var statusColor = g.status === 'completed' ? '#7ecf7e' : g.status === 'executing' || g.status === 'planning' ? '#7ec8e3' : g.status === 'failed' || g.status === 'terminated' ? '#ff8d8d' : g.status === 'paused' ? '#ffd17a' : '#888';
      var statusIcon = g.status === 'completed' ? '✅' : g.status === 'executing' ? '🔄' : g.status === 'planning' ? '🧠' : g.status === 'failed' ? '❌' : g.status === 'terminated' ? '⛔' : g.status === 'paused' ? '⏸' : '⏳';

      html += '<div class="panel" style="padding:10px;margin-bottom:6px;border-left:3px solid ' + statusColor + ';">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span>' + statusIcon + '</span>';
      html += '<strong style="font-size:13px;">' + escapeHtml(g.objective || '') + '</strong>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px;align-items:center;">';
      html += '<span style="color:' + statusColor + ';font-size:11px;font-weight:600;">' + escapeHtml(g.status) + '</span>';
      if (g.status === 'executing' || g.status === 'planning') {
        html += '<button class="secondary-button" style="font-size:10px;padding:1px 6px;" onclick="abortAutonomousGoal(\'' + escapeHtml(g.goalId) + '\')">⏹ Abort</button>';
      }
      html += '</div></div>';
      html += '<div style="font-size:11px;color:var(--muted);display:flex;gap:12px;">';
      html += '<span>ID: ' + escapeHtml((g.goalId || '').substring(0, 8)) + '</span>';
      html += '<span>Actions: ' + (g.totalActions || 0) + '/' + (g.constraints?.maxActions || '—') + '</span>';
      if (g.startedAt) html += '<span>Started: ' + new Date(g.startedAt).toLocaleTimeString() + '</span>';
      if (g.completedAt) html += '<span>Completed: ' + new Date(g.completedAt).toLocaleTimeString() + '</span>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  } catch (e) {
    console.warn('[agentic] goals refresh failed:', e);
  }
}

export async function abortAutonomousGoal(goalId) {
  try {
    await request('/api/autonomous/goals/' + encodeURIComponent(goalId) + '/abort', { method: 'POST' });
    dashboardLog('agentic', 'goal.aborted', 'Goal ' + goalId.substring(0, 8) + ' aborted');
    refreshAutonomousGoals();
    refreshAABLedger();
  } catch (e) {
    dashboardLog('agentic', 'goal.abort.error', 'Failed to abort goal: ' + (e.message || e));
  }
}
