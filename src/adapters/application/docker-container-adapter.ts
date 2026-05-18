/**
 * Docker Container Adapter
 *
 * Real-Docker backend for PRISM containers — additive sibling to the
 * built-in `ContainerSandboxAdapter`. Implements the same public surface
 * (`createContainer`, `startContainer`, `execInContainer`, `snapshotContainer`,
 * `revertSnapshot`, `stopContainer`, `destroyContainer`, plus inspectors)
 * but delegates to the Docker Engine API via [DockerEngineClient].
 *
 * Selected at runtime by `PRISM_CONTAINER_BACKEND=docker`. When the backend
 * env var is unset, callers continue to construct the existing
 * `ContainerSandboxAdapter` and nothing changes — this file is purely
 * additive (Frontend Protection Guarantee preserved at the application
 * layer; no UI/wiring touched).
 *
 * Phase R+ v0.18 slice 1: lifecycle + exec + commit-based snapshot. Future
 * slices: containerd backend, real resource-quota inspection via
 * `/containers/{id}/stats`.
 *
 * @module adapters/application/docker-container-adapter
 */

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";
import { PolicyEngine } from "../../core/policy/engine.js";
import { ActivityBus } from "../../core/activity/bus.js";
import type { ExecutionProfile } from "../../core/policy/execution-profiles.js";
import { INDIVIDUAL_PROFILE } from "../../core/policy/execution-profiles.js";
import { DockerEngineClient, type DockerHostConfig } from "../system/docker-engine-client.js";
import {
    ContainerState,
    type Container,
    type ContainerSnapshot,
    type ExecInContainerResponse,
    type ResourceQuota,
} from "./container-sandbox-adapter.js";

const TIER1_KEYWORDS = ["ls", "cat", "grep", "pwd", "echo", "head", "tail", "wc", "find", "stat", "file", "ping", "nslookup", "dig", "curl", "wget"];
const TIER2_KEYWORDS = ["mkdir", "touch", "cp", "mv", "chmod", "chgrp", "ln", "tar", "zip", "gzip", "sed", "awk"];
const TIER3_KEYWORDS = ["rm", "sudo", "reboot", "dd", "mkfs", "halt", "shutdown", "kill", "chown", "fdisk", "umount", "fsck"];

/**
 * Real-Docker backed container adapter.
 *
 * Selection: instantiate when `PRISM_CONTAINER_BACKEND === "docker"` AND
 * `DockerEngineClient.ping()` succeeds. Production callers should treat
 * absent docker.sock as a hard failure when the backend env is `docker`.
 */
export class DockerContainerAdapter {
    private db: sqlite3.Database;
    private policyEngine: PolicyEngine;
    private activityBus: ActivityBus;
    private executionProfile: ExecutionProfile;
    private engine: DockerEngineClient;
    /** PRISM container_id → Docker container Id mapping. */
    private dockerIds: Map<string, string> = new Map();
    /** PRISM container_id → metadata snapshot. */
    private containers: Map<string, Container> = new Map();
    /** PRISM container_id → list of snapshots (commit images). */
    private snapshots: Map<string, ContainerSnapshot[]> = new Map();
    /** PRISM container_id → command count (for snapshot.command_count). */
    private commandCounts: Map<string, number> = new Map();
    private initializationPromise: Promise<void>;

    constructor(
        db: sqlite3.Database,
        policyEngine: PolicyEngine,
        activityBus: ActivityBus,
        executionProfile?: ExecutionProfile,
        engine?: DockerEngineClient,
    ) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.executionProfile = executionProfile ?? INDIVIDUAL_PROFILE;
        this.engine = engine ?? new DockerEngineClient();
        this.initializationPromise = this.initializeDatabase();
    }

    /** Backend discriminator. */
    getRuntimeBackend(): "docker" {
        return "docker";
    }

    /** Real Docker is enabled iff the engine pings successfully. */
    async isDockerEnabled(): Promise<boolean> {
        return this.engine.ping();
    }

    /** Underlying Engine API client (for tests / advanced flows). */
    getEngine(): DockerEngineClient {
        return this.engine;
    }

    setExecutionProfile(profile: ExecutionProfile): void {
        this.executionProfile = profile;
    }

    getExecutionProfile(): ExecutionProfile {
        return this.executionProfile;
    }

    private initializeDatabase(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS docker_containers (
                        container_id TEXT PRIMARY KEY,
                        docker_id TEXT NOT NULL,
                        image TEXT NOT NULL,
                        state TEXT NOT NULL,
                        cpu_limit REAL NOT NULL,
                        memory_limit_mb INTEGER NOT NULL,
                        disk_limit_mb INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        started_at TEXT,
                        stopped_at TEXT
                    )
                `, (err: any) => {
                    if (err) { reject(err); return; }
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS docker_container_snapshots (
                            snapshot_id TEXT PRIMARY KEY,
                            container_id TEXT NOT NULL,
                            snapshot_name TEXT NOT NULL,
                            description TEXT,
                            image_id TEXT NOT NULL,
                            command_count INTEGER NOT NULL,
                            created_at TEXT NOT NULL,
                            parent_snapshot_id TEXT
                        )
                    `, (snapErr: any) => {
                        if (snapErr) { reject(snapErr); return; }
                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS docker_container_command_history (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                container_id TEXT NOT NULL,
                                command TEXT NOT NULL,
                                exit_code INTEGER NOT NULL,
                                stdout TEXT,
                                stderr TEXT,
                                execution_time_ms INTEGER NOT NULL,
                                reason_code TEXT NOT NULL,
                                timestamp TEXT NOT NULL
                            )
                        `, (histErr: any) => {
                            if (histErr) reject(histErr); else resolve();
                        });
                    });
                });
            });
        });
    }

    /**
     * Pull image (if missing) + create a container with PRISM-mapped
     * HostConfig quotas. Container is created in `none` network mode for
     * Business profile (matching the existing CAC default), `bridge` for
     * Individual.
     */
    async createContainer(image: string, resource_quota: ResourceQuota): Promise<Container> {
        await this.initializationPromise;

        // Image pull — Tier-2 mutating; gate via policy.
        const policyDecision = await this.routeThroughPolicy("pre-create", "tier2", `image_pull:${image}`);
        if (policyDecision === "deny") {
            throw new Error(`Image pull denied by policy: ${image}`);
        }
        await this.engine.imagePull(image);

        const container_id = uuidv4();
        const created_at = new Date().toISOString();
        const networkMode = this.executionProfile.segment === "business" ? "none" : "bridge";

        const hostConfig: DockerHostConfig = {
            Memory: resource_quota.memory_limit_mb * 1024 * 1024,
            MemorySwap: resource_quota.memory_limit_mb * 1024 * 1024, // disable swap
            NanoCpus: Math.floor(resource_quota.cpu_limit * 1e9),
            PidsLimit: 256,
            ReadonlyRootfs: this.executionProfile.segment === "business",
            NetworkMode: networkMode,
            AutoRemove: false,
        };

        const dockerId = await this.engine.containerCreate({
            Image: image,
            Cmd: ["/bin/sh", "-c", "tail -f /dev/null"],
            Tty: false,
            AttachStdout: true,
            AttachStderr: true,
            HostConfig: hostConfig,
            Labels: {
                "prism.container_id": container_id,
                "prism.execution_profile": this.executionProfile.segment,
            },
        }, `prism-${container_id}`);

        const container: Container = {
            container_id,
            image,
            state: ContainerState.CREATED,
            resource_quota,
            created_at,
        };

        this.dockerIds.set(container_id, dockerId);
        this.containers.set(container_id, container);
        this.snapshots.set(container_id, []);
        this.commandCounts.set(container_id, 0);
        await this.persistContainer(container, dockerId);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_create",
            status: "succeeded",
            details: { image, resource_quota, runtime: "docker", network_mode: networkMode, docker_id: dockerId },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });

        return container;
    }

    async startContainer(container_id: string): Promise<Container> {
        await this.initializationPromise;
        const container = this.containers.get(container_id);
        const dockerId = this.dockerIds.get(container_id);
        if (!container || !dockerId) throw new Error(`Container ${container_id} not found`);
        if (container.state !== ContainerState.CREATED && container.state !== ContainerState.STOPPED) {
            throw new Error(`Container must be in CREATED or STOPPED to start (current: ${container.state})`);
        }

        await this.engine.containerStart(dockerId);
        container.state = ContainerState.RUNNING;
        container.started_at = new Date().toISOString();
        container.stopped_at = undefined;
        await this.persistContainer(container, dockerId);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_start",
            status: "succeeded",
            details: { runtime: "docker", docker_id: dockerId },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });

        return container;
    }

    async execInContainer(container_id: string, command: string, timeout_ms = 30_000): Promise<ExecInContainerResponse> {
        await this.initializationPromise;
        const container = this.containers.get(container_id);
        const dockerId = this.dockerIds.get(container_id);
        if (!container || !dockerId) throw new Error(`Container ${container_id} not found`);
        if (container.state !== ContainerState.RUNNING && container.state !== ContainerState.EXECUTING) {
            throw new Error(`Container ${container_id} not running (state: ${container.state})`);
        }

        const tier = this.classifyCommandTier(command);
        const policyDecision = await this.routeThroughPolicy(container_id, tier, command);
        if (policyDecision === "deny") {
            throw new Error(`Command denied by policy (tier: ${tier})`);
        }

        container.state = ContainerState.EXECUTING;
        await this.persistContainer(container, dockerId);

        const start = Date.now();
        const { exitCode, stdout, stderr } = await this.engine.containerExec(dockerId, ["/bin/sh", "-c", command], { timeoutMs: timeout_ms });
        const response: ExecInContainerResponse = {
            container_id,
            command,
            exit_code: exitCode,
            stdout,
            stderr,
            execution_time_ms: Date.now() - start,
            timestamp: new Date().toISOString(),
        };

        container.state = ContainerState.RUNNING;
        await this.persistContainer(container, dockerId);
        this.commandCounts.set(container_id, (this.commandCounts.get(container_id) ?? 0) + 1);
        await this.persistCommandExecution(response, `tier_${tier}_executed`);
        return response;
    }

    /**
     * Snapshot via `POST /commit`. Repository is namespaced
     * `prism-snapshot/<container_id>` so PRISM can prune them on destroy.
     */
    async snapshotContainer(container_id: string, snapshot_name: string, description?: string): Promise<ContainerSnapshot> {
        await this.initializationPromise;
        const container = this.containers.get(container_id);
        const dockerId = this.dockerIds.get(container_id);
        if (!container || !dockerId) throw new Error(`Container ${container_id} not found`);

        const snapshot_id = uuidv4();
        const repo = `prism-snapshot/${container_id}`;
        const tag = snapshot_name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const imageId = await this.engine.containerCommit(dockerId, repo, tag, description);
        const list = this.snapshots.get(container_id) ?? [];
        const parent = list.length ? list[list.length - 1].snapshot_id : undefined;

        const snapshot: ContainerSnapshot = {
            snapshot_id,
            container_id,
            snapshot_name,
            description,
            snapshot_size_mb: 1, // commit-based; precise size would require image inspect
            command_count: this.commandCounts.get(container_id) ?? 0,
            created_at: new Date().toISOString(),
            parent_snapshot_id: parent,
        };
        list.push(snapshot);
        this.snapshots.set(container_id, list);
        await this.persistSnapshot(snapshot, imageId);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_snapshot",
            status: "succeeded",
            details: { snapshot_id, image_id: imageId, runtime: "docker" },
            authorityTier: "tier2_conditional",
            policyDecision: "allow",
        });

        return snapshot;
    }

    /**
     * Stop the running container, recreate from the snapshot's committed
     * image, swap the docker_id mapping, restart. Mirrors the semantics of
     * `ContainerSandboxAdapter.revertSnapshot` for the docker backend.
     */
    async revertSnapshot(container_id: string, snapshot_id: string): Promise<Container> {
        await this.initializationPromise;
        const container = this.containers.get(container_id);
        const dockerId = this.dockerIds.get(container_id);
        if (!container || !dockerId) throw new Error(`Container ${container_id} not found`);
        const list = this.snapshots.get(container_id) ?? [];
        const snap = list.find(s => s.snapshot_id === snapshot_id);
        if (!snap) throw new Error(`Snapshot ${snapshot_id} not found for container ${container_id}`);

        const imageRow = await this.lookupSnapshotImage(snapshot_id);
        if (!imageRow) throw new Error(`Snapshot ${snapshot_id} has no image_id row`);

        // Stop + remove old container.
        try { await this.engine.containerStop(dockerId, 5); } catch { /* may already be stopped */ }
        try { await this.engine.containerRemove(dockerId, { force: true }); } catch { /* may already be gone */ }

        // Recreate from snapshot image.
        const newDockerId = await this.engine.containerCreate({
            Image: imageRow,
            Cmd: ["/bin/sh", "-c", "tail -f /dev/null"],
            Tty: false,
            HostConfig: {
                Memory: container.resource_quota.memory_limit_mb * 1024 * 1024,
                NanoCpus: Math.floor(container.resource_quota.cpu_limit * 1e9),
                NetworkMode: this.executionProfile.segment === "business" ? "none" : "bridge",
                AutoRemove: false,
            },
            Labels: {
                "prism.container_id": container_id,
                "prism.reverted_to": snapshot_id,
            },
        }, `prism-${container_id}-r${Date.now()}`);
        await this.engine.containerStart(newDockerId);

        this.dockerIds.set(container_id, newDockerId);
        container.state = ContainerState.RUNNING;
        container.started_at = new Date().toISOString();
        await this.persistContainer(container, newDockerId);
        return container;
    }

    async stopContainer(container_id: string): Promise<Container> {
        await this.initializationPromise;
        const container = this.containers.get(container_id);
        const dockerId = this.dockerIds.get(container_id);
        if (!container || !dockerId) throw new Error(`Container ${container_id} not found`);
        await this.engine.containerStop(dockerId, 10);
        container.state = ContainerState.STOPPED;
        container.stopped_at = new Date().toISOString();
        await this.persistContainer(container, dockerId);
        return container;
    }

    async destroyContainer(container_id: string): Promise<void> {
        await this.initializationPromise;
        const dockerId = this.dockerIds.get(container_id);
        if (!dockerId) throw new Error(`Container ${container_id} not found`);
        try { await this.engine.containerRemove(dockerId, { force: true, removeVolumes: true }); } catch { /* tolerate already-gone */ }

        // Prune snapshot images.
        const list = this.snapshots.get(container_id) ?? [];
        for (const s of list) {
            const img = await this.lookupSnapshotImage(s.snapshot_id);
            if (img) {
                try { await this.engine.imageRemove(img, true); } catch { /* tolerate */ }
            }
        }

        this.dockerIds.delete(container_id);
        this.containers.delete(container_id);
        this.snapshots.delete(container_id);
        this.commandCounts.delete(container_id);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_destroy",
            status: "succeeded",
            details: { runtime: "docker" },
            authorityTier: "tier3_approval",
            policyDecision: "allow",
        });
    }

    async getContainerStatus(container_id: string): Promise<Container> {
        await this.initializationPromise;
        const c = this.containers.get(container_id);
        if (!c) throw new Error(`Container ${container_id} not found`);
        return c;
    }

    async listSnapshots(container_id: string): Promise<ContainerSnapshot[]> {
        await this.initializationPromise;
        return this.snapshots.get(container_id) ?? [];
    }

    private classifyCommandTier(command: string): "tier1" | "tier2" | "tier3" {
        const primary = command.trim().split(/[\s|&;]/)[0];
        if (TIER1_KEYWORDS.includes(primary)) return "tier1";
        if (TIER2_KEYWORDS.includes(primary)) return "tier2";
        if (TIER3_KEYWORDS.includes(primary)) return "tier3";
        return "tier2";
    }

    private async routeThroughPolicy(container_id: string, tier: "tier1" | "tier2" | "tier3", command: string): Promise<"allow" | "deny" | "request_approval"> {
        if (tier === "tier1") return "allow";
        if (tier === "tier3" && this.executionProfile.tier3ApprovalRequired) {
            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_tier3_approval_required",
                status: "started",
                details: { command, segment: this.executionProfile.segment, runtime: "docker" },
                authorityTier: "tier3_approval",
                policyDecision: "require_approval",
            });
            return "request_approval";
        }
        if (this.executionProfile.auditAllOperations) {
            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_tier2_audit",
                status: "succeeded",
                details: { command, segment: this.executionProfile.segment, runtime: "docker" },
                authorityTier: "tier2_conditional",
                policyDecision: "allow",
            });
        }
        return "allow";
    }

    private persistContainer(container: Container, dockerId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO docker_containers
                 (container_id, docker_id, image, state, cpu_limit, memory_limit_mb, disk_limit_mb, created_at, started_at, stopped_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    container.container_id, dockerId, container.image, container.state,
                    container.resource_quota.cpu_limit, container.resource_quota.memory_limit_mb, container.resource_quota.disk_limit_mb,
                    container.created_at, container.started_at ?? null, container.stopped_at ?? null,
                ],
                (err: any) => err ? reject(err) : resolve(),
            );
        });
    }

    private persistSnapshot(snapshot: ContainerSnapshot, imageId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO docker_container_snapshots
                 (snapshot_id, container_id, snapshot_name, description, image_id, command_count, created_at, parent_snapshot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [snapshot.snapshot_id, snapshot.container_id, snapshot.snapshot_name, snapshot.description ?? null, imageId, snapshot.command_count, snapshot.created_at, snapshot.parent_snapshot_id ?? null],
                (err: any) => err ? reject(err) : resolve(),
            );
        });
    }

    private persistCommandExecution(response: ExecInContainerResponse, reason_code: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO docker_container_command_history
                 (container_id, command, exit_code, stdout, stderr, execution_time_ms, reason_code, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [response.container_id, response.command, response.exit_code, response.stdout, response.stderr, response.execution_time_ms, reason_code, response.timestamp],
                (err: any) => err ? reject(err) : resolve(),
            );
        });
    }

    private lookupSnapshotImage(snapshot_id: string): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            this.db.get(
                "SELECT image_id FROM docker_container_snapshots WHERE snapshot_id = ?",
                [snapshot_id],
                (err: any, row: { image_id?: string } | undefined) => err ? reject(err) : resolve(row?.image_id),
            );
        });
    }
}
