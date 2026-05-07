// tab-hardware.js
import { state, request, safeRenderStep, escapeHtml, dashboardLog } from './dashboard-core.js';

let hardwarePollInterval = null;

export function initHardwareTab() {
  refreshHardwareSwarm()
    .then(() => {
      if (!hardwarePollInterval) {
        hardwarePollInterval = setInterval(() => {
          if (state.activeTab === 'agentic') {
            refreshHardwareSwarm().catch(() => {});
          }
        }, 5000);
      }
    });
}

export async function refreshHardwareSwarm() {
  try {
    const data = await request('/api/hardware/swarm');
    state.hardwareSwarm = data.activeSlots || [];
    safeRenderStep('hardwareSwarmPanel', renderHardwareSwarmPanel);
  } catch (err) {
    dashboardLog('hardware', 'refresh.error', err.message);
  }
}

export async function loadModelToSlot(slotId) {
  const modelNameInput = document.getElementById(`hardware-load-input-${slotId}`);
  const modelName = modelNameInput ? modelNameInput.value.trim() : prompt("Enter model path or HuggingFace repo (e.g. bartowski/Meta-Llama-3-8B-Instruct-GGUF):");
  if (!modelName) return;

  try {
    await request('/api/hardware/swarm/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, model: modelName })
    });
    if (modelNameInput) modelNameInput.value = '';
    await refreshHardwareSwarm();
  } catch (err) {
    alert("Failed to load model: " + err.message);
  }
}

export async function unloadModelSlot(slotId) {
  try {
    await request('/api/hardware/swarm/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId })
    });
    await refreshHardwareSwarm();
  } catch (err) {
    alert("Failed to unload model: " + err.message);
  }
}

function renderHardwareSwarmPanel() {
  const container = document.getElementById('hardware-swarm-panel');
  if (!container) return;

  if (!state.hardwareSwarm || state.hardwareSwarm.length === 0) {
    container.innerHTML = '<div class="muted" style="padding:10px;">Swarm supervisor offline or no slots configured.</div>';
    return;
  }

  container.innerHTML = state.hardwareSwarm.map(slot => {
    const isOccupied = slot.model !== null;
    const isLoading = slot.status === 'loading';
    const isError = slot.status === 'error';
    const isReady = slot.status === 'ready';

    let statusHtml = '';
    let badgeClass = 'badge-running';
    if (isReady) badgeClass = 'badge-succeeded';
    if (isError) badgeClass = 'badge-failed';
    if (!isOccupied) badgeClass = '';

    if (!isOccupied) {
      statusHtml = '<span class="badge" style="opacity:0.6">EMPTY SLOT</span>';
    } else {
      statusHtml = `<span class="badge ${badgeClass}">${escapeHtml(slot.status.toUpperCase() || 'UNKNOWN')}</span>`;
    }

    let progressHtml = '';
    if (isLoading && slot.loadingProgress) {
      progressHtml = `<div style="font-size:11px;color:var(--accent);margin-top:6px;">Loading progress: ${escapeHtml(slot.loadingProgress)}</div>`;
    }

    let memoryHtml = '';
    if (isOccupied && slot.usageMemNow !== undefined) {
      const mb = Math.round(slot.usageMemNow / 1024 / 1024);
      memoryHtml = `<div style="font-size:11px;color:var(--muted);margin-top:4px;">RAM: ${mb} MB</div>`;
    }

    return `
      <div class="action-card" style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;">
            ${escapeHtml(slot.slotId)}
            ${statusHtml}
          </div>
          <div style="font-family:monospace;font-size:12px;color:var(--muted);">
            ${slot.port ? 'Port: ' + slot.port : 'Port: Unassigned'}
          </div>
        </div>
        ${isOccupied ? `
          <div style="font-size:13px;color:var(--text);margin-top:4px;word-break:break-all;">
            <strong>Model:</strong> ${escapeHtml(slot.model)}
          </div>
          ${progressHtml}
          ${memoryHtml}
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="danger-button" style="font-size:12px;padding:6px 12px;flex:1;" onclick="unloadModelSlot('${escapeHtml(slot.slotId)}')">Unload Process</button>
          </div>
        ` : `
          <div style="font-size:12px;color:var(--muted);margin-top:4px;">
            Slot available. Awaiting workload.
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <input type="text" id="hardware-load-input-${escapeHtml(slot.slotId)}" placeholder="Model repository/path..." style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:rgba(0,0,0,0.2);color:var(--text);font-size:12px;" onkeydown="if(event.key==='Enter') loadModelToSlot('${escapeHtml(slot.slotId)}')">
            <button class="primary-button" style="font-size:12px;padding:6px 12px;" onclick="loadModelToSlot('${escapeHtml(slot.slotId)}')">Load Model</button>
          </div>
        `}
      </div>
    `;
  }).join('');
}
