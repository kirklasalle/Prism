/**
 * PTAC scenario s27 — self-drive: Real Docker container lifecycle verification.
 *
 * Drives `DockerContainerAdapter` through the full create → start → exec →
 * snapshot → revert → stop → destroy round-trip against a real local
 * Docker Engine (or named pipe on Win32). Bridges the gap between the
 * gated mocha test and the host automation gate.
 *
 * SAFETY GATES:
 *   1. CLI: `--profile=host` + `--i-understand-host-control`.
 *   2. Env: `PRISM_PTAC_SAFE=1` (orchestrator dispatch enforces).
 *
 * SOFT-SKIP: When the Docker Engine is unreachable on the host (no Docker
 * Desktop / no daemon), the orchestrator records the step as passed with
 * a single advisory log line, mirroring the mocha test's gated-skip path.
 *
 * Suite: `full` only. Tags: real, docker, host.
 */

import { registerScenario } from "../scenario-registry.js";
import type { PtacScenario } from "../types.js";

export const SCENARIO_S27: PtacScenario = {
    id: "s27-real-docker-lifecycle",
    title: "Self-drive — Real Docker container lifecycle (v0.18 verification)",
    suites: ["full"],
    requiresHost: true,
    tags: ["self-drive", "container", "docker", "host", "real"],
    steps: [
        {
            id: "boot-pad-verify",
            label: "Verify PAD integrity at boot",
            kind: "padHashVerify",
            timeoutMs: 5_000,
        },
        {
            id: "docker-lifecycle",
            label: "Pull → create → start → exec → snapshot → revert → destroy alpine",
            kind: "realDockerLifecycle",
            image: "alpine:latest",
            timeoutMs: 120_000,
        },
    ],
};

registerScenario(SCENARIO_S27);
