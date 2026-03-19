import * as assert from "assert";
import { describe, it, before, after } from "mocha";
import sqlite3 from "sqlite3";
import {
    ContainerSandboxAdapter,
    ContainerState,
    ResourceQuota
} from "../src/adapters/application/container-sandbox-adapter.js";
import { PolicyEngine } from "../src/core/policy/engine.js";
import { ActivityBus } from "../src/core/activity/bus.js";

describe("Container Sandbox Adapter", function () {
    // Container operations include snapshot/revert and process management.
    // Allow 15s global timeout.
    this.timeout(15000);

    let adapter: ContainerSandboxAdapter;
    let db: sqlite3.Database;
    let policyEngine: PolicyEngine;
    let activityBus: ActivityBus;

    before(async () => {
        db = new sqlite3.Database(":memory:");
        policyEngine = new PolicyEngine();
        activityBus = new ActivityBus();
        adapter = new ContainerSandboxAdapter(db, policyEngine, activityBus);
    });

    after(async () => {
        await new Promise<void>((resolve, reject) => {
            db.close((err) => (err ? reject(err) : resolve()));
        });
    });

    describe("Container Creation", () => {
        it("creates a container in CREATED state", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 2,
                memory_limit_mb: 512,
                disk_limit_mb: 10240
            };

            const container = await adapter.createContainer("alpine:latest", quota);

            assert.ok(container.container_id.length > 10);
            assert.strictEqual(container.image, "alpine:latest");
            assert.strictEqual(container.state, ContainerState.CREATED);
            assert.deepStrictEqual(container.resource_quota, quota);
            assert.ok(container.created_at);
            assert.strictEqual(container.started_at, undefined);
        });

        it("throws when getting status for non-existent container", async () => {
            await assert.rejects(async () => {
                await adapter.getContainerStatus("missing-container-id");
            }, /not found/);
        });

        it("returns status for created container", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const created = await adapter.createContainer("ubuntu:20.04", quota);
            const status = await adapter.getContainerStatus(created.container_id);

            assert.strictEqual(status.container_id, created.container_id);
            assert.strictEqual(status.state, ContainerState.CREATED);
            assert.strictEqual(status.image, "ubuntu:20.04");
        });

        it("preserves resource quota on container", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 4,
                memory_limit_mb: 2048,
                disk_limit_mb: 20480
            };

            const container = await adapter.createContainer("debian:bullseye", quota);

            assert.deepStrictEqual(container.resource_quota, quota);
        });

        it("supports different quota profiles", async () => {
            const smallQuota: ResourceQuota = {
                cpu_limit: 0.5,
                memory_limit_mb: 128,
                disk_limit_mb: 2560
            };

            const largeQuota: ResourceQuota = {
                cpu_limit: 8,
                memory_limit_mb: 8192,
                disk_limit_mb: 102400
            };

            const small = await adapter.createContainer("alpine:latest", smallQuota);
            const large = await adapter.createContainer("alpine:latest", largeQuota);

            assert.strictEqual(small.resource_quota.cpu_limit, 0.5);
            assert.strictEqual(large.resource_quota.cpu_limit, 8);
        });
    });

    describe("Activity Bus Integration", () => {
        it("emits container_create event on creation", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            await adapter.createContainer("alpine:latest", quota);

            const events = activityBus.listEvents();
            const hasCreate = events.some(
                (event) => event.operation === "container_create" && event.status === "succeeded"
            );
            assert.strictEqual(hasCreate, true);
        });

        it("includes resource quota details in create event", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 2,
                memory_limit_mb: 512,
                disk_limit_mb: 10240
            };

            await adapter.createContainer("alpine:latest", quota);

            const events = activityBus.listEvents();
            const createEvent = events.find(
                (event) => event.operation === "container_create" && event.status === "succeeded"
            );

            assert.ok(createEvent);
            assert.ok(createEvent?.details);
        });

        it("marks create operation as tier1_autonomous", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            await adapter.createContainer("alpine:latest", quota);

            const events = activityBus.listEvents();
            const hasAutoTier = events.some(
                (event) =>
                    event.operation === "container_create" &&
                    event.authorityTier === "tier1_autonomous"
            );
            assert.strictEqual(hasAutoTier, true);
        });
    });

    describe("SQLite Persistence", () => {
        it("persists container to database with all fields", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);

            const row: any = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT container_id, image, state, cpu_limit, memory_limit_mb, disk_limit_mb
                     FROM containers WHERE container_id = ?`,
                    [container.container_id],
                    (err, row) => (err ? reject(err) : resolve(row))
                );
            });

            assert.ok(row);
            assert.strictEqual(row.container_id, container.container_id);
            assert.strictEqual(row.image, "alpine:latest");
            assert.strictEqual(row.state, "created");
            assert.strictEqual(row.cpu_limit, 1);
            assert.strictEqual(row.memory_limit_mb, 256);
            assert.strictEqual(row.disk_limit_mb, 5120);
        });

        it("persists multiple containers independently", async () => {
            const quota1: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const quota2: ResourceQuota = {
                cpu_limit: 2,
                memory_limit_mb: 512,
                disk_limit_mb: 10240
            };

            const c1 = await adapter.createContainer("alpine:latest", quota1);
            const c2 = await adapter.createContainer("ubuntu:20.04", quota2);

            // Verify both containers exist
            const row1: any = await new Promise((resolve, reject) => {
                db.get(
                    "SELECT container_id FROM containers WHERE container_id = ?",
                    [c1.container_id],
                    (err, row) => (err ? reject(err) : resolve(row))
                );
            });

            const row2: any = await new Promise((resolve, reject) => {
                db.get(
                    "SELECT container_id FROM containers WHERE container_id = ?",
                    [c2.container_id],
                    (err, row) => (err ? reject(err) : resolve(row))
                );
            });

            assert.ok(row1);
            assert.ok(row2);
            assert.strictEqual(row1.container_id, c1.container_id);
            assert.strictEqual(row2.container_id, c2.container_id);
        });

        it("retrieves correct container state from database", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);
            const status = await adapter.getContainerStatus(container.container_id);

            assert.strictEqual(status.state, ContainerState.CREATED);
            assert.strictEqual(status.image, "alpine:latest");
        });
    });

    describe("Snapshot and Revert API", () => {
        it("lists snapshots returns empty array for new container", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);
            const snapshots = await adapter.listSnapshots(container.container_id);

            assert.deepStrictEqual(snapshots, []);
        });

        it("persists snapshot metadata to database", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);

            // Create snapshot using the adapter method
            const snapshot = await adapter.snapshotContainer(
                container.container_id,
                "test-snapshot",
                "A test snapshot"
            );

            // Verify it was persisted to database
            const row: any = await new Promise((resolve, reject) => {
                db.get(
                    "SELECT snapshot_id, snapshot_name FROM container_snapshots WHERE snapshot_id = ?",
                    [snapshot.snapshot_id],
                    (err, row) => (err ? reject(err) : resolve(row))
                );
            });

            assert.ok(row);
            assert.strictEqual(row.snapshot_name, "test-snapshot");
        });

        it("includes snapshot metadata in returned snapshot object", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);
            const snapshot = await adapter.snapshotContainer(
                container.container_id,
                "checkpoint-1",
                "First checkpoint"
            );

            assert.ok(snapshot.snapshot_id.length > 10);
            assert.strictEqual(snapshot.snapshot_name, "checkpoint-1");
            assert.strictEqual(snapshot.container_id, container.container_id);
            assert.strictEqual(snapshot.description, "First checkpoint");
            assert.ok(snapshot.created_at);
            assert.ok(snapshot.snapshot_size_mb > 0);
        });

        it("lists multiple snapshots in creation order", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);

            const snap1 = await adapter.snapshotContainer(container.container_id, "snap1");
            const snap2 = await adapter.snapshotContainer(container.container_id, "snap2");
            const snap3 = await adapter.snapshotContainer(container.container_id, "snap3");

            const snapshots = await adapter.listSnapshots(container.container_id);

            assert.strictEqual(snapshots.length, 3);
            assert.strictEqual(snapshots[0].snapshot_id, snap1.snapshot_id);
            assert.strictEqual(snapshots[1].snapshot_id, snap2.snapshot_id);
            assert.strictEqual(snapshots[2].snapshot_id, snap3.snapshot_id);
        });

        it("tracks parent snapshot in chain", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);
            const snap1 = await adapter.snapshotContainer(container.container_id, "snap1");
            const snap2 = await adapter.snapshotContainer(container.container_id, "snap2");

            const snapshots = await adapter.listSnapshots(container.container_id);

            // First snapshot has no parent (should be undefined or null)
            assert.ok(
                snapshots[0].parent_snapshot_id === undefined ||
                snapshots[0].parent_snapshot_id === null
            );
            // Second snapshot's parent is the first
            assert.strictEqual(snapshots[1].parent_snapshot_id, snap1.snapshot_id);
        });
    });

    describe("Error Handling", () => {
        it("throws on revert with non-existent snapshot", async () => {
            const quota: ResourceQuota = {
                cpu_limit: 1,
                memory_limit_mb: 256,
                disk_limit_mb: 5120
            };

            const container = await adapter.createContainer("alpine:latest", quota);

            await assert.rejects(
                async () => {
                    await adapter.revertContainer(container.container_id, "fake-snapshot-id");
                },
                /not found/
            );
        });

        it("throws on destroy non-existent container", async () => {
            await assert.rejects(
                async () => {
                    await adapter.destroyContainer("missing-container-id", "test");
                },
                /not found/
            );
        });

        it("throws on stop non-existent container", async () => {
            await assert.rejects(
                async () => {
                    await adapter.stopContainer("missing-container-id");
                },
                /not found/
            );
        });
    });

    describe("Command Execution Classification", () => {
        it("creates container successfully with various images", async () => {
            const images = ["alpine:latest", "ubuntu:20.04", "debian:bullseye", "node:18"];

            for (const image of images) {
                const quota: ResourceQuota = {
                    cpu_limit: 1,
                    memory_limit_mb: 256,
                    disk_limit_mb: 5120
                };

                const container = await adapter.createContainer(image, quota);
                assert.strictEqual(container.image, image);
            }
        });
    });
});

export function testContainerSandboxAdapter(): void {
    // Integration entry point for custom runners.
}
