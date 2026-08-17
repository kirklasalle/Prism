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
    }

    init() {
      this.refreshStatus();
      this.startPolling();
      this.setupPiPContainer();
    }

    startPolling() {
      if (this.pollInterval) clearInterval(this.pollInterval);
      this.pollInterval = setInterval(() => {
        // Poll every 5s if tab is active or PiP is active
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

    async refreshStatus() {
      try {
        const res = await fetch("/api/sandbox/desktop/status", {
          headers: this.getHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && data.status) {
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
      const placeholder = document.getElementById("desktop-placeholder");
      const takeoverBanner = document.getElementById("takeover-active-banner");

      const autoBtn = document.getElementById("btn-mode-autonomous");
      const takeoverBtn = document.getElementById("btn-mode-takeover");

      if (indicator) {
        indicator.style.background = status.state === "RUNNING" ? "#22c55e" :
          status.state === "HELD_FOR_OPERATOR" ? "#ef4444" :
          status.state === "STARTING" ? "#f59e0b" : "#94a3b8";
      }

      if (statusText) {
        statusText.innerText = status.state;
        statusText.style.color = status.state === "RUNNING" ? "#34d399" :
          status.state === "HELD_FOR_OPERATOR" ? "#f87171" : "#cbd5e1";
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

      if (vncFrame && placeholder) {
        if (status.state === "RUNNING" || status.state === "HELD_FOR_OPERATOR") {
          placeholder.style.display = "none";
          vncFrame.style.display = "block";
          if (vncFrame.src === "about:blank" || !vncFrame.src.includes(String(status.webRtcPort))) {
            vncFrame.src = status.streamUrl;
          }
        } else {
          vncFrame.style.display = "none";
          placeholder.style.display = "flex";
        }
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
      if (portEl) portEl.innerText = `${status.webRtcPort} (WebRTC) / ${status.vncPort} (VNC)`;

      this.renderSnapshots(status.snapshots || []);
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

    async startSandbox() {
      try {
        const res = await fetch("/api/sandbox/desktop/start", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
        else alert(`Failed to start sandbox: ${data.error}`);
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async stopSandbox() {
      if (!confirm("Are you sure you want to stop the sandbox container?")) return;
      try {
        const res = await fetch("/api/sandbox/desktop/stop", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async setMode(mode) {
      try {
        const res = await fetch("/api/sandbox/desktop/mode", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
      } catch (e) {
        console.error("Failed to set mode:", e);
      }
    }

    async promptSnapshot() {
      const name = prompt("Enter a name for this checkpoint snapshot:", `Checkpoint ${new Date().toLocaleTimeString()}`);
      if (!name) return;
      try {
        const res = await fetch("/api/sandbox/desktop/snapshot", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
        else alert(`Snapshot failed: ${data.error}`);
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async revertSnapshot(snapshotId) {
      if (!confirm(`Revert sandbox container state to checkpoint [${snapshotId}]? Any uncommitted changes will be wiped.`)) return;
      try {
        const res = await fetch("/api/sandbox/desktop/revert", {
          method: "POST",
          headers: this.getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ snapshotId })
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
        else alert(`Revert failed: ${data.error}`);
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async resetSandbox() {
      if (!confirm("Wipe and reset the entire visual desktop sandbox to fresh clean baseline?")) return;
      try {
        const res = await fetch("/api/sandbox/desktop/reset", {
          method: "POST",
          headers: this.getHeaders()
        });
        const data = await res.json();
        if (data.ok) this.refreshStatus();
      } catch (e) {
        alert(`Error: ${e.message}`);
      }
    }

    async captureBurst() {
      const previewContainer = document.getElementById("burst-preview-container");
      const counter = document.getElementById("burst-frame-counter");
      const shaEl = document.getElementById("burst-sha-digest");

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

          this.startBurstPlayback(previewContainer);
        } else {
          if (counter) counter.innerText = "Failed";
        }
      } catch (e) {
        if (counter) counter.innerText = "Error";
      }
    }

    startBurstPlayback(container) {
      if (this.burstAnimationInterval) clearInterval(this.burstAnimationInterval);
      if (!container || !this.burstFrames.length) return;

      this.currentFrameIdx = 0;
      container.innerHTML = `<img id="burst-anim-img" src="data:image/png;base64,${this.burstFrames[0]}" style="width:100%; height:100%; object-fit:contain;" />`;
      const img = document.getElementById("burst-anim-img");

      this.burstAnimationInterval = setInterval(() => {
        this.currentFrameIdx = (this.currentFrameIdx + 1) % this.burstFrames.length;
        if (img) img.src = `data:image/png;base64,${this.burstFrames[this.currentFrameIdx]}`;
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
  }

  window.prismDesktop = new PrismDesktopController();
  window.prismDesktop.init();
})();
