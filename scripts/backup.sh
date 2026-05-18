#!/usr/bin/env bash
# scripts/backup.sh — PRISM workspace backup (POSIX).
#
# Resolves the workspace via:
#   1. positional argument — ./backup.sh <workspace> [<archive>]
#   2. PRISM_WORKSPACE_ROOT env var
#   3. fallback            — $HOME/Prism_Refraction
#
# Produces a timestamped .tgz archive.

set -euo pipefail

WORKSPACE="${1:-${PRISM_WORKSPACE_ROOT:-$HOME/Prism_Refraction}}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUTPUT="${2:-./prism-backup-$STAMP.tgz}"

if [ ! -d "$WORKSPACE" ]; then
  echo "[backup] workspace not found: $WORKSPACE" >&2
  exit 2
fi

echo "[backup] workspace : $WORKSPACE"
echo "[backup] archive   : $OUTPUT"

tar -czf "$OUTPUT" -C "$(dirname "$WORKSPACE")" "$(basename "$WORKSPACE")"

SIZE=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT")
SIZE_MB=$(awk "BEGIN { printf \"%.2f\", $SIZE / 1048576 }")
echo "[backup] OK (${SIZE_MB} MiB)"
exit 0
