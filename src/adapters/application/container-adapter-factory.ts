/**
 * Container Adapter Factory
 *
 * Selects the active container backend at runtime based on
 * `PRISM_CONTAINER_BACKEND`:
 *
 *   - `builtin-prism` (default) → existing [ContainerSandboxAdapter]
 *     (filesystem-isolated runtime; no Docker required).
 *   - `docker`                  → [DockerContainerAdapter] talking to a
 *     local Docker Engine API socket via [DockerEngineClient].
 *
 * Production callers asking for `docker` will get a hard failure if the
 * socket is unreachable — no silent fall-back to the simulated backend.
 *
 * @module adapters/application/container-adapter-factory
 */

import sqlite3 from "sqlite3";
import { PolicyEngine } from "../../core/policy/engine.js";
import { ActivityBus } from "../../core/activity/bus.js";
import type { ExecutionProfile } from "../../core/policy/execution-profiles.js";
import { ContainerSandboxAdapter } from "./container-sandbox-adapter.js";
import { DockerContainerAdapter } from "./docker-container-adapter.js";
import { DockerEngineClient } from "../system/docker-engine-client.js";

export type ContainerBackend = "builtin-prism" | "docker";

export interface ContainerAdapterFactoryOptions {
    backend?: ContainerBackend;
    socketPath?: string;
    /** When true (default in production), missing docker.sock with backend=docker
     *  is a hard error; when false, the factory falls back to builtin-prism. */
    requireBackend?: boolean;
}

/**
 * Construct the container adapter selected by environment + options.
 *
 * Resolution order for `backend`:
 *   1. `options.backend`
 *   2. `process.env.PRISM_CONTAINER_BACKEND`
 *   3. `"builtin-prism"`
 */
export async function createContainerAdapter(
    db: sqlite3.Database,
    policyEngine: PolicyEngine,
    activityBus: ActivityBus,
    executionProfile?: ExecutionProfile,
    options: ContainerAdapterFactoryOptions = {},
): Promise<ContainerSandboxAdapter | DockerContainerAdapter> {
    const requested = (options.backend ?? (process.env.PRISM_CONTAINER_BACKEND as ContainerBackend | undefined) ?? "builtin-prism") as ContainerBackend;

    if (requested === "docker") {
        const engine = new DockerEngineClient(options.socketPath ? { socketPath: options.socketPath } : {});
        const ok = await engine.ping();
        if (!ok) {
            const required = options.requireBackend ?? (process.env.NODE_ENV === "production");
            const msg = `PRISM_CONTAINER_BACKEND=docker but Docker Engine API at ${engine.getSocketPath()} is unreachable`;
            if (required) throw new Error(msg);
            // Soft fall-back for dev environments.
            // eslint-disable-next-line no-console
            console.warn(`[container-adapter-factory] ${msg}; falling back to builtin-prism`);
            return new ContainerSandboxAdapter(db, policyEngine, activityBus, executionProfile);
        }
        return new DockerContainerAdapter(db, policyEngine, activityBus, executionProfile, engine);
    }

    return new ContainerSandboxAdapter(db, policyEngine, activityBus, executionProfile);
}
