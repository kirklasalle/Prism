import { request, escapeHtml, showTransientNotice } from './dashboard-core.js';

function byId(id) {
    return document.getElementById(id);
}

function statusBadge(status) {
    const key = String(status || 'unknown').toLowerCase();
    const color =
        key === 'active' ? '#22c55e' :
            key === 'paused' ? '#f59e0b' :
                key === 'degraded' ? '#f97316' :
                    key === 'retired' ? '#94a3b8' :
                        key === 'maintenance' ? '#38bdf8' : '#ef4444';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;border:1px solid ${color};color:${color};">${escapeHtml(status || 'unknown')}</span>`;
}

function buildTypeOptions(selected) {
    const values = ['physical', 'virtual', 'simulation'];
    return values
        .map((value) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`)
        .join('');
}

async function transitionEntity(entityId, status) {
    try {
        await request('/api/addons/vrgc-robotics/entities/' + encodeURIComponent(entityId) + '/transition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        showTransientNotice('Updated entity status.', 'success');
        await renderRobotics();
    } catch (err) {
        showTransientNotice('Failed to update status: ' + String(err.message || err), 'error');
    }
}

function wireEntityActions(entities) {
    const table = byId('robotics-entity-table');
    if (!table) return;

    table.querySelectorAll('[data-entity-id][data-next-status]').forEach((button) => {
        button.addEventListener('click', () => {
            const entityId = button.getAttribute('data-entity-id');
            const nextStatus = button.getAttribute('data-next-status');
            if (!entityId || !nextStatus) return;
            void transitionEntity(entityId, nextStatus);
        });
    });

    const form = byId('robotics-register-form');
    if (!form || form.dataset.bound === '1') return;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const entityIdEl = byId('robotics-entity-id');
        const nameEl = byId('robotics-entity-name');
        const typeEl = byId('robotics-entity-type');
        const backendEl = byId('robotics-entity-backend');
        const endpointEl = byId('robotics-entity-endpoint');
        const characterEl = byId('robotics-entity-character');

        const entityId = entityIdEl ? entityIdEl.value.trim() : '';
        const name = nameEl ? nameEl.value.trim() : '';
        const type = typeEl ? typeEl.value : 'physical';

        if (!entityId || !name) {
            showTransientNotice('Entity ID and Name are required.', 'error');
            return;
        }

        try {
            await request('/api/addons/vrgc-robotics/entities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entityId,
                    name,
                    type,
                    cognitiveBackend: backendEl ? backendEl.value : 'hybrid',
                    mcpEndpoint: endpointEl && endpointEl.value.trim() ? endpointEl.value.trim() : undefined,
                    characterId: characterEl && characterEl.value.trim() ? characterEl.value.trim() : undefined
                })
            });

            showTransientNotice('Robotics entity registered.', 'success');
            form.reset();
            await renderRobotics();
        } catch (err) {
            showTransientNotice('Failed to register entity: ' + String(err.message || err), 'error');
        }
    });

    form.dataset.bound = '1';
}

function renderRoboticsContent(payload, integrationsPayload) {
    const entities = Array.isArray(payload.entities) ? payload.entities : [];
    const stats = payload.stats || {};
    const integrations = Array.isArray(integrationsPayload.integrations) ? integrationsPayload.integrations : [];

    const tableRows = entities.length === 0
        ? '<tr><td colspan="6" style="padding:12px;color:var(--muted);">No robotics entities registered yet.</td></tr>'
        : entities.map((entity) => {
            const status = entity.state && entity.state.status ? entity.state.status : 'unknown';
            return `<tr>
        <td style="padding:8px 10px;">${escapeHtml(entity.entityId || 'unknown')}</td>
        <td style="padding:8px 10px;">${escapeHtml(entity.name || 'Unnamed')}</td>
        <td style="padding:8px 10px;">${escapeHtml(entity.type || 'unknown')}</td>
        <td style="padding:8px 10px;">${statusBadge(status)}</td>
        <td style="padding:8px 10px;">${escapeHtml(entity.cognitiveBackend || 'n/a')}</td>
        <td style="padding:8px 10px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="secondary-button" data-entity-id="${escapeHtml(entity.entityId)}" data-next-status="active" style="font-size:11px;padding:4px 8px;">Activate</button>
          <button class="secondary-button" data-entity-id="${escapeHtml(entity.entityId)}" data-next-status="paused" style="font-size:11px;padding:4px 8px;">Pause</button>
          <button class="secondary-button" data-entity-id="${escapeHtml(entity.entityId)}" data-next-status="maintenance" style="font-size:11px;padding:4px 8px;">Maintenance</button>
        </td>
      </tr>`;
        }).join('');

    const integrationItems = integrations.length === 0
        ? '<div style="color:var(--muted);font-size:12px;">No integration metadata reported.</div>'
        : integrations.map((item) => {
            const values = Object.entries(item || {}).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v ?? ''))}`).join(' • ');
            return `<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--border);">${values}</div>`;
        }).join('');

    return `
    <div class="stack" style="gap:12px;">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div class="panel" style="padding:10px;"><div style="font-size:11px;color:var(--muted);">Total Entities</div><div style="font-size:20px;font-weight:700;">${escapeHtml(String(stats.totalEntities || entities.length || 0))}</div></div>
        <div class="panel" style="padding:10px;"><div style="font-size:11px;color:var(--muted);">Active</div><div style="font-size:20px;font-weight:700;">${escapeHtml(String(stats.active || 0))}</div></div>
        <div class="panel" style="padding:10px;"><div style="font-size:11px;color:var(--muted);">Paused</div><div style="font-size:20px;font-weight:700;">${escapeHtml(String(stats.paused || 0))}</div></div>
        <div class="panel" style="padding:10px;"><div style="font-size:11px;color:var(--muted);">Degraded</div><div style="font-size:20px;font-weight:700;">${escapeHtml(String(stats.degraded || 0))}</div></div>
      </div>

      <div class="panel" style="padding:12px;">
        <h4 style="margin:0 0 8px;">Register New Entity</h4>
        <form id="robotics-register-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;align-items:end;">
          <div><label style="font-size:11px;color:var(--muted);">Entity ID</label><input id="robotics-entity-id" class="form-control" type="text" placeholder="robot-001" /></div>
          <div><label style="font-size:11px;color:var(--muted);">Name</label><input id="robotics-entity-name" class="form-control" type="text" placeholder="Assembly Arm A" /></div>
          <div><label style="font-size:11px;color:var(--muted);">Type</label><select id="robotics-entity-type" class="form-control">${buildTypeOptions('physical')}</select></div>
          <div><label style="font-size:11px;color:var(--muted);">Backend</label><select id="robotics-entity-backend" class="form-control"><option value="hybrid">hybrid</option><option value="llm">llm</option><option value="brainsim">brainsim</option></select></div>
          <div><label style="font-size:11px;color:var(--muted);">MCP Endpoint</label><input id="robotics-entity-endpoint" class="form-control" type="text" placeholder="http://localhost:8203" /></div>
          <div><label style="font-size:11px;color:var(--muted);">Character ID</label><input id="robotics-entity-character" class="form-control" type="text" placeholder="sentinel-business" /></div>
          <div><button class="primary-button" type="submit">Register</button></div>
        </form>
      </div>

      <div class="panel" style="padding:12px;overflow:auto;">
        <h4 style="margin:0 0 8px;">Entities</h4>
        <table id="robotics-entity-table" style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;">ID</th>
              <th style="text-align:left;padding:8px 10px;">Name</th>
              <th style="text-align:left;padding:8px 10px;">Type</th>
              <th style="text-align:left;padding:8px 10px;">Status</th>
              <th style="text-align:left;padding:8px 10px;">Backend</th>
              <th style="text-align:left;padding:8px 10px;">Actions</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <div class="panel" style="padding:12px;">
        <h4 style="margin:0 0 8px;">Integrations</h4>
        ${integrationItems}
      </div>
    </div>
  `;
}

export async function renderRobotics() {
    const container = byId('robotics-content');
    if (!container) return;

    try {
        const [payload, integrationsPayload] = await Promise.all([
            request('/api/addons/vrgc-robotics/entities'),
            request('/api/addons/vrgc-robotics/integrations').catch(() => ({ integrations: [] }))
        ]);

        container.innerHTML = renderRoboticsContent(payload || {}, integrationsPayload || { integrations: [] });
        wireEntityActions(Array.isArray(payload && payload.entities) ? payload.entities : []);
    } catch (err) {
        container.innerHTML = `<div class="muted" style="padding:16px;color:#fca5a5;">Failed to load robotics data: ${escapeHtml(String(err.message || err))}</div>`;
    }
}

export async function initRoboticsTab() {
    await renderRobotics();
}
