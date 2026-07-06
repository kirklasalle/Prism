import { state, request, escapeHtml, dashboardLog, safeRenderStep, showConfirm, showPrompt, showSelect, showTransientNotice } from './dashboard-core.js';

export const IMPORT_TARGET_DIRS = [
  "config",
  "artifacts",
  "data",
  "data/tasks",
  "data/notes",
  "data/email",
  "data/calendar",
  "logs",
  "workspace",
  "state"
];

export const IMPORT_REGISTERED_TYPES = [
  { value: "mcp-config", label: "MCP Server Config (mcp-settings.json)" },
  { value: "session-package", label: "Session Package / Binder (.json)" },
  { value: "tool-contract", label: "Tool Contract / Schema (.json)" },
  { value: "self-review", label: "Self-Review Report (.json)" },
  { value: "task-timeline", label: "Task Timeline / Roadmap (.json)" },
  { value: "note", label: "General Note (.txt, .md)" }
];

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
    state._workspaceFilesRaw = data;
    renderWorkspaceFileTree(data.entries, container);
    if (data.truncated) {
      var warn = document.createElement('div');
      warn.className = 'muted';
      warn.style.cssText = 'font-size:11px;padding:6px 0;border-top:1px solid rgba(148,163,184,0.1);margin-top:4px;';
      warn.textContent = '\u26A0\uFE0F Large workspace — showing first ' + data.entries.length + ' entries only.';
      container.appendChild(warn);
    }
  } catch (err) {
    container.innerHTML = '<span style="color:#e74c3c;">\u274C ' + escapeHtml(String(err)) + '</span>';
  }
}

export
  function renderWorkspaceFileTree(entries, container) {
  // ── Build a real tree structure ─────────────────────────────────────────
  // entries: [{name, path, type:'file'|'dir', size}]
  // We build a map of path -> node so we can nest properly.
  var ROOT_KEY = '__root__';
  var nodeMap = {};
  nodeMap[ROOT_KEY] = { name: '', path: '', type: 'dir', children: [], size: 0 };

  // Sort so directories come before files, then alphabetically.
  var sorted = entries.slice().sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  sorted.forEach(function (e) {
    nodeMap[e.path] = { name: e.name, path: e.path, type: e.type, size: e.size, children: [] };
  });

  sorted.forEach(function (e) {
    var slashIdx = e.path.lastIndexOf('/');
    var parentKey = slashIdx > 0 ? e.path.substring(0, slashIdx) : ROOT_KEY;
    var parent = nodeMap[parentKey] || nodeMap[ROOT_KEY];
    parent.children.push(nodeMap[e.path]);
  });

  // ── Render a single node ─────────────────────────────────────────────────
  function renderNode(node, depth) {
    var el = document.createElement('div');
    el.style.cssText = 'padding-left:' + (depth * 14) + 'px;';

    if (node.type === 'dir') {
      var summary = document.createElement('div');
      summary.className = 'ws-tree-dir';
      summary.setAttribute('role', 'button');
      summary.tabIndex = 0;
      summary.setAttribute('aria-expanded', 'true');
      summary.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 6px;border-radius:4px;cursor:pointer;user-select:none;font-size:12px;font-weight:600;';
      summary.onmouseenter = function () { summary.style.background = 'rgba(255,255,255,0.05)'; };
      summary.onmouseleave = function () { summary.style.background = ''; };

      var chevron = document.createElement('span');
      chevron.textContent = '▼';
      chevron.style.cssText = 'font-size:9px;color:var(--text-muted);transition:transform 0.15s;width:10px;display:inline-block;flex-shrink:0;';

      var icon = document.createElement('span');
      icon.textContent = '📁';

      var label = document.createElement('span');
      label.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      label.textContent = node.name || 'workspace';

      var count = document.createElement('span');
      count.className = 'muted';
      count.style.cssText = 'font-size:10px;font-weight:normal;margin-left:4px;flex-shrink:0;';
      count.textContent = '(' + node.children.length + ')';

      summary.appendChild(chevron);
      summary.appendChild(icon);
      summary.appendChild(label);
      summary.appendChild(count);

      var childContainer = document.createElement('div');
      childContainer.style.cssText = 'overflow:hidden;';
      node.children.forEach(function (child) {
        childContainer.appendChild(renderNode(child, depth + 1));
      });

      var toggleCollapse = function () {
        var collapsed = childContainer.style.display === 'none';
        childContainer.style.display = collapsed ? '' : 'none';
        chevron.style.transform = collapsed ? '' : 'rotate(-90deg)';
        summary.setAttribute('aria-expanded', String(collapsed));
      };
      summary.onclick = toggleCollapse;
      summary.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); } };

      el.appendChild(summary);
      el.appendChild(childContainer);
    } else {
      // File row with action buttons
      var row = document.createElement('div');
      row.className = 'ws-tree-file';
      row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:2px 6px;border-radius:4px;font-size:12px;';
      row.onmouseenter = function () { row.style.background = 'rgba(255,255,255,0.04)'; actions.style.opacity = '1'; };
      row.onmouseleave = function () { row.style.background = ''; actions.style.opacity = '0'; };

      var fileIcon = document.createElement('span');
      fileIcon.textContent = getFileIcon(node.name);
      fileIcon.style.cssText = 'flex-shrink:0;';

      var fileName = document.createElement('span');
      fileName.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      fileName.textContent = node.name;
      fileName.title = node.path;

      var fileSize = document.createElement('span');
      fileSize.className = 'muted';
      fileSize.style.cssText = 'font-size:10px;flex-shrink:0;white-space:nowrap;';
      fileSize.textContent = formatFileSize(node.size);

      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:3px;flex-shrink:0;opacity:0;transition:opacity 0.15s;';

      function makeActionBtn(title, emoji, onClick) {
        var btn = document.createElement('button');
        btn.title = title;
        btn.textContent = emoji;
        btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:1px 3px;border-radius:3px;font-size:11px;color:var(--text-muted);line-height:1;';
        btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.color = 'var(--text)'; };
        btn.onmouseleave = function () { btn.style.background = ''; btn.style.color = 'var(--text-muted)'; };
        btn.onclick = function (e) { e.stopPropagation(); onClick(); };
        return btn;
      }

      actions.appendChild(makeActionBtn('Download', '⬇️', function () { downloadWorkspaceFile(node.path, node.name); }));
      actions.appendChild(makeActionBtn('Rename', '✏️', function () { renameWorkspaceFile(node.path); }));
      actions.appendChild(makeActionBtn('Delete', '🗑️', function () { deleteWorkspaceFile(node.path, node.name); }));

      row.appendChild(fileIcon);
      row.appendChild(fileName);
      row.appendChild(fileSize);
      row.appendChild(actions);
      el.appendChild(row);
    }
    return el;
  }

  // ── Render into container ────────────────────────────────────────────────
  var fragment = document.createDocumentFragment();
  var root = nodeMap[ROOT_KEY];
  root.children.forEach(function (child) {
    fragment.appendChild(renderNode(child, 0));
  });
  container.innerHTML = '';
  if (root.children.length === 0) {
    container.innerHTML = '<span class="muted">No files found.</span>';
  } else {
    container.appendChild(fragment);
  }
}

function getFileIcon(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var icons = {
    js: '📜', ts: '📘', json: '📋', md: '📝', txt: '📄',
    html: '🌐', css: '🎨', py: '🐍', sh: '⚙️', bat: '⚙️',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎨',
    zip: '📦', gz: '📦', tar: '📦',
    pdf: '📕', csv: '📊', yaml: '⚙️', yml: '⚙️', toml: '⚙️',
    log: '📋', db: '🗄️', sqlite: '🗄️',
  };
  return icons[ext] || '📄';
}

export
  async function downloadWorkspaceFile(relPath, fileName) {
  try {
    var token = typeof getAuthToken !== 'undefined' ? getAuthToken() : '';
    var url = '/api/workspace/file/download?path=' + encodeURIComponent(relPath);
    var resp = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      showTransientNotice('Download failed: ' + (err.error || resp.statusText), 'error');
      return;
    }
    var blob = await resp.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 100);
  } catch (e) {
    showTransientNotice('Download error: ' + String(e), 'error');
  }
}

export
  async function renameWorkspaceFile(relPath) {
  var currentName = relPath.split('/').pop() || relPath;
  var newName = await showPrompt('Rename "' + currentName + '" to:', {
    defaultValue: currentName,
    placeholder: 'new-name.ext',
    confirmLabel: 'Rename',
    icon: '✏️'
  });
  if (!newName || newName === currentName) return;
  try {
    var result = await request('/api/workspace/file/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath, newName: newName })
    });
    if (result.error) { showTransientNotice('Rename failed: ' + result.error, 'error'); return; }
    showTransientNotice('Renamed to "' + newName + '".', 'success');
    refreshWorkspaceFiles();
  } catch (e) {
    showTransientNotice('Rename error: ' + String(e), 'error');
  }
}

export
  async function deleteWorkspaceFile(relPath, fileName) {
  var confirmed = await showConfirm('Delete "' + fileName + '"?\n\nThis cannot be undone.');
  if (!confirmed) return;
  try {
    var result = await request('/api/workspace/file/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath })
    });
    if (result.error) { showTransientNotice('Delete failed: ' + result.error, 'error'); return; }
    showTransientNotice('"' + fileName + '" deleted.', 'success');
    refreshWorkspaceFiles();
  } catch (e) {
    showTransientNotice('Delete error: ' + String(e), 'error');
  }
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
  var filtered = state._workspaceFiles.filter(function (e) {
    return e.path.toLowerCase().indexOf(lower) !== -1;
  });
  renderWorkspaceFileTree(filtered, container);
}

export
  async function openWorkspaceInExplorer() {
  try {
    await request('/api/workspace/open-explorer', { method: 'POST' });
  } catch (err) {
    showTransientNotice('Failed to open explorer: ' + String(err), 'error');
  }
}

export
  async function changeWorkspaceLocation() {
  var currentPath = (document.getElementById('workspace-path') || {}).textContent || '';
  var newPath = await showPrompt('Enter the new workspace path (absolute):', {
    defaultValue: currentPath.trim(),
    placeholder: 'C:\\Users\\you\\Documents\\MyWorkspace',
    confirmLabel: 'Relocate',
    icon: '📁'
  });
  if (!newPath || newPath.trim() === '' || newPath.trim() === currentPath.trim()) return;
  var confirmed = await showConfirm('Relocate the workspace to:\n\n' + newPath.trim() + '\n\nThis will initialize the workspace structure at the new location.');
  if (!confirmed) return;
  try {
    var result = await request('/api/workspace/relocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath.trim() })
    });
    if (result.error) { showTransientNotice('Relocation failed: ' + result.error, 'error'); return; }
    showTransientNotice('Workspace relocated successfully.', 'success');
    await refreshWorkspaceInfo();
    await refreshWorkspaceFiles();
  } catch (e) {
    showTransientNotice('Failed to change workspace location: ' + (e && e.message ? e.message : String(e)), 'error');
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
  setTimeout(function () { el.style.display = 'none'; }, 6000);
}

export
  function triggerWorkspaceImport() {
  triggerGeneralImport();
}

export
  async function triggerGeneralImport() {
  var targetDir = await showSelect('Select a target workspace directory:',
    IMPORT_TARGET_DIRS.map(function (d) { return { value: d, label: d }; }),
    { icon: '📄' });
  if (!targetDir) return;
  var input = document.getElementById('import-file-input');
  if (!input) return;
  input._importTargetDir = targetDir;
  input.value = '';
  input.click();
}

export
  async function triggerRegisteredImport() {
  var choice = await showSelect('Select the registered item type to import:',
    IMPORT_REGISTERED_TYPES.map(function (t) { return { value: t.value, label: t.label }; }),
    { icon: '🧩' });
  if (!choice) return;
  var input = document.getElementById('import-registered-input');
  if (!input) return;
  input._importRegisteredType = choice;
  input.value = '';
  input.click();
}

export
  async function triggerFolderImport() {
  var targetDir = await showSelect('Select a target directory for the folder contents:',
    IMPORT_TARGET_DIRS.map(function (d) { return { value: d, label: d }; }),
    { icon: '📁' });
  if (!targetDir) return;
  var input = document.getElementById('import-folder-input');
  if (!input) return;
  input._importTargetDir = targetDir;
  input.value = '';
  input.click();
}

export
  function readFileAsBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result;
      var base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = function () { reject(new Error('Failed to read file')); };
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

async function handleGeneralFileChange(e) {
  var file = e.target.files[0];
  if (!file) return;
  var targetDir = e.target._importTargetDir || 'workspace';
  try {
    showImportStatus('Reading and uploading ' + file.name + '...', false);
    var content = await readFileAsBase64(file);
    var result = await request('/api/workspace/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'general',
        fileName: file.name,
        content: content,
        targetDir: targetDir
      })
    });
    if (result.error) {
      showImportStatus('Failed: ' + result.error, true);
    } else {
      showImportStatus('Successfully imported ' + file.name, false);
      refreshWorkspaceFiles();
      refreshImportHistory();
    }
  } catch (err) {
    showImportStatus('Error: ' + String(err), true);
  }
}

async function handleRegisteredFileChange(e) {
  var file = e.target.files[0];
  if (!file) return;
  var registeredType = e.target._importRegisteredType;
  try {
    showImportStatus('Reading and uploading ' + file.name + '...', false);
    var content = await readFileAsBase64(file);
    var result = await request('/api/workspace/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'registered',
        fileName: file.name,
        content: content,
        registeredType: registeredType
      })
    });
    if (result.error) {
      showImportStatus('Failed: ' + result.error, true);
    } else {
      showImportStatus('Successfully imported registered ' + registeredType, false);
      refreshWorkspaceFiles();
      refreshImportHistory();
    }
  } catch (err) {
    showImportStatus('Error: ' + String(err), true);
  }
}

async function handleFolderChange(e) {
  var files = e.target.files;
  if (!files || files.length === 0) return;
  var targetDir = e.target._importTargetDir || 'workspace';
  if (files.length > 500) {
    showTransientNotice('Folder import is limited to 500 files at a time.', 'error');
    return;
  }
  try {
    showImportStatus('Reading and uploading ' + files.length + ' files...', false);
    var payloadFiles = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var base64 = await readFileAsBase64(file);
      var relPath = file.webkitRelativePath || file.name;
      payloadFiles.push({
        name: file.name,
        content: base64,
        relativePath: relPath
      });
    }
    var result = await request('/api/workspace/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'folder',
        targetDir: targetDir,
        files: payloadFiles
      })
    });
    if (result.error) {
      showImportStatus('Failed: ' + result.error, true);
    } else {
      var summary = result.summary || {};
      showImportStatus('Import summary: ' + (summary.message || 'Complete'), false);
      refreshWorkspaceFiles();
      refreshImportHistory();
    }
  } catch (err) {
    showImportStatus('Error: ' + String(err), true);
  }
}

export
  function initWorkspaceTab() {
  refreshWorkspaceInfo();
  refreshWorkspaceFiles();
  refreshImportHistory();

  var fileInput = document.getElementById('import-file-input');
  if (fileInput && !fileInput._bound) {
    fileInput.addEventListener('change', handleGeneralFileChange);
    fileInput._bound = true;
  }
  var registeredInput = document.getElementById('import-registered-input');
  if (registeredInput && !registeredInput._bound) {
    registeredInput.addEventListener('change', handleRegisteredFileChange);
    registeredInput._bound = true;
  }
  var folderInput = document.getElementById('import-folder-input');
  if (folderInput && !folderInput._bound) {
    folderInput.addEventListener('change', handleFolderChange);
    folderInput._bound = true;
  }

  // ── Drag-and-drop on import cards ──────────────────────────────────
  initImportCardDragDrop();
}

function initImportCardDragDrop() {
  // The three import cards each have an onclick. We attach drag-and-drop
  // on the entire import cards grid so any card or the area around them
  // accepts drops, and we ask the user to confirm the target directory.
  var container = document.getElementById('import-manager-container');
  if (!container || container._ddBound) return;
  container._ddBound = true;

  var overlay = null;

  function showDropOverlay(label) {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(109,40,217,0.18);border:2.5px dashed rgba(139,92,246,0.8);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#a78bfa;pointer-events:none;z-index:10;gap:8px;';
    overlay.innerHTML = '<span style="font-size:22px;">📂</span><span>' + label + '</span>';
    container.style.position = 'relative';
    container.appendChild(overlay);
  }
  function hideDropOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  container.addEventListener('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var hasFiles = e.dataTransfer && Array.from(e.dataTransfer.items || []).some(function (i) { return i.kind === 'file'; });
    if (hasFiles) showDropOverlay('Drop files to import');
  });
  container.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  container.addEventListener('dragleave', function (e) {
    // Only hide when truly leaving the container (not entering a child)
    if (!container.contains(e.relatedTarget)) hideDropOverlay();
  });
  container.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    hideDropOverlay();
    var items = e.dataTransfer && e.dataTransfer.items ? Array.from(e.dataTransfer.items) : [];
    var files = items.filter(function (i) { return i.kind === 'file'; }).map(function (i) { return i.getAsFile(); }).filter(Boolean);
    if (files.length === 0) return;
    handleDroppedFiles(files);
  });
}

async function handleDroppedFiles(files) {
  if (files.length === 0) return;
  // Ask for target dir via the premium select modal
  var targetDir = await showSelect(
    'Drop ' + files.length + ' file' + (files.length > 1 ? 's' : '') + ' into which directory?',
    IMPORT_TARGET_DIRS.map(function (d) { return { value: d, label: d }; }),
    { icon: '📂' }
  );
  if (!targetDir) return;

  showImportStatus('Uploading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '...', false);
  var succeeded = 0;
  var failed = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var content = await readFileAsBase64(file);
      var result = await request('/api/workspace/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'general', fileName: file.name, content: content, targetDir: targetDir })
      });
      if (result.error) { failed++; } else { succeeded++; }
    } catch (_) { failed++; }
  }
  var msg = succeeded + '/' + files.length + ' file' + (files.length > 1 ? 's' : '') + ' imported to ' + targetDir;
  showImportStatus(msg + (failed > 0 ? ' (' + failed + ' failed)' : ''), failed > 0 && succeeded === 0);
  refreshWorkspaceFiles();
  refreshImportHistory();
}
