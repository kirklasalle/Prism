export function loginHtml(port: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Operator Login — PRISM Refraction</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #090a0f;
      --bg-surface: rgba(20, 22, 32, 0.7);
      --border-color: rgba(255, 255, 255, 0.1);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent-cyan: #06b6d4;
      --accent-indigo: #6366f1;
      --focus-glow: rgba(6, 182, 212, 0.3);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-base);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.15) 0px, transparent 50%);
      background-attachment: fixed;
      font-family: 'Inter', sans-serif;
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .container {
      width: 100%;
      max-width: 440px;
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border-color);
      border-radius: 1.5rem;
      padding: 2.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      animation: fadeIn 0.5s ease-out;
      position: relative;
      overflow: hidden;
    }
    .container::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-indigo));
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 1rem;
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(99, 102, 241, 0.2));
      border: 1px solid rgba(255, 255, 255, 0.15);
      margin-bottom: 1rem;
      box-shadow: 0 0 20px var(--focus-glow);
    }
    .logo-badge svg {
      width: 32px;
      height: 32px;
      stroke: url(#cyan-indigo);
    }
    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-bottom: 0.5rem;
      background: linear-gradient(to right, #fff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    .form-group {
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: #e2e8f0;
    }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: rgba(10, 12, 18, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 0.75rem;
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-size: 0.95rem;
      transition: all 0.2s;
    }
    input:focus {
      outline: none;
      border-color: var(--accent-cyan);
      box-shadow: 0 0 0 3px var(--focus-glow);
    }
    button[type="submit"] {
      width: 100%;
      padding: 0.875rem 1.5rem;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-indigo));
      color: #fff;
      border: none;
      border-radius: 0.75rem;
      font-family: 'Outfit', sans-serif;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 10px 20px -10px var(--accent-cyan);
    }
    button[type="submit"]:hover {
      transform: translateY(-1px);
      filter: brightness(1.1);
      box-shadow: 0 15px 25px -10px var(--accent-cyan);
    }
    button[type="submit"]:active,
    .badge-btn:active,
    .small-button:active {
      transform: scale(0.95) !important;
      filter: brightness(0.9) !important;
      transition: transform 0.08s ease-out, filter 0.08s ease-out;
    }
    .quick-fill {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-color);
      text-align: center;
    }
    .quick-fill p {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .quick-buttons {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
    }
    .badge-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0.5rem;
      padding: 0.5rem 0.875rem;
      color: #e2e8f0;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .badge-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .badge-btn.admin { border-left: 3px solid var(--accent-indigo); }
    .badge-btn.testing { border-left: 3px solid var(--accent-cyan); }
    .error-banner {
      display: none;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
      text-align: center;
      animation: fadeIn 0.3s;
    }
    .info-banner {
      display: none;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #bae6fd;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }
    .manage-panel {
      display: none;
      margin-top: 1rem;
    }
    .manage-header {
      margin-bottom: 1.5rem;
    }
    .manage-header h2 {
      font-size: 1.35rem;
      margin-bottom: 0.35rem;
    }
    .manage-header p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    .user-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    .user-table th,
    .user-table td {
      padding: 0.85rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 0.92rem;
    }
    .user-table th {
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 0.75rem;
    }
    .small-button {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      border-radius: 0.65rem;
      padding: 0.45rem 0.8rem;
      font-size: 0.8rem;
      cursor: pointer;
      margin-right: 0.45rem;
    }
    .small-button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .small-button.positive {
      border-color: rgba(16, 185, 129, 0.35);
      background: rgba(16, 185, 129, 0.12);
    }
    .small-button.warn {
      border-color: rgba(249, 115, 22, 0.35);
      background: rgba(249, 115, 22, 0.12);
    }
    .compact-form {
      display: grid;
      gap: 0.75rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <svg style="display:none">
    <defs>
      <linearGradient id="cyan-indigo" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#06b6d4" />
        <stop offset="100%" stop-color="#6366f1" />
      </linearGradient>
    </defs>
  </svg>
  <div class="container">
    <div class="header">
      <div class="logo-badge">
        <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
        </svg>
      </div>
      <h1>Operator Authentication</h1>
      <p>Log in to access the PRISM Refraction Console</p>
    </div>
    <div id="errorBanner" class="error-banner"></div>
    <div id="infoBanner" class="info-banner"></div>
    <div id="loginPanel">
      <form id="loginForm" onsubmit="handleLogin(event)">
        <div class="form-group">
          <label for="email">Operator Email</label>
          <input type="email" id="email" required placeholder="operator@prism.ai" autofocus title="Enter your operator account email" autocomplete="username" />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" required placeholder="••••••••" title="Enter your operator account password" autocomplete="current-password" />
        </div>
        <button type="submit" id="submitBtn" title="Sign in to open your PRISM operator session">Authenticate Session</button>
      </form>
      <div class="quick-fill">
      <p>Quick Evaluation Profiles</p>
      <div style="background:rgba(249,115,22,0.12); border:1px solid rgba(249,115,22,0.3); color:#fdba74; padding:0.6rem 0.85rem; border-radius:0.6rem; font-size:0.8rem; margin-bottom:0.75rem; text-align:center;">
        ⚠️ Local evaluation only — do not use these credentials in production or internet-facing deployments. Run the Setup Wizard to create secure operator accounts.
      </div>
      <div class="quick-buttons">
        <button type="button" class="badge-btn admin" onclick="fillCreds('admin@prismrefraction.com', 'admin')" title="Autofill admin evaluation credentials (local dev only)">
          <span>Admin Profile</span>
        </button>
        <button type="button" class="badge-btn testing" onclick="fillCreds('testing@prismrefraction.com', 'testing')" title="Autofill testing operator credentials (local dev only)">
          <span>Testing Operator</span>
        </button>
      </div>
      <div style="margin-top:1rem; text-align:center;">
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.75rem;">No operator account yet? Set up PRISM and create one.</p>
        <button type="button" class="badge-btn" style="width:100%; justify-content:center;" onclick="window.location.href='/setup'" title="Open the guided setup wizard">
          <span>Run Setup Wizard</span>
        </button>
        <button type="button" class="badge-btn" style="width:100%; justify-content:center; margin-top:0.75rem;" onclick="window.location.href='/public/iam-admin.html'" title="Open operator account management">
          <span>Manage Operators</span>
        </button>
        <button type="button" class="badge-btn" style="width:100%; justify-content:center; margin-top:0.75rem; border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.12); color: #fca5a5;" onclick="shutdownSystem()" title="Shutdown the PRISM console server">
          <span>Shutdown Console</span>
        </button>
      </div>
    </div>
    <div id="managePanel" class="manage-panel">
      <div class="manage-header">
        <button type="button" class="badge-btn" onclick="window.location.href='/login'">← Back to Login</button>
        <h2>Operator Management</h2>
        <p>View and manage local operator accounts. Admin access is required.</p>
      </div>
      <div id="manageStatus" class="info-banner"></div>
      <div id="manageContent" style="display:none;">
        <form class="compact-form" onsubmit="event.preventDefault(); createOperator();">
          <label for="new-email">New operator email</label>
          <input type="email" id="new-email" placeholder="operator@prism.ai" autocomplete="username" />
          <label for="new-password">Password</label>
          <input type="password" id="new-password" placeholder="Set a secure password" autocomplete="new-password" />
          <button type="button" class="small-button positive" onclick="createOperator()">Create Operator</button>
        </form>
        <div id="operatorList" style="margin-top:1.5rem;"></div>
      </div>
    </div>
  </div>

  <script>
    let currentUser = null;
    const params = new URL(window.location.href).searchParams;
    const manageMode = params.get('manage') === 'true';
    const loginPanel = document.getElementById('loginPanel');
    const managePanel = document.getElementById('managePanel');
    const errorBanner = document.getElementById('errorBanner');
    const infoBanner = document.getElementById('infoBanner');
    const manageStatus = document.getElementById('manageStatus');
    const manageContent = document.getElementById('manageContent');

    function setBanner(element, message, visible = true) {
      if (!element) return;
      element.textContent = message;
      element.style.display = visible ? 'block' : 'none';
    }

    function fillCreds(email, password) {
      document.getElementById('email').value = email;
      document.getElementById('password').value = password;
      document.getElementById('password').focus();
      console.log('[PRISM][Auth] Quick Evaluation Profile selected:', email);
      authTrace('iam.quick_profile.selected', { email, profile: email.split('@')[0] });
    }

    function authTrace(operation, details) {
      try {
        fetch('/api/v1/telemetry/auth-trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation, details, timestamp: new Date().toISOString() }),
        }).catch(function() { /* best-effort */ });
      } catch(e) { /* swallow */ }
    }

    async function handleLogin(e) {
      e.preventDefault();
      setBanner(errorBanner, '', false);
      setBanner(infoBanner, 'Verifying credentials...', true);
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Verifying Credentials...';
      console.log('[PRISM][Auth] Login attempt started');
      authTrace('iam.login.attempt', { email: document.getElementById('email').value.trim() });

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value.trim();

      try {
        const res = await fetch('/api/iam/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setBanner(infoBanner, 'Session established. Redirecting...', true);
          btn.textContent = 'Session Established!';
          console.log('[PRISM][Auth] Login succeeded for', email);
          // The session cookie is already set by the server response.
          // Redirect to /dashboard — the cookie will authenticate the request.
          const redirectTarget = manageMode ? '/login?manage=true' : '/dashboard';
          setTimeout(() => {
            window.location.href = redirectTarget;
          }, 300);
          return;
        }
        throw new Error(data.error?.message || 'Invalid credentials');
      } catch (err) {
        setBanner(infoBanner, '', false);
        setBanner(errorBanner, err.message || 'Authentication failed. Please verify your credentials.', true);
        console.warn('[PRISM][Auth] Login failed:', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Authenticate Session';
      }
    }

    async function fetchJson(path, options) {
      const res = await fetch(path, options);
      const json = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, json };
    }

    async function ensureManageView() {
      if (!manageMode) return;
      window.location.href = '/public/iam-admin.html';
      return;
    }

    async function shutdownSystem() {
      if (!confirm('Are you sure you want to shutdown the PRISM console server?')) {
        return;
      }
      setBanner(errorBanner, '', false);
      setBanner(infoBanner, 'Sending shutdown command...', true);
      try {
        const res = await fetch('/api/system/shutdown', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          setBanner(infoBanner, 'Shutdown initialized. You may close this window.', true);
          return;
        }
        throw new Error(data.message || 'Shutdown failed');
      } catch (err) {
        setBanner(infoBanner, '', false);
        setBanner(errorBanner, 'Failed to shutdown server: ' + err.message, true);
      }
    }

    function showPanel() {
      if (manageMode && managePanel) {
        if (loginPanel) loginPanel.style.display = 'none';
        managePanel.style.display = 'block';
        ensureManageView();
      } else if (loginPanel) {
        loginPanel.style.display = 'block';
      }
    }

    showPanel();
  </script>
</body>
</html>`;
}
