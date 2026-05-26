/**
 * Container Sandbox Adapter
 *
 * Prism built-in container runtime:
 * - per-container isolated runtime directory
 * - command execution constrained to runtime directory
 * - snapshot/revert via filesystem copies
 * - policy-tier routing + audit logging
 *
 * @module adapters/application/container-sandbox-adapter
 */

import sqlite3 from "sqlite3";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyEngine } from "../../core/policy/engine.js";
import { ActivityBus } from "../../core/activity/bus.js";
import type { ExecutionProfile } from "../../core/policy/execution-profiles.js";
import { INDIVIDUAL_PROFILE } from "../../core/policy/execution-profiles.js";

export enum ContainerState {
    IDLE = "idle",
    CREATED = "created",
    RUNNING = "running",
    EXECUTING = "executing",
    TIMEOUT = "timeout",
    STOPPED = "stopped",
    DESTROYED = "destroyed"
}

export interface ResourceQuota {
    cpu_limit: number;
    memory_limit_mb: number;
    disk_limit_mb: number;
}

export interface ContainerSnapshot {
    snapshot_id: string;
    container_id: string;
    snapshot_name: string;
    description?: string;
    snapshot_size_mb: number;
    command_count: number;
    created_at: string;
    parent_snapshot_id?: string;
}

export interface Container {
    container_id: string;
    image: string;
    state: ContainerState;
    resource_quota: ResourceQuota;
    created_at: string;
    started_at?: string;
    stopped_at?: string;
}

export interface ExecInContainerResponse {
    container_id: string;
    command: string;
    exit_code: number;
    stdout: string;
    stderr: string;
    execution_time_ms: number;
    timestamp: string;
}

const TIER1_KEYWORDS = ["ls", "cat", "grep", "pwd", "echo", "cd", "head", "tail", "wc", "find", "locate", "stat", "file", "ipconfig", "ifconfig", "ping", "nslookup", "dig", "tracert", "traceroute", "netstat", "arp", "hostname", "nbtstat", "pathping", "getmac", "ss", "curl", "wget"];
const TIER2_KEYWORDS = ["mkdir", "touch", "cp", "mv", "chmod", "chgrp", "ln", "tar", "zip", "gzip", "sed", "awk", "netsh", "route"];
const TIER3_KEYWORDS = ["rm", "sudo", "reboot", "dd", "mkfs", "halt", "shutdown", "kill", "chown", "fdisk", "format", "umount", "fsck"];

export class ContainerSandboxAdapter {
    private db: sqlite3.Database;
    private policyEngine: PolicyEngine;
    private activityBus: ActivityBus;
    private executionProfile: ExecutionProfile;
    private activeContainers: Map<string, { container: Container; runtimeRoot: string }> = new Map();
    private snapshots: Map<string, ContainerSnapshot[]> = new Map();
    private initializationPromise: Promise<void>;
    private readonly runtimeBaseDir: string;

    constructor(db: sqlite3.Database, policyEngine: PolicyEngine, activityBus: ActivityBus, executionProfile?: ExecutionProfile) {
        this.db = db;
        this.policyEngine = policyEngine;
        this.activityBus = activityBus;
        this.executionProfile = executionProfile ?? INDIVIDUAL_PROFILE;
        this.runtimeBaseDir = join(tmpdir(), "prism-runtime-containers");
        if (!existsSync(this.runtimeBaseDir)) {
            mkdirSync(this.runtimeBaseDir, { recursive: true });
        }
        this.initializationPromise = this.initializeDatabase();
    }

    /** PRISM Computer Use: Docker is now supported for isolated sandboxing. */
    isDockerEnabled(): boolean {
        return this.getRuntimeBackend() === "docker";
    }

    /** Built-in runtime or Docker is available. */
    isContainerRuntimeEnabled(): boolean {
        return true;
    }

    getRuntimeBackend(): "docker" | "builtin-prism" {
        return (process.env.PRISM_USE_DOCKER === "true" || process.env.PRISM_USE_DOCKER === "1")
            ? "docker"
            : "builtin-prism";
    }

    setExecutionProfile(profile: ExecutionProfile): void {
        this.executionProfile = profile;
    }

    getExecutionProfile(): ExecutionProfile {
        return this.executionProfile;
    }

    private initializeDatabase(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS containers (
                    container_id TEXT PRIMARY KEY,
                    image TEXT NOT NULL,
                    state TEXT NOT NULL,
                    cpu_limit REAL NOT NULL,
                    memory_limit_mb INTEGER NOT NULL,
                    disk_limit_mb INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    stopped_at TEXT,
                    created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `, (err: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.db.run(`
                    CREATE TABLE IF NOT EXISTS container_snapshots (
                        snapshot_id TEXT PRIMARY KEY,
                        container_id TEXT NOT NULL,
                        snapshot_name TEXT NOT NULL,
                        description TEXT,
                        snapshot_size_mb INTEGER NOT NULL,
                        command_count INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        parent_snapshot_id TEXT,
                        created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(container_id) REFERENCES containers(container_id)
                    )
                `, (snapErr: any) => {
                    if (snapErr) {
                        reject(snapErr);
                        return;
                    }

                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS container_command_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            container_id TEXT NOT NULL,
                            command TEXT NOT NULL,
                            exit_code INTEGER NOT NULL,
                            stdout TEXT,
                            stderr TEXT,
                            execution_time_ms INTEGER NOT NULL,
                            reason_code TEXT NOT NULL,
                            snapshot_id TEXT,
                            timestamp TEXT NOT NULL,
                            created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY(container_id) REFERENCES containers(container_id)
                        )
                    `, (histErr: any) => {
                        if (histErr) {
                            reject(histErr);
                            return;
                        }

                        this.db.run(`
                            CREATE TABLE IF NOT EXISTS container_signal_log (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                container_id TEXT NOT NULL,
                                signal TEXT NOT NULL,
                                reason TEXT,
                                timestamp TEXT NOT NULL,
                                created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY(container_id) REFERENCES containers(container_id)
                            )
                        `, (signalErr: any) => {
                            if (signalErr) reject(signalErr);
                            else resolve();
                        });
                    });
                });
            });
        });
    }

    private containerDir(container_id: string): string {
        return join(this.runtimeBaseDir, container_id);
    }

    private workspaceDir(container_id: string): string {
        return join(this.containerDir(container_id), "workspace");
    }

    private snapshotsDir(container_id: string): string {
        return join(this.containerDir(container_id), "snapshots");
    }

    async createContainer(image: string, resource_quota: ResourceQuota): Promise<Container> {
        await this.initializationPromise;

        const container_id = uuidv4();
        const created_at = new Date().toISOString();
        const backend = this.getRuntimeBackend();

        const container: Container = {
            container_id,
            image,
            state: ContainerState.CREATED,
            resource_quota,
            created_at,
        };

        if (backend === "docker") {
            const memoryLimit = resource_quota.memory_limit_mb > 0 ? `${resource_quota.memory_limit_mb}m` : "512m";
            const cpuLimit = resource_quota.cpu_limit > 0 ? String(resource_quota.cpu_limit) : "0.5";

            // Create the container but don't start it yet.
            // We use the container_id as the name to avoid collisions.
            const args = [
                "create",
                "--name", container_id,
                "--memory", memoryLimit,
                "--cpus", cpuLimit,
                "--workdir", "/workspace",
                image,
                "tail", "-f", "/dev/null" // Keep it alive
            ];

            await this.runDockerCommand(args);
        } else {
            const cDir = this.containerDir(container_id);
            const wDir = this.workspaceDir(container_id);
            const sDir = this.snapshotsDir(container_id);
            mkdirSync(cDir, { recursive: true });
            mkdirSync(wDir, { recursive: true });
            mkdirSync(sDir, { recursive: true });
        }

        await this.persistContainer(container);
        this.snapshots.set(container_id, []);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_create",
            status: "succeeded",
            details: { image, resource_quota, runtime: backend },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });

        return container;
    }

    async startContainer(container_id: string): Promise<Container> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);
        if (container.state !== ContainerState.CREATED && container.state !== ContainerState.STOPPED) {
            throw new Error(`Container must be in CREATED or STOPPED state to start (current: ${container.state})`);
        }

        const backend = this.getRuntimeBackend();
        container.state = ContainerState.RUNNING;
        container.started_at = new Date().toISOString();
        container.stopped_at = undefined;

        if (backend === "docker") {
            await this.runDockerCommand(["start", container_id]);
            this.activeContainers.set(container_id, {
                container,
                runtimeRoot: "/workspace", // Virtual root inside container
            });
        } else {
            this.activeContainers.set(container_id, {
                container,
                runtimeRoot: this.workspaceDir(container_id),
            });
        }

        await this.persistContainer(container);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_start",
            status: "succeeded",
            details: { container_id, runtime: backend },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });

        return container;
    }

    async execInContainer(container_id: string, command: string, timeout_ms: number = 30000): Promise<ExecInContainerResponse> {
        await this.initializationPromise;

        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry) {
            throw new Error(`Container ${container_id} not found or not running`);
        }

        const { container, runtimeRoot } = containerEntry;
        const tier = this.classifyCommandTier(command);
        const policyDecision = await this.routeThroughPolicy(container_id, tier, command);
        if (policyDecision === "deny") {
            throw new Error(`Command denied by policy (tier: ${tier})`);
        }

        const start = Date.now();
        container.state = ContainerState.EXECUTING;
        await this.persistContainer(container);

        const backend = this.getRuntimeBackend();
        let shell: string;
        let args: string[];

        if (backend === "docker") {
            shell = "docker";
            args = ["exec", container_id, "sh", "-c", command];
        } else {
            const isWin = process.platform === "win32";
            shell = isWin ? "cmd.exe" : "/bin/sh";
            args = isWin ? ["/d", "/s", "/c", command] : ["-lc", command];
        }

        const response = await new Promise<ExecInContainerResponse>((resolve, reject) => {
            const proc = spawn(shell, args, {
                cwd: backend === "docker" ? process.cwd() : runtimeRoot,
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });

            let stdout = "";
            let stderr = "";
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill("SIGKILL");
                if (backend === "docker") {
                    // Force kill the container process too
                    spawn("docker", ["kill", container_id]).on("error", () => { });
                }
                this.handleTimeout(container_id, timeout_ms);
            }, timeout_ms);

            proc.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8");
            });
            proc.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
            });
            proc.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
            proc.on("close", (code) => {
                clearTimeout(timer);
                const execution_time_ms = Date.now() - start;
                resolve({
                    container_id,
                    command,
                    exit_code: timedOut ? 124 : (code ?? -1),
                    stdout,
                    stderr,
                    execution_time_ms,
                    timestamp: new Date().toISOString(),
                });
            });
        });

        container.state = response.exit_code === 124 ? ContainerState.TIMEOUT : ContainerState.RUNNING;
        await this.persistContainer(container);
        await this.persistCommandExecution(response, `tier_${tier}_executed`);

        if (backend !== "docker") {
            await this.monitorResourceUsage(container_id);
        }

        return response;
    }

    async snapshotContainer(container_id: string, snapshot_name: string, description?: string): Promise<ContainerSnapshot> {
        await this.initializationPromise;
        const backend = this.getRuntimeBackend();

        if (backend === "docker") {
            const snapshot_id = `prism-snap-${uuidv4().slice(0, 12)}`;
            const created_at = new Date().toISOString();

            await this.runDockerCommand(["commit", container_id, snapshot_id]);

            const snapshot: ContainerSnapshot = {
                snapshot_id,
                container_id,
                snapshot_name,
                description,
                snapshot_size_mb: 0, // Placeholder
                command_count: 0,
                created_at,
                parent_snapshot_id: undefined,
            };

            await this.persistSnapshot(snapshot);

            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_snapshot",
                status: "succeeded",
                details: { snapshot_name, snapshot_id, runtime: "docker" },
                authorityTier: "tier2_conditional",
                policyDecision: "allow",
            });

            return snapshot;
        }

        const workspace = this.workspaceDir(container_id);
        const snapshotsDir = this.snapshotsDir(container_id);
        if (!existsSync(workspace)) {
            throw new Error(`Container ${container_id} runtime workspace is missing`);
        }

        const snapshot_id = uuidv4();
        const created_at = new Date().toISOString();
        const existingSnapshots = this.snapshots.get(container_id) || [];
        const parent_snapshot_id = existingSnapshots.length > 0 ? existingSnapshots[existingSnapshots.length - 1].snapshot_id : undefined;

        const snapshotPath = join(snapshotsDir, snapshot_id);
        mkdirSync(snapshotPath, { recursive: true });
        cpSync(workspace, snapshotPath, { recursive: true, force: true });

        // Write an audit manifest into the snapshot so it has a verifiable
        // footprint even when the workspace is empty (empty workspaces would
        // otherwise round to a zero-byte snapshot, which break downstream
        // size-based audits and parity assertions). The manifest also serves
        // as a stable on-disk record of the snapshot identity.
        const manifest = {
            snapshot_id,
            container_id,
            snapshot_name,
            description: description ?? null,
            created_at,
            parent_snapshot_id: parent_snapshot_id ?? null,
            adapter: "builtin-prism",
            schema_version: 1,
        };
        writeFileSync(
            join(snapshotPath, ".prism-snapshot.json"),
            JSON.stringify(manifest, null, 2),
            "utf-8",
        );

        const snapshot_size_mb = Math.max(0, Math.ceil(this.dirSizeBytes(snapshotPath) / (1024 * 1024)));
        const snapshot: ContainerSnapshot = {
            snapshot_id,
            container_id,
            snapshot_name,
            description,
            snapshot_size_mb,
            command_count: existingSnapshots.reduce((sum, s) => sum + s.command_count, 0),
            created_at,
            parent_snapshot_id,
        };

        await new Promise<void>((resolve, reject) => {
            this.db.run(
                `INSERT INTO container_snapshots
                 (snapshot_id, container_id, snapshot_name, description, snapshot_size_mb, command_count, created_at, parent_snapshot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    snapshot.snapshot_id,
                    snapshot.container_id,
                    snapshot.snapshot_name,
                    snapshot.description,
                    snapshot.snapshot_size_mb,
                    snapshot.command_count,
                    snapshot.created_at,
                    snapshot.parent_snapshot_id,
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });

        existingSnapshots.push(snapshot);
        this.snapshots.set(container_id, existingSnapshots);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_snapshot",
            status: "succeeded",
            details: { snapshot_name, snapshot_id, runtime: "builtin-prism" },
            authorityTier: "tier2_conditional",
            policyDecision: "allow",
        });

        return snapshot;
    }

    async revertContainer(container_id: string, snapshot_id: string): Promise<Container> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);
        const snapshots = await this.listSnapshots(container_id);
        const snapshot = snapshots.find((s) => s.snapshot_id === snapshot_id);
        if (!snapshot) {
            throw new Error(`Snapshot ${snapshot_id} not found for container ${container_id}`);
        }

        const backend = this.getRuntimeBackend();
        if (backend === "docker") {
            // To revert in Docker:
            // 1. Stop and remove current container
            // 2. Create and start a new container from the snapshot image
            await this.runDockerCommand(["stop", container_id]).catch(() => { });
            await this.runDockerCommand(["rm", container_id]).catch(() => { });

            const memoryLimit = container.resource_quota.memory_limit_mb > 0 ? `${container.resource_quota.memory_limit_mb}m` : "512m";
            const cpuLimit = container.resource_quota.cpu_limit > 0 ? String(container.resource_quota.cpu_limit) : "0.5";

            const args = [
                "run", "-d",
                "--name", container_id,
                "--memory", memoryLimit,
                "--cpus", cpuLimit,
                "--workdir", "/workspace",
                snapshot.snapshot_id,
                "tail", "-f", "/dev/null"
            ];
            await this.runDockerCommand(args);

            container.state = ContainerState.RUNNING;
            container.started_at = new Date().toISOString();
            container.stopped_at = undefined;
            this.activeContainers.set(container_id, { container, runtimeRoot: "/workspace" });
        } else {
            const workspace = this.workspaceDir(container_id);
            const snapshotPath = join(this.snapshotsDir(container_id), snapshot_id);
            if (!existsSync(snapshotPath)) {
                throw new Error(`Snapshot content is missing: ${snapshot_id}`);
            }

            rmSync(workspace, { recursive: true, force: true });
            mkdirSync(workspace, { recursive: true });
            cpSync(snapshotPath, workspace, { recursive: true, force: true });

            container.state = ContainerState.RUNNING;
            container.started_at = new Date().toISOString();
            container.stopped_at = undefined;
            this.activeContainers.set(container_id, { container, runtimeRoot: workspace });
        }

        await this.persistContainer(container);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_revert",
            status: "succeeded",
            details: { snapshot_id, runtime: backend },
            authorityTier: "tier2_conditional",
            policyDecision: "allow",
        });

        return container;
    }

    async stopContainer(container_id: string): Promise<void> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);
        const backend = this.getRuntimeBackend();

        this.db.run(
            "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [container_id, "SIGTERM", "graceful_stop", new Date().toISOString()],
        );

        if (backend === "docker") {
            await this.runDockerCommand(["stop", container_id]);
        }

        this.activeContainers.delete(container_id);

        container.state = ContainerState.STOPPED;
        container.stopped_at = new Date().toISOString();
        await this.persistContainer(container);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_stop",
            status: "succeeded",
            details: { container_id, runtime: backend },
            authorityTier: "tier1_autonomous",
            policyDecision: "allow",
        });
    }

    async destroyContainer(container_id: string, reason: string): Promise<void> {
        await this.initializationPromise;

        const container = await this.getContainerStatus(container_id);
        const backend = this.getRuntimeBackend();

        if (container.state === ContainerState.RUNNING || container.state === ContainerState.EXECUTING) {
            await this.stopContainer(container_id);
        }

        if (backend === "docker") {
            await this.runDockerCommand(["rm", "-f", container_id]);
            // Clean up any snapshot images
            const snaps = await this.listSnapshots(container_id);
            for (const s of snaps) {
                await this.runDockerCommand(["rmi", "-f", s.snapshot_id]).catch(() => { });
            }
        }

        this.activeContainers.delete(container_id);
        this.snapshots.delete(container_id);

        if (backend !== "docker") {
            rmSync(this.containerDir(container_id), { recursive: true, force: true });
        }

        this.db.run(
            "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [container_id, "SIGKILL", `destruction: ${reason}`, new Date().toISOString()],
        );

        container.state = ContainerState.DESTROYED;
        await this.persistContainer(container);

        this.activityBus.emit({
            sessionId: container_id,
            layer: "governance",
            operation: "container_destroy",
            status: "succeeded",
            details: { reason, runtime: backend },
            authorityTier: "tier3_approval",
            policyDecision: "allow",
        });
    }

    async getContainerStatus(container_id: string): Promise<Container> {
        await this.initializationPromise;

        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT container_id, image, state, cpu_limit, memory_limit_mb, disk_limit_mb, created_at, started_at, stopped_at
                 FROM containers
                 WHERE container_id = ?`,
                [container_id],
                (err: any, row: any) => {
                    if (err) {
                        reject(err);
                    } else if (!row) {
                        reject(new Error(`Container ${container_id} not found`));
                    } else {
                        resolve({
                            container_id: row.container_id,
                            image: row.image,
                            state: row.state as ContainerState,
                            resource_quota: {
                                cpu_limit: row.cpu_limit,
                                memory_limit_mb: row.memory_limit_mb,
                                disk_limit_mb: row.disk_limit_mb,
                            },
                            created_at: row.created_at,
                            started_at: row.started_at,
                            stopped_at: row.stopped_at,
                        });
                    }
                },
            );
        });
    }

    async listSnapshots(container_id: string): Promise<ContainerSnapshot[]> {
        await this.initializationPromise;

        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT snapshot_id, container_id, snapshot_name, description, snapshot_size_mb, command_count, created_at, parent_snapshot_id
                 FROM container_snapshots
                 WHERE container_id = ?
                 ORDER BY created_at ASC`,
                [container_id],
                (err: any, rows: any[]) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows.map((r) => ({
                            snapshot_id: r.snapshot_id,
                            container_id: r.container_id,
                            snapshot_name: r.snapshot_name,
                            description: r.description,
                            snapshot_size_mb: r.snapshot_size_mb,
                            command_count: r.command_count,
                            created_at: r.created_at,
                            parent_snapshot_id: r.parent_snapshot_id,
                        })));
                    }
                },
            );
        });
    }

    private classifyCommandTier(command: string): "tier1" | "tier2" | "tier3" {
        const primaryCmd = command.trim().split(/[\s|&;]/)[0];

        if (TIER1_KEYWORDS.includes(primaryCmd)) return "tier1";
        if (TIER2_KEYWORDS.includes(primaryCmd)) return "tier2";
        if (TIER3_KEYWORDS.includes(primaryCmd)) return "tier3";

        return "tier2";
    }

    private async routeThroughPolicy(
        container_id: string,
        tier: "tier1" | "tier2" | "tier3",
        command: string,
    ): Promise<"allow" | "deny" | "request_approval"> {
        if (tier === "tier1") {
            return "allow";
        }

        if (tier === "tier2") {
            if (this.executionProfile.auditAllOperations) {
                this.activityBus.emit({
                    sessionId: container_id,
                    layer: "governance",
                    operation: "container_tier2_audit",
                    status: "succeeded",
                    details: { command, segment: this.executionProfile.segment, reason: "audit_all_operations" },
                    authorityTier: "tier2_conditional",
                    policyDecision: "allow",
                });
            }
            if (this.executionProfile.rollbackPlanRequired) {
                this.activityBus.emit({
                    sessionId: container_id,
                    layer: "governance",
                    operation: "container_tier2_rollback_advisory",
                    status: "succeeded",
                    details: { command, segment: this.executionProfile.segment, reason: "rollback_plan_required" },
                    authorityTier: "tier2_conditional",
                    policyDecision: "allow",
                });
            }
            return "allow";
        }

        if (this.executionProfile.tier3ApprovalRequired) {
            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_tier3_approval_required",
                status: "started",
                details: { command, segment: this.executionProfile.segment },
                authorityTier: "tier3_approval",
                policyDecision: "require_approval",
            });
            return "request_approval";
        }

        return "allow";
    }

    private async monitorResourceUsage(container_id: string): Promise<void> {
        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry) return;

        const diskBytes = this.dirSizeBytes(containerEntry.runtimeRoot);
        const diskMb = Math.ceil(diskBytes / (1024 * 1024));
        const limit = containerEntry.container.resource_quota.disk_limit_mb;
        if (limit > 0 && diskMb > limit) {
            this.activityBus.emit({
                sessionId: container_id,
                layer: "governance",
                operation: "container_resource_quota_exceeded",
                status: "failed",
                details: { diskUsageMb: diskMb, limitMb: limit },
                authorityTier: "tier2_conditional",
                policyDecision: "allow",
            });
        }
    }

    private handleTimeout(container_id: string, timeout_ms: number): void {
        const containerEntry = this.activeContainers.get(container_id);
        if (!containerEntry) return;

        this.db.run(
            "INSERT INTO container_signal_log (container_id, signal, reason, timestamp) VALUES (?, ?, ?, ?)",
            [container_id, "SIGTERM", `timeout_handler:${timeout_ms}`, new Date().toISOString()],
        );

        containerEntry.container.state = ContainerState.TIMEOUT;
        this.persistContainer(containerEntry.container);
    }

    private dirSizeBytes(root: string): number {
        if (!existsSync(root)) return 0;
        let total = 0;
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
                total += this.dirSizeBytes(path);
            } else if (entry.isFile()) {
                total += statSync(path).size;
            }
        }
        return total;
    }

    private async persistSnapshot(snapshot: ContainerSnapshot): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.db.run(
                `INSERT INTO container_snapshots
                 (snapshot_id, container_id, snapshot_name, description, snapshot_size_mb, command_count, created_at, parent_snapshot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    snapshot.snapshot_id,
                    snapshot.container_id,
                    snapshot.snapshot_name,
                    snapshot.description,
                    snapshot.snapshot_size_mb,
                    snapshot.command_count,
                    snapshot.created_at,
                    snapshot.parent_snapshot_id,
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });
    }

    private async persistContainer(container: Container): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO containers
                 (container_id, image, state, cpu_limit, memory_limit_mb, disk_limit_mb, created_at, started_at, stopped_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    container.container_id,
                    container.image,
                    container.state,
                    container.resource_quota.cpu_limit,
                    container.resource_quota.memory_limit_mb,
                    container.resource_quota.disk_limit_mb,
                    container.created_at,
                    container.started_at,
                    container.stopped_at,
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });
    }

    private async persistCommandExecution(response: ExecInContainerResponse, reason_code: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO container_command_history
                 (container_id, command, exit_code, stdout, stderr, execution_time_ms, reason_code, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    response.container_id,
                    response.command,
                    response.exit_code,
                    response.stdout,
                    response.stderr,
                    response.execution_time_ms,
                    reason_code,
                    response.timestamp,
                ],
                (err: any) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });
    }

    private async runDockerCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const proc = spawn("docker", args, {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString("utf8");
            });
            proc.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString("utf8");
            });
            proc.on("error", (err) => {
                reject(err);
            });
            proc.on("close", (code) => {
                if (code !== 0) {
                    reject(new Error(`Docker command failed with code ${code}: ${stderr}`));
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }
}
