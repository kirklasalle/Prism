/**
 * PRISM Simple Mode — Non-technical user interface.
 *
 * Provides a clean, three-character chat experience with no operator complexity.
 * Users can:
 *   - Pick a character (ARIA / PHOENIX / SENTINEL)
 *   - Chat in a single window
 *   - Browse recent sessions in a sidebar
 *   - Switch to Advanced Mode at any time
 *
 * Phase E3a.  Pure vanilla JS, no framework.
 * Communicates with the same REST API as the full operator dashboard.
 */

// ── Character definitions ─────────────────────────────────────────────────────

const CHARACTERS = [
    {
        id: "aria-individual",
        name: "ARIA",
        emoji: "🤝",
        color: "#69d2ff",
        badge: "General Assistant",
        persona: "Warm, approachable and structured",
        greeting: "Hi there! I'm ARIA, your personal assistant. What can I help you with today?",
    },
    {
        id: "phoenix-individual",
        name: "PHOENIX",
        emoji: "🔥",
        color: "#ff9d4d",
        badge: "Creative & Exploratory",
        persona: "Creative, autonomous, exploratory",
        greeting: "Hey! I'm PHOENIX — let's explore ideas and build something great. What's on your mind?",
    },
    {
        id: "sentinel-individual",
        name: "SENTINEL",
        emoji: "🛡️",
        color: "#7cf1c8",
        badge: "Organized & Precise",
        persona: "Organized, methodical and precise",
        greeting: "Hello. I'm SENTINEL — let's get organized. What tasks need attention?",
    },
];

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
    /** Currently selected character (persisted to localStorage). */
    characterId: localStorage.getItem("prism_simple_character") ?? CHARACTERS[0].id,
    /** Active chat session ID. */
    sessionId: null,
    /** Messages for the current session. */
    messages: [],
    /** All sessions list for sidebar. */
    sessions: [],
    /** True while a chat request is in-flight. */
    sending: false,
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getToken() {
    return document.querySelector('meta[name="prism-auth-token"]')?.content ?? "";
}

function authHeaders(extra = {}) {
    const token = getToken();
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...extra }
        : { "Content-Type": "application/json", ...extra };
}

async function apiFetch(path, opts = {}) {
    const res = await fetch(path, {
        headers: authHeaders(),
        ...opts,
        headers: { ...authHeaders(), ...(opts.headers ?? {}) },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.json();
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function createSession(title) {
    const data = await apiFetch("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title }),
    });
    return data.session;
}

async function loadSessions() {
    const data = await apiFetch("/api/chat/sessions");
    return Array.isArray(data) ? data : (data.sessions ?? []);
}

async function loadMessages(sessionId) {
    const data = await apiFetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
    return data.messages ?? [];
}

async function sendMessage(sessionId, content) {
    const data = await apiFetch(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        { method: "POST", body: JSON.stringify({ content }) }
    );
    return data;
}

async function saveUiMode(mode) {
    await apiFetch("/api/preferences/ui-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
    }).catch(() => { }); // non-fatal
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function getCharacter(id) {
    return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

function renderCharacterPicker() {
    const picker = document.getElementById("sm-character-picker");
    if (!picker) return;
    picker.innerHTML = CHARACTERS.map((ch) => {
        const selected = ch.id === state.characterId;
        return `
      <button
        class="sm-char-card${selected ? " sm-char-card--selected" : ""}"
        data-char-id="${ch.id}"
        style="${selected ? `--char-color: ${ch.color}; border-color: ${ch.color};` : ""}"
        aria-pressed="${selected}"
        title="${ch.persona}"
      >
        <span class="sm-char-emoji">${ch.emoji}</span>
        <span class="sm-char-name">${ch.name}</span>
        <span class="sm-char-badge">${ch.badge}</span>
        <span class="sm-char-persona">${ch.persona}</span>
      </button>
    `;
    }).join("");

    picker.querySelectorAll(".sm-char-card").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectCharacter(btn.dataset.charId);
        });
    });
}

function renderSessions() {
    const el = document.getElementById("sm-session-list");
    if (!el) return;
    if (state.sessions.length === 0) {
        el.innerHTML = '<p class="sm-empty">No previous chats yet.</p>';
        return;
    }
    el.innerHTML = state.sessions
        .slice()
        .reverse()
        .slice(0, 20)
        .map((s) => {
            const active = s.sessionId === state.sessionId;
            const title = s.title ?? s.sessionId ?? "Untitled";
            const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "";
            return `
        <button
          class="sm-session-item${active ? " sm-session-item--active" : ""}"
          data-session-id="${s.sessionId}"
        >
          <span class="sm-session-title">${escHtml(title)}</span>
          ${date ? `<span class="sm-session-date">${date}</span>` : ""}
        </button>
      `;
        })
        .join("");

    el.querySelectorAll(".sm-session-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            loadSession(btn.dataset.sessionId);
        });
    });
}

function renderMessages() {
    const el = document.getElementById("sm-messages");
    if (!el) return;

    if (state.messages.length === 0) {
        const ch = getCharacter(state.characterId);
        el.innerHTML = `
      <div class="sm-greeting">
        <span class="sm-greeting-emoji">${ch.emoji}</span>
        <p>${escHtml(ch.greeting)}</p>
      </div>
    `;
        return;
    }

    el.innerHTML = state.messages
        .map((m) => {
            const role = m.role === "user" ? "user" : "assistant";
            const ch = getCharacter(state.characterId);
            const label = role === "user" ? "You" : ch.name;
            return `
        <div class="sm-msg sm-msg--${role}">
          <span class="sm-msg-label">${label}</span>
          <div class="sm-msg-content">${formatContent(m.content ?? "")}</div>
        </div>
      `;
        })
        .join("");

    // Scroll to bottom
    el.scrollTop = el.scrollHeight;
}

function renderSendButton() {
    const btn = document.getElementById("sm-send-btn");
    if (!btn) return;
    btn.disabled = state.sending;
    btn.textContent = state.sending ? "…" : "Send";
}

function renderAll() {
    renderCharacterPicker();
    renderSessions();
    renderMessages();
    renderSendButton();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatContent(text) {
    // Convert newlines to <br> and escape HTML
    return escHtml(text).replace(/\n/g, "<br>");
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function selectCharacter(charId) {
    state.characterId = charId;
    localStorage.setItem("prism_simple_character", charId);
    renderCharacterPicker();
    renderMessages(); // update greeting/labels
}

async function newChat() {
    const ch = getCharacter(state.characterId);
    try {
        const session = await createSession(`${ch.name} — ${new Date().toLocaleDateString()}`);
        state.sessionId = session.sessionId;
        state.messages = [];
        state.sessions = await loadSessions();
        renderAll();
    } catch (err) {
        showError("Failed to create session: " + err.message);
    }
}

async function loadSession(sessionId) {
    try {
        state.sessionId = sessionId;
        state.messages = await loadMessages(sessionId);
        renderSessions();
        renderMessages();
    } catch (err) {
        showError("Failed to load session: " + err.message);
    }
}

async function submitMessage() {
    const input = document.getElementById("sm-input");
    const content = input?.value?.trim();
    if (!content || state.sending) return;

    // Ensure we have a session
    if (!state.sessionId) {
        await newChat();
        if (!state.sessionId) return;
    }

    state.sending = true;
    input.value = "";
    renderSendButton();

    // Optimistic user message
    state.messages.push({ role: "user", content, messageId: `tmp-${Date.now()}` });
    renderMessages();

    try {
        const turn = await sendMessage(state.sessionId, content);
        // Replace optimistic messages with real turn
        state.messages = state.messages.filter((m) => !m.messageId?.startsWith("tmp-"));
        if (turn.userMessage) state.messages.push(turn.userMessage);
        if (turn.assistantMessage) state.messages.push(turn.assistantMessage);
        // Refresh session list (title may have been set)
        state.sessions = await loadSessions();
    } catch (err) {
        state.messages = state.messages.filter((m) => !m.messageId?.startsWith("tmp-"));
        showError("Failed to send message: " + err.message);
    } finally {
        state.sending = false;
        renderAll();
        input?.focus();
    }
}

function showError(msg) {
    const el = document.getElementById("sm-error");
    if (el) {
        el.textContent = msg;
        el.style.display = "block";
        setTimeout(() => { el.style.display = "none"; }, 5000);
    } else {
        console.error("[SimpleMode]", msg);
    }
}

async function switchToAdvanced() {
    await saveUiMode("advanced");
    window.location.href = "/dashboard";
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
    // Save simple mode preference
    await saveUiMode("simple");

    // Load sessions
    try {
        state.sessions = await loadSessions();
    } catch {
        state.sessions = [];
    }

    // Load the most recent session if available
    if (state.sessions.length > 0) {
        const latest = state.sessions[state.sessions.length - 1];
        state.sessionId = latest.sessionId;
        try {
            state.messages = await loadMessages(state.sessionId);
        } catch {
            state.messages = [];
        }
    }

    renderAll();

    // Wire up "New Chat" button
    const newChatBtn = document.getElementById("sm-new-chat-btn");
    if (newChatBtn) newChatBtn.addEventListener("click", newChat);

    // Wire up send button
    const sendBtn = document.getElementById("sm-send-btn");
    if (sendBtn) sendBtn.addEventListener("click", submitMessage);

    // Wire up "Advanced Mode" button
    const advancedBtn = document.getElementById("sm-advanced-btn");
    if (advancedBtn) advancedBtn.addEventListener("click", switchToAdvanced);

    // Wire up Enter key in input (Shift+Enter for newline)
    const input = document.getElementById("sm-input");
    if (input) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitMessage();
            }
        });
        input.focus();
    }
}

// Kick off when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
} else {
    bootstrap();
}
