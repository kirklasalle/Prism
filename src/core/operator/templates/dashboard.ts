export function dashboardHtml(port: number, authToken?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="${authToken ?? ""}" />
  <title>PRISM Frontier Console</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #07111f;
      --panel: rgba(7, 19, 36, 0.82);
      --panel-strong: rgba(10, 24, 45, 0.94);
      --border: rgba(148, 163, 184, 0.16);
      --text: #edf3ff;
      --muted: #98a6bc;
      --accent: #69d2ff;
      --accent-2: #7cf1c8;
      --danger: #ff8d8d;
      --shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Aptos, "Segoe UI Variable Text", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(105, 210, 255, 0.16), transparent 28%),
        radial-gradient(circle at top right, rgba(124, 241, 200, 0.12), transparent 24%),
        linear-gradient(180deg, #06101d 0%, #091728 44%, #07111f 100%);
    }
    button, textarea, select { font: inherit; }
    .app {
      display: grid;
      grid-template-columns: var(--sidebar-width, 340px) auto minmax(0, 1fr);
      gap: 0;
      padding: 18px;
      min-height: 100vh;
    }
    .resize-handle {
      width: 6px;
      cursor: col-resize;
      background: transparent;
      position: relative;
      z-index: 10;
      transition: background 0.15s;
    }
    .resize-handle:hover,
    .resize-handle.active {
      background: rgba(105, 210, 255, 0.25);
    }
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 2px;
      height: 32px;
      border-radius: 2px;
      background: rgba(148, 163, 184, 0.25);
      transition: background 0.15s, height 0.15s;
    }
    .resize-handle:hover::after,
    .resize-handle.active::after {
      background: rgba(105, 210, 255, 0.5);
      height: 48px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .sidebar {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: hidden;
      min-width: 200px;
    }
    .workspace {
      min-width: 0;
      display: flex;
      margin-left: 12px;
      flex-direction: column;
      gap: 14px;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px;
      border-radius: 18px;
      min-height: 68px;
      background: linear-gradient(180deg, rgba(9,17,31,0.92), rgba(9,17,31,0.84));
      border: 1px solid rgba(105,210,255,0.20);
      align-items: stretch;
    }
    .tab-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 1 1 180px;
      min-height: 46px;
      border: 1px solid rgba(148,163,184,0.28);
      border-radius: 12px;
      background: rgba(14, 25, 43, 0.92);
      color: var(--text);
      cursor: pointer;
      padding: 12px 14px;
      font-weight: 700;
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease, transform 0.14s ease;
    }
    .tab-button:hover {
      border-color: rgba(105,210,255,0.42);
      transform: translateY(-1px);
    }
    .tab-button:focus-visible {
      outline: 2px solid rgba(105,210,255,0.7);
      outline-offset: 2px;
    }
    .tab-button.active {
      color: #04111f;
      border-color: rgba(105,210,255,0.18);
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 10px 24px rgba(105,210,255,0.16);
    }
    .tab-panel { display: block; }
    body.js-ready .tab-panel { display: none; }
    body.js-ready .tab-panel.active { display: block; }
    .tab-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      align-items: start;
    }
    .brand {
      padding: 16px;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(105, 210, 255, 0.16), rgba(124, 241, 200, 0.08));
      border: 1px solid rgba(105, 210, 255, 0.18);
    }
    .eyebrow { color: var(--accent-2); font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }
    .brand h1 { margin: 8px 0 6px; font-size: 28px; }
    .muted { color: var(--muted); }
    .session-list { display: flex; flex-direction: column; gap: 10px; overflow: auto; }
    .session-card {
      width: 100%;
      text-align: left;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(148,163,184,0.12);
      color: var(--text);
      padding: 14px;
      border-radius: 16px;
      cursor: pointer;
    }
    .session-card.active { border-color: rgba(105, 210, 255, 0.48); background: rgba(105, 210, 255, 0.10); }
    .session-title { font-weight: 700; margin-bottom: 6px; }
    .session-preview { font-size: 12px; color: var(--muted); line-height: 1.45; }
    .session-meta { margin-top: 8px; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; gap: 10px; }
    .session-package-card {
      border: 1px solid rgba(124, 241, 200, 0.24);
      background: rgba(124, 241, 200, 0.05);
    }
    .session-package-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .session-package-badge {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent-2);
    }
    .pkg-status-badge {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 8px;
      padding: 2px 9px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      line-height: 1.6;
    }
    .pkg-status-badge.planned  { background: rgba(148,163,184,0.15); color: #94a3b8; }
    .pkg-status-badge.running  { background: rgba(105,210,255,0.20); color: #69d2ff; }
    .pkg-status-badge.blocked  { background: rgba(255,170,50,0.22);  color: #ffaa32; }
    .pkg-status-badge.complete { background: rgba(124,241,200,0.22); color: #7cf1c8; }
    .session-package-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .session-package-actions .secondary-button,
    .session-package-actions .primary-button,
    .session-package-actions .danger-button {
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 8px 12px;
      font-size: 12px;
    }
    .session-package-children {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-left: 10px;
      border-left: 1px solid rgba(148,163,184,0.22);
    }
    .session-card.session-chapter {
      padding: 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.01);
    }
    .primary-button, .secondary-button, .danger-button {
      border: none;
      border-radius: 14px;
      cursor: pointer;
      padding: 10px 14px;
      color: #04111f;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      font-weight: 700;
    }
    .secondary-button {
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border: 1px solid rgba(148,163,184,0.14);
    }
    .danger-button {
      color: #fff;
      background: rgba(255, 77, 77, 0.18);
      border: 1px solid rgba(255, 141, 141, 0.28);
    }
    .primary-button[disabled], .secondary-button[disabled], .danger-button[disabled] {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .chat {
      position: relative;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 118px);
      overflow: hidden;
    }
    .chat-header {
      flex-shrink: 0;
      padding: 22px 24px 16px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    }
    .chat-header h2 { margin: 8px 0 6px; font-size: 26px; }
    .header-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(148,163,184,0.12);
      color: var(--muted);
    }
    .messages {
      padding: 22px 24px 24px 24px;
      overflow-y: auto;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .message {
      max-width: 86%;
      padding: 16px 18px;
      border-radius: 22px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.user {
      margin-left: auto;
      background: linear-gradient(135deg, rgba(105, 210, 255, 0.18), rgba(105, 210, 255, 0.08));
      border: 1px solid rgba(105, 210, 255, 0.18);
    }
    .message.assistant {
      margin-right: auto;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(148,163,184,0.12);
    }
    .message-label { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
    .message-time { margin-top: 10px; font-size: 11px; color: var(--muted); }
    .empty-state {
      margin: auto;
      max-width: 520px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed rgba(148,163,184,0.18);
      border-radius: 22px;
      padding: 28px;
      background: rgba(255,255,255,0.02);
    }
    .composer {
      flex-shrink: 0;
      padding: 18px 24px 24px;
      border-top: 1px solid var(--border);
      background: rgba(10, 24, 45, 0.95);
      border-bottom-left-radius: var(--radius);
      border-bottom-right-radius: var(--radius);
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
      z-index: 10;
      backdrop-filter: blur(12px);
    }
    .composer-container {
      display: flex;
      flex-direction: column;
      border-radius: 24px;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(2, 8, 18, 0.7);
      padding: 0;
      transition: border-color 0.2s, box-shadow 0.2s;
      overflow: hidden;
    }
    .composer-container:focus-within {
      border-color: rgba(105, 210, 255, 0.45);
      box-shadow: 0 0 0 3px rgba(105, 210, 255, 0.08), 0 4px 24px rgba(0,0,0,0.3);
    }
    .composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px 10px;
      border-top: 1px solid rgba(148,163,184,0.06);
    }
    .composer-left-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .composer-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .composer-icon-btn:hover {
      background: rgba(105,210,255,0.1);
      color: var(--accent);
    }
    .composer-send-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: linear-gradient(135deg, #69d2ff 0%, #4fb8e8 50%, #7cf1c8 100%);
      color: #07111f;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
      box-shadow: 0 2px 12px rgba(105,210,255,0.3);
      flex-shrink: 0;
    }
    .composer-send-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 4px 20px rgba(105,210,255,0.45);
    }
    .composer-send-btn:active {
      transform: scale(0.95);
    }
    .composer-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    .attachment-preview-strip {
      display: flex;
      gap: 8px;
      padding: 0 4px;
      flex-wrap: wrap;
    }
    .attachment-preview-strip:empty { display: none; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: rgba(105,210,255,0.08);
      border: 1px solid rgba(105,210,255,0.24);
      border-radius: 12px;
      font-size: 12px;
      color: var(--accent);
    }
    .attachment-chip .remove-btn {
      cursor: pointer;
      opacity: 0.6;
      font-size: 14px;
    }
    .attachment-chip .remove-btn:hover { opacity: 1; }
    .message pre {
      background: rgba(2,8,18,0.8);
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 8px;
      padding: 12px 14px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
      margin: 8px 0;
    }
    .message code {
      background: rgba(148,163,184,0.1);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }
    .message pre code {
      background: none;
      padding: 0;
    }
    .message p { margin: 6px 0; }
    .message ul, .message ol { margin: 6px 0; padding-left: 24px; }
    .message li { margin: 2px 0; }
    .message h1, .message h2, .message h3, .message h4 {
      margin: 12px 0 6px;
      font-weight: 600;
    }
    .message a { color: var(--accent); text-decoration: underline; }
    .message blockquote {
      border-left: 3px solid var(--accent);
      margin: 8px 0;
      padding: 4px 12px;
      opacity: 0.85;
    }
    .message table { border-collapse: collapse; margin: 8px 0; width: 100%; }
    .message th, .message td { border: 1px solid rgba(148,163,184,0.2); padding: 6px 10px; text-align: left; }
    .message th { background: rgba(148,163,184,0.06); font-weight: 600; }
    .tool-block {
      margin: 8px 0;
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 8px;
      overflow: hidden;
    }
    .tool-block-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(148,163,184,0.06);
      cursor: pointer;
      font-size: 13px;
      user-select: none;
    }
    .tool-block-header:hover { background: rgba(148,163,184,0.1); }
    .tool-block-icon { font-size: 14px; }
    .tool-block-name { font-weight: 600; color: var(--accent); }
    .tool-block-status { margin-left: auto; font-size: 12px; }
    .tool-block-status.ok { color: #4caf50; }
    .tool-block-status.fail { color: #f44336; }
    .tool-block-body {
      padding: 10px 12px;
      font-size: 12px;
      max-height: 200px;
      overflow-y: auto;
      display: none;
      background: rgba(2,8,18,0.5);
    }
    .tool-block.expanded .tool-block-body { display: block; }
    .streaming-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 1s infinite;
      margin-left: 6px;
    }
    .thinking-badge {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(105,210,255,0.12);
      color: var(--accent);
      animation: thinking-fade 1.4s ease-in-out infinite;
      vertical-align: middle;
    }
    .thinking-dots {
      display: flex;
      gap: 6px;
      padding: 6px 0 2px;
      align-items: center;
    }
    .thinking-dots span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.3;
      animation: dot-bounce 1.4s ease-in-out infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dot-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
      30% { transform: translateY(-6px); opacity: 1; }
    }
    @keyframes thinking-fade {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }
    @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    .message .attachment-inline {
      margin: 6px 0;
      display: inline-block;
    }
    .message .attachment-inline img {
      max-width: 300px;
      max-height: 200px;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.2);
    }
    .message .attachment-inline .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(148,163,184,0.06);
      border: 1px solid rgba(148,163,184,0.15);
      border-radius: 8px;
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
    }
    textarea {
      width: 100%;
      min-height: 48px;
      max-height: 240px;
      resize: none;
      border-radius: 0;
      padding: 16px 18px 8px;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 15px;
      line-height: 1.5;
      outline: none;
    }
    textarea::placeholder {
      color: rgba(148,163,184,0.5);
    }
    textarea:focus { outline: none; }
    .control-select {
      width: 100%;
      text-align: left;
      border-radius: 14px;
      padding: 10px 14px;
      border: 1px solid rgba(148,163,184,0.18);
      background: rgba(6, 16, 29, 0.96);
      color: var(--text);
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }
    .control-select:focus {
      outline: 1px solid rgba(105, 210, 255, 0.42);
      border-color: rgba(105, 210, 255, 0.34);
    }
    .control-select option,
    .control-select optgroup {
      background: #0b1728;
      color: var(--text);
    }
    select option, select optgroup { background: #0b1728; color: var(--text); }
    .composer-hint {
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
      text-align: center;
      opacity: 0.7;
    }
    .composer-hint kbd {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(148,163,184,0.2);
      background: rgba(148,163,184,0.06);
      font-family: inherit;
      font-size: 11px;
      color: var(--muted);
    }
    .rail-section {
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 18px;
      padding: 16px;
      background: rgba(255,255,255,0.03);
    }
    .rail-section h3 { margin: 0 0 12px; font-size: 15px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .metric { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      border: 1px solid rgba(148,163,184,0.14);
      color: var(--muted);
    }
    .badge-running { color: #8dd8ff; border-color: rgba(105,210,255,0.34); }
    .badge-succeeded { color: #8ff3c8; border-color: rgba(124,241,200,0.30); }
    .badge-failed { color: #ff9f9f; border-color: rgba(255,141,141,0.30); }
    .action-card, .approval-card {
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 16px;
      padding: 14px;
      background: rgba(255,255,255,0.025);
    }
    .action-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 8px; }
    .action-buttons { display: flex; gap: 8px; margin-top: 12px; }
    .history-table, .events-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .history-table th, .history-table td, .events-table th, .events-table td {
      text-align: left;
      padding: 8px 0;
      border-bottom: 1px solid rgba(148,163,184,0.10);
      vertical-align: top;
    }
    .notice {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(255, 141, 141, 0.10);
      border: 1px solid rgba(255, 141, 141, 0.18);
      color: #ffc1c1;
      font-size: 12px;
    }
    .onboarding {
      margin: 0 0 12px;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(148,163,184,0.16);
      background: rgba(255,255,255,0.03);
      flex-shrink: 0;
    }
    .onboarding:empty {
      display: none;
    }
    .onboarding-title {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .onboarding-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .onboarding-list .passed {
      color: var(--accent-2);
    }
    .onboarding-list .failed {
      color: #ffc1c1;
    }
    .mono { font-family: "Cascadia Code", Consolas, monospace; }
    .collapsible-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; padding: 0; margin: 0; }
    .collapsible-header:hover { opacity: 0.85; }
    .collapsible-header h3 { margin: 0; }
    .collapse-chevron { font-size: 14px; color: var(--muted); transition: transform 0.2s ease; margin-left: 8px; }
    .collapsible-body { overflow: hidden; }
    .collapsible-body.collapsed { display: none; }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .settings-item { display: flex; flex-direction: column; gap: 2px; }
    .settings-item-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .settings-item-value { font-size: 13px; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; word-break: break-all; }
    .stg-section { margin-bottom: 16px; border: 1px solid rgba(148,163,184,0.10); border-radius: 12px; background: rgba(255,255,255,0.015); overflow: hidden; }
    .stg-section-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--accent-2); }
    .stg-section-header:hover { background: rgba(255,255,255,0.025); }
    .stg-section-body { padding: 0 14px 14px; }
    .stg-section-body.stg-collapsed { display: none; }
    .stg-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(148,163,184,0.06); gap: 12px; }
    .stg-row:last-child { border-bottom: none; }
    .stg-label { font-size: 12px; color: var(--fg); flex: 1; }
    .stg-hint { font-size: 10px; color: var(--muted); font-family: "Cascadia Code", Consolas, monospace; margin-left: 6px; }
    .stg-value { font-size: 12px; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; text-align: right; max-width: 55%; word-break: break-all; }
    .stg-input { padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; font-family: "Cascadia Code", Consolas, monospace; width: 120px; text-align: right; }
    .stg-input:focus { outline: none; border-color: var(--accent); }
    .stg-select { padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.18); background: #0b1728; color: var(--fg); font-size: 12px; cursor: pointer; }
    .stg-select:focus { outline: none; border-color: var(--accent); }
    .stg-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .stg-badge-green { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .stg-badge-blue { background: rgba(105,210,255,0.15); color: #69d2ff; }
    .stg-badge-amber { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .stg-badge-red { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .stg-badge-muted { background: rgba(148,163,184,0.10); color: var(--muted); }
    .stg-save-btn { padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(126,207,126,0.3); background: rgba(126,207,126,0.1); color: #7ecf7e; font-size: 11px; font-weight: 600; cursor: pointer; margin-left: 6px; }
    .stg-save-btn:hover { background: rgba(126,207,126,0.2); }
    .stg-recheck-btn { padding: 5px 14px; border-radius: 8px; border: 1px solid rgba(105,210,255,0.3); background: rgba(105,210,255,0.08); color: #69d2ff; font-size: 11px; font-weight: 600; cursor: pointer; }
    .stg-recheck-btn:hover { background: rgba(105,210,255,0.18); }
    .stg-req-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
    .stg-req-met { color: #7ecf7e; }
    .stg-req-unmet { color: #ff8d8d; }
    .ps-card { border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; background: rgba(255,255,255,0.02); overflow: hidden; margin-bottom: 8px; }
    .ps-card-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; gap: 10px; }
    .ps-card-header:hover { background: rgba(255,255,255,0.03); }
    .ps-card-title { font-weight: 600; font-size: 13px; }
    .ps-card-badges { display: flex; gap: 6px; align-items: center; }
    .ps-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .ps-badge-ok { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .ps-badge-warn { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .ps-badge-off { background: rgba(148,163,184,0.10); color: var(--muted); }
    .ps-badge-local { background: rgba(80,160,255,0.10); color: #7eb8ff; }
    .ps-badge-remote { background: rgba(200,160,255,0.10); color: #c8a0ff; }
    .ps-card-body { padding: 0 16px 16px; border-top: 1px solid rgba(148,163,184,0.08); }
    .ps-field { margin-top: 10px; }
    .ps-field label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
    .ps-field input, .ps-field textarea { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; font-family: inherit; box-sizing: border-box; }
    .ps-field input:focus, .ps-field textarea:focus { outline: none; border-color: var(--accent); }
    .ps-key-row { display: flex; gap: 8px; align-items: center; }
    .ps-key-row input { flex: 1; }
    .ps-test-result { margin-top: 8px; font-size: 12px; padding: 6px 10px; border-radius: 8px; }
    .ps-test-ok { background: rgba(126,207,126,0.10); color: #7ecf7e; }
    .ps-test-fail { background: rgba(255,141,141,0.10); color: #ffc1c1; }
    @media (max-width: 1280px) {
      .app { grid-template-columns: var(--sidebar-width, 310px) auto minmax(0, 1fr); }
      .tab-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr !important; }
      .resize-handle { display: none; }
      .chat { min-height: auto; }
      .sidebar { order: 2; min-width: unset; }
      .workspace { margin-left: 0; }
      .tabs { gap: 8px; }
      .tab-button { flex-basis: calc(50% - 4px); }
    }
    [data-tooltip] { position: relative; }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 12px;
      background: rgba(15,20,35,0.95);
      color: #e2e8f0;
      font-size: 11px;
      line-height: 1.5;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.18);
      white-space: pre-line;
      max-width: 320px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 9999;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      backdrop-filter: blur(8px);
    }
    [data-tooltip]:hover::after { opacity: 1; }
    .tp-card { border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; background: rgba(255,255,255,0.02); margin-bottom: 6px; overflow: hidden; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .tp-card:hover { border-color: rgba(148,163,184,0.22); }
    .tp-card.tp-expanded { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 4px 16px rgba(0,0,0,0.15); }
    .tp-card-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; cursor: pointer; gap: 8px; user-select: none; }
    .tp-card-head:hover { background: rgba(255,255,255,0.03); }
    .tp-card-name { font-weight: 600; font-size: 13px; }
    .tp-card-desc { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .tp-card-badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
    .tp-card-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
    .tp-meta-tag { font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 3px; }
    .tp-card-body { padding: 0 14px 14px; border-top: 1px solid rgba(148,163,184,0.08); display: none; }
    .tp-card.tp-expanded .tp-card-body { display: block; }
    .tp-section { margin-top: 12px; }
    .tp-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .tp-controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .tp-toggle { position: relative; display: inline-flex; align-items: center; cursor: pointer; gap: 8px; font-size: 12px; color: var(--fg); }
    .tp-toggle input { display: none; }
    .tp-toggle-track { width: 34px; height: 18px; border-radius: 9px; background: rgba(148,163,184,0.25); transition: background 0.2s ease; position: relative; flex-shrink: 0; }
    .tp-toggle input:checked + .tp-toggle-track { background: var(--accent); }
    .tp-toggle-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; }
    .tp-toggle input:checked + .tp-toggle-track::after { transform: translateX(16px); }
    .tp-stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; }
    .tp-stat { display: flex; flex-direction: column; gap: 1px; min-width: 80px; }
    .tp-stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .tp-stat-value { font-size: 14px; font-weight: 600; color: var(--fg); font-family: "Cascadia Code", Consolas, monospace; }
    .tp-review-stars { display: inline-flex; gap: 2px; cursor: pointer; }
    .tp-star { font-size: 16px; color: rgba(148,163,184,0.25); transition: color 0.15s; }
    .tp-star.active { color: #ffd17a; }
    .tp-star:hover { color: #ffd17a; }
    .tp-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .tp-status-dot.green { background: #7ecf7e; box-shadow: 0 0 4px rgba(126,207,126,0.5); }
    .tp-status-dot.yellow { background: #ffd17a; box-shadow: 0 0 4px rgba(255,209,122,0.5); }
    .tp-status-dot.red { background: #ff8d8d; box-shadow: 0 0 4px rgba(255,141,141,0.5); }
    .tp-approval-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .tp-approval-approved { background: rgba(126,207,126,0.15); color: #7ecf7e; }
    .tp-approval-review { background: rgba(255,200,80,0.12); color: #ffd17a; }
    .tp-approval-flagged { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .tp-approval-blocked { background: rgba(148,163,184,0.15); color: var(--muted); }
    .tp-overview-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(148,163,184,0.10); margin-bottom: 12px; flex-wrap: wrap; }
    .tp-overview-stat { font-size: 12px; color: var(--fg); font-weight: 600; }
    .tp-overview-stat .muted { font-weight: 400; }
    .tp-filter-input { padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.18); background: rgba(0,0,0,0.25); color: var(--fg); font-size: 12px; min-width: 160px; }
    .tp-filter-input:focus { outline: none; border-color: var(--accent); }
    .tp-filter-input::placeholder { color: var(--muted); }
    .brand-profile-badge { display: inline-block; padding: 4px 14px; border-radius: 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 8px; }
    .brand-profile-badge.individual { background: rgba(105,210,255,0.18); color: #69d2ff; }
    .brand-profile-badge.business { background: rgba(168,130,255,0.18); color: #c9a0ff; }
    .brand-profile-badge.demo { background: rgba(255,200,80,0.18); color: #ffd17a; }
    .brand-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 10px; }
    .brand-info-item { font-size: 11px; }
    .brand-info-label { color: var(--muted); font-weight: 400; }
    .brand-info-value { color: var(--fg); font-weight: 600; }
    .brand-env-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 4px; vertical-align: middle; }
    .brand-env-dot.dev { background: #69d2ff; }
    .brand-env-dot.staging { background: #ffd17a; }
    .brand-env-dot.prod { background: #7ecf7e; }
    .brand-approvals-badge { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 8px; font-size: 10px; font-weight: 600; background: rgba(255,200,80,0.15); color: #ffd17a; }
    .usage-bar { position: relative; height: 22px; border-radius: 6px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); overflow: hidden; }
    .usage-bar-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: 5px; transition: width 0.6s ease; }
    .usage-bar-fill.ram { background: linear-gradient(90deg, #69d2ff 0%, #3b82f6 100%); box-shadow: 0 0 8px rgba(105,210,255,0.3); }
    .usage-bar-fill.vram { background: linear-gradient(90deg, #7cf1c8 0%, #10b981 100%); box-shadow: 0 0 8px rgba(124,241,200,0.3); }
    .usage-bar-label { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); pointer-events: none; }
    .sparkline-wrap { display: inline-block; vertical-align: middle; }
    .gpu-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(124,241,200,0.12); color: #7cf1c8; margin-left: 6px; }
    .framebuffer-viewer { position: relative; background: #0a0e17; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .framebuffer-viewer img { max-width: 100%; max-height: 480px; object-fit: contain; display: block; }
    .framebuffer-viewer .fb-placeholder { color: var(--muted); font-size: 13px; text-align: center; padding: 40px; }
    .framebuffer-controls { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
    .framebuffer-controls button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-controls button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-controls .fb-toggle-active { background: rgba(124,241,200,0.15); border-color: #7cf1c8; color: #7cf1c8; }
    .framebuffer-gallery { display: flex; gap: 8px; overflow-x: auto; padding: 10px 0 4px; }
    .framebuffer-gallery-path { font-family: monospace; font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 460px; }
    .framebuffer-selection-summary { font-size: 11px; color: var(--muted); padding: 4px 0 2px; min-height: 18px; }
    .framebuffer-gallery-controls { display: flex; gap: 6px; padding: 6px 0 2px; flex-wrap: wrap; }
    .framebuffer-gallery-controls button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-gallery-controls button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-media-bar { display: none; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(10,14,23,0.85); border: 1px solid var(--border); border-top: none; border-radius: 0 0 6px 6px; flex-wrap: wrap; }
    .framebuffer-media-bar button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 11px; transition: background 0.15s, border-color 0.15s; }
    .framebuffer-media-bar button:hover { background: rgba(124,241,200,0.08); border-color: var(--accent); }
    .framebuffer-media-bar button.active { background: rgba(124,241,200,0.15); border-color: #7cf1c8; color: #7cf1c8; }
    .framebuffer-media-bar .fb-media-spacer { flex: 1; }
    .framebuffer-media-bar .fb-media-label { font-size: 10px; color: var(--muted); }
    .framebuffer-viewer video { max-width: 100%; max-height: 480px; object-fit: contain; display: none; cursor: pointer; background: #000; }
    .framebuffer-thumb { width: 80px; height: 50px; object-fit: cover; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; opacity: 0.7; transition: opacity 0.15s, border-color 0.15s; flex-shrink: 0; }
    .framebuffer-thumb:hover { opacity: 1; border-color: var(--accent); }
    .framebuffer-meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
    .framebuffer-item { display: flex; flex-direction: column; width: 120px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; cursor: pointer; background: var(--surface); transition: border-color 0.15s, box-shadow 0.15s; }
    .framebuffer-item:hover { border-color: var(--accent); box-shadow: 0 0 8px rgba(124,241,200,0.12); }
    .framebuffer-item.selected { border-color: #7cf1c8; box-shadow: 0 0 12px rgba(124,241,200,0.25); }
    .framebuffer-item-poster { position: relative; width: 100%; height: 70px; background: #0a0e17; overflow: hidden; }
    .framebuffer-item-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .framebuffer-item-badge { position: absolute; top: 3px; right: 3px; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.7); color: #94a3b8; letter-spacing: 0.04em; }
    .framebuffer-item-badge.burst { background: rgba(124,241,200,0.2); color: #7cf1c8; }
    .framebuffer-item-body { padding: 4px 6px 5px; }
    .framebuffer-item-kind { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .framebuffer-item-kind.burst { color: #7cf1c8; }
    .framebuffer-item-title { font-size: 10px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; margin-top: 1px; }
    .framebuffer-item-subtitle { font-size: 9px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    .log-line { display: flex; align-items: baseline; gap: 8px; padding: 3px 8px; font-size: 11px; font-family: "Cascadia Code", Consolas, monospace; border-bottom: 1px solid rgba(148,163,184,0.06); }
    .log-line:hover { background: rgba(255,255,255,0.02); }
    .log-ts { color: var(--muted); font-size: 10px; flex-shrink: 0; min-width: 72px; }
    .log-src { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
    .log-src-diagnostics { background: rgba(105,210,255,0.12); color: #69d2ff; }
    .log-src-agent-diagnostics { background: rgba(168,130,255,0.12); color: #a882ff; }
    .log-src-computer-diagnostics { background: rgba(124,241,200,0.12); color: #7cf1c8; }
    .log-src-tools { background: rgba(255,209,122,0.12); color: #ffd17a; }
    .log-src-browser { background: rgba(105,210,255,0.12); color: #69d2ff; }
    .log-src-chat { background: rgba(148,163,184,0.12); color: #94a3b8; }
    .log-src-agentic { background: rgba(168,130,255,0.12); color: #a882ff; }
    .log-src-settings { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-src-computer { background: rgba(124,241,200,0.12); color: #7cf1c8; }
    .log-src-workspace { background: rgba(255,209,122,0.1); color: #ffd17a; }
    .log-src-scheduler { background: rgba(255,157,122,0.12); color: #ff9d7a; }
    .log-src-hardware { background: rgba(255,141,141,0.12); color: #ff8d8d; }
    .log-src-system { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-sev { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
    .log-sev-info { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .log-sev-warn { background: rgba(255,209,122,0.15); color: #ffd17a; }
    .log-sev-error { background: rgba(255,141,141,0.15); color: #ff8d8d; }
    .log-msg { color: var(--fg); word-break: break-word; flex: 1; min-width: 0; }
    .log-empty { text-align: center; padding: 24px; color: var(--muted); font-size: 12px; }
    .log-filter-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
    .log-filter-bar select { background: var(--surface); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 11px; font-family: inherit; cursor: pointer; }
    .log-filter-bar select:focus { outline: none; border-color: var(--accent); }
  </style>
</head>
<body>
  <div class="app" id="app">
    <aside class="sidebar panel" id="sidebar">
      <div class="brand" id="brand-panel">
        <div class="eyebrow">Frontier Operator Console</div>
        <h1>PRISM Chat</h1>
        <a href="http://localhost:${port}" target="_blank" rel="noopener" class="muted" style="display:block;margin-top:0;text-decoration:none;color:var(--muted);transition:color 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">http://localhost:${port} \u2197</a>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <button class="secondary-button" onclick="exportSession()" style="flex:1;">Export Session</button>
        <button class="secondary-button" onclick="importSession()" style="flex:1;">Import Session</button>
      </div>
      <button class="secondary-button" onclick="packageSessions()">Package Sessions</button>
      <button class="primary-button" onclick="createSession()">New Session</button>
      <button class="secondary-button" onclick="window.location.href='/setup?rerun=true'" style="font-size:11px;opacity:0.75;margin-top:2px;" title="Re-run the guided setup wizard">\u2728 Setup Wizard</button>
      <div id="session-list" class="session-list"></div>
    </aside>
    <div class="resize-handle" id="resize-handle"></div>

    <main class="workspace">
      <section class="tabs panel" id="tabs" role="tablist" aria-label="Dashboard sections">
        <button id="tab-button-chat" type="button" class="tab-button active" data-tab-id="chat" role="tab" aria-selected="true" aria-controls="tab-chat" tabindex="0" onclick="setActiveTab(this.dataset.tabId)">Chat Interface</button>
        <button id="tab-button-settings" type="button" class="tab-button" data-tab-id="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Provider &amp; Settings</button>
        <button id="tab-button-tools" type="button" class="tab-button" data-tab-id="tools" role="tab" aria-selected="false" aria-controls="tab-tools" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Tools &amp; Plugins</button>
        <button id="tab-button-agentic" type="button" class="tab-button" data-tab-id="agentic" role="tab" aria-selected="false" aria-controls="tab-agentic" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Agentic Control</button>
        <button id="tab-button-computer" type="button" class="tab-button" data-tab-id="computer" role="tab" aria-selected="false" aria-controls="tab-computer" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Computer Control</button>
        <button id="tab-button-browser" type="button" class="tab-button" data-tab-id="browser" role="tab" aria-selected="false" aria-controls="tab-browser" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Browser Control</button>
        <button id="tab-button-workspace" type="button" class="tab-button" data-tab-id="workspace" role="tab" aria-selected="false" aria-controls="tab-workspace" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Workspace</button>
        <button id="tab-button-network" type="button" class="tab-button" data-tab-id="network" role="tab" aria-selected="false" aria-controls="tab-network" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Network</button>
        <button id="tab-button-telemetry" type="button" class="tab-button" data-tab-id="telemetry" role="tab" aria-selected="false" aria-controls="tab-telemetry" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Telemetry</button>
        <button id="tab-button-logs" type="button" class="tab-button" data-tab-id="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Logs &amp; Debug</button>
        <button id="tab-button-scheduler" type="button" class="tab-button" data-tab-id="scheduler" role="tab" aria-selected="false" aria-controls="tab-scheduler" tabindex="-1" onclick="setActiveTab(this.dataset.tabId)">Scheduler</button>
        <span id="prism-ws-status" title="WebSocket connected" style="width:10px;height:10px;border-radius:50%;background:#22c55e;align-self:center;margin-left:auto;flex:0 0 10px;box-shadow:0 0 6px rgba(34,197,94,0.5);transition:background 0.3s;"></span>
      </section>

      <section id="tab-chat" class="tab-panel active" role="tabpanel" aria-labelledby="tab-button-chat" aria-hidden="false">
        <div class="chat panel">
          <div class="chat-header">
            <h2 id="active-session-title">Loading...</h2>
            <div id="active-session-meta" class="muted"></div>
            <div id="header-chips" class="header-chips" style="margin-top:12px;"></div>
          </div>
          <section id="messages" class="messages"></section>
          <div class="composer">
            <div id="onboarding" class="onboarding"></div>
            <div id="attachment-preview" class="attachment-preview-strip"></div>
            <div class="composer-container">
              <textarea id="composer" placeholder="Ask PRISM anything..." rows="1" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,240)+'px'"></textarea>
              <div class="composer-actions">
                <div class="composer-left-actions">
                  <button type="button" class="composer-icon-btn" onclick="document.getElementById('file-attach-input').click()" title="Attach file">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  </button>
                  <input type="file" id="file-attach-input" multiple accept="image/*,audio/*,video/*,text/*,application/pdf,.md,.json,.csv,.xml,.yaml,.yml,.ts,.js,.py,.html,.css" style="display:none" onchange="handleFileSelect(this)" />
                  <button type="button" class="composer-icon-btn" onclick="pasteFromClipboard()" title="Paste from clipboard">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
                <button id="send-button" class="composer-send-btn" onclick="sendMessage()" title="Send message (Enter)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
                </button>
              </div>
            </div>
            <div class="composer-hint"><kbd>Enter</kbd> to send &middot; <kbd>Shift+Enter</kbd> for new line &middot; Drag &amp; drop files to attach</div>
          </div>
        </div>
      </section>

      <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-settings" aria-hidden="true">
        <div class="tab-grid" style="grid-template-columns:1fr;">

          <section class="rail-section panel" id="sr-section" style="border:1px solid rgba(139,92,246,0.25);background:linear-gradient(135deg,rgba(139,92,246,0.06),rgba(59,130,246,0.04));">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 0 8px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;">🌈</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#a78bfa;">Prism SR:</div>
                  <div style="font-size:11px;color:var(--fg-muted);">Compounding model orchestration — Logic + Creative + Main model synthesis</div>
                </div>
              </div>
              <button class="btn btn-primary" onclick="toggleSRPanel()" style="background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;font-weight:600;font-size:12px;padding:6px 16px;border-radius:6px;cursor:pointer;color:#fff;">
                Spectrum Refraction
              </button>
            </div>
            <div id="sr-panel" style="display:none;">
              <div id="sr-panel-content" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('sessionProvider')">
              <h3>Session Provider Assignment</h3>
              <span class="collapse-chevron" id="chevron-sessionProvider">▼</span>
            </div>
            <div class="collapsible-body" id="body-sessionProvider">
              <div id="llm-provider" class="stack"></div>
            </div>
          </section>
          
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('modelRouting')">
              <h3>🔀 Model Routing</h3>
              <span class="collapse-chevron" id="chevron-modelRouting">▶</span>
            </div>
            <div class="collapsible-body collapsed" id="body-modelRouting">
              <div class="muted" style="margin-bottom:8px;">Configure how PRISM routes tasks to models. Single-provider uses the active provider for all roles. Multi-provider enables per-role and per-agent model assignment.</div>
              <div id="model-routing-container" class="stack"></div>
            </div>
          </section>

          <div id="provider-matrix-row" style="display: flex; align-items: stretch; gap: 0; min-width: 0;">
            <section id="provider-config-panel" class="rail-section panel" style="flex: 0 0 50%; min-width: 200px; overflow: hidden; box-sizing: border-box;">
              <div class="collapsible-header" onclick="togglePanelCollapse('providerConfig')">
                <h3>Provider Configuration</h3>
                <span class="collapse-chevron" id="chevron-providerConfig">▶</span>
              </div>
              <div class="collapsible-body collapsed" id="body-providerConfig">
                <div class="muted" style="margin-bottom:12px;">Configure API keys and settings for each provider. Expand a card to manage.</div>
                <div id="provider-cards-container" class="stack"></div>
              </div>
              <div id="providerConfig-summary" style="padding:8px 12px;"></div>
            </section>
            <div id="provider-matrix-divider" title="Drag to resize" style="width:8px;cursor:col-resize;flex-shrink:0;position:relative;user-select:none;z-index:1;">
              <div style="position:absolute;top:8%;bottom:8%;left:50%;transform:translateX(-50%);width:2px;background:rgba(148,163,184,0.15);border-radius:2px;pointer-events:none;"></div>
            </div>
            <section id="model-matrix-panel" class="rail-section panel" style="flex: 1 1 0; min-width: 200px; overflow: hidden; box-sizing: border-box;">
              <div class="collapsible-header" onclick="togglePanelCollapse('modelMatrix')">
                <h3>Model Capability Matrix</h3>
                <span class="collapse-chevron" id="chevron-modelMatrix">▼</span>
              </div>
              <div class="collapsible-body" id="body-modelMatrix">
                <div class="muted" style="margin-bottom:8px;">Available models scored by capability tier (T1 Minimal → T5 Frontier). Role routing selects the best model for each task.</div>
                <div id="capability-matrix" class="stack"></div>
              </div>
            </section>
          </div>

          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('settingsPanel')">
              <h3>Settings</h3>
              <span class="collapse-chevron" id="chevron-settingsPanel">▼</span>
            </div>
            <div class="collapsible-body" id="body-settingsPanel">
              <div id="settings-panel" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('llmAudit')">
              <h3>LLM Audit Trail</h3>
              <span class="collapse-chevron" id="chevron-llmAudit">▼</span>
            </div>
            <div class="collapsible-body" id="body-llmAudit">
              <div id="llm-audit"></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-tools" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-tools" aria-hidden="true">
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div id="tools-overview-bar"></div>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('pluginsPanel')">
              <h3>🧩 Plugins</h3>
              <span class="tp-panel-summary" id="pluginsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-pluginsPanel">▶</span>
            </div>
            <div class="collapsible-body collapsed" id="body-pluginsPanel">
              <div id="plugins-panel" class="stack"></div>
            </div>
          </section>
          <div class="tp-split-row">
            <section class="rail-section panel tp-split-col">
              <div class="collapsible-header" onclick="togglePanelCollapse('toolsPanel')">
                <h3>🛠️ Tools</h3>
                <span class="tp-panel-summary" id="toolsPanel-summary" style="display:none;"></span>
                <span class="collapse-chevron" id="chevron-toolsPanel">▶</span>
              </div>
              <div class="collapsible-body collapsed" id="body-toolsPanel">
                <div id="tools-panel" class="stack"></div>
              </div>
            </section>
            <section class="rail-section panel tp-split-col">
              <div class="collapsible-header" onclick="togglePanelCollapse('utilitiesPanel')">
                <h3>⚙️ Utilities</h3>
                <span class="tp-panel-summary" id="utilitiesPanel-summary" style="display:none;"></span>
                <span class="collapse-chevron" id="chevron-utilitiesPanel">▶</span>
              </div>
              <div class="collapsible-body collapsed" id="body-utilitiesPanel">
                <div id="utilities-panel" class="stack"></div>
              </div>
            </section>
          </div>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('diagnosticsPanel')">
              <h3>🧪 Diagnostics</h3>
              <span class="tp-panel-summary" id="diagnosticsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-diagnosticsPanel">▶</span>
            </div>
            <div class="collapsible-body collapsed" id="body-diagnosticsPanel">
              <div id="diagnostics-panel" class="stack"></div>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('agentDiagnosticsPanel')">
                  <h3>🤖 Agent Diagnostics</h3>
                  <span class="tp-panel-summary" id="agentDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-agentDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-agentDiagnosticsPanel">
                  <div id="agent-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('computerDiagnosticsPanel')">
                  <h3>🖥️ Computer Diagnostics</h3>
                  <span class="tp-panel-summary" id="computerDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-computerDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-computerDiagnosticsPanel">
                  <div id="computer-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('workspaceDiagnosticsPanel')">
                  <h3>📂 Workspace Diagnostics</h3>
                  <span class="tp-panel-summary" id="workspaceDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-workspaceDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-workspaceDiagnosticsPanel">
                  <div id="workspace-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('networkDiagnosticsPanel')">
                  <h3>🌐 Network Diagnostics</h3>
                  <span class="tp-panel-summary" id="networkDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-networkDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-networkDiagnosticsPanel">
                  <div id="network-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('telemetryDiagnosticsPanel')">
                  <h3>📊 Telemetry Diagnostics</h3>
                  <span class="tp-panel-summary" id="telemetryDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-telemetryDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-telemetryDiagnosticsPanel">
                  <div id="telemetry-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('logsDiagnosticsPanel')">
                  <h3>📝 Logs & Debug Diagnostics</h3>
                  <span class="tp-panel-summary" id="logsDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-logsDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-logsDiagnosticsPanel">
                  <div id="logs-diagnostics-panel" class="stack"></div>
                </div>
              </section>
              <section class="rail-section panel" style="margin-top:8px;">
                <div class="collapsible-header" onclick="togglePanelCollapse('schedulerDiagnosticsPanel')">
                  <h3>📅 Scheduler Diagnostics</h3>
                  <span class="tp-panel-summary" id="schedulerDiagnosticsPanel-summary" style="display:none;"></span>
                  <span class="collapse-chevron" id="chevron-schedulerDiagnosticsPanel">▶</span>
                </div>
                <div class="collapsible-body collapsed" id="body-schedulerDiagnosticsPanel">
                  <div id="scheduler-diagnostics-panel" class="stack"></div>
                </div>
              </section>
            </div>
          </section>
          <section class="rail-section panel">
            <div class="collapsible-header" onclick="togglePanelCollapse('demoDiagnosticsPanel')">
              <h3>🎬 Demo Scenarios</h3>
              <span class="tp-panel-summary" id="demoDiagnosticsPanel-summary" style="display:none;"></span>
              <span class="collapse-chevron" id="chevron-demoDiagnosticsPanel">▶</span>
            </div>
            <div class="collapsible-body collapsed" id="body-demoDiagnosticsPanel">
              <div id="demo-diagnostics-panel" class="stack"></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-agentic" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-agentic" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;border:1px solid var(--accent);border-radius:8px;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('guardianAgent')">
              <h3>🧬 Guardian Agent (llama.cpp)</h3>
              <span id="guardianAgent-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="guardianAgent-collapsible" class="collapsible-body">
              <div id="guardian-panel-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Loading Guardian status…</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('agentMgmt')">
              <h3>🤖 Agent Management</h3>
              <span id="agentMgmt-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="agentMgmt-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">List, start, stop, and monitor individual agents.</div>
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="primary-button" onclick="refreshAgentList()" style="font-size:12px;">🔄 Refresh Agents</button>
                <button class="primary-button" onclick="launchNewAgent()" style="font-size:12px;">➕ Launch Agent</button>
              </div>
              <div id="agent-list-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">No agents running. Launch an agent to get started.</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('subAgent')">
              <h3>🔗 Sub-Agent Control</h3>
              <span id="subAgent-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="subAgent-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">View agent hierarchy, parent-child relationships, and delegation chains.</div>
              <div id="sub-agent-tree-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Agent hierarchy will appear here when agents are active.</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('swarmControl')">
              <h3>🐝 Swarm Control</h3>
              <span id="swarmControl-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="swarmControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Orchestrate agent swarms — topology, scaling, and task distribution.</div>
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="primary-button" onclick="createSwarm()" style="font-size:12px;">🐝 Create Swarm</button>
                <button class="primary-button" onclick="refreshSwarmStatus()" style="font-size:12px;">🔄 Refresh Status</button>
              </div>
              <div id="swarm-topology-container" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">No swarms configured. Create a swarm to begin orchestration.</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('hardwareSwarm')">
              <h3>⚡ Local Hardware Swarm</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="secondary-button" style="font-size:12px;" onclick="if(window.refreshHardwareSwarm) window.refreshHardwareSwarm()">🔄 Refresh</button>
                <span id="hardwareSwarm-collapse-icon" class="collapse-icon">▼</span>
              </div>
            </div>
            <div id="hardwareSwarm-collapsible" class="collapsible-body">
              <div id="hardware-swarm-panel" class="stack" style="margin-top:10px;">
                <div class="muted" style="text-align:center;padding:24px;">Loading swarm status...</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('agentTelemetry')">
              <h3>📊 Agent Telemetry</h3>
              <span id="agentTelemetry-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="agentTelemetry-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Agent performance metrics, task throughput, and error rates.</div>
              <div id="agent-telemetry-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Active Agents</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Tasks Completed</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Error Rate</div><div style="font-size:24px;font-weight:700;color:var(--accent);">0%</div></div>
                  <div class="panel" style="text-align:center;padding:16px;"><div class="muted" style="font-size:11px;">Avg Response</div><div style="font-size:24px;font-weight:700;color:var(--accent);">—</div></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-computer" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-computer" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('localControl')">
              <h3>🖥️ Local Computer Control</h3>
              <span id="localControl-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="localControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">System information, telemetry overview, and quick actions.</div>
              <div id="local-system-info" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Operating System</div><div id="sys-os" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Hostname</div><div id="sys-hostname" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Platform</div><div id="sys-platform" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                  <div class="panel" style="padding:12px;"><div class="muted" style="font-size:11px;">Uptime</div><div id="sys-uptime" style="font-size:14px;font-weight:600;">Detecting...</div></div>
                </div>
              </div>
              <div id="usage-metrics" style="margin-top:12px;"></div>
              <div id="adapter-status-container"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('consoleView')">
              <h3>📠 Console View</h3>
              <span id="consoleView-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="consoleView-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Execute local system commands.</div>
              <div style="display:flex;gap:6px;margin-bottom:8px;">
                <input id="computer-console-input" type="text" placeholder="Enter system command (e.g. systeminfo, dir, tasklist)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-family:monospace;font-size:13px;" onkeydown="if(event.key==='Enter')runLocalCommand()" />
                <button onclick="runLocalCommand()" style="padding:6px 14px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;">▶ Run</button>
              </div>
              <pre id="computer-console-output" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;color:var(--text-muted);">Ready — enter a system command above.</pre>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('visionFramebuffer')">
              <h3>👁️ Vision Framebuffer</h3>
              <span id="visionFramebuffer-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="visionFramebuffer-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Agentic computer-use vision — shows the latest screengrab from the framebuffer. Captures occur automatically during agentic <code>computer use</code> actions.</div>
              <div class="framebuffer-controls">
                <button onclick="captureScreengrab()" title="Capture a single screenshot now">📸 Capture</button>
                <button onclick="burstCapture()" title="Burst capture 8 FPS for 2 seconds">🎥 Burst (8 FPS)</button>
                <button onclick="refreshFramebufferViewer()" title="Refresh the viewer with the latest image">🔄 Refresh</button>
                <button id="fb-auto-toggle" onclick="toggleFramebufferAutoRefresh()" title="Auto-refresh the viewer every 2 seconds">Auto-Refresh: OFF</button>
                <button onclick="runFramebufferDiagnostics()" title="Run capture diagnostics">🔧 Diagnostics</button>
                <span class="framebuffer-meta" id="fb-meta"></span>
              </div>
              <div class="framebuffer-viewer" id="framebuffer-viewer">
                <div class="fb-placeholder" id="fb-placeholder">No screengrab captured yet.<br/>Use <strong>Capture</strong> or trigger an agentic action to begin.</div>
                <img id="framebuffer-preview" style="display:none;" alt="Latest screengrab" onclick="window.open(this.src, '_blank')" title="Click to open full size" />
                <video id="framebuffer-preview-video" style="display:none;" autoplay loop muted playsinline title="Burst video — click to open" onclick="window.open(this.src, '_blank')"></video>
              </div>
              <div class="framebuffer-media-bar" id="framebuffer-media-bar">
                <button id="fb-mc-playpause" onclick="toggleBurstPlayPause()" title="Play / Pause burst animation">⏸ Pause</button>
                <button onclick="stopBurstFromUI()" title="Stop animation and show first frame">⏹ Stop</button>
                <span class="fb-media-spacer"></span>
                <span class="fb-media-label">Speed:</span>
                <button id="fb-mc-speed-half" onclick="setBurstSpeed(0.5)" title="Half speed">0.5×</button>
                <button id="fb-mc-speed-1x" onclick="setBurstSpeed(1)" title="Normal speed" class="active">1×</button>
                <button id="fb-mc-speed-2x" onclick="setBurstSpeed(2)" title="Double speed">2×</button>
              </div>
              <div class="framebuffer-selection-summary" id="framebuffer-selection-summary"></div>
              <div style="display:flex;align-items:center;gap:8px;padding:6px 0 2px;flex-wrap:wrap;">
                <span class="muted" style="font-size:10px;">📁</span>
                <span class="framebuffer-gallery-path" id="framebuffer-path">Loading…</span>
                <span style="flex:1;"></span>
                <span id="framebuffer-gallery-summary" class="muted" style="font-size:11px;"></span>
              </div>
              <div class="framebuffer-gallery" id="framebuffer-gallery"></div>
              <div class="framebuffer-gallery-controls" id="framebuffer-gallery-controls"></div>
              <div id="fb-diagnostics" style="display:none;margin-top:8px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;background:rgba(0,0,0,0.3);"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('computerConfig')">
              <h3>⚙️ Configuration &amp; Settings</h3>
              <span id="computerConfig-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="computerConfig-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">System configuration, environment variables, and editor settings.</div>
              <div id="computer-config-container" class="stack">
                <div style="margin-bottom:12px;">
                  <h4 style="margin:0 0 6px 0;font-size:13px;">Environment Variables</h4>
                  <div id="env-vars-list" class="muted" style="font-family:monospace;font-size:12px;max-height:200px;overflow:auto;">Click Refresh to load environment variables.</div>
                  <button class="primary-button" onclick="refreshEnvVars()" style="font-size:11px;margin-top:6px;">🔄 Refresh</button>
                </div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('policyControl')">
              <h3>📋 Policy Control</h3>
              <span id="policyControl-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="policyControl-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Windows Group Policy viewer and local security policy access. <strong>(Windows only)</strong></div>
              <div id="policy-control-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <button class="primary-button" onclick="openPolicyEditor('gpedit')" style="font-size:12px;">📜 Group Policy Editor</button>
                  <button class="primary-button" onclick="openPolicyEditor('secpol')" style="font-size:12px;">🔐 Local Security Policy</button>
                  <button class="primary-button" onclick="refreshPolicyStatus()" style="font-size:12px;">🔄 Refresh Policy Status</button>
                </div>
                <div id="policy-status-output" class="muted" style="margin-top:10px;font-size:12px;">Policy status not yet loaded.</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('deviceManager')">
              <h3>🔧 Device Manager <span id="dm-total-badge" class="dm-total-badge"></span></h3>
              <span id="deviceManager-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="deviceManager-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Comprehensive WMI hardware inventory — click any device to inspect all properties.</div>
              <input id="dm-search-input" class="dm-search-input" type="text" placeholder="🔍 Filter devices…" oninput="filterDeviceTree()" />
              <div class="dm-toolbar">
                <button class="primary-button" onclick="refreshDeviceManager()" style="font-size:12px;">🔄 Scan Devices</button>
                <button class="primary-button" onclick="generateDeviceReport()" style="font-size:12px;">📋 Generate Report</button>
                <button class="primary-button" onclick="openSystemDeviceManager()" style="font-size:12px;">🖥️ Open System Device Manager</button>
              </div>
              <div id="device-tree-container" class="stack" style="font-size:13px;">
                <div class="muted" style="text-align:center;padding:18px;">Click <strong>Scan Devices</strong> to enumerate hardware via WMI.</div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-browser" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-browser" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>🌐 Browser Control</h3>
              <div style="display:flex;gap:8px;align-items:center;">
                <span id="browser-default" class="muted" style="font-size:12px;">Detecting...</span>
                <span id="browser-preview-mode" class="muted" style="font-size:12px;display:none;"></span>
                <button id="browser-f12-btn" class="secondary-button" onclick="toggleBrowserDevTools()" style="font-size:12px;padding:4px 10px;">F12 Dev Tools</button>
                <button class="secondary-button" onclick="browserRunDiagnostics()" style="font-size:12px;padding:4px 10px;">🔍 Diagnostics</button>
              </div>
            </div>
            <div id="browser-diagnostics-result" style="display:none;padding:10px;background:rgba(255,255,255,0.04);border-radius:8px;margin:8px 0;font-size:12px;"></div>
            <div class="tabs panel" style="margin:10px 0;padding:6px;">
              <button id="bv-sessions" class="tab-button active" onclick="setBrowserView('sessions')" style="font-size:12px;">Sessions</button>
              <button id="bv-viewport" class="tab-button" onclick="setBrowserView('viewport')" style="font-size:12px;">Viewport</button>
              <button id="bv-network" class="tab-button" onclick="setBrowserView('network')" style="font-size:12px;">Network</button>
              <button id="bv-console" class="tab-button" onclick="setBrowserView('console')" style="font-size:12px;">Console</button>
              <button id="bv-dom" class="tab-button" onclick="setBrowserView('dom')" style="font-size:12px;">DOM</button>
              <button id="bv-storage" class="tab-button" onclick="setBrowserView('storage')" style="font-size:12px;">Storage</button>
              <button id="bv-profiles" class="tab-button" onclick="setBrowserView('profiles')" style="font-size:12px;">Profiles</button>
            </div>
            <div id="browser-sessions-panel">
              <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
                <select id="browser-launch-profile" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;"><option value="">No profile (ephemeral)</option></select>
                <button class="primary-button" onclick="browserLaunchSession(false)" style="font-size:12px;">🚀 Launch Headed</button>
                <button class="primary-button" onclick="browserLaunchSession(true)" style="font-size:12px;">🤖 Launch Headless</button>
                <button class="secondary-button" onclick="refreshSessionsList()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <div id="browser-sessions-list" class="stack"><span class="muted">No active sessions. Click Launch to start one.</span></div>
            </div>
            <div id="browser-viewport-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
                <select id="browser-active-session" onchange="browserSessionChanged()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <input id="browser-url-input" type="text" placeholder="https://example.com" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" onkeydown="if(event.key==='Enter')browserNavigate()" />
                <button class="primary-button" onclick="browserNavigate()" style="font-size:12px;">Go</button>
                <button class="secondary-button" onclick="browserTakeScreenshot()" style="font-size:12px;">📸 Screenshot</button>
              </div>
              <div id="browser-page-info" class="muted" style="font-size:12px;margin-bottom:8px;"></div>
              <div id="browser-viewport-container" class="panel" style="min-height:200px;display:flex;align-items:center;justify-content:center;"><span class="muted">No screenshot yet. Navigate to a URL.</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                <div class="panel" style="padding:12px;">
                  <div class="muted" style="font-size:11px;margin-bottom:6px;">Click Element</div>
                  <div style="display:flex;gap:6px;">
                    <input id="browser-click-selector" type="text" placeholder="CSS selector" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <button class="primary-button" onclick="browserClickElement()" style="font-size:12px;">Click</button>
                  </div>
                </div>
                <div class="panel" style="padding:12px;">
                  <div class="muted" style="font-size:11px;margin-bottom:6px;">Type Text</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <input id="browser-type-selector" type="text" placeholder="CSS selector" style="flex:1;min-width:100px;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <input id="browser-type-text" type="text" placeholder="Text to type" style="flex:1;min-width:100px;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                    <button class="primary-button" onclick="browserTypeText()" style="font-size:12px;">Type</button>
                  </div>
                </div>
              </div>
              <div class="panel" style="padding:12px;margin-top:12px;">
                <div class="muted" style="font-size:11px;margin-bottom:6px;">Evaluate JS</div>
                <div style="display:flex;gap:6px;">
                  <input id="browser-eval-input" type="text" placeholder="document.title" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" onkeydown="if(event.key==='Enter')browserEvaluate()" />
                  <button class="primary-button" onclick="browserEvaluate()" style="font-size:12px;">Eval</button>
                </div>
                <div id="browser-eval-result" style="display:none;margin-top:6px;padding:6px;background:rgba(0,0,0,0.2);border-radius:5px;font-size:12px;"></div>
              </div>
            </div>
            <div id="browser-network-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-network-session" onchange="browserRefreshNetwork()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshNetwork()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <table class="events-table" style="width:100%;"><thead><tr><th>Method</th><th>URL</th><th>Status</th><th>Type</th><th>Time</th></tr></thead><tbody id="browser-network-body"><tr><td colspan="5" class="muted" style="padding:10px;">Select a session first.</td></tr></tbody></table>
            </div>
            <div id="browser-console-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-console-session" onchange="browserRefreshConsole()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshConsole()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <div id="browser-console-entries" class="panel" style="max-height:400px;overflow-y:auto;padding:8px;"><span class="muted">Select a session first.</span></div>
            </div>
            <div id="browser-dom-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-dom-session" onchange="browserRefreshDom()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshDom()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <pre id="browser-dom-content" style="max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px;">Select a session first.</pre>
            </div>
            <div id="browser-storage-panel" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap;">
                <select id="browser-storage-session" onchange="browserRefreshStorage()" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;min-width:180px;"><option value="">Select session...</option></select>
                <button class="secondary-button" onclick="browserRefreshStorage()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="storage-tab-cookies" class="tab-button active" onclick="setStorageSubView('cookies')" style="font-size:11px;padding:4px 10px;">Cookies</button>
                <button id="storage-tab-local" class="tab-button" onclick="setStorageSubView('local')" style="font-size:11px;padding:4px 10px;">localStorage</button>
                <button id="storage-tab-session" class="tab-button" onclick="setStorageSubView('session')" style="font-size:11px;padding:4px 10px;">sessionStorage</button>
              </div>
              <div id="browser-storage-content" class="panel" style="padding:8px;"><span class="muted">Select a session first.</span></div>
            </div>
            <div id="browser-profiles-panel" style="display:none;">
              <div class="panel" style="padding:12px;margin-bottom:12px;">
                <div class="muted" style="font-size:11px;margin-bottom:8px;">Create New Profile</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <input id="browser-profile-email" type="email" placeholder="user@example.com" style="flex:1;min-width:160px;padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;" />
                  <select id="browser-profile-segment" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.18);background:#0b1728;color:var(--fg);font-size:12px;">
                    <option value="individual">Individual</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="operator">Operator</option>
                  </select>
                  <button class="primary-button" onclick="browserCreateProfile()" style="font-size:12px;">Create</button>
                  <button class="secondary-button" onclick="browserRefreshProfiles()" style="font-size:12px;">🔄 Refresh</button>
                </div>
              </div>
              <div id="browser-profiles-list" class="stack"><span class="muted">Loading profiles...</span></div>
            </div>
            <div class="panel" style="margin-top:16px;padding:10px;">
              <div class="muted" style="font-size:11px;font-weight:600;margin-bottom:6px;">Action Log</div>
              <div id="browser-action-history" style="max-height:150px;overflow-y:auto;"><span class="muted" style="font-size:12px;">No actions yet.</span></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-workspace" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-workspace" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('characterPanel')">
              <h3>Character Panel</h3>
              <span id="characterPanel-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="characterPanel-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Manage CAC assignments, inspect the full identity chain, and review lifecycle/audit activity directly in the Workspace tab.</div>
              <div id="character-panel-status" style="display:none;margin-bottom:10px;padding:10px;border-radius:6px;font-size:12px;"></div>
              <div id="character-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;"></div>
              <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(320px,1fr);gap:12px;align-items:start;">
                <div class="stack">
                  <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <input id="character-filter-input" type="text" placeholder="Filter by character, email, profile, or assignment..." style="flex:1;min-width:220px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:13px;" oninput="filterCharacterAssignments(this.value)" />
                    <button class="primary-button" onclick="refreshCharacterPanel()" style="font-size:12px;">🔄 Refresh</button>
                  </div>
                  <div id="character-roster" class="stack">
                    <div class="muted" style="padding:16px;text-align:center;">Loading CAC assignments...</div>
                  </div>
                </div>
                <div class="stack">
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">New Assignment</div>
                    <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                      <div>
                        <div id="label-workspace-hub" class="muted" style="font-size:11px;margin-bottom:3px;">Workspace Label (optional)</div>
                        <input id="character-assign-workspace-hub" type="text" placeholder="e.g., My Projects, Home Lab (optional)" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" onblur="onWorkspaceHubBlur()" />
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Type Selection *</div>
                        <select id="character-assign-profile" onchange="onProfileChanged()" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Character *</div>
                        <select id="character-assign-character" onchange="onCharacterDefinitionChanged()" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;">
                          <option value="">Loading characters...</option>
                        </select>
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Prism User Name</div>
                        <input id="character-assign-prism-user-id" type="text" placeholder="Prism user name" value="prism-dashboard-user" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div id="label-prism-user-email" class="muted" style="font-size:11px;margin-bottom:3px;">Assistant Email *</div>
                        <input id="character-assign-prism-user-email" type="email" placeholder="Character email (e.g., aria@prism.local)" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div class="muted" style="font-size:11px;margin-bottom:3px;">Operator ID</div>
                        <input id="character-assign-operator-id" type="text" placeholder="Operator ID" value="workspace-operator" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <div>
                        <div id="label-operator-email" class="muted" style="font-size:11px;margin-bottom:3px;">Personal Email *</div>
                        <input id="character-assign-operator-email" type="email" placeholder="Operator email" style="width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:12px;" />
                      </div>
                      <input id="character-assign-client-id" type="hidden" value="workspace-tab" />
                      <button class="primary-button" onclick="submitCharacterAssignment()" style="font-size:12px;">Assign Character</button>
                    </div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Character Profile Inspector</div>
                    <div id="character-definition-preview">
                      <div class="muted" style="font-size:12px;">Select a character to inspect its CAC profile, tool permissions, and persona.</div>
                    </div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">Accountability Audit Log</div>
                    <div id="character-audit-log" style="max-height:420px;overflow:auto;">
                      <div class="muted" style="font-size:12px;">Loading accountability activity...</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceLocation')">
              <h3>📂 Workspace Location</h3>
              <span id="workspaceLocation-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="workspaceLocation-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Current workspace path and relocation controls.</div>
              <div id="workspace-location-container" class="stack">
                <div class="panel" style="padding:12px;display:flex;align-items:center;gap:12px;">
                  <div style="flex:1;">
                    <div class="muted" style="font-size:11px;">Current Workspace</div>
                    <div id="workspace-path" style="font-size:14px;font-weight:600;font-family:monospace;word-break:break-all;">Loading...</div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                  <button class="primary-button" onclick="changeWorkspaceLocation()" style="font-size:12px;">📁 Change Location</button>
                  <button class="primary-button" onclick="openWorkspaceInExplorer()" style="font-size:12px;">📂 Open in Explorer</button>
                  <button class="primary-button" onclick="refreshWorkspaceInfo()" style="font-size:12px;">🔄 Refresh</button>
                </div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceFiles')">
              <h3>📁 Workspace Files</h3>
              <span id="workspaceFiles-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="workspaceFiles-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Browse and manage files in the current workspace.</div>
              <div style="display:flex;gap:8px;margin-bottom:10px;">
                <input id="workspace-file-filter" type="text" placeholder="Filter files..." style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-size:13px;" oninput="filterWorkspaceFiles(this.value)" />
                <button class="primary-button" onclick="refreshWorkspaceFiles()" style="font-size:12px;">🔄 Refresh</button>
              </div>
              <div id="workspace-file-tree" class="stack" style="max-height:500px;overflow:auto;font-family:monospace;font-size:12px;">
                <div class="muted" style="text-align:center;padding:24px;">Click Refresh to load workspace files.</div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('importManager')">
              <h3>📥 Import Manager</h3>
              <span id="importManager-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="importManager-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Import files and resources into the workspace. Imports are vetted based on your execution profile (Individual or Business).</div>
              <div id="import-manager-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerGeneralImport()">
                    <div style="font-size:24px;margin-bottom:4px;">📄</div>
                    <div style="font-size:13px;font-weight:700;">Import File</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Copy any file into a workspace directory.</div>
                  </div>
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerRegisteredImport()">
                    <div style="font-size:24px;margin-bottom:4px;">🧩</div>
                    <div style="font-size:13px;font-weight:700;">Import Registered Item</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Import a PRISM-recognized item (character, config, package, etc.).</div>
                  </div>
                  <div class="panel" style="padding:16px;text-align:center;cursor:pointer;border:2px dashed var(--border);" onclick="triggerFolderImport()">
                    <div style="font-size:24px;margin-bottom:4px;">📁</div>
                    <div style="font-size:13px;font-weight:700;">Import Folder</div>
                    <div class="muted" style="font-size:11px;margin-top:4px;">Copy an entire folder structure into the workspace.</div>
                  </div>
                </div>
                <input type="file" id="import-file-input" style="display:none;" />
                <input type="file" id="import-registered-input" style="display:none;" />
                <input type="file" id="import-folder-input" style="display:none;" multiple webkitdirectory />
                <div id="import-status" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:12px;"></div>
                <div style="margin-top:12px;">
                  <h4 style="margin:0 0 6px 0;font-size:13px;">Import History</h4>
                  <div id="import-history-list" class="muted" style="font-size:12px;">No imports yet.</div>
                </div>
              </div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('workspaceSettings')">
              <h3>⚙️ Workspace Settings</h3>
              <span id="workspaceSettings-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="workspaceSettings-collapsible" class="collapsible-body">
              <div class="muted" style="margin-bottom:8px;">Workspace-level configuration and preferences.</div>
              <div id="workspace-settings-container" class="stack">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Active Profile</div>
                    <div id="ws-active-profile" style="font-size:14px;font-weight:600;">Individual</div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Auto-Save</div>
                    <div id="ws-auto-save" style="font-size:14px;font-weight:600;">Enabled</div>
                  </div>
                  <div class="panel" style="padding:12px;">
                    <div class="muted" style="font-size:11px;">Git Integration</div>
                    <div id="ws-git-status" style="font-size:14px;font-weight:600;">Detecting...</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-network" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-network" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkTools')">
              <h3>📡 Network Tools</h3>
              <span id="networkTools-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="networkTools-collapsible" class="collapsible-body">
              <div id="network-tools-panel" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkSettings')">
              <h3>⚙️ Network Settings</h3>
              <span id="networkSettings-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="networkSettings-collapsible" class="collapsible-body">
              <div id="network-settings-panel" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkTelemetry')">
              <h3>📊 Network Telemetry</h3>
              <span id="networkTelemetry-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="networkTelemetry-collapsible" class="collapsible-body">
              <div id="network-telemetry-panel" class="stack"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkConsole')">
              <h3>🖥️ Network Console</h3>
              <span id="networkConsole-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="networkConsole-collapsible" class="collapsible-body">
              <div style="display:flex;gap:6px;margin-bottom:8px;">
                <input id="network-console-input" type="text" placeholder="Enter network command (e.g. ipconfig, ping 8.8.8.8)" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-family:monospace;font-size:13px;" onkeydown="if(event.key==='Enter')runNetworkCommand()" />
                <button onclick="runNetworkCommand()" style="padding:6px 14px;border:none;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;">▶ Run</button>
              </div>
              <pre id="network-console-output" style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;max-height:400px;overflow:auto;font-size:12px;white-space:pre-wrap;color:var(--text-muted);">Ready — enter a network command above.</pre>
              <div id="network-history-list" style="margin-top:8px;"></div>
            </div>
          </section>

          <section class="rail-section panel" style="grid-column:1/-1;border:1px solid var(--accent);border-radius:8px;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('networkIntelligence')">
              <h3>🧠 Network Intelligence (VRGC)</h3>
              <span id="networkIntelligence-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="networkIntelligence-collapsible" class="collapsible-body">
              <div id="network-intelligence-panel" class="stack">
                <div class="muted" style="text-align:center;padding:24px;">Loading VRGC status…</div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-telemetry" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-telemetry" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('usageCost')">
              <h3>💰 Usage &amp; Cost</h3>
              <span id="usageCost-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="usageCost-collapsible" class="collapsible-body">
              <div id="usage-cost-panel" class="stack"></div>
            </div>
          </section>
          <section class="rail-section panel" style="grid-column:1/-1;padding-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="muted" style="font-size:12px;">Change window:</span>
              <button class="tab-button" id="tw-1h" onclick="setTelemetryWindow('1h')">1 hour</button>
              <button class="tab-button" id="tw-1d" onclick="setTelemetryWindow('1d')">1 day</button>
              <button class="tab-button" id="tw-7d" onclick="setTelemetryWindow('7d')">7 days</button>
            </div>
          </section>
          <section class="rail-section panel">
            <h3>What Changed</h3>
            <div id="telemetry-what-changed"></div>
          </section>
          <section class="rail-section panel">
            <h3>Runtime Overview</h3>
            <div id="runtime-overview" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Runtime Excellence</h3>
            <div id="runtime-excellence"></div>
          </section>
          <section class="rail-section panel">
            <h3>Release Readiness</h3>
            <div id="release-readiness"></div>
          </section>
          <section class="rail-section panel">
            <h3>Package History</h3>
            <div id="package-history"></div>
          </section>
          <section class="rail-section panel">
            <h3>Self Review</h3>
            <div id="self-review"></div>
          </section>
          <section class="rail-section panel">
            <h3>Retrieval Alerts</h3>
            <div id="retrieval-alerts"></div>
          </section>
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header" style="cursor:pointer;user-select:none;" onclick="togglePanelCollapse('sloGauges')">
              <h3>🟢 SLO Gauges</h3>
              <span id="sloGauges-collapse-icon" class="collapse-icon">▼</span>
            </div>
            <div id="sloGauges-collapsible" class="collapsible-body">
              <div id="slo-gauge-panel"></div>
            </div>
          </section>
        </div>
      </section>

      <section id="tab-logs" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-logs" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel">
            <h3>Quick Actions</h3>
            <div id="actions" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Pending Approvals</h3>
            <div id="pending" class="stack"></div>
          </section>
          <section class="rail-section panel">
            <h3>Recent Action History</h3>
            <div id="action-history"></div>
          </section>
          <section class="rail-section panel">
            <h3>Chat Telemetry</h3>
            <div id="chat-telemetry"></div>
          </section>
          <section class="rail-section panel">
            <h3>Correlated Traces</h3>
            <div id="trace-view"></div>
          </section>
          <section class="rail-section panel">
            <h3>Recent Events</h3>
            <div id="events"></div>
          </section>
          <section class="rail-section panel">
            <h3>Tool Call Log</h3>
            <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
              <span class="muted" style="font-size:11px;">Live tool calls from agentic sessions.</span>
              <div style="flex:1;"></div>
              <button class="secondary-button" style="font-size:11px;padding:3px 8px;" onclick="state.toolCallLog=[];safeRenderStep('toolCallLog',renderToolCallLog);">Clear</button>
            </div>
            <div id="tool-call-log"></div>
          </section>
          <section class="rail-section panel" style="grid-column:1/-1;">
            <h3>📝 Activity Log</h3>
            <div class="log-filter-bar">
              <label class="muted" style="font-size:11px;">Source:</label>
              <select id="logs-tab-filter" onchange="filterLogs()">
                <option value="">All</option>
                <option value="diagnostics">diagnostics</option>
                <option value="agent-diagnostics">agent-diagnostics</option>
                <option value="computer-diagnostics">computer-diagnostics</option>
                <option value="tools">tools</option>
                <option value="browser">browser</option>
                <option value="chat">chat</option>
                <option value="agentic">agentic</option>
                <option value="computer">computer</option>
                <option value="settings">settings</option>
                <option value="workspace">workspace</option>
                <option value="scheduler">scheduler</option>
                <option value="hardware">hardware</option>
              </select>
              <label class="muted" style="font-size:11px;">Severity:</label>
              <select id="logs-severity-filter" onchange="filterLogs()">
                <option value="">All</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
              <div style="flex:1;"></div>
              <span class="muted" style="font-size:10px;">Last 500 entries · auto-scroll</span>
              <button class="secondary-button" style="font-size:11px;padding:3px 8px;" onclick="clearLogs()">Clear</button>
            </div>
            <div id="logs-panel-body" style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:rgba(0,0,0,0.15);padding:4px 0;"></div>
          </section>
        </div>
      </section>

      <section id="tab-hardware" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-hardware" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>⚡ Local Hardware Swarm</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="secondary-button" style="font-size:12px;" onclick="if(window.refreshHardwareSwarm) window.refreshHardwareSwarm()()">🔄 Refresh</button>
              </div>
            </div>
            <div id="hardware-swarm-panel" class="stack" style="margin-top:10px;">
            </div>
          </section>
        </div>
      </section>

      <section id="tab-scheduler" class="tab-panel" role="tabpanel" aria-labelledby="tab-button-scheduler" aria-hidden="true">
        <div class="tab-grid">
          <section class="rail-section panel" style="grid-column:1/-1;">
            <div class="rail-header">
              <h3>📅 Scheduler</h3>
              <div style="display:flex;gap:6px;align-items:center;">
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('event')">+ Event</button>
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('task')">+ Task</button>
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('project')">+ Project</button>
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('cron')">+ Cron Job</button>
                <button class="secondary-button" style="font-size:12px;" onclick="refreshSchedulerData()">🔄 Refresh</button>
              </div>
            </div>
            <div class="tabs panel" style="margin:10px 0;padding:6px;">
              <button class="tab-button sched-subnav-btn active" data-sched-view="calendar" onclick="switchSchedulerView('calendar')" style="font-size:12px;">📅 Calendar</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="projects" onclick="switchSchedulerView('projects')" style="font-size:12px;">📋 Projects</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="board" onclick="switchSchedulerView('board')" style="font-size:12px;">📌 Board</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="timeline" onclick="switchSchedulerView('timeline')" style="font-size:12px;">📊 Timeline</button>
              <button class="tab-button sched-subnav-btn" data-sched-view="cron" onclick="switchSchedulerView('cron')" style="font-size:12px;">⏰ Cron Jobs</button>
            </div>
            <div id="sched-view-calendar">
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <button class="secondary-button" onclick="schedCalNav(-1)" style="font-size:12px;padding:4px 10px;">‹</button>
                <span id="sched-cal-title" style="font-size:14px;font-weight:600;min-width:120px;text-align:center;"></span>
                <button class="secondary-button" onclick="schedCalNav(1)" style="font-size:12px;padding:4px 10px;">›</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="year" onclick="setCalMode('year')" style="font-size:11px;padding:4px 10px;">Year</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="month" onclick="setCalMode('month')" style="font-size:11px;padding:4px 10px;">Month</button>
                <button class="tab-button sched-mode-btn" data-cal-mode="week" onclick="setCalMode('week')" style="font-size:11px;padding:4px 10px;">Week</button>
                <button class="tab-button sched-mode-btn active" data-cal-mode="day" onclick="setCalMode('day')" style="font-size:11px;padding:4px 10px;">Day</button>
              </div>
              <div id="sched-cal-body" style="min-height:200px;"></div>
            </div>
            <div id="sched-view-projects" style="display:none;">
              <div id="sched-projects-list" class="stack"><span class="muted" style="font-size:12px;">No projects. Click + Project to create one.</span></div>
            </div>
            <div id="sched-view-board" style="display:none;">
              <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;min-height:300px;">
                <div data-status="backlog">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Backlog</div>
                  <div id="sched-lane-backlog" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="todo">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">To Do</div>
                  <div id="sched-lane-todo" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="in-progress">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">In Progress</div>
                  <div id="sched-lane-in-progress" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="review">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Review</div>
                  <div id="sched-lane-review" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
                <div data-status="done">
                  <div style="font-weight:600;font-size:12px;margin-bottom:8px;">Done</div>
                  <div id="sched-lane-done" class="sched-lane-body" style="min-height:200px;padding:6px;border:1px dashed rgba(148,163,184,0.2);border-radius:6px;"></div>
                </div>
              </div>
            </div>
            <div id="sched-view-timeline" style="display:none;">
              <div id="sched-gantt-header" style="position:relative;height:24px;"></div>
              <div id="sched-gantt-rows" style="min-height:100px;"></div>
            </div>
            <div id="sched-view-cron" style="display:none;">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
                <button class="primary-button" style="font-size:12px;" onclick="openSchedulerModal('cron')">+ New Cron Job</button>
                <button class="secondary-button" style="font-size:12px;" onclick="refreshCronJobs()">🔄 Refresh</button>
                <span id="sched-cron-count" class="muted" style="font-size:12px;"></span>
              </div>
              <div id="sched-cron-list" class="stack"><span class="muted" style="font-size:12px;">No cron jobs scheduled. Click + Cron Job to add one.</span></div>
            </div>
          </section>
        </div>
      </section>

      <div id="sched-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:360px;max-width:520px;width:90%;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 id="sched-modal-title" style="margin:0;font-size:16px;"></h3>
            <button class="secondary-button" onclick="closeSchedulerModal()" style="font-size:18px;padding:2px 8px;line-height:1;">&times;</button>
          </div>
          <div id="sched-modal-body"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="secondary-button" onclick="closeSchedulerModal()">Cancel</button>
            <button id="sched-modal-save" class="primary-button" onclick="saveSchedulerModal()">Save</button>
          </div>
        </div>
      </div>
    </main>
  </div>
  <script type="module" src="/public/dashboard-app.js"></script>

  <script>
  (function() {
    var handle = document.getElementById('resize-handle');
    var app = document.getElementById('app');
    var sidebar = document.getElementById('sidebar');
    if (!handle || !app || !sidebar) return;
    var dragging = false;
    var startX = 0;
    var startWidth = 0;
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
      app.style.setProperty('--sidebar-width', newWidth + 'px');
    });
    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();
  </script>
</body>
</html>`;
}

export function simpleModeHtml(port: number, authToken?: string): string {
  void port;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="prism-auth-token" content="\${authToken ?? ""}" />
  <title>PRISM</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #07111f;
      --panel: rgba(7,19,36,0.88);
      --border: rgba(148,163,184,0.16);
      --text: #edf3ff;
      --muted: #98a6bc;
      --accent: #69d2ff;
      --radius: 16px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(105,210,255,0.14), transparent 28%),
        radial-gradient(circle at bottom right, rgba(124,241,200,0.10), transparent 24%),
        linear-gradient(180deg,#06101d 0%,#091728 44%,#07111f 100%);
      color: var(--text);
      font-family: Aptos,"Segoe UI Variable Text","Segoe UI",sans-serif;
      font-size: 15px;
    }
    button, input, textarea, select { font: inherit; color: inherit; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .sm-app { display: flex; flex-direction: column; height: 100vh; }
    .sm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(6,16,29,0.72);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
    }
    .sm-logo {
      font-size: 1.15rem; font-weight: 700; letter-spacing: 0.06em;
      background: linear-gradient(90deg, var(--accent) 0%, #7cf1c8 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .sm-header-actions { display: flex; gap: 10px; align-items: center; }
    .sm-btn-ghost {
      padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
      background: transparent; cursor: pointer; font-size: 0.85rem; color: var(--muted);
      transition: border-color .15s, color .15s;
    }
    .sm-btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
    .sm-body { display: flex; flex: 1; overflow: hidden; }
    .sm-sidebar {
      width: 240px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: rgba(6,16,29,0.55);
      display: flex; flex-direction: column;
      padding: 14px 10px;
      gap: 8px;
      overflow-y: auto;
    }
    .sm-sidebar-title {
      font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--muted); padding: 0 6px 4px;
    }
    .sm-btn-new-chat {
      width: 100%; padding: 8px 12px; border-radius: var(--radius);
      border: 1px dashed rgba(105,210,255,0.35); background: transparent;
      cursor: pointer; font-size: 0.85rem; color: var(--accent);
      text-align: left; transition: background .15s, border-color .15s;
    }
    .sm-btn-new-chat:hover { background: rgba(105,210,255,0.08); border-color: var(--accent); }
    #sm-session-list { display: flex; flex-direction: column; gap: 4px; }
    .sm-session-item {
      width: 100%; padding: 8px 10px; border-radius: 10px; border: none;
      background: transparent; cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 2px;
      transition: background .15s;
    }
    .sm-session-item:hover { background: rgba(255,255,255,0.05); }
    .sm-session-item--active { background: rgba(105,210,255,0.1) !important; }
    .sm-session-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sm-session-date { font-size: 0.72rem; color: var(--muted); }
    .sm-empty { font-size: 0.8rem; color: var(--muted); padding: 6px; }
    .sm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #sm-character-picker {
      display: flex; gap: 10px; padding: 16px 20px;
      border-bottom: 1px solid var(--border); flex-shrink: 0;
      flex-wrap: wrap;
    }
    .sm-char-card {
      flex: 1; min-width: 120px; max-width: 200px;
      padding: 12px 14px; border-radius: 14px;
      border: 1px solid var(--border); background: var(--panel);
      cursor: pointer; text-align: left;
      display: flex; flex-direction: column; gap: 4px;
      transition: border-color .15s, background .15s, transform .1s;
    }
    .sm-char-card:hover { background: rgba(255,255,255,0.04); transform: translateY(-1px); }
    .sm-char-card--selected {
      background: rgba(105,210,255,0.08);
      box-shadow: 0 0 0 2px rgba(105,210,255,0.25);
    }
    .sm-char-emoji { font-size: 1.5rem; line-height: 1; }
    .sm-char-name { font-weight: 700; font-size: 0.95rem; letter-spacing: 0.04em; }
    .sm-char-badge {
      font-size: 0.7rem; font-weight: 600; padding: 2px 7px; border-radius: 20px;
      border: 1px solid rgba(148,163,184,0.2); color: var(--muted);
      align-self: flex-start;
    }
    .sm-char-persona { font-size: 0.75rem; color: var(--muted); line-height: 1.4; }
    #sm-messages {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .sm-greeting {
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 40px 20px; color: var(--muted); text-align: center;
    }
    .sm-greeting-emoji { font-size: 2.5rem; }
    .sm-greeting p { font-size: 1.05rem; max-width: 480px; line-height: 1.6; color: var(--text); }
    .sm-msg { display: flex; flex-direction: column; gap: 4px; max-width: 720px; }
    .sm-msg--user { align-self: flex-end; align-items: flex-end; }
    .sm-msg--assistant { align-self: flex-start; align-items: flex-start; }
    .sm-msg-label { font-size: 0.72rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .sm-msg-content {
      padding: 10px 14px; border-radius: 14px; line-height: 1.6;
      font-size: 0.92rem; max-width: 100%;
    }
    .sm-msg--user .sm-msg-content {
      background: rgba(105,210,255,0.12); border: 1px solid rgba(105,210,255,0.22);
    }
    .sm-msg--assistant .sm-msg-content {
      background: var(--panel); border: 1px solid var(--border);
    }
    .sm-input-area {
      border-top: 1px solid var(--border); padding: 14px 20px;
      display: flex; gap: 10px; flex-shrink: 0;
      background: rgba(6,16,29,0.55);
    }
    #sm-input {
      flex: 1; padding: 10px 14px; border-radius: 12px;
      border: 1px solid var(--border); background: rgba(255,255,255,0.04);
      color: var(--text); resize: none; min-height: 44px; max-height: 160px;
      line-height: 1.5; outline: none;
      transition: border-color .15s;
    }
    #sm-input:focus { border-color: rgba(105,210,255,0.5); }
    #sm-input::placeholder { color: var(--muted); }
    #sm-send-btn {
      padding: 10px 22px; border-radius: 12px;
      border: none; background: var(--accent); color: #07111f;
      font-weight: 700; cursor: pointer; align-self: flex-end;
      transition: opacity .15s, transform .1s;
    }
    #sm-send-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
    #sm-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    #sm-error {
      display: none; position: fixed; bottom: 20px; right: 20px;
      background: rgba(255,100,100,0.18); border: 1px solid rgba(255,100,100,0.4);
      color: #ff9d9d; padding: 10px 16px; border-radius: 10px;
      font-size: 0.85rem; max-width: 360px; z-index: 9999;
    }
    @media (max-width: 640px) {
      .sm-sidebar { display: none; }
      #sm-character-picker { padding: 10px 12px; }
      .sm-char-card { min-width: 90px; }
    }
  </style>
</head>
<body>
  <div class="sm-app">
    <header class="sm-header">
      <span class="sm-logo">⬡ PRISM</span>
      <div class="sm-header-actions">
        <button id="sm-advanced-btn" class="sm-btn-ghost" title="Switch to the full operator dashboard">
          Advanced Mode →
        </button>
      </div>
    </header>

    <div class="sm-body">
      <aside class="sm-sidebar">
        <span class="sm-sidebar-title">Conversations</span>
        <button id="sm-new-chat-btn" class="sm-btn-new-chat">+ New Chat</button>
        <div id="sm-session-list"></div>
      </aside>

      <main class="sm-main">
        <div id="sm-character-picker"></div>
        <div id="sm-messages"></div>
        <div class="sm-input-area">
          <textarea
            id="sm-input"
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            rows="1"
            autocomplete="off"
          ></textarea>
          <button id="sm-send-btn">Send</button>
        </div>
      </main>
    </div>
  </div>
  <div id="sm-error"></div>
  <script type="module" src="/public/simple-mode.js"></script>
</body>
</html>`;
}
