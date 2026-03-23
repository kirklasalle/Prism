import type { Tool, ToolRequest, ToolResult, GovernanceSchema } from "../../core/tools/types.js";
import type { ToolContract } from "../../core/tools/contracts.js";
import { FramebufferCapture } from "../../core/operator/framebuffer-capture.js";

const capture = new FramebufferCapture();

export class VisionCaptureTool implements Tool {
    readonly name = "vision_capture";

    readonly contract: ToolContract = {
        version: "1.0.0",
        args: {
            action: { type: "string", required: true, enum: ["capture_screen", "burst_capture"] },
            fps: { type: "number" },
            duration: { type: "number" },
        },
    };

    readonly governance: GovernanceSchema = {
        actions: {
            capture_screen: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
            burst_capture: { minimumRisk: "medium", mutating: false, rollbackRequired: false },
        },
    };

    async execute(request: ToolRequest): Promise<ToolResult> {
        const action = String(request.args.action ?? "").trim();

        if (action === "capture_screen") {
            try {
                const result = await capture.captureSingle();
                return {
                    ok: true,
                    output: {
                        filename: result.filename,
                        sizeBytes: result.sizeBytes,
                        timestamp: result.timestamp,
                        latestPath: capture.getLatestPath(),
                    },
                    sideEffects: [
                        { type: "file", description: `Screen captured: ${result.filename}`, mutating: false, reversible: true },
                    ],
                };
            } catch (err: unknown) {
                return { ok: false, output: { error: (err as Error).message ?? "Capture failed" } };
            }
        }

        if (action === "burst_capture") {
            const fps = Number(request.args.fps ?? 8);
            const duration = Number(request.args.duration ?? 2);
            try {
                const result = await capture.burstCapture(fps, duration);
                return {
                    ok: true,
                    output: {
                        frames: result.frames,
                        files: result.files,
                    },
                    sideEffects: [
                        { type: "file", description: `Burst capture: ${result.frames} frames`, mutating: false, reversible: true },
                    ],
                };
            } catch (err: unknown) {
                return { ok: false, output: { error: (err as Error).message ?? "Burst failed" } };
            }
        }

        return { ok: false, output: { error: `Unknown action: "${action}". Expected "capture_screen" or "burst_capture".` } };
    }
}
