// ─────────────────────────────────────────────────────────────────────────────
// PRISM Tooltips — Dashboard Shell Registrar (Phase 1)
//
// Registers curated descriptors for the dashboard shell elements that live
// outside any per-tab fragment: brand panel, sidebar session controls,
// the 11 main tab buttons, and the WebSocket status indicator.
//
// Idempotent: re-running just refreshes the descriptors. ADDITIVE only —
// no existing markup or behaviour is modified.
// ─────────────────────────────────────────────────────────────────────────────

import { registerTooltipById } from './prism-tooltips.js';

const SHELL_TIPS = {
    'shell:brand': {
        kind: 'shell',
        icon: '🔷',
        label: 'PRISM Frontier Console',
        summary: 'Operator console for the PRISM AaaS platform — chat, agents, telemetry, and infrastructure in one pane.',
        lore: [
            'PRISM = Profile-aware, Risk-tiered, Inspectable, Sovereign, Multi-provider.',
            'AaaS — "Agents As A Service" — coined by Kirk LaSalle.',
            'Every panel here is hover-rich: try moving your mouse around to discover what each control does.',
        ],
        links: [
            { label: 'README', href: '/docs/../README.md' },
            { label: 'Wiki', href: 'https://github.com/kirklasalle/Prism/wiki' },
        ],
    },
    'shell:console-link': {
        kind: 'shell',
        icon: '🔗',
        label: 'Open console in a new tab',
        summary: 'Click to open this PRISM console URL in a new browser tab — useful for keeping the operator console pinned while working elsewhere.',
        lore: [
            'PRISM serves the console over the local port shown here.',
            'Bookmark this URL — it\'s stable for the life of this PRISM instance.',
        ],
    },
    'shell:export-session': {
        kind: 'shell',
        icon: '📤',
        label: 'Export Session',
        summary: 'Export the current chat session to a portable JSON bundle — messages, tool calls, telemetry, and provenance included.',
        lore: [
            'Exports include full provenance for audit replay.',
            'Pair with Import Session on another machine for clean handoffs.',
        ],
        links: [
            { label: 'Session Export Guide', href: '/docs/DEPLOYMENT_GUIDE.md' },
            { label: 'Wiki — Sessions', href: 'https://github.com/kirklasalle/Prism/wiki/Sessions' },
        ],
    },
    'shell:import-session': {
        kind: 'shell',
        icon: '📥',
        label: 'Import Session',
        summary: 'Import a previously exported PRISM session bundle and resume the conversation with full provenance restored.',
        lore: [
            'Imports verify provenance signatures before loading.',
            'Conflicting session IDs are de-duplicated automatically.',
        ],
    },
    'shell:package-sessions': {
        kind: 'shell',
        icon: '📦',
        label: 'Package Sessions',
        summary: 'Bundle multiple sessions into a single signed archive for handoff, audit, or compliance review.',
        lore: [
            'Useful for end-of-shift handoffs in business profiles.',
            'Archives include a manifest with hash + timestamp per session.',
        ],
    },
    'shell:new-session': {
        kind: 'shell',
        icon: '✨',
        label: 'New Session',
        summary: 'Start a fresh PRISM chat session with a clean message history. Provider, character, and workspace settings are preserved.',
        lore: [
            'New sessions inherit your active character assignment.',
            'Old sessions are kept in the sidebar — nothing is deleted.',
        ],
    },
    'shell:setup-wizard': {
        kind: 'shell',
        icon: '✨',
        label: 'Setup Wizard',
        summary: 'Re-run the guided PRISM Setup Wizard — providers, profile, character, workspace, and policy in one walkthrough.',
        lore: [
            'Safe to re-run any time; existing settings are preserved as defaults.',
            'The wizard performs preflight checks for each provider before saving.',
        ],
        links: [
            { label: 'Setup Guide', href: '/docs/DEPLOYMENT_GUIDE.md' },
            { label: 'Wiki — Setup Wizard', href: 'https://github.com/kirklasalle/Prism/wiki/Setup-Wizard' },
        ],
    },
    'shell:ws-status': {
        kind: 'shell',
        icon: '📡',
        label: 'Live connection',
        summary: 'Real-time WebSocket link between this console and the PRISM core. Green = healthy stream; red = reconnecting.',
        lore: [
            'All live updates (chat stream, telemetry, Guardian events) flow over this channel.',
            'PRISM auto-reconnects with exponential backoff if the link drops.',
        ],
        links: [
            { label: 'Wiki — Realtime Channel', href: 'https://github.com/kirklasalle/Prism/wiki/Realtime' },
        ],
    },
};

const TAB_TIPS = {
    chat: {
        icon: '💬',
        summary: 'Chat with PRISM — multi-provider, character-aware, with file attachments and streaming output.',
        lore: [
            'The composer accepts files, pasted clipboard content, and Markdown.',
            'Tool calls and provenance are captured for every message.',
        ],
    },
    settings: {
        icon: '⚙️',
        summary: 'Provider keys, model routing, capability matrix, and Spectrum Refraction (multi-model fan-out).',
        lore: [
            'Routing strategies: Direct, Role-Based, or Modality-Based.',
            'The capability matrix shows which models support text, code, images, and more.',
        ],
    },
    tools: {
        icon: '🛠️',
        summary: 'Tools, plugins, utilities, and the full diagnostics suite (agent, computer, network, telemetry, logs, scheduler).',
        lore: [
            'Diagnostics surfaces are independent — run one without affecting the others.',
            'Plugins are signed; signing keys live in config/plugin-signing-keys.json.',
        ],
    },
    agentic: {
        icon: '🛡️',
        summary: 'Guardian agent, agent management, sub-agents, swarms, and live agent telemetry.',
        lore: [
            'Guardian (llama.cpp) provides local oversight and policy enforcement.',
            'Hardware swarm shows local model slots — load and unload models live.',
        ],
        links: [
            { label: 'PAD Whitepaper', href: '/docs/PAD_WHITEPAPER.md' },
            { label: 'Wiki — Guardian', href: 'https://github.com/kirklasalle/Prism/wiki/Guardian-Agent' },
        ],
    },
    computer: {
        icon: '🖥️',
        summary: 'Local computer control — system info, console, vision framebuffer, environment, policy, and device manager.',
        lore: [
            'Vision framebuffer can capture single shots or 2-second bursts at 8 FPS.',
            'Policy controls are gated by your active execution profile.',
        ],
    },
    browser: {
        icon: '🌐',
        summary: 'Browser control — sessions, viewport, network, console, DOM, storage, and profiles.',
        lore: [
            'Launch browsers headed for inspection or headless for automation.',
            'Each session is fully isolated; profiles persist across launches.',
        ],
    },
    workspace: {
        icon: '🗂️',
        summary: 'Character assignment, workspace location, files, import manager, and workspace settings.',
        lore: [
            'Hover the character chips for a quick view of each persona.',
            'Workspace files are scoped to your active workspace path.',
        ],
        links: [
            { label: 'Character Guide', href: '/docs/CHARACTER_SELECTION_GUIDE.md' },
            { label: 'Wiki — Workspace', href: 'https://github.com/kirklasalle/Prism/wiki/Workspace' },
        ],
    },
    network: {
        icon: '🌐',
        summary: 'Network tools, settings, telemetry, console, and VRGC intelligence.',
        lore: [
            'VRGC = Verified Routing & Governance Channel.',
            'The console keeps a rolling history — click any entry to re-run.',
        ],
    },
    telemetry: {
        icon: '📊',
        summary: 'Usage & cost, runtime overview, runtime excellence, release readiness, and SLO gauges.',
        lore: [
            'Time-window buttons (1h / 1d / 7d) re-scope every panel on this tab.',
            'Runtime Excellence is a composite score; Release Readiness is a checklist.',
        ],
        links: [
            { label: 'SRE Guide', href: '/docs/ADMIN_SRE_GUIDE.md' },
            { label: 'Wiki — Telemetry', href: 'https://github.com/kirklasalle/Prism/wiki/Telemetry' },
        ],
    },
    logs: {
        icon: '📜',
        summary: 'Quick actions, pending approvals, traces, events, tool call log, and the rolling activity log.',
        lore: [
            'Activity log shows the last 500 entries; filter by source and severity.',
            'Pending approvals block agentic actions until you decide.',
        ],
    },
    scheduler: {
        icon: '📅',
        summary: 'Calendar, projects, Kanban board, timeline, and cron jobs — all in one scheduler.',
        lore: [
            'Switch views with the sub-tabs above the calendar.',
            'Cron jobs run on the PRISM core process, not your browser.',
        ],
    },
};

function buildTabDescriptor(tabId) {
    const t = TAB_TIPS[tabId];
    if (!t) return null;
    const label = (tabId.charAt(0).toUpperCase() + tabId.slice(1)).replace(/-/g, ' ');
    return {
        kind: 'shell-tab',
        icon: t.icon,
        label: label + ' tab',
        summary: t.summary,
        lore: t.lore,
        links: t.links,
        telemetry: () => {
            try {
                const w = (typeof window !== 'undefined' ? window : null);
                const state = w && w.state ? w.state : null;
                const activity = state && state.tabActivity ? state.tabActivity : null;
                const visits = (activity && activity[tabId]) || 0;
                const out = { visits: String(visits) };
                if (state && state.activeTab === tabId) out.active = 'now';
                return out;
            } catch (_) {
                return {};
            }
        },
    };
}

function buildWsStatusDescriptor() {
    const base = SHELL_TIPS['shell:ws-status'];
    return {
        ...base,
        telemetry: () => {
            try {
                const el = (typeof document !== 'undefined') ? document.getElementById('prism-ws-status') : null;
                const title = el && el.getAttribute('title') ? el.getAttribute('title') : '';
                const out = {};
                if (title) out.state = title;
                const w = (typeof window !== 'undefined' ? window : null);
                if (w && w.state) {
                    if (typeof w.state.lastWsConnectAt === 'number') {
                        out['since'] = new Date(w.state.lastWsConnectAt).toLocaleTimeString();
                    }
                    if (typeof w.state.wsReconnectCount === 'number') {
                        out.reconnects = String(w.state.wsReconnectCount);
                    }
                }
                return out;
            } catch (_) {
                return {};
            }
        },
    };
}

export function registerShellTooltips() {
    for (const [tipId, descriptor] of Object.entries(SHELL_TIPS)) {
        if (tipId === 'shell:ws-status') {
            registerTooltipById(tipId, buildWsStatusDescriptor());
        } else {
            registerTooltipById(tipId, descriptor);
        }
    }
    for (const tabId of Object.keys(TAB_TIPS)) {
        const desc = buildTabDescriptor(tabId);
        if (desc) registerTooltipById('shell:tab:' + tabId, desc);
    }
}
