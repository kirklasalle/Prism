#!/usr/bin/env bash
# update.sh — PRISM One-Click Update Utility.
#
# Usage:
#   ./update.sh [--force-branch] [--from-guardian]

set -euo pipefail

cd "$(dirname "$0")"

echo "================================================"
echo "PRISM One-Click Update Utility"
echo "================================================"

if ! command -v node &> /dev/null; then
  echo "[ERROR] Node.js was not found on PATH." >&2
  echo "Install Node.js 22+ to run updates." >&2
  exit 1
fi

echo "[START] Running Prism update orchestrator..."
node scripts/prism-update.cjs "$@"

echo "[SUCCESS] Prism update completed successfully."
exit 0
