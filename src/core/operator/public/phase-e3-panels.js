// Phase E3 additive panels — Utilities runner, Risk Overrides editor, CAC chain inspector.
// Pure-additive: only mounts when its anchor <div> exists in the DOM. No existing UI is replaced.
//
// Anchors (inserted by tab-tools.html / tab-settings.html):
//   #phase-e3-utilities-runner
//   #phase-e3-risk-overrides
//   #phase-e3-cac-panel

const fmt = (s) => (s == null ? '' : String(s));
const esc = (s) => fmt(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Read the auth token injected by the dashboard's <meta> tag so that
// fetches from this panel carry the same Authorization header as the
// shared `request()` helper in dashboard-core.js. Without this, /api/v1
// routes (which require auth) return 401 for anything mounted by E3.
function authHeaders(extra) {
    const meta = document.querySelector('meta[name="prism-auth-token"]');
    const token = meta ? meta.getAttribute('content') || '' : '';
    const headers = extra ? Object.assign({}, extra) : {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

async function fetchJson(url, opts) {
    const o = opts || {};
    const headers = authHeaders(Object.assign({ 'content-type': 'application/json' }, o.headers || {}));
    const res = await fetch(url, Object.assign({}, o, { headers }));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.status === 204 ? null : res.json();
}

// ---------- Utilities Runner ----------
async function renderUtilitiesRunner(host) {
    host.innerHTML = '<div style="opacity:0.7">Loading utilities…</div>';
    try {
        const data = await fetchJson('/api/v1/utilities');
        const utils = (data && data.utilities) || [];
        host.innerHTML = `
      <div class="stack" style="gap:6px">
        <div style="font-weight:600">Operator Utilities (${utils.length})</div>
        <div id="e3-util-list" class="stack" style="gap:4px"></div>
        <div id="e3-util-runs" style="margin-top:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;max-height:200px;overflow:auto"></div>
      </div>`;
        const list = host.querySelector('#e3-util-list');
        list.innerHTML = utils.map((u) => `
      <div style="display:flex;gap:8px;align-items:center;padding:4px;border:1px solid #2a2a2a;border-radius:4px">
        <div style="flex:1">
          <div style="font-weight:500">${esc(u.label || u.id)} <span style="opacity:0.6;font-size:11px">tier ${esc(u.riskTier)}</span></div>
          <div style="opacity:0.7;font-size:11px">${esc(u.description || '')}</div>
        </div>
        <button data-uid="${esc(u.id)}" class="e3-run-btn">Run</button>
      </div>`).join('');
        list.querySelectorAll('.e3-run-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-uid');
                if (!confirm(`Run utility "${id}"?`)) return;
                btn.disabled = true; btn.textContent = 'Running…';
                const log = host.querySelector('#e3-util-runs');
                try {
                    const resp = await fetchJson(`/api/v1/utilities/${encodeURIComponent(id)}/execute`, { method: 'POST', body: '{}' });
                    const runId = resp && resp.runId;
                    log.textContent = `[${id}] runId=${runId}\n` + (log.textContent || '');
                    if (runId) {
                        for (let i = 0; i < 30; i++) {
                            await new Promise((r) => setTimeout(r, 1000));
                            const s = await fetchJson(`/api/v1/utilities/runs/${encodeURIComponent(runId)}`).catch(() => null);
                            if (!s) break;
                            if (s.status === 'succeeded' || s.status === 'failed') {
                                log.textContent = `[${id}] ${s.status}: ${esc(s.output || s.error || '')}\n` + (log.textContent || '');
                                break;
                            }
                        }
                    }
                } catch (e) {
                    log.textContent = `[${id}] ERROR ${e.message}\n` + (log.textContent || '');
                } finally {
                    btn.disabled = false; btn.textContent = 'Run';
                }
            });
        });
    } catch (e) {
        host.innerHTML = `<div style="color:#f66">Failed to load utilities: ${esc(e.message)}</div>`;
    }
}

// ---------- Risk Overrides ----------
async function renderRiskOverrides(host) {
    host.innerHTML = '<div style="opacity:0.7">Loading overrides…</div>';
    try {
        const data = await fetchJson('/api/v1/tools/risk-overrides');
        const rows = (data && data.overrides) || [];
        host.innerHTML = `
      <div class="stack" style="gap:6px">
        <div style="font-weight:600">Tool Risk Overrides (${rows.length} active)</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="e3-ro-tool" placeholder="toolId" style="flex:1"/>
          <select id="e3-ro-tier"><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option></select>
          <input id="e3-ro-reason" placeholder="reason (required)" style="flex:1"/>
          <button id="e3-ro-set">Set</button>
        </div>
        <div id="e3-ro-list" class="stack" style="gap:4px"></div>
      </div>`;
        const list = host.querySelector('#e3-ro-list');
        list.innerHTML = rows.map((r) => `
      <div style="display:flex;gap:8px;align-items:center;padding:4px;border:1px solid #2a2a2a;border-radius:4px">
        <div style="flex:1">
          <code>${esc(r.toolId)}</code> → tier <strong>${esc(r.overrideTier)}</strong>
          <div style="opacity:0.7;font-size:11px">${esc(r.reason || '')} ${r.expiresAt ? `(expires ${esc(r.expiresAt)})` : ''}</div>
        </div>
        <button data-tid="${esc(r.toolId)}" class="e3-ro-clear">Clear</button>
      </div>`).join('') || '<div style="opacity:0.6">No active overrides.</div>';
        list.querySelectorAll('.e3-ro-clear').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const tid = btn.getAttribute('data-tid');
                if (!confirm(`Clear override for ${tid}?`)) return;
                try { await fetchJson(`/api/v1/tools/${encodeURIComponent(tid)}/risk`, { method: 'DELETE' }); renderRiskOverrides(host); } catch (e) { alert(e.message); }
            });
        });
        host.querySelector('#e3-ro-set').addEventListener('click', async () => {
            const toolId = host.querySelector('#e3-ro-tool').value.trim();
            const tier = parseInt(host.querySelector('#e3-ro-tier').value, 10);
            const reason = host.querySelector('#e3-ro-reason').value.trim();
            if (!toolId || !reason) { alert('toolId and reason required'); return; }
            try {
                await fetchJson(`/api/v1/tools/${encodeURIComponent(toolId)}/risk`, { method: 'PATCH', body: JSON.stringify({ overrideTier: tier, reason }) });
                renderRiskOverrides(host);
            } catch (e) { alert(e.message); }
        });
    } catch (e) {
        host.innerHTML = `<div style="color:#f66">Failed to load overrides: ${esc(e.message)}</div>`;
    }
}

// ---------- CAC Chain Inspector ----------
async function renderCacPanel(host) {
    host.innerHTML = '<div style="opacity:0.7">Loading assignments…</div>';
    try {
        const data = await fetchJson('/api/v1/cac/assignments');
        const items = (data && data.assignments) || [];
        host.innerHTML = `
      <div class="stack" style="gap:6px">
        <div style="display:flex;gap:6px;align-items:center">
          <div style="font-weight:600;flex:1">CAC Identity (${items.length} assignments)</div>
          <button id="e3-cac-export-json">Export JSON</button>
          <button id="e3-cac-export-csv">Export CSV</button>
        </div>
        <select id="e3-cac-select" style="width:100%">
          <option value="">— Select assignment —</option>
          ${items.map((a) => `<option value="${esc(a.id || a.assignmentId)}">${esc(a.characterId || '?')} → ${esc(a.operatorId || '?')} (${esc(a.status || 'active')})</option>`).join('')}
        </select>
        <div id="e3-cac-detail" style="margin-top:8px"></div>
      </div>`;
        host.querySelector('#e3-cac-export-json').addEventListener('click', () => window.open('/api/v1/cac/export?format=json', '_blank'));
        host.querySelector('#e3-cac-export-csv').addEventListener('click', () => window.open('/api/v1/cac/export?format=csv', '_blank'));
        host.querySelector('#e3-cac-select').addEventListener('change', async (ev) => {
            const id = ev.target.value;
            const detail = host.querySelector('#e3-cac-detail');
            if (!id) { detail.innerHTML = ''; return; }
            detail.innerHTML = '<div style="opacity:0.7">Loading chain…</div>';
            try {
                const chain = await fetchJson(`/api/v1/cac/assignments/${encodeURIComponent(id)}/chain`);
                const ev = chain.emailVerification || {};
                detail.innerHTML = `
          <div style="border:1px solid #2a2a2a;border-radius:4px;padding:8px;font-size:12px">
            <div><strong>Assignment:</strong> ${esc(id)}</div>
            <div><strong>Scopes:</strong> active ${esc(ev && chain.scopes ? chain.scopes.active : '?')} / expired ${esc(chain.scopes ? chain.scopes.expired : '?')}</div>
            <div><strong>Email verified:</strong> ${ev.verified ? `yes (${esc(ev.provider || '?')}, ${esc(ev.freshDays)}d ago)` : 'no'}</div>
            <button id="e3-cac-verify" style="margin-top:6px">Verify Email Now</button>
            <pre style="margin-top:8px;max-height:200px;overflow:auto;background:#111;padding:6px;border-radius:4px">${esc(JSON.stringify(chain, null, 2))}</pre>
          </div>`;
                detail.querySelector('#e3-cac-verify').addEventListener('click', async () => {
                    const provider = prompt('Provider (gmail | outlook):', 'gmail');
                    if (!provider) return;
                    try {
                        await fetchJson(`/api/v1/cac/${encodeURIComponent(id)}/verify-email`, { method: 'POST', body: JSON.stringify({ provider }) });
                        alert('Verification recorded.');
                        host.querySelector('#e3-cac-select').dispatchEvent(new Event('change'));
                    } catch (e) { alert(e.message); }
                });
            } catch (e) { detail.innerHTML = `<div style="color:#f66">${esc(e.message)}</div>`; }
        });
    } catch (e) {
        host.innerHTML = `<div style="color:#f66">Failed to load CAC: ${esc(e.message)}</div>`;
    }
}

// ---------- Auto-mount on tab activation ----------
function tryMount() {
    const u = document.querySelector('#phase-e3-utilities-runner');
    if (u && !u.dataset.mounted) { u.dataset.mounted = '1'; renderUtilitiesRunner(u); }
    const r = document.querySelector('#phase-e3-risk-overrides');
    if (r && !r.dataset.mounted) { r.dataset.mounted = '1'; renderRiskOverrides(r); }
    const c = document.querySelector('#phase-e3-cac-panel');
    if (c && !c.dataset.mounted) { c.dataset.mounted = '1'; renderCacPanel(c); }
}

// Observe DOM mutations so panels mount whenever their tab fragment is injected.
const observer = new MutationObserver(() => tryMount());
observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', tryMount, { once: true });
tryMount();

export { renderUtilitiesRunner, renderRiskOverrides, renderCacPanel };
