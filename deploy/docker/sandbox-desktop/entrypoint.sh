#!/usr/bin/env bash
# ==============================================================================
# PRISM Governed Visual Desktop Sandbox — Entrypoint Supervisor
# ==============================================================================
set -e

# Clean up stale X11 lock files if container restarted
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

echo "[PRISM-SANDBOX] Initializing Virtual X11 Display on ${DISPLAY} (${RESOLUTION}x${COLOR_DEPTH})..."
echo "[PRISM-SANDBOX] Starting Xvfb, Openbox, x11vnc, and noVNC/WebRTC gateway..."

exec "$@"
