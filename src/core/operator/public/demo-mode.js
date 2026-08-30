// Prism Demonstration Mode — Client-Side Controller
// Interactive Mad Libs prompts, narration overlay, tab tour, speed control.
// Keyboard: Space = pause/resume, Escape = stop.
(function () {
  'use strict';

  let demoState = null;
  let ws = null;
  let definitions = null;
  let selectedScope = 'comp-browser';
  let selectedPlaybackMode = 'step-through';
  let demoPopoutWindow = null;
  let demoDocking = false;

  // ── DOM & Auth Helpers ───────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function getAuthToken() {
    const meta = document.querySelector('meta[name="prism-auth-token"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  function getAuthHeaders(extra = {}) {
    const token = getAuthToken();
    const headers = { ...extra };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  async function authFetch(url, options = {}) {
    options.headers = getAuthHeaders(options.headers);
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let err = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); if (j.error) err = j.error; } catch { }
      throw new Error(err);
    }
    return res;
  }

  // ── Overlay Creation ────────────────────────────────────────────────────
  function ensureOverlay() {
    if ($('prism-demo-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'prism-demo-overlay';
    overlay.innerHTML = `
      <div id="demo-overlay-inner">
        <div id="demo-header">
          <span id="demo-icon">🎬</span>
          <span id="demo-title">Prism Demonstration Mode</span>
          <span id="demo-status-pill">Ready</span>
          <button id="demo-popout-btn" class="demo-window-btn" onclick="window.prismDemo.togglePopout()" title="Pop out Demo window" aria-label="Pop out Demo window">↗</button>
        </div>
        <div id="demo-narration"></div>
        <div id="demo-progress-wrap">
          <div id="demo-progress-bar"></div>
        </div>
        <div id="demo-progress-text"></div>
        <div id="demo-controls">
          <button id="demo-btn-advance" class="demo-btn demo-btn-primary" onclick="window.prismDemo.advance()" style="display:none">▶ Next Step</button>
          <button id="demo-btn-play" class="demo-btn demo-btn-primary" onclick="window.prismDemo.start()">▶ Start Demo</button>
          <button id="demo-btn-pause" class="demo-btn" onclick="window.prismDemo.pause()" style="display:none">⏸ Pause</button>
          <button id="demo-btn-resume" class="demo-btn demo-btn-primary" onclick="window.prismDemo.resume()" style="display:none">▶ Resume</button>
          <button id="demo-btn-stop" class="demo-btn demo-btn-danger" onclick="window.prismDemo.stop()" style="display:none">⏹ Stop</button>
        </div>
        <div id="demo-output-container" style="display:none"></div>
        <div id="demo-prompts" style="display:none"></div>
        <div id="demo-log" style="display:none">
          <div class="demo-log-title">Operator Activity</div>
          <div id="demo-log-entries"></div>
        </div>
      </div>
      <button id="demo-minimize-btn" onclick="window.prismDemo.toggleMinimize()" title="Minimize">▼</button>
      <div class="demo-resize-handle demo-resize-n" data-resize="n"></div>
      <div class="demo-resize-handle demo-resize-ne" data-resize="ne"></div>
      <div class="demo-resize-handle demo-resize-e" data-resize="e"></div>
      <div class="demo-resize-handle demo-resize-se" data-resize="se"></div>
      <div class="demo-resize-handle demo-resize-s" data-resize="s"></div>
      <div class="demo-resize-handle demo-resize-sw" data-resize="sw"></div>
      <div class="demo-resize-handle demo-resize-w" data-resize="w"></div>
      <div class="demo-resize-handle demo-resize-nw" data-resize="nw"></div>
    `;
    document.body.appendChild(overlay);
    installResizeHandlers(document);
  }

  function removeOverlay() {
    const el = $('prism-demo-overlay');
    if (el) el.remove();
  }

  function installResizeHandlers(doc) {
    if (doc.documentElement.dataset.demoResizeReady === 'true') return;
    doc.documentElement.dataset.demoResizeReady = 'true';
    doc.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest && event.target.closest('.demo-resize-handle');
      if (!handle) return;
      const overlay = doc.getElementById('prism-demo-overlay');
      if (!overlay || overlay.classList.contains('demo-popped-out')) return;
      event.preventDefault();
      const view = doc.defaultView;
      const direction = handle.dataset.resize || '';
      const start = overlay.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      overlay.classList.add('demo-user-sized');
      overlay.style.left = start.left + 'px';
      overlay.style.top = start.top + 'px';
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.width = start.width + 'px';
      overlay.style.height = start.height + 'px';

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        let left = start.left;
        let top = start.top;
        let width = start.width;
        let height = start.height;
        if (direction.includes('e')) width = start.width + dx;
        if (direction.includes('s')) height = start.height + dy;
        if (direction.includes('w')) { width = start.width - dx; left = start.left + dx; }
        if (direction.includes('n')) { height = start.height - dy; top = start.top + dy; }
        const minWidth = 340;
        const minHeight = 280;
        if (width < minWidth) { if (direction.includes('w')) left -= minWidth - width; width = minWidth; }
        if (height < minHeight) { if (direction.includes('n')) top -= minHeight - height; height = minHeight; }
        width = Math.min(width, view.innerWidth - Math.max(0, left));
        height = Math.min(height, view.innerHeight - Math.max(0, top));
        left = Math.max(0, left);
        top = Math.max(0, top);
        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.width = width + 'px';
        overlay.style.height = height + 'px';
      };
      const onUp = () => {
        view.removeEventListener('pointermove', onMove);
        view.removeEventListener('pointerup', onUp);
      };
      view.addEventListener('pointermove', onMove);
      view.addEventListener('pointerup', onUp, { once: true });
    });
  }

  function syncPopout() {
    if (!demoPopoutWindow || demoPopoutWindow.closed) return;
    const source = $('prism-demo-overlay');
    if (!source) return;
    const clone = source.cloneNode(true);
    clone.style.display = '';
    clone.classList.add('demo-popped-out');
    const popButton = clone.querySelector('#demo-popout-btn');
    if (popButton) {
      popButton.textContent = '↙';
      popButton.title = 'Dock Demo window back into dashboard';
      popButton.setAttribute('aria-label', popButton.title);
    }
    demoPopoutWindow.document.body.replaceChildren(clone);
  }

  function popOutDemoWindow() {
    if (demoPopoutWindow && !demoPopoutWindow.closed) {
      demoPopoutWindow.focus();
      return;
    }
    const popup = window.open('', 'prism-demo-popout', 'popup=yes,width=540,height=780,resizable=yes,scrollbars=yes');
    if (!popup) {
      appendDemoActivity('Pop-out blocked', 'Allow pop-ups for PRISM to open the standalone Demo window.', '', 'failed');
      return;
    }
    demoPopoutWindow = popup;
    const activeTheme = [...document.body.classList].find((className) => className.startsWith('theme-')) || 'theme-tron';
    popup.document.open();
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PRISM Demonstration</title><link rel="stylesheet" href="/public/dashboard.css"><link rel="stylesheet" href="/public/demo-mode.css"></head><body class="' + activeTheme + ' demo-popout-body"></body></html>');
    popup.document.close();
    popup.prismDemo = window.prismDemo;
    popup.document.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.id) return;
      const original = document.getElementById(target.id);
      if (!original) return;
      if ('checked' in target) original.checked = target.checked;
      if ('value' in target) original.value = target.value;
    });
    popup.addEventListener('beforeunload', () => {
      if (demoDocking) return;
      demoPopoutWindow = null;
      const overlay = $('prism-demo-overlay');
      if (overlay) overlay.style.display = '';
    });
    const overlay = $('prism-demo-overlay');
    if (overlay) overlay.style.display = 'none';
    syncPopout();
    popup.focus();
    appendDemoActivity('Demo window', 'Popped out into a standalone resizable window.', '', 'succeeded');
  }

  function dockDemoWindow() {
    demoDocking = true;
    if (demoPopoutWindow && !demoPopoutWindow.closed) demoPopoutWindow.close();
    demoPopoutWindow = null;
    demoDocking = false;
    const overlay = $('prism-demo-overlay');
    if (overlay) overlay.style.display = '';
    appendDemoActivity('Demo window', 'Docked back into the dashboard.', '', 'succeeded');
  }

  function togglePopout() {
    if (demoPopoutWindow && !demoPopoutWindow.closed) dockDemoWindow();
    else popOutDemoWindow();
  }

  // ── Prompt UI (Mad Libs) ────────────────────────────────────────────────
  async function showPromptUI() {
    ensureOverlay();
    if (!definitions) {
      try {
        const r = await authFetch('/api/demo/definitions');
        definitions = await r.json();
      } catch { definitions = { demos: [], tabTour: [] }; }
    }

    const promptsEl = $('demo-prompts');
    if (!promptsEl) return;

    // Collect all unique prompts across all demos
    const allPrompts = [];
    const seen = new Set();
    for (const demo of (definitions.demos || [])) {
      for (const p of (demo.prompts || [])) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          allPrompts.push({
            ...p,
            demoTitle: demo.title,
            demoIcon: demo.icon,
            demoCategory: demo.category
          });
        }
      }
    }

    let html = '<div style="margin-bottom:12px;font-size:13px;color:var(--fg,#c9d1d9)">' +
      '<strong>🎯 Configure Demonstration Mode</strong><br>' +
      '<span style="font-size:11px;color:var(--muted,#8b949e)">Select execution mode and customize choices below. All actions run real operations with verified outputs.</span></div>';

    // Playback Mode Selector
    html += `
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;color:#c9d1d9">Playback Mode:</div>
      <div class="demo-mode-picker">
        <div id="mode-btn-step-through" class="demo-mode-option ${selectedPlaybackMode === 'step-through' ? 'active' : ''}" onclick="window.prismDemo.setPlaybackMode('step-through')">
          ▶ Step-Through (Manual Click)
        </div>
        <div id="mode-btn-auto" class="demo-mode-option ${selectedPlaybackMode === 'auto' ? 'active' : ''}" onclick="window.prismDemo.setPlaybackMode('auto')">
          ⚡ Auto-Mode (Continuous)
        </div>
      </div>
    `;

    html += `
      <label class="demo-setting-option" title="Keep the headed demonstration browser above other windows while it is active">
        <input id="demo-browser-always-on-top" type="checkbox" checked>
        Keep headed browser always on top
      </label>
    `;

    // Premium Scope Picker
    html += `
      <div style="font-size:12px;font-weight:600;margin-top:8px;margin-bottom:4px;color:#c9d1d9">Demonstration Suite Scope:</div>
      <div class="demo-scope-picker">
        <div id="scope-btn-desktop" class="demo-scope-option ${selectedScope === 'desktop' ? 'active' : ''}" onclick="window.prismDemo.setScope('desktop')">
          <span class="icon">🖥️</span>
          <span class="label-text">Visual Sandbox Desktop</span>
        </div>
        <div id="scope-btn-comp-browser" class="demo-scope-option ${selectedScope === 'comp-browser' ? 'active' : ''}" onclick="window.prismDemo.setScope('comp-browser')">
          <span class="icon">💻</span>
          <span class="label-text">Computer & Browser</span>
        </div>
        <div id="scope-btn-full" class="demo-scope-option ${selectedScope === 'full' ? 'active' : ''}" onclick="window.prismDemo.setScope('full')">
          <span class="icon">🧠</span>
          <span class="label-text">Full 44-Scenario Suite</span>
        </div>
      </div>
    `;

    if (allPrompts.length > 0) {
      html += '<div id="demo-prompt-cards-container">';
      for (const p of allPrompts) {
        const optionsHtml = p.options.map(o =>
          `<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid var(--border,#30363d);margin:2px 0;transition:all .2s">
            <input type="radio" name="demo-prompt-${esc(p.id)}" value="${esc(o)}" ${o === p.defaultValue ? 'checked' : ''} style="margin:0">
            ${esc(o)}
          </label>`
        ).join('');

        html += `<div class="demo-prompt-card" data-category="${esc(p.demoCategory)}" style="margin:10px 0;padding:10px;background:var(--card-bg,#161b22);border-radius:6px;border:1px solid var(--border,#30363d);transition:all 0.25s ease-in-out;">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(p.demoIcon)} ${esc(p.demoTitle)}</div>
          <div style="font-size:12px;font-weight:500;margin-bottom:2px">${esc(p.label)}</div>
          <div style="font-size:11px;color:var(--muted,#8b949e);margin-bottom:6px">${esc(p.description)}</div>
          ${optionsHtml}
        </div>`;
      }
      html += '</div>';
    }

    html += '<button class="demo-btn demo-btn-primary" onclick="window.prismDemo.submitPrompts()" style="width:100%;margin-top:12px">🚀 Launch Demonstration</button>';

    promptsEl.innerHTML = html;
    promptsEl.style.display = 'block';
    $('demo-btn-play').style.display = 'none';
    $('demo-narration').textContent = 'Configure your demonstration experience below...';
    $('demo-status-pill').textContent = 'Configuring';
    $('demo-status-pill').style.color = 'var(--warn,#d29922)';

    if (window.prismDemo && window.prismDemo.setScope) {
      window.prismDemo.setScope(selectedScope);
    }
    syncPopout();
  }

  function collectPromptAnswers() {
    const answers = {};
    const radios = document.querySelectorAll('#demo-prompts input[type=radio]:checked');
    radios.forEach(r => {
      const name = r.name.replace('demo-prompt-', '');
      answers[name] = r.value;
    });
    const alwaysOnTop = $('demo-browser-always-on-top');
    answers.browser_always_on_top = !alwaysOnTop || alwaysOnTop.checked ? 'true' : 'false';
    return answers;
  }

  // ── API Calls ───────────────────────────────────────────────────────────
  async function startDemo(answers) {
    try {
      const categories = selectedScope === 'desktop'
        ? ['computer-control']
        : selectedScope === 'comp-browser'
          ? ['browser-control', 'computer-control']
          : [];
      await authFetch('/api/demo/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, categories, playbackMode: selectedPlaybackMode }),
      });
      showRunningUI();
    } catch (e) {
      const n = $('demo-narration');
      if (n) n.textContent = 'Failed to start: ' + (e.message || e);
    }
  }

  function showRunningUI() {
    const p = $('demo-prompts'); if (p) p.style.display = 'none';
    const play = $('demo-btn-play'); if (play) play.style.display = 'none';
    const advance = $('demo-btn-advance'); if (advance) advance.style.display = selectedPlaybackMode === 'step-through' ? '' : 'none';
    const pause = $('demo-btn-pause'); if (pause) pause.style.display = selectedPlaybackMode === 'auto' ? '' : 'none';
    const stop = $('demo-btn-stop'); if (stop) stop.style.display = '';
    const outputBox = $('demo-output-container'); if (outputBox) outputBox.style.display = 'block';
    const pill = $('demo-status-pill');
    if (pill) {
      pill.textContent = selectedPlaybackMode === 'step-through' ? 'Step-Through' : 'Running Auto';
      pill.style.color = 'var(--accent,#2da44e)';
    }
  }

  function appendDemoActivity(label, message, detail, status) {
    const log = $('demo-log');
    const entries = $('demo-log-entries');
    if (!log || !entries) return;
    log.style.display = 'block';
    const item = document.createElement('div');
    item.className = 'demo-log-entry demo-log-' + (status || 'info');
    item.innerHTML = '<div class="demo-log-entry-header"><strong>' + esc(label) + '</strong><span>' + esc(new Date().toLocaleTimeString()) + '</span></div>'
      + '<div>' + esc(message || '') + '</div>'
      + (detail ? '<details><summary>Details</summary><pre>' + esc(detail) + '</pre></details>' : '');
    entries.appendChild(item);
    while (entries.children.length > 200) entries.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    const line = `[DEMO][${String(status || 'info').toUpperCase()}] ${label}: ${message || ''}${detail ? ` | ${detail}` : ''}`;
    if (typeof window.pushConsoleEntry === 'function') {
      window.pushConsoleEntry({
        ts: new Date().toISOString(),
        stream: status === 'failed' || status === 'timed_out' ? 'stderr' : 'stdout',
        line,
      });
    }
    if (typeof window.dashboardLog === 'function') {
      window.dashboardLog('demo', label, `${message || ''}${detail ? ` | ${detail}` : ''}`, status === 'failed' || status === 'timed_out' ? 'error' : 'info');
    }
  }

  function clearDemoActivity() {
    const entries = $('demo-log-entries');
    if (entries) entries.innerHTML = '';
  }

  async function focusBrowserSession(inner) {
    if (!inner.headless) return;
    if (typeof window.setActiveTab === 'function') await window.setActiveTab('browser');
    if (typeof window.refreshSessionsList === 'function') await window.refreshSessionsList();
    if (typeof window.setBrowserView === 'function') window.setBrowserView('viewport');
    const select = document.getElementById('browser-active-session');
    if (select && inner.sessionId) {
      select.value = inner.sessionId;
      if (typeof window.browserSessionChanged === 'function') window.browserSessionChanged();
    }
    if (inner.phase === 'succeeded' && typeof window.browserTakeScreenshot === 'function') {
      await window.browserTakeScreenshot().catch(() => null);
    }
    expandVisibleDemoPanels();
  }

  function expandVisibleDemoPanels() {
    document.querySelectorAll('.collapsible-body.collapsed').forEach((body) => {
      body.classList.remove('collapsed');
      const owner = body.closest('section, .panel') || body.parentElement;
      const header = owner && owner.querySelector('.rail-header, .panel-header');
      if (header) {
        header.setAttribute('aria-expanded', 'true');
        const label = header.querySelector('[data-collapse-state-info]');
        if (label) label.textContent = 'Expanded';
      }
    });
    document.querySelectorAll('main details').forEach((details) => { details.open = true; });
  }

  async function showDemoTab(tabId) {
    if (typeof window.setActiveTab === 'function') {
      await window.setActiveTab(tabId);
    } else {
      const tabBtns = document.querySelectorAll('[data-tab-id], [data-tab]');
      tabBtns.forEach(btn => {
        const tid = btn.dataset.tabId || btn.getAttribute('data-tab-id') || btn.dataset.tab || btn.getAttribute('data-tab');
        if (tid === tabId) btn.click();
      });
    }
    expandVisibleDemoPanels();
  }

  // ── WebSocket Events ────────────────────────────────────────────────────
  function handleDemoEvent(data) {
    if (!data.type?.startsWith('demo_') && data.type !== 'demo_event') return;
    const inner = data.type === 'demo_event' ? data : data;
    const type = inner.typeInner || inner.type;

    switch (type) {
      case 'demo_event': handleDemoEvent(inner); break;
      case 'demo_started':
        clearDemoActivity();
        showRunningUI();
        appendDemoActivity('Demo started', 'Real operations are now executing.', '', 'running');
        break;
      case 'demo_step': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `<span style="opacity:.6">${esc(inner.demoId)}</span> ${esc(inner.narration)}`;
        const bar = $('demo-progress-bar');
        if (bar && inner.totalSteps) bar.style.width = ((inner.stepIndex + 1) / inner.totalSteps * 100) + '%';
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = `Step ${inner.stepIndex + 1}/${inner.totalSteps}`;
        appendDemoActivity(
          `Step ${inner.stepIndex + 1}/${inner.totalSteps}`,
          `${inner.demoId}: ${inner.narration}`,
          `Action: ${inner.action || 'unspecified'}\nArguments: ${JSON.stringify(inner.args || {}, null, 2)}`,
          'running'
        );
        break;
      }
      case 'demo_step_result': {
        const outputBox = $('demo-output-container');
        if (outputBox) {
          outputBox.style.display = 'block';
          let outHtml = `<div style="font-weight:bold;margin-bottom:4px;color:${inner.status === 'succeeded' ? '#2da44e' : '#f85149'}">[Step ${inner.stepIndex + 1}] Output (${inner.status.toUpperCase()}):</div>`;
          if (inner.output) {
            outHtml += `<div style="white-space:pre-wrap;word-break:break-all;">${esc(inner.output)}</div>`;
          }
          if (inner.screenshotDataUrl) {
            outHtml += `<div style="margin-top:6px;"><strong>Verified headed screenshot:</strong><br><img class="demo-screenshot-thumb" src="${esc(inner.screenshotDataUrl)}" alt="Demo browser screenshot"></div>`;
          } else if (inner.screenshotPath) {
            outHtml += `<div style="margin-top:6px;"><strong>Screenshot saved:</strong><br><span>${esc(inner.screenshotPath)}</span></div>`;
          }
          outputBox.innerHTML = outHtml;
          outputBox.scrollTop = outputBox.scrollHeight;
        }
        appendDemoActivity(
          `Step ${inner.stepIndex + 1} ${String(inner.status || '').toUpperCase()}`,
          inner.narration || inner.demoId,
          inner.output || 'No output returned.',
          inner.status
        );
        break;
      }
      case 'demo_awaiting_advance': {
        const advance = $('demo-btn-advance');
        if (advance) advance.style.display = '';
        const pill = $('demo-status-pill');
        if (pill) { pill.textContent = 'Click Next Step'; pill.style.color = '#2da44e'; }
        appendDemoActivity('Awaiting operator', 'Click Next Step to continue.', '', 'info');
        break;
      }
      case 'demo_section': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `${esc(inner.icon)} <strong>${esc(inner.title)}</strong><br><span style="font-size:11px;color:var(--muted,#8b949e)">${esc(inner.description)}</span>`;
        const bar = $('demo-progress-bar'); if (bar) bar.style.width = '0%';
        const icon = $('demo-icon'); if (icon) icon.textContent = inner.icon;
        appendDemoActivity('Section', `${inner.icon || ''} ${inner.title}`, inner.description || '', 'info');
        break;
      }
      case 'demo_switch_tab': {
        showDemoTab(inner.tabId).catch((error) => appendDemoActivity('Operator view failed', String(error), '', 'failed'));
        appendDemoActivity('Operator view', `Switched to ${inner.tabId} tab.`, '', 'info');
        break;
      }
      case 'demo_operator_action':
        appendDemoActivity(inner.action || 'Demo action', inner.detail || '', JSON.stringify(inner.sessionIds || [], null, 2), inner.status);
        break;
      case 'demo_browser_session_focus':
        appendDemoActivity(
          'Browser viewport',
          `${inner.mode || 'browser'} ${inner.sessionId}: ${inner.operation} ${inner.phase}`,
          'Browser Control > Viewport selected for live operator inspection.',
          inner.phase === 'succeeded' ? 'succeeded' : 'running'
        );
        focusBrowserSession(inner).catch((error) => appendDemoActivity('Browser viewport failed', String(error), '', 'failed'));
        break;
      case 'demo_tab_tour': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `${esc(inner.title)}<br><span style="font-size:11px;color:var(--muted,#8b949e)">${esc(inner.highlight)}</span>`;
        const bar = $('demo-progress-bar');
        if (bar) bar.style.width = ((inner.index + 1) / inner.total * 100) + '%';
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = `Tab ${inner.index + 1}/${inner.total}`;
        appendDemoActivity(`Tab ${inner.index + 1}/${inner.total}`, inner.title, inner.highlight || '', 'running');
        break;
      }
      case 'demo_paused': {
        const pill = $('demo-status-pill');
        if (pill) { pill.textContent = 'Paused'; pill.style.color = 'var(--warn,#d29922)'; }
        const pause = $('demo-btn-pause'); if (pause) pause.style.display = 'none';
        const resume = $('demo-btn-resume'); if (resume) resume.style.display = '';
        break;
      }
      case 'demo_resumed': {
        const pill = $('demo-status-pill');
        if (pill) { pill.textContent = 'Running'; pill.style.color = 'var(--accent,#2da44e)'; }
        const pause = $('demo-btn-pause'); if (pause) pause.style.display = '';
        const resume = $('demo-btn-resume'); if (resume) resume.style.display = 'none';
        break;
      }
      case 'demo_completed': {
        const pill = $('demo-status-pill');
        if (pill) { pill.textContent = 'Finished & Published ✓'; pill.style.color = 'var(--accent,#2da44e)'; }
        const n = $('demo-narration');
        let html = '🎉 <strong>Demonstration Finished and Published!</strong><br>' +
          '<span style="font-size:11px">Execution is complete. Reports were saved to the configured workspace and the Demo Output Session was created.</span>';
        if (inner.outputSession) {
          html += `<div style="margin-top:6px"><strong>Chat output:</strong> ${esc(inner.outputSession.title || 'Demo Output Session')}</div>`;
        }
        if (inner.reports) {
          html += `<div class="demo-report-links">` +
            `<strong>Executive Reports Generated:</strong><br>` +
            `<a href="file:///${esc(inner.reports.mdPath.replace(/\\/g, '/'))}" target="_blank">📄 Open Markdown Report</a> &bull; ` +
            `<a href="file:///${esc(inner.reports.htmlPath.replace(/\\/g, '/'))}" target="_blank">🌐 Open HTML Report</a>` +
            `</div>`;
        }
        if (n) n.innerHTML = html;
        const bar = $('demo-progress-bar'); if (bar) bar.style.width = '100%';
        appendDemoActivity('Demo finished', 'Reports published and output session created.', inner.reports ? JSON.stringify(inner.reports, null, 2) : '', 'succeeded');
        resetButtons();
        break;
      }
      case 'demo_output_published': {
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = 'Reports published — finishing optional operator tour';
        appendDemoActivity(
          'Demo output published',
          inner.outputSession ? `Created ${inner.outputSession.title}` : 'Reports saved to the configured workspace.',
          inner.reports ? JSON.stringify(inner.reports, null, 2) : '',
          'succeeded'
        );
        break;
      }
      case 'demo_chat_session_created': {
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = `💬 Created New Chat Session: "${inner.title}"`;
        appendDemoActivity('Output session created', inner.title, `Session ID: ${inner.sessionId}`, 'succeeded');
        break;
      }
      case 'demo_chat_session_failed': {
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = 'Demo output session creation failed';
        appendDemoActivity('Output session failed', inner.error || 'Unknown error', '', 'failed');
        break;
      }
      case 'demo_stopped':
        appendDemoActivity('Demo stopped', 'The operator stopped the demonstration.', '', 'info');
        resetButtons();
        break;
    }
    syncPopout();
  }

  function resetButtons() {
    const play = $('demo-btn-play'); if (play) play.style.display = '';
    const advance = $('demo-btn-advance'); if (advance) advance.style.display = 'none';
    const pause = $('demo-btn-pause'); if (pause) pause.style.display = 'none';
    const resume = $('demo-btn-resume'); if (resume) resume.style.display = 'none';
    const stop = $('demo-btn-stop'); if (stop) stop.style.display = 'none';
  }

  // ── Connect to existing WebSocket ───────────────────────────────────────
  function hookWebSocket() {
    window._prismDemoWsHooked = true;
    window.addEventListener('message', (e) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        handleDemoEvent(data);
      } catch { /* not JSON */ }
    });
  }

  function setScope(scope) {
    selectedScope = scope;
    const desktopBtn = $('scope-btn-desktop');
    const compBrowserBtn = $('scope-btn-comp-browser');
    const fullBtn = $('scope-btn-full');
    [desktopBtn, compBrowserBtn, fullBtn].forEach((b) => { if (b) b.classList.remove('active'); });
    if (scope === 'desktop' && desktopBtn) {
      desktopBtn.classList.add('active');
    } else if (scope === 'comp-browser' && compBrowserBtn) {
      compBrowserBtn.classList.add('active');
    } else if (fullBtn) {
      fullBtn.classList.add('active');
    }
    syncPopout();
  }

  function setPlaybackMode(mode) {
    selectedPlaybackMode = mode;
    const stepBtn = $('mode-btn-step-through');
    const autoBtn = $('mode-btn-auto');
    if (stepBtn && autoBtn) {
      if (mode === 'step-through') {
        stepBtn.classList.add('active');
        autoBtn.classList.remove('active');
      } else {
        autoBtn.classList.add('active');
        stepBtn.classList.remove('active');
      }
    }
    syncPopout();
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!$('prism-demo-overlay')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (selectedPlaybackMode === 'step-through') window.prismDemo.advance();
      else window.prismDemo.togglePause();
    }
    if (e.code === 'Escape') { e.preventDefault(); window.prismDemo.stop(); }
  });

  // ── Public API ──────────────────────────────────────────────────────────
  window.prismDemo = {
    open() {
      ensureOverlay();
      showPromptUI();
    },
    close() { removeOverlay(); },
    async start() { showPromptUI(); },
    submitPrompts() {
      const answers = collectPromptAnswers();
      startDemo(answers);
    },
    setScope(scope) { setScope(scope); },
    setPlaybackMode(mode) { setPlaybackMode(mode); },
    togglePopout() { togglePopout(); },
    popOut() { popOutDemoWindow(); },
    dock() { dockDemoWindow(); },
    async advance() {
      const advanceBtn = $('demo-btn-advance');
      if (advanceBtn) advanceBtn.style.display = 'none';
      await authFetch('/api/demo/advance', { method: 'POST' });
    },
    async pause() { await authFetch('/api/demo/pause', { method: 'POST' }); },
    async resume() { await authFetch('/api/demo/resume', { method: 'POST' }); },
    async stop() {
      await authFetch('/api/demo/stop', { method: 'POST' });
      resetButtons();
      const pill = $('demo-status-pill');
      if (pill) { pill.textContent = 'Stopped'; pill.style.color = 'var(--muted,#8b949e)'; }
    },
    togglePause() {
      const pill = $('demo-status-pill');
      if (pill && pill.textContent === 'Paused') this.resume();
      else this.pause();
    },
    toggleMinimize() {
      const inner = $('demo-overlay-inner');
      if (inner) inner.style.display = inner.style.display === 'none' ? '' : 'none';
      const btn = $('demo-minimize-btn');
      if (btn) btn.textContent = inner?.style.display === 'none' ? '▲' : '▼';
    },
    handleEvent: handleDemoEvent,
  };

  hookWebSocket();

  const origOnMsg = window._onDashboardWsMessage;
  window._onDashboardWsMessage = function (data) {
    if (origOnMsg) origOnMsg(data);
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      handleDemoEvent(parsed);
    } catch { /* */ }
  };
})();
