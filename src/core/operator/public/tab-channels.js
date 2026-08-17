import { request, escapeHtml, dashboardLog, showTransientNotice } from './dashboard-core.js';

let idleTrackerTimer = null;
let idleLastActivityAt = Date.now();
let bindingsReady = false;

function byId(id) {
    return document.getElementById(id);
}

function formatChannelLogLine(line) {
    const text = typeof line === 'string' ? line : JSON.stringify(line);
    return `<div class="channels-log-entry-system">${escapeHtml(text)}</div>`;
}

function setPresenceIndicator(status) {
    const dot = byId('presence-status-indicator');
    if (!dot) return;
    dot.classList.remove('status-online', 'status-away', 'status-dnd', 'status-offline');
    dot.classList.add('status-' + (status || 'online'));
}

function renderChannelLogs(logs) {
    const container = byId('channel-logs-container');
    if (!container) return;
    if (!Array.isArray(logs) || logs.length === 0) {
        container.innerHTML = '<div class="channels-log-entry-system">[SYSTEM] No channel activity logged yet.</div>';
        return;
    }
    container.innerHTML = logs.map(formatChannelLogLine).join('');
    container.scrollTop = container.scrollHeight;
}

async function refreshPresenceLogs() {
    try {
        const payload = await request('/api/presence/logs');
        renderChannelLogs(payload.logs || []);
    } catch (err) {
        console.warn('[channels] Failed to refresh logs:', err);
    }
}

async function refreshOAuthCards() {
    const gmailStatus = byId('gmail-status-text');
    const outlookStatus = byId('outlook-status-text');
    const gmailBtn = byId('gmail-connect-btn');
    const outlookBtn = byId('outlook-connect-btn');

    try {
        const data = await request('/api/auth/gmail/status');
        if (gmailStatus) {
            gmailStatus.textContent = data.connected ? `Connected as ${data.email || 'gmail account'}` : 'Not connected';
        }
        if (gmailBtn) {
            gmailBtn.textContent = data.connected ? 'Disconnect' : 'Connect';
            gmailBtn.dataset.connected = data.connected ? '1' : '0';
        }
    } catch {
        if (gmailStatus) gmailStatus.textContent = 'Unavailable';
    }

    try {
        const data = await request('/api/auth/outlook/status');
        if (outlookStatus) {
            outlookStatus.textContent = data.connected
                ? `Connected as ${data.email || data.displayName || 'outlook account'}`
                : 'Not connected';
        }
        if (outlookBtn) {
            outlookBtn.textContent = data.connected ? 'Disconnect' : 'Connect';
            outlookBtn.dataset.connected = data.connected ? '1' : '0';
        }
    } catch {
        if (outlookStatus) outlookStatus.textContent = 'Unavailable';
    }
}

function bindChannelsUi() {
    if (bindingsReady) return;

    const presenceSelect = byId('presence-status-select');
    if (presenceSelect) {
        presenceSelect.addEventListener('change', () => {
            void onPresenceStatusChanged(presenceSelect.value);
        });
    }

    const autoAwayToggle = byId('auto-away-enabled');
    if (autoAwayToggle) {
        autoAwayToggle.addEventListener('change', () => {
            void toggleAutoAway(autoAwayToggle.checked);
        });
    }

    const autoAwayTimeout = byId('auto-away-timeout');
    if (autoAwayTimeout) {
        autoAwayTimeout.addEventListener('change', () => {
            void onAutoAwayTimeoutChanged(autoAwayTimeout.value);
        });
    }

    const saveSmsBtn = byId('save-sms-btn');
    if (saveSmsBtn) {
        saveSmsBtn.addEventListener('click', () => {
            void saveSmsGatewayConfig();
        });
    }

    const testSmsBtn = byId('test-sms-btn');
    if (testSmsBtn) {
        testSmsBtn.addEventListener('click', () => {
            void sendTestSms();
        });
    }

    const clearLogsBtn = byId('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            void clearChannelLogs();
        });
    }

    const gmailConnect = byId('gmail-connect-btn');
    if (gmailConnect) {
        gmailConnect.addEventListener('click', () => {
            const connected = gmailConnect.dataset.connected === '1';
            if (connected) {
                void disconnectChannel('gmail');
            } else {
                void connectChannel('gmail');
            }
        });
    }

    const outlookConnect = byId('outlook-connect-btn');
    if (outlookConnect) {
        outlookConnect.addEventListener('click', () => {
            const connected = outlookConnect.dataset.connected === '1';
            if (connected) {
                void disconnectChannel('outlook');
            } else {
                void connectChannel('outlook');
            }
        });
    }

    bindingsReady = true;
}

export async function initChannelsTab() {
    bindChannelsUi();

    try {
        const presence = await request('/api/presence');
        const status = presence.status || 'online';

        const presenceSelect = byId('presence-status-select');
        if (presenceSelect) presenceSelect.value = status;

        const autoAwayToggle = byId('auto-away-enabled');
        if (autoAwayToggle) autoAwayToggle.checked = !!presence.autoAway;

        const autoAwayTimeout = byId('auto-away-timeout');
        if (autoAwayTimeout) autoAwayTimeout.value = String(presence.autoAwayTimeout || 10);

        const smsPhone = byId('sms-phone');
        if (smsPhone) smsPhone.value = presence.smsPhone || '';

        const smsCarrier = byId('sms-carrier');
        if (smsCarrier) smsCarrier.value = presence.smsCarrier || 'att';

        setPresenceIndicator(status);
    } catch (err) {
        console.warn('[channels] Failed to load presence config:', err);
    }

    await Promise.all([refreshOAuthCards(), refreshPresenceLogs()]);
    startIdleTracker();
}

export async function onPresenceStatusChanged(status) {
    const presenceSelect = byId('presence-status-select');
    const nextStatus = status || (presenceSelect ? presenceSelect.value : 'online');
    try {
        await request('/api/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus })
        });
        setPresenceIndicator(nextStatus);
        dashboardLog('channels', 'presence.update', 'Operator status set to ' + nextStatus);
        await refreshPresenceLogs();
    } catch (err) {
        showTransientNotice('Failed to update status: ' + String(err.message || err), 'error');
    }
}

export async function toggleAutoAway(enabled) {
    const autoAwayToggle = byId('auto-away-enabled');
    const autoAwayTimeout = byId('auto-away-timeout');
    const isEnabled = typeof enabled === 'boolean' ? enabled : !!(autoAwayToggle && autoAwayToggle.checked);
    const timeout = autoAwayTimeout ? parseInt(autoAwayTimeout.value || '10', 10) : 10;

    try {
        await request('/api/presence/auto-away', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: isEnabled, timeout })
        });
        dashboardLog('channels', 'presence.autoAway', `Auto-away ${isEnabled ? 'enabled' : 'disabled'} (${timeout}m)`);
        await refreshPresenceLogs();
    } catch (err) {
        showTransientNotice('Failed to update auto-away settings: ' + String(err.message || err), 'error');
    }
}

export async function onAutoAwayTimeoutChanged(timeoutValue) {
    const autoAwayToggle = byId('auto-away-enabled');
    if (!autoAwayToggle || !autoAwayToggle.checked) return;
    const timeout = parseInt(timeoutValue || '10', 10) || 10;
    await toggleAutoAway(true);
    dashboardLog('channels', 'presence.autoAwayTimeout', `Auto-away timeout updated to ${timeout}m`);
}

export async function saveSmsGatewayConfig() {
    const phoneInput = byId('sms-phone');
    const carrierSelect = byId('sms-carrier');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const carrier = carrierSelect ? carrierSelect.value : 'att';

    try {
        await request('/api/presence/sms-gateway', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, carrier })
        });
        showTransientNotice('SMS gateway settings saved.', 'success');
        dashboardLog('channels', 'sms.gateway.saved', `SMS gateway configured for ${carrier}`);
        await refreshPresenceLogs();
    } catch (err) {
        showTransientNotice('Failed to save SMS gateway: ' + String(err.message || err), 'error');
    }
}

export async function sendTestSms() {
    try {
        await request('/api/presence/test-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        showTransientNotice('Test SMS broadcast sent.', 'success');
        dashboardLog('channels', 'sms.test', 'Test SMS broadcast sent');
        await refreshPresenceLogs();
    } catch (err) {
        showTransientNotice('Test SMS failed: ' + String(err.message || err), 'error');
    }
}

export async function clearChannelLogs() {
    try {
        await request('/api/presence/logs', { method: 'DELETE' });
        renderChannelLogs([]);
        dashboardLog('channels', 'logs.clear', 'Channel logs cleared');
    } catch (err) {
        showTransientNotice('Failed to clear channel logs: ' + String(err.message || err), 'error');
    }
}

export async function connectChannel(provider) {
    try {
        const data = await request('/api/auth/' + provider + '/authorize');
        if (data.authUrl) {
            window.open(data.authUrl, '_blank', 'width=520,height=640,noopener');
            showTransientNotice('OAuth window opened for ' + provider + '.', 'info');

            let polls = 0;
            const pollTimer = setInterval(async () => {
                polls++;
                await refreshOAuthCards();
                if (polls >= 60) {
                    clearInterval(pollTimer);
                }
            }, 2000);
        }
    } catch (err) {
        showTransientNotice('Failed to connect ' + provider + ': ' + String(err.message || err), 'error');
    }
}

export async function disconnectChannel(provider) {
    try {
        await request('/api/auth/' + provider + '/disconnect', { method: 'DELETE' });
        await refreshOAuthCards();
        showTransientNotice(provider + ' disconnected.', 'success');
    } catch (err) {
        showTransientNotice('Failed to disconnect ' + provider + ': ' + String(err.message || err), 'error');
    }
}

export function startIdleTracker() {
    if (idleTrackerTimer) return;

    const touch = () => {
        idleLastActivityAt = Date.now();
    };

    window.addEventListener('mousemove', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    window.addEventListener('click', touch, { passive: true });

    idleTrackerTimer = setInterval(() => {
        const autoAwayToggle = byId('auto-away-enabled');
        const autoAwayTimeout = byId('auto-away-timeout');
        if (!autoAwayToggle || !autoAwayToggle.checked || !autoAwayTimeout) return;

        const timeoutMinutes = parseInt(autoAwayTimeout.value || '10', 10) || 10;
        const idleMs = Date.now() - idleLastActivityAt;
        if (idleMs >= timeoutMinutes * 60 * 1000) {
            const presenceSelect = byId('presence-status-select');
            if (presenceSelect && presenceSelect.value !== 'away') {
                presenceSelect.value = 'away';
                void onPresenceStatusChanged('away');
            }
        }
    }, 15000);
}

export function stopIdleTracker() {
    if (idleTrackerTimer) {
        clearInterval(idleTrackerTimer);
        idleTrackerTimer = null;
    }
}
