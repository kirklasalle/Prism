// PTAC Operator Demo controller (additive — v0.20).
//
// This module is loaded as a side-effect script from /public and hydrates
// the panel injected into tab-computer.html. It is intentionally
// dependency-free (uses fetch + DOM only) so it does not couple to the
// rest of the dashboard-app module graph.
//
// On load and on tab activation it polls /api/ptac/demo/feature-flags and
// adapts the UI to the current gate state. When all three gates are set
// it enables the "Start Recorded Run" button. When the user clicks the
// button it POSTs to /api/ptac/demo/run, then begins polling
// /api/ptac/demo/runs once per 5 seconds to surface the freshly recorded
// slideshow as it appears on disk.
(function () {
    'use strict';

    let pollTimer = null;

    function $(id) { return document.getElementById(id); }

    function setStatusPill(text, kind) {
        const pill = $('ptac-demo-status-pill');
        if (!pill) return;
        pill.textContent = text;
        pill.style.color = kind === 'ready' ? 'var(--accent, #2da44e)'
            : kind === 'gated' ? 'var(--warn, #d29922)'
                : kind === 'error' ? 'var(--danger, #cf222e)'
                    : '';
    }

    function renderGateMatrix(flags) {
        const root = $('ptac-demo-gates');
        if (!root) return;
        const g = flags.gates || {};
        const item = (label, on, env) =>
            `<div style="display:flex;gap:8px;align-items:center;">
                <span style="font-family:monospace;color:${on ? 'var(--accent, #2da44e)' : 'var(--muted, #8b949e)'};">${on ? '✓' : '○'}</span>
                <span><strong>${label}</strong> <span class="muted">(${env})</span></span>
            </div>`;
        root.innerHTML =
            item('Operator demo opt-in', !!g.operatorGate, 'PRISM_PTAC_OPERATOR_DEMO=1') +
            item('Host prepared (safe gate)', !!g.safeGate, 'PRISM_PTAC_SAFE=1') +
            item('Recording opt-in', !!g.videoGate, 'PRISM_PTAC_RECORD_VIDEO=1');
    }

    async function refreshFeatureFlags() {
        try {
            const r = await fetch('/api/ptac/demo/feature-flags');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const flags = await r.json();
            renderGateMatrix(flags);
            const btn = $('ptac-demo-run-button');
            if (btn) btn.disabled = !flags.ready;
            const msg = $('ptac-demo-message');
            if (msg) msg.textContent = flags.advisory || '';
            setStatusPill(flags.ready ? 'ready' : 'gated', flags.ready ? 'ready' : 'gated');
            return flags;
        } catch (e) {
            setStatusPill('unavailable', 'error');
            const msg = $('ptac-demo-message');
            if (msg) msg.textContent = 'Feature-flags endpoint unavailable: ' + (e && e.message ? e.message : e);
            return null;
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderRuns(payload) {
        const root = $('ptac-demo-runs');
        if (!root) return;
        const runs = (payload && payload.runs) || [];
        if (runs.length === 0) {
            root.innerHTML = '<div class="muted" style="padding:8px;">No demo runs recorded yet. Click <strong>Start Recorded Run</strong> to create one.</div>';
            return;
        }
        const rows = runs.slice(0, 10).map(r => {
            const when = new Date(r.mtime).toLocaleString();
            const dur = r.durationSec ? `${r.durationSec}s` : '—';
            const fps = r.fps ? `${r.fps} fps` : '';
            const slideshowUrl = `/api/ptac/demo/runs/${encodeURIComponent(r.runId)}/video.html`;
            const reportUrl = `/api/ptac/demo/runs/${encodeURIComponent(r.runId)}/report.html`;
            const statusColor = r.status === 'passed' ? 'var(--accent, #2da44e)'
                : r.status === 'failed' ? 'var(--danger, #cf222e)'
                    : 'var(--muted, #8b949e)';
            const videoBtn = r.hasVideo
                ? `<a href="${slideshowUrl}" target="_blank" rel="noopener" class="primary-button" style="font-size:11px;text-decoration:none;padding:4px 10px;">▶ Slideshow</a>`
                : '<span class="muted">no video</span>';
            return `<div style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.runId)}</div>
                    <div class="muted" style="font-size:11px;">${escapeHtml(when)} • ${escapeHtml(String(r.scenarioCount))} scenarios • ${escapeHtml(String(r.frameCount))} frames • ${escapeHtml(dur)} ${escapeHtml(fps)}</div>
                </div>
                <span style="color:${statusColor};font-size:11px;font-weight:600;text-transform:uppercase;">${escapeHtml(r.status)}</span>
                ${videoBtn}
                <a href="${reportUrl}" target="_blank" rel="noopener" class="secondary-button" style="font-size:11px;text-decoration:none;padding:4px 10px;">📄 Report</a>
            </div>`;
        }).join('');
        root.innerHTML = rows;
    }

    async function refreshRuns() {
        try {
            const r = await fetch('/api/ptac/demo/runs');
            if (!r.ok) {
                if (r.status === 403) {
                    const root = $('ptac-demo-runs');
                    if (root) root.innerHTML = '<div class="muted" style="padding:8px;">Demo endpoint disabled — set PRISM_PTAC_OPERATOR_DEMO=1 to enable.</div>';
                    return;
                }
                throw new Error('HTTP ' + r.status);
            }
            renderRuns(await r.json());
        } catch (e) {
            const root = $('ptac-demo-runs');
            if (root) root.innerHTML = '<div class="muted" style="padding:8px;">Could not load runs: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
        }
    }

    async function startPtacDemo() {
        const btn = $('ptac-demo-run-button');
        const msg = $('ptac-demo-message');
        const suiteSel = $('ptac-demo-suite');
        const suite = suiteSel ? suiteSel.value : 'demo';
        if (btn) btn.disabled = true;
        if (msg) msg.textContent = 'Starting recorded run (suite=' + suite + ')…';
        try {
            const r = await fetch('/api/ptac/demo/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suite }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                if (msg) msg.textContent = '✖ ' + (data.error || ('HTTP ' + r.status)) + (data.advisory ? ' — ' + data.advisory : '');
                if (btn) btn.disabled = false;
                return;
            }
            if (msg) msg.textContent = '✓ Spawned demo run (pid ' + data.pid + ', suite=' + data.suite + '). Polling for output…';
            // Begin polling runs every 5s for a couple of minutes; the run is detached.
            let ticks = 0;
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(() => {
                ticks++;
                refreshRuns();
                if (ticks > 36) { clearInterval(pollTimer); pollTimer = null; if (btn) btn.disabled = false; }
            }, 5000);
            refreshRuns();
            // Re-enable the button after 30s so a follow-up run is possible.
            setTimeout(() => { if (btn) btn.disabled = false; }, 30000);
        } catch (e) {
            if (msg) msg.textContent = '✖ ' + (e && e.message ? e.message : String(e));
            if (btn) btn.disabled = false;
        }
    }

    async function initPtacDemoPanel() {
        if (!$('ptac-demo-panel')) return;
        const flags = await refreshFeatureFlags();
        if (flags && flags.enabled) {
            await refreshRuns();
        }
    }

    // Expose globally for the inline `onclick` handlers in the HTML
    // fragment. Following the existing dashboard convention: tab-* JS
    // modules attach their handlers to `window` so the legacy onclick
    // attributes resolve.
    window.startPtacDemo = startPtacDemo;
    window.refreshPtacDemoRuns = refreshRuns;
    window.refreshPtacDemoFeatureFlags = refreshFeatureFlags;
    window.initPtacDemoPanel = initPtacDemoPanel;

    // Boot when the panel is first rendered. Tab content is injected on
    // demand by tab-loader.js, so we observe the DOM until the panel
    // appears, then run init once and start a lightweight 30s poll on
    // the feature-flag endpoint so the gate state stays fresh while the
    // operator is on the tab.
    const observer = new MutationObserver(() => {
        if ($('ptac-demo-panel') && !window.__ptacDemoBooted) {
            window.__ptacDemoBooted = true;
            initPtacDemoPanel();
            setInterval(() => {
                const panel = $('ptac-demo-panel');
                if (panel && panel.offsetParent !== null) refreshFeatureFlags();
            }, 30000);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
