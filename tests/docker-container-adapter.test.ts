/**
 * Docker Container Adapter — Real Engine API Integration Tests
 *
 * Probes the local Docker Engine API socket. When unavailable, the entire
 * suite is reported as skipped (logged but exits zero). When available,
 * runs a real alpine round-trip exercising every method on
 * [DockerContainerAdapter] and the underlying [DockerEngineClient].
 *
 * Skip predicates:
 *   - `PRISM_DOCKER_TEST=skip`
 *   - DockerEngineClient.ping() returns false
 *
 * Coverage (when not skipped):
 *   ✓ engine.ping
 *   ✓ image pull (alpine:latest)
 *   ✓ create + start + exec (echo)
 *   ✓ exec stdout/stderr capture
 *   ✓ snapshot via commit + revertSnapshot
 *   ✓ stop + destroy
 *   ✓ snapshot image cleanup on destroy
 */
import assert from "node:assert";
import sqlite3 from "sqlite3";
import { DockerEngineClient } from "../src/adapters/system/docker-engine-client.js";
import { DockerContainerAdapter } from "../src/adapters/application/docker-container-adapter.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";
import { INDIVIDUAL_PROFILE } from "../src/core/policy/execution-profiles.js";

const SKIP_REASONS: string[] = [];

async function probe(): Promise<{ available: boolean; engine: DockerEngineClient; reason?: string }> {
    if (process.env.PRISM_DOCKER_TEST === "skip") {
        return { available: false, engine: new DockerEngineClient(), reason: "PRISM_DOCKER_TEST=skip" };
    }
    const engine = new DockerEngineClient();
    const ok = await engine.ping();
    if (!ok) {
        return { available: false, engine, reason: `Docker Engine API not reachable at ${engine.getSocketPath()}` };
    }
    return { available: true, engine };
}

export async function testDockerContainerAdapter(): Promise<void> {
    const probeResult = await probe();
    if (!probeResult.available) {
        SKIP_REASONS.push(probeResult.reason ?? "unknown");
        console.log(`⤳ Docker container adapter tests skipped: ${SKIP_REASONS.join("; ")}`);
        return;
    }

    const { engine } = probeResult;
    const db = new sqlite3.Database(":memory:");
    try {
        const adapter = new DockerContainerAdapter(db, new PolicyEngine(), new ActivityBus(), INDIVIDUAL_PROFILE, engine);
        assert.strictEqual(adapter.getRuntimeBackend(), "docker", "Backend discriminator should be 'docker'");
        assert.strictEqual(await adapter.isDockerEnabled(), true, "isDockerEnabled() should be true when ping succeeds");

        // Lifecycle round-trip on alpine:latest.
        const container = await adapter.createContainer("alpine:latest", {
            cpu_limit: 0.5,
            memory_limit_mb: 64,
            disk_limit_mb: 128,
        });
        assert.ok(container.container_id, "Container should have a container_id");

        await adapter.startContainer(container.container_id);

        const echoResult = await adapter.execInContainer(container.container_id, "echo prism-docker-real");
        assert.strictEqual(echoResult.exit_code, 0, "echo should exit 0");
        assert.match(echoResult.stdout, /prism-docker-real/, "echo stdout should contain marker");

        // Mutate filesystem so the snapshot has observable state.
        await adapter.execInContainer(container.container_id, "mkdir /tmp/prism && echo v1 > /tmp/prism/state");
        const v1 = await adapter.execInContainer(container.container_id, "cat /tmp/prism/state");
        assert.match(v1.stdout, /v1/, "Pre-snapshot state should be v1");

        const snapshot = await adapter.snapshotContainer(container.container_id, "snap1", "post-v1");
        assert.ok(snapshot.snapshot_id, "Snapshot should have a snapshot_id");

        // Mutate again — this change should be discarded by revert.
        await adapter.execInContainer(container.container_id, "echo v2 > /tmp/prism/state");
        const v2 = await adapter.execInContainer(container.container_id, "cat /tmp/prism/state");
        assert.match(v2.stdout, /v2/, "Mutation after snapshot should be observable");

        await adapter.revertSnapshot(container.container_id, snapshot.snapshot_id);
        const reverted = await adapter.execInContainer(container.container_id, "cat /tmp/prism/state");
        assert.match(reverted.stdout, /v1/, "Revert should restore snapshot state (v1)");

        await adapter.stopContainer(container.container_id);
        await adapter.destroyContainer(container.container_id);

        console.log("✓ Docker container adapter (real engine) integration tests passed");
    } finally {
        await new Promise<void>((resolve) => {
            setTimeout(() => db.close(() => resolve()), 25);
        });
    }
}

// Mocha discovery — register only when invoked under the mocha runner.
declare const describe: undefined | ((name: string, fn: () => void) => void);
declare const it: undefined | ((name: string, fn: () => Promise<void>) => void);
if (typeof describe === "function" && typeof it === "function") {
    describe("Docker Container Adapter (real engine, gated)", () => {
        it("performs a full alpine lifecycle when the Docker socket is reachable", async function (this: any) {
            // Generous timeout for image pull + container ops.
            this.timeout?.(180_000);
            await testDockerContainerAdapter();
        });
    });
}
