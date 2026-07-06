import { state, request, escapeHtml, dashboardLog } from './dashboard-core.js';

/* ── Local state ── */
let currentSchedulerView = 'calendar';
let calMode = 'day';
let calCursor = new Date();
let ganttCursor = new Date(); // To support Gantt timeline navigation
let cachedEvents = [];
let cachedProjects = [];
let cachedTasks = [];
let cachedCronJobs = [];
let modalType = null; // 'event' | 'task' | 'project' | 'cron' | 'project-detail'
let modalEditId = null;

/* ── Date helpers ── */

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isToday(d) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

export function mondayOfWeek(d) {
  const clone = new Date(d);
  const day = clone.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  clone.setDate(clone.getDate() + diff);
  return clone;
}

export function eventsForDate(dateStr) {
  return cachedEvents.filter(e => {
    const eStart = (e.start || e.startDate || '').substring(0, 10);
    const eEnd = (e.end || e.endDate || e.start || e.startDate || '').substring(0, 10);
    return dateStr >= eStart && dateStr <= eEnd;
  });
}

/* ── Data loading ── */

export async function refreshSchedulerData() {
  const indicator = document.getElementById('sched-loading-indicator');
  if (indicator) indicator.style.display = 'inline-flex';

  dashboardLog('scheduler', 'scheduler.refresh', 'Fetching scheduler data');
  
  // Dynamic query window based on calCursor year (queries yearBefore to yearAfter)
  const year = calCursor.getFullYear();
  const yearStart = `${year - 1}-01-01`;
  const yearEnd = `${year + 1}-12-31`;

  try {
    const evtData = await request(`/api/scheduler/events?start=${yearStart}&end=${yearEnd}`);
    cachedEvents = Array.isArray(evtData.events) ? evtData.events : Array.isArray(evtData) ? evtData : [];
  } catch (err) {
    dashboardLog('scheduler', 'scheduler.error', `Failed to load events: ${err.message}`);
    cachedEvents = [];
  }

  try {
    const projData = await request('/api/scheduler/projects');
    cachedProjects = Array.isArray(projData.projects) ? projData.projects : Array.isArray(projData) ? projData : [];
    
    // Collect all tasks from projects
    cachedTasks = [];
    for (const p of cachedProjects) {
      if (p.tasks && Array.isArray(p.tasks)) {
        for (const t of p.tasks) {
          cachedTasks.push(Object.assign({ projectId: p.id || p.projectId, projectName: p.name }, t));
        }
      }
    }
  } catch (err) {
    dashboardLog('scheduler', 'scheduler.error', `Failed to load projects: ${err.message}`);
    cachedProjects = [];
    cachedTasks = [];
  }

  try {
    const cronData = await request('/api/scheduler/cron');
    cachedCronJobs = Array.isArray(cronData) ? cronData : [];
  } catch (err) {
    dashboardLog('scheduler', 'scheduler.error', `Failed to load cron jobs: ${err.message}`);
    cachedCronJobs = [];
  }

  if (indicator) indicator.style.display = 'none';
  renderSchedulerPanel();
}

/* ── View switching ── */

export function switchSchedulerView(view) {
  currentSchedulerView = view;
  const views = ['calendar', 'projects', 'board', 'timeline', 'cron'];
  for (const v of views) {
    const panel = document.getElementById(`sched-view-${v}`);
    if (panel) panel.style.display = v === view ? '' : 'none';
  }
  const btns = document.querySelectorAll('.sched-subnav-btn[data-sched-view]');
  for (const btn of btns) {
    btn.classList.toggle('active', btn.getAttribute('data-sched-view') === view);
  }
  renderSchedulerPanel();
}

export function renderSchedulerPanel() {
  switch (currentSchedulerView) {
    case 'calendar': renderSchedulerCalendar(); break;
    case 'projects': renderSchedulerProjects(); break;
    case 'board': renderSchedulerBoard(); break;
    case 'timeline': renderSchedulerGantt(); break;
    case 'cron': renderCronJobs(); break;
  }
}

/* ── Calendar mode and navigation ── */

export function setCalMode(mode) {
  calMode = mode;
  const btns = document.querySelectorAll('.sched-mode-btn[data-cal-mode]');
  for (const btn of btns) {
    btn.classList.toggle('active', btn.getAttribute('data-cal-mode') === mode);
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
  // When year changes, trigger data refresh to grab events for the new year range
  refreshSchedulerData();
}

/* ── Gantt timeline navigation ── */

export function ganttNav(dir) {
  ganttCursor.setMonth(ganttCursor.getMonth() + dir);
  renderSchedulerGantt();
}

/* ── Calendar renderers ── */

const MONTHS_LBL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function renderSchedulerCalendar() {
  const title = document.getElementById('sched-cal-title');
  const body = document.getElementById('sched-cal-body');
  if (!body) return;

  if (calMode === 'year') {
    if (title) title.textContent = String(calCursor.getFullYear());
    let html = '<div class="sched-mini-month-container">';
    for (let m = 0; m < 12; m++) {
      html += renderMiniMonth(calCursor.getFullYear(), m);
    }
    html += '</div>';
    body.innerHTML = html;
  } else if (calMode === 'month') {
    if (title) title.textContent = `${MONTHS_LBL[calCursor.getMonth()]} ${calCursor.getFullYear()}`;
    body.innerHTML = renderFullMonth(calCursor.getFullYear(), calCursor.getMonth());
  } else if (calMode === 'week') {
    const mon = mondayOfWeek(calCursor);
    if (title) title.textContent = `Week of ${formatDateStr(mon)}`;
    body.innerHTML = renderWeekView(mon);
  } else if (calMode === 'day') {
    if (title) title.textContent = formatDateStr(calCursor);
    body.innerHTML = renderDayView(calCursor);
  }
}

export function renderMiniMonth(year, month) {
  const days = daysInMonth(year, month);
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday-based

  let html = `<div class="panel sched-mini-month-card">
    <div class="sched-mini-month-title">${MONTHS_SHORT[month]}</div>
    <div class="sched-mini-month-grid">`;
  
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  for (const label of dayLabels) {
    html += `<div class="sched-mini-month-day-lbl">${label}</div>`;
  }
  for (let blank = 0; blank < offset; blank++) {
    html += '<div></div>';
  }
  for (let d = 1; d <= days; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = formatDateStr(dateObj);
    const dayEvents = eventsForDate(dateStr);
    const classes = ['sched-mini-month-day'];
    if (isToday(dateObj)) classes.push('sched-mini-month-today');
    
    const eventDot = dayEvents.length > 0 ? '<div class="sched-mini-month-dot"></div>' : '';
    html += `<div class="${classes.join(' ')}" onclick="setCalMode('day'); window._schedGoToDate('${dateStr}')" title="${dayEvents.length} events">${d}${eventDot}</div>`;
  }
  html += '</div></div>';
  return html;
}

export function renderFullMonth(year, month) {
  const days = daysInMonth(year, month);
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  let html = '<div class="sched-full-month-grid">';
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const label of dayLabels) {
    html += `<div class="sched-full-month-day-lbl">${label}</div>`;
  }
  for (let blank = 0; blank < offset; blank++) {
    html += '<div class="sched-full-month-cell" style="opacity:0.25;"></div>';
  }
  for (let d = 1; d <= days; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = formatDateStr(dateObj);
    const dayEvents = eventsForDate(dateStr);
    
    const cellClasses = ['sched-full-month-cell'];
    if (isToday(dateObj)) cellClasses.push('sched-full-month-cell-today');
    
    const numClasses = ['sched-full-month-day-num'];
    if (isToday(dateObj)) numClasses.push('sched-full-month-day-num-today');

    html += `<div class="${cellClasses.join(' ')}">
      <div class="${numClasses.join(' ')}">${d}</div>`;
    
    const maxVisible = 3;
    for (let ei = 0; ei < Math.min(dayEvents.length, maxVisible); ei++) {
      const ev = dayEvents[ei];
      const evId = ev.id || ev.eventId || '';
      html += `<div class="sched-full-month-event-pill" onclick="openSchedulerModal('event','${escapeHtml(evId)}')" title="${escapeHtml(ev.title || ev.summary || '')}">
        ${escapeHtml(ev.title || ev.summary || 'Event')}
      </div>`;
    }
    if (dayEvents.length > maxVisible) {
      html += `<div style="font-size:10px;color:var(--muted);padding-left:4px;margin-top:2px;">+${dayEvents.length - maxVisible} more</div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

export function renderWeekView(monday) {
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '<div class="sched-week-grid">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateStr(d);
    const dayEvents = eventsForDate(dateStr);
    
    const columnClasses = ['sched-week-column'];
    if (isToday(d)) columnClasses.push('sched-week-column-today');

    const lblClasses = ['sched-week-day-lbl'];
    if (isToday(d)) lblClasses.push('sched-week-day-lbl-today');

    html += `<div class="${columnClasses.join(' ')}">
      <div class="${lblClasses.join(' ')}">${dayLabels[i]} ${d.getDate()}</div>`;
    
    for (const ev of dayEvents) {
      const evId = ev.id || ev.eventId || '';
      html += `<div class="panel sched-week-event-card" onclick="openSchedulerModal('event','${escapeHtml(evId)}')">
        <div class="sched-week-event-title">${escapeHtml(ev.title || ev.summary || 'Event')}</div>`;
      if (ev.startTime || ev.time) {
        html += `<div class="muted" style="font-size:10px;">${escapeHtml(ev.startTime || ev.time || '')}</div>`;
      }
      html += '</div>';
    }
    if (dayEvents.length === 0) {
      html += '<span class="muted" style="font-size:10px;display:block;text-align:center;margin-top:12px;">No events</span>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

export function renderDayView(date) {
  const dateStr = formatDateStr(date);
  const dayEvents = eventsForDate(dateStr);
  let html = '<div class="sched-day-view-container">';
  
  if (dayEvents.length === 0) {
    html += '<div class="panel" style="padding:40px;text-align:center;border-style:dashed;"><span class="muted">No events scheduled for this day.</span></div>';
  } else {
    for (const ev of dayEvents) {
      const evId = ev.id || ev.eventId || '';
      html += `<div class="panel sched-day-event-card" onclick="openSchedulerModal('event','${escapeHtml(evId)}')">
        <div class="sched-day-event-title">${escapeHtml(ev.title || ev.summary || 'Event')}</div>`;
      if (ev.startTime || ev.time) {
        html += `<div class="sched-day-event-time">${escapeHtml(ev.startTime || ev.time || '')}${ev.endTime ? ` – ${escapeHtml(ev.endTime)}` : ''}</div>`;
      }
      if (ev.description) {
        html += `<div class="sched-day-event-desc">${escapeHtml(ev.description)}</div>`;
      }
      html += '</div>';
    }
  }
  html += `<button class="sched-day-add-btn" onclick="openSchedulerModal('event')">+ Add event for ${escapeHtml(dateStr)}</button>`;
  html += '</div>';
  return html;
}

/* ── Projects ── */

export function renderSchedulerProjects() {
  const container = document.getElementById('sched-projects-list');
  if (!container) return;
  if (cachedProjects.length === 0) {
    container.innerHTML = '<div class="panel" style="padding:40px;text-align:center;border-style:dashed;"><span class="muted">No projects yet. Click + Project to create one.</span></div>';
    return;
  }
  let html = '';
  for (const p of cachedProjects) {
    const pid = p.id || p.projectId || '';
    const tasks = p.tasks || [];
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    
    html += `<div class="panel sched-project-card" onclick="openProjectDetail('${escapeHtml(pid)}')">
      <div class="sched-project-header">
        <div class="sched-project-name">${escapeHtml(p.name || p.title || 'Untitled')}</div>
        <span class="sched-project-meta">${done}/${tasks.length} tasks</span>
      </div>`;
    if (p.description) {
      html += `<div class="sched-project-desc">${escapeHtml(p.description.substring(0, 120))}</div>`;
    }
    html += `<div class="sched-project-progress-bar">
      <div class="sched-project-progress-fill" style="width:${pct}%;"></div>
    </div></div>`;
  }
  container.innerHTML = html;
}

export async function openProjectDetail(projectId) {
  if (!projectId) return;
  try {
    const data = await request(`/api/scheduler/projects/${encodeURIComponent(projectId)}`);
    const project = data.project || data;
    const tasks = project.tasks || [];
    const milestones = project.milestones || [];

    const titleEl = document.getElementById('sched-modal-title');
    const bodyEl = document.getElementById('sched-modal-body');
    const modal = document.getElementById('sched-modal');
    const saveBtn = document.getElementById('sched-modal-save');
    if (!bodyEl || !modal) return;

    modalType = 'project-detail';
    modalEditId = projectId;

    if (titleEl) titleEl.textContent = project.name || project.title || 'Project Details';
    if (saveBtn) saveBtn.style.display = 'none';

    let html = '<div class="sched-project-detail-content">';
    if (project.description) {
      html += `<p class="sched-detail-desc">${escapeHtml(project.description)}</p>`;
    }

    // Milestones
    if (milestones.length > 0) {
      html += '<h4 class="sched-detail-section-title">Milestones</h4>';
      for (const ms of milestones) {
        html += `<div class="sched-detail-milestone">
          <span class="sched-detail-milestone-marker">◆</span> 
          <strong>${escapeHtml(ms.title || ms.name || '')}</strong>`;
        if (ms.dueDate) html += ` <span class="muted">— ${escapeHtml(ms.dueDate)}</span>`;
        html += '</div>';
      }
    }

    // Tasks list inside Project Details modal with individual task delete actions
    html += `<h4 class="sched-detail-section-title">Tasks (${tasks.length})</h4>`;
    if (tasks.length === 0) {
      html += '<span class="muted" style="font-size:12px;">No tasks yet.</span>';
    } else {
      for (const t of tasks) {
        const statusColor = t.status === 'done' ? '#7ecf7e' : (t.status === 'in-progress' ? '#69d2ff' : 'var(--muted)');
        html += `<div class="sched-detail-task" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="sched-detail-task-dot" style="background:${statusColor};"></span>
            <span>${escapeHtml(t.title || t.name || 'Task')}</span>
            <span class="muted" style="font-size:10px;">(${escapeHtml(t.status || 'backlog')})</span>
          </div>
          <button class="secondary-button" style="padding:2px 8px;font-size:10px;color:var(--danger);" onclick="deleteSchedulerTask('${escapeHtml(t.id)}','${escapeHtml(projectId)}')">Delete</button>
        </div>`;
      }
    }

    // Project delete button
    html += `<div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px;display:flex;justify-content:flex-end;">
      <button class="danger-button" onclick="deleteSchedulerProject('${escapeHtml(projectId)}')">🗑 Delete Project</button>
    </div>`;

    html += '</div>';
    bodyEl.innerHTML = html;
    modal.style.display = 'flex';
  } catch (e) {
    dashboardLog('scheduler', 'scheduler.error', `Failed to load project: ${e.message}`);
  }
}

/* ── Board (Kanban) ── */

export function renderSchedulerBoard() {
  const lanes = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  for (const lane of lanes) {
    const laneEl = document.getElementById(`sched-lane-${lane}`);
    if (!laneEl) continue;
    const laneTasks = cachedTasks.filter(t => (t.status || 'backlog') === lane);
    if (laneTasks.length === 0) {
      laneEl.innerHTML = '<div class="muted" style="padding:20px;text-align:center;font-size:11px;">No tasks</div>';
      continue;
    }
    let html = '';
    for (const t of laneTasks) {
      const tid = t.id || t.taskId || '';
      html += `<div class="sched-kanban-card" draggable="true" data-task-id="${escapeHtml(tid)}" data-project-id="${escapeHtml(t.projectId || '')}">
        <div class="sched-kanban-card-title">${escapeHtml(t.title || t.name || 'Task')}</div>`;
      if (t.projectName || t.projectId) {
        html += `<div class="sched-kanban-card-project muted">${escapeHtml(t.projectName || t.projectId)}</div>`;
      }
      if (t.assignee) {
        html += `<div class="sched-kanban-card-assignee">👤 ${escapeHtml(t.assignee)}</div>`;
      }
      html += '</div>';
    }
    laneEl.innerHTML = html;
  }
  initBoardDragDrop();
}

export function initBoardDragDrop() {
  const cards = document.querySelectorAll('.sched-kanban-card[draggable]');
  for (const card of cards) {
    card.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', `${this.getAttribute('data-task-id')}|${this.getAttribute('data-project-id')}`);
      this.style.opacity = '0.5';
    });
    card.addEventListener('dragend', function () {
      this.style.opacity = '1';
    });
  }
}

/* ── Timeline (Gantt) ── */

export function renderSchedulerGantt() {
  const rangeLabel = document.getElementById('sched-gantt-range-label');
  const headerEl = document.getElementById('sched-gantt-header');
  const rowsEl = document.getElementById('sched-gantt-rows');
  if (!headerEl || !rowsEl) return;

  // Compute date range: ganttCursor month ± 1 month
  const rangeStart = new Date(ganttCursor.getFullYear(), ganttCursor.getMonth() - 1, 1);
  const rangeEnd = new Date(ganttCursor.getFullYear(), ganttCursor.getMonth() + 2, 0);
  let totalDays = Math.ceil((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24));
  if (totalDays < 1) totalDays = 30;

  if (rangeLabel) {
    rangeLabel.textContent = `${MONTHS_SHORT[rangeStart.getMonth()]} ${rangeStart.getFullYear()} – ${MONTHS_SHORT[rangeEnd.getMonth()]} ${rangeEnd.getFullYear()}`;
  }

  // Header: month labels
  let headerHtml = '';
  const cursor = new Date(rangeStart);
  while (cursor < rangeEnd) {
    const mDays = daysInMonth(cursor.getFullYear(), cursor.getMonth());
    const mStart = Math.max(0, Math.ceil((cursor - rangeStart) / (1000 * 60 * 60 * 24)));
    const leftPct = ((mStart / totalDays) * 100).toFixed(2);
    const widthPct = ((mDays / totalDays) * 100).toFixed(2);
    headerHtml += `<div class="sched-gantt-month-label" style="left:${leftPct}%;width:${widthPct}%;">
      ${MONTHS_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}
    </div>`;
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  headerEl.innerHTML = headerHtml;

  // Rows: one per project with task bars
  if (cachedProjects.length === 0) {
    rowsEl.innerHTML = '<div class="muted" style="padding:40px;text-align:center;font-size:12px;border:1px dashed var(--border);border-radius:8px;margin-top:8px;">No projects to display on timeline.</div>';
    return;
  }

  let rowsHtml = '';
  for (const p of cachedProjects) {
    const tasks = p.tasks || [];
    rowsHtml += `<div class="sched-gantt-row">
      <div class="sched-gantt-row-title" title="${escapeHtml(p.name || p.title || '')}">${escapeHtml(p.name || p.title || 'Project')}</div>
      <div class="sched-gantt-row-track">`;
    for (const t of tasks) {
      const tStart = t.startDate || t.start;
      const tEnd = t.endDate || t.end || t.dueDate;
      if (!tStart) continue;
      
      const tStartDate = new Date(tStart);
      const tEndDate = tEnd ? new Date(tEnd) : new Date(tStartDate.getTime() + 86400000);
      
      const barLeft = Math.max(0, (tStartDate - rangeStart) / (1000 * 60 * 60 * 24));
      const barWidth = Math.max(1, (tEndDate - tStartDate) / (1000 * 60 * 60 * 24));
      const barLeftPct = ((barLeft / totalDays) * 100).toFixed(2);
      const barWidthPct = ((barWidth / totalDays) * 100).toFixed(2);
      
      let barColor = 'rgba(148, 163, 184, 0.3)';
      if (t.status === 'done') barColor = '#7ecf7e';
      else if (t.status === 'in-progress') barColor = 'var(--accent)';
      
      rowsHtml += `<div class="sched-gantt-bar" title="${escapeHtml(t.title || t.name || '')}" style="left:${barLeftPct}%;width:${barWidthPct}%;background:${barColor};">
        ${escapeHtml(t.title || t.name || '')}
      </div>`;
    }
    rowsHtml += '</div></div>';
  }
  rowsEl.innerHTML = rowsHtml;
}

/* ── Modal Error Handlers ── */

function showModalError(msg) {
  let errorContainer = document.getElementById('sched-modal-error');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'sched-modal-error';
    errorContainer.className = 'sched-error-banner';
    const bodyEl = document.getElementById('sched-modal-body');
    if (bodyEl) bodyEl.parentNode.insertBefore(errorContainer, bodyEl);
  }
  errorContainer.textContent = msg;
}

function clearModalError() {
  const errorContainer = document.getElementById('sched-modal-error');
  if (errorContainer) errorContainer.remove();
}

/* ── Open/Close Modals ── */

export function openSchedulerModal(type, editId) {
  clearModalError();
  modalType = type;
  modalEditId = editId || null;
  const modal = document.getElementById('sched-modal');
  const titleEl = document.getElementById('sched-modal-title');
  const bodyEl = document.getElementById('sched-modal-body');
  const saveBtn = document.getElementById('sched-modal-save');
  if (!modal || !bodyEl) return;

  if (saveBtn) saveBtn.style.display = '';

  let html = '';
  if (type === 'event') {
    titleEl.textContent = editId ? 'Edit Event' : 'New Event';
    const existing = editId ? cachedEvents.find(e => (e.id || e.eventId) === editId) : null;
    
    html += `<label class="sched-modal-label">Title</label>
      <input id="sched-modal-event-title" class="sched-modal-input" type="text" placeholder="Event title" value="${escapeHtml(existing ? (existing.title || existing.summary || '') : '')}" />
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div>
          <label class="sched-modal-label">Start Date</label>
          <input id="sched-modal-event-start" class="sched-modal-input" type="date" value="${existing ? (existing.start || existing.startDate || '').substring(0, 10) : formatDateStr(calCursor)}" />
        </div>
        <div>
          <label class="sched-modal-label">End Date</label>
          <input id="sched-modal-event-end" class="sched-modal-input" type="date" value="${existing ? (existing.end || existing.endDate || '').substring(0, 10) : ''}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <div>
          <label class="sched-modal-label">Start Time</label>
          <input id="sched-modal-event-start-time" class="sched-modal-input" type="time" value="${existing && existing.startTime ? existing.startTime : ''}" />
        </div>
        <div>
          <label class="sched-modal-label">End Time</label>
          <input id="sched-modal-event-end-time" class="sched-modal-input" type="time" value="${existing && existing.endTime ? existing.endTime : ''}" />
        </div>
      </div>
      <label class="sched-modal-label" style="margin-top:8px;display:block;">Description</label>
      <textarea id="sched-modal-event-desc" class="sched-modal-textarea" rows="3" placeholder="Optional description">${escapeHtml(existing ? (existing.description || '') : '')}</textarea>`;

    if (editId) {
      // Add event delete option
      html += `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:flex-end;">
        <button class="danger-button" onclick="deleteSchedulerEvent('${escapeHtml(editId)}')">🗑 Delete Event</button>
      </div>`;
    }
  } else if (type === 'task') {
    titleEl.textContent = 'New Task';
    html += `<label class="sched-modal-label">Task Title</label>
      <input id="sched-modal-task-title" class="sched-modal-input" type="text" placeholder="Task title" />
      <label class="sched-modal-label">Project</label>
      <select id="sched-modal-task-project" class="sched-modal-select">
        <option value="">Select project...</option>`;
    for (const proj of cachedProjects) {
      html += `<option value="${escapeHtml(proj.id || proj.projectId || '')}">${escapeHtml(proj.name || proj.title || 'Project')}</option>`;
    }
    html += `</select>
      <label class="sched-modal-label">Status</label>
      <select id="sched-modal-task-status" class="sched-modal-select">
        <option value="backlog">Backlog</option>
        <option value="todo">To Do</option>
        <option value="in-progress">In Progress</option>
        <option value="review">Review</option>
        <option value="done">Done</option>
      </select>`;
  } else if (type === 'project') {
    titleEl.textContent = 'New Project';
    html += `<label class="sched-modal-label">Project Name</label>
      <input id="sched-modal-project-name" class="sched-modal-input" type="text" placeholder="Project name" />
      <label class="sched-modal-label">Description</label>
      <textarea id="sched-modal-project-desc" class="sched-modal-textarea" rows="3" placeholder="Project description"></textarea>`;
  } else if (type === 'cron') {
    titleEl.textContent = 'New Cron Job';
    html += `<label class="sched-modal-label">Label</label>
      <input id="sched-modal-cron-label" class="sched-modal-input" type="text" placeholder="Job label" />
      <label class="sched-modal-label">Type</label>
      <select id="sched-modal-cron-type" class="sched-modal-select" onchange="toggleCronFields()">
        <option value="recurring">Recurring (Cron)</option>
        <option value="once">One-time</option>
      </select>
      <div id="sched-cron-recurring-fields">
        <label class="sched-modal-label">Cron Expression</label>
        <input id="sched-modal-cron-expr" class="sched-modal-input" type="text" placeholder="*/5 * * * *" style="font-family:monospace;" />
        <div class="muted" style="font-size:11px;margin-bottom:8px;">Format: minute hour dayOfMonth month dayOfWeek</div>
      </div>
      <div id="sched-cron-once-fields" style="display:none;">
        <label class="sched-modal-label">Run At</label>
        <input id="sched-modal-cron-runat" class="sched-modal-input" type="datetime-local" />
      </div>
      <label class="sched-modal-label">Action</label>
      <input id="sched-modal-cron-action" class="sched-modal-input" type="text" placeholder="action-name" />
      <label class="sched-modal-label">Payload (JSON, optional)</label>
      <textarea id="sched-modal-cron-payload" class="sched-modal-textarea" rows="3" placeholder='{"key": "value"}' style="font-family:monospace;"></textarea>`;
  }

  bodyEl.innerHTML = html;
  modal.style.display = 'flex';
}

export function closeSchedulerModal() {
  clearModalError();
  const modal = document.getElementById('sched-modal');
  if (modal) modal.style.display = 'none';
  modalType = null;
  modalEditId = null;
}

/* ── Save handlers split into modular functions ── */

async function saveEvent() {
  const title = (document.getElementById('sched-modal-event-title') || {}).value || '';
  const start = (document.getElementById('sched-modal-event-start') || {}).value || '';
  const end = (document.getElementById('sched-modal-event-end') || {}).value || '';
  const startTime = (document.getElementById('sched-modal-event-start-time') || {}).value || '';
  const endTime = (document.getElementById('sched-modal-event-end-time') || {}).value || '';
  const desc = (document.getElementById('sched-modal-event-desc') || {}).value || '';

  if (!title || !start) {
    showModalError('Event title and start date are required');
    return;
  }

  const body = { title, start, description: desc, startTime, endTime };
  if (end) body.end = end;

  const endpoint = modalEditId ? `/api/scheduler/events/${encodeURIComponent(modalEditId)}` : '/api/scheduler/events';
  const method = modalEditId ? 'PUT' : 'POST';

  await request(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  dashboardLog('scheduler', 'scheduler.event-saved', title);
}

async function saveTask() {
  const title = (document.getElementById('sched-modal-task-title') || {}).value || '';
  const projectId = (document.getElementById('sched-modal-task-project') || {}).value || '';
  const status = (document.getElementById('sched-modal-task-status') || {}).value || 'backlog';

  if (!title) {
    showModalError('Task title is required');
    return;
  }
  if (!projectId) {
    showModalError('Project selection is required');
    return;
  }

  await request('/api/scheduler/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, projectId, status })
  });

  dashboardLog('scheduler', 'scheduler.task-saved', title);
}

async function saveProject() {
  const name = (document.getElementById('sched-modal-project-name') || {}).value || '';
  const desc = (document.getElementById('sched-modal-project-desc') || {}).value || '';

  if (!name) {
    showModalError('Project name is required');
    return;
  }

  await request('/api/scheduler/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: desc })
  });

  dashboardLog('scheduler', 'scheduler.project-saved', name);
}

async function saveCron() {
  const label = (document.getElementById('sched-modal-cron-label') || {}).value || '';
  const type = (document.getElementById('sched-modal-cron-type') || {}).value || 'recurring';
  const expr = (document.getElementById('sched-modal-cron-expr') || {}).value || '';
  const runAt = (document.getElementById('sched-modal-cron-runat') || {}).value || '';
  const action = (document.getElementById('sched-modal-cron-action') || {}).value || '';
  const payloadRaw = (document.getElementById('sched-modal-cron-payload') || {}).value || '';

  if (!label || !action) {
    showModalError('Cron job label and action are required');
    return;
  }

  const body = { label, type, action };
  if (type === 'recurring') {
    if (!expr) {
      showModalError('Cron expression is required for recurring jobs');
      return;
    }
    body.cronExpression = expr;
  } else {
    if (!runAt) {
      showModalError('Run-at datetime is required for one-time jobs');
      return;
    }
    body.runAt = runAt;
  }

  if (payloadRaw.trim()) {
    try {
      body.payload = JSON.parse(payloadRaw);
    } catch (_) {
      showModalError('Payload must be valid JSON');
      return;
    }
  }

  await request('/api/scheduler/cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  dashboardLog('scheduler', 'scheduler.cron-saved', label);
}

export async function saveSchedulerModal() {
  clearModalError();
  try {
    if (modalType === 'event') await saveEvent();
    else if (modalType === 'task') await saveTask();
    else if (modalType === 'project') await saveProject();
    else if (modalType === 'cron') await saveCron();

    closeSchedulerModal();
    await refreshSchedulerData();
  } catch (err) {
    showModalError(err.message || 'An error occurred during save.');
  }
}

/* ── Entity Deletion Handlers ── */

export async function deleteSchedulerEvent(eventId) {
  if (!confirm('Are you sure you want to delete this event?')) return;
  try {
    await request(`/api/scheduler/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    dashboardLog('scheduler', 'scheduler.event-deleted', eventId);
    closeSchedulerModal();
    await refreshSchedulerData();
  } catch (err) {
    showModalError(`Failed to delete event: ${err.message}`);
  }
}

export async function deleteSchedulerProject(projectId) {
  if (!confirm('Are you sure you want to delete this project? All associated tasks will be removed.')) return;
  try {
    await request(`/api/scheduler/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    dashboardLog('scheduler', 'scheduler.project-deleted', projectId);
    closeSchedulerModal();
    await refreshSchedulerData();
  } catch (err) {
    showModalError(`Failed to delete project: ${err.message}`);
  }
}

export async function deleteSchedulerTask(taskId, projectId) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    await request(`/api/scheduler/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    dashboardLog('scheduler', 'scheduler.task-deleted', taskId);
    // Reload project details modal
    await openProjectDetail(projectId);
    await refreshSchedulerData();
  } catch (err) {
    showModalError(`Failed to delete task: ${err.message}`);
  }
}

// Wire deletes to window globally so HTML onclick handlers can trigger them
window.deleteSchedulerEvent = deleteSchedulerEvent;
window.deleteSchedulerProject = deleteSchedulerProject;
window.deleteSchedulerTask = deleteSchedulerTask;

/* ── Initialization ── */

export async function initSchedulerTab() {
  dashboardLog('scheduler', 'scheduler.init', 'Initializing scheduler tab');
  
  // Allow day-click navigation from mini-month
  window._schedGoToDate = function (dateStr) {
    calCursor = new Date(dateStr + 'T00:00:00');
    calMode = 'day';
    renderSchedulerCalendar();
  };

  // Wire utilities to window for onclick declarations
  window.toggleCronFields = toggleCronFields;
  window.cancelCronJob = cancelCronJob;
  window.previewCronJob = previewCronJob;
  window.refreshCronJobs = refreshCronJobs;
  window.schedCalNav = schedCalNav;
  window.setCalMode = setCalMode;
  window.ganttNav = ganttNav;

  // Single delegated drag-and-drop listener setup on Kanban board container to prevent memory leaks
  const boardViewEl = document.getElementById('sched-view-board');
  if (boardViewEl) {
    const boardEl = boardViewEl.querySelector('.sched-kanban-board');
    if (boardEl) {
      boardEl.addEventListener('dragover', function (e) {
        const lane = e.target.closest('.sched-lane-body');
        if (lane) {
          e.preventDefault();
          lane.style.borderColor = 'var(--accent)';
          lane.style.background = 'rgba(105, 210, 255, 0.05)';
        }
      });

      boardEl.addEventListener('dragleave', function (e) {
        const lane = e.target.closest('.sched-lane-body');
        if (lane) {
          lane.style.borderColor = '';
          lane.style.background = '';
        }
      });

      boardEl.addEventListener('drop', function (e) {
        const lane = e.target.closest('.sched-lane-body');
        if (lane) {
          e.preventDefault();
          lane.style.borderColor = '';
          lane.style.background = '';
          
          const payload = e.dataTransfer.getData('text/plain');
          if (!payload) return;
          const [taskId, projectId] = payload.split('|');
          const col = lane.closest('.sched-kanban-column');
          const newStatus = col ? col.getAttribute('data-status') : null;
          
          if (taskId && newStatus) {
            request(`/api/scheduler/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId || '')}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus })
            }).then(() => {
              refreshSchedulerData();
            }).catch((err) => {
              dashboardLog('scheduler', 'scheduler.error', `Failed to move task: ${err.message}`);
            });
          }
        }
      });
    }
  }

  await refreshSchedulerData();
}

/* ── Cron Jobs ── */

export async function refreshCronJobs() {
  try {
    const cronData = await request('/api/scheduler/cron');
    cachedCronJobs = Array.isArray(cronData) ? cronData : [];
  } catch (_) {
    cachedCronJobs = [];
  }
  renderCronJobs();
}

export function renderCronJobs() {
  const container = document.getElementById('sched-cron-list');
  if (!container) return;
  const countEl = document.getElementById('sched-cron-count');
  if (countEl) countEl.textContent = `${cachedCronJobs.length} job${cachedCronJobs.length !== 1 ? 's' : ''}`;
  
  if (!cachedCronJobs.length) {
    container.innerHTML = '<span class="muted" style="font-size:12px;display:block;text-align:center;padding:24px;border:1px dashed var(--border);border-radius:8px;">No cron jobs scheduled. Click + Cron Job to add one.</span>';
    return;
  }
  let html = '';
  for (const job of cachedCronJobs) {
    const typeBadge = job.type === 'recurring'
      ? '<span class="sched-cron-badge-recurring">recurring</span>'
      : '<span class="sched-cron-badge-once">once</span>';
    
    const schedInfo = job.cronExpression
      ? `<code class="sched-cron-expr-info">${escapeHtml(job.cronExpression)}</code>`
      : `<span style="font-size:11px;color:var(--muted);">Run at: ${escapeHtml(job.runAt || 'N/A')}</span>`;
      
    const nextRun = job.nextRunAt ? `<span style="font-size:11px;color:var(--muted);">Next: ${new Date(job.nextRunAt).toLocaleString()}</span>` : '';
    const lastRun = job.lastRunAt ? `<span style="font-size:11px;color:var(--muted);">Last: ${new Date(job.lastRunAt).toLocaleString()}</span>` : '';
    
    html += `<div class="sched-cron-card">
      <div class="sched-cron-header">
        <div class="sched-cron-title-wrap">
          <strong style="font-size:13px;color:var(--fg);">${escapeHtml(job.label)}</strong>
          ${typeBadge}
        </div>
        <div class="sched-cron-actions-wrap">
          <button class="secondary-button" style="font-size:11px;padding:2px 8px;" onclick="previewCronJob('${escapeHtml(job.id)}')">Preview</button>
          <button class="danger-button" style="font-size:11px;padding:2px 8px;" onclick="cancelCronJob('${escapeHtml(job.id)}')">Cancel</button>
        </div>
      </div>
      <div class="sched-cron-details-row">
        ${schedInfo}
        <span style="font-size:11px;color:var(--muted);">Action: <strong style="color:var(--accent-2);">${escapeHtml(job.action)}</strong></span>
        ${nextRun}
        ${lastRun}
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

export async function cancelCronJob(jobId) {
  if (!confirm('Are you sure you want to cancel this cron job?')) return;
  try {
    await request(`/api/scheduler/cron/${jobId}`, { method: 'DELETE' });
    dashboardLog('scheduler', 'scheduler.cron-cancelled', jobId);
  } catch (e) {
    dashboardLog('scheduler', 'scheduler.error', `Failed to cancel cron job: ${e.message}`);
  }
  await refreshCronJobs();
}

export async function previewCronJob(jobId) {
  const modal = document.getElementById('sched-modal');
  const titleEl = document.getElementById('sched-modal-title');
  const bodyEl = document.getElementById('sched-modal-body');
  const saveBtn = document.getElementById('sched-modal-save');
  if (!modal || !bodyEl) return;
  
  if (saveBtn) saveBtn.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Cron Job Preview';
  
  try {
    const data = await request(`/api/scheduler/cron/${jobId}/preview`);
    let html = '<div style="font-size:13px;display:flex;flex-direction:column;gap:8px;">';
    html += `<div><strong>Label:</strong> ${escapeHtml(data.label || '')}</div>`;
    html += `<div><strong>Type:</strong> ${escapeHtml(data.type || '')}</div>`;
    if (data.cronExpression) html += `<div><strong>Cron:</strong> <code class="sched-cron-expr-info">${escapeHtml(data.cronExpression)}</code></div>`;
    if (data.runAt) html += `<div><strong>Run At:</strong> ${escapeHtml(data.runAt)}</div>`;
    html += `<div><strong>Action:</strong> <strong style="color:var(--accent-2);">${escapeHtml(data.action || '')}</strong></div>`;
    if (data.nextRunAt) html += `<div><strong>Next Run:</strong> ${escapeHtml(new Date(data.nextRunAt).toLocaleString())}</div>`;
    
    if (data.nextOccurrences && data.nextOccurrences.length) {
      html += `<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;">
        <strong>Next 10 Occurrences:</strong>
        <ol style="margin:6px 0 0 18px;padding:0;font-size:12px;color:var(--muted);line-height:1.6;">`;
      for (const occurrence of data.nextOccurrences) {
        html += `<li style="margin-bottom:2px;">${new Date(occurrence).toLocaleString()}</li>`;
      }
      html += '</ol></div>';
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  } catch (e) {
    bodyEl.innerHTML = `<span class="muted">Failed to load preview: ${escapeHtml(e.message || '')}</span>`;
  }
  modal.style.display = 'flex';
}

export function toggleCronFields() {
  const typeSelect = document.getElementById('sched-modal-cron-type');
  const recurringFields = document.getElementById('sched-cron-recurring-fields');
  const onceFields = document.getElementById('sched-cron-once-fields');
  if (!typeSelect) return;
  const isRecurring = typeSelect.value === 'recurring';
  if (recurringFields) recurringFields.style.display = isRecurring ? '' : 'none';
  if (onceFields) onceFields.style.display = isRecurring ? 'none' : '';
}
