// Chat tab tooltip registrar (Phase 2). Curated descriptors that override the
// auto-baseline. ADDITIVE — never modifies markup.

import { registerTooltipById } from './prism-tooltips.js';

function safeState() {
    try { return (typeof window !== 'undefined' && window.state) ? window.state : null; } catch (_) { return null; }
}

const TIPS = {
    'chat:header': {
        kind: 'chat',
        icon: '🧭',
        label: 'Active session header',
        summary: 'Session title, metadata, and live status chips for the chat you are currently in.',
        lore: [
            'Header chips reflect provider, character, profile, and risk tier.',
            'Click the title to rename the session.',
        ],
    },
    'chat:messages': {
        kind: 'chat',
        icon: '💬',
        label: 'Message thread',
        summary: 'Streaming conversation with PRISM. Includes user messages, assistant replies, tool calls, and provenance.',
        lore: [
            'Tool calls render inline — expand them to see arguments and results.',
            'Right-click a message to copy as Markdown.',
            'Provenance is captured per-message; view full traces in the Logs tab.',
        ],
        telemetry: () => {
            const s = safeState();
            const out = {};
            if (s && Array.isArray(s.messages)) out.messages = String(s.messages.length);
            if (s && s.activeSession && s.activeSession.id) out.session = String(s.activeSession.id).slice(0, 8);
            return out;
        },
    },
    'chat:composer-area': {
        kind: 'chat',
        icon: '✏️',
        label: 'Composer',
        summary: 'Where you talk to PRISM. Type, attach, paste, or drag files.',
        lore: [
            'Drag files anywhere over the composer to attach.',
            'Markdown is supported in the input.',
        ],
    },
    'chat:composer': {
        kind: 'chat',
        icon: '✏️',
        label: 'Message input',
        summary: 'Type a message to PRISM. Enter to send, Shift-Enter for a newline.',
        lore: [
            'The textarea auto-grows up to 240 px.',
            'Drag-drop files onto the page to attach them to your next message.',
        ],
    },
    'chat:attach': {
        kind: 'chat',
        icon: '📎',
        label: 'Attach file',
        summary: 'Attach images, audio, video, text, code, PDF, JSON, CSV, XML, YAML, or Markdown.',
        lore: [
            'Multiple files are supported in a single message.',
            'Attachments inherit the active execution profile’s policy.',
        ],
    },
    'chat:paste': {
        kind: 'chat',
        icon: '📋',
        label: 'Paste from clipboard',
        summary: 'Paste clipboard content (text or image) directly into your next message.',
        lore: [
            'Pasted images become attachments automatically.',
            'Use Ctrl-V in the composer for plain text paste.',
        ],
    },
    'chat:send': {
        kind: 'chat',
        icon: '⬆️',
        label: 'Send message',
        summary: 'Send your message (Enter). Streaming responses begin immediately.',
        lore: [
            'Tool calls run during streaming — no second round-trip needed.',
            'Tip: Esc cancels an in-flight stream.',
        ],
        telemetry: () => {
            const s = safeState();
            const out = {};
            if (s && Array.isArray(s.messages)) {
                out['session msgs'] = String(s.messages.length);
            }
            return out;
        },
    },
    'chat:attachments': {
        kind: 'chat',
        icon: '📎',
        label: 'Pending attachments',
        summary: 'Files queued to be sent with your next message.',
        lore: [
            'Click an attachment to remove it before sending.',
            'Large files may be chunked or summarised based on provider limits.',
        ],
    },
};

export function registerChatTooltips() {
    for (const [tipId, descriptor] of Object.entries(TIPS)) {
        registerTooltipById(tipId, descriptor);
    }
}
