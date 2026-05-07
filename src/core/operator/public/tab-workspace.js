import { state, request, escapeHtml, dashboardLog, safeRenderStep } from './dashboard-core.js';

export 
// ── Workspace Tab Functions ─────────────────────────────────────────
async function refreshWorkspaceInfo() {
var pathEl = document.getElementById('workspace-path');
if (!pathEl) return;
pathEl.textContent = 'Loading...';
try {
var info = await request('/api/workspace/info');
pathEl.textContent = info.workspaceRoot || 'Unknown';
var profileEl = document.getElementById('ws-active-profile');
if (profileEl && info.manifest && info.manifest.profile) {
  profileEl.textContent = info.manifest.profile;
}
var autoSaveEl = document.getElementById('ws-auto-save');
if (autoSaveEl) autoSaveEl.textContent = 'Enabled';
} catch (err) {
pathEl.textContent = '\u274C Error: ' + String(err);
}
refreshGitStatus();
}

export 
async function refreshGitStatus() {
var gitEl = document.getElementById('ws-git-status');
if (!gitEl) return;
gitEl.textContent = 'Checking...';
try {
var data = await request('/api/workspace/git-status');
if (data.isGitRepo) {
  gitEl.textContent = data.branch + ' (' + data.changedFiles + ' changed)';
} else {
  gitEl.textContent = 'Not a git repo';
}
} catch (e) {
gitEl.textContent = 'Unknown';
}
}

export 
async function refreshWorkspaceFiles() {
var container = document.getElementById('workspace-file-tree');
if (!container) return;
container.innerHTML = '<span class="muted">\u23F3 Loading workspace files...</span>';
try {
var data = await request('/api/workspace/files');
if (!data.entries || data.entries.length === 0) {
  container.innerHTML = '<span class="muted">Workspace is empty.</span>';
  return;
}
state._workspaceFiles = data.entries;
renderWorkspaceFileTree(data.entries, container);
} catch (err) {
container.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
}
}

export 
function renderWorkspaceFileTree(entries, container) {
var dirs = {};
entries.forEach(function(e) {
var parts = e.path.split('/');
if (parts.length === 1) {
  if (!dirs['_root']) dirs['_root'] = [];
  dirs['_root'].push(e);
} else {
  var top = parts[0];
  if (!dirs[top]) dirs[top] = [];
  dirs[top].push(e);
}
});
var html = '';
var topDirs = Object.keys(dirs).filter(function(k) { return k !== '_root'; }).sort();
topDirs.forEach(function(dirName) {
var children = dirs[dirName];
var fileCount = children.filter(function(c) { return c.type === 'file'; }).length;
html += '<details class="panel" style="padding:6px 10px;margin-bottom:3px;">';
html += '<summary style="cursor:pointer;font-weight:600;">\u{1F4C1} ' + escapeHtml(dirName);
html += ' <span class="muted" style="font-weight:normal;font-size:11px;">(' + fileCount + ' files)</span></summary>';
html += '<div style="padding:4px 0 0 16px;">';
children.forEach(function(child) {
  if (child.path === dirName) return;
  var displayName = child.path.substring(dirName.length + 1);
  var icon = child.type === 'dir' ? '\u{1F4C1}' : '\u{1F4C4}';
  var sizeStr = child.type === 'file' ? ' <span class="muted" style="font-size:10px;">(' + formatFileSize(child.size) + ')</span>' : '';
  html += '<div style="padding:2px 0;font-size:12px;">' + icon + ' ' + escapeHtml(displayName) + sizeStr + '</div>';
});
html += '</div></details>';
});
if (dirs['_root']) {
dirs['_root'].forEach(function(e) {
  var icon = e.type === 'dir' ? '\u{1F4C1}' : '\u{1F4C4}';
  var sizeStr = e.type === 'file' ? ' <span class="muted" style="font-size:10px;">(' + formatFileSize(e.size) + ')</span>' : '';
  html += '<div style="padding:3px 0;font-size:12px;">' + icon + ' ' + escapeHtml(e.name) + sizeStr + '</div>';
});
}
container.innerHTML = html || '<span class="muted">No files found.</span>';
}

export 
function formatFileSize(bytes) {
if (bytes === 0) return '0 B';
var units = ['B', 'KB', 'MB', 'GB'];
var i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
var size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
return size + ' ' + units[i];
}

export 
function filterWorkspaceFiles(query) {
var container = document.getElementById('workspace-file-tree');
if (!container || !state._workspaceFiles) return;
if (!query || !query.trim()) {
renderWorkspaceFileTree(state._workspaceFiles, container);
return;
}
var lower = query.toLowerCase();
var filtered = state._workspaceFiles.filter(function(e) {
return e.path.toLowerCase().indexOf(lower) !== -1;
});
renderWorkspaceFileTree(filtered, container);
}

export 
async function openWorkspaceInExplorer() {
try {
await request('/api/workspace/open-explorer', { method: 'POST' });
} catch (err) {
alert('Failed to open explorer: ' + String(err));
}
}

export 
async function changeWorkspaceLocation() {
var currentPath = (document.getElementById('workspace-path') || {}).textContent || '';
var newPath = prompt('Enter the new workspace path (absolute):', currentPath.trim());
if (!newPath || newPath.trim() === '' || newPath.trim() === currentPath.trim()) return;
try {
var result = await request('/api/workspace/relocate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: newPath.trim() })
});
if (result.error) { alert('Relocation failed: ' + result.error); return; }
await refreshWorkspaceInfo();
await refreshWorkspaceFiles();
} catch (e) {
alert('Failed to change workspace location: ' + e.message);
}
}

export 
function showImportStatus(msg, isError) {
var el = document.getElementById('import-status');
if (!el) return;
el.style.display = 'block';
el.style.background = isError ? 'rgba(231,76,60,0.15)' : 'rgba(126,207,126,0.15)';
el.style.color = isError ? '#ff8d8d' : '#7ecf7e';
el.textContent = msg;
setTimeout(function() { el.style.display = 'none'; }, 6000);
}

export 
function triggerWorkspaceImport() {
triggerGeneralImport();
}

export 
function triggerGeneralImport() {
var targetDir = prompt('Target workspace directory:\\n\\n' + IMPORT_TARGET_DIRS.join('\\n') + '\\n\\nEnter directory name:', 'workspace');
if (!targetDir || !targetDir.trim()) return;
targetDir = targetDir.trim();
if (IMPORT_TARGET_DIRS.indexOf(targetDir) === -1) {
alert('Invalid target directory. Must be one of:\\n' + IMPORT_TARGET_DIRS.join(', '));
return;
}
var input = document.getElementById('import-file-input');
if (!input) return;
input._importTargetDir = targetDir;
input.value = '';
input.click();
}

export 
function triggerRegisteredImport() {
var typeMsg = 'Select registered item type:\\n\\n';
for (var i = 0; i < IMPORT_REGISTERED_TYPES.length; i++) {
typeMsg += (i + 1) + '. ' + IMPORT_REGISTERED_TYPES[i].label + '\\n';
}
typeMsg += '\\nEnter number (1-' + IMPORT_REGISTERED_TYPES.length + '):';
var choice = prompt(typeMsg);
if (!choice) return;
var idx = parseInt(choice, 10) - 1;
if (isNaN(idx) || idx < 0 || idx >= IMPORT_REGISTERED_TYPES.length) {
alert('Invalid selection.');
return;
}
var input = document.getElementById('import-registered-input');
if (!input) return;
input._importRegisteredType = IMPORT_REGISTERED_TYPES[idx].value;
input.value = '';
input.click();
}

export 
function triggerFolderImport() {
var targetDir = prompt('Target workspace directory for folder contents:\\n\\n' + IMPORT_TARGET_DIRS.join('\\n') + '\\n\\nEnter directory name:', 'workspace');
if (!targetDir || !targetDir.trim()) return;
targetDir = targetDir.trim();
if (IMPORT_TARGET_DIRS.indexOf(targetDir) === -1) {
alert('Invalid target directory. Must be one of:\\n' + IMPORT_TARGET_DIRS.join(', '));
return;
}
var input = document.getElementById('import-folder-input');
if (!input) return;
input._importTargetDir = targetDir;
input.value = '';
input.click();
}

export 
function readFileAsBase64(file) {
return new Promise(function(resolve, reject) {
var reader = new FileReader();
reader.onload = function() {
  var result = reader.result;
  var base64 = result.split(',')[1] || '';
  resolve(base64);
};
reader.onerror = function() { reject(new Error('Failed to read file')); };
reader.readAsDataURL(file);
});
}

export 
async function refreshImportHistory() {
try {
var data = await request('/api/workspace/import/history');
state.importHistory = data.history || [];
renderImportHistory();
} catch (e) { console.error('[import] history refresh failed', e); }
}

export 
function renderImportHistory() {
var container = document.getElementById('import-history-list');
if (!container) return;
var hist = state.importHistory;
if (!hist || hist.length === 0) {
container.innerHTML = '<span class="muted">No imports yet.</span>';
return;
}
var html = '';
for (var i = 0; i < Math.min(hist.length, 25); i++) {
var h = hist[i];
var statusColor = h.status === 'success' ? '#7ecf7e' : (h.status === 'partial' ? '#ffd17a' : '#ff8d8d');
var modeIcon = h.mode === 'folder' ? '\u{1F4C1}' : (h.mode === 'registered' ? '\u{1F9E9}' : '\u{1F4C4}');
var ts = new Date(h.timestamp);
var timeStr = ts.toLocaleTimeString();
html += '<div style="padding:6px 0;border-bottom:1px solid rgba(148,163,184,0.08);display:flex;align-items:center;gap:8px;">';
html += '<span>' + modeIcon + '</span>';
html += '<div style="flex:1;min-width:0;">';
html += '<div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(h.fileName) + '</div>';
html += '<div class="muted" style="font-size:11px;">' + escapeHtml(h.message) + '</div>';
html += '</div>';
html += '<span style="color:' + statusColor + ';font-size:11px;font-weight:700;white-space:nowrap;">' + escapeHtml(h.status) + '</span>';
html += '<span class="muted" style="font-size:10px;white-space:nowrap;">' + timeStr + '</span>';
html += '</div>';
}
if (hist.length > 25) {
html += '<div class="muted" style="margin-top:6px;font-size:11px;">... and ' + (hist.length - 25) + ' more</div>';
}
container.innerHTML = html;
}

export 
function initWorkspaceTab() {
refreshWorkspaceInfo();
refreshWorkspaceFiles();
refreshImportHistory();
}
