// R6-3 — Approval Queue UI controller (Phase R · v0.20.2).
//
// Self-contained IIFE. Lists pending approvals from
// GET /api/approval/pending, with [Approve] / [Deny] action buttons that
// hit POST /api/approval/:id/approve and /api/approval/:id/deny.
//
// Frontend-Protection-safe — does not modify any existing telemetry
// component. Loaded as a plain <script src="/public/tab-approval-queue.js">
// after dashboard-app.js.

(function () {
    'use strict';

    if (window.__prismApprovalQueueInit) return;
    window.__prismApprovalQueueInit = true;

    var POLL_MS = 5000;
    var pollHandle = null;

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtAge(iso) {
        if (!iso) return '—';
        try {
            var ms = Date.now() - new Date(iso).getTime();
            if (ms < 0) return 'just now';
            if (ms < 60_000) return Math.floor(ms / 1000) + 's ago';
            if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ago';
            return Math.floor(ms / 3_600_000) + 'h ago';
        } catch (_) { return iso; }
    }

    function setMessage(text, isError) {
        var el = document.getElementById('approval-queue-message');
        if (!el) return;
        el.textContent = text || '';
        el.style.color = isError ? '#a33' : '';
    }

    function renderRow(item) {
        var ctx = item && item.context ? JSON.stringify(item.context) : '{}';
        return '<div class="panel" style="padding:10px;display:flex;flex-direction:column;gap:6px;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<strong style="font-size:13px;">' + escapeHtml(item.operation || '(unknown op)') + '</strong>' +
            '<span class="muted" style="font-size:11px;">id=' + escapeHtml(item.id) + '</span>' +
            '<span class="muted" style="font-size:11px;">session=' + escapeHtml(item.sessionId || '—') + '</span>' +
            '<span class="muted" style="font-size:11px;">' + escapeHtml(fmtAge(item.createdAt)) + '</span>' +
            '</div>' +
            '<div class="mono muted" style="font-size:11px;word-break:break-all;">' + escapeHtml(ctx) + '</div>' +
            '<div style="display:flex;gap:8px;">' +
            '<button type="button" data-approve="' + escapeHtml(item.id) + '"' +
            ' style="font-size:12px;padding:4px 10px;background:#2a7;color:#fff;border:0;border-radius:4px;cursor:pointer;">✓ Approve</button>' +
            '<button type="button" data-deny="' + escapeHtml(item.id) + '"' +
            ' style="font-size:12px;padding:4px 10px;background:#a33;color:#fff;border:0;border-radius:4px;cursor:pointer;">✗ Deny</button>' +
            '</div>' +
            '</div>';
    }

    async function refreshApprovals() {
        var list = document.getElementById('approval-queue-list');
        var counter = document.getElementById('approval-queue-count');
        if (!list) return;
        try {
            var res = await fetch('/api/approval/pending', { credentials: 'same-origin' });
            if (!res.ok) {
                list.innerHTML = '<div class="muted" style="font-size:12px;color:#a33;">HTTP ' + res.status + '</div>';
                if (counter) counter.textContent = '(error)';
                return;
            }
            var rows = await res.json();
            if (!Array.isArray(rows)) rows = [];
            if (counter) counter.textContent = '(' + rows.length + ')';
            if (rows.length === 0) {
                list.innerHTML = '<div class="muted" style="font-size:12px;">No pending approvals.</div>';
                return;
            }
            list.innerHTML = rows.map(renderRow).join('');
        } catch (e) {
            list.innerHTML = '<div class="muted" style="font-size:12px;color:#a33;">Fetch failed: ' + escapeHtml((e && e.message) || String(e)) + '</div>';
            if (counter) counter.textContent = '(error)';
        }
    }

    async function decide(id, decision) {
        setMessage('Submitting ' + decision + '…');
        try {
            var res = await fetch('/api/approval/' + encodeURIComponent(id) + '/' + decision, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) {
                setMessage('HTTP ' + res.status + ' on ' + decision, true);
                return;
            }
            setMessage(decision + ' OK · ' + new Date().toLocaleTimeString());
            await refreshApprovals();
        } catch (e) {
            setMessage('Network error: ' + ((e && e.message) || String(e)), true);
        }
    }

    function bindClicks() {
        var list = document.getElementById('approval-queue-list');
        var refresh = document.getElementById('approval-queue-refresh');
        if (refresh && !refresh.__bound) {
            refresh.__bound = true;
            refresh.addEventListener('click', function () { refreshApprovals(); });
        }
        if (list && !list.__bound) {
            list.__bound = true;
            list.addEventListener('click', function (ev) {
                var t = ev.target;
                if (!(t instanceof Element)) return;
                var approveId = t.getAttribute('data-approve');
                var denyId = t.getAttribute('data-deny');
                if (approveId) decide(approveId, 'approve');
                else if (denyId) decide(denyId, 'deny');
            });
        }
    }

    function start() {
        if (pollHandle != null) return;
        bindClicks();
        refreshApprovals();
        pollHandle = setInterval(refreshApprovals, POLL_MS);
    }

    function tryAttach() {
        if (document.getElementById('approval-queue')) {
            start();
            return true;
        }
        return false;
    }

    function init() {
        if (tryAttach()) return;
        var observer = new MutationObserver(function () {
            if (tryAttach()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.refreshApprovalQueue = refreshApprovals;
})();
