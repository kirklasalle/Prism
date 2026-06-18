import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';
import { registerTooltipById } from './prism-tooltips.js';

// ── Character archetype icons ────────────────────────────────────────────────
var CHARACTER_ICONS = {
  'aria': '\u{1F916}',
  'phoenix': '\u{1F985}',
  'sentinel': '\u{1F6E1}\uFE0F'
};

function characterIcon(characterId) {
  var id = String(characterId || '').toLowerCase();
  for (var key in CHARACTER_ICONS) {
    if (id.indexOf(key) !== -1) return CHARACTER_ICONS[key];
  }
  return '\u{1F464}';
}

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

// ── Profile-aware helpers ────────────────────────────────────────────────────
function getSelectedProfile() {
  var el = document.getElementById('character-assign-profile');
  return el ? el.value : 'individual';
}

function filteredCharacters() {
  var profile = getSelectedProfile();
  return (state.availableCharacters || []).filter(function (c) {
    return !c.executionProfile || c.executionProfile === profile;
  });
}

function selectedCharacter() {
  var select = document.getElementById('character-assign-character');
  var selectedId = select ? select.value : '';
  var chars = state.availableCharacters || [];
  for (var i = 0; i < chars.length; i++) {
    if (chars[i].id === selectedId) return chars[i];
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

// ── Dynamic Labels ───────────────────────────────────────────────────────────
function updateDynamicLabels() {
  var profile = getSelectedProfile();
  var isBusiness = profile === 'business';
  var prismEmailLabel = document.getElementById('label-prism-user-email');
  var operatorEmailLabel = document.getElementById('label-operator-email');
  var hubLabel = document.getElementById('label-workspace-hub');
  var hubInput = document.getElementById('character-assign-workspace-hub');
  if (prismEmailLabel) prismEmailLabel.textContent = isBusiness ? 'Prism Employee Email *' : 'Prism Agent Email *';
  if (operatorEmailLabel) operatorEmailLabel.textContent = isBusiness ? 'Operator Email (Company) *' : 'Operator Email (Personal) *';
  if (hubLabel) hubLabel.textContent = isBusiness ? 'Workspace Label (Department / Project) *' : 'Workspace Label (optional)';
  if (hubInput) hubInput.placeholder = isBusiness ? 'e.g., Engineering, Marketing, Project X' : 'e.g., My Projects, Home Lab (optional)';
}

// ── Summary ──────────────────────────────────────────────────────────────────
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

// ── Character Profile Inspector ──────────────────────────────────────────────
export function renderCharacterDefinitionPreview() {
  var container = document.getElementById('character-definition-preview');
  if (!container) return;
  var character = selectedCharacter();
  if (!character) {
    container.innerHTML = '<div class="muted" style="font-size:12px;">Select a character to inspect its CAC profile, tool permissions, and persona.</div>';
    return;
  }
  var icon = characterIcon(character.id);
  container.innerHTML = ''
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">'
    + '<div>'
    + '<div style="font-size:16px;font-weight:700;">' + icon + ' ' + escapeHtml(character.displayName || character.name || character.id) + '</div>'
    + '<div class="muted" style="font-size:12px;margin-top:3px;">' + escapeHtml(character.id) + '</div>'
    + '</div>'
    + stateBadge(character.executionProfile || 'unknown')
    + '</div>'
    + '<div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5;">' + escapeHtml(character.persona || character.systemPrompt || 'No persona summary available.') + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px;">'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Execution Profile</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.executionProfile || 'Unspecified') + '</div></div>'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Max Risk Tier</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.maxRiskTier == null ? 'Unspecified' : String(character.maxRiskTier)) + '</div></div>'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Greeting</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.greeting || 'None') + '</div></div>'
    + '<div class="panel" style="padding:10px;"><div class="muted" style="font-size:11px;">Default Email</div><div style="font-size:13px;font-weight:600;margin-top:4px;">' + escapeHtml(character.defaultEmail || 'None') + '</div></div>'
    + '</div>'
    + '<div style="margin-top:12px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Tags</div>' + formatList(character.tags || []) + '</div>'
    + '<div style="margin-top:10px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Allowed Tools</div>' + formatList(character.allowedTools || []) + '</div>'
    + '<div style="margin-top:10px;"><div class="muted" style="font-size:11px;margin-bottom:6px;">Denied Tools</div>' + formatList(character.deniedTools || []) + '</div>';
}

// ── Filter & Roster ──────────────────────────────────────────────────────────
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
      assignment.workspaceHub,
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
    var icon = characterIcon(assignment.characterId);
    html += '<div class="panel" style="padding:14px;margin-bottom:10px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">';
    html += '<div style="min-width:220px;flex:1;">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
    html += '<div style="font-size:15px;font-weight:700;">' + icon + ' ' + escapeHtml(displayName) + '</div>';
    html += stateBadge(assignment.state);
    if (assignment.workspaceHub) {
      html += '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:rgba(105,210,255,0.15);color:#69d2ff;font-size:10px;font-weight:600;">' + escapeHtml(assignment.workspaceHub) + '</span>';
    }
    html += '</div>';
    html += '<div class="muted" style="font-size:12px;margin-top:4px;">' + escapeHtml(assignment.characterId) + ' \u2022 ' + escapeHtml(assignment.assignmentId) + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px;font-size:12px;">';
    html += '<div><div class="muted" style="font-size:11px;">Operator Email / ID</div><div>' + escapeHtml(assignment.operatorEmail || '-') + ' (' + escapeHtml(assignment.operatorId || '-') + ')</div></div>';
    html += '<div><div class="muted" style="font-size:11px;">Agent Email / Character Name</div><div>' + escapeHtml(assignment.prismUserEmail || '-') + ' (' + escapeHtml(assignment.characterId || '-') + ')</div></div>';
    html += '<div><div class="muted" style="font-size:11px;">Workspace Label (Profile)</div><div>' + escapeHtml(assignment.workspaceHub || '-') + ' (' + escapeHtml(assignment.executionProfileSegment || '-') + ')</div></div>';
    if (assignment.prismUserId) {
      html += '<div><div class="muted" style="font-size:11px;">Prism User Name</div><div>' + escapeHtml(assignment.prismUserId) + '</div></div>';
    } else {
      html += '<div><div class="muted" style="font-size:11px;">Dispatch Count</div><div>' + escapeHtml(String(assignment.dispatchCount || 0)) + '</div></div>';
    }
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
    html += '<button class="danger-button" onclick="deleteCharacterAssignment(\'' + escapeHtml(assignment.assignmentId) + '\')" style="font-size:11px;">Delete</button>';
    html += '</div>';
    html += '</div>';
    if (expanded) {
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.14);display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:12px;">';
      html += '<div><div class="muted" style="font-size:11px;">Assignment Chain</div><div style="margin-top:6px;line-height:1.6;">'
        + '<div><strong>Operator ID/Email:</strong> ' + escapeHtml(assignment.operatorId || '-') + ' / ' + escapeHtml(assignment.operatorEmail || '-') + '</div>'
        + '<div><strong>Agent Email/Character Name:</strong> ' + escapeHtml(assignment.prismUserEmail || '-') + ' / ' + escapeHtml(assignment.characterId || '-') + '</div>'
        + '<div><strong>Workspace Label:</strong> ' + escapeHtml(assignment.workspaceHub || '-') + '</div>'
        + (assignment.prismUserId ? '<div><strong>Prism User Name (optional):</strong> ' + escapeHtml(assignment.prismUserId) + '</div>' : '')
        + '<div><strong>Client ID / Session ID:</strong> ' + escapeHtml(assignment.clientId || '-') + ' / ' + escapeHtml(assignment.sessionId || '-') + '</div>'
        + '</div></div>';
      html += '<div><div class="muted" style="font-size:11px;">Lifecycle</div><div style="margin-top:6px;line-height:1.6;">'
        + '<div><strong>Assigned:</strong> ' + escapeHtml(formatTimestamp(assignment.assignedAt)) + '</div>'
        + '<div><strong>Updated:</strong> ' + escapeHtml(formatTimestamp(assignment.updatedAt)) + '</div>'
        + '<div><strong>Last Active:</strong> ' + escapeHtml(formatTimestamp(assignment.lastActiveAt)) + '</div>'
        + '<div><strong>Suspend Reason:</strong> ' + escapeHtml(assignment.suspendReason || '-') + '</div>'
        + '<div><strong>Revocation Reason:</strong> ' + escapeHtml(assignment.revocationReason || '-') + '</div>'
        + '<div><strong>Dispatch Count:</strong> ' + escapeHtml(String(assignment.dispatchCount || 0)) + '</div>'
        + '</div></div>';
      html += '</div>';
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

// ── Audit Log ────────────────────────────────────────────────────────────────
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
    html += '<div class="muted" style="font-size:11px;margin-top:3px;">' + escapeHtml(event.characterId || '-') + ' \u2022 ' + escapeHtml(event.assignmentId || '-') + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;">' + stateBadge(event.status || 'unknown') + '<div class="muted" style="font-size:11px;margin-top:4px;">' + escapeHtml(formatTimestamp(event.timestamp)) + '</div></div>';
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:12px;line-height:1.6;">';
    html += '<div><strong>Operator Email / ID:</strong> ' + escapeHtml(event.operatorEmail || '-') + (event.operatorId ? ' (' + escapeHtml(event.operatorId) + ')' : '') + '</div>';
    html += '<div><strong>Agent Email / Character Name:</strong> ' + escapeHtml(event.prismUserEmail || '-') + (event.characterId ? ' (' + escapeHtml(event.characterId) + ')' : '') + '</div>';
    var hub = event.workspaceHub || (event.accountabilityChain && event.accountabilityChain.workspaceHub) || (event.details && event.details.workspaceHub);
    if (hub) {
      html += '<div><strong>Workspace Label:</strong> ' + escapeHtml(hub) + '</div>';
    }
    if (event.prismUserId) {
      html += '<div><strong>Prism User Name:</strong> ' + escapeHtml(event.prismUserId) + '</div>';
    }
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

// ── Assignment Form (profile-filtered dropdown) ──────────────────────────────
export function renderCharacterAssignmentForm() {
  var select = document.getElementById('character-assign-character');
  var chars = filteredCharacters();
  if (select) {
    var options = '<option value="">Select a character...</option>';
    for (var i = 0; i < chars.length; i++) {
      var character = chars[i];
      var icon = characterIcon(character.id);
      var optTitle = (character.displayName || character.name || character.id) + ' \u2014 ' + (character.persona || character.greeting || 'PRISM character');
      options += '<option value="' + escapeHtml(character.id) + '"'
        + ' title="' + escapeHtml(optTitle) + '"'
        + ' data-tip-id="character:' + escapeHtml(character.id) + '"'
        + ' data-tip-kind="character">'
        + escapeHtml(icon + ' ' + (character.displayName || character.name || character.id) + ' (' + character.id + ')')
        + '</option>';
    }
    var current = select.value;
    select.innerHTML = options;
    // Try to restore previous selection if still available
    if (current) {
      var found = false;
      for (var j = 0; j < chars.length; j++) {
        if (chars[j].id === current) { found = true; break; }
      }
      if (found) select.value = current;
    }
  }
  renderCharacterChipStrip(chars, select ? select.value : '');
  registerCharacterTooltips(chars);
  updateDynamicLabels();
  renderCharacterDefinitionPreview();
}

// ── Character Chip Strip (sibling to <select>; full Prism Tooltip support) ──
function renderCharacterChipStrip(chars, selectedId) {
  var strip = document.getElementById('character-chip-strip');
  if (!strip) return;
  if (!chars || !chars.length) {
    strip.innerHTML = '<span class="muted" style="font-size:11px;">No characters match the current profile.</span>';
    return;
  }
  var html = '';
  for (var i = 0; i < chars.length; i++) {
    var character = chars[i];
    var icon = characterIcon(character.id);
    var label = character.displayName || character.name || character.id;
    var summary = (label + ' \u2014 ' + (character.persona || character.greeting || 'PRISM character')).slice(0, 200);
    var selectedClass = (selectedId && selectedId === character.id) ? ' selected' : '';
    html += '<button type="button" class="character-chip' + selectedClass + '"'
      + ' data-character-id="' + escapeHtml(character.id) + '"'
      + ' data-tip-id="character:' + escapeHtml(character.id) + '"'
      + ' data-tip-kind="character"'
      + ' title="' + escapeHtml(summary) + '"'
      + ' aria-label="' + escapeHtml(label) + ' character"'
      + ' onclick="onCharacterChipClick(\'' + escapeHtml(character.id) + '\')">'
      + '<span class="character-chip-icon" aria-hidden="true">' + icon + '</span>'
      + '<span class="character-chip-label">' + escapeHtml(label) + '</span>'
      + '</button>';
  }
  strip.innerHTML = html;
}

function registerCharacterTooltips(chars) {
  if (!chars) return;
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    registerTooltipById('character:' + c.id, buildCharacterTipDescriptor(c));
  }
}

export function buildCharacterTipDescriptor(character) {
  var label = character.displayName || character.name || character.id;
  var icon = characterIcon(character.id);
  var summaryParts = [];
  if (character.persona) summaryParts.push(character.persona);
  if (character.executionProfile) summaryParts.push('Profile: ' + character.executionProfile);
  if (character.maxRiskTier != null) summaryParts.push('Max risk tier: ' + character.maxRiskTier);
  var summary = summaryParts.join(' \u2022 ') || (character.greeting || 'PRISM character');
  var lore = Array.isArray(character.tooltipTips) ? character.tooltipTips.slice() : [];
  return {
    id: 'character:' + character.id,
    kind: 'character',
    label: label,
    icon: icon,
    summary: summary,
    lore: lore,
    telemetry: function () {
      var assignments = (state.characterAssignments || []).filter(function (a) {
        return a.characterId === character.id;
      });
      if (!assignments.length) return { 'assignments': '0' };
      var totalDispatch = 0;
      var lastActive = null;
      for (var i = 0; i < assignments.length; i++) {
        totalDispatch += Number(assignments[i].dispatchCount || 0);
        var t = assignments[i].lastActiveAt || assignments[i].updatedAt;
        if (t && (!lastActive || t > lastActive)) lastActive = t;
      }
      var metrics = {
        'assignments': String(assignments.length),
        'dispatches': String(totalDispatch),
      };
      if (lastActive) {
        try { metrics['last active'] = new Date(lastActive).toLocaleString(); }
        catch (e) { metrics['last active'] = String(lastActive); }
      }
      return metrics;
    },
    // Links are merged in by the server registry; no per-element override needed.
  };
}

export function onCharacterChipClick(characterId) {
  var select = document.getElementById('character-assign-character');
  if (!select) return;
  // Verify the option exists; if not, no-op (e.g., profile filter changed).
  var found = false;
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].value === characterId) { found = true; break; }
  }
  if (!found) return;
  select.value = characterId;
  // Update chip selection state.
  var chips = document.querySelectorAll('#character-chip-strip .character-chip');
  for (var j = 0; j < chips.length; j++) {
    if (chips[j].getAttribute('data-character-id') === characterId) chips[j].classList.add('selected');
    else chips[j].classList.remove('selected');
  }
  onCharacterDefinitionChanged();
}

// ── Data Loading ─────────────────────────────────────────────────────────────
export async function loadAvailableCharacters() {
  var data = await request('/api/workspace/characters');
  state.availableCharacters = Array.isArray(data.characters) ? data.characters : [];
  renderCharacterAssignmentForm();
}

export async function loadWorkspaceHub() {
  try {
    var data = await request('/api/workspace/hub');
    var hubInput = document.getElementById('character-assign-workspace-hub');
    if (hubInput && data.workspaceHub) {
      hubInput.value = data.workspaceHub;
    }
  } catch (e) {
    // Non-critical — hub field remains empty
  }
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
      loadWorkspaceHub(),
      refreshCharacterAssignments(),
      refreshCharacterAuditLog()
    ]);
  } catch (error) {
    setCharacterPanelStatus('Failed to load Character Panel: ' + String(error), true);
  }
}

// ── Character Selection Changed ──────────────────────────────────────────────
export function onCharacterDefinitionChanged() {
  var character = selectedCharacter();
  if (character) {
    // Auto-populate fields from character defaults
    var emailEl = document.getElementById('character-assign-prism-user-email');
    var userIdEl = document.getElementById('character-assign-prism-user-id');
    if (emailEl && character.defaultEmail) emailEl.value = character.defaultEmail;
    if (userIdEl) userIdEl.value = character.name || character.id || '';
  }
  renderCharacterDefinitionPreview();
}

// ── Profile Selection Changed ────────────────────────────────────────────────
export function onProfileChanged() {
  updateDynamicLabels();
  renderCharacterAssignmentForm();
}

// ── Workspace Hub Persistence ────────────────────────────────────────────────
export async function onWorkspaceHubBlur() {
  var hubInput = document.getElementById('character-assign-workspace-hub');
  if (!hubInput) return;
  var value = hubInput.value.trim();
  try {
    await request('/api/workspace/hub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceHub: value })
    });
  } catch (e) {
    // Silent — hub is also sent with each assignment
  }
}

// ── Submit Assignment ────────────────────────────────────────────────────────
export async function submitCharacterAssignment() {
  clearCharacterPanelStatus();
  var characterIdEl = document.getElementById('character-assign-character');
  var prismUserIdEl = document.getElementById('character-assign-prism-user-id');
  var prismUserEmailEl = document.getElementById('character-assign-prism-user-email');
  var operatorIdEl = document.getElementById('character-assign-operator-id');
  var operatorEmailEl = document.getElementById('character-assign-operator-email');
  var clientIdEl = document.getElementById('character-assign-client-id');
  var profileEl = document.getElementById('character-assign-profile');
  var hubEl = document.getElementById('character-assign-workspace-hub');
  var profile = profileEl ? profileEl.value : 'individual';
  var payload = {
    characterId: characterIdEl ? characterIdEl.value.trim() : '',
    prismUserId: prismUserIdEl ? prismUserIdEl.value.trim() : '',
    prismUserEmail: prismUserEmailEl ? prismUserEmailEl.value.trim() : '',
    operatorId: operatorIdEl ? operatorIdEl.value.trim() : '',
    operatorEmail: operatorEmailEl ? operatorEmailEl.value.trim() : '',
    clientId: clientIdEl ? clientIdEl.value.trim() : 'workspace-tab',
    sessionId: state.selectedSessionId || '',
    executionProfile: profile,
    workspaceHub: hubEl ? hubEl.value.trim() : ''
  };
  // Validation
  if (!payload.characterId) {
    setCharacterPanelStatus('Please select a character.', true);
    return;
  }
  if (!payload.prismUserEmail) {
    setCharacterPanelStatus((profile === 'business' ? 'Employee' : 'Assistant') + ' email is required.', true);
    return;
  }
  if (!payload.operatorEmail) {
    setCharacterPanelStatus((profile === 'business' ? 'Company' : 'Personal') + ' email is required.', true);
    return;
  }
  var emailPattern = /^\S+@\S+\.\S+$/;
  if (!emailPattern.test(payload.prismUserEmail)) {
    setCharacterPanelStatus('Invalid ' + (profile === 'business' ? 'employee' : 'assistant') + ' email format.', true);
    return;
  }
  if (!emailPattern.test(payload.operatorEmail)) {
    setCharacterPanelStatus('Invalid ' + (profile === 'business' ? 'company' : 'personal') + ' email format.', true);
    return;
  }
  if (profile === 'business' && !payload.workspaceHub) {
    setCharacterPanelStatus('Department / Project is required for business profiles.', true);
    return;
  }
  if (profile === 'business') {
    var prismDomain = payload.prismUserEmail.split('@').pop().toLowerCase();
    var opDomain = payload.operatorEmail.split('@').pop().toLowerCase();
    if (prismDomain !== opDomain) {
      setCharacterPanelStatus('Business profile requires matching email domains (' + escapeHtml(prismDomain) + ' vs ' + escapeHtml(opDomain) + ').', true);
      return;
    }
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

// ── Lifecycle Transitions ────────────────────────────────────────────────────
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

window.deleteCharacterAssignment = async function (assignmentId) {
  if (!confirm('Are you sure you want to permanently delete this assignment?')) return;
  try {
    const result = await request('/api/workspace/character-assignment-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentId })
    });
    if (result.error) {
      alert('Delete failed: ' + result.error);
    } else {
      await refreshCharacterPanel();
    }
  } catch (e) {
    alert('Delete failed: ' + String(e));
  }
};

// ── Init ─────────────────────────────────────────────────────────────────────
export function initCharacterPanel() {
  renderCharacterSummary();
  renderCharacterAssignmentForm();
  renderCharacterRoster();
  renderCharacterAuditLog();
  void refreshCharacterPanel();
}

// ── Custom Character Modal ───────────────────────────────────────────────────
export function showCustomCharacterModal() {
  var modal = document.getElementById('custom-character-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'custom-character-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(15, 23, 42, 0.75)';
    modal.style.backdropFilter = 'blur(4px)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '99999';
    
    var content = document.createElement('div');
    content.className = 'panel';
    content.style.width = '480px';
    content.style.maxHeight = '90vh';
    content.style.overflowY = 'auto';
    content.style.background = '#1e293b';
    content.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    content.style.borderRadius = '12px';
    content.style.padding = '24px';
    content.style.boxShadow = '0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5)';
    
    content.innerHTML = '\
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">\
        <h3 style="margin:0;font-size:18px;font-weight:700;color:#f8fafc;">Create Custom Character</h3>\
        <button type="button" onclick="closeCustomCharacterModal()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;">&times;</button>\
      </div>\
      <form id="custom-character-form" onsubmit="event.preventDefault(); submitCustomCharacter();" style="display:flex;flex-direction:column;gap:12px;">\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Character ID *</label>\
          <input type="text" id="custom-char-name" placeholder="e.g. my-custom-agent (lowercase, alphanumeric, hyphens)" required\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;" />\
        </div>\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Display Name *</label>\
          <input type="text" id="custom-char-display-name" placeholder="e.g. My Custom Agent" required\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;" />\
        </div>\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Default Agent Email *</label>\
          <input type="email" id="custom-char-email" placeholder="e.g. agent-name@prism.local" required\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;" />\
        </div>\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">System Prompt / Persona *</label>\
          <textarea id="custom-char-prompt" placeholder="Define the system instructions, behavior, and personality..." required rows="4"\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;resize:vertical;"></textarea>\
        </div>\
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">\
          <div>\
            <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Execution Profile</label>\
            <select id="custom-char-profile" onchange="onCustomCharProfileChange()"\
              style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;">\
              <option value="individual">Individual</option>\
              <option value="business">Business</option>\
            </select>\
          </div>\
          <div>\
            <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Max Risk Tier</label>\
            <select id="custom-char-risk-tier"\
              style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;">\
              <option value="2">Tier 2: Standard Risk</option>\
              <option value="1">Tier 1: Minimal Risk</option>\
            </select>\
          </div>\
        </div>\
        <div style="font-size:10.5px;color:#94a3b8;line-height:1.4;" id="custom-char-risk-help">\
          Note: Individual profile supports both Risk Tiers. Business profile enforces Tier 1 (Minimal Risk) and applies auto-hardened tool restrictions.\
        </div>\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Allowed Tools (comma-separated, optional)</label>\
          <input type="text" id="custom-char-allow" placeholder="e.g. read_file, write_file"\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;" />\
        </div>\
        <div>\
          <label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Denied Tools (comma-separated, optional)</label>\
          <input type="text" id="custom-char-deny" placeholder="e.g. shell_exec, terminal_session"\
            style="width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:#0f172a;color:#f8fafc;font-size:13px;" />\
        </div>\
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">\
          <button type="button" onclick="closeCustomCharacterModal()" class="secondary-button" style="padding:8px 16px;font-size:13px;">Cancel</button>\
          <button type="submit" class="primary-button" style="padding:8px 16px;font-size:13px;">Create Character</button>\
        </div>\
      </form>\
    ';
    modal.appendChild(content);
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }
  
  document.getElementById('custom-char-name').value = '';
  document.getElementById('custom-char-display-name').value = '';
  document.getElementById('custom-char-email').value = '';
  document.getElementById('custom-char-prompt').value = '';
  document.getElementById('custom-char-profile').value = 'individual';
  document.getElementById('custom-char-risk-tier').value = '2';
  document.getElementById('custom-char-allow').value = '';
  document.getElementById('custom-char-deny').value = '';
  onCustomCharProfileChange();
}

export function closeCustomCharacterModal() {
  var modal = document.getElementById('custom-character-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

export function onCustomCharProfileChange() {
  var profile = document.getElementById('custom-char-profile').value;
  var tierSelect = document.getElementById('custom-char-risk-tier');
  if (profile === 'business') {
    tierSelect.value = '1';
    tierSelect.disabled = true;
  } else {
    tierSelect.disabled = false;
  }
}

export async function submitCustomCharacter() {
  var name = document.getElementById('custom-char-name').value.trim();
  var displayName = document.getElementById('custom-char-display-name').value.trim();
  var email = document.getElementById('custom-char-email').value.trim();
  var promptText = document.getElementById('custom-char-prompt').value.trim();
  var profile = document.getElementById('custom-char-profile').value;
  var riskTier = parseInt(document.getElementById('custom-char-risk-tier').value, 10);
  
  var allowInput = document.getElementById('custom-char-allow').value.trim();
  var denyInput = document.getElementById('custom-char-deny').value.trim();
  
  var allow = allowInput ? allowInput.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];
  var deny = denyInput ? denyInput.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];
  
  var nameRegex = /^[a-z0-9-]+$/;
  if (!nameRegex.test(name)) {
    alert('Character ID must contain only lowercase letters, numbers, and hyphens (no spaces or special chars).');
    return;
  }
  
  var manifest = {
    name: name,
    displayName: displayName,
    systemPrompt: promptText,
    persona: promptText,
    toolPermissions: {
      allow: allow,
      deny: deny
    },
    maxRiskTier: riskTier,
    executionProfile: profile,
    defaultEmail: email,
    tags: ['custom']
  };
  
  try {
    var response = await request('/api/workspace/character-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: manifest,
        targetProfile: profile,
        commit: true
      })
    });
    
    if (response.error) {
      alert('Failed to create character: ' + response.error);
    } else {
      closeCustomCharacterModal();
      setCharacterPanelStatus('Custom character "' + displayName + '" created successfully.', false);
      await loadAvailableCharacters();
      var select = document.getElementById('character-assign-character');
      if (select) {
        select.value = name;
        onCharacterDefinitionChanged();
      }
    }
  } catch (err) {
    alert('Error creating custom character: ' + String(err));
  }
}