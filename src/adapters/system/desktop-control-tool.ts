/**
 * @file desktop-control-tool.ts
 * @description Tool Adapter for PRISM Governed Visual Desktop Sandbox (Phase V).
 * Exposes mouse, keyboard, window, screenshot, and direct framebuffer burst grabbing
 * capabilities to autonomous agents, strictly governed by the 3-Tier Policy Interceptor.
 */

import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import { DesktopSandboxManager, DesktopInputAction, BurstCaptureOptions } from "../../core/operator/desktop-sandbox-manager.js";

export class DesktopControlTool implements Tool {
  public readonly name = "desktop_control";
  private sandboxManager: DesktopSandboxManager;

  public readonly governance: GovernanceSchema = {
    actions: {
      desktop_status: { minimumRisk: "low", mutating: false, rollbackRequired: false },
      desktop_screenshot: { minimumRisk: "low", mutating: false, rollbackRequired: false },
      desktop_capture_burst: { minimumRisk: "low", mutating: false, rollbackRequired: false },
      desktop_click: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_type: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_key: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_scroll: { minimumRisk: "low", mutating: true, rollbackRequired: false },
      desktop_drag: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_start: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_stop: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_mode: { minimumRisk: "high", mutating: true, rollbackRequired: false },
      desktop_snapshot: { minimumRisk: "medium", mutating: true, rollbackRequired: false },
      desktop_revert: { minimumRisk: "high", mutating: true, rollbackRequired: true }
    }
  };

  constructor(sandboxManager: DesktopSandboxManager) {
    this.sandboxManager = sandboxManager;
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    const op = request.operation;
    const args = request.args || {};

    try {
      switch (op) {
        case "desktop_status": {
          const status = this.sandboxManager.getStatus();
          return {
            ok: true,
            output: { status }
          };
        }

        case "desktop_start": {
          const status = await this.sandboxManager.startSandbox();
          return {
            ok: true,
            output: {
              message: "Visual Desktop Sandbox started successfully",
              status
            },
            sideEffects: [{
              type: "process",
              description: `Started sandbox container on ports VNC:${status.vncPort}, WebRTC:${status.webRtcPort}`,
              mutating: true,
              reversible: true
            }]
          };
        }

        case "desktop_stop": {
          await this.sandboxManager.stopSandbox();
          return {
            ok: true,
            output: { message: "Visual Desktop Sandbox stopped" },
            sideEffects: [{
              type: "process",
              description: "Stopped and cleared sandbox container",
              mutating: true,
              reversible: true
            }]
          };
        }

        case "desktop_mode": {
          const mode = (args.mode as "autonomous" | "operator_takeover") || "autonomous";
          const status = await this.sandboxManager.setControlMode(mode);
          return {
            ok: true,
            output: {
              message: `Control mode switched to ${mode}`,
              activeMode: status.activeMode,
              state: status.state
            }
          };
        }

        case "desktop_click": {
          const action: DesktopInputAction = {
            type: args.double ? "double_click" : args.right ? "right_click" : "click",
            x: typeof args.x === "number" ? args.x : 0,
            y: typeof args.y === "number" ? args.y : 0,
            button: (args.button as 1 | 2 | 3) || 1
          };
          const res = await this.sandboxManager.executeInputAction(action);
          return {
            ok: res.success,
            output: { ...res }
          };
        }

        case "desktop_type": {
          const action: DesktopInputAction = {
            type: "type",
            text: String(args.text || "")
          };
          const res = await this.sandboxManager.executeInputAction(action);
          return {
            ok: res.success,
            output: { ...res }
          };
        }

        case "desktop_key": {
          const action: DesktopInputAction = {
            type: "key",
            keyCombination: String(args.key || args.keyCombination || "")
          };
          const res = await this.sandboxManager.executeInputAction(action);
          return {
            ok: res.success,
            output: { ...res }
          };
        }

        case "desktop_scroll": {
          const action: DesktopInputAction = {
            type: "scroll",
            scrollDelta: typeof args.delta === "number" ? args.delta : (args.down ? -3 : 3)
          };
          const res = await this.sandboxManager.executeInputAction(action);
          return {
            ok: res.success,
            output: { ...res }
          };
        }

        case "desktop_drag": {
          const action: DesktopInputAction = {
            type: "drag",
            x: typeof args.x === "number" ? args.x : 0,
            y: typeof args.y === "number" ? args.y : 0,
            endX: typeof args.endX === "number" ? args.endX : 0,
            endY: typeof args.endY === "number" ? args.endY : 0
          };
          const res = await this.sandboxManager.executeInputAction(action);
          return {
            ok: res.success,
            output: { ...res }
          };
        }

        case "desktop_screenshot": {
          const snap = await this.sandboxManager.captureScreenshot();
          return {
            ok: true,
            output: {
              screenshotBase64: snap.screenshotBase64,
              timestamp: snap.timestamp
            }
          };
        }

        case "desktop_capture_burst": {
          const opts: BurstCaptureOptions = {
            durationMs: typeof args.durationMs === "number" ? args.durationMs : 1000,
            fps: typeof args.fps === "number" ? args.fps : 10
          };
          const burst = await this.sandboxManager.captureBurstFrames(opts);
          return {
            ok: true,
            output: {
              captureId: burst.captureId,
              frameCount: burst.frameCount,
              durationMs: burst.durationMs,
              fps: burst.fps,
              digestSha256: burst.digestSha256,
              timestamp: burst.timestamp,
              frameSample: burst.frames.slice(0, 3)
            }
          };
        }

        case "desktop_snapshot": {
          const name = String(args.name || "Checkpoint");
          const snap = await this.sandboxManager.createSnapshot(name);
          return {
            ok: true,
            output: {
              message: "Checkpoint snapshot created",
              snapshot: snap
            },
            sideEffects: [{
              type: "process",
              description: `Created container checkpoint snapshot: ${snap.id}`,
              mutating: true,
              reversible: true
            }]
          };
        }

        case "desktop_revert": {
          const snapshotId = String(args.snapshotId || "");
          if (!snapshotId) {
            return {
              ok: false,
              output: { error: "Missing required argument: snapshotId" }
            };
          }
          const status = await this.sandboxManager.revertSnapshot(snapshotId);
          return {
            ok: true,
            output: {
              message: `Reverted to snapshot: ${snapshotId}`,
              status
            },
            sideEffects: [{
              type: "process",
              description: `Reverted sandbox to snapshot checkpoint: ${snapshotId}`,
              mutating: true,
              reversible: true
            }]
          };
        }

        default:
          return {
            ok: false,
            output: { error: `Unknown desktop_control operation: ${op}` }
          };
      }
    } catch (err: any) {
      return {
        ok: false,
        output: { error: err?.message || String(err) }
      };
    }
  }
}
