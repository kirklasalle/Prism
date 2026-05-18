/**
 * PTAC scenario s26 — self-drive: Real PTY pause/resume verification.
 *
 * Verifies the v0.17 real-PTY pause/resume codepath end-to-end against a
 * real OS child process spawned by `TerminalSessionAdapter`. Bridges the
 * gap between the unit-test gate (testPauseResumeSession) and the host
 * automation gate, so the same codepath is verified through the PTAC
 * harness as a recorded artifact.
 *
 * SAFETY GATES:
 *   1. CLI: `--profile=host` + `--i-understand-host-control`.
 *   2. Env: `PRISM_PTAC_SAFE=1` (the orchestrator dispatch enforces this).
 *
 * Suite: `full` only. NOT in `fast` (host gate). NOT in `demo` (the
 * step does not produce viewer-friendly output).
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S26: PtacScenario = {
    id: "s26-real-pty-lifecycle",
    title: "Self-drive — Real PTY pause/resume lifecycle (v0.17 verification)",
    suites: ["full"],
    requiresHost: true,
    tags: ["self-drive", "terminal", "pty", "host", "real"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "pty-lifecycle",
            label: "Start → pause → resume → exec → stop a real PTY session",
            kind: "realPtyLifecycle",
            timeoutMs: 30_000,
        },
    ],
};

registerScenario(SCENARIO_S26);
