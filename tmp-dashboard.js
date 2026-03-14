
    const state = {
      sessions: [],
      selectedSessionId: null,
      messages: [],
      status: null,
      llmCatalog: null,
      llmAuditEvents: [],
      actions: [],
      pending: [],
      actionHistory: [],
      retrievalAlerts: [],
      events: [],
      busy: false,
      notice: null
    };

    async function request(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(payload.error || ('Request failed with status ' + response.status));
      }
      return payload;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatRelativeTime(value) {
      if (!value) {
        return '-';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleString();
    }

    function statusBadge(action) {
      const badgeClass = action.status === 'running'
        ? 'badge badge-running'
        : action.status === 'succeeded'
          ? 'badge badge-succeeded'
          : action.status === 'failed'
            ? 'badge badge-failed'
            : 'badge';
      return '<span class="' + badgeClass + '">' + escapeHtml(action.status) + '</span>';
    }

    async function loadSessions() {
      const payload = await request('/api/chat/sessions');
      state.sessions = payload;
      if (!state.selectedSessionId && state.sessions.length > 0) {
        state.selectedSessionId = state.sessions[0].sessionId;
      }
      if (state.selectedSessionId && !state.sessions.some(session => session.sessionId === state.selectedSessionId)) {
        state.selectedSessionId = state.sessions[0] ? state.sessions[0].sessionId : null;
      }
    }

    async function createSession() {
      const payload = await request('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      state.selectedSessionId = payload.session.sessionId;
      await loadSessions();
      await loadMessages();
      render();
    }

    async function loadMessages() {
      if (!state.selectedSessionId) {
        state.messages = [];
        return;
      }
      const payload = await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages');
      state.messages = payload.messages;
    }

    async function refreshChrome() {
      const llmUrl = state.selectedSessionId
        ? '/api/llm/providers?sessionId=' + encodeURIComponent(state.selectedSessionId)
        : null;
      const llmAuditUrl = '/api/events?limit=10&operation=dashboard.llm_selection'
        + (state.selectedSessionId ? '&chatSessionId=' + encodeURIComponent(state.selectedSessionId) : '');
      const [status, llmCatalog, llmAuditEvents, pending, actions, actionHistory, events, retrievalData] = await Promise.all([
        request('/api/status'),
        llmUrl ? request(llmUrl) : Promise.resolve(null),
        request(llmAuditUrl),
        request('/api/pending'),
        request('/api/actions'),
        request('/api/action-history'),
        request('/api/events?limit=8'),
        request('/api/retrieval/alerts').catch(() => ({ alerts: [] }))
      ]);
      state.status = status;
      state.llmCatalog = llmCatalog;
      state.llmAuditEvents = llmAuditEvents;
      state.pending = pending;
      state.actions = actions;
      state.actionHistory = actionHistory;
      state.events = events;
      state.retrievalAlerts = retrievalData.alerts || [];
    }

    async function bootstrap() {
      try {
        await loadSessions();
        if (state.sessions.length === 0) {
          await createSession();
        } else {
          await Promise.all([refreshChrome(), loadMessages()]);
          render();
        }
      } catch (error) {
        state.notice = String(error);
        render();
      }
    }

    function renderSessions() {
      const container = document.getElementById('session-list');
      if (!state.sessions.length) {
        container.innerHTML = '<div class="empty-state">No saved sessions yet.</div>';
        return;
      }

      container.innerHTML = state.sessions.map(session => {
        const preview = session.lastMessagePreview || 'Start a new conversation.';
        const activeClass = state.selectedSessionId === session.sessionId ? ' active' : '';
        return '<button class="session-card' + activeClass + '" data-session-id="' + escapeHtml(session.sessionId) + '" onclick="selectSession(this.dataset.sessionId)">'
          + '<div class="session-title">' + escapeHtml(session.title) + '</div>'
          + '<div class="session-preview">' + escapeHtml(preview) + '</div>'
          + '<div class="session-meta"><span>' + escapeHtml(String(session.messageCount)) + ' msgs</span><span>' + escapeHtml(formatRelativeTime(session.updatedAt)) + '</span></div>'
          + '</button>';
      }).join('');
    }

    function renderHeader() {
      const activeSession = state.sessions.find(session => session.sessionId === state.selectedSessionId);
      document.getElementById('active-session-title').textContent = activeSession ? activeSession.title : 'PRISM Chat';
      document.getElementById('active-session-meta').textContent = activeSession
        ? 'Updated ' + formatRelativeTime(activeSession.updatedAt) + ' � ' + activeSession.messageCount + ' messages'
        : 'Persistent runtime session';

      const chips = [];
      if (state.status) {
        chips.push('<span class="chip">Mode: ' + escapeHtml(state.status.mode) + '</span>');
        chips.push('<span class="chip">Environment: ' + escapeHtml(state.status.environmentProfile) + '</span>');
        chips.push('<span class="chip">Pending approvals: ' + escapeHtml(String(state.status.pendingApprovals)) + '</span>');
        chips.push('<span class="chip">Sessions: ' + escapeHtml(String(state.status.chatSessionCount)) + '</span>');
      }
      if (state.llmCatalog && state.llmCatalog.activeProviderId) {
        chips.push('<span class="chip">Provider: ' + escapeHtml(state.llmCatalog.activeProviderId) + '</span>');
        chips.push('<span class="chip">Model: ' + escapeHtml(state.llmCatalog.activeModel || '-') + '</span>');
      }
      document.getElementById('header-chips').innerHTML = chips.join('');
    }

    function renderMessages() {
      const container = document.getElementById('messages');
      if (!state.messages.length) {
        container.innerHTML = '<div class="empty-state"><strong>Persistent operator chat is ready.</strong><br><br>Ask for status, approvals, history, or trigger actions like <span class="mono">run workflow demo</span>.</div>';
        return;
      }

      const rows = state.messages.map(message => {
        const roleLabel = message.role === 'user' ? 'Operator' : message.role === 'assistant' ? 'PRISM' : 'System';
        return '<div class="message ' + escapeHtml(message.role) + '">'
          + '<div class="message-label">' + escapeHtml(roleLabel) + '</div>'
          + '<div>' + escapeHtml(message.content) + '</div>'
          + '<div class="message-time">' + escapeHtml(formatRelativeTime(message.createdAt)) + '</div>'
          + '</div>';
      }).join('');

      const typing = state.busy ? '<div class="message assistant"><div class="message-label">PRISM</div><div>Working...</div></div>' : '';
      container.innerHTML = rows + typing;
      container.scrollTop = container.scrollHeight;
    }

    function renderOverview() {
      const container = document.getElementById('runtime-overview');
      if (!state.status) {
        container.innerHTML = '<div class="muted">Loading runtime status...</div>';
        return;
      }
      const lastEvent = state.status.lastEvent;
      container.innerHTML = [
        metricRow('Session', state.status.sessionId),
        metricRow('Started', formatRelativeTime(state.status.startedAt)),
        metricRow('Uptime', String(state.status.uptimeSeconds) + 's'),
        metricRow('Events', String(state.status.eventCount)),
        metricRow('Last event', lastEvent ? lastEvent.operation + ' (' + lastEvent.status + ')' : 'none')
      ].join('');
    }

    function renderLlm() {
      const container = document.getElementById('llm-provider');
      if (!state.llmCatalog) {
        container.innerHTML = '<div class="muted">Loading providers...</div>';
        return;
      }

      const providers = state.llmCatalog.providers || [];
      if (!providers.length) {
        container.innerHTML = '<div class="muted">No providers configured.</div>';
        return;
      }

      const activeProviderId = state.llmCatalog.activeProviderId || '';
      const activeProvider = providers.find(provider => provider.id === activeProviderId) || null;
      const selectedModels = activeProvider ? (activeProvider.models || []) : [];
      const activeModel = state.llmCatalog.activeModel || '';

      const providerOptions = providers.map(provider =>
        '<option value="' + escapeHtml(provider.id) + '" ' + (provider.id === activeProviderId ? 'selected' : '') + '>'
        + escapeHtml(provider.label + (provider.enabled ? '' : ' (unavailable)'))
        + '</option>'
      ).join('');

      const modelOptions = selectedModels.length > 0
        ? selectedModels.map(model =>
          '<option value="' + escapeHtml(model) + '" ' + (model === activeModel ? 'selected' : '') + '>' + escapeHtml(model) + '</option>'
        ).join('')
        : '<option value="">No models available</option>';

      const reason = activeProvider && !activeProvider.enabled && activeProvider.reason
        ? '<div class="muted" style="margin-top:8px;color:#ffc1c1;">' + escapeHtml(activeProvider.reason) + '</div>'
        : '';

      container.innerHTML = ''
        + '<label class="muted" for="provider-select">Provider</label>'
        + '<select id="provider-select" class="secondary-button" style="width:100%;text-align:left;">' + providerOptions + '</select>'
        + '<label class="muted" for="model-select" style="margin-top:8px;display:block;">Model</label>'
        + '<select id="model-select" class="secondary-button" style="width:100%;text-align:left;">' + modelOptions + '</select>'
        + '<div class="action-buttons">'
        + '<button class="secondary-button" onclick="applyLlmSelection()">Apply</button>'
        + '</div>'
        + '<div class="muted" style="margin-top:8px;">Keys are sourced from environment variables and never shown in UI.</div>'
        + reason;
    }

    function renderLlmAudit() {
      const container = document.getElementById('llm-audit');
      const events = state.llmAuditEvents || [];
      if (!events.length) {
        container.innerHTML = '<div class="muted">No provider switch events for this scope.</div>'
          + '<div class="action-buttons">'
          + '<button class="secondary-button" disabled>Export JSON</button>'
          + '<button class="secondary-button" disabled>Copy JSON</button>'
          + '<button class="secondary-button" disabled>Export CSV</button>'
          + '</div>';
        return;
      }

      const successCount = events.filter(event => event.status === 'succeeded').length;
      const failedCount = events.filter(event => event.status === 'failed').length;

      container.innerHTML = ''
        + '<div class="metric"><span class="muted">Succeeded</span><span class="mono">' + escapeHtml(String(successCount)) + '</span></div>'
        + '<div class="metric"><span class="muted">Failed</span><span class="mono">' + escapeHtml(String(failedCount)) + '</span></div>'
        + '<div class="action-buttons">'
        + '<button class="secondary-button" onclick="exportLlmAuditJson()">Export JSON</button>'
        + '<button class="secondary-button" onclick="copyLlmAuditJson()">Copy JSON</button>'
        + '<button class="secondary-button" onclick="exportLlmAuditCsv()">Export CSV</button>'
        + '</div>'
        + '<table class="events-table"><thead><tr><th>Time</th><th>Selection</th><th>Status</th></tr></thead><tbody>'
        + events.map(event => {
          const details = event.details || {};
          const requestedProviderId = details.requestedProviderId || '-';
          const requestedModel = details.requestedModel || '-';
          const selectedProviderId = details.selectedProviderId || '-';
          const selectedModel = details.selectedModel || '-';
          const reason = details.reason
            ? ('<div class="muted">Reason: ' + escapeHtml(String(details.reason)) + '</div>')
            : '';
          return '<tr>'
            + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
            + '<td><div class="mono">req ' + escapeHtml(String(requestedProviderId)) + ' / ' + escapeHtml(String(requestedModel)) + '</div>'
            + '<div class="mono">sel ' + escapeHtml(String(selectedProviderId)) + ' / ' + escapeHtml(String(selectedModel)) + '</div>'
            + reason + '</td>'
            + '<td>' + escapeHtml(event.status) + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody></table>';
    }

    function exportLlmAuditJson() {
      const payload = buildLlmAuditPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    async function copyLlmAuditJson() {
      const payload = buildLlmAuditPayload();
      const text = JSON.stringify(payload, null, 2);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          state.notice = 'LLM audit JSON copied to clipboard.';
          render();
          return;
        }
      } catch {
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const copied = document.execCommand('copy');
        state.notice = copied
          ? 'LLM audit JSON copied to clipboard.'
          : 'Clipboard permission denied. Use Export JSON instead.';
      } catch {
        state.notice = 'Clipboard copy failed. Use Export JSON instead.';
      } finally {
        document.body.removeChild(textarea);
        render();
      }
    }

    function buildLlmAuditPayload() {
      const payload = {
        exportedAt: new Date().toISOString(),
        scope: {
          sessionId: state.selectedSessionId || null,
          operation: 'dashboard.llm_selection'
        },
        counts: {
          total: state.llmAuditEvents.length,
          succeeded: state.llmAuditEvents.filter(event => event.status === 'succeeded').length,
          failed: state.llmAuditEvents.filter(event => event.status === 'failed').length
        },
        events: state.llmAuditEvents
      };
      return payload;
    }

    function exportLlmAuditCsv() {
      const rows = [];
      rows.push([
        'timestamp',
        'status',
        'chatSessionId',
        'source',
        'requestedProviderId',
        'requestedModel',
        'previousProviderId',
        'previousModel',
        'selectedProviderId',
        'selectedModel',
        'reason'
      ]);

      for (const event of state.llmAuditEvents) {
        const details = event.details || {};
        rows.push([
          event.timestamp || '',
          event.status || '',
          details.chatSessionId || '',
          details.source || '',
          details.requestedProviderId || '',
          details.requestedModel || '',
          details.previousProviderId || '',
          details.previousModel || '',
          details.selectedProviderId || '',
          details.selectedModel || '',
          details.reason || ''
        ]);
      }

      const csv = rows.map(cols => cols.map(toCsvValue).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const safeSession = (state.selectedSessionId || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'prism-llm-audit-' + safeSession + '-' + timestamp + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function toCsvValue(value) {
      const text = String(value ?? '');
      if (/[",\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }

    function metricRow(label, value) {
      return '<div class="metric"><span class="muted">' + escapeHtml(label) + '</span><span class="mono">' + escapeHtml(value) + '</span></div>';
    }

    function renderActions() {
      const container = document.getElementById('actions');
      let html = '';
      if (state.notice) {
        html += '<div class="notice">' + escapeHtml(state.notice) + '</div>';
      }
      if (!state.actions.length) {
        container.innerHTML = html + '<div class="muted">No dashboard actions available.</div>';
        return;
      }

      html += state.actions.map(action =>
        '<div class="action-card">'
        + '<div class="action-card-head"><strong>' + escapeHtml(action.label) + '</strong>' + statusBadge(action) + '</div>'
        + '<div class="muted">' + escapeHtml(action.description) + '</div>'
        + (action.lastMessage ? '<div class="muted" style="margin-top:8px;">Last result: ' + escapeHtml(action.lastMessage) + '</div>' : '')
        + (action.lastError ? '<div style="margin-top:8px;color:#ffc1c1;">Last error: ' + escapeHtml(action.lastError) + '</div>' : '')
        + '<div class="action-buttons"><button class="secondary-button" ' + (action.status === 'running' ? 'disabled' : '') + ' data-action="' + escapeHtml(action.name) + '" onclick="runAction(this.dataset.action)">Run</button></div>'
        + '</div>'
      ).join('');
      container.innerHTML = html;
    }

    function renderApprovals() {
      const container = document.getElementById('pending');
      if (!state.pending.length) {
        container.innerHTML = '<div class="muted">No pending approvals.</div>';
        return;
      }
      container.innerHTML = state.pending.map(item =>
        '<div class="approval-card">'
        + '<div><strong>' + escapeHtml(item.operation) + '</strong></div>'
        + '<div class="muted mono" style="margin-top:6px;">' + escapeHtml(item.id) + '</div>'
        + '<div class="action-buttons"><button class="secondary-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="approve(this.dataset.approvalId)">Approve</button><button class="danger-button" data-approval-id="' + escapeHtml(item.id) + '" onclick="deny(this.dataset.approvalId)">Deny</button></div>'
        + '</div>'
      ).join('');
    }

    function renderActionHistory() {
      const container = document.getElementById('action-history');
      if (!state.actionHistory.length) {
        container.innerHTML = '<div class="muted">No action runs recorded yet.</div>';
        return;
      }
      container.innerHTML = '<table class="history-table"><thead><tr><th>Action</th><th>Status</th><th>Outcome</th></tr></thead><tbody>'
        + state.actionHistory.slice(0, 8).map(entry => '<tr>'
          + '<td>' + escapeHtml(entry.label) + '<div class="muted">' + escapeHtml(formatRelativeTime(entry.startedAt)) + '</div></td>'
          + '<td>' + escapeHtml(entry.status) + '</td>'
          + '<td>' + escapeHtml(entry.message || entry.error || '-') + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }

    function renderRetrievalObservability() {
      const container = document.getElementById('retrieval-alerts');
      if (!state.retrievalAlerts || !state.retrievalAlerts.length) {
        container.innerHTML = '<div class="muted">No alerts.</div>';
        return;
      }
      let html = '<div class="stack">';
      for (const alert of state.retrievalAlerts.slice(0, 5)) {
        html += '<div class="action-card" style="background:rgba(255,141,141,0.06);border-color:rgba(255,141,141,0.18)">'
          + '<div style="font-size:12px;color:var(--muted)">' + escapeHtml(alert) + '</div>'
          + '</div>';
      }
      if (state.retrievalAlerts.length > 5) {
        html += '<div class="muted">+ ' + (state.retrievalAlerts.length - 5) + ' more alerts</div>';
      }
      html += '</div>';
      container.innerHTML = html;
    }

    function renderEvents() {
      const container = document.getElementById('events');
      if (!state.events.length) {
        container.innerHTML = '<div class="muted">No recent events.</div>';
        return;
      }
      container.innerHTML = '<table class="events-table"><thead><tr><th>Time</th><th>Operation</th><th>Status</th></tr></thead><tbody>'
        + state.events.map(event => '<tr>'
          + '<td>' + escapeHtml(formatRelativeTime(event.timestamp)) + '</td>'
          + '<td>' + escapeHtml(event.operation) + '</td>'
          + '<td>' + escapeHtml(event.status) + '</td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }

    function render() {
      renderSessions();
      renderHeader();
      renderMessages();
      renderOverview();
      renderLlm();
      renderLlmAudit();
      renderActions();
      renderApprovals();
      renderActionHistory();
      renderRetrievalObservability();
      renderEvents();
      document.getElementById('send-button').disabled = state.busy;
    }

    async function selectSession(sessionId) {
      state.selectedSessionId = sessionId;
      await Promise.all([loadMessages(), refreshChrome()]);
      render();
    }

    async function sendMessage() {
      const composer = document.getElementById('composer');
      const content = composer.value.trim();
      if (!content || state.busy) {
        return;
      }
      if (!state.selectedSessionId) {
        await createSession();
      }
      state.busy = true;
      state.notice = null;
      render();
      try {
        await request('/api/chat/sessions/' + encodeURIComponent(state.selectedSessionId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        composer.value = '';
        await Promise.all([loadSessions(), loadMessages(), refreshChrome()]);
      } catch (error) {
        state.notice = String(error);
      } finally {
        state.busy = false;
        render();
      }
    }

    async function runAction(name) {
      state.notice = null;
      try {
        await request('/api/actions/' + name, { method: 'POST' });
        await refreshChrome();
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function applyLlmSelection() {
      const providerSelect = document.getElementById('provider-select');
      const modelSelect = document.getElementById('model-select');
      const providerId = providerSelect ? providerSelect.value : '';
      const model = modelSelect ? modelSelect.value : '';
      if (!providerId) {
        return;
      }
      state.notice = null;
      try {
        await request('/api/llm/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.selectedSessionId, providerId, model })
        });
        await refreshChrome();
      } catch (error) {
        state.notice = String(error);
      }
      render();
    }

    async function approve(id) {
      await request('/api/approve/' + id, { method: 'POST' });
      await refreshChrome();
      render();
    }

    async function deny(id) {
      await request('/api/deny/' + id, { method: 'POST' });
      await refreshChrome();
      render();
    }

    document.getElementById('composer').addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    });

    bootstrap();
  
