// ─────────────────────────────────────────────────────────────────────────────
// PRISM Tooltips — Per-tab descriptor catalog (Phases 3–12)
//
// Single consolidated module with curated descriptors for every tab beyond
// Chat (Settings, Tools, Agentic, Computer, Browser, Workspace extension,
// Network, Telemetry, Logs, Scheduler).
//
// Auto-coverage in `prism-tooltips.js` already provides a baseline tooltip
// for every interactive element on every tab. This catalog *upgrades* the
// elements that benefit from richer summaries, lore lines, telemetry
// providers, and curated documentation/wiki links.
// ─────────────────────────────────────────────────────────────────────────────

import { registerTooltipById } from './prism-tooltips.js';

function safeState() {
    try { return (typeof window !== 'undefined' && window.state) ? window.state : null; } catch (_) { return null; }
}
function len(arr) { try { return Array.isArray(arr) ? arr.length : 0; } catch (_) { return 0; } }

const CATALOG = {
    // ── Settings tab ────────────────────────────────────────────────────────
    'settings:sr-toggle': {
        kind: 'settings', icon: '🌈', label: 'Spectrum Refraction',
        summary: 'Compounding orchestration — Logic + Creative + Main models synthesise a single response.',
        lore: [
            'SR fans your prompt to multiple models and merges the strongest answer.',
            'Trades a small latency cost for higher-quality outputs on hard prompts.',
            'Toggle off when you want a single-model deterministic response.',
        ],
        links: [{ label: 'Wiki: Spectrum Refraction', href: 'https://github.com/kirklasalle/Prism/wiki/Spectrum-Refraction' }],
    },
    'settings:session-provider': {
        kind: 'settings', icon: '🔌', label: 'Session Provider',
        summary: 'Which LLM provider this session is talking to right now.',
        lore: [
            'Switching mid-session preserves message history.',
            'Provider availability depends on configured API keys.',
        ],
    },
    'settings:model-routing': {
        kind: 'settings', icon: '🔀', label: 'Model Routing',
        summary: 'Decide whether requests go Direct, Role-Based, or Modality-Based.',
        lore: [
            'Direct: one model for everything.',
            'Role-Based: different models per role (planner, coder, reviewer).',
            'Modality-Based: text/code/image are routed to specialised models.',
        ],
        links: [{ label: 'Wiki: Model Routing', href: 'https://github.com/kirklasalle/Prism/wiki/Model-Routing' }],
    },
    'settings:provider-config': {
        kind: 'settings', icon: '🔑', label: 'Provider Configuration',
        summary: 'API keys and per-provider settings. Expand a card to manage.',
        lore: [
            'Keys are stored encrypted at rest.',
            'Use Test Connection on each card to verify a key before saving.',
        ],
    },
    'settings:capability-matrix': {
        kind: 'settings', icon: '📊', label: 'Model Capability Matrix',
        summary: 'Models scored by capability tier (T1 Minimal → T5 Frontier).',
        lore: [
            'Role routing picks the best-tier model that supports the requested modality.',
            'Tiers reflect both raw quality and feature support (vision, tools, JSON mode).',
        ],
    },
    'settings:divider': {
        kind: 'settings', icon: '↔️', label: 'Resize divider',
        summary: 'Drag to resize the Provider Config and Capability Matrix panels.',
        lore: ['Double-click to reset to a 50/50 split.'],
    },
    'settings:settings-panel': {
        kind: 'settings', icon: '⚙️', label: 'Settings',
        summary: 'Operator-level settings: telemetry opt-in, defaults, theme, and audit retention.',
    },
    'settings:llm-audit': {
        kind: 'settings', icon: '🧾', label: 'LLM Audit Trail',
        summary: 'Per-call audit records: request, response, model, cost, latency, tool calls.',
        lore: [
            'Audit retention is configurable in Settings.',
            'Trails support compliance review and replay.',
        ],
    },

    // ── Tools tab ───────────────────────────────────────────────────────────
    'tools:overview': {
        kind: 'tools', icon: '📈', label: 'Tools Overview',
        summary: 'At-a-glance counts: registered tools, plugins, utilities, and active diagnostics.',
    },
    'tools:plugins': {
        kind: 'tools', icon: '🧩', label: 'Plugins',
        summary: 'Signed third-party extensions loaded into PRISM.',
        lore: [
            'Signing keys live under config/plugin-signing-keys.json.',
            'Disabled plugins are isolated — they cannot be invoked even by mistake.',
        ],
        links: [{ label: 'Wiki: Plugins', href: 'https://github.com/kirklasalle/Prism/wiki/Plugins' }],
    },
    'tools:tools': {
        kind: 'tools', icon: '🛠️', label: 'Tools',
        summary: 'First-class tools available to agents (filesystem, web, computer, etc.).',
        lore: ['Tools are gated by your active execution profile.'],
    },
    'tools:utilities': {
        kind: 'tools', icon: '⚙️', label: 'Utilities',
        summary: 'Helper utilities: formatters, validators, encoders, and inspectors.',
    },
    'tools:diagnostics': {
        kind: 'tools', icon: '🧪', label: 'Diagnostics',
        summary: 'Run the full diagnostics suite — agent, computer, workspace, network, telemetry, logs, scheduler.',
        lore: [
            'Each suite runs independently and live-streams results.',
            'Pass/fail history is retained for trend analysis.',
        ],
        links: [{ label: 'Wiki: Diagnostics', href: 'https://github.com/kirklasalle/Prism/wiki/Diagnostics' }],
    },
    'tools:demo': {
        kind: 'tools', icon: '🎬', label: 'Demo Scenarios',
        summary: 'Replay reference scenarios — useful for testing, training, and onboarding.',
    },

    // Diagnostics suites
    'diag:agent': { kind: 'diagnostics', icon: '🤖', label: 'Agent Diagnostics', summary: 'End-to-end agent dispatch, tool-call, and response checks.' },
    'diag:computer': { kind: 'diagnostics', icon: '🖥️', label: 'Computer Diagnostics', summary: 'Local OS, console, framebuffer, and device-tree probes.' },
    'diag:workspace': { kind: 'diagnostics', icon: '📂', label: 'Workspace Diagnostics', summary: 'Workspace path, files, imports, and character-assignment integrity.' },
    'diag:network': { kind: 'diagnostics', icon: '🌐', label: 'Network Diagnostics', summary: 'Connectivity, DNS, latency, and VRGC channel health.' },
    'diag:telemetry': { kind: 'diagnostics', icon: '📊', label: 'Telemetry Diagnostics', summary: 'Counters, histograms, and SLO gauge sanity checks.' },
    'diag:logs': { kind: 'diagnostics', icon: '📝', label: 'Logs & Debug Diagnostics', summary: 'Log buffers, action history, and trace correlation.' },
    'diag:scheduler': { kind: 'diagnostics', icon: '📅', label: 'Scheduler Diagnostics', summary: 'Calendar, cron, Kanban, and timeline integrity probes.' },

    // ── Agentic tab ─────────────────────────────────────────────────────────
    'agentic:guardian': {
        kind: 'agentic', icon: '🛡️', label: 'Guardian Agent',
        summary: 'Local llama.cpp supervisor — enforces policy, redacts PII, surfaces tips.',
        lore: [
            'Guardian runs entirely local; no agent telemetry leaves the machine.',
            'Guardian-pushed tooltips appear here in real time (look for the shield glyph).',
        ],
        links: [
            { label: 'PAD Whitepaper', href: '/docs/PAD_WHITEPAPER.md' },
            { label: 'Wiki: Guardian', href: 'https://github.com/kirklasalle/Prism/wiki/Guardian-Agent' },
        ],
    },
    'agentic:agent-list': {
        kind: 'agentic', icon: '🧑‍✈️', label: 'Agent Management',
        summary: 'All registered agents — their status, profile, character, and health.',
        telemetry: () => {
            const s = safeState(); const out = {};
            if (s && Array.isArray(s.agents)) out.agents = String(s.agents.length);
            return out;
        },
    },
    'agentic:sub-agents': {
        kind: 'agentic', icon: '🧬', label: 'Sub-Agent Tree',
        summary: 'Hierarchy of sub-agents spawned by your active agents.',
        lore: ['Sub-agents inherit risk tier from their parent.'],
    },
    'agentic:swarm': {
        kind: 'agentic', icon: '🐝', label: 'Swarm Control',
        summary: 'Coordinate multiple agents on a single objective.',
        lore: ['Swarm members share context but execute in parallel.'],
        links: [{ label: 'Wiki: Swarms', href: 'https://github.com/kirklasalle/Prism/wiki/Swarms' }],
    },
    'agentic:hardware-swarm': {
        kind: 'agentic', icon: '🖥️', label: 'Local Hardware Swarm',
        summary: 'Local model slots — load and unload models live across your hardware.',
        lore: [
            'Slots are sized to your GPU/CPU memory.',
            'Unload a model to free its slot for a different one.',
        ],
    },
    'agentic:telemetry': {
        kind: 'agentic', icon: '📊', label: 'Agent Telemetry',
        summary: 'Live KPIs across the agent fleet: active, completed, errors, latency.',
    },

    // ── Computer tab ────────────────────────────────────────────────────────
    'computer:local': {
        kind: 'computer', icon: '🖥️', label: 'Local Computer Control',
        summary: 'Host system info: OS, hostname, platform, uptime, RAM/VRAM.',
    },
    'computer:console': {
        kind: 'computer', icon: '⌨️', label: 'Console',
        summary: 'Run system commands inside the local execution sandbox.',
        lore: ['Output streams live; long-running commands can be cancelled with Esc.'],
    },
    'computer:framebuffer': {
        kind: 'computer', icon: '📸', label: 'Vision Framebuffer',
        summary: 'Capture single screenshots or 8 FPS bursts for vision-grounded reasoning.',
        lore: [
            'Bursts are 2 seconds at 8 FPS — useful for capturing motion.',
            'Auto-Refresh updates the viewer every 2 seconds.',
            'Click the image to open it full-size.',
        ],
        links: [{ label: 'Wiki: Vision', href: 'https://github.com/kirklasalle/Prism/wiki/Vision-Framebuffer' }],
    },
    'computer:env': {
        kind: 'computer', icon: '🌐', label: 'Environment Variables',
        summary: 'Visible environment variables on the host PRISM process.',
        lore: ['Sensitive variables (keys, tokens) are redacted in display.'],
    },
    'computer:policy': {
        kind: 'computer', icon: '📜', label: 'Policy Control',
        summary: 'Windows-only: Group Policy and Local Security Policy launchers.',
        lore: ['Requires admin privileges to mutate; read-only otherwise.'],
    },
    'computer:devices': {
        kind: 'computer', icon: '🔌', label: 'Device Manager',
        summary: 'OS device tree mirror — drivers, status, and identifiers.',
        telemetry: () => {
            const s = safeState(); const out = {};
            if (s && s.deviceTree && Array.isArray(s.deviceTree.devices)) out.devices = String(s.deviceTree.devices.length);
            return out;
        },
    },

    // ── Browser tab ─────────────────────────────────────────────────────────
    'browser:control': {
        kind: 'browser', icon: '🌐', label: 'Browser Control',
        summary: 'Top-level browser controls: dev tools, diagnostics, default profile.',
    },
    'browser:sessions': {
        kind: 'browser', icon: '🪟', label: 'Sessions',
        summary: 'Launch and manage isolated browser sessions (headed or headless).',
        telemetry: () => {
            const s = safeState(); const out = {};
            if (s && Array.isArray(s.browserSessions)) out.sessions = String(s.browserSessions.length);
            return out;
        },
    },
    'browser:viewport': {
        kind: 'browser', icon: '🖼️', label: 'Viewport',
        summary: 'Live page viewport, navigation, screenshots, click and type primitives.',
    },
    'browser:network': {
        kind: 'browser', icon: '📡', label: 'Network',
        summary: 'Per-session network log: every request with method, status, type, and timing.',
    },
    'browser:console': {
        kind: 'browser', icon: '🖨️', label: 'Console',
        summary: 'JavaScript console output captured from the running page.',
    },
    'browser:dom': {
        kind: 'browser', icon: '🌳', label: 'DOM',
        summary: 'Live DOM snapshot of the active session’s page.',
    },
    'browser:storage': {
        kind: 'browser', icon: '🗄️', label: 'Storage',
        summary: 'Cookies, localStorage, and sessionStorage for the active session.',
    },
    'browser:profiles': {
        kind: 'browser', icon: '👤', label: 'Profiles',
        summary: 'Persistent browser profiles segmented by use-case (work, personal, anon).',
    },
    'browser:action-log': {
        kind: 'browser', icon: '📜', label: 'Action Log',
        summary: 'Every browser action you (or an agent) ran — replayable.',
    },

    // ── Workspace extension (location, files, import, settings) ─────────────
    'workspace:location': {
        kind: 'workspace', icon: '📁', label: 'Workspace Location',
        summary: 'The active workspace path. All workspace files and imports are scoped here.',
        lore: ['Switching location preserves character assignments per-hub.'],
    },
    'workspace:files': {
        kind: 'workspace', icon: '📂', label: 'Workspace Files',
        summary: 'Filterable tree of files inside the active workspace.',
    },
    'workspace:import-manager': {
        kind: 'workspace', icon: '📦', label: 'Import Manager',
        summary: 'Import files, registered items, or whole folders into the workspace.',
        lore: ['Imports are gated by your active execution profile.'],
    },
    'workspace:settings': {
        kind: 'workspace', icon: '⚙️', label: 'Workspace Settings',
        summary: 'Active profile, auto-save, and Git-integration settings.',
    },

    // ── Network tab ─────────────────────────────────────────────────────────
    'network:tools': {
        kind: 'network', icon: '🛠️', label: 'Network Tools',
        summary: 'Ping, traceroute, DNS lookups, port scans, and more.',
    },
    'network:settings': {
        kind: 'network', icon: '⚙️', label: 'Network Settings',
        summary: 'Proxy, DNS, and adapter preferences for PRISM.',
    },
    'network:telemetry': {
        kind: 'network', icon: '📊', label: 'Network Telemetry',
        summary: 'Throughput, error rates, and per-route latency over the active window.',
    },
    'network:console': {
        kind: 'network', icon: '⌨️', label: 'Network Console',
        summary: 'Run network commands directly. History is preserved per session.',
    },
    'network:vrgc': {
        kind: 'network', icon: '🛡️', label: 'VRGC Intelligence',
        summary: 'Verified Routing & Governance Channel — policy-aware routing for sensitive traffic.',
        links: [{ label: 'Wiki: VRGC', href: 'https://github.com/kirklasalle/Prism/wiki/VRGC' }],
    },

    // ── Telemetry tab ───────────────────────────────────────────────────────
    'telemetry:usage-cost': {
        kind: 'telemetry', icon: '💰', label: 'Usage & Cost',
        summary: 'Token usage and cost broken out by provider and model.',
    },
    'telemetry:time-window': {
        kind: 'telemetry', icon: '⏱️', label: 'Time Window',
        summary: 'Re-scopes every panel on this tab to 1 hour, 1 day, or 7 days.',
    },
    'telemetry:what-changed': {
        kind: 'telemetry', icon: '🔄', label: 'What Changed',
        summary: 'Delta between this window and the prior comparable window.',
    },
    'telemetry:runtime-overview': {
        kind: 'telemetry', icon: '📈', label: 'Runtime Overview',
        summary: 'Top-line runtime metrics: requests, errors, latencies, active sessions.',
    },
    'telemetry:runtime-excellence': {
        kind: 'telemetry', icon: '🏆', label: 'Runtime Excellence',
        summary: 'Composite score across SLOs and reliability — higher is better.',
        lore: ['Excellence is a *score*. Release Readiness is a *checklist*.'],
    },
    'telemetry:release-readiness': {
        kind: 'telemetry', icon: '🚀', label: 'Release Readiness',
        summary: 'Checklist gating a packaged release. Must be all-green to ship.',
    },
    'telemetry:package-history': {
        kind: 'telemetry', icon: '📦', label: 'Package History',
        summary: 'Timeline of recent PRISM releases with status and notes.',
    },
    'telemetry:self-review': {
        kind: 'telemetry', icon: '🔍', label: 'Self Review',
        summary: 'PRISM’s own observations and improvement suggestions for this window.',
    },
    'telemetry:retrieval-alerts': {
        kind: 'telemetry', icon: '⚠️', label: 'Retrieval Alerts',
        summary: 'Anomalies in retrieval-augmented operations (RAG, search, embeddings).',
    },
    'telemetry:slo-gauges': {
        kind: 'telemetry', icon: '🎯', label: 'SLO Gauges',
        summary: 'Service-level objective dials. Red = breaching; amber = at-risk; green = healthy.',
    },

    // ── Logs tab ────────────────────────────────────────────────────────────
    'logs:actions': {
        kind: 'logs', icon: '⚡', label: 'Quick Actions',
        summary: 'One-click utilities (refresh, clear, export). Disabled while running.',
    },
    'logs:approvals': {
        kind: 'logs', icon: '✅', label: 'Pending Approvals',
        summary: 'Agentic actions blocked waiting for your approve/deny decision.',
        telemetry: () => {
            const s = safeState(); const out = {};
            if (s && Array.isArray(s.pendingApprovals)) out.pending = String(s.pendingApprovals.length);
            return out;
        },
    },
    'logs:action-history': {
        kind: 'logs', icon: '🕘', label: 'Action History',
        summary: 'Recent operator actions across the console.',
    },
    'logs:chat-telemetry': {
        kind: 'logs', icon: '💬', label: 'Chat Telemetry',
        summary: 'Per-session chat counters: messages, tokens, tool calls.',
    },
    'logs:trace-view': {
        kind: 'logs', icon: '🔗', label: 'Correlated Traces',
        summary: 'Cross-system traces linked by request id (chat → tool → provider).',
    },
    'logs:events': {
        kind: 'logs', icon: '📌', label: 'Recent Events',
        summary: 'Time-ordered system events.',
    },
    'logs:tool-call-log': {
        kind: 'logs', icon: '🛠️', label: 'Tool Call Log',
        summary: 'Every tool call (success or failure) with arguments and results.',
        telemetry: () => {
            const s = safeState(); const out = {};
            out.calls = String(len(s && s.toolCallLog));
            return out;
        },
    },
    'logs:activity-log': {
        kind: 'logs', icon: '📜', label: 'Activity Log',
        summary: 'Last 500 entries across the entire console. Filter by source and severity.',
    },
    'logs:filter-source': {
        kind: 'logs', icon: '🔎', label: 'Source filter',
        summary: 'Filter the activity log by source (diagnostics, agent, browser, chat, etc.).',
    },
    'logs:filter-severity': {
        kind: 'logs', icon: '🚦', label: 'Severity filter',
        summary: 'Filter the activity log by severity (info, warn, error).',
    },

    // ── Scheduler tab ───────────────────────────────────────────────────────
    'scheduler:header': {
        kind: 'scheduler', icon: '🗓️', label: 'Scheduler',
        summary: 'Calendar, projects, Kanban, timeline, and cron jobs.',
        links: [{ label: 'Wiki: Scheduler', href: 'https://github.com/kirklasalle/Prism/wiki/Scheduler' }],
    },
    'scheduler:add-event': { kind: 'scheduler', icon: '➕', label: 'Add Event', summary: 'Create a calendar event with title, time, and description.' },
    'scheduler:add-task': { kind: 'scheduler', icon: '➕', label: 'Add Task', summary: 'Create a task that flows through the Kanban board.' },
    'scheduler:add-project': { kind: 'scheduler', icon: '➕', label: 'Add Project', summary: 'Create a project — groups events and tasks under one umbrella.' },
    'scheduler:add-cron': { kind: 'scheduler', icon: '➕', label: 'Add Cron Job', summary: 'Schedule a recurring job to run on the PRISM core.' },
    'scheduler:view-calendar': { kind: 'scheduler', icon: '📅', label: 'Calendar view', summary: 'Year / Month / Week / Day calendar grid.' },
    'scheduler:view-projects': { kind: 'scheduler', icon: '📋', label: 'Projects view', summary: 'List of projects with their tasks and timelines.' },
    'scheduler:view-board': { kind: 'scheduler', icon: '📌', label: 'Kanban Board', summary: 'Backlog → To Do → In Progress → Review → Done.' },
    'scheduler:view-timeline': { kind: 'scheduler', icon: '📊', label: 'Timeline', summary: 'Gantt-style timeline of tasks and dependencies.' },
    'scheduler:view-cron': { kind: 'scheduler', icon: '⏰', label: 'Cron Jobs', summary: 'Recurring jobs running on the PRISM core.' },
};

export function registerTabTooltipCatalog() {
    for (const [tipId, descriptor] of Object.entries(CATALOG)) {
        registerTooltipById(tipId, descriptor);
    }
}
