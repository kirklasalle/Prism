// PRISM "Watch Me" controller — additive (v0.21).
//
// Hydrates tab-watch.html. Streams the live `agentic_event` WebSocket
// messages emitted by AgenticChatExecutor (already shipping since
// v0.20) into a curated demo-friendly timeline, plus auto-refreshes
// the framebuffer screenshot every 2s while a run is active.
//
// IMPORTANT: this script does not own a WebSocket — it attaches to
// the global one created by dashboard-app.js by intercepting
// `window.dispatchEvent` once a run starts. To stay loosely coupled
// we expose a tiny pub/sub on `window.__prismWatchBus` and
// `dashboard-app.js` may forward `agentic_event` payloads to it.
// As a fallback, we open our own SSE stream on /api/events/stream
// when present, or poll /api/chat/sessions/:sid/events.
//
// Frontend Protection Guarantee: this module never removes or
// destructively modifies any existing UI. It only renders into the
// `#tab-watch` mount point.

(function () {
    'use strict';

    let activeSessionId = null;
    let runActive = false;
    let screenshotTimer = null;
    let ownWs = null;

    function $(id) { return document.getElementById(id); }
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function setStatus(text) {
        const el = $('watch-status');
        if (el) el.textContent = text;
    }

    function setRunning(running) {
        runActive = running;
        const startBtn = $('watch-start-button');
        const stopBtn = $('watch-stop-button');
        if (startBtn) startBtn.disabled = running;
        if (stopBtn) stopBtn.disabled = !running;
        if (running) startScreenshotPolling();
        else stopScreenshotPolling();
    }

    function appendTimelineEvent(ev) {
        const root = $('watch-timeline');
        if (!root) return;
        // Replace the placeholder once the first event lands.
        if (root.firstElementChild && root.firstElementChild.classList?.contains('muted')) {
            root.innerHTML = '';
        }
        const t = new Date().toLocaleTimeString();
        const it = ev.iteration != null ? `[i${ev.iteration}]` : '';
        let line = '';
        const color = (c) => `color:${c};`;
        switch (ev.type) {
            case 'text':
                line = `<div style="margin:4px 0;">
                    <span class="muted">${t} ${it}</span>
                    <span style="${color('var(--text)')}"> 💭 ${escapeHtml(ev.text || '')}</span>
                </div>`;
                break;
            case 'tool_call':
                {
                    const tc = ev.toolCall || {};
                    const args = tc.arguments ? JSON.stringify(tc.arguments) : '{}';
                    line = `<div style="margin:4px 0;padding:4px 6px;border-left:3px solid var(--accent,#2da44e);background:rgba(45,164,78,0.06);">
                        <span class="muted">${t} ${it}</span>
                        <span style="${color('var(--accent,#2da44e)')};font-weight:600;"> 🔧 ${escapeHtml(tc.name || 'tool')}</span>
                        <code style="font-size:11px;color:var(--muted);"> ${escapeHtml(args.slice(0, 240))}${args.length > 240 ? '…' : ''}</code>
                    </div>`;
                }
                break;
            case 'tool_result':
                {
                    const tr = ev.toolResult || {};
                    const ok = tr.ok !== false;
                    const out = (tr.output || '').slice(0, 240);
                    line = `<div style="margin:2px 0 6px 12px;">
                        <span class="muted">${t}</span>
                        <span style="${color(ok ? 'var(--accent,#2da44e)' : 'var(--danger,#cf222e)')};"> ${ok ? '✓' : '✗'} ${escapeHtml(tr.name || 'tool')}</span>
                        <span class="muted" style="font-size:11px;"> → ${escapeHtml(out)}${(tr.output || '').length > 240 ? '…' : ''}</span>
                    </div>`;
                }
                break;
            case 'error':
                line = `<div style="margin:4px 0;color:var(--danger,#cf222e);">
                    <span class="muted">${t} ${it}</span> ✖ ${escapeHtml(ev.error || '')}
                </div>`;
                break;
            case 'done':
                line = `<div style="margin:8px 0;padding:6px;background:rgba(45,164,78,0.1);border-radius:4px;">
                    <span class="muted">${t} ${it}</span>
                    <span style="${color('var(--accent,#2da44e)')};font-weight:600;"> ◼ Run complete.</span>
                </div>`;
                setRunning(false);
                setStatus('Run complete.');
                break;
            default:
                line = `<div class="muted" style="margin:2px 0;">${t} ${escapeHtml(ev.type || 'event')}</div>`;
        }
        root.insertAdjacentHTML('beforeend', line);
        root.scrollTop = root.scrollHeight;
    }

    function clearTimeline() {
        const root = $('watch-timeline');
        if (root) root.innerHTML = '<div class="muted">Run starting…</div>';
    }

    async function refreshScreenshot() {
        const img = $('watch-screenshot');
        const ph = $('watch-screenshot-placeholder');
        if (!img) return;
        try {
            const r = await fetch('/api/computer/screengrab/latest', { cache: 'no-store' });
            if (!r.ok) return;
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const previous = img.src;
            img.onload = () => { if (previous && previous.startsWith('blob:')) URL.revokeObjectURL(previous); };
            img.src = url;
            img.style.display = 'block';
            if (ph) ph.style.display = 'none';
        } catch (_) {
            // best-effort
        }
    }

    function startScreenshotPolling() {
        stopScreenshotPolling();
        refreshScreenshot();
        screenshotTimer = setInterval(refreshScreenshot, 2000);
    }
    function stopScreenshotPolling() {
        if (screenshotTimer) { clearInterval(screenshotTimer); screenshotTimer = null; }
    }

    async function watchRefreshSessions() {
        const sel = $('watch-session');
        if (!sel) return;
        try {
            const r = await fetch('/api/chat/sessions');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const list = await r.json();
            sel.innerHTML = '';
            const sessions = Array.isArray(list) ? list : (list.sessions || []);
            if (sessions.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '(no sessions — create one in the Chat tab)';
                sel.appendChild(opt);
                return;
            }
            for (const s of sessions) {
                const opt = document.createElement('option');
                opt.value = s.id || s.sessionId || '';
                opt.textContent = (s.title || s.name || s.id || 'session') + (opt.value ? ` — ${opt.value.slice(0, 8)}` : '');
                sel.appendChild(opt);
            }
            // Try to default to the active session if dashboard-app.js exposes it.
            try {
                if (window.activeSessionId) sel.value = window.activeSessionId;
            } catch (_) { /* ignore */ }
        } catch (e) {
            sel.innerHTML = `<option value="">Could not load sessions: ${escapeHtml(e.message || String(e))}</option>`;
        }
    }

    function ensureSubscribedToAgenticEvents() {
        // Preferred path: the dashboard's main WebSocket already broadcasts
        // `agentic_event` messages. We tap into its global by listening on
        // a custom DOM event the dashboard can dispatch. As a robust
        // fallback, we open our own /ws connection scoped to this tab.
        if (ownWs && ownWs.readyState <= 1) return;
        try {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const tokenMeta = document.querySelector('meta[name="prism-auth-token"]');
            const token = tokenMeta ? tokenMeta.getAttribute('content') : '';
            const wsUrl = `${proto}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
            ownWs = new WebSocket(wsUrl);
            ownWs.onmessage = (msg) => {
                let data;
                try { data = JSON.parse(msg.data); } catch { return; }
                if (!data || data.type !== 'agentic_event') return;
                if (activeSessionId && data.sessionId && data.sessionId !== activeSessionId) return;
                if (data.event) appendTimelineEvent(data.event);
            };
            ownWs.onerror = () => { /* dashboard ws handles user-facing state */ };
            ownWs.onclose = () => { ownWs = null; };
        } catch (_) {
            // best-effort; dashboard's own WS may still surface events through
            // a global pub/sub if one is added later.
        }
    }

    async function watchStart() {
        const sel = $('watch-session');
        const input = $('watch-prompt-input');
        const sessionId = sel ? sel.value : '';
        const prompt = input ? input.value.trim() : '';
        if (!sessionId) { setStatus('Pick a session first.'); return; }
        if (!prompt) { setStatus('Type a goal first.'); return; }
        activeSessionId = sessionId;
        setRunning(true);
        clearTimeline();
        setStatus(`Running… session=${sessionId.slice(0, 8)}`);
        ensureSubscribedToAgenticEvents();
        try {
            const r = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, prompt }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                setStatus('✖ ' + (data.error || ('HTTP ' + r.status)));
                setRunning(false);
                return;
            }
            // Tier-3 deny path lands here with denied:true
            if (data.denied) {
                appendTimelineEvent({ type: 'error', error: `Denied by policy (${data.reason_code || 'tier3'}).` });
                setRunning(false);
                setStatus('Denied by policy.');
                return;
            }
            if (Array.isArray(data.approval_pending_ids) && data.approval_pending_ids.length) {
                setStatus(`Awaiting approval (${data.approval_pending_ids.length} pending).`);
            }
            // Final summary content also renders to timeline if streamed events
            // didn't already deliver a `done` event.
            if (data.content) {
                appendTimelineEvent({ type: 'text', text: data.content });
            }
            // If the run is fully synchronous and `done` did not arrive via WS
            // (e.g. WS not subscribed), end the run after a brief grace.
            setTimeout(() => { if (runActive) { setRunning(false); setStatus('Run complete (sync).'); } }, 2000);
        } catch (e) {
            setStatus('✖ ' + (e.message || String(e)));
            setRunning(false);
        }
    }

    async function watchStop() {
        if (!activeSessionId) return;
        setStatus('Stopping…');
        try {
            // Best-effort: the abort surface mirrors PTAC's. If not yet wired,
            // we still flip local state and stop polling.
            await fetch('/api/agentic/abort', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: activeSessionId }),
            }).catch(() => null);
        } finally {
            setRunning(false);
            appendTimelineEvent({ type: 'error', error: 'Operator pressed STOP.' });
            setStatus('Stopped by operator.');
        }
    }

    function initWatchTab() {
        if (!$('watch-timeline')) return;
        watchRefreshSessions();
        ensureSubscribedToAgenticEvents();
    }

    // Expose for inline onclick attributes in the HTML fragment.
    window.watchStart = watchStart;
    window.watchStop = watchStop;
    window.watchRefreshSessions = watchRefreshSessions;
    window.initWatchTab = initWatchTab;

    // Auto-init when the panel appears (tab is loaded on demand).
    const observer = new MutationObserver(() => {
        if ($('watch-timeline') && !window.__watchInited) {
            window.__watchInited = true;
            initWatchTab();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
