#!/usr/bin/env bash
# scripts/restore.sh — PRISM workspace restore (POSIX).
#
# Usage:
#   ./restore.sh <archive> [<workspace>] [--force]
#
# Refuses to overwrite a non-empty existing workspace unless --force is
# passed.

set -euo pipefail

FORCE=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

ARCHIVE="${ARGS[0]:-}"
WORKSPACE="${ARGS[1]:-${PRISM_WORKSPACE_ROOT:-$HOME/Prism_Refraction}}"

if [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 <archive> [<workspace>] [--force]" >&2
  exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "[restore] archive not found: $ARCHIVE" >&2
  exit 2
fi

if [ -d "$WORKSPACE" ] && [ "$(ls -A "$WORKSPACE" 2>/dev/null | wc -l)" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
  echo "[restore] workspace not empty: $WORKSPACE"
  echo "[restore] re-run with --force to overwrite. Refusing."
  exit 3
fi

mkdir -p "$WORKSPACE"
echo "[restore] archive   : $ARCHIVE"
echo "[restore] workspace : $WORKSPACE"

tar -xzf "$ARCHIVE" -C "$(dirname "$WORKSPACE")"

echo "[restore] OK"
exit 0
