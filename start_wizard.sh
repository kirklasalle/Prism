#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "================================================"
echo "PRISM Setup Wizard"
echo "================================================"

# ── CLI mode: run readline-based wizard instead of browser ──
if [[ "${1:-}" == "--cli" ]]; then
    shift
    if ! command -v node &>/dev/null; then
        echo "[ERROR] Node.js was not found on PATH."
        exit 1
    fi
    if [ ! -d "node_modules" ]; then
        echo "[SETUP] Installing dependencies..."
        npm install || exit 1
    fi
    echo "[WIZARD] Starting CLI Setup Wizard..."
    exec npx tsx src/cli/setup-wizard.ts "$@"
fi

# ── Browser mode (default) ──
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js was not found on PATH."
    echo "Install Node.js 22+ and re-run this script."
    exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "[ERROR] Node.js 22+ is required. Detected major version $NODE_MAJOR."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "[ERROR] npm was not found on PATH."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[SETUP] Installing dependencies..."
    npm install || exit 1
fi

if [ "${PRISM_WIZARD_SKIP_BUILD:-0}" != "1" ] || [ ! -d "dist" ]; then
    echo "[BUILD] Building PRISM wizard assets..."
    npm run build || exit 1
fi

PRISM_DASHBOARD_PORT="${PRISM_DASHBOARD_PORT:-7070}"
export PRISM_ALLOW_QUERY_TOKEN="${PRISM_ALLOW_QUERY_TOKEN:-1}"

if [ -z "${PRISM_WORKSPACE_ROOT:-}" ] && [ -f ".prism-preferences.json" ]; then
    PRISM_WORKSPACE_ROOT="$(node -e "try{const fs=require('fs');const p=JSON.parse(fs.readFileSync('.prism-preferences.json','utf8'));if(p.workspaceRoot)process.stdout.write(String(p.workspaceRoot));}catch{}")"
fi
PRISM_WORKSPACE_ROOT="${PRISM_WORKSPACE_ROOT:-$HOME/Documents/Prism_Refraction}"

PRISM_TOKEN_FILE="${PRISM_WORKSPACE_ROOT}/state/admin-token"
PRISM_AUTH_TOKEN=""
if [ -f "$PRISM_TOKEN_FILE" ]; then
    PRISM_AUTH_TOKEN="$(cat "$PRISM_TOKEN_FILE" 2>/dev/null || true)"
fi

PRISM_SETUP_URL="http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
if [ -n "$PRISM_AUTH_TOKEN" ]; then
    PRISM_SETUP_URL="http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true&token=${PRISM_AUTH_TOKEN}"
fi

wizard_selftest() {
    echo "[SELFTEST] Verifying wizard auth/token readiness..."
    if [ -z "$PRISM_AUTH_TOKEN" ]; then
        echo "[SELFTEST][WARN] Admin token not found at ${PRISM_TOKEN_FILE}."
        echo "[SELFTEST][WARN] Wizard will open; login may be required."
        return 0
    fi

    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "${PRISM_SETUP_URL}" || true)"
    if [ "$code" = "200" ] || [ "$code" = "302" ]; then
        echo "[SELFTEST][OK] Wizard endpoint responded with ${code}."
        return 0
    fi

    echo "[SELFTEST][WARN] Wizard endpoint returned ${code:-unknown}."
    echo "[SELFTEST][WARN] Opening login page fallback."
    PRISM_SETUP_URL="http://localhost:${PRISM_DASHBOARD_PORT}/login"
    return 0
}

# Check if server is already running
if curl -sf "http://localhost:${PRISM_DASHBOARD_PORT}/api/health" -o /dev/null --connect-timeout 2 2>/dev/null; then
    echo "[OK] PRISM server already running on port ${PRISM_DASHBOARD_PORT}."
    echo "[WIZARD] Launching Setup Wizard..."
    wizard_selftest
    # Try to open browser (platform-aware)
    if command -v xdg-open &>/dev/null; then
        xdg-open "${PRISM_SETUP_URL}"
    elif command -v open &>/dev/null; then
        open "${PRISM_SETUP_URL}"
    else
        echo "[INFO] Open ${PRISM_SETUP_URL} in your browser."
    fi
    exit 0
fi

echo "[START] Starting PRISM server..."
export PRISM_MODE=server
export PRISM_ENV_PROFILE="${PRISM_ENV_PROFILE:-dev}"
export PRISM_LLM_PROVIDER="${PRISM_LLM_PROVIDER:-ollama}"
export PRISM_LLM_MODEL="${PRISM_LLM_MODEL:-gemma3:1b}"

# Start server in background
npm start &
PRISM_PID=$!

echo "[WAIT] Waiting for PRISM server on port ${PRISM_DASHBOARD_PORT}..."
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${PRISM_DASHBOARD_PORT}/api/health" -o /dev/null --connect-timeout 1 2>/dev/null; then
        break
    fi
    sleep 1
done

if [ -z "$PRISM_AUTH_TOKEN" ]; then
    for i in $(seq 1 5); do
        if [ -f "$PRISM_TOKEN_FILE" ]; then
            PRISM_AUTH_TOKEN="$(cat "$PRISM_TOKEN_FILE" 2>/dev/null || true)"
            [ -n "$PRISM_AUTH_TOKEN" ] && break
        fi
        sleep 1
    done
fi

PRISM_SETUP_URL="http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
if [ -n "$PRISM_AUTH_TOKEN" ]; then
    PRISM_SETUP_URL="http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true&token=${PRISM_AUTH_TOKEN}"
fi

wizard_selftest

echo "[WIZARD] Launching Setup Wizard at http://localhost:${PRISM_DASHBOARD_PORT}/setup"
if command -v xdg-open &>/dev/null; then
    xdg-open "${PRISM_SETUP_URL}"
elif command -v open &>/dev/null; then
    open "${PRISM_SETUP_URL}"
else
    echo "[INFO] Open ${PRISM_SETUP_URL} in your browser."
fi

# Wait for the server process
wait "$PRISM_PID" 2>/dev/null || true
