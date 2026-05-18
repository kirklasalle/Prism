export function dashboardHtml(port: number, authToken?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="${authToken ?? ""}" />
  <title>PRISM Frontier Console</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/public/dashboard.css">
  <link rel="stylesheet" href="/public/demo-mode.css">
</head>
<body>
  <div class="app" id="app">
    <aside class="sidebar panel" id="sidebar">
      <div class="brand" id="brand-panel" data-tip-id="shell:brand" data-tip-kind="shell">
        <div class="eyebrow">Frontier Operator Console</div>
        <h1>PRISM Chat</h1>
        <a href="http://localhost:${port}" target="_blank" rel="noopener" class="muted" style="display:block;margin-top:0;text-decoration:none;color:var(--muted);transition:color 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'" data-tip-id="shell:console-link" data-tip-kind="shell">http://localhost:${port} \u2197</a>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <button class="secondary-button" onclick="exportSession()" style="flex:1;" data-tip-id="shell:export-session" data-tip-kind="shell">Export Session</button>
        <button class="secondary-button" onclick="importSession()" style="flex:1;" data-tip-id="shell:import-session" data-tip-kind="shell">Import Session</button>
      </div>
      <button class="secondary-button" onclick="packageSessions()" data-tip-id="shell:package-sessions" data-tip-kind="shell">Package Sessions</button>
      <button id="new-session-button" class="primary-button" onclick="createSession()" data-tip-id="shell:new-session" data-tip-kind="shell">New Session</button>
      <button class="secondary-button" onclick="window.location.href='/setup?rerun=true'" style="font-size:11px;opacity:0.75;margin-top:2px;" title="Re-run the guided setup wizard" data-tip-id="shell:setup-wizard" data-tip-kind="shell">\u2728 Setup Wizard</button>
      <button class="primary-button" onclick="window.prismDemo && window.prismDemo.open()" style="font-size:11px;margin-top:2px;background:linear-gradient(135deg,#a371f7,#f778ba);border:none;" title="Launch interactive demonstration of all Prism capabilities">\uD83C\uDFAC Demo Mode</button>
      <div id="session-list" class="session-list"></div>
    </aside>
    <div class="resize-handle" id="resize-handle"></div>

    <main class="workspace">
      <section class="tabs panel" id="tabs" role="tablist" aria-label="Dashboard sections">
        <button id="tab-button-chat" type="button" class="tab-button active" data-tab-id="chat" role="tab" aria-selected="true" aria-controls="tab-chat" tabindex="0" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:chat" data-tip-kind="shell-tab">Chat Interface</button>
        <button id="tab-button-settings" type="button" class="tab-button" data-tab-id="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:settings" data-tip-kind="shell-tab">Provider &amp; Settings</button>
        <button id="tab-button-tools" type="button" class="tab-button" data-tab-id="tools" role="tab" aria-selected="false" aria-controls="tab-tools" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:tools" data-tip-kind="shell-tab">Tools &amp; Plugins</button>
        <button id="tab-button-agentic" type="button" class="tab-button" data-tab-id="agentic" role="tab" aria-selected="false" aria-controls="tab-agentic" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:agentic" data-tip-kind="shell-tab">Agentic Control</button>
        <button id="tab-button-computer" type="button" class="tab-button" data-tab-id="computer" role="tab" aria-selected="false" aria-controls="tab-computer" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:computer" data-tip-kind="shell-tab">Computer Control</button>
        <button id="tab-button-browser" type="button" class="tab-button" data-tab-id="browser" role="tab" aria-selected="false" aria-controls="tab-browser" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:browser" data-tip-kind="shell-tab">Browser Control</button>
        <button id="tab-button-workspace" type="button" class="tab-button" data-tab-id="workspace" role="tab" aria-selected="false" aria-controls="tab-workspace" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:workspace" data-tip-kind="shell-tab">Workspace</button>
        <button id="tab-button-network" type="button" class="tab-button" data-tab-id="network" role="tab" aria-selected="false" aria-controls="tab-network" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:network" data-tip-kind="shell-tab">Network</button>
        <button id="tab-button-telemetry" type="button" class="tab-button" data-tab-id="telemetry" role="tab" aria-selected="false" aria-controls="tab-telemetry" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:telemetry" data-tip-kind="shell-tab">Telemetry</button>
        <button id="tab-button-logs" type="button" class="tab-button" data-tab-id="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:logs" data-tip-kind="shell-tab">Logs &amp; Debug</button>
        <button id="tab-button-scheduler" type="button" class="tab-button" data-tab-id="scheduler" role="tab" aria-selected="false" aria-controls="tab-scheduler" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:scheduler" data-tip-kind="shell-tab">Scheduler</button>
        <button id="tab-button-watch" type="button" class="tab-button" data-tab-id="watch" role="tab" aria-selected="false" aria-controls="tab-watch" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)" data-tip-id="shell:tab:watch" data-tip-kind="shell-tab" title="Watch PRISM run autonomously">👁️ Watch Me</button>
        <span id="prism-ws-status" title="WebSocket connected" style="width:10px;height:10px;border-radius:50%;background:#22c55e;align-self:center;margin-left:auto;flex:0 0 10px;box-shadow:0 0 6px rgba(34,197,94,0.5);transition:background 0.3s;" data-tip-id="shell:ws-status" data-tip-kind="shell" tabindex="0" role="status" aria-label="WebSocket connection status"></span>
      </section>

      <section id="tab-chat" class="tab-panel active" role="tabpanel" aria-labelledby="tab-button-chat" aria-hidden="false"></section>

      <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-settings" aria-hidden="true"></section>

      <section id="tab-tools" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-tools" aria-hidden="true"></section>

      <section id="tab-agentic" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-agentic" aria-hidden="true"></section>

      <section id="tab-computer" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-computer" aria-hidden="true"></section>

      <section id="tab-browser" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-browser" aria-hidden="true"></section>

      <section id="tab-workspace" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-workspace" aria-hidden="true"></section>

      <section id="tab-network" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-network" aria-hidden="true"></section>

      <section id="tab-telemetry" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-telemetry" aria-hidden="true"></section>

      <section id="tab-logs" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-logs" aria-hidden="true"></section>

      <section id="tab-scheduler" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-scheduler" aria-hidden="true"></section>

      <section id="tab-watch" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-watch" aria-hidden="true"></section>

      <div id="sched-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:360px;max-width:520px;width:90%;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 id="sched-modal-title" style="margin:0;font-size:16px;"></h3>
            <button class="secondary-button" onclick="closeSchedulerModal()" style="font-size:18px;padding:2px 8px;line-height:1;">&times;</button>
          </div>
          <div id="sched-modal-body"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="secondary-button" onclick="closeSchedulerModal()">Cancel</button>
            <button id="sched-modal-save" class="primary-button" onclick="saveSchedulerModal()">Save</button>
          </div>
        </div>
      </div>
    </main>
  </div>
  <script type="module" src="/public/dashboard-app.js"></script>
  <!-- Additive (v0.20): PTAC Operator Demo panel controller. Hydrates the
       additive panel injected into tab-computer.html. Self-hides when the
       feature gates are not set; never modifies existing dashboard state. -->
  <script src="/public/tab-ptac-demo.js"></script>

  <!-- Additive (v0.20.2): R6-2 Process Health widget controller. Polls
       /api/health/extended every 10s into the additive #health-widget
       <section> appended to tab-telemetry.html. -->
  <script src="/public/tab-health-widget.js"></script>

  <!-- Additive (v0.20.2): R6-3 Pending Approvals UI controller. Hits
       /api/approval/pending + /api/approval/:id/{approve,deny} for the
       additive #approval-queue <section> appended to tab-telemetry.html. -->
  <script src="/public/tab-approval-queue.js"></script>

  <!-- Additive (v0.21): Watch Me — autonomous PRISM live view. Streams
       the existing agentic_event WebSocket messages emitted by the
       AgenticChatExecutor loop into a curated, demo-friendly timeline.
       Frontend Protection Guarantee: purely additive, no existing UI
       removed or modified. -->
  <script src="/public/tab-watch.js"></script>

  <!-- Demonstration Mode: Interactive showcase with Mad Libs prompts,
       9 demos (3 self-control, 3 browser, 3 computer), tab tour,
       and full playback controls (pause/resume/stop/speed). -->
  <script src="/public/demo-mode.js"></script>

  <script>
  (function() {
    var handle = document.getElementById('resize-handle');
    var app = document.getElementById('app');
    var sidebar = document.getElementById('sidebar');
    if (!handle || !app || !sidebar) return;
    var dragging = false;
    var startX = 0;
    var startWidth = 0;
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
      app.style.setProperty('--sidebar-width', newWidth + 'px');
    });
    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();
  </script>
</body>
</html>`;
}

export function simpleModeHtml(port: number, authToken?: string): string {
  void port;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="\${authToken ?? ""}" />
  <title>PRISM</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #07111f;
      --panel: rgba(7,19,36,0.88);
      --border: rgba(148,163,184,0.16);
      --text: #edf3ff;
      --muted: #98a6bc;
      --accent: #69d2ff;
      --radius: 16px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(105,210,255,0.14), transparent 28%),
        radial-gradient(circle at bottom right, rgba(124,241,200,0.10), transparent 24%),
        linear-gradient(180deg,#06101d 0%,#091728 44%,#07111f 100%);
      color: var(--text);
      font-family: Aptos,"Segoe UI Variable Text","Segoe UI",sans-serif;
      font-size: 15px;
    }
    button, input, textarea, select { font: inherit; color: inherit; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .sm-app { display: flex; flex-direction: column; height: 100vh; }
    .sm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(6,16,29,0.72);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
    }
    .sm-logo {
      font-size: 1.15rem; font-weight: 700; letter-spacing: 0.06em;
      background: linear-gradient(90deg, var(--accent) 0%, #7cf1c8 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .sm-header-actions { display: flex; gap: 10px; align-items: center; }
    .sm-btn-ghost {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
      background: transparent; cursor: pointer; font-size: 0.85rem; color: var(--muted);
      transition: border-color .15s, color .15s;
    }
    .sm-btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
    .sm-body { display: flex; flex: 1; overflow: hidden; }
    .sm-sidebar {
      width: 240px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: rgba(6,16,29,0.55);
      display: flex; flex-direction: column;
      padding: 14px 10px;
      gap: 8px;
      overflow-y: auto;
    }
    .sm-sidebar-title {
      font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--muted); padding: 0 6px 4px;
    }
    .sm-btn-new-chat {
      width: 100%; padding: 8px 12px; border-radius: var(--radius);
      border: 1px dashed rgba(105,210,255,0.35); background: transparent;
      cursor: pointer; font-size: 0.85rem; color: var(--accent);
      text-align: left; transition: background .15s, border-color .15s;
    }
    .sm-btn-new-chat:hover { background: rgba(105,210,255,0.08); border-color: var(--accent); }
    #sm-session-list { display: flex; flex-direction: column; gap: 4px; }
    .sm-session-item {
      width: 100%; padding: 8px 10px; border-radius: 10px; border: none;
      background: transparent; cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 2px;
      transition: background .15s;
    }
    .sm-session-item:hover { background: rgba(255,255,255,0.05); }
    .sm-session-item--active { background: rgba(105,210,255,0.1) !important; }
    .sm-session-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sm-session-date { font-size: 0.72rem; color: var(--muted); }
    .sm-empty { font-size: 0.8rem; color: var(--muted); padding: 6px; }
    .sm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #sm-character-picker {
      display: flex; gap: 10px; padding: 16px 20px;
      border-bottom: 1px solid var(--border); flex-shrink: 0;
      flex-wrap: wrap;
    }
    .sm-char-card {
      flex: 1; min-width: 120px; max-width: 200px;
      padding: 12px 14px; border-radius: 14px;
      border: 1px solid var(--border); background: var(--panel);
      cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 4px;
      transition: border-color .15s, background .15s, transform .1s;
    }
    .sm-char-card:hover { background: rgba(255,255,255,0.04); transform: translateY(-1px); }
    .sm-char-card--selected {
      background: rgba(105,210,255,0.08);
      box-shadow: 0 0 0 2px rgba(105,210,255,0.25);
    }
    .sm-char-emoji { font-size: 1.5rem; line-height: 1; }
    .sm-char-name { font-weight: 700; font-size: 0.95rem; letter-spacing: 0.04em; }
    .sm-char-badge {
      font-size: 0.7rem; font-weight: 600; padding: 2px 7px; border-radius: 20px;
      border: 1px solid rgba(148,163,184,0.2); color: var(--muted);
      align-self: flex-start;
    }
    .sm-char-persona { font-size: 0.75rem; color: var(--muted); line-height: 1.4; }
    #sm-messages {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .sm-greeting {
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 40px 20px; color: var(--muted); text-align: center;
    }
    .sm-greeting-emoji { font-size: 2.5rem; }
    .sm-greeting p { font-size: 1.05rem; max-width: 480px; line-height: 1.6; color: var(--text); }
    .sm-msg { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
    .sm-msg--user { align-self: flex-end; align-items: flex-end; }
    .sm-msg--assistant { align-self: flex-start; align-items: flex-start; }
    .sm-msg-label { font-size: 0.72rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .sm-msg-content {
      padding: 10px 14px; border-radius: 14px; line-height: 1.6;
      font-size: 0.92rem; max-width: 100%;
    }
    .sm-msg--user .sm-msg-content {
      background: rgba(105,210,255,0.12); border: 1px solid rgba(105,210,255,0.22);
    }
    .sm-msg--assistant .sm-msg-content {
      background: var(--panel); border: 1px solid var(--border);
    }
    .sm-input-area {
      border-top: 1px solid var(--border); padding: 14px 20px;
      display: flex; gap: 10px; flex-shrink: 0;
      background: rgba(6,16,29,0.55);
    }
    #sm-input {
      flex: 1; padding: 10px 14px; border-radius: 12px;
      border: 1px solid var(--border); background: rgba(255,255,255,0.04);
      color: var(--text); resize: none; min-height: 44px; max-height: 160px;
      line-height: 1.5; outline: none;
      transition: border-color .15s;
    }
    #sm-input:focus { border-color: rgba(105,210,255,0.5); }
    #sm-input::placeholder { color: var(--muted); }
    #sm-send-btn {
      padding: 10px 22px; border-radius: 12px;
      border: none; background: var(--accent); color: #07111f;
      font-weight: 700; cursor: pointer; align-self: flex-end;
      transition: opacity .15s, transform .1s;
    }
    #sm-send-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
    #sm-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    #sm-error {
      display: none; position: fixed; bottom: 20px; right: 20px;
      background: rgba(255,100,100,0.18); border: 1px solid rgba(255,100,100,0.4);
      color: #ff9d9d; padding: 10px 16px; border-radius: 10px;
      font-size: 0.85rem; max-width: 360px; z-index: 9999;
    }
    @media (max-width: 640px) {
      .sm-sidebar { display: none; }
      #sm-character-picker { padding: 10px 12px; }
      .sm-char-card { min-width: 90px; }
    }
  </style>
</head>
<body>
  <div class="sm-app">
    <header class="sm-header">
      <span class="sm-logo">⬡ PRISM</span>
      <div class="sm-header-actions">
        <button id="sm-advanced-btn" class="sm-btn-ghost" title="Switch to the full operator dashboard">
          Advanced Mode →
        </button>
      </div>
    </header>

    <div class="sm-body">
      <aside class="sm-sidebar">
        <span class="sm-sidebar-title">Conversations</span>
        <button id="sm-new-chat-btn" class="sm-btn-new-chat">+ New Chat</button>
        <div id="sm-session-list"></div>
      </aside>

      <main class="sm-main">
        <div id="sm-character-picker"></div>
        <div id="sm-messages"></div>
        <div class="sm-input-area">
          <textarea
            id="sm-input"
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            rows="1"
            autocomplete="off"
          ></textarea>
          <button id="sm-send-btn">Send</button>
        </div>
      </main>
    </div>
  </div>
  <div id="sm-error"></div>
  <script type="module" src="/public/simple-mode.js"></script>
</body>
</html>`;
}
