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

if [ ! -d "dist" ]; then
    echo "[BUILD] Building PRISM..."
    npm run build || exit 1
fi

PRISM_DASHBOARD_PORT="${PRISM_DASHBOARD_PORT:-7070}"

# Check if server is already running
if curl -sf "http://localhost:${PRISM_DASHBOARD_PORT}/api/health" -o /dev/null --connect-timeout 2 2>/dev/null; then
    echo "[OK] PRISM server already running on port ${PRISM_DASHBOARD_PORT}."
    echo "[WIZARD] Launching Setup Wizard..."
    # Try to open browser (platform-aware)
    if command -v xdg-open &>/dev/null; then
        xdg-open "http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
    elif command -v open &>/dev/null; then
        open "http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
    else
        echo "[INFO] Open http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true in your browser."
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

echo "[WIZARD] Launching Setup Wizard at http://localhost:${PRISM_DASHBOARD_PORT}/setup"
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
elif command -v open &>/dev/null; then
    open "http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true"
else
    echo "[INFO] Open http://localhost:${PRISM_DASHBOARD_PORT}/setup?rerun=true in your browser."
fi

# Wait for the server process
wait "$PRISM_PID" 2>/dev/null || true
