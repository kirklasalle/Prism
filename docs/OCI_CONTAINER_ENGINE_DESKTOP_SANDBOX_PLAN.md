# Implementation Plan — World-Class OCI Container Engine Support for Governed Visual Desktop Sandbox

## Discovery Findings & Architecture Strategy

During environment probe:
1. **WSL2 Podman Engine is Available & Ready**:
   - `podman version 5.8.4` is installed inside WSL2 (`podman-machine-default`) with 26GB RAM and 4 CPUs allocated.
   - The workspace `D:\Projects\PrismRefraction` is mapped directly to `/mnt/d/Projects/PrismRefraction`.
   - Running container operations via WSL2 runs **100% headless in the background** with zero GUI windows and zero proprietary software requirements.
2. **Universal OCI CLI Executor (`OciCliExecutor`)**:
   - We will upgrade `DockerCliExecutor` in [`src/core/operator/desktop-sandbox-manager.ts`](file:///d:/Projects/PrismRefraction/src/core/operator/desktop-sandbox-manager.ts) into a multi-tier executor that probes and uses the best available backend:
     - **Tier 1**: Windows Docker daemon (`docker ...`)
     - **Tier 2**: Windows Podman CLI (`podman ...`)
     - **Tier 3**: WSL2 Podman Engine (`wsl -d podman-machine-default -u root -- podman ...`)
   - Any of these tiers executes the identical OCI commands (`build`, `run`, `exec`, `stop`, `commit`, `revert`).

---

## User Review Required

> [!IMPORTANT]
> The sandbox container will execute against real hardware resources (2 CPUs, 2048MB RAM, Debian 12 Bookworm Slim with Openbox + KasmVNC WebRTC + Chromium) in the background. No simulations will be used.

---

## Proposed Changes

### Core Operator & Sandbox Manager

#### [MODIFY] [`src/core/operator/desktop-sandbox-manager.ts`](file:///d:/Projects/PrismRefraction/src/core/operator/desktop-sandbox-manager.ts)
- Implement `OciCliExecutor` with multi-tier discovery (`docker`, `podman`, `wsl podman`).
- Add build image helper `buildImage()` to allow automated or one-click image compilation.
- Return detected engine and telemetry in `checkEngine()` / `getStatus()`.

#### [MODIFY] [`src/core/operator/routes/desktop-handler.ts`](file:///d:/Projects/PrismRefraction/src/core/operator/routes/desktop-handler.ts)
- Add `POST /api/sandbox/desktop/build-image` endpoint.
- Include active engine identification in `/api/sandbox/desktop/diagnostics` and `/api/sandbox/desktop/status`.

---

### Dashboard Frontend

#### [MODIFY] [`src/core/operator/public/tab-desktop.html`](file:///d:/Projects/PrismRefraction/src/core/operator/public/tab-desktop.html)
- Display active container engine badge in the top telemetry bar (e.g. `🦭 Podman (WSL2 Background)`).
- Add "Build Sandbox Image" status indicator and button if the image is not yet built.

#### [MODIFY] [`src/core/operator/public/tab-desktop.js`](file:///d:/Projects/PrismRefraction/src/core/operator/public/tab-desktop.js)
- Wire diagnostic engine metadata and build status to the UI.

---

## Verification Plan

### Automated Tests
- Run sandbox manager unit and integration tests:
  ```powershell
  npx tsx tests/desktop-sandbox-manager.test.ts
  ```

### Real Container Build & Live Desktop Validation
1. Trigger build of `prism-sandbox-desktop:debian-slim`.
2. Launch real sandbox container and verify:
   - WebRTC port `6080` and VNC port `5901` active.
   - Live X11/Xvfb display `:1` running Openbox.
   - Screen capture and input injection via `xdotool` in real container.
