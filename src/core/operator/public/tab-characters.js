import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';

function stateBadge(stateValue) {
  var value = String(stateValue || 'unknown').toLowerCase();
  var palette = {
    active: { bg: 'rgba(46,204,113,0.18)', fg: '#7ee2a8' },
    suspended: { bg: 'rgba(243,156,18,0.18)', fg: '#ffd17a' },
    revoked: { bg: 'rgba(231,76,60,0.18)', fg: '#ff9c93' },
    unknown: { bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' }
  };
  var colors = palette[value] || palette.unknown;
  return '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:' + colors.bg + ';color:' + colors.fg + ';font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">' + escapeHtml(value) + '</span>';
}

function metricCard(label, value, accent) {
  return '<div class="panel" style="padding:12px;border-left:3px solid ' + accent + ';">'
    + '<div class="muted" style="font-size:11px;">' + escapeHtml(label) + '</div>'
    + '<div style="font-size:24px;font-weight:700;margin-top:4px;">' + escapeHtml(String(value)) + '</div>'
    + '</div>';
}

function formatTimestamp(value) {
  if (!value) return '-';
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatList(items) {
  if (!items || !items.length) return '<span class="muted">None</span>';
  return items.map(function (item) {
    return '<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 8px;border-radius:999px;background:rgba(148,163,184,0.12);font-size:11px;">' + escapeHtml(String(item)) + '</span>';
  }).join('');
}

function selectedCharacter() {
  var select = document.getElementById('character-assign-character');
  var selectedId = select ? select.value : '';
  for (var i = 0; i < state.availableCharacters.length; i++) {
    if (state.availableCharacters[i].id === selectedId) {
      return state.availableCharacters[i];
    }
  }
  return null;
}

function setCharacterPanelStatus(message, isError) {
  var el = document.getElementById('character-panel-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = isError ? 'rgba(231,76,60,0.15)' : 'rgba(46,204,113,0.14)';
  el.style.color = isError ? '#ff9c93' : '#95f0b7';
  el.textContent = String(message);
}

export function clearCharacterPanelStatus() {
  var el = document.getElementById('character-panel-status');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

export function renderCharacterSummary() {
  var container = document.getElementById('character-summary-cards');
  if (!container) return;
  var assignments = state.characterAssignments || [];
  var active = 0;
  var suspended = 0;
  var revoked = 0;
  for (var i = 0; i < assignments.length; i++) {
    if (assignments[i].state === 'active') active++;
    else if (assignments[i].state === 'suspended') suspended++;
    else if (assignments[i].state === 'revoked') revoked++;
  }
  container.innerHTML = ''
    + metricCard('Total Assignments', assignments.length, '#5dade2')
    + metricCard('Active', active, '#2ecc71')
    + metricCard('Suspended', suspended, '#f39c12')
    + metricCard('Revoked', revoked, '#e74c3c');
}

export function renderCharacterDefinitionPreview() {
  var container = document.getElementById('character-definition-preview');
  if (!container) return;
  var character = selectedCharacter();
  if (!character) {
    container.innerHTML = '<div class="muted" style="font-size:12px;">Select a character to inspect its CAC profile, tool permissions, and persona.</div>';
    return;
  }
  container.innerHTML = ''
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">'
    + '<div>'
    + '<div style="font-size:16px;font-weight:700;">' + escapeHtml(character.displayName || character.name || character.id) + '</div>'
    + '<div class="muted" style="font-size:12px;margin-top:3px;">' + escapeHtml(character.id) + '</div>'
    + '</div>'
    + stateBadge(character.executionProfile || 'unknown')
    + '</div>'
    + '<div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5;">' + escapeHtml(character.persona || character.systemPrompt || 'No persona summary available.') + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px;">'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Execution Profile</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.executionProfile || 'Unspecified') + '</div></div>'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Max Risk Tier</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.maxRiskTier == null ? 'Unspecified' : String(character.maxRiskTier)) + '</div></div>'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Greeting</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.greeting || 'None') + '</div></div>'
    + '</div>'
    + '<div style="margin-top:12px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Tags</div>' + formatList(character.tags || []) + '</div>'
    + '<div style="margin-top:10px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Allowed Tools</div>' + formatList(character.allowedTools || []) + '</div>'
    + '<div style="margin-top:10px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Denied Tools</div>' + formatList(character.deniedTools || []) + '</div>';
}

export function filterCharacterAssignments(query) {
  state.characterFilterText = String(query || '');
  renderCharacterRoster();
}

export function toggleCharacterAssignmentDetails(assignmentId) {
  state.selectedAssignmentId = state.selectedAssignmentId === assignmentId ? null : assignmentId;
  renderCharacterRoster();
  refreshCharacterAuditLog();
}

export function renderCharacterRoster() {
  var container = document.getElementById('character-roster');
  if (!container) return;
  var assignments = state.characterAssignments || [];
  var query = String(state.characterFilterText || '').trim().toLowerCase();
  var filtered = assignments.filter(function (assignment) {
    if (!query) return true;
    var haystack = [
      assignment.characterId,
      assignment.operatorEmail,
      assignment.prismUserEmail,
      assignment.assignmentId,
      assignment.executionProfileSegment,
      assignment.character && assignment.character.displayName,
      assignment.character && assignment.character.name
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  });
  if (!filtered.length) {
    container.innerHTML = '<div class="muted" style="padding:18px;text-align:center;">No character assignments match the current filter.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var assignment = filtered[i];
    var expanded = state.selectedAssignmentId === assignment.assignmentId;
    var displayName = assignment.character && (assignment.character.displayName || assignment.character.name) ? (assignment.character.displayName || assignment.character.name) : assignment.characterId;
    html += '<div class="panel" style="padding:14px;margin-bottom:10px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<div style="min-width:220px;flex:1;">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
    html += '<div style="font-size:15px;font-weight:700;">' + escapeHtml(displayName) + '</div>';
    html += stateBadge(assignment.state);
    html += '</div>';
    html += '<div class="muted" style="font-size:12px;margin-top:4px;">' + escapeHtml(assignment.characterId) + ' • ' + escapeHtml(assignment.assignmentId) + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px;font-size:12px;">';
    html += '<div><div class="muted" style="font-size:11px;">Operator</div><div>' + escapeHtml(assignment.operatorEmail || '-') + '</div></div>';
    html += '<div><div class="muted" style="font-size:11px;">Prism User</div><div>' + escapeHtml(assignment.prismUserEmail || '-') + '</div></div>';
    html += '<div><div class="muted" style="font-size:11px;">Profile</div><div>' + escapeHtml(assignment.executionProfileSegment || '-') + '</div></div>';
    html += '<div><div class="muted" style="font-size:11px;">Dispatch Count</div><div>' + escapeHtml(String(assignment.dispatchCount || 0)) + '</div></div>';
    html += '</div>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end;">';
    html += '<button class="primary-button" onclick="toggleCharacterAssignmentDetails(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">' + (expanded ? 'Hide Details' : 'Inspect') + '</button>';
    if (assignment.state === 'active') {
      html += '<button class="primary-button" onclick="dispatchCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Dispatch</button>';
      html += '<button class="primary-button" onclick="suspendCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Suspend</button>';
      html += '<button class="primary-button" onclick="revokeCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Revoke</button>';
    } else if (assignment.state === 'suspended') {
      html += '<button class="primary-button" onclick="resumeCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Resume</button>';
      html += '<button class="primary-button" onclick="revokeCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Revoke</button>';
    }
    html += '</div>';
    html += '</div>';
    if (expanded) {
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.14);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:12px;">';
      html += '<div><div class="muted" style="font-size:11px;">Assignment Chain</div><div style="margin-top:6px;line-height:1.6;">'
        + '<div><strong>characterId:</strong> ' + escapeHtml(assignment.characterId) + '</div>'
        + '<div><strong>prismUserId:</strong> ' + escapeHtml(assignment.prismUserId || '-') + '</div>'
        + '<div><strong>operatorId:</strong> ' + escapeHtml(assignment.operatorId || '-') + '</div>'
        + '<div><strong>clientId:</strong> ' + escapeHtml(assignment.clientId || '-') + '</div>'
        + '<div><strong>sessionId:</strong> ' + escapeHtml(assignment.sessionId || '-') + '</div>'
        + '</div></div>';
      html += '<div><div class="muted" style="font-size:11px;">Lifecycle</div><div style="margin-top:6px;line-height:1.6;">'
        + '<div><strong>Assigned:</strong> ' + escapeHtml(formatTimestamp(assignment.assignedAt)) + '</div>'
        + '<div><strong>Updated:</strong> ' + escapeHtml(formatTimestamp(assignment.updatedAt)) + '</div>'
        + '<div><strong>Last Active:</strong> ' + escapeHtml(formatTimestamp(assignment.lastActiveAt)) + '</div>'
        + '<div><strong>Suspend Reason:</strong> ' + escapeHtml(assignment.suspendReason || '-') + '</div>'
        + '<div><strong>Revocation Reason:</strong> ' + escapeHtml(assignment.revocationReason || '-') + '</div>'
        + '</div></div>';
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

export function renderCharacterAuditLog() {
  var container = document.getElementById('character-audit-log');
  if (!container) return;
  var events = state.characterAuditEvents || [];
  if (!events.length) {
    container.innerHTML = '<div class="muted" style="padding:12px;">No accountability events recorded yet.</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var operation = String(event.operation || '').replace('character_accountability.', '');
    html += '<div style="padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.12);">';
    html += '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">';
    html += '<div>';
    html += '<div style="font-size:13px;font-weight:700;">' + escapeHtml(operation) + '</div>';
    html += '<div class="muted" style="font-size:11px;margin-top:3px;">' + escapeHtml(event.characterId || '-') + ' • ' + escapeHtml(event.assignmentId || '-') + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;">' + stateBadge(event.status || 'unknown') + '<div class="muted" style="font-size:11px;margin-top:4px;">' + escapeHtml(formatTimestamp(event.timestamp)) + '</div></div>';
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:12px;line-height:1.6;">';
    html += '<div><strong>Operator:</strong> ' + escapeHtml(event.operatorEmail || '-') + '</div>';
    html += '<div><strong>Prism User:</strong> ' + escapeHtml(event.prismUserEmail || '-') + '</div>';
    if (event.details && typeof event.details === 'object') {
      if (event.details.reason) {
        html += '<div><strong>Reason:</strong> ' + escapeHtml(String(event.details.reason)) + '</div>';
      }
      if (event.details.previousState) {
        html += '<div><strong>Previous State:</strong> ' + escapeHtml(String(event.details.previousState)) + '</div>';
      }
      if (event.details.dispatchCount != null) {
        html += '<div><strong>Dispatch Count:</strong> ' + escapeHtml(String(event.details.dispatchCount)) + '</div>';
      }
    }
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

export function renderCharacterAssignmentForm() {
  var select = document.getElementById('character-assign-character');
  if (select) {
    var options = '<option value="">Select a character...</option>';
    for (var i = 0; i < state.availableCharacters.length; i++) {
      var character = state.availableCharacters[i];
      options += '<option value="' + escapeHtml(character.id) + '">' + escapeHtml((character.displayName || character.name || character.id) + ' (' + character.id + ')') + '</option>';
    }
    var current = select.value;
    select.innerHTML = options;
    if (current) select.value = current;
  }
  renderCharacterDefinitionPreview();
}

export async function loadAvailableCharacters() {
  var data = await request('/api/workspace/characters');
  state.availableCharacters = Array.isArray(data.characters) ? data.characters : [];
  renderCharacterAssignmentForm();
}

export async function refreshCharacterAssignments() {
  var data = await request('/api/workspace/character-assignments');
  state.characterAssignments = Array.isArray(data.assignments) ? data.assignments : [];
  if (state.selectedAssignmentId) {
    var stillExists = state.characterAssignments.some(function (assignment) {
      return assignment.assignmentId === state.selectedAssignmentId;
    });
    if (!stillExists) state.selectedAssignmentId = null;
  }
  renderCharacterSummary();
  renderCharacterRoster();
}

export async function refreshCharacterAuditLog() {
  var url = '/api/workspace/character-audit?limit=20';
  if (state.selectedAssignmentId) {
    url += '&assignmentId=' + encodeURIComponent(state.selectedAssignmentId);
  }
  var data = await request(url);
  state.characterAuditEvents = Array.isArray(data.events) ? data.events : [];
  renderCharacterAuditLog();
}

export async function refreshCharacterPanel() {
  clearCharacterPanelStatus();
  try {
    await Promise.all([
      loadAvailableCharacters(),
      refreshCharacterAssignments(),
      refreshCharacterAuditLog()
    ]);
  } catch (error) {
    setCharacterPanelStatus('Failed to load Character Panel: ' + String(error), true);
  }
}

export async function submitCharacterAssignment() {
  clearCharacterPanelStatus();
  var characterIdEl = document.getElementById('character-assign-character');
  var prismUserIdEl = document.getElementById('character-assign-prism-user-id');
  var prismUserEmailEl = document.getElementById('character-assign-prism-user-email');
  var operatorIdEl = document.getElementById('character-assign-operator-id');
  var operatorEmailEl = document.getElementById('character-assign-operator-email');
  var clientIdEl = document.getElementById('character-assign-client-id');
  var profileEl = document.getElementById('character-assign-profile');
  var payload = {
    characterId: characterIdEl ? characterIdEl.value.trim() : '',
    prismUserId: prismUserIdEl ? prismUserIdEl.value.trim() : '',
    prismUserEmail: prismUserEmailEl ? prismUserEmailEl.value.trim() : '',
    operatorId: operatorIdEl ? operatorIdEl.value.trim() : '',
    operatorEmail: operatorEmailEl ? operatorEmailEl.value.trim() : '',
    clientId: clientIdEl ? clientIdEl.value.trim() : 'workspace-tab',
    sessionId: state.selectedSessionId || '',
    executionProfile: profileEl ? profileEl.value : 'individual'
  };
  if (!payload.characterId || !payload.prismUserEmail || !payload.operatorEmail) {
    setCharacterPanelStatus('Character, Prism user email, and operator email are required.', true);
    return;
  }
  try {
    await request('/api/workspace/character-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    dashboardLog('workspace', 'character.assign', 'Character assignment created for ' + payload.characterId);
    setCharacterPanelStatus('Character assignment created for ' + payload.characterId + '.', false);
    await refreshCharacterAssignments();
    await refreshCharacterAuditLog();
  } catch (error) {
    setCharacterPanelStatus('Assignment failed: ' + String(error), true);
  }
}

async function transitionAssignment(url, assignmentId, reason) {
  clearCharacterPanelStatus();
  try {
    await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId: assignmentId, reason: reason })
    });
    await refreshCharacterAssignments();
    await refreshCharacterAuditLog();
  } catch (error) {
    setCharacterPanelStatus('Character lifecycle update failed: ' + String(error), true);
  }
}

export async function dispatchCharacterAssignment(assignmentId) {
  await transitionAssignment('/api/workspace/character-dispatch', assignmentId);
}

export async function suspendCharacterAssignment(assignmentId) {
  var reason = prompt('Suspend reason:', 'policy hold');
  if (reason == null) return;
  await transitionAssignment('/api/workspace/character-suspend', assignmentId, reason);
}

export async function resumeCharacterAssignment(assignmentId) {
  await transitionAssignment('/api/workspace/character-resume', assignmentId);
}

export async function revokeCharacterAssignment(assignmentId) {
  var reason = prompt('Revocation reason:', 'manual revocation');
  if (reason == null) return;
  await transitionAssignment('/api/workspace/character-revoke', assignmentId, reason);
}

export function onCharacterDefinitionChanged() {
  renderCharacterDefinitionPreview();
}

export function initCharacterPanel() {
  renderCharacterSummary();
  renderCharacterAssignmentForm();
  renderCharacterRoster();
  renderCharacterAuditLog();
  void refreshCharacterPanel();
}