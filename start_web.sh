#!/usr/bin/env bash
# PRISM One-Click Startup (Linux / macOS)
# Usage: ./start_web.sh [build|test|release|strict]
set -euo pipefail

cd "$(dirname "$0")"

PRISM_PREFLIGHT_MODE="${1:-build}"

echo "================================================"
echo "PRISM One-Click Startup"
echo "================================================"

# ── Node.js checks ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js was not found on PATH."
  echo "Install Node.js 22+ and re-run this script."
  exit 1
fi

PRISM_NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ -z "$PRISM_NODE_MAJOR" ]; then
  echo "[ERROR] Unable to determine Node.js version."
  exit 1
fi
if [ "$PRISM_NODE_MAJOR" -lt 22 ]; then
  echo "[ERROR] Node.js 22+ is required. Detected major version $PRISM_NODE_MAJOR."
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "[ERROR] npm was not found on PATH."
  exit 1
fi

# ── Dependencies ──────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[SETUP] Installing dependencies..."
  npm install
fi

PRISM_DASHBOARD_PORT="${PRISM_DASHBOARD_PORT:-7070}"
export PRISM_DASHBOARD_PORT

# ── Kill previous instances ───────────────────────────────────────────
echo "[SETUP] Clearing any previous instances on port $PRISM_DASHBOARD_PORT..."
if command -v lsof &>/dev/null; then
  lsof -ti:"$PRISM_DASHBOARD_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
elif command -v fuser &>/dev/null; then
  fuser -k "$PRISM_DASHBOARD_PORT/tcp" 2>/dev/null || true
fi

# ── Build ─────────────────────────────────────────────────────────────
echo "[BUILD] Building PRISM..."
npm run build

# ── Workspace ─────────────────────────────────────────────────────────
if [ -z "${PRISM_WORKSPACE_ROOT:-}" ]; then
  PRISM_WORKSPACE_ROOT="$HOME/Documents/Prism_Refraction"
fi
export PRISM_WORKSPACE_ROOT
if [ ! -d "$PRISM_WORKSPACE_ROOT" ]; then
  echo "[WORKSPACE] Creating workspace at $PRISM_WORKSPACE_ROOT"
  mkdir -p "$PRISM_WORKSPACE_ROOT"
fi
echo "[WORKSPACE] $PRISM_WORKSPACE_ROOT"

# ── Preflight mode ────────────────────────────────────────────────────
case "$PRISM_PREFLIGHT_MODE" in
  build)
    ;;
  test)
    echo "[PREFLIGHT] Running full test suite..."
    npm test
    ;;
  release)
    echo "[PREFLIGHT] Running release validation..."
    npm run release:validate
    ;;
  strict)
    echo "[PREFLIGHT] Running strict release validation..."
    npm run release:validate:strict
    ;;
  *)
    echo "[ERROR] Unknown preflight mode: $PRISM_PREFLIGHT_MODE"
    echo "Usage: ./start_web.sh [build|test|release|strict]"
    exit 1
    ;;
esac

if [ "${PRISM_SKIP_LAUNCH:-}" = "1" ]; then
  echo "[INFO] PRISM_SKIP_LAUNCH=1 detected; startup checks completed, launch skipped."
  exit 0
fi

# ── Environment defaults ──────────────────────────────────────────────
export PRISM_MODE=server
export PRISM_ENV_PROFILE="${PRISM_ENV_PROFILE:-dev}"
export PRISM_LLM_PROVIDER="${PRISM_LLM_PROVIDER:-ollama}"
export PRISM_LLM_MODEL="${PRISM_LLM_MODEL:-gemma3:1b}"
export PRISM_OLLAMA_MODELS="${PRISM_OLLAMA_MODELS:-gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b}"

# ── Launch ────────────────────────────────────────────────────────────
echo "[START] Running PRISM server mode..."

# Check if PM2 is available and user wants managed mode
if command -v pm2 &>/dev/null && [ "${PRISM_USE_PM2:-}" != "0" ]; then
  echo "[PM2] PM2 detected. Starting with process management..."
  echo "[PM2] To disable: export PRISM_USE_PM2=0"
  mkdir -p logs
  pm2 start ecosystem.config.js
  echo "[PM2] PRISM launched via PM2. Use 'pm2 logs prism' or 'npm run pm2:monit' to monitor."
else
  npm start &
  PRISM_PID=$!
fi

echo "[WAIT] Waiting for PRISM server to be ready on port $PRISM_DASHBOARD_PORT..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PRISM_DASHBOARD_PORT/health" >/dev/null 2>&1; then
    echo "[START] PRISM is ready at http://localhost:$PRISM_DASHBOARD_PORT"
    # Open browser on macOS or Linux
    if command -v open &>/dev/null; then
      open "http://localhost:$PRISM_DASHBOARD_PORT"
    elif command -v xdg-open &>/dev/null; then
      xdg-open "http://localhost:$PRISM_DASHBOARD_PORT"
    fi
    if [ -n "${PRISM_PID:-}" ]; then
      wait $PRISM_PID
    fi
    exit 0
  fi
  sleep 1
done

echo "[ERROR] Timed out waiting for server to start."
if [ -n "${PRISM_PID:-}" ]; then
  kill $PRISM_PID 2>/dev/null || true
fi
exit 1
