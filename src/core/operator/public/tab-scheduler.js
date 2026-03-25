import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';

/* ── Local state ── */
let currentSchedulerView = 'calendar';
let calMode = 'year';
let calCursor = new Date();
let cachedEvents = [];
let cachedProjects = [];
let cachedTasks = [];
let modalType = null; // 'event' | 'task' | 'project'
let modalEditId = null;

/* ── Date helpers ── */

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDateStr(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function isToday(d) {
  var t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

export function mondayOfWeek(d) {
  var clone = new Date(d);
  var day = clone.getDay();
  var diff = (day === 0 ? -6 : 1) - day;
  clone.setDate(clone.getDate() + diff);
  return clone;
}

export function eventsForDate(dateStr) {
  return cachedEvents.filter(function (e) {
    var eStart = (e.start || e.startDate || '').substring(0, 10);
    var eEnd = (e.end || e.endDate || e.start || e.startDate || '').substring(0, 10);
    return dateStr >= eStart && dateStr <= eEnd;
  });
}

/* ── Data loading ── */

export async function refreshSchedulerData() {
  dashboardLog('scheduler', 'scheduler.refresh', 'Fetching scheduler data');
  try {
    var now = new Date();
    var yearStart = now.getFullYear() + '-01-01';
    var yearEnd = now.getFullYear() + '-12-31';
    var evtData = await request('/api/scheduler/events?start=' + yearStart + '&end=' + yearEnd);
    cachedEvents = evtData.events || evtData || [];
  } catch (_) {
    cachedEvents = [];
  }
  try {
    var projData = await request('/api/scheduler/projects');
    cachedProjects = projData.projects || projData || [];
    // Collect all tasks from projects
    cachedTasks = [];
    for (var i = 0; i < cachedProjects.length; i++) {
      var p = cachedProjects[i];
      if (p.tasks && Array.isArray(p.tasks)) {
        for (var j = 0; j < p.tasks.length; j++) {
          cachedTasks.push(Object.assign({ projectId: p.id || p.projectId }, p.tasks[j]));
        }
      }
    }
  } catch (_) {
    cachedProjects = [];
    cachedTasks = [];
  }
  renderSchedulerPanel();
}

/* ── View switching ── */

export function switchSchedulerView(view) {
  currentSchedulerView = view;
  var views = ['calendar', 'projects', 'board', 'timeline'];
  for (var i = 0; i < views.length; i++) {
    var panel = document.getElementById('sched-view-' + views[i]);
    if (panel) panel.style.display = views[i] === view ? '' : 'none';
    var btns = document.querySelectorAll('.sched-subnav-btn[data-sched-view]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].classList.toggle('active', btns[b].getAttribute('data-sched-view') === view);
    }
  }
  renderSchedulerPanel();
}

export function renderSchedulerPanel() {
  switch (currentSchedulerView) {
    case 'calendar': renderSchedulerCalendar(); break;
    case 'projects': renderSchedulerProjects(); break;
    case 'board': renderSchedulerBoard(); break;
    case 'timeline': renderSchedulerGantt(); break;
  }
}

/* ── Calendar mode and navigation ── */

export function setCalMode(mode) {
  calMode = mode;
  var btns = document.querySelectorAll('.sched-mode-btn[data-cal-mode]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-cal-mode') === mode);
  }
  renderSchedulerCalendar();
}

export function schedCalNav(dir) {
  if (calMode === 'year') {
    calCursor.setFullYear(calCursor.getFullYear() + dir);
  } else if (calMode === 'month') {
    calCursor.setMonth(calCursor.getMonth() + dir);
  } else if (calMode === 'week') {
    calCursor.setDate(calCursor.getDate() + dir * 7);
  } else if (calMode === 'day') {
    calCursor.setDate(calCursor.getDate() + dir);
  }
  renderSchedulerCalendar();
}

/* ── Calendar renderers ── */

export function renderSchedulerCalendar() {
  var title = document.getElementById('sched-cal-title');
  var body = document.getElementById('sched-cal-body');
  if (!body) return;

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (calMode === 'year') {
    if (title) title.textContent = String(calCursor.getFullYear());
    var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
    for (var m = 0; m < 12; m++) {
      html += renderMiniMonth(calCursor.getFullYear(), m);
    }
    html += '</div>';
    body.innerHTML = html;
  } else if (calMode === 'month') {
    if (title) title.textContent = months[calCursor.getMonth()] + ' ' + calCursor.getFullYear();
    body.innerHTML = renderFullMonth(calCursor.getFullYear(), calCursor.getMonth());
  } else if (calMode === 'week') {
    var mon = mondayOfWeek(calCursor);
    if (title) title.textContent = 'Week of ' + formatDateStr(mon);
    body.innerHTML = renderWeekView(mon);
  } else if (calMode === 'day') {
    if (title) title.textContent = formatDateStr(calCursor);
    body.innerHTML = renderDayView(calCursor);
  }
}

export function renderMiniMonth(year, month) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var days = daysInMonth(year, month);
  var firstDay = new Date(year, month, 1).getDay();
  var offset = firstDay === 0 ? 6 : firstDay - 1; // Monday-based

  var html = '<div class="panel" style="padding:8px;">';
  html += '<div style="text-align:center;font-weight:600;font-size:12px;margin-bottom:4px;">' + months[month] + '</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;font-size:10px;text-align:center;">';
  var dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  for (var dl = 0; dl < 7; dl++) {
    html += '<div style="color:var(--text-muted);font-weight:600;">' + dayLabels[dl] + '</div>';
  }
  for (var blank = 0; blank < offset; blank++) {
    html += '<div></div>';
  }
  for (var d = 1; d <= days; d++) {
    var dateObj = new Date(year, month, d);
    var dateStr = formatDateStr(dateObj);
    var dayEvents = eventsForDate(dateStr);
    var todayStyle = isToday(dateObj) ? 'background:var(--accent);color:#fff;border-radius:50%;' : '';
    var eventDot = dayEvents.length > 0 ? '<div style="width:4px;height:4px;border-radius:50%;background:var(--accent);margin:1px auto 0;"></div>' : '';
    html += '<div style="padding:1px;cursor:pointer;' + todayStyle + '" onclick="setCalMode(\'day\');window._schedGoToDate&&window._schedGoToDate(\'' + dateStr + '\')" title="' + dayEvents.length + ' events">' + d + eventDot + '</div>';
  }
  html += '</div></div>';
  return html;
}

export function renderFullMonth(year, month) {
  var days = daysInMonth(year, month);
  var firstDay = new Date(year, month, 1).getDay();
  var offset = firstDay === 0 ? 6 : firstDay - 1;

  var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">';
  var dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (var dl = 0; dl < 7; dl++) {
    html += '<div style="text-align:center;padding:4px;font-weight:600;font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border);">' + dayLabels[dl] + '</div>';
  }
  for (var blank = 0; blank < offset; blank++) {
    html += '<div style="min-height:80px;padding:4px;border:1px solid rgba(148,163,184,0.06);"></div>';
  }
  for (var d = 1; d <= days; d++) {
    var dateObj = new Date(year, month, d);
    var dateStr = formatDateStr(dateObj);
    var dayEvents = eventsForDate(dateStr);
    var todayBg = isToday(dateObj) ? 'background:rgba(105,210,255,0.08);' : '';
    html += '<div style="min-height:80px;padding:4px;border:1px solid rgba(148,163,184,0.06);' + todayBg + '">';
    html += '<div style="font-weight:600;font-size:12px;' + (isToday(dateObj) ? 'color:var(--accent);' : '') + '">' + d + '</div>';
    for (var ei = 0; ei < Math.min(dayEvents.length, 3); ei++) {
      var ev = dayEvents[ei];
      html += '<div style="font-size:10px;padding:1px 4px;margin-top:2px;border-radius:3px;background:rgba(105,210,255,0.12);color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="openSchedulerModal(\'event\',\'' + escapeHtml(ev.id || ev.eventId || '') + '\')" title="' + escapeHtml(ev.title || ev.summary || '') + '">' + escapeHtml(ev.title || ev.summary || 'Event') + '</div>';
    }
    if (dayEvents.length > 3) {
      html += '<div style="font-size:10px;color:var(--text-muted);">+' + (dayEvents.length - 3) + ' more</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

export function renderWeekView(monday) {
  var dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">';
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday);
    d.setDate(d.getDate() + i);
    var dateStr = formatDateStr(d);
    var dayEvents = eventsForDate(dateStr);
    var todayBg = isToday(d) ? 'background:rgba(105,210,255,0.08);' : '';
    html += '<div style="min-height:200px;padding:6px;border:1px solid rgba(148,163,184,0.06);border-radius:6px;' + todayBg + '">';
    html += '<div style="font-weight:600;font-size:12px;margin-bottom:4px;' + (isToday(d) ? 'color:var(--accent);' : '') + '">' + dayLabels[i] + ' ' + d.getDate() + '</div>';
    for (var ei = 0; ei < dayEvents.length; ei++) {
      var ev = dayEvents[ei];
      html += '<div class="panel" style="padding:4px 6px;margin-bottom:3px;font-size:11px;cursor:pointer;" onclick="openSchedulerModal(\'event\',\'' + escapeHtml(ev.id || ev.eventId || '') + '\')">';
      html += '<div style="font-weight:600;">' + escapeHtml(ev.title || ev.summary || 'Event') + '</div>';
      if (ev.startTime || ev.time) html += '<div class="muted" style="font-size:10px;">' + escapeHtml(ev.startTime || ev.time || '') + '</div>';
      html += '</div>';
    }
    if (dayEvents.length === 0) {
      html += '<span class="muted" style="font-size:10px;">No events</span>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

export function renderDayView(date) {
  var dateStr = formatDateStr(date);
  var dayEvents = eventsForDate(dateStr);
  var html = '<div style="max-width:600px;">';
  if (dayEvents.length === 0) {
    html += '<div class="panel" style="padding:20px;text-align:center;"><span class="muted">No events scheduled for this day.</span></div>';
  }
  for (var i = 0; i < dayEvents.length; i++) {
    var ev = dayEvents[i];
    html += '<div class="panel" style="padding:10px;margin-bottom:6px;cursor:pointer;" onclick="openSchedulerModal(\'event\',\'' + escapeHtml(ev.id || ev.eventId || '') + '\')">';
    html += '<div style="font-weight:600;font-size:14px;">' + escapeHtml(ev.title || ev.summary || 'Event') + '</div>';
    if (ev.startTime || ev.time) html += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">' + escapeHtml(ev.startTime || ev.time || '') + (ev.endTime ? ' \u2013 ' + escapeHtml(ev.endTime) : '') + '</div>';
    if (ev.description) html += '<div style="font-size:12px;margin-top:4px;">' + escapeHtml(ev.description) + '</div>';
    html += '</div>';
  }
  html += '<button onclick="openSchedulerModal(\'event\')" style="margin-top:8px;padding:6px 16px;border:1px dashed var(--border);border-radius:6px;background:transparent;color:var(--accent);cursor:pointer;font-size:12px;">+ Add event for ' + escapeHtml(dateStr) + '</button>';
  html += '</div>';
  return html;
}

/* ── Projects ── */

export function renderSchedulerProjects() {
  var container = document.getElementById('sched-projects-list');
  if (!container) return;
  if (cachedProjects.length === 0) {
    container.innerHTML = '<div class="panel" style="padding:20px;text-align:center;"><span class="muted">No projects yet. Click + Project to create one.</span></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < cachedProjects.length; i++) {
    var p = cachedProjects[i];
    var pid = p.id || p.projectId || '';
    var tasks = p.tasks || [];
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    var pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    html += '<div class="panel" style="padding:12px;margin-bottom:8px;cursor:pointer;" onclick="openProjectDetail(\'' + escapeHtml(pid) + '\')">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
    html += '<div style="font-weight:600;font-size:14px;">' + escapeHtml(p.name || p.title || 'Untitled') + '</div>';
    html += '<span style="font-size:11px;color:var(--text-muted);">' + done + '/' + tasks.length + ' tasks</span>';
    html += '</div>';
    if (p.description) html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">' + escapeHtml(p.description.substring(0, 120)) + '</div>';
    html += '<div style="height:4px;background:var(--surface);border-radius:2px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:2px;"></div></div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

export async function openProjectDetail(projectId) {
  if (!projectId) return;
  try {
    var data = await request('/api/scheduler/projects/' + encodeURIComponent(projectId));
    var project = data.project || data;
    var tasks = project.tasks || [];
    var milestones = project.milestones || [];

    var titleEl = document.getElementById('sched-modal-title');
    var bodyEl = document.getElementById('sched-modal-body');
    var modal = document.getElementById('sched-modal');
    var saveBtn = document.getElementById('sched-modal-save');
    if (!bodyEl || !modal) return;

    modalType = 'project-detail';
    modalEditId = projectId;

    if (titleEl) titleEl.textContent = project.name || project.title || 'Project';
    if (saveBtn) saveBtn.style.display = 'none';

    var html = '<div>';
    if (project.description) html += '<p style="color:var(--text-muted);font-size:12px;">' + escapeHtml(project.description) + '</p>';

    // Milestones
    if (milestones.length > 0) {
      html += '<h4 style="font-size:13px;margin:12px 0 6px;">Milestones</h4>';
      for (var mi = 0; mi < milestones.length; mi++) {
        var ms = milestones[mi];
        html += '<div style="padding:4px 0;font-size:12px;">';
        html += '<span style="color:var(--accent);">\u25C6</span> ';
        html += '<strong>' + escapeHtml(ms.title || ms.name || '') + '</strong>';
        if (ms.dueDate) html += ' <span class="muted">\u2014 ' + escapeHtml(ms.dueDate) + '</span>';
        html += '</div>';
      }
    }

    // Tasks
    html += '<h4 style="font-size:13px;margin:12px 0 6px;">Tasks (' + tasks.length + ')</h4>';
    if (tasks.length === 0) {
      html += '<span class="muted" style="font-size:12px;">No tasks yet.</span>';
    }
    for (var ti = 0; ti < tasks.length; ti++) {
      var t = tasks[ti];
      var statusColor = t.status === 'done' ? '#7ecf7e' : (t.status === 'in-progress' ? '#69d2ff' : 'var(--text-muted)');
      html += '<div style="padding:4px 0;font-size:12px;display:flex;align-items:center;gap:8px;">';
      html += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';"></span>';
      html += '<span>' + escapeHtml(t.title || t.name || 'Task') + '</span>';
      html += '<span class="muted" style="font-size:10px;">' + escapeHtml(t.status || 'backlog') + '</span>';
      html += '</div>';
    }

    html += '</div>';
    bodyEl.innerHTML = html;
    modal.style.display = 'flex';
  } catch (e) {
    dashboardLog('scheduler', 'scheduler.error', 'Failed to load project: ' + e.message);
  }
}

/* ── Board (Kanban) ── */

export function renderSchedulerBoard() {
  var lanes = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  for (var li = 0; li < lanes.length; li++) {
    var laneEl = document.getElementById('sched-lane-' + lanes[li]);
    if (!laneEl) continue;
    var laneTasks = cachedTasks.filter(function (t) { return (t.status || 'backlog') === lanes[li]; });
    if (laneTasks.length === 0) {
      laneEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;font-size:11px;">No tasks</div>';
      continue;
    }
    var html = '';
    for (var ti = 0; ti < laneTasks.length; ti++) {
      var t = laneTasks[ti];
      var tid = t.id || t.taskId || '';
      html += '<div class="sched-card" draggable="true" data-task-id="' + escapeHtml(tid) + '" data-project-id="' + escapeHtml(t.projectId || '') + '" style="padding:8px;margin-bottom:4px;border-radius:6px;background:var(--surface);border:1px solid var(--border);cursor:grab;font-size:12px;">';
      html += '<div style="font-weight:600;">' + escapeHtml(t.title || t.name || 'Task') + '</div>';
      if (t.projectName || t.projectId) {
        html += '<div class="muted" style="font-size:10px;margin-top:2px;">' + escapeHtml(t.projectName || t.projectId) + '</div>';
      }
      if (t.assignee) html += '<div style="font-size:10px;margin-top:2px;">\u{1F464} ' + escapeHtml(t.assignee) + '</div>';
      html += '</div>';
    }
    laneEl.innerHTML = html;
  }
  initBoardDragDrop();
}

export function initBoardDragDrop() {
  var cards = document.querySelectorAll('.sched-card[draggable]');
  var lanes = document.querySelectorAll('.sched-lane-body');

  for (var ci = 0; ci < cards.length; ci++) {
    cards[ci].addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', this.getAttribute('data-task-id') + '|' + this.getAttribute('data-project-id'));
      this.style.opacity = '0.5';
    });
    cards[ci].addEventListener('dragend', function () {
      this.style.opacity = '1';
    });
  }

  for (var li = 0; li < lanes.length; li++) {
    lanes[li].addEventListener('dragover', function (e) {
      e.preventDefault();
      this.style.background = 'rgba(105,210,255,0.06)';
    });
    lanes[li].addEventListener('dragleave', function () {
      this.style.background = '';
    });
    lanes[li].addEventListener('drop', function (e) {
      e.preventDefault();
      this.style.background = '';
      var payload = e.dataTransfer.getData('text/plain');
      if (!payload) return;
      var parts = payload.split('|');
      var taskId = parts[0];
      var projectId = parts[1];
      var newStatus = this.parentElement.getAttribute('data-status');
      if (taskId && newStatus) {
        request('/api/scheduler/tasks/' + encodeURIComponent(taskId) + '?projectId=' + encodeURIComponent(projectId || ''), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        }).then(function () {
          refreshSchedulerData();
        }).catch(function (err) {
          dashboardLog('scheduler', 'scheduler.error', 'Failed to move task: ' + err.message);
        });
      }
    });
  }
}

/* ── Timeline (Gantt) ── */

export function renderSchedulerGantt() {
  var headerEl = document.getElementById('sched-gantt-header');
  var rowsEl = document.getElementById('sched-gantt-rows');
  if (!headerEl || !rowsEl) return;

  // Compute date range: current month ± 1 month
  var now = new Date();
  var rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var rangeEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  var totalDays = Math.ceil((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24));
  if (totalDays < 1) totalDays = 30;

  // Header: month labels
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var headerHtml = '<div style="display:flex;position:relative;height:24px;border-bottom:1px solid var(--border);">';
  var cursor = new Date(rangeStart);
  while (cursor < rangeEnd) {
    var mDays = daysInMonth(cursor.getFullYear(), cursor.getMonth());
    var mStart = Math.max(0, Math.ceil((cursor - rangeStart) / (1000 * 60 * 60 * 24)));
    var leftPct = (mStart / totalDays * 100).toFixed(2);
    var widthPct = (mDays / totalDays * 100).toFixed(2);
    headerHtml += '<div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;font-size:10px;font-weight:600;color:var(--text-muted);padding:4px;border-left:1px solid var(--border);white-space:nowrap;">' + months[cursor.getMonth()] + ' ' + cursor.getFullYear() + '</div>';
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  headerHtml += '</div>';
  headerEl.innerHTML = headerHtml;

  // Rows: one per project with task bars
  if (cachedProjects.length === 0) {
    rowsEl.innerHTML = '<div class="muted" style="padding:16px;text-align:center;font-size:12px;">No projects to display on timeline.</div>';
    return;
  }

  var rowsHtml = '';
  for (var pi = 0; pi < cachedProjects.length; pi++) {
    var p = cachedProjects[pi];
    var tasks = p.tasks || [];
    rowsHtml += '<div style="position:relative;min-height:32px;border-bottom:1px solid rgba(148,163,184,0.06);display:flex;align-items:center;">';
    rowsHtml += '<div style="width:120px;min-width:120px;padding:4px 8px;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(p.name || p.title || '') + '">' + escapeHtml(p.name || p.title || 'Project') + '</div>';
    rowsHtml += '<div style="flex:1;position:relative;height:24px;">';
    for (var ti = 0; ti < tasks.length; ti++) {
      var t = tasks[ti];
      var tStart = t.startDate || t.start;
      var tEnd = t.endDate || t.end || t.dueDate;
      if (!tStart) continue;
      var tStartDate = new Date(tStart);
      var tEndDate = tEnd ? new Date(tEnd) : new Date(tStartDate.getTime() + 86400000);
      var barLeft = Math.max(0, (tStartDate - rangeStart) / (1000 * 60 * 60 * 24));
      var barWidth = Math.max(1, (tEndDate - tStartDate) / (1000 * 60 * 60 * 24));
      var barLeftPct = (barLeft / totalDays * 100).toFixed(2);
      var barWidthPct = (barWidth / totalDays * 100).toFixed(2);
      var barColor = t.status === 'done' ? '#7ecf7e' : (t.status === 'in-progress' ? 'var(--accent)' : 'rgba(148,163,184,0.3)');
      rowsHtml += '<div title="' + escapeHtml(t.title || t.name || '') + '" style="position:absolute;left:' + barLeftPct + '%;width:' + barWidthPct + '%;height:16px;top:4px;background:' + barColor + ';border-radius:3px;font-size:9px;line-height:16px;padding:0 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#fff;opacity:0.85;">' + escapeHtml(t.title || t.name || '') + '</div>';
    }
    rowsHtml += '</div></div>';
  }
  rowsEl.innerHTML = rowsHtml;
}

/* ── Modal ── */

export function openSchedulerModal(type, editId) {
  modalType = type;
  modalEditId = editId || null;
  var modal = document.getElementById('sched-modal');
  var titleEl = document.getElementById('sched-modal-title');
  var bodyEl = document.getElementById('sched-modal-body');
  var saveBtn = document.getElementById('sched-modal-save');
  if (!modal || !bodyEl) return;

  if (saveBtn) saveBtn.style.display = '';

  var html = '';
  if (type === 'event') {
    if (titleEl) titleEl.textContent = editId ? 'Edit Event' : 'New Event';
    var existing = editId ? cachedEvents.find(function (e) { return (e.id || e.eventId) === editId; }) : null;
    html += '<label style="font-size:12px;font-weight:600;">Title</label>';
    html += '<input id="sched-modal-event-title" type="text" placeholder="Event title" value="' + escapeHtml(existing ? (existing.title || existing.summary || '') : '') + '" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0 10px;font-size:13px;" />';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    html += '<div><label style="font-size:12px;font-weight:600;">Start Date</label><input id="sched-modal-event-start" type="date" value="' + (existing ? (existing.start || existing.startDate || '').substring(0, 10) : formatDateStr(calCursor)) + '" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0;font-size:13px;" /></div>';
    html += '<div><label style="font-size:12px;font-weight:600;">End Date</label><input id="sched-modal-event-end" type="date" value="' + (existing ? (existing.end || existing.endDate || '').substring(0, 10) : '') + '" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0;font-size:13px;" /></div>';
    html += '</div>';
    html += '<label style="font-size:12px;font-weight:600;margin-top:8px;display:block;">Description</label>';
    html += '<textarea id="sched-modal-event-desc" rows="3" placeholder="Optional description" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0;font-size:12px;resize:vertical;">' + escapeHtml(existing ? (existing.description || '') : '') + '</textarea>';
  } else if (type === 'task') {
    if (titleEl) titleEl.textContent = 'New Task';
    html += '<label style="font-size:12px;font-weight:600;">Task Title</label>';
    html += '<input id="sched-modal-task-title" type="text" placeholder="Task title" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0 10px;font-size:13px;" />';
    html += '<label style="font-size:12px;font-weight:600;">Project</label>';
    html += '<select id="sched-modal-task-project" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0 10px;font-size:13px;">';
    html += '<option value="">Select project...</option>';
    for (var i = 0; i < cachedProjects.length; i++) {
      var proj = cachedProjects[i];
      html += '<option value="' + escapeHtml(proj.id || proj.projectId || '') + '">' + escapeHtml(proj.name || proj.title || 'Project') + '</option>';
    }
    html += '</select>';
    html += '<label style="font-size:12px;font-weight:600;">Status</label>';
    html += '<select id="sched-modal-task-status" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0;font-size:13px;">';
    html += '<option value="backlog">Backlog</option><option value="todo">To Do</option><option value="in-progress">In Progress</option><option value="review">Review</option><option value="done">Done</option>';
    html += '</select>';
  } else if (type === 'project') {
    if (titleEl) titleEl.textContent = 'New Project';
    html += '<label style="font-size:12px;font-weight:600;">Project Name</label>';
    html += '<input id="sched-modal-project-name" type="text" placeholder="Project name" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0 10px;font-size:13px;" />';
    html += '<label style="font-size:12px;font-weight:600;">Description</label>';
    html += '<textarea id="sched-modal-project-desc" rows="3" placeholder="Project description" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin:4px 0;font-size:12px;resize:vertical;"></textarea>';
  }

  bodyEl.innerHTML = html;
  modal.style.display = 'flex';
}

export function closeSchedulerModal() {
  var modal = document.getElementById('sched-modal');
  if (modal) modal.style.display = 'none';
  modalType = null;
  modalEditId = null;
}

export async function saveSchedulerModal() {
  if (modalType === 'event') {
    var title = (document.getElementById('sched-modal-event-title') || {}).value || '';
    var start = (document.getElementById('sched-modal-event-start') || {}).value || '';
    var end = (document.getElementById('sched-modal-event-end') || {}).value || '';
    var desc = (document.getElementById('sched-modal-event-desc') || {}).value || '';
    if (!title || !start) {
      dashboardLog('scheduler', 'scheduler.error', 'Event title and start date are required');
      return;
    }
    var body = { title: title, start: start, description: desc };
    if (end) body.end = end;
    if (modalEditId) body.eventId = modalEditId;
    try {
      await request('/api/scheduler/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      dashboardLog('scheduler', 'scheduler.event-saved', title);
    } catch (e) {
      dashboardLog('scheduler', 'scheduler.error', 'Failed to save event: ' + e.message);
    }
  } else if (modalType === 'task') {
    var taskTitle = (document.getElementById('sched-modal-task-title') || {}).value || '';
    var projectId = (document.getElementById('sched-modal-task-project') || {}).value || '';
    var status = (document.getElementById('sched-modal-task-status') || {}).value || 'backlog';
    if (!taskTitle) {
      dashboardLog('scheduler', 'scheduler.error', 'Task title is required');
      return;
    }
    try {
      await request('/api/scheduler/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskTitle, projectId: projectId, status: status })
      });
      dashboardLog('scheduler', 'scheduler.task-saved', taskTitle);
    } catch (e) {
      dashboardLog('scheduler', 'scheduler.error', 'Failed to save task: ' + e.message);
    }
  } else if (modalType === 'project') {
    var projectName = (document.getElementById('sched-modal-project-name') || {}).value || '';
    var projectDesc = (document.getElementById('sched-modal-project-desc') || {}).value || '';
    if (!projectName) {
      dashboardLog('scheduler', 'scheduler.error', 'Project name is required');
      return;
    }
    try {
      await request('/api/scheduler/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, description: projectDesc })
      });
      dashboardLog('scheduler', 'scheduler.project-saved', projectName);
    } catch (e) {
      dashboardLog('scheduler', 'scheduler.error', 'Failed to save project: ' + e.message);
    }
  }

  closeSchedulerModal();
  await refreshSchedulerData();
}

/* ── Initialization ── */

export async function initSchedulerTab() {
  dashboardLog('scheduler', 'scheduler.init', 'Initializing scheduler tab');
  // Allow day-click navigation from mini-month
  window._schedGoToDate = function (dateStr) {
    calCursor = new Date(dateStr + 'T00:00:00');
    calMode = 'day';
    renderSchedulerCalendar();
  };
  await refreshSchedulerData();
}
