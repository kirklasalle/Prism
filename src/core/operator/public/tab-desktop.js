/**
 * @file tab-desktop.js
 * @description Frontend Controller for Governed Visual Desktop Sandbox (Phase V).
 */

(function () {
  class PrismDesktopController {
    constructor() {
      this.pollInterval = null;
      this.currentStatus = null;
      this.isPiPActive = false;
      this.burstAnimationInterval = null;
      this.burstFrames = [];
      this.currentFrameIdx = 0;
      this.activityLogEntries = [];
      this.previousState = null;
    }

    init() {
      this.logDesktopEvent('info', 'Desktop Sandbox controller initialized');
      this.refreshStatus();
      this.startPolling();
      this.setupPiPContainer();
    }

    /**
     * Log a desktop sandbox event to both the local activity trail and the central dashboard log
     */
    logDesktopEvent(severity, message, details) {
      const ts = new Date().toLocaleTimeString();
      const entry = { ts, severity, message };
      this.activityLogEntries.push(entry);
      if (this.activityLogEntries.length > 500) this.activityLogEntries = this.activityLogEntries.slice(-500);

      // Emit to central dashboard log system (Logs & Debug tab)
      if (typeof window.dashboardLog === 'function') {
        window.dashboardLog('desktop', message, details || message, severity);
      }

      // Console trace for developer debugging
      const prefix = '[PrismDesktop]';
      if (severity === 'error') console.error(prefix, message, details || '');
      else if (severity === 'warn') console.warn(prefix, message, details || '');
      else console.log(prefix, message, details || '');

      this.renderActivityLog();
    }

    renderActivityLog() {
      const container = document.getElementById('desktop-activity-log');
      const counter = document.getElementById('desktop-log-count');
      if (!container) return;

      if (counter) counter.innerText = `${this.activityLogEntries.length} entries`;

      if (!this.activityLogEntries.length) {
        container.innerHTML = '<div class="muted" style="font-size:10px; text-align:center; padding:8px;">No desktop sandbox events yet.</div>';
        return;
      }

      const sevColor = (s) => s === 'error' ? '#f87171' : s === 'warn' ? '#fbbf24' : s === 'success' ? '#34d399' : '#94a3b8';
      const sevIcon = (s) => s === 'error' ? '❌' : s === 'warn' ? '⚠️' : s === 'success' ? '✅' : 'ℹ️';

      container.innerHTML = this.activityLogEntries.slice(-100).map(e =>
        `<div style="display:flex; gap:6px; align-items:baseline; padding:1px 0; border-bottom:1px solid rgba(255,255,255,0.03);">`
        + `<span style="color:#64748b; font-size:9px; min-width:65px;">${e.ts}</span>`
        + `<span style="font-size:10px;">${sevIcon(e.severity)}</span>`
        + `<span style="color:${sevColor(e.severity)};">${e.message}</span>`
        + `</div>`
      ).join('');

      container.scrollTop = container.scrollHeight;
    }

    clearActivityLog() {
      this.activityLogEntries = [];
      this.renderActivityLog();
    }

    startPolling() {
      if (this.pollInterval) clearInterval(this.pollInterval);
      this.pollInterval = setInterval(() => {
        const desktopTab = document.getElementById("tab-desktop");
        if ((desktopTab && desktopTab.classList.contains("active")) || this.isPiPActive) {
          this.refreshStatus();
        }
      }, 5000);
    }

    getHeaders(extra) {
      const meta = document.querySelector('meta[name="prism-auth-token"]');
      const token = meta ? meta.getAttribute('content') || '' : '';
      const headers = Object.assign({}, extra || {});
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return headers;
    }

    showAlert(message) {
      const banner = document.getElementById("sandbox-alert-banner");
      const msgEl = document.getElementById("sandbox-alert-message");
      if (banner && msgEl) {
        msgEl.innerText = message;
        banner.style.display = "flex";
      }
    }

    hideAlert() {
      const banner = document.getElementById("sandbox-alert-banner");
      if (banner) banner.style.display = "none";
    }

    async refreshStatus() {
      try {
        const res = await fetch("/api/sandbox/desktop/status", {
          headers: this.getHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.status) {
          // Log state transitions
          if (this.previousState && this.previousState !== data.status.state) {
            this.logDesktopEvent(
              data.status.state === 'ERROR' ? 'error' : 'info',
              `State transition: ${this.previousState} → ${data.status.state}`,
              `Container: ${data.status.containerId || 'none'}`
            );
          }
          this.previousState = data.status.state;
          this.currentStatus = data.status;
          this.renderStatus(data.status);
        }
      } catch (err) {
        console.warn("[PrismDesktop] Failed to fetch status:", err);
      }
    }

    renderStatus(status) {
      const indicator = document.getElementById("sandbox-status-indicator");
      const statusText = document.getElementById("sandbox-status-text");
      const startBtn = document.getElementById("btn-sandbox-start");
      const stopBtn = document.getElementById("btn-sandbox-stop");
      const vncFrame = document.getElementById("desktop-vnc-frame");
      const simCanvas = document.getElementById("desktop-sim-canvas");
      const placeholder = document.getElementById("desktop-placeholder");
      const takeoverBanner = document.getElementById("takeover-active-banner");
      const simBadge = document.getElementById("sbx-simulation-badge");
      const engineBadge = document.getElementById("sbx-engine-badge");
      const buildBtn = document.getElementById("btn-build-image");

      const autoBtn = document.getElementById("btn-mode-autonomous");
      const takeoverBtn = document.getElementById("btn-mode-takeover");

      if (simBadge) {
        simBadge.style.display = status.isMock ? "inline-block" : "none";
      }

      if (engineBadge) {
        if (status.isMock) {
          engineBadge.style.display = "none";
        } else {
          engineBadge.style.display = "inline-block";
          const name = status.engineName || "OCI Engine";
          engineBadge.innerText = name.includes("Podman") ? `🦭 ${name}` : `🐳 ${name}`;
        }
      }

      if (buildBtn) {
        buildBtn.style.display = (status.lastError && (status.lastError.includes("not built") || status.lastError.includes("image"))) ? "inline-block" : "none";
      }

      if (status.lastError) {
        this.showAlert(status.lastError);
      } else {
        this.hideAlert();
      }

      if (indicator) {
        indicator.style.background = status.state === "RUNNING" ? "#22c55e" :
          status.state === "HELD_FOR_OPERATOR" ? "#ef4444" :
          status.state === "STARTING" ? "#f59e0b" :
          status.state === "ERROR" ? "#f87171" : "#94a3b8";
      }

      if (statusText) {
        statusText.innerText = status.state;
        statusText.style.color = status.state === "RUNNING" ? "#34d399" :
          status.state === "HELD_FOR_OPERATOR" ? "#f87171" :
          status.state === "ERROR" ? "#f87171" : "#cbd5e1";
      }

      if (startBtn && stopBtn) {
        if (status.state === "RUNNING" || status.state === "HELD_FOR_OPERATOR") {
          startBtn.style.display = "none";
          stopBtn.style.display = "inline-block";
        } else {
          startBtn.style.display = "inline-block";
          stopBtn.style.display = "none";
        }
      }

      const reloadBtn = document.getElementById("btn-sandbox-reload");
      if (reloadBtn) {
        reloadBtn.style.display = (status.state === "RUNNING" || status.state === "HELD_FOR_OPERATOR") ? "inline-block" : "none";
      }

      if (status.state === "RUNNING" || status.state === "HELD_FOR_OPERATOR") {
        if (placeholder) placeholder.style.display = "none";
        if (status.isMock) {
          if (vncFrame) vncFrame.style.display = "none";
          if (simCanvas) {
            simCanvas.style.display = "block";
            this.refreshSimScreenshot();
          }
        } else {
          if (simCanvas) simCanvas.style.display = "none";
          if (vncFrame) {
            vncFrame.style.display = "block";
            if (vncFrame.src === "about:blank" || !vncFrame.src.includes(String(status.webRtcPort))) {
              vncFrame.src = status.streamUrl;
              this.logDesktopEvent('info', `VNC stream connecting → localhost:${status.webRtcPort}`);
              this.checkVncConnectivity(vncFrame, status);
            }
          }
        }
      } else {
        this._streamReadyLoaded = false;
        if (vncFrame) vncFrame.style.display = "none";
        if (simCanvas) simCanvas.style.display = "none";
        if (placeholder) placeholder.style.display = "flex";
      }

      if (takeoverBanner) {
        takeoverBanner.style.display = status.activeMode === "operator_takeover" ? "block" : "none";
      }

      // Update mode buttons
      if (autoBtn && takeoverBtn) {
        if (status.activeMode === "operator_takeover") {
          autoBtn.style.background = "transparent";
          autoBtn.style.color = "#94a3b8";
          takeoverBtn.style.background = "var(--error, #ef4444)";
          takeoverBtn.style.color = "#fff";
        } else {
          autoBtn.style.background = "var(--accent, #3b82f6)";
          autoBtn.style.color = "#fff";
          takeoverBtn.style.background = "transparent";
          takeoverBtn.style.color = "#94a3b8";
        }
      }

      // Update meta telemetry
      const resEl = document.getElementById("sbx-meta-res");
      const cidEl = document.getElementById("sbx-meta-cid");
      const upEl = document.getElementById("sbx-meta-uptime");
      const portEl = document.getElementById("sbx-meta-port");

      if (resEl) resEl.innerText = status.resolution;
      if (cidEl) cidEl.innerText = status.containerId || "--";
      if (upEl) upEl.innerText = `${status.uptimeSeconds}s`;
      if (portEl) portEl.innerText = status.isMock ? "Mock Loopback (Simulation)" : `${status.webRtcPort} (WebRTC) / ${status.vncPort} (VNC)`;

      this.renderSnapshots(status.snapshots || []);
    }

    reloadStream() {
      const vncFrame = document.getElementById("desktop-vnc-frame");
      if (vncFrame && this.currentStatus && this.currentStatus.streamUrl) {
        this.logDesktopEvent('info', 'Reloading VNC stream viewport...');
        vncFrame.src = "about:blank";
        setTimeout(() => {
          vncFrame.src = this.currentStatus.streamUrl + (this.currentStatus.streamUrl.includes('?') ? '&' : '?') + '_r=' + Date.now();
          this.logDesktopEvent('success', 'VNC stream reloaded');
        }, 150);
      }
    }

    async refreshSimScreenshot() {
      try {
        const res = await fetch("/api/sandbox/desktop/screenshot", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok && data.base64) {
          const simCanvas = document.getElementById("desktop-sim-canvas");
          if (simCanvas) {
            simCanvas.src = data.base64.startsWith("data:") ? data.base64 : (
              data.base64.startsWith("PHN2Zy") || data.base64.startsWith("PD94b")
                ? `data:image/svg+xml;base64,${data.base64}`
                : `data:image/png;base64,${data.base64}`
            );
          }
        }
      } catch (_) {}
    }

    renderSnapshots(snapshots) {
      const container = document.getElementById("snapshot-list-container");
      if (!container) return;

      if (!snapshots.length) {
        container.innerHTML = '<div class="muted" style="font-size:11px; text-align:center; padding:12px;">No checkpoints created</div>';
        return;
      }

      container.innerHTML = snapshots.slice().reverse().map(snap => `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
            <span style="font-weight:600; font-size:11px; color:#f1f5f9; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${snap.name}</span>
            <span class="muted" style="font-size:9px;">${new Date(snap.createdAt).toLocaleTimeString()} · ${snap.id}</span>
          </div>
          <button class="secondary-button" onclick="window.prismDesktop.revertSnapshot('${snap.id}')" style="font-size:9px; padding:3px 6px; color:#38bdf8;" title="Revert container to this checkpoint">
            ⏪ Revert
          </button>
        </div>
      `).join("");
    }

    /**
     * Check if VNC iframe is reachable; if WSL2 port forwarding fails, show diagnostic overlay
     */
    checkVncConnectivity(vncFrame, status) {
      if (this._vncCheckTimer) clearTimeout(this._vncCheckTimer);
      this._vncCheckTimer = setTimeout(() => {
        try {
          fetch(`http://localhost:${status.webRtcPort}/vnc.html`, { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
            .then(() => {
              this.logDesktopEvent('success', `VNC stream reachable on port ${status.webRtcPort}`);
              const overlay = document.getElementById('vnc-diag-overlay');
              if (overlay) overlay.remove();
              if (vncFrame && (!this._streamReadyLoaded || vncFrame.src.includes('about:blank'))) {
                this._streamReadyLoaded = true;
                vncFrame.src = status.streamUrl;
              }
            })
            .catch(() => {
              this.logDesktopEvent('warn', `VNC port ${status.webRtcPort} initializing...`);
              this._vncCheckTimer = setTimeout(() => this.checkVncConnectivity(vncFrame, status), 1500);
            });
        } catch (_) {}
      }, 1000);
    }

    async toggleSimulationMode() {
      this.logDesktopEvent('info', 'Toggling simulation mode...');
      try {
        const res = await fetch("/api/sandbox/desktop/toggle-mock", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.ok) {
          this.hideAlert();
          // Remove VNC diagnostic overlay if present
          const overlay = document.getElementById('vnc-diag-overlay');
          if (overlay) overlay.remove();
          this.logDesktopEvent('success', `Simulation mode ${data.isMock ? 'ENABLED' : 'DISABLED'}`);
          this.refreshStatus();
        }
      } catch (e) {
        this.logDesktopEvent('error', `Failed to toggle simulation mode: ${e.message}`);
      }
    }

    async startSandbox() {
      this.logDesktopEvent('info', 'Starting sandbox container...');
      try {
        const res = await fetch("/api/sandbox/desktop/start", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          this.hideAlert();
          this.logDesktopEvent('success', `Sandbox started — Container ID: ${data.status?.containerId || 'unknown'}`, `Port ${data.status?.webRtcPort || 6080}`);
          this.refreshStatus();
        } else {
          this.logDesktopEvent('error', `Start failed: ${data.error || 'Unknown error'}`);
          this.showAlert(data.error || "Failed to start desktop sandbox");
          if (data.status) this.renderStatus(data.status);
        }
      } catch (e) {
        this.logDesktopEvent('error', `Start exception: ${e.message}`);
        this.showAlert(`Error: ${e.message}`);
      }
    }

    async stopSandbox() {
      if (!confirm("Are you sure you want to stop the sandbox container?")) return;
      this.logDesktopEvent('info', 'Stopping sandbox container...');
      try {
        const res = await fetch("/api/sandbox/desktop/stop", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          this.hideAlert();
          // Remove VNC diagnostic overlay if present
          const overlay = document.getElementById('vnc-diag-overlay');
          if (overlay) overlay.remove();
          this.logDesktopEvent('success', 'Sandbox container stopped');
          this.refreshStatus();
        }
      } catch (e) {
        this.logDesktopEvent('error', `Stop failed: ${e.message}`);
        this.showAlert(`Error: ${e.message}`);
      }
    }

    async setMode(mode) {
      this.logDesktopEvent('info', `Switching to ${mode === 'operator_takeover' ? '🕹️ Operator Takeover' : '🤖 Autonomous'} mode`);
      try {
        const res = await fetch("/api/sandbox/desktop/mode", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.ok) {
          this.logDesktopEvent('success', `Mode set → ${data.mode || mode}`);
          this.refreshStatus();
        }
      } catch (e) {
        this.logDesktopEvent('error', `Mode switch failed: ${e.message}`);
      }
    }

    async promptSnapshot() {
      const name = prompt("Enter a name for this checkpoint snapshot:", `Checkpoint ${new Date().toLocaleTimeString()}`);
      if (!name) return;
      this.logDesktopEvent('info', `Creating checkpoint snapshot: "${name}"`);
      try {
        const res = await fetch("/api/sandbox/desktop/snapshot", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.ok) {
          this.logDesktopEvent('success', `Snapshot created: ${data.snapshot?.id || 'ok'} — "${name}"`);
          this.refreshStatus();
        } else {
          this.logDesktopEvent('error', `Snapshot failed: ${data.error}`);
          this.showAlert(`Snapshot failed: ${data.error}`);
        }
      } catch (e) {
        this.logDesktopEvent('error', `Snapshot exception: ${e.message}`);
        this.showAlert(`Error: ${e.message}`);
      }
    }

    async revertSnapshot(snapshotId) {
      if (!confirm(`Revert sandbox container state to checkpoint [${snapshotId}]? Any uncommitted changes will be wiped.`)) return;
      this.logDesktopEvent('warn', `Reverting to snapshot: ${snapshotId}`);
      try {
        const res = await fetch("/api/sandbox/desktop/revert", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ snapshotId })
        });
        const data = await res.json();
        if (data.ok) {
          this.logDesktopEvent('success', `Reverted to snapshot ${snapshotId} — new container: ${data.status?.containerId || 'ok'}`);
          this.refreshStatus();
        } else {
          this.logDesktopEvent('error', `Revert failed: ${data.error}`);
          this.showAlert(`Revert failed: ${data.error}`);
        }
      } catch (e) {
        this.logDesktopEvent('error', `Revert exception: ${e.message}`);
        this.showAlert(`Error: ${e.message}`);
      }
    }

    async resetSandbox() {
      if (!confirm("Wipe and reset the entire visual desktop sandbox to fresh clean baseline?")) return;
      this.logDesktopEvent('warn', 'Resetting sandbox (full wipe & restart)...');
      try {
        const res = await fetch("/api/sandbox/desktop/reset", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) {
          this.logDesktopEvent('success', `Sandbox reset complete — new container: ${data.status?.containerId || 'ok'}`);
          this.refreshStatus();
        }
      } catch (e) {
        this.logDesktopEvent('error', `Reset failed: ${e.message}`);
        this.showAlert(`Error: ${e.message}`);
      }
    }

    async captureBurst() {
      const previewContainer = document.getElementById("burst-preview-container");
      const counter = document.getElementById("burst-frame-counter");
      const shaEl = document.getElementById("burst-sha-digest");

      this.logDesktopEvent('info', 'Capturing action burst (10 frames @ 10fps)...');
      if (counter) counter.innerText = "Grabbing...";
      try {
        const res = await fetch("/api/sandbox/desktop/burst", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ durationMs: 1000, fps: 10 })
        });
        const data = await res.json();
        if (data.ok && data.burst && data.burst.frames && data.burst.frames.length > 0) {
          this.burstFrames = data.burst.frames;
          if (counter) counter.innerText = `${data.burst.frameCount} frames (${data.burst.fps}fps)`;
          if (shaEl) shaEl.innerText = `SHA-256: ${data.burst.digestSha256.slice(0, 24)}…`;
          this.logDesktopEvent('success', `Burst captured: ${data.burst.frameCount} frames, SHA-256: ${data.burst.digestSha256.slice(0, 16)}…`);

          this.startBurstPlayback(previewContainer);
        } else {
          this.logDesktopEvent('error', 'Burst capture failed — no frames returned');
          if (counter) counter.innerText = "Failed";
        }
      } catch (e) {
        this.logDesktopEvent('error', `Burst capture error: ${e.message}`);
        if (counter) counter.innerText = "Error";
      }
    }

    startBurstPlayback(container) {
      if (this.burstAnimationInterval) clearInterval(this.burstAnimationInterval);
      if (!container || !this.burstFrames.length) return;

      const formatSrc = (raw) => {
        if (raw.startsWith("data:")) return raw;
        if (raw.startsWith("PHN2Zy") || raw.startsWith("PD94b")) return `data:image/svg+xml;base64,${raw}`;
        return `data:image/png;base64,${raw}`;
      };

      this.currentFrameIdx = 0;
      container.innerHTML = `<img id="burst-anim-img" src="${formatSrc(this.burstFrames[0])}" style="width:100%; height:100%; object-fit:contain;" />`;
      const img = document.getElementById("burst-anim-img");

      this.burstAnimationInterval = setInterval(() => {
        this.currentFrameIdx = (this.currentFrameIdx + 1) % this.burstFrames.length;
        if (img) img.src = formatSrc(this.burstFrames[this.currentFrameIdx]);
      }, 100);
    }

    setupPiPContainer() {
      let pip = document.getElementById("prism-desktop-pip");
      if (!pip) {
        pip = document.createElement("div");
        pip.id = "prism-desktop-pip";
        pip.style.cssText = "position:fixed; bottom:20px; right:20px; width:280px; height:160px; background:#000; border:2px solid var(--accent, #3b82f6); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.6); z-index:9999; display:none; flex-direction:column; overflow:hidden;";
        pip.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.8); padding:4px 8px; font-size:10px; font-weight:700; color:#fff;">
            <span>🖥️ Sandbox Live</span>
            <div style="display:flex; gap:4px;">
              <button onclick="window.prismDesktop.expandPiP()" style="background:none; border:none; color:#38bdf8; cursor:pointer; font-size:11px;" title="Expand to Full Tab">🗖</button>
              <button onclick="window.prismDesktop.togglePiP()" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:11px;" title="Close PiP">&times;</button>
            </div>
          </div>
          <iframe id="pip-vnc-frame" style="width:100%; flex:1; border:none; background:#000;" src="about:blank"></iframe>
        `;
        document.body.appendChild(pip);
      }
    }

    togglePiP() {
      const pip = document.getElementById("prism-desktop-pip");
      const pipFrame = document.getElementById("pip-vnc-frame");
      if (!pip) return;

      this.isPiPActive = !this.isPiPActive;
      if (this.isPiPActive) {
        pip.style.display = "flex";
        if (pipFrame && this.currentStatus && this.currentStatus.streamUrl) {
          pipFrame.src = this.currentStatus.streamUrl;
        }
      } else {
        pip.style.display = "none";
        if (pipFrame) pipFrame.src = "about:blank";
      }
    }

    expandPiP() {
      this.togglePiP();
      const tabBtn = document.getElementById("tab-button-desktop");
      if (tabBtn) tabBtn.click();
    }

    async buildImage() {
      const buildBtn = document.getElementById("btn-build-image");
      if (buildBtn) {
        buildBtn.disabled = true;
        buildBtn.innerText = "⏳ Building...";
      }
      this.logDesktopEvent('info', 'Building sandbox container image (Debian 12 Bookworm + Openbox + KasmVNC)...');
      this.showAlert("Building sandbox container image (Debian 12 Bookworm + Openbox + KasmVNC)... this may take 1-2 minutes.");
      try {
        const res = await fetch("/api/sandbox/desktop/build-image", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.ok) {
          this.hideAlert();
          this.logDesktopEvent('success', 'Sandbox container image built successfully');
          this.refreshStatus();
          alert("Sandbox image built successfully!");
        } else {
          this.logDesktopEvent('error', `Build failed: ${data.error || 'Unknown error'}`);
          this.showAlert("Build failed: " + (data.error || "Unknown error"));
        }
      } catch (err) {
        this.logDesktopEvent('error', `Build request error: ${err.message}`);
        this.showAlert("Build request error: " + err.message);
      } finally {
        if (buildBtn) {
          buildBtn.disabled = false;
          buildBtn.innerText = "🔨 Build Image";
        }
      }
    }
  }

  window.prismDesktop = new PrismDesktopController();
  window.prismDesktop.init();
})();
