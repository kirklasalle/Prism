// PRISM Strict Release Validation Panel Controller (additive — v0.21.0).
//
// This module hydrates the Release Validation panel in tab-computer.html.
// It is intentionally dependency-free (uses fetch + DOM only) to remain decoupled.
//
(function () {
    'use strict';

    let pollIntervalTimer = null;
    let isCurrentlyPolling = false;

    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function setStatusPill(text, status) {
        const pill = $('validation-status-pill');
        if (!pill) return;
        pill.textContent = text.toUpperCase();
        
        let color = '#8b949e';
        let bg = 'rgba(255,255,255,0.06)';
        let border = 'rgba(255,255,255,0.1)';
        let shadow = 'none';

        if (status === 'running') {
            color = '#38bdf8';
            bg = 'rgba(56,189,248,0.15)';
            border = 'rgba(56,189,248,0.4)';
            shadow = '0 0 10px rgba(56,189,248,0.2)';
            pill.classList.add('pulse-animation');
        } else {
            pill.classList.remove('pulse-animation');
            if (status === 'passed') {
                color = '#4ade80';
                bg = 'rgba(74,222,128,0.15)';
                border = 'rgba(74,222,128,0.4)';
                shadow = '0 0 10px rgba(74,222,128,0.2)';
            } else if (status === 'failed') {
                color = '#f87171';
                bg = 'rgba(248,113,113,0.15)';
                border = 'rgba(248,113,113,0.4)';
                shadow = '0 0 10px rgba(248,113,113,0.2)';
            }
        }

        pill.style.color = color;
        pill.style.background = bg;
        pill.style.borderColor = border;
        pill.style.boxShadow = shadow;
        pill.style.border = '1px solid ' + border;
    }

    function renderGates(gates) {
        const grid = $('validation-gates-grid');
        if (!grid) return;

        if (!gates || gates.length === 0) {
            grid.innerHTML = '<div class="muted" style="grid-column:1/-1;padding:12px;text-align:center;font-size:12px;">No gate execution data available. Click <strong>Run Strict Validation</strong>.</div>';
            return;
        }

        grid.innerHTML = gates.map(gate => {
            const status = gate.status || 'unknown';
            let statusColor = '#8b949e';
            let statusBg = 'rgba(255,255,255,0.04)';
            let borderColor = 'rgba(148,163,184,0.1)';

            if (status === 'passed') {
                statusColor = '#4ade80';
                statusBg = 'rgba(74,222,128,0.1)';
                borderColor = '#4ade80';
            } else if (status === 'failed') {
                statusColor = '#f87171';
                statusBg = 'rgba(248,113,113,0.1)';
                borderColor = '#f87171';
            } else if (status === 'manual_required') {
                statusColor = '#fbbf24';
                statusBg = 'rgba(251,191,36,0.1)';
                borderColor = '#fbbf24';
            }

            return `<div class="panel" style="padding:10px;border-left:4px solid ${borderColor};display:flex;flex-direction:column;gap:6px;background:var(--surface);border-radius:6px;transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span style="font-weight:600;font-size:13px;color:var(--text);">${escapeHtml(gate.label)}</span>
                    <span style="font-size:9px;font-weight:800;text-transform:uppercase;color:${statusColor};background:${statusBg};padding:2px 6px;border-radius:4px;letter-spacing:0.5px;">${escapeHtml(status)}</span>
                </div>
                <div class="muted" style="font-size:10px;">ID: <span style="font-family:monospace;">${escapeHtml(gate.id)}</span> • Required for: <strong style="color:var(--text-muted);">${escapeHtml(gate.requiredFor)}</strong></div>
                ${gate.details ? `<div class="muted" style="font-size:10.5px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;margin-top:2px;line-height:1.4;">${escapeHtml(gate.details)}</div>` : ''}
            </div>`;
        }).join('');
    }

    async function refreshStatus() {
        if (isCurrentlyPolling) return;
        isCurrentlyPolling = true;
        try {
            const token = document.querySelector('meta[name="prism-auth-token"]')?.getAttribute('content') || '';
            const headers = { 'Accept': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch('/api/release-validation/status', { headers, credentials: 'same-origin' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const status = await res.json();

            // 1. Update active button state
            const btn = $('validation-run-button');
            if (btn) {
                if (status.running) {
                    btn.disabled = true;
                    btn.textContent = '⏳ Executing Gates...';
                    btn.style.opacity = '0.7';
                } else {
                    btn.disabled = false;
                    btn.textContent = '▶ Run Strict Validation';
                    btn.style.opacity = '1';
                }
            }

            // 2. Update status pill
            if (status.running) {
                setStatusPill('running', 'running');
            } else if (status.passed === true) {
                setStatusPill('passed', 'passed');
            } else if (status.passed === false) {
                setStatusPill('failed', 'failed');
            } else {
                setStatusPill('idle', 'idle');
            }

            // 3. Update artifact link
            const artLink = $('validation-artifact-path');
            if (artLink) {
                if (status.gates && status.gates.length > 0) {
                    artLink.textContent = status.passed !== null 
                        ? `Generated at ${new Date(status.generatedAt).toLocaleTimeString()}`
                        : 'Generating...';
                } else {
                    artLink.textContent = 'Not generated yet';
                }
            }

            // 4. Update logs console
            const logBox = $('validation-console-output');
            if (logBox && status.log !== undefined) {
                const wasAtBottom = logBox.scrollHeight - logBox.clientHeight <= logBox.scrollTop + 40;
                logBox.textContent = status.log || 'Running release validation suite...\n';
                if (wasAtBottom || status.running) {
                    logBox.scrollTop = logBox.scrollHeight;
                }
            }

            // 5. Update gate grid
            renderGates(status.gates);

            // Adjust polling frequency dynamically based on state
            adjustPollingFrequency(status.running);

        } catch (e) {
            console.error('[validation] status refresh failed', e);
            setStatusPill('unavailable', 'failed');
        } finally {
            isCurrentlyPolling = false;
        }
    }

    function adjustPollingFrequency(isRunning) {
        const delay = isRunning ? 1500 : 8000;
        if (pollIntervalTimer) {
            clearInterval(pollIntervalTimer);
        }
        pollIntervalTimer = setInterval(refreshStatus, delay);
    }

    async function startReleaseValidation() {
        const btn = $('validation-run-button');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Initializing...';
        }
        
        try {
            const token = document.querySelector('meta[name="prism-auth-token"]')?.getAttribute('content') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch('/api/release-validation/run', {
                method: 'POST',
                headers,
                credentials: 'same-origin'
            });
            
            if (res.status === 499) {
                alert('A release validation run is already in progress.');
                refreshStatus();
                return;
            }

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || ('HTTP ' + res.status));
            }

            const data = await res.json();
            const logBox = $('validation-console-output');
            if (logBox) logBox.textContent = 'Validation run spawned (PID: ' + data.pid + '). Fetching logs...\n';
            
            // Immediately kick off high-frequency polling
            setStatusPill('running', 'running');
            adjustPollingFrequency(true);
            setTimeout(refreshStatus, 300);

        } catch (e) {
            alert('Failed to start validation suite: ' + e.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '▶ Run Strict Validation';
            }
        }
    }

    // Add pulse animation CSS styles dynamically
    function injectStyles() {
        if ($('validation-panel-styles')) return;
        const style = document.createElement('style');
        style.id = 'validation-panel-styles';
        style.textContent = `
            @keyframes pulse-val {
                0% { opacity: 0.7; }
                50% { opacity: 1; }
                100% { opacity: 0.7; }
            }
            .pulse-animation {
                animation: pulse-val 1.5s infinite;
                border-style: dashed !important;
            }
        `;
        document.head.appendChild(style);
    }

    function initValidationPanel() {
        if (!$('release-validation-panel')) return;
        injectStyles();
        refreshStatus();
    }

    // Expose handlers globally for HTML inline `onclick` bindings
    window.startReleaseValidation = startReleaseValidation;
    window.refreshReleaseValidationStatus = refreshStatus;
    window.initValidationPanel = initValidationPanel;

    // Mutation observer boots script when the target computer tab HTML fragment is loaded
    const observer = new MutationObserver(() => {
        if ($('release-validation-panel') && !window.__validationBooted) {
            window.__validationBooted = true;
            initValidationPanel();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
