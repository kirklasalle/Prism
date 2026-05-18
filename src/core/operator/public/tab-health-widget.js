// R6-2 — Health widget controller (Phase R · v0.20.2).
//
// Self-contained IIFE module. No imports, no module graph entanglement;
// loaded as a plain <script src="/public/tab-health-widget.js"> after the
// existing dashboard-app.js. Frontend-Protection-safe — does not modify
// any existing tab-telemetry component.
//
// Polls GET /api/health/extended every 10s while the #health-widget
// section is mounted in the DOM. Auto-starts when the section appears
// (the Telemetry tab is lazy-loaded via tab-loader.js).

(function () {
    'use strict';

    if (window.__prismHealthWidgetInit) return;
    window.__prismHealthWidgetInit = true;

    var POLL_MS = 10000;
    var pollHandle = null;

    function fmtMb(n) { return (typeof n === 'number') ? n.toFixed(1) + ' MiB' : '—'; }
    function fmtInt(n) { return (typeof n === 'number') ? n.toLocaleString() : '—'; }
    function fmtUptime(s) {
        if (typeof s !== 'number' || s < 0) return '—';
        if (s < 60) return s + 's';
        if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
        return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderTile(label, value, hint) {
        return '<div class="panel" style="padding:10px;">' +
            '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">' + escapeHtml(label) + '</div>' +
            '<div class="mono" style="font-size:18px;margin-top:4px;">' + escapeHtml(value) + '</div>' +
            (hint ? '<div class="muted" style="font-size:10px;margin-top:2px;">' + escapeHtml(hint) + '</div>' : '') +
            '</div>';
    }

    function renderError(grid, message) {
        grid.innerHTML = '<div class="muted" style="font-size:12px;color:#a33;">Health fetch failed: ' + escapeHtml(message) + '</div>';
    }

    async function refreshHealth() {
        var grid = document.getElementById('health-widget-grid');
        if (!grid) return;
        try {
            var res = await fetch('/api/health/extended', { credentials: 'same-origin' });
            if (!res.ok) {
                renderError(grid, 'HTTP ' + res.status);
                return;
            }
            var b = await res.json();
            var p = b.process || {};
            var tiles = [
                renderTile('Uptime', fmtUptime(b.uptimeS), 'since boot'),
                renderTile('Heap', fmtMb(p.heapMb), 'of ' + fmtMb(p.heapTotalMb)),
                renderTile('RSS', fmtMb(p.rssMb), 'resident set'),
                renderTile('DB on disk', fmtMb(b.dbSizeMb), 'sqlite total'),
                renderTile('Sessions', fmtInt(b.sessions), 'chat sessions'),
                renderTile('Pending Approvals', fmtInt(b.pendingApprovals), 'queue length'),
                renderTile('Version', String(b.version || '—'), b.nodeEnv || ''),
            ];
            grid.innerHTML = tiles.join('');
        } catch (e) {
            renderError(grid, (e && e.message) ? e.message : String(e));
        }
    }

    function start() {
        if (pollHandle != null) return;
        refreshHealth();
        pollHandle = setInterval(refreshHealth, POLL_MS);
    }

    function stop() {
        if (pollHandle != null) {
            clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    // Auto-start when #health-widget appears in the DOM (Telemetry tab is
    // lazy-loaded into the page via tab-loader.js — observe body until
    // the section materialises, then attach polling).
    function tryAttach() {
        if (document.getElementById('health-widget')) {
            start();
            return true;
        }
        return false;
    }

    function init() {
        if (tryAttach()) return;
        var observer = new MutationObserver(function () {
            if (tryAttach()) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for manual debugging / external orchestration.
    window.refreshHealthWidget = refreshHealth;
    window.stopHealthWidget = stop;
})();
