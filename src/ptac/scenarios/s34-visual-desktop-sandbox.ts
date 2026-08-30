/**
 * PTAC scenario s34 — self-drive: Governed Visual Desktop Sandbox (Phase V verification).
 *
 * Drives DesktopSandboxManager through the full visual desktop lifecycle:
 *   1. PAD integrity verification at boot.
 *   2. Container start (Debian 12 + Openbox + KasmVNC) on default OCI runtime with port readiness.
 *   3. Status & WebRTC stream verification (60fps stream URL on localhost:6080).
 *   4. Operator co-pilot takeover mode preemption and autonomous resume.
 *   5. Direct desktop mouse action execution.
 *   6. Forensic 10-frame Action Burst capture with SHA-256 cryptographic digest.
 *   7. Checkpoint snapshot creation and state revert.
 *   8. Clean shutdown & container cleanup.
 *
 * Suite: `fast`, `full`, `demo`. Tags: self-drive, desktop, sandbox, vds, phase-v.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S34: PtacScenario = {
    id: "s34-visual-desktop-sandbox",
    title: "Self-drive — Governed Visual Desktop Sandbox & Co-Pilot (Phase V verification)",
    suites: ["fast", "full", "demo"],
    requiresHost: false,
    tags: ["self-drive", "desktop", "sandbox", "vds", "phase-v"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "desktop-sandbox-lifecycle",
            label: "Boot VDS container → Co-Pilot Takeover → Action Burst → Snapshot → Revert",
            kind: "visualDesktopSandboxLifecycle",
            timeoutMs: 60_000,
        },
    ],
};

registerScenario(SCENARIO_S34);
