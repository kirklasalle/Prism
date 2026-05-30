// Prism Demonstration Mode — Client-Side Controller
// Interactive Mad Libs prompts, narration overlay, tab tour, speed control.
// Keyboard: Space = pause/resume, Escape = stop.
(function () {
  'use strict';

  let demoState = null;
  let ws = null;
  let definitions = null;
  let selectedScope = 'comp-browser';

  // ── DOM & Auth Helpers ───────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
      try { const j = JSON.parse(text); if (j.error) err = j.error; } catch {}
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
        </div>
        <div id="demo-narration"></div>
        <div id="demo-progress-wrap">
          <div id="demo-progress-bar"></div>
        </div>
        <div id="demo-progress-text"></div>
        <div id="demo-controls">
          <button id="demo-btn-play" class="demo-btn demo-btn-primary" onclick="window.prismDemo.start()">▶ Start Demo</button>
          <button id="demo-btn-pause" class="demo-btn" onclick="window.prismDemo.pause()" style="display:none">⏸ Pause</button>
          <button id="demo-btn-resume" class="demo-btn demo-btn-primary" onclick="window.prismDemo.resume()" style="display:none">▶ Resume</button>
          <button id="demo-btn-stop" class="demo-btn demo-btn-danger" onclick="window.prismDemo.stop()" style="display:none">⏹ Stop</button>
          <div id="demo-speed-control" style="display:none">
            <label style="font-size:11px;color:var(--muted,#8b949e)">Speed:</label>
            <input type="range" id="demo-speed-slider" min="500" max="8000" value="3000" step="500"
              oninput="window.prismDemo.setSpeed(this.value)">
            <span id="demo-speed-label" style="font-size:11px;min-width:32px">3.0s</span>
          </div>
        </div>
        <div id="demo-prompts" style="display:none"></div>
        <div id="demo-log" style="display:none"></div>
      </div>
      <button id="demo-minimize-btn" onclick="window.prismDemo.toggleMinimize()" title="Minimize">▼</button>
    `;
    document.body.appendChild(overlay);
  }

  function removeOverlay() {
    const el = $('prism-demo-overlay');
    if (el) el.remove();
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

    if (allPrompts.length === 0) { startDemo({}); return; }

    let html = '<div style="margin-bottom:12px;font-size:13px;color:var(--fg,#c9d1d9)">' +
      '<strong>🎯 Customize Your Demo</strong><br>' +
      '<span style="font-size:11px;color:var(--muted,#8b949e)">Choose options below to personalize the demonstration. ' +
      'These choices shape what Prism does during each demo — like Mad Libs for AI!</span></div>';

    // Premium Scope Picker
    html += `
      <div class="demo-scope-picker">
        <div id="scope-btn-comp-browser" class="demo-scope-option ${selectedScope === 'comp-browser' ? 'active' : ''}" onclick="window.prismDemo.setScope('comp-browser')">
          <span class="icon">🖥️</span>
          <span class="label-text">Computer & Browser</span>
        </div>
        <div id="scope-btn-full" class="demo-scope-option ${selectedScope === 'full' ? 'active' : ''}" onclick="window.prismDemo.setScope('full')">
          <span class="icon">🧠</span>
          <span class="label-text">Full Suite</span>
        </div>
      </div>
    `;

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

    html += '<button class="demo-btn demo-btn-primary" onclick="window.prismDemo.submitPrompts()" style="width:100%;margin-top:8px">🚀 Launch Demo with These Choices</button>';

    promptsEl.innerHTML = html;
    promptsEl.style.display = 'block';
    $('demo-btn-play').style.display = 'none';
    $('demo-narration').textContent = 'Configure your demo experience below...';
    $('demo-status-pill').textContent = 'Configuring';
    $('demo-status-pill').style.color = 'var(--warn,#d29922)';

    // Trigger initial category filter based on selectedScope
    if (window.prismDemo && window.prismDemo.setScope) {
      window.prismDemo.setScope(selectedScope);
    }
  }

  function collectPromptAnswers() {
    const answers = {};
    const radios = document.querySelectorAll('#demo-prompts input[type=radio]:checked');
    radios.forEach(r => {
      const name = r.name.replace('demo-prompt-', '');
      answers[name] = r.value;
    });
    return answers;
  }

  // ── API Calls ───────────────────────────────────────────────────────────
  async function startDemo(answers) {
    try {
      const categories = selectedScope === 'comp-browser'
        ? ['browser-control', 'computer-control']
        : [];
      await authFetch('/api/demo/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, categories }),
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
    const pause = $('demo-btn-pause'); if (pause) pause.style.display = '';
    const stop = $('demo-btn-stop'); if (stop) stop.style.display = '';
    const speed = $('demo-speed-control'); if (speed) speed.style.display = 'flex';
    const pill = $('demo-status-pill');
    if (pill) { pill.textContent = 'Running'; pill.style.color = 'var(--accent,#2da44e)'; }
  }

  // ── WebSocket Events ────────────────────────────────────────────────────
  function handleDemoEvent(data) {
    if (!data.type?.startsWith('demo_') && data.type !== 'demo_event') return;
    const inner = data.type === 'demo_event' ? data : data;

    switch (inner.type) {
      case 'demo_event': handleDemoEvent(inner); break;
      case 'demo_started': showRunningUI(); break;
      case 'demo_step': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `<span style="opacity:.6">${esc(inner.demoId)}</span> ${esc(inner.narration)}`;
        const bar = $('demo-progress-bar');
        if (bar && inner.totalSteps) bar.style.width = ((inner.stepIndex + 1) / inner.totalSteps * 100) + '%';
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = `Step ${inner.stepIndex + 1}/${inner.totalSteps}`;
        break;
      }
      case 'demo_section': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `${esc(inner.icon)} <strong>${esc(inner.title)}</strong><br><span style="font-size:11px;color:var(--muted,#8b949e)">${esc(inner.description)}</span>`;
        const bar = $('demo-progress-bar'); if (bar) bar.style.width = '0%';
        const icon = $('demo-icon'); if (icon) icon.textContent = inner.icon;
        break;
      }
      case 'demo_switch_tab': {
        // Programmatically click the sidebar tab button
        const tabBtns = document.querySelectorAll('[data-tab]');
        tabBtns.forEach(btn => {
          if (btn.dataset.tab === inner.tabId || btn.getAttribute('data-tab') === inner.tabId) btn.click();
        });
        break;
      }
      case 'demo_tab_tour': {
        const n = $('demo-narration');
        if (n) n.innerHTML = `${esc(inner.title)}<br><span style="font-size:11px;color:var(--muted,#8b949e)">${esc(inner.highlight)}</span>`;
        const bar = $('demo-progress-bar');
        if (bar) bar.style.width = ((inner.index + 1) / inner.total * 100) + '%';
        const txt = $('demo-progress-text');
        if (txt) txt.textContent = `Tab ${inner.index + 1}/${inner.total}`;
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
        if (pill) { pill.textContent = 'Completed ✓'; pill.style.color = 'var(--accent,#2da44e)'; }
        const n = $('demo-narration');
        if (n) n.innerHTML = '🎉 <strong>Demonstration Complete!</strong><br><span style="font-size:11px">Prism showcased self-control, browser control, and computer control across 9 demonstrations.</span>';
        const bar = $('demo-progress-bar'); if (bar) bar.style.width = '100%';
        resetButtons();
        break;
      }
      case 'demo_stopped': resetButtons(); break;
    }
  }

  function resetButtons() {
    const play = $('demo-btn-play'); if (play) play.style.display = '';
    const pause = $('demo-btn-pause'); if (pause) pause.style.display = 'none';
    const resume = $('demo-btn-resume'); if (resume) resume.style.display = 'none';
    const stop = $('demo-btn-stop'); if (stop) stop.style.display = 'none';
  }

  // ── Connect to existing WebSocket ───────────────────────────────────────
  function hookWebSocket() {
    // Listen on the existing dashboard WS connection
    const origHandler = window._prismWsHandler;
    window._prismDemoWsHooked = true;

    // Also try to intercept WS messages by monkey-patching
    const origWS = WebSocket.prototype.addEventListener;
    const messageListeners = [];

    // Simpler approach: poll for ws messages via a MutationObserver on the WS
    // Actually, intercept via the global message event on existing sockets
    window.addEventListener('message', (e) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        handleDemoEvent(data);
      } catch { /* not JSON */ }
    });
  }

  function setScope(scope) {
    selectedScope = scope;
    const compBrowserBtn = $('scope-btn-comp-browser');
    const fullBtn = $('scope-btn-full');
    if (compBrowserBtn && fullBtn) {
      if (scope === 'comp-browser') {
        compBrowserBtn.classList.add('active');
        fullBtn.classList.remove('active');
      } else {
        fullBtn.classList.add('active');
        compBrowserBtn.classList.remove('active');
      }
    }
    
    // Filter prompt cards dynamically
    const cards = document.querySelectorAll('.demo-prompt-card');
    cards.forEach(card => {
      const cat = card.getAttribute('data-category');
      if (scope === 'comp-browser') {
        if (cat === 'computer-control' || cat === 'browser-control') {
          card.style.display = 'block';
          void card.offsetHeight;
          card.style.opacity = '1';
          card.style.transform = 'scale(1)';
        } else {
          card.style.display = 'none';
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
        }
      } else {
        card.style.display = 'block';
        void card.offsetHeight;
        card.style.opacity = '1';
        card.style.transform = 'scale(1)';
      }
    });
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!$('prism-demo-overlay')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); window.prismDemo.togglePause(); }
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
    setScope(scope) {
      setScope(scope);
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
    setSpeed(ms) {
      const label = $('demo-speed-label');
      if (label) label.textContent = (ms / 1000).toFixed(1) + 's';
      authFetch('/api/demo/configure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedMs: parseInt(ms, 10) }),
      }).catch(() => {});
    },
    handleEvent: handleDemoEvent,
  };

  // Hook into existing WS messages
  hookWebSocket();

  // Also intercept via the dashboard's WS message handler
  const origOnMsg = window._onDashboardWsMessage;
  window._onDashboardWsMessage = function(data) {
    if (origOnMsg) origOnMsg(data);
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      handleDemoEvent(parsed);
    } catch { /* */ }
  };
})();
